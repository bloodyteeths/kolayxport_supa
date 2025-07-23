import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { logger } from '../../../../lib/logger';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import { Prisma } from '@prisma/client';
import { UIOrder, OrderChannel, OrderSource } from '../../../../lib/types';
import { withUsageLimiter } from '../../../../lib/middleware/withUsageLimiter';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get user via Supabase client
  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    logger.warn('Unauthorized Etsy sync attempt', { authError });
    return res.status(401).json({ error: 'Unauthorized', details: authError?.message });
  }
  const userId = user.id;

  try {
    const { orders, source, timestamp } = req.body;

    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'Invalid request: orders array required' });
    }

    if (!source || !source.includes('chrome-extension')) {
      return res.status(400).json({ error: 'Invalid source' });
    }

    logger.info(`[Etsy Chrome Extension] Received ${orders.length} orders from user ${userId}`, {
      userId,
      orderCount: orders.length,
      timestamp
    });

    // Transform extension data to match our UIOrder format
    const transformedOrders: UIOrder[] = orders.map(extOrder => {
      // Parse the date to ISO format
      let orderDate: string | undefined;
      if (extOrder.orderDate) {
        try {
          orderDate = new Date(extOrder.orderDate).toISOString();
        } catch (e) {
          orderDate = new Date().toISOString();
        }
      }

      return {
        id: `etsy-${extOrder.orderId}`,
        source: 'etsy' as OrderSource, // Etsy orders come through chrome extension
        channel: 'etsy' as OrderChannel,
        marketplace: 'etsy',
        marketplaceKey: extOrder.orderId,
        orderNumber: extOrder.orderNumber || extOrder.orderId,
        customerName: extOrder.buyerName || extOrder.shippingAddress?.name || 'Unknown',
        status: 'pending', // Default status for new orders
        externalStatus: 'New', // Chrome extension scraped orders are new
        currency: 'USD', // Default to USD, can be enhanced later
        totalPrice: typeof extOrder.orderTotal === 'number' ? extOrder.orderTotal : parseFloat(extOrder.orderTotal || '0'),
        uiOrderDate: orderDate,
        marketplaceOrderDate: orderDate,
        to_address: {
          name: extOrder.shippingAddress?.name || extOrder.buyerName || '',
          phone: '', // Etsy doesn't show phone in UI
          street1: extOrder.shippingAddress?.line1 || '',
          street2: extOrder.shippingAddress?.line2 || '',
          city: extOrder.shippingAddress?.city || '',
          state: extOrder.shippingAddress?.state || '',
          postal: extOrder.shippingAddress?.postalCode || '',
          country: extOrder.shippingAddress?.country || 'US',
          isResidential: true, // Default to residential for Etsy orders
        },
        line_items: (extOrder.items || []).map((item: any, index: number) => ({
          id: `${extOrder.orderId}-${index}`,
          title: item.title || 'Unknown Item',
          value: parseFloat(item.price || '0'),
          quantity: parseInt(item.quantity || '1'),
          weight: 0.5, // Default weight
          sku: item.sku || '',
          variantInfo: item.variation || '',
          image: '', // Etsy images not scraped for privacy
        })),
        rawData: extOrder, // Store original data
      };
    });

    // Process orders in batches
    const BATCH_SIZE = 10;
    const results = {
      success: true,
      processed: 0,
      created: 0,
      updated: 0,
      errors: [] as any[]
    };

    for (let i = 0; i < transformedOrders.length; i += BATCH_SIZE) {
      const batch = transformedOrders.slice(i, i + BATCH_SIZE);
      
      try {
        // Get existing orders
        const orderMarketplaceKeys = batch.map(o => o.marketplaceKey);
        const existingOrders = await prisma.order.findMany({
          where: { 
            userId, 
            marketplace: 'etsy',
            marketplaceKey: { in: orderMarketplaceKeys }
          },
          select: { id: true, marketplaceKey: true }
        });
        const existingOrdersMap = new Map(existingOrders.map(o => [o.marketplaceKey, o]));

        // Prepare orders for creation/update
        const ordersToCreate: Prisma.OrderCreateManyInput[] = [];
        const ordersToUpdate: { where: Prisma.OrderWhereUniqueInput; data: Prisma.OrderUpdateInput }[] = [];

        for (const order of batch) {
          const existingOrder = existingOrdersMap.get(order.marketplaceKey);
          
          const baseOrderData = {
            marketplace: order.marketplace,
            marketplaceKey: order.marketplaceKey,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            status: order.status,
            externalStatus: order.externalStatus,
            currency: order.currency,
            totalPrice: order.totalPrice,
            shippingAddress: order.to_address ? JSON.stringify(order.to_address) : Prisma.JsonNull,
            rawData: order.rawData ? order.rawData : Prisma.JsonNull,
            uiOrderDate: order.uiOrderDate,
          };

          if (existingOrder) {
            ordersToUpdate.push({
              where: { id: existingOrder.id },
              data: baseOrderData,
            });
          } else {
            ordersToCreate.push({
              ...baseOrderData,
              userId,
            });
          }
        }

        // Create new orders
        if (ordersToCreate.length > 0) {
          await prisma.order.createMany({
            data: ordersToCreate,
            skipDuplicates: true,
          });
          results.created += ordersToCreate.length;
        }

        // Update existing orders
        if (ordersToUpdate.length > 0) {
          await prisma.$transaction(
            ordersToUpdate.map(({ where, data }) => prisma.order.update({ where, data }))
          );
          results.updated += ordersToUpdate.length;
        }

        // Create OrderItems
        const currentOrders = await prisma.order.findMany({
          where: { 
            userId, 
            marketplace: 'etsy',
            marketplaceKey: { in: orderMarketplaceKeys }
          },
          select: { id: true, marketplaceKey: true }
        });
        const orderIdMap = new Map(currentOrders.map(o => [o.marketplaceKey, o.id]));

        const orderItemsToCreate: Prisma.OrderItemCreateManyInput[] = [];
        
        for (const order of batch) {
          const orderId = orderIdMap.get(order.marketplaceKey);
          if (!orderId) continue;

          const lineItems = order.line_items || [];
          for (let i = 0; i < lineItems.length; i++) {
            const item = lineItems[i];
            orderItemsToCreate.push({
              orderId,
              productName: item.title || 'Unknown Product',
              quantity: item.quantity || 1,
              unitPrice: new Prisma.Decimal(item.value || 0),
              totalPrice: new Prisma.Decimal((item.value || 0) * (item.quantity || 1)),
              weightKg: item.weight || 0.5,
              sku: item.sku || '',
              image: item.image || '',
              variantInfo: item.variantInfo || '',
              marketplaceKey: String(item.id),
              orderNumber: order.orderNumber,
              uniqueLineKey: String(item.id),
              remoteLineId: String(item.id),
            });
          }
        }

        if (orderItemsToCreate.length > 0) {
          await prisma.orderItem.createMany({
            data: orderItemsToCreate,
            skipDuplicates: true,
          });
        }

        results.processed += batch.length;

      } catch (error) {
        logger.error(`[Etsy Chrome Extension] Batch processing error:`, error);
        results.errors.push({
          batch: `${i}-${i + BATCH_SIZE}`,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Update sync count
    if (results.created > 0 || results.updated > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          orderSyncCount: { increment: results.created + results.updated },
          lastSyncedAt: new Date()
        }
      });
    }

    logger.info(`[Etsy Chrome Extension] Sync complete for user ${userId}`, results);

    return res.status(200).json(results);

  } catch (error) {
    logger.error('[Etsy Chrome Extension] Sync error', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Apply usage limiter middleware
export default withUsageLimiter(handler, 'orderSync');