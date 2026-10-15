// lib/listings/adapters/trendyol.ts — TrendyolProduct cache → ListingRow (listings-grid §3, §4, §9.1). DB only.
// Store = the supplier id from Credential (one supplier per account today).
import { decodeEntities } from '@/lib/text/decodeEntities';
import { listingStatus } from '@/lib/ds/status';
import type { ListingStatusKey } from '../types';
import {
  CATALOG_DESTRUCTIVE_ACTIONS,
  ListingsQueryError,
  csvValues,
  health,
  rangeWhere,
  roundMoney,
  toNumber,
  type DbRow,
  type DraftOverlay,
  type ListingsAdapter,
  type Where,
} from '../query';

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function id(v: string): string | undefined {
  return v ? v : undefined;
}

/** `rejectReasons` (Trendyol JSON: strings or `{ reason | description | message }`) → one tooltip line. */
export function trendyolRejectNote(reasons: unknown): string | undefined {
  if (!Array.isArray(reasons)) return typeof reasons === 'string' && reasons ? reasons : undefined;
  const parts = reasons
    .map((r) => {
      if (typeof r === 'string') return r;
      if (r && typeof r === 'object') {
        const o = r as Record<string, unknown>;
        const v = o.reason ?? o.description ?? o.message ?? o.rejectReason;
        return typeof v === 'string' ? v : null;
      }
      return null;
    })
    .filter((s): s is string => !!s && !!s.trim());
  return parts.length ? parts.join(' · ') : undefined;
}

/** CatalogDraft patch → overlay (v1 keys: title, price, quantity, tags, visible, status, collectionIds). */
export function catalogDraftOverlay(d: DbRow): DraftOverlay {
  const fp = d.fieldPatch && typeof d.fieldPatch === 'object' ? (d.fieldPatch as Record<string, unknown>) : {};
  const draft: DraftOverlay['draft'] = {};
  const price = toNumber(fp.price);
  if (price !== null) draft.price = price;
  const qty = toNumber(fp.quantity);
  if (qty !== null) draft.qty = Math.trunc(qty);
  if (typeof fp.title === 'string') draft.title = decodeEntities(fp.title);
  return { changedFields: Object.keys(fp), draft };
}

/** Not rejected / blacklisted and approved: the precondition of every non-review key. */
const APPROVED: Where = { rejected: false, blacklisted: false, approved: true };

