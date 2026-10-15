// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import {
  ordersApiParams,
  ordersListKey,
  orderKey,
  effectiveDates,
  resolveDatePreset,
  useOrdersList,
  useOrder,
} from '@/lib/hooks/useOrdersList';
import { etsyNoAddress, manualLabeled } from './g1-fixtures';

const NOW = new Date(2026, 9, 15, 12, 0, 0); // local time

describe('ordersApiParams', () => {
  it('To ship: view, counts, effective ship-by sort, no dates, page size 50', () => {
    const p = ordersApiParams({ view: 'to_ship' }, NOW);
    expect(Object.fromEntries(p)).toEqual({ view: 'to_ship', page: '1', limit: '50', sortBy: 'shipBy', sort: 'asc', include: 'counts' });
  });

  it('Shipped defaults to the last 30 days; preset any removes it; explicit from/to win over the view default', () => {
    expect(ordersApiParams({ view: 'shipped' }, NOW).get('startDate')).toBe('2026-09-15');
    expect(ordersApiParams({ view: 'shipped', preset: 'any' }, NOW).get('startDate')).toBeNull();
    const p = ordersApiParams({ view: 'all', from: '2026-10-01', to: '2026-10-10' }, NOW);
    expect([p.get('startDate'), p.get('endDate')]).toEqual(['2026-10-01', '2026-10-10']);
  });

  it('search drops dates; in, store, status repeat; sort and dir map to the API', () => {
    const p = ordersApiParams({ view: 'all', q: ' 3891 ', in: 'order', store: ['Etsy', 'Trendyol'], status: ['to_ship', 'shipped'], sort: 'total', dir: 'asc', page: 2, size: 1000 }, NOW);
    expect(p.get('search')).toBe('3891');
    expect(p.get('searchType')).toBe('order');
    expect(p.getAll('marketplace')).toEqual(['Etsy', 'Trendyol']);
    expect(p.getAll('status')).toEqual(['to_ship', 'shipped']);
    expect(p.get('startDate')).toBeNull();
    expect([p.get('sortBy'), p.get('sort'), p.get('page'), p.get('limit')]).toEqual(['price', 'asc', '2', '250']);
  });

  it('keys live under the /api/orders prefix (live revalidation)', () => {
    expect(ordersListKey({ view: 'to_ship' }, NOW).startsWith('/api/orders?')).toBe(true);
    expect(orderKey('o 1')).toBe('/api/orders?ids=o+1');
  });

  it('date presets', () => {
    expect(resolveDatePreset('lastMonth', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolveDatePreset('thisMonth', NOW)).toEqual({ from: '2026-10-01' });
    expect(effectiveDates({ view: 'to_ship' }, NOW)).toEqual({});
  });
});

describe('useOrdersList / useOrder', () => {
  let cache: Map<string, any>;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
  );
  const fetchMock = vi.fn();

  beforeEach(() => {
    cache = new Map();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/api/orders/sync')) return { ok: false, status: 402, json: async () => ({ error: 'Payment Required', details: 'orderSync limit reached for your plan.' }) };
      if (u.startsWith('/api/orders?')) {
        const ids = new URL(u, 'http://x').searchParams.get('ids');
        const orders = ids ? [manualLabeled].filter((o) => o.id === ids) : [etsyNoAddress, manualLabeled];
        return { ok: true, status: 200, json: async () => ({ orders, total: orders.length, page: 1, pageSize: 50, counts: { to_ship: 1, overdue: 1, label_created: 0, problems: 2 }, lastPulledAt: '2026-10-15T10:00:00.000Z', etsyShopNames: ['BelleCoutureGifts'] }) };
      }
      if (u.startsWith('/api/etsy-addresses')) return { ok: true, status: 200, json: async () => ({ success: true, lookup: {} }) };
      if (u.startsWith('/api/listing-urls')) return { ok: true, status: 200, json: async () => ({}) };
      void init;
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('maps rows, counts and lastPulledAt; Etsy store resolved from etsyShopNames', async () => {
    const { result } = renderHook(() => useOrdersList({ view: 'all' }), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.rows.map((r) => r.id)).toEqual(['o-etsy', 'o-manual']);
    expect(result.current.rows[0].store.marketplace).toBe('etsy');
    expect(result.current.counts).toEqual({ to_ship: 1, overdue: 1, label_created: 0, problems: 2 });
    expect(result.current.lastPulledAt).toBe('2026-10-15T10:00:00.000Z');
    expect(result.current.total).toBe(2);
  });

  it('pull: 402 → failed with the limit info, never throws; sends the inline-limit header', async () => {
    const { result } = renderHook(() => useOrdersList({ view: 'to_ship' }), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    await act(async () => {
      await result.current.pull();
    });
    expect(result.current.pullState).toBe('failed');
    expect(result.current.pullError?.status).toBe(402);
    expect(result.current.pullError?.limit?.limitType).toBe('orderSync');
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/orders/sync')!;
    expect(JSON.parse(String(call[1].body))).toEqual({ syncType: 'fast' });
    expect((call[1].headers as Record<string, string>)['x-kx-limit-ui']).toBe('inline');
  });

  it('useOrder loads one order by id; unknown id → empty', async () => {
    const one = renderHook(() => useOrder('o-manual'), { wrapper });
    await waitFor(() => expect(one.result.current.state).toBe('ready'));
    expect(one.result.current.row?.orderNumber).toBe('IG-2026-031');
    const none = renderHook(() => useOrder('missing'), { wrapper });
    await waitFor(() => expect(none.result.current.state).toBe('empty'));
    const idle = renderHook(() => useOrder(null), { wrapper });
    expect(idle.result.current.row).toBeUndefined();
  });
});
