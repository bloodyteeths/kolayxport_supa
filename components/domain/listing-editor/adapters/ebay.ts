// components/domain/listing-editor/adapters/ebay.ts — eBay staging for the editor (listing-editor §5.1, §7, §10 F).
// Payload builders moved from `components/ebay/ListingEditorDrawer.tsx` (`buildInitialFields`, the draft overlay
// in `fetchListing`, `getChangedFields`, `handleSave`) and `components/ebay/ListingCreatorDialog.tsx`
// (`handleCreate` body, last-used policies). Server contract: `stageEbayDraft({ inventoryFields, offerFields,
// replaceFields: true, preserveConflict: true })`, queued actions, `syncEbayDraft` (a conflict is returned, never
// forced), `discardEbayDraft`, `removeEbayDraftQueuedActions`.
// F1: a new listing is a draft keyed by a local SKU with `queuedActions: [{ type: 'create', publish }]`; nothing
// reaches eBay until Send (the legacy creator wrote straight to eBay, even for "save as draft").
// P5: marketplace text is entity-decoded on load and before staging, so "one&#39;s" never goes back to eBay.
import {
  discardEbayDraft,
  EbayDraftClientError,
  fetchEbayDraft,
  fetchEbayDrafts,
  removeEbayDraftQueuedActions,
  stageEbayDraft,
  syncEbayDraft,
} from '@/lib/ebay/draftClient';
import { classifyEbayError } from '@/lib/ebay/draftErrors';
import { ASPECT_VALUE_MAX, TITLE_MAX as EBAY_TITLE_MAX, normalizeCondition } from '@/lib/ebay/payloadRules';
import { isCreateVariations, normalizeSellerSku, type EbayCreateVariations } from '@/lib/ebay/draftPlan';
import { decodeEntities, decodeEntityList } from '@/lib/text/decodeEntities';
import { sectionForField } from '@/lib/listingEditor/sections';
import { listHref, readEditorNav } from '@/lib/listingEditor/editorNav';
import type {
  CopySourceData,
  DraftMediaRow,
  DraftRow,
  DraftSyncAttempt,
  EditorMode,
  FieldIssue,
  FieldMap,
  ListingFacts,
  ListingMeta,
  QueuedAction,
  RemoteImage,
} from '@/lib/listingEditor/types';
import { diffKeys, fieldEquals } from '../changeSummary';
import { storedDraftSendError } from '../draftSendError';
import { ebaySpecificKey } from '@/lib/drafts/syncErrors';
import type { AdapterContext, AdapterErrorInfo, ListingEditorAdapter, LoadedListing, StageFieldsInput } from './types';

/** eBay's photo limit per listing. */
export const EBAY_MAX_IMAGES = 24;
export const EBAY_SUBTITLE_MAX = 55;
export const EBAY_CURRENCIES = ['USD', 'GBP', 'EUR', 'TRY'] as const;
export const EBAY_WEIGHT_UNITS = ['KILOGRAM', 'POUND', 'GRAM', 'OUNCE'] as const;
export const EBAY_DIMENSION_UNITS = ['CENTIMETER', 'INCH', 'METER', 'FEET'] as const;

