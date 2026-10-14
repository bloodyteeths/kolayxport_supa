/**
 * Pure helpers that turn an Etsy listing payload (getListing with
 * includes=Images,Inventory,Videos, or one row of getListingsByShop) into:
 *   - the EtsyListing cache row,
 *   - EtsyListingOffering rows keyed by variantKey,
 *   - a content snapshot + contentHash used for change history.
 *
 * Isomorphic and side-effect free (unit tested in test/etsy/listingNormalize.test.ts).
 *
 * Snapshot rules (owner W3):
 *  - EXCLUDES volatile data: quantity, views, num_favorers, updated_timestamp,
 *    product_id, offering_id. A stock PUT (Etsy regenerates product ids) or a
 *    sale therefore never changes the hash unless state / isEnabled change.
 *  - Offerings are keyed by variantValueKey (value-based, survives value-id
 *    churn): { sku, price, isEnabled, propertyValues }. Offering cache rows
 *    (EtsyListingOffering) stay keyed by variantKey.
 *  - Images are [{ id, rank, altText }] sorted by rank.
 *  - contentHash = sha1(stableStringify(snapshot)).
 */
import { etsyVariantKeys, pairsFromEtsyProduct, sha1Hex } from './variantKey';
import { normalizeSku } from '@/lib/stock/normalize';
import type { EtsyOfferingObservation } from '@/lib/stock/types';

export type SnapshotImage = { id: string; rank: number; altText: string | null };

export type SnapshotOffering = {
  sku: string | null;
  /** price in minor units (amount at divisor 100) or null when unknown */
  price: number | null;
  isEnabled: boolean;
  /** [{ propertyId, name, values }] for display/restore context */
  propertyValues: Array<{ propertyId: number; name: string | null; values: string[] }>;
};

export type ListingSnapshot = {
  v: 1;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  /** listing-level price in minor units (cents) */
  price: number | null;
  currency: string | null;
  state: string;
  taxonomyId: number | null;
  shopSectionId: number | null;
  whoMade: string | null;
  whenMade: string | null;
  isSupply: boolean;
  processingMin: number | null;
  processingMax: number | null;
  shippingProfileId: string | null;
  returnPolicyId: string | null;
  itemWeight: number | null;
  itemWeightUnit: string | null;
  itemLength: number | null;
  itemWidth: number | null;
  itemHeight: number | null;
  itemDimensionsUnit: string | null;
  isPersonalizable: boolean;
  personalizationIsRequired: boolean;
  personalizationInstructions: string | null;
  personalizationCharCountMax: number | null;
  /** null = inventory was not fetched (never diffed) */
  hasVariations: boolean | null;
  /** null = images were not fetched (never diffed) */
  images: SnapshotImage[] | null;
  /** null = inventory was not fetched (never diffed) */
  offerings: Record<string, SnapshotOffering> | null;
  videoIds: string[] | null;
};

/** Keys that matter for SEO experiments. */
export const SEO_KEYS = ['title', 'tags', 'images'] as const;
/** Keys that an external edit alert cares about. */
export const EXTERNAL_ALERT_KEYS = ['title', 'tags', 'description', 'images', 'price'] as const;

// ---------------------------------------------------------------------------
// small coercers
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === '' ? null : s;
}

function int(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function float(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).map((x) => String(x)) : [];
}

/** Etsy money object {amount, divisor} -> minor units at divisor 100. */
export function moneyToMinor(m: any): number | null {
  if (m === null || m === undefined) return null;
  if (typeof m === 'number') return Math.round(m * 100);
  const amount = Number(m?.amount);
  const divisor = Number(m?.divisor) || 100;
  if (!Number.isFinite(amount)) return null;
  return Math.round((amount * 100) / divisor);
}

/** Deterministic JSON: object keys sorted recursively; BigInt -> string. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return JSON.stringify(value.toString());
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// payload extraction
// ---------------------------------------------------------------------------

/** Images from a getListing(includes=Images) payload; null when the key is absent. */
export function extractImages(listing: any): any[] | null {
  if (!listing || typeof listing !== 'object') return null;
  if (Array.isArray(listing.images)) return listing.images;
  if (Array.isArray(listing.Images)) return listing.Images;
  return null;
}

