import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import prisma from '../../../../lib/prisma';
import {
  generateFedexLabel,
  OrderRow,
  ShipperProfileData,
} from '../../../../lib/fedexService';
import { fedexOptionsData, FedExOption } from '../../../../lib/fedexConfig'; // For validation

interface ResponseData {
  trackingNumber?: string;
  labelUrl?: string;
  masterFormId?: string;
  error?: string;
  details?: any;
  shipmentStatus?: string;
  shippedAt?: string;
}

// Helper type for parsed shipping address from Order.shippingAddress JSON
interface ShippingAddress {
  firstName?: string;
  lastName?: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state?: string; // Or province
  postalCode: string;
  countryCode: string; // ISO 2-letter code
  phone?: string;
  isResidential?: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { orderId } = req.query;
  if (typeof orderId !== 'string' || !orderId) {
    return res.status(400).json({ error: 'Order ID is required.' });
  }

  const supabase = getSupabaseServerClient(req, res);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const orderRecord = await prisma.order.findUnique({
      where: { id: orderId, userId: authUser.id },
      include: {
        items: { include: { product: true } },
        // No need to include user.shipperProfile here if it's fetched separately
      },
    });

    if (!orderRecord) {
      return res.status(404).json({ error: `Order ${orderId} not found or access denied.` });
    }

    // --- Crucial: Validate that FedEx options are set on the order record --- 
    if (!orderRecord.fedexServiceType || !fedexOptionsData.serviceTypes.some(opt => opt.value === orderRecord.fedexServiceType)) {
      return res.status(400).json({ error: `Order ${orderId} has invalid or missing FedEx Service Type. Please configure via modal first.` });
    }
    if (!orderRecord.fedexPackagingType || !fedexOptionsData.packagingTypes.some(opt => opt.value === orderRecord.fedexPackagingType)) {
      return res.status(400).json({ error: `Order ${orderId} has invalid or missing FedEx Packaging Type. Please configure via modal first.` });
    }
    if (!orderRecord.fedexPickupType || !fedexOptionsData.pickupTypes.some(opt => opt.value === orderRecord.fedexPickupType)) {
      return res.status(400).json({ error: `Order ${orderId} has invalid or missing FedEx Pickup Type. Please configure via modal first.` });
    }
    // DutiesPaymentType might be optional if it can default to SENDER in some cases, but for chosen values, validate.
    if (!orderRecord.fedexDutiesPaymentType || !fedexOptionsData.dutiesPaymentTypes.some(opt => opt.value === orderRecord.fedexDutiesPaymentType)) {
      return res.status(400).json({ error: `Order ${orderId} has invalid or missing FedEx Duties Payment Type. Please configure via modal first.` });
    }
    // --- End FedEx options validation ---

    // Fetch User settings: IntegrationSettings for API keys, ShipperProfile for address/details
    const userWithSettings = await prisma.user.findUnique({
      where: { id: authUser.id },
      include: { 
        shipperProfile: true,
        integrationSettings: true 
      },
    });

    if (!userWithSettings) { // Should not happen if authUser exists, but good practice
      return res.status(404).json({ error: 'User not found.' });
    }

    if (!userWithSettings.integrationSettings) {
      return res.status(400).json({ error: 'User integration settings not found. Please configure API keys.' });
    }
    const { integrationSettings } = userWithSettings;

    if (!userWithSettings.shipperProfile) {
      return res.status(400).json({ error: 'Shipper profile not found. Please complete your shipper address and details.' });
    }
    const { shipperProfile } = userWithSettings;

    // --- Construct ShipperProfileData with strict validation ---
    // FedEx Core Credentials from UserIntegrationSettings
    if (!integrationSettings.fedexApiKey) {
      return res.status(400).json({ error: 'FedEx API Key missing in user integration settings.' });
    }
    if (!integrationSettings.fedexApiSecret) {
      return res.status(400).json({ error: 'FedEx API Secret missing in user integration settings.' });
    }
    if (!integrationSettings.fedexAccountNumber) {
      return res.status(400).json({ error: 'FedEx Account Number missing in user integration settings.' });
    }

