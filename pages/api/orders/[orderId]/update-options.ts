import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import { fedexOptionsData } from '../../../../lib/fedex/fedex.config';
import { logger } from '../../../../lib/logger';
import { Order } from '@prisma/client';
import Prisma from '../../../../node_modules/.prisma/client';

interface UpdateOrderOptionsPayload {
  fedexServiceType?: string;
  fedexPackagingType?: string;
  fedexPickupType?: string;
  fedexDutiesPaymentType?: string;
  weightKg?: number;
  packageLength?: number;
  packageWidth?: number;
  packageHeight?: number;
  dimensionUnits?: 'CM' | 'IN';
  commodityDesc?: string;
  countryOfMfg?: string;
  harmonizedCode?: string;
  labelStockType?: string;
  signatureType?: string;
  sendCommercialInvoiceViaEtd?: boolean;
  termsOfSale?: string;
  shippingAddress?: object;
  notes?: string;
  status?: string;
  customerName?: string;
  currency?: string;
  totalPrice?: number;
  rawData?: any;
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

  const { orderId } = req.query as { orderId: string };
  const payload = req.body as UpdateOrderOptionsPayload;

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }
  logger.info(`[API update-options] Received payload for order ${orderId}:`, payload);

  const errors: string[] = [];

  // Validate FedEx specific options using the imported fedexOptionsData
  if (payload.fedexServiceType && !fedexOptionsData.serviceTypes.some(opt => opt.value === payload.fedexServiceType)) errors.push(`Invalid FedEx Service Type: ${payload.fedexServiceType}`);
  if (payload.fedexPackagingType && !fedexOptionsData.packagingTypes.some(opt => opt.value === payload.fedexPackagingType)) errors.push(`Invalid FedEx Packaging Type: ${payload.fedexPackagingType}`);
  if (payload.fedexDutiesPaymentType && !fedexOptionsData.dutiesPaymentTypes.some(opt => opt.value === payload.fedexDutiesPaymentType)) errors.push(`Invalid FedEx Duties Payment Type: ${payload.fedexDutiesPaymentType}`);
  if (payload.weightKg !== undefined && (typeof payload.weightKg !== 'number' || payload.weightKg <= 0)) errors.push('Invalid weightKg.');
  if (payload.labelStockType && !fedexOptionsData.labelStockTypes.some(opt => opt.value === payload.labelStockType)) errors.push(`Invalid Label Stock Type: ${payload.labelStockType}`);
  if (payload.signatureType && !fedexOptionsData.signatureTypes.some(opt => opt.value === payload.signatureType)) errors.push(`Invalid Signature Type: ${payload.signatureType}`);
  if (payload.termsOfSale && !fedexOptionsData.termsOfSaleTypes.some(opt => opt.value === payload.termsOfSale)) errors.push(`Invalid Terms of Sale: ${payload.termsOfSale}`);

  const validPickups = ['DROPOFF_AT_FEDEX_LOCATION', 'REGULAR_PICKUP', 'CONTACT_FEDEX_TO_SCHEDULE', 'DROP_BOX'];
  if (payload.fedexPickupType && !validPickups.includes(payload.fedexPickupType)) {
    errors.push("Invalid FedEx pickup type");
  }

  // Optional dimensions: only validate if provided and > 0
  if (payload.packageLength !== undefined && payload.packageLength !== null && Number(payload.packageLength) <= 0) {
    errors.push("Invalid package length. Must be greater than 0 if provided.");
  }
  if (payload.packageWidth !== undefined && payload.packageWidth !== null && Number(payload.packageWidth) <= 0) {
    errors.push("Invalid package width. Must be greater than 0 if provided.");
  }
  if (payload.packageHeight !== undefined && payload.packageHeight !== null && Number(payload.packageHeight) <= 0) {
    errors.push("Invalid package height. Must be greater than 0 if provided.");
  }
  // Ensure dimensionUnits is validated if dimensions are present
  if ((payload.packageLength || payload.packageWidth || payload.packageHeight) && 
      payload.dimensionUnits && 
      !fedexOptionsData.dimensionUnits.some(opt => opt.value === payload.dimensionUnits)) {
    errors.push(`Invalid dimension units: ${payload.dimensionUnits}`);
  }

  if (errors.length > 0) {
    logger.warn(`[API update-options] Validation errors for order ${orderId}:`, errors);
    return res.status(400).json({ error: errors.join(', ') });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId, userId: authUser.id },
    });

    if (!order) {
      return res.status(404).json({ error: `Order ${orderId} not found or access denied.` });
    }

    const updateData: any = {};
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.customerName !== undefined) updateData.customerName = payload.customerName;
    if (payload.currency !== undefined) updateData.currency = payload.currency;
    if (payload.totalPrice !== undefined) updateData.totalPrice = new Prisma.Prisma.Decimal(payload.totalPrice);
    if (payload.shippingAddress && typeof payload.shippingAddress === 'object') {
        updateData.shippingAddress = payload.shippingAddress;
    }
    const extraFields = { ...payload };
    delete extraFields.status;
    delete extraFields.customerName;
    delete extraFields.currency;
    delete extraFields.totalPrice;
    delete extraFields.shippingAddress;
    const baseRawData = (order && typeof order.rawData === 'object' && order.rawData !== null) ? order.rawData : {};
    if (Object.keys(extraFields).length > 0) {
        updateData.rawData = { ...baseRawData, ...extraFields };
    }
    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No valid options provided to update.'});
    }
    updateData.updatedAt = new Date();

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });

    logger.info(`[API update-options] FedEx options updated successfully for order ${orderId}.`);
    return res.status(200).json({ message: 'Order options updated successfully.', order: updatedOrder });
  } catch (error: any) {
    logger.error(`[API update-options] Error updating options for order ${orderId}:`, new Error(JSON.stringify({ message: error.message, stack: error.stack })));
    return res.status(500).json({ error: 'Failed to update order options.', details: error.message });
  }
} 