import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isTrendyolEnabled } from "@/lib/config";
import { startSync, updateSyncProgress, completeSync, cleanupStaleSyncs } from "@/lib/sync-status";
import { fetchTrendyolOrders, fetchCreatedOrders } from "@/lib/integrations/trendyolClient";
import { toOrder, mapTrendyolOrdersWithImages } from "@/lib/mappers/trendyol";

type SyncMetrics = {
  processedOrders: number;
  successfulOrders: number;
  failedOrders: number;
  errors: Array<{ orderId: string; error: string }>;
};

/**
 * Run a recent Trendyol orders sync for a specific user.
 * - Skips silently if user has no Trendyol credentials or Trendyol is disabled for the user
 * - Uses conservative batching to avoid DB connection exhaustion
 */
export async function syncTrendyolRecentOrdersForUser(userId: string): Promise<SyncMetrics | null> {
  if (!userId) return null;

  if (!isTrendyolEnabled(userId)) {
    logger.info(`[TRENDYOL SYNC] Skipping user ${userId}: integration disabled`);
    return null;
  }

  const settings = await prisma.credential.findUnique({ where: { userId } });
  if (!settings?.trendyolApiKey || !settings?.trendyolApiSecret || !settings?.trendyolSupplierId) {
    logger.info(`[TRENDYOL SYNC] Skipping user ${userId}: missing credentials`);
    return null;
  }

  const syncType = "trendyol";
  let syncId: string | undefined;
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: Array<{ orderId: string; error: string }> = [];

  try {
    // Clean stale operations
    await cleanupStaleSyncs(userId, syncType);

    syncId = await startSync(userId, syncType);

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const futureBuffer = now + 3 * 60 * 60 * 1000; // timezone buffer

    let orders: any[] = [];
    try {
      const allOrders = await fetchTrendyolOrders({
        supplierId: settings.trendyolSupplierId,
        apiKey: settings.trendyolApiKey,
        apiSecret: settings.trendyolApiSecret,
        status: undefined,
        startDateMs: null,
        endDateMs: null,
        pageSize: 200,
      });
      orders = allOrders.filter((order: any) => {
        if (!order.orderDate) return false;
        const ts = typeof order.orderDate === "string" ? new Date(order.orderDate).getTime() : order.orderDate;
        return ts >= sevenDaysAgo && ts <= futureBuffer;
      });
    } catch (err: any) {
      logger.warn(`[TRENDYOL SYNC] Main fetch failed for user ${userId}: ${err?.message}`);
      try {
        const created = await fetchCreatedOrders({
          supplierId: settings.trendyolSupplierId,
          apiKey: settings.trendyolApiKey,
          apiSecret: settings.trendyolApiSecret,
          startDateMs: null,
          endDateMs: null,
          pageSize: 100,
        });
        orders = created.filter((order: any) => {
          if (!order.orderDate) return false;
          const ts = typeof order.orderDate === "string" ? new Date(order.orderDate).getTime() : order.orderDate;
          return ts >= sevenDaysAgo && ts <= futureBuffer;
        });
      } catch (fallbackErr: any) {
        logger.error(`[TRENDYOL SYNC] Fallback fetch failed for user ${userId}: ${fallbackErr?.message}`);
        orders = [];
      }
    }

    // Map orders (prefer enriched mapping with images, fallback to basic mapping)
    let uiOrders: any[] = [];
    try {
      uiOrders = await mapTrendyolOrdersWithImages(orders, {
        supplierId: settings.trendyolSupplierId,
        apiKey: settings.trendyolApiKey,
        apiSecret: settings.trendyolApiSecret,
      });
    } catch (e: any) {
      logger.warn(`[TRENDYOL SYNC] mapTrendyolOrdersWithImages failed for user ${userId}: ${e?.message}`);
      const computeShipBy = (order: any) => {
        const shipMs = order.extendedAgreedDeliveryDate && order.extendedAgreedDeliveryDate > 0
          ? order.extendedAgreedDeliveryDate
          : order.agreedDeliveryDate;
        return shipMs ? new Date(Number(shipMs)).toISOString() : undefined;
      };
      uiOrders = orders.map((o: any) => {
        const base = toOrder(o);
        const sb = computeShipBy(o);
        base.line_items = (base.line_items || []).map((it: any) => ({ ...it, shipBy: sb }));
        return base;
      });
    }

    const BATCH_SIZE = 5;
    const total = uiOrders.length;
    for (let i = 0; i < uiOrders.length; i += BATCH_SIZE) {
      const batch = uiOrders.slice(i, i + BATCH_SIZE);
      for (const ui of batch) {
        try {
          const orderData = mapUIToPrisma(ui, userId);
          const itemsData = (ui.line_items || []).map((item: any) => mapUIItemToPrisma(item, orderData));
          await prisma.order.upsert({
            where: { userId_marketplace_marketplaceKey: { userId, marketplace: orderData.marketplace, marketplaceKey: orderData.marketplaceKey } },
            update: { ...orderData, userId, items: { deleteMany: {}, create: itemsData } },
            create: { ...orderData, userId, items: { create: itemsData } },
          });
          successful++;
        } catch (err: any) {
          failed++;
          errors.push({ orderId: String(ui?.id ?? ui?.orderNumber ?? "unknown"), error: err?.message || String(err) });
        } finally {
          processed++;
          if (syncId) {
            await updateSyncProgress(syncId, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, totalOrders: total, errors });
          }
        }
      }
      if (i + BATCH_SIZE < uiOrders.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    if (syncId) {
      await completeSync(syncId, failed === 0, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, totalOrders: total, errors });
    }

    return { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors };
  } catch (err: any) {
    if (syncId) {
      await completeSync(syncId, false, { processedOrders: processed, successfulOrders: successful, failedOrders: failed + 1, errors: [...errors, { orderId: "sync", error: err?.message || String(err) }] });
    }
    logger.error(`[TRENDYOL SYNC] Failed for user ${userId}`, err);
    throw err;
  }
}

