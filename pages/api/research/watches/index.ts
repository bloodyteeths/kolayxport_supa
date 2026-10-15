/**
 * /api/research/watches — Shop tracker list + "Watch a shop" (research.md §8, §10; R3-A).
 *
 * GET  ?mkt=etsy|ebay|amazon|trendyol  ?type=etsyShop|ebaySeller|query|asin|trendyolProduct
 *   200 → ResearchResponse<WatchesData>:
 *     `rows` (ResearchWatch rows + read-only adapter rows over EbayTrackedSeller / AmazonTrackedProduct, each with
 *     Guarded metrics), `quota { used, limit, plan, stripeUpsell }`, `available` (BR-1c deployed),
 *     `alertsAvailable` (BR-7 deployed), `readingTimeUtc`.
 *     BR-1c missing → `available: false`, legacy rows only, `errors: [{ section: 'watches', key: 'research.shops.unavailable' }]`.
 *
 * POST { input? | (type + refId), type?, marketplace?, label?, alertRules? } (WatchCreateRequest)
 *   201 → { data: WatchCreateData { watch: WatchSummary, quota, created: true }, source, errors? } (created or
 *         re-activated; `errors` = first reading skipped/failed: [{ section: 'reading', key: 'research.error.budget' |
 *         'research.shops.readingFailed' }])
 *   200 → same body with `created: false` when the watch already existed and was active (idempotent)
 *   400 bad_request (research.watch.inputInvalid | research.watch.rulesInvalid) · 404 not_found (research.watch.shopNotFound)
 *   409 quota_exceeded { key: 'research.shops.quotaFull', used, limit } · 422 unsupported (research.watch.asinUnsupported)
 *   429 rate_limited · 503 unavailable (research.shops.unavailable) | budget (research.error.budget)
 *
 * Writes only KolayXport rows (ResearchWatch / EbayTrackedSeller); never writes to a marketplace.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { firstParam, userRateLimit } from '@/lib/research/etsySearch';
import { isResearchMkt, type ResearchResponse } from '@/lib/research/types';
import {
  createWatch,
  isWatchType,
  listWatches,
  parseJsonBody,
  sendWatchError,
  watchesSource,
  type WatchErrorBody,
  type WatchCreateData,
  type WatchesData,
} from '@/lib/research/watchAdapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies WatchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies WatchErrorBody);

  if (req.method === 'GET') {
    const mkt = firstParam(req.query.mkt);
    const type = firstParam(req.query.type);
    if ((mkt && mkt !== 'all' && !isResearchMkt(mkt)) || (type && !isWatchType(type))) {
      return res.status(400).json({ error: 'bad_request' } satisfies WatchErrorBody);
    }
    try {
      const data = await listWatches(user.id, { mkt: mkt && isResearchMkt(mkt) ? mkt : null, type: type && isWatchType(type) ? type : null });
      const body: ResearchResponse<WatchesData> = {
        data,
        source: watchesSource(data.rows),
        ...(data.available ? {} : { errors: [{ section: 'watches', key: 'research.shops.unavailable' }] }),
      };
      return res.status(200).json(body);
    } catch (err) {
      return sendWatchError(res, err, 'list');
    }
  }

  if (!userRateLimit(user.id, 'research:watches:create', 20)) {
    return res.status(429).json({ error: 'rate_limited' } satisfies WatchErrorBody);
  }
  try {
    const result = await createWatch(user.id, parseJsonBody(req.body));
    const body: ResearchResponse<WatchCreateData> = {
      data: { watch: result.summary, quota: result.quota, created: result.created },
      source: watchesSource([result.summary]),
      ...(result.errors.length ? { errors: result.errors } : {}),
    };
    return res.status(result.created ? 201 : 200).json(body);
  } catch (err) {
    return sendWatchError(res, err, 'create');
  }
}
