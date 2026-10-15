// lib/listings/adapters/etsy.ts — EtsyListing cache → ListingRow (listings-grid §3, §4, §9.1). DB only.
import { decodeEntities, decodeEntityList } from '@/lib/text/decodeEntities';
import { listingStatus } from '@/lib/ds/status';
import type { ListingStatusKey } from '../types';
import {
  ListingsQueryError,
  csvValues,
  health,
  rangeWhere,
  roundMoney,
  toNumber,
  type DbRow,
  type DraftOverlay,
  type ListingsAdapter,
  type SchemaCaps,
  type Where,
} from '../query';

/** Raw Etsy `state` values that map to each key (lib/ds/status/listings.ts ETSY map; unknown → inactive). */
const KNOWN_STATES = ['active', 'draft', 'expired', 'sold_out', 'soldout'];

const INT64_MAX = BigInt('9223372036854775807');

/** Etsy listing id → Postgres bigint; undefined for non-numeric or > int64 (a pasted barcode must match nothing, not 500). */
export function bigId(id: string): bigint | undefined {
  if (!/^\d{1,19}$/.test(id)) return undefined;
  const n = BigInt(id);
  return n > INT64_MAX ? undefined : n;
}

function tsIso(ts: unknown): string | null {
  const n = toNumber(ts);
  return n && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/** Etsy draft patch → overlay (fieldPatch keys: title, price (major units), quantity, tags, …). */
export function etsyDraftOverlay(d: DbRow): DraftOverlay {
  const fp = d.fieldPatch && typeof d.fieldPatch === 'object' ? (d.fieldPatch as Record<string, unknown>) : {};
  const changed = new Set<string>(Object.keys(fp));
  if (d.taxonomyPatch) changed.add('taxonomy');
  if (d.inventoryPatch) changed.add('variations');
  if (d.variationImagesPatch) changed.add('variationImages');
  if (d.personalizationPatch) changed.add('personalization');
  const draft: DraftOverlay['draft'] = {};
  const price = toNumber(typeof fp.price === 'string' ? fp.price.replace(',', '.') : fp.price);
  if (price !== null) draft.price = price;
  const qty = toNumber(fp.quantity);
  if (qty !== null) draft.qty = Math.trunc(qty);
  if (typeof fp.title === 'string') draft.title = decodeEntities(fp.title);
  return { changedFields: Array.from(changed), draft };
}

/**
 * A listing's SKUs, de-duplicated in order: the offerings cache (`EtsyListingOffering.sku`, selected as `offerings`)
 * first, then the planned `EtsyListing.skus` column when a build has it. EtsyListing itself has no SKU column today.
 */
export function etsySkus(r: DbRow, caps: SchemaCaps): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  };
  if (caps.offeringSkus && Array.isArray(r.offerings)) for (const o of r.offerings) add(o && typeof o === 'object' ? (o as { sku?: unknown }).sku : null);
  if (caps.skus && Array.isArray(r.skus)) for (const s of r.skus) add(s);
  return out;
}

