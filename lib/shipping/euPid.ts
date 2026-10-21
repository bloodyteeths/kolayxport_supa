// lib/shipping/euPid.ts — EU customs reform (1 Nov 2026): product identifiers (PIDs) on every item of a B2C parcel
// to the EU, whatever its value, plus IOSS autofill. Pure (no I/O) so the label panel, the submit adapters and the
// server routes share one rule set.
//
// Per item the declarant sends:
//  - M-PID  merchant product identifier: the seller's own code (SKU; else the marketplace listing id)
//  - NS-PID non-standardised manufacturer identifier: for handmade / own-brand goods the seller is the
//           manufacturer, so the same code is valid
//  - S-PID  standardised identifier (GTIN / EAN / UPC / ISBN) only when one exists, else the literal "NA"
// FedEx: commodities[].regulatoryDetails, regulationCode EU_DE_MINIMIS (mandatory from 26 Oct 2026).

/** The 27 EU member states (ISO-2; Greece is GR in shipping data). GB, NO, CH, XI (NI) and others are out. */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

export function isEuCountry(country: string | null | undefined): boolean {
  const c = String(country ?? '').trim().toUpperCase();
  return EU_COUNTRIES.has(c === 'EL' ? 'GR' : c);
}

/** What a customs line declares. `gtin` '' means "no standard identifier" (sent as NA). */
export interface ProductIds {
  merchant: string;
  manufacturer: string;
  gtin: string;
}

export const NO_STANDARD_ID = 'NA';
const MAX_ID = 100;

const tidy = (v: unknown): string => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_ID);

