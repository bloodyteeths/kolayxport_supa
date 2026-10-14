/**
 * JobRun ledger + due-job runner (owner W1).
 *
 * Each ScheduledJob runs at most once per bucket:
 *   intervalMinutes -> bucket = floor(now / interval), e.g. '2026-10-15T09:15'
 *   dailyAtUtc      -> bucket = today's UTC date, due once now >= HH:MM
 *                      (a run missed while the server was down catches up)
 *
 * A job is due when its JobRun(jobName, bucket) row
 *   - does not exist, or
 *   - is 'failed' with attempt < maxAttemptsPerBucket (default 3), or
 *   - is 'running' with a heartbeat older than 2 minutes (crashed owner),
 * and never when it is 'succeeded'. The claim is one atomic
 * INSERT ... ON CONFLICT DO UPDATE ... WHERE <due> RETURNING, so the
 * in-process scheduler and the GitHub run-due fallback can race safely.
 *
 * Runs heartbeat every 30 s; the per-job timeout (default 10 min) aborts the
 * job's signal and records a failure. The same job never overlaps itself in
 * this process: it stays marked running until its body settles, even past the
 * timeout (a body that ignores the signal blocks its own restart).
 */
import crypto from 'crypto';
import os from 'os';
import prisma from '@/lib/prisma';
import { logCronEvent } from '@/lib/admin/events';
import { processState } from '@/lib/processState';
import type { ScheduledJob } from './types';

export const DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const HEARTBEAT_MS = 30_000;
export const STALE_RUNNING_MS = 2 * 60_000;

const OWNER = `${os.hostname()}:${process.pid}`;

export type JobRunStatus =
  | 'succeeded'
  | 'failed'
  | 'timeout'
  | 'started'
  | 'skipped:not_due'
  | 'skipped:running'
  | 'skipped:claimed_elsewhere'
  | 'skipped:unknown_job';

// ---------------------------------------------------------------------------
// Buckets (pure)
// ---------------------------------------------------------------------------

function parseHHMM(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/** The bucket this job is due for at `now`, or null when it is not due yet today (daily jobs). */
export function bucketForJob(job: Pick<ScheduledJob, 'intervalMinutes' | 'dailyAtUtc'>, now: Date = new Date()): string | null {
  if (job.dailyAtUtc) {
    const t = parseHHMM(job.dailyAtUtc);
    if (!t) return null;
    const dueAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), t.h, t.m, 0, 0);
    if (now.getTime() < dueAt) return null;
    return now.toISOString().slice(0, 10);
  }
  const interval = Math.max(1, Math.floor(job.intervalMinutes || 0));
  if (!job.intervalMinutes) return null;
  const ms = interval * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms).toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/** Atomic claim of (job, bucket). Returns the run id, or null when not due / claimed elsewhere. */
export async function claimJobRun(job: ScheduledJob, bucket: string): Promise<{ id: string; attempt: number } | null> {
  const maxAttempts = Math.max(1, job.maxAttemptsPerBucket ?? DEFAULT_MAX_ATTEMPTS);
  const rows = await prisma.$queryRaw<Array<{ id: string; attempt: number }>>`
    INSERT INTO "JobRun" ("id", "jobName", "bucket", "status", "attempt", "owner", "startedAt", "heartbeatAt")
    VALUES (${crypto.randomUUID()}, ${job.name}, ${bucket}, 'running', 1, ${OWNER}, now(), now())
    ON CONFLICT ("jobName", "bucket") DO UPDATE SET
      "status" = 'running',
      "attempt" = "JobRun"."attempt" + 1,
      "owner" = EXCLUDED."owner",
      "startedAt" = now(),
      "heartbeatAt" = now(),
      "finishedAt" = NULL,
      "error" = NULL
    WHERE ("JobRun"."status" = 'failed' AND "JobRun"."attempt" < ${maxAttempts})
       OR ("JobRun"."status" = 'running' AND "JobRun"."heartbeatAt" < now() - interval '2 minutes')
    RETURNING "id", "attempt"`;
  return rows[0] ? { id: rows[0].id, attempt: Number(rows[0].attempt) } : null;
}

