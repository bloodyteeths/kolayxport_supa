// PATCH an order with address & options edits
import prisma from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '@/lib/logger'; // Assuming you have a logger, changed to named import
import { getAuthUser } from '@/lib/auth';

// Define a more specific type for the updates if possible, based on LabelRow
interface OrderUpdatePayload {
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientStreet1?: string;
  recipientStreet2?: string;
  recipientCity?: string;
  recipientState?: string;
  recipientPostal?: string;
  recipientCountry?: string;
  recipientPhone?: string;
  // Add other fields from LabelRow that are editable and should be saved to shippoOptions
  // For example:
  title?: string; // commodityDesc for the item
  weight?: number;
  hsCode?: string;
  countryOfOrigin?: string;
  fedexServiceType?: string;
  fedexPackagingType?: string;
  // Potentially commodityDesc if it's directly on the order level for shippoOptions
  commodityDesc?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    logger.warn(`[API /orders/update] Method Not Allowed: ${req.method}`);
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // --- Authentication ---
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const {
    id: orderId,
    itemId,
    recipientFirstName,
    recipientLastName,
    recipientStreet1,
    recipientStreet2,
    recipientCity,
    recipientState,
    recipientPostal,
    recipientCountry,
    recipientPhone,
    fedexServiceType,
    fedexPackagingType,
    commodityDesc,
    countryOfOrigin,
    hsCode,
    weight,
  } = req.body as any // Cast as any for now, consider defining a proper type

  // logger.info('[API /orders/update] received', { orderId, itemId, body: req.body })

  try {
    // Check if a shipping label already exists for this order before updating address fields
    let labelWarning: string | undefined;
    const hasAddressChange = recipientFirstName !== undefined || recipientLastName !== undefined ||
      recipientStreet1 !== undefined || recipientStreet2 !== undefined ||
      recipientCity !== undefined || recipientState !== undefined ||
      recipientPostal !== undefined || recipientCountry !== undefined;

    if (hasAddressChange) {
      const existingShipment = await prisma.shipment.findFirst({
        where: {
          orderId: orderId,
          status: 'created',
        },
      });

      if (existingShipment) {
        logger.warn(`[API /orders/update] Order ${orderId} has an existing shipment (${existingShipment.id}) with status 'created'. Address is being updated anyway.`);
        labelWarning = 'Address updated but a shipping label already exists. Consider regenerating the label.';
      }
    }

    // Prepare data for Order update, excluding fields not directly on Order model or handled separately
    const orderUpdateData: any = {
        // shippingAddress will be updated as a JSON object
        fedexServiceType,
        fedexPackagingType,
        commodityDesc, // Assuming commodityDesc is a field on Order model
        countryOfMfg: countryOfOrigin, // Assuming countryOfMfg is a field on Order model
        harmonizedCode: hsCode, // Assuming harmonizedCode is a field on Order model
        updatedAt: new Date(),
    };

    // Construct shippingAddress JSON
    const shippingAddress = {
        firstName: recipientFirstName,
        lastName:  recipientLastName,
        street1:   recipientStreet1,
        street2:   recipientStreet2,
        city:      recipientCity,
        state:     recipientState,
        postal:    recipientPostal,
        country:   recipientCountry,
        phone:     recipientPhone,
        email:     req.body.shippingAddress?.email,
    };
    
    // Only include shippingAddress in update if there are any address fields provided.
    // This check might be more robust depending on whether all fields are always sent or can be partial.
    if (Object.values(shippingAddress).some(val => val !== undefined)) {
        orderUpdateData.shippingAddress = shippingAddress; // Prisma expects the direct JSON object for update
    }

    await prisma.order.update({
      where: { id: orderId, userId: user.id },
      data: orderUpdateData,
    })

    if (itemId && (weight !== undefined || hsCode !== undefined || countryOfOrigin !== undefined)) {
      const itemUpdateData: any = {};
      if (weight !== undefined) {
        itemUpdateData.weightKg = weight;
        // Mark this line item as user-edited so the order sync writer
        // preserves the value on the next resync instead of clobbering it
        // from rawData.
        itemUpdateData.weightEditedAt = new Date();
      }
      if (hsCode !== undefined) itemUpdateData.harmonizedCode = hsCode;
      if (countryOfOrigin !== undefined) itemUpdateData.countryOfMfg = countryOfOrigin;
      
      if (Object.keys(itemUpdateData).length > 0) {
        // First check if the OrderItem exists
        const existingItem = await prisma.orderItem.findUnique({
          where: { id: String(itemId) }
        });
        
        if (existingItem) {
          await prisma.orderItem.update({
            where: { id: String(itemId) },
            data: itemUpdateData,
          })
          logger.info(`[API /orders/update] Updated OrderItem ${itemId}`, itemUpdateData);
        } else {
          logger.warn(`[API /orders/update] OrderItem ${itemId} not found, skipping update`);
        }
      }
    }

    logger.info(`[API /orders/update] Successfully updated order ${orderId}`);
    return res.status(200).json({
      success: true,
      ok: true,
      ...(labelWarning && { warning: labelWarning }),
    })
  } catch (err: any) {
    logger.error('[API /orders/update] DB error', err)
    return res.status(500).json({ error: 'DB update failed', details: err.message || String(err) })
  }
} 