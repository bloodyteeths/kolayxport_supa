// @vitest-environment jsdom
// useSyncOrders (overview §3.7, §8 G4): redirect vs none, toasts per outcome, 402 silent, dedupe, cache revalidation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const push = vi.fn(async () => true);
const router = { pathname: '/app', asPath: '/app', push };
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: (ns: string) => (k: string) => `${ns}.${k}` }));
const toast = { success: vi.fn(() => 'id'), error: vi.fn(() => 'id'), info: vi.fn(() => 'id'), dismiss: vi.fn() };
vi.mock('@/components/ds/feedback/toast', () => ({ useToast: () => toast }));
const mutate = vi.fn(async () => undefined);
vi.mock('swr', async (orig) => ({ ...(await orig<typeof import('swr')>()), mutate: (...a: unknown[]) => mutate(...(a as [])) }));

import {
  __resetSyncOrdersForTests,
  classifySyncFailure,
  isOrdersCacheKey,
  syncFailureToastKey,
  useSyncOrders,
} from '@/lib/hooks/useSyncOrders';

let status = 200;
const fetchMock = vi.fn(async (_url?: string, _init?: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => ({}) }));

beforeEach(() => {
  status = 200;
  __resetSyncOrdersForTests();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  push.mockClear();
  mutate.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  router.pathname = '/app';
  router.asPath = '/app';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pure helpers', () => {
  it('classifies statuses', () => {
    expect(classifySyncFailure(402)).toBe('limit');
    expect(classifySyncFailure(429)).toBe('tooSoon');
    expect(classifySyncFailure(400)).toBe('nothingToSync');
    expect(classifySyncFailure(401)).toBe('unauthorized');
    expect(classifySyncFailure(500)).toBe('failed');
    expect(classifySyncFailure(null)).toBe('failed');
  });
  it('maps failures to toast keys (402 shows none)', () => {
    expect(syncFailureToastKey('limit')).toBeNull();
    expect(syncFailureToastKey('tooSoon')).toBe('toast.refreshTooSoon');
    expect(syncFailureToastKey('nothingToSync')).toBe('toast.refreshNothingToSync');
    expect(syncFailureToastKey('failed')).toBe('toast.refreshFailed');
    expect(syncFailureToastKey('unauthorized')).toBe('toast.refreshFailed');
  });
  it('revalidates orders, nav counts and the summary only', () => {
    expect(isOrdersCacheKey('/api/orders?view=to_ship')).toBe(true);
    expect(isOrdersCacheKey('/api/orders#enrichment?x')).toBe(true);
    expect(isOrdersCacheKey('/api/nav/counts')).toBe(true);
    expect(isOrdersCacheKey('/api/overview/summary?tz=UTC&currency=TRY')).toBe(true);
    expect(isOrdersCacheKey('/api/listings')).toBe(false);
    expect(isOrdersCacheKey(['/api/orders'])).toBe(false);
  });
});

describe('useSyncOrders', () => {
  it('success without redirect: toast, revalidate, stay', async () => {
    const { result } = renderHook(() => useSyncOrders());
    let out: unknown;
    await act(async () => {
      out = await result.current.sync();
    });
    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/sync', expect.objectContaining({ method: 'POST' }));
    expect(toast.success).toHaveBeenCalledWith('overview.toast.refreshed');
    expect(mutate).toHaveBeenCalledWith(isOrdersCacheKey);
    expect(push).not.toHaveBeenCalled();
    expect(result.current.syncing).toBe(false);
    expect(result.current.lastSucceededAt).not.toBeNull();
  });

  it('success with redirectTo navigates, unless already there', async () => {
    const { result } = renderHook(() => useSyncOrders({ redirectTo: '/app/labels' }));
    await act(async () => {
      await result.current.sync();
    });
    expect(push).toHaveBeenCalledWith('/app/labels');
    push.mockClear();
    router.pathname = '/app/labels';
    router.asPath = '/app/labels?view=to_ship';
    await act(async () => {
      await result.current.sync();
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('402 limit: no toast (the limit dialog owns it), no redirect, no revalidation', async () => {
    status = 402;
    const { result } = renderHook(() => useSyncOrders({ redirectTo: '/app/labels' }));
    let out: unknown;
    await act(async () => {
      out = await result.current.sync();
    });
    expect(out).toEqual({ ok: false, reason: 'limit', status: 402 });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('429 → timed "try again in a minute" toast (never holds the queue)', async () => {
    status = 429;
    const { result } = renderHook(() => useSyncOrders());
    await act(async () => {
      await result.current.sync();
    });
    expect(toast.error).toHaveBeenCalledWith('overview.toast.refreshTooSoon', { persist: false });
  });

  it('400 → timed neutral "nothing to refresh" toast with a Connections action', async () => {
    status = 400;
    const { result } = renderHook(() => useSyncOrders());
    await act(async () => {
      await result.current.sync();
    });
    const [key, opts] = toast.error.mock.calls[0] as unknown as [string, { persist: boolean; action: { label: string; onClick: () => void } }];
    expect(key).toBe('overview.toast.refreshNothingToSync');
    expect(opts.persist).toBe(false);
    expect(opts.action.label).toBe('overview.toast.openConnections');
    opts.action.onClick();
    expect(push).toHaveBeenCalledWith('/ayarlar?tab=connections');
  });

  it('500 → persistent error toast with Retry that runs again', async () => {
    status = 500;
    const { result } = renderHook(() => useSyncOrders());
    await act(async () => {
      await result.current.sync();
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [key, opts] = toast.error.mock.calls[0] as unknown as [string, { action: { onClick: () => void } }];
    expect(key).toBe('overview.toast.refreshFailed');
    status = 200;
    await act(async () => {
      opts.action.onClick();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('overview.toast.refreshed');
  });

  it('network error → refreshFailed', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('network');
    });
    const { result } = renderHook(() => useSyncOrders());
    await act(async () => {
      await result.current.sync();
    });
    expect((toast.error.mock.calls[0] as unknown as [string])[0]).toBe('overview.toast.refreshFailed');
  });

  it('concurrent callers share one request and one toast; syncing is shared', async () => {
    let release: () => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise((r) => {
        release = () => r({ ok: true, status: 200, json: async () => ({}) });
      }),
    );
    const a = renderHook(() => useSyncOrders());
    const b = renderHook(() => useSyncOrders());
    let pa: Promise<unknown> = Promise.resolve();
    let pb: Promise<unknown> = Promise.resolve();
    act(() => {
      pa = a.result.current.sync();
      pb = b.result.current.sync();
    });
    expect(a.result.current.syncing).toBe(true);
    expect(b.result.current.syncing).toBe(true);
    await act(async () => {
      release();
      await Promise.all([pa, pb]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(b.result.current.syncing).toBe(false);
  });

  it('toasts: false stays quiet', async () => {
    const { result } = renderHook(() => useSyncOrders({ toasts: false }));
    await act(async () => {
      await result.current.sync();
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
