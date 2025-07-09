import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    orderId,
    trackingNumber,
    labelUrl,
    serviceType,
    packageType,
    signatureOption,
    iossNumber,
    weight,
  } = req.body || {};

  if (!orderId || !trackingNumber || !labelUrl || !serviceType || !packageType || !signatureOption) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const shipment = await prisma.shipment.create({
      data: {
        orderId,
        trackingNumber,
        pdfUrl: labelUrl,
        carrier: 'ups',

        serviceType,



        status: 'created',
        order: { connect: { id: orderId } },
        ...(req.body.orderItemId ? { orderItemId: req.body.orderItemId } : {})
      },
    });
    return res.status(200).json({ success: true, shipment });
  } catch (error: any) {
    console.error('UPS label save error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
