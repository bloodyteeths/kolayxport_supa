// components/domain/listing-editor/adapters/trendyol.ts — Trendyol staging for the full-page editor
// (marketplace-editors §6.1, §5.1; M6b-C). Form contract shared with the M6b-D sections
// (sections/marketplaceSectionShared.tsx): CatalogFieldPatch v2 keys, `attributes` as a JSON string.
//
// Read: the live product (`GET /api/trendyol/products?action=list&barcode=`, which also refreshes the cache row the
// draft's base snapshot comes from) + the grid row (`GET /api/listings?ids=`) for the link and status.
// Write: `CatalogDraft` only (adapters/catalog.ts). The executor splits content (product update with a full item)
// from price & stock (price-and-inventory) at Send; nothing reaches Trendyol before the footer's Send.
import { normalizeTrendyolAttributes, TRENDYOL_VAT_RATES, isHttpsUrl, LIMITS, TITLE_MAX, type TrendyolAttributeValue } from '@/lib/catalogDrafts/schemas';
import { decodeEntities } from '@/lib/text/decodeEntities';
import { FIELD_SECTION } from '@/lib/listingEditor/sections';
import type { CopySourceData, EditorMode, FieldIssue, FieldMap, ListingFacts, ListingMeta, SectionId } from '@/lib/listingEditor/types';
import type { TrendyolScoreInput } from '@/lib/listingScore/trendyol';
import { decodeHtmlEntities } from './ebay';
import {
  CatalogEditorLoadError,
  createCatalogAdapter,
  getJson,
  jsonArray,
  loadListingRow,
  numOrBlank,
  numOrNull,
  readJson,
  removeKey,
  strList,
  strOf,
  writeJson,
  type CatalogAdapterSpec,
  type PatchValues,
} from './catalog';
import type { AdapterContext, LoadedListing } from './types';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fields
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TrendyolEditorFields extends FieldMap {
  title: string;
  /** HTML. */
  description: string;
  /** Ordered https URLs (1–8). */
  images: string[];
  /** `encodeTrendyolAttributes(TrendyolAttributeValue[])` (sorted by attribute id; `'[]'` = none). */
  attributes: string;
  /** Sale price (TRY, major units). */
  price: number | '';
  listPrice: number | '';
  vatRate: number | '';
  quantity: number | '';
  stockCode: string;
  /** Desi. */
  dimensionalWeight: number | '';
  // Create only (→ queuedActions.create.payload); read-only after the product exists.
  barcode: string;
  productMainId: string;
  brandId: number | '';
  categoryId: number | '';
  cargoCompanyId: number | '';
  shipmentAddressId: number | '';
  returningAddressId: number | '';
  // Display labels kept with the picks (never sent).
  brandName: string;
  categoryName: string;
  categoryPath: string;
  /** Read-only fact: the patch keys the product had a value for when loaded (they can't be cleared in edit). */
  filledKeys: string[];
}

export type TrendyolFieldKey = keyof TrendyolEditorFields & string;

/** Canonical `fieldPatch` keys the Trendyol form owns. */
export const TRENDYOL_PATCH_KEYS = [
  'title', 'description', 'images', 'attributes', 'price', 'listPrice', 'vatRate', 'quantity', 'stockCode', 'dimensionalWeight',
] as const;
export const TRENDYOL_CREATE_KEYS = [
  'barcode', 'productMainId', 'brandId', 'categoryId', 'cargoCompanyId', 'shipmentAddressId', 'returningAddressId',
] as const;
export const TRENDYOL_DISPLAY_KEYS = ['brandName', 'categoryName', 'categoryPath', 'filledKeys'] as const;
/** Values Trendyol needs on every product: clearing one in edit is blocked (it would be a silent no-op). */
const TRENDYOL_KEEP_KEYS = ['images', 'price', 'listPrice', 'vatRate', 'quantity', 'stockCode', 'dimensionalWeight'] as const;
const TRENDYOL_NUMERIC_CREATE = new Set(['brandId', 'categoryId', 'cargoCompanyId', 'shipmentAddressId', 'returningAddressId']);

