/**
 * Catalog draft field contract (marketplace-editors §6, §7.1): the `fieldPatch`
 * v2 keys each marketplace accepts, their validation, the queued actions
 * (incl. `create`) and the error codes. Pure and client-safe: no Prisma, no
 * Next, no marketplace client. `service.ts` re-exports everything here, so the
 * server keeps importing from `@/lib/catalogDrafts/service`; adapters and
 * other browser code import types and helpers from this file.
 *
 * Validation is hand-written (the repo has no declared `zod` dependency; see
 * the M6b-A notes). Every field error carries `params.field` = the canonical
 * key so the editor can attach it to the input.
 *
 * Canonical keys and accepted input aliases (an alias is normalised to the
 * canonical key on input and never stored):
 *   trendyol  salePrice → price
 *   wix       name → title
 *   shopify   body_html → description, product_type → productType,
 *             compare_at_price → compareAtPrice
 */

// ---------------------------------------------------------------------------
// Marketplaces and statuses
// ---------------------------------------------------------------------------

export const CATALOG_MARKETPLACES = ['trendyol', 'wix', 'shopify', 'hepsiburada'] as const;
export type CatalogMarketplace = (typeof CATALOG_MARKETPLACES)[number];

export function isCatalogMarketplace(v: unknown): v is CatalogMarketplace {
  return typeof v === 'string' && (CATALOG_MARKETPLACES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Field value types
// ---------------------------------------------------------------------------

/** One Trendyol category attribute: a listed value (`attributeValueId`) or a custom text value. */
export type TrendyolAttributeValue = { attributeId: number; attributeValueId?: number; customAttributeValue?: string };
export const TRENDYOL_VAT_RATES = [0, 1, 10, 20] as const;
export type TrendyolVatRate = (typeof TRENDYOL_VAT_RATES)[number];

/** Wix product discount. `NONE` (value 0) removes a discount. */
export type WixDiscount = { type: 'AMOUNT' | 'PERCENT' | 'NONE'; value: number };
export type WixCustomTextField = { title: string; maxLength: number; mandatory: boolean };
/** Wix media operations, applied in this order at send: remove → reorder (latest) → add (appended). */
export type WixMediaOp = { op: 'add'; url: string } | { op: 'remove'; mediaId: string } | { op: 'reorder'; ids: string[] };

/**
 * Shopify image operations, applied at send in this order: delete → add → reorder (latest per image) → alt
 * (latest per image). Adds take a public https `src` (KolayXport-hosted, signed); base64 `attachment` is not
 * staged (it would be stored in the draft row and re-sent on every autosave).
 */
export type ShopifyImageOp =
  | { op: 'add'; src: string; alt?: string; position?: number }
  | { op: 'delete'; id: string }
  | { op: 'reorder'; id: string; position: number }
  | { op: 'alt'; id: string; alt: string };
/** One variant edit. `compareAtPrice: null` clears it. `expectedQuantity` = the quantity the editor showed. */
export type ShopifyVariantEdit = {
  id: string;
  price?: number;
  compareAtPrice?: number | null;
  inventoryQuantity?: number;
  expectedQuantity?: number;
  sku?: string;
};
export type ShopifySeo = { title?: string; description?: string };
export const SHOPIFY_WEIGHT_UNITS = ['g', 'kg', 'lb', 'oz'] as const;
export type ShopifyWeightUnit = (typeof SHOPIFY_WEIGHT_UNITS)[number];

/**
 * Staged field values (union of all marketplaces; `ALLOWED_FIELDS` says which keys each one takes).
 * v1 keys (grid): title, price, quantity, tags, visible, status. Everything else is v2 (editor).
 */
export type CatalogFieldPatch = {
  /** Trendyol ≤ 100 · Wix ≤ 80 · Shopify ≤ 255. */
  title?: string;
  /** Major units. Trendyol: sale price. Wix: product price. Shopify: the single variant's price. */
  price?: number;
  /** Trendyol: stock. Wix: tracked quantity (single variant). Shopify: single variant, single location. */
  quantity?: number;
  /** Shopify. */
  tags?: string[];
  /** Wix. */
  visible?: boolean;
  /** Shopify. */
  status?: 'active' | 'draft' | 'archived';
  /** All three (HTML). Trendyol ≤ 30 000 · Wix ≤ 8 000 · Shopify ≤ 100 000 characters. */
  description?: string;
  /** Trendyol: ordered https URLs (1–8). Shopify: image operations. */
  images?: string[] | ShopifyImageOp[];
  // Trendyol
  listPrice?: number;
  vatRate?: TrendyolVatRate;
  stockCode?: string;
  /** Desi. */
  dimensionalWeight?: number;
  attributes?: TrendyolAttributeValue[];
  // Wix
  discount?: WixDiscount;
  /** Wix product SKU · Shopify single-variant SKU. */
  sku?: string;
  /** Wix product weight · Shopify single-variant weight (with `weightUnit`). */
  weight?: number;
  ribbon?: string;
  customTextFields?: WixCustomTextField[];
  trackInventory?: boolean;
  /** Wix, only while stock is not tracked. */
  inStock?: boolean;
  /** Wix: the target set of manual collections (the executor diffs it against the live product). */
  collectionIds?: string[];
  media?: WixMediaOp[];
  // Shopify
  vendor?: string;
  productType?: string;
  /** Single variant. 0 clears it. */
  compareAtPrice?: number;
  weightUnit?: ShopifyWeightUnit;
  seo?: ShopifySeo;
  variants?: ShopifyVariantEdit[];
  // Hepsiburada (listing-level: price/stock/dispatch go through the async inventory upload)
  /** Days to hand the package to cargo (Kargoya veriliş süresi). */
  dispatchTime?: number;
  /** Max units per order. */
  maxPurchasableQuantity?: number;
};
export type CatalogFieldKey = keyof CatalogFieldPatch;

/** Fields each marketplace accepts (marketplace-editors §6; v1 keys first). */
export const ALLOWED_FIELDS: Record<CatalogMarketplace, CatalogFieldKey[]> = {
  trendyol: ['price', 'quantity', 'title', 'description', 'images', 'attributes', 'stockCode', 'dimensionalWeight', 'listPrice', 'vatRate'],
  wix: [
    'title', 'price', 'quantity', 'visible', 'description', 'discount', 'sku', 'weight', 'ribbon', 'customTextFields',
    'trackInventory', 'inStock', 'collectionIds', 'media',
  ],
  shopify: [
    'title', 'price', 'quantity', 'tags', 'status', 'description', 'vendor', 'productType', 'compareAtPrice', 'sku',
    'weight', 'weightUnit', 'seo', 'variants', 'images',
  ],
  // Hepsiburada listings: content lives in HB's catalog (changed through a review ticket), so v1 stages only the
  // listing values the inventory upload takes.
  hepsiburada: ['price', 'quantity', 'dispatchTime', 'maxPurchasableQuantity'],
};

/** Input aliases → canonical key. */
export const FIELD_ALIASES: Record<CatalogMarketplace, Record<string, CatalogFieldKey>> = {
  trendyol: { salePrice: 'price' },
  wix: { name: 'title' },
  shopify: { body_html: 'description', product_type: 'productType', compare_at_price: 'compareAtPrice' },
  hepsiburada: { availableStock: 'quantity', maximumPurchasableQuantity: 'maxPurchasableQuantity' },
};

/** Canonical key for an input key (alias resolved), or the key itself. */
export function canonicalFieldKey(marketplace: CatalogMarketplace, key: string): string {
  return FIELD_ALIASES[marketplace][key] ?? key;
}

/** Trendyol keys sent through the product (content) update: an approved product may go back to review. */
export const TRENDYOL_CONTENT_KEYS: CatalogFieldKey[] = ['title', 'description', 'images', 'attributes', 'stockCode', 'dimensionalWeight', 'vatRate'];
/** Trendyol keys sent through price-and-inventory (async, a few minutes). */
export const TRENDYOL_PRICE_KEYS: CatalogFieldKey[] = ['price', 'listPrice', 'quantity'];
/** Keys that are operation lists, not values: never compared for conflicts (stale ids are skipped at send). */
export const OP_KEYS: CatalogFieldKey[] = ['media', 'images'];
/** Op-list keys per marketplace (Trendyol `images` is a value list, not ops). */
export function isOpKey(marketplace: CatalogMarketplace, key: string): boolean {
  return (marketplace === 'wix' && key === 'media') || (marketplace === 'shopify' && key === 'images');
}
/** Keys that change stock (refused while stock sync manages the product). */
export function touchesStock(patch: CatalogFieldPatch): boolean {
  return patch.quantity !== undefined
    || patch.inStock !== undefined
    || patch.trackInventory !== undefined
    || (Array.isArray(patch.variants) && patch.variants.some((v) => v.inventoryQuantity !== undefined));
}

// ---------------------------------------------------------------------------
// Queued actions
// ---------------------------------------------------------------------------

/** `unarchive` (Trendyol) restores an archived product; it is not a removal and rides alone like `archive`. */
export type CatalogQueuedActionType = 'archive' | 'unarchive' | 'delete' | 'create';
export type CatalogQueuedAction = {
  type: CatalogQueuedActionType;
  queuedAt: string;
  completedAt?: string;
  /** `create` only: create-only values (Trendyol brand, category, barcode, …). See CreatePayload types. */
  payload?: Record<string, unknown>;
};
export const ALLOWED_ACTIONS: Record<CatalogMarketplace, CatalogQueuedActionType[]> = {
  trendyol: ['archive', 'unarchive', 'create'],
  wix: ['delete', 'create'],
  shopify: ['delete', 'create'],
  // Products are created through HB's catalog import (pages/app/hepsiburada-urunler/new.tsx), not a staged draft.
  hepsiburada: [],
};

/** Trendyol create-only values (marketplace-editors §5.1, §6.1). Completeness is checked at send. */
export type TrendyolCreatePayload = {
  barcode?: string;
  /** Defaults to `stockCode` at send. */
  productMainId?: string;
  brandId?: number;
  categoryId?: number;
  cargoCompanyId?: number;
  shipmentAddressId?: number;
  returningAddressId?: number;
};
/** Wix create-only values. */
export type WixCreatePayload = { productType?: 'physical' | 'digital' };
/** Shopify create takes everything from `fieldPatch`; the payload is empty. */
export type ShopifyCreatePayload = Record<string, never>;

/** Externals ids of products that exist only as a staged create: `new:<id>`. */
export const NEW_ID_PREFIX = 'new:';
export function isNewExternalId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(NEW_ID_PREFIX) && id.length > NEW_ID_PREFIX.length;
}
export function hasPendingCreate(actions: CatalogQueuedAction[]): boolean {
  return actions.some((a) => a.type === 'create' && !a.completedAt);
}
export function hasQueuedDelete(actions: CatalogQueuedAction[]): boolean {
  return actions.some((a) => (a.type === 'delete' || a.type === 'archive') && !a.completedAt);
}
export function createPayloadOf(actions: CatalogQueuedAction[]): Record<string, unknown> {
  const a = actions.find((x) => x.type === 'create' && !x.completedAt);
  return a?.payload && typeof a.payload === 'object' ? a.payload : {};
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERR = 'listings.draftError';

export type CatalogDraftErrorCode =
  | 'UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'INVALID_MARKETPLACE'
  | 'STORE_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_NOT_EDITABLE'
  | 'FIELD_NOT_SUPPORTED'
  | 'ACTION_NOT_SUPPORTED'
  | 'INVALID_TITLE'
  | 'INVALID_PRICE'
  | 'INVALID_QUANTITY'
  | 'INVALID_TAGS'
  | 'INVALID_VISIBLE'
  | 'INVALID_STATUS'
  | 'INVALID_TEXT'
  | 'INVALID_NUMBER'
  | 'INVALID_IMAGES'
  | 'INVALID_ATTRIBUTES'
  | 'INVALID_VAT'
  | 'INVALID_DISCOUNT'
  | 'INVALID_TEXT_FIELDS'
  | 'INVALID_COLLECTIONS'
  | 'INVALID_MEDIA'
  | 'INVALID_VARIANTS'
  | 'INVALID_CREATE'
  | 'LIST_BELOW_SALE'
  | 'ARCHIVED'
  | 'IN_STOCK_TRACKED'
  | 'CREATE_DRAFT'
  | 'MULTI_VARIANT'
  | 'NOT_TRACKED'
  | 'STOCK_MANAGED'
  | 'DELETE_NOT_EXCLUSIVE'
  | 'SCHEDULE_INVALID'
  | 'SCHEDULE_DELETE_REFUSED'
  | 'DISCOUNTED'
  | 'REMOTE_MISSING'
  | 'REMOTE_FAILED'
  | 'TOO_MANY';

export const ERROR_META: Record<CatalogDraftErrorCode, { status: number; key: string }> = {
  UNAVAILABLE: { status: 503, key: `${ERR}.unavailable` },
  INVALID_INPUT: { status: 400, key: `${ERR}.invalidInput` },
  INVALID_MARKETPLACE: { status: 400, key: `${ERR}.invalidInput` },
  STORE_NOT_FOUND: { status: 404, key: `${ERR}.storeNotFound` },
  PRODUCT_NOT_FOUND: { status: 404, key: `${ERR}.productNotFound` },
  DRAFT_NOT_FOUND: { status: 404, key: `${ERR}.draftNotFound` },
  DRAFT_NOT_EDITABLE: { status: 409, key: `${ERR}.notEditable` },
  FIELD_NOT_SUPPORTED: { status: 400, key: `${ERR}.fieldNotSupported` },
  ACTION_NOT_SUPPORTED: { status: 400, key: `${ERR}.actionNotSupported` },
  INVALID_TITLE: { status: 400, key: `${ERR}.invalidTitle` },
  INVALID_PRICE: { status: 400, key: 'listings.validate.priceInvalid' },
  INVALID_QUANTITY: { status: 400, key: 'listings.validate.qtyInvalid' },
  INVALID_TAGS: { status: 400, key: `${ERR}.invalidTags` },
  INVALID_VISIBLE: { status: 400, key: `${ERR}.invalidInput` },
  INVALID_STATUS: { status: 400, key: `${ERR}.invalidInput` },
  INVALID_TEXT: { status: 400, key: `${ERR}.textTooLong` },
  INVALID_NUMBER: { status: 400, key: `${ERR}.invalidNumber` },
  INVALID_IMAGES: { status: 400, key: `${ERR}.invalidImages` },
  INVALID_ATTRIBUTES: { status: 400, key: `${ERR}.invalidAttributes` },
  INVALID_VAT: { status: 400, key: `${ERR}.invalidVat` },
  INVALID_DISCOUNT: { status: 400, key: `${ERR}.invalidDiscount` },
  INVALID_TEXT_FIELDS: { status: 400, key: `${ERR}.invalidTextFields` },
  INVALID_COLLECTIONS: { status: 400, key: `${ERR}.invalidCollections` },
  INVALID_MEDIA: { status: 400, key: `${ERR}.invalidMedia` },
  INVALID_VARIANTS: { status: 400, key: `${ERR}.invalidVariants` },
  INVALID_CREATE: { status: 400, key: `${ERR}.invalidCreate` },
  LIST_BELOW_SALE: { status: 400, key: `${ERR}.listBelowSale` },
  ARCHIVED: { status: 409, key: `${ERR}.archived` },
  IN_STOCK_TRACKED: { status: 409, key: `${ERR}.inStockTracked` },
  CREATE_DRAFT: { status: 409, key: `${ERR}.createDraft` },
  MULTI_VARIANT: { status: 409, key: 'listings.cell.variationsReadOnly' },
  NOT_TRACKED: { status: 409, key: `${ERR}.notTracked` },
  STOCK_MANAGED: { status: 409, key: `${ERR}.stockManaged` },
  DELETE_NOT_EXCLUSIVE: { status: 409, key: `${ERR}.deleteNotExclusive` },
  SCHEDULE_INVALID: { status: 400, key: `${ERR}.scheduleInvalid` },
  SCHEDULE_DELETE_REFUSED: { status: 409, key: `${ERR}.scheduleDeleteRefused` },
  DISCOUNTED: { status: 409, key: `${ERR}.wixDiscounted` },
  REMOTE_MISSING: { status: 404, key: `${ERR}.remoteMissing` },
  REMOTE_FAILED: { status: 502, key: `${ERR}.remoteFailed` },
  TOO_MANY: { status: 400, key: `${ERR}.tooMany` },
};

export class CatalogDraftError extends Error {
  code: CatalogDraftErrorCode;
  status: number;
  key: string;
  params?: Record<string, string | number>;

  constructor(code: CatalogDraftErrorCode, message?: string, params?: Record<string, string | number>) {
    super(message || code);
    this.name = 'CatalogDraftError';
    this.code = code;
    this.status = ERROR_META[code].status;
    this.key = ERROR_META[code].key;
    this.params = params;
  }
}

export function isCatalogDraftError(err: unknown): err is CatalogDraftError {
  return err instanceof CatalogDraftError;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const TITLE_MAX: Record<CatalogMarketplace, number> = { trendyol: 100, wix: 80, shopify: 255, hepsiburada: 200 };
export const DESCRIPTION_MAX: Record<CatalogMarketplace, number> = { trendyol: 30_000, wix: 8_000, shopify: 100_000, hepsiburada: 65_000 };
export const LIMITS = {
  trendyolImages: 8,
  trendyolAttributes: 100,
  trendyolStockCode: 100,
  trendyolBarcode: 40,
  desiMax: 9_999,
  wixSku: 40,
  wixRibbon: 50,
  wixTextFields: 5,
  wixTextFieldTitle: 100,
  wixTextFieldMaxLength: 500,
  wixCollections: 50,
  wixMediaOps: 50,
  wixMediaAdds: 15,
  shopifyText: 255,
  shopifySeoTitle: 255,
  shopifySeoDescription: 320,
  shopifyVariants: 100,
  shopifyImageOps: 100,
  shopifyImageAdds: 20,
  weightMax: 1_000_000,
  quantityMax: 1_000_000,
  priceMax: 1_000_000_000,
} as const;

// ---------------------------------------------------------------------------
// Primitive parsers (throw CatalogDraftError with params.field)
// ---------------------------------------------------------------------------

function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw.replace(',', '.'));
  return NaN;
}

function parsePrice(field: string, raw: unknown, opts: { allowZero?: boolean } = {}): number {
  const n = toNumber(raw);
  if (!Number.isFinite(n) || n < 0 || (!opts.allowZero && n === 0) || n > LIMITS.priceMax) {
    throw new CatalogDraftError('INVALID_PRICE', 'Invalid price', { field });
  }
  return Math.round(n * 100) / 100;
}

function parseQuantity(field: string, raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > LIMITS.quantityMax) {
    throw new CatalogDraftError('INVALID_QUANTITY', 'Invalid quantity', { field, min: 0, max: LIMITS.quantityMax });
  }
  return n;
}

