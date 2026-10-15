/**
 * Registry of every scheduled job (owner W1).
 *
 * W1's core jobs plus each workstream's array:
 *   lib/stock/jobs.ts (W2), lib/etsy/listingJobs.ts (W3: listing reconcile),
 *   lib/orders/jobs.ts (W4: etsy-orders-incremental / reconcile),
 *   lib/notificationCenter/jobs.ts (W5).
 * Job names must be unique; a duplicate is dropped (first wins) and logged.
 */
import type { ScheduledJob } from './types';
import { coreJobs } from './coreJobs';
import { stockJobs } from '@/lib/stock/jobs';
import { listingJobs } from '@/lib/etsy/listingJobs';
import { orderJobs } from '@/lib/orders/jobs';
import { notificationJobs } from '@/lib/notificationCenter/jobs';

const MINUTE = 60_000;

/**
 * Listings-grid jobs (BR-8) and research housekeeping.
 *  send-scheduled-drafts   every 5 min   lib/drafts/scheduledSend (HTTP fallback: /api/cron/send-scheduled-drafts)
 *  research-cache-prune    daily 04:10   delete expired ResearchCache rows
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

export const allJobs: ScheduledJob[] = dedupe([...coreJobs, ...stockJobs, ...listingJobs, ...orderJobs, ...notificationJobs, ...listingsGridJobs]);