/** Inventory from a getListing(includes=Inventory) payload; null when absent. */
export function extractInventory(listing: any): any | null {
  if (!listing || typeof listing !== 'object') return null;
  const inv = listing.inventory ?? listing.Inventory;
  if (inv && typeof inv === 'object' && Array.isArray(inv.products)) return inv;
  return null;
}

export function extractVideos(listing: any): any[] | null {
  if (!listing || typeof listing !== 'object') return null;
  if (Array.isArray(listing.videos)) return listing.videos;
  if (Array.isArray(listing.Videos)) return listing.Videos;
  return null;
}

export function sortImages(images: any[]): any[] {
  return [...images].sort((a, b) => (Number(a?.rank) || 0) - (Number(b?.rank) || 0));
}

export function snapshotImages(images: any[] | null): SnapshotImage[] | null {
  if (!images) return null;
  return sortImages(images)
    .filter((img) => img && img.listing_image_id != null)
    .map((img) => ({
      id: String(img.listing_image_id),
      rank: int(img.rank) ?? 0,
      altText: str(img.alt_text),
    }));
}

// ---------------------------------------------------------------------------
// offerings
// ---------------------------------------------------------------------------

export type OfferingRow = {
  variantKey: string;
  variantValueKey: string;
  productId: string | null;
  offeringId: string | null;
  sku: string | null;
  skuNormalized: string | null;
  quantity: number;
  isEnabled: boolean;
  priceAmount: number | null;
  priceDivisor: number | null;
  propertyValues: Array<{ propertyId: number; name: string | null; valueIds: number[]; values: string[] }>;
};

/**
 * Inventory products -> offering rows keyed by variantKey (first wins on a
 * duplicate key; deleted products/offerings are skipped).
 */
export function buildOfferingRows(inventory: any | null): OfferingRow[] {
  if (!inventory || !Array.isArray(inventory.products)) return [];
  const out: OfferingRow[] = [];
  const seen = new Set<string>();
  for (const product of inventory.products) {
    if (!product || product.is_deleted) continue;
    const offerings = (Array.isArray(product.offerings) ? product.offerings : []).filter((o: any) => o && !o.is_deleted);
    const offering = offerings[0] || null;
    const { variantKey, variantValueKey } = etsyVariantKeys(pairsFromEtsyProduct(product));
    if (seen.has(variantKey)) continue;
    seen.add(variantKey);
    const pvs = (Array.isArray(product.property_values) ? product.property_values : []).map((pv: any) => ({
      propertyId: int(pv?.property_id) ?? 0,
      name: str(pv?.property_name),
      valueIds: (Array.isArray(pv?.value_ids) ? pv.value_ids : []).map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x)),
      values: strArr(pv?.values),
    }));
    const sku = str(product.sku);
    out.push({
      variantKey,
      variantValueKey,
      productId: product.product_id != null ? String(product.product_id) : null,
      offeringId: offering?.offering_id != null ? String(offering.offering_id) : null,
      sku,
      skuNormalized: normalizeSku(sku),
      quantity: int(offering?.quantity) ?? 0,
      isEnabled: offering ? offering.is_enabled !== false : false,
      priceAmount: int(offering?.price?.amount),
      priceDivisor: int(offering?.price?.divisor),
      propertyValues: pvs,
    });
  }
  return out;
}

export function offeringObservations(rows: OfferingRow[]): EtsyOfferingObservation[] {
  return rows.map((r) => ({
    variantKey: r.variantKey,
    variantValueKey: r.variantValueKey,
    productId: r.productId,
    sku: r.sku,
    quantity: r.quantity,
    isEnabled: r.isEnabled,
  }));
}

export function hasVariationsFromInventory(inventory: any | null): boolean {
  if (!inventory || !Array.isArray(inventory.products)) return false;
  return inventory.products.some((p: any) => !p?.is_deleted && Array.isArray(p?.property_values) && p.property_values.length > 0);
}

export function quantityOnPropertyFromInventory(inventory: any | null): number[] {
  if (!inventory || !Array.isArray(inventory.quantity_on_property)) return [];
  return inventory.quantity_on_property.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)).map((n: number) => Math.trunc(n));
}

