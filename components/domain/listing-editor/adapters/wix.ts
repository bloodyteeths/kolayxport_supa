// components/domain/listing-editor/adapters/wix.ts — Wix staging for the full-page editor (marketplace-editors §6.2,
// §5.2; M6b-C). Fixes the legacy drawer's silent data loss (#1): every rendered field is in the staged patch,
// collections and discount included. Form contract shared with the M6b-D sections
// (sections/marketplaceSectionShared.tsx); photos are a URL list mapped to Wix media operations here.
//
// Read: the `WixProduct` cache row (`GET /api/wix/products?action=list&fromCache=true`, the same row the draft's base
// snapshot comes from) + the grid row (`GET /api/listings?ids=`) for the link and the store currency.
// That cache read is scoped to the user's first active Wix site (the API takes no site param yet): a row of another
// site is never edited here (`listingEditor.wix.otherSite`), so a draft is never staged against the wrong site.
//
// Discount. The cache keeps the sale price only, not the discount's type / value. An existing discount is shown as
// the amount off it is today, but marked `discountKnown: false`: it is never re-staged as a guess, and a price
// edit on such a product is blocked until the seller sets the discount (type + value) themselves.
// Write: `CatalogDraft` only (adapters/catalog.ts); nothing reaches Wix before the footer's Send.
import { isHttpsUrl, LIMITS, TITLE_MAX, type WixCustomTextField, type WixDiscount, type WixMediaOp } from '@/lib/catalogDrafts/schemas';
import { WIX_ALL_PRODUCTS } from '@/lib/catalogDrafts/values';
import { decodeEntities } from '@/lib/text/decodeEntities';
import { sectionForField } from '@/lib/listingEditor/sections';
import type { CopySourceData, EditorMode, FieldIssue, FieldMap, ListingFacts, ListingMeta, SectionId } from '@/lib/listingEditor/types';
import type { WixScoreInput } from '@/lib/listingScore/wix';
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

export type WixDiscountType = 'NONE' | 'AMOUNT' | 'PERCENT';

export interface WixEditorFields extends FieldMap {
  title: string;
  /** HTML (Wix rich text). */
  description: string;
  /** Ordered image URLs. Existing ones are the product's media URLs (their ids are in `imageIds`). */
  images: string[];
  price: number | '';
  discountType: WixDiscountType;
  discountValue: number | '';
  sku: string;
  weight: number | '';
  ribbon: string;
  visible: boolean;
  trackInventory: boolean;
  quantity: number | '';
  inStock: boolean;
  /** Seller collections (Wix's built-in "All products" is never in the set). */
  collectionIds: string[];
  /** JSON `WixCustomTextField[]` (personalization). */
  customTextFields: string;
  // Read-only facts (never staged, never a change).
  /** Media ids parallel to the product's `images` (remote order). */
  imageIds: string[];
  /** Variant count (> 1: price / stock are per variant and read-only here). */
  variantCount: number;
  /** The product's media URLs as loaded (new photos are the ones not in this list). */
  remoteImages: string[];
  /** False when the product has a discount whose type / value the cache does not keep (see the header). */
  discountKnown: boolean;
  /** Price and amount off as loaded (the price-edit guard of an unknown discount compares with these). */
  loadedPrice: number | '';
  discountGuess: number | '';
}

export type WixFieldKey = keyof WixEditorFields & string;

export const WIX_DISPLAY_KEYS = ['imageIds', 'variantCount', 'remoteImages', 'discountKnown', 'loadedPrice', 'discountGuess'] as const;
export const WIX_MAX_IMAGES = LIMITS.wixMediaAdds;

export function blankWixFields(defaults: Partial<WixEditorFields> = {}): WixEditorFields {
  return {
    title: '',
    description: '',
    images: [],
    price: '',
    discountType: 'NONE',
    discountValue: '',
    sku: '',
    weight: '',
    ribbon: '',
    visible: true,
    trackInventory: true,
    quantity: '',
    inStock: true,
    collectionIds: [],
    customTextFields: '[]',
    imageIds: [],
    variantCount: 1,
    remoteImages: [],
    discountKnown: true,
    loadedPrice: '',
    discountGuess: '',
    ...defaults,
  };
}

