// lib/orders/manualOrder.ts — orders §2.7 / §13 G5. Pure model for the ManualOrderPanel: form state, validation,
// the `POST /api/orders/manual` payload (byte-compatible with today's `ManualOrderData`, pages/api/orders/manual.ts),
// the account base currency (never a hard "USD") and the error classifier (A8 `DUPLICATE_ORDER_NUMBER`).
// No React, no fetch: everything here is unit-tested in test/orders/g5-manualOrder.test.ts.

import { US_STATES as REGION_US_STATES, CA_PROVINCES as REGION_CA_PROVINCES } from '@/lib/shipping/regions';

/** One line item exactly as `POST /api/orders/manual` reads it today. */
export interface ManualOrderItemPayload {
  productName: string;
  quantity: number;
  unitPrice: number;
  weight: number;
  sku: string;
  hsCode: string;
  countryOfOrigin: string;
}

/** Request body of `POST /api/orders/manual` (same keys and types as the legacy `ManualOrderData`). */
export interface ManualOrderPayload {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  orderNumber: string;
  currency: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  items: ManualOrderItemPayload[];
}

export interface ManualOrderItemForm {
  /** Stable React key; never sent. */
  key: string;
  productName: string;
  sku: string;
  unitPrice: number | null;
  quantity: number | null;
  /** kg. */
  weight: number | null;
  /** Not rendered in v1 (customs live in Create label); sent as today. */
  hsCode: string;
  countryOfOrigin: string;
}

export interface ManualOrderForm {
  customerName: string;
  customerEmail: string;
  /** E.164 from PhoneInput, '' when empty. */
  customerPhone: string;
  orderNumber: string;
  /** null = follow the account base currency (resolved when the payload is built). */
  currency: string | null;
  country: string | null;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal: string;
  items: ManualOrderItemForm[];
}

export interface ManualOrderDefaults {
  /** Delivery country preselected (seller's country, else the locale default). '' = none. */
  country: string;
  /** Item country of origin (seller's country, else the locale default). */
  countryOfOrigin: string;
}

/** Legacy default per item (ManualOrderForm.tsx): 1 piece, 0.5 kg. */
export const DEFAULT_ITEM_WEIGHT_KG = 0.5;

let itemSeq = 0;
export function newItemKey(): string {
  itemSeq += 1;
  return `item-${Date.now().toString(36)}-${itemSeq}`;
}

export function emptyItem(countryOfOrigin: string, key: string = newItemKey()): ManualOrderItemForm {
  return { key, productName: '', sku: '', unitPrice: null, quantity: 1, weight: DEFAULT_ITEM_WEIGHT_KG, hsCode: '', countryOfOrigin };
}

export function emptyManualOrder(defaults: ManualOrderDefaults, itemKey?: string): ManualOrderForm {
  return {
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    orderNumber: '',
    currency: null,
    country: defaults.country || null,
    street1: '',
    street2: '',
    city: '',
    state: '',
    postal: '',
    items: [emptyItem(defaults.countryOfOrigin, itemKey)],
  };
}

/** Snapshot without React keys, for the dirty check. */
export function formSnapshot(form: ManualOrderForm): string {
  return JSON.stringify({ ...form, items: form.items.map(({ key: _key, ...rest }) => rest) });
}

// ── Account base currency ───────────────────────────────────────────────────────────────────────────

export interface BaseCurrencyInput {
  /** `ShipperProfile` from `GET /api/user/settings` (may be missing). */
  shipperProfile?: { defaultCurrencyCode?: string | null; shipperCountryCode?: string | null } | null;
  /** UI-locale fallback (`getLocaleConfig(locale).defaultCurrency`: TRY for tr, USD for en). */
  localeCurrency: string;
}

const EURO_COUNTRIES = new Set([
  'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
]);
const COUNTRY_CURRENCY: Record<string, string> = {
  TR: 'TRY', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', JP: 'JPY', AE: 'AED', SA: 'SAR', IL: 'ILS', MX: 'MXN', BR: 'BRL', IN: 'INR',
};

