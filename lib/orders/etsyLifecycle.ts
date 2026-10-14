/**
 * Etsy order lifecycle (W4).
 *
 * upsertEtsyReceipt is the ONLY Etsy order writer (webhook, incremental poll,
 * nightly reconcile, manual Sync button via syncAllOrders, label-guard live
 * re-check). One transaction, no network inside:
 *   order create/update (hash-gated) -> item upsert (only when itemsHash
 *   changed) -> state-derived OrderEffect rows (ON CONFLICT DO NOTHING).
 * After the commit: status hook (only on a real status change), live event
 * (publishOrderEvent: 'new' plays the order sound in every open tab), and a
 * kick of the effect drain.
 *
 * handleEtsyOrderEvent (webhook worker): ONE receipt GET + upsert for ANY
 * order event type, so a paid order appears in the UI within seconds — no
 * 30-day syncAllOrders pass.
 */
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { logIntegrationEvent, logSystemEvent } from '@/lib/admin/events';
import { publishOrderEvent } from '@/lib/live/publish';
import type { LiveOrderKind } from '@/lib/live/types';
import type { EtsyEventContext, HandlerOutcome } from '@/lib/etsy/webhooks/types';
import { EtsyPriority } from '@/lib/etsy/rateBudget';
import {
  etsyLatestTrackingCode,
  etsyShipByDate,
  etsyShippedAt,
  fetchEtsyReceiptRawFromApi,
  fetchReceiptsPage,
  listingIdsOfReceipts,
  listingImagesFromCache,
  mapReceiptToUIOrder,
} from '@/lib/integrations/etsyOrderSync';
import { computeItemsHash, computeOrderHash, itemsHashFromDbRows } from './orderHash';
import { linesFromUIOrder, upsertOrderItems } from './itemUpsert';
import { mergeAddressPreferNonEmpty, mergeNamePreferNonEmpty, sameAddress } from './addressMerge';
import { classifyOrderStatus, isRecentOrderDate, liveKindForOrderWrite, type OrderStatusClass } from './orderStatus';
import { deriveOrderEffects, hasOrderEffects, insertOrderEffects, kickOrderEffects, quietForExistingWrite } from './orderEffects';
import { withKxShopId } from './etsyShopResolve';
import { isShippedLate } from './dispatch';

export type UpsertEtsyReceiptSource = 'webhook' | 'poll' | 'reconcile' | 'manual';

export type UpsertEtsyReceiptResult = {
  orderId: string;
  created: boolean;
  status: string;
  effectsQueued: string[];
  /** Live event published for this write (null = nothing changed). */
  liveKind?: LiveOrderKind | null;
  /** Listing ids of the receipt that are not in the EtsyListing cache (for ensureListingsCached). */
  missingListingIds?: bigint[];
};

/** A pre-W4 row first seen by this pipeline counts as historical when its last remote change is older than this. */
const HISTORICAL_STATE_MS = 48 * 60 * 60 * 1000;

/** An unchanged receipt only refreshes lastRemoteCheckAt when it is older than this (label guard window is 10 min). */
const REMOTE_CHECK_REFRESH_MS = 5 * 60 * 1000;

/** Update keys that never by themselves justify rewriting the row (they would only bump Order.updatedAt). */
const BOOKKEEPING_KEYS = new Set(['source', 'orderHash', 'itemsHash', 'lastRemoteCheckAt', 'lastEventAt']);

/** Etsy receipts carry no shop id; one is stored under a KX-owned key so label guard / return policy pick the right shop. */

