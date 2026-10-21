// lib/shipping/labelDraft.ts — orders §6.1 (frozen contract) / §13 G4.
// One carrier-neutral model for the CreateLabelPanel, the three submit adapters and the bulk runner.
// Pure: no React, no fetch. `draftFromOrder` holds the prefill rules of §6.1; the submit contract
// (`LabelStep`, `LabelSubmitResult`, `executeSteps`) is shared by `lib/shipping/submit/{fedex,ups,dhl}.ts`.

/** 'dhl' = DHL eCommerce (MNG API). Never "MNG Kargo" in the UI. */
import { EU_COUNTRIES, defaultProductIds, suggestIoss, type ProductIds } from './euPid';

export type CarrierKey = 'fedex' | 'ups' | 'dhl';
export const CARRIER_KEYS: readonly CarrierKey[] = ['fedex', 'ups', 'dhl'];

export interface ShipTo {
  name: string;
  /** E.164 when known ("+15550134"); whatever the order had otherwise. Never the seller's phone. */
  phone: string;
  email: string;
  /** ISO 3166-1 alpha-2 ("US"), '' when unknown. */
  country: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal: string;
  /** TR only (DHL eCommerce). */
  district: string;
  neighbourhood: string;
}
export type ShipToField = keyof ShipTo;

export interface LabelPackage {
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  /** Carrier packaging code (FEDEX_PACKAGING_TYPES / UPS_PACKAGE_TYPES / MNG packagingType as string). */
  packaging: string;
}

export interface CustomsItem {
  itemId: string;
  description: string;
  hsCode: string;
  quantity: number;
  unitValue: number;
  /** ISO2 country of origin. */
  origin: string;
  /** Additive (not in the §6.1 sketch): carried to FedEx `line_items[].sku`, as the legacy body did. */
  sku?: string;
  /** Additive: the item's own weight per unit (kg) as loaded; FedEx/UPS line weights. */
  weightKg?: number;
  /** Additive: marketplace listing id (Etsy listing / eBay item), the merchant-ID fallback when there is no SKU. */
  listingRef?: string;
  /** EU product identifiers (lib/shipping/euPid.ts), prefilled for every line, sent only to EU destinations. */
  pid?: ProductIds;
}

export type ExportReason = 'SALE' | 'GIFT' | 'SAMPLE' | 'RETURN' | 'REPAIR';
export const EXPORT_REASONS: readonly ExportReason[] = ['SALE', 'GIFT', 'SAMPLE', 'RETURN', 'REPAIR'];

export interface LabelCustoms {
  items: CustomsItem[];
  currency: string;
  terms: 'DAP' | 'DDP';
  exportReason: ExportReason;
  ioss: string;
  vat: string;
  invoiceNumber: string;
  sendEtgb: boolean;
}

export interface DhlOptions {
  paymentType: number;
  deliveryType: number;
  packagingType: number;
  cod: boolean;
  codAmount: number;
  smsShipped: boolean;
  smsDelivered: boolean;
  content: string;
}

export interface LabelOptions {
  sendTracking: boolean;
  signature: string;
  labelStock: string;
  dhl?: DhlOptions;
  /** Additive: order-level FedEx values the legacy body forwarded (`fedexPickupType`, ETD flag). */
  fedex?: { pickupType: string; sendCommercialInvoiceViaEtd: boolean };
}

export interface LabelDraft {
  orderId: string;
  orderNumber: string;
  marketplace: string;
  shipTo: ShipTo;
  pkg: LabelPackage;
  carrier: CarrierKey;
  /** FEDEX service type / UPS code / DHL serviceType (as string). */
  service: string;
  customs: LabelCustoms;
  options: LabelOptions;
}

/** `shippingSettings.packagePresets[]` (orders §6.5, max 20). */
export interface PackagePreset {
  id: string;
  name: string;
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  packaging?: Partial<Record<CarrierKey, string>>;
  isDefault?: boolean;
}
export const MAX_PACKAGE_PRESETS = 20;

