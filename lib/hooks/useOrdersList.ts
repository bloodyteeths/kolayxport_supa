/**
 * Orders list data for the new Orders page (orders §13 frozen contract, owner M3 orders-G1).
 *
 *   const list = useOrdersList({ view: 'to_ship', page: 1, size: 50 });
 *   const one = useOrder(openId);              // ?open=<id>, works off-page (A3)
 *
 * SWR keys start with `/api/orders?`, so the live stream (LiveEventsProvider revalidates the
 * `/api/orders` prefix on order/shipment events and on reconnect) keeps the list and the open
 * order fresh with no extra wiring. The Etsy-extension address and listing-URL enrichment use a
 * second key under the same prefix (`/api/orders#enrichment?…`), so they refresh with the list.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useAsyncState, type AsyncState } from '@/lib/ds/useAsyncState';
import { LIMIT_UI_HEADER, parseLimitResponse, type LimitReachedInfo } from '@/lib/http/limitInterceptor';
import { NAV_COUNTS_KEY } from '@/lib/nav/useNavCounts';
import { revalidateSwrPrefix } from '@/components/live/useLiveEvent';
import { ORDER_VIEWS } from '@/lib/orders/views';
import { toOrderRows, fetchOrderEnrichment } from '@/lib/orders/toOrderRows';
import type {
  ApiOrder,
  OrderDatePreset,
  OrderEnrichment,
  OrderRow,
  OrdersApiResponse,
  OrderSortKey,
  OrdersQuery,
  ViewCounts,
} from '@/lib/orders/types';

export const ORDERS_PAGE_SIZES = [50, 100, 250] as const;
export const DEFAULT_ORDERS_PAGE_SIZE = 50;
export const ORDERS_API = '/api/orders';
export const ORDERS_SYNC_API = '/api/orders/sync';
const EMPTY_NAMES: string[] = [];

/** API `sortBy` per UI sort key (index.ts orderByClauses). */
const SORT_BY: Record<OrderSortKey, string> = {
  orderedAt: 'orderDate',
  shipBy: 'shipBy',
  total: 'price',
  customer: 'customer',
  store: 'store',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Date preset → local ISO days (`to` inclusive). `any` → no bounds. */
export function resolveDatePreset(preset: OrderDatePreset, now: Date = new Date()): { from?: string; to?: string } {
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return localDay(d);
  };
  switch (preset) {
    case 'today':
      return { from: day(0) };
    case 'last7':
      return { from: day(7) };
    case 'last30':
      return { from: day(30) };
    case 'last90':
      return { from: day(90) };
    case 'thisMonth':
      return { from: localDay(new Date(now.getFullYear(), now.getMonth(), 1)) };
    case 'lastMonth':
      return {
        from: localDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: localDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'any':
    default:
      return {};
  }
}

/**
 * The effective date window: `preset` wins, then explicit `from`/`to`, then the view's default
 * preset (orders §1.3: Shipped and All = last 30 days, the others undated).
 */
export function effectiveDates(q: OrdersQuery, now: Date = new Date()): { from?: string; to?: string } {
  if (q.preset) return resolveDatePreset(q.preset, now);
  const from = q.from && ISO_DAY.test(q.from) ? q.from : undefined;
  const to = q.to && ISO_DAY.test(q.to) ? q.to : undefined;
  if (from || to) return { from, to };
  return resolveDatePreset(ORDER_VIEWS[q.view]?.defaultPreset ?? 'any', now);
}

/** `/api/orders` params for a query (A1: `view`, normalized `status`, `include=counts`). */
export function ordersApiParams(q: OrdersQuery, now: Date = new Date()): URLSearchParams {
  const view = ORDER_VIEWS[q.view] ? q.view : 'to_ship';
  const def = ORDER_VIEWS[view];
  const p = new URLSearchParams();
  p.set('view', view);
  p.set('page', String(Math.max(1, Math.floor(q.page ?? 1))));
  p.set('limit', String(Math.min(250, Math.max(1, Math.floor(q.size ?? DEFAULT_ORDERS_PAGE_SIZE)))));
  const search = (q.q ?? '').trim();
  if (search) {
    p.set('search', search);
    if (q.in && q.in !== 'all') p.set('searchType', q.in);
  }
  for (const s of q.store ?? []) if (s) p.append('marketplace', s);
  for (const s of q.status ?? []) if (s) p.append('status', s);
  // The API ignores dates while searching ("Search covers all dates"); not sending them keeps the key stable.
  if (!search) {
    const { from, to } = effectiveDates({ ...q, view }, now);
    if (from) p.set('startDate', from);
    if (to) p.set('endDate', to);
  }
  const sort = q.sort ?? def.sort;
  p.set('sortBy', SORT_BY[sort] ?? 'orderDate');
  p.set('sort', q.dir ?? (q.sort ? (sort === 'shipBy' || sort === 'customer' || sort === 'store' ? 'asc' : 'desc') : def.dir));
  p.set('include', 'counts');
  return p;
}

/** SWR key of the list (`/api/orders?…`). */
export function ordersListKey(q: OrdersQuery, now: Date = new Date()): string {
  return `${ORDERS_API}?${ordersApiParams(q, now).toString()}`;
}

/** SWR key of one order (A3). */
export function orderKey(id: string): string {
  return `${ORDERS_API}?${new URLSearchParams({ ids: id }).toString()}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`GET ${url} failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Enrichment (EtsyAddress + listing URLs) for the orders of one response, under the `/api/orders` prefix. */
function useEnrichment(orders: ApiOrder[] | undefined): OrderEnrichment | undefined {
  const ordersRef = useRef<ApiOrder[]>([]);
  ordersRef.current = orders ?? [];
  const ids = useMemo(() => (orders ?? []).map((o) => o.id).join(','), [orders]);
  const { data } = useSWR<OrderEnrichment>(
    ids ? `${ORDERS_API}#enrichment?${new URLSearchParams({ ids }).toString()}` : null,
    () => fetchOrderEnrichment(ordersRef.current),
    { revalidateOnFocus: false, keepPreviousData: true, shouldRetryOnError: false },
  );
  return data;
}

export type PullState = 'idle' | 'pulling' | 'failed';
export interface PullError {
  /** HTTP status (0 = network). */
  status: number;
  /** Set on 402: render the usage `Banner` instead of the failed SyncMeta (orders §7.1). */
  limit: LimitReachedInfo | null;
}

export interface OrdersListResult {
  rows: OrderRow[];
  total: number;
  counts?: ViewCounts;
  /** A4 (newest of `User.lastSyncedAt` and the last completed order SyncOperation); undefined while loading, `undefined` also when the account never pulled. */
  lastPulledAt?: string;
  state: AsyncState;
  mutate(): Promise<unknown>;
  /** "Refresh orders" (`POST /api/orders/sync { syncType: 'fast' }`). Never rejects; read `pullState`/`pullError`. */
  pull(): Promise<void>;
  pulling: boolean;
  pullState: PullState;
  pullError: PullError | null;
  /** Revalidating with rows on screen (filter change / live refresh): show "Updating…". */
  isValidating: boolean;
  error?: unknown;
  page: number;
  pageSize: number;
  /** The user's Etsy shop names: pass to `canonicalStore(value, etsyShopNames)` for the Store filter options. */
  etsyShopNames: string[];
}

/** The list for the Orders page. */
export function useOrdersList(q: OrdersQuery): OrdersListResult {
  const key = ordersListKey(q);
  const swr = useSWR<OrdersApiResponse>(key, fetchJson, {
    keepPreviousData: true,
    refreshInterval: 120_000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 1000,
    shouldRetryOnError: true,
    errorRetryCount: 2,
    errorRetryInterval: 1500,
  });
  const { data, mutate } = swr;
  const state = useAsyncState(swr, { isEmpty: (d) => !d?.orders || d.orders.length === 0 });
  const enrichment = useEnrichment(data?.orders);
  const rows = useMemo(
    () => toOrderRows(data?.orders, { enrichment, etsyShopNames: data?.etsyShopNames ?? [] }),
    [data, enrichment],
  );

  const [pullState, setPullState] = useState<PullState>('idle');
  const [pullError, setPullError] = useState<PullError | null>(null);
  const pullingRef = useRef(false);

  const pull = useCallback(async () => {
    if (pullingRef.current) return;
    pullingRef.current = true;
    setPullState('pulling');
    setPullError(null);
    try {
      // Inline header: the page shows the 402 as a Banner, not the global limit dialog.
      const res = await fetch(ORDERS_SYNC_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' },
        body: JSON.stringify({ syncType: 'fast' }),
      });
      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          /* non-JSON error */
        }
        setPullError({ status: res.status, limit: res.status === 402 ? parseLimitResponse(body, ORDERS_SYNC_API) : null });
        setPullState('failed');
        return;
      }
      setPullState('idle');
      revalidateSwrPrefix(ORDERS_API);
      await Promise.all([mutate(), globalMutate(NAV_COUNTS_KEY)]).catch(() => undefined);
    } catch {
      setPullError({ status: 0, limit: null });
      setPullState('failed');
    } finally {
      pullingRef.current = false;
    }
  }, [mutate]);

  return {
    rows,
    total: data?.total ?? 0,
    counts: data?.counts,
    lastPulledAt: data?.lastPulledAt ?? undefined,
    state,
    mutate: () => mutate(),
    pull,
    pulling: pullState === 'pulling',
    pullState,
    pullError,
    isValidating: swr.isValidating && data !== undefined,
    error: swr.error,
    page: data?.page ?? q.page ?? 1,
    pageSize: data?.pageSize ?? q.size ?? DEFAULT_ORDERS_PAGE_SIZE,
    etsyShopNames: data?.etsyShopNames ?? EMPTY_NAMES,
  };
}

/**
 * One order by id (A3), for `?open=` when the order is not on the current page.
 * `state === 'empty'` = the order does not exist (or is not this user's): "This order no longer exists".
 */
export function useOrder(id: string | null): { row?: OrderRow; state: AsyncState; mutate(): Promise<unknown> } {
  const swr = useSWR<OrdersApiResponse>(id ? orderKey(id) : null, fetchJson, {
    revalidateOnFocus: true,
    shouldRetryOnError: true,
    errorRetryCount: 2,
  });
  const { data, mutate } = swr;
  const state = useAsyncState(swr, { isEmpty: (d) => !d?.orders || d.orders.length === 0 });
  const enrichment = useEnrichment(data?.orders);
  const row = useMemo(
    () => toOrderRows(data?.orders, { enrichment, etsyShopNames: data?.etsyShopNames ?? [] }).find((r) => r.id === id),
    [data, enrichment, id],
  );
  return { row, state, mutate: () => mutate() };
}
