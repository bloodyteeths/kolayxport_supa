/**
 * Scheduler job contract (owner W1).
 *
 * Each workstream exports an array of ScheduledJob from its own jobs module
 * (lib/stock/jobs.ts, lib/etsy/listingJobs.ts, lib/orders/jobs.ts,
 * lib/notificationCenter/jobs.ts); lib/scheduler/jobs.ts concatenates them.
 * Runs are recorded in JobRun, unique per (jobName, bucket), so a bucket runs
 * at most once even when the in-process scheduler and the GitHub cron
 * fallback race.
 */

export type ScheduledJobContext = {
  /** Time bucket this run covers, e.g. '2026-10-15T09:15' or '2026-10-15'. */
  bucket: string;
  /** Aborted on timeout or shutdown (SIGTERM). */
  signal: AbortSignal;
};

export type ScheduledJob = {
  name: string;
  /** Run every N minutes (bucketed). */
  intervalMinutes?: number;
  /** Run once a day at 'HH:MM' UTC. */
  dailyAtUtc?: string;
  timeoutMs?: number;
  maxAttemptsPerBucket?: number;
  run: (ctx: ScheduledJobContext) => Promise<Record<string, unknown> | void>;
};
