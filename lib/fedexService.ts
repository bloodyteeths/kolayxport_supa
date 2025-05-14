import axios from 'axios';
import { fedexOptionsData } from './fedexConfig';

// --- TypeScript Interfaces ---

export interface OrderRow {
  orderId: string | null;
  recipientFname: string | null;
  recipientLname: string | null;
  recipientCompany: string | null;
  recipientStreet1: string | null;
  recipientStreet2: string | null;
  recipientCity: string | null;
  recipientState: string | null;
  recipientPostal: string | null;
  recipientCountry: string | null;
  recipientPhone: string | null;

  // --- Fields that are now mandatory and sourced per-order ---
  weightKg: number;
  serviceType: string;
  packagingType: string;
  pickupType: string;
  customsValue: number;
  commodityDesc: string;
  countryOfMfg: string;
  harmonizedCode: string;
  currency: string;
  shippingChargesPaymentType: string;

  isRecipientResidential?: boolean;
  packageLength?: number;
  packageWidth?: number;
  packageHeight?: number;
  dimensionUnits?: string;
  labelStockType: string;
  signatureType?: string;
  sendCommercialInvoiceViaEtd?: boolean;
  termsOfSale?: string;
}

export interface ShipperProfileData {
  fedexApiKey: string;
  fedexApiSecret: string;
  fedexAccountNumber: string;
  shipperName: string;
  shipperPersonName: string;
  shipperPhoneNumber: string;
  shipperStreet1: string;
  shipperStreet2?: string | null;
  shipperCity: string;
  shipperStateCode: string;
  shipperPostalCode: string;
  shipperCountryCode: string;
  shipperTinNumber: string;
  shipperTinType: string;
  dutiesPaymentType: string;
  defaultCurrencyCode: string;
  importerOfRecord?: string | null; // JSON string
}

interface ImporterOfRecordContact {
    personName: string;
    companyName: string;
    phoneNumber: string;
    emailAddress?: string;
}
interface ImporterOfRecordAddress {
    streetLines: string[];
    city: string;
    stateOrProvinceCode: string;
    postalCode: string;
    countryCode: string;
}
interface ImporterOfRecordTin {
    tinType: string;
    number: string;
    usage?: string;
}
interface ImporterOfRecordPayload {
    contact: ImporterOfRecordContact;
    address: ImporterOfRecordAddress;
    tins?: ImporterOfRecordTin[];
}

// --- Default Values from Apps Script Logic ---
const DEFAULT_PICKUP_TYPE_TS    = 'DROPOFF_AT_FEDEX_LOCATION';
const DEFAULT_PHONE_NUMBER_TS   = '0000000000';
const DEFAULT_TERMS_OF_SALE_TS  = 'DDU';

// --- FedEx OAuth Token Management ---
interface FedExAuthToken {
  accessToken: string;
  expiresAt: number;
}
let fedExTokenCache: FedExAuthToken | null = null;

async function getFedExOAuthToken(shipperConfig: Pick<ShipperProfileData, 'fedexApiKey' | 'fedexApiSecret'>): Promise<string> {
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
      const expiresIn = response.data.expires_in || 3600; // Default to 1 hour
      fedExTokenCache = {
        accessToken: response.data.access_token,
        expiresAt: Date.now() + (expiresIn - 300) * 1000,
      };
      return fedExTokenCache.accessToken;
    } else {
      console.error('FedEx OAuth Error Response:', response.data);
      throw new Error(`FedEx OAuth failed: ${response.data?.errors?.[0]?.message || 'Unknown OAuth error'}`);
    }
  } catch (error: any) {
    const errorData = error.response?.data;
    console.error('FedEx OAuth Exception:', errorData || error.message);
    throw new Error(`FedEx OAuth exception: ${errorData?.errors?.[0]?.message || error.message}`);
  }
}

