/**
 * AI Product Matcher — matches Trendyol products against eBay index using Gemini.
 *
 * This is the core innovation: instead of searching eBay for each Turkish product
 * (1-3 API calls per product), we load pre-indexed eBay products and let Gemini
 * find matches offline (1 Gemini call per category, 0 eBay calls).
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import prisma from '../prisma';
import { logger } from '../logger';
import { getEbayIndexForCategory } from './ebayIndexer';
import { getTrendyolIndexForCategory } from './trendyolIndexer';
import { calculateArbitrage } from './calculator';
import { getCachedExchangeRate } from './scanner';
import type { TrendyolProduct, EbayComparable, ArbitrageResult } from './types';

const MATCH_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface MatchParams {
  shippingCostUsd: number;
  feeOverridePercent?: number;
  includeInternationalFee: boolean;
  highDefectRate?: boolean;
  exchangeRate?: number;
  minProfitUsd?: number;
  minRoiPercent?: number;
}

interface GeminiMatch {
  trendyolId: number;
  ebayItemId: string;
  matchType: 'exact' | 'equivalent' | 'similar' | 'none';
  confidence: number;
  reason: string;
}

/**
 * Match a Trendyol category against eBay index and calculate arbitrage.
 * Returns ArbitrageResult[] — same shape as the old scanner for backward compatibility.
 */
export async function matchAndCalculateCategory(
  slug: string,
  params: MatchParams,
  appToken?: string, // only needed if index is empty and we need to refresh
): Promise<{ results: ArbitrageResult[]; productsScanned: number; matchStats: MatchStats }> {
  // 1. Load indexes
  const trendyolProducts = await getTrendyolIndexForCategory(slug);
  const ebayProducts = await getEbayIndexForCategory(slug);

  if (trendyolProducts.length === 0) {
    return { results: [], productsScanned: 0, matchStats: emptyStats() };
  }

  if (ebayProducts.length === 0) {
    logger.warn(`No eBay index for category "${slug}" — run refresh_index first`);
    return { results: [], productsScanned: trendyolProducts.length, matchStats: emptyStats() };
  }

  // 2. Check for cached matches
  let matches = await getCachedMatches(slug);

  // 3. If no cached matches, run AI matching
  if (matches.length === 0) {
    matches = await aiMatchCategory(trendyolProducts, ebayProducts, slug);
  }

  // 4. Calculate arbitrage for matched pairs
  const exchangeRate = params.exchangeRate || await getCachedExchangeRate();
  const results: ArbitrageResult[] = [];

  const matchStats: MatchStats = {
    total: trendyolProducts.length,
    exact: 0,
    equivalent: 0,
    similar: 0,
    noMatch: 0,
  };

  for (const match of matches) {
    if (match.matchType === 'none' || match.confidence < 0.5) {
      matchStats.noMatch++;
      continue;
    }

    if (match.matchType === 'exact') matchStats.exact++;
    else if (match.matchType === 'equivalent') matchStats.equivalent++;
    else matchStats.similar++;

    // Find the original product data
    const tp = trendyolProducts.find(p => p.productId === match.trendyolId);
    const ebayItem = ebayProducts.find(p => p.itemId === match.ebayItemId);
    if (!tp || !ebayItem) continue;

    // Convert index data back to types the calculator expects
    const trendyolProduct: TrendyolProduct = {
      id: tp.productId,
      name: tp.name,
      brand: tp.brand,
      priceTry: tp.priceTry,
      originalPriceTry: tp.originalPriceTry,
      imageUrl: tp.imageUrl || '',
      url: tp.url || '',
      categoryName: tp.categoryName || '',
      ratingScore: tp.ratingScore,
      ratingCount: tp.ratingCount,
      merchantName: tp.merchantName || '',
      freeShipping: false,
      barcode: tp.barcode || undefined,
      favoriteCount: tp.favoriteCount || undefined,
      orderCount: tp.orderCount || undefined,
    };

    const ebayComparable: EbayComparable = {
      title: ebayItem.title,
      price: ebayItem.price,
      currency: ebayItem.currency,
      itemId: ebayItem.itemId,
      soldQuantity: ebayItem.soldQuantity,
      condition: ebayItem.condition || '',
      imageUrl: ebayItem.imageUrl || '',
      categoryId: ebayItem.categoryId,
      categoryName: ebayItem.categoryName || '',
    };

    const result = calculateArbitrage({
      trendyol: trendyolProduct,
      ebayItems: [ebayComparable], // single matched item
      exchangeRate,
      shippingCostUsd: params.shippingCostUsd,
      feeOverridePercent: params.feeOverridePercent,
      includeInternationalFee: params.includeInternationalFee,
      highDefectRate: params.highDefectRate,
    });

    if (result) {
      result.matchTier = match.matchType === 'exact' ? 'gtin' : 'gemini';
      result.translatedQuery = match.reason;
      results.push(result);
    }
  }

  matchStats.noMatch = trendyolProducts.length - matchStats.exact - matchStats.equivalent - matchStats.similar;

  return { results, productsScanned: trendyolProducts.length, matchStats };
}

