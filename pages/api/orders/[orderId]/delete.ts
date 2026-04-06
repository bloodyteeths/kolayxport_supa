import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '../../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res
      .status(405)
      .json({ error: `Method ${req.method} Not Allowed` });
  }

  const { orderId } = req.query;

  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  // Authentication
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // First, verify that the order belongs to the authenticated user
    const existingOrder = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId: user.id
      },
      include: {
        items: true,
        shipments: true
      }
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Delete related records in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete label jobs for order items
      if (existingOrder.items.length > 0) {
        await tx.labelJob.deleteMany({
          where: {
            orderItemId: {
              in: existingOrder.items.map(item => item.id)
            }
          }
        });
      }

      // Delete order items
      await tx.orderItem.deleteMany({
        where: {
          orderId: orderId
        }
      });

      // Delete shipments
      await tx.shipment.deleteMany({
        where: {
          orderId: orderId
        }
      });

      // Delete order shipping
      await tx.orderShipping.deleteMany({
        where: {
          orderId: orderId
        }
      });

      // Finally, delete the order itself
      await tx.order.delete({
        where: {
          id: orderId
        }
      });
    });

    console.log(`[DELETE ORDER] Successfully deleted order ${orderId} for user ${user.id}`);

    return res.status(200).json({ 
      success: true,
      message: 'Order deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting order:', error);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}