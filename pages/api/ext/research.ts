import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { etsyFetch, etsyPublicHeaders } from '@/lib/etsy/http';
import { EtsyPriority } from '@/lib/etsy/rateBudget';
import { getBatchListingStats, applyPageEstimates, rememberListingResult, getListingStats, getShopStats, EtsyPublicApiError } from '@/lib/etsy/listingStats';
import { buildFxTable } from '@/lib/research/stats';
import { summarizeEtsySearch } from '@/lib/etsy/searchSummary';
import { convertCurrency } from '@/lib/finance/fx';
import { withResearchQuota, sendResearchOutcome, sharedCacheKey, RESEARCH_TTL, limitBody, istanbulDay } from '@/lib/ext/researchQuota';
import { ETSY_OPENAPI_BASE } from '@/lib/etsy/apiBase';

// Anonymous (signed-out) allowance per IP: only marketplace calls count; shared-cache hits are free.
const anonLimitMap = new Map<string, { count: number; resetAt: number }>();
const ANON_LIMIT = 3; // 3 requests per day
const ANON_WINDOW = 86400000; // 24h

function checkAnonLimit(ip: string): boolean {
  const now = Date.now();
  const entry = anonLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    anonLimitMap.set(ip, { count: 1, resetAt: now + ANON_WINDOW });
    return true;
  }
  if (entry.count >= ANON_LIMIT) return false;
  entry.count++;
  return true;
}

// Etsy public API helper
const ETSY_BASE = ETSY_OPENAPI_BASE;

async function etsyGet(path: string) {
  // Through etsyFetch for the shared rate budget; no retries (unchanged behaviour).
  const res = await etsyFetch(`${ETSY_BASE}${path}`, { headers: etsyPublicHeaders() }, { priority: EtsyPriority.Interactive, retries: 0 });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Etsy API error: ${res.status} — ${errText.slice(0, 200)}`);
  }
  return res.json();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS for extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-KX-Client, X-KX-Page-View');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Auth check — optional (Bearer token OR session cookie)
  let userId: string | null = null;
  let plan = 'free';
  try {
    const user = await getAuthUser(req, res);
    if (user) {
      userId = user.id;
      plan = 'starter';
    }
  } catch { /* anonymous access */ }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const allowAnonymous = () => checkAnonLimit(ip);

  const { action, ...params } = req.body || {};

  // Research quota (lib/ext/researchQuota.ts): shared cache → global brake → daily lookups.
  // Every action below calls the Etsy API on a miss, so all of them go through the wrapper.
  try {
    switch (action) {
      case 'search_enrich': {
        // Market summary only (1 Etsy call). Per-card sales come from 'listings_batch',
        // which uses measured/estimated shop data instead of the old reviews x 8 formula.
        const { query } = params;
        if (!query || typeof query !== 'string') return res.status(400).json({ error: 'query required' });
        const q = query.slice(0, 200);
        const outcome = await withResearchQuota(
          { req, userId, marketplace: 'etsy', cacheKey: sharedCacheKey('etsy', 'search', 'etsy.com', q), ttl: RESEARCH_TTL.search, apiCallsEstimate: 1, allowAnonymous },
          async () => {
            const searchData = await etsyGet(`/listings/active?keywords=${encodeURIComponent(q)}&limit=100&sort_on=score`);
            // Pure summary (lib/etsy/searchSummary.ts): Money objects -> amount/divisor, FX to USD,
            // digital downloads excluded for physical queries, median + P25-P75, median favourites.
            // API prices are LIST prices (Etsy does not expose sale prices); the extension prefers
            // the prices displayed on the page and uses this only as a fallback.
            const currencies = (searchData.results || []).map((i: any) => i?.price?.currency_code || 'USD');
            const fx = await buildFxTable(currencies, 'USD', convertCurrency).catch(() => ({}));
            return { status: 200, body: { summary: summarizeEtsySearch(searchData, { query, fx }) } };
          },
        );
        return sendResearchOutcome(res, outcome, { plan });
      }

      case 'listings_batch': {
        // Per-card stats for search results / shop grids. Signed-in users only (costs Etsy QPD).
        if (!userId) return signedOut(res);
        const ids: string[] = Array.isArray(params.listingIds) ? params.listingIds.map(String) : [];
        const maxNewShops = Number(params.maxNewShops) || undefined;
        const outcome = await withResearchQuota(
          {
            req, userId, marketplace: 'etsy',
            cacheKey: ids.length ? sharedCacheKey('etsy', 'listings_batch', 'etsy.com', [...ids].sort().join(','), maxNewShops ?? '') : null,
            // Search-grid card stats: the search TTL (6 h), so they pick up listing-page estimates soon.
            ttl: RESEARCH_TTL.search,
            // 1 /listings/batch call + 2 calls per freshly fetched shop (capped server-side).
            apiCallsEstimate: 7,
          },
          async () => {
            const result = await getBatchListingStats(ids, { maxNewShops });
            const body = { ...result, fetchedAt: new Date().toISOString() };
            // Still-pending shop data is re-polled by the extension: never freeze it in the shared cache.
            return { status: 200, body, cacheable: !(result as any).pendingIds?.length };
          },
        );
        // Cached or live, a listing opened since then wins: same number on the card and the listing page.
        if (outcome.kind === 'ok' && outcome.body && typeof outcome.body === 'object') {
          outcome.body = { ...outcome.body, listings: applyPageEstimates({ ...(outcome.body.listings || {}) }) };
        }
        return sendResearchOutcome(res, outcome, { plan });
      }

      case 'listing_enrich': {
        // Legacy action (pre-9.5 extensions). Same data as /api/ext/listing-stats.
        if (!userId) return signedOut(res);
        const listingId = String(params.listingId || '');
        if (!/^\d{4,20}$/.test(listingId)) return res.status(400).json({ error: 'listingId required' });
        const outcome = await withResearchQuota(
          { req, userId, marketplace: 'etsy', cacheKey: sharedCacheKey('etsy', 'listing', 'etsy.com', listingId, 'nopage'), ttl: RESEARCH_TTL.detail, apiCallsEstimate: 5 },
          async () => ({ status: 200, body: await getListingStats(listingId, {}) }),
        );
        if (outcome.kind === 'ok' && outcome.status === 200) rememberListingResult(outcome.body);
        return sendResearchOutcome(res, outcome, { plan });
      }

      case 'shop_enrich': {
        const shopId = String(params.shopId || '');
        if (!shopId || shopId.length > 100) return res.status(400).json({ error: 'shopId required' });
        const outcome = await withResearchQuota(
          { req, userId, marketplace: 'etsy', cacheKey: sharedCacheKey('etsy', 'shop', 'etsy.com', shopId), ttl: RESEARCH_TTL.detail, apiCallsEstimate: 3, allowAnonymous },
          async () => {
            const stats = await getShopStats(shopId);
            return stats ? { status: 200, body: stats } : { status: 404, body: { error: 'Shop not found' } };
          },
        );
        return sendResearchOutcome(res, outcome, outcome.kind === 'ok' && outcome.status === 200 ? { plan } : undefined);
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    if (err instanceof EtsyPublicApiError && err.status === 404) return res.status(404).json({ error: 'Not found on Etsy' });
    console.error('[ext/research]', action, err?.message || err);
    return res.status(500).json({ error: `Research API error: ${err?.message || 'unknown'}` });
  }
}

/** Signed-out caller on a signed-in-only action: 429 limit payload (the extension shows the sign-up card). */
function signedOut(res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(429).json(limitBody('signed_out', 0, 0, istanbulDay().resetAt));
}