/** `ShipperProfile` as `GET /api/user/settings` returns it (strings; numbers may arrive as strings). */
export interface SenderProfile {
  shipperName?: string | null;
  shipperPersonName?: string | null;
  shipperPhoneNumber?: string | null;
  shipperStreet1?: string | null;
  shipperStreet2?: string | null;
  shipperCity?: string | null;
  shipperStateCode?: string | null;
  shipperPostalCode?: string | null;
  shipperCountryCode?: string | null;
  defaultCurrencyCode?: string | null;
  defaultWeightKg?: number | string | null;
  defaultServiceType?: string | null;
  defaultPackagingType?: string | null;
  dutiesPaymentType?: string | null;
  defaultCountryOfMfg?: string | null;
  defaultHarmonizedCode?: string | null;
}

// ─── Order input ────────────────────────────────────────────────────────────────────────────────

/** The `GET /api/orders` order object (`LocalUIOrder`), only the fields the label flow reads. */
export interface RawOrderLike {
  id?: string;
  orderNumber?: string | null;
  marketplace?: string | null;
  currency?: string | null;
  orderTotalPrice?: number | string | null;
  recipientFirstName?: string | null;
  recipientLastName?: string | null;
  customerName?: string | null;
  recipientStreet1?: string | null;
  recipientStreet2?: string | null;
  recipientCity?: string | null;
  recipientState?: string | null;
  recipientPostal?: string | null;
  recipientCountry?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  customerEmail?: string | null;
  shippingAddress?: unknown;
  rawData?: unknown;
  line_items?: Array<{
    id?: string;
    title?: string | null;
    value?: number | string | null;
    quantity?: number | null;
    weight?: number | null;
    hs_code?: string | null;
    country_of_origin?: string | null;
    sku?: string | null;
    listingRef?: string | null;
  } | null> | null;
  termsOfSale?: string | null;
  sendCommercialInvoiceViaEtd?: boolean | null;
  fedexPickupType?: string | null;
  fedexServiceType?: string | null;
  fedexPackagingType?: string | null;
  labelStockType?: string | null;
  signatureType?: string | null;
  packageLength?: number | null;
  packageWidth?: number | null;
  packageHeight?: number | null;
}

/**
 * What the label flow needs from an `OrderRow` (lib/orders/types.ts, G1). Structural on purpose: every field
 * is optional except the ids, and `raw` (the API order, kept on OrderRow until A6) is the fallback source,
 * so a field G1 names differently only loses its preferred source, never the value.
 */
export interface LabelOrderInput {
  id: string;
  orderNumber?: string | null;
  marketplace?: string | null;
  currency?: string | null;
  total?: number | null;
  shipTo?: Partial<Record<ShipToField, string | null | undefined>> | null;
  items?: Array<{
    id?: string; title?: string | null; sku?: string | null; quantity?: number | null;
    unitPrice?: number | null; weightKg?: number | null; hsCode?: string | null; originCountry?: string | null;
  } | null> | null;
  isFBA?: boolean;
  /** Canonical store (lib/marketplaces/canonical.ts): `marketplace` is 'etsy' even when `Order.marketplace` is a shop name. */
  store?: { marketplace?: string | null } | null;
  raw?: RawOrderLike | null;
}

// ─── Small pure helpers ─────────────────────────────────────────────────────────────────────────

