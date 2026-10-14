import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { etsyFetch, etsyPublicHeaders } from '@/lib/etsy/http';
import { EtsyPriority } from '@/lib/etsy/rateBudget';
import { getBatchListingStats, getListingStats, getShopStats, EtsyPublicApiError } from '@/lib/etsy/listingStats';

// Rate limiting per IP for anonymous users
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
const ETSY_BASE = 'https://openapi.etsy.com/v3/application';

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

  // Anonymous rate limit
  if (!userId) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    if (!checkAnonLimit(ip)) {
      return res.status(429).json({ error: 'Daily free limit reached (3/day). Sign in with KolayXport account.' });
    }
  }

  const { action, ...params } = req.body || {};

  try {
    switch (action) {
      case 'search_enrich': {
        // Market summary only (1 Etsy call). Per-card sales come from 'listings_batch',
        // which uses measured/estimated shop data instead of the old reviews x 8 formula.
        const { query } = params;
        if (!query || typeof query !== 'string') return res.status(400).json({ error: 'query required' });

        const searchData = await etsyGet(`/listings/active?keywords=${encodeURIComponent(query.slice(0, 200))}&limit=100&sort_on=score`);
        const items = (searchData.results || []);
        const prices = items.map((i: any) => (i.price?.amount || 0) / (i.price?.divisor || 100)).filter((p: number) => p > 0);
        const avgPrice = prices.length > 0 ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : 0;
        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
        const avgFav = items.length > 0 ? items.reduce((s: number, i: any) => s + (i.num_favorers || 0), 0) / items.length : 0;
        const uniqueShops = new Set(items.map((i: any) => i.shop_id)).size;
        const competition = uniqueShops > 50 ? 'high' : uniqueShops > 20 ? 'medium' : 'low';
        const currencies = new Set(items.map((i: any) => i.price?.currency_code).filter(Boolean));

        return res.json({
          summary: {
            totalResults: searchData.count || 0,
            avgPrice: Math.round(avgPrice * 100) / 100,
            minPrice: Math.round(minPrice * 100) / 100,
            maxPrice: Math.round(maxPrice * 100) / 100,
            // Mixed currencies make the price stats approximate — tell the client.
            currency: currencies.size === 1 ? [...currencies][0] : null,
            avgFavorites: Math.round(avgFav),
            uniqueShops,
            competition,
            sampled: items.length,
          },
          plan,
        });
      }

      case 'listings_batch': {
        // Per-card stats for search results / shop grids. Signed-in users only (costs Etsy QPD).
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const ids = Array.isArray(params.listingIds) ? params.listingIds.map(String) : [];
        const result = await getBatchListingStats(ids, { maxNewShops: Number(params.maxNewShops) || undefined });
        return res.json({ ...result, fetchedAt: new Date().toISOString(), plan });
      }

      case 'listing_enrich': {
        // Legacy action (pre-9.5 extensions). Same data as /api/ext/listing-stats.
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const listingId = String(params.listingId || '');
        if (!/^\d{4,20}$/.test(listingId)) return res.status(400).json({ error: 'listingId required' });
        return res.json({ ...(await getListingStats(listingId, {})), plan });
      }

      case 'shop_enrich': {
        const shopId = String(params.shopId || '');
        if (!shopId || shopId.length > 100) return res.status(400).json({ error: 'shopId required' });
        const stats = await getShopStats(shopId);
        if (!stats) return res.status(404).json({ error: 'Shop not found' });
        return res.json({ ...stats, plan });
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

