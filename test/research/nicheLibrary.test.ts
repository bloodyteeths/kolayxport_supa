import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { rankNiches, SEED_NICHES, totalsOf, type NicheSummary } from '@/lib/research/nicheLibrary';

const n = (q: string, over: Partial<NicheSummary> = {}): NicheSummary => ({ q, mkt: 'etsy', score: 60, band: 'ok', typicalPrice: 40, currency: 'USD', total: 9000, salesMonthly: 300, revenueMonthly: 12000, counted: 20, measured: 10, updatedAt: '', ...over });

describe('niche library', () => {
  it('seed list: unique, non-empty, sized for the daily Etsy budget', () => {
    expect(new Set(SEED_NICHES).size).toBe(SEED_NICHES.length);
    expect(SEED_NICHES.length).toBeGreaterThan(100);
    expect(SEED_NICHES.length).toBeLessThanOrEqual(150);
  });

  it('totals: only real monthly numbers, upper bounds not added', () => {
    const t = totalsOf({
      a: { sales: { kind: 'measured', monthlySales: 10, monthlyRevenue: 400 } },
      b: { sales: { kind: 'estimated', monthlySales: 4.4, monthlyRevenue: 100 } },
      c: { sales: { kind: 'estimated', monthlySales: null, monthlySalesUpperBound: 3 } },
      d: { sales: { kind: 'insufficient', monthlySales: null } },
    });
    expect(t).toEqual({ sales: 14, revenue: 500, counted: 2, measured: 1 });
  });

  it('home cards: scored niches with enough counted listings, best score first', () => {
    const out = rankNiches([n('a', { score: 50 }), n('b', { score: 80 }), n('c', { score: null }), n('d', { counted: 2 }), n('e', { salesMonthly: null })]);
    expect(out.map((x) => x.q)).toEqual(['b', 'a']);
  });
});
