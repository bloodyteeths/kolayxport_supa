import { describe, it, expect } from 'vitest';
import { trendyolOrderDateIso } from '@/lib/mappers/trendyol';

describe('trendyolOrderDateIso', () => {
  it('reads Trendyol orderDate as Turkey local time (GMT+3)', () => {
    // Placed 22:32 in Istanbul = 19:32 UTC; Trendyol sends the epoch of 22:32 UTC.
    expect(trendyolOrderDateIso(Date.UTC(2026, 9, 17, 22, 32))).toBe('2026-10-17T19:32:00.000Z');
  });
  it('accepts a numeric string', () => {
    expect(trendyolOrderDateIso(String(Date.UTC(2026, 0, 1, 2, 0)))).toBe('2025-12-31T23:00:00.000Z');
  });
  it('returns undefined for missing or invalid values', () => {
    for (const v of [undefined, null, 0, '', 'abc', -5]) expect(trendyolOrderDateIso(v)).toBeUndefined();
  });
});
