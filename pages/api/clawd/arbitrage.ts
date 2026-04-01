import type { NextApiRequest, NextApiResponse } from 'next';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../../../lib/logger';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { getApplicationToken } from '../../../lib/integrations/ebayClient';
import { fetchTrendyolCategoryProducts, getExchangeRate, TRENDYOL_CATEGORIES } from '../../../lib/integrations/trendyolSearch';
import { calculateArbitrage } from '../../../lib/arbitrage/calculator';
import type { ArbitrageResult, EbayComparable, TrendyolProduct, ArbitrageScanResponse } from '../../../lib/arbitrage/types';

export const config = { runtime: 'nodejs' };

const EBAY_API_BASE = 'https://api.ebay.com';

async function callEbayAPI(endpoint: string, token: string, marketplaceId = 'EBAY_US') {
  const url = endpoint.startsWith('http') ? endpoint : `${EBAY_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay API ${response.status}: ${text.substring(0, 200)}`);
  }
  return response.json();
}

async function getItemDetails(legacyItemId: string, appToken: string) {
  const item = await callEbayAPI(
    `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyItemId}`,
    appToken
  );
  return {
    title: item.title || '',
    price: parseFloat(item.price?.value || '0'),
    currency: item.price?.currency || 'USD',
    itemId: item.itemId || '',
    soldQuantity: item.estimatedAvailabilities?.[0]?.estimatedSoldQuantity || 0,
    condition: item.condition || '',
    imageUrl: item.image?.imageUrl || '',
    categoryId: item.categoryId || '',
    categoryName: item.categoryPath || '',
  } as EbayComparable;
}

// --- Tiered product matching ---

/** Tier 1: Search eBay by GTIN/barcode (exact match) */
async function searchEbayByGtin(barcode: string, appToken: string): Promise<any[]> {
  try {
    const result = await callEbayAPI(
      `/buy/browse/v1/item_summary/search?gtin=${encodeURIComponent(barcode)}&limit=10`,
      appToken
    );
    return result.itemSummaries || [];
  } catch {
    return [];
  }
}

/** Tier 2: Use Gemini to translate Turkish product titles to English eBay search queries */
async function batchTranslateTitles(
  products: TrendyolProduct[]
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || products.length === 0) return result;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' } as any,
    });

    // Batch up to 25 products per Gemini call
    const batch = products.slice(0, 25).map(p => ({
      id: p.id,
      brand: p.brand,
      name: p.name,
    }));

    const prompt = `You are a cross-border e-commerce expert. Translate these Turkish product listings into short English eBay search queries that real US/UK buyers would use to find this exact product type.

Rules:
- Keep brand names as-is (they're international)
- Keep cultural terms that English buyers search for: kilim, peshtemal, cezve, lokum, baklava, hammam, ottoman, suzani, ikat
- Include "Turkish" when it adds value (e.g., "Turkish towel", "Turkish coffee set")
- Max 6-8 words per query
- Focus on what the product IS, not marketing fluff
- Include material/size only if distinctive (e.g., "copper", "hand painted", "100% cotton")

Products:
${JSON.stringify(batch)}

Return a JSON array of objects: [{"id": number, "query": "english search terms"}, ...]`;

    const response = await model.generateContent(prompt);
    let raw = response.response.text().trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.id && item.query && typeof item.query === 'string') {
          result.set(item.id, item.query);
        }
      }
    }
  } catch (err) {
    logger.warn('Gemini translation failed, falling back to extraction', { error: String(err) });
  }

  return result;
}

