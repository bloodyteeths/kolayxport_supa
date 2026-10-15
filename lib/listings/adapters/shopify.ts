// lib/listings/adapters/shopify.ts — ShopifyProduct cache → ListingRow (listings-grid §3, §4, §9.1). DB only.
// Store = ShopifyShop.id. `status` is nullable and its case is not guaranteed, so every match is case-insensitive.
import { decodeEntities, decodeEntityList } from '@/lib/text/decodeEntities';
import { listingStatus } from '@/lib/ds/status';
import type { ListingStatusKey } from '../types';
import {
  CATALOG_DESTRUCTIVE_ACTIONS,
  ListingsQueryError,
  csvValues,
  health,
  ieq,
  notIeq,
  rangeWhere,
  roundMoney,
  toNumber,
  type DbRow,
  type ListingsAdapter,
  type Where,
} from '../query';
import { catalogDraftOverlay } from './trendyol';

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function id(v: string): string | undefined {
  return v ? v : undefined;
}

const TRACKED_ZERO: Where = { trackInventory: true, totalInventory: 0 };

/** First variant SKU (variants JSON from the Shopify sync). */
function firstSku(variants: unknown): string | null {
  if (!Array.isArray(variants)) return null;
  for (const v of variants) {
    const s = v && typeof v === 'object' ? (v as Record<string, unknown>).sku : null;
    if (typeof s === 'string' && s.trim()) return s.trim();
  }
  return null;
}

