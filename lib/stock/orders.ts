/**
 * Orders -> canonical stock (W2, T4). Server-only.
 *
 * applyOrderToStock(orderId) is idempotent: each (orderKey, stockItem) has at
 * most one 'sale' row; later quantity changes are 'sale_adjust' rows and a
 * cancellation is one 'cancel' row. The same Etsy order seen via webhook,
 * poll, scan and a Veeqo/Shippo copy therefore counts once.
 *
 * Line resolution order:
 *   1. StockLink (channel, externalId = listingRef, variantRef = variantKey / '' / '*')
 *   2. the same with variantValueKey
 *   3. StockLink (channel, externalId = raw line SKU)   (Trendyol barcode, eBay SKU)
 *   4. normalizeSku(line.sku) -> StockItem
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify } from '@/lib/notifications';
import { publishLive } from '@/lib/live/publish';
import { getStockSettings, isStockSyncActive } from './settings';
import { applyCancel, applySaleDesired, STOCK_PAGE_LINK } from './engine';
import { deriveOrderKey, orderStatusClass, resolveOrderChannel } from './orderKey';
import { normalizeSku } from './normalize';
import { processState } from '@/lib/processState';
import type { ApplyOrderToStockResult, StockOrderSource } from './types';

const LINKABLE_STATUSES = ['active', 'paused', 'error', 'unsupported'];
const SCAN_LIMIT = 500;
const SCAN_OVERLAP_MS = 10 * 60 * 1000;
/** A cursor-head order that keeps failing is given up after this many scans (logged). */
export const SCAN_MAX_ORDER_FAILURES = 5;

// Failure counts per order across scans (one per process; see lib/processState.ts).
const scanFailures = processState('stock.orderScanFailures', () => new Map<string, number>());

/**
 * Pure: where the scan cursor may move after processing `rows` in keyset
 * order. It stops just before the first order that failed (so the next scan
 * retries it), unless that order has failed SCAN_MAX_ORDER_FAILURES times.
 */
export function advanceScanCursor(
  start: { at: Date; id: string },
  rows: Array<{ id: string; updatedAt: Date; failed: boolean; failures: number }>,
): { at: Date; id: string; blockedBy: string | null } {
  let cur = { at: start.at, id: start.id };
  for (const r of rows) {
    if (r.failed && r.failures < SCAN_MAX_ORDER_FAILURES) return { ...cur, blockedBy: r.id };
    cur = { at: r.updatedAt, id: r.id };
  }
  return { ...cur, blockedBy: null };
}

