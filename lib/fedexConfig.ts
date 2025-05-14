export interface FedExOption { 
  value: string; 
  label: string; 
}

export interface FedExOptions {
  serviceTypes: FedExOption[];
  packagingTypes: FedExOption[];
  pickupTypes: FedExOption[];
  dutiesPaymentTypes: FedExOption[];
  shippingChargesPaymentTypes: FedExOption[];
  labelStockTypes: FedExOption[];
  signatureTypes: FedExOption[];
  termsOfSaleTypes: FedExOption[];
  dimensionUnits: FedExOption[];
  // Add other options like labelStockTypes if needed
}

// Based on common FedEx options. For a comprehensive list, refer to FedEx documentation.
export const fedexOptionsData: FedExOptions = {
  serviceTypes: [
    { value: 'INTERNATIONAL_PRIORITY', label: 'FedEx International Priority®' },
    { value: 'FEDEX_INTERNATIONAL_ECONOMY', label: 'FedEx International Economy®' },
    { value: 'FEDEX_GROUND', label: 'FedEx Ground® (US Domestic)' },
    { value: 'FEDEX_2_DAY', label: 'FedEx 2Day® (US Domestic)' },
    { value: 'FEDEX_STANDARD_OVERNIGHT', label: 'FedEx Standard Overnight® (US Domestic)' },
  ],
  packagingTypes: [
    { value: 'FEDEX_ENVELOPE', label: 'FedEx® Envelope' },
    { value: 'FEDEX_PAK', label: 'FedEx® Pak' },
    { value: 'FEDEX_BOX', label: 'FedEx® Box' },
    { value: 'FEDEX_TUBE', label: 'FedEx® Tube' },
    { value: 'YOUR_PACKAGING', label: 'Your Packaging' },
  ],
  pickupTypes: [
    { value: 'DROPOFF_AT_FEDEX_LOCATION', label: 'Drop off at FedEx Location' },
    { value: 'CONTACT_FEDEX_TO_SCHEDULE', label: 'Contact FedEx to Schedule Pickup' },
    { value: 'USE_SCHEDULED_PICKUP', label: 'Use My Scheduled Pickup' },
  ],
  dutiesPaymentTypes: [
    { value: 'SENDER', label: 'Sender' },
    { value: 'RECIPIENT', label: 'Recipient' },
    { value: 'THIRD_PARTY', label: 'Third Party' },
  ],
  shippingChargesPaymentTypes: [
    { value: 'SENDER', label: 'Sender (Default)' },
    { value: 'RECIPIENT', label: 'Recipient (Collect)' },
    // { value: 'THIRD_PARTY', label: 'Third Party' }, // Requires account number handling
  ],
  labelStockTypes: [
    { value: 'PAPER_4X6', label: 'A4 Kağıt (4x6 Lazer Yazıcı Etiketi)' },
    { value: 'STOCK_4X6', label: 'Termal Etiket (4x6)' },
    { value: 'PAPER_LETTER', label: 'Letter Kağıt (8.5x11 Lazer Yazıcı)' },
    // Add more common types as needed by user
  ],
  signatureTypes: [
    { value: 'NO_SIGNATURE_REQUIRED', label: 'İmza Gerekmez (Varsayılan)' },
    { value: 'ADULT', label: 'Yetişkin İmzası Gerekli' },
    { value: 'DIRECT', label: 'Doğrudan İmza Gerekli' },
    { value: 'INDIRECT', label: 'Dolaylı İmza Gerekli' },
    { value: 'SERVICE_DEFAULT', label: 'Servis Varsayılanı' },
  ],
  termsOfSaleTypes: [
    // Add termsOfSaleTypes options here
  ],
  dimensionUnits: [
    { value: 'CM', label: 'Centimeters (CM)' },
    { value: 'IN', label: 'Inches (IN)' },
  ],
}; 