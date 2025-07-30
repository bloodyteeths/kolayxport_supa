import React, { useState } from 'react';
import { Drawer, Box, Typography, IconButton, TextField, Select, MenuItem, FormControl, InputLabel, Button, Alert, Chip, Autocomplete, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { UPS_SERVICE_TYPES, UPS_PACKAGE_TYPES, UPS_SIGNATURE_OPTIONS } from '@/constants/ups';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'react-hot-toast';

// Check if an order has existing successful shipments (labels)
function hasExistingLabel(order: any): boolean {
  if (!order) return false;
  
  const shipments = order.shipments || [];
  return shipments.some((s: any) => s?.status === 'created' && (s?.trackingNumber || s?.pdfUrl));
}

// Utility function to normalize decimal values to max 2 decimal places
const normalizeDecimal = (value: number | string): number => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return 0;
  return Math.round(num * 100) / 100; // Round to 2 decimal places
};

// Format decimal for display (ensures 2 decimal places)
const formatDecimal = (value: number | string): string => {
  return normalizeDecimal(value).toFixed(2);
};

interface UIOrder {
  orderId: string;
  orderNumber: string;
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientStreet1?: string;
  recipientStreet2?: string;
  recipientCity?: string;
  recipientState?: string;
  recipientPostal?: string;
  recipientCountry?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  orderTotalPrice?: number;
  currency?: string;
  title?: string;
  weight?: number;
  hsCode?: string;
  countryOfOrigin?: string;
  shipments?: any[];
}

interface UPSLabelDrawerProps {
  open: boolean;
  onClose: () => void;
  order: UIOrder | null;
  onSaved: () => void;
}

const DEFAULTS = {
  serviceType: '65', // UPS Saver
  packageType: 'UPS_PAK',
  signatureOption: 'NO_SIGNATURE',
  dutyPaymentType: 'RECEIVER', // Default: Receiver pays duties
  weight: 0.5,
};

const UPS_EXPORT_REASONS = [
  { value: 'SALE', label: 'Satış' },
  { value: 'GIFT', label: 'Hediye' },
  { value: 'RETURN', label: 'İade' },
  { value: 'REPAIR', label: 'Tamir' },
  { value: 'SAMPLE', label: 'Numune' },
];

