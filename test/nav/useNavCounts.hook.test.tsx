// @vitest-environment jsdom
// useNavCounts hook: freshness lives in the shared SWR cache, so every instance
// (sidebar + tab bar, or a remounted shell) shows the same counts — including
// instances whose request SWR deduped and after a global (live) revalidation.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig, useSWRConfig } from 'swr';

vi.mock('@/components/live/useLiveEvent', () => ({ useLiveRevalidate: () => {} }));

import { NAV_COUNTS_KEY, NAV_COUNTS_STALE_MS, useNavCounts } from '@/lib/nav/useNavCounts';

let toShip = 4;
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ orders: { toShip, overdue: 1 }, drafts: { etsy: 2, ebay: 0 }, generatedAt: new Date().toISOString() }),
}));

let cache: Map<string, any>;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
);

beforeEach(() => {
  cache = new Map();
  toShip = 4;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function useTwo() {
  const a = useNavCounts();
  const b = useNavCounts();
  const { mutate } = useSWRConfig();
  return { a, b, mutate };
}

describe('useNavCounts (hook)', () => {
  it('two instances both show counts after one fetch, and after a global revalidation', async () => {
    const { result } = renderHook(() => useTwo(), { wrapper });
    await waitFor(() => expect(result.current.a.ordersToShip).toBe(4));
    expect(result.current.b.ordersToShip).toBe(4);
    expect(result.current.b.unsentDrafts).toEqual({ etsy: 2, ebay: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    toShip = 7;
    await act(async () => {
      await result.current.mutate(NAV_COUNTS_KEY);
    });
    await waitFor(() => expect(result.current.a.ordersToShip).toBe(7));
    expect(result.current.b.ordersToShip).toBe(7);
  });

  it('a remount inside the dedupe window shows the cached counts at once', async () => {
    const first = renderHook(() => useNavCounts(), { wrapper });
    await waitFor(() => expect(first.result.current.ordersToShip).toBe(4));
    first.unmount();
    const second = renderHook(() => useNavCounts(), { wrapper });
    expect(second.result.current.ordersToShip).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hides counts whose receive time is older than 10 minutes', () => {
    cache.set(NAV_COUNTS_KEY, {
      data: { orders: { toShip: 9, overdue: 0 }, drafts: { etsy: 0, ebay: 0 }, generatedAt: '', receivedAt: Date.now() - NAV_COUNTS_STALE_MS - 1000 },
    });
    fetchMock.mockImplementationOnce(() => new Promise(() => {}) as any);
    const { result } = renderHook(() => useNavCounts(), { wrapper });
    expect(result.current.ordersToShip).toBeUndefined();
  });
});
