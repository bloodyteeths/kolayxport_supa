import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRaw = vi.fn(async (..._a: any[]) => [] as any[]);
const jobRunUpdate = vi.fn(async (_a: any) => ({}));
const jobRunUpdateMany = vi.fn(async (_a: any) => ({ count: 1 }));

vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRaw: (...a: any[]) => queryRaw(...a),
    jobRun: {
      update: (a: any) => jobRunUpdate(a),
      updateMany: (a: any) => jobRunUpdateMany(a),
      findFirst: async () => null,
      findMany: async () => [],
    },
  },
}));

import { __resetSchedulerState, bucketForJob, isJobRunning, startJobIfDue } from '@/lib/scheduler/runs';
import { decideInProcessJobs } from '@/lib/scheduler';

beforeEach(() => {
  __resetSchedulerState();
  queryRaw.mockReset();
  jobRunUpdate.mockReset();
  jobRunUpdate.mockResolvedValue({});
});

describe('bucketForJob', () => {
  const now = new Date('2026-10-15T09:17:42Z');
  it('interval jobs bucket on the interval boundary', () => {
    expect(bucketForJob({ intervalMinutes: 15 }, now)).toBe('2026-10-15T09:15');
    expect(bucketForJob({ intervalMinutes: 1 }, now)).toBe('2026-10-15T09:17');
  });
  it('daily jobs are due from HH:MM UTC and catch up later the same day', () => {
    expect(bucketForJob({ dailyAtUtc: '09:30' }, now)).toBeNull();
    expect(bucketForJob({ dailyAtUtc: '03:10' }, now)).toBe('2026-10-15');
    expect(bucketForJob({ dailyAtUtc: '03:10' }, new Date('2026-10-15T23:59:00Z'))).toBe('2026-10-15');
  });
  it('invalid schedules are never due', () => {
    expect(bucketForJob({ dailyAtUtc: '25:00' }, now)).toBeNull();
    expect(bucketForJob({}, now)).toBeNull();
  });
});

