// This script can be used with GitHub Actions, EasyCron, or any external scheduler to trigger incremental sync for all users every 15 minutes.
// It assumes your site is deployed and accessible at the given BASE_URL.
// You must provide a way to authenticate as each user (e.g. service tokens, or trigger per-user from your backend).

const prisma = require('../lib/prisma.ts').default;
const { startSync, updateSyncProgress, completeSync, cleanupStaleSyncs } = require('../lib/sync-status');
const { fetchVeeqoOrders } = require('../lib/integrations/veeqo');
const { fetchShippoOrders } = require('../lib/integrations/shippo');
const { fetchCreatedOrders, fetchTrendyolOrders } = require('../lib/integrations/trendyolClient');
const { toOrder, mapTrendyolOrdersWithImages } = require('../lib/mappers/trendyol');
// Stub for Hepsiburada integration
async function fetchHepsiburadaOrders(settings) {
  // TODO: Implement real fetch logic for Hepsiburada
  return [];
}

// Trendyol-specific mapper that properly converts to Prisma format
function mapTrendyolOrderToPrisma(trendyolOrder, userId) {
  const uiOrder = toOrder(trendyolOrder);
  
  return {
    userId: userId,
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
    
    // Additional fields from UIOrder
    uiOrderDate: uiOrder.uiOrderDate ? new Date(uiOrder.uiOrderDate) : null,
    commodityDesc: uiOrder.commodityDesc,
    externalStatus: uiOrder.externalStatus,
    
    // Set other required Prisma fields to null/default
    fedexDutiesPaymentType: null,
    fedexPackagingType: null,
    fedexPickupType: null,
    fedexServiceType: null,
    countryOfMfg: null,
    dimensionUnits: null,
    harmonizedCode: null,
    labelStockType: null,
    packageHeight: null,
    packageLength: null,
    packageWidth: null,
    sendCommercialInvoiceViaEtd: null,
    shippingChargesPaymentType: null,
    signatureType: null,
    termsOfSale: null,
    shipmentStatus: null,
    shippedAt: null,
    shippingLabelUrl: null,
    trackingNumber: null,
    labelStatus: null,
  };
}

function mapTrendyolItemToPrisma(trendyolLineItem, orderData) {
  return {
    sku: trendyolLineItem.sku || null,
    productName: trendyolLineItem.title || null,
    variantInfo: trendyolLineItem.variantInfo || null, // Now mapped from productSize + productColor
    quantity: trendyolLineItem.quantity || 1,
    unitPrice: trendyolLineItem.value || null,
    totalPrice: (trendyolLineItem.value || 0) * (trendyolLineItem.quantity || 1),
    image: trendyolLineItem.image || '',
    marketplaceKey: String(trendyolLineItem.id || Date.now()),
    shipBy: null, // Trendyol items don't have individual ship dates
    orderNumber: orderData.orderNumber,
    uniqueLineKey: String(trendyolLineItem.id || Date.now()),
    remoteLineId: String(trendyolLineItem.id || Date.now()),
    
    // Additional fields for order items
    weightKg: trendyolLineItem.weight || 0.5,
    harmonizedCode: trendyolLineItem.hs_code || null,
    countryOfMfg: null,
    recipientEmail: orderData.rawData?.customerEmail || null,
  };
}

// Enhanced mapper for UIOrder (with images) to Prisma format
function mapUIOrderToPrisma(uiOrder, userId) {
  return {
    userId: userId,
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
    
    // Additional fields from UIOrder
    uiOrderDate: uiOrder.uiOrderDate ? new Date(uiOrder.uiOrderDate) : null,
    commodityDesc: uiOrder.commodityDesc,
    externalStatus: uiOrder.externalStatus,
    
    // Set other required Prisma fields to null/default
    fedexDutiesPaymentType: null,
    fedexPackagingType: null,
    fedexPickupType: null,
    fedexServiceType: null,
    countryOfMfg: null,
    dimensionUnits: null,
    harmonizedCode: null,
    labelStockType: null,
    packageHeight: null,
    packageLength: null,
    packageWidth: null,
    sendCommercialInvoiceViaEtd: null,
    shippingChargesPaymentType: null,
    signatureType: null,
    termsOfSale: null,
    shipmentStatus: null,
    shippedAt: null,
    shippingLabelUrl: null,
    trackingNumber: null,
    labelStatus: null,
  };
}

