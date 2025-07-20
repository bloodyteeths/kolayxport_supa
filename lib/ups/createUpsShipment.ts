import fetch from 'node-fetch';
// @ts-ignore
// import PDFDocument from 'pdfkit';
// import getStream from 'get-stream';

// Types for UPS shipment creation
export interface UpsShipperProfile {
  upsApiKey: string;
  upsApiSecret: string;
  upsAccountNumber: string;
  shipperName: string;
  shipperPersonName: string;
  shipperPhoneNumber: string;
  shipperStreet1: string;
  shipperStreet2?: string;
  shipperCity: string;
  shipperStateCode: string;
  shipperPostalCode: string;
  shipperCountryCode: string;
  shipperTinNumber?: string;
  shipperTinType?: string;
  dutiesPaymentType?: string;
  defaultCurrencyCode?: string;
  importerOfRecord?: string;
}

export interface UpsRecipientAddress {
  name: string;
  company?: string;
  phone: string;
  phoneExtension?: string;
  email?: string;
  street1: string;
  street2?: string;
  city: string;
  stateCode?: string;
  postalCode: string;
  countryCode: string;
}

export interface UpsPackageDetails {
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  dimensionUnits?: 'CM' | 'IN';
}

export interface InternationalFormsInput {
  invoiceNumber: string;
  invoiceDate: string;
  exportReason: string;
  currencyCode: string;
  iossNumber?: string;
  vatNumber?: string;
  products: Array<{
    description: string;
    quantity: number;
    value: number;
    commodityCode: string;
    unitOfMeasurement: string;
    weight: string;
    originCountry: string;
  }>;
  soldTo: {
    name: string;
    attention: string;
    street1: string;
    street2?: string;
    city: string;
    state?: string;
    postalCode: string;
    countryCode: string;
    phone: string;
    email?: string;
  };
  termsOfShipment?: string;
  invoiceLineTotal?: {
    currencyCode: string;
    monetaryValue: string;
  };
  exportDate?: string;
  documentIdList?: Array<{ documentId: string }>;
}

export interface CreateShipmentInput {
  shipper: UpsShipperProfile;
  recipient: UpsRecipientAddress;
  package: UpsPackageDetails;
  serviceType: string;
  isEdi?: boolean;
  description?: string;
  internationalForms?: InternationalFormsInput;
  dutyPaymentType?: 'SHIPPER' | 'RECEIVER'; // Who pays duties and taxes
}

export interface CreateShipmentResult {
  success: boolean;
  trackingNumber?: string;
  labelUrl?: string;
  errors?: string[];
  raw?: any;
}

const UPS_BASE_URL = 'https://onlinetools.ups.com';

// Add a mapping for US state names to 2-letter codes
const US_STATE_NAME_TO_CODE: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

// Sanitize phone numbers for UPS (6‑15 digits, digits only)
function normalizePhone(raw?: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 6) return '';
  return digits.slice(0, 15); // UPS max length 15
}

// Normalize postal codes for UPS (remove dashes, max 9 alphanumeric)
function normalizePostalCode(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/-/g, '').slice(0, 9); // Remove dashes and limit to 9 chars
}

function normalizeStateCode(state: string, countryCode: string): string {
  if (countryCode === 'US') {
    if (state.length === 2) return state.toUpperCase();
    return US_STATE_NAME_TO_CODE[state] || state;
  }
  return state;
}

