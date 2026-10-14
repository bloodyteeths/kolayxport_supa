/**
 * OrderEffect transactional outbox (W4 T6/T7).
 *
 * Writers derive effect rows from the order's resulting STATE (not from the
 * transition edge) and insert them in the same transaction as the order
 * write with ON CONFLICT DO NOTHING (@@unique([orderId, effect])). A crash
 * after the commit therefore never loses a side effect, and a replayed or
 * coalesced event never duplicates one.
 *
 * The drain claims due rows (FOR UPDATE SKIP LOCKED + lease), runs each
 * effect idempotently against the CURRENT order state and retries with
 * backoff [30s, 2m, 10m, 1h]; after 6 attempts the row is 'failed' and a
 * system event is logged.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { logSystemEvent } from '@/lib/admin/events';
import { notify, resolveNotification, NOTIFICATION_LINKS } from '@/lib/notifications';
import { publishLive } from '@/lib/live/publish';
import { hasLegacyOrderLabel, type OrderStatusClass } from './orderStatus';

type Db = PrismaClient | Prisma.TransactionClient;

export const EFFECT_MAX_ATTEMPTS = 6;
export const EFFECT_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000];
const CLAIM_LEASE_MS = 5 * 60_000;

export type EffectSource = 'webhook' | 'poll' | 'reconcile' | 'manual' | 'sync';

export type DerivedEffect = { effect: string; status: 'pending' | 'done' };

export const orderNotificationKeys = {
  newOrder: (orderId: string) => `order:new:${orderId}`,
  cancelled: (orderId: string) => `order:cancelled:${orderId}`,
  cancelledAfterLabel: (orderId: string) => `order:cancelled_after_label:${orderId}`,
  shippedExternal: (orderId: string) => `order:shipped_external:${orderId}`,
};

/**
 * Pure: effect rows implied by an order's state.
 *
 * `quiet` = the state is historical (a backfilled order older than the new
 * window, or a pre-W4 row first seen by the pipeline long after it changed):
 * user-facing alerts are inserted as 'done' so they never fire, while
 * housekeeping effects (tracking queue closing, stock, metrics) still run.
 * `includeStock` / `includeTracking` let non-Etsy writers opt out of effects
 * that only make sense for direct Etsy receipts.
 */
export function deriveOrderEffects(a: {
  statusClass: OrderStatusClass;
  itemsHash: string | null;
  quiet: boolean;
  includeStock?: boolean;
  includeShipped?: boolean;
}): DerivedEffect[] {
  const alert = (effect: string): DerivedEffect => ({ effect, status: a.quiet ? 'done' : 'pending' });
  const work = (effect: string): DerivedEffect => ({ effect, status: 'pending' });
  const out: DerivedEffect[] = [];
  // notify_new is always derived; for anything but a fresh open order it is born 'done'.
  out.push(a.statusClass === 'open' ? alert('notify_new') : { effect: 'notify_new', status: 'done' });
  if (a.includeStock !== false && a.itemsHash) {
    out.push(work(`stock_apply:${a.itemsHash.slice(0, 16)}:${a.statusClass === 'cancelled' ? 'cancelled' : 'open'}`));
  }
  if (a.statusClass === 'cancelled') {
    out.push(work('close_tracking_cancelled'));
    out.push(alert('cancel_label_alert'));
  }
  if (a.includeShipped !== false && (a.statusClass === 'shipped' || a.statusClass === 'delivered')) {
    out.push(work('close_tracking_shipped'));
    out.push(alert('shipped_external'));
  }
  if (a.statusClass === 'delivered') out.push(work('delivered_metrics'));
  return out;
}

/**
 * "Historical" marker for rows written before W4 (pure).
 *
 * Every W4 writer inserts at least `notify_new` on every write, so an order
 * with NO OrderEffect row has never been seen by this pipeline (it is NOT
 * keyed on `orderHash IS NULL`: scripts/backfill-order-hashes.ts fills hashes
 * and must not turn every old order into a fresh alert).
 *
 * A first write to such a row is quiet only when the stored state already
 * matches the incoming one (the seller has seen it) — or, for Etsy, when the
 * remote change itself is older than the historical window. A real
 * open -> cancelled / shipped transition on a pre-W4 row still alerts.
 * Rows that already have effects are never quiet: the alert rows for the new
 * state are fresh and must fire.
 */
