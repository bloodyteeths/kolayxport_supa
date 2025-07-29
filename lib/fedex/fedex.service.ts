// @ts-ignore
import axios from 'axios';
import { fedexOptionsData } from './fedex.config';
import {
  OrderRow,
  ShipperProfileData,
  FedexShipmentResult,
  ImporterOfRecordPayload,
  OrderRowItem
} from './fedex.types';
import { logger } from '../logger';
import { retrieveAsyncShipment, extractShipmentDetails, FedexShipResponse, FedexAsyncError } from './fedex.async';

const DEFAULT_PHONE_NUMBER_TS   = '0000000000';
const DEFAULT_TERMS_OF_SALE_TS  = 'DDU';

interface FedExAuthToken {
  accessToken: string;
  expiresAt: number;
}
let fedExTokenCache: FedExAuthToken | null = null;

async function getFedExOAuthToken(
    shipperConfig: Pick<ShipperProfileData, 'fedexApiKey' | 'fedexApiSecret'>
): Promise<string> {
  if (fedExTokenCache && fedExTokenCache.expiresAt > Date.now()) {
    return fedExTokenCache.accessToken;
  }

  const tokenUrl = 'https://apis.fedex.com/oauth/token';
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', shipperConfig.fedexApiKey);
  params.append('client_secret', shipperConfig.fedexApiSecret);

  try {
    const response = await axios.post(tokenUrl, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (response.status === 200 && response.data.access_token) {
      const expiresIn = response.data.expires_in || 3600;
      fedExTokenCache = {
        accessToken: response.data.access_token,
        expiresAt: Date.now() + (expiresIn - 300) * 1000,
      };
      logger.info('[FedEx Service] OAuth token obtained/refreshed.');
      return fedExTokenCache.accessToken;
    } else {
      logger.error('[FedEx Service] FedEx OAuth Error Response:', new Error(JSON.stringify(response.data)));
      throw new Error(`FedEx OAuth failed: ${response.data?.errors?.[0]?.message || 'Unknown OAuth error'}`);
    }
  } catch (error: any) {
    const errorData = error.response?.data;
    logger.error('[FedEx Service] FedEx OAuth Exception:', new Error(JSON.stringify({ errorData, message: error.message })));
    throw new Error(`FedEx OAuth exception: ${errorData?.errors?.[0]?.message || error.message}`);
  }
}

// Allowed labelStockType values when imageType is PDF or PNG (per FedEx Ship v1)
const ALLOWED_LABEL_STOCK_TYPES = [
  'PAPER_4X6',
  'PAPER_4X8',
  'PAPER_4X9',
  'PAPER_4X675',
  'PAPER_85X11_BOTTOM_HALF_LABEL',
  'PAPER_85X11_TOP_HALF_LABEL',
  'PAPER_LETTER',
] as const;

type FedexLabelStockType = typeof ALLOWED_LABEL_STOCK_TYPES[number];

const STOCK_FOR_LABEL: Record<string, FedexLabelStockType> = {
  FEDEX_PAK:              'PAPER_4X6',
  FEDEX_ENVELOPE:         'PAPER_4X6',
  FEDEX_BOX:              'PAPER_4X6',
  FEDEX_SMALL_BOX:        'PAPER_4X6',
  FEDEX_MEDIUM_BOX:       'PAPER_4X6',
  FEDEX_LARGE_BOX:        'PAPER_4X6',
  FEDEX_EXTRA_LARGE_BOX:  'PAPER_4X6',
  FEDEX_TUBE:             'PAPER_4X6',
  YOUR_PACKAGING:         'PAPER_LETTER',
};

export async function createFedexShipment(
  orderData: any,
  shipper: ShipperProfileData
): Promise<FedexShipmentResult> {
  logger.info(`[FedEx Service] createFedexShipment called for orderId: ${orderData.orderId}`, { orderNumber: orderData.orderNumber });

  // --- Rigorous validation for ShipperProfileData ---
  const requiredShipperProps: (keyof Omit<ShipperProfileData, 'shipperStreet2' | 'importerOfRecord'>)[] = [
    'fedexApiKey', 'fedexApiSecret', 'fedexAccountNumber', 'shipperName',
    'shipperPersonName', 'shipperPhoneNumber', 'shipperStreet1', 'shipperCity', 'shipperStateCode',
    'shipperPostalCode', 'shipperCountryCode', 'shipperTinNumber', 'shipperTinType',
    'dutiesPaymentType', 'defaultCurrencyCode'
  ];
  for (const prop of requiredShipperProps) {
    if (!shipper[prop]) {
      logger.error(`[FedEx Service] ShipperProfileData validation failed: Missing ${prop}`, new Error(`Order ${orderData.orderId}`));
      throw new Error(`ShipperProfileData validation failed: Missing required property: ${prop}`);
    }
  }
  if (!fedexOptionsData.tinTypes.some(opt => opt.value === shipper.shipperTinType.toUpperCase())) {
      logger.error(`[FedEx Service] Invalid ShipperProfile.shipperTinType: ${shipper.shipperTinType}`, new Error(`Order ${orderData.orderId}`));
      throw new Error(`Configuration Error: Invalid ShipperProfile.shipperTinType: '${shipper.shipperTinType}'`);
  }

  // --- Rigorous validation for OrderData fields (adapted for new structure) ---
  const validationErrors: string[] = [];
  if (!orderData.orderId) validationErrors.push("Internal Order ID (orderData.orderId) missing");

  const recipientFullName = `${orderData.recipientFname || ''} ${orderData.recipientLname || ''}`.trim();
  if (!recipientFullName) validationErrors.push("Recipient Name (fname/lname) missing or empty");
  if (!orderData.recipientStreet1) validationErrors.push("Recipient Street 1 missing or empty");
  if (!orderData.recipientCity) validationErrors.push("Recipient City missing or empty");
  if (!orderData.recipientPostal) validationErrors.push("Recipient Postal Code missing or empty");
  if (!orderData.recipientCountry) validationErrors.push("Recipient Country Code missing or empty");
  
  // Normalize country codes to uppercase
  if (orderData.recipientCountry) {
    orderData.recipientCountry = orderData.recipientCountry.toUpperCase();
  }

  // Phone is already normalized in generate-label.ts, so we just use it directly
  const recipientPhoneCleaned = String(orderData.recipientPhone || '');
  if (!recipientPhoneCleaned || recipientPhoneCleaned === '0000000000') {
      validationErrors.push("Recipient Phone missing or invalid");
  }
  
  // Extension is also parsed in generate-label.ts
  const recipientPhoneExt = orderData.recipientPhoneExt;

  if (typeof orderData.weightKg !== 'number' || orderData.weightKg <= 0) validationErrors.push("Top-level weightKg (for package) must be a positive number");
  if (!orderData.serviceType || !fedexOptionsData.serviceTypes.some(o => o.value === orderData.serviceType)) validationErrors.push("serviceType is required and must be valid");
  if (!orderData.packagingType || !fedexOptionsData.packagingTypes.some(o => o.value === orderData.packagingType)) validationErrors.push("packagingType is required and must be valid");
  if (!orderData.pickupType || !fedexOptionsData.pickupTypes.some(o => o.value === orderData.pickupType)) validationErrors.push("pickupType is required and must be valid");
  if (!orderData.shippingChargesPaymentType || !fedexOptionsData.shippingChargesPaymentTypes.some(o => o.value === orderData.shippingChargesPaymentType)) validationErrors.push("shippingChargesPaymentType is required and must be valid");
  if (!orderData.labelStockType || !fedexOptionsData.labelStockTypes.some(o => o.value === orderData.labelStockType)) validationErrors.push("labelStockType is required and must be valid");

  // Normalize shipper country code too
  const shipperCountryNormalized = shipper.shipperCountryCode.toUpperCase();
  const isShipmentInternational = shipperCountryNormalized !== orderData.recipientCountry;

  if (isShipmentInternational) {
    if (!orderData.customsClearanceDetail || typeof orderData.customsClearanceDetail !== 'object') {
        validationErrors.push("customsClearanceDetail object is required for international shipments.");
    } else {
        const ccd = orderData.customsClearanceDetail;
        if (!ccd.totalCustomsValue || typeof ccd.totalCustomsValue.amount !== 'number' || ccd.totalCustomsValue.amount < 0) {
            validationErrors.push("customsClearanceDetail.totalCustomsValue.amount must be a number >= 0.");
        }
        if (!ccd.totalCustomsValue.currency || !fedexOptionsData.currencyCodes.some(c => c.value === ccd.totalCustomsValue.currency)) {
            validationErrors.push("customsClearanceDetail.totalCustomsValue.currency is required and must be valid.");
        }
        if (!ccd.commodities || !Array.isArray(ccd.commodities) || ccd.commodities.length === 0) {
            validationErrors.push("customsClearanceDetail.commodities array is required and must not be empty.");
        } else {
            // Calculate total customs value from commodities
            let calculatedTotalCustomsValue = 0;
            
            ccd.commodities.forEach((item: any, index: number) => {
                if (!item.description || String(item.description).trim() === '') validationErrors.push(`Commodity ${index+1}: description is required`);
                if (typeof item.quantity !== 'number' || item.quantity <= 0) validationErrors.push(`Commodity ${index+1}: quantity must be a positive number`);
                if (!item.quantityUnits || item.quantityUnits !== 'EA') validationErrors.push(`Commodity ${index+1}: quantityUnits must be 'EA'`);
                if (!item.unitPrice || typeof item.unitPrice.amount !== 'number' || item.unitPrice.amount < 0) validationErrors.push(`Commodity ${index+1}: unitPrice.amount must be a number >= 0`);
                if (!item.unitPrice.currency) validationErrors.push(`Commodity ${index+1}: unitPrice.currency is required`);
                
                // Auto-set customsValue based on unitPrice * quantity (like UPS)
                if (item.unitPrice && typeof item.unitPrice.amount === 'number' && typeof item.quantity === 'number') {
                    const itemCustomsValue = item.unitPrice.amount * item.quantity;
                    item.customsValue = {
                        amount: parseFloat(itemCustomsValue.toFixed(2)),
                        currency: item.unitPrice.currency
                    };
                    calculatedTotalCustomsValue += itemCustomsValue;
                }
                
                if (!item.customsValue || typeof item.customsValue.amount !== 'number' || item.customsValue.amount < 0) validationErrors.push(`Commodity ${index+1}: customsValue.amount must be a number >= 0`);
                if (!item.customsValue.currency) validationErrors.push(`Commodity ${index+1}: customsValue.currency is required`);
                if (!item.weight || typeof item.weight.value !== 'number' || item.weight.value <= 0) validationErrors.push(`Commodity ${index+1}: weight.value must be a positive number`);
                if (!item.weight.units || item.weight.units !== 'KG') validationErrors.push(`Commodity ${index+1}: weight.units must be 'KG'`);
                if (!item.countryOfManufacture || String(item.countryOfManufacture).trim() === '') validationErrors.push(`Commodity ${index+1}: countryOfManufacture is required`);
                
                // Normalize country of manufacture to uppercase
                if (item.countryOfManufacture) {
                    item.countryOfManufacture = item.countryOfManufacture.toUpperCase();
                }
            });
            
            // Auto-adjust total customs value to match sum of commodities (like UPS)
            if (calculatedTotalCustomsValue > 0) {
                const declaredTotal = ccd.totalCustomsValue?.amount || 0;
                const totalDifference = Math.abs(calculatedTotalCustomsValue - declaredTotal);
                
                // If difference is significant (more than 1 cent), use calculated value
                if (totalDifference > 0.01) {
                    logger.warn(`[FedEx Service] Total customs value mismatch for order ${orderData.orderId}. Declared: ${declaredTotal}, Calculated: ${calculatedTotalCustomsValue}. Using calculated value.`);
                    ccd.totalCustomsValue.amount = parseFloat(calculatedTotalCustomsValue.toFixed(2));
                }
            }
        }
    }
  } else { // Domestic (customsClearanceDetail might not be strictly needed by FedEx but good to have basic structure if sent)
    if (orderData.customsClearanceDetail?.totalCustomsValue?.currency && 
        !fedexOptionsData.currencyCodes.some(c => c.value === orderData.customsClearanceDetail.totalCustomsValue.currency)) {
      validationErrors.push("Domestic: If customsClearanceDetail.totalCustomsValue.currency is provided, it must be valid.");
    }
  }

  if (validationErrors.length > 0) {
    const errorString = `Order data validation failed for orderId ${orderData.orderId}: ${validationErrors.join('; ')}.`;
    logger.error(`[FedEx Service] ${errorString}`);
    throw new Error(errorString);
  }

  const shipperPhoneCleaned = String(shipper.shipperPhoneNumber).replace(/\D/g, '') || DEFAULT_PHONE_NUMBER_TS;
  const accessToken = await getFedExOAuthToken(shipper);
  const shipDate = new Date().toISOString().split('T')[0];

  let dimensionsPayload: any = null;
  if (
    orderData.packagingType === 'YOUR_PACKAGING' &&
    orderData.packageLength && orderData.packageLength > 0 &&
    orderData.packageWidth && orderData.packageWidth > 0 &&
    orderData.packageHeight && orderData.packageHeight > 0 &&
    orderData.dimensionUnits && (orderData.dimensionUnits === 'CM' || orderData.dimensionUnits === 'IN')
  ) {
    dimensionsPayload = {
      length: Math.round(orderData.packageLength),
      width: Math.round(orderData.packageWidth),
      height: Math.round(orderData.packageHeight),
      units: orderData.dimensionUnits,
    };
  }

  let signatureOptionDetailPayload: any = null;
  if (orderData.signatureType && orderData.signatureType !== 'NO_SIGNATURE_REQUIRED' && orderData.signatureType !== 'SERVICE_DEFAULT') {
    if (fedexOptionsData.signatureTypes.some(s => s.value === orderData.signatureType)) {
     signatureOptionDetailPayload = { optionType: orderData.signatureType };
    } else {
     logger.warn(`[FedEx Service] Invalid signatureType '${orderData.signatureType}' provided for order ${orderData.orderId}. Ignoring.`);
    }
  }

  const effectivePackagingType = orderData.packagingType;
  let labelStockType: FedexLabelStockType = STOCK_FOR_LABEL[effectivePackagingType] ?? 'PAPER_4X6';
  // If the user provided a labelStockType and it's allowed, use it for YOUR_PACKAGING
  if (
    effectivePackagingType === 'YOUR_PACKAGING' &&
    orderData.labelStockType &&
    ALLOWED_LABEL_STOCK_TYPES.includes(orderData.labelStockType as FedexLabelStockType)
  ) {
    labelStockType = orderData.labelStockType as FedexLabelStockType;
  }
  // Always validate the final labelStockType
  if (!ALLOWED_LABEL_STOCK_TYPES.includes(labelStockType)) {
    labelStockType = 'PAPER_4X6'; // safest fallback
  }

  const requestPayload: any = {
    labelResponseOptions: "URL_ONLY",
    requestedShipment: {
      shipDatestamp: shipDate,
      serviceType: orderData.serviceType,
      packagingType: orderData.packagingType,
      pickupType: orderData.pickupType,
      shipper: {
        contact: {
          personName: shipper.shipperPersonName,
          companyName: shipper.shipperName,
          phoneNumber: shipperPhoneCleaned,
        },
        address: {
          streetLines: [shipper.shipperStreet1, shipper.shipperStreet2].filter(Boolean) as string[],
          city: shipper.shipperCity,
          stateOrProvinceCode: shipper.shipperStateCode,
          postalCode: shipper.shipperPostalCode,
          countryCode: shipperCountryNormalized,
        },
        ...(shipper.shipperTinNumber && shipper.shipperTinType && {
          tins: [{
            number: shipper.shipperTinNumber,
            tinType: shipper.shipperTinType.toUpperCase(),
          }]
        }),
      },
      recipients: [{
        contact: {
          personName: recipientFullName,
          companyName: orderData.recipientCompany || undefined,
          phoneNumber: recipientPhoneCleaned,
          ...(recipientPhoneExt && { phoneExtension: recipientPhoneExt }),
          ...(orderData.recipientEmail && { emailAddress: orderData.recipientEmail })
        },
        address: {
          streetLines: [orderData.recipientStreet1, orderData.recipientStreet2].filter(Boolean) as string[],
          city: orderData.recipientCity,
          stateOrProvinceCode: orderData.recipientState || undefined,
          postalCode: String(orderData.recipientPostal),
          countryCode: orderData.recipientCountry,
          residential: orderData.isResidential === true,
        },
      }],
      shippingChargesPayment: {
        paymentType: orderData.shippingChargesPaymentType,
        payor: {
          responsibleParty: {
            accountNumber: { value: shipper.fedexAccountNumber }
          }
        }
      },
      labelSpecification: {
        labelFormatType: "COMMON2D",
        imageType: "PDF",
        labelStockType,
      },
      requestedPackageLineItems: (() => {
        let declaredValuePayload: any = null;
        if (orderData.customsClearanceDetail?.totalCustomsValue?.amount > 0) {
          let amount = parseFloat(orderData.customsClearanceDetail.totalCustomsValue.amount.toFixed(2));
          const currency = orderData.customsClearanceDetail.totalCustomsValue.currency;

          if (orderData.packagingType === 'FEDEX_PAK' && amount > 100) {
            logger.warn(`[FedEx Service] Declared value ${amount} ${currency} for FEDEX_PAK exceeds 100 USD limit. Capping at 100 ${currency}. Order ID: ${orderData.orderId}`);
            amount = 100;
          }
          declaredValuePayload = { amount, currency };
        }

        return [{
          weight: { units: "KG", value: parseFloat(orderData.weightKg.toFixed(2)) },
          ...(dimensionsPayload && { dimensions: dimensionsPayload }),
          ...(declaredValuePayload && { declaredValue: declaredValuePayload })
        }];
      })(),
      ...(isShipmentInternational && orderData.customsClearanceDetail && { 
        customsClearanceDetail: orderData.customsClearanceDetail 
      }),
      ...(orderData.shipmentSpecialServices && { 
        shipmentSpecialServices: orderData.shipmentSpecialServices 
      }),
    },
    accountNumber: { value: shipper.fedexAccountNumber }
  };

  // Handle shippingDocumentSpecification, especially for ETD Commercial Invoice
  if (
    orderData.shipmentSpecialServices?.specialServiceTypes?.includes("ELECTRONIC_TRADE_DOCUMENTS") &&
    orderData.shippingDocumentSpecification // Check if it exists in input
  ) {
    // Deep clone to avoid modifying the input orderData object.
    let spec = JSON.parse(JSON.stringify(orderData.shippingDocumentSpecification));

    // If FedEx is to generate the Commercial Invoice via ETD
    if (spec.shippingDocumentTypes?.includes("COMMERCIAL_INVOICE")) {
      if (!spec.commercialInvoiceDetail) {
        spec.commercialInvoiceDetail = {};
      }
      if (!spec.commercialInvoiceDetail.documentFormat) {
        spec.commercialInvoiceDetail.documentFormat = {};
      }
      // Set the docType to PDF for the Commercial Invoice to be generated by FedEx
      spec.commercialInvoiceDetail.documentFormat.docType = 'PDF';
      // Add the required stockType for the CI document
      spec.commercialInvoiceDetail.documentFormat.stockType = 'PAPER_LETTER';
      logger.info('[FedEx Service] Ensured commercialInvoiceDetail.documentFormat.docType is PDF and stockType is PAPER_LETTER for ETD CI.');
    }
    requestPayload.requestedShipment.shippingDocumentSpecification = spec;
  }
  
  if (signatureOptionDetailPayload) {
    if (!requestPayload.requestedShipment.shipmentSpecialServices) {
      requestPayload.requestedShipment.shipmentSpecialServices = { specialServiceTypes: [] };
    }
    if (!requestPayload.requestedShipment.shipmentSpecialServices.specialServiceTypes) {
      requestPayload.requestedShipment.shipmentSpecialServices.specialServiceTypes = [];
    }
    if (!requestPayload.requestedShipment.shipmentSpecialServices.specialServiceTypes.includes("SIGNATURE_OPTION")) {
      requestPayload.requestedShipment.shipmentSpecialServices.specialServiceTypes.push("SIGNATURE_OPTION");
    }
    requestPayload.requestedShipment.shipmentSpecialServices.signatureOptionDetail = signatureOptionDetailPayload;
  }

  // Guard: ensure no labelStockType leaks into CI section
  if (requestPayload.requestedShipment.shippingDocumentSpecification &&
      requestPayload.requestedShipment.shippingDocumentSpecification.labelStockType) {
    delete requestPayload.requestedShipment.shippingDocumentSpecification.labelStockType;
  }

  logger.info('[FedEx Service] Sending FedEx Ship API request for orderId: ' + orderData.orderId, { payloadSummary: { service: orderData.serviceType, recipientCountry: orderData.recipientCountry }});

  try {
    const shipApiUrl = 'https://apis.fedex.com/ship/v1/shipments';
    const apiResponse = await axios.post(shipApiUrl, requestPayload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US',
      },
    });

    // Handle async response (202 or has jobId)
    if (apiResponse.status === 202 || apiResponse.data?.output?.jobId) {
      const jobId = apiResponse.data.output.jobId;
      logger.info(`[FedEx Service] Shipment queued asynchronously. jobId=${jobId}`);
      
      try {
        const asyncResponse = await retrieveAsyncShipment(jobId, shipper.fedexAccountNumber, accessToken);
        const { trackingNumber, labelUrl } = extractShipmentDetails(asyncResponse);
        const alerts = asyncResponse.output.alerts || [];
        
        logger.info(`[FedEx Service] Label created for orderId ${orderData.orderId}. Tracking: ${trackingNumber}`);
        return { trackingNumber, labelUrl, alerts };
      } catch (error) {
        if (error instanceof FedexAsyncError) {
          throw error;
        }
        throw new Error(`FedEx async shipment error: ${error.message}`);
      }
    }

    // Handle synchronous response
    if (apiResponse.status === 200 && apiResponse.data?.output?.transactionShipments?.[0]) {
      const shipmentOutput = apiResponse.data.output.transactionShipments[0];
      const trackingNumber = shipmentOutput.masterTrackingNumber;
      const labelUrl = shipmentOutput.pieceResponses?.[0]?.packageDocuments?.find(
        (doc: any) =>
          doc.url &&
          (
            doc.contentType === 'LABEL' ||
            doc.docType === 'SHIPPING_LABEL' ||
            doc.docType === 'PDF'
          )
      )?.url
        // fallback: just take the first url if none match above
        || shipmentOutput.pieceResponses?.[0]?.packageDocuments?.[0]?.url;
      const alerts = shipmentOutput.alerts || [];

      if (!trackingNumber || !labelUrl) {
        logger.error('[FedEx Service] FedEx response missing tracking number or label URL. Full response:', apiResponse.data);
        // Try to extract using extractShipmentDetails as fallback
        try {
          const fallback = extractShipmentDetails(apiResponse.data);
          logger.warn('[FedEx Service] Fallback extraction succeeded for tracking/label.', fallback);
          return { ...fallback, alerts };
        } catch (fallbackErr) {
          logger.error('[FedEx Service] Fallback extraction failed.', fallbackErr);
          throw new Error('FedEx response missing tracking number or label URL.');
        }
      }
      logger.info(`[FedEx Service] Label created for orderId ${orderData.orderId}. Tracking: ${trackingNumber}`);
      return { trackingNumber, labelUrl, alerts };
    }

    // Handle unexpected response structure
    const errorDetail = apiResponse.data?.errors?.[0] || { message: 'Unknown API error after successful status.' };
    logger.error(`[FedEx Service] Unexpected FedEx API response structure for order ${orderData.orderId}:`, new Error(JSON.stringify(apiResponse.data)));
    throw new Error(`FedEx API Error (${apiResponse.status}): ${errorDetail.message || 'Unexpected response structure.'}`);
  } catch (error: any) {
    const errorResponse = error.response;
    const errorData = errorResponse?.data;
    const fedExErrors = errorData?.errors;

    let errorMessage = `FedEx Ship API Exception: ${error.message}`;
    if (fedExErrors && Array.isArray(fedExErrors) && fedExErrors.length > 0) {
        errorMessage = `FedEx Ship API Exception (${fedExErrors[0].code}): ${fedExErrors[0].message}`;
        if (fedExErrors.length > 1) {
            logger.error(`[FedEx Service] Multiple FedEx API error details for order ${orderData.orderId}: ${JSON.stringify(fedExErrors)}`);
        }
    }
    
    logger.error(`[FedEx Service] Processed error message for order ${orderData.orderId}: ${errorMessage}`);
    
    if (errorData) {
      logger.error(`[FedEx Service] Raw FedEx error response data for order ${orderData.orderId}:`, errorData);
    }
    
    if (error !== errorData) {
        logger.error(`[FedEx Service] Original caught exception object for order ${orderData.orderId}:`, error);
    }
    
    const errToThrow: any = new Error(errorMessage);
    if (fedExErrors) {
      errToThrow.responseErrors = fedExErrors;
    }
    throw errToThrow;
  }
} 