export function blankTrendyolFields(defaults: Partial<TrendyolEditorFields> = {}): TrendyolEditorFields {
  return {
    title: '',
    description: '',
    images: [],
    attributes: '[]',
    price: '',
    listPrice: '',
    vatRate: 20,
    quantity: '',
    stockCode: '',
    dimensionalWeight: '',
    barcode: '',
    productMainId: '',
    brandId: '',
    categoryId: '',
    cargoCompanyId: '',
    shipmentAddressId: '',
    returningAddressId: '',
    brandName: '',
    categoryName: '',
    categoryPath: '',
    filledKeys: [],
    ...defaults,
  };
}

/** Attribute list → form value (same formula as the sections' `encodeAttributes`: canonical, sorted). */
export function encodeTrendyolAttributes(list: unknown): string {
  return JSON.stringify(normalizeTrendyolAttributes(Array.isArray(list) ? list : jsonArray(list)));
}

export function decodeTrendyolAttributes(v: unknown): TrendyolAttributeValue[] {
  return normalizeTrendyolAttributes(jsonArray(v));
}

function imageUrls(raw: unknown): string[] {
  const out: string[] = [];
  for (const it of Array.isArray(raw) ? raw : []) {
    const u = typeof it === 'string' ? it : it && typeof it === 'object' ? (it as { url?: unknown }).url : null;
    if (typeof u === 'string' && u && !out.includes(u)) out.push(u);
  }
  return out;
}

/** A Trendyol product (API `content[]` item or cache row) → form fields. Text entity-decoded (P5). */
export function trendyolFieldsFromProduct(p: Record<string, unknown>): TrendyolEditorFields {
  const f = blankTrendyolFields({
    title: decodeEntities(strOf(p.title)),
    description: decodeHtmlEntities(strOf(p.description)),
    images: imageUrls(p.images),
    attributes: encodeTrendyolAttributes(p.attributes),
    price: numOrBlank(p.salePrice),
    listPrice: numOrBlank(p.listPrice),
    vatRate: numOrBlank(p.vatRate),
    quantity: numOrBlank(p.quantity),
    stockCode: strOf(p.stockCode),
    dimensionalWeight: numOrBlank(p.dimensionalWeight),
    barcode: strOf(p.barcode),
    productMainId: strOf(p.productMainId),
    brandId: numOrBlank(p.brandId),
    categoryId: numOrBlank(p.pimCategoryId ?? p.categoryId),
    cargoCompanyId: numOrBlank(p.cargoCompanyId),
    brandName: decodeEntities(strOf(p.brand ?? p.brandName)),
    categoryName: decodeEntities(strOf(p.categoryName)),
  });
  f.filledKeys = TRENDYOL_KEEP_KEYS.filter((k) => !isEmptyValue(f[k]));
  return f;
}

function isEmptyValue(v: unknown): boolean {
  return v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim());
}

/** Read-only facts for the sections (`view.meta.raw`): brand / category labels, status flags, reject reasons. */
export function trendyolRaw(p: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...p,
    brandName: strOf(p.brand ?? p.brandName),
    categoryId: p.pimCategoryId ?? p.categoryId ?? null,
    currencyType: strOf(p.currencyType) || 'TRY',
    rejectReasons: p.rejectReasonDetails ?? p.rejectReasons ?? null,
    ...extra,
  };
}