/** Server draft statuses whose patches are still pending (not yet on eBay). */
export const EBAY_PENDING_DRAFT_STATUSES = ['draft', 'failed', 'conflict', 'syncing'];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Field set
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * eBay editor fields (the drawer's `EditableFields`, moved). Flat so the engine can diff them.
 * `aspects` is the item-specifics map encoded with `encodeAspects` (stable JSON, sorted names) because a
 * `FieldValue` cannot be an object; sections read it with `decodeAspects` and write it with `encodeAspects`.
 * `''` = "not set" for optional numbers.
 */
export interface EbayEditorFields extends FieldMap {
  title: string;
  subtitle: string;
  /** Plain text (paragraphs, "• " bullets) or HTML; plain text is sent as HTML (lib/ebay/payloadRules descriptionToEbayHtml). */
  description: string;
  /** Public image URLs in order (first = primary). */
  images: string[];
  /** `encodeAspects({ Brand: ['Acme'], … })`. */
  aspects: string;
  /** Inventory API ConditionEnum (`NEW`, `USED_EXCELLENT`, …). */
  condition: string;
  conditionDescription: string;
  /** Decimal string, e.g. "24.99". */
  price: string;
  currency: string;
  quantity: number;
  categoryId: string;
  storeCategoryNames: string[];
  fulfillmentPolicyId: string;
  returnPolicyId: string;
  paymentPolicyId: string;
  weight: number | '';
  weightUnit: string;
  length: number | '';
  width: number | '';
  height: number | '';
  dimensionUnit: string;
  /** Create only: the seller's own SKU ('' = the generated local SKU). Locked once the listing exists on eBay. */
  sku: string;
  /** Create only: `encodeCreateVariations(EbayCreateVariations)` ('' = no variations). Staged as variationPatch. */
  createVariations: string;
}

export type EbayFieldKey = keyof EbayEditorFields & string;

export const EBAY_FIELD_KEYS = [
  'images',
  'title',
  'subtitle',
  'description',
  'aspects',
  'price',
  'currency',
  'quantity',
  'categoryId',
  'condition',
  'conditionDescription',
  'storeCategoryNames',
  'fulfillmentPolicyId',
  'returnPolicyId',
  'paymentPolicyId',
  'weight',
  'weightUnit',
  'length',
  'width',
  'height',
  'dimensionUnit',
  'sku',
  'createVariations',
] as const satisfies ReadonlyArray<keyof EbayEditorFields>;

/** Section of each eBay field key (keys `lib/listingEditor/sections.ts` FIELD_SECTION does not know yet). */
export const EBAY_FIELD_SECTION: Readonly<Record<EbayFieldKey, ReturnType<typeof sectionForField> & string>> = {
  images: 'photos',
  title: 'title',
  subtitle: 'title',
  description: 'title',
  aspects: 'specifics',
  price: 'price',
  currency: 'price',
  quantity: 'price',
  categoryId: 'details',
  condition: 'details',
  conditionDescription: 'details',
  storeCategoryNames: 'details',
  fulfillmentPolicyId: 'shipping',
  returnPolicyId: 'shipping',
  paymentPolicyId: 'shipping',
  weight: 'shipping',
  weightUnit: 'shipping',
  length: 'shipping',
  width: 'shipping',
  height: 'shipping',
  dimensionUnit: 'shipping',
  sku: 'price',
  createVariations: 'variations',
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// New-listing variations (create mode): the field holds the `EbayCreateVariations` the server's F1 plan reads
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Normalises a create-variations value (trimmed names/values, blank options dropped). Null when there are none. */
export function normalizeCreateVariations(v: unknown): EbayCreateVariations | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Partial<EbayCreateVariations>;
  const specifications = (Array.isArray(raw.specifications) ? raw.specifications : [])
    .map((sp) => ({
      name: String(sp?.name ?? '').trim(),
      values: Array.from(new Set((Array.isArray(sp?.values) ? sp.values : []).map((x) => String(x ?? '').trim()).filter(Boolean))),
    }))
    .filter((sp) => sp.name && sp.values.length);
  const variants = (Array.isArray(raw.variants) ? raw.variants : []).map((x) => ({
    sku: String(x?.sku ?? '').trim(),
    combination: Object.fromEntries(Object.entries(x?.combination ?? {}).map(([k, val]) => [String(k).trim(), String(val ?? '').trim()])),
    quantity: Number.isFinite(Number(x?.quantity)) ? Math.max(0, Math.round(Number(x?.quantity))) : 0,
    price: x?.price === undefined || x?.price === null || String(x.price).trim() === '' ? null : String(x.price).trim(),
  }));
  if (!specifications.length && !variants.length) return null;
  const out: EbayCreateVariations = { specifications, variants };
  if (raw.imageVaryingAspect) out.imageVaryingAspect = String(raw.imageVaryingAspect);
  if (raw.variationImages && typeof raw.variationImages === 'object') out.variationImages = { ...raw.variationImages };
  return out;
}

/** Create variations → field string ('' = none). Stable for diffing. */
export function encodeCreateVariations(v: EbayCreateVariations | null | undefined): string {
  const n = normalizeCreateVariations(v);
  return n ? JSON.stringify(n) : '';
}

export function decodeCreateVariations(raw: unknown): EbayCreateVariations | null {
  if (typeof raw !== 'string' || !raw.trim()) return typeof raw === 'object' ? normalizeCreateVariations(raw) : null;
  try {
    return normalizeCreateVariations(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Every combination of the options' values, in option order (e.g. Color × Size). */
export function combineVariationValues(specs: Array<{ name: string; values: string[] }>): Array<Record<string, string>> {
  let combos: Array<Record<string, string>> = [{}];
  for (const sp of specs) {
    if (!sp.name || !sp.values.length) continue;
    const next: Array<Record<string, string>> = [];
    for (const c of combos) for (const v of sp.values) next.push({ ...c, [sp.name]: v });
    combos = next;
  }
  return combos.length === 1 && Object.keys(combos[0]).length === 0 ? [] : combos;
}

/** eBay SKUs allow letters, digits, `-`, `_`, `.`; this turns an option value into a SKU suffix. */
function skuPart(v: string): string {
  return v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 8);
}

/**
 * Rebuilds the variant rows for new options: combinations that already had a row keep its SKU, price and
 * quantity; new ones get `<base>-<VALUE…>` (unique, ≤ 50 characters) and the listing's price / quantity.
 */
export function rebuildCreateVariants(
  specs: Array<{ name: string; values: string[] }>,
  previous: EbayCreateVariations['variants'],
  baseSku: string,
  defaults: { price: string | null; quantity: number },
): EbayCreateVariations['variants'] {
  const key = (c: Record<string, string>) => specs.map((sp) => `${sp.name}=${c[sp.name] ?? ''}`).join('|');
  const prev = new Map(previous.map((v) => [key(v.combination), v]));
  const used = new Set<string>([baseSku]);
  const rows = combineVariationValues(specs).map((combination) => {
    const old = prev.get(key(combination));
    if (old?.sku) used.add(old.sku);
    return { combination, old };
  });
  return rows.map(({ combination, old }, i) => {
    if (old) return { ...old, combination };
    const suffix = specs.map((sp) => skuPart(combination[sp.name] ?? '')).filter(Boolean).join('-') || String(i + 1);
    let sku = `${baseSku}-${suffix}`.slice(0, 50);
    for (let n = 2; used.has(sku); n += 1) sku = `${baseSku}-${suffix}`.slice(0, 50 - String(n).length - 1) + `-${n}`;
    used.add(sku);
    return { sku, combination, quantity: defaults.quantity, price: defaults.price };
  });
}

export function ebaySectionForField(field: string) {
  return (EBAY_FIELD_SECTION as Record<string, string>)[field] ?? sectionForField(field) ?? 'title';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Aspects encoding
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AspectMap = Record<string, string[]>;

/** Aspects → stable string (names sorted, value order kept, empty names/values dropped). */
export function encodeAspects(aspects: Record<string, unknown> | null | undefined): string {
  if (!aspects || typeof aspects !== 'object') return '';
  const clean: AspectMap = {};
  for (const name of Object.keys(aspects).sort()) {
    const n = decodeEntities(String(name ?? '')).trim();
    if (!n) continue;
    const raw = (aspects as Record<string, unknown>)[name];
    const values = (Array.isArray(raw) ? raw : [raw])
      .map((v) => decodeEntities(String(v ?? '')).trim())
      .filter(Boolean);
    if (values.length) clean[n] = values;
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : '';
}

/** Encoded string (or, tolerated, a raw map written by a generic AI applier) → aspects map. */
export function decodeAspects(encoded: string | Record<string, unknown> | null | undefined): AspectMap {
  if (!encoded) return {};
  try {
    const parsed = typeof encoded === 'string' ? JSON.parse(encoded) : encoded;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AspectMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const values = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? '')).filter(Boolean);
      if (values.length) out[k] = values;
    }
    return out;
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Remote listing (`GET /api/clawd/ebay?action=listing&sku=`)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EbayListingData {
  sku: string;
  isLegacy?: boolean;
  legacyItemId?: string;
  itemWebUrl?: string;
  product?: {
    title?: string;
    description?: string;
    subtitle?: string;
    aspects?: Record<string, string[]>;
    imageUrls?: string[];
    brand?: string;
  };
  condition?: string;
  conditionDescription?: string;
  availability?: { shipToLocationAvailability?: { quantity?: number } };
  offers?: Array<{
    offerId?: string | null;
    status?: string;
    pricingSummary?: { price?: { value: string; currency: string } };
    listingPolicies?: { fulfillmentPolicyId?: string; returnPolicyId?: string; paymentPolicyId?: string };
    categoryId?: string;
    storeCategoryNames?: string[];
    listingDescription?: string;
    listing?: { listingId?: string; listingStatus?: string };
  }>;
  packageWeightAndSize?: {
    weight?: { value: number; unit: string };
    dimensions?: { length: number; width: number; height: number; unit: string };
  };
}

/** Thrown by `load` with the HTTP status (401 → reconnect, 404 → not on eBay any more, 409 → legacy item). */
export class EbayEditorLoadError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message?: string, code?: string) {
    super(message || `HTTP ${status}`);
    this.name = 'EbayEditorLoadError';
    this.status = status;
    this.code = code;
  }
}

const numOrBlank = (v: unknown): number | '' => (typeof v === 'number' && Number.isFinite(v) ? v : '');

/** 12.5 → "12.50": eBay's pricingSummary takes a decimal string (a payload value, never locale-formatted). */
export function toPriceString(n: number): string {
  const cents = Math.round(n * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Entities that carry HTML structure in text content (`<`, `>`, `&`): decoding them would turn text into markup. */
const STRUCTURAL_ENTITY_CODES = new Set([60, 62, 38]);
const STRUCTURAL_ENTITY_NAMES = new Set(['lt', 'gt', 'amp']);

function isStructuralEntity(name: string): boolean {
  const n = name.toLowerCase();
  if (STRUCTURAL_ENTITY_NAMES.has(n)) return true;
  if (n.startsWith('#x')) return STRUCTURAL_ENTITY_CODES.has(Number.parseInt(n.slice(2), 16));
  if (n.startsWith('#')) return STRUCTURAL_ENTITY_CODES.has(Number.parseInt(n.slice(1), 10));
  return false;
}

/**
 * P5 for HTML (the eBay description): decodes display entities (`&#39;`, `&quot;`, `&nbsp;`, `&eacute;` …) in
 * TEXT only, one pass. Tags and attribute values are left as they are, and `&lt;` `&gt;` `&amp;` stay encoded, so
 * escaped text such as `&lt;3` never becomes markup. Idempotent.
 */
export function decodeHtmlEntities(html: string): string {
  if (!html || html.indexOf('&') === -1) return html || '';
  return html
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith('<')
        ? part
        : part.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, name: string) => {
            if (isStructuralEntity(name)) return m;
            const decoded = decodeEntities(m);
            // Unknown entity, or one that decodes to a structural character: leave it.
            return decoded === m || /[<>&]/.test(decoded) ? m : decoded;
          }),
    )
    .join('');
}

function cleanHtml(v: unknown): string {
  return decodeHtmlEntities(String(v ?? ''));
}

/** `buildInitialFields` from the drawer, entity-decoded. */
export function ebayFieldsFromListing(data: EbayListingData): EbayEditorFields {
  const offer = data.offers?.[0];
  return {
    title: decodeEntities(data.product?.title ?? ''),
    subtitle: decodeEntities(data.product?.subtitle ?? ''),
    description: decodeHtmlEntities(data.product?.description || offer?.listingDescription || ''),
    images: (data.product?.imageUrls ?? []).filter((u) => typeof u === 'string' && u),
    aspects: encodeAspects(data.product?.aspects ?? {}),
    condition: normalizeCondition(data.condition) || 'NEW',
    conditionDescription: decodeEntities(data.conditionDescription ?? ''),
    price: offer?.pricingSummary?.price?.value || '',
    currency: offer?.pricingSummary?.price?.currency || 'USD',
    quantity: data.availability?.shipToLocationAvailability?.quantity ?? 0,
    categoryId: offer?.categoryId ? String(offer.categoryId) : '',
    storeCategoryNames: Array.isArray(offer?.storeCategoryNames) ? decodeEntityList(offer!.storeCategoryNames) : [],
    fulfillmentPolicyId: offer?.listingPolicies?.fulfillmentPolicyId || '',
    returnPolicyId: offer?.listingPolicies?.returnPolicyId || '',
    paymentPolicyId: offer?.listingPolicies?.paymentPolicyId || '',
    weight: numOrBlank(data.packageWeightAndSize?.weight?.value),
    weightUnit: data.packageWeightAndSize?.weight?.unit || 'KILOGRAM',
    length: numOrBlank(data.packageWeightAndSize?.dimensions?.length),
    width: numOrBlank(data.packageWeightAndSize?.dimensions?.width),
    height: numOrBlank(data.packageWeightAndSize?.dimensions?.height),
    dimensionUnit: data.packageWeightAndSize?.dimensions?.unit || 'CENTIMETER',
    // Create-only fields: an existing listing's SKU is its route id, its variations live in the group editor.
    sku: '',
    createVariations: '',
  };
}

/** eBay offer status → listing lifecycle (`status.listing.*`). */
export function ebayListingState(data: EbayListingData): string | null {
  const raw = String(data.offers?.[0]?.status || '').toUpperCase();
  if (raw === 'PUBLISHED' || raw === 'ACTIVE') return 'active';
  if (raw === 'UNPUBLISHED') return 'draft';
  if (raw === 'ENDED') return 'inactive';
  return raw ? raw.toLowerCase() : null;
}

export function ebayMetaFromListing(data: EbayListingData): ListingMeta {
  const offer = data.offers?.[0];
  const listingId = offer?.listing?.listingId || data.legacyItemId || null;
  const images: RemoteImage[] = (data.product?.imageUrls ?? []).map((src, i) => ({
    id: src,
    src,
    fullSrc: src,
    rank: i + 1,
    alt: '',
  }));
  return {
    id: data.sku,
    state: ebayListingState(data),
    url: data.itemWebUrl || (listingId ? `https://www.ebay.com/itm/${listingId}` : null),
    // The Inventory API exposes no item timestamp.
    updatedAt: null,
    views: 0,
    favorites: 0,
    currency: offer?.pricingSummary?.price?.currency || 'USD',
    images,
    raw: data,
  };
}

export function blankEbayFields(defaults: Partial<EbayEditorFields> = {}): EbayEditorFields {
  return {
    title: '',
    subtitle: '',
    description: '',
    images: [],
    aspects: '',
    condition: 'NEW',
    conditionDescription: '',
    price: '',
    currency: 'USD',
    quantity: 1,
    categoryId: '',
    storeCategoryNames: [],
    fulfillmentPolicyId: '',
    returnPolicyId: '',
    paymentPolicyId: '',
    weight: '',
    weightUnit: 'KILOGRAM',
    length: '',
    width: '',
    height: '',
    dimensionUnit: 'CENTIMETER',
    sku: '',
    createVariations: '',
    ...defaults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Draft overlay + payloads
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Patch paths the form owns; anything else in a staged patch is preserved in `extra` and re-sent. */
const OWNED_INVENTORY_PATHS = [
  'product.title',
  'product.subtitle',
  'product.description',
  'product.imageUrls',
  'product.aspects',
  'condition',
  'conditionDescription',
  'availability.shipToLocationAvailability.quantity',
  'packageWeightAndSize.weight',
  'packageWeightAndSize.dimensions',
];
const OWNED_OFFER_PATHS = [
  'pricingSummary.price',
  'listingPolicies',
  'categoryId',
  'storeCategoryNames',
  'listingDescription',
];

function flatten(prefix: string, value: unknown, owned: string[], out: Json) {
  const o = obj(value);
  if (!o) return;
  for (const [k, v] of Object.entries(o)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const rel = path.replace(/^(inventory|offer)\./, '');
    if (owned.includes(rel)) continue;
    if (owned.some((p) => p.startsWith(`${rel}.`)) && obj(v)) {
      flatten(path, v, owned, out);
      continue;
    }
    out[path] = v;
  }
}

function setPath(target: Json, path: string[], value: unknown) {
  let cur: Json = target;
  for (let i = 0; i < path.length - 1; i++) {
    const next = obj(cur[path[i]]);
    if (!next) cur[path[i]] = {};
    cur = cur[path[i]] as Json;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * Overlay a DB draft's inventoryPatch / offerPatch onto editor fields (I0 8b: the DB draft is loaded first).
 * Patch content without an input (`inventory.product.brand`, …) is returned in `extra` (dotted paths) so the
 * next stage (`replaceFields`) re-sends it instead of dropping it.
 */
export function overlayEbayPatches(
  base: EbayEditorFields,
  inventoryPatch: Json | null | undefined,
  offerPatch: Json | null | undefined,
): { fields: EbayEditorFields; extra: Json; applied: number } {
  const next: EbayEditorFields = { ...base, images: [...base.images], storeCategoryNames: [...base.storeCategoryNames] };
  const extra: Json = {};
  let applied = 0;
  const inv = obj(inventoryPatch) ?? {};
  const ofr = obj(offerPatch) ?? {};
  const prod = obj(inv.product) ?? {};
  const set = <K extends EbayFieldKey>(k: K, v: EbayEditorFields[K]) => {
    next[k] = v;
    applied += 1;
  };
  if (typeof prod.title === 'string') set('title', decodeEntities(prod.title));
  if (typeof prod.subtitle === 'string') set('subtitle', decodeEntities(prod.subtitle));
  if (typeof prod.description === 'string') set('description', decodeHtmlEntities(prod.description));
  if (Array.isArray(prod.imageUrls)) set('images', (prod.imageUrls as unknown[]).filter((u): u is string => typeof u === 'string'));
  if (obj(prod.aspects)) set('aspects', encodeAspects(prod.aspects as Json));
  if (typeof inv.condition === 'string') set('condition', normalizeCondition(inv.condition) || inv.condition);
  if (typeof inv.conditionDescription === 'string') set('conditionDescription', decodeEntities(inv.conditionDescription));
  const qty = (obj(obj(inv.availability)?.shipToLocationAvailability) ?? {}).quantity;
  if (typeof qty === 'number') set('quantity', qty);
  const pkg = obj(inv.packageWeightAndSize);
  const w = obj(pkg?.weight);
  if (w && w.value !== undefined) {
    set('weight', numOrBlank(Number(w.value)));
    if (typeof w.unit === 'string') next.weightUnit = w.unit;
  }
  const dim = obj(pkg?.dimensions);
  if (dim) {
    if (dim.length !== undefined) set('length', numOrBlank(Number(dim.length)));
    if (dim.width !== undefined) set('width', numOrBlank(Number(dim.width)));
    if (dim.height !== undefined) set('height', numOrBlank(Number(dim.height)));
    if (typeof dim.unit === 'string') next.dimensionUnit = dim.unit;
  }
  const price = obj(obj(ofr.pricingSummary)?.price);
  if (price?.value !== undefined) set('price', String(price.value));
  if (typeof price?.currency === 'string') next.currency = price.currency;
  if (ofr.categoryId !== undefined && ofr.categoryId !== null) set('categoryId', String(ofr.categoryId));
  if (Array.isArray(ofr.storeCategoryNames)) set('storeCategoryNames', decodeEntityList(ofr.storeCategoryNames as string[]));
  const pol = obj(ofr.listingPolicies);
  if (pol) {
    if (typeof pol.fulfillmentPolicyId === 'string') set('fulfillmentPolicyId', pol.fulfillmentPolicyId);
    if (typeof pol.returnPolicyId === 'string') set('returnPolicyId', pol.returnPolicyId);
    if (typeof pol.paymentPolicyId === 'string') set('paymentPolicyId', pol.paymentPolicyId);
  }
  // `listingDescription` mirrors `description` (the drawer staged both); not an extra.
  flatten('inventory', inv, OWNED_INVENTORY_PATHS, extra);
  flatten('offer', ofr, OWNED_OFFER_PATHS, extra);
  return { fields: next, extra, applied };
}

/**
 * Coerces values a generic writer may put in the field map (useListingAI writes the eBay aspects as a map and
 * a suggested price as a number) back into the adapter's shapes. Idempotent.
 */
export function normalizeEbayFields(f: EbayEditorFields): EbayEditorFields {
  const raw = f as unknown as Record<string, unknown>;
  let next = f;
  if (raw.aspects && typeof raw.aspects === 'object') next = { ...next, aspects: encodeAspects(raw.aspects as Record<string, unknown>) };
  if (typeof raw.price === 'number') next = { ...next, price: Number.isFinite(raw.price) ? toPriceString(raw.price as number) : '' };
  if (typeof raw.quantity === 'string') next = { ...next, quantity: Number.parseInt(raw.quantity as string, 10) || 0 };
  return next;
}

/** Keys of `current` that differ from `remote` (`remote` null → every non-blank key). */
export function ebayChangedKeys(remote: EbayEditorFields | null, current: EbayEditorFields): string[] {
  return diffKeys(remote ? normalizeEbayFields(remote) : null, normalizeEbayFields(current)).filter((k) =>
    (EBAY_FIELD_KEYS as readonly string[]).includes(k),
  );
}

function cleanText(v: unknown): string {
  return decodeEntities(String(v ?? ''));
}

function packagePatch(f: EbayEditorFields): Json | null {
  const pkg: Json = {};
  if (f.weight !== '' && f.weight !== undefined && f.weight !== null) pkg.weight = { value: Number(f.weight), unit: f.weightUnit };
  if (f.length !== '' || f.width !== '' || f.height !== '') {
    pkg.dimensions = {
      length: Number(f.length) || 0,
      width: Number(f.width) || 0,
      height: Number(f.height) || 0,
      unit: f.dimensionUnit,
    };
  }
  return Object.keys(pkg).length ? pkg : null;
}

function applyExtra(inventory: Json, offer: Json, extra: Json) {
  for (const [path, value] of Object.entries(extra)) {
    const [head, ...rest] = path.split('.');
    if (!rest.length) continue;
    const target = head === 'inventory' ? inventory : head === 'offer' ? offer : null;
    if (!target) continue;
    // Never overwrite a value the form set.
    let cur: unknown = target;
    let present = true;
    for (const p of rest) {
      const o = obj(cur);
      if (!o || !(p in o)) {
        present = false;
        break;
      }
      cur = o[p];
    }
    if (!present) setPath(target, rest, value);
  }
}

/**
 * Edit mode: `{ inventoryFields, offerFields }` for `stageEbayDraft({ …, replaceFields: true })` — the drawer's
 * `handleSave` rules (description staged on the item AND as the offer's listingDescription; all three policy
 * ids together; package weight/size as one object; the whole aspects map), plus the draft content the form
 * has no input for.
 */
export function buildEbayEditPayload(
  remote: EbayEditorFields,
  current: EbayEditorFields,
  extra: Json = {},
): { inventoryFields: Json; offerFields: Json } {
  current = normalizeEbayFields(current);
  const changed = new Set(ebayChangedKeys(remote, current));
  const inventory: Json = {};
  const offer: Json = {};
  const product: Json = {};
  if (changed.has('title')) product.title = cleanText(current.title).trim().slice(0, EBAY_TITLE_MAX);
  if (changed.has('subtitle')) product.subtitle = cleanText(current.subtitle).trim().slice(0, EBAY_SUBTITLE_MAX);
  if (changed.has('description')) {
    product.description = cleanHtml(current.description);
    offer.listingDescription = cleanHtml(current.description);
  }
  if (changed.has('images')) product.imageUrls = [...current.images];
  if (changed.has('aspects')) product.aspects = decodeAspects(current.aspects);
  if (Object.keys(product).length) inventory.product = product;
  if (changed.has('condition')) inventory.condition = normalizeCondition(current.condition) || current.condition;
  if (changed.has('conditionDescription')) inventory.conditionDescription = cleanText(current.conditionDescription);
  if (changed.has('quantity')) {
    inventory.availability = { shipToLocationAvailability: { quantity: Math.max(0, Number(current.quantity) || 0) } };
  }
  if (['weight', 'weightUnit', 'length', 'width', 'height', 'dimensionUnit'].some((k) => changed.has(k))) {
    const pkg = packagePatch(current);
    if (pkg) inventory.packageWeightAndSize = pkg;
  }
  if (changed.has('price') || changed.has('currency')) {
    offer.pricingSummary = { price: { value: String(current.price), currency: current.currency } };
  }
  if (changed.has('fulfillmentPolicyId') || changed.has('returnPolicyId') || changed.has('paymentPolicyId')) {
    offer.listingPolicies = {
      fulfillmentPolicyId: current.fulfillmentPolicyId,
      returnPolicyId: current.returnPolicyId,
      paymentPolicyId: current.paymentPolicyId,
    };
  }
  if (changed.has('categoryId')) offer.categoryId = current.categoryId;
  if (changed.has('storeCategoryNames')) offer.storeCategoryNames = decodeEntityList(current.storeCategoryNames);
  applyExtra(inventory, offer, extra);
  return { inventoryFields: inventory, offerFields: offer };
}

/**
 * Create mode: the full content (creator `handleCreate` body). The server turns it into the creator's call
 * sequence on Send (`lib/ebay/draftPlan.buildCreatePlan`). Blanks are left out.
 */
export function buildEbayCreatePayload(current: EbayEditorFields, extra: Json = {}): { inventoryFields: Json; offerFields: Json } {
  current = normalizeEbayFields(current);
  const product: Json = {};
  const title = cleanText(current.title).trim().slice(0, EBAY_TITLE_MAX);
  if (title) product.title = title;
  const subtitle = cleanText(current.subtitle).trim().slice(0, EBAY_SUBTITLE_MAX);
  if (subtitle) product.subtitle = subtitle;
  const description = cleanHtml(current.description).trim();
  if (description) product.description = description;
  if (current.images.length) product.imageUrls = current.images.slice(0, EBAY_MAX_IMAGES);
  const aspects = decodeAspects(current.aspects);
  if (Object.keys(aspects).length) product.aspects = aspects;
  const inventory: Json = {
    condition: normalizeCondition(current.condition) || 'NEW',
    availability: { shipToLocationAvailability: { quantity: Math.max(0, Number.parseInt(String(current.quantity), 10) || 1) } },
  };
  if (Object.keys(product).length) inventory.product = product;
  const condDesc = cleanText(current.conditionDescription).trim();
  if (condDesc && inventory.condition !== 'NEW') inventory.conditionDescription = condDesc;
  const pkg = packagePatch(current);
  if (pkg) inventory.packageWeightAndSize = pkg;

  const offer: Json = {};
  const price = parseFloat(String(current.price ?? ''));
  if (Number.isFinite(price) && price > 0) offer.pricingSummary = { price: { value: toPriceString(price), currency: current.currency || 'USD' } };
  if (current.categoryId) offer.categoryId = current.categoryId;
  if (current.storeCategoryNames.length) offer.storeCategoryNames = decodeEntityList(current.storeCategoryNames).slice(0, 2);
  if (current.fulfillmentPolicyId || current.returnPolicyId || current.paymentPolicyId) {
    offer.listingPolicies = {
      fulfillmentPolicyId: current.fulfillmentPolicyId || undefined,
      returnPolicyId: current.returnPolicyId || undefined,
      paymentPolicyId: current.paymentPolicyId || undefined,
    };
  }
  if (description) offer.listingDescription = description;
  applyExtra(inventory, offer, extra);
  return { inventoryFields: inventory, offerFields: offer };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Draft rows
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Serialised `EbayListingDraft` (`/api/ebay-drafts`) → `DraftRow`. `fieldPatch` holds the editor-field view. */
export function toEbayDraftRow(d: Json | null | undefined): DraftRow | null {
  if (!d || typeof d !== 'object' || !d.id) return null;
  const media: DraftMediaRow[] = Array.isArray(d.media)
    ? (d.media as Json[]).map((m) => ({
        id: String(m.id),
        kind: String(m.kind ?? ''),
        operation: String(m.operation ?? ''),
        rank: typeof m.rank === 'number' ? m.rank : null,
        sourceUrl: str(m.sourceUrl ?? m.imageUrl),
        filename: str(m.filename),
        status: null,
      }))
    : [];
  const syncAttempts: DraftSyncAttempt[] = Array.isArray(d.syncAttempts)
    ? (d.syncAttempts as Json[]).map((a) => ({
        id: String(a.id),
        status: String(a.status ?? ''),
        startedAt: String(a.startedAt ?? ''),
        finishedAt: str(a.finishedAt),
        error: str(a.error),
      }))
    : [];
  const inventoryPatch = obj(d.inventoryPatch) ?? {};
  const offerPatch = obj(d.offerPatch) ?? {};
  // fieldPatch = the staged values in editor-field terms (same keys as the form), so the engine's
  // "in the draft" logic works as for Etsy. Extras (no input) keep their dotted path.
  const overlay = overlayEbayPatches(blankEbayFields(), inventoryPatch, offerPatch);
  const fieldPatch: Json = {};
  const blank = blankEbayFields();
  for (const k of EBAY_FIELD_KEYS) {
    if (!fieldEquals(overlay.fields[k] as never, blank[k] as never) || patchTouches(k, inventoryPatch, offerPatch)) {
      fieldPatch[k] = overlay.fields[k];
    }
  }
  Object.assign(fieldPatch, overlay.extra);
  Object.assign(fieldPatch, createOnlyFields(d.queuedActions, d.variationPatch));
  return {
    id: String(d.id),
    status: String(d.status ?? 'draft'),
    listingId: String(d.sku ?? ''),
    fieldPatch,
    // eBay variation content (inventory_item_group body, or EbayCreateVariations for a new listing).
    inventoryPatch: obj(d.variationPatch),
    queuedActions: Array.isArray(d.queuedActions) ? (d.queuedActions as QueuedAction[]) : [],
    media,
    lastSyncError: str(d.lastSyncError),
    syncAttempts,
    updatedAt: str(d.updatedAt),
    syncedAt: str(d.syncedAt),
    createdAt: str(d.createdAt),
    raw: d,
  };
}

function patchTouches(key: EbayFieldKey, inv: Json, ofr: Json): boolean {
  const prod = obj(inv.product) ?? {};
  switch (key) {
    case 'title':
    case 'subtitle':
    case 'description':
      return key in prod;
    case 'images':
      return 'imageUrls' in prod;
    case 'aspects':
      return 'aspects' in prod;
    case 'condition':
    case 'conditionDescription':
      return key in inv;
    case 'quantity':
      return Boolean(obj(inv.availability));
    case 'weight':
    case 'weightUnit':
      return Boolean(obj(obj(inv.packageWeightAndSize)?.weight));
    case 'length':
    case 'width':
    case 'height':
    case 'dimensionUnit':
      return Boolean(obj(obj(inv.packageWeightAndSize)?.dimensions));
    case 'price':
    case 'currency':
      return Boolean(obj(ofr.pricingSummary));
    case 'categoryId':
    case 'storeCategoryNames':
      return key in ofr;
    case 'sku':
    case 'createVariations':
      // Not in the item/offer patches (create action / variationPatch); toEbayDraftRow adds them.
      return false;
    default:
      return Boolean(obj(ofr.listingPolicies));
  }
}

/** The staged create-only values (seller SKU on the create action, new-listing variations) as editor fields. */
function createOnlyFields(queuedActions: unknown, variationPatch: unknown): Partial<Pick<EbayEditorFields, 'sku' | 'createVariations'>> {
  const out: Partial<Pick<EbayEditorFields, 'sku' | 'createVariations'>> = {};
  const create = Array.isArray(queuedActions) ? (queuedActions as Json[]).find((a) => a?.type === 'create') : null;
  if (!create) return out;
  const progress = obj(create.progress);
  const sku = typeof progress?.sku === 'string' && progress.sku ? progress.sku : typeof create.sku === 'string' ? create.sku : '';
  if (sku) out.sku = sku;
  if (isCreateVariations(variationPatch)) out.createVariations = encodeCreateVariations(variationPatch);
  return out;
}

/** The create action of a create draft (without the server-written progress), or null. */
function createActionOf(draft: Pick<DraftRow, 'queuedActions'> | null | undefined): Json | null {
  const a = draft?.queuedActions?.find((x) => x?.type === 'create') as Json | undefined;
  if (!a) return null;
  const { progress: _progress, ...rest } = a;
  return rest;
}

/** True once a send created something on eBay for this new listing (the SKU is then locked). */
export function ebayCreateStarted(draft: Pick<DraftRow, 'queuedActions'> | null | undefined): boolean {
  const a = draft?.queuedActions?.find((x) => x?.type === 'create') as Json | undefined;
  const p = obj(a?.progress);
  if (!p) return false;
  return (Array.isArray(p.itemsCreated) && p.itemsCreated.length > 0) || Boolean(p.groupCreated) || Object.keys(obj(p.offerIds) ?? {}).length > 0;
}

/** The raw server row's patches (for `overlay`). */
function rawPatches(draft: DraftRow | null): { inventoryPatch: Json; offerPatch: Json } {
  const raw = obj(draft?.raw) ?? {};
  return { inventoryPatch: obj(raw.inventoryPatch) ?? {}, offerPatch: obj(raw.offerPatch) ?? {} };
}

export function isEbayCreateDraft(draft: Pick<DraftRow, 'queuedActions'> | null | undefined): boolean {
  return Boolean(draft?.queuedActions?.some((a) => a?.type === 'create'));
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** Nothing staged at all (no patch, variations, media or pending action). */
export function isEbayDraftEmpty(draft: DraftRow): boolean {
  const { inventoryPatch, offerPatch } = rawPatches(draft);
  return (
    isEmptyValue(inventoryPatch) &&
    isEmptyValue(offerPatch) &&
    isEmptyValue(draft.inventoryPatch) &&
    draft.media.length === 0 &&
    !draft.queuedActions.some((a) => a && !a.completedAt)
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ebayErrorInfo(err: unknown): AdapterErrorInfo {
  if (err instanceof EbayDraftClientError) {
    const missing = Array.isArray(err.data?.missing) ? (err.data.missing as string[]) : [];
    const issues: FieldIssue[] | undefined = missing.length
      ? missing.map((m) => createMissingIssue(m))
      : undefined;
    return {
      status: err.status,
      network: false,
      conflict: err.isConflict,
      key: err.key ? (err.key.startsWith('ebay.') ? err.key : `ebay.${err.key}`) : null, // EBAY_LEGACY_LISTING sends a full key
      params: err.params,
      issues,
    };
  }
  if (err instanceof EbayEditorLoadError) {
    return {
      status: err.status,
      network: false,
      conflict: false,
      key: err.code === 'LEGACY' ? 'ebay.draftSync.legacyNotEditable' : null,
    };
  }
  const network = err instanceof TypeError || (err instanceof Error && /network|failed to fetch|load failed/i.test(err.message));
  return { status: null, network, conflict: false, key: null };
}

/**
 * Failed-banner cause key. The API's `lastSyncErrorKey` (`ebay.draftSync.<code>`) wins; old rows that still hold
 * English `lastSyncError` text are classified from the text.
 */
export function ebayFailureCauseKey(draft: Pick<DraftRow, 'status' | 'lastSyncError' | 'raw'>): string {
  const stored = storedDraftSendError(draft, 'ebay.');
  if (stored) return stored.errorKey;
  const raw = typeof draft.lastSyncError === 'string' ? draft.lastSyncError.trim() : '';
  if (draft.status === 'conflict') return 'ebay.draftSync.conflict';
  if (!raw) return 'listings.sendError.generic';
  const typed = classifyEbayError(new Error(raw));
  if (typed.code === 'MISSING_ASPECTS') return 'ebay.draftSync.missingAspectsShort';
  if (typed.code === 'LOCATION_REQUIRED') return 'ebay.draftSync.locationRequired';
  if (typed.code === 'REAUTH_REQUIRED') return 'ebay.draftSync.reauthRequired';
  const msg = raw.toLowerCase();
  if (/already used by a listing/.test(msg)) return 'ebay.draftSync.skuExistsShort';
  if (/missing before listing/.test(msg)) return 'ebay.draftSync.createIncompleteShort';
  if (/server restart|interrupted/.test(msg)) return 'listings.sendError.interrupted';
  if (/rate limit|too many requests|\b429\b/.test(msg)) return 'listings.sendError.rateLimited';
  const specific = ebaySpecificKey(msg);
  if (specific) return specific;
  if (/not found|\b404\b|no longer exists/.test(msg)) return 'listings.sendError.notFound';
  if (/invalid|validation|must|required|\b400\b|ebay api 4\d\d/.test(msg)) return 'listings.sendError.rejected';
  return 'listings.sendError.generic';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Validation (client; eBay payload rules from lib/ebay/payloadRules)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CREATE_FIELD: Record<string, EbayFieldKey> = {
  title: 'title',
  description: 'description',
  photos: 'images',
  category: 'categoryId',
  price: 'price',
  fulfillmentPolicy: 'fulfillmentPolicyId',
  returnPolicy: 'returnPolicyId',
  paymentPolicy: 'paymentPolicyId',
};

function createMissingIssue(m: string): FieldIssue {
  const isVariation = m === 'variations' || m === 'variantSku' || m.startsWith('price:');
  const field: EbayFieldKey = CREATE_FIELD[m] ?? (isVariation ? 'createVariations' : 'title');
  return {
    field,
    section: ebaySectionForField(field) as FieldIssue['section'],
    severity: 'block_sync',
    key: `ebay.validation.${m.startsWith('price:') ? 'variantPrice' : m}Required`,
  };
}

export function validateEbayEditorFields(fields: EbayEditorFields, mode: EditorMode): FieldIssue[] {
  fields = normalizeEbayFields(fields);
  const issues: FieldIssue[] = [];
  const add = (field: EbayFieldKey, severity: FieldIssue['severity'], key: string, params?: Record<string, string | number>) =>
    issues.push({ field, section: ebaySectionForField(field) as FieldIssue['section'], severity, key: `ebay.validation.${key}`, params });

  const title = cleanText(fields.title).trim();
  if (title.length > EBAY_TITLE_MAX) add('title', 'block_save', 'titleTooLong', { max: EBAY_TITLE_MAX, length: title.length });
  if (cleanText(fields.subtitle).trim().length > EBAY_SUBTITLE_MAX) add('subtitle', 'block_save', 'subtitleTooLong', { max: EBAY_SUBTITLE_MAX });
  if (fields.images.length > EBAY_MAX_IMAGES) add('images', 'block_sync', 'tooManyPhotos', { max: EBAY_MAX_IMAGES });
  const price = parseFloat(String(fields.price ?? ''));
  if (String(fields.price ?? '').trim() !== '' && !(Number.isFinite(price) && price > 0)) add('price', 'block_save', 'priceInvalid');
  if (!(EBAY_CURRENCIES as readonly string[]).includes(fields.currency)) add('currency', 'block_sync', 'currencyInvalid');
  if (!Number.isFinite(Number(fields.quantity)) || Number(fields.quantity) < 0) add('quantity', 'block_save', 'quantityInvalid');
  const longAspects = Object.entries(decodeAspects(fields.aspects))
    .filter(([, vs]) => vs.some((v) => v.length > ASPECT_VALUE_MAX))
    .map(([n]) => n);
  if (longAspects.length) add('aspects', 'warn', 'aspectTooLong', { names: longAspects.join(', '), max: ASPECT_VALUE_MAX });

  // Send needs these (the legacy creator's draft blockers); in edit mode only when a value was cleared.
  if (mode === 'create') {
    const sku = String(fields.sku ?? '').trim();
    if (sku && !normalizeSellerSku(sku)) add('sku', 'block_save', 'skuInvalid', { max: 50 });
  }
  const variations = mode === 'create' ? decodeCreateVariations(fields.createVariations) : null;
  if (variations) {
    const seen = new Set<string>(fields.sku ? [String(fields.sku).trim()] : []);
    let badSku = false;
    let dupSku = false;
    let noPrice = false;
    for (const v of variations.variants) {
      if (!normalizeSellerSku(v.sku)) badSku = true;
      else if (seen.has(v.sku)) dupSku = true;
      seen.add(v.sku);
      const p = parseFloat(String(v.price ?? fields.price ?? ''));
      if (!(Number.isFinite(p) && p > 0)) noPrice = true;
    }
    if (!variations.specifications.length || !variations.variants.length) add('createVariations', 'block_sync', 'variationsRequired');
    if (badSku) add('createVariations', 'block_sync', 'variantSkuRequired');
    if (dupSku) add('createVariations', 'block_sync', 'variantSkuDuplicate');
    if (noPrice) add('createVariations', 'block_sync', 'variantPriceRequired');
  }

  if (mode === 'create') {
    if (!title) add('title', 'block_sync', 'titleRequired');
    if (!cleanText(fields.description).trim()) add('description', 'block_sync', 'descriptionRequired');
    if (fields.images.length === 0) add('images', 'block_sync', 'photosRequired');
    if (!fields.categoryId) add('categoryId', 'block_sync', 'categoryRequired');
    // With variations each variation has its own price (the listing price is only their default).
    if (!variations && !(Number.isFinite(price) && price > 0)) add('price', 'block_sync', 'priceRequired');
    if (!fields.fulfillmentPolicyId) add('fulfillmentPolicyId', 'block_sync', 'fulfillmentPolicyRequired');
    if (!fields.returnPolicyId) add('returnPolicyId', 'block_sync', 'returnPolicyRequired');
    if (!fields.paymentPolicyId) add('paymentPolicyId', 'block_sync', 'paymentPolicyRequired');
  } else {
    if (!title) add('title', 'block_sync', 'titleRequired');
  }
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Local storage (device copy + last-used policies); every access wrapped
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const EBAY_DEVICE_COPY_PREFIX = 'ebay_listing_draft_';
/** Existing creator key (last fulfillment / return / payment policy). */
export const EBAY_POLICY_STORAGE_KEY = 'kx.ebay.lastPolicies.v1';

function readJson(key: string): unknown {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Copy / cross-list / research prefill
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** CopySourceData plus the eBay-only values a same-marketplace copy keeps (category, condition, policies…). */
export interface EbayCopySourceData extends CopySourceData {
  ebay?: Partial<EbayEditorFields>;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain text (Etsy / research) → eBay description HTML (legacy `plainTextToHtml`). */
export function plainTextToHtml(text: string): string {
  if (!text) return '';
  if (/<\/?(p|br|div|ul|li|h\d|strong|em)\b/i.test(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export function ebayFieldsFromCopy(src: CopySourceData): Partial<EbayEditorFields> {
  const s = src as EbayCopySourceData;
  const out: Partial<EbayEditorFields> = {
    title: decodeEntities(src.title ?? '').trim().slice(0, EBAY_TITLE_MAX),
    description: s.source === 'ebay' ? decodeHtmlEntities(src.description ?? '') : plainTextToHtml(decodeEntities(src.description ?? '')),
  };
  if (typeof src.price === 'number' && Number.isFinite(src.price) && src.price > 0) out.price = toPriceString(src.price);
  if (typeof src.quantity === 'number' && src.quantity > 0) out.quantity = src.quantity;
  if (Array.isArray(src.imageUrls)) {
    out.images = src.imageUrls.filter((u) => typeof u === 'string' && /^https:\/\//i.test(u)).slice(0, EBAY_MAX_IMAGES);
  }
  const materials = (src.materials ?? []).map((m) => decodeEntities(m).trim()).filter(Boolean).slice(0, 5);
  if (materials.length) out.aspects = encodeAspects({ Material: materials });
  if (typeof src.item_weight === 'number' && src.item_weight > 0) {
    const unit = String(src.item_weight_unit || '').toLowerCase();
    const map: Record<string, string> = { g: 'GRAM', kg: 'KILOGRAM', lb: 'POUND', oz: 'OUNCE' };
    if (map[unit]) {
      out.weight = src.item_weight;
      out.weightUnit = map[unit];
    }
  }
  if (s.ebay) Object.assign(out, s.ebay);
  return out;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EbayEditorLoadError(res.status, body?.error);
  }
  return res.json();
}

const q = (v: string) => encodeURIComponent(v);

export async function loadEbayListing(ctx: AdapterContext): Promise<LoadedListing<EbayEditorFields>> {
  if (!ctx.listingId) throw new EbayEditorLoadError(404);
  const data = (await getJson(`/api/clawd/ebay?action=listing&sku=${q(ctx.listingId)}`)) as EbayListingData;
  // Listings created on eBay (legacy) load like the others: title, description, price and stock are sent through the
  // Trading API (lib/ebay/legacyTrading); the editor locks the other sections for them.
  return { fields: ebayFieldsFromListing(data), meta: ebayMetaFromListing(data) };
}

/** `?copy=<sku>`: an eBay listing as a create prefill (legacy items included). */
export async function loadEbayCopySource(ctx: AdapterContext): Promise<EbayCopySourceData | null> {
  if (!ctx.listingId) return null;
  const data = (await getJson(`/api/clawd/ebay?action=listing&sku=${q(ctx.listingId)}`)) as EbayListingData;
  const f = ebayFieldsFromListing(data);
  const price = parseFloat(f.price);
  return {
    source: 'ebay',
    title: f.title,
    description: f.description,
    tags: [],
    price: Number.isFinite(price) && price > 0 ? price : undefined,
    quantity: f.quantity || undefined,
    imageUrls: f.images.filter((u) => /^https:\/\//i.test(u)).slice(0, EBAY_MAX_IMAGES),
    ebay: {
      subtitle: f.subtitle,
      aspects: f.aspects,
      condition: f.condition,
      conditionDescription: f.conditionDescription,
      currency: f.currency,
      categoryId: f.categoryId,
      storeCategoryNames: f.storeCategoryNames,
      fulfillmentPolicyId: f.fulfillmentPolicyId,
      returnPolicyId: f.returnPolicyId,
      paymentPolicyId: f.paymentPolicyId,
      weight: f.weight,
      weightUnit: f.weightUnit,
      length: f.length,
      width: f.width,
      height: f.height,
      dimensionUnit: f.dimensionUnit,
    },
  };
}

/**
 * `?crosslist=etsy:<listingId>` (Etsy "Copy to eBay"): reads the Etsy listing through the first shop that can
 * read it (legacy page's `loadEtsyListingForCrosslist`, without the SKU carry-over: the editor uses its own
 * local SKU, so an existing eBay SKU can never be overwritten).
 */
export async function loadEtsyCrosslistSource(etsyListingId: string): Promise<CopySourceData | null> {
  if (!/^\d{1,20}$/.test(etsyListingId)) return null;
  const shops = (await getJson('/api/integrations/etsy/shops')) as { shops?: Array<{ shopId?: unknown }> };
  const shopIds = (Array.isArray(shops?.shops) ? shops.shops : [])
    .map((s) => (s?.shopId != null ? String(s.shopId) : ''))
    .filter(Boolean);
  for (const shopId of shopIds) {
    let l: Json | null = null;
    try {
      l = obj(await getJson(`/api/clawd/etsy?action=listing&shop_id=${q(shopId)}&listing_id=${q(etsyListingId)}`));
    } catch {
      continue;
    }
    if (!l || !l.listing_id) continue;
    const images = (Array.isArray(l.images) ? (l.images as Json[]) : [])
      .slice()
      .sort((a, b) => (Number(a?.rank) || 0) - (Number(b?.rank) || 0))
      .map((img) => (img?.url_fullxfull || img?.url_570xN) as unknown)
      .filter((u): u is string => typeof u === 'string' && /^https:\/\//i.test(u));
    const p = obj(l.price);
    const amount = Number(p?.amount);
    const divisor = Number(p?.divisor) || 100;
    return {
      source: 'etsy',
      title: String(l.title ?? ''),
      description: String(l.description ?? ''),
      tags: Array.isArray(l.tags) ? (l.tags as string[]) : [],
      materials: Array.isArray(l.materials) ? (l.materials as string[]) : [],
      price: Number.isFinite(amount) && amount > 0 ? Math.round((amount / divisor) * 100) / 100 : undefined,
      quantity: typeof l.quantity === 'number' ? l.quantity : undefined,
      item_weight: typeof l.item_weight === 'number' ? l.item_weight : undefined,
      item_weight_unit: typeof l.item_weight_unit === 'string' ? l.item_weight_unit : undefined,
      imageUrls: images.slice(0, EBAY_MAX_IMAGES),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Network: drafts
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function loadEbayDraftRow(input: { shopId: string; listingId?: string | null; draftId?: string | null }): Promise<DraftRow | null> {
  if (input.draftId) return toEbayDraftRow(await fetchEbayDraft(input.draftId));
  if (!input.listingId) return null;
  const drafts = (await fetchEbayDrafts(input.listingId)) as Json[];
  const pending = drafts.find((d) => String(d?.sku) === input.listingId && EBAY_PENDING_DRAFT_STATUSES.includes(String(d?.status)));
  return toEbayDraftRow(pending ?? null);
}

function offerIdOf(draft: DraftRow | null, remoteMeta?: ListingMeta | null): string | undefined {
  const raw = obj(draft?.raw);
  if (raw?.offerId) return String(raw.offerId);
  const data = obj(remoteMeta?.raw) as EbayListingData | null;
  const id = data?.offers?.[0]?.offerId;
  return id ? String(id) : undefined;
}

export async function stageEbayFields(input: StageFieldsInput<EbayEditorFields>): Promise<DraftRow | null> {
  const { ctx, mode, remote, current, extra, draft } = input;
  if (!ctx.listingId) throw new Error('stageEbayFields: listingId (SKU) is required');

  if (mode === 'create') {
    const body = buildEbayCreatePayload(current, extra);
    // The create action carries the publish choice and the seller's own SKU; the server keeps it unique per
    // draft and keeps its progress (lib/ebay/draftPlan mergeQueuedActions), so re-staging it is safe.
    const prev = createActionOf(draft);
    const sellerSku = normalizeSellerSku(current.sku) ?? undefined;
    const nextAction: Json = { ...(prev ?? {}), type: 'create', publish: prev?.publish !== false };
    if (sellerSku) nextAction.sku = sellerSku;
    else delete nextAction.sku;
    const actionChanged = !prev || (prev.sku ?? undefined) !== (nextAction.sku ?? undefined);
    const staged = await stageEbayDraft({
      sku: ctx.listingId,
      inventoryFields: body.inventoryFields,
      offerFields: body.offerFields,
      // A new multi-variation listing (server F1: item per variant → group → offers → publish by group).
      variationFields: (decodeCreateVariations(current.createVariations) as Record<string, unknown> | null) ?? null,
      replaceFields: true,
      ...(actionChanged ? { queuedActions: [nextAction] } : {}),
    });
    return toEbayDraftRow(staged);
  }

  if (!remote) throw new Error('stageEbayFields: remote values are required in edit mode');
  const payload = buildEbayEditPayload(remote, current, extra);
  const empty = isEmptyValue(payload.inventoryFields) && isEmptyValue(payload.offerFields);
  if (empty && !draft) return null; // nothing to stage; never create an empty draft
  const staged = toEbayDraftRow(
    await stageEbayDraft({
      sku: ctx.listingId,
      offerId: offerIdOf(draft),
      inventoryFields: payload.inventoryFields,
      offerFields: payload.offerFields,
      replaceFields: true,
      preserveConflict: true,
    }),
  );
  // Everything reverted: an empty plain draft is discarded so the listing reads "Up to date" (§5.1).
  if (staged && staged.status === 'draft' && isEbayDraftEmpty(staged)) {
    await discardEbayDraft(staged.id);
    return null;
  }
  return staged;
}

/** Map the engine's generic state actions onto the eBay engine's (`deactivate` → `withdraw`). */
export function toEbayAction(a: QueuedAction): Record<string, unknown> | null {
  switch (a.type) {
    case 'publish':
    case 'activate':
      return { type: 'publish' };
    case 'deactivate':
    case 'withdraw':
      return { type: 'withdraw' };
    case 'delete':
      return { type: 'delete' };
    default:
      // renew / create_* / copy are Etsy-only (eBay copy is the `new?copy=` route).
      return null;
  }
}

/** A fresh local SKU for a new listing (legacy creator default `SKU-<ms>`, base-36 to stay short). */
export function newEbayLocalSku(): string {
  return `KX-${Date.now().toString(36).toUpperCase()}`;
}

export const ebayAdapter: ListingEditorAdapter<EbayEditorFields> = {
  marketplace: 'ebay',
  displayName: 'eBay',
  blankFields: blankEbayFields,
  fieldsFromCopy: ebayFieldsFromCopy,
  readCreateDefaults() {
    const last = obj(readJson(EBAY_POLICY_STORAGE_KEY));
    if (!last) return {};
    const out: Partial<EbayEditorFields> = {};
    if (typeof last.fulfillment === 'string' && last.fulfillment) out.fulfillmentPolicyId = last.fulfillment;
    if (typeof last.return === 'string' && last.return) out.returnPolicyId = last.return;
    if (typeof last.payment === 'string' && last.payment) out.paymentPolicyId = last.payment;
    return out;
  },
  writeCreateDefaults(_shopId, fields) {
    writeJson(EBAY_POLICY_STORAGE_KEY, {
      fulfillment: fields.fulfillmentPolicyId,
      return: fields.returnPolicyId,
      payment: fields.paymentPolicyId,
    });
  },
  newLocalListingId: newEbayLocalSku,
  load: loadEbayListing,
  loadCopySource: loadEbayCopySource,
  loadDraft: loadEbayDraftRow,
  overlay(base, draft) {
    const { inventoryPatch, offerPatch } = rawPatches(draft);
    const result = overlayEbayPatches(base, inventoryPatch, offerPatch);
    const raw = obj(draft?.raw) ?? {};
    const createOnly = createOnlyFields(draft?.queuedActions, raw.variationPatch);
    const n = Object.keys(createOnly).length;
    return n ? { ...result, fields: { ...result.fields, ...createOnly }, applied: result.applied + n } : result;
  },
  changedKeys: ebayChangedKeys,
  stageFields: stageEbayFields,
  async stageActions(ctx, actions) {
    if (!ctx.listingId) throw new Error('stageActions: listingId (SKU) is required');
    const mapped = actions.map(toEbayAction).filter((a): a is Record<string, unknown> => a !== null);
    if (!mapped.length) return null;
    return toEbayDraftRow(await stageEbayDraft({ sku: ctx.listingId, queuedActions: mapped, preserveConflict: true }));
  },
  // Copy / prefill photos are already the `images` field (eBay fetches public URLs itself at publish time), so
  // there is nothing to stage as media; returning null lets the engine clear its pending list.
  async stageImageUrls() {
    return null;
  },
  async removeActions(draftId, types) {
    const mapped = Array.from(new Set(types.map((t) => (t === 'deactivate' ? 'withdraw' : t === 'activate' ? 'publish' : t))));
    return toEbayDraftRow(await removeEbayDraftQueuedActions(draftId, mapped));
  },
  async discard(draftId) {
    await discardEbayDraft(draftId);
  },
  async send(draft, opts) {
    // Create: the publish choice (List on eBay / Save on eBay as unpublished) is staged right before the send;
    // the server replaces the create action and keeps its progress.
    if (isEbayCreateDraft(draft)) {
      const current = createActionOf(draft);
      const publish = opts?.publish !== false;
      if ((current?.publish !== false) !== publish) {
        // Keep the rest of the action (the seller's SKU); the server keeps the progress.
        await stageEbayDraft({ sku: draft.listingId, queuedActions: [{ ...(current ?? {}), type: 'create', publish }] });
      }
    }
    // Never forced: a conflict comes back as `{ status: 'conflict' }` and goes through Review differences.
    const result = (await syncEbayDraft(draft.id)) as { status?: string; created?: boolean; sku?: unknown };
    if (result?.status === 'conflict') {
      throw new EbayDraftClientError(409, { ...result, error: 'Changed on eBay since the draft started' });
    }
    // The editor's route id for eBay is the SKU; only a create reports it (the page then leaves `new`).
    return { listingId: result?.created && result.sku != null ? String(result.sku) : null, warnings: [] };
  },
  validate: validateEbayEditorFields,
  errorInfo: ebayErrorInfo,
  failureCauseKey: ebayFailureCauseKey,
  readDeviceCopy(key) {
    const raw = obj(readJson(`${EBAY_DEVICE_COPY_PREFIX}${key}`));
    if (!raw || raw.v !== 2 || !obj(raw.fields)) return null;
    return { fields: raw.fields as Partial<EbayEditorFields>, savedAt: Number(raw.savedAt) || 0 };
  },
  writeDeviceCopy(key, fields) {
    return writeJson(`${EBAY_DEVICE_COPY_PREFIX}${key}`, { v: 2, savedAt: Date.now(), fields });
  },
  clearDeviceCopy(key) {
    removeKey(`${EBAY_DEVICE_COPY_PREFIX}${key}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Score input (lib/listingScore/ebay.ts `EbayScoreInput`) from the editor view
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EbayAspectMeta {
  required: string[];
  recommended: string[];
}

/** Editor view → `scoreEbay` input. Category metadata unknown → the aspect checks stay `na`. */
export function ebayScoreInput(fields: EbayEditorFields, facts: ListingFacts = {}, aspectMeta?: EbayAspectMeta | null) {
  fields = normalizeEbayFields(fields);
  const aspects = decodeAspects(fields.aspects);
  const filled = (names: string[]) => names.filter((n) => (aspects[n] ?? []).some((v) => v.trim())).length;
  const price = parseFloat(String(fields.price ?? ''));
  return {
    title: cleanText(fields.title),
    description: cleanText(fields.description),
    imageCount: facts.images ? facts.images.filter((i) => i.staged !== 'delete').length : fields.images.length,
    aspects,
    // SpecificsSection reports required-aspect coverage as `facts.attributes` once the category metadata loaded.
    aspectsRequired: aspectMeta
      ? { required: aspectMeta.required.length, filled: filled(aspectMeta.required) }
      : facts.attributes
        ? { required: facts.attributes.required, filled: facts.attributes.filled }
        : null,
    aspectsRecommended: aspectMeta ? { recommended: aspectMeta.recommended.length, filled: filled(aspectMeta.recommended) } : null,
    condition: fields.condition || null,
    conditionDescription: fields.conditionDescription || null,
    category: fields.categoryId ? { id: fields.categoryId } : null,
    policies: {
      fulfillment: Boolean(fields.fulfillmentPolicyId),
      payment: Boolean(fields.paymentPolicyId),
      return: Boolean(fields.returnPolicyId),
    },
    package: { hasWeight: fields.weight !== '', hasDimensions: fields.length !== '' && fields.width !== '' && fields.height !== '' },
    price: Number.isFinite(price) ? price : null,
    market: facts.market ? { p25: facts.market.p25, p75: facts.market.p75 } : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Route helpers (pages/app/ebay-listings/[sku].tsx, new.tsx)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** eBay has no shop id in the editor contract (drafts are per user + SKU); the engine still needs a stable key. */
export const EBAY_EDITOR_SHOP = 'ebay';

/** Back target: the list with its URL state when the editor was opened from it. */
export function ebayBackHref(): string {
  const nav = readEditorNav();
  if (nav && nav.marketplace === 'ebay' && nav.query) return listHref('ebay', null, nav.query);
  return listHref('ebay', null);
}

/** `[sku]` route param → SKU (≤ 50 characters, no control characters), else null. */
export function parseSkuParam(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const sku = raw.trim();
  return sku && sku.length <= 50 && !/[\u0000-\u001f]/.test(sku) ? sku : null;
}

/** `new` bootstrap from the query (latched once by the page). */
export interface EbayCreateBootstrap {
  draftId: string | null;
  copyFromId: string | null;
  /** `etsy:<listingId>` cross-list source (loaded asynchronously by the page). */
  crosslistEtsyId: string | null;
  prefill: boolean;
}

export function parseEbayCreateQuery(q: Record<string, string | string[] | undefined>): EbayCreateBootstrap {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const draft = one(q.draft);
  const draftId = typeof draft === 'string' && /^[\w-]{1,64}$/.test(draft) ? draft : null;
  const copyFromId = !draftId ? parseSkuParam(one(q.copy)) : null;
  const cross = one(q.crosslist);
  const m = !draftId && !copyFromId && typeof cross === 'string' ? /^etsy:(\d{1,20})$/.exec(cross) : null;
  return {
    draftId,
    copyFromId,
    crosslistEtsyId: m ? m[1] : null,
    prefill: !draftId && !copyFromId && !m && one(q.prefill) === 'session',
  };
}

/** Research hand-off (`ListingPrefillV1`, target ebay) → copy data (legacy `researchPayloadToEbayPrefill`). */
export function ebayCopyFromPrefill(p: { title?: string; description?: string; price?: number; imageUrls?: string[] }): CopySourceData {
  return {
    source: 'research',
    title: (p.title ?? '').slice(0, EBAY_TITLE_MAX),
    description: p.description ?? '',
    tags: [],
    price: typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0 ? p.price : undefined,
    imageUrls: Array.isArray(p.imageUrls)
      ? p.imageUrls.filter((u) => typeof u === 'string' && /^https:\/\//i.test(u)).slice(0, EBAY_MAX_IMAGES)
      : [],
  };
}