export function quietForExistingWrite(a: {
  seeded: boolean;
  prevClass: OrderStatusClass;
  nextClass: OrderStatusClass;
  remoteChangeOld?: boolean;
}): boolean {
  if (a.seeded) return false;
  return a.prevClass === a.nextClass || a.remoteChangeOld === true;
}

/** True when the order already has any OrderEffect row (i.e. was written by the W4 pipeline). */
export async function hasOrderEffects(db: Db, orderId: string): Promise<boolean> {
  const row = await db.orderEffect.findFirst({ where: { orderId }, select: { id: true } });
  return !!row;
}

export function effectKind(effect: string): string {
  const i = effect.indexOf(':');
  return i === -1 ? effect : effect.slice(0, i);
}

/** Insert derived effects (ON CONFLICT DO NOTHING). Returns the effect names newly queued as pending. */
export async function insertOrderEffects(
  db: Db,
  orderId: string,
  effects: DerivedEffect[],
  payload: Record<string, unknown> = {},
): Promise<string[]> {
  if (effects.length === 0) return [];
  const now = new Date();
  const existing = await db.orderEffect.findMany({ where: { orderId, effect: { in: effects.map((e) => e.effect) } }, select: { effect: true } });
  const have = new Set(existing.map((e) => e.effect));
  const fresh = effects.filter((e) => !have.has(e.effect));
  if (fresh.length === 0) return [];
  await db.orderEffect.createMany({
    data: fresh.map((e) => ({
      orderId,
      effect: e.effect,
      status: e.status,
      payload: payload as Prisma.InputJsonValue,
      doneAt: e.status === 'done' ? now : null,
    })),
    skipDuplicates: true,
  });
  return fresh.filter((e) => e.status === 'pending').map((e) => e.effect);
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

type ClaimedRow = { id: string; orderId: string; effect: string; attempts: number; payload: any };

async function claim(limit: number, orderId?: string): Promise<ClaimedRow[]> {
  // Timestamps are passed as UTC ISO strings cast to `timestamp` (the columns
  // are timestamp(3) without time zone holding UTC, as Prisma writes them), so
  // the claim does not depend on the DB session time zone.
  const nowIso = new Date().toISOString();
  const leaseIso = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
  if (orderId) {
    return prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "OrderEffect" SET "nextAttemptAt" = ${leaseIso}::timestamp, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "OrderEffect"
        WHERE "status" = 'pending' AND "nextAttemptAt" <= ${nowIso}::timestamp AND "orderId" = ${orderId}
        ORDER BY "nextAttemptAt" ASC LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "orderId", "effect", "attempts", "payload"`;
  }
  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "OrderEffect" SET "nextAttemptAt" = ${leaseIso}::timestamp, "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "OrderEffect"
      WHERE "status" = 'pending' AND "nextAttemptAt" <= ${nowIso}::timestamp
      ORDER BY "nextAttemptAt" ASC LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "orderId", "effect", "attempts", "payload"`;
}

export function nextRetryDelayMs(attempts: number): number {
  return EFFECT_BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), EFFECT_BACKOFF_MS.length - 1)];
}

export async function drainOrderEffects(opts: { orderId?: string; limit?: number; maxBatches?: number } = {}): Promise<{ claimed: number; done: number; retried: number; failed: number }> {
  const stats = { claimed: 0, done: 0, retried: 0, failed: 0 };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const maxBatches = opts.maxBatches ?? 10;
  for (let b = 0; b < maxBatches; b++) {
    const rows = await claim(limit, opts.orderId);
    if (rows.length === 0) break;
    stats.claimed += rows.length;
    for (const row of rows) {
      try {
        await runEffect(row);
        await prisma.orderEffect.update({ where: { id: row.id }, data: { status: 'done', doneAt: new Date(), lastError: null } });
        stats.done++;
      } catch (err: any) {
        const message = String(err?.message || err).slice(0, 300);
        if (row.attempts >= EFFECT_MAX_ATTEMPTS) {
          await prisma.orderEffect.update({ where: { id: row.id }, data: { status: 'failed', lastError: message } }).catch(() => undefined);
          stats.failed++;
          logSystemEvent('error', {
            message: `Order effect ${effectKind(row.effect)} failed permanently`,
            operation: 'orders.effect.failed',
            details: { effectId: row.id, orderId: row.orderId, effect: row.effect, attempts: row.attempts, error: message },
          });
        } else {
          await prisma.orderEffect
            .update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() + nextRetryDelayMs(row.attempts)), lastError: message } })
            .catch(() => undefined);
          stats.retried++;
        }
      }
    }
    if (rows.length < limit) break;
  }
  return stats;
}