function parseText(field: string, raw: unknown, max: number, opts: { allowEmpty?: boolean; trim?: boolean } = {}): string {
  if (typeof raw !== 'string') throw new CatalogDraftError('INVALID_TEXT', `${field} must be text`, { field, max });
  const v = opts.trim === false ? raw : raw.trim();
  if ((!opts.allowEmpty && !v) || v.length > max) throw new CatalogDraftError('INVALID_TEXT', `Invalid ${field}`, { field, max });
  return v;
}

function parseNonNegative(field: string, raw: unknown, max: number): number {
  const n = toNumber(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new CatalogDraftError('INVALID_NUMBER', `Invalid ${field}`, { field, min: 0, max });
  return Math.round(n * 1000) / 1000;
}

function parseBool(field: string, raw: unknown): boolean {
  if (typeof raw !== 'boolean') throw new CatalogDraftError('INVALID_VISIBLE', `${field} must be a boolean`, { field });
  return raw;
}

function parsePositiveInt(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Public https URL (no credentials, no localhost/private hosts). */
export function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h.startsWith('[')) return false;
    return h.includes('.');
  } catch {
    return false;
  }
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
}

function numericId(v: unknown): string | null {
  const s = typeof v === 'number' && Number.isInteger(v) && v > 0 ? String(v) : typeof v === 'string' ? v.trim() : '';
  return /^\d{1,20}$/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Structured parsers
// ---------------------------------------------------------------------------

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new CatalogDraftError('INVALID_TAGS', 'tags must be an array', { field: 'tags' });
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') throw new CatalogDraftError('INVALID_TAGS', 'tags must be strings', { field: 'tags' });
    const v = t.trim();
    if (!v) continue;
    if (v.length > 255 || v.includes(',')) throw new CatalogDraftError('INVALID_TAGS', 'Invalid tag', { field: 'tags' });
    const lk = v.toLocaleLowerCase('en');
    if (seen.has(lk)) continue;
    seen.add(lk);
    tags.push(v);
  }
  if (tags.length > 250) throw new CatalogDraftError('INVALID_TAGS', 'Too many tags', { field: 'tags', max: 250 });
  return tags;
}

