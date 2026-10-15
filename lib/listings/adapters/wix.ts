// lib/listings/adapters/wix.ts — WixProduct cache → ListingRow (listings-grid §3, §4, §9.1). DB only.
// Store = WixSite.id (`?site=` in the page URL, `store=` on the API).
import { decodeEntities } from '@/lib/text/decodeEntities';
import { listingStatus } from '@/lib/ds/status';
import type { ListingStatusKey } from '../types';
import {
  CATALOG_DESTRUCTIVE_ACTIONS,
  ListingsQueryError,
  csvValues,
  health,
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

function collectionIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];
}

function variantCount(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/** Tracked and at zero: `listingStatus` treats this as sold out. */
/**
 * Wix always returns `priceData.discountedPrice` (equal to `price` when there is no discount), so a product is only
 * discounted when discountPrice < price. The shown price (row, sort and price filter) is the effective one.
 */
export function shownPrice(r: DbRow): { price: number | null; shown: number | null; discounted: boolean } {
  const price = toNumber(r.price);
  const discount = toNumber(r.discountPrice);
  const discounted = discount !== null && price !== null && discount < price;
  return { price, shown: discounted ? discount : price ?? discount, discounted };
}

const TRACKED_ZERO: Where = { trackInventory: true, quantity: 0 };

export const wixAdapter: ListingsAdapter = {
  marketplace: 'wix',
  model: 'WixProduct',
  delegateKey: 'wixProduct',
  idField: 'wixProductId',
  toDbId: id,
  statusKeys: ['active', 'sold_out', 'inactive'],

  async resolveStore(db, userId, store) {
    const sites: DbRow[] = await db.wixSite.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, siteName: true, siteUrl: true, siteId: true },
    });
    if (!sites.length) return null;
    const site = store ? sites.find((s) => s.id === store) : sites[0];
    if (!site) throw new ListingsQueryError('store_not_found', 404);
    const [agg, sample] = await Promise.all([
      db.wixProduct.aggregate({ where: { userId, wixSiteId: site.id }, _max: { syncedAt: true }, _count: { _all: true } }),
      db.wixProduct.findFirst({ where: { userId, wixSiteId: site.id }, select: { currency: true } }),
    ]);
    const nameOf = (s: DbRow) => String(s.siteName || s.siteUrl || s.siteId);
    const last = agg?._max?.syncedAt;
    return {
      userId,
      store: { id: String(site.id), name: nameOf(site), currency: sample?.currency || 'USD', lastPulledAt: (agg?._count?._all ?? 0) > 0 && last ? new Date(last).toISOString() : null },
      stores: sites.map((s) => ({ id: String(s.id), name: nameOf(s) })),
      storeWhere: { userId, wixSiteId: String(site.id) },
      meta: { siteUrl: site.siteUrl ? String(site.siteUrl).replace(/\/+$/, '') : null },
    };
  },

  statusWhere(key: ListingStatusKey): Where | null {
    switch (key) {
      case 'inactive':
        return { visible: false };
      case 'sold_out':
        return { AND: [{ visible: true }, { OR: [{ inStock: false }, TRACKED_ZERO] }] };
      case 'active':
        return { AND: [{ visible: true }, { inStock: true }, { NOT: TRACKED_ZERO }] };
      default:
        return null;
    }
  },

  searchWhere(q) {
    return { OR: [{ title: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] };
  },

  filterWheres(q) {
    const out: Where[] = [];
    if (q.collection) {
      const ids = csvValues(q.collection);
      out.push({ OR: ids.map((c) => ({ collectionIds: { array_contains: [c] } })) });
    }
    if (q.visible !== undefined) out.push({ visible: q.visible });
    if (q.stock === 'in') out.push({ inStock: true, NOT: TRACKED_ZERO });
    if (q.stock === 'out') out.push({ OR: [{ inStock: false }, TRACKED_ZERO] });
    return out; // price: memoryPrice (the shown price is the effective one, see shownPrice)
  },

  healthProxy(key) {
    return key === 'missing_photos' ? { imageCount: { lt: 5 } } : null;
  },

  sortColumn(field, caps) {
    switch (field) {
      case 'updated':
        return { column: 'wixUpdatedDate', nullable: true };
      case 'created':
        return { column: 'wixCreatedDate', nullable: true };
      case 'title':
        return { column: 'title', nullable: false };
      case 'price':
        return 'memory';
      case 'qty':
        return { column: 'quantity', nullable: false };
      case 'health':
        return caps.health ? { column: 'healthScore', nullable: true } : null;
      default:
        return null;
    }
  },

  memoryPrice: { select: { price: true, discountPrice: true }, price: (r) => shownPrice(r).shown },

  select: {
    id: true,
    wixProductId: true,
    slug: true,
    sku: true,
    title: true,
    collectionIds: true,
    price: true,
    discountPrice: true,
    currency: true,
    trackInventory: true,
    inStock: true,
    quantity: true,
    thumbnailUrl: true,
    imageCount: true,
    variants: true,
    visible: true,
    ribbon: true,
    wixCreatedDate: true,
    wixUpdatedDate: true,
  },
  exportSelect: {},

  toRow(r, ctx, caps) {
    const { price, shown, discounted } = shownPrice(r);
    const variants = variantCount(r.variants);
    const tracked = r.trackInventory !== false;
    const cols = collectionIds(r.collectionIds);
    const editable: ReturnType<ListingsAdapter['toRow']>['editable'] =
      variants > 1 ? { price: false, qty: false, reason: 'variations' } : !tracked ? { price: true, qty: false, reason: 'not_tracked' } : { price: true, qty: true };
    const siteUrl = ctx.meta.siteUrl;
    return {
      id: String(r.wixProductId),
      title: decodeEntities(String(r.title ?? '')),
      metaLine: r.sku ? [String(r.sku)] : [],
      thumbUrl: r.thumbnailUrl || null,
      price: shown === null ? null : { amount: roundMoney(shown), currency: r.currency || ctx.store.currency },
      qty: tracked ? toNumber(r.quantity) : null,
      editable,
      status: listingStatus(r, 'wix'),
      statusRaw: [r.visible === false ? 'hidden' : 'visible', r.inStock === false ? 'outOfStock' : 'inStock'].join(','),
      health: health(r, caps),
      updatedAt: isoOrNull(r.wixUpdatedDate),
      createdAt: isoOrNull(r.wixCreatedDate),
      extra: {
        collection: cols[0] ?? null,
        collectionCount: cols.length,
        visible: r.visible !== false,
        ribbon: r.ribbon ?? null,
        variants,
        compareAt: discounted && price !== null ? roundMoney(price) : null,
        photos: toNumber(r.imageCount),
      },
      externalUrl: siteUrl && r.slug ? `${siteUrl}/product-page/${r.slug}` : null,
    };
  },

  exportFields(r) {
    return { sku: r.sku ? String(r.sku) : null, tags: [], description: typeof r.description === 'string' ? r.description : null };
  },
  exportExtras: ['collection', 'visible', 'ribbon', 'variants', 'compareAt'],

  drafts: {
    model: 'CatalogDraft',
    delegateKey: 'catalogDraft',
    idField: 'externalId',
    where: (ctx) => ({ userId: ctx.userId, marketplace: 'wix', storeId: ctx.store.id }),
    toDbId: id,
    overlay: catalogDraftOverlay,
    destructiveActions: CATALOG_DESTRUCTIVE_ACTIONS,
  },
};