export const clean = (v: unknown): string => {
  if (v == null) return '';
  const s = String(v).trim();
  return s === '—' || s === '-' || s.toLowerCase() === 'n/a' ? '' : s;
};

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const round2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** Split at the LAST space ("Mary Ann Smith" → "Mary Ann" / "Smith"); one word → first name only. */
export function splitName(full: string): { first: string; last: string } {
  const s = clean(full).replace(/\s+/g, ' ');
  const i = s.lastIndexOf(' ');
  if (i <= 0) return { first: s, last: '' };
  return { first: s.slice(0, i), last: s.slice(i + 1) };
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US', 'u.s.a.': 'US', 'u.s.': 'US', america: 'US', 'united states of america': 'US',
  uk: 'GB', 'u.k.': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'great britain': 'GB',
  turkey: 'TR', türkiye: 'TR', turkiye: 'TR', holland: 'NL', 'the netherlands': 'NL', deutschland: 'DE',
  'south korea': 'KR', 'republic of korea': 'KR', czechia: 'CZ', 'russian federation': 'RU',
  "people's republic of china": 'CN', prc: 'CN', uae: 'AE', 'u.a.e.': 'AE',
};

let nameIndex: Map<string, string> | null = null;
function countryNameIndex(): Map<string, string> {
  if (nameIndex) return nameIndex;
  const idx = new Map<string, string>();
  try {
    const dn = ['en', 'tr'].map((l) => new Intl.DisplayNames([l], { type: 'region', fallback: 'none' }));
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        for (const d of dn) {
          const name = d.of(code);
          if (name && name !== code) idx.set(name.toLowerCase(), code);
        }
      }
    }
  } catch {
    /* no Intl.DisplayNames: aliases only */
  }
  nameIndex = idx;
  return idx;
}

/** Country name or code → ISO2 ('' when unknown). Same intent as the legacy `getCountryCode`/`resolveEtsyCountryCode`. */
export function toIso2(input: unknown): string {
  const s = clean(input);
  if (!s) return '';
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const k = s.toLowerCase();
  return COUNTRY_ALIASES[k] ?? countryNameIndex().get(k) ?? '';
}

/** EU member states (IOSS applies). */
// One list for the label panel, validation and the EU product-identifier rule (lib/shipping/euPid.ts).
export { EU_COUNTRIES };
/** State/province is required for these recipient countries (FedEx/UPS). */
export const STATE_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set(['US', 'CA']);

export function senderCountry(sender: SenderProfile | null | undefined): string {
  return toIso2(sender?.shipperCountryCode) || '';
}

/** International = recipient country differs from the sender country (unknown sender → TR, the product's home). */
export function isInternational(draft: Pick<LabelDraft, 'shipTo'>, sender: SenderProfile | null | undefined): boolean {
  const from = senderCountry(sender) || 'TR';
  const to = draft.shipTo.country;
  return !!to && to !== from;
}

export function isManualOrder(marketplace: string | null | undefined): boolean {
  const m = (marketplace || '').toLowerCase();
  return m === 'manual' || m === 'manuel' || m.startsWith('manual');
}

/**
 * Marketplaces `POST /api/orders/:id/submit-tracking` can push to. The route has Etsy, eBay, Amazon and Wix
 * branches; everything else falls into its Veeqo branch (Veeqo orders, and Etsy shops stored under the shop
 * name, which the route resolves itself → `other`). Trendyol, Shopify and Hepsiburada have no branch: their
 * orders would hit the Veeqo path and always report "nothing pushed", so the option is not offered for them.
 */
const NO_TRACKING_PUSH = new Set(['trendyol', 'shopify', 'hepsiburada']);
export function canPushTracking(marketplace: string | null | undefined): boolean {
  if (isManualOrder(marketplace)) return false;
  return !NO_TRACKING_PUSH.has(marketplaceSelectKey(marketplace));
}

/** Marketplace key for ICU selects (`{mp, select, etsy {…} …}`). */
export function marketplaceSelectKey(marketplace: string | null | undefined): string {
  const m = (marketplace || '').toLowerCase();
  for (const k of ['etsy', 'ebay', 'amazon', 'trendyol', 'wix', 'shopify', 'hepsiburada']) if (m.includes(k)) return k;
  return 'other';
}

// ─── Raw order → address ────────────────────────────────────────────────────────────────────────