export const etsyAdapter: ListingsAdapter = {
  marketplace: 'etsy',
  model: 'EtsyListing',
  delegateKey: 'etsyListing',
  idField: 'etsyListingId',
  toDbId: bigId,
  statusKeys: ['active', 'draft', 'inactive', 'expired', 'sold_out'],

  async resolveStore(db, userId, store) {
    const shops: DbRow[] = await db.etsyShop.findMany({
      where: { userId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { shopId: true, shopName: true, lastListingSyncAt: true },
    });
    if (!shops.length) return null;
    const shop = store ? shops.find((s) => s.shopId === store) : shops[0];
    if (!shop) throw new ListingsQueryError('store_not_found', 404);
    const sample = await db.etsyListing.findFirst({ where: { etsyShopId: shop.shopId }, select: { priceCurrencyCode: true } });
    const nameOf = (s: DbRow) => (s.shopName ? decodeEntities(String(s.shopName)) : String(s.shopId));
    return {
      userId,
      store: {
        id: String(shop.shopId),
        name: nameOf(shop),
        currency: sample?.priceCurrencyCode || 'USD',
        lastPulledAt: shop.lastListingSyncAt ? new Date(shop.lastListingSyncAt).toISOString() : null,
      },
      stores: shops.map((s) => ({ id: String(s.shopId), name: nameOf(s) })),
      storeWhere: { etsyShopId: String(shop.shopId) },
      meta: {},
    };
  },

  statusWhere(key: ListingStatusKey): Where | null {
    switch (key) {
      case 'active':
      case 'draft':
      case 'expired':
        return { state: key };
      case 'sold_out':
        return { state: { in: ['sold_out', 'soldout'] } };
      case 'inactive':
        return { state: { notIn: KNOWN_STATES } };
      default:
        return null;
    }
  },

  searchWhere(q: string, caps: SchemaCaps): Where {
    const or: Where[] = [{ title: { contains: q, mode: 'insensitive' } }];
    const id = bigId(q);
    if (id !== undefined) or.push({ etsyListingId: id });
    if (caps.skus) or.push({ skus: { has: q } });
    // Partial, case-insensitive SKU match (ILIKE '%q%' on EtsyListingOffering.sku). Not index-backed: the
    // (etsyShopId, skuNormalized) index does not cover it; scoped to the shop's offerings by the listing join.
    if (caps.offeringSkus) or.push({ offerings: { some: { sku: { contains: q, mode: 'insensitive' } } } });
    return { OR: or };
  },

  filterWheres(q) {
    const out: Where[] = [];
    if (q.section) {
      const vals = csvValues(q.section);
      const ids = vals.map(bigId).filter((v): v is bigint => v !== undefined);
      const or: Where[] = [];
      if (ids.length) or.push({ shopSectionId: { in: ids } });
      if (vals.includes('none')) or.push({ shopSectionId: null });
      out.push(or.length ? { OR: or } : { id: { in: [] } });
    }
    if (q.hasVideo !== undefined) out.push({ hasVideo: q.hasVideo });
    if (q.personalizable !== undefined) out.push({ isPersonalizable: q.personalizable });
    if (q.stock === 'in') out.push({ quantity: { gt: 0 } });
    if (q.stock === 'out') out.push({ quantity: { lte: 0 } });
    // Etsy stores minor units with a per-row divisor; every shop seen uses 100.
    const price = rangeWhere('priceAmount', q.priceMin, q.priceMax, 100);
    if (price) out.push(price);
    return out;
  },

  healthProxy(key) {
    if (key === 'missing_photos') return { imageCount: { lt: 5 } };
    if (key === 'no_video') return { hasVideo: false };
    if (key === 'missing_tags') return { tags: { isEmpty: true } };
    return null;
  },

  sortColumn(field, caps) {
    switch (field) {
      case 'updated':
        return { column: 'etsyUpdatedTimestamp', nullable: false };
      case 'created':
        return { column: 'etsyCreatedTimestamp', nullable: false };
      case 'title':
        return { column: 'title', nullable: false };
      case 'price':
        return { column: 'priceAmount', nullable: false };
      case 'qty':
        return { column: 'quantity', nullable: false };
      case 'views':
        return { column: 'views', nullable: false };
      case 'health':
        return caps.health ? { column: 'healthScore', nullable: true } : null;
      default:
        return null;
    }
  },

  select: {
    id: true,
    etsyListingId: true,
    title: true,
    priceAmount: true,
    priceDivisor: true,
    priceCurrencyCode: true,
    quantity: true,
    state: true,
    url: true,
    shopSectionId: true,
    views: true,
    numFavorers: true,
    isPersonalizable: true,
    thumbnailUrl75x75: true,
    thumbnailUrl170x135: true,
    thumbnailUrl570xN: true,
    imageCount: true,
    hasVideo: true,
    hasVariations: true,
    etsyCreatedTimestamp: true,
    etsyUpdatedTimestamp: true,
  },
  exportSelect: { tags: true, materials: true },

  toRow(r, _ctx, caps) {
    const id = String(r.etsyListingId);
    const skus = etsySkus(r, caps);
    const divisor = toNumber(r.priceDivisor) || 100;
    const amount = toNumber(r.priceAmount);
    const variations = !!r.hasVariations;
    return {
      id,
      title: decodeEntities(String(r.title ?? '')),
      metaLine: [`ID ${id}`, ...(skus[0] ? [skus[0]] : [])],
      thumbUrl: r.thumbnailUrl170x135 || r.thumbnailUrl75x75 || r.thumbnailUrl570xN || null,
      price: amount === null ? null : { amount: roundMoney(amount / divisor), currency: r.priceCurrencyCode || 'USD' },
      qty: toNumber(r.quantity),
      editable: variations ? { price: false, qty: false, reason: 'variations' } : { price: true, qty: true },
      status: listingStatus({ state: r.state }, 'etsy'),
      statusRaw: String(r.state ?? ''),
      health: health(r, caps),
      updatedAt: tsIso(r.etsyUpdatedTimestamp),
      createdAt: tsIso(r.etsyCreatedTimestamp),
      extra: {
        section: r.shopSectionId != null ? String(r.shopSectionId) : null,
        views: toNumber(r.views),
        favorites: toNumber(r.numFavorers),
        photos: toNumber(r.imageCount),
        hasVideo: !!r.hasVideo,
        personalizable: !!r.isPersonalizable,
        hasVariations: variations,
      },
      externalUrl: r.url || `https://www.etsy.com/listing/${id}`,
    };
  },

  exportFields(r, caps) {
    return {
      sku: etsySkus(r, caps)[0] ?? null,
      tags: decodeEntityList(r.tags),
      description: typeof r.description === 'string' ? decodeEntities(r.description) : null,
      materials: decodeEntityList(r.materials),
    };
  },
  exportExtras: ['section', 'views', 'favorites', 'materials'],

  drafts: {
    model: 'EtsyListingDraft',
    delegateKey: 'etsyListingDraft',
    idField: 'etsyListingId',
    where: (ctx) => ({ userId: ctx.userId, etsyShopId: ctx.store.id }),
    toDbId: bigId,
    overlay: etsyDraftOverlay,
    attemptsRelation: 'syncAttempts',
  },
};
