// components/ds/shell/usePullToRefresh.ts — mobile pull-to-refresh for the persistent shell (shell-nav §4.1).
//
// Behaviour is carried over from the legacy AppLayout (AppLayout.js:392–490) unchanged:
//   - bound to the scroll container (`<main>`), not the window, and gated on its scrollTop;
//   - a touch that starts inside a nested scroller that is not at its top never counts as a pull;
//   - upward or mostly sideways movement aborts; the distance is dampened ((dy − 10) × 0.4, max 120);
//   - releasing past 80px runs a **soft** refresh: the `kx:pull-refresh` window event, `router.replace`
//     of the current URL (scroll kept) and a global SWR revalidate. A hard reload used to wipe unsaved
//     edits on an accidental drag, so it is never used.
// Only the visual is new (the indicator lives in MobileTopBar.tsx: `PullToRefreshIndicator`).
import * as React from 'react';
import { useRouter } from 'next/router';
import { mutate } from 'swr';

/** Window event pages listen to for their own soft refresh (kept from the legacy shell). */
export const PULL_REFRESH_EVENT = 'kx:pull-refresh';
/** Distance (after damping) that arms the refresh. */
export const PULL_THRESHOLD = 80;
/** Maximum indicator travel. */
export const PULL_MAX = 120;

export type PullPhase = 'idle' | 'pull' | 'release' | 'refreshing';

export type PullToRefreshState = {
  /** Current dampened distance in px (0 when idle). */
  distance: number;
  /** 0–1 towards the threshold. */
  progress: number;
  phase: PullPhase;
  /** True while the finger is down (no height transition then). */
  dragging: boolean;
};

export type UsePullToRefreshOptions = {
  /** Mobile only. When false nothing is bound. */
  enabled: boolean;
  threshold?: number;
  /** Replaces the default soft refresh (event + router.replace + SWR revalidate). */
  onRefresh?: () => Promise<unknown> | unknown;
};

/** Pure: raw finger travel → dampened indicator distance (legacy formula). */
export function dampenPull(dy: number): number {
  if (dy <= 10) return 0;
  return Math.min((dy - 10) * 0.4, PULL_MAX);
}

/** Pure: phase for a distance while dragging. */
export function pullPhaseFor(distance: number, threshold = PULL_THRESHOLD): PullPhase {
  if (distance <= 0) return 'idle';
  return distance >= threshold ? 'release' : 'pull';
}

/** True when `target` sits in a nested scroller (below `root`) that is not scrolled to its top. */
export function inScrolledChild(target: EventTarget | null, root: HTMLElement): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (el.scrollTop > 0) return true;
    el = el.parentElement;
  }
  return false;
}

const IDLE: PullToRefreshState = { distance: 0, progress: 0, phase: 'idle', dragging: false };

/**
 * Binds pull-to-refresh to `targetRef.current` (the shell's scrolling `<main>`). Returns the indicator
 * state; render it with `<PullToRefreshIndicator state={…} />` (or pass it to `<MobileTopBar pull>`).
 */
export function usePullToRefresh(
  targetRef: React.RefObject<HTMLElement | null>,
  { enabled, threshold = PULL_THRESHOLD, onRefresh }: UsePullToRefreshOptions,
): PullToRefreshState {
  const router = useRouter();
  const routerRef = React.useRef(router);
  routerRef.current = router;
  const onRefreshRef = React.useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const [state, setState] = React.useState<PullToRefreshState>(IDLE);

  React.useEffect(() => {
    const main = targetRef.current;
    if (!enabled || !main) return undefined;

    let startY = 0;
    let startX = 0;
    let pulling = false;
    let refreshing = false;
    let distance = 0;
    let alive = true;

    const reset = () => {
      pulling = false;
      distance = 0;
      if (alive) setState(IDLE);
    };

    const onStart = (e: TouchEvent) => {
      pulling = false;
      if (refreshing || e.touches.length !== 1) return;
      if (main.scrollTop > 0 || inScrolledChild(e.target, main)) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pulling = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!pulling || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (dy < 0 || main.scrollTop > 0 || (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10)) {
        reset();
        return;
      }
      const d = dampenPull(dy);
      if (d <= 0) return;
      distance = d;
      setState({ distance: d, progress: Math.min(d / threshold, 1), phase: pullPhaseFor(d, threshold), dragging: true });
    };

    const onEnd = async () => {
      if (!pulling) return;
      pulling = false;
      if (distance < threshold) {
        reset();
        return;
      }
      refreshing = true;
      setState({ distance: threshold * 0.5, progress: 1, phase: 'refreshing', dragging: false });
      try {
        if (onRefreshRef.current) {
          await onRefreshRef.current();
        } else {
          window.dispatchEvent(new CustomEvent(PULL_REFRESH_EVENT));
          const r = routerRef.current;
          await Promise.all([
            r?.replace ? r.replace(r.asPath, undefined, { scroll: false }) : Promise.resolve(true),
            mutate(() => true),
          ]);
        }
      } catch {
        // best-effort refresh
      } finally {
        refreshing = false;
        reset();
      }
    };

    // A cancelled touch while a refresh is in flight must not hide the spinner (the refresh still runs).
    const onCancel = () => {
      if (refreshing) return;
      reset();
    };

    const opts: AddEventListenerOptions = { passive: true };
    main.addEventListener('touchstart', onStart, opts);
    main.addEventListener('touchmove', onMove, opts);
    main.addEventListener('touchend', onEnd, opts);
    main.addEventListener('touchcancel', onCancel, opts);
    return () => {
      alive = false;
      main.removeEventListener('touchstart', onStart);
      main.removeEventListener('touchmove', onMove);
      main.removeEventListener('touchend', onEnd);
      main.removeEventListener('touchcancel', onCancel);
      // The in-flight `finally` can no longer clear state (alive = false): clear it here so a re-run of
      // this effect (e.g. `enabled` flipping on rotation) never resurfaces a stale 'refreshing' spinner.
      setState(IDLE);
    };
  }, [enabled, targetRef, threshold]);

  return enabled ? state : IDLE;
}

export default usePullToRefresh;