    // Shipper Details from ShipperProfile (validate required ones)
    // fedexService.ts already validates these, but good to be explicit for critical ones
    if (!shipperProfile.shipperName) {
      return res.status(400).json({ error: 'Shipper Name missing in shipper profile.' });
    }
    if (!shipperProfile.shipperPersonName) {
      return res.status(400).json({ error: 'Shipper Person Name missing in shipper profile.' });
    }
    if (!shipperProfile.shipperPhoneNumber) {
      return res.status(400).json({ error: 'Shipper Phone Number missing in shipper profile.' });
    }
    if (!shipperProfile.shipperStreet1) {
      return res.status(400).json({ error: 'Shipper Street1 missing in shipper profile.' });
    }
    if (!shipperProfile.shipperCity) {
      return res.status(400).json({ error: 'Shipper City missing in shipper profile.' });
    }
    // shipperStateCode can be optional for some countries, fedexService handles this
    if (!shipperProfile.shipperPostalCode) {
      return res.status(400).json({ error: 'Shipper Postal Code missing in shipper profile.' });
    }
    if (!shipperProfile.shipperCountryCode) {
      return res.status(400).json({ error: 'Shipper Country Code missing in shipper profile.' });
    }
    if (!shipperProfile.shipperTinNumber) {
      return res.status(400).json({ error: 'Shipper TIN Number missing in shipper profile.' });
    }
    // Shipper TIN Type is validated in fedexService, ensure it's present
    if (!shipperProfile.shipperTinType) {
        return res.status(400).json({ error: 'Shipper TIN Type missing in shipper profile.' });
    }
    if (!orderRecord.fedexDutiesPaymentType) { // This comes from the order itself, pre-validated
        return res.status(400).json({ error: 'Duties Payment Type missing on the order.' });
    }
     if (!shipperProfile.defaultCurrencyCode) {
        return res.status(400).json({ error: 'Default Currency Code missing in shipper profile.' });
    }
    // fedexFolderId is not directly used by generateFedexLabel but by other parts (e.g. storage)
    // For importerOfRecord, it's optional in the service.

    const shipperData: ShipperProfileData = {
      fedexApiKey: integrationSettings.fedexApiKey,
      fedexApiSecret: integrationSettings.fedexApiSecret,
      fedexAccountNumber: integrationSettings.fedexAccountNumber,
      shipperName: shipperProfile.shipperName,
      shipperPersonName: shipperProfile.shipperPersonName,
      shipperPhoneNumber: shipperProfile.shipperPhoneNumber,
      shipperStreet1: shipperProfile.shipperStreet1,
      shipperStreet2: shipperProfile.shipperStreet2, // Optional
      shipperCity: shipperProfile.shipperCity,
      shipperStateCode: shipperProfile.shipperStateCode || '', // Optional in some cases, service handles
      shipperPostalCode: shipperProfile.shipperPostalCode,
      shipperCountryCode: shipperProfile.shipperCountryCode,
      shipperTinNumber: shipperProfile.shipperTinNumber,
      shipperTinType: shipperProfile.shipperTinType, 
      dutiesPaymentType: orderRecord.fedexDutiesPaymentType, // From order, validated
      defaultCurrencyCode: shipperProfile.defaultCurrencyCode,
      importerOfRecord: shipperProfile.importerOfRecord, // Optional
    };
    // Redundant check as we validated above, but keeping for belt-and-suspenders from original code.
    // if (!shipperData.fedexApiKey || !shipperData.fedexApiSecret || !shipperData.fedexAccountNumber) {
    //   return res.status(400).json({ error: 'FedEx API Key, Secret, or Account Number missing in settings.' });
    // }

