import prisma from '@/lib/prisma';
import { logger } from '../logger';

/**
 * Hook that automatically updates order custom status based on cargo status:
 * - SHIPPED → "shipped"
 * - CANCELLED → "cancelled"
 */
export async function executeStatusUpdateHook(orderId: string, userId: string): Promise<void> {
  try {
    // Fetch the order with current status
    const order = await prisma.order.findUnique({
      where: { id: orderId, userId },
      include: {
        senkronData: true
      }
    });

    if (!order) {
      logger.warn(`Order ${orderId} not found for status update hook`);
      return;
    }

    // Check order status
    const orderStatus = (order.status || order.externalStatus || '').toUpperCase();
    const currentCustomStatus = order.senkronData?.customStatus;
    
    let targetStatus: string | null = null;
    
    // Determine target status based on cargo status
    if (orderStatus === 'SHIPPED') {
      if (currentCustomStatus === 'shipped') {
        logger.info(`Order ${orderId} custom status already set to "shipped"`);
        return;
      }
      targetStatus = 'shipped';
    } else if (orderStatus === 'CANCELLED' || orderStatus === 'CANCELED') {
      if (currentCustomStatus === 'cancelled') {
        logger.info(`Order ${orderId} custom status already set to "cancelled"`);
        return;
      }
      targetStatus = 'cancelled';
    } else {
      // No automatic update needed for other statuses
      return;
    }

    // Update custom status based on cargo status
    await prisma.senkronOrderData.upsert({
      where: { orderId },
      update: {
        customStatus: targetStatus,
        updatedAt: new Date(),
      },
      create: {
        orderId,
        userId,
        customStatus: targetStatus,
        internalNote: null, // Keep existing note if any
      },
    });

    logger.info(`Status update hook: Order ${orderId} custom status updated to "${targetStatus}" due to cargo status "${orderStatus}"`);
    
  } catch (error: any) {
    logger.error(`Error in status update hook for order ${orderId}:`, error);
  }
}

/**
 * Batch process status updates for multiple orders
 * Useful for running during sync operations
 */
export async function batchExecuteStatusUpdateHook(orderIds: string[], userId: string): Promise<void> {
  logger.info(`Executing status update hook for ${orderIds.length} orders`);
  
  for (const orderId of orderIds) {
    try {
      await executeStatusUpdateHook(orderId, userId);
    } catch (error: any) {
      logger.error(`Failed to execute status update hook for order ${orderId}:`, error);
      // Continue processing other orders even if one fails
    }
  }
}