/** GS1 mod-10 check digit over a numeric string (the last digit is the check digit). */
function gs1CheckOk(digits: string): boolean {
  let sum = 0;
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(digits[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * A valid GTIN-8/12/13/14 (UPC, EAN, ISBN-13 included) with its check digit, digits only; '' otherwise.
 * ISBN-10 is converted to its EAN-13 (978…) form.
 */
export function normalizeGtin(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  // ISBN-10 → EAN-13: 978 + its first 9 digits + a new GS1 check digit.
  if (/^\d{9}[\dX]$/.test(s) && isIsbn10(s)) {
    const body = `978${s.slice(0, 9)}`;
    for (let d = 0; d <= 9; d++) if (gs1CheckOk(body + d)) return body + d;
  }
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return '';
  if (/^0+$/.test(s)) return '';
  return gs1CheckOk(s) ? s : '';
}

function isIsbn10(s: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

/** Marketplace values that mean "no identifier" (eBay "Does not apply", Etsy/Shopify blanks …). */
const NOT_APPLICABLE = /^(does not apply|n\/?a|na|none|not applicable|geçerli değil|yok|-+)$/i;

/**
 * Prefilled identifiers for one line: merchant = SKU, else the listing id, else the item id; manufacturer = the
 * same code (seller-made); GTIN from the marketplace when it is a valid barcode, else ''.
 */
export function defaultProductIds(item: { sku?: string | null; listingRef?: string | null; itemId?: string | null; gtin?: string | null; mpn?: string | null }): ProductIds {
  const sku = tidy(item.sku);
  const listing = tidy(item.listingRef);
  const merchant = sku || listing || tidy(item.itemId);
  const mpn = tidy(item.mpn);
  return {
    merchant,
    manufacturer: mpn && !NOT_APPLICABLE.test(mpn) ? mpn : merchant,
    gtin: normalizeGtin(item.gtin),
  };
}

/** Both mandatory identifiers present (the GTIN may be empty → NA). */
export function productIdsComplete(p: ProductIds | null | undefined): boolean {
  return Boolean(p && tidy(p.merchant) && tidy(p.manufacturer));
}

export type PidProblem = 'merchantMissing' | 'manufacturerMissing' | 'gtinInvalid';

/** Field-level problems for the label panel. A non-empty GTIN must be a valid barcode. */
export function productIdProblems(p: ProductIds | null | undefined): PidProblem[] {
  const out: PidProblem[] = [];
  if (!tidy(p?.merchant)) out.push('merchantMissing');
  if (!tidy(p?.manufacturer)) out.push('manufacturerMissing');
  const g = tidy(p?.gtin);
  if (g && g.toUpperCase() !== NO_STANDARD_ID && !normalizeGtin(g)) out.push('gtinInvalid');
  return out;
}

/** FedEx Ship API `commodities[].regulatoryDetails[0]` (null when a mandatory identifier is missing). */
export function fedexRegulatoryDetail(p: ProductIds | null | undefined): {
  regulationCode: 'EU_DE_MINIMIS';
  productId: string;
  productIdType: 'SKU';
  details: { merchantProductId: string; nonStandardManufacturerProductId: string; standardManufacturerProductId: string };
} | null {
  if (!productIdsComplete(p)) return null;
  const merchant = tidy(p!.merchant);
  return {
    regulationCode: 'EU_DE_MINIMIS',
    productId: merchant,
    productIdType: 'SKU',
    details: {
      merchantProductId: merchant,
      nonStandardManufacturerProductId: tidy(p!.manufacturer),
      standardManufacturerProductId: normalizeGtin(p!.gtin) || NO_STANDARD_ID,
    },
  };
}

// ─── IOSS ────────────────────────────────────────────────────────────────────────────────────────

/** Etsy's EU IOSS number: valid only on orders where Etsy collected the EU VAT. */
export const ETSY_IOSS = 'IM3720000224';
const IOSS_RE = /^IM\d{10}$/;

export function isIoss(v: unknown): boolean {
  return IOSS_RE.test(String(v ?? '').trim().toUpperCase());
}

/** The first IOSS number in a marketplace payload: eBay `ebayReference {name:'IOSS', value}` or any *ioss* field. */
function findIoss(raw: unknown, depth = 0): string {
  if (!raw || typeof raw !== 'object' || depth > 8) return '';
  if (Array.isArray(raw)) {
    for (const v of raw) { const f = findIoss(v, depth + 1); if (f) return f; }
    return '';
  }
  const o = raw as Record<string, unknown>;
  if (String(o.name ?? '').toUpperCase() === 'IOSS' && isIoss(o.value)) return String(o.value).trim().toUpperCase();
  for (const [k, v] of Object.entries(o)) {
    if (/ioss/i.test(k) && isIoss(v)) return String(v).trim().toUpperCase();
    if (v && typeof v === 'object') { const f = findIoss(v, depth + 1); if (f) return f; }
  }
  return '';
}

export type IossSource = 'marketplace' | 'etsy' | 'seller' | 'none';

/**
 * IOSS for a parcel to the EU, in order: the number the marketplace put on the order (eBay collected the VAT), Etsy's
 * number when the Etsy receipt shows VAT collected, the seller's own IOSS (settings), else none. Never for non-EU.
 */
export function suggestIoss(input: { country: string; marketplace?: string | null; rawData?: unknown; sellerIoss?: string | null }): { ioss: string; source: IossSource } {
  if (!isEuCountry(input.country)) return { ioss: '', source: 'none' };
  const fromOrder = findIoss(input.rawData);
  if (fromOrder) return { ioss: fromOrder, source: 'marketplace' };
  const mp = String(input.marketplace ?? '').toLowerCase();
  const rd = (input.rawData && typeof input.rawData === 'object' ? input.rawData : {}) as Record<string, any>;
  const vat = rd.total_vat_cost;
  const vatAmount = vat && typeof vat === 'object' ? Number(vat.amount) : Number(vat);
  if (mp === 'etsy' && Number.isFinite(vatAmount) && vatAmount > 0) return { ioss: ETSY_IOSS, source: 'etsy' };
  if (isIoss(input.sellerIoss)) return { ioss: String(input.sellerIoss).trim().toUpperCase(), source: 'seller' };
  return { ioss: '', source: 'none' };
}