function epochOrIso(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return new Date(v);
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Patch
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Form → canonical patch values (`undefined` = not set: the key is dropped from the draft). */
export function trendyolToPatch(f: TrendyolEditorFields): PatchValues {
  const title = f.title.trim();
  const stockCode = f.stockCode.trim();
  const images = strList(f.images);
  return {
    title: title || undefined,
    description: f.description,
    images: images.length ? images : undefined,
    attributes: decodeTrendyolAttributes(f.attributes),
    price: numOrNull(f.price) ?? undefined,
    listPrice: numOrNull(f.listPrice) ?? undefined,
    vatRate: numOrNull(f.vatRate) ?? undefined,
    quantity: numOrNull(f.quantity) ?? undefined,
    stockCode: stockCode || undefined,
    dimensionalWeight: numOrNull(f.dimensionalWeight) ?? undefined,
  };
}

/** Create-only values → `queuedActions.create.payload` (blank → `null`, which drops the key). */
export function trendyolCreatePayload(f: TrendyolEditorFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TRENDYOL_CREATE_KEYS) {
    const v = f[k];
    if (TRENDYOL_NUMERIC_CREATE.has(k)) {
      const n = numOrNull(v);
      out[k] = n !== null && Number.isInteger(n) && n > 0 ? n : null;
    } else {
      const s = strOf(v).trim();
      out[k] = s || null;
    }
  }
  return out;
}

/** Draft `fieldPatch` (+ create payload) over base fields. */
export function overlayTrendyol(
  base: TrendyolEditorFields,
  patch: Record<string, unknown>,
  payload: Record<string, unknown>,
  labels?: Partial<Pick<TrendyolEditorFields, 'brandName' | 'categoryName' | 'categoryPath'>> | null,
): { fields: TrendyolEditorFields; extra: Record<string, unknown>; applied: number } {
  const f: TrendyolEditorFields = { ...base, images: [...base.images] };
  const extra: Record<string, unknown> = {};
  let applied = 0;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined || v === null) continue;
    applied += 1;
    switch (k) {
      case 'title':
      case 'description':
      case 'stockCode':
        f[k] = decodeEntities(strOf(v));
        if (k === 'description') f.description = decodeHtmlEntities(strOf(v));
        break;
      case 'images':
        f.images = strList(v);
        break;
      case 'attributes':
        f.attributes = encodeTrendyolAttributes(v);
        break;
      case 'price':
      case 'listPrice':
      case 'vatRate':
      case 'quantity':
      case 'dimensionalWeight':
        f[k] = numOrBlank(v);
        break;
      default:
        extra[k] = v;
        applied -= 1;
    }
  }
  for (const k of TRENDYOL_CREATE_KEYS) {
    if (!(k in (payload ?? {}))) continue;
    const v = payload[k];
    if (v === null || v === undefined) continue;
    applied += 1;
    if (TRENDYOL_NUMERIC_CREATE.has(k)) (f as Record<string, unknown>)[k] = numOrBlank(v);
    else (f as Record<string, unknown>)[k] = strOf(v);
  }
  if (labels) {
    if (labels.brandName) f.brandName = labels.brandName;
    if (labels.categoryName) f.categoryName = labels.categoryName;
    if (labels.categoryPath) f.categoryPath = labels.categoryPath;
  }
  return { fields: f, extra, applied };
}

// The create payload keeps ids only (server contract); the picked labels are kept on this device so `?draft=`
// shows "Ev & Yaşam › Dekorasyon" instead of "#1234".
const LABELS_PREFIX = 'kx.trendyol.createLabels.';

export function readTrendyolCreateLabels(draftId: string): Partial<TrendyolEditorFields> | null {
  const raw = readJson(`${LABELS_PREFIX}${draftId}`) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  return { brandName: strOf(raw.brandName), categoryName: strOf(raw.categoryName), categoryPath: strOf(raw.categoryPath) };
}

