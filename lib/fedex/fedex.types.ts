export interface FedexCredentials {
  apiKey: string;
  apiSecret: string;
  accountNumber: string;
}

export interface OrderRowItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice?: number;
  weightKg: number;
  harmonizedCode: string;
  countryOfMfg: string;
  sku?: string;
}

export interface OrderRow {
  orderId: string;
  orderNumber?: string;
  recipientFname: string;
  recipientLname: string;
  recipientCompany?: string;
  recipientStreet1: string;
  recipientStreet2?: string;
  recipientCity: string;
  recipientState?: string;
  recipientPostal: string;
  recipientCountry: string;
  recipientPhone: string;
  recipientPhoneExt?: string;
  recipientEmail?: string;
  isResidential?: boolean;
  weightKg: number;
  serviceType: string;
  packagingType: string;
  pickupType: string;
  customsValue: number;
  currency: string;
  shippingChargesPaymentType: string;
  declaredValue?: number;
  commodityDesc: string;
  countryOfMfg: string;
  harmonizedCode: string;
  packageLength?: number;
  packageWidth?: number;
  packageHeight?: number;
  dimensionUnits?: 'CM' | 'IN';
  labelStockType: string;
  signatureType?: string;
  sendCommercialInvoiceViaEtd?: boolean;
  termsOfSale?: string;
  items: OrderRowItem[];
}

export interface ShipperProfileData {
  fedexApiKey: string;
  fedexApiSecret: string;
  fedexAccountNumber: string;
  shipperName: string;
  shipperPersonName: string;
  shipperPhoneNumber: string;
  shipperStreet1: string;
  shipperStreet2?: string;
  shipperCity: string;
  shipperStateCode: string;
  shipperPostalCode: string;
  shipperCountryCode: string;
  shipperTinNumber: string;
  shipperTinType: string;
  dutiesPaymentType: string;
  defaultCurrencyCode: string;
  importerOfRecord?: string;
}

export interface ImporterOfRecordContact {
    personName: string;
    companyName: string;
    phoneNumber: string;
    emailAddress?: string;
}
export interface ImporterOfRecordAddress {
    streetLines: string[];
    city: string;
    stateOrProvinceCode: string;
    postalCode: string;
    countryCode: string;
}
export interface ImporterOfRecordTin {
    tinType: string;
    number: string;
    usage?: string;
}
export interface ImporterOfRecordPayload {
    contact: ImporterOfRecordContact;
    address: ImporterOfRecordAddress;
    tins?: ImporterOfRecordTin[];
}

export interface FedexShipmentResult {
  trackingNumber: string;
  labelUrl: string;
  masterFormId?: string;
  alerts?: any[];
  errors?: any[];
} 