function mapUIToPrisma(uiOrder: any, userId: string) {
  return {
    userId,
    marketplace: uiOrder.marketplace,
    marketplaceKey: String(uiOrder.marketplaceKey),
    uiOrderDate: uiOrder.marketplaceOrderDate ? new Date(uiOrder.marketplaceOrderDate) : new Date(),
    customerName: uiOrder.customerName,
    status: uiOrder.status,
    currency: uiOrder.currency,
    totalPrice: uiOrder.totalPrice,
    orderNumber: uiOrder.orderNumber,
    shippingAddress: uiOrder.shippingAddress,
    rawData: uiOrder.rawData,
    commodityDesc: uiOrder.commodityDesc,
    externalStatus: uiOrder.externalStatus,
    shippedAt: null,
    shippingLabelUrl: null,
    trackingNumber: null,
    labelStatus: null,
  };
}

function mapUIItemToPrisma(lineItem: any, orderData: any) {
  return {
    sku: lineItem.sku || null,
    productName: lineItem.title || null,
    variantInfo: lineItem.variantInfo || null,
    quantity: lineItem.quantity || 1,
    unitPrice: lineItem.value || null,
    totalPrice: (lineItem.value || 0) * (lineItem.quantity || 1),
    image: lineItem.image || "",
    marketplaceKey: String(lineItem.id || Date.now()),
    shipBy: lineItem.shipBy ? new Date(lineItem.shipBy) : null,
    orderNumber: orderData.orderNumber,
    uniqueLineKey: String(lineItem.id || Date.now()),
    remoteLineId: String(lineItem.id || Date.now()),
    weightKg: lineItem.weight || 0.5,
    harmonizedCode: lineItem.hs_code || null,
    countryOfMfg: null,
    recipientEmail: orderData.rawData?.customerEmail || null,
  };
}