function warn(msg: string, details: Record<string, unknown>) {
  try {
    void Promise.resolve(logger.warn(msg, details)).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** Channels the user has a DIRECT integration for (aggregator copies defer to them). */
export async function connectedDirectChannels(userId: string): Promise<Set<string>> {
  const [etsy, cred, shopify, wix] = await Promise.all([
    prisma.etsyShop.count({ where: { userId, isActive: true } }),
    prisma.credential.findUnique({ where: { userId }, select: { ebayAccessToken: true, trendyolApiKey: true, amazonRefreshToken: true } }),
    prisma.shopifyShop.count({ where: { userId, isActive: true } }),
    prisma.wixSite.count({ where: { userId, isActive: true } }),
  ]);
  const s = new Set<string>();
  if (etsy) s.add('etsy');
  if (cred?.ebayAccessToken) s.add('ebay');
  if (cred?.trendyolApiKey) s.add('trendyol');
  if (cred?.amazonRefreshToken) s.add('amazon');
  if (shopify) s.add('shopify');
  if (wix) s.add('wix');
  return s;
}

// Daily unmatched-sale rollup (per process; the notification carries the count).
const unmatchedSeen = new Map<string, Set<string>>();

function trackUnmatched(userId: string, entries: Array<{ key: string; sku: string }>): { count: number; skus: string[] } {
  const day = new Date().toISOString().slice(0, 10);
  const k = `${userId}|${day}`;
  for (const key of Array.from(unmatchedSeen.keys())) if (!key.endsWith(day)) unmatchedSeen.delete(key);
  const set = unmatchedSeen.get(k) || new Set<string>();
  for (const e of entries) set.add(`${e.key}#${e.sku}`);
  unmatchedSeen.set(k, set);
  const skus = Array.from(new Set(Array.from(set).map((x) => x.split('#').slice(1).join('#')).filter(Boolean))).slice(0, 5);
  return { count: set.size, skus };
}

async function reportUnmatched(userId: string, entries: Array<{ key: string; sku: string }>) {
  if (!entries.length) return;
  const { count, skus } = trackUnmatched(userId, entries);
  const day = new Date().toISOString().slice(0, 10);
  void notify(userId, {
    type: 'stockUnmatchedSale',
    severity: 'info',
    titleKey: 'types.stockUnmatchedSale',
    params: { count, skus: skus.join(', ') },
    link: STOCK_PAGE_LINK,
    dedupeKey: `stock:unmatched:${day}`,
    escalateOn: 'count',
  });
  publishLive(userId, { type: 'stock', kind: 'unmatched_sale' });
}

/** A non-aggregator Order row already moved stock for this orderKey. */
async function directRowRecorded(userId: string, orderKey: string, selfOrderId: string): Promise<boolean> {
  const rows = await prisma.stockLedger.findMany({
    where: { userId, orderKey, kind: { in: ['sale', 'sale_adjust', 'cancel'] }, orderId: { not: null } },
    select: { orderId: true },
    distinct: ['orderId'],
  });
  const ids = rows.map((r) => r.orderId!).filter((id) => id !== selfOrderId);
  if (!ids.length) return false;
  const others = await prisma.order.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, marketplace: true, marketplaceKey: true, orderNumber: true, source: true, rawData: true },
  });
  return others.some((o) => resolveOrderChannel(o as any).via === 'direct');
}

type Line = { id: string; sku: string | null; quantity: number; listingRef: string | null; variantRef: string | null; variantValueKey: string | null };

async function resolveLine(userId: string, channel: string | null, line: Line): Promise<{ stockItemId: string; linkId: string | null; unitsPerSale: number } | null> {
  if (channel && line.listingRef) {
    const candidates = await prisma.stockLink.findMany({
      where: { userId, channel, externalId: String(line.listingRef), status: { in: LINKABLE_STATUSES } },
      select: { id: true, stockItemId: true, variantRef: true, variantValueKey: true, unitsPerSale: true },
    });
    const vr = line.variantRef ?? '';
    const hit =
      candidates.find((c) => c.variantRef === vr) ||
      (line.variantValueKey ? candidates.find((c) => c.variantValueKey && c.variantValueKey === line.variantValueKey) : undefined) ||
      candidates.find((c) => c.variantRef === '*') ||
      (candidates.length === 1 && candidates[0].variantRef === '' ? candidates[0] : undefined);
    if (hit) return { stockItemId: hit.stockItemId, linkId: hit.id, unitsPerSale: hit.unitsPerSale };
  }
  if (channel && line.sku) {
    const raw = String(line.sku).trim();
    const byExt = await prisma.stockLink.findFirst({
      where: { userId, channel, externalId: raw, status: { in: LINKABLE_STATUSES } },
      select: { id: true, stockItemId: true, unitsPerSale: true },
    });
    if (byExt) return { stockItemId: byExt.stockItemId, linkId: byExt.id, unitsPerSale: byExt.unitsPerSale };
  }
  const sku = normalizeSku(line.sku);
  if (!sku) return null;
  const item = await prisma.stockItem.findUnique({ where: { userId_sku: { userId, sku } }, select: { id: true } });
  if (!item) return null;
  if (channel) {
    const links = await prisma.stockLink.findMany({
      where: { userId, stockItemId: item.id, channel, status: { in: LINKABLE_STATUSES } },
      select: { id: true, unitsPerSale: true },
    });
    if (links.length === 1) return { stockItemId: item.id, linkId: links[0].id, unitsPerSale: links[0].unitsPerSale };
  }
  return { stockItemId: item.id, linkId: null, unitsPerSale: 1 };
}

