/**
 * /api/research/watches/[id] — one watch (research.md §8.1 SidePanel; R3-A).
 *
 * `id` = ResearchWatch id, or `ebaySeller.<id>` / `asin.<id>` for the read-only adapter rows.
 *
 * GET    200 → ResearchResponse<WatchDetail> `{ watch, shop, sales, newListings, fastest, tagGap, tagGapAvailable,
 *        listingsSampled, listingsComplete }`: 30-day measured sales (gaps = null, guard-7 drops `dropped: true`),
 *        new listings (7 d), fastest-gaining listings (favorites Δ Measured, share of sales = Estimate), tag gap vs
 *        the user's active Etsy listings. 404 not_found · 503 unavailable.
 * PATCH  { label?, alertRules?: Partial<AlertRules>, isActive?: true } → 200 { data: { watch: WatchSummary }, source }
 *        400 bad_request · 404 not_found · 409 read_only (legacy rows) | quota_exceeded (re-activate) · 503 unavailable.
 * DELETE → 200 { data: { id, removed: true } } (soft: isActive=false; shared readings stay). 404 · 503.
 *
 * KolayXport rows only; nothing is written to a marketplace.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { firstParam, userRateLimit } from '@/lib/research/etsySearch';
import type { ResearchResponse } from '@/lib/research/types';
import {
  getWatchDetail,
  parseJsonBody,
  patchWatch,
  removeWatch,
  sendWatchError,
  watchesSource,
  type WatchDetail,
  type WatchErrorBody,
  type WatchSummary,
} from '@/lib/research/watchAdapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies WatchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies WatchErrorBody);
  const id = firstParam(req.query.id);
  if (!id) return res.status(400).json({ error: 'bad_request' } satisfies WatchErrorBody);

  try {
    if (req.method === 'GET') {
      const data = await getWatchDetail(user.id, id);
      const body: ResearchResponse<WatchDetail> = {
        data,
        source: watchesSource([data.watch]),
      };
      return res.status(200).json(body);
    }
    if (!userRateLimit(user.id, 'research:watches:write', 60)) {
      return res.status(429).json({ error: 'rate_limited' } satisfies WatchErrorBody);
    }
    if (req.method === 'PATCH') {
      const data = await patchWatch(user.id, id, parseJsonBody(req.body));
      const body: ResearchResponse<{ watch: WatchSummary }> = { data: { watch: data }, source: watchesSource([data]) };
      return res.status(200).json(body);
    }
    const data = await removeWatch(user.id, id);
    return res.status(200).json({ data });
  } catch (err) {
    return sendWatchError(res, err, req.method === 'GET' ? 'detail' : req.method === 'PATCH' ? 'patch' : 'delete');
  }
}
