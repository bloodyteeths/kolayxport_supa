import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import prisma from '../../../../lib/prisma';
import { createFedexShipment } from '../../../../lib/fedex/fedex.service';
import { OrderRow, ShipperProfileData, FedexShipmentResult, OrderRowItem } from '../../../../lib/fedex/fedex.types';
import { fedexOptionsData } from '../../../../lib/fedex/fedex.config';
import { logger } from '../../../../lib/logger';
import { withUsageLimiter } from '../../../../lib/middleware/withUsageLimiter';

// Utility to parse phone number and extension - handles Amazon format like "+1 415-851-9136 ext. 96793"
// Same logic as UPS but adapted for FedEx (max 6 chars extension vs UPS 4 chars)
function parsePhoneNumberWithExt(raw: string): { phone: string, ext?: string } {
  const FALLBACK_PHONE = '0000000000';

  if (!raw) {
    console.warn(`[FEDEX PHONE] Warning: Empty phone number provided, using fallback "${FALLBACK_PHONE}"`);
    return { phone: FALLBACK_PHONE };
  }

  // Extract extension - matches "ext. 96793", "ext 96793", "x96793", "x 96793", etc.
  const extMatch = raw.match(/(?:ext\.?\s*|x\s*)(\d+)/i);
  let ext = extMatch ? extMatch[1] : undefined;

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
  } else if (phone.length > 15) {
    // Take the last 15 digits for any other long numbers (FedEx max)
    phone = phone.slice(-15);
  }

  // FedEx accepts 10-15 digits for phone numbers
  // If invalid, use sanitized fallback instead of passing bad data to FedEx
  if (phone.length < 10 || phone.length > 15) {
    console.warn(`[FEDEX PHONE] Warning: Phone number "${raw}" normalized to "${phone}" with ${phone.length} digits (expected 10-15). Using fallback "${FALLBACK_PHONE}"`);
    phone = FALLBACK_PHONE;
  }

  // FedEx supports up to 6 character extensions (vs UPS 4 chars)
  if (ext && ext.length > 6) {
    console.warn(`[FEDEX PHONE] Warning: Extension "${ext}" is ${ext.length} characters (FedEx max 6), truncating`);
    ext = ext.substring(0, 6);
  }

  return { phone, ext };
}

interface ResponseData extends Partial<FedexShipmentResult> {
  error?: string;
  details?: any;
  shipmentStatus?: string;
  shippedAt?: string;
}