export async function applyOrderToStockImpl(orderId: string, opts: { source: StockOrderSource; sourceEventId?: string }): Promise<ApplyOrderToStockResult> {
  const res: ApplyOrderToStockResult = { applied: 0, deduped: 0, unmatched: 0, restocked: 0 };
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      marketplace: true,
      marketplaceKey: true,
      orderNumber: true,
      source: true,
      status: true,
      rawData: true,
      createdAt: true,
      uiOrderDate: true,
      items: { select: { id: true, sku: true, quantity: true, listingRef: true, variantRef: true, variantValueKey: true } },
    },
  });
  if (!order) return { ...res, skipped: 'disabled' };
  const settings = await getStockSettings(order.userId);
  if (!isStockSyncActive(settings)) return { ...res, skipped: 'disabled' };
  const orderDate = order.uiOrderDate ?? order.createdAt;
  if (!settings!.enabledAt || orderDate.getTime() < settings!.enabledAt.getTime()) return { ...res, skipped: 'before_enable' };

  const info = resolveOrderChannel(order);
  const directChannels = await connectedDirectChannels(order.userId);
  const orderKey = deriveOrderKey(order, { directChannels });
  if (!orderKey) {
    await reportUnmatched(order.userId, [{ key: `order:${order.id}`, sku: '' }]);
    return { ...res, unmatched: order.items.length, skipped: 'aggregator_unresolved' };
  }
  const channel = info.channel;
  const statusClass = orderStatusClass(order);

  // An aggregator copy (Veeqo / Shippo) of a channel we also import directly
  // defers to the direct row once that row recorded this order: the direct row
  // is authoritative. A copy of an order the direct integration never saw (a
  // second shop that only comes in through the aggregator) is applied, but may
  // never REDUCE a recorded sale (thin line data must not undo it).
  const aggregatorCopy = (info.via === 'veeqo' || info.via === 'shippo') && !!channel && directChannels.has(channel);
  if (aggregatorCopy && (await directRowRecorded(order.userId, orderKey, order.id))) {
    return { ...res, deduped: order.items.length };
  }

  // Desired units per stock item for this order.
  const desired = new Map<string, { units: number; linkId: string | null }>();
  const unmatched: Array<{ key: string; sku: string }> = [];
  for (const line of order.items) {
    const qty = Math.max(0, Math.trunc(line.quantity || 0));
    if (!qty) continue;
    const r = await resolveLine(order.userId, channel, line);
    if (!r) {
      res.unmatched++;
      unmatched.push({ key: `${orderKey}:${line.id}`, sku: String(line.sku || line.listingRef || '').slice(0, 40) });
      continue;
    }
    const prev = desired.get(r.stockItemId) || { units: 0, linkId: r.linkId };
    prev.units += qty * Math.max(1, r.unitsPerSale);
    if (!prev.linkId && r.linkId) prev.linkId = r.linkId;
    desired.set(r.stockItemId, prev);
  }

  // Only a cancellation looks at items this order moved earlier (to restock them
  // even if its lines no longer resolve). Open orders never reduce a recorded
  // sale because a line is missing: another Order row with the same orderKey may
  // simply carry less line data.
  const touched = new Set<string>(Array.from(desired.keys()));
  if (statusClass === 'cancelled') {
    const prior = await prisma.stockLedger.findMany({
      where: { userId: order.userId, orderKey, kind: { in: ['sale', 'sale_adjust'] } },
      select: { stockItemId: true },
      distinct: ['stockItemId'],
    });
    for (const p of prior) touched.add(p.stockItemId);
  }

  for (const stockItemId of Array.from(touched)) {
    try {
      if (statusClass === 'cancelled') {
        if (!settings!.restockOnCancel) continue;
        const out = await applyCancel({ userId: order.userId, stockItemId, orderKey, orderId: order.id, channel, sourceEventId: opts.sourceEventId ?? null });
        if (out.status === 'applied') res.restocked++;
        else res.deduped++;
        continue;
      }
      if (statusClass === 'returned') continue; // returns are restocked manually
      const d = desired.get(stockItemId);
      const out = await applySaleDesired({
        userId: order.userId,
        stockItemId,
        orderKey,
        orderId: order.id,
        channel,
        desiredUnits: d?.units ?? 0,
        originLinkId: d?.linkId ?? null,
        sourceEventId: opts.sourceEventId ?? null,
        noReduce: aggregatorCopy,
      });
      if (out.status === 'applied') res.applied++;
      else if (out.status === 'deduped') res.deduped++;
    } catch (err) {
      res.failed = (res.failed ?? 0) + 1;
      warn('stock.apply_order_item_failed', { orderId: order.id, stockItemId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (statusClass === 'open' && unmatched.length) await reportUnmatched(order.userId, unmatched);
  return res;
}

/**
 * Safety-net scan (every 5 min): keyset over (updatedAt, id) from the stored
 * cursor, then a 10-minute overlap pass for rows committed late. The ledger
 * makes re-processing idempotent.
 */
export async function scanOrdersForStockImpl(opts: { userId?: string; limit?: number } = {}): Promise<{ users: number; orders: number }> {
  const limit = Math.min(SCAN_LIMIT, Math.max(1, opts.limit ?? SCAN_LIMIT));
  const settingsRows = await prisma.stockSettings.findMany({
    where: { enabled: true, ...(opts.userId ? { userId: opts.userId } : {}) },
    select: { userId: true, enabledAt: true, orderScanCursorAt: true, orderScanCursorId: true },
  });
  let orders = 0;
  let users = 0;
  for (const s of settingsRows) {
    if (!isStockSyncActive({ enabled: true })) break;
    users++;
    const startAt = s.orderScanCursorAt ?? s.enabledAt ?? new Date();
    const startId = s.orderScanCursorAt ? s.orderScanCursorId ?? '' : '';
    const fresh = await prisma.order.findMany({
      where: {
        userId: s.userId,
        OR: [{ updatedAt: { gt: startAt } }, { updatedAt: startAt, id: { gt: startId } }],
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, updatedAt: true },
    });
    const seen = new Set<string>();
    const processed: Array<{ id: string; updatedAt: Date; failed: boolean; failures: number }> = [];
    for (const o of fresh) {
      seen.add(o.id);
      let failed = false;
      try {
        const r = await applyOrderToStockImpl(o.id, { source: 'order_scan' });
        failed = (r.failed ?? 0) > 0;
      } catch (err) {
        failed = true;
        warn('stock.scan_order_failed', { orderId: o.id, error: err instanceof Error ? err.message : String(err) });
      }
      orders++;
      const failures = failed ? (scanFailures.get(o.id) ?? 0) + 1 : 0;
      if (failed) scanFailures.set(o.id, failures);
      else scanFailures.delete(o.id);
      processed.push({ id: o.id, updatedAt: o.updatedAt, failed, failures });
      // Stop at the first failure that will be retried: nothing after it may move the cursor.
      if (failed && failures < SCAN_MAX_ORDER_FAILURES) break;
      if (failed) {
        scanFailures.delete(o.id);
        warn('stock.scan_order_gave_up', { orderId: o.id, failures });
      }
    }
    const next = advanceScanCursor({ at: startAt, id: startId }, processed);
    const cursorAt = next.at;
    const cursorId = next.id;
    if (scanFailures.size > 5000) scanFailures.clear();
    if (!next.blockedBy && fresh.length < limit && s.orderScanCursorAt) {
      const overlap = await prisma.order.findMany({
        where: { userId: s.userId, updatedAt: { gte: new Date(cursorAt.getTime() - SCAN_OVERLAP_MS), lte: cursorAt } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: { id: true },
      });
      for (const o of overlap) {
        if (seen.has(o.id)) continue;
        await applyOrderToStockImpl(o.id, { source: 'order_scan' }).catch(() => undefined);
        orders++;
      }
    }
    await prisma.stockSettings.update({ where: { userId: s.userId }, data: { orderScanCursorAt: cursorAt, orderScanCursorId: cursorId } });
  }
  return { users, orders };
}
