/**
 * Order status vocabulary helpers (W4). Pure, isomorphic.
 *
 * Order.status is a free string written by many mappers (Etsy 'PAID',
 * Veeqo 'awaiting_fulfillment', Trendyol 'Created', submit-tracking 'shipped',
 * legacy rows in mixed case). Everything that needs a decision on it goes
 * through classifyOrderStatus so all call sites agree.
 */
import type { LiveOrderKind } from '@/lib/live/types';

export type OrderStatusClass = 'open' | 'shipped' | 'delivered' | 'cancelled';

const CANCELLED = new Set(['CANCELLED', 'CANCELED', 'REFUNDED', 'FULLY REFUNDED', 'FULLY_REFUNDED', 'UNSUPPLIED', 'VOIDED']);
const DELIVERED = new Set(['DELIVERED', 'COMPLETED_DELIVERED']);
const SHIPPED = new Set(['SHIPPED', 'COMPLETED', 'FULFILLED', 'IN_TRANSIT', 'INTRANSIT', 'PARTIALLY_SHIPPED', 'DISPATCHED', 'AT_COLLECTION_POINT']);

function norm(s: unknown): string {
  return typeof s === 'string' ? s.trim().toUpperCase() : '';
}

/** CANCELLED / CANCELED / REFUNDED (case-insensitive) on status or externalStatus. */
export function isCancelledStatus(status?: string | null, externalStatus?: string | null): boolean {
  return CANCELLED.has(norm(status)) || CANCELLED.has(norm(externalStatus));
}

export function classifyOrderStatus(
  status?: string | null,
  externalStatus?: string | null,
  deliveredAt?: Date | string | null,
): OrderStatusClass {
  if (isCancelledStatus(status, externalStatus)) return 'cancelled';
  const s = norm(status);
  if (deliveredAt || DELIVERED.has(s)) return 'delivered';
  if (SHIPPED.has(s)) return 'shipped';
  return 'open';
}

/** Open orders the dispatch view cares about: PAID / AWAITING_* etc. */
export function isOpenStatus(status?: string | null, externalStatus?: string | null): boolean {
  return classifyOrderStatus(status, externalStatus) === 'open';
}

/** An order placed within this window counts as "new" (sound + orderNew notification). */
export const NEW_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isRecentOrderDate(orderDate: Date | string | number | null | undefined, now = Date.now()): boolean {
  if (orderDate === null || orderDate === undefined || orderDate === '') return true; // unknown date: treat as new
  const t = orderDate instanceof Date ? orderDate.getTime() : typeof orderDate === 'number' ? orderDate : Date.parse(orderDate);
  if (!Number.isFinite(t)) return true;
  return now - t < NEW_ORDER_WINDOW_MS;
}

/**
 * Which live event (if any) an order write should publish.
 *  - created + open + recent        -> 'new' (client plays the order sound)
 *  - created otherwise (backfill)   -> 'updated' (silent insert)
 *  - status class changed           -> 'cancelled' | 'shipped' | 'delivered' | 'updated'
 *  - other field changes            -> 'updated'
 *  - nothing changed                -> null (publish nothing)
 */
export function liveKindForOrderWrite(a: {
  created: boolean;
  prev?: OrderStatusClass | null;
  next: OrderStatusClass;
  changed: boolean;
  recent: boolean;
}): LiveOrderKind | null {
  if (a.created) return a.next === 'open' && a.recent ? 'new' : 'updated';
  if (a.prev && a.prev !== a.next) {
    if (a.next === 'cancelled') return 'cancelled';
    if (a.next === 'shipped') return 'shipped';
    if (a.next === 'delivered') return 'delivered';
    return 'updated';
  }
  return a.changed ? 'updated' : null;
}

/**
 * Etsy receipt -> Order.status. A canceled order can still have
 * was_paid/was_shipped=true, so the cancel check has to win over both.
 */
export function mapEtsyReceiptStatus(receipt: any): string {
  const externalStatus = typeof receipt?.status === 'string' ? receipt.status : '';
  if (
    receipt?.is_dead ||
    receipt?.is_refunded ||
    externalStatus === 'Canceled' ||
    externalStatus === 'Cancelled' ||
    externalStatus === 'Fully Refunded'
  ) {
    return 'CANCELLED';
  }
  if (receipt?.is_shipped || receipt?.was_shipped) return 'SHIPPED';
  if (receipt?.is_paid || receipt?.was_paid) return 'PAID';
  if (externalStatus === 'Completed') return 'SHIPPED';
  if (externalStatus === 'Paid') return 'PAID';
  return 'AWAITING_FULFILLMENT';
}

/**
 * Order-level (FedEx, pre-Shipment) label still counts as active: labelStatus
 * 'created' or a stored label URL, unless the seller marked it voided
 * (POST /api/shipments/order:<id>/void confirm_manual sets labelStatus 'voided').
 */
export function hasLegacyOrderLabel(o: { labelStatus: string | null | undefined; shippingLabelUrl: string | null | undefined }): boolean {
  if (String(o.labelStatus || '').toLowerCase() === 'voided') return false;
  return o.labelStatus === 'created' || !!o.shippingLabelUrl;
}