// ---------------------------------------------------------------------------
// AI Matching via Gemini
// ---------------------------------------------------------------------------

async function aiMatchCategory(
  trendyolProducts: Awaited<ReturnType<typeof getTrendyolIndexForCategory>>,
  ebayProducts: Awaited<ReturnType<typeof getEbayIndexForCategory>>,
  slug: string,
): Promise<GeminiMatch[]> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    logger.error('GEMINI_API_KEY not set — cannot run AI matching');
    return [];
  }

  // Pre-filter: reduce eBay products to top 100 by relevance heuristics
  const filteredEbay = preFilterEbayProducts(ebayProducts, trendyolProducts);

  // Build compact representations for the prompt
  const trendyolCompact = trendyolProducts.map(p => ({
    id: p.productId,
    name: p.name,
    brand: p.brand,
    priceTRY: p.priceTry,
    rating: p.ratingScore,
    barcode: p.barcode || undefined,
  }));

  const ebayCompact = filteredEbay.map(p => ({
    itemId: p.itemId,
    title: p.title,
    priceUSD: p.price,
    condition: p.condition,
    category: p.categoryName,
  }));

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' } as any,
    });

    const prompt = `You are a cross-border e-commerce product matching expert specializing in Turkish→US/UK arbitrage.

TASK: Match each Trendyol product (Turkish marketplace) to its best eBay equivalent (US marketplace).

TRENDYOL PRODUCTS (source — buy cheap):
${JSON.stringify(trendyolCompact)}

EBAY PRODUCTS (target — sell higher):
${JSON.stringify(ebayCompact)}

MATCH TYPES:
- "exact": Same brand AND same product (e.g., Tefal Titanyum ↔ Tefal Titanium Frypan)
- "equivalent": Same product type, interchangeable (e.g., "Pamuk Peştemal 100x180" ↔ "Turkish Cotton Peshtemal Bath Towel 40x70")
- "similar": Same category, comparable quality tier, valid for price comparison (confidence must be > 0.6)
- "none": No reasonable match exists on eBay

RULES:
- Turkish "Peştemal" = English "Peshtemal" or "Turkish towel"
- Turkish "Gümüş" = English "Silver", "Halhal" = "Anklet", "Küpe" = "Earring", "Yüzük" = "Ring"
- Match by product FUNCTION and TYPE, not just translated keywords
- Consider price proportionality: a ₺200 premium towel shouldn't match a $3 washcloth
- If a Trendyol product has a barcode, prioritize exact barcode matches
- It's OK (and preferred) to return "none" rather than a low-quality match
- Each Trendyol product should match AT MOST one eBay product (the best one)
- Multiple Trendyol products CAN match the same eBay product

Return a JSON array:
[{"trendyolId": number, "ebayItemId": "string", "matchType": "exact"|"equivalent"|"similar"|"none", "confidence": 0.0-1.0, "reason": "brief explanation"}]

Include ALL Trendyol products in the response (even those with "none" match).`;

    const response = await model.generateContent(prompt);
    let raw = response.response.text().trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const matches: GeminiMatch[] = parsed
      .filter((m: any) => m.trendyolId && m.matchType)
      .map((m: any) => ({
        trendyolId: m.trendyolId,
        ebayItemId: m.ebayItemId || '',
        matchType: m.matchType,
        confidence: typeof m.confidence === 'number' ? m.confidence : 0,
        reason: m.reason || '',
      }));

    // Cache matches
    await cacheMatches(matches, slug);

    return matches;
  } catch (err) {
    logger.error('Gemini matching failed', err instanceof Error ? err : new Error(String(err)), { slug });
    return [];
  }
}