function toUPSDate(date: string): string {
  // Accepts 'YYYY-MM-DD' or 'YYYY/MM/DD' or 'YYYYMMDD', returns 'YYYYMMDD'
  if (!date) return '';
  if (/^\d{8}$/.test(date)) return date;
  return date.replace(/-/g, '').replace(/\//g, '');
}

function redactSensitive(obj: any) {
  if (!obj) return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  if (clone.Authorization) clone.Authorization = '[REDACTED]';
  if (clone.apiKey) clone.apiKey = '[REDACTED]';
  if (clone.password) clone.password = '[REDACTED]';
  return clone;
}

export async function getUpsAccessToken(apiKey: string, apiSecret: string): Promise<string> {
  const tokenUrl = `${UPS_BASE_URL}/security/v2/oauth/token`;
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('scope', 'shipment');  // Requesting shipment scope which includes paperless documents

  console.log('[UPS OAUTH] Requesting OAuth 2.0 token from:', tokenUrl);
  
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-merchant-id': 'string',  // Required for some UPS APIs
        'Authorization': `Basic ${auth}`,
      },
      body: params.toString(),
    });

    const responseData = await response.json();
    console.log('[UPS OAUTH] Token response:', JSON.stringify(responseData, null, 2));
    
    if (!response.ok) {
      console.error('[UPS OAUTH] Error response:', responseData);
      throw new Error(`UPS OAuth 2.0 error: ${response.status} – ${JSON.stringify(responseData)}`);
    }

    if (!responseData.access_token) {
      console.error('[UPS OAUTH] No access token in response:', responseData);
      throw new Error('No access_token in UPS OAuth 2.0 response');
    }

    console.log('[UPS OAUTH] Successfully obtained access token');
    return responseData.access_token;
  } catch (error) {
    console.error('[UPS OAUTH] Exception during token request:', error);
    throw new Error(`Failed to obtain UPS access token: ${error.message}`);
  }
}

