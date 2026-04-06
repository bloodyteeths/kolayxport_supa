import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { executeStatusUpdateHook } from '../../../../lib/hooks/statusUpdateHook';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { not, durum } = req.body;
  const { orderId } = req.query;

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  try {
    // Verify order exists and belongs to user
    const order = await prisma.order.findUnique({
      where: { id: orderId as string, userId: user.id },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Upsert SenkronOrderData record
    await prisma.senkronOrderData.upsert({
      where: { orderId: orderId as string },
      update: {
        internalNote: not || null,
        customStatus: durum || null,
        updatedAt: new Date(),
      },
      create: {
        orderId: orderId as string,
        userId: user.id,
        internalNote: not || null,
        customStatus: durum || null,
      },
    });

    // Execute status update hook to check if cargo status requires auto-update
    try {
      await executeStatusUpdateHook(orderId as string, user.id);
    } catch (hookError) {
      console.warn(`Status update hook failed for order ${orderId}:`, hookError);
      // Don't fail the entire request if hook fails
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error updating note and status:', error);
    return res.status(500).json({ error: error.message, stack: error?.stack });
  }
}
