/**
 * Canonical product values for catalog drafts: the same keys as `fieldPatch`
 * (schemas.ts), read from the marketplace API (executors' `readRemote`) or
 * from the local cache row (the draft's `baseSnapshot`). Conflict checks and
 * the Review differences diff compare these two shapes key by key, so both
 * readers here must produce identical forms for identical products.
 *
 * Pure: no Prisma, no clients.
 */
import {
  normalizeTrendyolAttributes,
  type ShopifySeo,
  type TrendyolAttributeValue,
  type WixCustomTextField,
  type WixDiscount,
} from './schemas';

/** Canonical values compared for conflicts and written back into the cache. */
export type CanonicalValues = {
  title?: string | null;
  price?: number | null;
  listPrice?: number | null;
  quantity?: number | null;
  tags?: string[];
  visible?: boolean;
  status?: string | null;
  variantCount?: number;
  trackInventory?: boolean;
  archived?: boolean;
  /** Wix: a sale price (priceData.discountedPrice) differs from the base price. */
  discounted?: boolean;
  /** Wix: sale price written back to the cache next to `price` (the grid shows discountPrice ?? price). */
  discountPrice?: number | null;
  // v2 (editor)
  description?: string | null;
  /** Trendyol: ordered image URLs. (Shopify/Wix media are op lists; their current items are in `mediaItems`.) */
  images?: string[];
  attributes?: TrendyolAttributeValue[];
  stockCode?: string | null;
  dimensionalWeight?: number | null;
  vatRate?: number | null;
  productMainId?: string | null;
  brandId?: number | null;
  categoryId?: number | null;
  cargoCompanyId?: number | null;
  discount?: WixDiscount;
  sku?: string | null;
  weight?: number | null;
  ribbon?: string | null;
  customTextFields?: WixCustomTextField[];
  inStock?: boolean;
  collectionIds?: string[];
  vendor?: string | null;
  productType?: string | null;
  compareAtPrice?: number | null;
  weightUnit?: string | null;
  seo?: ShopifySeo;
  variants?: CanonicalVariant[];
  /** Display only (diff panel): current media/images of Wix/Shopify products. Never compared. */
  mediaItems?: { id: string; url: string | null; alt?: string | null; position?: number }[];
  [key: string]: unknown;
};

export type CanonicalVariant = { id: string; price: number | null; compareAtPrice: number | null; inventoryQuantity: number | null; sku: string };

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};

function imageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const it of raw) {
    const u = typeof it === 'string' ? it : it && typeof it === 'object' ? (it as any).url ?? (it as any).src : null;
    if (typeof u === 'string' && u && !out.includes(u)) out.push(u);
  }
  return out;
}

function stringIds(raw: unknown, exclude?: string): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((x): x is string => typeof x === 'string' && x !== '' && x !== exclude)));
}

function textFields(raw: unknown): WixCustomTextField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f === 'object' && typeof (f as any).title === 'string')
    .map((f: any) => ({ title: String(f.title).trim(), maxLength: Number(f.maxLength) || 0, mandatory: f.mandatory === true }));
}

// ---------------------------------------------------------------------------
// Trendyol
// ---------------------------------------------------------------------------

/** Values of a product from the Trendyol product filter API (`content[]` item). */
export function trendyolValuesFromApi(p: any): CanonicalValues {
  return {
    title: str(p?.title),
    price: num(p?.salePrice),
    listPrice: num(p?.listPrice),
    quantity: num(p?.quantity),
    archived: Boolean(p?.archived),
    variantCount: 1,
    trackInventory: true,
    description: str(p?.description),
    images: imageUrls(p?.images),
    attributes: normalizeTrendyolAttributes(p?.attributes),
    stockCode: str(p?.stockCode),
    dimensionalWeight: num(p?.dimensionalWeight),
    vatRate: int(p?.vatRate),
    productMainId: str(p?.productMainId),
    brandId: int(p?.brandId),
    categoryId: int(p?.pimCategoryId ?? p?.categoryId),
    cargoCompanyId: int(p?.cargoCompanyId),
  };
}