let kickTimer: ReturnType<typeof setTimeout> | null = null;
const kickedOrders = new Set<string>();

/** Fire-and-forget drain shortly after a commit (debounced 250 ms). Never throws. */
export function kickOrderEffects(orderId?: string): void {
  try {
    if (orderId) kickedOrders.add(orderId);
    if (kickTimer) return;
    kickTimer = setTimeout(() => {
      kickTimer = null;
      const ids = [...kickedOrders];
      kickedOrders.clear();
      void (async () => {
        try {
          if (ids.length > 0 && ids.length <= 20) {
            for (const id of ids) await drainOrderEffects({ orderId: id, limit: 20, maxBatches: 1 });
          } else {
            await drainOrderEffects({ limit: 100, maxBatches: 2 });
          }
        } catch (err) {
          logger.warn('[orderEffects] kick drain failed', { error: (err as Error)?.message });
        }
      })();
    }, 250);
    if (typeof (kickTimer as any)?.unref === 'function') (kickTimer as any).unref();
  } catch {
    /* never throw */
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

const VOID_STATUSES = ['voided', 'void_requested', 'error', 'failed', 'cancelled', 'canceled'];

/** Shipments created by KolayXport that still represent a purchasable/printed label. */
export async function findActiveKxShipments(orderId: string) {
  const rows = await prisma.shipment.findMany({
    where: { orderId, voidedAt: null },
    select: { id: true, carrier: true, status: true, trackingNumber: true, pdfUrl: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.filter((s) => !VOID_STATUSES.includes(String(s.status || '').toLowerCase()) && (s.trackingNumber || s.pdfUrl));
}

function receiptTrackingCodes(rawData: any): string[] {
  const ships = Array.isArray(rawData?.shipments) ? rawData.shipments : [];
  return ships.map((s: any) => (s?.tracking_code ? String(s.tracking_code).trim() : '')).filter(Boolean);
}

function normTracking(s: string | null | undefined): string {
  return String(s || '').replace(/\s+/g, '').toUpperCase();
}

async function runEffect(row: ClaimedRow): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: row.orderId },
    select: {
      id: true,
      userId: true,
      marketplace: true,
      orderNumber: true,
      status: true,
      totalPrice: true,
      currency: true,
      rawData: true,
      trackingNumber: true,
      shippingLabelUrl: true,
      labelStatus: true,
      manualShippingCost: true,
      manualShippingCostCurrency: true,
      shippedAt: true,
      shipByAt: true,
      deliveredAt: true,
      _count: { select: { items: true } },
    },
  });
  if (!order) return; // order deleted: nothing to do
  const kind = effectKind(row.effect);
  const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, any>;

  switch (kind) {
    case 'notify_new': {
      const items = await prisma.orderItem.aggregate({ where: { orderId: order.id }, _sum: { quantity: true } });
      await notify(order.userId, {
        type: 'orderNew',
        severity: 'info',
        titleKey: 'types.orderNew',
        params: {
          orderNumber: order.orderNumber,
          total: Number(order.totalPrice ?? 0),
          currency: order.currency || '',
          itemCount: Number(items._sum.quantity ?? order._count.items ?? 0),
          marketplace: order.marketplace,
        },
        link: NOTIFICATION_LINKS.labels,
        dedupeKey: orderNotificationKeys.newOrder(order.id),
        badge: false,
        entity: { type: 'order', id: order.id },
      });
      return;
    }
    case 'stock_apply': {
      const { applyOrderToStock } = await import('@/lib/stock/hooks');
      const source = payload.source === 'webhook' ? 'etsy_webhook' : payload.source === 'sync' ? 'order_scan' : 'etsy_poll';
      await applyOrderToStock(order.id, { source, sourceEventId: payload.eventId ? String(payload.eventId) : undefined });
      return;
    }
    case 'close_tracking_cancelled': {
      await prisma.trackingSubmission.updateMany({
        where: { orderId: order.id, etsySubmitStatus: { in: ['pending', 'needs_manual'] } },
        data: { etsySubmitStatus: 'cancelled', closedReason: 'order_cancelled', closedAt: new Date() },
      });
      return;
    }
    case 'cancel_label_alert': {
      const active = await findActiveKxShipments(order.id);
      const hasFedexLabel = !active.length && hasLegacyOrderLabel(order);
      if (active.length > 0 || hasFedexLabel) {
        const s = active[0];
        const params: Record<string, string | number> = {
          orderNumber: order.orderNumber,
          carrier: s?.carrier || 'FEDEX',
          tracking: s?.trackingNumber || order.trackingNumber || '',
        };
        if (order.manualShippingCost !== null && order.manualShippingCost !== undefined) {
          params.labelCost = Number(order.manualShippingCost.toString());
          params.labelCostCurrency = order.manualShippingCostCurrency || '';
        }
        await notify(order.userId, {
          type: 'orderCanceledAfterLabel',
          severity: 'error',
          titleKey: 'types.orderCanceledAfterLabel',
          params,
          link: NOTIFICATION_LINKS.labels,
          dedupeKey: orderNotificationKeys.cancelledAfterLabel(order.id),
          entity: { type: 'order', id: order.id },
        });
      } else {
        await notify(order.userId, {
          type: 'orderCanceled',
          severity: 'warning',
          titleKey: 'types.orderCanceled',
          params: { orderNumber: order.orderNumber, marketplace: order.marketplace },
          link: NOTIFICATION_LINKS.labels,
          dedupeKey: orderNotificationKeys.cancelled(order.id),
          entity: { type: 'order', id: order.id },
        });
      }
      return;
    }
    case 'close_tracking_shipped': {
      const remote = new Set(receiptTrackingCodes(order.rawData).map(normTracking));
      const open = await prisma.trackingSubmission.findMany({
        where: { orderId: order.id, etsySubmitStatus: { in: ['pending', 'needs_manual'] } },
        select: { id: true, trackingNumber: true },
      });
      const now = new Date();
      for (const ts of open) {
        const matched = remote.has(normTracking(ts.trackingNumber));
        await prisma.trackingSubmission.update({
          where: { id: ts.id },
          data: matched
            ? { etsySubmitStatus: 'submitted', etsySubmittedAt: now, closedReason: 'matched_remote', closedAt: now }
            : { etsySubmitStatus: 'submitted_external', closedReason: 'shipped_external', closedAt: now },
        });
      }
      if (open.length > 0) {
        publishLive(order.userId, { type: 'shipment', kind: 'tracking_submitted', orderId: order.id, trackingNumber: order.trackingNumber });
      }
      return;
    }
    case 'shipped_external': {
      const active = await findActiveKxShipments(order.id);
      const submissions = await prisma.trackingSubmission.count({ where: { orderId: order.id } });
      const kxLabel = active.length > 0 || hasLegacyOrderLabel(order) || submissions > 0;
      if (kxLabel) return;
      const codes = receiptTrackingCodes(order.rawData);
      await notify(order.userId, {
        type: 'orderShippedExternal',
        severity: 'info',
        titleKey: 'types.orderShippedExternal',
        params: { orderNumber: order.orderNumber, tracking: codes[codes.length - 1] || order.trackingNumber || '' },
        link: NOTIFICATION_LINKS.labels,
        dedupeKey: orderNotificationKeys.shippedExternal(order.id),
        badge: false,
        entity: { type: 'order', id: order.id },
      });
      return;
    }
    case 'delivered_metrics': {
      const { computeReturnWindowEnd } = await import('./returnPolicy');
      const { isShippedLate } = await import('./dispatch');
      const deliveredAt = order.deliveredAt || (payload.firstReceivedAt ? new Date(payload.firstReceivedAt) : new Date());
      const returnWindowEndsAt = await computeReturnWindowEnd(order.userId, order.rawData, deliveredAt, order.marketplace);
      await prisma.order.update({
        where: { id: order.id },
        data: {
          deliveredAt,
          returnWindowEndsAt,
          ...(order.shippedAt && order.shipByAt ? { shippedLate: isShippedLate(order.shippedAt, order.shipByAt) } : {}),
        },
      });
      return;
    }
    default:
      logger.warn('[orderEffects] unknown effect, marking done', { effect: row.effect });
  }
}

/** Resolve the 'cancelled after label' alert (void done / user confirmed manual cancel). */
export async function resolveCancelledAfterLabel(userId: string, orderId: string): Promise<void> {
  await resolveNotification(userId, orderNotificationKeys.cancelledAfterLabel(orderId));
}
