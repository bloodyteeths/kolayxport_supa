// lib/sync/shopify.ts
import prisma from '@/lib/prisma';
import { upsertMarketplaceOrder, publishOrderWrites, type LiveWrite } from '@/lib/orders/marketplaceOrderWrite';
import { logger } from '@/lib/logger';
import { isShopifyEnabled } from '@/lib/config';
import { startSync, updateSyncProgress, completeSync, cleanupStaleSyncs } from '@/lib/sync-status';
import { ShopifyClient, getValidAccessToken } from '@/lib/integrations/shopifyClient';
import { toOrder } from '@/lib/mappers/shopify';
import { isConnectionBlocked, recordAuthFailure, recordAuthSuccess } from '@/lib/integrations/authFailures';

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
  const activeShops = await prisma.shopifyShop.findMany({
    where: { userId, isActive: true },
  });

  if (activeShops.length === 0) {
    logger.info(`[SHOPIFY SYNC] Skipping user ${userId}: no active shops`);
    return null;
  }

  // Shops whose auth was rejected AUTH_FAILURE_THRESHOLD times in a row are parked until the
  // user reconnects (lib/integrations/authFailures.ts); Settings shows them as "Reconnect".
  const shops: typeof activeShops = [];
  for (const shop of activeShops) {
    if (await isConnectionBlocked(userId, 'shopify', shop.shopDomain)) {
      logger.info(`[SHOPIFY SYNC] Skipping shop ${shop.shopDomain}: reconnect required`, { userId, shop: shop.shopDomain });
    } else {
      shops.push(shop);
    }
  }
  if (shops.length === 0) return null;

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
        // Token refresh + an authenticated read both succeeded: reset the auth-failure counter.
        await recordAuthSuccess(userId, 'shopify', shop.shopDomain);

        logger.info(`[SHOPIFY SYNC] Fetched ${rawOrders.length} orders from ${shop.shopDomain}`, { userId, shop: shop.shopDomain, orderCount: rawOrders.length });

        // Line items carry their variant/product image (GraphQL LineItem.image). For the ones
        // without one, fetch each unique product_id once and stamp the featured image onto every
        // line_item that references it, so the order/label UI shows product thumbnails.
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
        const liveWrites: LiveWrite[] = [];
        const total = uiOrders.length;

        for (let i = 0; i < uiOrders.length; i += BATCH_SIZE) {
          const batch = uiOrders.slice(i, i + BATCH_SIZE);
          for (const ui of batch) {
            try {
              const orderData = mapUIToPrisma(ui, userId);
              const write = await upsertMarketplaceOrder(userId, orderData, ui.line_items || [], {
                source: 'shopify',
                recipientEmail: orderData.rawData?.email || null,
              });
              if (write.live) liveWrites.push(write.live);
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

        publishOrderWrites(userId, liveWrites, 'shopify');

        // Update last sync timestamp
        await prisma.shopifyShop.update({
          where: { id: shop.id },
          data: { lastOrderSyncAt: new Date() },
        });
      } catch (shopErr: any) {
        logger.error(`[SHOPIFY SYNC] Failed for shop ${shop.shopDomain}`, shopErr);
        errors.push({ orderId: `shop:${shop.shopDomain}`, error: shopErr.message });
        // Counts only 401/403/invalid_grant/token-refresh rejections; network/5xx are ignored.
        await recordAuthFailure(userId, 'shopify', shop.shopDomain, shopErr);
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