export const shopifyAdapter: ListingsAdapter = {
  marketplace: 'shopify',
  model: 'ShopifyProduct',
  delegateKey: 'shopifyProduct',
  idField: 'shopifyProductId',
  toDbId: id,
  statusKeys: ['active', 'draft', 'sold_out', 'inactive'],

  async resolveStore(db, userId, store) {
    // Same default as pages/api/shopify/products.ts: newest active shop.
    const shops: DbRow[] = await db.shopifyShop.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, shopName: true, shopDomain: true, lastProductSyncAt: true },
    });
    if (!shops.length) return null;
    const shop = store ? shops.find((s) => s.id === store) : shops[0];
    if (!shop) throw new ListingsQueryError('store_not_found', 404);
    const sample = await db.shopifyProduct.findFirst({ where: { userId, shopifyShopId: shop.id }, select: { currency: true } });
    const nameOf = (s: DbRow) => (s.shopName ? decodeEntities(String(s.shopName)) : String(s.shopDomain));
    return {
      userId,
      store: {
        id: String(shop.id),
        name: nameOf(shop),
        currency: sample?.currency || 'USD',
        lastPulledAt: shop.lastProductSyncAt ? new Date(shop.lastProductSyncAt).toISOString() : null,
      },
      stores: shops.map((s) => ({ id: String(s.id), name: nameOf(s) })),
      storeWhere: { userId, shopifyShopId: String(shop.id) },
      meta: { shopDomain: shop.shopDomain ? String(shop.shopDomain) : null },
    };
  },

  // Mirrors listingStatus('shopify'): archived → inactive; draft → draft; tracked at 0 → sold out;
  // active → active; anything else (null, unknown) → inactive.
  statusWhere(key: ListingStatusKey): Where | null {
    const notArchived = notIeq('status', 'archived', true);
    const notDraft = notIeq('status', 'draft', true);
    switch (key) {
      case 'draft':
        return ieq('status', 'draft');
      case 'sold_out':
        return { AND: [notArchived, notDraft, TRACKED_ZERO] };
      case 'active':
        return { AND: [ieq('status', 'active'), { NOT: TRACKED_ZERO }] };
      case 'inactive':
        return {
          OR: [ieq('status', 'archived'), { AND: [notArchived, notDraft, notIeq('status', 'active', true), { NOT: TRACKED_ZERO }] }],
        };
      default:
        return null;
    }
  },

  searchWhere(q) {
    return {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { handle: { contains: q, mode: 'insensitive' } },
        { vendor: { contains: q, mode: 'insensitive' } },
        { shopifyProductId: q },
      ],
    };
  },

  filterWheres(q) {
    const out: Where[] = [];
    if (q.productType) out.push({ productType: { in: csvValues(q.productType) } });
    if (q.vendor) out.push({ vendor: { in: csvValues(q.vendor) } });
    if (q.stock === 'in') out.push({ NOT: TRACKED_ZERO });
    if (q.stock === 'out') out.push(TRACKED_ZERO);
    const price = rangeWhere('price', q.priceMin, q.priceMax);
    if (price) out.push(price);
    return out;
  },

  healthProxy(key) {
    if (key === 'missing_photos') return { imageCount: { lt: 3 } };
    if (key === 'missing_tags') return { tags: { isEmpty: true } };
    return null;
  },

  sortColumn(field, caps) {
    switch (field) {
      case 'updated':
        return { column: 'shopifyUpdatedAt', nullable: true };
      case 'created':
        return { column: 'shopifyCreatedAt', nullable: true };
      case 'title':
        return { column: 'title', nullable: false };
      case 'price':
        return { column: 'price', nullable: true };
      case 'qty':
        return { column: 'totalInventory', nullable: false };
      case 'health':
        return caps.health ? { column: 'healthScore', nullable: true } : null;
      default:
        return null;
    }
  },

  select: {
    id: true,
    shopifyProductId: true,
    title: true,
    vendor: true,
    productType: true,
    status: true,
    handle: true,
    price: true,
    compareAtPrice: true,
    currency: true,
    trackInventory: true,
    totalInventory: true,
    thumbnailUrl: true,
    imageCount: true,
    variants: true,
    variantCount: true,
    shopifyCreatedAt: true,
    shopifyUpdatedAt: true,
  },
  exportSelect: { tags: true },

  toRow(r, ctx, caps) {
    const price = toNumber(r.price);
    const compare = toNumber(r.compareAtPrice);
    const variants = toNumber(r.variantCount) ?? 0;
    const tracked = r.trackInventory !== false;
    const editable: ReturnType<ListingsAdapter['toRow']>['editable'] =
      variants > 1 ? { price: false, qty: false, reason: 'variations' } : !tracked ? { price: true, qty: false, reason: 'not_tracked' } : { price: true, qty: true };
    const domain = ctx.meta.shopDomain;
    return {
      id: String(r.shopifyProductId),
      title: decodeEntities(String(r.title ?? '')),
      metaLine: r.handle ? [String(r.handle)] : [],
      thumbUrl: r.thumbnailUrl || null,
      price: price === null ? null : { amount: roundMoney(price), currency: r.currency || ctx.store.currency, ...(variants > 1 ? { from: true } : {}) },
      qty: tracked ? toNumber(r.totalInventory) : null,
      editable,
      status: listingStatus(r, 'shopify'),
      statusRaw: String(r.status ?? ''),
      health: health(r, caps),
      updatedAt: isoOrNull(r.shopifyUpdatedAt),
      createdAt: isoOrNull(r.shopifyCreatedAt),
      extra: {
        vendor: r.vendor ? decodeEntities(String(r.vendor)) : null,
        productType: r.productType ? decodeEntities(String(r.productType)) : null,
        variants,
        compareAt: compare === null ? null : roundMoney(compare),
        photos: toNumber(r.imageCount),
      },
      externalUrl: domain && r.handle ? `https://${domain}/products/${r.handle}` : null,
    };
  },

  exportFields(r) {
    return { sku: firstSku(r.variants), tags: decodeEntityList(r.tags), description: typeof r.description === 'string' ? r.description : null };
  },
  exportExtras: ['vendor', 'productType', 'variants', 'compareAt'],

  drafts: {
    model: 'CatalogDraft',
    delegateKey: 'catalogDraft',
    idField: 'externalId',
    where: (ctx) => ({ userId: ctx.userId, marketplace: 'shopify', storeId: ctx.store.id }),
    toDbId: id,
    overlay: catalogDraftOverlay,
    destructiveActions: CATALOG_DESTRUCTIVE_ACTIONS,
  },
};
