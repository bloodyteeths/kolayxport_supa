import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getUpsCredentialsForUser } from '@/lib/ups/ups.credentials';
import { createUpsShipment, CreateShipmentInput, getUpsAccessToken } from '@/lib/ups/createUpsShipment';
import { saveUpsLabelToCache } from '@/lib/ups/cache';

// Utility to parse phone number and extension
function parsePhoneNumberWithExt(raw: string): { phone: string, ext?: string } {
  if (!raw) return { phone: '' };
  const extMatch = raw.match(/ext\.?\s*(\d+)/i) || raw.match(/x\s*(\d+)/i);
  const ext = extMatch ? extMatch[1] : undefined;
  let phone = raw.replace(/(ext\.?\s*\d+|x\s*\d+)/i, '').replace(/\D/g, '');
  if (phone.length > 10) phone = phone.slice(-10);
  return { phone, ext };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // For now, get userId from body (replace with real auth in production)
  const { userId, orderId, recipient, package: pkg, serviceType, isEdi = true, internationalForms } = req.body || {};

  if (!userId || !orderId || !recipient || !pkg || !serviceType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    console.log('[UPS LABEL DEBUG] Handler start');
    // Load UPS credentials
    let upsCreds;
    try {
      console.log('[UPS LABEL DEBUG] Getting UPS credentials for user', userId);
      upsCreds = await getUpsCredentialsForUser(userId);
      console.log('[UPS LABEL DEBUG] Got UPS credentials');
    } catch (err: any) {
      console.error('[UPS LABEL DEBUG] Error getting UPS credentials:', err);
      return res.status(400).json({ success: false, error: 'Missing or invalid UPS credentials: ' + (err.message || 'Please check your UPS API key, secret, and account number.') });
    }

    // Load shipper profile
    console.log('[UPS LABEL DEBUG] Loading shipper profile for user', userId);
    const shipperProfileDb = await prisma.shipperProfile.findUnique({ where: { userId } });
    if (!shipperProfileDb) {
      console.error('[UPS LABEL DEBUG] Missing shipper profile for user', userId);
      return res.status(400).json({ success: false, error: 'Missing shipper profile for user. Please complete your shipper address and contact information.' });
    }

    // Build shipper input for UPS
    console.log('[UPS LABEL DEBUG] Building shipper input');
    const shipper = {
      ...upsCreds,
      shipperName: shipperProfileDb.shipperName || '',
      shipperPersonName: shipperProfileDb.shipperPersonName || '',
      shipperPhoneNumber: shipperProfileDb.shipperPhoneNumber || '',
      shipperStreet1: shipperProfileDb.shipperStreet1 || '',
      shipperStreet2: shipperProfileDb.shipperStreet2 || undefined,
      shipperCity: shipperProfileDb.shipperCity || '',
      shipperStateCode: shipperProfileDb.shipperStateCode || '',
      shipperPostalCode: shipperProfileDb.shipperPostalCode || '',
      shipperCountryCode: shipperProfileDb.shipperCountryCode || '',
      shipperTinNumber: shipperProfileDb.shipperTinNumber || undefined,
      shipperTinType: shipperProfileDb.shipperTinType || undefined,
      dutiesPaymentType: shipperProfileDb.dutiesPaymentType || undefined,
      defaultCurrencyCode: shipperProfileDb.defaultCurrencyCode || undefined,
      importerOfRecord: shipperProfileDb.importerOfRecord || undefined,
    };

    // Normalize recipient phone and extract extension
    console.log('[UPS LABEL DEBUG] Normalizing recipient phone');
    const { phone: normalizedPhone, ext: phoneExt } = parsePhoneNumberWithExt(recipient.phone);
    const normalizedRecipient = { ...recipient, phone: normalizedPhone };
    if (phoneExt) normalizedRecipient.ext = phoneExt;

    // Overwrite order's shipping address in DB before label generation
    console.log('[UPS LABEL DEBUG] Updating order shipping address in DB for order', orderId);
    await prisma.order.update({
      where: { id: orderId },
      data: {
        shippingAddress: {
          ...(normalizedRecipient.name && { name: normalizedRecipient.name }),
          ...(normalizedRecipient.phone && { phone: normalizedRecipient.phone }),
          ...(normalizedRecipient.ext && { ext: normalizedRecipient.ext }),
          ...(normalizedRecipient.street1 && { street1: normalizedRecipient.street1 }),
          ...(normalizedRecipient.street2 && { street2: normalizedRecipient.street2 }),
          ...(normalizedRecipient.city && { city: normalizedRecipient.city }),
          ...(normalizedRecipient.stateCode && { state: normalizedRecipient.stateCode }),
          ...(normalizedRecipient.postalCode && { postal: normalizedRecipient.postalCode }),
          ...(normalizedRecipient.countryCode && { country: normalizedRecipient.countryCode }),
        },
      },
    });
    console.log('[UPS LABEL DEBUG] Order shipping address updated');

    const input: CreateShipmentInput = {
      shipper,
      recipient: normalizedRecipient,
      package: pkg,
      serviceType,
      isEdi,
      internationalForms,
    };

    if (isEdi && internationalForms) {
      console.log('[UPS LABEL DEBUG] EDI flow: using paperless helpers');
      const { generateInvoicePdf, pushPaperlessDocument } = await import('@/lib/ups/paperless');

      // Step 1: Create the shipment first, without a DocumentID.
      console.log('[UPS API] Step 1: Calling createUpsShipment for EDI.');
      const shipmentResult = await createUpsShipment(input);

      if (!shipmentResult.success || !shipmentResult.trackingNumber) {
        console.error('[UPS API] Step 1 FAILED: Shipment creation failed.', shipmentResult.errors, shipmentResult.raw);
        return res.status(500).json({ success: false, message: 'UPS shipment creation failed.', errors: shipmentResult.errors, raw: shipmentResult.raw });
      }

      console.log('[UPS API] Step 1 SUCCEEDED: Shipment created, tracking:', shipmentResult.trackingNumber);

      // Save the successful shipment to the database immediately.
      await prisma.shipment.create({
        data: {
          order: { connect: { id: orderId } },
          carrier: 'ups',
          status: 'created',
          pdfUrl: shipmentResult.labelUrl,
          trackingNumber: shipmentResult.trackingNumber,
          serviceType,
          isEdi: true,
        },
      });
              console.log('[UPS API] Shipment record saved to DB.');

      // No Step 2 needed – EDI label already generated
      return res.status(200).json(shipmentResult);
    } else {
      // Non-EDI flow
      console.log('[UPS LABEL DEBUG] Calling createUpsShipment');
      const result = await createUpsShipment(input);
      console.log('[UPS LABEL DEBUG] createUpsShipment result:', result);
      // Save to Shipment and update Order tables
      console.log('[UPS LABEL DEBUG] Saving shipment to DB');
      await prisma.shipment.create({
        data: {
          order: { connect: { id: orderId } },
          carrier: 'ups',
          status: 'created',
          pdfUrl: result.labelUrl,
          trackingNumber: result.trackingNumber,
          serviceType,
          isEdi: false,
        },
      });
      console.log('[UPS LABEL DEBUG] Shipment record saved to DB');
      return res.status(200).json({ success: true, trackingNumber: result.trackingNumber, labelUrl: result.labelUrl });
    }
  } catch (error: any) {
    console.error('UPS label error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
}
