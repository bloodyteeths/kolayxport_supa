/**
 * Core scheduler jobs of the Etsy event backbone (owner W1).
 *
 *  etsy-webhook-sweep     every 1 min   one worker pass (the 5 s loop normally does the work;
 *                                       this records a JobRun heartbeat and is the in-process net)
 *  etsy-queue-health      every 5 min   notifyAdmins(webhookBacklog) when the oldest due event is
 *                                       > 10 min old or failures appeared in the last hour (1 h dedupe)
 *  etsy-api-usage-flush   every 1 min   flush rate-budget counters to EtsyApiUsage / EtsyApiQuota
 *  webhook-purge          daily 03:40   delete old Etsy WebhookEvent rows (batches of 5000)
 *  jobrun-purge           daily 03:50   delete JobRun rows older than 14 days
 */
import prisma from '@/lib/prisma';
import type { ScheduledJob } from './types';

const MINUTE = 60_000;
const PURGE_BATCH = 5_000;
const MAX_PURGE_BATCHES = 200;

export async function getEtsyQueueHealthSnapshot(nowMs: number = Date.now()) {
  const [oldestDue, due, failed1h] = await Promise.all([
    prisma.webhookEvent.findFirst({
      where: { provider: 'etsy', status: 'received', nextAttemptAt: { lte: new Date(nowMs) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.webhookEvent.count({ where: { provider: 'etsy', status: 'received', nextAttemptAt: { lte: new Date(nowMs) } } }),
    prisma.webhookEvent.count({ where: { provider: 'etsy', status: 'failed', processedAt: { gte: new Date(nowMs - 60 * MINUTE) } } }),
  ]);
  const oldestDueAgeMs = oldestDue ? nowMs - oldestDue.createdAt.getTime() : null;
  return { due, failed1h, oldestDueAgeMs };
}

/** Pure: should the backlog alert fire? */
export function shouldAlertBacklog(s: { oldestDueAgeMs: number | null; failed1h: number }): boolean {
  return (s.oldestDueAgeMs !== null && s.oldestDueAgeMs > 10 * MINUTE) || s.failed1h > 0;
}

async function purgeBatches(sql: () => Promise<number>, signal: AbortSignal): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_PURGE_BATCHES && !signal.aborted; i++) {
    const n = await sql();
    total += n;
    if (n < PURGE_BATCH) break;
  }
  return total;
}

export const coreJobs: ScheduledJob[] = [
  {
    name: 'etsy-webhook-sweep',
    intervalMinutes: 1,
    timeoutMs: 2 * MINUTE,
    run: async () => {
      const { runEtsyWorkerPass } = await import('@/lib/etsy/webhooks/worker');
      const r = await runEtsyWorkerPass();
      return { recovered: r.recovered, claimed: r.claimed, coalesced: r.coalesced, inFlight: r.inFlight };
    },
  },
  {
    name: 'etsy-queue-health',
    intervalMinutes: 5,
    timeoutMs: MINUTE,
    run: async () => {
      const s = await getEtsyQueueHealthSnapshot();
      if (shouldAlertBacklog(s)) {
        const { notifyAdmins } = await import('@/lib/notifications');
        await notifyAdmins({
          type: 'webhookBacklog',
          severity: s.failed1h > 0 ? 'error' : 'warning',
          titleKey: 'types.webhookBacklog',
          params: { due: s.due, failed: s.failed1h, oldestMinutes: s.oldestDueAgeMs ? Math.round(s.oldestDueAgeMs / MINUTE) : 0 },
          link: '/admin/monitoring',
          dedupeKey: `webhookBacklog:${new Date().toISOString().slice(0, 13)}`,
          onlyIfNew: true,
        });
      }
      return { ...s, alerted: shouldAlertBacklog(s) };
    },
  },
  {
    name: 'etsy-api-usage-flush',
    intervalMinutes: 1,
    timeoutMs: MINUTE,
    maxAttemptsPerBucket: 1,
    run: async () => {
      const { flushEtsyUsage } = await import('@/lib/etsy/rateBudget');
      return flushEtsyUsage();
    },
  },
  {
    name: 'webhook-purge',
    dailyAtUtc: '03:40',
    timeoutMs: 20 * MINUTE,
    run: async ({ signal }) => {
      // Parked longer than 14 days: give up (terminal), purged with the failed rows later.
      const expiredBlocked = await prisma.webhookEvent.updateMany({
        where: { provider: 'etsy', status: 'blocked_reauth', createdAt: { lt: new Date(Date.now() - 14 * 24 * 60 * MINUTE) } },
        data: { status: 'failed', processedAt: new Date(), errorMessage: 'expired:blocked_reauth_14d' },
      });
      const doneDeleted = await purgeBatches(() => prisma.$executeRaw`
        DELETE FROM "WebhookEvent" WHERE "id" IN (
          SELECT "id" FROM "WebhookEvent"
          WHERE "provider" = 'etsy' AND "status" IN ('done', 'ignored', 'coalesced')
            AND "createdAt" < now() - interval '30 days'
          LIMIT ${PURGE_BATCH})`, signal);
      const failedDeleted = await purgeBatches(() => prisma.$executeRaw`
        DELETE FROM "WebhookEvent" WHERE "id" IN (
          SELECT "id" FROM "WebhookEvent"
          WHERE "provider" = 'etsy' AND "status" = 'failed'
            AND "createdAt" < now() - interval '90 days'
          LIMIT ${PURGE_BATCH})`, signal);
      return { expiredBlocked: expiredBlocked.count, doneDeleted, failedDeleted };
    },
  },
  {
    name: 'jobrun-purge',
    dailyAtUtc: '03:50',
    timeoutMs: 5 * MINUTE,
    run: async ({ signal }) => {
      const deleted = await purgeBatches(() => prisma.$executeRaw`
        DELETE FROM "JobRun" WHERE "id" IN (
          SELECT "id" FROM "JobRun" WHERE "startedAt" < now() - interval '14 days' LIMIT ${PURGE_BATCH})`, signal);
      return { deleted };
    },
  },
];
