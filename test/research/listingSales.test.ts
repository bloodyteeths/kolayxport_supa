import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { displayRevenue, marketTotals, type ListingSales } from '@/lib/research/hooks/useListingSales';
import { parseIds } from '@/pages/api/research/sales';
import type { TopListing } from '@/lib/research/types';

const row = (id: string, price: number, currency: string, converted?: { amount: number; currency: string }): TopListing => ({
  id, title: id, url: null, thumbUrl: null, price: { amount: price, currency }, priceConverted: converted ?? null,
  favorites: 1, ageDays: 10, shop: { id: null, name: null, url: null }, tags: [],
});
const sale = (kind: ListingSales['kind'], monthlySales: number | null, monthlyRevenue: number | null, currency = 'USD'): ListingSales => ({
  kind, confidence: 'medium', monthlySales, monthlySalesUpperBound: null, monthlyRevenue, currency,
});

describe('parseIds', () => {
  it('keeps numeric Etsy ids, dedupes, caps at 48', () => {
    expect(parseIds('123456, 123456,abc,99')).toEqual(['123456']);
    const many = Array.from({ length: 60 }, (_, i) => String(100000 + i)).join(',');
    expect(parseIds(many)).toHaveLength(48);
  });
});

describe('displayRevenue', () => {
  it('converts revenue with the same rate as the converted price', () => {
    // £51.08 shown as $68.00 → £510 revenue shows as $679 (rounded).
    expect(displayRevenue(row('1', 51.08, 'GBP', { amount: 68, currency: 'USD' }), sale('estimated', 10, 510.8, 'GBP'))).toEqual({ amount: 680, currency: 'USD' });
    expect(displayRevenue(row('2', 45, 'USD'), sale('measured', 3, 135))).toEqual({ amount: 135, currency: 'USD' });
    expect(displayRevenue(row('3', 45, 'USD'), sale('insufficient', null, null))).toBeNull();
  });
});

describe('marketTotals', () => {
  it('sums only measured/estimated listings and counts measured ones', () => {
    const rows = [row('1', 45, 'USD'), row('2', 100, 'USD'), row('3', 20, 'USD')];
    const t = marketTotals(rows, { 1: sale('measured', 10, 450), 2: sale('estimated', 2, 200), 3: sale('insufficient', null, null) });
    expect(t).toEqual({ counted: 2, monthlySales: 12, revenue: 650, currency: 'USD', measured: 1 });
  });

  it('no single revenue total when currencies differ (never adds MAD to USD)', () => {
    const rows = [row('1', 45, 'USD'), row('2', 1500, 'MAD')];
    const t = marketTotals(rows, { 1: sale('estimated', 5, 225), 2: sale('estimated', 1, 1500, 'MAD') });
    expect(t.monthlySales).toBe(6);
    expect(t.revenue).toBeNull();
    expect(t.currency).toBeNull();
  });
});
