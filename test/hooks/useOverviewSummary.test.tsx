// @vitest-environment jsdom
// useOverviewSummary (overview §3.7, §8 G4): key, options, stale-on-error, 401 not retried.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

vi.mock('@/lib/format', () => ({ useFormatters: () => ({ timeZone: 'Europe/Istanbul' }) }));

import useLocaleStore from '@/lib/stores/useLocaleStore';
import {
  OVERVIEW_SUMMARY_SWR_OPTIONS,
  OverviewSummaryFetchError,
  defaultOverviewCurrency,
  overviewSummaryKey,
  overviewSummaryOnErrorRetry,
  sectionFailed,
  useOverviewSummary,
} from '@/lib/hooks/useOverviewSummary';

const body = (over: Record<string, unknown> = {}) => ({
  generatedAt: '2026-10-15T10:00:00.000Z',
  requestId: 'req_1',
  tz: 'Europe/Istanbul',
  currency: 'TRY',
  errors: [],
  ordersLastSyncedAt: null,
  toShip: null, labels: null, tracking: null, drafts: null, usage: null, kpis: null, series: null, topSellers: null, setup: null,
  ...over,
});

let next: { status: number; json: unknown } = { status: 200, json: body() };
const fetchMock = vi.fn(async (_url: string) => ({ ok: next.status < 300, status: next.status, json: async () => next.json }));
let cache: Map<string, any>;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
);

beforeEach(() => {
  cache = new Map();
  next = { status: 200, json: body() };
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  useLocaleStore.setState({ locale: 'tr' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pure helpers', () => {
  it('builds the key with tz and currency', () => {
    expect(overviewSummaryKey('Europe/Istanbul', 'TRY')).toBe('/api/overview/summary?tz=Europe%2FIstanbul&currency=TRY');
  });
  it('currency defaults by locale', () => {
    expect(defaultOverviewCurrency('tr')).toBe('TRY');
    expect(defaultOverviewCurrency('en')).toBe('USD');
  });
  it('§3.7 options', () => {
    expect(OVERVIEW_SUMMARY_SWR_OPTIONS).toMatchObject({
      refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true, errorRetryCount: 2, refreshWhenHidden: false,
    });
  });
  it('onErrorRetry: a 500 gives 1 request + exactly 2 retries (SWR retryCount starts at 1); 401/405 none', () => {
    vi.useFakeTimers();
    try {
      // Simulate SWR's loop: each failed revalidate calls onErrorRetry with (prev || 0) + 1.
      const run = (status: number) => {
        let fetches = 1;
        const revalidate = (opts: { retryCount: number }) => {
          fetches += 1;
          overviewSummaryOnErrorRetry({ status }, revalidate, (opts.retryCount || 0) + 1);
        };
        overviewSummaryOnErrorRetry({ status }, revalidate, 1);
        vi.runAllTimers();
        return fetches;
      };
      expect(run(500)).toBe(3);
      expect(run(401)).toBe(1);
      expect(run(405)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('sectionFailed', () => {
    expect(sectionFailed({ errors: ['drafts'] }, 'drafts')).toBe(true);
    expect(sectionFailed({ errors: [] }, 'drafts')).toBe(false);
    expect(sectionFailed(undefined, 'drafts')).toBe(false);
  });
});

describe('useOverviewSummary', () => {
  it('loads with the seller tz and locale currency', async () => {
    const { result } = renderHook(() => useOverviewSummary(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.summary?.requestId).toBe('req_1'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/overview/summary?tz=Europe%2FIstanbul&currency=TRY');
    expect(result.current.summary?.receivedAt).toEqual(expect.any(Number));
    expect(result.current.isLoading).toBe(false);
  });

  it('en locale asks for USD; explicit options win', async () => {
    useLocaleStore.setState({ locale: 'en' });
    const a = renderHook(() => useOverviewSummary(), { wrapper });
    expect(a.result.current.key).toBe('/api/overview/summary?tz=Europe%2FIstanbul&currency=USD');
    const b = renderHook(() => useOverviewSummary({ tz: 'UTC', currency: 'TRY' }), { wrapper });
    expect(b.result.current.key).toBe('/api/overview/summary?tz=UTC&currency=TRY');
  });

  it('enabled: false makes no request', () => {
    const { result } = renderHook(() => useOverviewSummary({ enabled: false }), { wrapper });
    expect(result.current.key).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed refresh keeps the old summary and reports isStale', async () => {
    const { result } = renderHook(() => useOverviewSummary(), { wrapper });
    await waitFor(() => expect(result.current.summary).toBeDefined());
    next = { status: 500, json: { error: 'x', requestId: 'req_err' } };
    await act(async () => {
      await result.current.refresh().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(OverviewSummaryFetchError));
    expect(result.current.error?.requestId).toBe('req_err');
    expect(result.current.isStale).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.summary?.requestId).toBe('req_1');
  });

  it('401 with nothing cached is an error and is not retried', async () => {
    next = { status: 401, json: { error: 'Unauthorized' } };
    const { result } = renderHook(() => useOverviewSummary(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(401);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