function parseJson(v: unknown): Record<string, any> | null {
  if (!v) return null;
  if (typeof v === 'object') return Array.isArray(v) ? null : (v as Record<string, any>);
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Address from the API order: flattened `recipient*`, then `shippingAddress` JSON, Wix contact, Trendyol `shipmentAddress`. */
export function shipToFromRaw(raw: RawOrderLike | null | undefined): ShipTo {
  const r = raw || {};
  const sa = parseJson(r.shippingAddress) || {};
  const rd = parseJson(r.rawData) || {};
  const ty = (rd.shipmentAddress && typeof rd.shipmentAddress === 'object' ? rd.shipmentAddress : {}) as Record<string, any>;
  const wix = (rd.recipientInfo || rd.shippingInfo?.logistics?.shippingDestination || {}) as Record<string, any>;
  const wixContact = (wix.contactDetails || {}) as Record<string, any>;
  const wixAddr = (wix.address || {}) as Record<string, any>;

  const first = clean(r.recipientFirstName) || clean(sa.firstName);
  const last = clean(r.recipientLastName) || clean(sa.lastName);
  const joined = `${first} ${last}`.trim();
  const name = joined || clean(r.customerName) || clean(sa.name) || clean(ty.fullName)
    || `${clean(wixContact.firstName)} ${clean(wixContact.lastName)}`.trim();

  return {
    name,
    phone: clean(r.recipientPhone) || clean(sa.phone) || clean(ty.phone) || clean(wixContact.phone),
    email: clean(r.recipientEmail) || clean(sa.email) || clean(r.customerEmail) || clean(rd.buyerInfo?.email),
    country: toIso2(clean(r.recipientCountry) || clean(sa.country) || clean(ty.countryCode) || clean(wixAddr.country)),
    street1: clean(r.recipientStreet1) || clean(sa.street1) || clean(ty.address1) || clean(ty.fullAddress)
      || clean(wixAddr.addressLine) || clean(wixAddr.addressLine1),
    street2: clean(r.recipientStreet2) || clean(sa.street2) || clean(ty.address2) || clean(wixAddr.addressLine2),
    city: clean(r.recipientCity) || clean(sa.city) || clean(ty.city) || clean(wixAddr.city),
    state: clean(r.recipientState) || clean(sa.state) || clean(wixAddr.subdivision),
    postal: clean(r.recipientPostal) || clean(sa.postal) || clean(sa.postalCode) || clean(ty.postalCode) || clean(wixAddr.postalCode),
    // Manual TR orders keep the district in the state field (Turkey has no states).
    district: clean(ty.district) || clean(sa.district)
      || (toIso2(clean(r.recipientCountry) || clean(sa.country) || clean(ty.countryCode) || clean(wixAddr.country)) === 'TR' ? clean(r.recipientState) : ''),
    neighbourhood: clean(ty.neighborhood) || clean(ty.neighbourhood) || clean(sa.neighbourhood),
  };
}

const SHIP_TO_FIELDS: ShipToField[] = ['name', 'phone', 'email', 'country', 'street1', 'street2', 'city', 'state', 'postal', 'district', 'neighbourhood'];

/** Row (`OrderRow.shipTo`, preferred) merged over the raw order, field by field. */
export function resolveShipTo(order: LabelOrderInput): ShipTo {
  const base = shipToFromRaw(order.raw);
  const row = order.shipTo || {};
  const out = { ...base };
  for (const f of SHIP_TO_FIELDS) {
    const v = clean(row[f]);
    if (v) out[f] = f === 'country' ? toIso2(v) || base.country : v;
  }
  return out;
}

/** One customs line per order item (§6.1: today's drawers sent one line for multi-item orders). */
export function customsItemsFromOrder(order: LabelOrderInput, defaultOrigin: string): CustomsItem[] {
  const rawItems = (order.raw?.line_items || []).filter(Boolean) as NonNullable<NonNullable<RawOrderLike['line_items']>[number]>[];
  const rowItems = (order.items || []).filter(Boolean) as NonNullable<NonNullable<LabelOrderInput['items']>[number]>[];
  const n = Math.max(rawItems.length, rowItems.length);
  const out: CustomsItem[] = [];
  for (let i = 0; i < n; i++) {
    const ri = rawItems[i] || {};
    const oi = rowItems[i] || {};
    const quantity = Math.max(1, Math.round(num(oi.quantity) ?? num(ri.quantity) ?? 1));
    out.push({
      itemId: clean(oi.id) || clean(ri.id),
      description: clean(oi.title) || clean(ri.title) || 'Product',
      hsCode: clean(oi.hsCode) || clean(ri.hs_code),
      quantity,
      unitValue: round2(num(oi.unitPrice) ?? num(ri.value) ?? 0),
      origin: toIso2(clean(oi.originCountry) || clean(ri.country_of_origin)) || defaultOrigin,
      sku: clean(oi.sku) || clean(ri.sku) || undefined,
      weightKg: num(oi.weightKg) ?? num(ri.weight) ?? undefined,
      listingRef: clean(ri.listingRef) || undefined,
      pid: defaultProductIds({ sku: clean(oi.sku) || clean(ri.sku), listingRef: clean(ri.listingRef), itemId: clean(oi.id) || clean(ri.id) }),
    });
  }
  if (out.length === 0) {
    const total = num(order.total) ?? num(order.raw?.orderTotalPrice) ?? 0;
    out.push({ itemId: '', description: 'Product', hsCode: '', quantity: 1, unitValue: round2(total), origin: defaultOrigin });
  }
  return out;
}

export function customsTotal(items: readonly CustomsItem[]): number {
  return round2(items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitValue) || 0), 0));
}

