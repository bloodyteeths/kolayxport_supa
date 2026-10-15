/**
 * POST /api/research/price-gap/refresh — Price gap "Refresh prices" for one Trendyol category (research.md §9, R4, Pro).
 *
 * Body: `{ cat: string }` (a slug of TRENDYOL_CATEGORIES).
 * 200 → `{ data: { category, refreshed, updatedAt } }`: `refreshed: false` when the category was read less than an
 *       hour ago (nothing is fetched; the prices are already that fresh). `updatedAt` = newest Trendyol index read (ISO).
 * 400 { error:'bad_request', key } · 401 · 402 featureLocked (lib/billing/requireFeature) · 405 · 429 rate_limited · 500.
 *
 * Writes only the shared index tables (TrendyolProductIndex, EbayProductIndex, ArbitrageMatch) through
 * lib/arbitrage/indexRefresh; nothing user-specific, nothing on a marketplace. The scheduler job
 * `arbitrage-index-refresh` keeps every category filled; this is the on-demand top-up.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { isFeatureLockedError, requireFeature } from '@/lib/billing/requireFeature';
import {
  MANUAL_REFRESH_COOLDOWN_MS,
  isIndexedCategory,
  refreshArbitrageCategory,
  trendyolIndexUpdatedAt,
} from '@/lib/arbitrage/indexRefresh';
import type { ResearchErrorBody } from '@/lib/research/types';

export const config = { runtime: 'nodejs', maxDuration: 300 };

export interface PriceGapRefreshData {
  category: string;
  refreshed: boolean;
  updatedAt: string | null;
}

const WINDOW_MS = 3_600_000;
export const MAX_REFRESHES_PER_HOUR = 5;
const recent = new Map<string, number[]>();

/** Per-user sliding window (in memory, per process). Returns false when the user is over the limit. */
export function takeRefreshSlot(userId: string, nowMs = Date.now()): boolean {
  const list = (recent.get(userId) ?? []).filter((t) => nowMs - t < WINDOW_MS);
  if (list.length >= MAX_REFRESHES_PER_HOUR) {
    recent.set(userId, list);
    return false;
  }
  list.push(nowMs);
  recent.set(userId, list);
  return true;
}

export function __resetRefreshSlotsForTests() {
  recent.clear();
}

function bodyCat(raw: unknown): unknown {
  let b = raw;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      return null;
    }
  }
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>).cat : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies ResearchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies ResearchErrorBody);

  try {
    await requireFeature(user.id, 'arbitrage');
  } catch (err) {
    if (isFeatureLockedError(err)) return res.status(402).json(err.body());
    logger.error('[research/price-gap/refresh] feature check failed', err as Error);
    return res.status(500).json({ error: 'server_error' } satisfies ResearchErrorBody);
  }

  const cat = bodyCat(req.body);
  if (!isIndexedCategory(cat)) return res.status(400).json({ error: 'bad_request', key: 'research.gap.error.categoryNotIndexed' } satisfies ResearchErrorBody);

  try {
    const now = new Date();
    const last = await trendyolIndexUpdatedAt(cat, now);
    if (last && now.getTime() - last.getTime() < MANUAL_REFRESH_COOLDOWN_MS) {
      return res.status(200).json({ data: { category: cat, refreshed: false, updatedAt: last.toISOString() } satisfies PriceGapRefreshData });
    }
    if (!takeRefreshSlot(user.id, now.getTime())) {
      return res.status(429).json({ error: 'rate_limited', key: 'research.gap.refreshFailed' } satisfies ResearchErrorBody);
    }
    const r = await refreshArbitrageCategory(cat);
    if (r.errors.length) logger.warn('[research/price-gap/refresh] partial refresh', { cat, errors: r.errors.slice(0, 3) });
    const updated = await trendyolIndexUpdatedAt(cat);
    return res.status(200).json({ data: { category: cat, refreshed: true, updatedAt: updated?.toISOString() ?? null } satisfies PriceGapRefreshData });
  } catch (err) {
    logger.error('[research/price-gap/refresh] failed', err as Error);
    return res.status(500).json({ error: 'server_error', key: 'research.gap.refreshFailed' } satisfies ResearchErrorBody);
  }
}
