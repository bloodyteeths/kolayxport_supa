/**
 * Hepsiburada scheduled jobs, registered in lib/scheduler/jobs.ts. Every job fans out over users with saved HB
 * credentials; the per-user functions skip users the MARKETPLACE_HEPSIBURADA flag does not enable.
 *
 *  hepsiburada-orders        every 5 min   order sync (open lines, packages, status lists, cancellations)
 *  hepsiburada-listings      hourly        listing cache refresh (HepsiburadaListing)
 *  hepsiburada-uploads       every 5 min   resolve async price/stock upload batches
 *  hepsiburada-finance       daily 04:40   transactions → FinancialTransaction
 */
import type { ScheduledJob } from '@/lib/scheduler/types';
import { logger } from '@/lib/logger';
import { MARKETPLACE_HEPSIBURADA } from '@/lib/config';

const MINUTE = 60_000;

async function forEachHbUser(name: string, signal: AbortSignal, fn: (userId: string) => Promise<unknown>) {
  if (!MARKETPLACE_HEPSIBURADA) return { skipped: 'disabled' };
  const { listHepsiburadaUserIds } = await import('./orderSync');
  const users = await listHepsiburadaUserIds();
  let ok = 0;
  let failed = 0;
  for (const userId of users) {
    if (signal.aborted) break;
    try {
      await fn(userId);
      ok++;
    } catch (err) {
      failed++;
      logger.warn(`[hepsiburadaJobs] ${name} failed`, { userId, error: (err as Error)?.message });
    }
  }
  return { users: users.length, ok, failed };
}

export const hepsiburadaJobs: ScheduledJob[] = [
  {
    name: 'hepsiburada-orders',
    intervalMinutes: 5,
    timeoutMs: 4 * MINUTE,
    run: async ({ signal }) => {
      const { syncHepsiburadaRecentOrdersForUser } = await import('./orderSync');
      return forEachHbUser('orders', signal, syncHepsiburadaRecentOrdersForUser);
    },
  },
  {
    name: 'hepsiburada-listings',
    intervalMinutes: 60,
    timeoutMs: 20 * MINUTE,
    run: async ({ signal }) => {
      const { syncHepsiburadaListingsForUser } = await import('./listingSync');
      return forEachHbUser('listings', signal, (userId) => syncHepsiburadaListingsForUser(userId, { signal }));
    },
  },
  {
    name: 'hepsiburada-uploads',
    intervalMinutes: 5,
    timeoutMs: 4 * MINUTE,
    run: async ({ signal }) => {
      const { resolvePendingHbUploads } = await import('./uploads');
      return forEachHbUser('uploads', signal, resolvePendingHbUploads);
    },
  },
  {
    name: 'hepsiburada-finance',
    dailyAtUtc: '04:40',
    timeoutMs: 30 * MINUTE,
    maxAttemptsPerBucket: 2,
    run: async ({ signal }) => {
      const { syncHepsiburadaFinanceForUser } = await import('./finance');
      return forEachHbUser('finance', signal, (userId) => syncHepsiburadaFinanceForUser(userId));
    },
  },
];
