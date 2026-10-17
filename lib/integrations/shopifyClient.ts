// lib/integrations/shopifyClient.ts
//
// Shopify Admin client over the GraphQL Admin API only (App Store requirement 2.2.4; version in
// ./shopifyApiVersion.ts). The public methods keep their REST-era signatures and return the
// REST resource shapes (snake_case, numeric ids, `tags` as a comma string, lower-case enums)
// because callers, the order mapper, catalog drafts and the `ShopifyProduct.variants/images`
// cache JSON all consume that shape. Ids in/out are numeric strings/numbers; gids stay inside.
//
// Images: the GraphQL model is product *media*. An image's `id` is now the numeric MediaImage
// id (REST ProductImage ids were a different number space). Each image also carries
// `legacy_image_id` (the numeric id of `MediaImage.image`) so callers can match ids staged
// before the migration; see `resolveImageId` (./shopifyImageIds.ts).
import { randomUUID } from 'crypto';
import { logger } from '../logger';
import prisma from '../prisma';
import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';
import { assertNoUserErrors, gidNum, gidStr, shopifyGraphql, ShopifyApiError, toGid, type ShopifyGqlOptions } from './shopifyGraphql';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export async function getValidAccessToken(shopId: string): Promise<string> {
  const shop = await prisma.shopifyShop.findUniqueOrThrow({ where: { id: shopId } });

  // Stored tokens may be plaintext (legacy), `lib/encryption.ts` base64 envelope, or new
  // `enc:v1:`. `decryptIfNeeded` handles all three.
  const plainAccess = decryptIfNeeded(shop.accessToken) as string;
  const plainRefresh = decryptIfNeeded(shop.refreshToken) as string | null;

  if (!shop.tokenExpiresAt || !plainRefresh) {
    return plainAccess;
  }

  if (new Date(shop.tokenExpiresAt).getTime() - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return plainAccess;
  }

  logger.info('Shopify token expired, refreshing', { shopId, shopDomain: shop.shopDomain });

  const res = await fetch(`https://${shop.shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: 'refresh_token',
      refresh_token: plainRefresh,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    logger.error('Shopify token refresh failed', undefined, { shopId, status: res.status, body: err });
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  const tokenExpiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;

  await prisma.shopifyShop.update({
    where: { id: shopId },
    data: {
      accessToken: encryptIfNeeded(data.access_token),
      refreshToken: encryptIfNeeded(data.refresh_token || plainRefresh),
      tokenExpiresAt,
    },
  });

  logger.info('Shopify token refreshed', { shopId, expiresAt: tokenExpiresAt });
  return data.access_token;
}

export interface ShopifyCredentials {
  accessToken: string;
  shopDomain: string; // e.g. "mystore.myshopify.com"
}

export type InventoryLevelLite = { location_id: number; available: number | null };

// ─── GraphQL documents ──────────────────────────────────────────────────────────────────────

const VARIANT_FIELDS = `
  id title price compareAtPrice sku barcode position inventoryPolicy inventoryQuantity taxable createdAt updatedAt
  selectedOptions { name value }
  inventoryItem { id tracked requiresShipping measurement { weight { unit value } } }`;

const MEDIA_FIELDS = `
  id alt mediaContentType status
  ... on MediaImage { createdAt updatedAt image { id url width height } }`;

const PRODUCT_FIELDS = `
  id title handle descriptionHtml vendor productType status tags createdAt updatedAt publishedAt templateSuffix isGiftCard
  options { id name position values }
  media(first: $mediaFirst) { pageInfo { hasNextPage endCursor } nodes { ${MEDIA_FIELDS} } }
  variants(first: $variantsFirst) { pageInfo { hasNextPage endCursor } nodes { ${VARIANT_FIELDS} } }`;

const Q_SHOP = `query KxShop {
  shop { id name email contactEmail shopOwnerName myshopifyDomain currencyCode ianaTimezone createdAt
    plan { publicDisplayName } primaryDomain { host } shopAddress { countryCodeV2 phone } }
}`;

const Q_PRODUCT = `query KxProduct($id: ID!, $variantsFirst: Int!, $mediaFirst: Int!) {
  product(id: $id) { ${PRODUCT_FIELDS} }
}`;

const Q_PRODUCTS = `query KxProducts($first: Int!, $after: String, $query: String, $variantsFirst: Int!, $mediaFirst: Int!) {
  products(first: $first, after: $after, query: $query, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes { ${PRODUCT_FIELDS} }
  }
}`;

const Q_PRODUCT_VARIANTS_PAGE = `query KxProductVariantsPage($id: ID!, $after: String) {
  product(id: $id) { variants(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${VARIANT_FIELDS} } } }
}`;

const Q_PRODUCT_MEDIA_PAGE = `query KxProductMediaPage($id: ID!, $after: String) {
  product(id: $id) { id media(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${MEDIA_FIELDS} } } }
}`;

const Q_VARIANT_CONTEXT = `query KxVariantContext($id: ID!) {
  productVariant(id: $id) {
    id
    product { id options { name position } }
    inventoryItem { measurement { weight { unit value } } }
  }
}`;

const Q_PRODUCT_OPTIONS = `query KxProductOptions($id: ID!) {
  product(id: $id) { id options { name position } }
}`;

const M_PRODUCT_SET = `mutation KxProductSet($input: ProductSetInput!) {
  productSet(synchronous: true, input: $input) { product { id } userErrors { field message code } }
}`;

const M_PRODUCT_UPDATE = `mutation KxProductUpdate($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id } userErrors { field message } }
}`;

const M_PRODUCT_ADD_MEDIA = `mutation KxProductAddMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
  productUpdate(product: $product, media: $media) {
    product { id media(last: 1) { nodes { ${MEDIA_FIELDS} } } }
    userErrors { field message }
  }
}`;

const M_PRODUCT_DELETE = `mutation KxProductDelete($input: ProductDeleteInput!) {
  productDelete(input: $input) { deletedProductId userErrors { field message } }
}`;

const M_VARIANTS_CREATE = `mutation KxVariantsCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) {
    productVariants { ${VARIANT_FIELDS} }
    userErrors { field message code }
  }
}`;

const M_VARIANTS_UPDATE = `mutation KxVariantsUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { ${VARIANT_FIELDS} }
    userErrors { field message code }
  }
}`;

const M_VARIANTS_DELETE = `mutation KxVariantsDelete($productId: ID!, $variantsIds: [ID!]!) {
  productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) { product { id } userErrors { field message code } }
}`;

// productDeleteMedia / productUpdateMedia are deprecated in favour of fileUpdate, but fileUpdate
// needs write_files, which this app does not request. Both still work in this version with write_products.
const M_MEDIA_DELETE = `mutation KxMediaDelete($productId: ID!, $mediaIds: [ID!]!) {
  productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { deletedMediaIds mediaUserErrors { field message code } }
}`;

const M_MEDIA_UPDATE = `mutation KxMediaUpdate($productId: ID!, $media: [UpdateMediaInput!]!) {
  productUpdateMedia(productId: $productId, media: $media) { media { id alt } mediaUserErrors { field message code } }
}`;

const M_MEDIA_REORDER = `mutation KxMediaReorder($id: ID!, $moves: [MoveInput!]!) {
  productReorderMedia(id: $id, moves: $moves) { job { id done } mediaUserErrors { field message code } }
}`;

const Q_JOB = `query KxJob($id: ID!) { job(id: $id) { id done } }`;

const M_STAGED_UPLOAD = `mutation KxStagedUpload($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } }
}`;

const Q_LOCATIONS = `query KxLocations($after: String) {
  locations(first: 250, after: $after, includeInactive: true, includeLegacy: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id name isActive fulfillsOnlineOrders createdAt updatedAt
      address { address1 address2 city province provinceCode zip country countryCode phone } }
  }
}`;

const Q_PRIMARY_LOCATION = `query KxPrimaryLocation { location { id } }`;

const Q_ITEM_LEVELS = `query KxItemLevels($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on InventoryItem {
      id
      inventoryLevels(first: 10) {
        pageInfo { hasNextPage endCursor }
        nodes { location { id } quantities(names: ["available"]) { name quantity } }
      }
    }
  }
}`;

const Q_ITEM_LEVELS_PAGE = `query KxItemLevelsPage($id: ID!, $after: String) {
  inventoryItem(id: $id) {
    id
    inventoryLevels(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { location { id } quantities(names: ["available"]) { name quantity } }
    }
  }
}`;

const M_INVENTORY_SET = `mutation KxInventorySet($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { id }
    userErrors { code field message }
  }
}`;

const Q_COLLECTIONS = `query KxCollections($after: String) {
  collections(first: 250, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle descriptionHtml updatedAt sortOrder templateSuffix
      image { url altText } ruleSet { appliedDisjunctively } }
  }
}`;

const ORDER_LINE_ITEM_FIELDS = `
  id title name quantity sku variantTitle vendor requiresShipping
  originalUnitPriceSet { shopMoney { amount } }
  image { url altText }
  product { id }
  variant { id }`;

const ADDRESS_FIELDS = `name firstName lastName company address1 address2 city province provinceCode zip country countryCodeV2 phone`;

const Q_ORDERS = `query KxOrders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name number email phone note tags test
      createdAt updatedAt processedAt cancelledAt closedAt cancelReason
      displayFinancialStatus displayFulfillmentStatus currencyCode presentmentCurrencyCode
      totalPriceSet { shopMoney { amount } }
      subtotalPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      shippingAddress { ${ADDRESS_FIELDS} }
      billingAddress { ${ADDRESS_FIELDS} }
      lineItems(first: 10) { pageInfo { hasNextPage endCursor } nodes { ${ORDER_LINE_ITEM_FIELDS} } }
    }
  }
}`;

const Q_ORDER_LINE_ITEMS_PAGE = `query KxOrderLineItemsPage($id: ID!, $after: String) {
  order(id: $id) { id lineItems(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${ORDER_LINE_ITEM_FIELDS} } } }
}`;

const Q_VARIANT_WEIGHTS = `query KxVariantWeights($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id inventoryItem { measurement { weight { unit value } } } } }
}`;

// ─── Shape helpers (GraphQL → REST) ─────────────────────────────────────────────────────────

const WEIGHT_TO_REST: Record<string, string> = { GRAMS: 'g', KILOGRAMS: 'kg', OUNCES: 'oz', POUNDS: 'lb' };
const WEIGHT_FROM_REST: Record<string, string> = { g: 'GRAMS', kg: 'KILOGRAMS', oz: 'OUNCES', lb: 'POUNDS' };
const GRAMS_PER: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.349523125, POUNDS: 453.59237 };

const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v ?? null);
const nodesOf = (conn: any): any[] => (Array.isArray(conn?.nodes) ? conn.nodes : []);

function toGrams(weight: any): number {
  if (!weight || typeof weight.value !== 'number') return 0;
  return Math.round(weight.value * (GRAMS_PER[weight.unit] ?? 1));
}

function restVariant(v: any, productId: number | null, optionNames: string[], isGiftCard = false): any {
  const weight = v?.inventoryItem?.measurement?.weight;
  const sel: any[] = Array.isArray(v?.selectedOptions) ? v.selectedOptions : [];
  const valueOf = (i: number) => {
    const name = optionNames[i];
    if (name !== undefined) return sel.find((o) => o?.name === name)?.value ?? null;
    return sel[i]?.value ?? null;
  };
  return {
    id: gidNum(v?.id),
    product_id: productId,
    title: v?.title ?? null,
    price: v?.price ?? null,
    compare_at_price: v?.compareAtPrice ?? null,
    sku: v?.sku ?? '',
    barcode: v?.barcode ?? null,
    position: v?.position ?? null,
    inventory_policy: lower(v?.inventoryPolicy),
    inventory_management: v?.inventoryItem?.tracked ? 'shopify' : null,
    inventory_item_id: gidNum(v?.inventoryItem?.id),
    inventory_quantity: typeof v?.inventoryQuantity === 'number' ? v.inventoryQuantity : 0,
    option1: valueOf(0),
    option2: valueOf(1),
    option3: valueOf(2),
    taxable: v?.taxable ?? null,
    requires_shipping: v?.inventoryItem?.requiresShipping ?? null,
    fulfillment_service: isGiftCard ? 'gift_card' : 'manual',
    weight: typeof weight?.value === 'number' ? weight.value : 0,
    weight_unit: weight?.unit ? WEIGHT_TO_REST[weight.unit] ?? String(weight.unit).toLowerCase() : null,
    grams: toGrams(weight),
    created_at: v?.createdAt ?? null,
    updated_at: v?.updatedAt ?? null,
    admin_graphql_api_id: v?.id ?? null,
  };
}

/** MediaImage nodes → REST product images (position = 1-based among images, videos excluded). */
function restImages(media: any[], productId: number | null): any[] {
  return media
    .filter((m) => m?.mediaContentType === 'IMAGE')
    .map((m, i) => ({
      id: gidNum(m.id),
      product_id: productId,
      position: i + 1,
      alt: m.alt ?? null,
      width: m.image?.width ?? null,
      height: m.image?.height ?? null,
      src: m.image?.url ?? null,
      status: lower(m.status),
      variant_ids: [],
      legacy_image_id: gidNum(m.image?.id),
      created_at: m.createdAt ?? null,
      updated_at: m.updatedAt ?? null,
      admin_graphql_api_id: m.id,
    }));
}

function restProduct(p: any, media: any[], variants: any[]): any {
  const id = gidNum(p?.id);
  const options: any[] = Array.isArray(p?.options) ? [...p.options].sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0)) : [];
  const optionNames = options.map((o) => o?.name);
  const images = restImages(media, id);
  return {
    id,
    title: p?.title ?? '',
    body_html: p?.descriptionHtml ?? null,
    vendor: p?.vendor ?? null,
    product_type: p?.productType ?? '',
    handle: p?.handle ?? null,
    status: lower(p?.status),
    tags: Array.isArray(p?.tags) ? p.tags.join(', ') : '',
    template_suffix: p?.templateSuffix ?? null,
    created_at: p?.createdAt ?? null,
    updated_at: p?.updatedAt ?? null,
    published_at: p?.publishedAt ?? null,
    options: options.map((o) => ({ id: gidNum(o?.id), product_id: id, name: o?.name, position: o?.position, values: o?.values ?? [] })),
    variants: variants.map((v) => restVariant(v, id, optionNames, Boolean(p?.isGiftCard))),
    images,
    image: images[0] ?? null,
    admin_graphql_api_id: p?.id ?? null,
  };
}

function restAddress(a: any): any {
  if (!a) return null;
  return {
    name: a.name ?? null,
    first_name: a.firstName ?? null,
    last_name: a.lastName ?? null,
    company: a.company ?? null,
    address1: a.address1 ?? null,
    address2: a.address2 ?? null,
    city: a.city ?? null,
    province: a.province ?? null,
    province_code: a.provinceCode ?? null,
    zip: a.zip ?? null,
    country: a.country ?? null,
    country_code: a.countryCodeV2 ?? null,
    phone: a.phone ?? null,
  };
}

const FULFILLMENT_TO_REST: Record<string, string | null> = {
  FULFILLED: 'fulfilled',
  PARTIALLY_FULFILLED: 'partial',
  RESTOCKED: 'restocked',
};

function restLineItem(li: any, gramsByVariant: Map<string, number>): any {
  const variantId = gidNum(li?.variant?.id);
  return {
    id: gidNum(li?.id),
    admin_graphql_api_id: li?.id ?? null,
    title: li?.title ?? null,
    name: li?.name ?? null,
    quantity: li?.quantity ?? 0,
    sku: li?.sku ?? null,
    variant_title: li?.variantTitle ?? null,
    vendor: li?.vendor ?? null,
    price: li?.originalUnitPriceSet?.shopMoney?.amount ?? null,
    product_id: gidNum(li?.product?.id),
    variant_id: variantId,
    requires_shipping: li?.requiresShipping ?? null,
    grams: variantId !== null ? gramsByVariant.get(String(variantId)) ?? 0 : 0,
    ...(li?.image?.url ? { image: { src: li.image.url, alt: li.image.altText ?? null } } : {}),
  };
}

function restOrder(o: any, lineItems: any[], gramsByVariant: Map<string, number>): any {
  return {
    id: gidNum(o?.id),
    admin_graphql_api_id: o?.id ?? null,
    name: o?.name ?? null,
    order_number: o?.number ?? null,
    number: o?.number ?? null,
    email: o?.email ?? null,
    phone: o?.phone ?? null,
    note: o?.note ?? null,
    tags: Array.isArray(o?.tags) ? o.tags.join(', ') : '',
    test: o?.test ?? false,
    created_at: o?.createdAt ?? null,
    updated_at: o?.updatedAt ?? null,
    processed_at: o?.processedAt ?? null,
    cancelled_at: o?.cancelledAt ?? null,
    closed_at: o?.closedAt ?? null,
    cancel_reason: lower(o?.cancelReason),
    financial_status: lower(o?.displayFinancialStatus),
    fulfillment_status: FULFILLMENT_TO_REST[o?.displayFulfillmentStatus] ?? null,
    currency: o?.currencyCode ?? null,
    presentment_currency: o?.presentmentCurrencyCode ?? null,
    total_price: o?.totalPriceSet?.shopMoney?.amount ?? null,
    subtotal_price: o?.subtotalPriceSet?.shopMoney?.amount ?? null,
    total_tax: o?.totalTaxSet?.shopMoney?.amount ?? null,
    total_shipping_price: o?.totalShippingPriceSet?.shopMoney?.amount ?? null,
    // `Order.customer` needs read_customers (not requested): names fall back to the addresses.
    customer: null,
    shipping_address: restAddress(o?.shippingAddress),
    billing_address: restAddress(o?.billingAddress),
    line_items: lineItems.map((li) => restLineItem(li, gramsByVariant)),
  };
}

function restLocation(l: any): any {
  const a = l?.address || {};
  return {
    id: gidNum(l?.id),
    name: l?.name ?? null,
    active: Boolean(l?.isActive),
    fulfills_online_orders: l?.fulfillsOnlineOrders ?? null,
    address1: a.address1 ?? null,
    address2: a.address2 ?? null,
    city: a.city ?? null,
    province: a.province ?? null,
    province_code: a.provinceCode ?? null,
    zip: a.zip ?? null,
    country: a.country ?? null,
    country_code: a.countryCode ?? null,
    phone: a.phone ?? null,
    created_at: l?.createdAt ?? null,
    updated_at: l?.updatedAt ?? null,
    admin_graphql_api_id: l?.id ?? null,
  };
}

// ─── Input helpers (REST → GraphQL) ─────────────────────────────────────────────────────────

function tagsArray(tags: unknown): string[] | undefined {
  if (tags === undefined || tags === null) return undefined;
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  return String(tags).split(',').map((t) => t.trim()).filter(Boolean);
}

/** REST product fields → ProductUpdateInput / ProductSetInput scalar fields. */
function productFieldsFromRest(p: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.title !== undefined) out.title = p.title;
  if (p.body_html !== undefined) out.descriptionHtml = p.body_html ?? '';
  if (p.vendor !== undefined) out.vendor = p.vendor ?? '';
  if (p.product_type !== undefined) out.productType = p.product_type ?? '';
  if (p.handle !== undefined) out.handle = p.handle;
  if (p.template_suffix !== undefined) out.templateSuffix = p.template_suffix;
  if (p.status !== undefined && p.status !== null) out.status = String(p.status).toUpperCase();
  const tags = tagsArray(p.tags);
  if (tags !== undefined) out.tags = tags;
  if (p.metafields_global_title_tag !== undefined || p.metafields_global_description_tag !== undefined) {
    out.seo = {
      ...(p.metafields_global_title_tag !== undefined ? { title: p.metafields_global_title_tag } : {}),
      ...(p.metafields_global_description_tag !== undefined ? { description: p.metafields_global_description_tag } : {}),
    };
  }
  return out;
}

/** REST variant fields → the shared part of ProductVariantsBulkInput / ProductVariantSetInput. */
function variantFieldsFromRest(v: Record<string, any>, currentWeight?: { unit: string; value: number } | null, opts: { skuInItem?: boolean } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const item: Record<string, unknown> = {};
  if (v.price !== undefined) out.price = v.price === null ? null : String(v.price);
  if (v.compare_at_price !== undefined) out.compareAtPrice = v.compare_at_price === null || v.compare_at_price === '' ? null : String(v.compare_at_price);
  if (v.barcode !== undefined) out.barcode = v.barcode;
  if (v.taxable !== undefined) out.taxable = Boolean(v.taxable);
  if (v.inventory_policy !== undefined && v.inventory_policy !== null) out.inventoryPolicy = String(v.inventory_policy).toUpperCase();
  if (v.sku !== undefined) {
    if (opts.skuInItem === false) out.sku = v.sku;
    else item.sku = v.sku;
  }
  if (v.inventory_management !== undefined) item.tracked = v.inventory_management === 'shopify';
  if (v.requires_shipping !== undefined) item.requiresShipping = Boolean(v.requires_shipping);
  if (v.weight !== undefined || v.weight_unit !== undefined) {
    const unit = v.weight_unit !== undefined && v.weight_unit !== null
      ? WEIGHT_FROM_REST[String(v.weight_unit)] ?? String(v.weight_unit).toUpperCase()
      : currentWeight?.unit ?? 'KILOGRAMS';
    const value = v.weight !== undefined && v.weight !== null ? Number(v.weight) : currentWeight?.value ?? 0;
    item.measurement = { weight: { unit, value } };
  }
  if (Object.keys(item).length) out.inventoryItem = item;
  return out;
}

function optionValuesFromRest(v: Record<string, any>, optionNames: string[]): { optionName: string; name: string }[] | undefined {
  const out: { optionName: string; name: string }[] = [];
  ['option1', 'option2', 'option3'].forEach((k, i) => {
    if (v[k] !== undefined && v[k] !== null && optionNames[i]) out.push({ optionName: optionNames[i], name: String(v[k]) });
  });
  return out.length ? out : undefined;
}

function guessMime(filename: string | undefined, b64: string): string {
  const ext = (filename || '').toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('R0lG')) return 'image/gif';
  if (b64.startsWith('UklG')) return 'image/webp';
  return 'image/jpeg';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Client ─────────────────────────────────────────────────────────────────────────────────

export class ShopifyClient {
  private accessToken: string;
  private shopDomain: string;
  private primaryLocationGid: string | null | undefined;

  constructor(credentials: ShopifyCredentials) {
    this.accessToken = credentials.accessToken;
    this.shopDomain = credentials.shopDomain;
  }

  /** Raw Admin GraphQL call (throttle-aware; top-level errors thrown). */
  async graphql<T = any>(query: string, variables: Record<string, unknown> = {}, opts?: ShopifyGqlOptions): Promise<T> {
    return shopifyGraphql<T>(this.shopDomain, this.accessToken, query, variables, opts);
  }

  /** Follow a connection inside `fetchPage` until `hasNextPage` is false. */
  private async paginate<T>(fetchPage: (after: string | null) => Promise<any>, max = 10_000): Promise<T[]> {
    const all: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < max; page++) {
      const conn = await fetchPage(after);
      all.push(...nodesOf(conn));
      if (!conn?.pageInfo?.hasNextPage || !conn?.pageInfo?.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
    return all;
  }

  // ─── Shop ─────────────────────────────────────────────────────

  async getShopInfo(): Promise<any> {
    const data = await this.graphql(Q_SHOP);
    const s = data?.shop || {};
    return {
      id: gidNum(s.id),
      name: s.name ?? null,
      email: s.email ?? null,
      customer_email: s.contactEmail ?? null,
      shop_owner: s.shopOwnerName ?? null,
      domain: s.primaryDomain?.host ?? null,
      myshopify_domain: s.myshopifyDomain ?? this.shopDomain,
      currency: s.currencyCode ?? null,
      iana_timezone: s.ianaTimezone ?? null,
      plan_display_name: s.plan?.publicDisplayName ?? null,
      country_code: s.shopAddress?.countryCodeV2 ?? null,
      phone: s.shopAddress?.phone ?? null,
      created_at: s.createdAt ?? null,
    };
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getShopInfo();
      return true;
    } catch {
      return false;
    }
  }

  // ─── Orders ───────────────────────────────────────────────────

  /**
   * Orders in REST shape. Without read_all_orders Shopify only returns the last 60 days
   * (same as REST). `fields` and `limit` are accepted for compatibility and ignored.
   */
  async getOrders(params?: {
    status?: string; // any, open, closed, cancelled
    created_at_min?: string;
    created_at_max?: string;
    updated_at_min?: string;
    limit?: number;
    fields?: string;
  }): Promise<any[]> {
    const terms: string[] = [];
    if (params?.created_at_min) terms.push(`created_at:>='${params.created_at_min}'`);
    if (params?.created_at_max) terms.push(`created_at:<='${params.created_at_max}'`);
    if (params?.updated_at_min) terms.push(`updated_at:>='${params.updated_at_min}'`);
    const status = (params?.status || 'any').toLowerCase();
    if (status === 'open' || status === 'closed' || status === 'cancelled') terms.push(`status:${status}`);
    const query = terms.join(' AND ') || null;

    const raw = await this.paginate<any>(async (after) => {
      const data = await this.graphql(Q_ORDERS, { first: 10, after, query }, { allowAccessDenied: true, label: 'orders' });
      return data?.orders;
    });

    // Line items beyond the first page of an order.
    const lineItemsByOrder = new Map<string, any[]>();
    for (const o of raw) {
      const items = nodesOf(o?.lineItems);
      if (o?.lineItems?.pageInfo?.hasNextPage && o?.lineItems?.pageInfo?.endCursor) {
        const rest = await this.paginate<any>(async (after) => {
          const data = await this.graphql(Q_ORDER_LINE_ITEMS_PAGE, { id: o.id, after: after ?? o.lineItems.pageInfo.endCursor }, { allowAccessDenied: true });
          return data?.order?.lineItems;
        });
        items.push(...rest);
      }
      lineItemsByOrder.set(o.id, items);
    }

    // Line-item weights (REST `grams`) from the variants' inventory items, deduped, 50 per call.
    const variantGids = Array.from(new Set(Array.from(lineItemsByOrder.values()).flat().map((li) => li?.variant?.id).filter(Boolean))) as string[];
    const gramsByVariant = new Map<string, number>();
    for (let i = 0; i < variantGids.length; i += 50) {
      try {
        const data = await this.graphql(Q_VARIANT_WEIGHTS, { ids: variantGids.slice(i, i + 50) });
        for (const n of Array.isArray(data?.nodes) ? data.nodes : []) {
          if (n?.id) gramsByVariant.set(gidStr(n.id), toGrams(n?.inventoryItem?.measurement?.weight));
        }
      } catch (err: any) {
        logger.warn('Shopify variant weight lookup failed', { shopDomain: this.shopDomain, err: err?.message });
      }
    }

    return raw.map((o) => restOrder(o, lineItemsByOrder.get(o.id) || [], gramsByVariant));
  }

  // ─── Products ─────────────────────────────────────────────────

  /** Fill the variants / media of a product node past their first page. */
  private async completeProduct(p: any): Promise<any> {
    const media = nodesOf(p?.media);
    const variants = nodesOf(p?.variants);
    if (p?.media?.pageInfo?.hasNextPage) {
      media.push(...(await this.paginate<any>(async (after) => {
        const data = await this.graphql(Q_PRODUCT_MEDIA_PAGE, { id: p.id, after: after ?? p.media.pageInfo.endCursor });
        return data?.product?.media;
      })));
    }
    if (p?.variants?.pageInfo?.hasNextPage) {
      variants.push(...(await this.paginate<any>(async (after) => {
        const data = await this.graphql(Q_PRODUCT_VARIANTS_PAGE, { id: p.id, after: after ?? p.variants.pageInfo.endCursor });
        return data?.product?.variants;
      })));
    }
    return restProduct(p, media, variants);
  }

  async getProducts(params?: {
    status?: string;
    product_type?: string;
    vendor?: string;
    collection_id?: string;
    title?: string;
    limit?: number;
  }): Promise<any[]> {
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const terms: string[] = [];
    if (params?.status) {
      const statuses = String(params.status).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (statuses.length) terms.push(`(${statuses.map((s) => `status:${s}`).join(' OR ')})`);
    }
    if (params?.product_type) terms.push(`product_type:"${esc(params.product_type)}"`);
    if (params?.vendor) terms.push(`vendor:"${esc(params.vendor)}"`);
    if (params?.collection_id) terms.push(`collection_id:${gidStr(params.collection_id)}`);
    if (params?.title) terms.push(`title:"${esc(params.title)}"`);
    const query = terms.join(' AND ') || null;

    // Requested cost must stay under 1000 per call: 6 products × (20 variants + 15 media).
    const nodes = await this.paginate<any>(async (after) => {
      const data = await this.graphql(Q_PRODUCTS, { first: 6, after, query, variantsFirst: 20, mediaFirst: 15 });
      return data?.products;
    });
    const out: any[] = [];
    for (const p of nodes) out.push(await this.completeProduct(p));
    return out;
  }

  /** One product in REST shape; a missing product throws a 404 error (as REST did). */
  async getProduct(productId: string): Promise<any> {
    const data = await this.graphql(Q_PRODUCT, { id: toGid('Product', productId), variantsFirst: 100, mediaFirst: 100 });
    if (!data?.product) throw new ShopifyApiError(`Shopify API product ${productId} failed: 404 - Not Found`, 404);
    return this.completeProduct(data.product);
  }

  private async primaryLocation(): Promise<string | null> {
    if (this.primaryLocationGid !== undefined) return this.primaryLocationGid;
    const data = await this.graphql(Q_PRIMARY_LOCATION);
    this.primaryLocationGid = data?.location?.id ?? null;
    return this.primaryLocationGid ?? null;
  }

  /** Numeric id of the shop's primary location, or null. */
  async getPrimaryLocationId(): Promise<string | null> {
    const gid = await this.primaryLocation();
    return gid ? gidStr(gid) : null;
  }

  /**
   * Create a product from a REST-shaped body (title, body_html, vendor, product_type, tags,
   * status, options, variants, images). Product + options + variants are created atomically
   * with `productSet`; images are attached afterwards.
   */
  async createProduct(product: {
    title: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    tags?: string;
    status?: string;
    variants?: any[];
    images?: any[];
    options?: any[];
  }): Promise<any> {
    const p = product as Record<string, any>;
    const input: Record<string, unknown> = productFieldsFromRest(p);
    const restVariants: any[] = Array.isArray(p.variants) && p.variants.length ? p.variants : [{}];

    // Options: given, else inferred from option1..3 of the variants, else Shopify's default "Title".
    let options: { name: string; values: string[] }[] = Array.isArray(p.options)
      ? p.options.filter((o: any) => o?.name).map((o: any) => ({ name: String(o.name), values: Array.isArray(o.values) ? o.values.map(String) : [] }))
      : [];
    if (!options.length && restVariants.some((v) => v?.option1)) {
      options = ['option1', 'option2', 'option3']
        .map((k, i) => ({ name: `Option ${i + 1}`, values: Array.from(new Set(restVariants.map((v) => v?.[k]).filter(Boolean).map(String))) }))
        .filter((o) => o.values.length);
    }
    const usesDefault = !options.length;
    if (usesDefault) options = [{ name: 'Title', values: ['Default Title'] }];
    // Values used by the variants must be listed on the option.
    options.forEach((o, i) => {
      for (const v of restVariants) {
        const val = v?.[`option${i + 1}`];
        if (val && !o.values.includes(String(val))) o.values.push(String(val));
      }
      if (!o.values.length) o.values.push(usesDefault ? 'Default Title' : `${o.name} 1`);
    });
    const optionNames = options.map((o) => o.name);
    input.productOptions = options.map((o, i) => ({ name: o.name, position: i + 1, values: o.values.map((name) => ({ name })) }));

    const wantsStock = restVariants.some((v) => v?.inventory_quantity !== undefined && v?.inventory_quantity !== null);
    const locationGid = wantsStock ? await this.primaryLocation() : null;
    input.variants = restVariants.map((v) => {
      const fields = variantFieldsFromRest(v || {}, null, { skuInItem: false });
      const optionValues = usesDefault
        ? [{ optionName: 'Title', name: 'Default Title' }]
        : optionValuesFromRest(v || {}, optionNames) ?? options.map((o) => ({ optionName: o.name, name: o.values[0] }));
      return {
        ...fields,
        optionValues,
        ...(locationGid && v?.inventory_quantity !== undefined && v?.inventory_quantity !== null
          ? { inventoryQuantities: [{ locationId: locationGid, name: 'available', quantity: Math.trunc(Number(v.inventory_quantity) || 0) }] }
          : {}),
      };
    });

    const data = await this.graphql(M_PRODUCT_SET, { input });
    assertNoUserErrors(data?.productSet, 'productSet');
    const gid = data?.productSet?.product?.id;
    const id = gidStr(gid);
    if (!id) throw new ShopifyApiError('Shopify API productSet failed: 502 - no product id returned', 502);

    const images: any[] = Array.isArray(p.images) ? p.images : [];
    for (const img of images) {
      try {
        await this.createProductImage(id, img || {});
      } catch (err: any) {
        logger.error('Shopify createProduct: image attach failed (product was created)', err as Error, { productId: id });
      }
    }
    return this.getProduct(id);
  }

  /**
   * Update product fields from a REST-shaped body. `variants` entries with an `id` are
   * updated via the variant API; `images` / `options` are not supported here (use the image
   * and variant methods).
   */
  async updateProduct(productId: string, updates: Record<string, unknown>): Promise<any> {
    const u = updates as Record<string, any>;
    if (u.images !== undefined || u.options !== undefined) {
      throw new ShopifyApiError('Shopify API productUpdate failed: 400 - images/options cannot be replaced through updateProduct', 400);
    }
    const fields = productFieldsFromRest(u);
    if (Object.keys(fields).length) {
      const data = await this.graphql(M_PRODUCT_UPDATE, { product: { id: toGid('Product', productId), ...fields } });
      assertNoUserErrors(data?.productUpdate, 'productUpdate');
      if (!data?.productUpdate?.product?.id) throw new ShopifyApiError(`Shopify API productUpdate failed: 404 - product ${productId} not found`, 404);
    }
    if (Array.isArray(u.variants)) {
      for (const v of u.variants) {
        if (!v?.id) throw new ShopifyApiError('Shopify API productUpdate failed: 400 - new variants must be created with createProductVariant', 400);
        const { id, ...rest } = v;
        if (Object.keys(rest).length) await this.updateProductVariant(String(id), rest);
      }
    }
    return this.getProduct(productId);
  }

  async deleteProduct(productId: string): Promise<void> {
    const data = await this.graphql(M_PRODUCT_DELETE, { input: { id: toGid('Product', productId) } });
    assertNoUserErrors(data?.productDelete, 'productDelete');
  }

  // ─── Product Images (product media) ───────────────────────────

  private async getAllMedia(productId: string): Promise<any[]> {
    const gid = toGid('Product', productId);
    let exists = true;
    const media = await this.paginate<any>(async (after) => {
      const data = await this.graphql(Q_PRODUCT_MEDIA_PAGE, { id: gid, after });
      if (!data?.product) exists = false;
      return data?.product?.media;
    });
    if (!exists) throw new ShopifyApiError(`Shopify API product ${productId} failed: 404 - Not Found`, 404);
    return media;
  }

  async getProductImages(productId: string): Promise<any[]> {
    return restImages(await this.getAllMedia(productId), Number(gidStr(productId)) || null);
  }

  /** Upload base64 image bytes to a staged target; returns the `resourceUrl` for `originalSource`. */
  private async stageAttachment(b64: string, filename?: string): Promise<string> {
    const mimeType = guessMime(filename, b64);
    const name = filename || `upload-${Date.now()}.${mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1]}`;
    const bytes = Buffer.from(b64, 'base64');
    const data = await this.graphql(M_STAGED_UPLOAD, {
      input: [{ filename: name, mimeType, resource: 'IMAGE', httpMethod: 'POST', fileSize: String(bytes.length) }],
    });
    assertNoUserErrors(data?.stagedUploadsCreate, 'stagedUploadsCreate');
    const target = data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target?.url || !target?.resourceUrl) throw new ShopifyApiError('Shopify API stagedUploadsCreate failed: 502 - no upload target', 502);
    const form = new FormData();
    for (const prm of target.parameters || []) form.append(prm.name, prm.value);
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), name);
    const res = await fetch(target.url, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ShopifyApiError(`Shopify API staged upload failed: ${res.status} - ${body.slice(0, 300)}`, res.status >= 500 ? 502 : 422);
    }
    return target.resourceUrl;
  }

  async createProductImage(
    productId: string,
    image: { src?: string; attachment?: string; filename?: string; alt?: string; position?: number }
  ): Promise<any> {
    const source = image.attachment ? await this.stageAttachment(image.attachment, image.filename) : image.src;
    if (!source) throw new ShopifyApiError('Shopify API productCreateMedia failed: 400 - src or attachment required', 400);
    const data = await this.graphql(M_PRODUCT_ADD_MEDIA, {
      product: { id: toGid('Product', productId) },
      media: [{ originalSource: source, mediaContentType: 'IMAGE', ...(image.alt !== undefined ? { alt: image.alt } : {}) }],
    });
    assertNoUserErrors(data?.productUpdate, 'productUpdate(media)');
    const created = nodesOf(data?.productUpdate?.product?.media)[0];
    if (!created?.id) throw new ShopifyApiError('Shopify API productUpdate(media) failed: 502 - no media returned', 502);
    const mediaId = gidStr(created.id);
    if (image.position !== undefined && image.position !== null) {
      await this.moveImage(productId, mediaId, Number(image.position));
    }
    const images = await this.getProductImages(productId).catch(() => null);
    return images?.find((im) => String(im.id) === mediaId) ?? restImages([created], Number(gidStr(productId)) || null)[0];
  }

  /** Move one image to a 1-based position among the product's images (videos keep their slots). */
  private async moveImage(productId: string, mediaId: string, position: number): Promise<void> {
    const media = await this.getAllMedia(productId);
    const target = media.find((m) => gidStr(m.id) === mediaId);
    if (!target) throw new ShopifyApiError(`Shopify API productReorderMedia failed: 404 - image ${mediaId} not found`, 404);
    const others = media.filter((m) => m !== target);
    const otherImages = others.filter((m) => m.mediaContentType === 'IMAGE');
    const idx = Math.max(0, Math.trunc(position) - 1);
    let newPos: number;
    if (idx < otherImages.length) newPos = others.indexOf(otherImages[idx]);
    else newPos = otherImages.length ? others.indexOf(otherImages[otherImages.length - 1]) + 1 : 0;
    if (media.indexOf(target) === newPos) return;
    const data = await this.graphql(M_MEDIA_REORDER, { id: toGid('Product', productId), moves: [{ id: target.id, newPosition: String(newPos) }] });
    assertNoUserErrors(data?.productReorderMedia, 'productReorderMedia');
    // The reorder runs as a job; wait briefly so the next read / move sees it.
    const job = data?.productReorderMedia?.job;
    for (let i = 0; job?.id && !job.done && i < 20; i++) {
      await sleep(500);
      const j = await this.graphql(Q_JOB, { id: job.id });
      if (j?.job?.done) break;
    }
  }

  async updateProductImage(
    productId: string,
    imageId: string,
    updates: { alt?: string; position?: number }
  ): Promise<any> {
    const mediaGid = toGid('MediaImage', imageId);
    if (updates.alt !== undefined) {
      const data = await this.graphql(M_MEDIA_UPDATE, { productId: toGid('Product', productId), media: [{ id: mediaGid, alt: updates.alt }] });
      assertNoUserErrors(data?.productUpdateMedia, 'productUpdateMedia');
    }
    if (updates.position !== undefined && updates.position !== null) {
      await this.moveImage(productId, gidStr(mediaGid), Number(updates.position));
    }
    const images = await this.getProductImages(productId);
    return images.find((im) => String(im.id) === gidStr(mediaGid)) ?? null;
  }

  async deleteProductImage(productId: string, imageId: string): Promise<void> {
    const data = await this.graphql(M_MEDIA_DELETE, { productId: toGid('Product', productId), mediaIds: [toGid('MediaImage', imageId)] });
    assertNoUserErrors(data?.productDeleteMedia, 'productDeleteMedia');
  }

  // ─── Product Variants ─────────────────────────────────────────

  async createProductVariant(
    productId: string,
    variant: {
      option1?: string;
      option2?: string;
      option3?: string;
      price?: string;
      compare_at_price?: string;
      sku?: string;
      inventory_quantity?: number;
      weight?: number;
      weight_unit?: string;
    }
  ): Promise<any> {
    const pGid = toGid('Product', productId);
    const ctx = await this.graphql(Q_PRODUCT_OPTIONS, { id: pGid });
    if (!ctx?.product) throw new ShopifyApiError(`Shopify API product ${productId} failed: 404 - Not Found`, 404);
    const optionNames: string[] = [...(ctx.product.options || [])].sort((a: any, b: any) => a.position - b.position).map((o: any) => o.name);
    const v = variant as Record<string, any>;
    const input: Record<string, unknown> = { ...variantFieldsFromRest(v) };
    const optionValues = optionValuesFromRest(v, optionNames);
    if (optionValues) input.optionValues = optionValues;
    if (v.inventory_quantity !== undefined && v.inventory_quantity !== null) {
      const loc = await this.primaryLocation();
      if (loc) input.inventoryQuantities = [{ locationId: loc, availableQuantity: Math.trunc(Number(v.inventory_quantity) || 0) }];
    }
    const data = await this.graphql(M_VARIANTS_CREATE, { productId: pGid, variants: [input] });
    assertNoUserErrors(data?.productVariantsBulkCreate, 'productVariantsBulkCreate');
    const created = data?.productVariantsBulkCreate?.productVariants?.[0];
    return created ? restVariant(created, Number(gidStr(productId)) || null, optionNames) : null;
  }

  /** Update one variant from REST-shaped fields (price, compare_at_price, sku, weight, weight_unit, …). */
  async updateProductVariant(variantId: string, updates: Record<string, unknown>): Promise<any> {
    const ctx = await this.graphql(Q_VARIANT_CONTEXT, { id: toGid('ProductVariant', variantId) });
    const pv = ctx?.productVariant;
    if (!pv?.product?.id) throw new ShopifyApiError(`Shopify API variant ${variantId} failed: 404 - Not Found`, 404);
    const optionNames: string[] = [...(pv.product.options || [])].sort((a: any, b: any) => a.position - b.position).map((o: any) => o.name);
    const u = updates as Record<string, any>;
    const input: Record<string, unknown> = { id: pv.id, ...variantFieldsFromRest(u, pv.inventoryItem?.measurement?.weight ?? null) };
    const optionValues = optionValuesFromRest(u, optionNames);
    if (optionValues) input.optionValues = optionValues;
    const data = await this.graphql(M_VARIANTS_UPDATE, { productId: pv.product.id, variants: [input] });
    assertNoUserErrors(data?.productVariantsBulkUpdate, 'productVariantsBulkUpdate');
    const updated = data?.productVariantsBulkUpdate?.productVariants?.[0];
    return updated ? restVariant(updated, gidNum(pv.product.id), optionNames) : null;
  }

  async deleteProductVariant(productId: string, variantId: string): Promise<void> {
    const data = await this.graphql(M_VARIANTS_DELETE, { productId: toGid('Product', productId), variantsIds: [toGid('ProductVariant', variantId)] });
    assertNoUserErrors(data?.productVariantsBulkDelete, 'productVariantsBulkDelete');
  }

  // ─── Inventory ────────────────────────────────────────────────

  /** All locations (active and inactive), REST-shaped (`active` flag). */
  async getLocations(): Promise<any[]> {
    const nodes = await this.paginate<any>(async (after) => {
      const data = await this.graphql(Q_LOCATIONS, { after });
      return data?.locations;
    });
    return nodes.map(restLocation);
  }

  /** Inventory levels of the given inventory items, grouped by numeric inventory_item_id. */
  async getInventoryLevelsForItems(inventoryItemIds: string[]): Promise<Map<string, InventoryLevelLite[]>> {
    const byItem = new Map<string, InventoryLevelLite[]>();
    const unique = Array.from(new Set(inventoryItemIds.map((id) => gidStr(id)).filter(Boolean)));
    const toLevel = (n: any): InventoryLevelLite => {
      const q = (Array.isArray(n?.quantities) ? n.quantities : []).find((x: any) => x?.name === 'available');
      return { location_id: gidNum(n?.location?.id) as number, available: typeof q?.quantity === 'number' ? q.quantity : null };
    };
    for (let i = 0; i < unique.length; i += 25) {
      const ids = unique.slice(i, i + 25).map((id) => toGid('InventoryItem', id));
      const data = await this.graphql(Q_ITEM_LEVELS, { ids });
      for (const item of Array.isArray(data?.nodes) ? data.nodes : []) {
        if (!item?.id) continue;
        const levels = nodesOf(item.inventoryLevels).map(toLevel);
        if (item.inventoryLevels?.pageInfo?.hasNextPage) {
          const more = await this.paginate<any>(async (after) => {
            const d = await this.graphql(Q_ITEM_LEVELS_PAGE, { id: item.id, after: after ?? item.inventoryLevels.pageInfo.endCursor });
            return d?.inventoryItem?.inventoryLevels;
          });
          levels.push(...more.map(toLevel));
        }
        byItem.set(gidStr(item.id), levels);
      }
    }
    return byItem;
  }

  /**
   * Set the `available` quantity of an item at a location (no compare-and-set, like the REST
   * `inventory_levels/set`). The item must already be stocked at that location.
   */
  async setInventoryLevel(inventoryItemId: string, locationId: string, available: number): Promise<any> {
    const data = await this.graphql(M_INVENTORY_SET, {
      key: randomUUID(),
      input: {
        name: 'available',
        reason: 'correction',
        quantities: [{
          inventoryItemId: toGid('InventoryItem', inventoryItemId),
          locationId: toGid('Location', locationId),
          quantity: Math.trunc(Number(available)),
          changeFromQuantity: null,
        }],
      },
    });
    assertNoUserErrors(data?.inventorySetQuantities, 'inventorySetQuantities');
    return {
      inventory_item_id: gidNum(inventoryItemId),
      location_id: gidNum(locationId),
      available: Math.trunc(Number(available)),
      updated_at: new Date().toISOString(),
    };
  }

  // ─── Collections ──────────────────────────────────────────────

  /** Custom collections first, then smart ones (REST order), REST-shaped. */
  async getCollections(): Promise<any[]> {
    const nodes = await this.paginate<any>(async (after) => {
      const data = await this.graphql(Q_COLLECTIONS, { after });
      return data?.collections;
    });
    const mapped = nodes.map((c) => ({
      id: gidNum(c.id),
      handle: c.handle ?? null,
      title: c.title ?? '',
      body_html: c.descriptionHtml ?? null,
      updated_at: c.updatedAt ?? null,
      sort_order: typeof c.sortOrder === 'string' ? c.sortOrder.toLowerCase().replace(/_/g, '-') : null,
      template_suffix: c.templateSuffix ?? null,
      image: c.image?.url ? { src: c.image.url, alt: c.image.altText ?? null } : null,
      collection_type: c.ruleSet ? 'smart' : 'custom',
      ...(c.ruleSet ? { disjunctive: Boolean(c.ruleSet.appliedDisjunctively) } : {}),
      admin_graphql_api_id: c.id,
    }));
    return [...mapped.filter((c) => c.collection_type === 'custom'), ...mapped.filter((c) => c.collection_type === 'smart')];
  }
}