const UPS_CURRENCY_CODES = [
  { value: 'USD', label: 'ABD Doları (USD)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'GBP', label: 'İngiliz Sterlini (GBP)' },
  { value: 'TRY', label: 'Türk Lirası (TRY)' },
  { value: 'CAD', label: 'Kanada Doları (CAD)' },
  { value: 'AUD', label: 'Avustralya Doları (AUD)' },
  { value: 'JPY', label: 'Japon Yeni (JPY)' },
  { value: 'CHF', label: 'İsviçre Frangı (CHF)' },
  { value: 'CNY', label: 'Çin Yuanı (CNY)' },
  { value: 'SEK', label: 'İsveç Kronu (SEK)' },
  { value: 'NOK', label: 'Norveç Kronu (NOK)' },
  { value: 'DKK', label: 'Danimarka Kronu (DKK)' },
  { value: 'NZD', label: 'Yeni Zelanda Doları (NZD)' },
  { value: 'SGD', label: 'Singapur Doları (SGD)' },
  { value: 'HKD', label: 'Hong Kong Doları (HKD)' },
  { value: 'KRW', label: 'Güney Kore Wonu (KRW)' },
  { value: 'MXN', label: 'Meksika Pesosu (MXN)' },
  { value: 'BRL', label: 'Brezilya Reali (BRL)' },
  { value: 'INR', label: 'Hindistan Rupisi (INR)' },
  { value: 'ZAR', label: 'Güney Afrika Randı (ZAR)' },
  { value: 'AED', label: 'BAE Dirhemi (AED)' },
  { value: 'SAR', label: 'Suudi Arabistan Riyali (SAR)' },
  { value: 'PLN', label: 'Polonya Zlotisi (PLN)' },
  { value: 'CZK', label: 'Çek Korunası (CZK)' },
  { value: 'HUF', label: 'Macar Forinti (HUF)' },
  { value: 'RON', label: 'Romen Leyi (RON)' },
  { value: 'BGN', label: 'Bulgar Levası (BGN)' },
  { value: 'HRK', label: 'Hırvat Kunası (HRK)' },
  { value: 'RUB', label: 'Rus Rublesi (RUB)' },
  { value: 'THB', label: 'Tayland Bahtı (THB)' },
  { value: 'MYR', label: 'Malezya Ringgiti (MYR)' },
  { value: 'IDR', label: 'Endonezya Rupisi (IDR)' },
  { value: 'PHP', label: 'Filipin Pesosu (PHP)' },
  { value: 'ILS', label: 'İsrail Şekeli (ILS)' },
  { value: 'TWD', label: 'Tayvan Doları (TWD)' },
  { value: 'VND', label: 'Vietnam Dongu (VND)' },
  { value: 'CLP', label: 'Şili Pesosu (CLP)' },
  { value: 'ARS', label: 'Arjantin Pesosu (ARS)' },
  { value: 'COP', label: 'Kolombiya Pesosu (COP)' },
  { value: 'PEN', label: 'Peru Solu (PEN)' },
  { value: 'UAH', label: 'Ukrayna Grivnası (UAH)' },
  { value: 'KZT', label: 'Kazakistan Tengesi (KZT)' },
  { value: 'EGP', label: 'Mısır Lirası (EGP)' },
  { value: 'MAD', label: 'Fas Dirhemi (MAD)' },
  { value: 'QAR', label: 'Katar Riyali (QAR)' },
  { value: 'KWD', label: 'Kuveyt Dinarı (KWD)' },
  { value: 'OMR', label: 'Umman Riyali (OMR)' },
  { value: 'BHD', label: 'Bahreyn Dinarı (BHD)' },
  { value: 'JOD', label: 'Ürdün Dinarı (JOD)' },
  { value: 'LBP', label: 'Lübnan Lirası (LBP)' },
  { value: 'PKR', label: 'Pakistan Rupisi (PKR)' },
  { value: 'BDT', label: 'Bangladeş Takası (BDT)' },
  { value: 'LKR', label: 'Sri Lanka Rupisi (LKR)' },
].sort((a, b) => a.label.localeCompare(b.label, 'tr'));

// Comprehensive list of countries with ISO codes
const COUNTRIES = [
  { code: 'AF', name: 'Afghanistan' },
  { code: 'AL', name: 'Albania' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'AD', name: 'Andorra' },
  { code: 'AO', name: 'Angola' },
  { code: 'AG', name: 'Antigua and Barbuda' },
  { code: 'AR', name: 'Argentina' },
  { code: 'AM', name: 'Armenia' },
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'AZ', name: 'Azerbaijan' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BB', name: 'Barbados' },
  { code: 'BY', name: 'Belarus' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BZ', name: 'Belize' },
  { code: 'BJ', name: 'Benin' },
  { code: 'BT', name: 'Bhutan' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'BA', name: 'Bosnia and Herzegovina' },
  { code: 'BW', name: 'Botswana' },
  { code: 'BR', name: 'Brazil' },
  { code: 'BN', name: 'Brunei' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' },
  { code: 'CV', name: 'Cabo Verde' },
  { code: 'KH', name: 'Cambodia' },
  { code: 'CM', name: 'Cameroon' },
  { code: 'CA', name: 'Canada' },
  { code: 'CF', name: 'Central African Republic' },
  { code: 'TD', name: 'Chad' },
  { code: 'CL', name: 'Chile' },
  { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' },
  { code: 'KM', name: 'Comoros' },
  { code: 'CG', name: 'Congo' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'CI', name: "Côte d'Ivoire" },
  { code: 'HR', name: 'Croatia' },
  { code: 'CU', name: 'Cuba' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DK', name: 'Denmark' },
  { code: 'DJ', name: 'Djibouti' },
  { code: 'DM', name: 'Dominica' },
  { code: 'DO', name: 'Dominican Republic' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'EG', name: 'Egypt' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'GQ', name: 'Equatorial Guinea' },
  { code: 'ER', name: 'Eritrea' },
  { code: 'EE', name: 'Estonia' },
  { code: 'SZ', name: 'Eswatini' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'FJ', name: 'Fiji' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GA', name: 'Gabon' },
  { code: 'GM', name: 'Gambia' },
  { code: 'GE', name: 'Georgia' },
  { code: 'DE', name: 'Germany' },
  { code: 'GH', name: 'Ghana' },
  { code: 'GR', name: 'Greece' },
  { code: 'GD', name: 'Grenada' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'GN', name: 'Guinea' },
  { code: 'GW', name: 'Guinea-Bissau' },
  { code: 'GY', name: 'Guyana' },
  { code: 'HT', name: 'Haiti' },
  { code: 'HN', name: 'Honduras' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IS', name: 'Iceland' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IR', name: 'Iran' },
  { code: 'IQ', name: 'Iraq' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'JP', name: 'Japan' },
  { code: 'JO', name: 'Jordan' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KI', name: 'Kiribati' },
  { code: 'KP', name: 'North Korea' },
  { code: 'KR', name: 'South Korea' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'KG', name: 'Kyrgyzstan' },
  { code: 'LA', name: 'Laos' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'LS', name: 'Lesotho' },
  { code: 'LR', name: 'Liberia' },
  { code: 'LY', name: 'Libya' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MG', name: 'Madagascar' },
  { code: 'MW', name: 'Malawi' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MV', name: 'Maldives' },
  { code: 'ML', name: 'Mali' },
  { code: 'MT', name: 'Malta' },
  { code: 'MH', name: 'Marshall Islands' },
  { code: 'MR', name: 'Mauritania' },
  { code: 'MU', name: 'Mauritius' },
  { code: 'MX', name: 'Mexico' },
  { code: 'FM', name: 'Micronesia' },
  { code: 'MD', name: 'Moldova' },
  { code: 'MC', name: 'Monaco' },
  { code: 'MN', name: 'Mongolia' },
  { code: 'ME', name: 'Montenegro' },
  { code: 'MA', name: 'Morocco' },
  { code: 'MZ', name: 'Mozambique' },
  { code: 'MM', name: 'Myanmar' },
  { code: 'NA', name: 'Namibia' },
  { code: 'NR', name: 'Nauru' },
  { code: 'NP', name: 'Nepal' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'NE', name: 'Niger' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'MK', name: 'North Macedonia' },
  { code: 'NO', name: 'Norway' },
  { code: 'OM', name: 'Oman' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PW', name: 'Palau' },
  { code: 'PS', name: 'Palestine' },
  { code: 'PA', name: 'Panama' },
  { code: 'PG', name: 'Papua New Guinea' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' },
  { code: 'RO', name: 'Romania' },
  { code: 'RU', name: 'Russia' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'KN', name: 'Saint Kitts and Nevis' },
  { code: 'LC', name: 'Saint Lucia' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines' },
  { code: 'WS', name: 'Samoa' },
  { code: 'SM', name: 'San Marino' },
  { code: 'ST', name: 'Sao Tome and Principe' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SN', name: 'Senegal' },
  { code: 'RS', name: 'Serbia' },
  { code: 'SC', name: 'Seychelles' },
  { code: 'SL', name: 'Sierra Leone' },
  { code: 'SG', name: 'Singapore' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'SB', name: 'Solomon Islands' },
  { code: 'SO', name: 'Somalia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'SS', name: 'South Sudan' },
  { code: 'ES', name: 'Spain' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SD', name: 'Sudan' },
  { code: 'SR', name: 'Suriname' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SY', name: 'Syria' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TJ', name: 'Tajikistan' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TL', name: 'Timor-Leste' },
  { code: 'TG', name: 'Togo' },
  { code: 'TO', name: 'Tonga' },
  { code: 'TT', name: 'Trinidad and Tobago' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'TR', name: 'Turkey' },
  { code: 'TM', name: 'Turkmenistan' },
  { code: 'TV', name: 'Tuvalu' },
  { code: 'UG', name: 'Uganda' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'UZ', name: 'Uzbekistan' },
  { code: 'VU', name: 'Vanuatu' },
  { code: 'VA', name: 'Vatican City' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'YE', name: 'Yemen' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ZW', name: 'Zimbabwe' },
  // Common territories and special codes
  { code: 'HK', name: 'Hong Kong' },
  { code: 'MO', name: 'Macau' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'VI', name: 'U.S. Virgin Islands' },
  { code: 'GU', name: 'Guam' },
  { code: 'AS', name: 'American Samoa' },
  { code: 'MP', name: 'Northern Mariana Islands' },
].sort((a, b) => a.name.localeCompare(b.name));

// Countries that require state/province codes for UPS shipping
const COUNTRIES_REQUIRING_STATE = ['US', 'CA', 'AU', 'CN', 'BR', 'MX', 'MY', 'IE'];

// Helper function to check if a country requires state
const countryRequiresState = (countryCode: string): boolean => {
  return COUNTRIES_REQUIRING_STATE.includes(countryCode);
};

// Helper function to convert country names to country codes
const getCountryCode = (countryName: string): string => {
  if (!countryName) return '';
  
  // First check if it's already a 2-letter code
  if (countryName.length === 2) {
    const upperCode = countryName.toUpperCase();
    if (COUNTRIES.find(c => c.code === upperCode)) {
      return upperCode;
    }
  }
  
  // Common country name variations and mappings
  const countryMappings: Record<string, string> = {
    'United States': 'US',
    'United States of America': 'US',
    'USA': 'US',
    'U.S.A.': 'US',
    'US': 'US',
    'America': 'US',
    'Turkey': 'TR',
    'Türkiye': 'TR',
    'TR': 'TR',
    'United Kingdom': 'GB',
    'UK': 'GB',
    'U.K.': 'GB',
    'Great Britain': 'GB',
    'England': 'GB',
    'GB': 'GB',
    'Germany': 'DE',
    'Deutschland': 'DE',
    'DE': 'DE',
    'France': 'FR',
    'FR': 'FR',
    'Netherlands': 'NL',
    'Holland': 'NL',
    'The Netherlands': 'NL',
    'South Korea': 'KR',
    'Republic of Korea': 'KR',
    'North Korea': 'KP',
    'Czech Republic': 'CZ',
    'Czechia': 'CZ',
    'Russia': 'RU',
    'Russian Federation': 'RU',
    'China': 'CN',
    'People\'s Republic of China': 'CN',
    'PRC': 'CN',
    'UAE': 'AE',
    'U.A.E.': 'AE',
  };
  
  // Check common mappings
  const normalizedName = countryName.trim();
  if (countryMappings[normalizedName]) {
    return countryMappings[normalizedName];
  }
  
  // Try to find by exact name match
  const exactMatch = COUNTRIES.find(
    c => c.name.toLowerCase() === normalizedName.toLowerCase()
  );
  if (exactMatch) {
    return exactMatch.code;
  }
  
  // Try partial match
  const partialMatch = COUNTRIES.find(
    c => c.name.toLowerCase().includes(normalizedName.toLowerCase()) ||
         normalizedName.toLowerCase().includes(c.name.toLowerCase())
  );
  if (partialMatch) {
    return partialMatch.code;
  }
  
  // Default to empty string if not found
  return '';
};

const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

export default function UPSLabelDrawer({ open, onClose, order, onSaved }: UPSLabelDrawerProps) {
  type Product = {
    description: string;
    quantity: number;
    value: number;
    commodityCode: string;
    originCountry: string;
  };
  type UPSFormState = {
    recipientFirstName: string;
    recipientLastName: string;
    recipientStreet1: string;
    recipientStreet2: string;
    recipientCity: string;
    recipientState: string;
    recipientPostal: string;
    recipientCountry: string;
    recipientPhone: string;
    hsCode: string;
    countryOfOrigin: string;
    weight: number;
    serviceType: string;
    packageType: string;
    signatureOption: string;
    dutyPaymentType: string;
    packageLength?: string;
    packageWidth?: string;
    packageHeight?: string;
    invoiceNumber: string;
    invoiceDate: string;
    exportReason: string;
    currencyCode: string;
    iossNumber: string;
    vatNumber: string;
    products: Array<{
      description: string;
      quantity: number;
      value: number;
      commodityCode: string;
      unitOfMeasurement: string;
      weight: string;
      originCountry: string;
    }>;
    soldToName: string;
    soldToAttention: string;
    soldToStreet1: string;
    soldToStreet2: string;
    soldToCity: string;
    soldToPostal: string;
    soldToCountry: string;
    soldToPhone: string;
    soldToState: string;
    soldToEmail: string;
    termsOfShipment: string;
    invoiceLineTotal: {
      currencyCode: string;
      monetaryValue: string;
    };
  };
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<UPSFormState>({
    recipientFirstName: '',
    recipientLastName: '',
    recipientStreet1: '',
    recipientStreet2: '',
    recipientCity: '',
    recipientState: '',
    recipientPostal: '',
    recipientCountry: '',
    recipientPhone: '',
    hsCode: '',
    countryOfOrigin: '',
    weight: DEFAULTS.weight,
    serviceType: DEFAULTS.serviceType,
    packageType: DEFAULTS.packageType,
    signatureOption: DEFAULTS.signatureOption,
    dutyPaymentType: DEFAULTS.dutyPaymentType,
    packageLength: '',
    packageWidth: '',
    packageHeight: '',
    invoiceNumber: '',
    invoiceDate: today,
    exportReason: 'SALE',
    currencyCode: 'USD',
    iossNumber: '',
    vatNumber: '',
    products: [{
      description: 'Global Cargo Shipment',
      quantity: 1,
      value: 0.01,
      commodityCode: '',
      unitOfMeasurement: 'PCS',
      weight: formatDecimal(DEFAULTS.weight),
      originCountry: 'TR',
    }],
    soldToName: '',
    soldToAttention: '',
    soldToStreet1: '',
    soldToStreet2: '',
    soldToCity: '',
    soldToPostal: '',
    soldToCountry: 'TR',
    soldToPhone: '',
    soldToState: '',
    soldToEmail: '',
    termsOfShipment: 'DAP',
    invoiceLineTotal: {
      currencyCode: 'USD',
      monetaryValue: '0.00'
    }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { user }: { user: any } = useAuth();
  const [labelUrl, setLabelUrl] = useState<string | null>(null);

  React.useEffect(() => {
    if (order) {
      // Reset UI state when order changes
      setSuccess(false);
      setError(null);
      setLabelUrl(null);
      setSaving(false);
      
      const orderValue = order?.orderTotalPrice || 0;
      setForm(f => ({
        ...f,
        recipientFirstName: order?.recipientFirstName || '',
        recipientLastName: order?.recipientLastName || '',
        recipientStreet1: order?.recipientStreet1 || '',
        recipientStreet2: order?.recipientStreet2 || '',
        recipientCity: order?.recipientCity || '',
        recipientState: order?.recipientState || '',
        recipientPostal: order?.recipientPostal || '',
        recipientCountry: getCountryCode(order?.recipientCountry || ''),
        recipientPhone: order?.recipientPhone || '',
        hsCode: order?.hsCode || '',
        countryOfOrigin: order?.countryOfOrigin || '',
        serviceType: DEFAULTS.serviceType,
        dutyPaymentType: DEFAULTS.dutyPaymentType,
        weight: normalizeDecimal(order?.weight || DEFAULTS.weight),
        invoiceNumber: `INV-${order?.orderNumber || Date.now()}`,
        soldToName: `${order?.recipientFirstName || ''} ${order?.recipientLastName || ''}`.trim(),
        soldToAttention: `${order?.recipientFirstName || ''} ${order?.recipientLastName || ''}`.trim(),
        soldToStreet1: order?.recipientStreet1 || '',
        soldToStreet2: order?.recipientStreet2 || '',
        soldToCity: order?.recipientCity || '',
        soldToPostal: order?.recipientPostal || '',
        soldToCountry: getCountryCode(order?.recipientCountry || ''),
        soldToPhone: order?.recipientPhone || '',
        soldToState: order?.recipientState || '',
        soldToEmail: order?.recipientEmail || '',
        products: [{
          description: (order?.title || 'Global Cargo Shipment').substring(0, 35),
          quantity: 1,
          value: normalizeDecimal(orderValue),
          commodityCode: order?.hsCode || '',
          unitOfMeasurement: 'PCS',
          weight: formatDecimal(order?.weight || DEFAULTS.weight),
          originCountry: order?.countryOfOrigin || 'TR',
        }],
        invoiceLineTotal: {
          currencyCode: order?.currency || 'USD',
          monetaryValue: formatDecimal(orderValue)
        }
      }));
    }
  }, [order]);

  // Reset UI state when drawer opens
  React.useEffect(() => {
    if (open) {
      setSuccess(false);
      setError(null);
      setLabelUrl(null);
      setSaving(false);
    }
  }, [open]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    // Normalize decimal values for specific fields
    if (name === 'weight') {
      const normalizedValue = normalizeDecimal(value);
      setForm(f => ({ ...f, [name]: normalizedValue }));
    } else {
      setForm(f => ({ ...f, [name]: value }));
    }
  };

  const handleSelectChange = (e: SelectChangeEvent<string>) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name as string]: value }));
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const { fetchWithLimit } = await import('../lib/fetchWithLimit');
      const res = await fetchWithLimit('/api/labels/ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          orderId: order?.orderId,
          recipient: {
            name: `${form.recipientFirstName} ${form.recipientLastName}`.trim(),
            phone: form.recipientPhone,
            street1: form.recipientStreet1,
            street2: form.recipientStreet2,
            city: form.recipientCity,
            stateCode: form.recipientState,
            postalCode: form.recipientPostal,
            countryCode: form.recipientCountry,
          },
          package: {
            weightKg: form.weight,
            lengthCm: form.packageLength ? Number(form.packageLength) : undefined,
            widthCm: form.packageWidth ? Number(form.packageWidth) : undefined,
            heightCm: form.packageHeight ? Number(form.packageHeight) : undefined,
            dimensionUnits: 'CM',
          },
          serviceType: form.serviceType,
          isEdi: true,
          description: form.products[0].description, // Use product description
          dutyPaymentType: form.dutyPaymentType,
          internationalForms: {
            invoiceNumber: form.invoiceNumber,
            invoiceLineTotal: {
              currencyCode: form.currencyCode,
              monetaryValue: formatDecimal(form.products[0].quantity * form.products[0].value)
            },
            exportReason: form.exportReason,
            currencyCode: form.currencyCode,
            iossNumber: form.iossNumber,
            vatNumber: form.vatNumber,
            products: form.products.map(product => ({
              ...product,
              commodityCode: product.commodityCode || '000000' // Fallback to 000000 if empty
            })),
            soldTo: {
              name: form.soldToName,
              attention: form.soldToAttention,
              street1: form.soldToStreet1,
              street2: form.soldToStreet2,
              city: form.soldToCity,
              postalCode: form.soldToPostal,
              countryCode: form.soldToCountry,
              phone: form.soldToPhone,
              state: form.soldToState,
              email: form.soldToEmail,
            },
            soldToState: form.soldToState,
            soldToEmail: form.soldToEmail,
            termsOfShipment: form.termsOfShipment,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'UPS label creation failed');
        setSaving(false);
        return;
      }
      toast.success(`UPS etiketi oluşturuldu! Takip No: ${data.trackingNumber}`);
      if (data.trackingNumber) {
        try { 
          await navigator.clipboard.writeText(data.trackingNumber);
          toast.success('Takip numarası panoya kopyalandı');
        } catch (e) {
          console.error('Failed to copy tracking number:', e);
        }
      }
      
      // Set success state first
      setSuccess(true);
      setSaving(false);
      
      // Trigger parent to refresh the orders list
      if (onSaved) {
        await onSaved();
      }
      
      // Handle label URL after parent has had a chance to update
      if (data.labelUrl) {
        if (data.labelUrl.startsWith('data:image/')) {
          setLabelUrl(data.labelUrl);
        } else {
          // Small delay to ensure the parent has time to update
          setTimeout(() => {
            window.open(data.labelUrl, '_blank', 'noopener,noreferrer');
            onClose();
          }, 500);
        }
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'UPS label creation failed');
      setSaving(false);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '90%', sm: 450, md: 500 }, p: { xs: 1, sm: 2 } } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1} p={1} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h6">UPS Etiketi Oluştur</Typography>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Box>
        <Box sx={{ overflowY: 'auto', p: { xs: 1, sm: 2 }, flexGrow: 1 }}>
          <form onSubmit={handleSubmit}>
            
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Recipient Information</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box>
                  <TextField
                    label="First Name"
                    name="recipientFirstName"
                    value={form.recipientFirstName}
                    onChange={handleInputChange}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Last Name"
                    name="recipientLastName"
                    value={form.recipientLastName}
                    onChange={handleInputChange}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Street Address 1"
                    name="recipientStreet1"
                    value={form.recipientStreet1}
                    onChange={handleInputChange}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Street Address 2"
                    name="recipientStreet2"
                    value={form.recipientStreet2}
                    onChange={handleInputChange}
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="City"
                    name="recipientCity"
                    value={form.recipientCity}
                    onChange={handleInputChange}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="State/Province"
                    name="recipientState"
                    value={form.recipientState}
                    onChange={handleInputChange}
                    required={countryRequiresState(form.recipientCountry)}
                    fullWidth
                    margin="dense"
                    size="small"
                    helperText={
                      countryRequiresState(form.recipientCountry) 
                        ? 'State/Province is required for this country' 
                        : 'State/Province is optional for this country'
                    }
                  />
                  <TextField
                    label="Postal Code"
                    name="recipientPostal"
                    value={form.recipientPostal}
                    onChange={handleInputChange}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <Autocomplete
                    options={COUNTRIES}
                    getOptionLabel={(option) => option.name}
                    value={COUNTRIES.find(c => c.code === form.recipientCountry) || null}
                    onChange={(event, newValue) => {
                      setForm(f => ({ ...f, recipientCountry: newValue?.code || '' }));
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Country"
                        required
                        margin="dense"
                        size="small"
                      />
                    )}
                    fullWidth
                    size="small"
                    sx={{ mt: 1 }}
                  />
                  <TextField
                    label="Phone"
                    name="recipientPhone"
                    value={form.recipientPhone}
                    onChange={handleInputChange}
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                </Box>
              </AccordionDetails>
            </Accordion>
            
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>UPS Seçenekleri</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Service Type</InputLabel>
                    <Select name="serviceType" value={form.serviceType} onChange={handleSelectChange} label="Service Type">
                      {UPS_SERVICE_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Package Type</InputLabel>
                    <Select name="packageType" value={form.packageType} onChange={handleSelectChange} label="Package Type">
                      {UPS_PACKAGE_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Signature Option</InputLabel>
                    <Select name="signatureOption" value={form.signatureOption} onChange={handleSelectChange} label="Signature Option">
                      {UPS_SIGNATURE_OPTIONS.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Vergi/Gümrük Ödemesi</InputLabel>
                    <Select name="dutyPaymentType" value={form.dutyPaymentType} onChange={handleSelectChange} label="Vergi/Gümrük Ödemesi">
                      <MenuItem value="RECEIVER">Alıcı (Receiver)</MenuItem>
                      <MenuItem value="SHIPPER">Gönderici (Shipper)</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField label="Weight (kg)" name="weight" type="number" value={form.weight} onChange={handleInputChange} fullWidth margin="dense" size="small" inputProps={{ min: 0, step: 0.01 }} />
                </Box>
              </AccordionDetails>
            </Accordion>
            
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Satış Bilgileri</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box>
                  <TextField
                    label="Fatura Numarası"
                    name="invoiceNumber"
                    value={form.invoiceNumber}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 30 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Fatura Tarihi"
                    name="invoiceDate"
                    type="date"
                    value={form.invoiceDate}
                    onChange={handleInputChange}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                    InputLabelProps={{ shrink: true }}
                  />
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>İhracat Nedeni</InputLabel>
                    <Select
                      name="exportReason"
                      value={form.exportReason}
                      onChange={handleSelectChange}
                      label="İhracat Nedeni"
                      required
                    >
                      {UPS_EXPORT_REASONS.map(opt => (
                        <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Para Birimi</InputLabel>
                    <Select
                      name="currencyCode"
                      value={form.currencyCode}
                      onChange={handleSelectChange}
                      label="Para Birimi"
                      required
                    >
                      {UPS_CURRENCY_CODES.map(opt => (
                        <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    label="IOSS Numarası"
                    name="iossNumber"
                    value={form.iossNumber}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 35, pattern: '^[A-Z0-9]{1,35}$' }}
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="KDV Numarası"
                    name="vatNumber"
                    value={form.vatNumber}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 20, pattern: '^[A-Z0-9]{1,20}$' }}
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                </Box>
              </AccordionDetails>
            </Accordion>
            
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Ürün Bilgisi</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box>
                  <TextField
                    label="Açıklama"
                    name="description"
                    value={form.products[0].description}
                    onChange={e => {
                      const newDescription = e.target.value;
                      setForm(f => ({
                        ...f,
                        products: [{
                          ...f.products[0],
                          description: newDescription
                        }]
                      }));
                    }}
                    inputProps={{ maxLength: 35 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="GTIP Kodu"
                    name="commodityCode"
                    value={form.products[0].commodityCode}
                    onChange={e => setForm(f => ({
                      ...f,
                      products: [{ ...f.products[0], commodityCode: e.target.value }]
                    }))}
                    inputProps={{ maxLength: 20, pattern: '^[0-9]*$' }}
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Miktar"
                    name="quantity"
                    type="number"
                    value={form.products[0].quantity}
                    onChange={e => {
                      const quantity = Math.max(1, Number(e.target.value));
                      const unitPrice = form.products[0].value;
                      setForm(f => ({
                        ...f, 
                        products: [{ ...f.products[0], quantity }],
                        invoiceLineTotal: {
                          currencyCode: f.currencyCode,
                          monetaryValue: formatDecimal(quantity * unitPrice)
                        }
                      }));
                    }}
                    inputProps={{ min: 1 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Birim Fiyat"
                    name="value"
                    type="number"
                    value={form.products[0].value}
                    onChange={e => {
                      const unitPrice = Math.max(0.01, normalizeDecimal(e.target.value));
                      setForm(f => ({
                        ...f, 
                        products: [{ ...f.products[0], value: unitPrice }],
                        invoiceLineTotal: {
                          currencyCode: f.currencyCode,
                          monetaryValue: formatDecimal(f.products[0].quantity * unitPrice)
                        }
                      }));
                    }}
                    inputProps={{ min: 0.01, step: 0.01 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Toplam Tutar"
                    type="number"
                    value={formatDecimal(form.products[0].quantity * form.products[0].value)}
                    disabled
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Ürün Birimi</InputLabel>
                    <Select
                      name="unitOfMeasurement"
                      value={form.products[0].unitOfMeasurement}
                      onChange={e => setForm(f => ({ ...f, products: [{ ...f.products[0], unitOfMeasurement: e.target.value }] }))}
                      label="Ürün Birimi"
                      required
                    >
                      <MenuItem value="PCS">Adet</MenuItem>
                      <MenuItem value="KG">Kilogram</MenuItem>
                      <MenuItem value="LTR">Litre</MenuItem>
                      <MenuItem value="MTR">Metre</MenuItem>
                      <MenuItem value="CMT">Santimetre</MenuItem>
                      <MenuItem value="MMT">Milimetre</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    label="Ürün Ağırlığı"
                    name="weight"
                    type="number"
                    value={form.products[0].weight}
                    onChange={e => {
                      const normalizedWeight = formatDecimal(e.target.value);
                      setForm(f => ({ ...f, products: [{ ...f.products[0], weight: normalizedWeight }] }));
                    }}
                    inputProps={{ min: 0, step: 0.01 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <Autocomplete
                    options={COUNTRIES}
                    getOptionLabel={(option) => option.name}
                    value={COUNTRIES.find(c => c.code === form.products[0].originCountry) || null}
                    onChange={(event, newValue) => {
                      setForm(f => ({ ...f, products: [{ ...f.products[0], originCountry: newValue?.code || 'TR' }] }));
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Country of Origin"
                        required
                        margin="dense"
                        size="small"
                      />
                    )}
                    fullWidth
                    size="small"
                    sx={{ mt: 1 }}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>
            
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Alıcı (Sold To)</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box>
                  <TextField
                    label="Ad"
                    name="soldToName"
                    value={form.soldToName}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 35 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Dikkat Edilecek Kişi"
                    name="soldToAttention"
                    value={form.soldToAttention}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 35 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Adres Satırı 1"
                    name="soldToStreet1"
                    value={form.soldToStreet1}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 35 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Adres Satırı 2"
                    name="soldToStreet2"
                    value={form.soldToStreet2}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 35 }}
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Şehir"
                    name="soldToCity"
                    value={form.soldToCity}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 35 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Posta Kodu"
                    name="soldToPostal"
                    value={form.soldToPostal}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 10 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <TextField
                    label="Telefon Numarası"
                    name="soldToPhone"
                    value={form.soldToPhone}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 20 }}
                    required
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <Autocomplete
                    options={COUNTRIES}
                    getOptionLabel={(option) => option.name}
                    value={COUNTRIES.find(c => c.code === form.soldToCountry) || null}
                    onChange={(event, newValue) => {
                      setForm(f => ({ ...f, soldToCountry: newValue?.code || 'TR' }));
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Country (Sold To)"
                        required
                        margin="dense"
                        size="small"
                      />
                    )}
                    fullWidth
                    size="small"
                    sx={{ mt: 1 }}
                  />
                  <TextField
                    label="State/Province (Sold To)"
                    name="soldToState"
                    value={form.soldToState}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 5 }}
                    required={countryRequiresState(form.soldToCountry)}
                    fullWidth
                    margin="dense"
                    size="small"
                    helperText={
                      countryRequiresState(form.soldToCountry) 
                        ? 'State/Province is required for this country' 
                        : 'State/Province is optional for this country'
                    }
                  />
                  <TextField
                    label="Alıcı E-posta"
                    name="soldToEmail"
                    type="email"
                    value={form.soldToEmail}
                    onChange={handleInputChange}
                    inputProps={{ maxLength: 50 }}
                    fullWidth
                    margin="dense"
                    size="small"
                  />
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Teslim Şartı</InputLabel>
                    <Select
                      name="termsOfShipment"
                      value={form.termsOfShipment}
                      onChange={handleSelectChange}
                      label="Teslim Şartı"
                      required
                    >
                      <MenuItem value="DAP">DAP (Delivered At Place)</MenuItem>
                      <MenuItem value="DDP">DDP (Delivered Duty Paid)</MenuItem>
                      <MenuItem value="DDU">DDU (Delivered Duty Unpaid)</MenuItem>
                      <MenuItem value="EXW">EXW (Ex Works)</MenuItem>
                      <MenuItem value="FCA">FCA (Free Carrier)</MenuItem>
                      <MenuItem value="CPT">CPT (Carriage Paid To)</MenuItem>
                      <MenuItem value="CIP">CIP (Carriage and Insurance Paid To)</MenuItem>
                      <MenuItem value="DAT">DAT (Delivered At Terminal)</MenuItem>
                      <MenuItem value="DPU">DPU (Delivered at Place Unloaded)</MenuItem>
                      <MenuItem value="CFR">CFR (Cost and Freight)</MenuItem>
                      <MenuItem value="CIF">CIF (Cost, Insurance and Freight)</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              </AccordionDetails>
            </Accordion>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }}>UPS etiketi başarıyla kaydedildi.</Alert>}
            <Button type="submit" variant="contained" color="primary" fullWidth disabled={saving || (!!order && hasExistingLabel(order))}>{saving ? 'Kaydediliyor...' : (order && hasExistingLabel(order) ? 'Mevcut Etiketi Silin' : 'Kaydet')}</Button>
          </form>
          {labelUrl && (
            <Box mt={2} textAlign="center">
              <Typography variant="subtitle1" gutterBottom>UPS Etiketi</Typography>
              <img src={labelUrl} alt="UPS Label" style={{ maxWidth: '100%', border: '1px solid #ccc', marginBottom: 8 }} />
              <a href={labelUrl} download="ups-label.gif">
                <Button variant="outlined" color="primary">Etiketi İndir</Button>
              </a>
            </Box>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
