/**
 * Shared single-order writer for the per-marketplace syncs that upsert one
 * order at a time (lib/sync/trendyol.ts, wix.ts, shopify.ts).
 *
 * Replaces `order.upsert({ update: { ..., items: { deleteMany: {}, create } } })`,
 * which cascade-deleted Shipment/LabelJob rows on every sync and nulled the
 * locally created label fields (trackingNumber, shippingLabelUrl, labelStatus,
 * shippedAt). Now:
 *  - hash-gated: unchanged orders are not rewritten;
 *  - items are upserted in place (lib/orders/itemUpsert);
 *  - label/tracking fields the mapper sends as null never overwrite local values;
 *  - the address is merged prefer-non-empty;
 *  - effect outbox rows (new-order notification, cancel-after-label alert,
 *    tracking-queue close) commit with the order;
 *  - the caller collects the returned live write and publishes it after the
 *    pass (publishOrderWrites), so a new order appears live in every tab.
 */
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { publishLive, publishOrderEvent } from '@/lib/live/publish';
import type { LiveOrderKind } from '@/lib/live/types';
import { computeItemsHash, computeOrderHash, itemsHashFromDbRows } from './orderHash';
import { linesFromUIOrder, upsertOrderItems } from './itemUpsert';
import { mergeAddressPreferNonEmpty, mergeNamePreferNonEmpty, parseStoredAddress, sameAddress } from './addressMerge';
import { classifyOrderStatus, isRecentOrderDate, liveKindForOrderWrite } from './orderStatus';
import { deriveOrderEffects, hasOrderEffects, insertOrderEffects, kickOrderEffects, quietForExistingWrite } from './orderEffects';

export type LiveWrite = { row: any; kind: LiveOrderKind; itemCount: number };

const LABEL_FIELDS = ['trackingNumber', 'shippingLabelUrl', 'labelStatus', 'shippedAt'] as const;
const MAX_LIVE_NEW_EVENTS = 20;
const MAX_LIVE_UPDATE_EVENTS = 50;

