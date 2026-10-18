/**
 * Hepsiburada order sync for one user (pattern: lib/sync/trendyol.ts).
 *
 * Sources folded into an HbOrderBook (lib/hepsiburada/orderMapper.ts):
 *   1. open lines            GET /orders                   (all pages, no date filter: every unpacked line)
 *   2. packages to ship      GET /packages                 (limit 10, capital Offset)
 *   3. shipped/delivered/undelivered package lists          (status only; HB rejects their date filters)
 *   4. cancelled lines       GET /orders/.../cancelled
 *   5. order detail          GET /orders/.../ordernumber/n for orders seen only in 3/4 whose stored status changed
 * Then one upsert per order through upsertMarketplaceOrder (skip-unchanged hashing, outbox, live events).
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { upsertMarketplaceOrder, publishOrderWrites, type LiveWrite } from '@/lib/orders/marketplaceOrderWrite';
import { startSync, updateSyncProgress, completeSync, cleanupStaleSyncs } from '@/lib/sync-status';
import { isAuthFailure, isConnectionBlocked, recordAuthFailure, recordAuthSuccess } from '@/lib/integrations/authFailures';
import { inAuthorizationGrace, loadHepsiburadaClient } from './server';
import { hbErrorMessage, type HepsiburadaClient } from './client';
import { HbOrderBook, toUIOrder, HB_MARKETPLACE, HB_SOURCE } from './orderMapper';

export interface HbSyncMetrics {
  processedOrders: number;
  successfulOrders: number;
  failedOrders: number;
  errors: Array<{ orderId: string; error: string }>;
}

const MAX_OPEN_PAGES = 30; // ×100 lines
const MAX_PACKAGE_PAGES = 50; // ×10 packages
const STATUS_PAGES = 2; // ×100, newest first
const MAX_DETAIL_FETCHES = 40;

/** Read every page of an offset/limit list until a short page or the cap. */
async function pages<T>(fetchPage: (offset: number) => Promise<T[]>, pageSize: number, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < maxPages; p++) {
    const rows = await fetchPage(p * pageSize);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

const itemsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : Array.isArray(r?.Items) ? r.Items : []);

/** Fill the book from HB. Exported for the SIT smoke script and tests. */
export async function collectHepsiburadaOrders(client: HepsiburadaClient, opts: { knownStatus?: Map<string, string> } = {}): Promise<HbOrderBook> {
  const book = new HbOrderBook();

  const open = await pages((offset) => client.listOrders({ offset, limit: 100 }).then(itemsOf), 100, MAX_OPEN_PAGES);
  for (const line of open) book.addLine(line);

  const packages = await pages((offset) => client.listPackages({ offset, limit: 10 }).then(itemsOf), 10, MAX_PACKAGE_PAGES);
  for (const pkg of packages) book.addPackage(pkg);

  // Status lists and cancellations are best-effort: a failure here must not drop the open orders above.
  const statusLists: Array<['shipped' | 'delivered' | 'undelivered', (o: number) => Promise<any>]> = [
    ['shipped', (offset) => client.listShippedPackages({ offset, limit: 100 })],
    ['delivered', (offset) => client.listDeliveredPackages({ offset, limit: 100 })],
    ['undelivered', (offset) => client.listUndeliveredPackages({ offset, limit: 100 })],
  ];
  for (const [state, fetchPage] of statusLists) {
    try {
      const rows = await pages((offset) => fetchPage(offset).then(itemsOf), 100, STATUS_PAGES);
      for (const row of rows) book.addPackageStatus(row, state);
    } catch (err) {
      if (isAuthFailure(err)) throw err;
      logger.warn(`[HEPSIBURADA SYNC] ${state} list failed`, { error: hbErrorMessage(err) });
    }
  }
  try {
    const cancelled = await pages((offset) => client.listCancelledOrders({ offset, limit: 100 }).then(itemsOf), 100, STATUS_PAGES);
    for (const row of cancelled) book.addCancelled(row);
  } catch (err) {
    if (isAuthFailure(err)) throw err;
    logger.warn('[HEPSIBURADA SYNC] cancelled list failed', { error: hbErrorMessage(err) });
  }

  // Orders known only by status: fetch detail when new to us or when the status moved.
  const missing = book.ordersMissingDetail().filter((n) => {
    const prev = opts.knownStatus?.get(n);
    if (prev === undefined) return true;
    return prev !== toUIOrder(book.orders.get(n)!).externalStatus;
  });
  for (const orderNumber of missing.slice(0, MAX_DETAIL_FETCHES)) {
    try {
      const detail: any = await client.getOrder(orderNumber);
      for (const line of detail?.items || []) {
        book.addLine({ ...line, orderNumber: line.orderNumber || orderNumber }, {
          orderDate: detail.orderDate, customerName: detail.customer?.name, customerId: detail.customer?.customerId,
          address: detail.deliveryAddress, invoice: detail.invoice, orderId: detail.orderId,
        });
      }
    } catch (err) {
      if (isAuthFailure(err)) throw err;
      logger.warn('[HEPSIBURADA SYNC] order detail failed', { orderNumber, error: hbErrorMessage(err) });
    }
  }
  // Still no line detail (status unchanged, cap reached or fetch failed): never upsert it — an item-less write would
  // wipe the stored items. Unchanged orders need no write; the rest retry next run.
  for (const n of book.ordersMissingDetail()) book.orders.delete(n);
  return book;
}

