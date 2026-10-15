/**
 * /api/research/keywords/track — start / stop tracking keyword positions for one of the user's Etsy listings
 * (research.md §3.4 "Track", §6.1 Tracked view; R2-A). Writes only KolayXport rows (RankTrackedKeyword/RankSnapshot);
 * the immediate rank check is a read of Etsy's public search. Nothing is written to Etsy.
 *
 * POST   body TrackRequest `{ listingId, shopId, keywords[], listingTitle?, checkNow? }` → 200 `{ data: TrackData }`.
 *        The shop must belong to the user (403 otherwise). Re-tracking a stopped keyword re-activates it.
 *        `checkNow` (default true) rank-checks up to 3 keywords now (≤ 5 Etsy calls each); the rest wait for the daily
 *        cron. Budget breaker → tracked without a check and `errors[{ section: 'rank', key: 'research.error.budget' }]`.
 *        Pass `checkNow: false` for the auto-tracking of tags just added from the explorer (spec §6.1 "Auto-track").
 * DELETE body (or query) UntrackRequest `{ ids[] }` | `{ listingId, keywords[] }` → 200 `{ data: { tracked: n } }`
 *        (n = rows deactivated; only the user's own rows are touched; 0 is not an error).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { userRateLimit } from '@/lib/research/etsySearch';
import { decodeEntities } from '@/lib/research/stats';
import { MAX_IMMEDIATE_CHECKS, normalizeTrackKeywords, trackKeywords, untrackKeywords, userOwnsEtsyShop } from '@/lib/research/rank';
import type { KeywordErrorBody, TrackData, UntrackData } from '@/lib/research/keywordTypes';
import type { ResearchSectionError } from '@/lib/research/types';

const isId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}$/.test(v);

function body(req: NextApiRequest): Record<string, unknown> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { const b = JSON.parse(req.body); return b && typeof b === 'object' ? b : {}; } catch { return {}; }
  }
  return {};
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).filter((x): x is string => typeof x === 'string');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies KeywordErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies KeywordErrorBody);
  if (!userRateLimit(user.id, 'research:keywords:track', 30)) return res.status(429).json({ error: 'rate_limited' } satisfies KeywordErrorBody);
  const b = body(req);

  try {
    if (req.method === 'DELETE') {
      const q = req.query as Record<string, unknown>;
      const ids = [...asList(b.ids), ...asList(q.ids), ...asList(q.id)];
      const listingId = typeof b.listingId === 'string' ? b.listingId : typeof q.listingId === 'string' ? q.listingId : undefined;
      const keywords = [...asList(b.keywords), ...asList(q.keywords), ...asList(q.keyword)];
      if (ids.length === 0 && !(isId(listingId) && keywords.length)) {
        return res.status(400).json({ error: 'bad_request' } satisfies KeywordErrorBody);
      }
      const n = await untrackKeywords({ userId: user.id, ids, listingId: isId(listingId) ? listingId : undefined, keywords });
      return res.status(200).json({ data: { tracked: n } satisfies UntrackData });
    }

    const listingId = b.listingId != null ? String(b.listingId) : '';
    const shopId = b.shopId != null ? String(b.shopId) : '';
    const keywords = normalizeTrackKeywords(b.keywords);
    if (!isId(listingId) || !isId(shopId) || keywords.length === 0) {
      return res.status(400).json({ error: 'bad_request' } satisfies KeywordErrorBody);
    }
    if (!(await userOwnsEtsyShop(user.id, shopId))) return res.status(403).json({ error: 'forbidden' } satisfies KeywordErrorBody);

    // Title for the legacy rows: the cached listing title wins over a client-sent one.
    const cached = await prisma.etsyListing.findFirst({
      where: { etsyShopId: shopId, etsyListingId: BigInt(listingId) },
      select: { title: true },
    });
    // Tracking is for the user's own listings only (each keyword costs daily Etsy calls in the cron).
    if (!cached) return res.status(404).json({ error: 'not_found' } satisfies KeywordErrorBody);
    const listingTitle = decodeEntities(cached.title || (typeof b.listingTitle === 'string' ? b.listingTitle.slice(0, 200) : ''));
    const checkNow = b.checkNow === false ? 0 : MAX_IMMEDIATE_CHECKS;

    const out = await trackKeywords({ userId: user.id, shopId, listingId, listingTitle, keywords, checkNow });
    const errors: ResearchSectionError[] = out.budgetLimited ? [{ section: 'rank', key: 'research.error.budget' }] : [];
    const data: TrackData = {
      tracked: out.ids.length,
      ids: out.ids,
      checked: out.checked.map((c) => ({ keyword: c.keyword, id: c.id, rank: c.rank, totalResults: c.totalResults })),
    };
    return res.status(200).json({ data, ...(errors.length ? { errors } : {}) });
  } catch (err) {
    logger.error('[research/keywords/track] failed', err as Error);
    return res.status(500).json({ error: 'server_error' } satisfies KeywordErrorBody);
  }
}