export async function upsertMarketplaceOrder(
  userId: string,
  orderData: Record<string, any>,
  uiLineItems: any[],
  opts: { source: string; recipientEmail?: string | null; shipByDate?: string | Date | null },
): Promise<{ orderId: string; created: boolean; skipped: boolean; live: LiveWrite | null }> {
  const now = new Date();
  const marketplace = String(orderData.marketplace);
  const marketplaceKey = String(orderData.marketplaceKey);
  const lines = linesFromUIOrder({ marketplaceKey, orderNumber: orderData.orderNumber, line_items: uiLineItems || [] }).map((l) => ({
    ...l,
    recipientEmail: opts.recipientEmail ?? null,
  }));
  const itemsHash = computeItemsHash(lines.map((l) => ({ lineKey: l.lineKey, quantity: l.quantity, unitPrice: l.unitPrice, sku: l.sku, image: l.image })));
  const shipByAt = opts.shipByDate ? new Date(opts.shipByDate as any) : lines.find((l) => l.shipBy)?.shipBy ?? null;
  const validShipBy = shipByAt && Number.isFinite(shipByAt.getTime()) ? shipByAt : null;
  const nextClass = classifyOrderStatus(orderData.status, orderData.externalStatus);
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);

  const existing = await prisma.order.findUnique({ where: { userId_marketplace_marketplaceKey: { userId, marketplace, marketplaceKey } } });

  // Never let a mapper's null overwrite locally created label/tracking data.
  const data: Record<string, any> = { ...orderData, userId, source: opts.source };
  for (const f of LABEL_FIELDS) if (data[f] === null || data[f] === undefined) delete data[f];
  if (validShipBy) data.shipByAt = validShipBy;

  const orderHash = computeOrderHash({
    status: orderData.status,
    externalStatus: orderData.externalStatus,
    totalPrice: orderData.totalPrice,
    trackingNumber: existing?.trackingNumber || data.trackingNumber || null,
    shipByAt: validShipBy,
  });
  data.orderHash = orderHash;
  data.itemsHash = itemsHash;
  data.lastRemoteCheckAt = now;

  if (!existing) {
    const recent = isRecentOrderDate(orderData.uiOrderDate ?? null, now.getTime());
    try {
      const out = await prisma.$transaction(
        async (tx) => {
          const row = await tx.order.create({
            data: {
              ...data,
              shippingAddress: data.shippingAddress ?? Prisma.JsonNull,
              rawData: data.rawData ?? Prisma.JsonNull,
              cancelledAt: nextClass === 'cancelled' ? now : null,
              lastEventAt: nextClass === 'open' ? null : now,
            } as Prisma.OrderUncheckedCreateInput,
          });
          await upsertOrderItems(tx, row.id, lines);
          const queued = await insertOrderEffects(
            tx,
            row.id,
            deriveOrderEffects({ statusClass: nextClass, itemsHash, quiet: !recent, includeStock: false, includeShipped: false }),
            { source: 'sync' },
          );
          return { row, queued };
        },
        { timeout: 15_000, maxWait: 10_000 },
      );
      if (out.queued.length) kickOrderEffects(out.row.id);
      const kind = liveKindForOrderWrite({ created: true, next: nextClass, changed: true, recent });
      return { orderId: out.row.id, created: true, skipped: false, live: kind ? { row: out.row, kind, itemCount } : null };
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      const row = await prisma.order.findUnique({ where: { userId_marketplace_marketplaceKey: { userId, marketplace, marketplaceKey } } });
      return { orderId: row?.id || '', created: false, skipped: true, live: null };
    }
  }

  // Hash gate (NULL stored hashes are computed from the stored row/items once).
  const storedOrderHash =
    existing.orderHash ??
    computeOrderHash({ status: existing.status, externalStatus: existing.externalStatus, totalPrice: existing.totalPrice, trackingNumber: existing.trackingNumber, shipByAt: existing.shipByAt });
  let storedItemsHash = existing.itemsHash;
  if (!storedItemsHash) {
    const rows = await prisma.orderItem.findMany({
      where: { orderId: existing.id },
      select: { id: true, uniqueLineKey: true, remoteLineId: true, marketplaceKey: true, quantity: true, unitPrice: true, sku: true, image: true },
    });
    storedItemsHash = itemsHashFromDbRows(rows);
  }
  const itemsChanged = storedItemsHash !== itemsHash;
  const mergedAddress = mergeAddressPreferNonEmpty(existing.shippingAddress, data.shippingAddress);
  const addressChanged = !!mergedAddress && !sameAddress(existing.shippingAddress, mergedAddress);
  const name = mergeNamePreferNonEmpty(existing.customerName, data.customerName);
  const nameChanged = name !== null && name !== existing.customerName;
  if (storedOrderHash === orderHash && !itemsChanged && !addressChanged && !nameChanged && existing.orderHash && existing.itemsHash && existing.uiOrderDate) {
    return { orderId: existing.id, created: false, skipped: true, live: null };
  }

  if (addressChanged) {
    data.shippingAddress = typeof data.shippingAddress === 'string' || typeof existing.shippingAddress === 'string' ? JSON.stringify(mergedAddress) : mergedAddress;
  } else {
    delete data.shippingAddress;
  }
  if (nameChanged) data.customerName = name;
  else delete data.customerName;
  if (data.trackingNumber && existing.trackingNumber) delete data.trackingNumber; // fill-if-empty
  if (existing.uiOrderDate) delete data.uiOrderDate; // keep the first-seen order date stable
  const prevClass = classifyOrderStatus(existing.status, existing.externalStatus, existing.deliveredAt);
  const statusChanged = (existing.status || '') !== (orderData.status || '');
  if (statusChanged) data.lastEventAt = now;
  if (nextClass === 'cancelled' && !existing.cancelledAt) data.cancelledAt = now;
  delete data.userId;

  const out = await prisma.$transaction(
    async (tx) => {
      const row = await tx.order.update({ where: { id: existing.id }, data });
      if (itemsChanged) await upsertOrderItems(tx, existing.id, lines);
      // Pre-W4 rows (no OrderEffect yet) are quiet only when the stored state already matches.
      const quiet = quietForExistingWrite({ seeded: await hasOrderEffects(tx, existing.id), prevClass, nextClass });
      const queued = await insertOrderEffects(
        tx,
        existing.id,
        deriveOrderEffects({ statusClass: nextClass, itemsHash, quiet, includeStock: false, includeShipped: false }),
        { source: 'sync' },
      );
      return { row, queued };
    },
    { timeout: 15_000, maxWait: 10_000 },
  );
  if (out.queued.length) kickOrderEffects(existing.id);
  const kind = liveKindForOrderWrite({ created: false, prev: prevClass, next: nextClass, changed: storedOrderHash !== orderHash || itemsChanged || addressChanged || nameChanged, recent: false });
  return { orderId: existing.id, created: false, skipped: false, live: kind ? { row: out.row, kind, itemCount } : null };
}

/**
 * Publish the live events of one sync pass: individual events up to a cap
 * (a first-time import of hundreds of orders must not flood every tab), then
 * one generic invalidate, plus a sync-finished hint. Never throws.
 */
export function publishOrderWrites(userId: string, writes: LiveWrite[], scope = 'orders'): void {
  try {
    if (!userId || writes.length === 0) return;
    const news = writes.filter((w) => w.kind === 'new');
    const others = writes.filter((w) => w.kind !== 'new');
    for (const w of news.slice(0, MAX_LIVE_NEW_EVENTS)) publishOrderEvent(userId, { ...w.row, itemCount: w.itemCount }, w.kind);
    for (const w of others.slice(0, MAX_LIVE_UPDATE_EVENTS)) publishOrderEvent(userId, { ...w.row, itemCount: w.itemCount }, w.kind);
    if (news.length > MAX_LIVE_NEW_EVENTS || others.length > MAX_LIVE_UPDATE_EVENTS) {
      publishLive(userId, { type: 'invalidate', keys: ['/api/orders'] });
    }
    publishLive(userId, { type: 'sync', kind: 'finished', scope, newOrders: news.length, updatedOrders: others.length });
  } catch {
    /* live events never break a sync */
  }
}
