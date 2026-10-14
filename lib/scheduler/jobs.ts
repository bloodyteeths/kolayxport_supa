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

export const allJobs: ScheduledJob[] = dedupe([...coreJobs, ...stockJobs, ...listingJobs, ...orderJobs, ...notificationJobs]);