interface ShippingAddressParsed {
  firstName?: string;
  lastName?: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state?: string;
  postal: string;
  country: string;
  phone?: string;
  email?: string;
  isResidential?: boolean;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  // Remove initial request logging
  // logger.info(`[API generate-label] Received request for orderId: ${req.query.orderId}`, { body: req.body });

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !authUser) {
    logger.warn('[API generate-label] Authentication failed.', { authError });
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { orderId } = req.query;
  if (typeof orderId !== 'string' || !orderId) {
    return res.status(400).json({ error: 'Order ID is required.' });
  }

  // Check for existing shipments to prevent multiple labels
  try {
    const existingShipments = await prisma.shipment.findMany({
      where: {
        orderId: orderId,
        status: 'created'
      }
    });

    if (existingShipments.length > 0) {
      logger.warn(`[API generate-label] Order ${orderId} already has existing shipments: ${existingShipments.length}`);
      return res.status(400).json({ 
        error: 'Bu sipariş için zaten bir etiket mevcut. Yeni etiket oluşturmak için mevcut etiketi silin.' 
      });
    }
  } catch (error) {
    logger.error('[API generate-label] Error checking existing shipments:', error);
    return res.status(500).json({ error: 'Failed to validate existing labels.' });
  }

  // --- Extract data from request body ---
  const {
    line_items: lineItemsFromRequest, // Renamed for clarity
    harmonizedCode: harmonizedCodeOverride,
    countryOfMfg: countryOfMfgOverride,
    weightKg: weightKgOverride,
    commodityDesc: commodityDescOverride,
    termsOfSale: termsOfSaleOverride,
    sendCommercialInvoiceViaEtd: sendCommercialInvoiceViaEtdOverride,
    fedexServiceType: serviceTypeOverride, // Ensure this is correctly named if used for override
    fedexPackagingType: packagingTypeOverride, // Ensure this is correctly named if used for override
    // Destructure package dimensions and units
    packageLength,
    packageWidth,
    packageHeight,
    dimensionUnits: dimensionUnitsOverride,
    // ... any other specific overrides from body
  } = req.body;

  // Validate that lineItemsFromRequest exists and is an array
  if (!lineItemsFromRequest || !Array.isArray(lineItemsFromRequest) || lineItemsFromRequest.length === 0) {
    logger.error(`[API generate-label] line_items missing or invalid in request body for order ${orderId}.`);
    return res.status(400).json({ error: 'Request body must contain a valid line_items array.' });
  }

  // Pre-fetch OrderItems once to avoid duplicate queries in success and error paths
  let actualOrderItems: { id: string; productName: string | null }[] = [];

  try {
    // Fetch order items early so both success and catch paths can reuse the result
    actualOrderItems = await prisma.orderItem.findMany({
      where: { orderId: orderId },
      select: { id: true, productName: true }
    });

    const orderRecord = await prisma.order.findUnique({
      where: { id: orderId, userId: authUser.id },
      include: {
        items: true,
        user: {
          include: {
            shipperProfile: true,
            integrationSettings: true,
          },
        },
      },
    });

    if (!orderRecord) {
      logger.warn(`[API generate-label] Order ${orderId} not found or access denied for user ${authUser.id}.`);
      return res.status(404).json({ error: `Order ${orderId} not found or access denied.` });
    }
    if (!orderRecord.user) {
      logger.error(`[API generate-label] User record not found for authenticated user ${authUser.id}. Data inconsistency.`);
      return res.status(500).json({ error: 'User data incomplete.' });
    }
    if (!orderRecord.user.shipperProfile) {
      logger.warn(`[API generate-label] Shipper profile not found for user ${authUser.id}. Order ${orderId}.`);
      return res.status(400).json({ error: 'Shipper profile not found. Please complete your shipper details in Ayarlar.' });
    }
    if (!orderRecord.user.integrationSettings ||
        !orderRecord.user.integrationSettings.fedexApiKey ||
        !orderRecord.user.integrationSettings.fedexApiSecret ||
        !orderRecord.user.integrationSettings.fedexAccountNumber) {
      logger.warn(`[API generate-label] FedEx integration settings missing for user ${authUser.id}. Order ${orderId}.`);
      return res.status(400).json({ error: 'FedEx API credentials not configured in Ayarlar.' });
    }

    const userDb = orderRecord.user;
    const shipperProfileDb = userDb.shipperProfile;
    const integrationSettingsDb = userDb.integrationSettings;

    if (!integrationSettingsDb) {
      logger.error(`[API generate-label] Critical: integrationSettingsDb is null for user ${authUser.id}. This should have been caught by earlier checks. Order ${orderId}.`);
      return res.status(500).json({ error: 'Integration settings are missing. Please contact support.' });
    }
    if (!shipperProfileDb) {
      logger.error(`[API generate-label] Critical: shipperProfileDb is null for user ${authUser.id}. This should have been caught by earlier checks. Order ${orderId}.`);
      return res.status(500).json({ error: 'Shipper profile data is missing. Please contact support.' });
    }

    // --- Construct ShipperProfileData ---
    if (!integrationSettingsDb.fedexApiKey || !integrationSettingsDb.fedexApiSecret || !integrationSettingsDb.fedexAccountNumber) {
      logger.error(`[API generate-label] Critical: FedEx API credentials missing or null in DB for user ${authUser.id}. Order ${orderId}.`);
      return res.status(500).json({ error: 'FedEx API credentials are not correctly configured. Please contact support.' });
    }

    const shipperData: ShipperProfileData = {
      fedexApiKey: integrationSettingsDb.fedexApiKey,
      fedexApiSecret: integrationSettingsDb.fedexApiSecret,
      fedexAccountNumber: integrationSettingsDb.fedexAccountNumber,
      shipperName: shipperProfileDb.shipperName || '',
      shipperPersonName: shipperProfileDb.shipperPersonName || '',
      shipperPhoneNumber: shipperProfileDb.shipperPhoneNumber || '',
      shipperStreet1: shipperProfileDb.shipperStreet1 || '',
      shipperStreet2: shipperProfileDb.shipperStreet2 || undefined,
      shipperCity: shipperProfileDb.shipperCity || '',
      shipperStateCode: shipperProfileDb.shipperStateCode || '',
      shipperPostalCode: shipperProfileDb.shipperPostalCode || '',
      shipperCountryCode: shipperProfileDb.shipperCountryCode || '',
      shipperTinNumber: shipperProfileDb.shipperTinNumber || '',
      shipperTinType: shipperProfileDb.shipperTinType || '',
      dutiesPaymentType: shipperProfileDb.dutiesPaymentType || 'SENDER',
      defaultCurrencyCode: shipperProfileDb.defaultCurrencyCode || 'USD',
      importerOfRecord: shipperProfileDb.importerOfRecord || undefined,
    };

    // --- Parse Shipping Address from Order ---
    let parsedShippingAddress: ShippingAddressParsed;
    if (orderRecord.shippingAddress && typeof orderRecord.shippingAddress === 'object') {
        if (Array.isArray(orderRecord.shippingAddress)) {
            logger.error(`[API generate-label] shippingAddress is an array, which is invalid for order ${orderId}.`);
            return res.status(400).json({ error: 'Shipping address format is invalid (array).' });
        }
        parsedShippingAddress = orderRecord.shippingAddress as unknown as ShippingAddressParsed;
    } else if (typeof orderRecord.shippingAddress === 'string') {
        try {
            parsedShippingAddress = JSON.parse(orderRecord.shippingAddress);
        } catch (e) {
            logger.error(`[API generate-label] Failed to parse shippingAddress JSON for order ${orderId}.`, new Error(JSON.stringify({ address: orderRecord.shippingAddress, error: e })));
            return res.status(400).json({ error: 'Invalid shipping address format on order.' });
        }
    } else {
        logger.error(`[API generate-label] shippingAddress missing or invalid for order ${orderId}.`);
        return res.status(400).json({ error: 'Shipping address is missing or invalid on order.' });
    }
     if (!parsedShippingAddress.street1 || !parsedShippingAddress.city || !parsedShippingAddress.postal || !parsedShippingAddress.country) {
         logger.warn('[API generate-label] Shipping address from DB is incomplete.', { parsedShippingAddress });
         const missingFields = [
           !parsedShippingAddress.street1 && 'street1',
           !parsedShippingAddress.city && 'city',
           !parsedShippingAddress.postal && 'postal',
           !parsedShippingAddress.country && 'country',
         ].filter(Boolean);
         return res.status(400).json({ error: `Shipping address is incomplete. Missing fields: ${missingFields.join(', ')}.` });
     }

    // --- Determine Effective Values (Overrides > Order DB > Shipper Profile Default > Hardcoded Default) ---
    const effectiveWeightKg =
      (typeof weightKgOverride === 'number' && weightKgOverride > 0) ? weightKgOverride :
      (shipperProfileDb.defaultWeightKg && shipperProfileDb.defaultWeightKg > 0) ? shipperProfileDb.defaultWeightKg :
      0.5;

    // Simplified service type logic: always international
    let chosenServiceType = serviceTypeOverride || shipperProfileDb.defaultServiceType;
    const validInternationalServices = fedexOptionsData.serviceTypes
        .filter(s => s.value.toUpperCase().includes('INTERNATIONAL') || s.label.toUpperCase().includes('INTERNATIONAL'))
        .map(s => s.value);
    
    if (!chosenServiceType || !validInternationalServices.includes(chosenServiceType.toUpperCase())) {
        if (chosenServiceType) {
            logger.warn(`[API generate-label] Order ${orderId}: Service '${chosenServiceType}' is not a recognized international service. Defaulting to INTERNATIONAL_PRIORITY.`);
        } else {
            // Remove debug logging
            // logger.info(`[API generate-label] Order ${orderId}: No service type specified. Defaulting to INTERNATIONAL_PRIORITY.`);
        }
        chosenServiceType = 'INTERNATIONAL_PRIORITY'; // Default international service
    }
    const effectiveServiceType = chosenServiceType;

    const effectivePackagingType =
      packagingTypeOverride ||
      shipperProfileDb.defaultPackagingType ||
      fedexOptionsData.packagingTypes.find(p => p.value === 'YOUR_PACKAGING')?.value ||
      fedexOptionsData.packagingTypes[0].value;

    const effectivePickupType =
      'DROPOFF_AT_FEDEX_LOCATION';

    const effectiveLabelStockType =
      'PAPER_4X6';

    const effectiveCurrency = orderRecord.currency || shipperProfileDb.defaultCurrencyCode || 'USD';

    const effectiveShippingChargesPaymentType =
      shipperProfileDb.defaultShippingChargesPaymentType &&
      fedexOptionsData.shippingChargesPaymentTypes.some(opt => opt.value === shipperProfileDb.defaultShippingChargesPaymentType)
        ? shipperProfileDb.defaultShippingChargesPaymentType
        : 'SENDER';

    // --- HS-code sanitation (for overrides and defaults) ---
    const sanitizeAndValidateHsCode = (rawHs: string | undefined | null): string | undefined => {
      if (!rawHs) return undefined;
      const cleanedHs = String(rawHs).replace(/\D/g, ''); // keep digits only
      return cleanedHs.length >= 6 && cleanedHs.length <= 10 ? cleanedHs : undefined;
    };

    const sanitizeDescription = (desc: string | undefined | null): string => {
      if (!desc) return 'Product';
      let sanitized = String(desc).replace(/&#39;/g, "'");
      // FedEx allows up to 450 characters for commodity descriptions
      if (sanitized.length > 450) {
        sanitized = sanitized.substring(0, 447) + '...';
      }
      return sanitized;
    };

    const validGlobalHsOverride = sanitizeAndValidateHsCode(harmonizedCodeOverride);
    const DEFAULT_FALLBACK_HS_CODE_FOR_TYPE_CHECKER = '000000';

    // --- Prepare OrderRowItems for ETD ---
    const etdDefaults = shipperProfileDb ? {
      weightKg: shipperProfileDb.defaultWeightKg || 0.5,
      harmonizedCode: shipperProfileDb.defaultHarmonizedCode || '000000', // Fallback HS if all else fails
      countryOfMfg: shipperProfileDb.defaultCountryOfMfg || 'CN',     // Fallback CoM if all else fails
    } : { weightKg: 0.5, harmonizedCode: '000000', countryOfMfg: 'CN' };

    // Use line_items from request body to construct items for FedEx - MAPPING TO FEDEX 'COMMODITIES' STRUCTURE
    const commodities: any[] = lineItemsFromRequest.map((item: any) => {
      const itemHs = sanitizeAndValidateHsCode(item.hs_code);
      const orderRecordHs = sanitizeAndValidateHsCode(orderRecord.harmonizedCode);
      const shipperProfileHs = sanitizeAndValidateHsCode(shipperProfileDb.defaultHarmonizedCode);
      const effectiveItemHs = itemHs || validGlobalHsOverride || orderRecordHs || shipperProfileHs;

      const itemWeightKg = item.weight || weightKgOverride || orderRecord.weightKg || etdDefaults.weightKg;
      const itemUnitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : 0;
      const itemQuantity = item.quantity || 1;
      const itemCustomsValue = itemUnitPrice * itemQuantity;

      return {
        description: sanitizeDescription(item.title || commodityDescOverride || orderRecord.commodityDesc || 'Product'),
        quantity: itemQuantity,
        quantityUnits: 'EA', // Added quantityUnits
        unitPrice: { amount: itemUnitPrice, currency: effectiveCurrency }, // Nested unitPrice
        customsValue: { amount: parseFloat(itemCustomsValue.toFixed(2)), currency: effectiveCurrency }, // Auto-calculate customsValue per item
        weight: { units: 'KG', value: itemWeightKg }, // Nested weight
        countryOfManufacture: (item.country_of_origin || countryOfMfgOverride || orderRecord.countryOfMfg || etdDefaults.countryOfMfg || '').toUpperCase(), // Normalize to uppercase
        ...(effectiveItemHs && { harmonizedCode: effectiveItemHs }), // Uses correct type now
        // sku: item.sku || undefined // SKU is not typically part of FedEx commodities array
      };
    });

    if (commodities.length === 0) {
        // Remove debug warning
        // logger.warn(`[API generate-label] Order ${orderId}: commodities array is empty. Adding a fallback item.`);
        commodities.push({
            description: sanitizeDescription(commodityDescOverride || orderRecord.commodityDesc || 'General Goods'),
            quantity: 1,
            quantityUnits: 'EA',
            unitPrice: { amount: 0, currency: effectiveCurrency },
            customsValue: { amount: 0, currency: effectiveCurrency },
            weight: { units: 'KG', value: effectiveWeightKg },
            countryOfManufacture: (countryOfMfgOverride || orderRecord.countryOfMfg || etdDefaults.countryOfMfg || '').toUpperCase(),
            ...( (validGlobalHsOverride || sanitizeAndValidateHsCode(orderRecord.harmonizedCode) || sanitizeAndValidateHsCode(etdDefaults.harmonizedCode)) && 
               { harmonizedCode: validGlobalHsOverride || sanitizeAndValidateHsCode(orderRecord.harmonizedCode) || sanitizeAndValidateHsCode(etdDefaults.harmonizedCode) }
            )
        });
    }
    
    const totalCustomsAmount = commodities.reduce((sum, item) => sum + (item.customsValue?.amount || 0), 0);

    // --- Construct OrderRow (which maps to FedEx requestedShipment) ---
    const orderDataForFedex: any = { // Changed to any to allow dynamic structure for FedEx
      orderId: orderRecord.id, // Internal reference, not for FedEx payload directly at this level
      orderNumber: orderRecord.orderNumber || orderRecord.id, // Internal reference

      // Recipient Details (These will be mapped to shipper.contact, recipient.contact, recipient.address by createFedexShipment)
      recipientFname: parsedShippingAddress.firstName || orderRecord.customerName?.split(' ')[0] || 'N/A',
      recipientLname: parsedShippingAddress.lastName || orderRecord.customerName?.split(' ').slice(1).join(' ') || 'N/A',
      recipientCompany: parsedShippingAddress.company || undefined,
      recipientStreet1: parsedShippingAddress.street1,
      recipientStreet2: parsedShippingAddress.street2 || undefined,
      recipientCity: parsedShippingAddress.city,
      recipientState: parsedShippingAddress.state || undefined,
      recipientPostal: parsedShippingAddress.postal,
      recipientCountry: parsedShippingAddress.country ? parsedShippingAddress.country.toUpperCase() : '', // Normalize country code to uppercase
      ...(() => {
        // Parse phone number and extension using same logic as UPS
        const { phone: normalizedPhone, ext: phoneExt } = parsePhoneNumberWithExt(parsedShippingAddress.phone || '');
        const finalPhone = normalizedPhone || '0000000000';
        
        // Log phone normalization for debugging
        if (parsedShippingAddress.phone && parsedShippingAddress.phone !== finalPhone) {
          logger.info(`[FEDEX PHONE] Normalized "${parsedShippingAddress.phone}" → "${finalPhone}"${phoneExt ? ` ext: ${phoneExt}` : ''}`);
        }
        
        return {
          recipientPhone: finalPhone,
          recipientPhoneExt: phoneExt, // Store extension separately for FedEx API
        };
      })(),
      recipientEmail: parsedShippingAddress.email || (orderRecord.items?.[0]?.recipientEmail) || undefined,
      isResidential: parsedShippingAddress.isResidential === true,
      
      // Shipment Details (These will be mapped to requestedShipment by createFedexShipment)
      serviceType: effectiveServiceType,
      packagingType: effectivePackagingType,
      pickupType: 'USE_SCHEDULED_PICKUP', // Changed as per suggestion
      
      // Dimensions - logic for YOUR_PACKAGING remains, but these are part of requestedShipment.requestedPackageLineItems[0]
      // The createFedexShipment service should handle placing these correctly.
      // This top-level structure is for data collection.
      packageLength: (effectivePackagingType === 'YOUR_PACKAGING' && typeof packageLength === 'number' && packageLength > 0) ? packageLength : undefined,
      packageWidth: (effectivePackagingType === 'YOUR_PACKAGING' && typeof packageWidth === 'number' && packageWidth > 0) ? packageWidth : undefined,
      packageHeight: (effectivePackagingType === 'YOUR_PACKAGING' && typeof packageHeight === 'number' && packageHeight > 0) ? packageHeight : undefined,
      dimensionUnits: (effectivePackagingType === 'YOUR_PACKAGING') ? (dimensionUnitsOverride || 'CM') : undefined,
      
      // Weight - This becomes requestedShipment.requestedPackageLineItems[0].weight
      weightKg: effectiveWeightKg, // The createFedexShipment service will map this to { units: 'KG', value: effectiveWeightKg }

      // Customs Clearance Detail
      customsClearanceDetail: {
        commercialInvoice: {
          // Usecase: generate CI if not provided by customer. But ETD is preferred.
          // For ETD, specific document content might be needed here or handled by FedEx.
        },
        dutiesPayment: {
          paymentType: shipperProfileDb.dutiesPaymentType || 'SENDER', // Matches shipperData
          // payor.responsibleParty will be set up by createFedexShipment based on shipperData/recipientData
        },
        totalCustomsValue: { amount: totalCustomsAmount, currency: effectiveCurrency },
        commodities: commodities, // Use the refactored commodities array
        isDocumentOnly: false, // Assuming not just documents
        // importerOfRecord: shipperData.importerOfRecord // TODO: Confirm if this should be here or handled by shipperData only
      },

      shippingChargesPaymentType: effectiveShippingChargesPaymentType, // Becomes requestedShipment.shippingChargesPayment
      
      labelStockType: effectiveLabelStockType, // Becomes requestedShipment.labelSpecification.labelStockType
      // Removed top-level harmonizedCode, countryOfMfg, commodityDesc, customsValue, declaredValue
      // These are now primarily handled within the commodities.
      // Top-level commodityDesc in createFedexShipment can use the first item's description as a fallback if needed.

      // ETD Setup
      ...( (sendCommercialInvoiceViaEtdOverride ?? true) && { // Default to true if not specified in request
        shipmentSpecialServices: {
          specialServiceTypes: ["ELECTRONIC_TRADE_DOCUMENTS"],
          etdDetail: { "requestedDocumentTypes": ["COMMERCIAL_INVOICE"] }
        },
        shippingDocumentSpecification: { // This section tells FedEx what docs you want (e.g., its generated CI)
          shippingDocumentTypes: ["COMMERCIAL_INVOICE"], // Request FedEx to generate CI if ETD is used.
          // commercialInvoiceDetail for providing specific data for the CI can be added here if needed.
          // For now, letting FedEx generate based on commodity data.
        }
      }),
      
      // The 'items' field here is a bit ambiguous now that we have 'commodities'.
      // It was used by orderDataForFedex: OrderRow type.
      // For createFedexShipment, the 'commodities' array is the source of truth for customs.
      // We'll keep 'items' if the OrderRow type expects it for other purposes, but ensure createFedexShipment uses 'commodities'.
      // Let's remove it from this direct payload construction for FedEx if it's redundant with `customsClearanceDetail.commodities`
      // items: orderRowItems, // OrderRowItems was the old structure. Commodities is the new.
    };

    // Clean up undefined dimension fields if not YOUR_PACKAGING
    if (orderDataForFedex.packagingType !== 'YOUR_PACKAGING') {
      delete orderDataForFedex.packageLength;
      delete orderDataForFedex.packageWidth;
      delete orderDataForFedex.packageHeight;
      delete orderDataForFedex.dimensionUnits;
    }
    
    // The `createFedexShipment` function will take `orderDataForFedex` (now `any`)
    // and `shipperData` and construct the final nested FedEx JSON payload.
    // It needs to be aware of these structural changes, especially:
    // - `customsClearanceDetail` object
    // - `commodities` array structure
    // - `shipmentSpecialServices` and `shippingDocumentSpecification` for ETD
    // - Mapping `weightKg` to the nested weight object in requestedPackageLineItems
    // - Mapping recipient and shipper details to their correct places.

    // Remove intermediate data logging
    // logger.info(`[API generate-label] Data prepared for createFedexShipment (intermediate structure):`, { payload: orderDataForFedex });

    // --- Call the unified FedEx service ---
    const fedexResult: FedexShipmentResult = await createFedexShipment(orderDataForFedex, shipperData);

    // --- Validate FedEx response before writing to DB ---
    if (!fedexResult.trackingNumber || !fedexResult.labelUrl) {
      logger.error(`[API generate-label] FedEx API returned incomplete response for order ${orderId}`, undefined, {
        hasTrackingNumber: !!fedexResult.trackingNumber,
        hasLabelUrl: !!fedexResult.labelUrl,
        alerts: fedexResult.alerts,
      });
      return res.status(502).json({ error: 'FedEx API returned incomplete response' });
    }

    // --- Create LabelJob record for each line item (tracking info, label URL, etc) ---
    // Debug: Log the item IDs we're trying to use
    logger.info(`[API generate-label] Line items from request:`, lineItemsFromRequest.map(item => ({id: item.id, title: item.title})));
    logger.info(`[API generate-label] Actual OrderItems in DB:`, actualOrderItems);

    // RACE CONDITION FIX: If no OrderItems exist, recreate them from request data
    if (actualOrderItems.length === 0 && lineItemsFromRequest.length > 0) {
      logger.warn(`[API generate-label] No OrderItems found for order ${orderId}, recreating from request data`);
      
      const createdItems = await Promise.all(
        lineItemsFromRequest.map(async (item) => {
          return prisma.orderItem.create({
            data: {
              orderId: orderId,
              productName: item.title || 'Unknown Product',
              quantity: item.quantity || 1,
              unitPrice: item.unitPrice || 0,
              totalPrice: (item.unitPrice || 0) * (item.quantity || 1),
              weightKg: item.weight || 0.5,
              harmonizedCode: item.hs_code || '',
              countryOfMfg: item.country_of_origin || 'TR',
              sku: item.sku || '',
              marketplaceKey: String(item.id),
              orderNumber: orderRecord.orderNumber || orderId,
              uniqueLineKey: String(item.id)
            }
          });
        })
      );
      
      actualOrderItems = createdItems.map(item => ({ id: item.id, productName: item.productName }));
      logger.info(`[API generate-label] Recreated ${createdItems.length} OrderItems for order ${orderId}`);
    }

    // Create labelJobs for each OrderItem
    const labelJobs = actualOrderItems.length > 0 
      ? await Promise.all(
          actualOrderItems.map(async (orderItem) => {
            return prisma.labelJob.create({
              data: {
                orderItemId: orderItem.id,
                carrier: 'FEDEX',
                status: 'created',
                pdfUrl: fedexResult.labelUrl,
                trackingNumber: fedexResult.trackingNumber,
              },
            });
          })
        )
      : [];
    
    logger.info(`[API generate-label] Created ${labelJobs.length} labelJob records for ${actualOrderItems.length} OrderItems`);

    // --- Also update the order with tracking information (similar to UPS) ---
    const orderUpdate = await prisma.order.update({
      where: { id: orderId },
      data: {
        trackingNumber: fedexResult.trackingNumber,
        labelStatus: 'created',
        shippingLabelUrl: fedexResult.labelUrl,
        shippedAt: new Date(),
      },
    });
    
    logger.info(`[API generate-label] Order updated successfully:`, {
      orderId: orderUpdate.id,
      trackingNumber: orderUpdate.trackingNumber,
      labelStatus: orderUpdate.labelStatus,
      shippingLabelUrl: orderUpdate.shippingLabelUrl ? 'SET' : 'NOT_SET'
    });

    // Increment usage counter after successful label generation
    if (res.incrementUsage) {
      await res.incrementUsage();
    }

    // Keep only essential success logging
    logger.info(`[API generate-label] Label generated successfully for order ${orderId}. Tracking: ${fedexResult.trackingNumber}`);
    return res.status(200).json({
      trackingNumber: fedexResult.trackingNumber,
      labelUrl: fedexResult.labelUrl,
      shipmentStatus: 'LABEL_GENERATED',
      shippedAt: new Date().toISOString(),
      alerts: fedexResult.alerts,
    });

  } catch (error: any) {
    logger.error(`[API generate-label] Error generating label for order ${orderId}:`, error);

    // Create failed LabelJob records for each actual OrderItem (reusing pre-fetched list)
    try {
      // RACE CONDITION FIX: If no OrderItems exist, recreate them from request data
      if (actualOrderItems.length === 0 && lineItemsFromRequest.length > 0) {
        logger.warn(`[API generate-label] No OrderItems found for failed label, recreating from request data`);

        const createdItems = await Promise.all(
          lineItemsFromRequest.map(async (item) => {
            return prisma.orderItem.create({
              data: {
                orderId: orderId,
                productName: item.title || 'Unknown Product',
                quantity: item.quantity || 1,
                unitPrice: item.unitPrice || 0,
                totalPrice: (item.unitPrice || 0) * (item.quantity || 1),
                weightKg: item.weight || 0.5,
                harmonizedCode: item.hs_code || '',
                countryOfMfg: item.country_of_origin || 'TR',
                sku: item.sku || '',
                marketplaceKey: String(item.id),
                orderNumber: orderId,
                uniqueLineKey: String(item.id)
              }
            });
          })
        );

        actualOrderItems = createdItems.map(item => ({ id: item.id, productName: item.productName }));
      }

      if (actualOrderItems.length > 0) {
        await Promise.all(
          actualOrderItems.map(async (orderItem) => {
            return prisma.labelJob.create({
              data: {
                orderItemId: orderItem.id,
                carrier: 'FEDEX',
                status: 'failed',
                errorMessage: error.message || 'Unknown error during label generation',
              },
            });
          })
        );
      }
    } catch (dbError) {
      logger.error(`[API generate-label] Failed to create error LabelJob records:`, dbError);
    }

    return res.status(500).json({
      error: error.message || 'Failed to generate label',
      details: error.details || error,
    });
  }
}

export default withUsageLimiter(handler, 'label'); 