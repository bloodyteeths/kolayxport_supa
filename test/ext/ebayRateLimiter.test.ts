// The shared eBay limiter: queued calls still run one after another; `concurrent` read-only
// calls overlap but keep the same paced start rate (one start per 140 ms). Fake timers, fake fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const LATENCY = 1000;
let starts: number[] = [];
let inFlight = 0;
let maxInFlight = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
  starts = [];
  inFlight = 0;
  maxInFlight = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    starts.push(Date.now());
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, LATENCY));
    inFlight--;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: 1 }), text: async () => '' };
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('callEbayRateLimited', () => {
  it('concurrent: 8 calls overlap, starts paced >= 140 ms apart, all done in ~2 s instead of ~8 s', async () => {
    vi.resetModules();
    const { callEbayRateLimited } = await import('@/lib/integrations/ebayRateLimiter');
    const t0 = Date.now();
    const all = Promise.all(Array.from({ length: 8 }, (_, i) => callEbayRateLimited(`https://api.ebay.com/x/${i}`, { token: 't', concurrent: true })));
    await vi.advanceTimersByTimeAsync(3000);
    await all;
    expect(starts).toHaveLength(8);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(140);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(Math.max(...starts) + LATENCY - t0).toBeLessThan(2200);
  });

  it('queued (default): one call at a time, as before', async () => {
    vi.resetModules();
    const { callEbayRateLimited } = await import('@/lib/integrations/ebayRateLimiter');
    const all = Promise.all(Array.from({ length: 3 }, (_, i) => callEbayRateLimited(`https://api.ebay.com/y/${i}`, { token: 't' })));
    await vi.advanceTimersByTimeAsync(4000);
    await all;
    expect(maxInFlight).toBe(1);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(LATENCY);
  });
});
