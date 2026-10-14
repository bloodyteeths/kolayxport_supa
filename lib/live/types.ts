/**
 * Live event contract (owner W6-live). Isomorphic: no server imports, so the
 * browser SSE consumer (components/live/*) imports the same types.
 *
 * Server code publishes with lib/live/publish.ts:
 *   publishLive(userId, event)              — any LiveEvent
 *   publishOrderEvent(userId, order, kind)  — order events (new order => sound + live row)
 *
 * The transport (W6) wraps each event in a LiveEnvelope and delivers it to
 * every open tab of that user within seconds (SSE; heartbeat comment every
 * LIVE_HEARTBEAT_MS). Events are hints to refresh/insert UI state; they are
 * not a durable log — clients revalidate via the normal APIs on reconnect.
 *
 * Rules for payloads: small (< 4 KB), JSON-safe (no BigInt/Date — use strings
 * and epoch ms), no secrets, no buyer PII beyond what the orders list already
 * shows (customerName is allowed).
 */

export const LIVE_EVENT_VERSION = 1;
export const LIVE_HEARTBEAT_MS = 20_000;

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * new        — a brand-new order was imported (client: play order sound, insert row)
 * updated    — fields/status changed
 * cancelled  — order cancelled on the marketplace
 * shipped    — marked shipped (by us or externally)
 * delivered  — delivered
 * label_created — a label/shipment was created for it
 */
export type LiveOrderKind = 'new' | 'updated' | 'cancelled' | 'shipped' | 'delivered' | 'label_created';

export type LiveOrderSummary = {
  id: string;
  marketplace: string;
  marketplaceKey: string | null;
  orderNumber: string | null;
  /** Order.source when known: etsy-api | ebay-api | trendyol | shopify | wix | amazon | veeqo | shippo ... */
  source: string | null;
  status: string | null;
  customerName: string | null;
  totalPrice: number | null;
  currency: string | null;
  itemCount: number | null;
  /** ISO strings */
  createdAt: string | null;
  uiOrderDate: string | null;
  shipByAt: string | null;
  /** First item image (absolute https URL only), when known. */
  thumbnail?: string | null;
};

export type LiveOrderEvent = { type: 'order'; kind: LiveOrderKind; order: LiveOrderSummary };

// ---------------------------------------------------------------------------
// Notifications (bell)
// ---------------------------------------------------------------------------

