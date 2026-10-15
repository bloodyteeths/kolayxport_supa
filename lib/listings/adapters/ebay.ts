// lib/listings/adapters/ebay.ts — EbayListing cache → ListingRow (listings-grid §3, §4, §9.1). DB only.
// eBay keeps price as a string (`priceValue`), so price sort and price range run in memory (query.ts memoryPrice).
import { decodeEntities } from '@/lib/text/decodeEntities';
import { listingStatus } from '@/lib/ds/status';
import type { ListingStatusKey } from '../types';
import {
  ListingsQueryError,
  csvValues,
  health,
  ieq,
  roundMoney,
  toNumber,
  type DbRow,
  type DraftOverlay,
  type ListingsAdapter,
  type Where,
} from '../query';

/** The one eBay account has no store row; this id stands for it in `store` / `stores`. */
export const EBAY_STORE_ID = 'ebay';

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function sku(id: string): string | undefined {
  return id ? id : undefined;
}

/** eBay draft patch → overlay. Paths verified against components/ebay/ListingEditorDrawer.tsx (draft load). */
export function ebayDraftOverlay(d: DbRow): DraftOverlay {
  const inv = d.inventoryPatch && typeof d.inventoryPatch === 'object' ? (d.inventoryPatch as Record<string, any>) : {};
  const ofr = d.offerPatch && typeof d.offerPatch === 'object' ? (d.offerPatch as Record<string, any>) : {};
  const changed = new Set<string>();
  const product = inv.product && typeof inv.product === 'object' ? inv.product : {};
  for (const k of Object.keys(product)) changed.add(k === 'imageUrls' ? 'images' : k);
  if (inv.condition !== undefined || inv.conditionDescription !== undefined) changed.add('condition');
  if (inv.availability !== undefined) changed.add('quantity');
  if (inv.packageWeightAndSize !== undefined) changed.add('package');
  if (ofr.pricingSummary !== undefined) changed.add('price');
  if (ofr.categoryId !== undefined) changed.add('category');
  if (ofr.listingPolicies !== undefined) changed.add('policies');
  if (ofr.listingDescription !== undefined) changed.add('description');
  if (d.variationPatch) changed.add('variations');
  const draft: DraftOverlay['draft'] = {};
  const price = toNumber(ofr.pricingSummary?.price?.value);
  if (price !== null) draft.price = price;
  const qty = toNumber(inv.availability?.shipToLocationAvailability?.quantity);
  if (qty !== null) draft.qty = Math.trunc(qty);
  if (typeof product.title === 'string') draft.title = decodeEntities(product.title);
  return { changedFields: Array.from(changed), draft };
}

function priceOf(r: DbRow): number | null {
  return toNumber(r.priceValue);
}

