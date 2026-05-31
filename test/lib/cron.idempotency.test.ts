import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/lib/prisma', () => {
  const cronLock = {
    storage: new Map<string, true>(),
    async create({ data }: { data: { jobName: string; bucket: string } }) {
      const key = `${data.jobName}::${data.bucket}`;
      if (cronLock.storage.has(key)) {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      cronLock.storage.set(key, true);
      return { id: 'mock', ...data, createdAt: new Date() };
    },
    _reset() {
      cronLock.storage.clear();
    },
  };
  return { default: { cronLock } };
});

import prisma from '@/lib/prisma';
import {
  verifyCronAuth,
  bucketFor,
  tryAcquireCronLock,
  runCronGuard,
} from '@/lib/cron/idempotency';

const CRON_SECRET = 'super-secret-cron-bearer-value-aaaa';

function makeReq(authorization?: string): NextApiRequest {
  return {
    headers: authorization ? { authorization } : {},
    query: {},
    body: {},
    method: 'GET',
    url: '/test',
  } as unknown as NextApiRequest;
}

function makeRes() {
  const state = { status: 0, body: null as any, ended: false };
  const res = {
    setHeader: vi.fn(),
    status: vi.fn((code: number) => {
      state.status = code;
      return res;
    }),
    json: vi.fn((body: any) => {
      state.body = body;
      state.ended = true;
      return res;
    }),
    end: vi.fn(() => {
      state.ended = true;
      return res;
    }),
    state,
  };
  return res as any;
}

beforeAll(() => {
  process.env.CRON_SECRET = CRON_SECRET;
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe('verifyCronAuth — timing-safe', () => {
  it('accepts the correct Bearer header', () => {
    expect(verifyCronAuth(makeReq(`Bearer ${CRON_SECRET}`))).toBe(true);
  });

  it('rejects a missing header', () => {
    expect(verifyCronAuth(makeReq())).toBe(false);
  });

  it('rejects a non-Bearer header', () => {
    expect(verifyCronAuth(makeReq(CRON_SECRET))).toBe(false);
  });

  it('rejects a same-length wrong key (must not throw)', () => {
    const wrong = 'Bearer ' + 'x'.repeat(CRON_SECRET.length);
    expect(verifyCronAuth(makeReq(wrong))).toBe(false);
  });

  it('rejects a different-length header', () => {
    expect(verifyCronAuth(makeReq('Bearer short'))).toBe(false);
    expect(verifyCronAuth(makeReq(`Bearer ${CRON_SECRET}EXTRA`))).toBe(false);
  });

  it('rejects when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronAuth(makeReq(`Bearer ${CRON_SECRET}`))).toBe(false);
    process.env.CRON_SECRET = CRON_SECRET;
  });
});

describe('bucketFor', () => {
  it('quantizes a 15-minute bucket to the floor of the quarter-hour (UTC)', () => {
    const t = new Date('2026-05-31T12:07:31.123Z');
    expect(bucketFor(15, t)).toBe('2026-05-31T12:00');
    const t2 = new Date('2026-05-31T12:14:59.999Z');
    expect(bucketFor(15, t2)).toBe('2026-05-31T12:00');
    const t3 = new Date('2026-05-31T12:15:00.000Z');
    expect(bucketFor(15, t3)).toBe('2026-05-31T12:15');
  });

  it('quantizes a 60-minute bucket to the hour (UTC)', () => {
    const t = new Date('2026-05-31T12:34:00Z');
    expect(bucketFor(60, t)).toBe('2026-05-31T12');
  });

  it('quantizes a 1440-minute bucket to the day (UTC)', () => {
    const t = new Date('2026-05-31T23:59:59Z');
    expect(bucketFor(1440, t)).toBe('2026-05-31');
  });

  it('rejects non-positive intervals', () => {
    expect(() => bucketFor(0)).toThrow();
    expect(() => bucketFor(-15)).toThrow();
  });
});

describe('tryAcquireCronLock', () => {
  beforeAll(() => {
    (prisma as any).cronLock._reset();
  });

  it('first acquire succeeds', async () => {
    expect(await tryAcquireCronLock('sync-orders', '2026-05-31T12:00')).toBe(true);
  });

  it('second acquire on same bucket returns false (duplicate)', async () => {
    expect(await tryAcquireCronLock('sync-orders', '2026-05-31T12:00')).toBe(false);
  });

  it('different bucket succeeds', async () => {
    expect(await tryAcquireCronLock('sync-orders', '2026-05-31T12:15')).toBe(true);
  });

  it('different job, same bucket succeeds', async () => {
    expect(await tryAcquireCronLock('reset-usage', '2026-05-31T12:00')).toBe(true);
  });
});

describe('runCronGuard — combined auth + idempotency', () => {
  beforeAll(() => {
    (prisma as any).cronLock._reset();
  });

  it('writes 401 on bad auth and returns ok=false', async () => {
    const req = makeReq('Bearer wrong-key');
    const res = makeRes();
    const result = await runCronGuard(req, res, { jobName: 'sync-orders', intervalMinutes: 15 });
    expect(result.ok).toBe(false);
    expect(res.state.status).toBe(401);
  });

  it('first run with good auth acquires the lock and returns ok=true', async () => {
    const req = makeReq(`Bearer ${CRON_SECRET}`);
    const res = makeRes();
    const result = await runCronGuard(req, res, {
      jobName: 'sync-orders-runner',
      intervalMinutes: 1440,
    });
    expect(result.ok).toBe(true);
  });

  it('second run with good auth in same bucket returns 200 skipped', async () => {
    const req = makeReq(`Bearer ${CRON_SECRET}`);
    const res = makeRes();
    const result = await runCronGuard(req, res, {
      jobName: 'sync-orders-runner',
      intervalMinutes: 1440,
    });
    expect(result.ok).toBe(false);
    expect(res.state.status).toBe(200);
    expect(res.state.body).toMatchObject({ skipped: true, reason: 'duplicate' });
  });
});