// --- Main Label Generation Function ---
export async function generateFedexLabel(
  orderData: OrderRow,
  shipper: ShipperProfileData
): Promise<{ trackingNumber: string; labelUrl: string; masterFormId?: string }> {
  console.log(`generateFedexLabel: Validating inputs for order ${orderData.orderId}`);

  // Validate ShipperProfileData (existing logic)
  const requiredShipperProps: (keyof ShipperProfileData)[] = [
    'fedexApiKey', 'fedexApiSecret', 'fedexAccountNumber', 'shipperName',
    'shipperPersonName', 'shipperPhoneNumber', 'shipperStreet1', 'shipperCity', 'shipperStateCode',
    'shipperPostalCode', 'shipperCountryCode', 'shipperTinNumber', 'shipperTinType',
    'dutiesPaymentType', 'defaultCurrencyCode'
  ];
  for (const prop of requiredShipperProps) {
    if (!shipper[prop]) {
      throw new Error(`ShipperProfileData validation failed: Missing required property: ${prop}`);
    }
  }
  const validTinTypes = ["VAT", "EORI", "IOSS", "OSS", "PAN", "GST", "TIN", "EIN", "SSN", "NIE", "DNI", "CNPJ", "CPF", "DUNS", "FEDERAL_TAX_ID", "STATE_TAX_ID", "BUSINESS_NATIONAL", "PERSONAL_NATIONAL", "BUSINESS_UNION", "PERSONAL_UNION"];
   if (validTinTypes.indexOf(shipper.shipperTinType.toUpperCase()) === -1) {
       throw new Error(`Configuration Error: Invalid ShipperProfile.shipperTinType: '${shipper.shipperTinType}'`);
   }

  // --- Rigorous validation for OrderRow fields ---
  const validationErrors: string[] = [];
  if (!orderData.orderId) validationErrors.push("Order ID missing");

  // Recipient details (assuming API route pre-validates general presence)
  const recipientFullName = `${orderData.recipientFname || ''} ${orderData.recipientLname || ''}`.trim();
  if (!recipientFullName) validationErrors.push("Recipient Name (fname/lname) missing or empty");
  if (!orderData.recipientStreet1) validationErrors.push("Recipient Street 1 missing or empty");
  if (!orderData.recipientCity) validationErrors.push("Recipient City missing or empty");
  if (!orderData.recipientPostal) validationErrors.push("Recipient Postal Code missing or empty");
  if (!orderData.recipientCountry) validationErrors.push("Recipient Country Code missing or empty");
  
  const recipientPhoneCleaned = String(orderData.recipientPhone || '').replace(/\D/g, '') || DEFAULT_PHONE_NUMBER_TS;
  if (!recipientPhoneCleaned || recipientPhoneCleaned === DEFAULT_PHONE_NUMBER_TS && !orderData.recipientPhone) {
      validationErrors.push("Recipient Phone missing or invalid after cleaning");
  }

  // Mandatory order-specific fields
  if (typeof orderData.weightKg !== 'number' || orderData.weightKg <= 0) {
    validationErrors.push("weightKg must be a positive number");
  }
  if (!orderData.serviceType || String(orderData.serviceType).trim() === '') {
    validationErrors.push("serviceType is required");
  }
  if (!orderData.packagingType || String(orderData.packagingType).trim() === '') {
    validationErrors.push("packagingType is required");
  }
  if (!orderData.pickupType || !fedexOptionsData.pickupTypes.some(opt => opt.value === orderData.pickupType)) {
    validationErrors.push("pickupType is required and must be valid");
  }
  if (!orderData.shippingChargesPaymentType || !fedexOptionsData.shippingChargesPaymentTypes.some(opt => opt.value === orderData.shippingChargesPaymentType)) {
    validationErrors.push("shippingChargesPaymentType is required and must be valid (e.g. SENDER)");
  }

  const isShipmentInternational = shipper.shipperCountryCode.toUpperCase() !== orderData.recipientCountry?.toUpperCase();

  if (isShipmentInternational) {
    if (typeof orderData.customsValue !== 'number' || orderData.customsValue < 0) {
      validationErrors.push("customsValue must be a number >= 0 for international shipments");
    }
    if (!orderData.commodityDesc || String(orderData.commodityDesc).trim() === '') {
      validationErrors.push("commodityDesc is required for international shipments");
    }
    if (!orderData.countryOfMfg || String(orderData.countryOfMfg).trim() === '') {
      validationErrors.push("countryOfMfg is required for international shipments");
    }
    if (!orderData.harmonizedCode || String(orderData.harmonizedCode).trim() === '') {
      validationErrors.push("harmonizedCode is required for international shipments");
    }
    if (!orderData.currency || String(orderData.currency).trim() === '') {
      validationErrors.push("currency is required for international shipments");
    }
  } else {
    // For domestic, customsValue might be 0 or not strictly needed by FedEx API depending on region.
    // However, our OrderRow now makes it non-nullable. So, it must be provided (e.g. as 0).
    if (typeof orderData.customsValue !== 'number') { // Still check type even for domestic.
        validationErrors.push("customsValue must be a number (can be 0 for domestic if API allows)");
    }
     // Currency might also be required by FedEx even for domestic in some contexts, ensure it's present.
    if (!orderData.currency || String(orderData.currency).trim() === '') {
      validationErrors.push("currency is required (e.g., shipper's defaultCurrencyCode)");
    }
  }

  if (validationErrors.length > 0) {
    throw new Error(`OrderRow data validation failed: ${validationErrors.join('; ')}.`);
  }
  
  // Use validated values directly
  const weightKg = orderData.weightKg;
  const customsValue = orderData.customsValue;
  const commodityDescription = orderData.commodityDesc;
  const countryOfManufacture = orderData.countryOfMfg;
  const harmonizedCode = String(orderData.harmonizedCode).replace(/\D/g,'');
  const currencyCode = orderData.currency;

  const shipperPhoneCleaned = String(shipper.shipperPhoneNumber).replace(/\D/g, '') || DEFAULT_PHONE_NUMBER_TS;

  // --- Dimension validation and preparation ---
  let dimensionsPayload: any = null;
  if (
    orderData.packageLength && orderData.packageLength > 0 &&
    orderData.packageWidth && orderData.packageWidth > 0 &&
    orderData.packageHeight && orderData.packageHeight > 0 &&
    orderData.dimensionUnits && (orderData.dimensionUnits === 'CM' || orderData.dimensionUnits === 'IN')
  ) {
    dimensionsPayload = {
      length: Math.round(orderData.packageLength), // FedEx expects integers for dimensions
      width: Math.round(orderData.packageWidth),
      height: Math.round(orderData.packageHeight),
      units: orderData.dimensionUnits,
    };
  } else if (orderData.packageLength || orderData.packageWidth || orderData.packageHeight || orderData.dimensionUnits) {
    // If some dimension info is present but not all or invalid, this could be an error or warning.
    // For now, we only include dimensions if all parts are valid and present.
    console.warn(`Order ${orderData.orderId}: Incomplete or invalid dimension data provided. Dimensions will not be sent.`);
  }
  // --- End Dimension validation ---

  const accessToken = await getFedExOAuthToken(shipper);
  const shipDate = new Date().toISOString().split('T')[0];

  // --- Prepare Special Services --- 
  const specialServiceTypes: string[] = [];
  if (isShipmentInternational && (orderData.sendCommercialInvoiceViaEtd === undefined || orderData.sendCommercialInvoiceViaEtd === true) ) {
    specialServiceTypes.push("ELECTRONIC_TRADE_DOCUMENTS");
  }
  let signatureOptionDetailPayload: any = null;
  if (orderData.signatureType && orderData.signatureType !== 'NO_SIGNATURE_REQUIRED' && orderData.signatureType !== 'SERVICE_DEFAULT') {
    specialServiceTypes.push("SIGNATURE_OPTION");
    signatureOptionDetailPayload = { optionType: orderData.signatureType };
  } else if (orderData.signatureType === 'SERVICE_DEFAULT') {
     // For SERVICE_DEFAULT, FedEx docs imply not sending SIGNATURE_OPTION but letting it default.
     // Or, some services might require it explicitly. For now, treat as no specific option.
  }
  // --- End Prepare Special Services ---

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
      },
      recipients: [{
        contact: {
          personName: recipientFullName,
          companyName: orderData.recipientCompany || undefined,
          phoneNumber: recipientPhoneCleaned,
        },
        address: {
          streetLines: [orderData.recipientStreet1, orderData.recipientStreet2].filter(Boolean) as string[],
          city: orderData.recipientCity,
          stateOrProvinceCode: orderData.recipientState,
          postalCode: String(orderData.recipientPostal),
          countryCode: orderData.recipientCountry,
          residential: orderData.isRecipientResidential === true,
        },
      }],
      shippingChargesPayment: {
        paymentType: orderData.shippingChargesPaymentType,
        payor: {
          responsibleParty: { 
            accountNumber: shipper.fedexAccountNumber
          }
        }
      },
      labelSpecification: {
        labelFormatType: "COMMON2D",
        imageType: "PDF",
        labelStockType: orderData.labelStockType,
      },
      requestedPackageLineItems: [{
        weight: { units: "KG", value: weightKg },
        ...(dimensionsPayload && { dimensions: dimensionsPayload })
      }],
    },
  };

  if (isShipmentInternational) {
    const dutiesPaymentTypeResolved = shipper.dutiesPaymentType || "SENDER";
    let parsedImporterOfRecord: ImporterOfRecordPayload | null = null;
    if (shipper.importerOfRecord) {
      try {
        parsedImporterOfRecord = JSON.parse(shipper.importerOfRecord);
      } catch (e: any) {
        console.warn(`Could not parse ShipperProfile.importerOfRecord JSON: ${e.message}.`);
      }
    }

    requestPayload.requestedShipment.customsClearanceDetail = {
      isDocumentOnly: false,
      dutiesPayment: {
        paymentType: dutiesPaymentTypeResolved,
        payor: {
          responsibleParty: {
            ...(dutiesPaymentTypeResolved === 'SENDER' && shipper.shipperTinNumber && shipper.shipperTinType && {
              tins: [{
                number: shipper.shipperTinNumber,
                tinType: shipper.shipperTinType.toUpperCase(),
              }]
            }),
          }
        }
      },
      totalCustomsValue: { amount: customsValue, currency: currencyCode },
      commodities: [{
        description: commodityDescription,
        countryOfManufacture: countryOfManufacture,
        quantity: 1,
        quantityUnits: "EA",
        unitPrice: { amount: customsValue, currency: currencyCode },
        customsValue: { amount: customsValue, currency: currencyCode },
        harmonizedCode: harmonizedCode,
        weight: { units: "KG", value: weightKg }
      }],
      commercialInvoice: {
        purpose: "SOLD",
        termsOfSale: orderData.termsOfSale || DEFAULT_TERMS_OF_SALE_TS,
        currency: currencyCode
      },
      ...(parsedImporterOfRecord && { importerOfRecord: parsedImporterOfRecord })
    };
    // requestPayload.requestedShipment.shipmentSpecialServices is now built dynamically
    if (specialServiceTypes.length > 0) {
      requestPayload.requestedShipment.shipmentSpecialServices = { specialServiceTypes };
      if (signatureOptionDetailPayload) {
        requestPayload.requestedShipment.shipmentSpecialServices.signatureOptionDetail = signatureOptionDetailPayload;
      }
      // Add etdDetail if ELECTRONIC_TRADE_DOCUMENTS is present
      if (specialServiceTypes.includes("ELECTRONIC_TRADE_DOCUMENTS")) {
        requestPayload.requestedShipment.shipmentSpecialServices.etdDetail = {
          requestedDocumentCopies: "COMMERCIAL_INVOICE", // Or specify others if needed
          // Attributes like "POST_SHIPMENT_UPLOAD" can be added if you upload docs later
        };
        // Add explicit shippingDocumentSpecification for Commercial Invoice with ETD
        requestPayload.requestedShipment.shippingDocumentSpecification = {
          shippingDocumentTypes: ["COMMERCIAL_INVOICE"],
          commercialInvoiceDetail: {
            documentFormat: { docType: "PDF" }
          }
        };
      }
    }
  } else { // Domestic shipment - ensure no special services related to international are lingering
    if (requestPayload.requestedShipment.shipmentSpecialServices && 
        (requestPayload.requestedShipment.shipmentSpecialServices.specialServiceTypes.includes("ELECTRONIC_TRADE_DOCUMENTS") ||
         requestPayload.requestedShipment.shipmentSpecialServices.etdDetail 
        )
      ) {
        // Filter out ETD related special services for domestic if they were added
        const filteredSpecialServices = requestPayload.requestedShipment.shipmentSpecialServices.specialServiceTypes.filter(
            (type: string) => type !== "ELECTRONIC_TRADE_DOCUMENTS"
        );
        if (filteredSpecialServices.length > 0) {
            requestPayload.requestedShipment.shipmentSpecialServices.specialServiceTypes = filteredSpecialServices;
        } else {
            delete requestPayload.requestedShipment.shipmentSpecialServices;
        }
        delete requestPayload.requestedShipment.shipmentSpecialServices.etdDetail; 
    }
    delete requestPayload.requestedShipment.shippingDocumentSpecification; // No CI spec for domestic typically
    delete requestPayload.requestedShipment.customsClearanceDetail; // No customs for domestic
  }

  const shipApiUrl = 'https://apis.fedex.com/ship/v1/shipments';
  console.log("Sending FedEx Ship API request for order:", orderData.orderId);

  try {
    const shipResponse = await axios.post(shipApiUrl, requestPayload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US'
      },
    });

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

      if (shipResponse.data.output.alerts?.length > 0) {
        console.warn(`FedEx Alerts for Order ${orderData.orderId}:`, JSON.stringify(shipResponse.data.output.alerts));
      }
      if (!trackingNumber) throw new Error('FedEx response successful but masterTrackingNumber missing.');
      if (!labelUrl) throw new Error('FedEx response successful but label URL could not be extracted.');
      
      const masterFormId = transaction.shipmentDocuments?.find((doc: any) => doc.type === "FEDEX_MASTER_FORM")?.docId;

      console.log(`FedEx Label Success for Order ${orderData.orderId}. Tracking: ${trackingNumber}`);
      return { trackingNumber, labelUrl, masterFormId };
    } else {
      const errorDetail = shipResponse.data?.errors?.[0];
      throw new Error(`FedEx Ship API Error (${errorDetail?.code || shipResponse.status}): ${errorDetail?.message || 'Unknown API error'}`);
    }
  } catch (error: any) {
    const responseData = error.response?.data;
    const errorDetail = responseData?.errors?.[0];
    // Ensure the error message is propagated if it's from our validation
    if (error.message && error.message.startsWith('OrderRow data validation failed')) {
        throw error;
    }
    if (error.message && error.message.startsWith('ShipperProfileData validation failed')) {
        throw error;
    }
    throw new Error(`FedEx Ship API Exception (${errorDetail?.code || error.response?.status || 'Exception'}): ${errorDetail?.message || responseData?.message || error.message}`);
  }
} 