export const ebayAdapter: ListingsAdapter = {
  marketplace: 'ebay',
  model: 'EbayListing',
  delegateKey: 'ebayListing',
  idField: 'sku',
  toDbId: sku,
  statusKeys: ['active', 'sold_out', 'inactive', 'draft'],

  async resolveStore(db, userId, store) {
    if (store && store !== EBAY_STORE_ID) throw new ListingsQueryError('store_not_found', 404);
    const [cred, agg, sample] = await Promise.all([
      db.credential.findUnique({ where: { userId }, select: { ebayAccessToken: true, ebayRefreshToken: true } }),
      db.ebayListing.aggregate({ where: { userId }, _max: { syncedAt: true }, _count: { _all: true } }),
      db.ebayListing.findFirst({ where: { userId }, select: { priceCurrency: true } }),
    ]);
    const hasToken = !!(cred?.ebayAccessToken || cred?.ebayRefreshToken);
    const count = agg?._count?._all ?? 0;
    if (!hasToken && count === 0) return null;
    const last = agg?._max?.syncedAt;
    return {
      userId,
      store: { id: EBAY_STORE_ID, name: 'eBay', currency: sample?.priceCurrency || 'USD', lastPulledAt: count > 0 && last ? new Date(last).toISOString() : null },
      stores: [{ id: EBAY_STORE_ID, name: 'eBay' }],
      storeWhere: { userId },
      meta: {},
    };
  },

  statusWhere(key: ListingStatusKey): Where | null {
    const published = ieq('status', 'PUBLISHED');
    switch (key) {
      case 'active':
        return { AND: [published, { quantity: { gt: 0 } }] };
      case 'sold_out':
        return { AND: [published, { quantity: { lte: 0 } }] };
      case 'inactive':
        return ieq('status', 'ENDED');
      case 'draft':
        return { NOT: [published, ieq('status', 'ENDED')] };
      default:
        return null;
    }
  },

  searchWhere(q) {
    return { OR: [{ title: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { listingId: q }] };
  },

  filterWheres(q) {
    const out: Where[] = [];
    if (q.condition) out.push({ condition: { in: csvValues(q.condition) } });
    if (q.category) out.push({ categoryId: { in: csvValues(q.category) } });
    if (q.format) out.push({ format: { in: csvValues(q.format) } });
    if (q.stock === 'in') out.push({ quantity: { gt: 0 } });
    if (q.stock === 'out') out.push({ quantity: { lte: 0 } });
    return out; // price: memoryPrice
  },

  healthProxy(key) {
    return key === 'missing_photos' ? { imageCount: { lt: 5 } } : null;
  },

  sortColumn(field, caps) {
    switch (field) {
      case 'updated':
        return { column: 'ebayUpdatedAt', nullable: true }; // ISO string: lexicographic = chronological
      case 'created':
        return { column: 'ebayCreatedAt', nullable: true };
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

  memoryPrice: { select: { priceValue: true }, price: priceOf },

  select: {
    id: true,
    sku: true,
    listingId: true,
    title: true,
    priceValue: true,
    priceCurrency: true,
    quantity: true,
    condition: true,
    categoryId: true,
    categoryName: true,
    format: true,
    status: true,
    imageUrl: true,
    imageUrls: true,
    imageCount: true,
    listingUrl: true,
    ebayCreatedAt: true,
    ebayUpdatedAt: true,
  },
  exportSelect: {},

  toRow(r, _ctx, caps) {
    const price = priceOf(r);
    const firstImage = Array.isArray(r.imageUrls) ? r.imageUrls.find((u: unknown) => typeof u === 'string' && u) : null;
    return {
      id: String(r.sku),
      title: decodeEntities(String(r.title ?? '')),
      metaLine: [`SKU ${r.sku}`],
      thumbUrl: r.imageUrl || firstImage || null,
      price: price === null ? null : { amount: roundMoney(price), currency: r.priceCurrency || 'USD' },
      qty: toNumber(r.quantity),
      editable: { price: true, qty: true },
      status: listingStatus({ status: r.status, quantity: r.quantity }, 'ebay'),
      statusRaw: String(r.status ?? ''),
      health: health(r, caps),
      updatedAt: isoOrNull(r.ebayUpdatedAt),
      createdAt: isoOrNull(r.ebayCreatedAt),
      extra: {
        condition: r.condition ?? null,
        category: r.categoryName ? decodeEntities(String(r.categoryName)) : null,
        categoryId: r.categoryId ?? null,
        format: r.format ?? null,
        photos: toNumber(r.imageCount),
      },
      externalUrl: r.listingUrl || (r.listingId ? `https://www.ebay.com/itm/${r.listingId}` : null),
    };
  },

  exportFields(r) {
    return { sku: r.sku ? String(r.sku) : null, tags: [], description: typeof r.description === 'string' ? r.description : null };
  },
  exportExtras: ['condition', 'category', 'format'],

  drafts: {
    model: 'EbayListingDraft',
    delegateKey: 'ebayListingDraft',
    idField: 'sku',
    where: (ctx) => ({ userId: ctx.userId }),
    toDbId: sku,
    overlay: ebayDraftOverlay,
  },
};