// Enhanced item mapper for UIOrder line items to Prisma format 
function mapUIOrderItemToPrisma(lineItem, orderData) {
  return {
    sku: lineItem.sku || null,
    productName: lineItem.title || null,
    variantInfo: null, // Trendyol items don't have variant info
    quantity: lineItem.quantity || 1,
    unitPrice: lineItem.value || null,
    totalPrice: (lineItem.value || 0) * (lineItem.quantity || 1),
    image: lineItem.image || '',
    marketplaceKey: String(lineItem.id || Date.now()),
    shipBy: null, // Trendyol items don't have individual ship dates
    orderNumber: orderData.orderNumber,
    uniqueLineKey: String(lineItem.id || Date.now()),
    remoteLineId: String(lineItem.id || Date.now()),
    
    // Additional fields for order items
    weightKg: lineItem.weight || 0.5,
    harmonizedCode: lineItem.hs_code || null,
    countryOfMfg: null,
    recipientEmail: orderData.rawData?.customerEmail || null,
  };
}

const { logger } = require('../lib/logger');

// Helper: filter and map order fields to Prisma schema for VEEQO
function mapVeeqoOrderToPrisma(veeqoOrder, userId) {
  const customerFirstName = veeqoOrder.customer?.first_name || veeqoOrder.delivery_address?.first_name;
  const customerLastName = veeqoOrder.customer?.last_name || veeqoOrder.delivery_address?.last_name;
  let customerName = customerFirstName || customerLastName ? `${customerFirstName || ''} ${customerLastName || ''}`.trim() : null;
  if (!customerName && veeqoOrder.delivery_address?.company_name) {
    customerName = veeqoOrder.delivery_address.company_name;
  }

  const marketplaceName = veeqoOrder.channel?.name;
  if (!marketplaceName) {
    logger.warn(`[VEEQO MAPPER] Veeqo order ID ${veeqoOrder.id} does not have 'channel.name'. Falling back to 'Veeqo' as marketplace. Check rawData for correct field.`, { veeqoOrderChannel: veeqoOrder.channel });
  }

  return {
    userId: userId,
    marketplace: marketplaceName || 'Veeqo', // Use dynamic channel name, fallback to 'Veeqo'
    marketplaceKey: String(veeqoOrder.id),
    uiOrderDate: veeqoOrder.created_at ? new Date(veeqoOrder.created_at) : null,
    customerName: customerName,
    status: veeqoOrder.status?.name || veeqoOrder.status || 'Unknown', // Veeqo status can be an object or string
    shipByDate: veeqoOrder.ship_by_date ? new Date(veeqoOrder.ship_by_date) : null,
    currency: veeqoOrder.currency_code || null,
    totalPrice: veeqoOrder.total_discounts_inclusive_tax?.value ? parseFloat(veeqoOrder.total_discounts_inclusive_tax.value) : null,
    notes: veeqoOrder.notes_from_customer || null,
    orderNumber: veeqoOrder.number ? String(veeqoOrder.number) : null,
    
    // Address and raw data
    shippingAddress: veeqoOrder.delivery_address || null, // Veeqo delivery_address is a JSON object
    rawData: veeqoOrder, // Store the original Veeqo order

    // Fields from Prisma schema that are not directly in a typical Veeqo order object
    // These might be populated by other processes (e.g., label generation) or other marketplaces
    fedexDutiesPaymentType: null,
    fedexPackagingType: null,
    fedexPickupType: null,
    fedexServiceType: null,
    commodityDesc: null,
    countryOfMfg: null,
    dimensionUnits: null,
    harmonizedCode: null,
    labelStockType: null,
    packageHeight: null,
    packageLength: null,
    packageWidth: null,
    sendCommercialInvoiceViaEtd: null,
    shippingChargesPaymentType: null,
    signatureType: null,
    termsOfSale: null,
    shipmentStatus: null,
    shippedAt: null,
    shippingLabelUrl: null,
    trackingNumber: null,
  };
}

