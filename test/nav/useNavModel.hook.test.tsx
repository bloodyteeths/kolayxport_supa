// @vitest-environment jsdom
// useNavModel hook: the per-user connections cache (kx.nav.connections.v1) and the router/connections wiring.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ConnectionsMap } from '@/lib/hooks/useConnections';

const router = { asPath: '/app/etsy-listings/42?tab=x', pathname: '/app/etsy-listings/[id]' };
vi.mock('next/router', () => ({ useRouter: () => router }));

let liveConnections: ConnectionsMap | null = null;
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ connections: liveConnections }),
}));

import { NAV_CONN_CACHE_KEY, readNavConnCache, useNavModel } from '@/lib/nav/useNavModel';

const messages = {
  nav: { groups: { listings: 'Listings' }, items: { listingsOf: '{marketplace} listings', home: 'Home', orders: 'Orders' } },
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages} onError={() => {}} getMessageFallback={({ key }) => key}>
    {children}
  </NextIntlClientProvider>
);

const ids = (m: ReturnType<typeof useNavModel>) => m.groups.flatMap((g) => g.items.map((i) => i.id));

function connsOf(connected: string[]): ConnectionsMap {
  const map = {} as ConnectionsMap;
  for (const p of ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'veeqo', 'shippo'] as const) {
    map[p] = { connected: connected.includes(p), accounts: [], needsReauth: false };
  }
  return map;
}

beforeEach(() => {
  window.localStorage.clear();
  liveConnections = null;
});
afterEach(cleanup);

describe('useNavModel (hook)', () => {
  it('uses the cache tagged with this user id while connections are unknown', () => {
    window.localStorage.setItem(NAV_CONN_CACHE_KEY, JSON.stringify({ uid: 'u1', flags: { etsy: true, ebay: false } }));
    const { result } = renderHook(() => useNavModel({ userId: 'u1' }), { wrapper });
    expect(ids(result.current)).toContain('listings-etsy');
    expect(ids(result.current)).not.toContain('listings-ebay');
  });

  it('ignores a cache written for another user id (shows everything while unknown)', () => {
    window.localStorage.setItem(NAV_CONN_CACHE_KEY, JSON.stringify({ uid: 'other', flags: { etsy: false, ebay: false } }));
    expect(readNavConnCache('u1')).toBeNull();
    const { result } = renderHook(() => useNavModel({ userId: 'u1' }), { wrapper });
    expect(ids(result.current)).toEqual(expect.arrayContaining(['listings-etsy', 'listings-ebay', 'listings-shopify']));
  });

  it('writes live flags to the cache for this user and resolves the route from asPath', () => {
    liveConnections = connsOf(['etsy']);
    const { result } = renderHook(() => useNavModel({ userId: 'u1' }), { wrapper });
    expect(JSON.parse(window.localStorage.getItem(NAV_CONN_CACHE_KEY)!)).toMatchObject({ uid: 'u1', flags: { etsy: true, ebay: false } });
    expect(result.current.activeId).toBe('listings-etsy');
    expect(result.current.breadcrumbs.map((c) => c.label)).toEqual(['Listings', 'Etsy']);
    expect(result.current.groups.flatMap((g) => g.items).find((i) => i.id === 'listings-etsy')?.ariaLabel).toBe('Etsy listings');
  });

  it('without a user id nothing is cached', () => {
    liveConnections = connsOf(['etsy']);
    renderHook(() => useNavModel({}), { wrapper });
    expect(window.localStorage.getItem(NAV_CONN_CACHE_KEY)).toBeNull();
  });
});
