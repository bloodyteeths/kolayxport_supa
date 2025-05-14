import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { getSupabaseServerClient } from '../../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res
      .status(405)
      .json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * pageSize;

  try {
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          marketplace: true,
          marketplaceKey: true,
          rawData: true,
          rawFetchedAt: true,
          syncedAt: true,
          syncStatus: true,
          trackingNumber: true,
          shippingLabelUrl: true,
          shipmentStatus: true,
          shippedAt: true,
          packingStatus: true,
          productionNotes: true,
          packingEditedAt: true,
          productionEditedAt: true,
          termsOfSale: true,
          shippingChargesPaymentType: true,
          packageLength: true,
          packageWidth: true,
          packageHeight: true,
          dimensionUnits: true,
          commodityDesc: true,
          countryOfMfg: true,
          harmonizedCode: true,
          sendCommercialInvoiceViaEtd: true,
          customerName: true,
          status: true,
          shipByDate: true,
          currency: true,
          totalPrice: true,
          shippingAddress: true,
          billingAddress: true,
          createdAt: true,
          updatedAt: true,
          images: true,
          fedexServiceType: true,
          fedexPackagingType: true,
          fedexPickupType: true,
          fedexDutiesPaymentType: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: skip,
        take: pageSize,
      }),
      prisma.order.count({ where: { userId: user.id } }),
    ]);

    return res.status(200).json({ orders, total, page, pageSize });
  } catch (error: any) {
    console.error('Error fetching orders:', error);
    return res
      .status(500)
      .json({ error: 'Failed to fetch orders', details: error.message });
  }
} 