function mapVeeqoItemToPrisma(veeqoLineItem, orderPrismaData) {
  let unitPrice = null;
  if (veeqoLineItem.price_per_unit && typeof veeqoLineItem.price_per_unit.value !== 'undefined') {
    unitPrice = parseFloat(veeqoLineItem.price_per_unit.value);
  }

  let quantity = 0;
  if (typeof veeqoLineItem.quantity !== 'undefined' && veeqoLineItem.quantity !== null) {
      quantity = parseInt(veeqoLineItem.quantity, 10);
      if (isNaN(quantity)) quantity = 0;
  }
  
  let itemTotalPrice = null;
  // Veeqo API has quantity_x_price_per_unit for total, or use line_total.value if available
  if (veeqoLineItem.line_total?.value) {
    itemTotalPrice = parseFloat(veeqoLineItem.line_total.value);
  } else if (unitPrice !== null) {
    itemTotalPrice = unitPrice * quantity;
  }

  let shipByDate = null;
  const dispatchDate = veeqoLineItem.dispatch_date || orderPrismaData.rawData?.dispatch_date; // Check line item then order
  const dueDate = orderPrismaData.rawData?.due_date;
  
  // Updated shipBy logic
  const effectiveDate = veeqoLineItem.dispatch_date || orderPrismaData.rawData?.dispatch_date || orderPrismaData.rawData?.due_date;
  if (effectiveDate) {
    try {
      shipByDate = new Date(effectiveDate).toISOString();
    } catch (e) {
      logger.warn(`[VEEQO ITEM MAPPER] Invalid date format for shipBy: ${effectiveDate}`, e);
      shipByDate = null;
    }
  } else {
    shipByDate = null;
  }

  return {
    // orderId will be connected by Prisma during nested create
    sku: veeqoLineItem.sku || null,
    productName: veeqoLineItem.product_title || null,
    variantInfo: veeqoLineItem.sellable_title || null,
    quantity: quantity,
    unitPrice: unitPrice,
    totalPrice: itemTotalPrice,
    notes: null, // Veeqo line items don't typically have separate notes
    image: veeqoLineItem.image_url || null,
    marketplaceKey: String(veeqoLineItem.id), // Veeqo line item ID
    shipBy: shipByDate, // Updated shipBy mapping
    orderNumber: orderPrismaData.orderNumber, // From parent order
    uniqueLineKey: String(veeqoLineItem.id), // Use Veeqo line item ID for uniqueness within the order
    remoteLineId: String(veeqoLineItem.id), // Use Veeqo line item ID
    // productId: String? // This would require product matching logic
  };
}

// Generic mappers (placeholders, ideally each integration has its own specific mapper)
// For now, these will be simple pass-throughs or very basic, assuming 'order' is already somewhat structured.
// THIS IS A SIMPLIFICATION and might lead to issues if used with raw, unmapped data from other marketplaces.
function mapOrderToPrisma(order, integration) {
  // THIS IS A GENERIC FALLBACK - SHOULD BE REPLACED BY SPECIFIC MAPPERS
  logger.warn(`Using generic mapOrderToPrisma for integration: ${integration}. Data might be incomplete or incorrect.`, { orderData: order });
  return {
    userId: order.userId, // Must be set by calling function
    marketplace: order.marketplace || integration,
    marketplaceKey: String(order.marketplaceKey || order.id || order.object_id || Date.now()), // Ensure a value
    uiOrderDate: order.orderDate ? new Date(order.orderDate) : (order.marketplaceCreatedAt ? new Date(order.marketplaceCreatedAt) : new Date()),
    customerName: order.customerName || order.shipping_address?.name || order.customer_name || null,
    status: order.status || order.order_status || 'Unknown',
    currency: order.currency || null,
    totalPrice: (typeof order.totalPrice === 'number' || typeof order.total_price === 'number') ? (order.totalPrice || order.total_price) : (order.totalPrice || order.total_price ? parseFloat(String(order.totalPrice || order.total_price)) : null),
    notes: order.notes || null,
    orderNumber: order.orderNumber || order.order_number || null,
    shippingAddress: order.shippingAddress || order.shipping_address || null,
    rawData: order,
  };
}

