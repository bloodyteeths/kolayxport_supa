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

  const { shipmentId } = req.query;

  if (!shipmentId || typeof shipmentId !== 'string') {
    return res.status(400).json({ error: 'Shipment ID is required' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // First, verify that the shipment belongs to an order owned by the authenticated user
    const existingShipment = await prisma.shipment.findFirst({
      where: {
        id: shipmentId
      },
      include: {
        order: {
          select: {
            id: true,
            userId: true,
            orderNumber: true
          }
        }
      }
    });

    if (!existingShipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    if (existingShipment.order.userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete the shipment
    await prisma.shipment.delete({
      where: {
        id: shipmentId
      }
    });

    console.log(`[DELETE SHIPMENT] Successfully deleted shipment ${shipmentId} for order ${existingShipment.order.orderNumber} (user ${user.id})`);

    return res.status(200).json({ 
      success: true,
      message: 'Shipment deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting shipment:', error);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}