export async function syncHepsiburadaRecentOrdersForUser(userId: string): Promise<HbSyncMetrics | null> {
  if (!userId) return null;
  const loaded = await loadHepsiburadaClient(userId);
  if (!loaded.ok) {
    logger.info(`[HEPSIBURADA SYNC] Skipping user ${userId}: ${loaded.reason}`);
    return null;
  }
  const { client, merchantId } = loaded;
  if (await isConnectionBlocked(userId, 'hepsiburada', merchantId)) {
    logger.info(`[HEPSIBURADA SYNC] Skipping user ${userId}: reconnect required`);
    return null;
  }

  const syncType = 'hepsiburada';
  let syncId: string | undefined;
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: Array<{ orderId: string; error: string }> = [];

  try {
    await cleanupStaleSyncs(userId, syncType);
    syncId = await startSync(userId, syncType);

    const stored = await prisma.order.findMany({
      where: { userId, marketplace: HB_MARKETPLACE, uiOrderDate: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } },
      select: { marketplaceKey: true, externalStatus: true },
    });
    const knownStatus = new Map(stored.map((o) => [o.marketplaceKey, o.externalStatus || '']));

    let book: HbOrderBook;
    try {
      book = await collectHepsiburadaOrders(client, { knownStatus });
      await recordAuthSuccess(userId, 'hepsiburada', merchantId);
    } catch (err) {
      if (isAuthFailure(err)) {
        // Within 2 h of saving, a 401 is HB still activating the authorization: not a strike toward "reconnect".
        if (!(await inAuthorizationGrace(userId))) await recordAuthFailure(userId, 'hepsiburada', merchantId, err);
        throw Object.assign(new Error(`Hepsiburada rejected the credentials: ${hbErrorMessage(err).slice(0, 200)}`), { authFailure: true });
      }
      throw err;
    }

    const uiOrders = Array.from(book.orders.values()).map(toUIOrder);
    const liveWrites: LiveWrite[] = [];
    const total = uiOrders.length;
    for (const ui of uiOrders) {
      try {
        const write = await upsertMarketplaceOrder(userId, mapUIToPrisma(ui, userId), ui.line_items || [], {
          source: HB_SOURCE,
          recipientEmail: ui.rawData?.customerEmail || null,
          shipByDate: ui.shipByDate ?? null,
        });
        if (write.live) liveWrites.push(write.live);
        successful++;
      } catch (err: any) {
        failed++;
        errors.push({ orderId: ui.orderNumber, error: err?.message || String(err) });
      } finally {
        processed++;
        if (syncId && (processed % 10 === 0 || processed === total)) {
          await updateSyncProgress(syncId, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, totalOrders: total, errors });
        }
      }
    }

    publishOrderWrites(userId, liveWrites, HB_SOURCE);
    if (syncId) {
      await completeSync(syncId, failed === 0, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, totalOrders: total, errors });
    }
    return { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors };
  } catch (err: any) {
    if (syncId) {
      await completeSync(syncId, false, { processedOrders: processed, successfulOrders: successful, failedOrders: failed + 1, errors: [...errors, { orderId: 'sync', error: err?.message || String(err) }] });
    }
    logger.error(`[HEPSIBURADA SYNC] Failed for user ${userId}`, err);
    throw err;
  }
}

function mapUIToPrisma(ui: ReturnType<typeof toUIOrder>, userId: string) {
  return {
    userId,
    marketplace: ui.marketplace,
    marketplaceKey: String(ui.marketplaceKey),
    uiOrderDate: ui.marketplaceOrderDate ? new Date(ui.marketplaceOrderDate) : new Date(),
    customerName: ui.customerName,
    status: ui.status,
    currency: ui.currency,
    totalPrice: ui.totalPrice,
    orderNumber: ui.orderNumber,
    shippingAddress: ui.shippingAddress,
    rawData: ui.rawData,
    commodityDesc: ui.commodityDesc,
    externalStatus: ui.externalStatus,
    shippedAt: null,
    shippingLabelUrl: null,
    trackingNumber: null,
    labelStatus: null,
  };
}

/** Users with Hepsiburada credentials saved (job fan-out). Flag filtering happens per user in the sync. */
export async function listHepsiburadaUserIds(): Promise<string[]> {
  const rows = await prisma.credential.findMany({
    where: { hepsiburadaMerchantId: { not: null }, hepsiburadaApiKey: { not: null } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