/** Tier 3: Extract English/Latin words + brand as fallback search query */
function extractEnglishQuery(product: TrendyolProduct): string {
  const { brand, name } = product;
  // Extract only ASCII/Latin words (English words, numbers, sizes)
  const englishWords = name
    .replace(/[^a-zA-Z0-9\s.,-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 5)
    .join(' ');

  if (brand && englishWords) return `${brand} ${englishWords}`.trim();
  if (brand) return brand;
  return englishWords;
}

/** Search eBay with query and return enriched items */
async function searchAndEnrichEbay(
  query: string,
  appToken: string,
  limit = 15,
  enrichCount = 8
): Promise<EbayComparable[]> {
  const searchParams = new URLSearchParams();
  searchParams.set('q', query);
  searchParams.set('sort', 'newlyListed');
  searchParams.set('limit', String(limit));

  const searchResult = await callEbayAPI(
    `/buy/browse/v1/item_summary/search?${searchParams.toString()}`,
    appToken
  );

  const ebayItems = searchResult.itemSummaries || [];
  if (ebayItems.length === 0) return [];

  const enriched: EbayComparable[] = [];
  const enrichLimit = Math.min(ebayItems.length, enrichCount);

  for (let i = 0; i < enrichLimit; i++) {
    const item = ebayItems[i];
    const legacyId = item.legacyItemId;
    const fallback: EbayComparable = {
      title: item.title || '',
      price: parseFloat(item.price?.value || '0'),
      currency: item.price?.currency || 'USD',
      itemId: item.itemId || '',
      soldQuantity: 0,
      condition: item.condition || '',
      imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || '',
      categoryId: item.categories?.[0]?.categoryId || '',
      categoryName: item.categories?.[0]?.categoryName || '',
    };

    if (!legacyId) {
      enriched.push(fallback);
      continue;
    }
    try {
      enriched.push(await getItemDetails(legacyId, appToken));
    } catch {
      enriched.push(fallback);
    }
  }

  return enriched.filter(i => i.price > 0);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const envApiKey = process.env.CLAWD_API_KEY;
  let authenticated = false;

  if (envApiKey && apiKey === envApiKey) {
    authenticated = true;
  }

  if (!authenticated) {
    const supabase = getSupabaseServerClient(req, res);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) authenticated = true;
  }

  if (!authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.body;

  try {
    switch (action) {
      case 'scan': {
        const startTime = Date.now();
        const {
          categories = [],
          minProfitUsd = 5,
          minRoiPercent = 20,
          shippingCostUsd = 15,
          feeOverridePercent,
          includeInternationalFee = true,
          maxTrendyolResults = 30,
          highDefectRate = false,
        } = req.body;

        if (!categories.length) {
          return res.status(400).json({ error: 'At least one category is required' });
        }

        // Get exchange rate
        const exchangeRate = req.body.exchangeRate || await getExchangeRate();

        // Get eBay app token
        const appToken = await getApplicationToken();

        // Fetch all Trendyol products from selected categories
        const allProducts: TrendyolProduct[] = [];
        const perCategoryLimit = Math.ceil(maxTrendyolResults / categories.length);

        for (const slug of categories) {
          try {
            const { products } = await fetchTrendyolCategoryProducts(slug);
            for (const p of products.slice(0, perCategoryLimit)) {
              allProducts.push(p);
            }
          } catch (err) {
            logger.warn(`Trendyol category fetch failed for "${slug}"`, { error: String(err) });
          }
        }

        const trendyolProducts = allProducts.slice(0, maxTrendyolResults);
        if (trendyolProducts.length === 0) {
          return res.json({
            results: [], exchangeRate, totalScanned: 0,
            profitable: 0, scanDurationMs: Date.now() - startTime,
          } as ArbitrageScanResponse);
        }

        // Tier 2: Batch translate all product titles via Gemini
        const translatedQueries = await batchTranslateTitles(trendyolProducts);

        // For each Trendyol product, find eBay matches using tiered approach
        const results: ArbitrageResult[] = [];
        const ebaySearchCache = new Map<string, EbayComparable[]>();

        for (const tp of trendyolProducts) {
          try {
            let ebayItems: EbayComparable[] = [];

            // Tier 1: Try GTIN/barcode match (exact)
            if (tp.barcode && tp.barcode.length >= 8) {
              const gtinItems = await searchEbayByGtin(tp.barcode, appToken);
              if (gtinItems.length > 0) {
                ebayItems = await searchAndEnrichEbay(
                  tp.barcode, appToken, 10, 6
                );
              }
            }

            // Tier 2: Gemini-translated search query
            if (ebayItems.length === 0) {
              const geminiQuery = translatedQueries.get(tp.id);
              if (geminiQuery && geminiQuery.length >= 3) {
                const cacheKey = geminiQuery.toLowerCase();
                if (ebaySearchCache.has(cacheKey)) {
                  ebayItems = ebaySearchCache.get(cacheKey)!;
                } else {
                  ebayItems = await searchAndEnrichEbay(geminiQuery, appToken);
                  ebaySearchCache.set(cacheKey, ebayItems);
                }
              }
            }

            // Tier 3: Brand + English word extraction fallback
            if (ebayItems.length === 0) {
              const fallbackQuery = extractEnglishQuery(tp);
              if (fallbackQuery && fallbackQuery.length >= 3) {
                const cacheKey = fallbackQuery.toLowerCase();
                if (ebaySearchCache.has(cacheKey)) {
                  ebayItems = ebaySearchCache.get(cacheKey)!;
                } else {
                  ebayItems = await searchAndEnrichEbay(fallbackQuery, appToken);
                  ebaySearchCache.set(cacheKey, ebayItems);
                }
              }
            }

            if (ebayItems.length === 0) continue;

            const result = calculateArbitrage({
              trendyol: tp,
              ebayItems,
              exchangeRate,
              shippingCostUsd,
              feeOverridePercent,
              includeInternationalFee,
              highDefectRate,
            });

            if (result) {
              results.push(result);
            }
          } catch (err) {
            logger.warn(`Arbitrage scan failed for product ${tp.id}`, { error: String(err) });
          }
        }

        // Sort by score descending
        const sorted = results.sort((a, b) => b.score - a.score);

        const profitable = sorted.filter(
          r => r.financials.profitUsd >= minProfitUsd && r.financials.roiPercent >= minRoiPercent
        );

        return res.json({
          results: sorted,
          exchangeRate,
          totalScanned: trendyolProducts.length,
          profitable: profitable.length,
          scanDurationMs: Date.now() - startTime,
        } as ArbitrageScanResponse);
      }

      case 'categories': {
        return res.json({ categories: TRENDYOL_CATEGORIES });
      }

      case 'exchange_rate': {
        const rate = await getExchangeRate();
        return res.json({ rate, source: 'open.er-api.com' });
      }

      case 'test_trendyol': {
        const slug = req.body.slug || 'havlu-x-c104073';
        try {
          const result = await fetchTrendyolCategoryProducts(slug);
          // Also test Gemini translation on first 3 products
          const translations = await batchTranslateTitles(result.products.slice(0, 3));
          return res.json({
            success: true,
            parsedCount: result.products.length,
            products: result.products.slice(0, 5).map(p => ({
              id: p.id, name: p.name, brand: p.brand,
              priceTry: p.priceTry, imageUrl: p.imageUrl,
              ebayQuery: translations.get(p.id) || extractEnglishQuery(p),
            })),
          });
        } catch (err: any) {
          return res.json({ success: false, error: err.message });
        }
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    logger.error('Arbitrage API error', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
