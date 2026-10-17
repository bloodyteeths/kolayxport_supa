import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { getListingStats, sanitizePageSignals, EtsyPublicApiError, rememberListingResult } from '@/lib/etsy/listingStats';
import { withResearchQuota, sendResearchOutcome, sharedCacheKey, RESEARCH_TTL } from '@/lib/ext/researchQuota';

/**
 * POST /api/ext/listing-stats
 * Body: { listingId: string, page?: PageSignals }
 *
 * Public Etsy listing stats for the Chrome extension overlay, with measured vs
 * estimated sales clearly separated (see lib/etsy/listingStats.ts).
 * Auth: any signed-in KolayXport user (Bearer token from /api/auth/extension).
 *
 * Research quota (lib/ext/researchQuota.ts): shared cross-user cache for 24 h keyed by
 * listing id + the page price/currency (the only page signals that change the numbers;
 * the rest are echoed back fresh), then the global Etsy brake and the daily lookup limit.
 */

// Simple per-user rate limit (in-process): 120 lookups / 10 min.
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

function allow(userId: string): boolean {
  const now = Date.now();
  const e = hits.get(userId);
  if (!e || now > e.resetAt) {
    hits.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (e.count >= LIMIT) return false;
  e.count++;
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const user = await getAuthUser(req, res).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!allow(user.id)) return res.status(429).json({ error: 'Too many lookups, try again in a few minutes' });

  const listingId = String(req.body?.listingId ?? '');
  if (!/^\d{4,20}$/.test(listingId)) return res.status(400).json({ error: 'valid listingId required' });

  try {
    const page = sanitizePageSignals(req.body?.page);
    const outcome = await withResearchQuota(
      {
        req,
        userId: user.id,
        marketplace: 'etsy',
        cacheKey: sharedCacheKey('etsy', 'listing', 'etsy.com', listingId, page.pagePrice ?? '', page.pageCurrency ?? ''),
        ttl: RESEARCH_TTL.detail,
        apiCallsEstimate: 5, // listing + reviews + images + shop + shop reviews
      },
      async () => ({ status: 200, body: await getListingStats(listingId, req.body?.page) }),
    );
    // Shared hits carry another viewer's page signals: echo this page's own.
    if (outcome.kind === 'ok' && outcome.source === 'shared_cache' && outcome.body && typeof outcome.body === 'object') {
      outcome.body = { ...outcome.body, pageSignals: page };
    }
    // Cached answers skip getListingStats(), so record the estimate here too: search cards reuse it.
    if (outcome.kind === 'ok' && outcome.status === 200) rememberListingResult(outcome.body);
    return sendResearchOutcome(res, outcome);
  } catch (err) {
    if (err instanceof EtsyPublicApiError) {
      const status = err.status === 404 ? 404 : 502;
      return res.status(status).json({ error: err.status === 404 ? 'Listing not found on Etsy' : 'Etsy API unavailable' });
    }
    console.error('[ext/listing-stats]', (err as Error)?.message || err);
    return res.status(500).json({ error: 'Listing stats failed' });
  }
}