async function finishJobRun(id: string, status: 'succeeded' | 'failed', result: unknown, error: string | null) {
  let json: any = null;
  try {
    json = result === undefined || result === null ? null : JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  } catch {
    json = null;
  }
  await prisma.jobRun.update({
    where: { id },
    data: { status, finishedAt: new Date(), heartbeatAt: new Date(), result: json ?? undefined, error: error ? error.slice(0, 1000) : null },
  });
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

type SchedulerRunState = {
  /** jobName -> settles only when the job BODY settles (not at its timeout). */
  runningJobs: Map<string, Promise<void>>;
  /** jobName -> bucket that needs no more claim attempts in this process for a while. */
  memo: Map<string, { bucket: string; until: number }>;
  shuttingDown: boolean;
  shutdownController: AbortController;
};

// One registry per process, shared by the instrumentation bundle (scheduler
// tick) and the API-route bundle (/api/cron/run-job) — see lib/processState.ts.
const R = processState<SchedulerRunState>('scheduler.runs', () => ({
  runningJobs: new Map(),
  memo: new Map(),
  shuttingDown: false,
  shutdownController: new AbortController(),
}));

export function isJobRunning(name: string): boolean {
  return R.runningJobs.has(name);
}

export function abortAllJobs() {
  R.shuttingDown = true;
  R.shutdownController.abort();
}

class JobTimeoutError extends Error {
  constructor(ms: number) {
    super(`job timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'JobTimeoutError';
  }
}

/**
 * Runs a claimed job. `status` settles at completion OR at the timeout (the
 * JobRun row is then marked failed); `body` settles only when job.run itself
 * does, which may be later when the job ignores its abort signal.
 */
function executeClaimed(job: ScheduledJob, bucket: string, runId: string): { status: Promise<JobRunStatus>; body: Promise<void> } {
  const timeoutMs = job.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const shutdownSignal = R.shutdownController.signal;
  const onShutdown = () => controller.abort();
  shutdownSignal.addEventListener('abort', onShutdown, { once: true });
  // Heartbeat while the body runs (even past a timeout); a no-op once the row is no longer 'running'.
  const heartbeat = setInterval(() => {
    prisma.jobRun.updateMany({ where: { id: runId, status: 'running' }, data: { heartbeatAt: new Date() } }).catch(() => undefined);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  const startedAt = Date.now();

  let bodyPromise: Promise<unknown>;
  try {
    bodyPromise = Promise.resolve(job.run({ bucket, signal: controller.signal }));
  } catch (err) {
    bodyPromise = Promise.reject(err);
  }
  const body = bodyPromise.then(() => undefined, () => undefined).finally(() => {
    clearInterval(heartbeat);
    shutdownSignal.removeEventListener('abort', onShutdown);
  });

  const status = (async (): Promise<JobRunStatus> => {
    let timer: NodeJS.Timeout | null = null;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new JobTimeoutError(timeoutMs));
        }, timeoutMs);
        timer.unref?.();
      });
      const result = await Promise.race([bodyPromise, timeout]);
      await finishJobRun(runId, 'succeeded', result ?? null, null);
      return 'succeeded';
    } catch (err: any) {
      const timedOut = err instanceof JobTimeoutError;
      const message = String(err?.message || err);
      await finishJobRun(runId, 'failed', null, message).catch(() => undefined);
      logCronEvent(timedOut ? 'warn' : 'error', {
        message: `Scheduled job "${job.name}" ${timedOut ? 'timed out' : 'failed'}`,
        operation: 'scheduler.job_failed',
        details: { jobName: job.name, bucket, durationMs: Date.now() - startedAt, error: message.slice(0, 300) },
      });
      return timedOut ? 'timeout' : 'failed';
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  return { status, body };
}

/**
 * Claims and starts one job if due. Returns the run promise (or a skip status).
 * The returned promise settles at completion or timeout, but the job stays
 * "running" in this process until its BODY settles, even past its timeout, so
 * it never overlaps itself (a job that ignores its abort signal is not started
 * again until it actually returns).
 */
export async function startJobIfDue(job: ScheduledJob, now: Date = new Date()): Promise<{ status: JobRunStatus; promise?: Promise<JobRunStatus> }> {
  if (R.shuttingDown) return { status: 'skipped:not_due' };
  if (R.runningJobs.has(job.name)) return { status: 'skipped:running' };
  const bucket = bucketForJob(job, now);
  if (!bucket) return { status: 'skipped:not_due' };
  const m = R.memo.get(job.name);
  if (m && m.bucket === bucket && m.until > now.getTime()) return { status: 'skipped:not_due' };

  // Reserve the name before the async claim so two concurrent ticks (scheduler
  // + run-job endpoint) in this process cannot both claim and start it.
  let releaseReservation!: () => void;
  const reservation = new Promise<void>((resolve) => { releaseReservation = resolve; });
  R.runningJobs.set(job.name, reservation);
  let claim: { id: string; attempt: number } | null;
  try {
    claim = await claimJobRun(job, bucket);
  } catch (err) {
    if (R.runningJobs.get(job.name) === reservation) R.runningJobs.delete(job.name);
    releaseReservation();
    throw err;
  }
  if (!claim) {
    if (R.runningJobs.get(job.name) === reservation) R.runningJobs.delete(job.name);
    releaseReservation();
    // Succeeded, exhausted, or running elsewhere: re-check this bucket in a minute
    // (a crashed owner's heartbeat goes stale after 2 minutes).
    R.memo.set(job.name, { bucket, until: now.getTime() + 60_000 });
    return { status: 'skipped:claimed_elsewhere' };
  }
  const { status, body } = executeClaimed(job, bucket, claim.id);
  const held = body.finally(() => {
    if (R.runningJobs.get(job.name) === held) R.runningJobs.delete(job.name);
  });
  R.runningJobs.set(job.name, held);
  releaseReservation();
  status.then((st) => {
    // Succeeded: done for this bucket. Failed: retry (up to maxAttemptsPerBucket) after a minute.
    R.memo.set(job.name, { bucket, until: st === 'succeeded' ? Number.MAX_SAFE_INTEGER : Date.now() + 60_000 });
  }).catch(() => undefined);
  return { status: 'started', promise: status };
}

async function loadJobs(): Promise<ScheduledJob[]> {
  const { allJobs } = await import('./jobs');
  return allJobs;
}

/**
 * Runs every due job (or only the named ones). With wait (default), waits for
 * the started jobs and reports their final status.
 */
export async function runDueJobs(opts: { only?: string[]; wait?: boolean } = {}): Promise<Array<{ job: string; status: string }>> {
  const jobs = await loadJobs();
  const wanted = opts.only?.length ? new Set(opts.only) : null;
  const out: Array<{ job: string; status: string }> = [];
  const waits: Array<Promise<void>> = [];
  if (wanted) {
    for (const name of wanted) if (!jobs.some((j) => j.name === name)) out.push({ job: name, status: 'skipped:unknown_job' });
  }
  for (const job of jobs) {
    if (wanted && !wanted.has(job.name)) continue;
    try {
      const res = await startJobIfDue(job);
      const entry = { job: job.name, status: res.status as string };
      out.push(entry);
      if (res.promise && opts.wait !== false) {
        waits.push(res.promise.then((s) => { entry.status = s; }));
      }
    } catch (err: any) {
      out.push({ job: job.name, status: `error:${String(err?.message || err).slice(0, 120)}` });
    }
  }
  await Promise.allSettled(waits);
  return out;
}

export async function getLastSuccessfulRun(jobName: string): Promise<Date | null> {
  const row = await prisma.jobRun.findFirst({
    where: { jobName, status: 'succeeded' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  return row?.finishedAt ?? null;
}

/** Status of every registered job for the admin cockpit. */
export async function getJobStatuses(): Promise<Array<{
  name: string;
  schedule: string;
  lastSuccessAt: string | null;
  runningSince: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  inProcess: boolean;
}>> {
  const jobs = await loadJobs().catch(() => [] as ScheduledJob[]);
  const since = new Date(Date.now() - 3 * 24 * 60 * 60_000);
  const rows = await prisma.jobRun.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: 'desc' },
    select: { jobName: true, status: true, startedAt: true, finishedAt: true, heartbeatAt: true, error: true },
    take: 2_000,
  });
  const names = new Set<string>([...jobs.map((j) => j.name), ...rows.map((r) => r.jobName)]);
  return Array.from(names).sort().map((name) => {
    const job = jobs.find((j) => j.name === name);
    const mine = rows.filter((r) => r.jobName === name);
    const ok = mine.find((r) => r.status === 'succeeded');
    const fail = mine.find((r) => r.status === 'failed');
    const run = mine.find((r) => r.status === 'running' && Date.now() - r.heartbeatAt.getTime() < STALE_RUNNING_MS);
    return {
      name,
      schedule: job?.dailyAtUtc ? `daily ${job.dailyAtUtc} UTC` : job?.intervalMinutes ? `every ${job.intervalMinutes} min` : 'unregistered',
      lastSuccessAt: ok?.finishedAt?.toISOString() ?? null,
      runningSince: run?.startedAt.toISOString() ?? null,
      lastFailureAt: fail ? (fail.finishedAt ?? fail.startedAt).toISOString() : null,
      lastError: fail?.error ? fail.error.slice(0, 200) : null,
      inProcess: R.runningJobs.has(name),
    };
  });
}

/** Test hook. */
export function __resetSchedulerState() {
  R.runningJobs.clear();
  R.memo.clear();
  R.shuttingDown = false;
  R.shutdownController = new AbortController();
}