    // --- Map Prisma Order to OrderRow ---
    let recipientFname = '';
    let recipientLname = '';
    if (orderRecord.customerName) {
      const nameParts = orderRecord.customerName.trim().split(/\s+/);
      recipientFname = nameParts[0] || '';
      recipientLname = nameParts.slice(1).join(' ') || recipientFname;
    }
    let parsedShippingAddress: any = null; // Use 'any' or define proper ShippingAddress type
    if (orderRecord.shippingAddress && typeof orderRecord.shippingAddress === 'object') {
        parsedShippingAddress = orderRecord.shippingAddress;
    } else if (typeof orderRecord.shippingAddress === 'string') {
        try { parsedShippingAddress = JSON.parse(orderRecord.shippingAddress); } catch (e) { /* handle error */ }
    }
    if (!parsedShippingAddress?.street1 || !parsedShippingAddress?.city || !parsedShippingAddress?.postalCode || !parsedShippingAddress?.countryCode) {
        return res.status(400).json({ error: `Order ${orderId} missing required shipping address components.` });
    }
    recipientFname = parsedShippingAddress.firstName || recipientFname || 'Recipient';
    recipientLname = parsedShippingAddress.lastName || recipientLname || 'Name';
    const recipientPhoneForOrder = parsedShippingAddress.phone || orderRecord.customerName;
     if (!recipientPhoneForOrder || String(recipientPhoneForOrder).trim() === '') {
          return res.status(400).json({ error: `Order ${orderId} missing recipient phone number.`});
      }

    let totalOrderWeightKg = 0;
    let itemsProcessedForWeight = 0;
    if (orderRecord.items && orderRecord.items.length > 0) {
      for (const item of orderRecord.items) {
        if (item.product && typeof item.product.weight === 'number' && item.product.weight > 0) {
          totalOrderWeightKg += (item.product.weight * item.quantity);
          itemsProcessedForWeight++;
        }
      }
    }
    if (itemsProcessedForWeight === 0 && orderRecord.items && orderRecord.items.length > 0) {
        return res.status(400).json({ error: `Order ${orderId} missing product weight for all items.` });
    }
    if (totalOrderWeightKg <= 0 && orderRecord.items && orderRecord.items.length > 0) {
         return res.status(400).json({ error: `Order ${orderId} calculated total weight is ${totalOrderWeightKg}kg. Must be positive.`});
    }
    if (!orderRecord.items || orderRecord.items.length === 0) {
      return res.status(400).json({ error: `Order ${orderId} has no items.` });
    }

    const primaryCommodityDesc = 
      orderRecord.commodityDesc || 
      orderRecord.items[0]?.productName || 
      `Item from ${orderRecord.id}`;
    const countryOfMfgFromOrderOrProduct = 
      orderRecord.countryOfMfg || 
      orderRecord.items[0]?.product?.countryOfMfg;
    const harmonizedCodeFromOrderOrProduct = 
      orderRecord.harmonizedCode || 
      orderRecord.items[0]?.product?.harmonizedCode;

    const orderRowForFedex: OrderRow = {
      orderId: orderRecord.id,
      recipientFname,
      recipientLname,
      recipientCompany: parsedShippingAddress.company,
      recipientStreet1: parsedShippingAddress.street1,
      recipientStreet2: parsedShippingAddress.street2,
      recipientCity: parsedShippingAddress.city,
      recipientState: parsedShippingAddress.state,
      recipientPostal: parsedShippingAddress.postalCode,
      recipientCountry: parsedShippingAddress.countryCode,
      recipientPhone: recipientPhoneForOrder,
      weightKg: totalOrderWeightKg,
      
      // --- Use validated, order-specific FedEx options --- 
      serviceType: orderRecord.fedexServiceType,       // Already validated above
      packagingType: orderRecord.fedexPackagingType,   // Already validated above
      pickupType: orderRecord.fedexPickupType,         // Already validated above
      // dutiesPaymentType is handled by ShipperProfileData above for the FedEx payload structure

      customsValue: orderRecord.totalPrice ? parseFloat(orderRecord.totalPrice.toString()) : 0,
      commodityDesc: primaryCommodityDesc,
      countryOfMfg: countryOfMfgFromOrderOrProduct || '',
      harmonizedCode: harmonizedCodeFromOrderOrProduct || '',
      currency: orderRecord.currency || shipperData.defaultCurrencyCode,
      isRecipientResidential: parsedShippingAddress.isResidential || false,
      shippingChargesPaymentType: orderRecord.shippingChargesPaymentType || 'SENDER',
      packageLength: orderRecord.packageLength ?? undefined,
      packageWidth: orderRecord.packageWidth ?? undefined,
      packageHeight: orderRecord.packageHeight ?? undefined,
      dimensionUnits: orderRecord.dimensionUnits ?? undefined,
      labelStockType: orderRecord.labelStockType || 'PAPER_4X6',
      signatureType: orderRecord.signatureType ?? undefined,
      sendCommercialInvoiceViaEtd: orderRecord.sendCommercialInvoiceViaEtd === null || orderRecord.sendCommercialInvoiceViaEtd === undefined ? true : orderRecord.sendCommercialInvoiceViaEtd,
      termsOfSale: orderRecord.termsOfSale ?? undefined,
    };
    
