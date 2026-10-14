/**
 * React hooks over the live event stream (owner W6-live).
 *
 *   useLiveEvent(['order.new'], (event, meta) => ...)
 *   useLiveRevalidate(['listing.changed', 'stock.changed'], fetchListings)
 *   useLiveRevalidate(['order'], '/api/orders')            // SWR key prefix
 *   useLiveStatus()                                         // 'live' | 'polling' | ...
 *   useRecentLiveOrders()                                   // Map<orderId, arrivedAt>
 *   useHighlightParam()                                     // ?highlight=<id> helper
 *
 * Names: see lib/live/names.ts ('order.new', 'order.canceled', 'order',
 * 'order.*', 'listing.changed', 'stock.alert', 'notification.new', '*', ...).
 * Events arrive as window CustomEvent 'kx:live' dispatched by
 * LiveEventsProvider (mounted once in AppLayout). Without the provider these
 * hooks are inert.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/router';
import { mutate as globalMutate } from 'swr';
import type { LiveEvent } from '@/lib/live/types';
import {
  LIVE_WINDOW_EVENT,
  getLiveStatus,
  getRecentOrders,
  getServerLiveStatus,
  getServerRecentOrders,
  subscribeLiveStatus,
  subscribeRecentOrders,
  type LiveClientEvent,
  type LiveStatusSnapshot,
} from './liveStore';

export type { LiveClientEvent } from './liveStore';

function namesKey(types: readonly string[]): string {
  return Array.from(new Set(types || [])).sort().join('|');
}

/**
 * Subscribe to live events by name. The handler is kept in a ref, so passing
 * an inline function does not re-subscribe on every render; `types` is
 * compared by value.
 */
export function useLiveEvent(
  types: readonly string[],
  handler: (event: LiveEvent, meta: LiveClientEvent) => void,
  opts: { enabled?: boolean } = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = namesKey(types);
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !key) return;
    const wanted = key.split('|');
    const onLive = (e: Event) => {
      const detail = (e as CustomEvent<LiveClientEvent>).detail;
      if (!detail || !Array.isArray(detail.names)) return;
      if (!wanted.some((w) => detail.names.includes(w))) return;
      try {
        handlerRef.current(detail.event, detail);
      } catch (err) {
        console.warn('[live] handler threw', err);
      }
    };
    window.addEventListener(LIVE_WINDOW_EVENT, onLive);
    return () => window.removeEventListener(LIVE_WINDOW_EVENT, onLive);
  }, [key, enabled]);
}

export type LiveRevalidateTarget =
  /** SWR key prefix: every cached key equal to it or starting with it (`/api/orders` matches `/api/orders?page=1`) */
  | string
  /** called as-is: a bound SWR `mutate`, or any refetch function (e.g. fetchListings) */
  | (() => unknown)
  /** custom SWR key predicate */
  | { match: (key: string) => boolean };

/** Revalidate SWR keys whose string form starts with `prefix`. */
export function revalidateSwrPrefix(prefix: string): void {
  if (!prefix) return;
  void globalMutate((key: unknown) => typeof key === 'string' && key.startsWith(prefix)).catch(() => {});
}

/**
 * Refetch when any of `types` arrives — and, by default, after the stream
 * reconnects or while it is polling (events may have been missed).
 * Leading + trailing throttle (default 1 s) so a burst causes at most 2 fetches.
 */
export function useLiveRevalidate(
  types: readonly string[],
  target: LiveRevalidateTarget | null | undefined,
  opts: { throttleMs?: number; onReconnect?: boolean; enabled?: boolean } = {},
): void {
  const targetRef = useRef(target);
  targetRef.current = target;
  const throttleMs = opts.throttleMs ?? 1000;
  const onReconnect = opts.onReconnect !== false;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);

  const run = useCallback(() => {
    const t = targetRef.current;
    if (!t) return;
    try {
      if (typeof t === 'string') revalidateSwrPrefix(t);
      else if (typeof t === 'function') {
        const r = t();
        if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
      } else if (typeof t.match === 'function') {
        void globalMutate((key: unknown) => typeof key === 'string' && t.match(key)).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, []);

  const trigger = useCallback(() => {
    if (timer.current) {
      pending.current = true;
      return;
    }
    run();
    timer.current = setTimeout(function flush() {
      if (pending.current) {
        pending.current = false;
        run();
        timer.current = setTimeout(flush, throttleMs);
      } else {
        timer.current = null;
      }
    }, throttleMs);
  }, [run, throttleMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  const names = onReconnect ? [...types, 'sync.status'] : [...types];
  useLiveEvent(
    names,
    (event) => {
      if (event.type === 'sync' && event.kind === 'status') {
        if (!onReconnect || (event.phase !== 'reconnected' && event.phase !== 'polling')) return;
      }
      trigger();
    },
    { enabled: opts.enabled },
  );
}

/** Live connection status of this tab (status, since, leader). */
export function useLiveStatus(): LiveStatusSnapshot {
  return useSyncExternalStore(subscribeLiveStatus, getLiveStatus, getServerLiveStatus);
}

/** Orders that arrived live in the last 15 min: Map<orderId, arrivedAtMs>. */
export function useRecentLiveOrders(): ReadonlyMap<string, number> {
  return useSyncExternalStore(subscribeRecentOrders, getRecentOrders, getServerRecentOrders);
}

/**
 * Reads `?highlight=<id>` (set by the new-order toast's Open action). Returns
 * the id until `clear()` or `ttlMs` (default 12 s) elapses; clear() also drops
 * the param from the URL (shallow, no refetch).
 */
export function useHighlightParam(param = 'highlight', ttlMs = 12_000): { highlightId: string | null; clear: () => void } {
  const router = useRouter();
  const raw = router?.query?.[param];
  const fromUrl = typeof raw === 'string' && raw ? raw : null;
  const [id, setId] = useState<string | null>(null);

  const clear = useCallback(() => {
    setId(null);
    if (!router || !router.query || router.query[param] === undefined) return;
    const { [param]: _drop, ...rest } = router.query;
    void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true, scroll: false }).catch(() => {});
  }, [router, param]);

  useEffect(() => {
    if (fromUrl) setId(fromUrl);
  }, [fromUrl]);

  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => setId(null), ttlMs);
    return () => clearTimeout(t);
  }, [id, ttlMs]);

  return { highlightId: id, clear };
}
