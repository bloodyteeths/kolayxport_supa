/**
 * eBay Product Indexer — sweeps eBay categories and stores in shared EbayProductIndex.
 *
 * Designed to run as a daily background job (~40-80 eBay API calls total).
 * The indexed products are shared across ALL tenants — no per-user eBay calls needed
 * for arbitrage matching.
 */
import prisma from '../prisma';
import { logger } from '../logger';
import { callEbayRateLimited } from '../integrations/ebayRateLimiter';
import { TRENDYOL_CATEGORIES } from '../integrations/trendyolSearch';

const EBAY_API_BASE = 'https://api.ebay.com';
const INDEX_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Static English search queries per Trendyol category slug.
 * Each query yields up to 200 eBay item summaries.
 * Multiple queries per category give diverse product coverage.
 */
export const CATEGORY_SEARCH_QUERIES: Record<string, string[]> = {};

// Build from TRENDYOL_CATEGORIES — each has an ebaySearch field
for (const cat of TRENDYOL_CATEGORIES) {
  const queries = [cat.ebaySearch];
  // Add variations for better coverage
  const extras = getExtraQueries(cat.slug, cat.ebaySearch);
  queries.push(...extras);
  CATEGORY_SEARCH_QUERIES[cat.slug] = queries;
}

function getExtraQueries(slug: string, primary: string): string[] {
  // Add a "best seller" / "popular" variant for key categories
  const extras: string[] = [];
  if (slug.includes('havlu')) extras.push('peshtemal beach towel', 'Turkish bath towel set');
  else if (slug.includes('kilim')) extras.push('kilim pillow cover', 'vintage kilim runner');
  else if (slug.includes('kolye')) extras.push('Turkish 925 sterling silver necklace');
  else if (slug.includes('yuzuk')) extras.push('Turkish Ottoman silver ring men');
  else if (slug.includes('lokum')) extras.push('Turkish delight candy gift box');
  else if (slug.includes('kahve')) extras.push('Turkish coffee Mehmet Efendi');
  else if (slug.includes('cezve') || slug.includes('caydanlik')) extras.push('Turkish coffee maker copper');
  else if (slug.includes('lambader') || slug.includes('avize')) extras.push('Turkish mosaic hanging lamp');
  else if (slug.includes('baklava')) extras.push('baklava pistachio Turkish');
  else if (slug.includes('fular')) extras.push('Turkish silk scarf women');
  else if (slug.includes('nazar') || slug.includes('anahtar')) extras.push('evil eye jewelry Turkish');
  return extras;
}

interface IndexResult {
  slug: string;
  queries: number;
  indexed: number;
  errors: string[];
}

/**
 * Index a single eBay category: run all search queries and store results.
 */
export async function indexEbayCategory(
  slug: string,
  appToken: string
): Promise<IndexResult> {
  const queries = CATEGORY_SEARCH_QUERIES[slug] || [];
  const result: IndexResult = { slug, queries: queries.length, indexed: 0, errors: [] };

  for (const query of queries) {
    try {
      const items = await searchEbayForIndex(query, appToken);
      if (items.length > 0) {
        const stored = await storeEbayProducts(items, query);
        result.indexed += stored;
      }
    } catch (err) {
      result.errors.push(`${query}: ${String(err)}`);
    }
  }

  return result;
}

/**
 * Full index refresh — sweep all 38 categories.
 * Returns summary of what was indexed.
 */
export async function refreshFullEbayIndex(appToken: string): Promise<{
  categories: number;
  totalIndexed: number;
  totalQueries: number;
  errors: string[];
  durationMs: number;
}> {
  const start = Date.now();
  const allSlugs = Object.keys(CATEGORY_SEARCH_QUERIES);
  let totalIndexed = 0;
  let totalQueries = 0;
  const errors: string[] = [];

  // Clean expired entries first
  await cleanExpiredEntries();

  for (const slug of allSlugs) {
    const r = await indexEbayCategory(slug, appToken);
    totalIndexed += r.indexed;
    totalQueries += r.queries;
    errors.push(...r.errors);
  }

  return {
    categories: allSlugs.length,
    totalIndexed,
    totalQueries,
    errors,
    durationMs: Date.now() - start,
  };
}

/**
 * Get eBay index status per category.
 */