/** Values of a `TrendyolProduct` cache row (images/attributes hold the raw API JSON). */
export function trendyolValuesFromCache(row: any): CanonicalValues {
  return {
    title: str(row?.title),
    price: num(row?.salePrice),
    listPrice: num(row?.listPrice),
    quantity: int(row?.quantity),
    archived: Boolean(row?.archived),
    variantCount: 1,
    trackInventory: true,
    description: str(row?.description),
    images: imageUrls(row?.images),
    attributes: normalizeTrendyolAttributes(row?.attributes),
    stockCode: str(row?.stockCode),
    dimensionalWeight: num(row?.dimensionalWeight),
    vatRate: int(row?.vatRate),
    productMainId: str(row?.productMainId),
    brandId: int(row?.brandId),
    categoryId: int(row?.categoryId),
    cargoCompanyId: int(row?.cargoCompanyId),
  };
}

// ---------------------------------------------------------------------------
// Wix
// ---------------------------------------------------------------------------

/** Wix's automatic "All products" collection (never part of the editable set). */
export const WIX_ALL_PRODUCTS = '00000000-000000-000000-000000000001';

function wixDiscount(raw: any): WixDiscount | undefined {
  const type = raw?.type;
  if (type === 'AMOUNT' || type === 'PERCENT') {
    const value = num(raw?.value);
    return value !== null && value > 0 ? { type, value } : { type: 'NONE', value: 0 };
  }
  if (type === 'NONE' || raw === null) return { type: 'NONE', value: 0 };
  return undefined;
}

/** Values of a Wix Stores v1 product (`getProduct`). */
export function wixValuesFromApi(p: any): CanonicalValues {
  const variants = Array.isArray(p?.variants) ? p.variants : [];
  const price = num(p?.priceData?.price ?? p?.price?.price);
  const sale = num(p?.priceData?.discountedPrice ?? p?.price?.discountedPrice);
  const items: any[] = Array.isArray(p?.media?.items) ? p.media.items : [];
  return {
    title: str(p?.name),
    price,
    discounted: sale !== null && price !== null && Math.round(sale * 100) !== Math.round(price * 100),
    discountPrice: sale,
    quantity: num(p?.stock?.quantity),
    visible: p?.visible !== false,
    trackInventory: p?.stock?.trackInventory !== false,
    inStock: p?.stock?.inStock !== false,
    variantCount: Math.max(1, variants.length),
    description: str(p?.description),
    discount: wixDiscount(p?.discount),
    sku: str(p?.sku),
    weight: num(p?.weight),
    ribbon: str(p?.ribbon),
    customTextFields: textFields(p?.customTextFields),
    collectionIds: stringIds(p?.collectionIds, WIX_ALL_PRODUCTS),
    mediaItems: items
      .filter((it) => typeof it?.id === 'string')
      .map((it) => ({ id: it.id, url: str(it?.image?.url ?? it?.video?.files?.[0]?.url) })),
  };
}

/** Values of a `WixProduct` cache row. The cache keeps no discount type/value, only `discountPrice`. */
export function wixValuesFromCache(row: any): CanonicalValues {
  const variants = Array.isArray(row?.variants) ? (row.variants as unknown[]) : [];
  const base = num(row?.price);
  const sale = num(row?.discountPrice);
  return {
    title: str(row?.title),
    // The grid shows discountPrice ?? price. Price edits are refused while a
    // sale price differs (DISCOUNTED) unless the draft sets the discount too.
    price: base,
    discounted: sale !== null && base !== null && Math.round(sale * 100) !== Math.round(base * 100),
    discountPrice: sale,
    quantity: int(row?.quantity),
    visible: row?.visible !== false,
    trackInventory: row?.trackInventory !== false,
    inStock: row?.inStock !== false,
    variantCount: Math.max(1, variants.length),
    description: str(row?.description),
    sku: str(row?.sku),
    weight: num(row?.weight),
    ribbon: str(row?.ribbon),
    customTextFields: textFields(row?.customTextFields),
    collectionIds: stringIds(row?.collectionIds, WIX_ALL_PRODUCTS),
  };
}

