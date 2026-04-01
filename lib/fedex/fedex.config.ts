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

// --- UI Dropdown Constants (used by labels page) ---

export const FEDEX_SERVICE_TYPES: FedExOption[] = [
  { value: 'INTERNATIONAL_PRIORITY', label: 'FedEx International Priority\u00AE' },
  { value: 'INTERNATIONAL_ECONOMY', label: 'FedEx International Economy\u00AE' },
  { value: 'FEDEX_EXPRESS_SAVER', label: 'FedEx Express Saver\u00AE' },
  { value: 'FEDEX_GROUND', label: 'FedEx Ground\u00AE' },
  { value: 'FEDEX_HOME_DELIVERY', label: 'FedEx Home Delivery\u00AE' },
];

export const FEDEX_PACKAGING_TYPES: FedExOption[] = [
  { value: 'FEDEX_PAK', label: 'FedEx Pak' },
  { value: 'FEDEX_BOX', label: 'FedEx Box' },
  { value: 'FEDEX_TUBE', label: 'FedEx Tube' },
  { value: 'FEDEX_ENVELOPE', label: 'FedEx Envelope' },
  { value: 'YOUR_PACKAGING', label: 'Your Packaging' },
];

// Allowed label stock types for PDF/PNG labels per FedEx Ship API
export const ALLOWED_LABEL_STOCK_TYPES = [
  { value: 'PAPER_4X6',  label: '4 \u00D7 6 in' },
  { value: 'PAPER_4X8',  label: '4 \u00D7 8 in' },
  { value: 'PAPER_4X9',  label: '4 \u00D7 9 in' },
  { value: 'PAPER_4X675', label: '4 \u00D7 6.75 in' },
  { value: 'PAPER_85X11_TOP_HALF_LABEL',   label: 'Letter \u2013 top \u00BD' },
  { value: 'PAPER_85X11_BOTTOM_HALF_LABEL',label: 'Letter \u2013 bottom \u00BD' },
  { value: 'PAPER_LETTER',                 label: 'Letter \u2013 full page' },
] as const;

// FedEx Currency Codes — call with t from useTranslations('fedex')
export const FEDEX_CURRENCY_CODE_LIST = [
  'USD', 'EUR', 'GBP', 'TRY', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY',
  'SEK', 'NOK', 'DKK', 'NZD', 'SGD', 'HKD', 'KRW', 'MXN', 'BRL',
  'INR', 'ZAR', 'AED', 'SAR', 'PLN', 'CZK', 'HUF', 'RON', 'BGN',
  'HRK', 'RUB', 'THB', 'MYR', 'IDR', 'PHP', 'ILS', 'TWD', 'VND',
  'CLP', 'ARS', 'COP', 'PEN', 'UAH', 'KZT', 'EGP', 'MAD', 'QAR',
  'KWD', 'OMR', 'BHD', 'JOD', 'LBP', 'PKR', 'BDT', 'LKR'
] as const;

/** Build translated currency options. Pass t from useTranslations('fedex'). */
export function getFedexCurrencyCodes(t: (key: string) => string): FedExOption[] {
  return FEDEX_CURRENCY_CODE_LIST.map(code => ({
    value: code,
    label: t(`currencies.${code}`)
  })).sort((a, b) => a.label.localeCompare(b.label));
}

/** @deprecated Use getFedexCurrencyCodes(t) for i18n support */
export const FEDEX_CURRENCY_CODES: FedExOption[] = FEDEX_CURRENCY_CODE_LIST.map(code => ({
  value: code,
  label: `${code}`
}));