import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getSupabaseServerClient } from '../../../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { orderId } = req.query;
  if (typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const { packingStatus, productionNotes } = req.body;
  if (typeof packingStatus !== 'string') {
    return res.status(400).json({ error: 'packingStatus must be a string' });
  }
  if (typeof productionNotes !== 'string') {
    return res.status(400).json({ error: 'productionNotes must be a string' });
  }

  const supabase = getSupabaseServerClient(req, res);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // prepare update data with edited timestamps
    const dataToUpdate: any = { packingStatus, productionNotes };
    dataToUpdate.packingEditedAt = new Date();
    dataToUpdate.productionEditedAt = new Date();
    const updateResult = await prisma.order.updateMany({
      where: { id: orderId, userId: user.id },
      data: dataToUpdate,
    });
    if (updateResult.count === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updatedOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerName: true,
        images: true,
        fedexServiceType: true,
        fedexPackagingType: true,
        fedexPickupType: true,
        fedexDutiesPaymentType: true,
        commodityDesc: true,
        harmonizedCode: true,
        sendCommercialInvoiceViaEtd: true,
        trackingNumber: true,
        shippingLabelUrl: true,
        packingStatus: true,
        productionNotes: true,
        packingEditedAt: true,
        productionEditedAt: true,
      }
    });

    return res.status(200).json({ order: updatedOrder });
  } catch (error: any) {
    console.error('Error updating production status:', error);
    return res.status(500).json({ error: 'Failed to update order', details: error.message });
  }
} 