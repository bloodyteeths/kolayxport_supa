// Scheduled activation jobs (lib/scheduler/jobs.ts registers them; the VPS scheduler runs them).
//  activation-emails  daily 06:15 UTC (09:15 Istanbul)  onboarding reminders to signups without a store (lib/activation/emails.ts)
// ACTIVATION_EMAILS=on sends; otherwise the run is a dry run that only logs.
import type { ScheduledJob } from '@/lib/scheduler/types';

export const activationJobs: ScheduledJob[] = [
  {
    name: 'activation-emails',
    dailyAtUtc: '06:15',
    timeoutMs: 5 * 60_000,
    maxAttemptsPerBucket: 1,
    run: async () => {
      const { runActivationEmails } = await import('./emails');
      return { ...(await runActivationEmails()) };
    },
  },
];
