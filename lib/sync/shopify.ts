// lib/sync/shopify.ts
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isShopifyEnabled } from '@/lib/config';
import { startSync, updateSyncProgress, completeSync, cleanupStaleSyncs } from '@/lib/sync-status';
import { ShopifyClient, getValidAccessToken } from '@/lib/integrations/shopifyClient';
import { toOrder } from '@/lib/mappers/shopify';

type SyncMetrics = {
  processedOrders: number;
  successfulOrders: number;
  failedOrders: number;
  errors: Array<{ orderId: string; error: string }>;
};

/**
 * Sync recent Shopify orders for a specific user.
 * Iterates all active ShopifyShop records for multi-store support.
 */
export async function syncShopifyRecentOrdersForUser(userId: string): Promise<SyncMetrics | null> {
  if (!userId) return null;

  if (!isShopifyEnabled(userId)) {
    logger.info(`[SHOPIFY SYNC] Skipping user ${userId}: integration disabled`);
    return null;
  }

  // Get all active Shopify shops for user
  const shops = await prisma.shopifyShop.findMany({
    where: { userId, isActive: true },
  });

  if (shops.length === 0) {
    logger.info(`[SHOPIFY SYNC] Skipping user ${userId}: no active shops`);
    return null;
  }

  const syncType = 'shopify';
  let syncId: string | undefined;
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors: Array<{ orderId: string; error: string }> = [];

  try {
    await cleanupStaleSyncs(userId, syncType);
    syncId = await startSync(userId, syncType);

    for (const shop of shops) {
      try {
        const accessToken = await getValidAccessToken(shop.id);
        const client = new ShopifyClient({
          accessToken,
          shopDomain: shop.shopDomain,
        });

        // Fetch orders from last 7 days or since last sync
        const sinceDate = shop.lastOrderSyncAt
          ? new Date(shop.lastOrderSyncAt.getTime() - 60 * 60 * 1000).toISOString() // 1hr overlap buffer
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const rawOrders = await client.getOrders({
          status: 'any',
          created_at_min: sinceDate,
        });

        logger.info(`[SHOPIFY SYNC] Fetched ${rawOrders.length} orders from ${shop.shopDomain}`, { userId, shop: shop.shopDomain, orderCount: rawOrders.length });

        // Shopify order line_items don't include an image field. Fetch each unique
        // product_id once and stamp the featured image onto every line_item that
        // references it, so the order/label UI shows product thumbnails.
        const productIdsNeeded = new Set<string>();
        for (const o of rawOrders) {
          for (const li of (o.line_items || [])) {
            if (li.product_id && !li.image) productIdsNeeded.add(String(li.product_id));
          }
        }
        const imageByProductId: Record<string, string> = {};
        const ids = Array.from(productIdsNeeded);
        const CHUNK = 5;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          await Promise.all(chunk.map(async (pid) => {
            try {
              const product = await client.getProduct(pid);
              const src = product?.image?.src || product?.images?.[0]?.src;
              if (src) imageByProductId[pid] = src;
            } catch (err: any) {
              logger.warn(`[SHOPIFY SYNC] product ${pid} image fetch failed`, { err: err?.message });
            }
          }));
        }
        for (const o of rawOrders) {
          for (const li of (o.line_items || [])) {
            const src = imageByProductId[String(li.product_id)];
            if (li.product_id && !li.image && src) li.image = { src };
          }
        }
        if (ids.length) {
          logger.info(`[SHOPIFY SYNC] Enriched ${Object.keys(imageByProductId).length}/${ids.length} product images`, { userId });
        }

        // Map to UIOrder format
        const uiOrders = rawOrders.map((o: any) => toOrder(o, shop.shopDomain));

        // Upsert in batches
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
                update: {
                  ...orderData,
                  userId,
                  items: { deleteMany: {}, create: itemsData },
                },
                create: {
                  ...orderData,
                  userId,
                  items: { create: itemsData },
                },
              });
              successful++;
            } catch (err: any) {
              failed++;
              errors.push({
                orderId: String(ui?.id ?? ui?.orderNumber ?? 'unknown'),
                error: err?.message || String(err),
              });
            } finally {
              processed++;
              if (syncId) {
                await updateSyncProgress(syncId, {
                  processedOrders: processed,
                  successfulOrders: successful,
                  failedOrders: failed,
                  totalOrders: total,
                  errors,
                });
              }
            }
          }
          if (i + BATCH_SIZE < uiOrders.length) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        // Update last sync timestamp
        await prisma.shopifyShop.update({
          where: { id: shop.id },
          data: { lastOrderSyncAt: new Date() },
        });
      } catch (shopErr: any) {
        logger.error(`[SHOPIFY SYNC] Failed for shop ${shop.shopDomain}`, shopErr);
        errors.push({ orderId: `shop:${shop.shopDomain}`, error: shopErr.message });
      }
    }

    if (syncId) {
      await completeSync(syncId, failed === 0, {
        processedOrders: processed,
        successfulOrders: successful,
        failedOrders: failed,
        totalOrders: processed,
        errors,
      });
    }

    return { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors };
  } catch (err: any) {
    if (syncId) {
      await completeSync(syncId, false, {
        processedOrders: processed,
        successfulOrders: successful,
        failedOrders: failed + 1,
        errors: [...errors, { orderId: 'sync', error: err?.message || String(err) }],
      });
    }
    logger.error(`[SHOPIFY SYNC] Failed for user ${userId}`, err);
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
    recipientEmail: orderData.rawData?.email || null,
  };
}
