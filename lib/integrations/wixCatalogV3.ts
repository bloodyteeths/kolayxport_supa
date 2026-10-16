/**
 * Wix Stores Catalog V3 support (pure helpers, no I/O).
 *
 * Wix sites are on either Catalog V1 (`/stores/v1/*`, `/stores/v2/inventoryItems`)
 * or Catalog V3 (`/stores/v3/*`, `/categories/v1/*`). A V3 site answers every V1
 * catalog call with HTTP 501 UNIMPLEMENTED ("This Catalog V1 operation is not
 * supported for sites using Catalog V3"). The client keeps its V1-shaped public
 * methods; on a V3 site it calls the V3 endpoints and maps the results here into
 * the V1 shapes the rest of the app (WixProduct cache, catalog-draft executor,
 * stock adapter, editors) already reads.
 *
 * Docs:
 * - Catalog versioning: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/get-catalog-version
 * - V1 → V3 migration guide: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/catalog-v1-to-v3-migration-guide
 * - Products V3: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/introduction
 * - Read-only variants V3: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/read-only-variants-v3/query-variants
 * - Inventory items V3: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/introduction
 * - Categories: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/introduction
 */

export type WixCatalogVersion = 'V1' | 'V3';

/** Wix Stores app id: the `appId` of category items and `managingAppId` of the automatic "All Products" category. */
export const WIX_STORES_APP_ID = '215238eb-22a5-4c36-9e7b-e7c08025e04e';
/** Category tree of Wix Stores (every Categories API call needs it). */
export const WIX_STORES_TREE = { appNamespace: '@wix/stores' } as const;
/** Same value as `WIX_ALL_PRODUCTS_COLLECTION_ID` in wixClient (kept here to avoid an import cycle). */
const ALL_PRODUCTS_V1_ID = '00000000-000000-000000-000000000001';

/** `fields` asked for on V3 product reads (the extra data the V1 shape needs). */
export const V3_PRODUCT_FIELDS = [
  'URL',
  'CURRENCY',
  'PLAIN_DESCRIPTION',
  'MEDIA_ITEMS_INFO',
  'DIRECT_CATEGORIES_INFO',
  'THUMBNAIL',
  'VARIANT_OPTION_CHOICE_NAMES',
  'WEIGHT_MEASUREMENT_UNIT_INFO',
] as const;

/** `GET /stores/v3/provision/version` body → version (null when Stores is missing or the answer is unknown). */
export function parseCatalogVersion(body: unknown): WixCatalogVersion | null {
  const v = (body as { catalogVersion?: unknown } | null)?.catalogVersion;
  if (v === 'V3_CATALOG') return 'V3';
  if (v === 'V1_CATALOG') return 'V1';
  return null;
}

/** A stored `WixSite.catalogVersion` value → version (anything else = unknown). */
export function normalizeCatalogVersion(v: unknown): WixCatalogVersion | null {
  return v === 'V1' || v === 'V3' ? v : null;
}

/** True for the error a V3 site returns to a V1 catalog call (HTTP 501 UNIMPLEMENTED). */
export function isCatalogV1UnsupportedError(err: unknown): boolean {
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? '');
  return /Catalog V1 operation is not supported/i.test(msg) || (/^Wix API 501\b/.test(msg) && /UNIMPLEMENTED/.test(msg));
}

// ─── small value helpers ─────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Money amount as Wix V3 wants it (decimal string, 2 places). */
export function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function arr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// ─── reads: V3 → V1 shape ────────────────────────────────────

/** One inventory item V3 (one variant at one location). */
export type WixV3InventoryItem = {
  id: string;
  revision?: string;
  variantId: string;
  productId: string;
  locationId?: string;
  trackQuantity?: boolean;
  quantity?: number;
  inStock?: boolean;
  availabilityStatus?: string;
  preorderInfo?: { enabled?: boolean };
  updatedDate?: string;
};

/** Inventory items grouped by product id (first item per variant wins: a site has one default location). */
export function groupInventoryByProduct(items: unknown): Map<string, WixV3InventoryItem[]> {
  const out = new Map<string, WixV3InventoryItem[]>();
  for (const it of arr<WixV3InventoryItem>(items)) {
    if (!it || typeof it.productId !== 'string' || typeof it.variantId !== 'string') continue;
    const list = out.get(it.productId) || [];
    if (!list.some((x) => x.variantId === it.variantId)) list.push(it);
    out.set(it.productId, list);
  }
  return out;
}