function buildUpsShipmentPayload(
  shipper: UpsShipperProfile,
  recipient: UpsRecipientAddress,
  pkg: UpsPackageDetails,
  serviceType: string,
  isEdi: boolean,
  description: string = 'global cargo shipment',
  internationalForms?: InternationalFormsInput,
  dutyPaymentType: 'SHIPPER' | 'RECEIVER' = 'RECEIVER'
) {
  const shipmentPayload: any = {
    ShipmentRequest: {
      Request: {
        RequestOption: 'nonvalidate',
        TransactionReference: {
          CustomerContext: 'Label generation',
        },
      },
      Shipment: {
        Description: description ? description.slice(0, 35) : 'global cargo shipment',
        Shipper: {
          Name: shipper.shipperName,
          AttentionName: shipper.shipperPersonName,
          Phone: { Number: shipper.shipperPhoneNumber },
          ShipperNumber: shipper.upsAccountNumber,
          Address: {
            AddressLine: [shipper.shipperStreet1, shipper.shipperStreet2 || ''].filter(Boolean),
            City: shipper.shipperCity,
            StateProvinceCode: shipper.shipperStateCode,
            PostalCode: shipper.shipperPostalCode,
            CountryCode: shipper.shipperCountryCode,
          },
        },
        ShipTo: {
          Name: recipient.name,
          AttentionName: recipient.company || recipient.name,
          Phone: { 
            Number: normalizePhone(recipient.phone) ||
                    normalizePhone(internationalForms?.soldTo.phone) ||
                    '0000000000',   // final fallback to satisfy UPS
            ...(recipient.phoneExtension && { Extension: recipient.phoneExtension.slice(0, 4) }) // UPS allows max 4 chars
          },
          Address: {
            AddressLine: [recipient.street1, recipient.street2 || ''].filter(Boolean),
            City: recipient.city,
            StateProvinceCode: normalizeStateCode(recipient.stateCode || '', recipient.countryCode),
            PostalCode: normalizePostalCode(recipient.postalCode),
            CountryCode: recipient.countryCode,
          },
        },
        PaymentInformation: {
          ShipmentCharge: dutyPaymentType === 'SHIPPER' 
            ? [
                {
                  Type: '01', // Transportation charges
                  BillShipper: { AccountNumber: shipper.upsAccountNumber },
                },
                {
                  Type: '02', // Duties and Taxes - bill to shipper
                  BillShipper: { AccountNumber: shipper.upsAccountNumber },
                }
              ]
            : {
                // Default: only transportation charges, let UPS handle duties to receiver at delivery
                Type: '01', // Transportation charges
                BillShipper: { AccountNumber: shipper.upsAccountNumber },
              },
        },
        Service: { Code: serviceType },
        Package: {
          Packaging: { Code: '02' }, // Customer Supplied Package
          PackageWeight: {
            UnitOfMeasurement: { Code: 'KGS' },
            Weight: String(pkg.weightKg),
          },
          ...(pkg.lengthCm && pkg.widthCm && pkg.heightCm && {
            Dimensions: {
              UnitOfMeasurement: { Code: 'CM' },
              Length: String(pkg.lengthCm),
              Width: String(pkg.widthCm),
              Height: String(pkg.heightCm),
            },
          }),
        },
        ShipmentServiceOptions: {},
      },
      LabelSpecification: {
        LabelImageFormat: { Code: 'GIF' },
        HTTPUserAgent: 'Mozilla/4.5',
      },
    },
  };

  if (isEdi && internationalForms) {
    // --- UPS EDI strict validation ---
    // Validate international forms
    if (!internationalForms.currencyCode) {
      throw new Error('Currency code is required for international shipments');
    }
    if (!/^[A-Z]{3}$/.test(internationalForms.currencyCode)) {
      throw new Error(`Invalid currency code: ${internationalForms.currencyCode}. Must be 3 uppercase letters.`);
    }

    const products = internationalForms.products.map((p, index) => {
      // Validate required fields
      if (!p.description || p.description.trim() === '') {
        throw new Error(`Product #${index + 1} is missing a description`);
      }
      
      if (p.description.length > 35) {
        console.warn(`[UPS VALIDATION] Product #${index + 1} description will be truncated from ${p.description.length} to 35 characters`);
      }

      // Quantity validation
      const quantity = Math.floor(Number(p.quantity));
      if (isNaN(quantity) || quantity <= 0) {
        throw new Error(`Product #${index + 1} (${p.description}) has an invalid quantity: ${p.quantity}. Must be a positive integer.`);
      }
      if (quantity > 9999999) {
        throw new Error(`Product #${index + 1} (${p.description}) quantity ${quantity} exceeds maximum of 9,999,999`);
      }
      
      // Value validation
      const totalValue = Number(p.value);
      if (isNaN(totalValue) || totalValue < 0) {
        throw new Error(`Product #${index + 1} (${p.description}) has an invalid value: ${p.value}. Must be a non-negative number.`);
      }
      
      // Calculate per-unit value with proper decimal handling
      const perUnitValue = totalValue / quantity;
      
      // Format to exactly 6 decimal places, remove trailing zeros, but keep at least one decimal place
      let monetaryValueStr = perUnitValue.toFixed(6);
      monetaryValueStr = monetaryValueStr.replace(/\.?0+$/, '');
      if (monetaryValueStr.indexOf('.') === -1) {
        monetaryValueStr += '.0'; // Ensure at least one decimal place
      }
      
      // Validate the monetary value
      const monetaryValueNum = Number(monetaryValueStr);
      if (monetaryValueNum < 0 || monetaryValueNum > 999999999999999.999999) {
        throw new Error(`Product #${index + 1} (${p.description}) has an invalid unit value: ${monetaryValueStr}. Must be between 0 and 999,999,999,999,999.999999`);
      }
      
      // Validate commodity code
      if (!p.commodityCode || !/^\d{6,10}$/.test(p.commodityCode)) {
        throw new Error(`Product #${index + 1} (${p.description}) has an invalid commodity code: ${p.commodityCode}. Must be 6-10 digits.`);
      }
      
      // Validate unit of measurement
      const unitOfMeasurement = (p.unitOfMeasurement || 'PCS').toUpperCase();
      if (!/^[A-Z0-9]{2,3}$/.test(unitOfMeasurement)) {
        throw new Error(`Product #${index + 1} (${p.description}) has an invalid unit of measurement: ${unitOfMeasurement}. Must be 2-3 uppercase alphanumeric characters.`);
      }
      
      // Validate origin country
      const originCountry = (p.originCountry || shipper.shipperCountryCode).toUpperCase();
      if (!/^[A-Z]{2}$/.test(originCountry)) {
        throw new Error(`Product #${index + 1} (${p.description}) has an invalid origin country code: ${originCountry}. Must be 2 uppercase letters.`);
      }
      
      // Build the product payload following UPS EDI schema (Unit.Value is a numeric string)
      const productPayload: any = {
        Description: p.description.slice(0, 35),
        CommodityCode: p.commodityCode,
        OriginCountryCode: originCountry,
        PartNumber: p.commodityCode,
        Unit: {
          Number: String(quantity), // 1‑7 digits
          UnitOfMeasurement: { Code: unitOfMeasurement },
          Value: monetaryValueStr // numeric string, max 6 dp
        },
        ...(p.weight && {
          Weight: {
            UnitOfMeasurement: { Code: pkg.dimensionUnits === 'IN' ? 'LBS' : 'KGS' },
            Weight: String(Number(parseFloat(p.weight).toFixed(3)))
          }
        })
      };

      // Debug log
      console.log(
        `[UPS PRODUCT ${index + 1}] Built product payload:`,
        JSON.stringify(productPayload, null, 2)
      );

      return productPayload;
    });
    // Calculate and validate invoice totals
    const invoiceLineTotal = products.reduce((sum, p) => {
      const qty = Number(p.Unit.Number);
      const val = Number(p.Unit.Value); // Unit.Value is now a numeric string
      const productTotal = qty * val;
      console.log(`[UPS INVOICE] Product ${p.Description}: ${qty} × ${val} = ${productTotal.toFixed(6)}`);
      return sum + productTotal;
    }, 0);
    
    const declaredTotal = Number(internationalForms.invoiceLineTotal?.monetaryValue || 0);
    const totalDifference = Math.abs(invoiceLineTotal - declaredTotal);
    
    console.log(`[UPS INVOICE] Calculated total: ${invoiceLineTotal.toFixed(6)}`);
    console.log(`[UPS INVOICE] Declared total: ${declaredTotal.toFixed(6)}`);
    console.log(`[UPS INVOICE] Difference: ${totalDifference.toFixed(6)}`);
    
    // Allow small floating point differences (1 cent tolerance)
    if (totalDifference > 0.01) {
      const errorMsg = `Sum of (quantity × per-unit value) for all products (${invoiceLineTotal.toFixed(2)}) does not match InvoiceLineTotal (${declaredTotal.toFixed(2)}). Difference: ${totalDifference.toFixed(2)}. UPS will reject this shipment.`;
      console.error('[UPS VALIDATION ERROR]', errorMsg);
      throw new Error(errorMsg);
    }
    // Handle invoice date - default to today if not provided
    const invoiceDateUPS = internationalForms.invoiceDate
      ? toUPSDate(internationalForms.invoiceDate)
      : toUPSDate(new Date().toISOString().slice(0, 10)); // YYYYMMDD

    // Validate the invoice date format
    if (internationalForms.invoiceDate && !/^\d{8}$/.test(invoiceDateUPS)) {
      throw new Error(`Invalid invoice date format: ${internationalForms.invoiceDate}. Expected YYYY-MM-DD, YYYY/MM/DD, or YYYYMMDD`);
    }

    const forms = {
      FormType: '01', // 01 = EDI
      InvoiceNumber: internationalForms.invoiceNumber,
      InvoiceDate: invoiceDateUPS,
      ExportDate: invoiceDateUPS, // Must match InvoiceDate for EDI
      ReasonForExport: internationalForms.exportReason,
      CurrencyCode: internationalForms.currencyCode,
      TermsOfShipment: internationalForms.termsOfShipment || 'DAP',
      Contacts: {
        SoldTo: {
          Name: internationalForms.soldTo.name,
          AttentionName: internationalForms.soldTo.attention,
          ...(internationalForms.soldTo.email && { EMailAddress: internationalForms.soldTo.email }),
          Phone: { Number: normalizePhone(internationalForms.soldTo.phone) || '0000000000' },
          Address: {
            AddressLine: [internationalForms.soldTo.street1, internationalForms.soldTo.street2 || ''].filter(Boolean),
            City: internationalForms.soldTo.city,
            StateProvinceCode: normalizeStateCode(internationalForms.soldTo.state || '', internationalForms.soldTo.countryCode),
            PostalCode: normalizePostalCode(internationalForms.soldTo.postalCode),
            CountryCode: internationalForms.soldTo.countryCode,
          },
        },
      },
      Product: products,
      ...(internationalForms.invoiceLineTotal && {
        InvoiceLineTotal: {
          CurrencyCode: internationalForms.invoiceLineTotal.currencyCode,
          MonetaryValue: internationalForms.invoiceLineTotal.monetaryValue,
        },
      }),
      ...(internationalForms.documentIdList && {
        UserCreatedForm: {
          DocumentID: internationalForms.documentIdList.map(d => d.documentId),
        },
      }),
    };
    shipmentPayload.ShipmentRequest.Shipment.ShipmentServiceOptions.InternationalForms = forms;
  }

  return shipmentPayload;
}

