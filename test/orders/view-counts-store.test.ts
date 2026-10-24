import { describe, expect, it, vi } from 'vitest';

describe('view counts follow the shop filter', () => {
  it('adds the marketplace condition as a bound parameter and skips the cache', async () => {
    vi.resetModules();
    const calls: unknown[][] = [];
    vi.doMock('@/lib/prisma', () => ({ default: { $queryRawUnsafe: async (...a: unknown[]) => { calls.push(a); return [{ n: 3, fp: 'x' }]; } } }));
    const { loadViewCounts } = await import('@/pages/api/orders/index');
    const counts = await loadViewCounts('u1', Date.now(), ['Etsy:MyShop']);
    expect(counts).toEqual({ to_ship: 3, overdue: 3, label_created: 3, problems: 3 });
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(String(c[0])).toMatch(/o\."marketplace" = ANY\(\$2::text\[\]\)$/);
      expect(c.slice(1)).toEqual(['u1', ['Etsy:MyShop']]);
    }
  });
});