/** Σ items weight × qty (only when every item has a real weight; the API's 0.01 placeholder counts as unknown). */
export function itemsWeightKg(items: readonly CustomsItem[]): number | null {
  if (items.length === 0) return null;
  let sum = 0;
  for (const i of items) {
    if (i.weightKg == null || !(i.weightKg > 0.01)) return null;
    sum += i.weightKg * (i.quantity || 1);
  }
  return round2(sum) > 0 ? Math.round(sum * 1000) / 1000 : null;
}

// ─── Defaults per carrier (mirrors lib/shipping/carriers.ts catalog; kept here to avoid an import cycle) ────

export const DEFAULT_SERVICE: Record<CarrierKey, string> = { fedex: 'INTERNATIONAL_PRIORITY', ups: '65', dhl: '1' };
export const DEFAULT_PACKAGING: Record<CarrierKey, string> = { fedex: 'FEDEX_PAK', ups: 'UPS_PAK', dhl: '1' };
export const DEFAULT_SIGNATURE: Record<CarrierKey, string> = { fedex: 'NO_SIGNATURE_REQUIRED', ups: 'NO_SIGNATURE', dhl: '' };
export const DEFAULT_LABEL_STOCK = 'PAPER_LETTER';
/** Stocks `PATCH /api/orders/:id/update-options` accepts (`fedexOptionsData.labelStockTypes`); anything else is a 400. */
export const FEDEX_ACCEPTED_LABEL_STOCKS: readonly string[] = ['PAPER_4X6', 'STOCK_4X6', 'PAPER_LETTER'];

/** Duties terms from the sender profile (`dutiesPaymentType`: SENDER → DDP, else DAP), orders §6.1. */
export function profileTerms(sender: SenderProfile | null | undefined): 'DAP' | 'DDP' {
  return clean(sender?.dutiesPaymentType).toUpperCase() === 'SENDER' ? 'DDP' : 'DAP';
}
export const DEFAULT_WEIGHT_KG = 0.5;

