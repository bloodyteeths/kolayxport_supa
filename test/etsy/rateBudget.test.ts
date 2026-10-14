import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real logger persists warnings via Prisma (would try to reach a DB).
vi.mock('@/lib/logger', () => ({ logger: { info() {}, warn() {}, error() {}, debug() {} } }));
import {
  EtsyPriority,
  DAILY_GATES,
  P0_RETRY_MS,
  __resetEtsyBudget,
  canSpend,
  currentEtsyPriority,
  evaluateDailyGate,
  getBudgetSnapshot,
  msUntilNextDayWindow,
  parseQuotaHeaders,
  perShopCap,
  recordEtsyCall,
  recordEtsyResponse,
  withEtsyBudget,
  getEtsyBudgetContext,
  mergeEtsyPriority,
} from '@/lib/etsy/rateBudget';
import { etsyFetch, EtsyWriteTimeoutError, resolveEtsyFetchOptions } from '@/lib/etsy/http';
import { isEtsyDeferError } from '@/lib/etsy/webhooks/types';

function quotaResponse(limit: number, remaining: number, status = 200, extra: Record<string, string> = {}) {
  return new Response('{}', {
    status,
    headers: { 'x-limit-per-day': String(limit), 'x-remaining-today': String(remaining), ...extra },
  });
}

beforeEach(() => {
  __resetEtsyBudget();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('evaluateDailyGate (pure)', () => {
  const base = { shopBackgroundCalls: 0, shopCap: 1000, nowMs: Date.UTC(2026, 9, 15, 12, 0, 0) };

  it('applies the per-priority thresholds', () => {
    expect(DAILY_GATES[EtsyPriority.Critical]).toBe(0.98);
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Reconcile, usedFraction: 0.69 }).ok).toBe(true);
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Reconcile, usedFraction: 0.7 }).ok).toBe(false);
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Webhook, usedFraction: 0.84 }).ok).toBe(true);
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Webhook, usedFraction: 0.85 }).ok).toBe(false);
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Interactive, usedFraction: 0.89 }).ok).toBe(true);
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Interactive, usedFraction: 0.9 }).ok).toBe(false);
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Critical, usedFraction: 0.97 }).ok).toBe(true);
  });

  it('never defers P0 to the next day: p0_retry in 5 minutes', () => {
    const r = evaluateDailyGate({ ...base, priority: EtsyPriority.Critical, usedFraction: 0.995 });
    expect(r).toEqual({ ok: false, retryAfterMs: P0_RETRY_MS, reason: 'p0_retry' });
  });

  it('defers P1/P2 to 00:05 UTC next day', () => {
    const r = evaluateDailyGate({ ...base, priority: EtsyPriority.Webhook, usedFraction: 0.9 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('budget');
      expect(r.retryAfterMs).toBe(msUntilNextDayWindow(base.nowMs));
      expect(new Date(base.nowMs + r.retryAfterMs).toISOString()).toBe('2026-10-16T00:05:00.000Z');
    }
  });

  it('caps P1+P2 per shop but never P0/P3', () => {
    const atCap = { ...base, usedFraction: 0.1, shopBackgroundCalls: 1000, shopCap: 1000 };
    expect(evaluateDailyGate({ ...atCap, priority: EtsyPriority.Webhook }).ok).toBe(false);
    expect(evaluateDailyGate({ ...atCap, priority: EtsyPriority.Reconcile }).ok).toBe(false);
    expect(evaluateDailyGate({ ...atCap, priority: EtsyPriority.Critical }).ok).toBe(true);
    expect(evaluateDailyGate({ ...atCap, priority: EtsyPriority.Interactive }).ok).toBe(true);
  });

  it('per-shop cap is clamp(floor(0.6*limit/shops), 300, 5000)', () => {
    expect(perShopCap(100_000, 1)).toBe(5000);
    expect(perShopCap(100_000, 30)).toBe(2000);
    expect(perShopCap(100_000, 1000)).toBe(300);
    expect(perShopCap(100_000, 0)).toBe(5000);
  });
});

