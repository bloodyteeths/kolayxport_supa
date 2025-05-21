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
  countryCodes: FedExOption[];
  tinTypes: FedExOption[];
  currencyCodes: FedExOption[];
}

export const fedexOptionsData: FedExOptions = {
  serviceTypes: [
    { value: 'INTERNATIONAL_PRIORITY', label: 'FedEx International Priority®' },
    { value: 'FEDEX_INTERNATIONAL_ECONOMY', label: 'FedEx International Economy®' },
    { value: 'FEDEX_EXPRESS_SAVER', label: 'FedEx Express Saver® (US Domestic)' },
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
  ],
  labelStockTypes: [
    { value: 'PAPER_4X6', label: 'A4 Paper (4x6 Laser Label)' },
    { value: 'STOCK_4X6', label: 'Thermal Label (4x6)' },
    { value: 'PAPER_LETTER', label: 'Letter Paper (8.5x11 Laser)' },
  ],
  signatureTypes: [
    { value: 'NO_SIGNATURE_REQUIRED', label: 'No Signature Required (Default)' },
    { value: 'ADULT', label: 'Adult Signature Required' },
    { value: 'DIRECT', label: 'Direct Signature Required' },
    { value: 'INDIRECT', label: 'Indirect Signature Required' },
    { value: 'SERVICE_DEFAULT', label: 'Service Default' },
  ],
  termsOfSaleTypes: [
     { value: 'DDU', label: 'DDU - Delivery Duty Unpaid' },
     { value: 'DAP', label: 'DAP - Delivered At Place' },
     { value: 'DDP', label: 'DDP - Delivery Duty Paid' },
  ],
  dimensionUnits: [
    { value: 'CM', label: 'Centimeters (CM)' },
    { value: 'IN', label: 'Inches (IN)' },
  ],
  countryCodes: [
     { value: 'TR', label: 'Turkey' },
     { value: 'US', label: 'United States' },
     { value: 'GB', label: 'United Kingdom' },
     { value: 'DE', label: 'Germany' },
  ],
  tinTypes: [
     "VAT", "EORI", "IOSS", "OSS", "PAN", "GST", "TIN", "EIN", "SSN",
     "NIE", "DNI", "CNPJ", "CPF", "DUNS", "FEDERAL_TAX_ID", "STATE_TAX_ID",
     "BUSINESS_NATIONAL", "PERSONAL_NATIONAL", "BUSINESS_UNION", "PERSONAL_UNION"
   ].map(type => ({ value: type, label: type.replace(/_/g, ' ') })),
  currencyCodes: [
     { value: 'USD', label: 'USD - US Dollar' },
     { value: 'EUR', label: 'EUR - Euro' },
     { value: 'TRY', label: 'TRY - Turkish Lira' },
  ]
}; 