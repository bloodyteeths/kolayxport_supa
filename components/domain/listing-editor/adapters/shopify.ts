// components/domain/listing-editor/adapters/shopify.ts — Shopify staging for the full-page editor
// (marketplace-editors §6.3, §5.3; M6b-C). Shopify used to go live on Save (CRITIQUE #9): every edit now stages into
// the product's `CatalogDraft`; the per-variant optimistic check (`expectedQuantity`) is kept and enforced by the
// executor at Send — for a single-variant product too (its stock is staged as that variant's edit, as the legacy
// editor did), since inventory changes by orders do not move the product's `updated_at` (no conflict would catch it).
// SEO: when the SEO read failed, the SEO key is not owned (never sent as a pair with an unread half). Form contract shared with the M6b-D sections (sections/marketplaceSectionShared.tsx); photos are a
// URL list mapped to Shopify image operations here.
//
// Read: the live product (`GET /api/shopify/products?action=get`), its SEO (`action=seo`, GraphQL) and the shop's
// locations (`action=locations`, multi-location quantity is read-only), plus the grid row (`GET /api/listings?ids=`).
import { isHttpsUrl, LIMITS, SHOPIFY_WEIGHT_UNITS, TITLE_MAX, type ShopifyImageOp, type ShopifyVariantEdit } from '@/lib/catalogDrafts/schemas';
import { decodeEntities, decodeEntityList } from '@/lib/text/decodeEntities';
import { sectionForField } from '@/lib/listingEditor/sections';
import type { CopySourceData, EditorMode, FieldIssue, FieldMap, ListingFacts, ListingMeta, SectionId } from '@/lib/listingEditor/types';
import type { ShopifyScoreInput } from '@/lib/listingScore/shopify';
import { decodeHtmlEntities } from './ebay';
import {
  CatalogEditorLoadError,
  createCatalogAdapter,
  getJson,
  jsonArray,
  loadListingRow,
  numOrBlank,
  numOrNull,
  strList,
  strOf,
  type CatalogAdapterSpec,
  type PatchValues,
} from './catalog';
import type { CatalogCopySource } from './trendyol';
import type { AdapterContext, LoadedListing } from './types';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fields
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ShopifyStatus = 'active' | 'draft' | 'archived';

export interface ShopifyEditorFields extends FieldMap {
  title: string;
  /** body_html. */
  description: string;
  /** Ordered image URLs (existing ones are the product's `src`; their ids are in `imageIds`). */
  images: string[];
  tags: string[];
  vendor: string;
  productType: string;
  status: ShopifyStatus;
  // Single-variant products only (multi-variant: `variants`).
  price: number | '';
  compareAtPrice: number | '';
  sku: string;
  quantity: number | '';
  weight: number | '';
  weightUnit: string;
  seoTitle: string;
  seoDescription: string;
  /** JSON `ShopifyVariantEdit[]`: the edits only (`'[]'` = none); `expectedQuantity` = the quantity the table showed. */
  variants: string;
  // Read-only facts (never staged, never a change).
  imageIds: string[];
  variantCount: number;
  /** Single variant: stock is tracked by Shopify (quantity editable). */
  trackInventory: boolean;
  /** Number of the shop's locations (> 1: quantity is read-only). 0 = unknown. */
  locationCount: number;
  /** The SEO values were read (false: the SEO request failed; the fields start empty). */
  seoLoaded: boolean;
  /** Single variant: its id (the stock edit is staged on it with `expectedQuantity`). '' = unknown / create. */
  variantId: string;
}

export type ShopifyFieldKey = keyof ShopifyEditorFields & string;

export const SHOPIFY_DISPLAY_KEYS = ['imageIds', 'variantCount', 'trackInventory', 'locationCount', 'seoLoaded', 'variantId'] as const;
export const SHOPIFY_MAX_NEW_IMAGES = LIMITS.shopifyImageAdds;