/**
 * Pre-filter eBay products to reduce prompt size.
 * Keep top 100 most relevant products based on simple heuristics.
 */
function preFilterEbayProducts(
  ebayProducts: Awaited<ReturnType<typeof getEbayIndexForCategory>>,
  trendyolProducts: Awaited<ReturnType<typeof getTrendyolIndexForCategory>>,
): typeof ebayProducts {
  if (ebayProducts.length <= 100) return ebayProducts;

  // Extract brand names and keywords from Trendyol products
  const trendyolBrands = new Set(
    trendyolProducts.map(p => p.brand.toLowerCase()).filter(b => b.length > 1)
  );
  const trendyolBarcodes = new Set(
    trendyolProducts.map(p => p.barcode).filter((b): b is string => !!b && b.length >= 8)
  );

  // Score each eBay product by relevance
  const scored = ebayProducts.map(ep => {
    let score = 0;
    const titleLower = ep.title.toLowerCase();

    // Brand match
    for (const brand of trendyolBrands) {
      if (titleLower.includes(brand)) { score += 10; break; }
    }

    // Price in reasonable range (not too cheap, not luxury)
    if (ep.price >= 5 && ep.price <= 200) score += 3;

    // Has sold items (demand signal)
    if (ep.soldQuantity > 0) score += 5;

    // Turkish-related keywords
    if (/turkish|ottoman|peshtemal|kilim|evil eye|hammam|cezve|lokum|baklava/i.test(ep.title)) {
      score += 8;
    }

    return { product: ep, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 100).map(s => s.product);
}

// ---------------------------------------------------------------------------
// Match caching
// ---------------------------------------------------------------------------

async function getCachedMatches(slug: string): Promise<GeminiMatch[]> {
  try {
    const matches = await prisma.arbitrageMatch.findMany({
      where: {
        categorySlug: slug,
        expiresAt: { gt: new Date() },
      },
    });

    if (matches.length === 0) return [];

    return matches.map(m => ({
      trendyolId: m.trendyolId,
      ebayItemId: m.ebayItemId,
      matchType: m.matchType as GeminiMatch['matchType'],
      confidence: m.confidence,
      reason: m.matchReason || '',
    }));
  } catch {
    return [];
  }
}

async function cacheMatches(matches: GeminiMatch[], slug: string): Promise<void> {
  const expiresAt = new Date(Date.now() + MATCH_TTL_MS);

  for (const m of matches) {
    if (m.matchType === 'none' || !m.ebayItemId) continue;

    try {
      await prisma.arbitrageMatch.upsert({
        where: {
          trendyolId_ebayItemId: {
            trendyolId: m.trendyolId,
            ebayItemId: m.ebayItemId,
          },
        },
        create: {
          trendyolId: m.trendyolId,
          ebayItemId: m.ebayItemId,
          confidence: m.confidence,
          matchReason: m.reason,
          matchType: m.matchType,
          categorySlug: slug,
          expiresAt,
        },
        update: {
          confidence: m.confidence,
          matchReason: m.reason,
          matchType: m.matchType,
          expiresAt,
        },
      });
    } catch {
      // Upsert race — non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatchStats {
  total: number;
  exact: number;
  equivalent: number;
  similar: number;
  noMatch: number;
}

function emptyStats(): MatchStats {
  return { total: 0, exact: 0, equivalent: 0, similar: 0, noMatch: 0 };
}