function mapItemToPrisma(item, orderData, integration) {
    // THIS IS A GENERIC FALLBACK - SHOULD BE REPLACED BY SPECIFIC MAPPERS
  logger.warn(`Using generic mapItemToPrisma for integration: ${integration}. Data might be incomplete or incorrect.`, { itemData: item });
  return {
    sku: item.sku || null,
    productName: item.productName || item.title || null,
    variantInfo: item.variantInfo || item.variant_title || null,
    quantity: parseInt(String(item.quantity), 10) || 0,
    unitPrice: parseFloat(String(item.unitPrice || item.unit_price)) || null,
    totalPrice: parseFloat(String(item.totalPrice || item.total_price)) || null,
    notes: item.notes || null,
    image: item.image || null,
    marketplaceKey: String(item.marketplaceKey || item.id || item.object_id || Date.now()), // Ensure a value
    shipBy: item.shipBy ? new Date(item.shipBy) : null,
    orderNumber: orderData?.orderNumber || item.orderNumber || null,
    uniqueLineKey: String(item.uniqueLineKey || item.id || item.object_id || Date.now()), // Ensure a value
    remoteLineId: String(item.remoteLineId || item.id || item.object_id || Date.now()), // Ensure a value
  };
}

async function syncVeeqoRecentOrders(user, settings) {
  const integrationName = 'Veeqo'; // Use a consistent name
  let syncId, processed = 0, successful = 0, failed = 0, errors = [];
  const veeqoLastSyncDate = settings.veeqoLastRecentSyncDate ? new Date(settings.veeqoLastRecentSyncDate) : null;

  try {
    // Pass `userId` and `integrationName` (or specific type like 'veeqo_recent') to startSync
    syncId = await startSync(user.id, 'recent'); // Assuming 'recent' is the type for SyncOperation
    
    // Fetch Veeqo orders, passing createdAfter if veeqoLastSyncDate is available
    const orders = await fetchVeeqoOrders(
      user.id, 
      settings.veeqoApiKey, 
      veeqoLastSyncDate // Pass the date directly
    );

    logger.info(`[VEEQO SYNC] User ${user.id} - Fetched ${orders.length} orders for recent sync.`);
    if (orders.length === 0 && veeqoLastSyncDate) {
        logger.info(`[VEEQO SYNC] No new orders found for user ${user.id} since ${veeqoLastSyncDate.toISOString()}`);
    }


    for (const veeqoOrder of orders) {
      processed++;
      let orderData; // To hold mapped data
      try {
        // Use the Veeqo-specific mapper
        orderData = mapVeeqoOrderToPrisma(veeqoOrder, user.id);
        
        const itemsData = (veeqoOrder.line_items || []).map(item => 
          mapVeeqoItemToPrisma(item, orderData) // Pass mapped orderData for context if needed (e.g. orderNumber)
        );

        const whereClauseForUpsert = {
          userId_marketplace_marketplaceKey: { 
            userId: user.id, 
            marketplace: orderData.marketplace, 
            marketplaceKey: orderData.marketplaceKey
          }
        };

        // Simplified version:
        const whereValuesForLog = whereClauseForUpsert.userId_marketplace_marketplaceKey;
        logger.info(
          `[VEEQO SYNC PRE-UPSERT] Veeqo Order ID: ${veeqoOrder.id}, User ID: ${user.id}`,
          {
            originalVeeqoInternalId: veeqoOrder.id,
            userIdForUpsert: user.id, // This is directly user.id
            marketplaceForUpsert: whereValuesForLog.marketplace, // From orderData.marketplace
            marketplaceKeyForUpsert: whereValuesForLog.marketplaceKey, // From orderData.marketplaceKey
            fullWhereClauseUsed: whereClauseForUpsert // Keep the full clause structure for inspection
          }
        );

        await prisma.order.upsert({
          where: whereClauseForUpsert, 
          update: { 
            ...orderData, 
            userId: user.id, // ensure userId is in the update payload
            items: { 
              deleteMany: {}, // This will delete existing items and recreate them. 
                              // Consider more sophisticated item update logic if needed.
              create: itemsData 
            } 
          },
          create: { 
            ...orderData, 
            userId: user.id, // ensure userId is in the create payload
            items: { 
              create: itemsData 
            } 
          },
        });
        successful++;
      } catch (err) {
        failed++;
        const orderIdentifier = veeqoOrder.number || veeqoOrder.id || 'unknown_order';
        errors.push({ orderId: String(orderIdentifier), error: err.message });
        logger.error(`[VEEQO SYNC ERROR] Order sync failed for Veeqo order ID: ${orderIdentifier}, User ID: ${user.id}`, { error: err, stack: err.stack, veeqoOrder });
      }
      await updateSyncProgress(syncId, { 
        processedOrders: processed, 
        successfulOrders: successful, 
        failedOrders: failed, 
        totalOrders: orders.length, // Add totalOrders to progress
        errors: errors
      });
    }
    await completeSync(syncId, failed === 0, { 
        processedOrders: processed, 
        successfulOrders: successful, 
        failedOrders: failed, 
        totalOrders: orders.length, // Add totalOrders to completion metrics
        errors: errors
    });
    
    // If sync was successful and orders were processed, update veeqoLastRecentSyncDate
    if (failed === 0 && orders.length > 0) {
      const newLastSyncDate = new Date();
      await prisma.userIntegrationSettings.update({
        where: { userId: user.id },
        data: { veeqoLastRecentSyncDate: newLastSyncDate },
      });
      logger.info(`[VEEQO SYNC] User ${user.id} - Updated veeqoLastRecentSyncDate to ${newLastSyncDate.toISOString()}`);
    } else if (failed === 0 && orders.length === 0 && veeqoLastSyncDate) {
        logger.info(`[VEEQO SYNC] User ${user.id} - No new orders, veeqoLastRecentSyncDate remains ${veeqoLastSyncDate.toISOString()}`);
    }


  } catch (err) {
    const generalError = { orderId: 'veeqo_sync_process', error: err.message };
    if (syncId) {
      await completeSync(syncId, false, { 
        processedOrders: processed, 
        successfulOrders: successful, 
        failedOrders: failed + 1, // Increment failed for the process error
        totalOrders: orders ? orders.length : 0, 
        errors: [...errors, generalError] 
      });
    }
    logger.error(`[VEEQO SYNC CRITICAL] Veeqo recent sync failed for user ${user.id}`, { error: err, stack: err.stack });
    // Do not re-throw here if called from API, let the API handler manage response.
    // If called from a script that needs to exit on error, then re-throw.
    // For now, assuming it might be called from an API, so we just log.
  }
}

