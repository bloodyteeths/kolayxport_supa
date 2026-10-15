// lib/nav/orderHits.ts — ⌘K live order search (shell-nav §3.6, §11). `toOrderHits` is moved unchanged from
// the legacy components/CommandPalette.tsx. The `kx:labels-search` CustomEvent handoff is removed: it had no
// listener. Until M3 (Orders reads `q` through useUrlState) a hit on the Orders route itself does a full
// navigation (`needsFullNavigation`).

export interface OrderHit {
  id: string;
  orderNumber: string;
  customerName: string;
  marketplace: string;
}

export const ORDER_SEARCH_DEBOUNCE_MS = 250;
export const ORDER_SEARCH_MIN_CHARS = 2;
export const ORDER_SEARCH_LIMIT = 5;
/** The Orders route (legacy path name). */
export const ORDERS_PATH = '/app/labels';

/** Parses `/api/orders` JSON (`{ orders: [...] }`) into at most `limit` hits; anything malformed is skipped. */
export function toOrderHits(raw: unknown, limit: number = ORDER_SEARCH_LIMIT): OrderHit[] {
  if (!raw || typeof raw !== 'object') return [];
  const orders = (raw as Record<string, unknown>).orders;
  if (!Array.isArray(orders)) return [];
  const out: OrderHit[] = [];
  for (const o of orders) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    const orderNumber = typeof r.orderNumber === 'string' ? r.orderNumber : typeof r.orderNumber === 'number' ? String(r.orderNumber) : '';
    if (!orderNumber) continue;
    out.push({
      id: typeof r.id === 'string' ? r.id : orderNumber,
      orderNumber,
      customerName: typeof r.customerName === 'string' ? r.customerName : '',
      marketplace: typeof r.marketplace === 'string' ? r.marketplace : '',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** `/api/orders` query for the palette search (all fields, first page). */
export function orderSearchUrl(query: string, limit: number = ORDER_SEARCH_LIMIT): string {
  const params = new URLSearchParams({ search: query, searchType: 'all', page: '1', limit: String(limit) });
  return `/api/orders?${params.toString()}`;
}

/** Where an order hit (or "Search orders for …") goes: the Orders route filtered by `q`. */
export function orderHitHref(query: string): string {
  return `${ORDERS_PATH}?q=${encodeURIComponent(query)}`;
}

/**
 * True while the palette is opened on the Orders route itself: that page reads its URL filters once on mount
 * (until M3's useUrlState), so a `router.push` would change the URL but not the list.
 */
export function needsFullNavigation(currentPathname: string): boolean {
  return currentPathname === ORDERS_PATH;
}

export type OrderSearchState = { status: 'idle' | 'loading' | 'done' | 'error'; hits: OrderHit[] };

/** One fetch of the order search; throws on a non-2xx response. */
export async function fetchOrderHits(query: string, signal?: AbortSignal): Promise<OrderHit[]> {
  const res = await fetch(orderSearchUrl(query), { credentials: 'same-origin', signal });
  if (!res.ok) throw new Error(`orders search ${res.status}`);
  return toOrderHits(await res.json());
}