export function currencyForCountry(country: string | null | undefined): string | null {
  const c = (country ?? '').trim().toUpperCase();
  if (!c) return null;
  if (EURO_COUNTRIES.has(c)) return 'EUR';
  return COUNTRY_CURRENCY[c] ?? null;
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

/**
 * The seller's base currency (DS §3.7 "TRY for TR sellers"). `ShipperProfile.defaultCurrencyCode` defaults to
 * "USD" in the schema, so a stored "USD" is not a choice: it is used only when nothing better is known.
 * 1. a stored non-USD code (an explicit choice, e.g. EUR) · 2. the sender country's currency (TR → TRY) ·
 * 3. a stored "USD" when the sender country is set but unmapped · 4. the UI-locale currency (TRY in the TR UI).
 */
export function resolveBaseCurrency({ shipperProfile, localeCurrency }: BaseCurrencyInput): string {
  const stored = (shipperProfile?.defaultCurrencyCode ?? '').trim().toUpperCase();
  if (ISO_CURRENCY.test(stored) && stored !== 'USD') return stored;
  const byCountry = currencyForCountry(shipperProfile?.shipperCountryCode);
  if (byCountry) return byCountry;
  if (stored === 'USD' && (shipperProfile?.shipperCountryCode ?? '').trim()) return 'USD';
  return localeCurrency;
}

/** Delivery-country and origin defaults: the sender country, else the locale default (legacy behavior). */
export function resolveManualDefaults(
  shipperProfile: { shipperCountryCode?: string | null } | null | undefined,
  localeCountry: string,
): ManualOrderDefaults {
  const c = (shipperProfile?.shipperCountryCode ?? '').trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(c) ? c : localeCountry;
  return { country, countryOfOrigin: country };
}

// ── State / province ────────────────────────────────────────────────────────────────────────────────

const toOptions = (list: ReadonlyArray<[string, string]>) => list.map(([value, label]) => ({ value, label }));

export const US_STATES: ReadonlyArray<{ value: string; label: string }> = toOptions(REGION_US_STATES);

export const CA_PROVINCES: ReadonlyArray<{ value: string; label: string }> = toOptions(REGION_CA_PROVINCES);

/** US and CA pick from a list and require it; elsewhere the state is optional free text. */
export function stateOptionsFor(country: string | null): ReadonlyArray<{ value: string; label: string }> | null {
  if (country === 'US') return US_STATES;
  if (country === 'CA') return CA_PROVINCES;
  return null;
}

/** On a country change, drop a state code that belongs to the old country's list (legacy behavior, plus CA). */
export function stateAfterCountryChange(prevCountry: string | null, nextCountry: string | null, state: string): string {
  if (prevCountry === nextCountry) return state;
  const prevList = stateOptionsFor(prevCountry);
  const nextList = stateOptionsFor(nextCountry);
  if (prevList && prevList.some((s) => s.value === state)) return '';
  if (nextList && !nextList.some((s) => s.value === state)) return '';
  return state;
}

// ── Validation ──────────────────────────────────────────────────────────────────────────────────────

export type ManualErrorCode = 'required' | 'positive' | 'duplicate';
/** Field keys: top-level names, or `items.<index>.<field>`. Ordered as rendered, so the first one gets focus. */
export type ManualErrors = Record<string, ManualErrorCode>;

export function validateManualOrder(form: ManualOrderForm): ManualErrors {
  const e: ManualErrors = {};
  if (!form.customerName.trim()) e.customerName = 'required';
  if (!form.orderNumber.trim()) e.orderNumber = 'required';
  if (!form.country) e.country = 'required';
  if (!form.street1.trim()) e.street1 = 'required';
  if (!form.city.trim()) e.city = 'required';
  if (!form.postal.trim()) e.postal = 'required';
  if (stateOptionsFor(form.country) && !form.state.trim()) e.state = 'required';
  form.items.forEach((item, i) => {
    if (!item.productName.trim()) e[`items.${i}.productName`] = 'required';
    if (item.unitPrice == null) e[`items.${i}.unitPrice`] = 'required';
    else if (!(item.unitPrice > 0)) e[`items.${i}.unitPrice`] = 'positive';
    if (item.quantity == null) e[`items.${i}.quantity`] = 'required';
    else if (!(item.quantity > 0)) e[`items.${i}.quantity`] = 'positive';
    if (item.weight == null) e[`items.${i}.weight`] = 'required';
    else if (!(item.weight > 0)) e[`items.${i}.weight`] = 'positive';
  });
  return e;
}

/** Σ unitPrice × quantity (empty values count as 0). One currency per order, so this is safe to sum. */
export function manualOrderTotal(items: ReadonlyArray<Pick<ManualOrderItemForm, 'unitPrice' | 'quantity'>>): number {
  const cents = items.reduce((sum, i) => sum + Math.round((i.unitPrice ?? 0) * (i.quantity ?? 0) * 100), 0);
  return cents / 100;
}

// ── Payload ─────────────────────────────────────────────────────────────────────────────────────────

/** Builds the exact `ManualOrderData` body. Call only after `validateManualOrder` returned no errors. */
export function buildManualOrderPayload(form: ManualOrderForm, baseCurrency: string): ManualOrderPayload {
  return {
    customerName: form.customerName.trim(),
    customerEmail: form.customerEmail.trim(),
    customerPhone: form.customerPhone.trim(),
    orderNumber: form.orderNumber.trim(),
    currency: form.currency || baseCurrency,
    street1: form.street1.trim(),
    street2: form.street2.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    postal: form.postal.trim(),
    country: form.country ?? '',
    items: form.items.map((i) => ({
      productName: i.productName.trim(),
      quantity: i.quantity ?? 0,
      unitPrice: i.unitPrice ?? 0,
      weight: i.weight ?? 0,
      sku: i.sku.trim(),
      hsCode: i.hsCode.trim(),
      countryOfOrigin: i.countryOfOrigin,
    })),
  };
}

// ── Response ────────────────────────────────────────────────────────────────────────────────────────

export const DUPLICATE_ORDER_NUMBER = 'DUPLICATE_ORDER_NUMBER';
/** The pre-A8 hard-coded server text (manual.ts L90 / L196); matched only until A8 is deployed everywhere. */
const LEGACY_DUPLICATE_TEXT = 'Bu sipariş numarası zaten mevcut';

export type ManualSubmitResult =
  | { kind: 'created'; orderId: string; orderNumber: string }
  | { kind: 'duplicate' }
  | { kind: 'auth' }
  /** Server `error` text is never surfaced: manual.ts sends hard-coded Turkish copy, so the UI always shows its own i18n body. */
  | { kind: 'failed'; status: number };

export function classifyManualResponse(status: number, body: unknown): ManualSubmitResult {
  const b = (body && typeof body === 'object' ? body : {}) as {
    order?: { id?: unknown; orderNumber?: unknown };
    error?: unknown;
    code?: unknown;
  };
  if (status >= 200 && status < 300 && b.order && typeof b.order.id === 'string') {
    return { kind: 'created', orderId: b.order.id, orderNumber: typeof b.order.orderNumber === 'string' ? b.order.orderNumber : '' };
  }
  if (b.code === DUPLICATE_ORDER_NUMBER || (status === 400 && b.error === LEGACY_DUPLICATE_TEXT)) return { kind: 'duplicate' };
  if (status === 401) return { kind: 'auth' };
  return { kind: 'failed', status };
}

/** SWR key matcher for every orders cache entry under the `/api/orders` prefix (list `?…`, detail `/…`, G1 enrichment
 *  `#enrichment?…`; string or array keys). `/api/ordersx`-style siblings do not match. */
export function isOrdersKey(key: unknown): boolean {
  const k = typeof key === 'string' ? key : Array.isArray(key) && typeof key[0] === 'string' ? key[0] : '';
  return /^\/api\/orders(?:$|[?/#])/.test(k);
}