export function blankShopifyFields(defaults: Partial<ShopifyEditorFields> = {}): ShopifyEditorFields {
  return {
    title: '',
    description: '',
    images: [],
    tags: [],
    vendor: '',
    productType: '',
    // marketplace-editors §5.3: new products default to Draft.
    status: 'draft',
    price: '',
    compareAtPrice: '',
    sku: '',
    quantity: '',
    weight: '',
    weightUnit: 'kg',
    seoTitle: '',
    seoDescription: '',
    variants: '[]',
    imageIds: [],
    variantCount: 1,
    trackInventory: true,
    locationCount: 0,
    seoLoaded: true,
    variantId: '',
    ...defaults,
  };
}

export function splitTags(tags: unknown): string[] {
  const list = Array.isArray(tags) ? tags.map(String) : typeof tags === 'string' ? tags.split(',') : [];
  return list.map((t) => t.trim()).filter(Boolean);
}

function statusOf(v: unknown): ShopifyStatus {
  return v === 'active' || v === 'archived' ? v : 'draft';
}

export interface ShopifyProductData {
  product: Record<string, any>;
  seo?: { title?: string | null; description?: string | null } | null;
  locationCount?: number;
}

/** Shopify REST product (+ SEO, locations) → form fields. Text entity-decoded (P5). */
export function shopifyFieldsFromProduct({ product: p, seo, locationCount }: ShopifyProductData): ShopifyEditorFields {
  const variants: any[] = Array.isArray(p?.variants) ? p.variants : [];
  const images: any[] = Array.isArray(p?.images) ? [...p.images].sort((a, b) => (Number(a?.position) || 0) - (Number(b?.position) || 0)) : [];
  const single = variants.length <= 1;
  const v = variants[0] ?? {};
  return blankShopifyFields({
    title: decodeEntities(strOf(p?.title)),
    description: decodeHtmlEntities(strOf(p?.body_html)),
    images: images.map((im) => strOf(im?.src)).filter(Boolean),
    imageIds: images.filter((im) => strOf(im?.src)).map((im) => String(im?.id ?? '')),
    tags: decodeEntityList(splitTags(p?.tags)),
    vendor: decodeEntities(strOf(p?.vendor)),
    productType: decodeEntities(strOf(p?.product_type)),
    status: statusOf(p?.status),
    price: single ? numOrBlank(v.price) : '',
    compareAtPrice: single ? numOrBlank(v.compare_at_price) : '',
    sku: single ? strOf(v.sku) : '',
    quantity: single ? numOrBlank(v.inventory_quantity) : '',
    weight: single ? numOrBlank(v.weight) : '',
    weightUnit: single && strOf(v.weight_unit) ? strOf(v.weight_unit) : 'kg',
    seoTitle: decodeEntities(strOf(seo?.title)),
    seoDescription: decodeEntities(strOf(seo?.description)),
    variants: '[]',
    variantCount: Math.max(1, variants.length),
    trackInventory: single ? v.inventory_management === 'shopify' : false,
    locationCount: Number(locationCount) || 0,
    seoLoaded: seo !== undefined && seo !== null,
    variantId: single && v.id != null ? String(v.id) : '',
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Image operations (target URL list ⇄ delete / add / reorder; the executor applies deletes → adds → positions)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function shopifyImageOps(remoteUrls: string[], remoteIds: string[], current: string[]): ShopifyImageOp[] {
  const remote = remoteUrls.map((url, i) => ({ url, id: remoteIds[i] })).filter((r) => r.id);
  const ops: ShopifyImageOp[] = [];
  for (const r of remote) if (!current.includes(r.url)) ops.push({ op: 'delete', id: r.id });
  const remaining = remote.filter((r) => current.includes(r.url));
  current.forEach((url, i) => {
    const r = remote.find((x) => x.url === url);
    if (!r) ops.push({ op: 'add', src: url, position: i + 1 });
  });
  const hasAdds = ops.some((o) => o.op === 'add');
  current.forEach((url, i) => {
    const r = remote.find((x) => x.url === url);
    if (!r) return;
    const after = remaining.findIndex((x) => x.id === r.id);
    // Positions only when they change (an add before it shifts it too, so then every kept image is placed).
    if (hasAdds || after !== i) ops.push({ op: 'reorder', id: r.id, position: i + 1 });
  });
  return ops;
}

/** Staged image operations over the product's images → the URL list the product will have. */
export function applyShopifyImageOps(remoteUrls: string[], remoteIds: string[], ops: unknown): string[] {
  const list = Array.isArray(ops) ? (ops as Array<Record<string, unknown>>) : [];
  const deleted = new Set(list.filter((o) => o?.op === 'delete').map((o) => String(o.id)));
  const pos = new Map<string, number>();
  for (const o of list) if (o?.op === 'reorder' && typeof o.position === 'number') pos.set(String(o.id), o.position);
  type Item = { url: string; at: number; order: number };
  const items: Item[] = [];
  remoteUrls.forEach((url, i) => {
    const id = remoteIds[i] ?? '';
    if (deleted.has(id)) return;
    items.push({ url, at: pos.get(id) ?? i + 1, order: i });
  });
  list.forEach((o, i) => {
    if (o?.op === 'add' && typeof o.src === 'string' && !items.some((x) => x.url === o.src)) {
      items.push({ url: o.src, at: typeof o.position === 'number' ? o.position : Number.MAX_SAFE_INTEGER, order: 1000 + i });
    }
  });
  return items.sort((a, b) => a.at - b.at || a.order - b.order).map((x) => x.url);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Variant edits (same formula as the sections' `encodeVariantEdits`)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function decodeShopifyVariantEdits(v: unknown): ShopifyVariantEdit[] {
  const out: ShopifyVariantEdit[] = [];
  for (const r of jsonArray(v)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (o.id === undefined || o.id === null) continue;
    const e: ShopifyVariantEdit = { id: String(o.id) };
    const price = numOrNull(o.price);
    if (price !== null) e.price = price;
    if (o.compareAtPrice === null) e.compareAtPrice = null;
    else {
      const c = numOrNull(o.compareAtPrice);
      if (c !== null) e.compareAtPrice = c;
    }
    const q = numOrNull(o.inventoryQuantity);
    if (q !== null) e.inventoryQuantity = q;
    const eq = numOrNull(o.expectedQuantity);
    if (eq !== null) e.expectedQuantity = eq;
    if (typeof o.sku === 'string') e.sku = o.sku;
    if (Object.keys(e).some((k) => k !== 'id' && k !== 'expectedQuantity')) out.push(e);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function encodeShopifyVariantEdits(list: ShopifyVariantEdit[]): string {
  const kept = list.filter((e) => Object.keys(e).some((k) => k !== 'id' && k !== 'expectedQuantity'));
  return kept.length ? JSON.stringify([...kept].sort((a, b) => a.id.localeCompare(b.id))) : '[]';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Patch
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const SINGLE_KEYS = ['price', 'compareAtPrice', 'sku', 'quantity', 'weight', 'weightUnit'] as const;
export const SHOPIFY_PATCH_KEYS = [
  'title', 'description', 'tags', 'vendor', 'productType', 'status', 'seo', 'images', 'variants', ...SINGLE_KEYS,
] as const;

/** The form owns `seo` only when the SEO values were read (an unread description must never be sent as ''). */
export function shopifyPatchKeys(mode: EditorMode, remote: ShopifyEditorFields | null): readonly string[] {
  if (mode === 'edit' && remote && remote.seoLoaded === false) return SHOPIFY_PATCH_KEYS.filter((k) => k !== 'seo');
  return SHOPIFY_PATCH_KEYS;
}

export function shopifyToPatch(f: ShopifyEditorFields, remote: ShopifyEditorFields | null, mode: EditorMode): PatchValues {
  const multi = (remote?.variantCount ?? f.variantCount) > 1;
  const multiLocation = (remote?.locationCount ?? f.locationCount) > 1;
  const tracked = mode === 'create' ? true : remote?.trackInventory ?? f.trackInventory;
  const title = f.title.trim();
  const compare = numOrNull(f.compareAtPrice);
  const remoteCompare = remote ? numOrNull(remote.compareAtPrice) : null;
  const ops = shopifyImageOps(remote?.images ?? [], remote?.imageIds ?? [], strList(f.images));
  const edits = decodeShopifyVariantEdits(f.variants);
  const unit = (SHOPIFY_WEIGHT_UNITS as readonly string[]).includes(f.weightUnit) ? f.weightUnit : undefined;
  // Single variant, edit: stock goes out as the variant's edit with the quantity the editor showed (STOCK_CHANGED
  // at Send when orders moved it meanwhile), never as a blind `quantity` overwrite.
  const stockEditable = !multi && tracked && !multiLocation;
  const variantId = mode === 'edit' && remote ? remote.variantId : '';
  const qty = numOrNull(f.quantity);
  const expected = remote ? numOrNull(remote.quantity) : null;
  const singleStock: ShopifyVariantEdit[] | undefined =
    stockEditable && variantId && qty !== null
      ? [{ id: variantId, inventoryQuantity: qty, ...(expected !== null ? { expectedQuantity: expected } : {}) }]
      : undefined;
  const remoteWeight = remote ? numOrNull(remote.weight) : null;
  return {
    title: title || undefined,
    description: f.description,
    tags: splitTags(f.tags),
    vendor: f.vendor.trim(),
    productType: f.productType.trim(),
    status: f.status,
    seo: remote && remote.seoLoaded === false ? undefined : { title: f.seoTitle.trim(), description: f.seoDescription.trim() },
    images: ops.length ? ops : undefined,
    variants: multi ? (edits.length ? edits : undefined) : singleStock,
    // Single-variant keys (refused by the server for variant products).
    price: multi ? undefined : numOrNull(f.price) ?? undefined,
    // Clearing a compare-at price is staged as 0.
    compareAtPrice: multi ? undefined : compare ?? (remoteCompare !== null ? 0 : undefined),
    sku: multi ? undefined : f.sku.trim(),
    quantity: !stockEditable || variantId ? undefined : qty ?? undefined,
    // Clearing the weight of a product that has one is staged as 0 (never a silent no-op).
    weight: multi ? undefined : numOrNull(f.weight) ?? (remoteWeight !== null && remoteWeight !== 0 ? 0 : undefined),
    weightUnit: multi || numOrNull(f.weight) === null ? undefined : unit,
  };
}

export function overlayShopify(
  base: ShopifyEditorFields,
  patch: Record<string, unknown>,
): { fields: ShopifyEditorFields; extra: Record<string, unknown>; applied: number } {
  const f: ShopifyEditorFields = { ...base };
  const extra: Record<string, unknown> = {};
  let applied = 0;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined || v === null) continue;
    applied += 1;
    switch (k) {
      case 'title':
      case 'vendor':
      case 'productType':
      case 'sku':
        f[k] = decodeEntities(strOf(v));
        break;
      case 'description':
        f.description = decodeHtmlEntities(strOf(v));
        break;
      case 'tags':
        f.tags = decodeEntityList(splitTags(v));
        break;
      case 'status':
        f.status = statusOf(v);
        break;
      case 'price':
      case 'quantity':
      case 'weight':
        f[k] = numOrBlank(v);
        break;
      case 'compareAtPrice': {
        const n = numOrNull(v);
        f.compareAtPrice = n === null || n === 0 ? '' : n;
        break;
      }
      case 'weightUnit':
        f.weightUnit = strOf(v) || f.weightUnit;
        break;
      case 'seo': {
        // SEO not read: the staged value stays in the draft untouched (no input owns it, never re-sent as a pair).
        if (!base.seoLoaded) {
          extra[k] = v;
          applied -= 1;
          break;
        }
        const s = v as { title?: unknown; description?: unknown };
        if (typeof s?.title === 'string') f.seoTitle = decodeEntities(s.title);
        if (typeof s?.description === 'string') f.seoDescription = decodeEntities(s.description);
        break;
      }
      case 'variants': {
        const edits = decodeShopifyVariantEdits(v);
        // Single variant: its staged stock edit is the Quantity field.
        const own = base.variantCount <= 1 && base.variantId ? edits.find((e) => e.id === base.variantId) : undefined;
        if (own && own.inventoryQuantity !== undefined && edits.length === 1) f.quantity = own.inventoryQuantity;
        else f.variants = encodeShopifyVariantEdits(edits);
        break;
      }
      case 'images':
        f.images = applyShopifyImageOps(base.images, base.imageIds, v);
        break;
      default:
        extra[k] = v;
        applied -= 1;
    }
  }
  return { fields: f, extra, applied };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function sectionOf(field: string): SectionId {
  return sectionForField(field, 'shopify') ?? 'title';
}

function formKeyFor(serverKey: string): string {
  if (serverKey === 'seo' || serverKey === 'seo.title') return 'seoTitle';
  if (serverKey === 'seo.description') return 'seoDescription';
  return serverKey;
}

export function validateShopifyFields(f: ShopifyEditorFields, mode: EditorMode): FieldIssue[] {
  const out: FieldIssue[] = [];
  const push = (field: string, severity: FieldIssue['severity'], key: string, params?: Record<string, string | number>) =>
    out.push({ field, section: sectionOf(field), severity, key, ...(params ? { params } : {}) });
  const create = mode === 'create';
  const title = f.title.trim();
  if (!title) push('title', create ? 'block_sync' : 'block_save', 'listings.draftError.invalidTitle', { max: TITLE_MAX.shopify });
  else if (title.length > TITLE_MAX.shopify) push('title', 'block_save', 'listings.draftError.invalidTitle', { max: TITLE_MAX.shopify });

  const multi = f.variantCount > 1;
  if (!multi) {
    const price = numOrNull(f.price);
    if (f.price !== '' && (price === null || price < 0)) push('price', 'block_save', 'listings.validate.priceInvalid');
    else if (create && price === null) push('price', 'block_sync', 'listings.validate.priceInvalid');
    // An existing product's price / stock can't be cleared (it would be a silent no-op).
    else if (!create && price === null) push('price', 'block_save', 'listingEditor.catalog.required');
    const compare = numOrNull(f.compareAtPrice);
    if (f.compareAtPrice !== '' && (compare === null || compare < 0)) push('compareAtPrice', 'block_save', 'listings.validate.priceInvalid');
    const q = numOrNull(f.quantity);
    if (f.quantity !== '' && (q === null || !Number.isInteger(q) || q < 0)) push('quantity', 'block_save', 'listings.validate.qtyInvalid');
    else if (!create && f.quantity === '' && f.trackInventory && f.locationCount <= 1) push('quantity', 'block_save', 'listingEditor.catalog.required');
    const w = numOrNull(f.weight);
    if (f.weight !== '' && (w === null || w < 0 || w > LIMITS.weightMax)) push('weight', 'block_save', 'listings.draftError.invalidNumber', { min: 0, max: LIMITS.weightMax });
    if (f.sku.trim().length > LIMITS.shopifyText) push('sku', 'block_save', 'listings.draftError.textTooLong', { max: LIMITS.shopifyText });
  }
  for (const k of ['vendor', 'productType'] as const) {
    if (f[k].trim().length > LIMITS.shopifyText) push(k, 'block_save', 'listings.draftError.textTooLong', { max: LIMITS.shopifyText });
  }
  if (splitTags(f.tags).some((t) => t.length > 255 || t.includes(','))) push('tags', 'block_save', 'listings.draftError.invalidTags');
  // SEO not read (the request failed): typed SEO text could not be sent without erasing the unread half.
  if (!create && !f.seoLoaded && (f.seoTitle.trim() || f.seoDescription.trim())) push('seoTitle', 'block_save', 'listingEditor.shopify.seoUnavailable');
  if (f.seoTitle.trim().length > LIMITS.shopifySeoTitle) push('seoTitle', 'block_save', 'listings.draftError.textTooLong', { max: LIMITS.shopifySeoTitle });
  if (f.seoDescription.trim().length > LIMITS.shopifySeoDescription) push('seoDescription', 'block_save', 'listings.draftError.textTooLong', { max: LIMITS.shopifySeoDescription });
  return out;
}

/** New photos beyond Shopify's per-send add limit, or not public https (Shopify downloads them at Send). */
export function shopifyInvalidNewImages(f: ShopifyEditorFields, remote: ShopifyEditorFields | null): string[] {
  const known = new Set(remote?.images ?? []);
  return strList(f.images).filter((u) => !known.has(u) && !isHttpsUrl(u));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Load
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function shopQs(shopId: string, extra: Record<string, string>): string {
  const qs = new URLSearchParams(extra);
  if (shopId) qs.set('shopId', shopId);
  return qs.toString();
}

export async function fetchShopifyProduct(shopId: string, productId: string): Promise<ShopifyProductData> {
  if (!/^\d{1,20}$/.test(productId)) throw new CatalogEditorLoadError(404, 'listingEditor.shopify.notFound');
  let data: { product?: Record<string, unknown> | null };
  try {
    data = (await getJson(`/api/shopify/products?${shopQs(shopId, { action: 'get', id: productId })}`)) as { product?: Record<string, unknown> | null };
  } catch (err) {
    if (err instanceof CatalogEditorLoadError && (err.status === 400 || err.status === 404) && !err.key) {
      // 400/404 here = no active Shopify shop: the frame offers "Reconnect".
      throw new CatalogEditorLoadError(401, null);
    }
    throw err;
  }
  if (!data?.product || typeof data.product !== 'object') throw new CatalogEditorLoadError(404, 'listingEditor.shopify.notFound');
  const [seo, locations] = await Promise.all([
    getJson(`/api/shopify/products?${shopQs(shopId, { action: 'seo', id: productId })}`)
      .then((d) => ((d as { seo?: { title?: string; description?: string } | null })?.seo ?? { title: '', description: '' }))
      .catch(() => null),
    getJson(`/api/shopify/products?${shopQs(shopId, { action: 'locations' })}`)
      .then((d) => {
        const list = (d as { locations?: unknown[] })?.locations;
        return Array.isArray(list) ? list.filter((l) => (l as { active?: unknown })?.active !== false).length : 0;
      })
      .catch(() => 0),
  ]);
  return { product: data.product, seo, locationCount: locations };
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export function shopifyMeta(data: ShopifyProductData, row: Record<string, unknown> | null, currency: string | null): ListingMeta {
  const p = data.product;
  const images: any[] = Array.isArray(p?.images) ? [...p.images].sort((a, b) => (Number(a?.position) || 0) - (Number(b?.position) || 0)) : [];
  const updated = p?.updated_at ? new Date(String(p.updated_at)) : null;
  return {
    id: p?.id != null ? String(p.id) : null,
    state: row && typeof row.status === 'string' ? row.status : strOf(p?.status) || null,
    url: row && typeof row.externalUrl === 'string' ? row.externalUrl : null,
    updatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
    views: 0,
    favorites: 0,
    currency: currency || null,
    images: images
      .filter((im) => strOf(im?.src))
      .map((im, i) => ({ id: String(im.id), src: strOf(im.src), rank: i + 1, alt: decodeEntities(strOf(im.alt)) })),
    raw: {
      ...p,
      seo: data.seo ?? null,
      locationCount: data.locationCount ?? 0,
      currency: currency || null,
      shopDomain: hostOf(row && typeof row.externalUrl === 'string' ? row.externalUrl : null),
      ...(row ? { listingRow: row } : {}),
    },
  };
}

export async function loadShopifyListing(ctx: AdapterContext): Promise<LoadedListing<ShopifyEditorFields>> {
  const id = ctx.listingId;
  if (!id) throw new CatalogEditorLoadError(404);
  const [data, listing] = await Promise.all([fetchShopifyProduct(ctx.shopId, id), loadListingRow('shopify', ctx.shopId, id)]);
  return { fields: shopifyFieldsFromProduct(data), meta: shopifyMeta(data, listing.row, listing.store?.currency || null) };
}

export async function loadShopifyCopySource(ctx: AdapterContext): Promise<CatalogCopySource | null> {
  if (!ctx.listingId) return null;
  const f = shopifyFieldsFromProduct(await fetchShopifyProduct(ctx.shopId, ctx.listingId));
  return {
    title: f.title,
    description: f.description,
    tags: f.tags,
    price: numOrNull(f.price) ?? undefined,
    quantity: numOrNull(f.quantity) ?? undefined,
    imageUrls: f.images.filter((u) => isHttpsUrl(u)),
    catalogFields: {
      vendor: f.vendor,
      productType: f.productType,
      compareAtPrice: f.compareAtPrice,
      weight: f.weight,
      weightUnit: f.weightUnit,
      seoTitle: f.seoTitle,
      seoDescription: f.seoDescription,
    },
  };
}

export function shopifyFieldsFromCopy(src: CopySourceData): Partial<ShopifyEditorFields> {
  const out: Partial<ShopifyEditorFields> = {
    title: (src.title ?? '').slice(0, TITLE_MAX.shopify),
    description: src.description ?? '',
    tags: splitTags(src.tags ?? []),
  };
  if (typeof src.price === 'number' && src.price > 0) out.price = Math.round(src.price * 100) / 100;
  if (typeof src.quantity === 'number' && src.quantity >= 0) out.quantity = Math.round(src.quantity);
  const urls = (src.imageUrls ?? []).filter((u) => isHttpsUrl(u)).slice(0, SHOPIFY_MAX_NEW_IMAGES);
  if (urls.length) out.images = urls;
  const same = (src as CatalogCopySource).catalogFields;
  if (same && typeof same === 'object') {
    const blank = blankShopifyFields();
    for (const [k, v] of Object.entries(same)) {
      if (k in blank && !SHOPIFY_DISPLAY_KEYS.includes(k as never) && v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function shopifyScoreInput(f: ShopifyEditorFields, facts: ListingFacts = {}): ShopifyScoreInput {
  return {
    title: f.title,
    description: f.description,
    imageCount: facts.images ? facts.images.filter((i) => i.staged !== 'delete').length : strList(f.images).length,
    seoTitle: f.seoLoaded ? f.seoTitle : undefined,
    seoDescription: f.seoLoaded ? f.seoDescription : undefined,
    tags: splitTags(f.tags),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SHOPIFY_ADAPTER_SPEC: CatalogAdapterSpec<ShopifyEditorFields> = {
  marketplace: 'shopify',
  blankFields: blankShopifyFields,
  displayOnlyKeys: SHOPIFY_DISPLAY_KEYS,
  createOnlyKeys: [],
  patchKeys: (mode, _fields, remote) => shopifyPatchKeys(mode, remote),
  toPatch: (f, remote, mode) => shopifyToPatch(f, remote, mode),
  toCreatePayload: () => ({}),
  overlayPatch: (base, patch) => overlayShopify(base, patch),
  load: loadShopifyListing,
  loadCopySource: loadShopifyCopySource,
  fieldsFromCopy: shopifyFieldsFromCopy,
  validate: validateShopifyFields,
  error: { marketplace: 'shopify', sectionFor: sectionOf, formKeyFor },
  defaultKeys: ['vendor', 'productType', 'status', 'weightUnit'],
};

export const shopifyAdapter = createCatalogAdapter(SHOPIFY_ADAPTER_SPEC);