function textFields(raw: unknown): WixCustomTextField[] {
  return jsonArray(raw)
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object' && typeof (f as Record<string, unknown>).title === 'string')
    .map((f) => ({
      title: String(f.title),
      maxLength: Math.max(0, Math.round(numOrNull(f.maxLength) ?? 0)),
      mandatory: f.mandatory === true,
    }));
}

/** Same formula as the sections' `encodeTextFields`. */
export function encodeWixTextFields(list: WixCustomTextField[]): string {
  return JSON.stringify(list.map((f) => ({ title: f.title, maxLength: f.maxLength, mandatory: f.mandatory })));
}

/** `wix:image://v1/<id>/…` → the static URL (as the cache's thumbnail). */
export function wixImageUrl(u: string): string {
  if (!u.startsWith('wix:image')) return u;
  return `https://static.wixstatic.com/media/${u.replace('wix:image://v1/', '').split('/')[0]}`;
}

/** Cache `images` (mainMedia + media items, with duplicates) → unique `{ id, url }` in order. */
export function wixMediaItems(raw: unknown): Array<{ id: string; url: string }> {
  const out: Array<{ id: string; url: string }> = [];
  for (const it of Array.isArray(raw) ? raw : []) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, any>;
    const id = typeof r.id === 'string' ? r.id : '';
    const u = r.image?.url ?? r.url ?? r.thumbnail?.url ?? r.video?.files?.[0]?.url;
    if (!id || typeof u !== 'string' || !u) continue;
    if (out.some((x) => x.id === id)) continue;
    out.push({ id, url: wixImageUrl(u) });
  }
  return out;
}

function collections(raw: unknown): string[] {
  return Array.from(new Set(strList(raw).filter((id) => id && id !== WIX_ALL_PRODUCTS)));
}

