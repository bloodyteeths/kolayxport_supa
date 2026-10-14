/**
 * Etsy webhook event vocabulary and payload parsing (owner W1). Pure.
 *
 * Shared by the ingest route, the worker and the processor compatibility
 * wrappers so none of them has to import the others.
 */

export const ETSY_WEBHOOK_PROVIDER = 'etsy';

export const LISTING_EVENTS = new Set(['listing.created', 'listing.updated', 'listing.deleted']);
export const INVENTORY_EVENTS = new Set(['inventory.created', 'inventory.updated', 'inventory.deleted', 'inventory.out_of_stock']);
export const ORDER_EVENTS = new Set(['order.paid', 'order.canceled', 'order.shipped', 'order.delivered']);
/** Synthetic events enqueued by our own reconcile/poll jobs (enqueueSyntheticEtsyEvent). */
export const SYNTHETIC_LISTING_EVENTS = new Set(['reconcile.changed']);
export const SYNTHETIC_ORDER_EVENTS = new Set(['reconcile.order']);

/** Queue statuses (WebhookEvent.status) used for Etsy rows. 'failed' is terminal. */
export const ETSY_EVENT_STATUSES = ['received', 'processing', 'done', 'ignored', 'coalesced', 'blocked_reauth', 'failed'] as const;

export function isSupportedEtsyEvent(eventType: string): boolean {
  return LISTING_EVENTS.has(eventType) || INVENTORY_EVENTS.has(eventType) || ORDER_EVENTS.has(eventType);
}

export function isOrderEventType(eventType: string): boolean {
  return ORDER_EVENTS.has(eventType) || SYNTHETIC_ORDER_EVENTS.has(eventType);
}

export function isListingEventType(eventType: string): boolean {
  return LISTING_EVENTS.has(eventType) || INVENTORY_EVENTS.has(eventType) || SYNTHETIC_LISTING_EVENTS.has(eventType);
}

/** Queue priority: order.* = 0 (critical), inventory.out_of_stock = 1, everything else = 2. */
export function etsyEventPriority(eventType: string): number {
  if (isOrderEventType(eventType)) return 0;
  if (eventType === 'inventory.out_of_stock') return 1;
  return 2;
}

function digits(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
  if (typeof v === 'string' && /^\d+$/.test(v)) return v;
  return null;
}

export function receiptIdFromPayload(payload: any): string | null {
  const direct = digits(payload?.receipt_id);
  if (direct) return direct;
  const url = typeof payload?.resource_url === 'string' ? payload.resource_url : '';
  const m = url.match(/\/receipts\/(\d+)/);
  return m ? m[1] : null;
}

export function listingIdFromPayload(payload: any): string | null {
  const direct = digits(payload?.listing_id);
  if (direct) return direct;
  const url = typeof payload?.resource_url === 'string' ? payload.resource_url : '';
  const m = url.match(/\/listings\/(\d+)/);
  return m ? m[1] : null;
}

/** Coalescing key: listing + inventory events share one per listing. */
export function resourceKeyFor(eventType: string, payload: any): string | null {
  if (LISTING_EVENTS.has(eventType) || INVENTORY_EVENTS.has(eventType)) {
    const id = listingIdFromPayload(payload);
    return id ? `listing:${id}` : null;
  }
  if (ORDER_EVENTS.has(eventType)) {
    const id = receiptIdFromPayload(payload);
    return id ? `receipt:${id}` : null;
  }
  return null;
}

/** 'listing:123' -> { kind: 'listing', id: '123' } */
export function parseResourceKey(resourceKey: string | null | undefined): { kind: 'listing' | 'receipt'; id: string } | null {
  const m = /^(listing|receipt):(\d+)$/.exec(String(resourceKey || ''));
  return m ? { kind: m[1] as 'listing' | 'receipt', id: m[2] } : null;
}
