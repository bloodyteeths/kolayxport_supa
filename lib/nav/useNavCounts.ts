/**
 * Sidebar / tab-bar counters (shell-nav §8, §9.1). Client hook over
 * `GET /api/nav/counts`.
 *
 * Rules from shell-nav §5/§7:
 * - Polls every 60s and on window focus; never while the tab is hidden.
 * - Also revalidates (throttled) on live order / shipment / draft events.
 * - Loading, error and stale (> 10 min old) all give `undefined` counts: the
 *   nav renders nothing rather than a placeholder or a wrong number. A count of
 *   0 is returned as 0; rendering nothing for 0 is the component's rule.
 *
 * This file is isomorphic and holds the response type, so the route imports
 * its type from here (type-only, erased) and the browser never pulls server code.
 */
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';

/** 200 body of `GET /api/nav/counts`. */
export interface NavCountsResponse {
  orders: { toShip: number; overdue: number };
  /** Staged changes not sent yet: draft status `draft | failed | conflict` (not `syncing`, `synced`, `cancelled`). */
  drafts: { etsy: number; ebay: number };
  /** ISO time the server computed the counts. */
  generatedAt: string;
}

export const NAV_COUNTS_KEY = '/api/nav/counts';
export const NAV_COUNTS_REFRESH_MS = 60_000;
/** Older data is hidden instead of shown wrong (shell-nav §5 "Counts"). */
export const NAV_COUNTS_STALE_MS = 10 * 60_000;
/** Live events that can change a count: orders, labels/shipments, staged drafts. */
export const NAV_COUNTS_LIVE_EVENTS = ['order', 'shipment', 'draft'] as const;

export class NavCountsFetchError extends Error {
  status: number;
  constructor(status: number) {
    super(`Failed to load nav counts (${status})`);
    this.status = status;
  }
}

/**
 * The cached SWR value: the response plus the client time it arrived. The
 * receive time lives in the shared cache (not per hook instance) so every
 * consumer — sidebar, tab bar, More sheet, a remounted shell — sees the same
 * freshness, including after deduped requests and live revalidations, which
 * SWR runs in one instance only (its `onSuccess` fires only there).
 */
export type NavCountsCached = NavCountsResponse & { receivedAt: number };

export const navCountsFetcher = async (url: string): Promise<NavCountsCached> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new NavCountsFetchError(res.status);
  const json = (await res.json()) as NavCountsResponse;
  return { ...json, receivedAt: Date.now() };
};

/**
 * True when the data was received more than NAV_COUNTS_STALE_MS before `now`.
 * Measured on the client clock (receive time), so server/client clock skew
 * cannot hide fresh counts.
 */
export function isNavCountsStale(receivedAt: number | null | undefined, now: number): boolean {
  if (receivedAt == null || !Number.isFinite(receivedAt)) return true;
  return now - receivedAt > NAV_COUNTS_STALE_MS;
}

export interface UseNavCountsResult {
  /** Undefined while loading, after an error with no fresh data, or when stale. */
  ordersToShip: number | undefined;
  ordersOverdue: number | undefined;
  /** Unsent staged drafts per marketplace (drives the `attention` dot). */
  unsentDrafts: { etsy: number; ebay: number } | undefined;
  /** The raw response when fresh, else undefined. */
  data: NavCountsCached | undefined;
  error: Error | undefined;
  isLoading: boolean;
  /** Force a refresh (e.g. after creating a label or sending drafts). */
  mutate: () => Promise<NavCountsCached | undefined>;
}

export function useNavCounts(opts: { enabled?: boolean } = {}): UseNavCountsResult {
  const enabled = opts.enabled !== false;
  const { data, error, isLoading, mutate } = useSWR<NavCountsCached>(enabled ? NAV_COUNTS_KEY : null, navCountsFetcher, {
    refreshInterval: NAV_COUNTS_REFRESH_MS,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    dedupingInterval: 10_000,
    keepPreviousData: true,
    shouldRetryOnError: (err: unknown) => !(err instanceof NavCountsFetchError && (err.status === 401 || err.status === 403)),
    errorRetryCount: 5,
  });

  useLiveRevalidate(NAV_COUNTS_LIVE_EVENTS, enabled ? NAV_COUNTS_KEY : null, { throttleMs: 5_000, enabled });

  // A clock for the staleness rule, ticking once a minute (no Date.now() in render).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), NAV_COUNTS_REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled]);

  // `now` may lag a just-received response (negative age) — that is fresh.
  const fresh = enabled && data && !isNavCountsStale(data.receivedAt, now) ? data : undefined;

  return {
    ordersToShip: fresh?.orders.toShip,
    ordersOverdue: fresh?.orders.overdue,
    unsentDrafts: fresh?.drafts,
    data: fresh,
    error: error as Error | undefined,
    isLoading,
    mutate: () => mutate(),
  };
}
