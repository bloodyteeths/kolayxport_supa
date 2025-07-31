import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { executeStatusUpdateHook } from '../../../lib/hooks/statusUpdateHook';
import { logger } from '../../../lib/logger';

/**
 * API endpoint to manually trigger the status update hook
 * Can be used to batch update all orders or specific orders
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { orderIds, batchProcess = false } = req.body;

  try {
    let processedOrders = 0;
    let updatedOrders = 0;
    const errors: Array<{ orderId: string; error: string }> = [];

    if (batchProcess) {
      // Process all orders for the user that have SHIPPED status
      logger.info(`Starting batch status update hook for user ${user.id}`);
      
      const ordersToProcess = await prisma.order.findMany({
        where: {
          userId: user.id,
          OR: [
            { status: 'SHIPPED' },
            { externalStatus: 'SHIPPED' },
            { status: 'CANCELLED' },
            { externalStatus: 'CANCELLED' },
            { status: 'CANCELED' },
            { externalStatus: 'CANCELED' }
          ]
        },
        select: { id: true, orderNumber: true }
      });

      logger.info(`Found ${ordersToProcess.length} orders (shipped/cancelled) to process`);

      for (const order of ordersToProcess) {
        try {
          await executeStatusUpdateHook(order.id, user.id);
          processedOrders++;
          // Check if the custom status was actually updated
          const updatedOrder = await prisma.senkronOrderData.findUnique({
            where: { orderId: order.id }
          });
          if (updatedOrder?.customStatus === 'Çıktı') {
            updatedOrders++;
          }
        } catch (error: any) {
          logger.error(`Status update hook failed for order ${order.id}:`, error);
          errors.push({
            orderId: order.id,
            error: error.message || 'Unknown error'
          });
        }
      }
    } else if (orderIds && Array.isArray(orderIds)) {
      // Process specific orders
      logger.info(`Processing status update hook for ${orderIds.length} specific orders`);
      
      for (const orderId of orderIds) {
        try {
          await executeStatusUpdateHook(orderId, user.id);
          processedOrders++;
          // Check if the custom status was actually updated
          const updatedOrder = await prisma.senkronOrderData.findUnique({
            where: { orderId }
          });
          if (updatedOrder?.customStatus === 'Çıktı') {
            updatedOrders++;
          }
        } catch (error: any) {
          logger.error(`Status update hook failed for order ${orderId}:`, error);
          errors.push({
            orderId,
            error: error.message || 'Unknown error'
          });
        }
      }
    } else {
      return res.status(400).json({ 
        error: 'Either set batchProcess=true or provide orderIds array' 
      });
    }

    const result = {
      success: true,
      processedOrders,
      updatedOrders,
      failedOrders: errors.length,
      errors
    };

    logger.info(`Status update hook completed:`, result);
    return res.status(200).json(result);

  } catch (error: any) {
    logger.error('Status update hook endpoint failed:', error);
    return res.status(500).json({ 
      error: error.message, 
      stack: error?.stack 
    });
  }
}