export interface DraftContext {
  sender: SenderProfile | null | undefined;
  presets: readonly PackagePreset[];
  /** Carrier chosen by `pickDefaultCarrier` (carriers.ts); falls back to fedex. */
  carrier?: CarrierKey;
  /** Kept for the §6.1 signature; `pickDefaultCarrier` already applies it. */
  lastCarrier?: CarrierKey;
  baseCurrency: string;
  /** Remembered per viewer (localStorage); default true. */
  sendTracking?: boolean;
}

/** Service for a carrier: the sender's default when it belongs to that carrier, else the carrier default. */
export function serviceFor(carrier: CarrierKey, sender: SenderProfile | null | undefined, validServices: readonly string[]): string {
  const pref = clean(sender?.defaultServiceType);
  if (pref && validServices.includes(pref)) return pref;
  return DEFAULT_SERVICE[carrier];
}

export function packagingFor(carrier: CarrierKey, preset: PackagePreset | null | undefined, sender: SenderProfile | null | undefined, valid: readonly string[]): string {
  const fromPreset = preset?.packaging?.[carrier];
  if (fromPreset && valid.includes(fromPreset)) return fromPreset;
  const pref = clean(sender?.defaultPackagingType);
  if (pref && valid.includes(pref)) return pref;
  return DEFAULT_PACKAGING[carrier];
}

export function defaultPreset(presets: readonly PackagePreset[]): PackagePreset | null {
  return presets.find((p) => p.isDefault) ?? null;
}

/**
 * orders §6.1 prefill rules. `validServices`/`validPackaging` come from carriers.ts (passed in, so this module
 * stays import-free); omitted → the carrier defaults.
 */
export function draftFromOrder(
  row: LabelOrderInput,
  ctx: DraftContext,
  catalog?: { validServices?: (c: CarrierKey) => readonly string[]; validPackaging?: (c: CarrierKey) => readonly string[] },
): LabelDraft {
  const raw = row.raw || {};
  const sender = ctx.sender || {};
  const carrier: CarrierKey = ctx.carrier ?? ctx.lastCarrier ?? 'fedex';
  const services = catalog?.validServices?.(carrier) ?? [DEFAULT_SERVICE[carrier]];
  const packagings = catalog?.validPackaging?.(carrier) ?? [DEFAULT_PACKAGING[carrier]];
  const preset = defaultPreset(ctx.presets);
  const origin = toIso2(sender.defaultCountryOfMfg) || senderCountry(sender) || 'TR';
  const items = customsItemsFromOrder(row, origin);
  if (!items[0].hsCode && clean(sender.defaultHarmonizedCode)) {
    for (const it of items) if (!it.hsCode) it.hsCode = clean(sender.defaultHarmonizedCode);
  }

  const profileWeight = num(sender.defaultWeightKg);
  const weightKg = preset?.weightKg && preset.weightKg > 0
    ? preset.weightKg
    : itemsWeightKg(items) ?? (profileWeight && profileWeight > 0 ? profileWeight : DEFAULT_WEIGHT_KG);

  const orderNumber = clean(row.orderNumber) || clean(raw.orderNumber) || row.id;
  const marketplace = clean(row.store?.marketplace) || clean(row.marketplace) || clean(raw.marketplace);
  const currency = clean(row.currency) || clean(raw.currency) || ctx.baseCurrency || 'USD';
  const storedStock = clean(raw.labelStockType);
  const shipTo = resolveShipTo(row);
  // EU customs reform: the marketplace's IOSS when it collected the VAT (eBay on the order, Etsy's own number).
  const ioss = suggestIoss({ country: shipTo.country, marketplace, rawData: raw.rawData });

  return {
    orderId: row.id,
    orderNumber,
    marketplace,
    shipTo,
    pkg: {
      weightKg,
      lengthCm: preset?.lengthCm ?? num(raw.packageLength) ?? undefined,
      widthCm: preset?.widthCm ?? num(raw.packageWidth) ?? undefined,
      heightCm: preset?.heightCm ?? num(raw.packageHeight) ?? undefined,
      packaging: packagingFor(carrier, preset, sender, packagings),
    },
    carrier,
    service: serviceFor(carrier, sender, services),
    customs: {
      items,
      currency: currency.toUpperCase(),
      terms: profileTerms(sender),
      exportReason: 'SALE',
      ioss: ioss.ioss,
      vat: '',
      invoiceNumber: `INV-${orderNumber}`,
      sendEtgb: false,
    },
    options: {
      sendTracking: canPushTracking(marketplace) ? ctx.sendTracking ?? true : false,
      signature: DEFAULT_SIGNATURE[carrier],
      labelStock: FEDEX_ACCEPTED_LABEL_STOCKS.includes(storedStock) ? storedStock : DEFAULT_LABEL_STOCK,
      dhl: {
        paymentType: 1, deliveryType: 1, packagingType: 1, cod: false, codAmount: 0,
        smsShipped: true, smsDelivered: true, content: items[0]?.description || orderNumber,
      },
      fedex: {
        pickupType: clean(raw.fedexPickupType) || 'DROP_BOX',
        sendCommercialInvoiceViaEtd: raw.sendCommercialInvoiceViaEtd ?? true,
      },
    },
  };
}

