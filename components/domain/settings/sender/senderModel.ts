// components/domain/settings/sender/senderModel.ts — pure rules for Settings › Sender profile (settings §6).
// No React, no i18n: the form maps the returned keys to `settings.sender.*` messages.
import { toE164 } from '@/components/ds/inputs';

export type SenderProfile = Record<string, string | null | undefined>;
export interface SenderShipping {
  etgbRecipientEmail?: string | null;
  etgbEnabled?: boolean;
  /** Report "Picking" to Trendyol when the cargo label is printed from KolayXport (pages/api/trendyol/cargo.ts). */
  trendyolAutoPicking?: boolean;
}

/** Field names of `shipperProfile` (unchanged PATCH contract of /api/user/settings). */
export const SENDER_FIELDS = [
  'shipperName', 'shipperPersonName', 'shipperPhoneNumber', 'shipperTinNumber', 'shipperTinType', 'shipperTaxOffice',
  'shipperStreet1', 'shipperStreet2', 'shipperCity', 'shipperStateCode', 'shipperPostalCode', 'shipperCountryCode',
  'defaultCurrencyCode', 'dutiesPaymentType', 'defaultShippingChargesPaymentType', 'fedexFolderId', 'importerOfRecord',
] as const;
export type SenderField = (typeof SENDER_FIELDS)[number];

/** settings §6 "Required": company, person, phone, tax number + type, address 1, city, postal code, country. */
export const REQUIRED_SENDER_FIELDS: readonly SenderField[] = [
  'shipperName', 'shipperPersonName', 'shipperPhoneNumber', 'shipperTinNumber', 'shipperTinType',
  'shipperStreet1', 'shipperCity', 'shipperPostalCode', 'shipperCountryCode',
];

/** Tax id types the carriers accept (same list as the legacy panel). Codes, shown as-is (they are acronyms). */
export const TIN_TYPES = [
  'VAT', 'EORI', 'IOSS', 'OSS', 'PAN', 'GST', 'TIN', 'EIN', 'SSN', 'NIE', 'DNI', 'CNPJ', 'CPF', 'DUNS',
  'FEDERAL_TAX_ID', 'STATE_TAX_ID', 'BUSINESS_NATIONAL', 'PERSONAL_NATIONAL', 'BUSINESS_UNION', 'PERSONAL_UNION',
] as const;
export const tinTypeLabel = (code: string) => code.replace(/_/g, ' ');

/** Currencies the label flow supports today (legacy list), base currency first. */
export function senderCurrencies(listFirst: string): string[] {
  const all = ['TRY', 'USD', 'EUR'];
  return [listFirst, ...all.filter((c) => c !== listFirst)].filter((c) => all.includes(c));
}

/** What the label routes use when `defaultCurrencyCode` is empty (generate-label.ts: `|| 'USD'`). */
export const LABEL_FALLBACK_CURRENCY = 'USD';

/** Country picker priority (legacy short list, kept on top). */
export const COUNTRY_PRIORITY = ['TR', 'US', 'DE', 'GB'];

export type SenderErrorKind = 'required' | 'email';
export type SenderErrors = Partial<Record<SenderField | 'etgbRecipientEmail', SenderErrorKind>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '';

/** Errors for a save attempt. The recipient email is required and validated only while ETGB is on. */
export function validateSender(profile: SenderProfile, shipping: SenderShipping | null | undefined): SenderErrors {
  const errors: SenderErrors = {};
  for (const f of REQUIRED_SENDER_FIELDS) if (blank(profile?.[f])) errors[f] = 'required';
  if (shipping?.etgbEnabled) {
    const email = (shipping.etgbRecipientEmail ?? '').trim();
    if (!email) errors.etgbRecipientEmail = 'required';
    else if (!EMAIL_RE.test(email)) errors.etgbRecipientEmail = 'email';
  }
  return errors;
}

export const errorCount = (e: SenderErrors) => Object.keys(e).length;

/**
 * Stored phone → E.164 for the DS PhoneInput. Stored values are free text from the legacy form
 * ("05320000000", "5320000000", "+90 532 …", "905320000000"); nothing is rewritten until the user edits.
 */
export function phoneToE164(stored: string | null | undefined, country: string | null | undefined): string {
  const raw = (stored ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  const c = country || 'TR';
  // A trunk "0" or a ≤ 10-digit number is national.
  if (digits.startsWith('0') || digits.length <= 10) return toE164(c, digits);
  return `+${digits}`;
}

/**
 * E.164 from PhoneInput → stored value. Digits only (country code included, no "+"), because the UPS label
 * request sends `shipperPhoneNumber` verbatim and FedEx strips non-digits anyway.
 */
export function phoneForStorage(e164: string): string {
  return (e164 ?? '').replace(/\D/g, '');
}

/** The lines the label prints for the sender block (settings §6 "Label preview"). Empty lines are dropped. */
export function labelPreviewLines(p: SenderProfile, countryName: (code: string) => string): string[] {
  const v = (k: SenderField) => (typeof p?.[k] === 'string' ? (p[k] as string).trim() : '');
  const cityLine = [v('shipperPostalCode'), v('shipperCity'), v('shipperStateCode')].filter(Boolean).join(' ');
  const country = v('shipperCountryCode');
  const phone = v('shipperPhoneNumber');
  return [
    v('shipperName'),
    v('shipperPersonName'),
    v('shipperStreet1'),
    v('shipperStreet2'),
    cityLine,
    country ? countryName(country) : '',
    phone ? phoneDisplay(phone, country) : '',
  ].filter(Boolean);
}

function phoneDisplay(stored: string, country: string): string {
  const e164 = phoneToE164(stored, country);
  return e164 || stored;
}