    // Further validation, especially for international fields not covered by the modal directly
    const isInternational = shipperData.shipperCountryCode?.toUpperCase() !== orderRowForFedex.recipientCountry?.toUpperCase();
    if (isInternational) {
        if (!orderRowForFedex.customsValue && orderRowForFedex.customsValue !== 0) return res.status(400).json({ error: `Order ${orderId} missing customs value for international shipment.`});
        if (!orderRowForFedex.commodityDesc) return res.status(400).json({ error: `Order ${orderId} missing commodity description for international shipment.`});
        if (!orderRowForFedex.countryOfMfg) return res.status(400).json({ error: `Order ${orderId} missing country of manufacture for international shipment (from product).`});
        if (!orderRowForFedex.harmonizedCode) return res.status(400).json({ error: `Order ${orderId} missing harmonized code for international shipment (from product).`});
        if (!orderRowForFedex.currency) return res.status(400).json({ error: `Order ${orderId} missing currency for international shipment.`});
    } else {
        if (orderRowForFedex.customsValue === null || typeof orderRowForFedex.customsValue !== 'number') {
            return res.status(400).json({ error: `Order ${orderId} missing customs value (must be a number, can be 0 for domestic).`});
        }
        if (!orderRowForFedex.currency) return res.status(400).json({ error: `Order ${orderId} missing currency.`});
    }
    

    const result = await generateFedexLabel(orderRowForFedex, shipperData);

    const now = new Date();
    // Save tracking number and label URL to the Order model
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        trackingNumber: result.trackingNumber,
        shippingLabelUrl: result.labelUrl,
        fedexMasterFormId: result.masterFormId,
        shipmentStatus: 'LABEL_GENERATED',
        shippedAt: now,
      },
      select: { // Select the updated audit fields for the response
        trackingNumber: true,
        shippingLabelUrl: true,
        fedexMasterFormId: true,
        shipmentStatus: true,
        shippedAt: true,
      }
    });

    return res.status(200).json({ 
      trackingNumber: updatedOrder.trackingNumber,
      labelUrl: updatedOrder.shippingLabelUrl,
      masterFormId: updatedOrder.fedexMasterFormId,
      shipmentStatus: updatedOrder.shipmentStatus, // Include updated audit field
      shippedAt: updatedOrder.shippedAt?.toISOString() // Include updated audit field
    });

  } catch (error: any) {
    console.error(`[API /orders/${orderId}/generateFedexLabel] Error:`, error.message, error.stack);
    let statusCode = 500;
    const message = error.message || 'Failed to generate FedEx label.';
    // Check for specific validation errors first
    if (message.startsWith(`Order ${orderId} has invalid or missing FedEx`) ||
        message.startsWith(`Order ${orderId} missing required field`) || 
        message.startsWith(`Order ${orderId} missing product weight`) || 
        message.startsWith(`Order ${orderId} calculated total weight`) ||
        message.startsWith(`Order ${orderId} has no items`) ||
        message.includes('validation failed') || // from fedexService
        message.includes('ShipperProfileData missing') || 
        message.includes('Configuration Error') ||
        message.includes('Invalid shippingAddress format') ||
        message.includes('Shipping address is missing') ||
        message.includes('FedEx API Key, Secret, or Account Number missing')) {
      statusCode = 400;
    } else if (message.startsWith('FedEx Ship API Error') || message.startsWith('FedEx Ship API Exception') || message.startsWith('FedEx OAuth failed') || message.startsWith('FedEx OAuth exception')) {
      statusCode = error.message.includes("validation failed") ? 400 : 502; 
    }
    
    return res.status(statusCode).json({ 
        error: message, 
        details: (statusCode === 400 || statusCode === 502) ? (error.response?.data?.errors || error.message) : error.stack 
    });
  }
} 