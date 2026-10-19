import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { dailySeries, ratingGrowth, salesView } from '@/lib/market/sales';
import { poolRatio } from '@/lib/market/calibration';
import { priceChange } from '@/lib/market/read';

const at = (d: string) => new Date(`2026-10-${d}T12:00:00Z`);

describe('ratingGrowth (measured)', () => {
  it('needs two readings at least 3 days apart', () => {
    expect(ratingGrowth([{ at: at('01'), ratingCount: 100, price: 1 }])).toBeNull();
    expect(ratingGrowth([{ at: at('01'), ratingCount: 100, price: 1 }, { at: at('03'), ratingCount: 102, price: 1 }])).toBeNull();
  });
  it('popular products: ≥ 5 new ratings over ≥ 4 hours count', () => {
    const h = (x: number) => new Date(Date.UTC(2026, 9, 18, x));
    expect(ratingGrowth([{ at: h(10), ratingCount: 6633, price: 1 }, { at: h(12), ratingCount: 6640, price: 1 }])).toBeNull();
    expect(ratingGrowth([{ at: h(10), ratingCount: 6633, price: 1 }, { at: h(16), ratingCount: 6639, price: 1 }])).toEqual({ per30d: 720, spanDays: 0.3 });
  });
  it('per 30 days; a dropped rating never makes growth negative', () => {
    expect(ratingGrowth([{ at: at('01'), ratingCount: 100, price: 1 }, { at: at('11'), ratingCount: 110, price: 1 }])).toEqual({ per30d: 30, spanDays: 10 });
    expect(ratingGrowth([{ at: at('01'), ratingCount: 100, price: 1 }, { at: at('11'), ratingCount: 99, price: 1 }])!.per30d).toBe(0);
  });
});

describe('salesView', () => {
  const rs = [{ at: at('01'), ratingCount: 100, price: 500 }, { at: at('11'), ratingCount: 110, price: 500 }];
  it('without calibration: rating growth only, no invented sales', () => {
    const v = salesView(rs, { price: 500, ratingCount: 110, ordersAtLeast: 100, calibration: null });
    expect(v).toMatchObject({ ratingsPer30d: 30, salesPer30d: null, lifetimeSales: null, ordersAtLeast: 100, kind: 'measured' });
  });
  it('with calibration: estimate = growth × orders per rating', () => {
    const v = salesView(rs, { price: 500, ratingCount: 110, ordersAtLeast: null, calibration: { ordersPerRating: 12, n: 80, source: '1 store', computedAt: '' } });
    expect(v).toMatchObject({ salesPer30d: 360, revenuePer30d: 180000, salesPerDay: 12, revenuePerDay: 6000, lifetimeSales: 1320, kind: 'estimate' });
  });
  it('one reading: nothing measured yet', () => {
    expect(salesView(rs.slice(0, 1), { price: 500, ratingCount: 100, ordersAtLeast: null, calibration: null }).kind).toBe('none');
  });
});

describe('poolRatio (calibration)', () => {
  it('pools stores; needs 30 new ratings and a plausible ratio', () => {
    expect(poolRatio([{ orders: 300, newRatings: 20 }])).toBeNull();
    expect(poolRatio([{ orders: 300, newRatings: 20 }, { orders: 150, newRatings: 15 }])).toEqual({ ordersPerRating: 12.9, n: 35, stores: 2 });
    expect(poolRatio([{ orders: 40, newRatings: 40 }])).toBeNull(); // 1 order per rating: a linking problem
  });
});

describe('series and price change', () => {
  it('last reading per day; price change first → last', () => {
    const rs = [{ at: at('01'), ratingCount: 1, price: 100 }, { at: new Date('2026-10-01T20:00:00Z'), ratingCount: 2, price: 90 }, { at: at('05'), ratingCount: 3, price: 80 }];
    expect(dailySeries(rs).map((d) => [d.day, d.price])).toEqual([['2026-10-01', 90], ['2026-10-05', 80]]);
    expect(priceChange(rs)).toBe(-0.2);
  });
});