/**
 * Switch carrier on an existing draft: service, packaging and signature move to the new carrier's values.
 * FedEx duties always follow the sender profile (generate-label reads only `ShipperProfile.dutiesPaymentType`),
 * so switching to FedEx resets `customs.terms` to the profile value.
 */
export function withCarrier(
  draft: LabelDraft,
  carrier: CarrierKey,
  service: string,
  ctx: { sender?: SenderProfile | null; presets?: readonly PackagePreset[]; validPackaging?: readonly string[] },
): LabelDraft {
  if (draft.carrier === carrier) return { ...draft, service };
  const valid = ctx.validPackaging ?? [DEFAULT_PACKAGING[carrier]];
  return {
    ...draft,
    carrier,
    service,
    pkg: { ...draft.pkg, packaging: packagingFor(carrier, defaultPreset(ctx.presets ?? []), ctx.sender, valid) },
    customs: carrier === 'fedex' ? { ...draft.customs, terms: profileTerms(ctx.sender) } : draft.customs,
    options: { ...draft.options, signature: DEFAULT_SIGNATURE[carrier] },
  };
}

/** Apply a package preset (weight, dimensions, packaging for the current carrier when the preset has one). */
export function applyPreset(draft: LabelDraft, preset: PackagePreset): LabelDraft {
  return {
    ...draft,
    pkg: {
      weightKg: preset.weightKg > 0 ? preset.weightKg : draft.pkg.weightKg,
      lengthCm: preset.lengthCm,
      widthCm: preset.widthCm,
      heightCm: preset.heightCm,
      packaging: preset.packaging?.[draft.carrier] || draft.pkg.packaging,
    },
  };
}

/**
 * Weight of one item line (the whole line, all units): the package weight for one line (legacy: item weight =
 * package weight); else the item's own per-unit weight × quantity; else the package weight shared by quantity.
 */
export function lineWeightKg(draft: LabelDraft, i: number): number {
  const items = draft.customs.items;
  if (items.length <= 1) return draft.pkg.weightKg;
  const qtyOf = (k: number) => (items[k].quantity > 0 ? items[k].quantity : 1);
  const own = items[i].weightKg;
  if (own != null && own > 0.01) return round2(own * qtyOf(i));
  const qty = items.reduce((s, _it, k) => s + qtyOf(k), 0) || 1;
  return round2((draft.pkg.weightKg * qtyOf(i)) / qty);
}

// ─── Submit contract (shared by the three adapters and the bulk runner) ─────────────────────────────

/** One HTTP call of a label submission. `kind` tells the runner how to read the answer. */
export interface LabelStep {
  url: string;
  init: { method: 'POST' | 'PATCH'; headers: Record<string, string>; body: string };
  /** `prepare` steps must be 2xx (FedEx order update / options); `label` is the metered create call. */
  kind: 'prepare' | 'label';
}

