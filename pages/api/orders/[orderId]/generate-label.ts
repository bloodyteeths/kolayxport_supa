import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import prisma from '../../../../lib/prisma';
import { createFedexShipment } from '../../../../lib/fedex/fedex.service';
import { OrderRow, ShipperProfileData, FedexShipmentResult, OrderRowItem } from '../../../../lib/fedex/fedex.types';
import { fedexOptionsData } from '../../../../lib/fedex/fedex.config';
import { logger } from '../../../../lib/logger';

interface ResponseData extends Partial<FedexShipmentResult> {
  error?: string;
  details?: any;
  shipmentStatus?: string;
  shippedAt?: string;
}

interface ShippingAddressParsed {
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientCompany?: string;
  recipientStreet1: string;
  recipientStreet2?: string;
  recipientCity: string;
  recipientState?: string;
  recipientPostal: string;
  recipientCountry: string;
  recipientPhone?: string;
  recipientEmail?: string;
  isResidential?: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  logger.info(`[API generate-label] Received request for orderId: ${req.query.orderId}`, { body: req.body });

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

  // --- Get Overrides from Request Body (sent from LabelsPage drawer if any quick edits) ---
  const {
    serviceType: serviceTypeOverride,
    packagingType: packagingTypeOverride,
    weightKg: weightKgOverride,
  } = req.body;

  try {
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

    // --- Construct ShipperProfileData ---
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
      dutiesPaymentType: orderRecord.fedexDutiesPaymentType || shipperProfileDb.dutiesPaymentType || 'SENDER',
      defaultCurrencyCode: shipperProfileDb.defaultCurrencyCode || 'USD',
      importerOfRecord: shipperProfileDb.importerOfRecord || undefined,
    };