function parseTrendyolImages(raw: unknown): string[] {
  const max = LIMITS.trendyolImages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) {
    throw new CatalogDraftError('INVALID_IMAGES', 'images must be 1–8 https URLs', { field: 'images', max });
  }
  const out: string[] = [];
  for (const u of raw) {
    if (!isHttpsUrl(u)) throw new CatalogDraftError('INVALID_IMAGES', 'Invalid image URL', { field: 'images', max });
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** Canonical attribute list from any of the three shapes (patch input, Trendyol API, cache row). */
export function normalizeTrendyolAttributes(raw: unknown): TrendyolAttributeValue[] {
  if (!Array.isArray(raw)) return [];
  const out: TrendyolAttributeValue[] = [];
  for (const a of raw) {
    if (!isObj(a)) continue;
    const attributeId = parsePositiveInt(a.attributeId);
    if (!attributeId) continue;
    const valueId = parsePositiveInt(a.attributeValueId);
    const custom = [a.customAttributeValue, a.customValue, a.attributeValue].find((v) => typeof v === 'string' && v.trim());
    if (valueId) out.push({ attributeId, attributeValueId: valueId });
    else if (typeof custom === 'string') out.push({ attributeId, customAttributeValue: custom.trim() });
  }
  return out.sort((x, y) => x.attributeId - y.attributeId);
}

function parseTrendyolAttributes(raw: unknown): TrendyolAttributeValue[] {
  if (!Array.isArray(raw) || raw.length > LIMITS.trendyolAttributes) {
    throw new CatalogDraftError('INVALID_ATTRIBUTES', 'attributes must be an array', { field: 'attributes', max: LIMITS.trendyolAttributes });
  }
  const seen = new Set<number>();
  const out: TrendyolAttributeValue[] = [];
  for (const a of raw) {
    if (!isObj(a)) throw new CatalogDraftError('INVALID_ATTRIBUTES', 'Invalid attribute', { field: 'attributes' });
    const attributeId = parsePositiveInt(a.attributeId);
    const hasValueId = a.attributeValueId !== undefined && a.attributeValueId !== null;
    const hasCustom = a.customAttributeValue !== undefined && a.customAttributeValue !== null;
    if (!attributeId || seen.has(attributeId) || hasValueId === hasCustom) {
      throw new CatalogDraftError('INVALID_ATTRIBUTES', 'Each attribute needs an id and exactly one value', { field: 'attributes' });
    }
    seen.add(attributeId);
    if (hasValueId) {
      const valueId = parsePositiveInt(a.attributeValueId);
      if (!valueId) throw new CatalogDraftError('INVALID_ATTRIBUTES', 'Invalid attribute value', { field: 'attributes' });
      out.push({ attributeId, attributeValueId: valueId });
    } else {
      const v = typeof a.customAttributeValue === 'string' ? a.customAttributeValue.trim() : '';
      if (!v || v.length > 255) throw new CatalogDraftError('INVALID_ATTRIBUTES', 'Invalid custom value', { field: 'attributes' });
      out.push({ attributeId, customAttributeValue: v });
    }
  }
  return out.sort((x, y) => x.attributeId - y.attributeId);
}

function parseDiscount(raw: unknown): WixDiscount {
  if (!isObj(raw)) throw new CatalogDraftError('INVALID_DISCOUNT', 'discount must be an object', { field: 'discount' });
  const type = raw.type;
  const value = toNumber(raw.value);
  if (type === 'NONE') return { type: 'NONE', value: 0 };
  if (type === 'AMOUNT' && Number.isFinite(value) && value > 0 && value <= LIMITS.priceMax) {
    return { type, value: Math.round(value * 100) / 100 };
  }
  if (type === 'PERCENT' && Number.isFinite(value) && value > 0 && value < 100) {
    return { type, value: Math.round(value * 100) / 100 };
  }
  throw new CatalogDraftError('INVALID_DISCOUNT', 'Invalid discount', { field: 'discount' });
}

function parseTextFields(raw: unknown): WixCustomTextField[] {
  const max = LIMITS.wixTextFields;
  if (!Array.isArray(raw) || raw.length > max) throw new CatalogDraftError('INVALID_TEXT_FIELDS', 'Invalid text fields', { field: 'customTextFields', max });
  return raw.map((f) => {
    if (!isObj(f)) throw new CatalogDraftError('INVALID_TEXT_FIELDS', 'Invalid text field', { field: 'customTextFields', max });
    const title = typeof f.title === 'string' ? f.title.trim() : '';
    const maxLength = typeof f.maxLength === 'number' ? f.maxLength : Number(f.maxLength);
    if (!title || title.length > LIMITS.wixTextFieldTitle || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > LIMITS.wixTextFieldMaxLength) {
      throw new CatalogDraftError('INVALID_TEXT_FIELDS', 'Invalid text field', { field: 'customTextFields', max });
    }
    return { title, maxLength, mandatory: f.mandatory === true };
  });
}

function parseIdSet(field: string, raw: unknown, max: number, code: CatalogDraftErrorCode): string[] {
  if (!Array.isArray(raw) || raw.length > max) throw new CatalogDraftError(code, `Invalid ${field}`, { field, max });
  const out: string[] = [];
  for (const v of raw) {
    if (!isId(v)) throw new CatalogDraftError(code, `Invalid ${field}`, { field, max });
    const id = v.trim();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function parseWixMedia(raw: unknown): WixMediaOp[] {
  const err = () => new CatalogDraftError('INVALID_MEDIA', 'Invalid media operations', { field: 'media', max: LIMITS.wixMediaAdds });
  if (!Array.isArray(raw) || raw.length > LIMITS.wixMediaOps) throw err();
  const out: WixMediaOp[] = [];
  let adds = 0;
  for (const op of raw) {
    if (!isObj(op)) throw err();
    if (op.op === 'add') {
      if (!isHttpsUrl(op.url)) throw err();
      adds++;
      out.push({ op: 'add', url: op.url });
    } else if (op.op === 'remove') {
      if (!isId(op.mediaId)) throw err();
      out.push({ op: 'remove', mediaId: op.mediaId.trim() });
    } else if (op.op === 'reorder') {
      if (!Array.isArray(op.ids) || op.ids.length === 0 || op.ids.length > LIMITS.wixMediaOps || !op.ids.every(isId)) throw err();
      out.push({ op: 'reorder', ids: Array.from(new Set((op.ids as string[]).map((s) => s.trim()))) });
    } else {
      throw err();
    }
  }
  if (adds > LIMITS.wixMediaAdds) throw err();
  return out;
}

function parseShopifyImages(raw: unknown): ShopifyImageOp[] {
  const err = () => new CatalogDraftError('INVALID_MEDIA', 'Invalid image operations', { field: 'images', max: LIMITS.shopifyImageAdds });
  if (!Array.isArray(raw) || raw.length > LIMITS.shopifyImageOps) throw err();
  const out: ShopifyImageOp[] = [];
  let adds = 0;
  for (const op of raw) {
    if (!isObj(op)) throw err();
    const alt = op.alt === undefined ? undefined : typeof op.alt === 'string' && op.alt.length <= 512 ? op.alt.trim() : null;
    if (alt === null) throw err();
    if (op.op === 'add') {
      if (!isHttpsUrl(op.src) || op.attachment !== undefined) throw err();
      const position = op.position === undefined ? undefined : parsePositiveInt(op.position);
      if (position === null) throw err();
      adds++;
      out.push({ op: 'add', src: op.src, ...(alt !== undefined ? { alt } : {}), ...(position ? { position } : {}) });
    } else if (op.op === 'delete') {
      const id = numericId(op.id);
      if (!id) throw err();
      out.push({ op: 'delete', id });
    } else if (op.op === 'reorder') {
      const id = numericId(op.id);
      const position = parsePositiveInt(op.position);
      if (!id || !position) throw err();
      out.push({ op: 'reorder', id, position });
    } else if (op.op === 'alt') {
      const id = numericId(op.id);
      if (!id || alt === undefined) throw err();
      out.push({ op: 'alt', id, alt });
    } else {
      throw err();
    }
  }
  if (adds > LIMITS.shopifyImageAdds) throw err();
  return out;
}

function parseSeo(raw: unknown): ShopifySeo {
  if (!isObj(raw)) throw new CatalogDraftError('INVALID_TEXT', 'seo must be an object', { field: 'seo', max: LIMITS.shopifySeoTitle });
  const out: ShopifySeo = {};
  if (raw.title !== undefined) out.title = parseText('seo.title', raw.title, LIMITS.shopifySeoTitle, { allowEmpty: true });
  if (raw.description !== undefined) out.description = parseText('seo.description', raw.description, LIMITS.shopifySeoDescription, { allowEmpty: true });
  if (out.title === undefined && out.description === undefined) {
    throw new CatalogDraftError('INVALID_TEXT', 'seo needs a title or a description', { field: 'seo', max: LIMITS.shopifySeoTitle });
  }
  return out;
}

function parseVariants(raw: unknown): ShopifyVariantEdit[] {
  const err = () => new CatalogDraftError('INVALID_VARIANTS', 'Invalid variant edits', { field: 'variants', max: LIMITS.shopifyVariants });
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LIMITS.shopifyVariants) throw err();
  const seen = new Set<string>();
  const out: ShopifyVariantEdit[] = [];
  for (const v of raw) {
    if (!isObj(v)) throw err();
    const id = numericId(v.id);
    if (!id || seen.has(id)) throw err();
    seen.add(id);
    const edit: ShopifyVariantEdit = { id };
    try {
      if (v.price !== undefined) edit.price = parsePrice('variants', v.price, { allowZero: true });
      if (v.compareAtPrice !== undefined) edit.compareAtPrice = v.compareAtPrice === null ? null : parsePrice('variants', v.compareAtPrice, { allowZero: true });
      if (v.inventoryQuantity !== undefined) edit.inventoryQuantity = parseQuantity('variants', v.inventoryQuantity);
      if (v.expectedQuantity !== undefined) {
        const n = Number(v.expectedQuantity);
        if (!Number.isInteger(n)) throw err();
        edit.expectedQuantity = n;
      }
      if (v.sku !== undefined) edit.sku = parseText('variants', v.sku, LIMITS.shopifyText, { allowEmpty: true });
    } catch {
      throw err();
    }
    if (Object.keys(edit).length === 1 || (Object.keys(edit).length === 2 && edit.expectedQuantity !== undefined)) throw err();
    out.push(edit);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Public validators
// ---------------------------------------------------------------------------

/**
 * Validate and normalise an incoming field patch for one marketplace. Aliases are resolved
 * (`FIELD_ALIASES`). A key set to `null` means "drop this field from the draft" (returned in `remove`).
 * Throws CatalogDraftError (with `params.field`) on the first invalid field.
 */
export function validateFieldPatch(
  marketplace: CatalogMarketplace,
  input: unknown,
): { set: CatalogFieldPatch; remove: CatalogFieldKey[] } {
  if (input === undefined) return { set: {}, remove: [] };
  if (!isObj(input)) throw new CatalogDraftError('INVALID_INPUT', 'fields must be an object');
  const allowed = ALLOWED_FIELDS[marketplace] as string[];
  const set: CatalogFieldPatch = {};
  const remove: CatalogFieldKey[] = [];
  const s = set as Record<string, unknown>;
  for (const [rawKey, raw] of Object.entries(input)) {
    const key = canonicalFieldKey(marketplace, rawKey);
    if (!allowed.includes(key)) {
      throw new CatalogDraftError('FIELD_NOT_SUPPORTED', `Field "${rawKey}" cannot be staged for ${marketplace}`, { field: rawKey });
    }
    const k = key as CatalogFieldKey;
    if (raw === null) {
      if (!remove.includes(k)) remove.push(k);
      delete s[k];
      continue;
    }
    switch (k) {
      case 'title': {
        const max = TITLE_MAX[marketplace];
        const v = typeof raw === 'string' ? raw.trim() : '';
        if (!v || v.length > max) throw new CatalogDraftError('INVALID_TITLE', 'Invalid title', { field: 'title', max });
        set.title = v;
        break;
      }
      case 'price': set.price = parsePrice('price', raw); break;
      case 'listPrice': set.listPrice = parsePrice('listPrice', raw); break;
      case 'compareAtPrice': set.compareAtPrice = parsePrice('compareAtPrice', raw, { allowZero: true }); break;
      case 'quantity': set.quantity = parseQuantity('quantity', raw); break;
      case 'tags': set.tags = parseTags(raw); break;
      case 'visible': set.visible = parseBool('visible', raw); break;
      case 'trackInventory': set.trackInventory = parseBool('trackInventory', raw); break;
      case 'inStock': set.inStock = parseBool('inStock', raw); break;
      case 'status': {
        if (raw !== 'active' && raw !== 'draft' && raw !== 'archived') throw new CatalogDraftError('INVALID_STATUS', 'Invalid status', { field: 'status' });
        set.status = raw;
        break;
      }
      case 'description': set.description = parseText('description', raw, DESCRIPTION_MAX[marketplace], { allowEmpty: true }); break;
      case 'images':
        if (marketplace === 'trendyol') set.images = parseTrendyolImages(raw);
        else set.images = parseShopifyImages(raw);
        break;
      case 'attributes': set.attributes = parseTrendyolAttributes(raw); break;
      case 'stockCode': set.stockCode = parseText('stockCode', raw, LIMITS.trendyolStockCode); break;
      case 'dimensionalWeight': set.dimensionalWeight = parseNonNegative('dimensionalWeight', raw, LIMITS.desiMax); break;
      case 'vatRate': {
        const n = toNumber(raw);
        if (!(TRENDYOL_VAT_RATES as readonly number[]).includes(n)) throw new CatalogDraftError('INVALID_VAT', 'Invalid VAT rate', { field: 'vatRate' });
        set.vatRate = n as TrendyolVatRate;
        break;
      }
      case 'discount': set.discount = parseDiscount(raw); break;
      case 'sku': set.sku = parseText('sku', raw, marketplace === 'wix' ? LIMITS.wixSku : LIMITS.shopifyText, { allowEmpty: true }); break;
      case 'weight': set.weight = parseNonNegative('weight', raw, LIMITS.weightMax); break;
      case 'weightUnit': {
        if (!(SHOPIFY_WEIGHT_UNITS as readonly unknown[]).includes(raw)) throw new CatalogDraftError('INVALID_INPUT', 'Invalid weight unit', { field: 'weightUnit' });
        set.weightUnit = raw as ShopifyWeightUnit;
        break;
      }
      case 'ribbon': set.ribbon = parseText('ribbon', raw, LIMITS.wixRibbon, { allowEmpty: true }); break;
      case 'customTextFields': set.customTextFields = parseTextFields(raw); break;
      case 'collectionIds': set.collectionIds = parseIdSet('collectionIds', raw, LIMITS.wixCollections, 'INVALID_COLLECTIONS'); break;
      case 'media': set.media = parseWixMedia(raw); break;
      case 'vendor': set.vendor = parseText('vendor', raw, LIMITS.shopifyText, { allowEmpty: true }); break;
      case 'productType': set.productType = parseText('productType', raw, LIMITS.shopifyText, { allowEmpty: true }); break;
      case 'seo': set.seo = parseSeo(raw); break;
      case 'variants': set.variants = parseVariants(raw); break;
      case 'dispatchTime': {
        const n = toNumber(raw);
        if (!Number.isInteger(n) || n < 0 || n > 30) throw new CatalogDraftError('INVALID_INPUT', 'Invalid dispatch time', { field: 'dispatchTime' });
        set.dispatchTime = n;
        break;
      }
      case 'maxPurchasableQuantity': {
        const n = toNumber(raw);
        if (!Number.isInteger(n) || n < 1 || n > 10_000) throw new CatalogDraftError('INVALID_INPUT', 'Invalid max purchasable quantity', { field: 'maxPurchasableQuantity' });
        set.maxPurchasableQuantity = n;
        break;
      }
    }
    const i = remove.indexOf(k);
    if (i >= 0) remove.splice(i, 1);
  }
  return { set, remove };
}

/** Validate a create payload (types only; completeness is checked at send). `null` values drop a key. */
export function validateCreatePayload(marketplace: CatalogMarketplace, raw: unknown): { set: Record<string, unknown>; remove: string[] } {
  if (raw === undefined) return { set: {}, remove: [] };
  if (!isObj(raw)) throw new CatalogDraftError('INVALID_CREATE', 'payload must be an object', { field: 'payload' });
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  const bad = (field: string) => new CatalogDraftError('INVALID_CREATE', `Invalid ${field}`, { field });
  const allowed: Record<CatalogMarketplace, string[]> = {
    trendyol: ['barcode', 'productMainId', 'brandId', 'categoryId', 'cargoCompanyId', 'shipmentAddressId', 'returningAddressId'],
    wix: ['productType'],
    shopify: [],
    hepsiburada: [],
  };
  for (const [key, v] of Object.entries(raw)) {
    if (!allowed[marketplace].includes(key)) throw new CatalogDraftError('FIELD_NOT_SUPPORTED', `Create field "${key}" is not supported`, { field: key });
    if (v === null) {
      remove.push(key);
      continue;
    }
    if (key === 'barcode' || key === 'productMainId') {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s || s.length > LIMITS.trendyolBarcode || !/^[A-Za-z0-9._\-]+$/.test(s)) throw bad(key);
      set[key] = s;
    } else if (key === 'productType') {
      if (v !== 'physical' && v !== 'digital') throw bad(key);
      set[key] = v;
    } else {
      const n = parsePositiveInt(v);
      if (!n) throw bad(key);
      set[key] = n;
    }
  }
  return { set, remove };
}

/** Validate incoming queued actions (`[{ type, payload? }]`); stamps queuedAt. */
export function validateQueuedActions(marketplace: CatalogMarketplace, input: unknown, now: Date = new Date()): CatalogQueuedAction[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new CatalogDraftError('INVALID_INPUT', 'queuedActions must be an array');
  const out: CatalogQueuedAction[] = [];
  for (const a of input) {
    const type = isObj(a) ? a.type : undefined;
    if (!(ALLOWED_ACTIONS[marketplace] as unknown[]).includes(type)) {
      throw new CatalogDraftError('ACTION_NOT_SUPPORTED', `Action "${String(type)}" cannot be queued for ${marketplace}`, { action: String(type) });
    }
    const action: CatalogQueuedAction = { type: type as CatalogQueuedActionType, queuedAt: now.toISOString() };
    if (type === 'create') {
      const { set, remove } = validateCreatePayload(marketplace, (a as Record<string, unknown>).payload);
      action.payload = { ...set, ...Object.fromEntries(remove.map((k) => [k, null])) };
    } else if (isObj(a) && a.payload !== undefined) {
      throw new CatalogDraftError('INVALID_INPUT', 'Only create takes a payload');
    }
    out.push(action);
  }
  return out;
}

/**
 * Existing actions + incoming ones, deduped by type (the first stays). A second `create` merges its payload
 * into the pending one (`null` removes a key), so the creator can autosave create-only values.
 */
export function mergeQueuedActions(existing: CatalogQueuedAction[], incoming: CatalogQueuedAction[]): CatalogQueuedAction[] {
  const out = existing.map((a) => ({ ...a }));
  for (const a of incoming) {
    const open = out.find((e) => e.type === a.type && !e.completedAt);
    if (open && a.type === 'create') {
      const payload: Record<string, unknown> = { ...(open.payload || {}) };
      for (const [k, v] of Object.entries(a.payload || {})) {
        if (v === null) delete payload[k];
        else payload[k] = v;
      }
      open.payload = payload;
    } else if (!open) {
      const payload = a.payload ? Object.fromEntries(Object.entries(a.payload).filter(([, v]) => v !== null)) : undefined;
      out.push({ ...a, ...(payload ? { payload } : {}) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comparison (conflicts, diff)
// ---------------------------------------------------------------------------

const MONEY_KEYS = new Set(['price', 'listPrice', 'compareAtPrice']);
const INT_KEYS = new Set(['quantity', 'vatRate', 'dispatchTime', 'maxPurchasableQuantity']);
const SET_KEYS = new Set(['tags', 'collectionIds']);

/** Stable comparable form of a value for one key (null = empty / unknown). */
export function comparableValue(key: string, v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (MONEY_KEYS.has(key)) {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 100)) : null;
  }
  if (INT_KEYS.has(key)) {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.trunc(n)) : null;
  }
  if (key === 'weight' || key === 'dimensionalWeight') {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 1000)) : null;
  }
  if (SET_KEYS.has(key) && Array.isArray(v)) {
    return JSON.stringify(v.map((x) => String(x).trim().toLocaleLowerCase('en')).sort());
  }
  if (key === 'attributes') return JSON.stringify(normalizeTrendyolAttributes(v));
  if (key === 'description' && typeof v === 'string') return v.replace(/\s+/g, ' ').trim() || null;
  if (typeof v === 'string') return v.trim();
  return stableJson(v);
}

export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** The value of `key` restricted to what the patch touches (seo subfields, variant ids/fields). */
export function scopedToPatch(key: string, value: unknown, patchValue: unknown): unknown {
  if (key === 'seo' && isObj(patchValue)) {
    const src = isObj(value) ? value : {};
    return Object.fromEntries(Object.keys(patchValue).map((k) => [k, src[k] ?? null]));
  }
  if (key === 'variants' && Array.isArray(patchValue)) {
    const list = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    return (patchValue as ShopifyVariantEdit[]).map((edit) => {
      const cur = list.find((x) => isObj(x) && String(x.id) === edit.id);
      if (!cur) return { id: edit.id, missing: true };
      const out: Record<string, unknown> = { id: edit.id };
      for (const f of ['price', 'compareAtPrice', 'inventoryQuantity', 'sku'] as const) {
        if (edit[f] !== undefined) {
          const raw = cur[f];
          out[f] = f === 'price' || f === 'compareAtPrice'
            ? (raw === null || raw === undefined || raw === '' ? null : Math.round(Number(raw) * 100) / 100)
            : raw ?? null;
        }
      }
      return out;
    });
  }
  return value;
}

/** Patch value in the same scoped shape as `scopedToPatch` (variants without expectedQuantity). */
export function scopedPatchValue(key: string, patchValue: unknown): unknown {
  if (key === 'variants' && Array.isArray(patchValue)) {
    return (patchValue as ShopifyVariantEdit[]).map(({ expectedQuantity: _e, ...rest }) => rest);
  }
  return patchValue;
}

export function sameValue(key: string, a: unknown, b: unknown): boolean {
  return comparableValue(key, a) === comparableValue(key, b);
}
