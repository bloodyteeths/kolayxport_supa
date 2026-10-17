import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import { logger } from '../../../lib/logger';
import {
  fetchTrendyolCategoryProducts,
  searchTrendyolByCategories,
  TRENDYOL_CATEGORIES,
} from '../../../lib/integrations/trendyolSearch';
import type { TrendyolProduct } from '../../../lib/arbitrage/types';
import { summarizeAmounts, groupMedian, type PriceSummary } from '../../../lib/research/stats';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = req.query.action as string;

  try {
    // Auth: API key or session
    const apiKey = req.headers['x-api-key'];
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

      const { getAiModel } = await import('@/lib/ai/gemini');
      const model = getAiModel({ feature: 'trendyol.market_report', tier: 'deep', json: false });

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
- Medyan fiyat: ${analysis.priceStats.median != null ? analysis.priceStats.median.toFixed(0) + '₺' : 'yetersiz veri'}
- Tipik fiyat aralığı (P25–P75): ${analysis.priceStats.p25 ?? '-'}₺ - ${analysis.priceStats.p75 ?? '-'}₺ (n=${analysis.priceStats.n})
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
  /** R0: robust summary in TRY (median, P25–P75, Tukey-trimmed min/max, n). No mean. */
  priceStats: PriceSummary;
  priceHistogram: Array<{ range: string; min: number; max: number; count: number }>;
  uniqueMerchants: number;
  uniqueBrands: number;
  freeShippingPct: number;
  avgRating: number;
  avgDiscount: number;
  topBrands: Array<{ name: string; count: number; medianPrice: number | null }>;
  topMerchants: Array<{ id: number; count: number; medianPrice: number | null; avgRating: number }>;
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
      priceStats: summarizeAmounts([], 'TRY'),
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

  // R0: robust price stats in TRY. No FX bounds are applied (no rate is
  // guessed); Tukey trimming removes placeholder/wholesale outliers.
  const priceStats = summarizeAmounts(products.map(p => p.priceTry), 'TRY');
  const min = priceStats.min ?? 0;
  const max = priceStats.max ?? 0;
  const prices = products.map(p => p.priceTry).filter(p => p > 0 && p >= min && p <= max).sort((a, b) => a - b);

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
  const merchantMap = new Map<number, { count: number; prices: number[]; totalRating: number }>();
  for (const p of products) {
    if (!p.merchantId) continue;
    const m = merchantMap.get(p.merchantId) || { count: 0, prices: [], totalRating: 0 };
    m.count++;
    m.prices.push(p.priceTry);
    m.totalRating += p.ratingScore;
    merchantMap.set(p.merchantId, m);
  }

  // Brands
  const brandMap = new Map<string, { count: number; prices: number[] }>();
  for (const p of products) {
    if (!p.brand) continue;
    const b = brandMap.get(p.brand) || { count: 0, prices: [] };
    b.count++;
    b.prices.push(p.priceTry);
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
    priceStats,
    priceHistogram: histogram,
    uniqueMerchants: merchantMap.size,
    uniqueBrands: brandMap.size,
    freeShippingPct: (products.filter(p => p.freeShipping).length / products.length) * 100,
    avgRating: products.reduce((s, p) => s + p.ratingScore, 0) / products.length,
    avgDiscount,
    topBrands: Array.from(brandMap.entries())
      .map(([name, data]) => ({ name, count: data.count, medianPrice: groupMedian(data.prices) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    topMerchants: Array.from(merchantMap.entries())
      .map(([id, data]) => ({
        id,
        count: data.count,
        medianPrice: groupMedian(data.prices),
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
