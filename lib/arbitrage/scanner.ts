import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../logger';
import { getApplicationToken } from '../integrations/ebayClient';
import { fetchTrendyolCategoryProducts, getExchangeRate } from '../integrations/trendyolSearch';
import { calculateArbitrage } from './calculator';
import { getCached, setCache, cacheKey, TTL, maybeClearExpired } from './cache';
import { mapToEbayCategory } from './categoryMapper';
import type { ArbitrageResult, EbayComparable, TrendyolProduct } from './types';

const EBAY_API_BASE = 'https://api.ebay.com';

interface ScanParams {
  shippingCostUsd: number;
  feeOverridePercent?: number;
  includeInternationalFee: boolean;
  highDefectRate?: boolean;
  exchangeRate?: number;
  minProfitUsd?: number;
  minRoiPercent?: number;
}

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

async function getItemDetails(legacyItemId: string, appToken: string): Promise<EbayComparable> {
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
  };
}

/** Search eBay by GTIN/barcode (exact match) */
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

/** Use Gemini to translate Turkish product titles to English eBay search queries */
export async function batchTranslateTitles(
  products: TrendyolProduct[]
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || products.length === 0) return result;

  // Check cache for this batch
  const ids = products.map(p => p.id);
  const cached = await getCached<Array<{ id: number; query: string }>>(cacheKey.geminiTranslate(ids));
  if (cached) {
    for (const item of cached) {
      result.set(item.id, item.query);
    }
    return result;
  }

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' } as any,
    });

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
      // Cache translations
      await setCache(cacheKey.geminiTranslate(ids), parsed, TTL.GEMINI_TRANSLATE);
    }
  } catch (err) {
    logger.warn('Gemini translation failed, falling back to extraction', { error: String(err) });
  }

  return result;
}

/** Extract English/Latin words + brand as fallback search query */
export function extractEnglishQuery(product: TrendyolProduct): string {
  const { brand, name } = product;
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

/** Search eBay with query and return enriched items (with caching) */
async function searchAndEnrichEbay(
  query: string,
  appToken: string,
  limit = 15,
  enrichCount = 8
): Promise<EbayComparable[]> {
  // Check cache
  const cached = await getCached<EbayComparable[]>(cacheKey.ebaySearch(query));
  if (cached) return cached;

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

  const results = enriched.filter(i => i.price > 0);

  // Cache results
  if (results.length > 0) {
    await setCache(cacheKey.ebaySearch(query), results, TTL.EBAY_SEARCH);
  }

  return results;
}

/**
 * Scan a single Trendyol category against eBay.
 * Returns ArbitrageResult[] for all products in that category.
 */
export async function scanCategory(
  slug: string,
  params: ScanParams,
  appToken: string,
  page = 1
): Promise<{ results: ArbitrageResult[]; productsScanned: number }> {
  // Fetch Trendyol products (with cache)
  const cKey = cacheKey.trendyolProducts(slug, page);
  let trendyolData = await getCached<{ products: TrendyolProduct[] }>(cKey);

  if (!trendyolData) {
    const fetched = await fetchTrendyolCategoryProducts(slug, page);
    trendyolData = { products: fetched.products };
    if (fetched.products.length > 0) {
      await setCache(cKey, trendyolData, TTL.TRENDYOL_PRODUCTS);
    }
  }

  const products = trendyolData.products;
  if (products.length === 0) return { results: [], productsScanned: 0 };

  // Batch translate via Gemini
  const translations = await batchTranslateTitles(products);

  // Get exchange rate (cached)
  const exchangeRate = params.exchangeRate || await getCachedExchangeRate();

  // Scan each product
  return scanBatch(products, translations, { ...params, exchangeRate }, appToken);
}

/**
 * Scan a batch of Trendyol products against eBay.
 */
export async function scanBatch(
  products: TrendyolProduct[],
  translations: Map<number, string>,
  params: ScanParams & { exchangeRate: number },
  appToken: string
): Promise<{ results: ArbitrageResult[]; productsScanned: number }> {
  const results: ArbitrageResult[] = [];

  for (const tp of products) {
    try {
      let ebayItems: EbayComparable[] = [];
      let matchTier: 'gtin' | 'gemini' | 'fallback' = 'fallback';

      // Tier 1: GTIN/barcode
      if (tp.barcode && tp.barcode.length >= 8) {
        const gtinItems = await searchEbayByGtin(tp.barcode, appToken);
        if (gtinItems.length > 0) {
          ebayItems = await searchAndEnrichEbay(tp.barcode, appToken, 10, 6);
          matchTier = 'gtin';
        }
      }

      // Tier 2: Gemini translation
      let translatedQuery: string | undefined;
      if (ebayItems.length === 0) {
        const geminiQuery = translations.get(tp.id);
        if (geminiQuery && geminiQuery.length >= 3) {
          ebayItems = await searchAndEnrichEbay(geminiQuery, appToken);
          if (ebayItems.length > 0) {
            matchTier = 'gemini';
            translatedQuery = geminiQuery;
          }
        }
      }

      // Tier 3: Brand + English extraction
      if (ebayItems.length === 0) {
        const fallbackQuery = extractEnglishQuery(tp);
        if (fallbackQuery && fallbackQuery.length >= 3) {
          ebayItems = await searchAndEnrichEbay(fallbackQuery, appToken);
          if (ebayItems.length > 0) {
            translatedQuery = fallbackQuery;
          }
        }
      }

      if (ebayItems.length === 0) continue;

      const result = calculateArbitrage({
        trendyol: tp,
        ebayItems,
        exchangeRate: params.exchangeRate,
        shippingCostUsd: params.shippingCostUsd,
        feeOverridePercent: params.feeOverridePercent,
        includeInternationalFee: params.includeInternationalFee,
        highDefectRate: params.highDefectRate,
      });

      if (result) {
        result.matchTier = matchTier;
        result.translatedQuery = translatedQuery;
        results.push(result);
      }
    } catch (err) {
      logger.warn(`Scan failed for product ${tp.id}`, { error: String(err) });
    }
  }

  // Probabilistic cache cleanup
  await maybeClearExpired();

  return { results, productsScanned: products.length };
}

/** Get exchange rate with caching */
export async function getCachedExchangeRate(): Promise<number> {
  const cached = await getCached<number>(cacheKey.exchangeRate());
  if (cached) return cached;

  const rate = await getExchangeRate();
  await setCache(cacheKey.exchangeRate(), rate, TTL.EXCHANGE_RATE);
  return rate;
}