    // --- Parse Shipping Address from Order ---
    let parsedShippingAddress: ShippingAddressParsed;
    if (orderRecord.shippingAddress && typeof orderRecord.shippingAddress === 'object') {
        parsedShippingAddress = orderRecord.shippingAddress as ShippingAddressParsed;
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
     if (!parsedShippingAddress.recipientStreet1 || !parsedShippingAddress.recipientCity || !parsedShippingAddress.recipientPostal || !parsedShippingAddress.recipientCountry) {
         return res.status(400).json({ error: 'Shipping address is incomplete (street, city, postal, country required).' });
     }

    // --- Determine Effective Values (Overrides > Order DB > Shipper Profile Default > Hardcoded Default) ---
    const effectiveWeightKg =
      (typeof weightKgOverride === 'number' && weightKgOverride > 0) ? weightKgOverride :
      (orderRecord.weightKg && orderRecord.weightKg > 0) ? orderRecord.weightKg :
      (shipperProfileDb.defaultWeightKg && shipperProfileDb.defaultWeightKg > 0) ? shipperProfileDb.defaultWeightKg :
      0.5;

    const effectiveServiceType =
      serviceTypeOverride ||
      orderRecord.fedexServiceType ||
      shipperProfileDb.defaultServiceType ||
      fedexOptionsData.serviceTypes[0].value;

    const effectivePackagingType =
      packagingTypeOverride ||
      orderRecord.fedexPackagingType ||
      shipperProfileDb.defaultPackagingType ||
      fedexOptionsData.packagingTypes.find(p => p.value === 'YOUR_PACKAGING')?.value ||
      fedexOptionsData.packagingTypes[0].value;

    const effectivePickupType =
      orderRecord.fedexPickupType ||
      shipperProfileDb.defaultPickupType ||
      'DROPOFF_AT_FEDEX_LOCATION';

    const effectiveLabelStockType =
      orderRecord.labelStockType ||
      shipperProfileDb.defaultLabelStockType ||
      'PAPER_4X6';

    const effectiveCurrency = orderRecord.currency || shipperProfileDb.defaultCurrencyCode || 'USD';

    const effectiveShippingChargesPaymentType =
      shipperProfileDb.defaultShippingChargesPaymentType &&
      fedexOptionsData.shippingChargesPaymentTypes.some(opt => opt.value === shipperProfileDb.defaultShippingChargesPaymentType)
        ? shipperProfileDb.defaultShippingChargesPaymentType
        : 'SENDER';

    // --- Prepare OrderRowItems for ETD ---
    const etdDefaults = shipperProfileDb ? {
      weightKg: shipperProfileDb.defaultWeightKg || 0.5,
      harmonizedCode: shipperProfileDb.defaultHarmonizedCode || '610910',
      countryOfMfg: shipperProfileDb.defaultCountryOfMfg || 'TR',
    } : { weightKg: 0.5, harmonizedCode: '610910', countryOfMfg: 'TR' };
    const orderRowItems: OrderRowItem[] = orderRecord.items.map(item => ({
      description: item.productName || 'Product',
      quantity: item.quantity || 1,
      unitPrice: item.unitPrice || 1,
      weightKg: item.weightKg || etdDefaults.weightKg,
      countryOfMfg: item.countryOfMfg || etdDefaults.countryOfMfg,
      harmonizedCode: item.harmonizedCode || etdDefaults.harmonizedCode,
    }));

    if (orderRowItems.length === 0 && shipperData.shipperCountryCode.toUpperCase() !== parsedShippingAddress.recipientCountry.toUpperCase()) {
        orderRowItems.push({
            description: orderRecord.commodityDesc || 'General Goods',
            quantity: 1,
            unitPrice: parseFloat(String(orderRecord.totalPrice)) || 0,
            totalPrice: parseFloat(String(orderRecord.totalPrice)) || 0,
            weightKg: effectiveWeightKg,
            harmonizedCode: orderRecord.harmonizedCode || shipperProfileDb.defaultHarmonizedCode || '000000',
            countryOfMfg: orderRecord.countryOfMfg || shipperProfileDb.defaultCountryOfMfg || 'CN',
        });
    }

    // --- Construct OrderRow ---
    const orderDataForFedex: OrderRow = {
      orderId: orderRecord.id,
      orderNumber: orderRecord.orderNumber || orderRecord.id,
      recipientFname: parsedShippingAddress.recipientFirstName || orderRecord.customerName?.split(' ')[0] || 'N/A',
      recipientLname: parsedShippingAddress.recipientLastName || orderRecord.customerName?.split(' ').slice(1).join(' ') || 'N/A',
      recipientCompany: parsedShippingAddress.recipientCompany || undefined,
      recipientStreet1: parsedShippingAddress.recipientStreet1,
      recipientStreet2: parsedShippingAddress.recipientStreet2 || undefined,
      recipientCity: parsedShippingAddress.recipientCity,
      recipientState: parsedShippingAddress.recipientState || undefined,
      recipientPostal: parsedShippingAddress.recipientPostal,
      recipientCountry: parsedShippingAddress.recipientCountry,
      recipientPhone: parsedShippingAddress.recipientPhone || '0000000000',
      recipientEmail: parsedShippingAddress.recipientEmail || undefined,
      isResidential: parsedShippingAddress.isResidential === true,
      weightKg: effectiveWeightKg,
      serviceType: effectiveServiceType,
      packagingType: effectivePackagingType,
      pickupType: effectivePickupType,
      customsValue: parseFloat(String(orderRecord.totalPrice)) || 0,
      currency: effectiveCurrency,
      shippingChargesPaymentType: effectiveShippingChargesPaymentType,
      commodityDesc: orderRecord.commodityDesc || orderRowItems[0]?.description || 'Goods',
      countryOfMfg: orderRecord.countryOfMfg || orderRowItems[0]?.countryOfMfg || shipperProfileDb.defaultCountryOfMfg || 'CN',
      harmonizedCode: orderRecord.harmonizedCode || orderRowItems[0]?.harmonizedCode || shipperProfileDb.defaultHarmonizedCode || '000000',
      declaredValue: parseFloat(String(orderRecord.totalPrice)) || undefined,
      packageLength: orderRecord.packageLength || undefined,
      packageWidth: orderRecord.packageWidth || undefined,
      packageHeight: orderRecord.packageHeight || undefined,
      dimensionUnits: orderRecord.dimensionUnits as 'CM' | 'IN' || undefined,
      labelStockType: effectiveLabelStockType,
      signatureType: orderRecord.signatureType || undefined,
      sendCommercialInvoiceViaEtd: orderRecord.sendCommercialInvoiceViaEtd === undefined ? true : orderRecord.sendCommercialInvoiceViaEtd,
      termsOfSale: orderRecord.termsOfSale || shipperProfileDb.defaultTermsOfSale || 'DDU',
      items: orderRowItems,
    };

    logger.info(`[API generate-label] FedEx request payload for ETD debug:`, { payload: orderDataForFedex });

    // --- Call the unified FedEx service ---
    const fedexResult: FedexShipmentResult = await createFedexShipment(orderDataForFedex, shipperData);

    // --- Update order with tracking info on success ---
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        trackingNumber: fedexResult.trackingNumber,
        shippingLabelUrl: fedexResult.labelUrl,
        shipmentStatus: 'LABEL_GENERATED',
        shippedAt: new Date(),
        fedexServiceType: effectiveServiceType,
        fedexPackagingType: effectivePackagingType,
        weightKg: effectiveWeightKg,
      },
    });

    logger.info(`[API generate-label] Label generated successfully for order ${orderId}. Tracking: ${fedexResult.trackingNumber}`);
    return res.status(200).json({
      trackingNumber: updatedOrder.trackingNumber || undefined,
      labelUrl: updatedOrder.shippingLabelUrl || undefined,
      shipmentStatus: updatedOrder.shipmentStatus || undefined,
      shippedAt: updatedOrder.shippedAt?.toISOString() || undefined,
      alerts: fedexResult.alerts,
    });

  } catch (error: any) {
    logger.error(`[API generate-label] Error generating label for order ${orderId}:`, new Error(JSON.stringify({ message: error.message, stack: error.stack, details: error.responseErrors })));
    let statusCode = 500;
    const message = error.message || 'Failed to generate FedEx label.';

    if (message.includes('validation failed') ||
        message.includes('Invalid') ||
        message.includes('Missing') ||
        message.includes('not found') ||
        message.includes('incomplete')) {
      statusCode = 400;
    } else if (message.startsWith('FedEx')) {
      statusCode = 502;
    }

    return res.status(statusCode).json({
        error: message,
        details: error.responseErrors || error.stack?.substring(0, 500)
    });
  }
} 