export interface LabelSuccess {
  ok: true;
  carrier: CarrierKey;
  trackingNumber: string;
  /** Openable href (http, /api path, data: URI) or null. */
  labelHref: string | null;
  barcode?: string | null;
  /** FedEx `labelData.alerts`, text only. */
  alerts?: string[];
}
export type LabelFailure =
  | { ok: false; kind: 'guard'; code: 'ORDER_CANCELLED' | 'ORDER_SHIPPED_EXTERNALLY' }
  | { ok: false; kind: 'limit' }
  | { ok: false; kind: 'error'; message: string; status?: number };
export type LabelSubmitResult = LabelSuccess | LabelFailure;

export interface SubmitContext {
  /** Retry after the CancelledOrderLabelDialog: adds `forceCancelled: true`. */
  forceCancelled?: boolean;
  /** UPS legacy body carried the session user id (the route ignores it; kept byte-compatible). */
  userId?: string;
  /** The sender's country (DHL eligibility is checked before; adapters do not read it). */
  senderCountry?: string;
}

/** Request header that keeps the global 402 dialog off (the panel shows the limit inline). Mirrors lib/http/limitInterceptor. */
export const INLINE_LIMIT_HEADERS: Record<string, string> = { 'x-kx-limit-ui': 'inline' };
export const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json', ...INLINE_LIMIT_HEADERS };

/** Carrier error text only: never JSON, at most 200 characters (orders §6.4). */
export function carrierMessage(body: unknown, fallback: string): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errs = Array.isArray(b.errors) ? (b.errors as unknown[]) : [];
  const fromErrors = errs
    .map((e) => (typeof e === 'string' ? e : e && typeof e === 'object' ? (e as Record<string, unknown>).message : null))
    .find((m): m is string => typeof m === 'string' && !!m.trim());
  const pick = [b.error, b.message, b.details, fromErrors].find((m): m is string => typeof m === 'string' && !!m.trim());
  const text = (pick ?? fallback).replace(/\s+/g, ' ').trim();
  const looksJson = /^[[{]/.test(text);
  const out = looksJson ? fallback : text;
  return out.length > 200 ? `${out.slice(0, 199)}…` : out;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.clone().json();
  } catch {
    try {
      const txt = await res.text();
      return { error: txt.slice(0, 200) };
    } catch {
      return null;
    }
  }
}

/**
 * Run the steps in order. `prepare` failures stop with their message; the `label` step's 409 guard,
 * 402 limit and errors map to `LabelFailure`; its JSON goes to `parse`.
 */
export async function executeSteps(
  steps: LabelStep[],
  parse: (body: unknown) => LabelSubmitResult,
  fetchImpl: typeof fetch = fetch,
): Promise<LabelSubmitResult> {
  for (const step of steps) {
    let res: Response;
    try {
      res = await fetchImpl(step.url, step.init);
    } catch (e) {
      return { ok: false, kind: 'error', message: e instanceof Error && e.message ? e.message.slice(0, 200) : 'Network error' };
    }
    if (res.status === 402) return { ok: false, kind: 'limit' };
    const body = await readJson(res);
    if (res.status === 409 && body && typeof body === 'object') {
      const code = (body as Record<string, unknown>).code;
      if (code === 'ORDER_CANCELLED' || code === 'ORDER_SHIPPED_EXTERNALLY') return { ok: false, kind: 'guard', code };
    }
    if (step.kind === 'prepare') {
      if (!res.ok) return { ok: false, kind: 'error', status: res.status, message: carrierMessage(body, `HTTP ${res.status}`) };
      continue;
    }
    if (!res.ok) return { ok: false, kind: 'error', status: res.status, message: carrierMessage(body, `HTTP ${res.status}`) };
    return parse(body);
  }
  return { ok: false, kind: 'error', message: 'No label request' };
}
