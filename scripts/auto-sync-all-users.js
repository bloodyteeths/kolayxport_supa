// This script can be used with GitHub Actions, EasyCron, or any external scheduler to trigger incremental sync for all users every 15 minutes.
// It assumes your site is deployed and accessible at the given BASE_URL.
// You must provide a way to authenticate as each user (e.g. service tokens, or trigger per-user from your backend).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { startSync, updateSyncProgress, completeSync } = require('../lib/sync-status');
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
    marketplaceKey: uiOrder.marketplaceKey,
    marketplaceCreatedAt: uiOrder.marketplaceOrderDate ? new Date(uiOrder.marketplaceOrderDate) : new Date(),
    customerName: uiOrder.customerName,
    status: uiOrder.status,
    shipByDate: uiOrder.shipByDate ? new Date(uiOrder.shipByDate) : null,
    currency: uiOrder.currency,
    totalPrice: uiOrder.totalPrice,
    notes: null, // Trendyol doesn't have customer notes
    orderNumber: uiOrder.orderNumber,
    shippingAddress: uiOrder.shippingAddress,
    rawData: uiOrder.rawData,
    
    // Additional fields from UIOrder
    uiOrderDate: uiOrder.uiOrderDate ? new Date(uiOrder.uiOrderDate) : null,
    commodityDesc: uiOrder.commodityDesc,
    externalStatus: uiOrder.externalStatus,
    source: uiOrder.source,
    channel: uiOrder.channel,
    
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
    fedexMasterFormId: null,
    shipmentStatus: null,
    shippedAt: null,
    shippingLabelUrl: null,
    trackingNumber: null,
    packingEditedAt: null,
    packingStatus: null,
    productionEditedAt: null,
    productionNotes: null,
    labelStatus: null,
  };
}