/** Variants (product GET `variantsInfo.variants` or Read-Only Variants rows) grouped by product id. */
export function groupVariantsByProduct(rows: unknown): Map<string, any[]> {
  const out = new Map<string, any[]>();
  for (const v of arr(rows)) {
    const pid = v?.productData?.productId;
    if (typeof pid !== 'string') continue;
    out.set(pid, [...(out.get(pid) || []), v]);
  }
  return out;
}

function inventoryQty(it: WixV3InventoryItem | undefined): number | null {
  if (!it || it.trackQuantity !== true) return null;
  return num(it.quantity);
}

function inventoryInStock(it: WixV3InventoryItem | undefined, fallback?: boolean): boolean {
  if (!it) return fallback !== false;
  if (it.availabilityStatus) return it.availabilityStatus !== 'OUT_OF_STOCK';
  if (it.trackQuantity) return (num(it.quantity) ?? 0) > 0;
  return it.inStock !== false;
}

/** V3 inventory items of one product → the Stores V2 inventory item shape (`getInventoryItem`). */
export function v3InventoryToV2Item(productId: string, items: WixV3InventoryItem[]) {
  return {
    // Synthetic: V3 has one inventory item per variant. `updateInventoryVariants(id)` takes it back as the product id.
    id: productId,
    productId,
    trackQuantity: items.some((i) => i.trackQuantity === true),
    variants: items.map((i) => ({
      variantId: i.variantId,
      ...(i.trackQuantity ? { quantity: num(i.quantity) ?? 0 } : {}),
      inStock: inventoryInStock(i),
      availableForPreorder: i.preorderInfo?.enabled === true,
    })),
    lastUpdated: items.map((i) => i.updatedDate).filter(Boolean).sort().pop(),
  };
}

function v1Media(m: any) {
  if (!m || typeof m !== 'object') return null;
  const id = String(m.id || m.image?.id || m.video?.id || '');
  const type = String(m.mediaType || (m.video ? 'VIDEO' : 'IMAGE')).toLowerCase();
  const out: any = { id, mediaType: type === 'video' ? 'video' : 'image', title: m.image?.filename || m.video?.filename || '' };
  if (m.image) out.image = { url: m.image.url || '', width: m.image.width, height: m.image.height, ...(m.image.altText ? { altText: m.image.altText } : {}) };
  if (m.video) out.video = { files: arr(m.video.resolutions).map((r: any) => ({ url: r.url, width: r.width, height: r.height, format: r.format })) };
  if (m.thumbnail) out.thumbnail = { url: m.thumbnail.url, width: m.thumbnail.width, height: m.thumbnail.height };
  if (!m.image && !m.video && m.url) out.image = { url: m.url };
  return out;
}

