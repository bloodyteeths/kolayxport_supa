import { describe, it, expect } from 'vitest';
import { isNavCountsStale, NAV_COUNTS_STALE_MS, NAV_COUNTS_KEY, NAV_COUNTS_LIVE_EVENTS } from '@/lib/nav/useNavCounts';

describe('useNavCounts helpers', () => {
  it('hides data older than 10 minutes, keeps fresh and just-received data', () => {
    const now = 1_000_000_000;
    expect(isNavCountsStale(null, now)).toBe(true);
    expect(isNavCountsStale(now - NAV_COUNTS_STALE_MS - 1, now)).toBe(true);
    expect(isNavCountsStale(now - NAV_COUNTS_STALE_MS, now)).toBe(false);
    expect(isNavCountsStale(now + 5_000, now)).toBe(false); // clock tick lags the response
    expect(isNavCountsStale(Number.NaN, now)).toBe(true);
  });

  it('polls the counts endpoint and listens to order, shipment and draft events', () => {
    expect(NAV_COUNTS_KEY).toBe('/api/nav/counts');
    expect([...NAV_COUNTS_LIVE_EVENTS]).toEqual(['order', 'shipment', 'draft']);
  });
});