async function syncShippoRecentOrders(user, settings) {
  const syncType = 'shippo';
  let syncId, processed = 0, successful = 0, failed = 0, errors = [];
  try {
    syncId = await startSync(user.id, syncType);
    const orders = await fetchShippoOrders(settings.shippoToken, { page_size: '100' });
    for (const order of orders) {
      try {
        const orderData = mapOrderToPrisma(order, syncType);
        const itemsData = (order.items || order.line_items || []).map(item => mapItemToPrisma(item, order, syncType));
        await prisma.order.upsert({
          where: { userId_marketplace_marketplaceKey: { userId: user.id, marketplace: orderData.marketplace, marketplaceKey: orderData.marketplaceKey } },
          update: { ...orderData, items: { deleteMany: {}, create: itemsData } },
          create: { ...orderData, items: { create: itemsData } },
        });
        successful++;
      } catch (err) {
        failed++;
        errors.push({ orderId: order.order_number, error: err.message });
        logger.error('Shippo order sync failed', err, { userId: user.id });
      }
      processed++;
      await updateSyncProgress(syncId, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors });
    }
    await completeSync(syncId, failed === 0, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors });
  } catch (err) {
    if (syncId) await completeSync(syncId, false, { processedOrders: processed, successfulOrders: successful, failedOrders: failed + 1, errors: [...errors, { orderId: 'sync', error: err.message }] });
    logger.error('Shippo sync failed', err, { userId: user.id });
    throw err;
  }
}