// ---------------------------------------------------------------------------
// Shopify
// ---------------------------------------------------------------------------

export function splitShopifyTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map(String).map((t) => t.trim()).filter(Boolean);
  return typeof tags === 'string' ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
}

export function shopifyVariant(v: any): CanonicalVariant {
  return {
    id: String(v?.id ?? ''),
    price: num(v?.price),
    compareAtPrice: num(v?.compare_at_price),
    inventoryQuantity: int(v?.inventory_quantity),
    sku: typeof v?.sku === 'string' ? v.sku : '',
  };
}

function shopifyCommon(variantsRaw: unknown): Pick<CanonicalValues, 'price' | 'quantity' | 'trackInventory' | 'variantCount' | 'variants' | 'compareAtPrice' | 'sku' | 'weight' | 'weightUnit'> {
  const variants: any[] = Array.isArray(variantsRaw) ? variantsRaw : [];
  const first = variants[0];
  const single = variants.length === 1;
  return {
    price: num(first?.price),
    quantity: variants.reduce((s, v) => s + (Number(v?.inventory_quantity) || 0), 0),
    trackInventory: first?.inventory_management === 'shopify',
    variantCount: Math.max(1, variants.length),
    // Only when known: an empty list would make every staged variant edit look "deleted remotely".
    ...(variants.length ? { variants: variants.map(shopifyVariant).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) } : {}),
    ...(single
      ? { compareAtPrice: num(first?.compare_at_price), sku: typeof first?.sku === 'string' ? first.sku : '', weight: num(first?.weight), weightUnit: str(first?.weight_unit) }
      : {}),
  };
}

/** Values of a Shopify REST product (`getProduct`), plus SEO when it was read (GraphQL). */
export function shopifyValuesFromApi(p: any, seo?: ShopifySeo | null): CanonicalValues {
  const images: any[] = Array.isArray(p?.images) ? p.images : [];
  return {
    title: str(p?.title),
    tags: splitShopifyTags(p?.tags),
    status: p?.status ?? null,
    description: str(p?.body_html),
    vendor: str(p?.vendor),
    productType: str(p?.product_type),
    ...shopifyCommon(p?.variants),
    ...(seo ? { seo: { title: seo.title ?? '', description: seo.description ?? '' } } : {}),
    mediaItems: images.map((im) => ({ id: String(im?.id), url: str(im?.src), alt: str(im?.alt), position: num(im?.position) ?? undefined })),
  };
}

/** Values of a `ShopifyProduct` cache row (`variants` holds the raw REST variants). */
export function shopifyValuesFromCache(row: any): CanonicalValues {
  const common = shopifyCommon(row?.variants);
  return {
    title: str(row?.title),
    tags: Array.isArray(row?.tags) ? row.tags : [],
    status: row?.status ?? null,
    description: str(row?.description),
    vendor: str(row?.vendor),
    productType: str(row?.productType),
    ...common,
    // Cache columns win over the variant JSON for the grid's v1 values.
    price: num(row?.price) ?? common.price ?? null,
    quantity: int(row?.totalInventory) ?? common.quantity ?? null,
    trackInventory: typeof row?.trackInventory === 'boolean' ? row.trackInventory : common.trackInventory,
    variantCount: Math.max(1, Number(row?.variantCount) || common.variantCount || 1),
    ...(row?.seoTitle != null || row?.seoDescription != null
      ? { seo: { title: row?.seoTitle ?? '', description: row?.seoDescription ?? '' } }
      : {}),
  };
}