/** Ordered media ids of a raw V3 product (`media.itemsInfo.items[].id`). */
export function v3MediaIds(p: any): string[] {
  const ids: string[] = [];
  for (const it of arr(p?.media?.itemsInfo?.items)) {
    const id = typeof it?.id === 'string' ? it.id : '';
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Variant price (V1 terms: `price` = list price, `discountedPrice` = selling price). */
function variantPrices(v: any): { price: number | null; discountedPrice: number | null } {
  const actual = num(v?.price?.actualPrice?.amount);
  const compare = num(v?.price?.compareAtPrice?.amount);
  if (actual === null) return { price: compare, discountedPrice: compare };
  return { price: compare !== null && compare > actual ? compare : actual, discountedPrice: actual };
}

/** Choices of a V3 variant (`choices` on the product, `optionChoices` on Read-Only Variants). */
function variantChoices(v: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of arr(v?.choices ?? v?.optionChoices)) {
    const name = c?.optionChoiceNames?.optionName;
    const choice = c?.optionChoiceNames?.choiceName;
    if (typeof name === 'string' && typeof choice === 'string') out[name] = choice;
  }
  return out;
}

function v1ChoicesOf(choices: unknown, mediaById: Map<string, any>) {
  return arr(choices).map((c: any) => {
    const linked = arr(c?.linkedMedia).map((m: any) => (typeof m?.id === 'string' ? mediaById.get(m.id) ?? v1Media(m) : v1Media(m))).filter(Boolean);
    return {
      value: (typeof c?.colorCode === 'string' && c.colorCode) || c?.name || c?.key || '',
      description: c?.name || c?.key || '',
      inStock: c?.inStock !== false,
      visible: c?.visible !== false,
      ...(linked.length ? { media: { mainMedia: linked[0], items: linked } } : {}),
    };
  });
}

export type V3ToV1Context = {
  /** Variants of the product (from GET `variantsInfo.variants` or the Read-Only Variants API). */
  variants?: any[];
  /** Inventory items of the product (default location). */
  inventory?: WixV3InventoryItem[];
  /** Real id of the automatic "All Products" category: mapped to the V1 constant so it stays protected. */
  allProductsCategoryId?: string | null;
};

/**
 * Raw Catalog V3 product → Catalog V1 product shape (what `upsertWixProduct`,
 * `wixValuesFromApi` and the stock adapter read). V1 `price` is the list price
 * (V3 `compareAtPrice`, or `actualPrice` when there is no sale) and
 * `discountedPrice` the selling price (V3 `actualPrice`). Extra keys:
 * `catalogVersion: 'V3'` and `revision`.
 */
export function wixV3ProductToV1(p: any, ctx: V3ToV1Context = {}): any {
  const variantsRaw = ctx.variants ?? arr(p?.variantsInfo?.variants);
  const inv = ctx.inventory ?? [];
  const invByVariant = new Map(inv.map((i) => [i.variantId, i] as const));
  const currency = p?.currency || undefined;

  const itemsRaw = arr(p?.media?.itemsInfo?.items);
  const items = itemsRaw.map(v1Media).filter(Boolean);
  const mediaById = new Map(items.map((m: any) => [m.id, m] as const));
  const mainMedia = v1Media(p?.media?.main) || items[0] || undefined;

  const variants = variantsRaw.map((v: any) => {
    const id = String(v?.variantId || v?.id || '');
    const it = invByVariant.get(id);
    const prices = variantPrices(v);
    const qty = inventoryQty(it);
    return {
      id,
      choices: variantChoices(v),
      variant: {
        priceData: { currency, price: prices.price, discountedPrice: prices.discountedPrice },
        weight: num(v?.physicalProperties?.weight) ?? undefined,
        sku: v?.sku || undefined,
        visible: v?.visible !== false,
      },
      stock: {
        trackQuantity: it?.trackQuantity === true,
        ...(qty !== null ? { quantity: qty } : {}),
        inStock: inventoryInStock(it, v?.inventoryStatus?.inStock),
      },
    };
  });

  // Product-level price: the single variant, else the cheapest variant (V1 showed the base price).
  let price: number | null = null;
  let discountedPrice: number | null = null;
  if (variants.length) {
    const cheapest = [...variants].sort((a, b) => (a.variant.priceData.discountedPrice ?? Infinity) - (b.variant.priceData.discountedPrice ?? Infinity))[0];
    price = cheapest.variant.priceData.price;
    discountedPrice = cheapest.variant.priceData.discountedPrice;
  } else {
    discountedPrice = num(p?.actualPriceRange?.minValue?.amount);
    const compare = num(p?.compareAtPriceRange?.minValue?.amount);
    price = compare !== null && discountedPrice !== null && compare > discountedPrice ? compare : discountedPrice;
  }
  const discount =
    price !== null && discountedPrice !== null && Math.round(price * 100) > Math.round(discountedPrice * 100)
      ? { type: 'AMOUNT', value: Math.round((price - discountedPrice) * 100) / 100 }
      : { type: 'NONE', value: 0 };

  const tracked = inv.some((i) => i.trackQuantity === true);
  const qtySum = inv.reduce((s, i) => s + (inventoryQty(i) ?? 0), 0);
  const availability = p?.inventory?.availabilityStatus;
  const inStock = availability ? availability !== 'OUT_OF_STOCK' : inv.length ? inv.some((i) => inventoryInStock(i)) : true;

  const modifiers = arr(p?.modifiers);
  const customTextFields = modifiers
    .filter((m: any) => m?.modifierRenderType === 'FREE_TEXT')
    .map((m: any) => ({
      title: m?.freeTextSettings?.title || m?.name || '',
      maxLength: num(m?.freeTextSettings?.maxCharCount) ?? 0,
      mandatory: m?.mandatory === true,
    }));
  const productOptions = [
    ...arr(p?.options).map((o: any) => ({
      optionType: o?.optionRenderType === 'SWATCH_CHOICES' ? 'color' : 'drop_down',
      name: o?.name || '',
      choices: v1ChoicesOf(o?.choicesSettings?.choices, mediaById),
    })),
    // V1 kept non-variant options (`manageVariants: false`) in productOptions too.
    ...modifiers
      .filter((m: any) => m?.modifierRenderType !== 'FREE_TEXT')
      .map((m: any) => ({
        optionType: m?.modifierRenderType === 'SWATCH_CHOICES' ? 'color' : 'drop_down',
        name: m?.name || '',
        choices: v1ChoicesOf(m?.choicesSettings?.choices, mediaById),
      })),
  ];

  const allId = ctx.allProductsCategoryId || null;
  const collectionIds = Array.from(
    new Set(
      arr(p?.directCategoriesInfo?.categories)
        .map((c: any) => (typeof c?.id === 'string' ? c.id : ''))
        .filter(Boolean)
        .map((id: string) => (allId && id === allId ? ALL_PRODUCTS_V1_ID : id)),
    ),
  );

  const single = variants.length === 1 ? variants[0] : null;
  return {
    id: p?.id,
    catalogVersion: 'V3',
    revision: p?.revision,
    name: p?.name || '',
    slug: p?.slug || undefined,
    visible: p?.visible !== false,
    productType: String(p?.productType || 'PHYSICAL').toLowerCase(),
    description: typeof p?.plainDescription === 'string' ? p.plainDescription : '',
    sku: single?.variant.sku,
    weight: single?.variant.weight,
    stock: {
      trackInventory: tracked,
      ...(tracked ? { quantity: qtySum } : {}),
      inStock,
      inventoryStatus: availability || undefined,
    },
    priceData: { currency, price, discountedPrice },
    price: { currency, price, discountedPrice },
    discount,
    media: { ...(mainMedia ? { mainMedia } : {}), items },
    customTextFields,
    manageVariants: arr(p?.options).length > 0,
    productOptions,
    productPageUrl: p?.url?.url ? { base: String(p.url.url).replace(p.url.relativePath || '', ''), path: p.url.relativePath || '' } : undefined,
    numericId: p?.numericId,
    inventoryItemId: p?.id,
    collectionIds,
    brand: p?.brand?.name || undefined,
    ribbon: p?.ribbon?.name || undefined,
    variants,
    lastUpdated: p?.updatedDate,
    createdDate: p?.createdDate,
  };
}

/** Category (Categories API) → V1 collection shape (`/api/wix/collections`). */
export function wixV3CategoryToCollection(c: any) {
  const isAll = c?.managingAppId === WIX_STORES_APP_ID || c?.handle === 'online_stores_all_products';
  return {
    id: isAll ? ALL_PRODUCTS_V1_ID : c?.id,
    name: c?.name || '',
    slug: c?.slug || undefined,
    visible: c?.visible !== false,
    numberOfProducts: num(c?.itemCounter) ?? 0,
    description: c?.description || undefined,
    media: c?.image?.url ? { mainMedia: { image: { url: c.image.url } } } : undefined,
    ...(isAll ? { categoryId: c?.id } : {}),
  };
}

/** Real id of the automatic "All Products" category in a categories list (null when absent). */
export function findAllProductsCategoryId(categories: unknown): string | null {
  const c = arr(categories).find((x: any) => x?.managingAppId === WIX_STORES_APP_ID || x?.handle === 'online_stores_all_products');
  return typeof c?.id === 'string' ? c.id : null;
}

// ─── writes: V1 payload → V3 request ─────────────────────────

/** Refused V1 → V3 translation (nothing was sent). */
export class WixV3UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WixV3UnsupportedError';
  }
}