describe('quota headers', () => {
  it('parses Etsy headers', () => {
    const q = parseQuotaHeaders(new Headers({ 'x-limit-per-day': '100000', 'x-remaining-today': '4000', 'x-remaining-this-second': '7' }));
    expect(q).toEqual({ limitPerDay: 100000, remainingToday: 4000, remainingThisSecond: 7 });
    expect(parseQuotaHeaders(new Headers())).toEqual({ limitPerDay: null, remainingToday: null, remainingThisSecond: null });
  });

  it('remote header usage is authoritative over local counts', () => {
    recordEtsyResponse(quotaResponse(100_000, 20_000), EtsyPriority.Interactive, 's1'); // 80% used
    expect(canSpend('s1', EtsyPriority.Reconcile).ok).toBe(false); // P2 < 70%
    expect(canSpend('s1', EtsyPriority.Interactive).ok).toBe(true); // P3 < 90%
    expect(canSpend('s1', EtsyPriority.Webhook).ok).toBe(true); // P1 < 85%
    expect(getBudgetSnapshot()).toMatchObject({ remoteLimit: 100_000, remoteRemaining: 20_000, remoteFresh: true, usedFraction: 0.8 });
  });

  it('falls back to local counters 5 minutes after the last header', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    recordEtsyResponse(quotaResponse(100_000, 1_000), EtsyPriority.Interactive, 's1'); // 99% used
    expect(canSpend('s1', EtsyPriority.Critical).ok).toBe(false);
    vi.setSystemTime(new Date('2026-10-15T12:05:01Z'));
    // Stale remote -> local counters (a handful of calls) drive the gate.
    recordEtsyCall('s1', EtsyPriority.Interactive);
    expect(getBudgetSnapshot().remoteFresh).toBe(false);
    expect(canSpend('s1', EtsyPriority.Critical).ok).toBe(true);
    expect(canSpend('s1', EtsyPriority.Reconcile).ok).toBe(true);
  });

  it('counts calls per priority and shop', () => {
    recordEtsyCall('s1', EtsyPriority.Webhook);
    recordEtsyCall('s1', EtsyPriority.Webhook);
    recordEtsyCall('s2', EtsyPriority.Critical);
    const snap = getBudgetSnapshot();
    expect(snap.localCalls).toBe(3);
    expect(snap.byPriority[EtsyPriority.Webhook]).toBe(2);
    expect(snap.topShops[0]).toEqual({ shopId: 's1', calls: 2 });
  });
});

describe('priority context', () => {
  it('defaults to Interactive and follows withEtsyBudget', async () => {
    expect(currentEtsyPriority()).toBe(EtsyPriority.Interactive);
    const inner = await withEtsyBudget({ priority: EtsyPriority.Critical, shopId: 's' }, async () => currentEtsyPriority());
    expect(inner).toBe(EtsyPriority.Critical);
    expect(currentEtsyPriority()).toBe(EtsyPriority.Interactive);
  });
});

