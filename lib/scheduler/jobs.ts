/**
 * Registry of every scheduled job (owner W1).
 *
 * W1's core jobs plus each workstream's array:
 *   lib/stock/jobs.ts (W2), lib/etsy/listingJobs.ts (W3: listing reconcile),
 *   lib/orders/jobs.ts (W4: etsy-orders-incremental / reconcile),
 *   lib/notificationCenter/jobs.ts (W5), lib/partners/jobs.ts (referral bounties),
 *   lib/activation/jobs.ts (onboarding reminder emails).
 * Job names must be unique; a duplicate is dropped (first wins) and logged.
 */
import type { ScheduledJob } from './types';
import { coreJobs } from './coreJobs';
import { stockJobs } from '@/lib/stock/jobs';
import { listingJobs } from '@/lib/etsy/listingJobs';
import { orderJobs } from '@/lib/orders/jobs';
import { notificationJobs } from '@/lib/notificationCenter/jobs';
import { hepsiburadaJobs } from '@/lib/hepsiburada/jobs';
import { partnerJobs } from '@/lib/partners/jobs';
import { activationJobs } from '@/lib/activation/jobs';

const MINUTE = 60_000;

/**
 * Listings-grid jobs (BR-8) and research housekeeping.
 *  send-scheduled-drafts   every 5 min   lib/drafts/scheduledSend (HTTP fallback: /api/cron/send-scheduled-drafts)
 *  research-snapshots      daily 06:00   lib/research/watchAdapter (HTTP fallback: /api/cron/research-snapshots)
 *  research-cache-prune    daily 04:10   delete expired ResearchCache rows
 *  research-niche-library  daily 04:50   lib/research/nicheLibrary (seed niches: daily reads → measured sales, home cards)
 *  research-market-index   daily 05:20   lib/research/marketIndex (re-snapshot searched niches → measured sales)
 *  market-calibration      daily 05:50   lib/market/calibration (Trendyol orders-per-rating from connected stores)
 *  market-retention        daily 04:40   lib/market/retention (crowd Trendyol/HB readings: thin to daily after 90 days)
 *  research-ebay-items     daily 06:30   lib/research/ebayItemTracker (eBay seller/item watches: EbayPriceSnapshot)
 *  arbitrage-index-refresh every 6 h     lib/arbitrage/indexRefresh (Price gap: Trendyol/eBay indexes + AI matches)
 * Loaded lazily so the draft services are not imported when the scheduler module loads.
 */
const listingsGridJobs: ScheduledJob[] = [
  {
    name: 'send-scheduled-drafts',
    intervalMinutes: 5,
    timeoutMs: 4 * MINUTE,
    maxAttemptsPerBucket: 1,
    run: async (ctx) => {
      const { scheduledSendJob } = await import('@/lib/drafts/scheduledSend');
      return scheduledSendJob.run(ctx);
    },
  },
  {
    name: 'market-calibration',
    dailyAtUtc: '05:50',
    timeoutMs: 15 * MINUTE,
    maxAttemptsPerBucket: 1,
    run: async () => {
      const { runMarketCalibration } = await import('@/lib/market/calibration');
      return runMarketCalibration();
    },
  },
  {
    name: 'market-retention',
    dailyAtUtc: '04:40',
    timeoutMs: 20 * MINUTE,
    maxAttemptsPerBucket: 1,
    run: async () => {
      const { runMarketRetention } = await import('@/lib/market/retention');
      return runMarketRetention();
    },
  },
  {
    // Niche library (lib/research/nicheLibrary): ~130 common seller niches researched daily, so first visits show
    // measured sales and Research Home has "Strong niches today". Before the market index, within the Etsy budget.
    name: 'research-niche-library',
    dailyAtUtc: '04:50',
    timeoutMs: 60 * MINUTE,
    maxAttemptsPerBucket: 1,
    run: async ({ signal }) => {
      const { runNicheLibrary } = await import('@/lib/research/nicheLibrary');
      return runNicheLibrary(signal);
    },
  },
  {
    // Market index (lib/research/marketIndex): re-snapshot the listing sets Product finder showed sales for in the
    // last 14 days, so the next search of a niche gets measured sales instead of estimates. Stops at the Etsy budget.
    name: 'research-market-index',
    dailyAtUtc: '05:20',
    timeoutMs: 40 * MINUTE,
    maxAttemptsPerBucket: 1,
    run: async ({ signal }) => {
      const { runMarketIndex } = await import('@/lib/research/marketIndex');
      return runMarketIndex(signal);
    },
  },
  {
    // R3 Shop tracker (BR-8): one shared reading per watched Etsy shop / query per UTC day, Reconcile priority
    // under the shared Etsy daily budget (stops at the gate), then the watchers' alerts. HTTP fallback:
    // /api/cron/research-snapshots.
    name: 'research-snapshots',
    dailyAtUtc: '06:00',
    timeoutMs: 50 * MINUTE,
    maxAttemptsPerBucket: 1,
    run: async (ctx) => {
      const { researchSnapshotsJob } = await import('@/lib/research/watchAdapter');
      return researchSnapshotsJob.run(ctx);
    },
  },
  {
    // Shop tracker eBay rows (sellers' tracked items + "Watch an eBay item"): one EbayPriceSnapshot per active
    // EbayTrackedProduct per UTC day through the Browse API (the legacy Product tracker's "Refresh all" did this).
    name: 'research-ebay-items',
    dailyAtUtc: '06:30',
    timeoutMs: 40 * MINUTE,
    maxAttemptsPerBucket: 1,
    run: async (ctx) => {
      const { refreshTrackedEbayItems } = await import('@/lib/research/ebayItemTracker');
      return (await refreshTrackedEbayItems({ signal: ctx.signal })) as unknown as Record<string, unknown>;
    },
  },
  {
    // Price gap (Product finder `?source=trendyol`) reads TrendyolProductIndex (6 h rows), EbayProductIndex (48 h) and
    // ArbitrageMatch (24 h); the legacy ArbitrageScanner was the only thing that refilled them.
    name: 'arbitrage-index-refresh',
    intervalMinutes: 6 * 60,
    timeoutMs: 45 * MINUTE,
    maxAttemptsPerBucket: 1,
    run: async (ctx) => {
      const { runArbitrageIndexRefresh } = await import('@/lib/arbitrage/indexRefresh');
      return (await runArbitrageIndexRefresh({ signal: ctx.signal })) as unknown as Record<string, unknown>;
    },
  },
  {
    name: 'research-cache-prune',
    dailyAtUtc: '04:10',
    timeoutMs: 5 * MINUTE,
    run: async () => {
      const { pruneExpiredCache } = await import('@/lib/researchCache');
      return { deleted: await pruneExpiredCache() };
    },
  },
];

function dedupe(jobs: ScheduledJob[]): ScheduledJob[] {
  const seen = new Set<string>();
  const out: ScheduledJob[] = [];
  for (const job of jobs) {
    if (!job?.name || seen.has(job.name)) {
      if (job?.name) console.warn(`[scheduler] duplicate job name "${job.name}" ignored`);
      continue;
    }
    if (!job.intervalMinutes && !job.dailyAtUtc) {
      console.warn(`[scheduler] job "${job.name}" has no schedule; ignored`);
      continue;
    }
    seen.add(job.name);
    out.push(job);
  }
  return out;
}

export const allJobs: ScheduledJob[] = dedupe([...coreJobs, ...stockJobs, ...listingJobs, ...orderJobs, ...notificationJobs, ...listingsGridJobs, ...hepsiburadaJobs, ...partnerJobs, ...activationJobs]);
