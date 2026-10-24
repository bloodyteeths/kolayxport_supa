// Every pair of order filters combines: choosing one never resets another (labels page bug, 24 Oct 2026).
import { describe, expect, it } from 'vitest';
import { parseUrlState } from '@/lib/ds/useUrlState';
import { ORDERS_URL_SCHEMA, applyViewPatch, fromFilterValues, toFilterValues, toOrdersQuery, type OrdersUrlState } from '@/components/domain/orders/ordersFilters';

const NOW = new Date('2026-10-24T12:00:00Z');
const state = (q: Record<string, string | string[]> = {}): OrdersUrlState => parseUrlState(ORDERS_URL_SCHEMA, q);
const apply = (s: OrdersUrlState, patch: Partial<OrdersUrlState>): OrdersUrlState => ({ ...s, ...patch });

type Step = { name: string; run: (s: OrdersUrlState) => OrdersUrlState; check: (q: ReturnType<typeof toOrdersQuery>, s: OrdersUrlState) => void };
const setFilter = (s: OrdersUrlState, change: Record<string, unknown>) => apply(s, fromFilterValues({ ...toFilterValues(s, NOW), ...change }, s, NOW));
const steps: Step[] = [
  { name: 'shop', run: (s) => setFilter(s, { store: ['Etsy'] }), check: (q) => expect(q.store).toEqual(['Etsy']) },
  { name: 'status', run: (s) => setFilter(s, { status: ['label_failed'] }), check: (q) => expect(q.status).toEqual(['label_failed']) },
  { name: 'date', run: (s) => setFilter(s, { date: { preset: 'last7' } }), check: (q) => expect(q.from).toBeTruthy() },
  { name: 'view unshipped', run: (s) => apply(s, applyViewPatch('to_ship', [])), check: (q) => expect(q.view).toBe('to_ship') },
  { name: 'view shipped', run: (s) => apply(s, applyViewPatch('shipped', [])), check: (q) => expect(q.view).toBe('shipped') },
];

describe('order filters combine in every pair and order', () => {
  for (const a of steps) {
    for (const b of steps) {
      if (a === b || (a.name.startsWith('view') && b.name.startsWith('view'))) continue;
      it(`${a.name} then ${b.name}: both apply`, () => {
        const s = b.run(a.run(state({ view: 'all' })));
        const q = toOrdersQuery(s, NOW);
        a.check(q, s);
        b.check(q, s);
      });
    }
  }
  it("Atilla's case: shop, then the unshipped view: still that shop only", () => {
    const s = apply(setFilter(state({ view: 'all' }), { store: ['Etsy:MyShop'] }), applyViewPatch('to_ship', []));
    expect(toOrdersQuery(s, NOW)).toMatchObject({ view: 'to_ship', store: ['Etsy:MyShop'] });
  });
});