async function syncTrendyolRecentOrders(user, settings) {
  const syncType = 'trendyol';
  let syncId, processed = 0, successful = 0, failed = 0, errors = [];
  try {
    // Clean up any stale Trendyol syncs before starting
    const cleanedCount = await cleanupStaleSyncs(user.id, syncType);
    if (cleanedCount > 0) {
      logger.info(`[TRENDYOL SYNC] Cleaned up ${cleanedCount} stale sync operations for user ${user.id}`);
    }
    
    // Check for existing sync operations that might be blocking
    const existingSyncs = await prisma.syncOperation.findMany({
      where: { userId: user.id, type: syncType },
      orderBy: { updatedAt: 'desc' },
      take: 3
    });
    
    if (existingSyncs.length > 0) {
      logger.info(`[TRENDYOL SYNC] Found ${existingSyncs.length} existing sync operations for user ${user.id}:`, 
        existingSyncs.map(s => ({
          id: s.id,
          status: s.status,
          updatedAt: s.updatedAt.toISOString(),
          ageMinutes: Math.round((Date.now() - s.updatedAt.getTime()) / (1000 * 60))
        }))
      );
    }
    
    logger.info(`[TRENDYOL SYNC] Attempting to start sync for user ${user.id}, type: ${syncType}`);
    syncId = await startSync(user.id, syncType);
    logger.info(`[TRENDYOL SYNC] Started sync successfully, syncId: ${syncId}`);
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000; // Extended to 7 days to catch recent orders
    const futureBuffer = now + 3 * 60 * 60 * 1000; // Add 3 hours buffer for timezone discrepancies
    // Implement smart pagination since Trendyol API date filtering is broken
    // Limit orders to prevent DB connection exhaustion
    let orders = [];
    const MAX_ORDERS_PER_SYNC = 10; // Very conservative limit for fast sync
    
    try {
      logger.info(`[TRENDYOL SYNC] Starting limited fetch for user ${user.id}, max ${MAX_ORDERS_PER_SYNC} orders`);
      
      // Fetch recent orders with size limit to prevent overload
      const allOrders = await fetchTrendyolOrders({
        supplierId: settings.trendyolSupplierId,
        apiKey: settings.trendyolApiKey,
        apiSecret: settings.trendyolApiSecret,
        status: undefined,
        startDateMs: null,
        endDateMs: null,
        pageSize: 15, // Very small limit for fast sync
      });
      
      logger.info(`[TRENDYOL SYNC] Fetched ${allOrders.length} orders (limited) for user ${user.id}`);
      
      // Filter and limit orders for performance
      const filteredOrders = allOrders
        .filter(order => {
          if (!order.orderDate) return false;
          const orderTimestamp = typeof order.orderDate === 'string' 
            ? new Date(order.orderDate).getTime() 
            : order.orderDate;
          return orderTimestamp >= sevenDaysAgo && orderTimestamp <= futureBuffer;
        })
        .slice(0, MAX_ORDERS_PER_SYNC); // Hard limit for safety
      
      logger.info(`[TRENDYOL SYNC] After filtering and limiting: ${filteredOrders.length} orders for sync`);
      orders = filteredOrders;
      
    } catch (err) {
      logger.warn(`[TRENDYOL SYNC] Main fetch failed, trying Created orders with limit:`, err.message);
      try {
        // Fallback: fetch Created orders with strict limit
        const createdOrders = await fetchCreatedOrders({
          supplierId: settings.trendyolSupplierId,
          apiKey: settings.trendyolApiKey,
          apiSecret: settings.trendyolApiSecret,
          startDateMs: null,
          endDateMs: null,
          pageSize: 10, // Even smaller limit for fallback
        });
        
        // Filter and limit Created orders
        orders = createdOrders
          .filter(order => {
            if (!order.orderDate) return false;
            const orderTimestamp = typeof order.orderDate === 'string' 
              ? new Date(order.orderDate).getTime() 
              : order.orderDate;
            return orderTimestamp >= sevenDaysAgo && orderTimestamp <= futureBuffer;
          })
          .slice(0, MAX_ORDERS_PER_SYNC);
        
        logger.info(`[TRENDYOL SYNC] Fallback: ${orders.length} recent Created orders (limited)`);
      } catch (fallbackErr) {
        logger.error(`[TRENDYOL SYNC] Both main and fallback failed:`, fallbackErr.message);
        orders = []; // Empty to prevent further errors
      }
    }
    
    logger.info(`[TRENDYOL SYNC] User ${user.id} - Fetched ${orders.length} orders for recent sync.`);
    
    // Map orders with product images
    let uiOrders = [];
    try {
      logger.info(`[TRENDYOL SYNC] Mapping orders with product images for user ${user.id}`);
      uiOrders = await mapTrendyolOrdersWithImages(orders, {
        supplierId: settings.trendyolSupplierId,
        apiKey: settings.trendyolApiKey,
        apiSecret: settings.trendyolApiSecret,
      });
      logger.info(`[TRENDYOL SYNC] Successfully mapped ${uiOrders.length} orders with images for user ${user.id}`);
    } catch (err) {
      logger.warn(`[TRENDYOL SYNC] Failed to map orders with images, falling back to basic mapping:`, err.message);
      // Fallback to basic mapping without images
      uiOrders = orders.map(order => toOrder(order));
    }
    
    // Process orders in small batches to prevent DB connection exhaustion
    const BATCH_SIZE = 5; // Very conservative batch size
    logger.info(`[TRENDYOL SYNC] Processing ${uiOrders.length} orders in batches of ${BATCH_SIZE}`);
    
    for (let i = 0; i < uiOrders.length; i += BATCH_SIZE) {
      const batch = uiOrders.slice(i, i + BATCH_SIZE);
      logger.info(`[TRENDYOL SYNC] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(uiOrders.length/BATCH_SIZE)} (${batch.length} orders)`);
      
      for (const uiOrder of batch) {
        try {
          const orderData = mapUIOrderToPrisma(uiOrder, user.id);
          const itemsData = (uiOrder.line_items || []).map(item => mapUIOrderItemToPrisma(item, orderData));
          
          // Reduced verbose logging - only log batch summaries

          await prisma.order.upsert({
            where: { userId_marketplace_marketplaceKey: { userId: user.id, marketplace: orderData.marketplace, marketplaceKey: orderData.marketplaceKey } },
            update: { ...orderData, items: { deleteMany: {}, create: itemsData } },
            create: { ...orderData, items: { create: itemsData } },
          });
          
          // Success logged in batch summary
          successful++;
        } catch (err) {
          failed++;
          errors.push({ orderId: uiOrder.id, error: err.message });
          logger.error('Trendyol order sync failed', err, { userId: user.id });
        }
        processed++;
        await updateSyncProgress(syncId, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors });
      }
      
      // Log batch completion
      logger.info(`[TRENDYOL SYNC] Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(uiOrders.length/BATCH_SIZE)} completed: ${successful - (failed > 0 ? failed : 0)} success, ${failed > 0 ? batch.length - (successful - failed) : 0} failed`);
      
      // Small delay between batches to let DB connections settle
      if (i + BATCH_SIZE < uiOrders.length) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms pause
      }
    }
    
    logger.info(`[TRENDYOL SYNC] Completed: ${successful}/${processed} orders successful for user ${user.id}`);
    await completeSync(syncId, failed === 0, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors });
  } catch (err) {
    if (syncId) {
      await completeSync(syncId, false, { processedOrders: processed, successfulOrders: successful, failedOrders: failed + 1, errors: [...errors, { orderId: 'sync', error: err.message }] });
    } else {
      logger.error(`[TRENDYOL SYNC] Failed to start sync for user ${user.id}:`, err.message);
    }
    logger.error('Trendyol sync failed', err, { userId: user.id });
    throw err;
  }
}

