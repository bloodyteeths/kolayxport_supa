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

export async function createFedexShipment(
  orderData: OrderRow,
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

  // --- Rigorous validation for OrderRow fields ---
  const validationErrors: string[] = [];
  if (!orderData.orderId) validationErrors.push("Order ID missing");

  const recipientFullName = `${orderData.recipientFname || ''} ${orderData.recipientLname || ''}`.trim();
  if (!recipientFullName) validationErrors.push("Recipient Name (fname/lname) missing or empty");
  if (!orderData.recipientStreet1) validationErrors.push("Recipient Street 1 missing or empty");
  if (!orderData.recipientCity) validationErrors.push("Recipient City missing or empty");
  if (!orderData.recipientPostal) validationErrors.push("Recipient Postal Code missing or empty");
  if (!orderData.recipientCountry) validationErrors.push("Recipient Country Code missing or empty");

  const recipientPhoneCleaned = String(orderData.recipientPhone || '').replace(/\D/g, '');
  if (!recipientPhoneCleaned) {
      validationErrors.push("Recipient Phone missing or invalid (was empty after cleaning)");
  }

  if (typeof orderData.weightKg !== 'number' || orderData.weightKg <= 0) validationErrors.push("weightKg must be a positive number");
  if (!orderData.serviceType || !fedexOptionsData.serviceTypes.some(o => o.value === orderData.serviceType)) validationErrors.push("serviceType is required and must be valid");
  if (!orderData.packagingType || !fedexOptionsData.packagingTypes.some(o => o.value === orderData.packagingType)) validationErrors.push("packagingType is required and must be valid");
  if (!orderData.pickupType || !fedexOptionsData.pickupTypes.some(o => o.value === orderData.pickupType)) validationErrors.push("pickupType is required and must be valid");
  if (!orderData.shippingChargesPaymentType || !fedexOptionsData.shippingChargesPaymentTypes.some(o => o.value === orderData.shippingChargesPaymentType)) validationErrors.push("shippingChargesPaymentType is required and must be valid");
  if (!orderData.labelStockType || !fedexOptionsData.labelStockTypes.some(o => o.value === orderData.labelStockType)) validationErrors.push("labelStockType is required and must be valid");

  const isShipmentInternational = shipper.shipperCountryCode.toUpperCase() !== orderData.recipientCountry?.toUpperCase();

  if (isShipmentInternational) {
    if (typeof orderData.customsValue !== 'number' || orderData.customsValue < 0) validationErrors.push("customsValue must be a number >= 0 for international shipments");
    if (!orderData.currency || !fedexOptionsData.currencyCodes.some(c => c.value === orderData.currency)) validationErrors.push("currency is required and must be valid for international shipments");
    if (!orderData.items || orderData.items.length === 0) {
        validationErrors.push("`items` array is required and must not be empty for international ETD shipments.");
    } else {
        orderData.items.forEach((item, index) => {
            if (!item.description || String(item.description).trim() === '') validationErrors.push(`Item ${index+1}: description is required`);
            if (typeof item.quantity !== 'number' || item.quantity <= 0) validationErrors.push(`Item ${index+1}: quantity must be a positive number`);
            if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) validationErrors.push(`Item ${index+1}: unitPrice must be a number >= 0`);
            if (typeof item.weightKg !== 'number' || item.weightKg <= 0) validationErrors.push(`Item ${index+1}: weightKg must be a positive number`);
            if (!item.countryOfMfg || String(item.countryOfMfg).trim() === '') validationErrors.push(`Item ${index+1}: countryOfMfg is required`);
            if (!item.harmonizedCode || String(item.harmonizedCode).trim() === '') validationErrors.push(`Item ${index+1}: harmonizedCode is required`);
        });
    }
  } else { // Domestic
    if (typeof orderData.customsValue !== 'number') validationErrors.push("customsValue must be a number (can be 0 for domestic if API allows)");
    if (!orderData.currency || !fedexOptionsData.currencyCodes.some(c => c.value === orderData.currency)) validationErrors.push("currency is required (e.g., shipper's defaultCurrencyCode)");
  }

  if (validationErrors.length > 0) {
    const errorString = `OrderRow/Shipper data validation failed for orderId ${orderData.orderId}: ${validationErrors.join('; ')}.`;
    logger.error(`[FedEx Service] ${errorString}`);
    throw new Error(errorString);
  }

  const shipperPhoneCleaned = String(shipper.shipperPhoneNumber).replace(/\D/g, '') || DEFAULT_PHONE_NUMBER_TS;
  const accessToken = await getFedExOAuthToken(shipper);
  const shipDate = new Date().toISOString().split('T')[0];

  let dimensionsPayload: any = null;
  if (
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

  const specialServiceTypes: string[] = [];
  if (isShipmentInternational && (orderData.sendCommercialInvoiceViaEtd === undefined || orderData.sendCommercialInvoiceViaEtd === true) ) {
    specialServiceTypes.push("ELECTRONIC_TRADE_DOCUMENTS");
  }
  let signatureOptionDetailPayload: any = null;
  if (orderData.signatureType && orderData.signatureType !== 'NO_SIGNATURE_REQUIRED' && orderData.signatureType !== 'SERVICE_DEFAULT') {
    if (fedexOptionsData.signatureTypes.some(s => s.value === orderData.signatureType)) {
     specialServiceTypes.push("SIGNATURE_OPTION");
     signatureOptionDetailPayload = { optionType: orderData.signatureType };
    } else {
     logger.warn(`[FedEx Service] Invalid signatureType '${orderData.signatureType}' provided for order ${orderData.orderId}. Ignoring.`);
    }
  }

  const commodities = orderData.items.map(item => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    weightKg: item.weightKg,
    countryOfMfg: item.countryOfMfg,
    harmonizedCode: item.harmonizedCode,
  }));

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
          countryCode: shipper.shipperCountryCode,
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
        labelStockType: orderData.labelStockType,
      },
      requestedPackageLineItems: [{
        weight: { units: "KG", value: parseFloat(orderData.weightKg.toFixed(2)) },
        ...(dimensionsPayload && { dimensions: dimensionsPayload }),
        ...(orderData.declaredValue && orderData.declaredValue > 0 && {
         declaredValue: { amount: parseFloat(orderData.declaredValue.toFixed(2)), currency: orderData.currency }
        })
      }],
    },
    accountNumber: { value: shipper.fedexAccountNumber }
  };

  if (specialServiceTypes.length > 0) {
    requestPayload.requestedShipment.shipmentSpecialServices = { specialServiceTypes };
    if (signatureOptionDetailPayload) {
      requestPayload.requestedShipment.shipmentSpecialServices.signatureOptionDetail = signatureOptionDetailPayload;
    }
    if (specialServiceTypes.includes("ELECTRONIC_TRADE_DOCUMENTS")) {
      requestPayload.requestedShipment.shipmentSpecialServices.etdDetail = {
        requestedDocumentCopies: "COMMERCIAL_INVOICE",
      };
      requestPayload.requestedShipment.shippingDocumentSpecification = {
        shippingDocumentTypes: ["COMMERCIAL_INVOICE"],
        commercialInvoiceDetail: {
          documentFormat: { docType: "PDF", stockType: "PAPER_LETTER" }
        }
      };
    }
  }

  if (isShipmentInternational) {
    let parsedImporterOfRecord: ImporterOfRecordPayload | null = null;
    if (shipper.importerOfRecord) {
      try {
        parsedImporterOfRecord = JSON.parse(shipper.importerOfRecord);
      } catch (e: any) {
        logger.warn(`[FedEx Service] Could not parse ShipperProfile.importerOfRecord JSON for order ${orderData.orderId}: ${e.message}.`);
      }
    }

    requestPayload.requestedShipment.customsClearanceDetail = {
      isDocumentOnly: false,
      dutiesPayment: {
        paymentType: shipper.dutiesPaymentType,
        payor: {
          responsibleParty: {
            accountNumber: { value: shipper.fedexAccountNumber },
            ...(shipper.dutiesPaymentType === 'SENDER' && shipper.shipperTinNumber && shipper.shipperTinType && {
              tins: [{
                number: shipper.shipperTinNumber,
                tinType: shipper.shipperTinType.toUpperCase(),
              }]
            }),
          }
        }
      },
      totalCustomsValue: { amount: parseFloat(orderData.customsValue.toFixed(2)), currency: orderData.currency },
      commodities: commodities,
      commercialInvoice: {
        purpose: "SOLD",
        termsOfSale: orderData.termsOfSale || DEFAULT_TERMS_OF_SALE_TS,
      },
      ...(parsedImporterOfRecord && { importerOfRecord: parsedImporterOfRecord })
    };

    requestPayload.shipmentSpecialServices = {
      etdDetail: { documentContent: 'ALL_DOCUMENTS' }
    };
    requestPayload.shippingDocumentSpecification = {
      commercialInvoiceDetail: {
        documentFormat: { stockType: 'PAPER_LETTER' }
      }
    };
  }

  const shipApiUrl = 'https://apis.fedex.com/ship/v1/shipments';
  logger.info(`[FedEx Service] Sending FedEx Ship API request for orderId: ${orderData.orderId}`, { payloadSummary: { service: orderData.serviceType, recipientCountry: orderData.recipientCountry }});

  try {
    const shipResponse = await axios.post(shipApiUrl, requestPayload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US'
      },
    });

    logger.info(`[FedEx Service] FedEx Ship API response status: ${shipResponse.status} for orderId: ${orderData.orderId}`);

    if (shipResponse.status === 200 && shipResponse.data.output?.transactionShipments?.[0]) {
      const transaction = shipResponse.data.output.transactionShipments[0];
      const trackingNumber = transaction.masterTrackingNumber;
      let labelUrl: string | null = null;

      if (transaction.pieceResponses?.[0]?.packageDocuments) {
        const docs = transaction.pieceResponses[0].packageDocuments;
        let foundDoc = docs.find((d: any) => /label/i.test(d.contentType || '') || /label/i.test(d.docType || ''));
        if (foundDoc && foundDoc.url) labelUrl = foundDoc.url;
        else {
            foundDoc = docs.find((d: any) => /pdf/i.test(d.contentType || '') || /pdf/i.test(d.docType || ''));
            if (foundDoc && foundDoc.url) labelUrl = foundDoc.url;
        }
        if (!labelUrl && docs.length > 0 && docs[0].url) labelUrl = docs[0].url;
      }

      const apiAlerts = shipResponse.data.output.alerts;
      if (apiAlerts?.length > 0) {
        logger.warn(`[FedEx Service] FedEx Alerts for Order ${orderData.orderId}:`, { alerts: apiAlerts });
      }
      if (!trackingNumber) {
         logger.error(`[FedEx Service] FedEx response successful but masterTrackingNumber missing for order ${orderData.orderId}`, new Error(JSON.stringify(shipResponse.data)));
         throw new Error('FedEx response successful but masterTrackingNumber missing.');
      }
      if (!labelUrl) {
         logger.error(`[FedEx Service] FedEx response successful but label URL could not be extracted for order ${orderData.orderId}`, new Error(JSON.stringify(shipResponse.data)));
         throw new Error('FedEx response successful but label URL could not be extracted.');
      }

      const masterFormId = transaction.shipmentDocuments?.find((doc: any) => doc.type === "FEDEX_MASTER_FORM")?.docId;

      logger.info(`[FedEx Service] FedEx Label Success for Order ${orderData.orderId}. Tracking: ${trackingNumber}`);
      return {
         trackingNumber,
         labelUrl,
         masterFormId,
         alerts: apiAlerts,
         errors: []
      };
    } else {
      const errorDetail = shipResponse.data?.errors?.[0];
      const errorMessage = `FedEx Ship API Error (${errorDetail?.code || shipResponse.status}): ${errorDetail?.message || 'Unknown API error'}`;
      logger.error(`[FedEx Service] ${errorMessage} for order ${orderData.orderId}`, new Error(JSON.stringify(shipResponse.data)));
      throw new Error(errorMessage);
    }
  } catch (error: any) {
    const responseData = error.response?.data;
    const errorDetail = responseData?.errors?.[0];
    let errorMessage = error.message;

    if (!errorMessage.startsWith('OrderRow/Shipper data validation failed') && !errorMessage.startsWith('Configuration Error: Invalid ShipperProfile.shipperTinType')) {
         errorMessage = `FedEx Ship API Exception (${errorDetail?.code || error.response?.status || 'Exception'}): ${errorDetail?.message || responseData?.message || error.message}`;
    }
    logger.error(`[FedEx Service] ${errorMessage} for order ${orderData.orderId}`, new Error(JSON.stringify({ error, responseData })));
    throw {
         message: errorMessage,
         responseErrors: responseData?.errors
    };
  }
} 