describe('nested contexts (worker order events stay P0)', () => {
  it('a nested withEtsyBudget(Webhook) inside a Critical worker context inherits Critical + deferOn429', async () => {
    const ctx = await withEtsyBudget({ priority: EtsyPriority.Critical, deferOn429: true, shopId: 's', userId: 'u' }, () =>
      withEtsyBudget({ priority: EtsyPriority.Webhook, shopId: 's' }, async () => getEtsyBudgetContext()));
    expect(ctx).toMatchObject({ priority: EtsyPriority.Critical, deferOn429: true, shopId: 's', userId: 'u' });
  });

  it('an explicit lower priority on the fetch cannot downgrade a Critical context', async () => {
    const opts = await withEtsyBudget({ priority: EtsyPriority.Critical, deferOn429: true }, async () =>
      resolveEtsyFetchOptions({ priority: EtsyPriority.Webhook }));
    expect(opts.priority).toBe(EtsyPriority.Critical);
    expect(opts.deferOn429).toBe(true);
    // Outside a Critical chain the explicit priority still wins.
    const plain = await withEtsyBudget({ priority: EtsyPriority.Webhook }, async () =>
      resolveEtsyFetchOptions({ priority: EtsyPriority.Reconcile }));
    expect(plain.priority).toBe(EtsyPriority.Reconcile);
    expect(mergeEtsyPriority(undefined, undefined)).toBeUndefined();
  });

  it('an order fetch nested at Webhook inside the worker is NOT deferred to tomorrow by the per-shop cap; it defers on 429', async () => {
    // Exhaust the shop's P1+P2 cap (min 300).
    for (let i = 0; i < 400; i++) recordEtsyCall('s', EtsyPriority.Webhook);
    const fetchMock = vi.fn(async () => new Response('slow', { status: 429, headers: { 'retry-after': '7' } }));
    vi.stubGlobal('fetch', fetchMock);
    const err = await withEtsyBudget({ priority: EtsyPriority.Critical, deferOn429: true, shopId: 's' }, () =>
      withEtsyBudget({ priority: EtsyPriority.Webhook, shopId: 's' }, () =>
        etsyFetch('https://openapi.etsy.com/v3/application/shops/s/receipts/1', {}, { priority: EtsyPriority.Webhook }).then(() => null, (e) => e)));
    expect(fetchMock).toHaveBeenCalledTimes(1); // gate passed: P0 has no per-shop cap
    expect(isEtsyDeferError(err)).toBe(true);
    expect(err.retryAfterMs).toBe(7_000); // deferred, not slept/retried
  });
});

describe('process-wide state', () => {
  it('is shared between separately loaded copies of the module (API vs instrumentation bundles)', async () => {
    recordEtsyCall('shared-shop', EtsyPriority.Interactive);
    vi.resetModules();
    const copy = await import('@/lib/etsy/rateBudget');
    expect(copy.getBudgetSnapshot().topShops.find((s) => s.shopId === 'shared-shop')?.calls).toBe(1);
    const ctxSeenByCopy = await withEtsyBudget({ priority: EtsyPriority.Critical }, async () => copy.currentEtsyPriority());
    expect(ctxSeenByCopy).toBe(EtsyPriority.Critical);
  });
});

describe('etsyFetch', () => {
  it('in worker mode a 429 throws a defer immediately (no sleep, Retry-After honoured)', async () => {
    const fetchMock = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '42' } }));
    vi.stubGlobal('fetch', fetchMock);
    const started = Date.now();
    const err = await withEtsyBudget({ priority: EtsyPriority.Webhook, deferOn429: true, shopId: 's' }, () =>
      etsyFetch('https://openapi.etsy.com/v3/application/listings/1').then(() => null, (e) => e));
    expect(isEtsyDeferError(err)).toBe(true);
    expect(err.retryAfterMs).toBe(42_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('in worker mode a 5xx defers with the default 60 s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 503 })));
    const err = await etsyFetch('https://openapi.etsy.com/x', {}, { deferOn429: true }).then(() => null, (e) => e);
    expect(isEtsyDeferError(err)).toBe(true);
    expect(err.retryAfterMs).toBe(60_000);
  });

  it('outside the worker retries a 429 and records quota headers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(quotaResponse(100_000, 99_000));
    vi.stubGlobal('fetch', fetchMock);
    const res = await etsyFetch('https://openapi.etsy.com/x', {}, { retries: 1 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getBudgetSnapshot().remoteRemaining).toBe(99_000);
  });

  it('a timed-out write throws EtsyWriteTimeoutError and is not retried', async () => {
    const fetchMock = vi.fn(async () => {
      const e: any = new Error('timeout');
      e.name = 'TimeoutError';
      throw e;
    });
    vi.stubGlobal('fetch', fetchMock);
    const err = await etsyFetch('https://openapi.etsy.com/x', { method: 'PUT' }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(EtsyWriteTimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a P2 call when the daily gate is closed', async () => {
    recordEtsyResponse(quotaResponse(100_000, 10_000), EtsyPriority.Interactive, 's'); // 90% used
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const err = await etsyFetch('https://openapi.etsy.com/x', {}, { priority: EtsyPriority.Reconcile, shopId: 's' }).then(() => null, (e) => e);
    expect(isEtsyDeferError(err)).toBe(true);
    expect(err.reason).toBe('budget');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
