import prisma from '../prisma';

// TTL constants in milliseconds
export const TTL = {
  EXCHANGE_RATE: 60 * 60 * 1000,           // 1 hour
  EBAY_SEARCH: 24 * 60 * 60 * 1000,        // 24 hours — cross-tenant (key is query-only); maximises cache hits within eBay's 5k/day Browse quota
  TRENDYOL_PRODUCTS: 4 * 60 * 60 * 1000,   // 4 hours
  GEMINI_TRANSLATE: 24 * 60 * 60 * 1000,   // 24 hours
  CATEGORY_SUGGESTIONS: 7 * 24 * 60 * 60 * 1000, // 7 days
  CATEGORY_TREE: 30 * 24 * 60 * 60 * 1000, // 30 days
  NICHE_ANALYSIS: 12 * 60 * 60 * 1000,     // 12 hours
} as const;

export async function getCached<T = any>(key: string): Promise<T | null> {
  try {
    const entry = await prisma.arbitrageCache.findUnique({ where: { key } });
    if (!entry) return null;
    if (new Date() > entry.expiresAt) {
      // Expired — delete async, return null
      prisma.arbitrageCache.delete({ where: { key } }).catch(() => {});
      return null;
    }
    return entry.value as T;
  } catch {
    return null;
  }
}

export async function setCache(key: string, value: any, ttlMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    await prisma.arbitrageCache.upsert({
      where: { key },
      create: { key, value, expiresAt },
      update: { value, expiresAt },
    });
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function clearExpired(): Promise<number> {
  try {
    const result = await prisma.arbitrageCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  } catch {
    return 0;
  }
}

// Probabilistic cache cleanup — call on ~10% of requests
export async function maybeClearExpired(): Promise<void> {
  if (Math.random() < 0.1) {
    await clearExpired();
  }
}

// Key builders
export const cacheKey = {
  ebaySearch: (query: string) => `ebay_search:${query.toLowerCase().trim()}`,
  exchangeRate: () => 'exchange_rate:TRY_USD',
  categorySuggestions: (query: string) => `ebay_cat_suggest:${query.toLowerCase().trim()}`,
  categoryTree: () => 'trendyol_categories',
  trendyolProducts: (slug: string, page: number) => `trendyol_products:${slug}:${page}`,
  geminiTranslate: (ids: number[]) => `gemini_translate:${ids.sort().join(',')}`,
  nicheAnalysis: (query: string) => `ebay_niche:${query.toLowerCase().trim()}`,
};