type V1Discount = { type?: string; value?: number | string } | undefined;

/** List price + discount → V3 variant `price` (`actualPrice` = selling price, `compareAtPrice` = list price when on sale). */
export function v3PriceFrom(listPrice: number, discount: V1Discount, keepAmountOff = 0) {
  let actual = listPrice;
  const type = discount?.type;
  const value = num(discount?.value) ?? 0;
  if (type === 'AMOUNT') actual = listPrice - value;
  else if (type === 'PERCENT') actual = listPrice * (1 - value / 100);
  else if (type === undefined && keepAmountOff > 0) actual = listPrice - keepAmountOff;
  actual = Math.max(0, Math.round(actual * 100) / 100);
  return actual < listPrice
    ? { actualPrice: { amount: money(actual) }, compareAtPrice: { amount: money(listPrice) } }
    : { actualPrice: { amount: money(listPrice) } };
}

/** V1 `customTextFields` → V3 FREE_TEXT modifiers (an existing one with the same title keeps its id). */
function freeTextModifiers(fields: unknown, existing: any[]): any[] {
  return arr(fields)
    .filter((f: any) => f && typeof f.title === 'string' && f.title.trim())
    .map((f: any) => {
      const title = String(f.title).trim();
      const prev = existing.find((m) => m?.modifierRenderType === 'FREE_TEXT' && (m?.freeTextSettings?.title || m?.name) === title);
      return {
        ...(prev?.id ? { id: prev.id } : {}),
        name: title.slice(0, 50),
        modifierRenderType: 'FREE_TEXT',
        mandatory: f.mandatory === true,
        freeTextSettings: { title: title.slice(0, 150), minCharCount: 0, maxCharCount: Math.min(500, Math.max(1, Number(f.maxLength) || 500)) },
      };
    });
}

