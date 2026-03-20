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

// FedEx Currency Codes
export const FEDEX_CURRENCY_CODES: FedExOption[] = [
  { value: 'USD', label: 'ABD Dolar\u0131 (USD)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'GBP', label: '\u0130ngiliz Sterlini (GBP)' },
  { value: 'TRY', label: 'T\u00FCrk Liras\u0131 (TRY)' },
  { value: 'CAD', label: 'Kanada Dolar\u0131 (CAD)' },
  { value: 'AUD', label: 'Avustralya Dolar\u0131 (AUD)' },
  { value: 'JPY', label: 'Japon Yeni (JPY)' },
  { value: 'CHF', label: '\u0130svi\u00E7re Frang\u0131 (CHF)' },
  { value: 'CNY', label: '\u00C7in Yuan\u0131 (CNY)' },
  { value: 'SEK', label: '\u0130sve\u00E7 Kronu (SEK)' },
  { value: 'NOK', label: 'Norve\u00E7 Kronu (NOK)' },
  { value: 'DKK', label: 'Danimarka Kronu (DKK)' },
  { value: 'NZD', label: 'Yeni Zelanda Dolar\u0131 (NZD)' },
  { value: 'SGD', label: 'Singapur Dolar\u0131 (SGD)' },
  { value: 'HKD', label: 'Hong Kong Dolar\u0131 (HKD)' },
  { value: 'KRW', label: 'G\u00FCney Kore Wonu (KRW)' },
  { value: 'MXN', label: 'Meksika Pesosu (MXN)' },
  { value: 'BRL', label: 'Brezilya Reali (BRL)' },
  { value: 'INR', label: 'Hindistan Rupisi (INR)' },
  { value: 'ZAR', label: 'G\u00FCney Afrika Rand\u0131 (ZAR)' },
  { value: 'AED', label: 'BAE Dirhemi (AED)' },
  { value: 'SAR', label: 'Suudi Arabistan Riyali (SAR)' },
  { value: 'PLN', label: 'Polonya Zlotisi (PLN)' },
  { value: 'CZK', label: '\u00C7ek Korunas\u0131 (CZK)' },
  { value: 'HUF', label: 'Macar Forinti (HUF)' },
  { value: 'RON', label: 'Romen Leyi (RON)' },
  { value: 'BGN', label: 'Bulgar Levas\u0131 (BGN)' },
  { value: 'HRK', label: 'H\u0131rvat Kunas\u0131 (HRK)' },
  { value: 'RUB', label: 'Rus Rublesi (RUB)' },
  { value: 'THB', label: 'Tayland Baht\u0131 (THB)' },
  { value: 'MYR', label: 'Malezya Ringgiti (MYR)' },
  { value: 'IDR', label: 'Endonezya Rupisi (IDR)' },
  { value: 'PHP', label: 'Filipin Pesosu (PHP)' },
  { value: 'ILS', label: '\u0130srail \u015Eekeli (ILS)' },
  { value: 'TWD', label: 'Tayvan Dolar\u0131 (TWD)' },
  { value: 'VND', label: 'Vietnam Dongu (VND)' },
  { value: 'CLP', label: '\u015Eili Pesosu (CLP)' },
  { value: 'ARS', label: 'Arjantin Pesosu (ARS)' },
  { value: 'COP', label: 'Kolombiya Pesosu (COP)' },
  { value: 'PEN', label: 'Peru Solu (PEN)' },
  { value: 'UAH', label: 'Ukrayna Grivnas\u0131 (UAH)' },
  { value: 'KZT', label: 'Kazakistan Tengesi (KZT)' },
  { value: 'EGP', label: 'M\u0131s\u0131r Liras\u0131 (EGP)' },
  { value: 'MAD', label: 'Fas Dirhemi (MAD)' },
  { value: 'QAR', label: 'Katar Riyali (QAR)' },
  { value: 'KWD', label: 'Kuveyt Dinar\u0131 (KWD)' },
  { value: 'OMR', label: 'Umman Riyali (OMR)' },
  { value: 'BHD', label: 'Bahreyn Dinar\u0131 (BHD)' },
  { value: 'JOD', label: '\u00DCrd\u00FCn Dinar\u0131 (JOD)' },
  { value: 'LBP', label: 'L\u00FCbnan Liras\u0131 (LBP)' },
  { value: 'PKR', label: 'Pakistan Rupisi (PKR)' },
  { value: 'BDT', label: 'Banglade\u015F Takas\u0131 (BDT)' },
  { value: 'LKR', label: 'Sri Lanka Rupisi (LKR)' },
].sort((a, b) => a.label.localeCompare(b.label, 'tr'));