export const trendyolAdapter: ListingsAdapter = {
  marketplace: 'trendyol',
  model: 'TrendyolProduct',
  delegateKey: 'trendyolProduct',
  idField: 'barcode',
  toDbId: id,
  statusKeys: ['active', 'sold_out', 'inactive', 'in_review', 'rejected'],

  async resolveStore(db, userId, store) {
    const cred = await db.credential.findUnique({ where: { userId }, select: { trendyolSupplierId: true } });
    const supplierId: string | null = cred?.trendyolSupplierId || null;
    if (!supplierId) return null;
    if (store && store !== supplierId) throw new ListingsQueryError('store_not_found', 404);
    const agg = await db.trendyolProduct.aggregate({ where: { userId, supplierId }, _max: { syncedAt: true }, _count: { _all: true } });
    const last = agg?._max?.syncedAt;
    const name = `Trendyol ${supplierId}`;
    return {
      userId,
      store: { id: supplierId, name, currency: 'TRY', lastPulledAt: (agg?._count?._all ?? 0) > 0 && last ? new Date(last).toISOString() : null },
      stores: [{ id: supplierId, name }],
      storeWhere: { userId, supplierId },
      meta: {},
    };
  },

  statusWhere(key: ListingStatusKey): Where | null {
    switch (key) {
      case 'rejected':
        return { OR: [{ rejected: true }, { blacklisted: true }] };
      case 'in_review':
        return { rejected: false, blacklisted: false, approved: false };
      case 'inactive':
        return { AND: [APPROVED, { OR: [{ archived: true }, { onSale: false }] }] };
      case 'sold_out':
        return { AND: [APPROVED, { archived: false, onSale: true, quantity: 0 }] };
      case 'active':
        return { AND: [APPROVED, { archived: false, onSale: true, NOT: { quantity: 0 } }] };
      default:
        return null;
    }
  },

  searchWhere(q) {
    return {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
        { stockCode: { contains: q, mode: 'insensitive' } },
        { productMainId: { contains: q, mode: 'insensitive' } },
      ],
    };
  },

  filterWheres(q) {
    const out: Where[] = [];
    if (q.category) {
      const ids = csvValues(q.category).map(Number).filter(Number.isInteger);
      out.push({ categoryId: { in: ids } });
    }
    if (q.brand) out.push({ brandName: { in: csvValues(q.brand) } });
    if (q.approval === 'approved') out.push(APPROVED);
    if (q.approval === 'in_review') out.push({ rejected: false, blacklisted: false, approved: false });
    if (q.approval === 'rejected') out.push({ OR: [{ rejected: true }, { blacklisted: true }] });
    if (q.stock === 'in') out.push({ quantity: { gt: 0 } });
    if (q.stock === 'out') out.push({ quantity: { lte: 0 } });
    const price = rangeWhere('salePrice', q.priceMin, q.priceMax);
    if (price) out.push(price);
    return out;
  },

  healthProxy(key) {
    return key === 'missing_photos' ? { imageCount: { lt: 5 } } : null;
  },

  sortColumn(field, caps) {
    switch (field) {
      case 'updated':
        return { column: 'trendyolLastUpdate', nullable: true };
      case 'created':
        return { column: 'trendyolCreatedDate', nullable: true };
      case 'title':
        return { column: 'title', nullable: false };
      case 'price':
        return { column: 'salePrice', nullable: true };
      case 'qty':
        return { column: 'quantity', nullable: false };
      case 'health':
        return caps.health ? { column: 'healthScore', nullable: true } : null;
      default:
        return null;
    }
  },

  select: {
    id: true,
    barcode: true,
    stockCode: true,
    productMainId: true,
    title: true,
    brandName: true,
    categoryId: true,
    categoryName: true,
    listPrice: true,
    salePrice: true,
    currencyType: true,
    quantity: true,
    thumbnailUrl: true,
    imageCount: true,
    approved: true,
    onSale: true,
    rejected: true,
    blacklisted: true,
    archived: true,
    rejectReasons: true,
    trendyolCreatedDate: true,
    trendyolLastUpdate: true,
  },
  exportSelect: {},

  toRow(r, _ctx, caps) {
    const sale = toNumber(r.salePrice);
    const list = toNumber(r.listPrice);
    const status = listingStatus(r, 'trendyol');
    const note = status === 'rejected' ? trendyolRejectNote(r.rejectReasons) : undefined;
    return {
      id: String(r.barcode),
      title: decodeEntities(String(r.title ?? '')),
      metaLine: [String(r.barcode), ...(r.stockCode && r.stockCode !== r.barcode ? [String(r.stockCode)] : [])],
      thumbUrl: r.thumbnailUrl || null,
      price: sale === null ? null : { amount: roundMoney(sale), currency: r.currencyType || 'TRY' },
      qty: toNumber(r.quantity),
      editable: { price: true, qty: true },
      status,
      statusRaw: [r.rejected && 'rejected', r.blacklisted && 'blacklisted', !r.approved && 'unapproved', r.archived && 'archived', r.onSale ? 'onSale' : 'notOnSale']
        .filter(Boolean)
        .join(','),
      ...(note ? { statusNote: note } : {}),
      health: health(r, caps),
      updatedAt: isoOrNull(r.trendyolLastUpdate),
      createdAt: isoOrNull(r.trendyolCreatedDate),
      extra: {
        brand: r.brandName ? decodeEntities(String(r.brandName)) : null,
        category: r.categoryName ? decodeEntities(String(r.categoryName)) : null,
        categoryId: toNumber(r.categoryId),
        listPrice: list === null ? null : roundMoney(list),
        barcode: String(r.barcode),
        photos: toNumber(r.imageCount),
      },
      externalUrl: null,
    };
  },

  exportFields(r) {
    return { sku: r.stockCode ? String(r.stockCode) : null, tags: [], description: typeof r.description === 'string' ? r.description : null };
  },
  exportExtras: ['brand', 'category', 'listPrice', 'barcode'],

  drafts: {
    model: 'CatalogDraft',
    delegateKey: 'catalogDraft',
    idField: 'externalId',
    where: (ctx) => ({ userId: ctx.userId, marketplace: 'trendyol', storeId: ctx.store.id }),
    toDbId: id,
    overlay: catalogDraftOverlay,
    destructiveActions: CATALOG_DESTRUCTIVE_ACTIONS,
  },
};