/** A variant as sent back in an update (read-only parts removed). */
function writableVariant(v: any) {
  const { media: _m, inventoryStatus: _i, revenueDetails: _r, subscriptionPricesInfo: _s, ...rest } = v || {};
  return rest;
}

const HANDLED_UPDATE_KEYS = new Set(['name', 'description', 'priceData', 'discount', 'sku', 'weight', 'visible', 'ribbon', 'customTextFields', 'slug', 'brand', 'productType', 'manageVariants']);

/**
 * V1 product PATCH body (`name`, `description`, `priceData.price`, `discount`,
 * `sku`, `weight`, `visible`, `ribbon`, `customTextFields`, `slug`, `brand`)
 * → V3 Update Product `product` body, given the current raw V3 product.
 * Per the Update Product rules, `variantsInfo.variants` is sent whole (with ids)
 * together with `options`, and `modifiers` whole. Throws WixV3UnsupportedError
 * for what V3 cannot take as given (nothing is sent then).
 */
export function buildV3ProductUpdate(update: Record<string, any>, current: any): Record<string, any> {
  const unknown = Object.keys(update).filter((k) => !HANDLED_UPDATE_KEYS.has(k));
  if (unknown.length) throw new WixV3UnsupportedError(`Wix Catalog V3: unsupported product fields: ${unknown.join(', ')}`);
  const out: Record<string, any> = { id: current?.id, revision: current?.revision };
  if (update.name !== undefined) out.name = update.name;
  if (update.description !== undefined) out.plainDescription = update.description || '<p></p>';
  if (update.visible !== undefined) out.visible = update.visible;
  if (update.slug !== undefined) out.slug = update.slug;
  if (update.productType !== undefined && String(update.productType).toUpperCase() !== String(current?.productType || 'PHYSICAL').toUpperCase()) {
    throw new WixV3UnsupportedError('Wix Catalog V3: the product type cannot be changed');
  }
  if (update.brand !== undefined) {
    if ((update.brand || '') !== (current?.brand?.name || '')) {
      if (!update.brand) throw new WixV3UnsupportedError('Wix Catalog V3: removing a brand is not supported');
      if (!current?.brand?.id || current.brand.name !== update.brand) throw new WixV3UnsupportedError('Wix Catalog V3: changing the brand needs a brand id');
    }
  }
  if (update.ribbon !== undefined) {
    const name = typeof update.ribbon === 'string' ? update.ribbon.trim() : '';
    if (name) out.ribbon = { name };
    else if (current?.ribbon?.id || current?.ribbon?.name) throw new WixV3UnsupportedError('Wix Catalog V3: removing a ribbon is not supported yet');
  }
  if (update.customTextFields !== undefined) {
    const existing = arr(current?.modifiers);
    out.modifiers = [...existing.filter((m: any) => m?.modifierRenderType !== 'FREE_TEXT'), ...freeTextModifiers(update.customTextFields, existing)];
  }

  const listPrice = num(update.priceData?.price);
  const touchesVariants = listPrice !== null || update.discount !== undefined || update.sku !== undefined || update.weight !== undefined;
  if (touchesVariants) {
    const variants = arr(current?.variantsInfo?.variants);
    if (!variants.length) throw new WixV3UnsupportedError('Wix Catalog V3: product has no variants to update');
    if (update.sku !== undefined && variants.length !== 1) throw new WixV3UnsupportedError('Wix Catalog V3: SKU is per variant on a product with options');
    if (listPrice !== null || update.discount !== undefined) {
      const lists = new Set(variants.map((v: any) => Math.round((variantPrices(v).price ?? 0) * 100)));
      if (variants.length > 1 && lists.size > 1) throw new WixV3UnsupportedError('Wix Catalog V3: variants have different prices');
    }
    out.options = arr(current?.options);
    out.variantsInfo = {
      variants: variants.map((v: any) => {
        const w = writableVariant(v);
        if (listPrice !== null || update.discount !== undefined) {
          const cur = variantPrices(v);
          const base = listPrice ?? cur.price ?? 0;
          const amountOff = cur.price !== null && cur.discountedPrice !== null ? Math.max(0, cur.price - cur.discountedPrice) : 0;
          w.price = v3PriceFrom(base, update.discount, amountOff);
        }
        if (update.sku !== undefined) w.sku = update.sku || undefined;
        if (update.weight !== undefined) w.physicalProperties = { ...(w.physicalProperties || {}), weight: num(update.weight) ?? 0 };
        return w;
      }),
    };
  }
  return out;
}

