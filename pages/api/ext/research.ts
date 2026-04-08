import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';

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
  const apiKey = (process.env.ETSY_API_KEY || '').trim().replace(/^"|"$/g, '');
  const apiSecret = (process.env.ETSY_API_SECRET || '').trim().replace(/^"|"$/g, '');
  const res = await fetch(`${ETSY_BASE}${path}`, {
    headers: { 'x-api-key': `${apiKey}:${apiSecret}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Etsy API error: ${res.status} — ${errText.slice(0, 200)}`);
  }
  return res.json();
}

// Safe fetch — returns null on error instead of throwing
async function etsyGetSafe(path: string): Promise<any | null> {
  try {
    return await etsyGet(path);
  } catch {
    return null;
  }
}

// Compute listing metrics from Etsy listing data
function computeListingMetrics(item: any) {
  const price = (item.price?.amount || 0) / (item.price?.divisor || 100);
  const favs = item.num_favorers || 0;
  const views = item.views || 0;
  const createdTs = item.original_creation_timestamp || item.creation_timestamp || Math.floor(Date.now() / 1000);
  const ageMs = Date.now() - createdTs * 1000;
  const ageDays = Math.max(1, ageMs / (24 * 3600 * 1000));
  const ageMonths = Math.max(1, ageDays / 30);

  // Sales velocity: favorites correlate ~3% with sales
  const estMonthlySales = (favs / ageMonths) * 0.03;
  const estMonthlyRevenue = estMonthlySales * price;

  // Demand score: favorites per day (normalized)
  const favsPerDay = favs / ageDays;
  const demandScore = favsPerDay >= 5 ? 'hot' : favsPerDay >= 1 ? 'good' : favsPerDay >= 0.3 ? 'moderate' : 'low';

  // Conversion rate: favs / views
  const conversionRate = views > 0 ? (favs / views) * 100 : 0;

  // Stock signal
  const quantity = item.quantity || 0;

  return {
    price,
    favorites: favs,
    views,
    quantity,
    ageDays: Math.round(ageDays),
    ageMonths: Math.round(ageMonths),
    estMonthlySales: Math.round(estMonthlySales * 10) / 10,
    estMonthlyRevenue: Math.round(estMonthlyRevenue * 100) / 100,
    favsPerDay: Math.round(favsPerDay * 100) / 100,
    demandScore,
    conversionRate: Math.round(conversionRate * 100) / 100,
    lowStock: quantity > 0 && quantity <= 3,
  };
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
        const { query, listingIds } = params;
        if (!query) return res.status(400).json({ error: 'query required' });

        // Two parallel fetches:
        // 1. Keyword search for market summary stats
        // 2. Batch fetch of actual page listing IDs for per-card data
        const pageIds = Array.isArray(listingIds) ? listingIds.filter((id: string) => /^\d+$/.test(id)) : [];

        const [searchData, batchData] = await Promise.all([
          etsyGet(`/listings/active?keywords=${encodeURIComponent(query)}&limit=100&sort_on=score`),
          pageIds.length > 0
            ? etsyGetSafe(`/listings/batch?listing_ids=${pageIds.slice(0, 100).join(',')}`)
            : null,
        ]);

        // Summary from keyword search
        const items = (searchData.results || []);
        const prices = items.map((i: any) => (i.price?.amount || 0) / (i.price?.divisor || 100)).filter((p: number) => p > 0);
        const avgPrice = prices.length > 0 ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : 0;
        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
        const avgFav = items.length > 0 ? items.reduce((s: number, i: any) => s + (i.num_favorers || 0), 0) / items.length : 0;
        const avgViews = items.length > 0 ? items.reduce((s: number, i: any) => s + (i.views || 0), 0) / items.length : 0;

        // Competition level
        const uniqueShops = new Set(items.map((i: any) => i.shop_id)).size;
        const competition = uniqueShops > 50 ? 'high' : uniqueShops > 20 ? 'medium' : 'low';

        let totalEstRevenue = 0;

        // Per-listing badges from BATCH fetch (actual page listings)
        const listingBadges: Record<string, any> = {};
        const batchItems = batchData?.results || [];
        for (const item of batchItems) {
          const lid = String(item.listing_id);
          const metrics = computeListingMetrics(item);
          listingBadges[lid] = metrics;
        }

        // Also add any keyword search results (for best seller ranking)
        for (const item of items) {
          const lid = String(item.listing_id);
          if (!listingBadges[lid]) {
            const metrics = computeListingMetrics(item);
            listingBadges[lid] = metrics;
          }
          totalEstRevenue += computeListingMetrics(item).estMonthlyRevenue;
        }

        return res.json({
          summary: {
            totalResults: searchData.count || 0,
            avgPrice: Math.round(avgPrice * 100) / 100,
            minPrice: Math.round(minPrice * 100) / 100,
            maxPrice: Math.round(maxPrice * 100) / 100,
            avgFavorites: Math.round(avgFav),
            avgViews: Math.round(avgViews),
            uniqueShops,
            competition,
            estMarketRevenue: Math.round(totalEstRevenue),
          },
          listingBadges,
          plan,
        });
      }

      case 'listing_enrich': {
        const { listingId } = params;
        if (!listingId) return res.status(400).json({ error: 'listingId required' });

        // Public API — NO includes= (includes=Images,Shop only works with OAuth)
        // Fetch listing data and image count separately
        const [listing, imagesData] = await Promise.all([
          etsyGet(`/listings/${listingId}`),
          etsyGetSafe(`/listings/${listingId}/images`),
        ]);

        const metrics = computeListingMetrics(listing);

        // Fetch shop data separately if we have shop_id
        let shopData: any = null;
        if (listing.shop_id) {
          shopData = await etsyGetSafe(`/shops/${listing.shop_id}`);
        }

        // SEO score
        const titleLen = (listing.title || '').length;
        const tagCount = (listing.tags || []).length;
        const descLen = (listing.description || '').length;
        const imgCount = imagesData?.results?.length || (listing.images || []).length || 0;
        const titleScore = titleLen >= 100 ? 25 : titleLen >= 60 ? 18 : titleLen >= 30 ? 12 : 5;
        const tagScore = tagCount >= 13 ? 25 : tagCount >= 10 ? 20 : tagCount >= 5 ? 12 : 5;
        const descScore = descLen >= 300 ? 25 : descLen >= 100 ? 18 : descLen > 0 ? 10 : 0;
        const imgScore = imgCount >= 8 ? 25 : imgCount >= 5 ? 20 : imgCount >= 3 ? 15 : 5;
        const seoScore = titleScore + tagScore + descScore + imgScore;

        return res.json({
          listing: {
            listing_id: listing.listing_id,
            title: listing.title,
            price: metrics.price,
            favorites: metrics.favorites,
            views: metrics.views,
            tags: listing.tags || [],
            tagCount,
            imageCount: imgCount,
            quantity: metrics.quantity,
          },
          velocity: {
            estMonthlySales: metrics.estMonthlySales,
            estMonthlyRevenue: metrics.estMonthlyRevenue,
            ageMonths: metrics.ageMonths,
            ageDays: metrics.ageDays,
            favsPerDay: metrics.favsPerDay,
            demandScore: metrics.demandScore,
            conversionRate: metrics.conversionRate,
            lowStock: metrics.lowStock,
          },
          seoScore: { total: seoScore, title: titleScore, tags: tagScore, description: descScore, images: imgScore },
          shop: shopData ? {
            shop_id: shopData.shop_id,
            shop_name: shopData.shop_name,
            num_sales: shopData.transaction_sold_count,
            rating: shopData.review_average,
          } : null,
          plan,
        });
      }

      case 'shop_enrich': {
        const { shopId } = params;
        if (!shopId) return res.status(400).json({ error: 'shopId required' });

        // Step 1: Resolve shop name → numeric shop_id
        // Etsy API v3 requires numeric shop_id in path — shop names are NOT accepted
        // Use /shops?shop_name=X to look up by name
        let shop: any;
        if (/^\d+$/.test(shopId)) {
          shop = await etsyGet(`/shops/${shopId}`);
        } else {
          const lookup = await etsyGet(`/shops?shop_name=${encodeURIComponent(shopId)}`);
          const results = lookup.results || [];
          // Find exact match (case-insensitive)
          shop = results.find((s: any) => s.shop_name.toLowerCase() === shopId.toLowerCase());
          if (!shop && results.length > 0) shop = results[0];
          if (!shop) return res.status(404).json({ error: `Shop "${shopId}" not found` });
        }
        const numericShopId = shop.shop_id;

        // Step 2: Fetch listings using numeric ID
        const listingsData = await etsyGet(`/shops/${numericShopId}/listings/active?limit=100&sort_on=score`);

        const listings = listingsData.results || [];

        // Compute metrics for all listings
        const listingMetrics = listings.map((l: any) => ({
          ...computeListingMetrics(l),
          title: l.title,
          listing_id: l.listing_id,
        }));

        // Best sellers by estimated revenue
        const bestSellers = [...listingMetrics]
          .sort((a, b) => b.estMonthlyRevenue - a.estMonthlyRevenue)
          .slice(0, 5)
          .map((l) => ({
            title: l.title,
            listing_id: l.listing_id,
            price: l.price,
            favorites: l.favorites,
            estMonthlySales: l.estMonthlySales,
            estMonthlyRevenue: l.estMonthlyRevenue,
            demandScore: l.demandScore,
          }));

        // Aggregate shop metrics
        const prices = listingMetrics.map((l: any) => l.price).filter((p: number) => p > 0);
        const avgPrice = prices.length > 0 ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : 0;
        const totalEstMonthlyRevenue = listingMetrics.reduce((s: number, l: any) => s + l.estMonthlyRevenue, 0);
        const totalEstMonthlySales = listingMetrics.reduce((s: number, l: any) => s + l.estMonthlySales, 0);
        const avgConversionRate = listingMetrics.length > 0
          ? listingMetrics.reduce((s: number, l: any) => s + l.conversionRate, 0) / listingMetrics.length
          : 0;
        const hotListings = listingMetrics.filter((l: any) => l.demandScore === 'hot' || l.demandScore === 'good').length;
        const lowStockCount = listingMetrics.filter((l: any) => l.lowStock).length;

        // Shop age
        const shopAgeMs = Date.now() - (shop.create_timestamp || Math.floor(Date.now() / 1000)) * 1000;
        const shopAgeYears = Math.round((shopAgeMs / (365 * 24 * 3600 * 1000)) * 10) / 10;

        return res.json({
          shop: {
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            num_sales: shop.transaction_sold_count || 0,
            rating: shop.review_average || 0,
            review_count: shop.review_count || 0,
            listing_count: shop.listing_active_count || 0,
            created: shop.create_timestamp,
            shopAgeYears,
            currency: shop.currency_code || 'USD',
          },
          revenue: {
            estMonthlyRevenue: Math.round(totalEstMonthlyRevenue),
            estMonthlySales: Math.round(totalEstMonthlySales * 10) / 10,
            avgConversionRate: Math.round(avgConversionRate * 100) / 100,
            hotListings,
            lowStockCount,
          },
          avgPrice: Math.round(avgPrice * 100) / 100,
          bestSellers,
          plan,
        });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    console.error('[ext/research]', action, err?.message || err);
    return res.status(500).json({ error: `Research API error: ${err?.message || 'unknown'}` });
  }
}
