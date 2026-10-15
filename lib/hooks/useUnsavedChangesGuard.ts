// lib/hooks/useUnsavedChangesGuard.ts — settings §3.3: one guard for unsaved form edits.
//
// Covers (1) `beforeunload` (tab close / reload: the browser's own prompt), (2) Next `routeChangeStart`
// (links, back chevron, browser back, other pages; also shallow `?tab=` changes) and (3) in-page actions
// that call `confirmDiscard()` themselves before switching (the Settings nav). The confirm is the DS
// `ConfirmDialog` via `useConfirm()`: "Discard unsaved changes?" · [Keep editing] [Discard].
//
// A blocked link/push/replace is cancelled the documented way (emit `routeChangeError`, throw), then
// retried once the user picks Discard. Browser/OS back & forward are different: the browser has already
// moved the URL when `routeChangeStart` would fire, so they are caught earlier in `router.beforePopState`:
// the guard re-inserts the current entry (`history.pushState`, which leaves the target exactly one entry
// back in either direction), asks, and on Discard calls `history.back()` — so the history stack ends up
// as if the plain back/forward had happened, without a duplicate entry. While the confirm is open every
// other navigation is blocked. `shouldBlock(url)` lets a page allow param-only rewrites (e.g. stripping
// `?success=` after OAuth) that keep the user on the same form.
import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';

export interface UnsavedChangesGuardOptions {
  /** Called after the user picks Discard (reset the form to its saved values here). */
  onDiscard?: () => void;
  /** Default true. */
  enabled?: boolean;
  /** Route changes to `url` that need the confirm; default: any URL other than the current `asPath`. */
  shouldBlock?: (url: string) => boolean;
  /** Override the confirm copy (already translated). Default `settings.unsaved.*`. */
  labels?: { title?: string; keep?: string; discard?: string };
}

export interface UnsavedChangesGuard {
  /** Resolves true when it is fine to leave: nothing dirty, or the user chose Discard (onDiscard ran). */
  confirmDiscard: () => Promise<boolean>;
  /** Let the next route change through without a confirm (after confirmDiscard, or after a save). */
  allowNextNavigation: () => void;
  /** `confirmDiscard()` then `fn()` with the next navigation allowed. Resolves false when the user kept editing. */
  runGuarded: (fn: () => void | Promise<unknown>) => Promise<boolean>;
}

/** The error string Next ignores when a `routeChangeStart` handler aborts a navigation. */
export const ROUTE_ABORT = 'kx-unsaved-changes: route change aborted';

/** Pure: does a route change from `currentAsPath` to `url` leave the current view? (hash-only = no). */
export function leavesCurrentView(currentAsPath: string, url: string): boolean {
  const strip = (u: string) => u.split('#')[0];
  return strip(currentAsPath) !== strip(url);
}

export function useUnsavedChangesGuard(isDirty: boolean, options: UnsavedChangesGuardOptions = {}): UnsavedChangesGuard {
  const router = useRouter();
  const confirm = useConfirm();
  const t = useTranslations('settings.unsaved');
  const { enabled = true } = options;

  const active = enabled && isDirty;
  const activeRef = useRef(active);
  activeRef.current = active;
  const optsRef = useRef(options);
  optsRef.current = options;
  const bypassRef = useRef(false);
  const promptingRef = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;

  const ask = useCallback(async (): Promise<boolean> => {
    const labels = optsRef.current.labels ?? {};
    const ok = await confirm({
      title: labels.title ?? tRef.current('title'),
      confirmLabel: labels.discard ?? tRef.current('discard'),
      cancelLabel: labels.keep ?? tRef.current('keep'),
    });
    if (ok) optsRef.current.onDiscard?.();
    return ok;
  }, [confirm]);

  const confirmDiscard = useCallback(async () => {
    if (!activeRef.current) return true;
    return ask();
  }, [ask]);

  const allowNextNavigation = useCallback(() => {
    bypassRef.current = true;
  }, []);

  const runGuarded = useCallback(async (fn: () => void | Promise<unknown>) => {
    const ok = await confirmDiscard();
    if (!ok) return false;
    bypassRef.current = true;
    try {
      // Return the router promise from `fn` so the navigation has started (and consumed the bypass) here.
      await fn();
    } finally {
      // A navigation that never fired routeChangeStart must not leave the bypass armed.
      bypassRef.current = false;
    }
    return true;
  }, [confirmDiscard]);

  // (1) Tab close / reload.
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome needs returnValue set; the text itself is never shown by modern browsers.
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);

  // (2) Client-side navigation (links, push, replace).
  useEffect(() => {
    const events = router?.events;
    if (!events) return undefined;
    const onStart = (url: string, meta?: { shallow?: boolean }) => {
      if (bypassRef.current) {
        bypassRef.current = false;
        return;
      }
      if (!activeRef.current) return;
      const abort = () => {
        events.emit('routeChangeError', ROUTE_ABORT, url, meta);
        // Next's documented way to cancel a navigation from routeChangeStart.
        throw ROUTE_ABORT;
      };
      // A second navigation while the confirm is open is blocked, never let through unguarded.
      if (promptingRef.current) abort();
      const block = optsRef.current.shouldBlock ?? ((u: string) => leavesCurrentView(router.asPath, u));
      if (!block(url)) return;
      promptingRef.current = true;
      const shallow = Boolean(meta?.shallow);
      void ask().then((ok) => {
        promptingRef.current = false;
        if (!ok) return;
        bypassRef.current = true;
        void router.push(url, undefined, { shallow });
      });
      abort();
    };
    events.on('routeChangeStart', onStart);
    return () => events.off('routeChangeStart', onStart);
  }, [router, ask]);

  // (3) Browser / OS back & forward. The URL has already moved when Next sees the popstate.
  const popBypassRef = useRef(false);
  /** The committed history entry (Next state + URL) to restore when a popstate is refused. */
  const committedRef = useRef<{ state: unknown; href: string } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof router?.beforePopState !== 'function') return undefined;
    const snapshot = () => {
      committedRef.current = { state: window.history.state, href: window.location.pathname + window.location.search + window.location.hash };
    };
    snapshot();
    const events = router.events;
    events?.on('routeChangeComplete', snapshot);
    events?.on('hashChangeComplete', snapshot);
    router.beforePopState((state: { as?: string }) => {
      if (popBypassRef.current) {
        popBypassRef.current = false;
        bypassRef.current = true; // let the routeChangeStart of this same popstate through
        return true;
      }
      const target = typeof state?.as === 'string' ? state.as : '';
      if (!activeRef.current) return true;
      const block = optsRef.current.shouldBlock ?? ((u: string) => leavesCurrentView(router.asPath, u));
      if (!promptingRef.current && !block(target)) return true;
      // Put the current entry back so the address bar matches the page that is still rendered.
      const committed = committedRef.current;
      if (committed) window.history.pushState(committed.state, '', committed.href);
      if (promptingRef.current) return false;
      promptingRef.current = true;
      void ask().then((ok) => {
        promptingRef.current = false;
        if (!ok) return;
        // The target is now exactly one entry back (back and forward alike).
        popBypassRef.current = true;
        window.history.back();
      });
      return false;
    });
    return () => {
      events?.off('routeChangeComplete', snapshot);
      events?.off('hashChangeComplete', snapshot);
      router.beforePopState(() => true);
    };
  }, [router, ask]);

  return { confirmDiscard, allowNextNavigation, runGuarded };
}

export default useUnsavedChangesGuard;
