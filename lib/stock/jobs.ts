/**
 * Scheduled jobs contributed by W2 (stock sync). Registered via
 * lib/scheduler/jobs.ts (in-process scheduler + GitHub run-due fallback).
 *
 * Every job is a cheap no-op while no user has stock sync enabled.
 */
import type { ScheduledJob } from '@/lib/scheduler/types';
import { getEnabledStockUserIds } from './settings';

async function anyEnabled(): Promise<boolean> {
  return (await getEnabledStockUserIds()).size > 0;
}

export const stockJobs: ScheduledJob[] = [
  {
    name: 'stock-push-worker',
    intervalMinutes: 1,
    timeoutMs: 55_000,
    async run() {
      if (!(await anyEnabled())) return { skipped: 'disabled' };
      const { runStockPushWorker } = await import('./pushWorker');
      return await runStockPushWorker({ trigger: 'scheduler' });
    },
  },
  {
    name: 'stock-scan-orders',
    intervalMinutes: 5,
    timeoutMs: 4 * 60_000,
    async run() {
      if (!(await anyEnabled())) return { skipped: 'disabled' };
      const { scanOrdersForStockImpl } = await import('./orders');
      return await scanOrdersForStockImpl();
    },
  },
  {
    name: 'stock-reconcile',
    intervalMinutes: 60,
    timeoutMs: 15 * 60_000,
    async run() {
      if (!(await anyEnabled())) return { skipped: 'disabled' };
      const { runStockReconcile } = await import('./reconcile');
      return await runStockReconcile();
    },
  },
  {
    name: 'stock-observation-purge',
    dailyAtUtc: '04:30',
    timeoutMs: 5 * 60_000,
    async run() {
      const { purgeStockHistory } = await import('./reconcile');
      return await purgeStockHistory();
    },
  },
];
