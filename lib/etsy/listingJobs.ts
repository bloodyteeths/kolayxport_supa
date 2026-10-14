/**
 * Scheduled jobs contributed by W3 (listing intel). Registered via lib/scheduler/jobs.ts.
 *
 *  etsy-listings-reconcile         daily 02:30 UTC  shops one after another, skips needsReauth,
 *                                                   stops when canSpend(P2) is false
 *  etsy-listing-stats-sales        daily 01:15 UTC  yesterday's units/orders/revenue per listing
 *  etsy-seo-evaluate               daily 04:00 UTC  evaluate due SEO experiments (+ weekly rollup notify)
 *  etsy-listing-version-retention  daily 04:20 UTC  thin versions older than 180 d to 1/listing/week
 *  etsy-listing-cache-backfill     every 30 min     cache listing ids referenced by recent orders
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { ScheduledJob } from '@/lib/scheduler/types';
import { EtsyPriority, canSpend } from './rateBudget';

const DAY_MS = 24 * 60 * 60_000;

async function activeShops() {
  return prisma.etsyShop.findMany({
    where: { isActive: true, needsReauth: false },
    select: { shopId: true, userId: true },
    orderBy: { lastListingReconcileAt: { sort: 'asc', nulls: 'first' } },
  });
}

const reconcileJob: ScheduledJob = {
  name: 'etsy-listings-reconcile',
  dailyAtUtc: '02:30',
  timeoutMs: 60 * 60_000,
  maxAttemptsPerBucket: 2,
  async run({ signal }) {
    const { reconcileShopListingsDetailed } = await import('./listingReconcile');
    const shops = await activeShops();
    let ok = 0;
    let partial = 0;
    let lost = 0;
    let stoppedForBudget = false;
    for (const shop of shops) {
      if (signal.aborted) break;
      if (!canSpend(shop.shopId, EtsyPriority.Reconcile, 5).ok) {
        stoppedForBudget = true;
        break;
      }
      try {
        const r = await reconcileShopListingsDetailed(shop.shopId, { mode: 'nightly', signal });
        if (r.success) ok++;
        else partial++;
        lost += r.lostWebhookChanges;
        if (r.errors.includes('budget')) {
          stoppedForBudget = true;
          break;
        }
      } catch (err: any) {
        partial++;
        logger.warn('Nightly listing reconcile failed for shop', { shopId: shop.shopId, error: err?.message });
      }
    }
    return { shops: shops.length, ok, partial, lostWebhookChanges: lost, stoppedForBudget };
  },
};

const salesStatsJob: ScheduledJob = {
  name: 'etsy-listing-stats-sales',
  dailyAtUtc: '01:15',
  timeoutMs: 20 * 60_000,
  async run({ signal }) {
    const { aggregateSalesForDay, writeDailyTotalsFromCache } = await import('./listingStatsDaily');
    const yesterday = new Date(Date.now() - DAY_MS);
    const shops = await activeShops();
    let listings = 0;
    for (const shop of shops) {
      if (signal.aborted) break;
      try {
        listings += await aggregateSalesForDay(shop.shopId, yesterday);
        // Ensure yesterday has totals even if the reconcile did not run (no Etsy call).
        const has = await prisma.etsyListingDailyStat.count({
          where: { etsyShopId: shop.shopId, date: new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate())), viewsTotal: { not: null } },
        });
        if (!has) await writeDailyTotalsFromCache(shop.shopId, yesterday);
      } catch (err: any) {
        logger.warn('Listing sales stats failed for shop', { shopId: shop.shopId, error: err?.message });
      }
    }
    return { shops: shops.length, listings };
  },
};

const seoEvaluateJob: ScheduledJob = {
  name: 'etsy-seo-evaluate',
  dailyAtUtc: '04:00',
  timeoutMs: 20 * 60_000,
  async run({ signal }) {
    const { evaluateDueExperiments } = await import('./seoExperiments');
    return evaluateDueExperiments({ signal });
  },
};

const retentionJob: ScheduledJob = {
  name: 'etsy-listing-version-retention',
  dailyAtUtc: '04:20',
  timeoutMs: 20 * 60_000,
  async run({ signal }) {
    const { pruneListingVersions } = await import('./listingHistory');
    const deleted = await pruneListingVersions({ signal });
    return { deleted };
  },
};

const cacheBackfillJob: ScheduledJob = {
  name: 'etsy-listing-cache-backfill',
  intervalMinutes: 30,
  timeoutMs: 10 * 60_000,
  async run({ signal }) {
    const { ensureListingsCached } = await import('./listingCache');
    const since = new Date(Date.now() - 3 * DAY_MS);
    const shops = await activeShops();
    let cached = 0;
    for (const shop of shops) {
      if (signal.aborted) break;
      if (!canSpend(shop.shopId, EtsyPriority.Reconcile, 20).ok) continue;
      try {
        // listing ids referenced by this user's recent Etsy orders, missing from the cache
        const rows = await prisma.$queryRaw<Array<{ lid: string }>>`
          SELECT DISTINCT x.lid FROM (
            SELECT oi."listingRef" AS lid
            FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
            WHERE o."userId" = ${shop.userId} AND o."createdAt" >= ${since} AND oi."listingRef" IS NOT NULL
              AND (o.source = 'etsy-api' OR o."rawData"::jsonb ? 'receipt_id')
            UNION
            SELECT t->>'listing_id' AS lid
            FROM "Order" o, jsonb_array_elements(
              CASE WHEN jsonb_typeof(o."rawData"::jsonb->'transactions') = 'array' THEN o."rawData"::jsonb->'transactions' ELSE '[]'::jsonb END
            ) t
            WHERE o."userId" = ${shop.userId} AND o."createdAt" >= ${since}
          ) x
          WHERE x.lid ~ '^[0-9]+$'
            AND NOT EXISTS (
              SELECT 1 FROM "EtsyListing" l WHERE l."etsyShopId" = ${shop.shopId} AND l."etsyListingId"::text = x.lid
            )
          LIMIT 40`;
        if (!rows.length) continue;
        cached += await ensureListingsCached(shop.shopId, rows.map((r) => BigInt(r.lid)), { max: 20 });
      } catch (err: any) {
        logger.warn('Listing cache backfill failed for shop', { shopId: shop.shopId, error: err?.message });
      }
    }
    return { shops: shops.length, cached };
  },
};

export const listingJobs: ScheduledJob[] = [reconcileJob, salesStatsJob, seoEvaluateJob, retentionJob, cacheBackfillJob];
