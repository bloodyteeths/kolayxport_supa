import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // Get user from Supabase
  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { orderId } = req.query;

  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Invalid order ID' });
  }

  // GET: Fetch order details
  if (req.method === 'GET') {
    try {
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          userId: user.id
        },
        include: {
          items: true
        }
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      return res.status(200).json(order);
    } catch (error) {
      console.error('Error fetching order:', error);
      return res.status(500).json({ error: 'Failed to fetch order' });
    }
  }

  // PATCH: Update order details
  if (req.method === 'PATCH') {
    try {
      const {
        weightKg,
        serviceType,
        packagingType,
        items,
        shippingAddress
      } = req.body;

      // Start a transaction to update order and items
      const updatedOrder = await prisma.$transaction(async (tx) => {
        // Update order
        const order = await tx.order.update({
          where: {
            id: orderId,
            userId: user.id
          },
          data: {
            shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : undefined
          }
        });

        // Update items if provided
        if (items && Array.isArray(items)) {
          // Delete existing items
          await tx.orderItem.deleteMany({
            where: { orderId }
          });

          // Create new items
          await tx.orderItem.createMany({
            data: items.map((item: any) => ({
              orderId,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              weightKg: item.weightKg,
              harmonizedCode: item.harmonizedCode,
              countryOfMfg: item.countryOfMfg,
              sku: item.sku,
              remoteLineId: item.remoteLineId,
              marketplaceKey: order.marketplaceKey,
              orderNumber: order.orderNumber
            }))
          });
        }

        // Fetch updated order with items
        return tx.order.findFirst({
          where: {
            id: orderId,
            userId: user.id
          },
          include: {
            items: true
          }
        });
      });

      if (!updatedOrder) {
        return res.status(404).json({ error: 'Order not found' });
      }

      return res.status(200).json(updatedOrder);
    } catch (error) {
      console.error('Error updating order:', error);
      return res.status(500).json({ error: 'Failed to update order' });
    }
  }

  // Method not allowed
  res.setHeader('Allow', ['GET', 'PATCH']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
} 