/**
 * Live event names (owner W6-live). Isomorphic, pure.
 *
 * The wire carries structured events ({ type: 'order', kind: 'new' }); UI code
 * subscribes by dotted NAME. Every event answers to several names so callers
 * can be as broad or as specific as they like:
 *
 *   canonical   `${type}.${kind|action}`     order.new, notification.raised, stock.out_of_stock
 *   aliases     friendly groupings            order.canceled, notification.new, listing.changed,
 *                                             listing.removed, stock.changed, stock.alert
 *   type        `${type}` and `${type}.*`     order, order.*
 *   wildcard    '*'
 *
 * Alias table (keep in sync with docs/integration/parts/W6-live.md):
 *   order.cancelled                      -> order.canceled
 *   shipment.*                           -> order.updated   (orders page shows shipments)
 *   notification.raised                  -> notification.new
 *   notification.*                       -> notification.changed
 *   listing.created|updated|deactivated|expired|changed_externally -> listing.changed
 *   listing.deleted                      -> listing.removed
 *   draft.*                              -> listing.changed  (the listings page shows draft state)
 *   stock.changed|push_applied|settings_changed -> stock.changed
 *   stock.out_of_stock|drift|unmatched_sale|push_failed -> stock.alert
 */
import type { LiveEvent, LiveEventType } from './types';

const ALIASES: Record<string, string[]> = {
  'order.cancelled': ['order.canceled'],
  'notification.raised': ['notification.new', 'notification.changed'],
  'notification.read': ['notification.changed'],
  'notification.resolved': ['notification.changed'],
  'listing.created': ['listing.changed'],
  'listing.updated': ['listing.changed'],
  'listing.deactivated': ['listing.changed'],
  'listing.expired': ['listing.changed'],
  'listing.changed_externally': ['listing.changed'],
  'listing.deleted': ['listing.removed'],
  'stock.changed': [],
  'stock.push_applied': ['stock.changed'],
  'stock.settings_changed': ['stock.changed'],
  'stock.out_of_stock': ['stock.alert', 'stock.changed'],
  'stock.drift': ['stock.alert'],
  'stock.unmatched_sale': ['stock.alert'],
  'stock.push_failed': ['stock.alert'],
};

const TYPE_ALIASES: Partial<Record<LiveEventType, string[]>> = {
  shipment: ['order.updated'],
  draft: ['listing.changed'],
};

/** Canonical dotted name: `${type}.${kind|action}`; `invalidate` for invalidate events. */
export function liveEventName(ev: LiveEvent | null | undefined): string {
  if (!ev || typeof ev !== 'object' || typeof (ev as { type?: unknown }).type !== 'string') return 'unknown';
  const e = ev as { type: string; kind?: unknown; action?: unknown };
  const sub = typeof e.kind === 'string' ? e.kind : typeof e.action === 'string' ? e.action : '';
  return sub ? `${e.type}.${sub}` : e.type;
}

/** Every name the event answers to (canonical first). */
export function liveEventNames(ev: LiveEvent | null | undefined): string[] {
  const canonical = liveEventName(ev);
  if (canonical === 'unknown') return [];
  const type = (ev as { type: string }).type;
  const out = new Set<string>([canonical]);
  for (const a of ALIASES[canonical] || []) out.add(a);
  for (const a of TYPE_ALIASES[type as LiveEventType] || []) out.add(a);
  out.add(type);
  out.add(`${type}.*`);
  out.add('*');
  return Array.from(out);
}

/** True when the event answers to any of `patterns` (names, aliases, `type`, `type.*`, `*`). */
export function matchesLiveNames(ev: LiveEvent | null | undefined, patterns: readonly string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  const names = liveEventNames(ev);
  if (names.length === 0) return false;
  for (const p of patterns) if (names.includes(p)) return true;
  return false;
}

/**
 * SWR key prefixes the browser provider revalidates automatically for each
 * event type (global `mutate(key => key.startsWith(prefix))`). Pages whose data
 * lives under these keys need no live wiring at all.
 */
export const LIVE_SWR_PREFIXES: Partial<Record<LiveEventType, string[]>> = {
  order: ['/api/orders'],
  shipment: ['/api/orders', '/api/shipments'],
  notification: ['/api/notifications'],
  stock: ['/api/stock'],
  connection: ['/api/integrations/status'],
};

/**
 * Short, stable, non-reversible-at-a-glance key for a user id (FNV-1a 64-bit as
 * two 32-bit lanes, hex). Isomorphic and synchronous: the SSE hello carries it
 * and the browser compares it with its own session's key, and the cross-tab
 * BroadcastChannel / Web Lock names are scoped by it, so a stream opened for
 * one account is never consumed or relayed by another account's tabs.
 */
export function liveUserKey(userId: string | null | undefined): string {
  const s = String(userId ?? '');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c ^ (h1 >>> 7), 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
