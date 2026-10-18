// lib/listings/adapters/hepsiburada.ts — HepsiburadaListing cache → ListingRow (listings-grid §3, §4, §9.1). DB only.
// Store = the Mağaza ID (merchantId) from Credential (one store per account). Row id = hbSku (what the inventory
// upload keys on). Staging goes through CatalogDraft (marketplace 'hepsiburada'): price, stock, dispatch time.
import { decodeEntities } from '@/lib/text/decodeEntities';
import { listingStatus } from '@/lib/ds/status';
import type { ListingStatusKey } from '../types';
import {
  ListingsQueryError,
  csvValues,
  health,
  rangeWhere,
  roundMoney,
  toNumber,
  type ListingsAdapter,
  type Where,
} from '../query';
import { catalogDraftOverlay } from './trendyol';

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

const id = (v: string): string | undefined => (v ? v : undefined);

/** Not suspended / locked / frozen: the precondition of active and sold out. */
const OPEN: Where = { isSuspended: false, isLocked: false, isFrozen: false };

/** Public product page (HB SKUs resolve through the search-by-sku redirect). */
export function hepsiburadaProductUrl(hbSku: string): string {
  return `https://www.hepsiburada.com/ara?q=${encodeURIComponent(hbSku)}`;
}

export const hepsiburadaAdapter: ListingsAdapter = {
  marketplace: 'hepsiburada',
  model: 'HepsiburadaListing',
  delegateKey: 'hepsiburadaListing',
  idField: 'hbSku',
  toDbId: id,
  statusKeys: ['active', 'sold_out', 'inactive'],

  async resolveStore(db, userId, store) {
    const cred = await db.credential.findUnique({ where: { userId }, select: { hepsiburadaMerchantId: true } });
    const merchantId: string | null = cred?.hepsiburadaMerchantId?.trim() || null;
    if (!merchantId) return null;
    if (store && store !== merchantId) throw new ListingsQueryError('store_not_found', 404);
    const agg = await db.hepsiburadaListing.aggregate({ where: { userId, merchantId }, _max: { syncedAt: true }, _count: { _all: true } });
    const last = agg?._max?.syncedAt;
    const name = 'Hepsiburada';
    return {
      userId,
      store: { id: merchantId, name, currency: 'TRY', lastPulledAt: (agg?._count?._all ?? 0) > 0 && last ? new Date(last).toISOString() : null },
      stores: [{ id: merchantId, name }],
      storeWhere: { userId, merchantId },
      meta: {},
    };
  },

  statusWhere(key: ListingStatusKey): Where | null {
    switch (key) {
      case 'inactive':
        return { OR: [{ isSuspended: true }, { isLocked: true }, { isFrozen: true }, { AND: [OPEN, { availableStock: { gt: 0 } }, { isSalable: false }] }] };
      case 'sold_out':
        return { AND: [OPEN, { availableStock: { lte: 0 } }] };
      case 'active':
        return { AND: [OPEN, { availableStock: { gt: 0 } }, { isSalable: true }] };
      default:
        return null;
    }
  },

  searchWhere(q) {
    return {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { hbSku: { contains: q, mode: 'insensitive' } },
        { merchantSku: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
      ],
    };
  },

  filterWheres(q) {
    const out: Where[] = [];
    if (q.category) {
      const ids = csvValues(q.category).map(Number).filter(Number.isInteger);
      out.push({ categoryId: { in: ids } });
    }
    if (q.brand) out.push({ brand: { in: csvValues(q.brand) } });
    if (q.stock === 'in') out.push({ availableStock: { gt: 0 } });
    if (q.stock === 'out') out.push({ availableStock: { lte: 0 } });
    const price = rangeWhere('price', q.priceMin, q.priceMax);
    if (price) out.push(price);
    return out;
  },

  healthProxy() {
    return null;
  },

  sortColumn(field) {
    switch (field) {
      case 'updated':
        return { column: 'syncedAt', nullable: false };
      case 'created':
        return { column: 'createdAt', nullable: false };
      case 'title':
        return { column: 'title', nullable: true };
      case 'price':
        return { column: 'price', nullable: true };
      case 'qty':
        return { column: 'availableStock', nullable: false };
      default:
        return null;
    }
  },

  select: {
    id: true,
    hbSku: true,
    merchantSku: true,
    barcode: true,
    title: true,
    brand: true,
    categoryId: true,
    categoryName: true,
    price: true,
    availableStock: true,
    dispatchTime: true,
    thumbnailUrl: true,
    images: true,
    isSalable: true,
    isSuspended: true,
    isLocked: true,
    isFrozen: true,
    isFulfilledByHB: true,
    deactivationReasons: true,
    syncedAt: true,
    createdAt: true,
  },
  exportSelect: {},

  toRow(r, _ctx, caps) {
    const price = toNumber(r.price);
    const status = listingStatus(r, 'hepsiburada');
    const reasons = Array.isArray(r.deactivationReasons) ? r.deactivationReasons.filter((x: unknown) => typeof x === 'string' && x) : [];
    const photos = Array.isArray(r.images) ? r.images.length : 0;
    const hbSku = String(r.hbSku);
    return {
      id: hbSku,
      title: decodeEntities(String(r.title || r.merchantSku || hbSku)),
      metaLine: [hbSku, ...(r.merchantSku && r.merchantSku !== hbSku ? [String(r.merchantSku)] : [])],
      thumbUrl: r.thumbnailUrl || null,
      price: price === null ? null : { amount: roundMoney(price), currency: 'TRY' },
      qty: toNumber(r.availableStock),
      // HB's own warehouse (Hepsiburada Lojistik) owns the stock of fulfilled-by-HB listings.
      editable: r.isFulfilledByHB ? { price: true, qty: false, reason: 'not_tracked' } : { price: true, qty: true },
      status,
      statusRaw: [r.isSuspended && 'suspended', r.isLocked && 'locked', r.isFrozen && 'frozen', r.isSalable ? 'salable' : 'notSalable', r.isFulfilledByHB && 'fulfilledByHB']
        .filter(Boolean)
        .join(','),
      ...(status === 'inactive' && reasons.length ? { statusNote: reasons.join(' · ') } : {}),
      health: health(r, caps),
      updatedAt: isoOrNull(r.syncedAt),
      createdAt: isoOrNull(r.createdAt),
      extra: {
        brand: r.brand ? decodeEntities(String(r.brand)) : null,
        category: r.categoryName ? decodeEntities(String(r.categoryName)) : null,
        categoryId: toNumber(r.categoryId),
        barcode: r.barcode ? String(r.barcode) : null,
        photos,
        dispatchTime: toNumber(r.dispatchTime),
      },
      externalUrl: hepsiburadaProductUrl(hbSku),
    };
  },

  exportFields(r) {
    return { sku: r.merchantSku ? String(r.merchantSku) : null, tags: [], description: null };
  },
  exportExtras: ['brand', 'category', 'barcode', 'dispatchTime'],

  drafts: {
    model: 'CatalogDraft',
    delegateKey: 'catalogDraft',
    idField: 'externalId',
    where: (ctx) => ({ userId: ctx.userId, marketplace: 'hepsiburada', storeId: ctx.store.id }),
    toDbId: id,
    overlay: catalogDraftOverlay,
    destructiveActions: [],
  },
};
