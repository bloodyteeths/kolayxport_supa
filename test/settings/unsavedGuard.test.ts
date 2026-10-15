// @vitest-environment jsdom
// Settings Group A — useUnsavedChangesGuard (settings §3.3): beforeunload, routeChangeStart, in-page confirm.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

type Handler = (url: string, meta?: { shallow?: boolean }) => void;
const h = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const events = {
    on: (e: string, fn: (...a: unknown[]) => void) => { if (!handlers.has(e)) handlers.set(e, new Set()); handlers.get(e)!.add(fn); },
    off: (e: string, fn: (...a: unknown[]) => void) => { handlers.get(e)?.delete(fn); },
    emit: vi.fn(),
  };
  return {
    handlers,
    router: { asPath: '/ayarlar?tab=senderProfile', events, push: vi.fn(() => Promise.resolve(true)), replace: vi.fn(() => Promise.resolve(true)), beforePopState: vi.fn<(cb: (state: { as?: string }) => boolean) => void>() },
    confirm: vi.fn<(o: { title: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>>(),
  };
});
vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('next-intl', () => ({ useTranslations: (ns: string) => (k: string) => `${ns}.${k}` }));
vi.mock('@/components/ds/overlay/ConfirmDialog', () => ({ useConfirm: () => h.confirm }));

import { ROUTE_ABORT, leavesCurrentView, useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';

const start = (url: string, meta?: { shallow?: boolean }) => {
  for (const fn of h.handlers.get('routeChangeStart') ?? []) (fn as Handler)(url, meta);
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  h.handlers.clear();
  h.confirm.mockReset();
  h.router.push.mockClear();
  h.router.events.emit.mockClear();
  h.router.beforePopState.mockClear();
});
const bps = () => h.router.beforePopState.mock.calls.at(-1)![0];
afterEach(cleanup);

describe('leavesCurrentView', () => {
  it('ignores hash-only changes', () => {
    expect(leavesCurrentView('/a?x=1', '/a?x=1#top')).toBe(false);
    expect(leavesCurrentView('/a?x=1', '/a?x=2')).toBe(true);
  });
});

describe('useUnsavedChangesGuard', () => {
  it('does nothing while clean', async () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(false));
    expect(() => start('/app/labels')).not.toThrow();
    await expect(result.current.confirmDiscard()).resolves.toBe(true);
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it('confirm copy comes from settings.unsaved.*', async () => {
    h.confirm.mockResolvedValue(false);
    const onDiscard = vi.fn();
    const { result } = renderHook(() => useUnsavedChangesGuard(true, { onDiscard }));
    await expect(result.current.confirmDiscard()).resolves.toBe(false);
    expect(h.confirm).toHaveBeenCalledWith({ title: 'settings.unsaved.title', confirmLabel: 'settings.unsaved.discard', cancelLabel: 'settings.unsaved.keep' });
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('blocks a dirty route change, then retries it after Discard', async () => {
    h.confirm.mockResolvedValue(true);
    const onDiscard = vi.fn();
    renderHook(() => useUnsavedChangesGuard(true, { onDiscard }));
    expect(() => start('/ayarlar?tab=billing', { shallow: true })).toThrow(ROUTE_ABORT);
    expect(h.router.events.emit).toHaveBeenCalledWith('routeChangeError', ROUTE_ABORT, '/ayarlar?tab=billing', { shallow: true });
    await flush();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(h.router.push).toHaveBeenCalledWith('/ayarlar?tab=billing', undefined, { shallow: true });
    // the retried navigation passes once
    expect(() => start('/ayarlar?tab=billing', { shallow: true })).not.toThrow();
  });

  it('Keep editing leaves the user where they are', async () => {
    h.confirm.mockResolvedValue(false);
    renderHook(() => useUnsavedChangesGuard(true));
    expect(() => start('/app/labels')).toThrow(ROUTE_ABORT);
    await flush();
    expect(h.router.push).not.toHaveBeenCalled();
  });

  it('shouldBlock lets same-form rewrites through', () => {
    renderHook(() => useUnsavedChangesGuard(true, { shouldBlock: (u) => !u.includes('tab=senderProfile') }));
    expect(() => start('/ayarlar?tab=senderProfile&provider=x')).not.toThrow();
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it('runGuarded skips the route check for its own navigation', async () => {
    h.confirm.mockResolvedValue(true);
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    let ok = false;
    await act(async () => {
      ok = await result.current.runGuarded(async () => { start('/ayarlar?tab=billing'); });
    });
    expect(ok).toBe(true);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    // bypass is consumed: the next foreign navigation is guarded again
    h.confirm.mockResolvedValue(false);
    expect(() => start('/app/labels')).toThrow(ROUTE_ABORT);
  });

  it('a second navigation while the confirm is open is blocked, not let through', async () => {
    let resolve!: (v: boolean) => void;
    h.confirm.mockReturnValue(new Promise<boolean>((r) => { resolve = r; }));
    renderHook(() => useUnsavedChangesGuard(true));
    expect(() => start('/app/labels')).toThrow(ROUTE_ABORT);
    expect(() => start('/app/orders')).toThrow(ROUTE_ABORT);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    resolve(false);
    await flush();
    expect(h.router.push).not.toHaveBeenCalled();
  });

  describe('browser back / forward (beforePopState)', () => {
    it('clean: popstate passes', () => {
      renderHook(() => useUnsavedChangesGuard(false));
      expect(bps()({ as: '/ayarlar' })).toBe(true);
    });

    it('dirty: restores the URL, asks, Keep editing stays, Discard goes back once without a push', async () => {
      window.history.replaceState({ __N: true, as: '/ayarlar?tab=senderProfile' }, '', '/ayarlar?tab=senderProfile');
      const pushState = vi.spyOn(window.history, 'pushState');
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      const onDiscard = vi.fn();
      renderHook(() => useUnsavedChangesGuard(true, { onDiscard }));

      h.confirm.mockResolvedValueOnce(false);
      expect(bps()({ as: '/ayarlar' })).toBe(false);
      expect(pushState).toHaveBeenCalledWith({ __N: true, as: '/ayarlar?tab=senderProfile' }, '', '/ayarlar?tab=senderProfile');
      await flush();
      expect(back).not.toHaveBeenCalled();

      h.confirm.mockResolvedValueOnce(true);
      expect(bps()({ as: '/ayarlar' })).toBe(false);
      await flush();
      expect(onDiscard).toHaveBeenCalledTimes(1);
      expect(back).toHaveBeenCalledTimes(1);
      expect(h.router.push).not.toHaveBeenCalled();
      // the resulting popstate and its routeChangeStart pass once
      expect(bps()({ as: '/ayarlar' })).toBe(true);
      expect(() => start('/ayarlar')).not.toThrow();
      pushState.mockRestore();
      back.mockRestore();
    });

    it('unmount releases beforePopState', () => {
      const { unmount } = renderHook(() => useUnsavedChangesGuard(true));
      unmount();
      expect(bps()({ as: '/x' })).toBe(true);
    });
  });

  it('beforeunload is armed only while dirty', () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), { initialProps: { dirty: true } });
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    rerender({ dirty: false });
    const ev2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
  });
});