/** `WixProduct` cache row → form fields. Text entity-decoded (P5). */
export function wixFieldsFromRow(row: Record<string, unknown>): WixEditorFields {
  const media = wixMediaItems(row.images);
  const price = numOrNull(row.price);
  const sale = numOrNull(row.discountPrice);
  // The cache keeps the sale price only (not the discount's type / value): show today's amount off, marked unknown.
  const off = price !== null && sale !== null && sale < price ? Math.round((price - sale) * 100) / 100 : null;
  return blankWixFields({
    title: decodeEntities(strOf(row.title)),
    description: decodeHtmlEntities(strOf(row.description)),
    images: media.map((m) => m.url),
    imageIds: media.map((m) => m.id),
    remoteImages: media.map((m) => m.url),
    price: price ?? '',
    loadedPrice: price ?? '',
    discountType: off ? 'AMOUNT' : 'NONE',
    discountValue: off ?? '',
    discountKnown: !off,
    discountGuess: off ?? '',
    sku: strOf(row.sku),
    weight: numOrBlank(row.weight),
    ribbon: decodeEntities(strOf(row.ribbon)),
    visible: row.visible !== false,
    trackInventory: row.trackInventory !== false,
    quantity: numOrBlank(row.quantity),
    inStock: row.inStock !== false,
    collectionIds: collections(row.collectionIds),
    customTextFields: encodeWixTextFields(textFields(row.customTextFields)),
    variantCount: Math.max(1, Array.isArray(row.variants) ? row.variants.length : 1),
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Media operations (target URL list ⇄ remove / reorder / add, applied by the executor in that order)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function wixMediaOps(remoteUrls: string[], remoteIds: string[], current: string[]): WixMediaOp[] {
  const remote = remoteUrls.map((url, i) => ({ url, id: remoteIds[i] })).filter((r) => r.id);
  const ops: WixMediaOp[] = [];
  for (const r of remote) if (!current.includes(r.url)) ops.push({ op: 'remove', mediaId: r.id });
  const kept = current
    .map((url) => remote.find((r) => r.url === url))
    .filter((r): r is { url: string; id: string } => Boolean(r));
  const keptIds = Array.from(new Set(kept.map((r) => r.id)));
  const remainingInRemoteOrder = remote.filter((r) => current.includes(r.url)).map((r) => r.id);
  if (keptIds.length > 1 && keptIds.join('|') !== remainingInRemoteOrder.join('|')) ops.push({ op: 'reorder', ids: keptIds });
  for (const url of current) if (!remote.some((r) => r.url === url)) ops.push({ op: 'add', url });
  return ops;
}

/** Staged media operations over the product's media → the URL list the product will have (adds appended). */
export function applyWixMediaOps(remoteUrls: string[], remoteIds: string[], ops: unknown): string[] {
  let items = remoteUrls.map((url, i) => ({ url, id: remoteIds[i] ?? '' }));
  const list = Array.isArray(ops) ? (ops as Array<Record<string, unknown>>) : [];
  const removed = new Set(list.filter((o) => o?.op === 'remove').map((o) => String(o.mediaId)));
  items = items.filter((i) => !removed.has(i.id));
  const reorder = [...list].reverse().find((o) => o?.op === 'reorder');
  if (reorder && Array.isArray(reorder.ids)) {
    const ids = (reorder.ids as unknown[]).map(String);
    items = [...items].sort((a, b) => {
      const ia = ids.indexOf(a.id);
      const ib = ids.indexOf(b.id);
      return (ia < 0 ? ids.length : ia) - (ib < 0 ? ids.length : ib);
    });
  }
  const urls = items.map((i) => i.url);
  for (const o of list) if (o?.op === 'add' && typeof o.url === 'string' && !urls.includes(o.url)) urls.push(o.url);
  return urls;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Patch
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const WIX_PATCH_KEYS = [
  'title', 'description', 'price', 'discount', 'sku', 'weight', 'ribbon', 'visible', 'trackInventory', 'quantity', 'inStock',
  'collectionIds', 'customTextFields', 'media',
] as const;

export function wixDiscountOf(f: Pick<WixEditorFields, 'discountType' | 'discountValue'>): WixDiscount {
  const v = numOrNull(f.discountValue);
  if ((f.discountType === 'AMOUNT' || f.discountType === 'PERCENT') && v !== null && v > 0) return { type: f.discountType, value: v };
  return { type: 'NONE', value: 0 };
}

/** Form → canonical patch values. `remote` (edit) supplies the media ids. */
export function wixToPatch(f: WixEditorFields, remote: WixEditorFields | null): PatchValues {
  const multi = (remote?.variantCount ?? f.variantCount) > 1;
  const title = f.title.trim();
  const ops = wixMediaOps(remote?.images ?? [], remote?.imageIds ?? [], strList(f.images));
  return {
    title: title || undefined,
    description: f.description,
    // Variant products: price and stock are per variant (server MULTI_VARIANT); never staged from here.
    price: multi ? undefined : numOrNull(f.price) ?? undefined,
    discount: wixDiscountOf(f),
    sku: f.sku.trim(),
    // Clearing the weight of a product that has one is staged as 0 (never a silent no-op).
    weight: numOrNull(f.weight) ?? (remote && numOrNull(remote.weight) !== null ? 0 : undefined),
    ribbon: f.ribbon.trim(),
    visible: f.visible,
    trackInventory: f.trackInventory,
    quantity: multi || !f.trackInventory ? undefined : numOrNull(f.quantity) ?? undefined,
    inStock: multi || f.trackInventory ? undefined : f.inStock,
    collectionIds: [...strList(f.collectionIds)].sort(),
    customTextFields: textFields(f.customTextFields),
    media: ops.length ? ops : undefined,
  };
}

/**
 * Server rule DISCOUNTED: a price edit of a discounted product is staged together with its discount (Wix applies
 * the discount on top of the base price). Only a discount whose type / value is known is re-sent: a discount the
 * cache cannot describe is never re-staged as a guess (validation blocks that price edit instead).
 */
export function wixFinalizePatch(body: Record<string, unknown>, ctx: { remote: WixEditorFields | null; next: PatchValues }): Record<string, unknown> {
  if (ctx.remote && ctx.remote.discountKnown === false) return body;
  const remoteDiscounted = ctx.remote ? wixDiscountOf(ctx.remote).type !== 'NONE' : false;
  if (body.price !== null && body.price !== undefined && remoteDiscounted && (body.discount === null || body.discount === undefined)) {
    return { ...body, discount: ctx.next.discount };
  }
  return body;
}

export function overlayWix(
  base: WixEditorFields,
  patch: Record<string, unknown>,
): { fields: WixEditorFields; extra: Record<string, unknown>; applied: number } {
  const f: WixEditorFields = { ...base };
  const extra: Record<string, unknown> = {};
  let applied = 0;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined || v === null) continue;
    applied += 1;
    switch (k) {
      case 'title':
      case 'sku':
      case 'ribbon':
        f[k] = decodeEntities(strOf(v));
        break;
      case 'description':
        f.description = decodeHtmlEntities(strOf(v));
        break;
      case 'price':
      case 'weight':
      case 'quantity':
        f[k] = numOrBlank(v);
        break;
      case 'visible':
      case 'trackInventory':
      case 'inStock':
        if (typeof v === 'boolean') f[k] = v;
        break;
      case 'discount': {
        const d = v as Partial<WixDiscount>;
        const type: WixDiscountType = d?.type === 'AMOUNT' || d?.type === 'PERCENT' ? d.type : 'NONE';
        f.discountType = type;
        f.discountValue = type === 'NONE' ? '' : numOrBlank(d?.value);
        break;
      }
      case 'collectionIds':
        f.collectionIds = collections(v);
        break;
      case 'customTextFields':
        f.customTextFields = encodeWixTextFields(textFields(v));
        break;
      case 'media':
        f.images = applyWixMediaOps(base.images, base.imageIds, v);
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
  // Wix keeps weight in Price & inventory (no shipping section); media ops are photos (FIELD_SECTION_BY.wix).
  return sectionForField(field, 'wix') ?? 'title';
}

/** The seller has not set the discount of a product whose discount type / value is unknown. */
export function wixDiscountUntouched(f: Pick<WixEditorFields, 'discountKnown' | 'discountType' | 'discountValue' | 'discountGuess'>): boolean {
  return f.discountKnown === false && f.discountType === 'AMOUNT' && numOrNull(f.discountValue) === numOrNull(f.discountGuess);
}

/** New photos (not on the product yet). */
export function wixNewImages(f: Pick<WixEditorFields, 'images' | 'remoteImages'>): string[] {
  const known = new Set(strList(f.remoteImages));
  return strList(f.images).filter((u) => !known.has(u));
}

function formKeyFor(serverKey: string): string {
  if (serverKey === 'media') return 'images';
  if (serverKey === 'discount') return 'discountValue';
  return serverKey;
}

export function validateWixFields(f: WixEditorFields, mode: EditorMode): FieldIssue[] {
  const out: FieldIssue[] = [];
  const push = (field: string, severity: FieldIssue['severity'], key: string, params?: Record<string, string | number>) =>
    out.push({ field, section: sectionOf(field), severity, key, ...(params ? { params } : {}) });
  const create = mode === 'create';
  const title = f.title.trim();
  if (!title) push('title', create ? 'block_sync' : 'block_save', 'listings.draftError.invalidTitle', { max: TITLE_MAX.wix });
  else if (title.length > TITLE_MAX.wix) push('title', 'block_save', 'listings.draftError.invalidTitle', { max: TITLE_MAX.wix });

  const multi = f.variantCount > 1;
  const price = numOrNull(f.price);
  if (!multi) {
    if (f.price !== '' && (price === null || price <= 0)) push('price', 'block_save', 'listings.validate.priceInvalid');
    else if (create && price === null) push('price', 'block_sync', 'listings.validate.priceInvalid');
    // An existing product's price can't be cleared (it would be a silent no-op).
    else if (!create && price === null) push('price', 'block_save', 'listingEditor.catalog.required');
    // Unknown discount (cache keeps the sale price only): the price is edited together with an explicit discount.
    else if (!create && price !== null && price !== numOrNull(f.loadedPrice) && wixDiscountUntouched(f)) {
      push('price', 'block_save', 'listingEditor.wix.discountUnknown');
    }
  }
  const disc = numOrNull(f.discountValue);
  if (f.discountType !== 'NONE' && f.discountValue !== '') {
    if (disc === null || disc < 0) push('discountValue', 'block_save', 'listings.draftError.invalidDiscount');
    else if (f.discountType === 'PERCENT' && disc >= 100) push('discountValue', 'block_save', 'listings.draftError.invalidDiscount');
    else if (f.discountType === 'AMOUNT' && price !== null && disc >= price) push('discountValue', 'block_save', 'listings.draftError.invalidDiscount');
  }
  if (!multi && f.trackInventory) {
    const q = numOrNull(f.quantity);
    if (f.quantity !== '' && (q === null || !Number.isInteger(q) || q < 0)) push('quantity', 'block_save', 'listings.validate.qtyInvalid');
    else if (!create && f.quantity === '') push('quantity', 'block_save', 'listingEditor.catalog.required');
  }
  if (f.sku.trim().length > LIMITS.wixSku) push('sku', 'block_save', 'listings.draftError.textTooLong', { max: LIMITS.wixSku });
  if (f.ribbon.trim().length > LIMITS.wixRibbon) push('ribbon', 'block_save', 'listings.draftError.textTooLong', { max: LIMITS.wixRibbon });
  const w = numOrNull(f.weight);
  if (f.weight !== '' && (w === null || w < 0 || w > LIMITS.weightMax)) push('weight', 'block_save', 'listings.draftError.invalidNumber', { min: 0, max: LIMITS.weightMax });
  // 15 is Wix's per-send add limit: only new photos count (a product may already have more).
  if (wixNewImages(f).length > WIX_MAX_IMAGES) push('images', 'block_save', 'listings.draftError.invalidMedia', { max: WIX_MAX_IMAGES });
  const tf = textFields(f.customTextFields);
  if (tf.length > LIMITS.wixTextFields || tf.some((x) => !x.title.trim() || x.title.length > LIMITS.wixTextFieldTitle || x.maxLength < 1 || x.maxLength > LIMITS.wixTextFieldMaxLength)) {
    push('customTextFields', 'block_save', 'listings.draftError.invalidTextFields', { max: LIMITS.wixTextFields });
  }
  return out;
}

/** New photos must be public https URLs (Wix downloads them at Send). Separate so the photo section can warn. */
export function wixInvalidNewImages(f: WixEditorFields, remote: WixEditorFields | null): string[] {
  const known = new Set(remote?.images ?? []);
  return strList(f.images).filter((u) => !known.has(u) && !isHttpsUrl(u));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Load
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Pages of the cache read while looking for one product (500 × 20 = 10 000 products). */
const PAGE_SIZE = 500;
const MAX_PAGES = 20;

/**
 * The `WixProduct` cache row (no single-product read exists; the cache list is paged until it is found).
 * `siteId` = the editor's store (`WixSite.id`). The API reads the user's first active site whatever `site` says
 * (backend delta requested); a page of another site's rows means this product's site can't be read here.
 */
export async function fetchWixRow(productId: string, siteId?: string | null): Promise<Record<string, unknown>> {
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const qs = new URLSearchParams({ action: 'list', fromCache: 'true', size: String(PAGE_SIZE), page: String(page) });
    if (siteId) qs.set('site', siteId);
    let data: { content?: unknown[]; totalPages?: number };
    try {
      data = (await getJson(`/api/wix/products?${qs.toString()}`)) as { content?: unknown[]; totalPages?: number };
    } catch (err) {
      // 400 = Wix is not connected (the API's credential check): the frame offers "Reconnect".
      if (err instanceof CatalogEditorLoadError && err.status === 400) throw new CatalogEditorLoadError(401, err.key);
      throw err;
    }
    const rows = Array.isArray(data?.content) ? (data.content as Record<string, unknown>[]) : [];
    if (siteId && rows.some((r) => r && typeof r.wixSiteId === 'string' && r.wixSiteId !== siteId)) {
      throw new CatalogEditorLoadError(404, 'listingEditor.wix.otherSite');
    }
    const hit = rows.find((r) => r && r.wixProductId === productId);
    if (hit) return hit;
    const total = Number(data?.totalPages) || 0;
    if (rows.length < PAGE_SIZE || page + 1 >= total) break;
  }
  throw new CatalogEditorLoadError(404, 'listingEditor.wix.notFound');
}

export function wixMeta(row: Record<string, unknown>, listingRow: Record<string, unknown> | null, currency: string | null): ListingMeta {
  const media = wixMediaItems(row.images);
  const updated = row.wixUpdatedDate ? new Date(String(row.wixUpdatedDate)) : null;
  return {
    id: strOf(row.wixProductId) || null,
    state: listingRow && typeof listingRow.status === 'string' ? listingRow.status : null,
    url: listingRow && typeof listingRow.externalUrl === 'string' ? listingRow.externalUrl : null,
    updatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
    views: 0,
    favorites: 0,
    currency: currency || strOf(row.currency) || null,
    images: media.map((m, i) => ({ id: m.id, src: m.url, rank: i + 1, alt: '' })),
    raw: { ...row, mediaItems: media, ...(listingRow ? { listingRow } : {}) },
  };
}

export async function loadWixListing(ctx: AdapterContext): Promise<LoadedListing<WixEditorFields>> {
  const id = ctx.listingId;
  if (!id) throw new CatalogEditorLoadError(404);
  const [row, listing] = await Promise.all([fetchWixRow(id, ctx.shopId), loadListingRow('wix', ctx.shopId, id)]);
  return { fields: wixFieldsFromRow(row), meta: wixMeta(row, listing.row, listing.store?.currency || null) };
}

export async function loadWixCopySource(ctx: AdapterContext): Promise<CatalogCopySource | null> {
  if (!ctx.listingId) return null;
  const f = wixFieldsFromRow(await fetchWixRow(ctx.listingId, ctx.shopId));
  return {
    title: f.title,
    description: f.description,
    tags: [],
    price: numOrNull(f.price) ?? undefined,
    quantity: numOrNull(f.quantity) ?? undefined,
    imageUrls: f.images.filter((u) => isHttpsUrl(u)),
    catalogFields: {
      discountType: f.discountType,
      discountValue: f.discountValue,
      weight: f.weight,
      ribbon: f.ribbon,
      visible: f.visible,
      trackInventory: f.trackInventory,
      inStock: f.inStock,
      collectionIds: f.collectionIds,
      customTextFields: f.customTextFields,
    },
  };
}

export function wixFieldsFromCopy(src: CopySourceData): Partial<WixEditorFields> {
  const out: Partial<WixEditorFields> = {
    title: (src.title ?? '').slice(0, TITLE_MAX.wix),
    description: src.description ?? '',
  };
  if (typeof src.price === 'number' && src.price > 0) out.price = Math.round(src.price * 100) / 100;
  if (typeof src.quantity === 'number' && src.quantity >= 0) out.quantity = Math.round(src.quantity);
  const urls = (src.imageUrls ?? []).filter((u) => isHttpsUrl(u)).slice(0, WIX_MAX_IMAGES);
  if (urls.length) out.images = urls;
  const same = (src as CatalogCopySource).catalogFields;
  if (same && typeof same === 'object') {
    const blank = blankWixFields();
    for (const [k, v] of Object.entries(same)) {
      if (k in blank && !WIX_DISPLAY_KEYS.includes(k as never) && v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function wixScoreInput(f: WixEditorFields, facts: ListingFacts = {}): WixScoreInput {
  return {
    title: f.title,
    description: f.description,
    imageCount: facts.images ? facts.images.filter((i) => i.staged !== 'delete').length : strList(f.images).length,
    collectionCount: collections(f.collectionIds).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const WIX_ADAPTER_SPEC: CatalogAdapterSpec<WixEditorFields> = {
  marketplace: 'wix',
  blankFields: blankWixFields,
  displayOnlyKeys: WIX_DISPLAY_KEYS,
  createOnlyKeys: [],
  patchKeys: () => WIX_PATCH_KEYS,
  toPatch: (f, remote) => wixToPatch(f, remote),
  toCreatePayload: () => ({ productType: 'physical' }),
  finalizePatch: (body, ctx) => wixFinalizePatch(body, ctx),
  overlayPatch: (base, patch) => overlayWix(base, patch),
  load: loadWixListing,
  loadCopySource: loadWixCopySource,
  fieldsFromCopy: wixFieldsFromCopy,
  validate: validateWixFields,
  error: { marketplace: 'wix', sectionFor: sectionOf, formKeyFor },
  defaultKeys: ['visible', 'trackInventory', 'ribbon', 'weight'],
};

export const wixAdapter = createCatalogAdapter(WIX_ADAPTER_SPEC);
