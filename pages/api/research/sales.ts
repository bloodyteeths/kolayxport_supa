/**
 * GET /api/research/sales?mkt=etsy&ids=1,2,3 — estimated monthly sales + revenue for Product finder's top listings.
 *
 * Same engine as the Chrome extension's search cards (lib/etsy/listingStats `getBatchListingStats`): every number is
 *   measured   — from a real change of the shop's sales counter between two of our snapshots (×this listing's share)
 *   estimated  — this listing's review velocity × the shop's own sales-per-review ratio
 *   insufficient / pending — no number (pending = shop data still loading; the client re-polls those ids)
 * Each call also writes snapshots, so a niche searched today gets *measured* sales on later searches (the market index).
 *
 * Shared 6 h cache (budget-aware: at the Etsy budget breaker only cached rows are served), ≤ 48 ids, 30 calls/min per
 * user. `poll=1` (the client's re-poll for `pendingIds`) bypasses the cache so pending shops resolve instead of being
 * frozen for 6 h. Read-only: never writes to a marketplace.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { applyPageEstimates, getBatchListingStats, type CardStats } from '@/lib/etsy/listingStats';
import { cachedLive, firstParam, isBudgetError, sha1, userRateLimit } from '@/lib/research/etsySearch';
import { registerMarketSet } from '@/lib/research/marketIndex';

export const MAX_SALES_IDS = 48;
const TTL_MS = 6 * 3_600_000;
/** Fresh shop fetches per call (2 Etsy calls each); the rest come back `pending` and are re-polled. */
const MAX_NEW_SHOPS = 20;

export interface ListingSales {
  kind: 'measured' | 'estimated' | 'insufficient' | 'pending';
  confidence: 'high' | 'medium' | 'low' | null;
  monthlySales: number | null;
  monthlySalesUpperBound: number | null;
  /** In the listing's own currency (`currency`). */
  monthlyRevenue: number | null;
  currency: string | null;
}

export interface SalesData {
  listings: Record<string, ListingSales>;
  pendingIds: string[];
  fetchedAt: string;
  cached: boolean;
  budgetLimited: boolean;
}

export function parseIds(raw: unknown): string[] {
  const s = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
  return Array.from(new Set(s.split(',').map((x) => x.trim()).filter((x) => /^\d{4,20}$/.test(x)))).slice(0, MAX_SALES_IDS);
}

export function toListingSales(c: CardStats): ListingSales {
  return {
    kind: c.sales.kind,
    confidence: c.sales.confidence,
    monthlySales: c.sales.monthlySales,
    monthlySalesUpperBound: c.sales.monthlySalesUpperBound,
    monthlyRevenue: c.sales.monthlyRevenue,
    currency: c.currency,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if ((firstParam(req.query.mkt) ?? 'etsy') !== 'etsy') return res.status(200).json({ data: null, unsupported: true });
  const ids = parseIds(req.query.ids);
  if (!ids.length) return res.status(400).json({ error: 'bad_request' });
  if (!userRateLimit(user.id, 'research:sales', 30)) return res.status(429).json({ error: 'rate_limited' });

  try {
    const key = `public:etsy:sales:${sha1([...ids].sort().join(','))}`;
    const poll = firstParam(req.query.poll) === '1';
    // First look (not a re-poll): keep this niche's listings in the daily market index (measured sales later).
    if (!poll) void registerMarketSet(ids);
    const served = await cachedLive(key, TTL_MS, async () => getBatchListingStats(ids, { maxNewShops: MAX_NEW_SHOPS }), { force: poll });
    // A listing opened since (extension listing page) wins, so the card and the listing page show the same figure.
    const merged = applyPageEstimates({ ...(served.data.listings || {}) }) as Record<string, CardStats>;
    const listings: Record<string, ListingSales> = {};
    for (const [id, c] of Object.entries(merged)) listings[id] = toListingSales(c);
    const data: SalesData = {
      listings,
      pendingIds: served.data.pendingIds || [],
      fetchedAt: served.fetchedAt,
      cached: served.cached,
      budgetLimited: served.budgetLimited,
    };
    return res.status(200).json({ data });
  } catch (err) {
    if (isBudgetError(err)) return res.status(200).json({ data: null, budgetLimited: true });
    logger.warn('[research/sales] failed', { userId: user.id, error: (err as Error)?.message });
    return res.status(502).json({ error: 'etsy_failed' });
  }
}