export function writeTrendyolCreateLabels(draftId: string, f: TrendyolEditorFields): void {
  if (!f.brandName && !f.categoryName && !f.categoryPath) {
    removeKey(`${LABELS_PREFIX}${draftId}`);
    return;
  }
  writeJson(`${LABELS_PREFIX}${draftId}`, { brandName: f.brandName, categoryName: f.categoryName, categoryPath: f.categoryPath });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Validation (client mirror of lib/catalogDrafts/schemas + create completeness, marketplace-editors §5.1)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function sectionOf(field: string): SectionId {
  if (field === 'dimensionalWeight' || field === 'cargoCompanyId' || field === 'shipmentAddressId' || field === 'returningAddressId') return 'shipping';
  return FIELD_SECTION[field] ?? 'title';
}

const BARCODE_RE = /^[A-Za-z0-9._-]+$/;

export function validateTrendyolFields(f: TrendyolEditorFields, mode: EditorMode): FieldIssue[] {
  const out: FieldIssue[] = [];
  const push = (field: string, severity: FieldIssue['severity'], key: string, params?: Record<string, string | number>) =>
    out.push({ field, section: sectionOf(field), severity, key, ...(params ? { params } : {}) });
  const create = mode === 'create';
  const title = f.title.trim();
  // A blank title never enters an existing product's draft; a new product may be saved before it has one.
  if (!title) push('title', create ? 'block_sync' : 'block_save', 'listings.draftError.invalidTitle', { max: TITLE_MAX.trendyol });
  else if (title.length > TITLE_MAX.trendyol) push('title', 'block_save', 'listings.draftError.invalidTitle', { max: TITLE_MAX.trendyol });

  const images = strList(f.images);
  if (images.length > LIMITS.trendyolImages || images.some((u) => !isHttpsUrl(u))) {
    push('images', 'block_save', 'listings.draftError.invalidImages', { max: LIMITS.trendyolImages });
  }

  const sale = numOrNull(f.price);
  const list = numOrNull(f.listPrice);
  if (f.price !== '' && (sale === null || sale <= 0)) push('price', 'block_save', 'listings.validate.priceInvalid');
  else if (create && sale === null) push('price', 'block_sync', 'listings.validate.priceInvalid');
  if (f.listPrice !== '' && (list === null || list <= 0)) push('listPrice', 'block_save', 'listings.validate.priceInvalid');
  else if (list !== null && sale !== null && list < sale) push('listPrice', 'block_save', 'listings.draftError.listBelowSale');
  else if (create && list === null) push('listPrice', 'block_sync', 'listings.validate.priceInvalid');

  const vat = numOrNull(f.vatRate);
  if (f.vatRate !== '' && (vat === null || !(TRENDYOL_VAT_RATES as readonly number[]).includes(vat))) push('vatRate', 'block_save', 'listings.draftError.invalidVat');
  else if (create && vat === null) push('vatRate', 'block_sync', 'listings.draftError.invalidVat');

  const qty = numOrNull(f.quantity);
  if (f.quantity !== '' && (qty === null || !Number.isInteger(qty) || qty < 0)) push('quantity', 'block_save', 'listings.validate.qtyInvalid');
  else if (create && qty === null) push('quantity', 'block_sync', 'listings.validate.qtyInvalid');

  if (f.stockCode.trim().length > LIMITS.trendyolStockCode) push('stockCode', 'block_save', 'listings.draftError.textTooLong', { max: LIMITS.trendyolStockCode });
  else if (create && !f.stockCode.trim()) push('stockCode', 'block_sync', 'listingEditor.catalog.required');

  const desi = numOrNull(f.dimensionalWeight);
  if (f.dimensionalWeight !== '' && (desi === null || desi < 0 || desi > LIMITS.desiMax)) push('dimensionalWeight', 'block_save', 'listings.draftError.invalidNumber', { min: 0, max: LIMITS.desiMax });
  else if (create && desi === null) push('dimensionalWeight', 'block_sync', 'listingEditor.catalog.required');

  if (!create) {
    const filled = new Set(strList(f.filledKeys));
    for (const k of TRENDYOL_KEEP_KEYS) {
      if (!filled.has(k) || !isEmptyValue(f[k]) || out.some((i) => i.field === k)) continue;
      if (k === 'images') push('images', 'block_save', 'listings.draftError.invalidImages', { max: LIMITS.trendyolImages });
      else push(k, 'block_save', 'listingEditor.catalog.required');
    }
  }
  if (create) {
    const barcode = f.barcode.trim();
    if (barcode && (barcode.length > LIMITS.trendyolBarcode || !BARCODE_RE.test(barcode))) push('barcode', 'block_save', 'listingEditor.catalog.barcodeInvalid', { max: LIMITS.trendyolBarcode });
    else if (!barcode) push('barcode', 'block_sync', 'listingEditor.catalog.required');
    const main = f.productMainId.trim();
    if (main && (main.length > LIMITS.trendyolBarcode || !BARCODE_RE.test(main))) push('productMainId', 'block_save', 'listingEditor.catalog.barcodeInvalid', { max: LIMITS.trendyolBarcode });
    if (numOrNull(f.categoryId) === null) push('categoryId', 'block_sync', 'listingEditor.catalog.required');
    if (numOrNull(f.brandId) === null) push('brandId', 'block_sync', 'listingEditor.catalog.required');
    if (numOrNull(f.cargoCompanyId) === null) push('cargoCompanyId', 'block_sync', 'listingEditor.catalog.required');
    if (images.length === 0) push('images', 'block_sync', 'listings.draftError.invalidImages', { max: LIMITS.trendyolImages });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Load
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The live Trendyol product with this barcode (also refreshes its cache row). 404 when it is not on Trendyol. */
export async function fetchTrendyolProduct(barcode: string): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ action: 'list', barcode, size: '5', page: '0' });
  let data: { content?: unknown[] };
  try {
    data = (await getJson(`/api/trendyol/products?${qs.toString()}`)) as { content?: unknown[] };
  } catch (err) {
    // 400 = no Trendyol credentials (the API's only 400 here): the frame offers "Reconnect".
    if (err instanceof CatalogEditorLoadError && err.status === 400) throw new CatalogEditorLoadError(401, err.key);
    throw err;
  }
  const list = Array.isArray(data?.content) ? (data.content as Record<string, unknown>[]) : [];
  const hit = list.find((p) => p && (p.barcode === barcode || (!p.barcode && p.stockCode === barcode)));
  if (!hit) throw new CatalogEditorLoadError(404, 'listingEditor.trendyol.notFound');
  return hit;
}