/** Same shape as lib/notifications.ts NotificationItem (GET /api/notifications items[]). */
export type LiveNotificationItem = {
  id: string;
  type: string;
  severity: string;
  titleKey: string;
  params: unknown;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type LiveNotificationEvent =
  /** created or re-raised badge notification; unreadCount when cheaply known */
  | { type: 'notification'; action: 'raised'; notification: LiveNotificationItem; unreadCount?: number }
  /** marked read in some tab (sync other tabs) */
  | { type: 'notification'; action: 'read'; ids?: string[]; all?: boolean; unreadCount?: number }
  /** resolved (disappears from the bell) */
  | { type: 'notification'; action: 'resolved'; dedupeKeys?: string[]; ids?: string[]; unreadCount?: number };

// ---------------------------------------------------------------------------
// Listings / drafts
// ---------------------------------------------------------------------------

export type LiveListingKind = 'created' | 'updated' | 'deactivated' | 'expired' | 'deleted' | 'changed_externally';

export type LiveListingEvent = {
  type: 'listing';
  kind: LiveListingKind;
  marketplace: 'etsy' | 'ebay' | 'trendyol' | 'shopify' | 'wix' | 'amazon';
  shopId: string;
  /** string (Etsy ids exceed int32; never send BigInt) */
  listingId: string;
  title?: string | null;
  state?: string | null;
  /** kolayxport_draft | kolayxport_stock | external | unknown */
  attribution?: string | null;
  versionId?: string | null;
};

export type LiveDraftEvent = {
  type: 'draft';
  kind: 'syncing' | 'synced' | 'failed' | 'conflict' | 'discarded';
  marketplace: 'etsy' | 'ebay';
  draftId: string;
  shopId?: string | null;
  listingId?: string | null;
  error?: string | null;
};

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export type LiveStockEvent = {
  type: 'stock';
  kind: 'changed' | 'push_applied' | 'push_failed' | 'out_of_stock' | 'drift' | 'unmatched_sale' | 'settings_changed';
  stockItemId?: string | null;
  sku?: string | null;
  onHand?: number | null;
  channel?: string | null;
  linkId?: string | null;
};

// ---------------------------------------------------------------------------
// Shipments / labels / tracking
// ---------------------------------------------------------------------------

export type LiveShipmentEvent = {
  type: 'shipment';
  kind: 'created' | 'failed' | 'void_requested' | 'voided' | 'tracking_submitted';
  orderId: string;
  shipmentId?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
};

// ---------------------------------------------------------------------------
// Sync / connection / generic
// ---------------------------------------------------------------------------

export type LiveSyncEvent = {
  type: 'sync';
  /**
   * started/progress/finished/failed — a marketplace sync run (emitters).
   * status — transport-level: sent by the SSE endpoint on connect (hello) and
   * as a periodic data heartbeat, and synthesized by the browser provider
   * while it is polling or after a reconnect. Clients treat it as "you may
   * have missed events — revalidate".
   */
  kind: 'started' | 'progress' | 'finished' | 'failed' | 'status';
  /** etsy | ebay | trendyol | shopify | wix | amazon | veeqo | shippo | listings:<marketplace> | stream ... */
  scope: string;
  newOrders?: number;
  updatedOrders?: number;
  processed?: number;
  total?: number;
  /** kind 'status' only: server epoch ms */
  serverTime?: number;
  /** kind 'status' only: 'hello' on connect, 'heartbeat' periodic, 'reconnected' / 'polling' (client-synthesized) */
  phase?: 'hello' | 'heartbeat' | 'reconnected' | 'polling';
  /** kind 'status' only: 'pg' (LISTEN/NOTIFY fan-out) or 'local' (single-process fallback) */
  transport?: 'pg' | 'local';
  /** kind 'status' phase 'hello' only: liveUserKey() of the stream's user (client drops a foreign stream) */
  userKey?: string;
};

export type LiveConnectionEvent = {
  type: 'connection';
  kind: 'reauth_required' | 'reconnected' | 'disconnected';
  provider: string;
  accountId?: string | null;
};

/** Generic SWR revalidation hint: clients call mutate(key) for each key prefix. */
export type LiveInvalidateEvent = { type: 'invalidate'; keys: string[] };

export type LiveEvent =
  | LiveOrderEvent
  | LiveNotificationEvent
  | LiveListingEvent
  | LiveDraftEvent
  | LiveStockEvent
  | LiveShipmentEvent
  | LiveSyncEvent
  | LiveConnectionEvent
  | LiveInvalidateEvent;

export type LiveEventType = LiveEvent['type'];

/** Wire format (one SSE `data:` line per envelope). */
export type LiveEnvelope = {
  /** Unique per publish (`<epoch36>-<boot>-<seq36>`); used as SSE `id:` for Last-Event-ID resume. */
  id: string;
  v: typeof LIVE_EVENT_VERSION;
  /** epoch ms when published */
  ts: number;
  event: LiveEvent;
  /** Canonical client name, e.g. 'order.new' (see lib/live/names.ts). Set by the transport. */
  name?: string;
};

/** Minimal order shape accepted by publishOrderEvent (a Prisma Order row fits). */
export type LiveOrderInput = {
  id: string;
  marketplace?: string | null;
  marketplaceKey?: string | null;
  orderNumber?: string | null;
  source?: string | null;
  status?: string | null;
  customerName?: string | null;
  totalPrice?: number | string | { toString(): string } | null;
  currency?: string | null;
  createdAt?: Date | string | null;
  uiOrderDate?: Date | string | null;
  shipByAt?: Date | string | null;
  /** items array (only length/quantities are read) or an explicit count */
  items?: Array<{ quantity?: number | null; image?: string | null }> | null;
  itemCount?: number | null;
  /** explicit thumbnail; otherwise the first item `image` is used */
  thumbnail?: string | null;
};
