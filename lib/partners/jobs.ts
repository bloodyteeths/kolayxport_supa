// Scheduled partner jobs (lib/scheduler/jobs.ts registers them; the VPS scheduler runs them).
//  partner-bounties  daily 02:00 UTC  bounties past their 30-day hold → payable (lib/partners/bounty.ts)
// HTTP fallback: /api/cron/partner-bounties. The report, dashboard and payout run also promote due rows.
import type { ScheduledJob } from '@/lib/scheduler/types';

export const partnerJobs: ScheduledJob[] = [
  {
    name: 'partner-bounties',
    dailyAtUtc: '02:00',
    timeoutMs: 5 * 60_000,
    maxAttemptsPerBucket: 1,
    run: async () => {
      const { promoteDueBounties } = await import('./bounty');
      return { promoted: await promoteDueBounties() };
    },
  },
];