/** True when two offering sets differ in any quantity or isEnabled (by variantKey). */
export function offeringsStockDiffer(
  a: Array<{ variantKey: string; quantity: number; isEnabled: boolean }>,
  b: Array<{ variantKey: string; quantity: number; isEnabled: boolean }>,
): boolean {
  if (a.length !== b.length) return true;
  const map = new Map(a.map((o) => [o.variantKey, o]));
  for (const o of b) {
    const x = map.get(o.variantKey);
    if (!x) return true;
    if (Number(x.quantity) !== Number(o.quantity) || Boolean(x.isEnabled) !== Boolean(o.isEnabled)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// cache row
// ---------------------------------------------------------------------------

/** EtsyListing columns derived from an Etsy listing payload (no id/shop/listing keys). */
export function listingRowFromEtsy(listing: any, images: any[] | null) {
  const sorted = images ? sortImages(images) : null;
  const first = sorted?.[0] || null;
  return {
    title: listing?.title || '',
    description: listing?.description || '',
    tags: strArr(listing?.tags),
    materials: strArr(listing?.materials),
    priceAmount: int(listing?.price?.amount) ?? 0,
    priceDivisor: int(listing?.price?.divisor) || 100,
    priceCurrencyCode: listing?.price?.currency_code || 'USD',
    views: int(listing?.views) ?? 0,
    numFavorers: int(listing?.num_favorers) ?? 0,
    quantity: int(listing?.quantity) ?? 0,
    state: listing?.state || 'draft',
    url: str(listing?.url),
    taxonomyId: int(listing?.taxonomy_id),
    shopSectionId: int(listing?.shop_section_id),
    whoMade: str(listing?.who_made),
    whenMade: str(listing?.when_made),
    isSupply: listing?.is_supply === true,
    processingMin: int(listing?.processing_min),
    processingMax: int(listing?.processing_max),
    shippingProfileId: listing?.shipping_profile_id != null && listing.shipping_profile_id !== '' ? BigInt(String(listing.shipping_profile_id)) : null,
    returnPolicyId: listing?.return_policy_id != null && listing.return_policy_id !== '' ? BigInt(String(listing.return_policy_id)) : null,
    itemWeight: float(listing?.item_weight),
    itemWeightUnit: str(listing?.item_weight_unit),
    itemLength: float(listing?.item_length),
    itemWidth: float(listing?.item_width),
    itemHeight: float(listing?.item_height),
    itemDimensionsUnit: str(listing?.item_dimensions_unit),
    isPersonalizable: listing?.is_personalizable === true,
    personalizationIsRequired: listing?.personalization_is_required === true,
    personalizationInstructions: str(listing?.personalization_instructions),
    personalizationCharCountMax: int(listing?.personalization_char_count_max),
    // Thumbnails / image count only when images were actually fetched.
    ...(sorted
      ? {
          thumbnailUrl75x75: str(first?.url_75x75),
          thumbnailUrl170x135: str(first?.url_170x135),
          thumbnailUrl570xN: str(first?.url_570xN),
          imageCount: sorted.length,
        }
      : {}),
    hasVideo: listing?.has_videos === true || (Array.isArray(extractVideos(listing)) && (extractVideos(listing) as any[]).length > 0),
    etsyCreatedTimestamp: int(listing?.created_timestamp ?? listing?.creation_timestamp) ?? 0,
    etsyUpdatedTimestamp: int(listing?.updated_timestamp ?? listing?.last_modified_timestamp) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// snapshot / hash / diff
// ---------------------------------------------------------------------------

export function buildSnapshot(listing: any, images: any[] | null, inventory: any | null, videos: any[] | null = null): ListingSnapshot {
  const offeringRows = inventory ? buildOfferingRows(inventory) : null;
  let offerings: Record<string, SnapshotOffering> | null = null;
  if (offeringRows) {
    offerings = {};
    for (const r of offeringRows) {
      // Keyed by the value-based key: survives Etsy value-id churn on re-PUT.
      offerings[r.variantValueKey] = {
        sku: r.sku,
        price: r.priceAmount != null ? moneyToMinor({ amount: r.priceAmount, divisor: r.priceDivisor || 100 }) : null,
        isEnabled: r.isEnabled,
        propertyValues: r.propertyValues.map((pv) => ({ propertyId: pv.propertyId, name: pv.name, values: pv.values })),
      };
    }
  }
  return {
    v: 1,
    title: listing?.title || '',
    description: listing?.description || '',
    tags: strArr(listing?.tags),
    materials: strArr(listing?.materials),
    price: moneyToMinor(listing?.price),
    currency: str(listing?.price?.currency_code),
    state: listing?.state || 'draft',
    taxonomyId: int(listing?.taxonomy_id),
    shopSectionId: int(listing?.shop_section_id),
    whoMade: str(listing?.who_made),
    whenMade: str(listing?.when_made),
    isSupply: listing?.is_supply === true,
    processingMin: int(listing?.processing_min),
    processingMax: int(listing?.processing_max),
    shippingProfileId: str(listing?.shipping_profile_id),
    returnPolicyId: str(listing?.return_policy_id),
    itemWeight: float(listing?.item_weight),
    itemWeightUnit: str(listing?.item_weight_unit),
    itemLength: float(listing?.item_length),
    itemWidth: float(listing?.item_width),
    itemHeight: float(listing?.item_height),
    itemDimensionsUnit: str(listing?.item_dimensions_unit),
    isPersonalizable: listing?.is_personalizable === true,
    personalizationIsRequired: listing?.personalization_is_required === true,
    personalizationInstructions: str(listing?.personalization_instructions),
    personalizationCharCountMax: int(listing?.personalization_char_count_max),
    hasVariations: inventory ? hasVariationsFromInventory(inventory) : null,
    images: snapshotImages(images),
    offerings,
    videoIds: videos ? videos.map((v: any) => String(v?.video_id ?? '')).filter(Boolean).sort() : null,
  };
}

export function contentHash(snapshot: ListingSnapshot): string {
  return sha1Hex(stableStringify(snapshot));
}

export type ImageDiff = { added: string[]; removed: string[]; reordered: boolean; altChanged: string[] };
export type OfferingDiff = {
  added: string[];
  removed: string[];
  changed: Array<{ variantKey: string; fields: string[]; label: string | null }>;
};

export type SnapshotDiff = {
  changedKeys: string[];
  /** key -> { from, to } (long text truncated); images/offerings summarised */
  diff: Record<string, any>;
};

const TEXT_DIFF_MAX = 600;

function clip(v: unknown): unknown {
  if (typeof v === 'string' && v.length > TEXT_DIFF_MAX) return `${v.slice(0, TEXT_DIFF_MAX)}…`;
  return v;
}

export function diffImages(a: SnapshotImage[], b: SnapshotImage[]): ImageDiff {
  const aIds = a.map((i) => i.id);
  const bIds = b.map((i) => i.id);
  const aSet = new Set(aIds);
  const bSet = new Set(bIds);
  const added = bIds.filter((id) => !aSet.has(id));
  const removed = aIds.filter((id) => !bSet.has(id));
  const commonA = aIds.filter((id) => bSet.has(id));
  const commonB = bIds.filter((id) => aSet.has(id));
  const reordered = commonA.some((id, i) => commonB[i] !== id);
  const aAlt = new Map(a.map((i) => [i.id, i.altText || null]));
  const altChanged = b.filter((i) => aAlt.has(i.id) && (aAlt.get(i.id) || null) !== (i.altText || null)).map((i) => i.id);
  return { added, removed, reordered, altChanged };
}

function offeringLabel(o: SnapshotOffering | undefined): string | null {
  if (!o || !o.propertyValues?.length) return null;
  return o.propertyValues.map((pv) => pv.values.join('/')).filter(Boolean).join(' · ') || null;
}

export function diffOfferings(a: Record<string, SnapshotOffering>, b: Record<string, SnapshotOffering>): OfferingDiff {
  const added = Object.keys(b).filter((k) => !(k in a));
  const removed = Object.keys(a).filter((k) => !(k in b));
  const changed: OfferingDiff['changed'] = [];
  for (const k of Object.keys(b)) {
    if (!(k in a)) continue;
    const fields: string[] = [];
    if ((a[k].sku || null) !== (b[k].sku || null)) fields.push('sku');
    if ((a[k].price ?? null) !== (b[k].price ?? null)) fields.push('price');
    if (Boolean(a[k].isEnabled) !== Boolean(b[k].isEnabled)) fields.push('isEnabled');
    if (fields.length) changed.push({ variantKey: k, fields, label: offeringLabel(b[k]) });
  }
  return { added, removed, changed };
}

const SCALAR_KEYS: Array<keyof ListingSnapshot> = [
  'title', 'description', 'price', 'currency', 'state', 'taxonomyId', 'shopSectionId', 'whoMade', 'whenMade', 'isSupply',
  'processingMin', 'processingMax', 'shippingProfileId', 'returnPolicyId', 'itemWeight', 'itemWeightUnit', 'itemLength',
  'itemWidth', 'itemHeight', 'itemDimensionsUnit', 'isPersonalizable', 'personalizationIsRequired',
  'personalizationInstructions', 'personalizationCharCountMax', 'hasVariations',
];

/**
 * Diff two snapshots. A side whose images/offerings/videos is null (not
 * fetched) is never diffed for that part.
 */
export function diffSnapshots(prev: ListingSnapshot | null | undefined, next: ListingSnapshot): SnapshotDiff {
  if (!prev) return { changedKeys: [], diff: {} };
  const changedKeys: string[] = [];
  const diff: Record<string, any> = {};
  for (const key of SCALAR_KEYS) {
    const a = (prev as any)[key] ?? null;
    const b = (next as any)[key] ?? null;
    if (key === 'hasVariations' && (a === null || b === null)) continue;
    if (a !== b) {
      changedKeys.push(key);
      diff[key] = { from: clip(a), to: clip(b) };
    }
  }
  for (const key of ['tags', 'materials'] as const) {
    const a = prev[key] || [];
    const b = next[key] || [];
    if (stableStringify(a) !== stableStringify(b)) {
      changedKeys.push(key);
      const aSet = new Set(a.map((x) => x.toLowerCase()));
      const bSet = new Set(b.map((x) => x.toLowerCase()));
      diff[key] = {
        from: a,
        to: b,
        added: b.filter((x) => !aSet.has(x.toLowerCase())),
        removed: a.filter((x) => !bSet.has(x.toLowerCase())),
      };
    }
  }
  if (prev.images && next.images) {
    const d = diffImages(prev.images, next.images);
    if (d.added.length || d.removed.length || d.reordered || d.altChanged.length) {
      changedKeys.push('images');
      diff.images = d;
    }
  }
  if (prev.offerings && next.offerings) {
    const d = diffOfferings(prev.offerings, next.offerings);
    if (d.added.length || d.removed.length || d.changed.length) {
      changedKeys.push('offerings');
      diff.offerings = d;
    }
  }
  if (prev.videoIds && next.videoIds && stableStringify(prev.videoIds) !== stableStringify(next.videoIds)) {
    changedKeys.push('videos');
    diff.videos = { from: prev.videoIds, to: next.videoIds };
  }
  return { changedKeys, diff };
}

/**
 * A snapshot whose images/offerings/videos are null inherits them from the
 * previous snapshot, so the hash does not flip just because a part was not
 * fetched this time.
 */
export function fillMissingParts(next: ListingSnapshot, prev: ListingSnapshot | null | undefined): ListingSnapshot {
  if (!prev) return next;
  return {
    ...next,
    images: next.images ?? prev.images ?? null,
    offerings: next.offerings ?? prev.offerings ?? null,
    videoIds: next.videoIds ?? prev.videoIds ?? null,
    hasVariations: next.offerings ? next.hasVariations : prev.hasVariations,
  };
}

/** True when an offering's isEnabled flipped or the listing state changed. */
export function isStockRelevantChange(d: SnapshotDiff): boolean {
  if (d.changedKeys.includes('state')) return true;
  const off = d.diff.offerings as OfferingDiff | undefined;
  return !!off && off.changed.some((c) => c.fields.includes('isEnabled'));
}

export function seoChangeKinds(changedKeys: string[]): string[] {
  return (SEO_KEYS as readonly string[]).filter((k) => changedKeys.includes(k));
}