/**
 * V1 Create Product body → V3 Create Product With Inventory body. A new product
 * gets one variant, in stock and untracked (as a new V1 product).
 */
export function buildV3ProductCreate(body: Record<string, any>): Record<string, any> {
  const type = String(body.productType || 'physical').toUpperCase();
  if (type !== 'PHYSICAL') throw new WixV3UnsupportedError('Wix Catalog V3: only physical products can be created here');
  const listPrice = num(body.priceData?.price);
  if (listPrice === null) throw new WixV3UnsupportedError('Wix Catalog V3: a price is required');
  const variant: Record<string, any> = {
    price: v3PriceFrom(listPrice, body.discount),
    inventoryItem: { inStock: true },
    physicalProperties: num(body.weight) !== null ? { weight: num(body.weight) } : {},
  };
  if (body.sku) variant.sku = body.sku;
  const product: Record<string, any> = {
    name: body.name,
    productType: 'PHYSICAL',
    physicalProperties: {},
    variantsInfo: { variants: [variant] },
  };
  if (body.description) product.plainDescription = body.description;
  if (body.visible !== undefined) product.visible = body.visible;
  if (typeof body.ribbon === 'string' && body.ribbon.trim()) product.ribbon = { name: body.ribbon.trim() };
  if (typeof body.brand === 'string' && body.brand.trim()) product.brand = { name: body.brand.trim() };
  const mods = freeTextModifiers(body.customTextFields, []);
  if (mods.length) product.modifiers = mods;
  return { product };
}

/** V3 media list after adds / removes / a reorder (items by id; new ones by url or Media Manager id). */
export function v3MediaItems(currentIds: string[], change: { remove?: string[]; order?: string[]; add?: ({ url: string } | { mediaId: string })[] }) {
  let ids = currentIds.filter((id) => !(change.remove || []).includes(id));
  if (change.order) ids = change.order.filter((id) => ids.includes(id)).concat(ids.filter((id) => !change.order!.includes(id)));
  const items: any[] = ids.map((id) => ({ id }));
  for (const m of change.add || []) items.push('mediaId' in m ? { id: m.mediaId } : { url: m.url });
  return items;
}
