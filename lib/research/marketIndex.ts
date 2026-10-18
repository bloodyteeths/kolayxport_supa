/**
 * Market index: turns Product finder's *estimated* sales into *measured* sales over time.
 *
 * `getBatchListingStats` (lib/etsy/listingStats) measures a shop's sales from the change of its sales counter between
 * two of our snapshots ≥ 1 day apart. A niche searched once has one snapshot, so it can only be estimated. Every
 * /api/research/sales call registers its listing set here (a shared ResearchCache row kept 14 days, no new table);
 * the daily `research-market-index` job re-reads up to MAX_SETS_PER_RUN sets, which writes the next snapshots — the
 * next search of that niche gets measured numbers. Stops early at the Etsy budget breaker.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { etsyBudgetLimited, sha1 } from './etsySearch';

const SHARED = '__public__';
const PREFIX = 'public:etsy:marketIndex:';
const KEEP_DAYS = 14;
export const MAX_SETS_PER_RUN = 150;

/** Remember a listing set for daily re-snapshots (best effort, never fails the request). */
export async function registerMarketSet(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const sorted = [...ids].sort();
  const cacheKey = `${PREFIX}${sha1(sorted.join(','))}`;
  const expiresAt = new Date(Date.now() + KEEP_DAYS * 86_400_000);
  try {
    await prisma.researchCache.upsert({
      where: { userId_cacheKey: { userId: SHARED, cacheKey } },
      create: { userId: SHARED, cacheKey, data: { ids: sorted }, expiresAt },
      update: { expiresAt },
    });
  } catch (err) {
    logger.warn('[marketIndex] register failed', { error: (err as Error)?.message });
  }
}

/** Daily job body: re-snapshot the registered sets, newest first, within the Etsy budget. */
export async function runMarketIndex(signal?: AbortSignal): Promise<Record<string, unknown>> {
  const rows = await prisma.researchCache.findMany({
    where: { userId: SHARED, cacheKey: { startsWith: PREFIX }, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: 'desc' },
    take: MAX_SETS_PER_RUN,
    select: { data: true },
  });
  const { getBatchListingStats } = await import('@/lib/etsy/listingStats');
  let done = 0;
  let stoppedForBudget = false;
  for (const r of rows) {
    if (signal?.aborted) break;
    if (etsyBudgetLimited()) {
      stoppedForBudget = true;
      break;
    }
    const ids = Array.isArray((r.data as any)?.ids) ? ((r.data as any).ids as string[]) : [];
    if (!ids.length) continue;
    try {
      // Resolve every shop of the set (up to 3 passes), so each one gets today's snapshot.
      let want = ids;
      for (let pass = 0; pass < 3 && want.length && !signal?.aborted; pass++) {
        const res = await getBatchListingStats(want, { maxNewShops: 25 });
        want = res.pendingIds;
      }
      done++;
    } catch (err) {
      logger.warn('[marketIndex] set failed', { error: (err as Error)?.message });
    }
  }
  return { sets: rows.length, done, stoppedForBudget };
}
