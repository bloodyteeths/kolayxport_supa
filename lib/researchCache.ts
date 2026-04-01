import prisma from './prisma';

/**
 * Cache-first fetcher for research data.
 * Checks ResearchCache, returns cached data if fresh, otherwise calls fetcher and stores result.
 */
export async function getCachedOrFetch<T>(
  userId: string,
  cacheKey: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  // Check cache
  const cached = await prisma.researchCache.findUnique({
    where: { userId_cacheKey: { userId, cacheKey } },
  });

  if (cached && cached.expiresAt > new Date()) {
    return cached.data as T;
  }

  // Fetch fresh data
  const data = await fetcher();

  // Store in cache (upsert)
  await prisma.researchCache.upsert({
    where: { userId_cacheKey: { userId, cacheKey } },
    create: {
      userId,
      cacheKey,
      data: data as any,
      expiresAt: new Date(Date.now() + ttlMs),
    },
    update: {
      data: data as any,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  return data;
}

// TTL constants
export const CACHE_TTL = {
  NICHE: 6 * 60 * 60 * 1000,      // 6 hours
  SHOP: 12 * 60 * 60 * 1000,      // 12 hours
  KEYWORDS: 12 * 60 * 60 * 1000,  // 12 hours
  TRENDS: 24 * 60 * 60 * 1000,    // 24 hours
  REVIEWS: 24 * 60 * 60 * 1000,   // 24 hours
};

/**
 * Clean up expired cache entries. Call periodically.
 */
export async function pruneExpiredCache(): Promise<number> {
  const result = await prisma.researchCache.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