export async function getIndexStatus(): Promise<Array<{
  slug: string;
  label: string;
  productCount: number;
  oldestFetch: Date | null;
  newestFetch: Date | null;
  isStale: boolean;
}>> {
  const now = new Date();
  const results: Array<{
    slug: string;
    label: string;
    productCount: number;
    oldestFetch: Date | null;
    newestFetch: Date | null;
    isStale: boolean;
  }> = [];

  for (const cat of TRENDYOL_CATEGORIES) {
    const queries = CATEGORY_SEARCH_QUERIES[cat.slug] || [];
    // Count non-expired products for this category's queries
    const products = await prisma.ebayProductIndex.aggregate({
      where: {
        searchQuery: { in: queries.map(q => q.toLowerCase().trim()) },
        expiresAt: { gt: now },
      },
      _count: true,
      _min: { fetchedAt: true },
      _max: { fetchedAt: true },
    });

    const oldestFetch = products._min.fetchedAt;
    const isStale = !oldestFetch || (now.getTime() - oldestFetch.getTime()) > INDEX_TTL_MS;

    results.push({
      slug: cat.slug,
      label: cat.label,
      productCount: products._count,
      oldestFetch,
      newestFetch: products._max.fetchedAt,
      isStale,
    });
  }

  return results;
}

/**
 * Get indexed eBay products for a set of search queries (used by matcher).
 */
export async function getEbayIndexForCategory(slug: string): Promise<Array<{
  itemId: string;
  title: string;
  price: number;
  currency: string;
  condition: string | null;
  imageUrl: string | null;
  categoryId: string;
  categoryName: string | null;
  soldQuantity: number;
}>> {
  const queries = CATEGORY_SEARCH_QUERIES[slug] || [];
  if (queries.length === 0) return [];

  const products = await prisma.ebayProductIndex.findMany({
    where: {
      searchQuery: { in: queries.map(q => q.toLowerCase().trim()) },
      expiresAt: { gt: new Date() },
    },
    select: {
      itemId: true,
      title: true,
      price: true,
      currency: true,
      condition: true,
      imageUrl: true,
      categoryId: true,
      categoryName: true,
      soldQuantity: true,
    },
    orderBy: { price: 'asc' },
    take: 500, // cap to keep Gemini prompt manageable
  });

  return products;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function searchEbayForIndex(query: string, appToken: string): Promise<any[]> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('limit', '200');
  params.set('filter', 'buyingOptions:{FIXED_PRICE}');
  params.set('sort', 'newlyListed');

  const url = `${EBAY_API_BASE}/buy/browse/v1/item_summary/search?${params.toString()}`;

  try {
    const data = await callEbayRateLimited<any>(url, {
      token: appToken,
      marketplaceId: 'EBAY_US',
    });
    return data.itemSummaries || [];
  } catch (err) {
    logger.warn('eBay index search failed', { query, error: String(err) });
    return [];
  }
}

async function storeEbayProducts(items: any[], searchQuery: string): Promise<number> {
  const expiresAt = new Date(Date.now() + INDEX_TTL_MS);
  const normalizedQuery = searchQuery.toLowerCase().trim();
  let stored = 0;

  for (const item of items) {
    const price = parseFloat(item.price?.value || '0');
    if (price <= 0) continue;

    const itemId = item.itemId || '';
    if (!itemId) continue;

    try {
      await prisma.ebayProductIndex.upsert({
        where: { itemId },
        create: {
          itemId,
          title: item.title || '',
          price,
          currency: item.price?.currency || 'USD',
          condition: item.condition || null,
          imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
          categoryId: item.categories?.[0]?.categoryId || '',
          categoryName: item.categories?.[0]?.categoryName || null,
          soldQuantity: 0,
          sellerName: item.seller?.username || null,
          itemUrl: item.itemWebUrl || null,
          searchQuery: normalizedQuery,
          expiresAt,
        },
        update: {
          title: item.title || '',
          price,
          condition: item.condition || null,
          imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
          expiresAt,
        },
      });
      stored++;
    } catch {
      // Upsert race — non-fatal
    }
  }

  return stored;
}

async function cleanExpiredEntries(): Promise<number> {
  try {
    const result = await prisma.ebayProductIndex.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  } catch {
    return 0;
  }
}
