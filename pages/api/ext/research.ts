import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';

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
const ETSY_API_KEY = process.env.ETSY_API_KEY || '';
const ETSY_BASE = 'https://openapi.etsy.com/v3/application';

async function etsyGet(path: string) {
  const res = await fetch(`${ETSY_BASE}${path}`, {
    headers: { 'x-api-key': ETSY_API_KEY },
  });
  if (!res.ok) throw new Error(`Etsy API error: ${res.status}`);
  return res.json();
}

// Sleep for rate limiting
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS for extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Auth check — optional (Bearer token OR Supabase cookie)
  let userId: string | null = null;
  let plan = 'free';
  try {
    const supabase = getSupabaseServerClient(req, res);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      userId = user.id;
      plan = 'starter';
    }
  } catch { /* anonymous access */ }

  // Anonymous rate limit
  if (!userId) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    if (!checkAnonLimit(ip)) {
      return res.status(429).json({ error: 'Günlük ücretsiz limit aşıldı (3/gün). KolayXport hesabıyla giriş yapın.' });
    }
  }

  const { action, ...params } = req.body || {};

  try {
    switch (action) {
      case 'search_enrich': {
        // Enrich search results page
        const { query, listingIds } = params;
        if (!query) return res.status(400).json({ error: 'query required' });

        // Fetch search stats
        const searchData = await etsyGet(
          `/listings/active?keywords=${encodeURIComponent(query)}&limit=100&includes=Images(url_170x135)&sort_on=score`
        );

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

        // Per-listing badges (for IDs on the page)
        const listingBadges: Record<string, any> = {};
        if (Array.isArray(listingIds) && listingIds.length > 0) {
          // Match from search results
          for (const item of items) {
            const lid = String(item.listing_id);
            if (listingIds.includes(lid)) {
              const price = (item.price?.amount || 0) / (item.price?.divisor || 100);
              const ageMs = Date.now() - (item.original_creation_timestamp || item.creation_timestamp || Date.now()) * 1000;
              const ageMonths = Math.max(1, ageMs / (30 * 24 * 3600 * 1000));
              const estMonthlySales = ((item.num_favorers || 0) / ageMonths) * 0.03;
              listingBadges[lid] = {
                price,
                favorites: item.num_favorers || 0,
                views: item.views || 0,
                estMonthlySales: Math.round(estMonthlySales * 10) / 10,
                competition: price > avgPrice * 1.5 ? 'premium' : price < avgPrice * 0.7 ? 'budget' : 'competitive',
              };
            }
          }
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
          },
          listingBadges,
          plan,
        });
      }

      case 'listing_enrich': {
        const { listingId } = params;
        if (!listingId) return res.status(400).json({ error: 'listingId required' });

        const listing = await etsyGet(`/listings/${listingId}?includes=Images,Shop`);
        const price = (listing.price?.amount || 0) / (listing.price?.divisor || 100);
        const ageMs = Date.now() - (listing.original_creation_timestamp || listing.creation_timestamp || Date.now()) * 1000;
        const ageMonths = Math.max(1, ageMs / (30 * 24 * 3600 * 1000));
        const estMonthlySales = ((listing.num_favorers || 0) / ageMonths) * 0.03;

        // SEO score
        const titleLen = (listing.title || '').length;
        const tagCount = (listing.tags || []).length;
        const descLen = (listing.description || '').length;
        const imgCount = (listing.images || []).length;
        const titleScore = titleLen >= 100 ? 25 : titleLen >= 60 ? 18 : titleLen >= 30 ? 12 : 5;
        const tagScore = tagCount >= 13 ? 25 : tagCount >= 10 ? 20 : tagCount >= 5 ? 12 : 5;
        const descScore = descLen >= 300 ? 25 : descLen >= 100 ? 18 : descLen > 0 ? 10 : 0;
        const imgScore = imgCount >= 8 ? 25 : imgCount >= 5 ? 20 : imgCount >= 3 ? 15 : 5;
        const seoScore = titleScore + tagScore + descScore + imgScore;

        return res.json({
          listing: {
            listing_id: listing.listing_id,
            title: listing.title,
            price,
            favorites: listing.num_favorers || 0,
            views: listing.views || 0,
            tags: listing.tags || [],
            tagCount,
            imageCount: imgCount,
          },
          velocity: { estMonthlySales: Math.round(estMonthlySales * 10) / 10, ageMonths: Math.round(ageMonths) },
          seoScore: { total: seoScore, title: titleScore, tags: tagScore, description: descScore, images: imgScore },
          shop: listing.shop ? {
            shop_id: listing.shop.shop_id,
            shop_name: listing.shop.shop_name,
            num_sales: listing.shop.transaction_sold_count,
            rating: listing.shop.review_average,
          } : null,
          plan,
        });
      }

      case 'shop_enrich': {
        const { shopId } = params;
        if (!shopId) return res.status(400).json({ error: 'shopId required' });

        const [shop, listingsData] = await Promise.all([
          etsyGet(`/shops/${shopId}`),
          etsyGet(`/shops/${shopId}/listings/active?limit=25&sort_on=score`),
        ]);

        const listings = listingsData.results || [];
        const bestSellers = [...listings]
          .sort((a: any, b: any) => (b.num_favorers || 0) - (a.num_favorers || 0))
          .slice(0, 5)
          .map((l: any) => ({
            title: l.title,
            price: (l.price?.amount || 0) / (l.price?.divisor || 100),
            favorites: l.num_favorers || 0,
          }));

        const prices = listings.map((l: any) => (l.price?.amount || 0) / (l.price?.divisor || 100)).filter((p: number) => p > 0);
        const avgPrice = prices.length > 0 ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : 0;

        return res.json({
          shop: {
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            num_sales: shop.transaction_sold_count || 0,
            rating: shop.review_average || 0,
            review_count: shop.review_count || 0,
            listing_count: shop.listing_active_count || 0,
            created: shop.create_timestamp,
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
    console.error('[ext/research]', err);
    return res.status(500).json({ error: 'Research API error' });
  }
}