function mapTrendyolItemToPrisma(trendyolLineItem, orderData) {
  return {
    sku: trendyolLineItem.sku || null,
    productName: trendyolLineItem.title || null,
    variantInfo: null, // Trendyol items don't have variant info
    quantity: trendyolLineItem.quantity || 1,
    unitPrice: trendyolLineItem.value || null,
    totalPrice: (trendyolLineItem.value || 0) * (trendyolLineItem.quantity || 1),
    notes: null,
    image: trendyolLineItem.image || '',
    marketplaceKey: trendyolLineItem.id || String(Date.now()),
    shipBy: null, // Trendyol items don't have individual ship dates
    orderNumber: orderData.orderNumber,
    uniqueLineKey: trendyolLineItem.id || String(Date.now()),
    remoteLineId: trendyolLineItem.id || String(Date.now()),
    
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
    marketplaceKey: uiOrder.marketplaceKey,
    marketplaceCreatedAt: uiOrder.marketplaceOrderDate ? new Date(uiOrder.marketplaceOrderDate) : new Date(),
    customerName: uiOrder.customerName,
    status: uiOrder.status,
    shipByDate: uiOrder.shipByDate ? new Date(uiOrder.shipByDate) : null,
    currency: uiOrder.currency,
    totalPrice: uiOrder.totalPrice,
    notes: null, // Trendyol doesn't have customer notes
    orderNumber: uiOrder.orderNumber,
    shippingAddress: uiOrder.shippingAddress,
    rawData: uiOrder.rawData,
    
    // Additional fields from UIOrder
    uiOrderDate: uiOrder.uiOrderDate ? new Date(uiOrder.uiOrderDate) : null,
    commodityDesc: uiOrder.commodityDesc,
    externalStatus: uiOrder.externalStatus,
    source: uiOrder.source,
    channel: uiOrder.channel,
    
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
    fedexMasterFormId: null,
    shipmentStatus: null,
    shippedAt: null,
    shippingLabelUrl: null,
    trackingNumber: null,
    packingEditedAt: null,
    packingStatus: null,
    productionEditedAt: null,
    productionNotes: null,
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
    notes: null,
    image: lineItem.image || '',
    marketplaceKey: lineItem.id || String(Date.now()),
    shipBy: null, // Trendyol items don't have individual ship dates
    orderNumber: orderData.orderNumber,
    uniqueLineKey: lineItem.id || String(Date.now()),
    remoteLineId: lineItem.id || String(Date.now()),
    
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
    marketplaceCreatedAt: veeqoOrder.created_at ? new Date(veeqoOrder.created_at) : null,
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
    fedexMasterFormId: null,
    shipmentStatus: null,
    shippedAt: null,
    shippingLabelUrl: null,
    trackingNumber: null,
    packingEditedAt: null,
    packingStatus: null,
    productionEditedAt: null,
    productionNotes: null,
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
    marketplaceKey: order.marketplaceKey || order.id || order.object_id || String(Date.now()), // Ensure a value
    marketplaceCreatedAt: order.marketplaceCreatedAt ? new Date(order.marketplaceCreatedAt) : new Date(),
    customerName: order.customerName || order.shipping_address?.name || order.customer_name || null,
    status: order.status || order.order_status || 'Unknown',
    shipByDate: order.shipByDate || order.ship_by_date ? new Date(order.ship_by_date) : null,
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
    marketplaceKey: item.marketplaceKey || item.id || item.object_id || String(Date.now()), // Ensure a value
    shipBy: item.shipBy ? new Date(item.shipBy) : null,
    orderNumber: orderData?.orderNumber || item.orderNumber || null,
    uniqueLineKey: item.uniqueLineKey || item.id || item.object_id || String(Date.now()), // Ensure a value
    remoteLineId: item.remoteLineId || item.id || item.object_id || String(Date.now()), // Ensure a value
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
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000; // Extend to 24 hours for debugging
    // Try fetching all recent orders first, then fall back to Created only
    let orders = [];
    
    try {
      // First try all orders without status filter
      orders = await fetchTrendyolOrders({
        supplierId: settings.trendyolSupplierId,
        apiKey: settings.trendyolApiKey,
        apiSecret: settings.trendyolApiSecret,
        status: undefined, // No status filter to get all orders
        startDateMs: twentyFourHoursAgo,
        endDateMs: now,
      });
      logger.info(`[TRENDYOL SYNC] Fetched ${orders.length} orders (all statuses) for user ${user.id}`);
    } catch (err) {
      logger.warn(`[TRENDYOL SYNC] Failed to fetch all orders, trying Created only:`, err.message);
      // Fallback to Created orders only
      orders = await fetchCreatedOrders({
        supplierId: settings.trendyolSupplierId,
        apiKey: settings.trendyolApiKey,
        apiSecret: settings.trendyolApiSecret,
        startDateMs: twentyFourHoursAgo,
        endDateMs: now,
      });
      logger.info(`[TRENDYOL SYNC] Fetched ${orders.length} orders (Created status only) for user ${user.id}`);
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
    
    for (const uiOrder of uiOrders) {
      try {
        const orderData = mapUIOrderToPrisma(uiOrder, user.id);
        const itemsData = (uiOrder.line_items || []).map(item => mapUIOrderItemToPrisma(item, orderData));
        
        logger.info(`[TRENDYOL SYNC PRE-UPSERT] Trendyol Order ID: ${uiOrder.id}, User ID: ${user.id}`, {
          originalTrendyolId: uiOrder.id,
          userIdForUpsert: user.id,
          marketplaceForUpsert: orderData.marketplace,
          marketplaceKeyForUpsert: orderData.marketplaceKey,
          orderNumber: orderData.orderNumber,
          itemsCount: itemsData.length,
          itemsWithImages: itemsData.filter(item => item.image && item.image.length > 0).length
        });

        await prisma.order.upsert({
          where: { userId_marketplace_marketplaceKey: { userId: user.id, marketplace: orderData.marketplace, marketplaceKey: orderData.marketplaceKey } },
          update: { ...orderData, items: { deleteMany: {}, create: itemsData } },
          create: { ...orderData, items: { create: itemsData } },
        });
        
        logger.info(`[TRENDYOL SYNC SUCCESS] Successfully upserted Trendyol order ${uiOrder.id} for user ${user.id}`);
        successful++;
      } catch (err) {
        failed++;
        errors.push({ orderId: uiOrder.id, error: err.message });
        logger.error('Trendyol order sync failed', err, { userId: user.id });
      }
      processed++;
      await updateSyncProgress(syncId, { processedOrders: processed, successfulOrders: successful, failedOrders: failed, errors });
    }
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
