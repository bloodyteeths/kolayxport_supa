import { describe, it, expect } from 'vitest';
import { migrateLegacyOrdersQuery, hasLegacyOrdersParams } from '@/lib/orders/legacyQuery';

describe('migrateLegacyOrdersQuery (orders §1.2)', () => {
  it.each([
    ['unlabeled', 'to_ship'],
    ['labeled', 'label_created'],
    ['failed', 'problems'],
    ['all', 'all'],
  ])('label=%s → view=%s', (label, view) => {
    expect(migrateLegacyOrdersQuery({ label })).toEqual({ query: { view }, changed: true });
  });

  it('mp → store, qt → in, highlight → open, statuses, sort, from=all', () => {
    const { query, changed } = migrateLegacyOrdersQuery({
      mp: ['Etsy', 'Trendyol'],
      qt: 'sku',
      q: 'BB-1',
      highlight: 'o1',
      status: 'onaylandi',
      sort: 'priceHigh',
      from: 'all',
      page: '2',
    });
    expect(changed).toBe(true);
    expect(query).toEqual({ store: ['Etsy', 'Trendyol'], in: 'sku', q: 'BB-1', open: 'o1', status: 'to_ship', sort: 'total', dir: 'desc', preset: 'any', page: '2' });
  });

  it.each([
    ['kargolandi', 'shipped'],
    ['iptal', 'cancelled'],
    ['Delivered', 'delivered'],
  ])('status=%s → %s', (status, key) => {
    expect(migrateLegacyOrdersQuery({ status }).query.status).toBe(key);
  });

  it.each([
    ['newest', 'orderedAt', 'desc'],
    ['oldest', 'orderedAt', 'asc'],
    ['shipBy', 'shipBy', 'asc'],
    ['priceLow', 'total', 'asc'],
    ['customer', 'customer', 'asc'],
  ])('sort=%s → %s %s', (sort, s, dir) => {
    expect(migrateLegacyOrdersQuery({ sort }).query).toMatchObject({ sort: s, dir });
  });

  it('leaves a new-format query alone', () => {
    const q = { view: 'overdue', status: ['to_ship', 'delivered'], sort: 'shipBy', dir: 'asc', store: 'Etsy', from: '2026-10-01' };
    expect(hasLegacyOrdersParams(q)).toBe(false);
    expect(migrateLegacyOrdersQuery(q)).toEqual({ query: q, changed: false });
  });

  it('new keys win over legacy ones', () => {
    expect(migrateLegacyOrdersQuery({ label: 'labeled', view: 'shipped', mp: 'A', store: 'B' }).query).toEqual({ view: 'shipped', store: 'B' });
  });
});
