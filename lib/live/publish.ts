/**
 * Live event publishing (owner W6-live). Server-only (imports the pg bus).
 *
 * Signatures — callers in every workstream code against these:
 *   publishLive(userId, event): void
 *   publishOrderEvent(userId, order, kind): void
 *   publishNewOrders(userId, orders, opts?): void     (batch importers)
 *
 * All are fire-and-forget and NEVER throw (safe on hot paths and inside
 * catch blocks). Call them AFTER the DB write commits — the browser refetches
 * on receipt, so publishing inside an open transaction races the commit.
 *
 * Transport: lib/live/bus.ts (Postgres NOTIFY kx_live -> LISTEN in the Next
 * server -> SSE /api/live/stream -> every open tab). Works from any process
 * (Next server, in-process worker, tsx scripts, cron endpoints).
 */
import type { LiveEvent, LiveOrderEvent, LiveOrderInput, LiveOrderKind } from './types';
import { publishToBus } from './bus';

export function publishLive(userId: string, event: LiveEvent): void {
  try {
    if (!userId || !event) return;
    publishToBus(userId, event);
  } catch {
    /* never throw into callers */
  }
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown, max = 200): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s ? s.slice(0, max) : null;
}

/** Only absolute http(s) URLs of sane length (never data: URIs — they would blow the NOTIFY limit). */
function thumb(order: LiveOrderInput): string | null {
  const candidates: unknown[] = [order.thumbnail];
  if (Array.isArray(order.items)) for (const it of order.items) candidates.push(it?.image);
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//i.test(c) && c.length <= 600) return c;
  }
  return null;
}

/** Pure: Order-like row -> LiveOrderEvent (JSON-safe, small). */
export function buildOrderLiveEvent(order: LiveOrderInput, kind: LiveOrderKind): LiveOrderEvent {
  let itemCount: number | null = num(order.itemCount);
  if (itemCount === null && Array.isArray(order.items)) {
    itemCount = order.items.reduce((sum, it) => sum + (num(it?.quantity) ?? 1), 0);
  }
  return {
    type: 'order',
    kind,
    order: {
      id: String(order.id),
      marketplace: str(order.marketplace) || 'unknown',
      marketplaceKey: str(order.marketplaceKey),
      orderNumber: str(order.orderNumber),
      source: str(order.source),
      status: str(order.status),
      customerName: str(order.customerName),
      totalPrice: num(order.totalPrice),
      currency: str(order.currency, 8),
      itemCount,
      createdAt: iso(order.createdAt),
      uiOrderDate: iso(order.uiOrderDate),
      shipByAt: iso(order.shipByAt),
      thumbnail: thumb(order) ?? undefined,
    },
  };
}

export function publishOrderEvent(userId: string, order: LiveOrderInput, kind: LiveOrderKind): void {
  try {
    if (!userId || !order?.id) return;
    publishLive(userId, buildOrderLiveEvent(order, kind));
  } catch {
    /* never throw into callers */
  }
}

/** Orders older than this are history (first import / backfill), not "a new order just came in". */
export const LIVE_NEW_ORDER_MAX_AGE_MS = 72 * 3600_000;

/**
 * Batch helper for importers (orderSync batches, pollers, backfills).
 * - Orders whose marketplace order date is older than `maxAgeMs` are NOT
 *   announced as `new` (no chime for a 500-order first import).
 * - At most `maxIndividual` newest orders get their own `order.new` event; the
 *   rest are summarised in one `sync.finished { newOrders }` so the tab
 *   revalidates once instead of receiving a flood.
 * Never throws.
 */
export function publishNewOrders(
  userId: string,
  orders: LiveOrderInput[] | null | undefined,
  opts: { scope?: string; maxIndividual?: number; maxAgeMs?: number; now?: number } = {},
): void {
  try {
    if (!userId || !Array.isArray(orders) || orders.length === 0) return;
    const now = opts.now ?? Date.now();
    const maxAge = opts.maxAgeMs ?? LIVE_NEW_ORDER_MAX_AGE_MS;
    const maxIndividual = opts.maxIndividual ?? 10;
    const dated = orders
      .filter((o) => o && o.id)
      .map((o) => {
        const d = iso(o.uiOrderDate) ?? iso(o.createdAt);
        return { o, t: d ? Date.parse(d) : now };
      });
    const fresh = dated.filter((x) => now - x.t <= maxAge).sort((a, b) => b.t - a.t);
    const individual = fresh.slice(0, maxIndividual);
    for (const { o } of individual) publishLive(userId, buildOrderLiveEvent(o, 'new'));
    const rest = dated.length - individual.length;
    if (rest > 0) {
      publishLive(userId, { type: 'sync', kind: 'finished', scope: opts.scope || 'orders', newOrders: rest });
    }
  } catch {
    /* never throw into callers */
  }
}

/**
 * Prisma `select` that yields exactly what buildOrderLiveEvent reads:
 *   const row = await prisma.order.findUnique({ where: { id }, select: LIVE_ORDER_SELECT });
 *   if (row) publishOrderEvent(userId, row, 'new');
 */
export const LIVE_ORDER_SELECT = {
  id: true,
  marketplace: true,
  marketplaceKey: true,
  orderNumber: true,
  source: true,
  status: true,
  customerName: true,
  totalPrice: true,
  currency: true,
  createdAt: true,
  uiOrderDate: true,
  shipByAt: true,
  items: { select: { quantity: true, image: true } },
} as const;
