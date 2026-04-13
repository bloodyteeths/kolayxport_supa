import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isWixEnabled } from '@/lib/config';
import { startSync, updateSyncProgress, completeSync, cleanupStaleSyncs } from '@/lib/sync-status';
import { createWixClient } from '@/lib/integrations/wixClient';
import { mapWixOrders } from '@/lib/mappers/wix';

type SyncMetrics = {
  processedOrders: number;
  successfulOrders: number;
  failedOrders: number;
  errors: Array<{ orderId: string; error: string }>;
};

/**
 * Sync recent Wix orders for a specific user.
 * Skips silently if user has no Wix credentials or Wix is disabled.
 */
export async function syncWixRecentOrdersForUser(userId: string): Promise<SyncMetrics | null> {
  if (!userId) return null;

  if (!isWixEnabled(userId)) {
    logger.info(`[WIX SYNC] Skipping user ${userId}: integration disabled`);
    return null;
  }

  // Try WixSite first, fall back to Credential
  const wixSite = await prisma.wixSite.findFirst({
    where: { userId, isActive: true },
  });

  const cred = await prisma.credential.findUnique({ where: { userId } });
  const credential = wixSite
    ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: cred?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
    : cred;

  if (!credential?.wixInstanceId || !credential?.wixSiteId) {
    logger.info(`[WIX SYNC] Skipping user ${userId}: missing credentials`);
    return null;
  }

  const syncType = 'wix';
  let syncId: string | undefined;
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: Array<{ orderId: string; error: string }> = [];

  try {
    await cleanupStaleSyncs(userId, syncType);
    syncId = await startSync(userId, syncType);

    // Token refresh callback — persist to both WixSite and Credential
    const onTokenRefresh = async (creds: any) => {
      try {
        if (wixSite) {
          await prisma.wixSite.update({
            where: { id: wixSite.id },
            data: {
              accessToken: creds.accessToken,
              tokenExpiresAt: creds.tokenExpiresAt,
            },
          });
        }
        await prisma.credential.update({
          where: { userId },
          data: {
            wixAccessToken: creds.accessToken,
            wixTokenExpiresAt: creds.tokenExpiresAt,
          },
        });
      } catch (e) {
        logger.warn(`[WIX SYNC] Failed to persist refreshed tokens for user ${userId}`);
      }
    };

    const client = createWixClient(credential, onTokenRefresh);

    // Fetch orders from last 30 days using cursor pagination
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let allOrders: any[] = [];
    let cursor: string | undefined;

    while (true) {
      const result = await client.searchOrders({
        limit: 100,
        cursor,
        dateCreatedFrom: thirtyDaysAgo,
      });
      allOrders = allOrders.concat(result.orders);
      if (!result.hasNext || result.orders.length === 0) break;
      cursor = result.cursor;
    }

    logger.info(`[WIX SYNC] Fetched ${allOrders.length} orders for user ${userId}`);

    const uiOrders = mapWixOrders(allOrders);

    // Batch upsert
    const BATCH_SIZE = 5;
    const total = uiOrders.length;

    for (let i = 0; i < uiOrders.length; i += BATCH_SIZE) {
      const batch = uiOrders.slice(i, i + BATCH_SIZE);
      for (const ui of batch) {
        try {
          const orderData = mapUIToPrisma(ui, userId);
          const itemsData = (ui.line_items || []).map((item: any) => mapUIItemToPrisma(item, orderData));
          await prisma.order.upsert({
            where: {
              userId_marketplace_marketplaceKey: {
                userId,
                marketplace: orderData.marketplace,
                marketplaceKey: orderData.marketplaceKey,
              },
            },
            update: { ...orderData, userId, items: { deleteMany: {}, create: itemsData } },
            create: { ...orderData, userId, items: { create: itemsData } },
          });
          successful++;
        } catch (err: any) {
          failed++;
          errors.push({ orderId: String(ui?.id ?? ui?.orderNumber ?? 'unknown'), error: err?.message || String(err) });
        } finally {
          processed++;
          if (syncId) {
            await updateSyncProgress(syncId, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, totalOrders: total, errors });
          }
        }
      }
      if (i + BATCH_SIZE < uiOrders.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Update last sync timestamp
    if (wixSite) {
      await prisma.wixSite.update({
        where: { id: wixSite.id },
        data: { lastOrderSyncAt: new Date() },
      });
    }

    if (syncId) {
      await completeSync(syncId, failed === 0, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, totalOrders: total, errors });
    }

    return { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors };
  } catch (err: any) {
    if (syncId) {
      await completeSync(syncId, false, {
        processedOrders: processed, successfulOrders: successful, failedOrders: failed + 1,
        errors: [...errors, { orderId: 'sync', error: err?.message || String(err) }],
      });
    }
    logger.error(`[WIX SYNC] Failed for user ${userId}`, err);
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
    image: lineItem.image || '',
    marketplaceKey: String(lineItem.id || Date.now()),
    shipBy: lineItem.shipBy ? new Date(lineItem.shipBy) : null,
    orderNumber: orderData.orderNumber,
    uniqueLineKey: String(lineItem.id || Date.now()),
    remoteLineId: String(lineItem.id || Date.now()),
    weightKg: lineItem.weight || 0.5,
    harmonizedCode: lineItem.hs_code || null,
    countryOfMfg: null,
    recipientEmail: orderData.rawData?.buyerInfo?.email || null,
  };
}