async function callUpsApi(url: string, options: any, label: string) {
  console.log(`[UPS API CALL] ${label} URL: ${url}`);
  console.log(`[UPS API CALL] ${label} REQUEST:`, JSON.stringify(redactSensitive(options), null, 2));
  const res = await fetch(url, options);
  const rawResponse = await res.text();
  console.log(`[UPS API CALL] ${label} RESPONSE STATUS: ${res.status}`);
  console.log(`[UPS API CALL] ${label} RAW RESPONSE:`, rawResponse);

  if (!res.ok) {
    throw new Error(`API call for ${label} failed with status ${res.status}: ${rawResponse}`);
  }

  try {
    return JSON.parse(rawResponse);
  } catch (e) {
    console.error(`[UPS API CALL] Failed to parse JSON response for ${label}:`, e);
    throw new Error(`Failed to parse JSON response for ${label}. Raw: ${rawResponse}`);
  }
}

export async function createUpsShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  const { shipper, recipient, package: pkg, serviceType, isEdi = false, description, internationalForms, dutyPaymentType = 'RECEIVER' } = input;

  if (isEdi && internationalForms) {
    for (const p of internationalForms.products) {
      if (!p.commodityCode) {
        throw new Error(`Product "${p.description}" is missing a required Commodity Code for EDI shipment.`);
      }
    }
  }

  console.log('[createUpsShipment] Received input:', JSON.stringify({
    ...input,
    shipper: {
      ...shipper,
      upsApiKey: '[REDACTED]',
      upsApiSecret: '[REDACTED]',
    }
  }, null, 2));

  try {
    const token = await getUpsAccessToken(shipper.upsApiKey, shipper.upsApiSecret);
    const payload = buildUpsShipmentPayload(shipper, recipient, pkg, serviceType, isEdi, description, internationalForms, dutyPaymentType);
    console.log('[createUpsShipment] Built payload:', JSON.stringify(payload, null, 2));
    const url = `${UPS_BASE_URL}/api/shipments/v1/ship`;
    const res = await callUpsApi(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        transId: Date.now().toString(),
        transactionSrc: 'MyApp',
      },
      body: JSON.stringify(payload),
    }, 'SHIPMENT');
    const data = res.ShipmentResponse?.ShipmentResults;
    const trackingNumber = data?.ShipmentIdentificationNumber;
    const labelBase64 = data?.PackageResults?.ShippingLabel?.GraphicImage;
    if (!trackingNumber || !labelBase64) {
      return { success: false, errors: ['Missing tracking number or label from UPS response'], raw: data };
    }
    const labelUrl = `data:image/gif;base64,${labelBase64}`;

    return {
      success: true,
      trackingNumber,
      labelUrl,
      raw: data,
    };
  } catch (error: any) {
    console.error('[createUpsShipment] CATCH BLOCK: An error occurred:', error);
    return {
      success: false,
      errors: [error.message || 'UPS label generation failed'],
      raw: error.stack,
    };
  }
} 