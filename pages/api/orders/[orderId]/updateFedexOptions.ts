import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import { fedexOptionsData } from '../../../../lib/fedexConfig'; // Corrected: Import from shared config

interface UpdateFedexOptionsPayload {
  fedexServiceType?: string;
  fedexPackagingType?: string;
  fedexPickupType?: string;
  fedexDutiesPaymentType?: string;
  shippingChargesPaymentType?: string;
  packageLength?: number;
  packageWidth?: number;
  packageHeight?: number;
  dimensionUnits?: string;
  commodityDesc?: string;
  countryOfMfg?: string;
  harmonizedCode?: string;
  labelStockType?: string;
  signatureType?: string;
  sendCommercialInvoiceViaEtd?: boolean;
  termsOfSale?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { orderId } = req.query;
  if (typeof orderId !== 'string' || !orderId) {
    return res.status(400).json({ error: 'Order ID is required in the path.' });
  }

  const payload = req.body as UpdateFedexOptionsPayload;

  // Validate payload values against allowed options
  if (payload.fedexServiceType && !fedexOptionsData.serviceTypes.some(opt => opt.value === payload.fedexServiceType)) {
    return res.status(400).json({ error: `Invalid FedEx Service Type: ${payload.fedexServiceType}` });
  }
  if (payload.fedexPackagingType && !fedexOptionsData.packagingTypes.some(opt => opt.value === payload.fedexPackagingType)) {
    return res.status(400).json({ error: `Invalid FedEx Packaging Type: ${payload.fedexPackagingType}` });
  }
  if (payload.fedexPickupType && !fedexOptionsData.pickupTypes.some(opt => opt.value === payload.fedexPickupType)) {
    return res.status(400).json({ error: `Invalid FedEx Pickup Type: ${payload.fedexPickupType}` });
  }
  if (payload.fedexDutiesPaymentType && !fedexOptionsData.dutiesPaymentTypes.some(opt => opt.value === payload.fedexDutiesPaymentType)) {
    return res.status(400).json({ error: `Invalid FedEx Duties Payment Type: ${payload.fedexDutiesPaymentType}` });
  }
  if (payload.shippingChargesPaymentType && !fedexOptionsData.shippingChargesPaymentTypes.some(opt => opt.value === payload.shippingChargesPaymentType)) {
    return res.status(400).json({ error: `Invalid Shipping Charges Payment Type: ${payload.shippingChargesPaymentType}` });
  }
  if (payload.packageLength !== undefined && (typeof payload.packageLength !== 'number' || payload.packageLength <= 0)) {
    return res.status(400).json({ error: 'Invalid package length.'});
  }
  if (payload.packageWidth !== undefined && (typeof payload.packageWidth !== 'number' || payload.packageWidth <= 0)) {
    return res.status(400).json({ error: 'Invalid package width.'});
  }
  if (payload.packageHeight !== undefined && (typeof payload.packageHeight !== 'number' || payload.packageHeight <= 0)) {
    return res.status(400).json({ error: 'Invalid package height.'});
  }
  if (payload.dimensionUnits && !fedexOptionsData.dimensionUnits.some(opt => opt.value === payload.dimensionUnits)) {
    return res.status(400).json({ error: `Invalid dimension units: ${payload.dimensionUnits}` });
  }
  if (payload.labelStockType && !fedexOptionsData.labelStockTypes.some(opt => opt.value === payload.labelStockType)) {
    return res.status(400).json({ error: `Invalid Label Stock Type: ${payload.labelStockType}` });
  }
  if (payload.signatureType && !fedexOptionsData.signatureTypes.some(opt => opt.value === payload.signatureType)) {
    return res.status(400).json({ error: `Invalid Signature Type: ${payload.signatureType}` });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId, userId: authUser.id },
    });

    if (!order) {
      return res.status(404).json({ error: `Order ${orderId} not found or access denied.` });
    }

    const updateData: Partial<UpdateFedexOptionsPayload> = {};
    if (payload.fedexServiceType) updateData.fedexServiceType = payload.fedexServiceType;
    if (payload.fedexPackagingType) updateData.fedexPackagingType = payload.fedexPackagingType;
    if (payload.fedexPickupType) updateData.fedexPickupType = payload.fedexPickupType;
    if (payload.fedexDutiesPaymentType) updateData.fedexDutiesPaymentType = payload.fedexDutiesPaymentType;
    if (payload.shippingChargesPaymentType) updateData.shippingChargesPaymentType = payload.shippingChargesPaymentType;
    if (payload.packageLength !== undefined) updateData.packageLength = payload.packageLength;
    if (payload.packageWidth !== undefined) updateData.packageWidth = payload.packageWidth;
    if (payload.packageHeight !== undefined) updateData.packageHeight = payload.packageHeight;
    if (payload.dimensionUnits) updateData.dimensionUnits = payload.dimensionUnits;
    if (payload.commodityDesc) updateData.commodityDesc = payload.commodityDesc;
    if (payload.countryOfMfg) updateData.countryOfMfg = payload.countryOfMfg;
    if (payload.harmonizedCode) updateData.harmonizedCode = payload.harmonizedCode;
    if (payload.labelStockType) updateData.labelStockType = payload.labelStockType;
    if (payload.signatureType) updateData.signatureType = payload.signatureType;
    if (payload.sendCommercialInvoiceViaEtd !== undefined) updateData.sendCommercialInvoiceViaEtd = payload.sendCommercialInvoiceViaEtd;
    if (payload.termsOfSale) updateData.termsOfSale = payload.termsOfSale;

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No valid options provided to update.'});
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });

    return res.status(200).json({ message: 'FedEx options updated successfully.', order: updatedOrder });
  } catch (error: any) {
    console.error(`[API PATCH /api/orders/${orderId}/updateFedexOptions] Error:`, error);
    return res.status(500).json({ error: 'Failed to update FedEx options.', details: error.message });
  }
} 