describe('startJobIfDue', () => {
  it('runs a claimed job once and records success', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'run1', attempt: 1 }]);
    const run = vi.fn(async () => ({ n: 1 }));
    const job = { name: 'j1', intervalMinutes: 5, run };
    const r = await startJobIfDue(job, new Date('2026-10-15T09:17:00Z'));
    expect(r.status).toBe('started');
    expect(await r.promise).toBe('succeeded');
    expect(run).toHaveBeenCalledTimes(1);
    expect(jobRunUpdate.mock.calls[0][0]).toMatchObject({ where: { id: 'run1' }, data: { status: 'succeeded' } });
    // Same bucket again: memo says done, no DB claim.
    const again = await startJobIfDue(job, new Date('2026-10-15T09:18:00Z'));
    expect(again.status).toBe('skipped:not_due');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not run when the claim is refused (claimed elsewhere / succeeded)', async () => {
    queryRaw.mockResolvedValueOnce([]);
    const run = vi.fn();
    const r = await startJobIfDue({ name: 'j2', intervalMinutes: 5, run }, new Date());
    expect(r.status).toBe('skipped:claimed_elsewhere');
    expect(run).not.toHaveBeenCalled();
  });

  it('never overlaps the same job in-process', async () => {
    queryRaw.mockResolvedValue([{ id: 'run2', attempt: 1 }]);
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const job = { name: 'j3', intervalMinutes: 1, run };
    const first = await startJobIfDue(job, new Date('2026-10-15T09:00:00Z'));
    const second = await startJobIfDue(job, new Date('2026-10-15T09:01:00Z'));
    expect(second.status).toBe('skipped:running');
    release();
    expect(await first.promise).toBe('succeeded');
  });

  it('a job that ignores its abort signal stays running past its timeout and is not started again', async () => {
    queryRaw.mockResolvedValue([{ id: 'run9', attempt: 1 }]);
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve; })); // ignores ctx.signal
    const job = { name: 'stubborn', intervalMinutes: 1, timeoutMs: 20, run };
    const first = await startJobIfDue(job, new Date('2026-10-15T09:00:00Z'));
    expect(await first.promise).toBe('timeout');
    expect(jobRunUpdate.mock.calls[0][0].data).toMatchObject({ status: 'failed' });
    // Next bucket (and the memo window) — the body is still running: no second start.
    const second = await startJobIfDue(job, new Date('2026-10-15T09:05:00Z'));
    expect(second.status).toBe('skipped:running');
    expect(run).toHaveBeenCalledTimes(1);
    expect(isJobRunning('stubborn')).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(isJobRunning('stubborn')).toBe(false);
    const third = await startJobIfDue(job, new Date('2026-10-15T09:06:00Z'));
    expect(third.status).toBe('started');
    release();
    await third.promise;
  });

  it('running-job registry is shared between separately loaded copies of the module', async () => {
    queryRaw.mockResolvedValue([{ id: 'run10', attempt: 1 }]);
    let release!: () => void;
    const job = { name: 'shared-job', intervalMinutes: 1, run: () => new Promise<void>((resolve) => { release = resolve; }) };
    const first = await startJobIfDue(job, new Date('2026-10-15T09:00:00Z'));
    vi.resetModules();
    const copy = await import('@/lib/scheduler/runs');
    expect(copy.isJobRunning('shared-job')).toBe(true);
    expect((await copy.startJobIfDue(job, new Date('2026-10-15T09:01:00Z'))).status).toBe('skipped:running');
    release();
    await first.promise;
  });

  it('records a failure with the error', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'run3', attempt: 1 }]);
    const r = await startJobIfDue({ name: 'j4', intervalMinutes: 5, run: async () => { throw new Error('kaput'); } }, new Date());
    expect(await r.promise).toBe('failed');
    expect(jobRunUpdate.mock.calls[0][0].data).toMatchObject({ status: 'failed', error: 'kaput' });
  });

  it('claim SQL only re-claims failed-under-max or stale running rows', async () => {
    queryRaw.mockResolvedValueOnce([]);
    await startJobIfDue({ name: 'j5', intervalMinutes: 5, maxAttemptsPerBucket: 3, run: async () => undefined }, new Date());
    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/ON CONFLICT \("jobName", "bucket"\) DO UPDATE/);
    expect(sql).toMatch(/"JobRun"\."status" = 'failed' AND "JobRun"\."attempt" < \?/);
    expect(sql).toMatch(/"JobRun"\."status" = 'running' AND "JobRun"\."heartbeatAt" < now\(\) - interval '2 minutes'/);
  });
});

describe('decideInProcessJobs', () => {
  it('on by default in production', () => {
    expect(decideInProcessJobs({ NODE_ENV: 'production', NEXT_RUNTIME: 'nodejs' })).toMatchObject({ scheduler: true, worker: true });
  });
  it('never during next build', () => {
    expect(decideInProcessJobs({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }).scheduler).toBe(false);
  });
  it('kill switch', () => {
    expect(decideInProcessJobs({ NODE_ENV: 'production', KX_DISABLE_INPROCESS_JOBS: '1' }).scheduler).toBe(false);
  });
  it('off in dev unless forced', () => {
    expect(decideInProcessJobs({ NODE_ENV: 'development' }).scheduler).toBe(false);
    expect(decideInProcessJobs({ NODE_ENV: 'development', KX_INPROCESS_JOBS: '1' }).scheduler).toBe(true);
  });
  it('ETSY_WEBHOOK_WORKER=0 turns only the worker loop off', () => {
    expect(decideInProcessJobs({ NODE_ENV: 'production', ETSY_WEBHOOK_WORKER: '0' })).toMatchObject({ scheduler: true, worker: false });
  });
  it('never in the edge runtime', () => {
    expect(decideInProcessJobs({ NODE_ENV: 'production', NEXT_RUNTIME: 'edge' }).scheduler).toBe(false);
  });
});