function receiptUpdatedMs(receipt: any): number | null {
  const n = Number(receipt?.updated_timestamp ?? receipt?.update_timestamp);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

function isEtsyScopedRow(row: { marketplace: string; source: string | null; rawData: any }, receiptId: string, shopName: string | null): boolean {
  const raw = row.rawData && typeof row.rawData === 'object' ? (row.rawData as any) : null;
  if (raw?.receipt_id !== undefined && String(raw.receipt_id) === receiptId) return true;
  if (row.source === 'etsy-api') return true;
  if (shopName && row.marketplace === shopName) return true;
  return /etsy/i.test(row.marketplace || '');
}

/**
 * Write one raw Etsy receipt. See module doc. Never calls Etsy.
 */
export async function upsertEtsyReceipt(a: {
  userId: string;
  shopId: string;
  receipt: any;
  source: UpsertEtsyReceiptSource;
  eventTypes?: Set<string>;
  firstReceivedAt?: Date;
  eventId?: string;
}): Promise<UpsertEtsyReceiptResult> {
  const { userId, shopId, receipt } = a;
  if (!receipt?.receipt_id) throw new Error('upsertEtsyReceipt: receipt without receipt_id');
  const receiptId = String(receipt.receipt_id);
  const now = new Date();

  const shop = await prisma.etsyShop.findFirst({ where: { shopId, userId }, select: { shopName: true } });
  const shopName = shop?.shopName || null;
  const listingIds = listingIdsOfReceipts([receipt]);
  const { imageMap, missing } = await listingImagesFromCache(shopId, listingIds);
  const ui = mapReceiptToUIOrder(receipt, shopId, shopName || 'Etsy', imageMap);

  // Extension-scraped address (EtsyAddress) — read before the transaction.
  let extAddress: any = null;
  try {
    const { getEtsyExtensionAddress } = await import('@/lib/orderSync');
    extAddress = (await getEtsyExtensionAddress(userId, ui.orderNumber, shopId)) ?? null;
  } catch (err) {
    logger.warn('[etsyLifecycle] EtsyAddress lookup failed', { error: (err as Error)?.message });
  }

  const delivered = a.eventTypes?.has('order.delivered') ?? false;
  const shipByAt = etsyShipByDate(receipt);
  const shippedAtRemote = etsyShippedAt(receipt);
  const lines = linesFromUIOrder({ ...ui, shipByDate: ui.shipByDate ?? null, customerNote: (ui as any).customerNote ?? null });
  const incomingItemsHash = computeItemsHash(lines.map((l) => ({ lineKey: l.lineKey, quantity: l.quantity, unitPrice: l.unitPrice, sku: l.sku, image: l.image })));
  const incomingTracking = etsyLatestTrackingCode(receipt);
  const recent = isRecentOrderDate(ui.marketplaceOrderDate ?? null, now.getTime());

  type TxOut = {
    orderId: string;
    created: boolean;
    statusChanged: boolean;
    changed: boolean;
    prevClass: OrderStatusClass | null;
    nextClass: OrderStatusClass;
    effectsQueued: string[];
    row: any;
  };

  const runTx = () =>
    prisma.$transaction(
      async (tx): Promise<TxOut> => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order:etsy:${userId}:${receiptId}`}))`;
        const candidates = await tx.order.findMany({
          where: { userId, marketplaceKey: receiptId },
          orderBy: { createdAt: 'asc' },
        });
        const existing = candidates.find((c) => isEtsyScopedRow(c as any, receiptId, shopName)) || null;

        // Delivery: Etsy receipts carry no delivered flag; the order.delivered event time is the signal.
        const deliveredAt = existing?.deliveredAt ?? (delivered ? a.firstReceivedAt ?? now : null);
        const nextClass = classifyOrderStatus(ui.status, ui.externalStatus, deliveredAt);
        const trackingForHash = existing?.trackingNumber || incomingTracking || null;
        const incomingOrderHash = computeOrderHash({ status: ui.status, externalStatus: ui.externalStatus, totalPrice: ui.totalPrice, trackingNumber: trackingForHash, shipByAt });

        const apiAddress = ui.to_address;
        const withExt = mergeAddressPreferNonEmpty(existing?.shippingAddress ?? null, extAddress);
        const mergedAddress = mergeAddressPreferNonEmpty(withExt, apiAddress);
        const customerName = mergeNamePreferNonEmpty(existing?.customerName, ui.customerName);

        const cancelledAt = nextClass === 'cancelled' ? existing?.cancelledAt ?? (receiptUpdatedMs(receipt) ? new Date(receiptUpdatedMs(receipt)!) : now) : existing?.cancelledAt ?? null;
        const shippedAt =
          nextClass === 'shipped' || nextClass === 'delivered' ? existing?.shippedAt ?? shippedAtRemote ?? (receiptUpdatedMs(receipt) ? new Date(receiptUpdatedMs(receipt)!) : now) : existing?.shippedAt ?? null;
        const shippedLate = shippedAt && shipByAt ? isShippedLate(shippedAt, shipByAt) : existing?.shippedLate ?? null;

        if (!existing) {
          const created = await tx.order.create({
            data: {
              userId,
              marketplace: ui.marketplace,
              marketplaceKey: receiptId,
              orderNumber: ui.orderNumber,
              customerName: customerName ?? '',
              status: ui.status,
              externalStatus: ui.externalStatus,
              currency: ui.currency,
              totalPrice: ui.totalPrice,
              shippingAddress: mergedAddress ? JSON.stringify(mergedAddress) : Prisma.JsonNull,
              rawData: withKxShopId(receipt, shopId) as Prisma.InputJsonValue,
              uiOrderDate: ui.marketplaceOrderDate ? new Date(ui.marketplaceOrderDate) : now,
              commodityDesc: ui.commodityDesc || '',
              giftMessage: (ui as any).giftMessage || null,
              customerNote: (ui as any).customerNote || null,
              trackingNumber: incomingTracking,
              source: 'etsy-api',
              shipByAt,
              cancelledAt,
              shippedAt,
              shippedLate,
              deliveredAt,
              orderHash: incomingOrderHash,
              itemsHash: incomingItemsHash,
              lastEventAt: a.source === 'webhook' || nextClass !== 'open' ? now : null,
              lastRemoteCheckAt: now,
            },
          });
          await upsertOrderItems(tx, created.id, lines);
          const effects = deriveOrderEffects({ statusClass: nextClass, itemsHash: incomingItemsHash, quiet: !recent });
          const queued = await insertOrderEffects(tx, created.id, effects, { source: a.source, eventId: a.eventId ?? null, firstReceivedAt: (a.firstReceivedAt ?? now).toISOString() });
          return { orderId: created.id, created: true, statusChanged: true, changed: true, prevClass: null, nextClass, effectsQueued: queued, row: created };
        }

        const prevClass = classifyOrderStatus(existing.status, existing.externalStatus, existing.deliveredAt);
        const storedOrderHash =
          existing.orderHash ??
          computeOrderHash({ status: existing.status, externalStatus: existing.externalStatus, totalPrice: existing.totalPrice, trackingNumber: existing.trackingNumber, shipByAt: existing.shipByAt });
        let storedItemsHash = existing.itemsHash;
        if (!storedItemsHash) {
          const rows = await tx.orderItem.findMany({ where: { orderId: existing.id }, select: { id: true, uniqueLineKey: true, remoteLineId: true, marketplaceKey: true, quantity: true, unitPrice: true, sku: true, image: true } });
          storedItemsHash = itemsHashFromDbRows(rows);
        }
        const orderChanged = storedOrderHash !== incomingOrderHash;
        const itemsChanged = storedItemsHash !== incomingItemsHash;
        const addressChanged = !sameAddress(existing.shippingAddress, mergedAddress);
        const statusChanged = (existing.status || '') !== (ui.status || '') || prevClass !== nextClass;

        const data: Prisma.OrderUpdateInput = {
          source: 'etsy-api',
          orderHash: incomingOrderHash,
          itemsHash: incomingItemsHash,
          lastRemoteCheckAt: now,
          // lastEventAt = last time the marketplace told us something changed (webhook, or a poll that saw a status change).
          ...(a.source === 'webhook' || statusChanged ? { lastEventAt: now } : {}),
          ...(existing.shipByAt?.getTime() !== shipByAt?.getTime() && shipByAt ? { shipByAt } : {}),
          ...(cancelledAt && !existing.cancelledAt ? { cancelledAt } : {}),
          ...(shippedAt && !existing.shippedAt ? { shippedAt } : {}),
          ...(shippedLate !== null && shippedLate !== existing.shippedLate ? { shippedLate } : {}),
          ...(deliveredAt && !existing.deliveredAt ? { deliveredAt } : {}),
          ...(!existing.uiOrderDate && ui.marketplaceOrderDate ? { uiOrderDate: new Date(ui.marketplaceOrderDate) } : {}),
        };
        if (orderChanged || itemsChanged || statusChanged) {
          Object.assign(data, {
            status: ui.status,
            externalStatus: ui.externalStatus,
            currency: ui.currency,
            totalPrice: ui.totalPrice,
            rawData: withKxShopId(receipt, shopId) as Prisma.InputJsonValue,
            commodityDesc: ui.commodityDesc || existing.commodityDesc || '',
          });
        }
        if (addressChanged && mergedAddress) data.shippingAddress = JSON.stringify(mergedAddress);
        if (customerName && customerName !== existing.customerName) data.customerName = customerName;
        if ((ui as any).giftMessage && (ui as any).giftMessage !== existing.giftMessage) data.giftMessage = (ui as any).giftMessage;
        if ((ui as any).customerNote && (ui as any).customerNote !== existing.customerNote) data.customerNote = (ui as any).customerNote;
        // Fill-if-empty: never clobber a number the user entered locally.
        if (incomingTracking && !existing.trackingNumber) data.trackingNumber = incomingTracking;

        // Hash gate: an unchanged receipt (nightly reconcile, re-delivered webhook)
        // does not rewrite the row, so Order.updatedAt stays put (W2's stock
        // safety-net scan pages over updatedAt) and no effects are derived.
        const meaningful = Object.keys(data).filter((k) => !BOOKKEEPING_KEYS.has(k));
        const unchanged =
          !orderChanged &&
          !itemsChanged &&
          !statusChanged &&
          meaningful.length === 0 &&
          existing.source === 'etsy-api' &&
          !!existing.orderHash &&
          !!existing.itemsHash &&
          !!existing.uiOrderDate;
        if (unchanged) {
          const lastCheck = existing.lastRemoteCheckAt?.getTime() ?? 0;
          const touchEvent = a.source === 'webhook';
          if (touchEvent || now.getTime() - lastCheck >= REMOTE_CHECK_REFRESH_MS) {
            // Raw UPDATE: Prisma's @updatedAt is client-side, so this does not bump Order.updatedAt.
            const nowIso = now.toISOString();
            if (touchEvent) {
              await tx.$executeRaw`UPDATE "Order" SET "lastRemoteCheckAt" = ${nowIso}::timestamp, "lastEventAt" = ${nowIso}::timestamp WHERE "id" = ${existing.id}`;
            } else {
              await tx.$executeRaw`UPDATE "Order" SET "lastRemoteCheckAt" = ${nowIso}::timestamp WHERE "id" = ${existing.id}`;
            }
          }
          return {
            orderId: existing.id,
            created: false,
            statusChanged: false,
            changed: false,
            prevClass,
            nextClass,
            effectsQueued: [],
            row: { ...existing, lastRemoteCheckAt: now, ...(touchEvent ? { lastEventAt: now } : {}) },
          };
        }

        const row = await tx.order.update({ where: { id: existing.id }, data });
        if (itemsChanged) await upsertOrderItems(tx, existing.id, lines);

        // Pre-W4 rows (no OrderEffect yet) are quiet only when the seller already saw this
        // state, or the remote change is older than the historical window. Not keyed on
        // orderHash IS NULL: the hash backfill must not re-arm alerts for every old order.
        const quiet = quietForExistingWrite({
          seeded: await hasOrderEffects(tx, existing.id),
          prevClass,
          nextClass,
          remoteChangeOld: (receiptUpdatedMs(receipt) ?? now.getTime()) < now.getTime() - HISTORICAL_STATE_MS,
        });
        const effects = deriveOrderEffects({ statusClass: nextClass, itemsHash: incomingItemsHash, quiet });
        const queued = await insertOrderEffects(tx, existing.id, effects, { source: a.source, eventId: a.eventId ?? null, firstReceivedAt: (a.firstReceivedAt ?? now).toISOString() });
        return {
          orderId: existing.id,
          created: false,
          statusChanged,
          changed: orderChanged || itemsChanged || addressChanged,
          prevClass,
          nextClass,
          effectsQueued: queued,
          row,
        };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );

  let out: TxOut;
  try {
    out = await runTx();
  } catch (err: any) {
    // Two writers creating the same receipt at once: the loser retries as an update.
    if (err?.code === 'P2002') out = await runTx();
    else throw err;
  }

  const liveKind = liveKindForOrderWrite({ created: out.created, prev: out.prevClass, next: out.nextClass, changed: out.changed, recent });
  if (liveKind) publishOrderEvent(userId, { ...out.row, items: lines.map((l) => ({ quantity: l.quantity })) }, liveKind);
  if (out.effectsQueued.length > 0) kickOrderEffects(out.orderId);

  return {
    orderId: out.orderId,
    created: out.created,
    status: ui.status,
    effectsQueued: out.effectsQueued,
    liveKind,
    missingListingIds: missing,
  };
}

/** GET one raw receipt at the given priority (null on 404 / shop not connected). */
export async function fetchEtsyReceiptRaw(userId: string, shopId: string, receiptId: string, priority: EtsyPriority = EtsyPriority.Critical): Promise<any | null> {
  return fetchEtsyReceiptRawFromApi(userId, shopId, receiptId, priority);
}

function cacheMissingListings(shopId: string, ids: bigint[] | undefined) {
  if (!ids || ids.length === 0) return;
  void (async () => {
    try {
      const { ensureListingsCached } = await import('@/lib/etsy/listingCache');
      await ensureListingsCached(shopId, ids, { max: 20 });
    } catch (err) {
      logger.warn('[etsyLifecycle] ensureListingsCached failed', { shopId, error: (err as Error)?.message });
    }
  })();
}

/**
 * Webhook handler for any order.* event (paid, shipped, canceled, delivered…).
 * Exactly one Etsy call (receipt GET) at Critical priority.
 */
export async function handleEtsyOrderEvent(ctx: EtsyEventContext & { receiptId: string }): Promise<HandlerOutcome> {
  const { userId, shopId, receiptId } = ctx;
  if (!receiptId || !/^\d+$/.test(String(receiptId))) return { outcome: 'ignored', note: 'no receipt id' };

  // Critical (P0): a new order must never be deferred by the per-shop cap / 85% gate (A2).
  const receipt = await fetchEtsyReceiptRaw(userId, shopId, String(receiptId), EtsyPriority.Critical);
  if (!receipt) return { outcome: 'ignored', note: 'receipt not found' };

  const result = await upsertEtsyReceipt({
    userId,
    shopId,
    receipt,
    source: 'webhook',
    eventTypes: ctx.eventTypes,
    firstReceivedAt: ctx.firstReceivedAt,
    eventId: ctx.eventId,
  });
  try {
    await prisma.etsyShop.updateMany({ where: { shopId }, data: { lastWebhookAt: new Date() } });
  } catch {
    /* informational */
  }
  cacheMissingListings(shopId, result.missingListingIds);
  return { outcome: 'done', note: `note:order_${result.created ? 'created' : 'updated'},${result.status}` };
}

// ---------------------------------------------------------------------------
// Incremental keyset poll (safety net for webhooks)
// ---------------------------------------------------------------------------

export const ORDER_POLL_FIRST_RUN_LOOKBACK_S = 3 * 24 * 60 * 60;

/**
 * A receipt whose upsert throws holds the persisted cursor at its
 * updated_timestamp for this many consecutive runs; after that the cursor
 * moves past it (logged; the nightly 90-day reconcile and webhooks still
 * retry it), so one bad receipt can never stall the shop's polling.
 */
export const RECEIPT_MAX_CURSOR_HOLDS = 3;
const receiptFailures = new Map<string, number>();
const MAX_TRACKED_RECEIPT_FAILURES = 5000;

/** Test hook. */
export function __resetReceiptFailures() {
  receiptFailures.clear();
}

/**
 * Keyset paging over receipts by updated_timestamp:
 *   min_last_modified = cursor, sort_on=updated asc, limit 100.
 * The next page starts at the page's max updated_timestamp; offset is used only
 * while a page is entirely inside one second (tie). Receipts are deduped by id.
 * The cursor (EtsyShop.orderPollCursor) advances only after the page is written.
 */
export async function runEtsyOrderIncremental(
  shopId: string,
  opts?: { reason?: string; maxPages?: number; priority?: EtsyPriority; sinceSeconds?: number; source?: UpsertEtsyReceiptSource; persistCursor?: boolean },
): Promise<{ receipts: number; pages: number; created: number; updated: number; failed: number; failedReceiptIds: string[] }> {
  const shop = await prisma.etsyShop.findUnique({
    where: { shopId },
    select: { userId: true, shopId: true, isActive: true, needsReauth: true, orderPollCursor: true },
  });
  if (!shop || !shop.isActive) return { receipts: 0, pages: 0, created: 0, updated: 0, failed: 0, failedReceiptIds: [] };
  if (shop.needsReauth) throw Object.assign(new Error('Etsy shop needs reauthorization'), { code: 'ETSY_REAUTH_REQUIRED' });

  const persistCursor = opts?.persistCursor !== false;
  const maxPages = Math.max(1, opts?.maxPages ?? 10);
  const priority = opts?.priority ?? EtsyPriority.Reconcile;
  const source = opts?.source ?? 'poll';
  const nowS = Math.floor(Date.now() / 1000);
  let cursor = opts?.sinceSeconds ?? shop.orderPollCursor ?? nowS - ORDER_POLL_FIRST_RUN_LOOKBACK_S;
  // Small overlap so receipts modified in the same second as the cursor are re-read (deduped below).
  cursor = Math.max(0, cursor - 1);

  const seen = new Set<string>();
  const missing = new Set<string>();
  let pages = 0;
  let receipts = 0;
  let created = 0;
  let updated = 0;
  let tieOffset = 0;
  /** Lowest updated_timestamp of a receipt that failed and still holds the persisted cursor. */
  let holdTs: number | null = null;
  const failedReceiptIds: string[] = [];
  const persistedCursor = () => (holdTs !== null ? Math.min(cursor, holdTs) : cursor);

  while (pages < maxPages) {
    const page = await fetchReceiptsPage(shop.userId, shopId, { minLastModified: cursor, sortOn: 'updated', sortOrder: 'asc', limit: 100, offset: tieOffset }, priority);
    pages++;
    const results = page.results;
    let maxTs = cursor;
    for (const r of results) {
      const id = String(r?.receipt_id || '');
      const ts = Number(r?.updated_timestamp ?? r?.update_timestamp) || 0;
      if (ts > maxTs) maxTs = ts;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const failKey = `${shopId}:${id}`;
      let res: UpsertEtsyReceiptResult;
      try {
        res = await upsertEtsyReceipt({ userId: shop.userId, shopId, receipt: r, source });
      } catch (err) {
        // Per-receipt isolation: one failing receipt must not stop the others.
        failedReceiptIds.push(id);
        const attempts = (receiptFailures.get(failKey) ?? 0) + 1;
        const holds = persistCursor && attempts < RECEIPT_MAX_CURSOR_HOLDS && ts > 0;
        if (holds) {
          if (receiptFailures.size >= MAX_TRACKED_RECEIPT_FAILURES) receiptFailures.clear();
          receiptFailures.set(failKey, attempts);
          holdTs = holdTs === null ? ts : Math.min(holdTs, ts);
        } else if (persistCursor) {
          receiptFailures.delete(failKey);
        }
        logSystemEvent(holds ? 'warn' : 'error', {
          message: holds ? 'Etsy receipt upsert failed; cursor held for retry' : 'Etsy receipt upsert failed; skipped (reconcile will retry)',
          operation: holds ? 'orders.etsy.receipt_failed' : 'orders.etsy.receipt_skipped',
          userId: shop.userId,
          details: { shopId, receiptId: id, attempts, reason: opts?.reason, error: String((err as Error)?.message || err).slice(0, 300) },
        });
        continue;
      }
      receiptFailures.delete(failKey);
      receipts++;
      if (res.created) created++;
      else if (res.liveKind) updated++;
      for (const m of res.missingListingIds || []) missing.add(String(m));
    }
    if (results.length < 100) {
      cursor = maxTs;
      break;
    }
    if (maxTs === cursor) {
      // Whole page inside one second: page through the tie with offset.
      tieOffset += results.length;
    } else {
      cursor = maxTs;
      tieOffset = 0;
    }
    if (persistCursor) await prisma.etsyShop.update({ where: { shopId }, data: { orderPollCursor: persistedCursor() } });
  }

  if (persistCursor) {
    await prisma.etsyShop.update({
      where: { shopId },
      data: { orderPollCursor: persistedCursor(), lastOrderPollAt: new Date(), orderPollFailures: 0 },
    });
  }
  cacheMissingListings(shopId, [...missing].map((s) => BigInt(s)));
  logger.info('[etsyLifecycle] incremental poll', { shopId, reason: opts?.reason, pages, receipts, created, updated, failed: failedReceiptIds.length });
  return { receipts, pages, created, updated, failed: failedReceiptIds.length, failedReceiptIds };
}

/**
 * Nightly reconcile: receipts modified in the last `days` days (P2). Upserts
 * are hash-gated, so unchanged orders are not rewritten. Does not move the
 * incremental cursor.
 */
export async function reconcileEtsyOrders(
  shopId: string,
  days = 90,
): Promise<{ receipts: number; pages: number; created: number; updated: number; failed: number; failedReceiptIds: string[] }> {
  const res = await runEtsyOrderIncremental(shopId, {
    reason: 'reconcile',
    maxPages: 200,
    priority: EtsyPriority.Reconcile,
    sinceSeconds: Math.floor(Date.now() / 1000) - days * 24 * 60 * 60,
    source: 'reconcile',
    persistCursor: false,
  });
  await prisma.etsyShop.update({ where: { shopId }, data: { lastOrderReconcileAt: new Date() } }).catch(() => undefined);
  return res;
}