async function syncHepsiburadaRecentOrders(user, settings) {
  const syncType = 'hepsiburada';
  let syncId, processed = 0, successful = 0, failed = 0, errors = [];
  try {
    syncId = await startSync(user.id, syncType);
    const orders = await fetchHepsiburadaOrders(settings); // TODO: Implement real fetch logic
    for (const order of orders) {
      try {
        const orderData = mapOrderToPrisma(order, syncType);
        const itemsData = (order.items || order.line_items || []).map(item => mapItemToPrisma(item, order, syncType));
        await prisma.order.upsert({
          where: { userId_marketplace_marketplaceKey: { userId: user.id, marketplace: orderData.marketplace, marketplaceKey: orderData.marketplaceKey } },
          update: { ...orderData, items: { deleteMany: {}, create: itemsData } },
          create: { ...orderData, items: { create: itemsData } },
        });
        successful++;
      } catch (err) {
        failed++;
        errors.push({ orderId: order.id, error: err.message });
        logger.error('Hepsiburada order sync failed', err, { userId: user.id });
      }
      processed++;
      await updateSyncProgress(syncId, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors });
    }
    await completeSync(syncId, failed === 0, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors });
  } catch (err) {
    if (syncId) await completeSync(syncId, false, { processedOrders: processed, successfulOrders: successful, failedOrders: failed + 1, errors: [...errors, { orderId: 'sync', error: err.message }] });
    logger.error('Hepsiburada sync failed', err, { userId: user.id });
    throw err;
  }
}