export function trendyolMeta(p: Record<string, unknown>, row: Record<string, unknown> | null, currency: string | null): ListingMeta {
  const images = imageUrls(p.images).map((src, i) => ({ id: src, src, rank: i + 1, alt: '' }));
  return {
    id: strOf(p.barcode) || null,
    state: row && typeof row.status === 'string' ? row.status : null,
    url: row && typeof row.externalUrl === 'string' ? row.externalUrl : null,
    updatedAt: epochOrIso(p.lastUpdateDate ?? p.trendyolLastUpdate),
    views: 0,
    favorites: 0,
    currency: currency || strOf(p.currencyType) || 'TRY',
    images,
    raw: trendyolRaw(p, row ? { listingRow: row } : {}),
  };
}

export async function loadTrendyolListing(ctx: AdapterContext): Promise<LoadedListing<TrendyolEditorFields>> {
  const barcode = ctx.listingId;
  if (!barcode) throw new CatalogEditorLoadError(404);
  const [product, listing] = await Promise.all([fetchTrendyolProduct(barcode), loadListingRow('trendyol', ctx.shopId, barcode)]);
  return {
    fields: trendyolFieldsFromProduct(product),
    meta: trendyolMeta(product, listing.row, listing.store?.currency || null),
  };
}

/** Same-marketplace copy keeps everything but the unique ids (barcode, stock code, product main id). */
export interface CatalogCopySource extends CopySourceData {
  /** Form values of a same-marketplace copy (applied over the generic copy mapping). */
  catalogFields?: Record<string, unknown>;
}

export async function loadTrendyolCopySource(ctx: AdapterContext): Promise<CatalogCopySource | null> {
  if (!ctx.listingId) return null;
  const product = await fetchTrendyolProduct(ctx.listingId);
  const f = trendyolFieldsFromProduct(product);
  return {
    title: f.title,
    description: f.description,
    tags: [],
    price: numOrNull(f.price) ?? undefined,
    quantity: numOrNull(f.quantity) ?? undefined,
    imageUrls: f.images,
    catalogFields: {
      ...f,
      barcode: '',
      stockCode: '',
      productMainId: '',
    },
  };
}

