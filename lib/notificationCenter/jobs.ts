/**
 * Scheduled jobs contributed by W5 (notifications). Registered via
 * lib/scheduler/jobs.ts (allJobs). Each job is idempotent per bucket.
 *
 *   notifications-dispatch   every 1 min   send due email/telegram deliveries
 *   notifications-digest     every 15 min  daily digest at the user's digestHour
 *   notifications-retention  daily 04:40 UTC  prune old rows
 */
import type { ScheduledJob } from '@/lib/scheduler/types';
import { dispatchDueDeliveries } from './dispatcher';
import { runDigests } from './digest';
import { runNotificationRetention } from './retention';

export const notificationJobs: ScheduledJob[] = [
  {
    name: 'notifications-dispatch',
    intervalMinutes: 1,
    timeoutMs: 50_000,
    maxAttemptsPerBucket: 1,
    run: async ({ signal }) => dispatchDueDeliveries({ signal }),
  },
  {
    name: 'notifications-digest',
    intervalMinutes: 15,
    timeoutMs: 5 * 60_000,
    maxAttemptsPerBucket: 2,
    run: async ({ signal }) => runDigests({ signal }),
  },
  {
    name: 'notifications-retention',
    dailyAtUtc: '04:40',
    timeoutMs: 10 * 60_000,
    maxAttemptsPerBucket: 2,
    run: async ({ signal }) => runNotificationRetention({ signal }),
  },
];