async function main() {
  const errors = [];
  const users = await prisma.user.findMany({
    include: { integrationSettings: true }
  });

  for (const user of users) {
    const settings = user.integrationSettings;
    if (!settings) continue;
    const integrations = [
      settings.veeqoApiKey && 'veeqo',
      settings.shippoToken && 'shippo',
      settings.trendyolApiKey && settings.trendyolApiSecret && settings.trendyolSupplierId && 'trendyol',
      settings.hepsiburadaApiKey && settings.hepsiburadaMerchantId && 'hepsiburada'
    ].filter(Boolean);

    for (const integration of integrations) {
      try {
        switch (integration) {
          case 'veeqo':
            await syncVeeqoRecentOrders(user, settings);
            break;
          case 'shippo':
            await syncShippoRecentOrders(user, settings);
            break;
          case 'trendyol':
            await syncTrendyolRecentOrders(user, settings);
            break;
          case 'hepsiburada':
            await syncHepsiburadaRecentOrders(user, settings);
            break;
        }
      } catch (err) {
        errors.push({ userId: user.id, integration, error: err.message });
      }
    }
  }

  if (errors.length) {
    console.error('Some syncs failed:', errors);
    process.exitCode = 1;
  } else {
    console.log('All syncs completed successfully.');
  }
}

// Only run main if the script is executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error in auto-sync:', err);
    process.exit(1);
  });
}

module.exports = {
  syncVeeqoRecentOrders,
  syncShippoRecentOrders,
  syncTrendyolRecentOrders,
  syncHepsiburadaRecentOrders,
  // Potentially mapOrderToPrisma and mapItemToPrisma if they were ever needed externally,
  // but for now, only the sync functions are required by retry.ts
};
