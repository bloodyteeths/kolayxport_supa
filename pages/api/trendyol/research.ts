import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import { logger } from '../../../lib/logger';
import {
  fetchTrendyolCategoryProducts,
  searchTrendyolByCategories,
  TRENDYOL_CATEGORIES,
} from '../../../lib/integrations/trendyolSearch';
import type { TrendyolProduct } from '../../../lib/arbitrage/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = req.query.action as string;

  try {
    // Auth: API key or session
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const envApiKey = process.env.CLAWD_API_KEY;
    if (!(envApiKey && apiKey === envApiKey)) {
      const user = await getAuthUser(req, res);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
    }

    // ================================================================
    // BROWSE CATEGORY (single category scrape)
    // ================================================================
    if (action === 'category_products') {
      const slug = req.query.slug as string;
      if (!slug) {
        return res.status(400).json({ error: 'slug query parameter is required' });
      }
      const page = parseInt(req.query.page as string) || 1;

      const result = await fetchTrendyolCategoryProducts(slug, page);
      const analysis = analyzeProducts(result.products);

      return res.status(200).json({
        products: result.products,
        totalCount: result.totalCount,
        categorySlug: result.categorySlug,
        analysis,
      });
    }

    // ================================================================
    // MULTI-CATEGORY BROWSE
    // ================================================================
    if (action === 'multi_category' && req.method === 'POST') {
      const { slugs, maxPerCategory = 100 } = req.body;
      if (!slugs || !Array.isArray(slugs)) {
        return res.status(400).json({ error: 'slugs array is required' });
      }

      const result = await searchTrendyolByCategories(slugs, maxPerCategory);
      const analysis = analyzeProducts(result.products);

      return res.status(200).json({
        products: result.products,
        totalCount: result.totalCount,
        analysis,
      });
    }

    // ================================================================
    // AVAILABLE CATEGORIES
    // ================================================================
    if (action === 'categories') {
      // Group by category group
      const groups: Record<string, typeof TRENDYOL_CATEGORIES> = {};
      for (const cat of TRENDYOL_CATEGORIES) {
        if (!groups[cat.group]) groups[cat.group] = [];
        groups[cat.group].push(cat);
      }
      return res.status(200).json({ categories: TRENDYOL_CATEGORIES, groups });
    }

    // ================================================================
    // FULL CATEGORY TREE (dynamic from Trendyol API)
    // ================================================================
    if (action === 'category_tree') {
      const { fetchTrendyolCategoryTree } = await import('../../../lib/integrations/trendyolSearch');
      const allCategories = await fetchTrendyolCategoryTree();

      // Group by top-level parent
      const tree: Record<string, typeof allCategories> = {};
      for (const cat of allCategories) {
        const topLevel = cat.parentPath.split(' > ')[0];
        if (!tree[topLevel]) tree[topLevel] = [];
        tree[topLevel].push(cat);
      }

      // Also support search query
      const q = (req.query.q as string || '').toLowerCase().trim();
      if (q) {
        const filtered = allCategories.filter(cat =>
          cat.name.toLowerCase().includes(q) ||
          cat.parentPath.toLowerCase().includes(q)
        );
        return res.status(200).json({
          categories: filtered.slice(0, 100),
          totalCount: filtered.length,
          source: 'search',
        });
      }

      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
      return res.status(200).json({
        categories: allCategories,
        tree,
        totalCount: allCategories.length,
        source: 'api',
      });
    }

    // ================================================================
    // PRICE ANALYSIS (from already-fetched products)
    // ================================================================
    if (action === 'price_analysis' && req.method === 'POST') {
      const { products } = req.body as { products: TrendyolProduct[] };
      if (!products || !Array.isArray(products)) {
        return res.status(400).json({ error: 'products array is required' });
      }
      const analysis = analyzeProducts(products);
      return res.status(200).json(analysis);
    }

    // ================================================================
    // AI MARKET REPORT (Gemini)
    // ================================================================
    if (action === 'ai_market_report' && req.method === 'POST') {
      const { products, categoryName } = req.body as {
        products: TrendyolProduct[];
        categoryName: string;
      };
      if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: 'products array is required' });
      }

      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured' });
      }

      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const analysis = analyzeProducts(products);
      const topProducts = products.slice(0, 20).map(p => ({
        name: p.name,
        brand: p.brand,
        price: p.priceTry,
        originalPrice: p.originalPriceTry,
        rating: p.ratingScore,
        reviews: p.ratingCount,
        favorites: p.favoriteCount,
        orders: p.orderCount,
        freeShipping: p.freeShipping,
        badge: p.sellerBadgeType,
      }));

      const prompt = `Sen bir Trendyol pazar analiz uzmanısın. "${categoryName}" kategorisi için detaylı bir pazar raporu hazırla.

Veriler:
- Toplam ürün: ${products.length}
- Fiyat aralığı: ${analysis.priceStats.min}₺ - ${analysis.priceStats.max}₺
- Ortalama fiyat: ${analysis.priceStats.avg.toFixed(0)}₺
- Medyan fiyat: ${analysis.priceStats.median.toFixed(0)}₺
- Benzersiz satıcı sayısı: ${analysis.uniqueMerchants}
- Benzersiz marka sayısı: ${analysis.uniqueBrands}
- Ücretsiz kargo oranı: ${analysis.freeShippingPct.toFixed(0)}%
- Ort. puan: ${analysis.avgRating.toFixed(1)}
- En popüler markalar: ${analysis.topBrands.slice(0, 5).map(b => `${b.name} (${b.count})`).join(', ')}

İlk 20 ürün:
${JSON.stringify(topProducts, null, 2)}

Rapor formatı (Türkçe):
1. **Pazar Özeti**: Genel durum, rekabet seviyesi
2. **Fiyatlandırma Stratejisi**: İdeal fiyat aralığı, indirim stratejisi
3. **Rekabet Analizi**: Markalar, satıcılar, giriş zorlukları
4. **Talep Sinyalleri**: Favori/sipariş verileri ne söylüyor
5. **Fırsatlar**: Boşluklar, niş alanlar
6. **Öneriler**: Somut 3-5 aksiyon maddesi

Kısa ve öz tut. Rakamlarla destekle.`;

      const response = await model.generateContent(prompt);
      const report = response.response.text();

      return res.status(200).json({ report, analysis });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (error: any) {
    logger.error('Trendyol research API error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

// ================================================================
// ANALYSIS HELPERS
// ================================================================

interface ProductAnalysis {
  priceStats: {
    min: number;
    max: number;
    avg: number;
    median: number;
    p25: number;
    p75: number;
  };
  priceHistogram: Array<{ range: string; min: number; max: number; count: number }>;
  uniqueMerchants: number;
  uniqueBrands: number;
  freeShippingPct: number;
  avgRating: number;
  avgDiscount: number;
  topBrands: Array<{ name: string; count: number; avgPrice: number }>;
  topMerchants: Array<{ id: number; count: number; avgPrice: number; avgRating: number }>;
  socialProofSummary: {
    withFavorites: number;
    withOrders: number;
    withViews: number;
  };
  badgeDistribution: Record<string, number>;
}

function analyzeProducts(products: TrendyolProduct[]): ProductAnalysis {
  if (products.length === 0) {
    return {
      priceStats: { min: 0, max: 0, avg: 0, median: 0, p25: 0, p75: 0 },
      priceHistogram: [],
      uniqueMerchants: 0,
      uniqueBrands: 0,
      freeShippingPct: 0,
      avgRating: 0,
      avgDiscount: 0,
      topBrands: [],
      topMerchants: [],
      socialProofSummary: { withFavorites: 0, withOrders: 0, withViews: 0 },
      badgeDistribution: {},
    };
  }

  const prices = products.map(p => p.priceTry).filter(p => p > 0).sort((a, b) => a - b);

  // Price stats
  const min = prices[0] || 0;
  const max = prices[prices.length - 1] || 0;
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  const median = prices[Math.floor(prices.length / 2)] || 0;
  const p25 = prices[Math.floor(prices.length * 0.25)] || 0;
  const p75 = prices[Math.floor(prices.length * 0.75)] || 0;

  // Price histogram (10 buckets)
  const bucketSize = Math.max(1, Math.ceil((max - min) / 10));
  const histogram: ProductAnalysis['priceHistogram'] = [];
  for (let i = 0; i < 10; i++) {
    const bucketMin = min + i * bucketSize;
    const bucketMax = bucketMin + bucketSize;
    const count = prices.filter(p => p >= bucketMin && (i === 9 ? p <= bucketMax : p < bucketMax)).length;
    if (count > 0) {
      histogram.push({
        range: `${Math.round(bucketMin)}-${Math.round(bucketMax)}₺`,
        min: bucketMin,
        max: bucketMax,
        count,
      });
    }
  }

  // Merchants
  const merchantMap = new Map<number, { count: number; totalPrice: number; totalRating: number }>();
  for (const p of products) {
    if (!p.merchantId) continue;
    const m = merchantMap.get(p.merchantId) || { count: 0, totalPrice: 0, totalRating: 0 };
    m.count++;
    m.totalPrice += p.priceTry;
    m.totalRating += p.ratingScore;
    merchantMap.set(p.merchantId, m);
  }

  // Brands
  const brandMap = new Map<string, { count: number; totalPrice: number }>();
  for (const p of products) {
    if (!p.brand) continue;
    const b = brandMap.get(p.brand) || { count: 0, totalPrice: 0 };
    b.count++;
    b.totalPrice += p.priceTry;
    brandMap.set(p.brand, b);
  }

  // Discount analysis
  const discounts = products
    .filter(p => p.originalPriceTry > p.priceTry && p.originalPriceTry > 0)
    .map(p => ((p.originalPriceTry - p.priceTry) / p.originalPriceTry) * 100);
  const avgDiscount = discounts.length > 0
    ? discounts.reduce((s, d) => s + d, 0) / discounts.length
    : 0;

  // Badge distribution
  const badges: Record<string, number> = {};
  for (const p of products) {
    if (p.sellerBadgeType) {
      badges[p.sellerBadgeType] = (badges[p.sellerBadgeType] || 0) + 1;
    }
  }

  return {
    priceStats: { min, max, avg, median, p25, p75 },
    priceHistogram: histogram,
    uniqueMerchants: merchantMap.size,
    uniqueBrands: brandMap.size,
    freeShippingPct: (products.filter(p => p.freeShipping).length / products.length) * 100,
    avgRating: products.reduce((s, p) => s + p.ratingScore, 0) / products.length,
    avgDiscount,
    topBrands: Array.from(brandMap.entries())
      .map(([name, data]) => ({ name, count: data.count, avgPrice: data.totalPrice / data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    topMerchants: Array.from(merchantMap.entries())
      .map(([id, data]) => ({
        id,
        count: data.count,
        avgPrice: data.totalPrice / data.count,
        avgRating: data.totalRating / data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    socialProofSummary: {
      withFavorites: products.filter(p => p.favoriteCount).length,
      withOrders: products.filter(p => p.orderCount).length,
      withViews: products.filter(p => p.pageViewCount).length,
    },
    badgeDistribution: badges,
  };
}
