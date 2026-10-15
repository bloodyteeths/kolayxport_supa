// lib/ds/status/orders.ts — DS §3.9 order/label domains, orders §4.2 (one pill per row, priority list).
// Pure, no I/O. Raw marketplace values always go to the pill tooltip (`raw`).

import { normalizeRaw, type OrderStatusKey } from './vocabulary';

const CANCELLED = new Set(['cancelled', 'canceled', 'cancel', 'iptal', 'iptal_edildi', 'cancelled_by_seller', 'cancelled_by_buyer']);
const REFUNDED = new Set(['refunded', 'fully_refunded', 'returned', 'iade', 'iade_edildi']);
const DELIVERED = new Set(['delivered', 'completed', 'complete', 'teslim_edildi']);
const SHIPPED = new Set([
  'shipped',
  'partially_shipped',
  'kargolandi',
  'kargoda',
  'is_shipped',
  'fulfilled',
  'partially_fulfilled',
  'in_transit',
  'at_collection_point',
]);
const ON_HOLD = new Set(['on_hold', 'onhold', 'hold', 'held']);
const PROBLEM = new Set(['undelivered', 'un_delivered', 'unfulfillable', 'unsupplied', 'un_supplied', 'problem']);

/**
 * Raw marketplace status → order key, without row context (finance breakdown, messages rail).
 * Rules 1–3 and 8 of orders §4.2 plus explicit problem states (Trendyol `UnDelivered`/`UnSupplied`,
 * Amazon `Unfulfillable`). Anything else is a live order → `to_ship` (Amazon `Pending` included).
 * `marketplace` is accepted for marketplace-specific overrides; none are needed today.
 */
export function orderStatus(raw: string | null | undefined, marketplace?: string | null): OrderStatusKey {
  void marketplace;
  const r = normalizeRaw(raw);
  if (CANCELLED.has(r)) return 'cancelled';
  if (REFUNDED.has(r)) return 'refunded';
  if (DELIVERED.has(r)) return 'delivered';
  if (SHIPPED.has(r)) return 'shipped';
  if (PROBLEM.has(r)) return 'problem';
  if (ON_HOLD.has(r)) return 'on_hold';
  return 'to_ship';
}

/** Whether `orderStatus(raw)` is a terminal (no-action) state. */
export function isClosedOrderStatus(key: OrderStatusKey): boolean {
  return key === 'cancelled' || key === 'refunded' || key === 'delivered' || key === 'shipped';
}

export type OrderRowStatusReason =
  /** Fulfilled by Amazon: never overdue, never labelable. */
  | 'fba'
  /** `addressMissing` lists the missing fields. */
  | 'address_incomplete'
  /** Etsy shared no address for this order. */
  | 'address_unavailable'
  /** Label creation failed; `detail` = carrier error message. */
  | 'label_error';

export interface OrderRowStatusInput {
  /** Raw marketplace status ("paid", "Shipped", "NOT_FULFILLED"). */
  rawStatus: string | null | undefined;
  marketplace?: string | null;
  isFBA?: boolean;
  /** Latest LabelJob failed or Order.labelStatus === 'failed'. */
  labelFailed?: boolean;
  labelError?: string | null;
  /** A label exists (Shipment created with tracking or PDF, LabelJob created, Order.trackingNumber/shippingLabelUrl,
   *  labelStatus 'created'). Trendyol `cargoTrackingNumber` alone does not count; `labelStatus 'voided'` = no label. */
  hasLabel?: boolean;
  /** Missing ship-to fields (postal code, city…). */
  addressMissing?: readonly string[];
  /** No address at all because the marketplace withholds it (Etsy). */
  addressUnavailable?: boolean;
  /** Effective ship-by (lib/orders/views.ts EFFECTIVE_SHIP_BY). */
  shipBy?: Date | string | number | null;
  now?: Date;
}

export type OrderRowStatus =
  | { domain: 'order'; key: OrderStatusKey; raw: string; reason?: OrderRowStatusReason; detail?: string }
  | { domain: 'label'; key: 'label_failed'; raw: string; reason: 'label_error'; detail?: string };

/** orders §4.2: one pill per row, first match wins. */
export function orderRowStatus(row: OrderRowStatusInput): OrderRowStatus {
  const raw = String(row.rawStatus ?? '');
  const base = orderStatus(raw, row.marketplace);

  // 1–3: terminal raw states
  if (base === 'cancelled' || base === 'refunded' || base === 'delivered' || base === 'shipped') {
    return { domain: 'order', key: base, raw, ...(row.isFBA ? { reason: 'fba' as const } : {}) };
  }
  // 4: label failed
  if (row.labelFailed) {
    return { domain: 'label', key: 'label_failed', raw, reason: 'label_error', ...(row.labelError ? { detail: row.labelError } : {}) };
  }
  // 5: FBA — never overdue, never labelable
  if (row.isFBA) return { domain: 'order', key: 'to_ship', raw, reason: 'fba' };
  // 6: has a label
  if (row.hasLabel) return { domain: 'order', key: 'label_created', raw };
  // 7: address incomplete
  if (row.addressUnavailable) return { domain: 'order', key: 'problem', raw, reason: 'address_unavailable' };
  if (row.addressMissing && row.addressMissing.length > 0) {
    return { domain: 'order', key: 'problem', raw, reason: 'address_incomplete', detail: row.addressMissing.join(', ') };
  }
  // 8: on hold (raw) — also explicit problem raw states keep their key
  if (base === 'on_hold' || base === 'problem') return { domain: 'order', key: base, raw };
  // 9: effective ship-by
  const shipBy = row.shipBy == null ? null : new Date(row.shipBy);
  const now = row.now ?? new Date();
  if (shipBy && Number.isFinite(shipBy.getTime()) && shipBy.getTime() < now.getTime()) {
    return { domain: 'order', key: 'overdue', raw };
  }
  return { domain: 'order', key: 'to_ship', raw };
}
