import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '../../../lib/prisma';
import { getIntegrationCreds } from '../../../lib/config';
import { createShipment, FedexPayload } from '@integrations/fedex';

/**
 * POST { orderId } → creates a FedEx shipment and
 * stores a row in Shipment table.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const userId = user.id;
  const { orderId } = req.body as { orderId?: string };
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  try {
    // 1️⃣  Creds
    const creds = await getIntegrationCreds(userId);
    if (!creds.fedexApiKey || !creds.fedexApiSecret || !creds.fedexAccountNumber) {
      return res.status(400).json({ error: 'Missing FedEx credentials' });
    }

    // 2️⃣  Order + Shipper profile (with proper tenant isolation)
    const order = await prisma.order.findFirst({ 
      where: { 
        id: orderId, 
        userId: userId  // Ensure order belongs to the requesting user
      } 
    });
    const profile = await prisma.shipperProfile.findUnique({ where: { userId } });
    if (!order || !profile) return res.status(404).json({ error: 'Order or Shipper profile not found' });

    // 3️⃣  Build *very* minimal payload (TODO: map recipient etc.)
    const payload: FedexPayload = {
      labelResponseOptions: 'URL_ONLY',
      requestedShipment: {
        serviceType: profile.defaultServiceType ?? 'INTERNATIONAL_PRIORITY',
        packagingType: profile.defaultPackagingType ?? 'FEDEX_PAK',
      } as any,
    };

    // 4️⃣  FedEx call
    const fx = await createShipment(
      { apiKey: creds.fedexApiKey, apiSecret: creds.fedexApiSecret, accountNumber: creds.fedexAccountNumber },
      payload,
    );

    // 5️⃣  Persist
    const shipment = await prisma.shipment.create({
      data: {
        orderId,
        carrier: 'FEDEX',
        status: fx.success ? 'success' : 'error',
        pdfUrl: fx.pdfUrl,
        trackingNumber: fx.trackingNumber,
        errorMessage: fx.errors?.join('; '),
      },
    });

    return res.status(fx.success ? 200 : 400).json({ shipment, fx });
  } catch (err: any) {
    console.error('[shipments-create]', err);
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
}
