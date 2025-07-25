import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getUpsCredentialsForUser } from '@/lib/ups/ups.credentials';
import { createUpsShipment, CreateShipmentInput, getUpsAccessToken } from '@/lib/ups/createUpsShipment';
import { saveUpsLabelToCache } from '@/lib/ups/cache';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';

// Utility to parse phone number and extension - handles Amazon format like "+1 415-851-9136 ext. 96793"
function parsePhoneNumberWithExt(raw: string): { phone: string, ext?: string } {
  if (!raw) return { phone: '' };
  
  // Extract extension - matches "ext. 96793", "ext 96793", "x96793", "x 96793", etc.
  const extMatch = raw.match(/(?:ext\.?\s*|x\s*)(\d+)/i);
  const ext = extMatch ? extMatch[1] : undefined;
  
  // Remove extension part from the phone number
  let phoneWithoutExt = raw;
  if (extMatch) {
    phoneWithoutExt = raw.substring(0, extMatch.index).trim();
  }
  
  // Extract only digits from the phone number
  let phone = phoneWithoutExt.replace(/\D/g, '');
  
  // Handle different phone number lengths
  if (phone.length === 11 && phone.startsWith('1')) {
    // Remove country code for US numbers (1-xxx-xxx-xxxx)
    phone = phone.substring(1);
  } else if (phone.length > 10) {
    // Take the last 10 digits for any other long numbers
    phone = phone.slice(-10);
  }
  
  // Ensure we have exactly 10 digits for UPS
  if (phone.length !== 10) {
    console.warn(`[UPS PHONE] Warning: Phone number "${raw}" normalized to "${phone}" with ${phone.length} digits (expected 10)`);
  }
  
  return { phone, ext };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // For now, get userId from body (replace with real auth in production)
  const { userId, orderId, recipient, package: pkg, serviceType, isEdi = true, internationalForms, dutyPaymentType = 'RECEIVER', description } = req.body || {};
  
  console.log('[UPS LABEL DEBUG] Received description:', description);

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

    // Check for existing shipments to prevent multiple labels
    console.log('[UPS LABEL DEBUG] Checking for existing shipments for order', orderId);
    const existingShipments = await prisma.shipment.findMany({
      where: {
        orderId: orderId,
        status: 'created'
      }
    });

    if (existingShipments.length > 0) {
      console.error('[UPS LABEL DEBUG] Order already has existing shipments:', existingShipments.length);
      return res.status(400).json({ 
        success: false, 
        error: 'Bu sipariş için zaten bir etiket mevcut. Yeni etiket oluşturmak için mevcut etiketi silin.' 
      });
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
    console.log('[UPS LABEL DEBUG] Normalizing recipient phone:', recipient.phone);
    const { phone: normalizedPhone, ext: phoneExt } = parsePhoneNumberWithExt(recipient.phone);
    
    // Normalize postal code - remove dashes for UPS (e.g., "20903-2633" → "209032633")
    const normalizedPostalCode = recipient.postalCode?.replace(/-/g, '') || '';
    if (recipient.postalCode !== normalizedPostalCode) {
      console.log('[UPS LABEL DEBUG] Normalized postal code:', recipient.postalCode, '→', normalizedPostalCode);
    }
    
    const normalizedRecipient = { 
      ...recipient, 
      phone: normalizedPhone,
      postalCode: normalizedPostalCode
    };
    
    if (phoneExt) {
      normalizedRecipient.ext = phoneExt; // Keep for database storage
      console.log('[UPS LABEL DEBUG] Extracted phone extension:', phoneExt);
      
      if (phoneExt.length <= 4) {
        // Use UPS extension field for 4 digits or less
        normalizedRecipient.phoneExtension = phoneExt;
      } else {
        // Add long extension to address line 2 for 5+ digits
        const extText = ` EXT ${phoneExt}`;
        normalizedRecipient.street2 = (normalizedRecipient.street2 || '').trim() + extText;
        console.log('[UPS LABEL DEBUG] Long extension added to address line 2:', extText);
      }
    }

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
      description,
      internationalForms,
      dutyPaymentType,
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
          carrier: 'UPS',
          status: 'created',
          pdfUrl: shipmentResult.labelUrl,
          trackingNumber: shipmentResult.trackingNumber,
          serviceType,
          isEdi: true,
        },
      });
              console.log('[UPS API] Shipment record saved to DB.');

      // Increment usage counter after successful label generation
      if (res.incrementUsage) {
        await res.incrementUsage();
      }

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
          carrier: 'UPS',
          status: 'created',
          pdfUrl: result.labelUrl,
          trackingNumber: result.trackingNumber,
          serviceType,
          isEdi: false,
        },
      });
      console.log('[UPS LABEL DEBUG] Shipment record saved to DB');
      
      // Increment usage counter after successful label generation
      if (res.incrementUsage) {
        await res.incrementUsage();
      }
      
      return res.status(200).json({ success: true, trackingNumber: result.trackingNumber, labelUrl: result.labelUrl });
    }
  } catch (error: any) {
    console.error('UPS label error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
}

export default withUsageLimiter(handler, 'label');