/** Cross-list / research / same-marketplace copy → Trendyol form values. */
export function trendyolFieldsFromCopy(src: CopySourceData): Partial<TrendyolEditorFields> {
  const out: Partial<TrendyolEditorFields> = {
    title: (src.title ?? '').slice(0, TITLE_MAX.trendyol),
    description: src.description ?? '',
  };
  if (typeof src.price === 'number' && src.price > 0) {
    out.price = Math.round(src.price * 100) / 100;
    out.listPrice = out.price;
  }
  if (typeof src.quantity === 'number' && src.quantity >= 0) out.quantity = Math.round(src.quantity);
  const urls = (src.imageUrls ?? []).filter((u) => isHttpsUrl(u)).slice(0, LIMITS.trendyolImages);
  if (urls.length) out.images = urls;
  const same = (src as CatalogCopySource).catalogFields;
  if (same && typeof same === 'object') {
    const blank = blankTrendyolFields();
    for (const [k, v] of Object.entries(same)) {
      if (k in blank && k !== 'filledKeys' && v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Score input (lib/listingScore/trendyol.ts) from the editor view
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function trendyolScoreInput(f: TrendyolEditorFields, facts: ListingFacts = {}, raw?: unknown): TrendyolScoreInput {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const imageCount = facts.images ? facts.images.filter((i) => i.staged !== 'delete').length : strList(f.images).length;
  return {
    title: f.title,
    brandName: f.brandName || strOf(r.brandName) || null,
    categoryName: f.categoryName || strOf(r.categoryName) || null,
    imageCount,
    description: f.description,
    attributeCount: decodeTrendyolAttributes(f.attributes).length,
    listPrice: numOrNull(f.listPrice),
    salePrice: numOrNull(f.price),
    quantity: numOrNull(f.quantity),
    approved: typeof r.approved === 'boolean' ? r.approved : null,
    rejected: typeof r.rejected === 'boolean' ? r.rejected : null,
    blacklisted: typeof r.blacklisted === 'boolean' ? r.blacklisted : null,
    dimensionalWeight: numOrNull(f.dimensionalWeight),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TRENDYOL_ADAPTER_SPEC: CatalogAdapterSpec<TrendyolEditorFields> = {
  marketplace: 'trendyol',
  blankFields: blankTrendyolFields,
  displayOnlyKeys: TRENDYOL_DISPLAY_KEYS,
  createOnlyKeys: TRENDYOL_CREATE_KEYS,
  patchKeys: () => TRENDYOL_PATCH_KEYS,
  toPatch: (f) => trendyolToPatch(f),
  toCreatePayload: trendyolCreatePayload,
  overlayPatch: (base, patch, payload) => overlayTrendyol(base, patch, payload),
  load: loadTrendyolListing,
  loadCopySource: loadTrendyolCopySource,
  fieldsFromCopy: trendyolFieldsFromCopy,
  validate: validateTrendyolFields,
  error: { marketplace: 'trendyol', sectionFor: sectionOf },
  defaultKeys: ['vatRate', 'cargoCompanyId', 'shipmentAddressId', 'returningAddressId', 'dimensionalWeight', 'brandId', 'brandName'],
  afterCreateStage: (draft, fields) => writeTrendyolCreateLabels(draft.id, fields),
};

const base = createCatalogAdapter(TRENDYOL_ADAPTER_SPEC);

export const trendyolAdapter: typeof base = {
  ...base,
  overlay(baseFields, draft) {
    const result = base.overlay(baseFields, draft);
    if (!draft) return result;
    const labels = readTrendyolCreateLabels(draft.id);
    return labels ? { ...result, fields: { ...result.fields, ...pickLabels(labels, result.fields) } as TrendyolEditorFields } : result;
  },
};

function pickLabels(labels: Partial<TrendyolEditorFields>, f: TrendyolEditorFields): Pick<TrendyolEditorFields, 'brandName' | 'categoryName' | 'categoryPath'> {
  // Only fill labels the form does not have (edit mode carries the live ones).
  return {
    brandName: f.brandName || strOf(labels.brandName),
    categoryName: f.categoryName || strOf(labels.categoryName),
    categoryPath: f.categoryPath || strOf(labels.categoryPath),
  };
}
