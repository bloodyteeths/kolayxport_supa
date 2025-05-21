import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import { fedexOptionsData } from '../../../../lib/fedex/fedex.config';
import { logger } from '../../../../lib/logger';
import { Order } from '@prisma/client';

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

  const payload = req.body as UpdateOrderOptionsPayload;
  logger.info(`[API update-options] Received payload for order ${orderId}:`, payload);

  // --- Payload Validation ---
  const validationErrors: string[] = [];
  if (payload.fedexServiceType && !fedexOptionsData.serviceTypes.some(opt => opt.value === payload.fedexServiceType)) validationErrors.push(`Invalid FedEx Service Type: ${payload.fedexServiceType}`);
  if (payload.fedexPackagingType && !fedexOptionsData.packagingTypes.some(opt => opt.value === payload.fedexPackagingType)) validationErrors.push(`Invalid FedEx Packaging Type: ${payload.fedexPackagingType}`);
  if (payload.fedexPickupType && !fedexOptionsData.pickupTypes.some(opt => opt.value === payload.fedexPickupType)) validationErrors.push(`Invalid FedEx Pickup Type: ${payload.fedexPickupType}`);
  if (payload.fedexDutiesPaymentType && !fedexOptionsData.dutiesPaymentTypes.some(opt => opt.value === payload.fedexDutiesPaymentType)) validationErrors.push(`Invalid FedEx Duties Payment Type: ${payload.fedexDutiesPaymentType}`);
  if (payload.weightKg !== undefined && (typeof payload.weightKg !== 'number' || payload.weightKg <= 0)) validationErrors.push('Invalid weightKg.');
  if (payload.packageLength !== undefined && (typeof payload.packageLength !== 'number' || payload.packageLength < 0)) validationErrors.push('Invalid package length.');
  if (payload.packageWidth !== undefined && (typeof payload.packageWidth !== 'number' || payload.packageWidth < 0)) validationErrors.push('Invalid package width.');
  if (payload.packageHeight !== undefined && (typeof payload.packageHeight !== 'number' || payload.packageHeight < 0)) validationErrors.push('Invalid package height.');
  if (payload.dimensionUnits && !fedexOptionsData.dimensionUnits.some(opt => opt.value === payload.dimensionUnits)) validationErrors.push(`Invalid dimension units: ${payload.dimensionUnits}`);
  if (payload.labelStockType && !fedexOptionsData.labelStockTypes.some(opt => opt.value === payload.labelStockType)) validationErrors.push(`Invalid Label Stock Type: ${payload.labelStockType}`);
  if (payload.signatureType && !fedexOptionsData.signatureTypes.some(opt => opt.value === payload.signatureType)) validationErrors.push(`Invalid Signature Type: ${payload.signatureType}`);
  if (payload.termsOfSale && !fedexOptionsData.termsOfSaleTypes.some(opt => opt.value === payload.termsOfSale)) validationErrors.push(`Invalid Terms of Sale: ${payload.termsOfSale}`);

  if (validationErrors.length > 0) {
    logger.warn(`[API update-options] Validation errors for order ${orderId}:`, validationErrors);
    return res.status(400).json({ error: validationErrors.join('; ') });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId, userId: authUser.id },
    });

    if (!order) {
      return res.status(404).json({ error: `Order ${orderId} not found or access denied.` });
    }

    const updateData: Partial<Order> = {};
    if (payload.fedexServiceType !== undefined) (updateData as any).serviceType = payload.fedexServiceType;
    if (payload.fedexPackagingType !== undefined) (updateData as any).packagingType = payload.fedexPackagingType;
    if (payload.fedexPickupType !== undefined) (updateData as any).pickupType = payload.fedexPickupType;
    if (payload.fedexDutiesPaymentType !== undefined) (updateData as any).dutiesPaymentType = payload.fedexDutiesPaymentType;
    if (payload.weightKg !== undefined) {
        const weight = parseFloat(payload.weightKg.toString());
        if (isNaN(weight)) {
            validationErrors.push('Invalid weightKg value.');
        } else {
            (updateData as any).weightKg = weight;
        }
    }
    if (payload.packageLength !== undefined) updateData.packageLength = payload.packageLength;
    if (payload.packageWidth !== undefined) updateData.packageWidth = payload.packageWidth;
    if (payload.packageHeight !== undefined) updateData.packageHeight = payload.packageHeight;
    if (payload.dimensionUnits !== undefined) updateData.dimensionUnits = payload.dimensionUnits;
    if (payload.commodityDesc !== undefined) updateData.commodityDesc = payload.commodityDesc;
    if (payload.countryOfMfg !== undefined) updateData.countryOfMfg = payload.countryOfMfg;
    if (payload.harmonizedCode !== undefined) updateData.harmonizedCode = payload.harmonizedCode;
    if (payload.labelStockType !== undefined) updateData.labelStockType = payload.labelStockType;
    if (payload.signatureType !== undefined) updateData.signatureType = payload.signatureType;
    if (payload.sendCommercialInvoiceViaEtd !== undefined) updateData.sendCommercialInvoiceViaEtd = payload.sendCommercialInvoiceViaEtd;
    if (payload.termsOfSale !== undefined) updateData.termsOfSale = payload.termsOfSale;
    if (payload.notes !== undefined) updateData.notes = payload.notes;
    if (payload.shippingAddress && typeof payload.shippingAddress === 'object') {
        updateData.shippingAddress = payload.shippingAddress;
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