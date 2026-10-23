// lib/listings/types.ts — listings-grid §9.1 / §9.4 shared contract (M5 G0).
// One read API (`GET /api/listings`) for all five marketplaces; one staging interface on the client.
// Pure types + tiny pure helpers: no React, no Prisma, safe on the server and the client.
//
// Owners downstream: G1 (read API, adapters, export, duplicates) produces these shapes,
// G5/G6 (page, tools) consume them. Status keys come from M1-a's `lib/ds/status` (never redefined here).

import type { ListingMarketplace, ListingStatusKey, SyncStatusKey } from '@/lib/ds/status';

export type { ListingMarketplace, ListingStatusKey };

/** The five marketplaces in nav order. */
export const LISTING_MARKETPLACES = ['etsy', 'ebay', 'trendyol', 'wix', 'shopify', 'hepsiburada'] as const satisfies readonly ListingMarketplace[];

export function isListingMarketplace(v: unknown): v is ListingMarketplace {
  return typeof v === 'string' && (LISTING_MARKETPLACES as readonly string[]).includes(v);
}

/** Every `ListingStatusKey` (mirror of `STATUS_VOCABULARY.listing`), for query validation. */
export const LISTING_STATUS_KEYS = [
  'active',
  'draft',
  'inactive',
  'sold_out',
  'expired',
  'in_review',
  'rejected',
] as const satisfies readonly ListingStatusKey[];

// ─── Sync (staged changes) ──────────────────────────────────────────────────

/** The sync pill keys a listing row can carry (DS §3.9 sync domain, minus `refresh_failed`, which is pull-side). */
export type ListingSyncKey = Extract<SyncStatusKey, 'pending' | 'syncing' | 'sync_failed' | 'conflict' | 'synced'>;

export const LISTING_SYNC_KEYS = ['pending', 'syncing', 'sync_failed', 'conflict', 'synced'] as const satisfies readonly ListingSyncKey[];

/** Draft fields the grid overlays on the live values (§4 "Draft overlay"). */
export type ListingDraftOverlay = { price?: number; qty?: number; title?: string; /** Trendyol list price (major units). */ listPrice?: number };

export type ListingRowSync = {
  draftId: string;
  status: ListingSyncKey;
  /** Patch keys in the draft, normalised: `price`, `quantity`, `title`, `tags`, `description`, `images`, `variations`, … */
  changedFields: string[];
  /** Overlay values (major units for price). */
  draft: ListingDraftOverlay;
  /** i18n key from `draftErrorI18n` (seoRules.ts); raw error text never reaches the client. */
  errorKey?: string;
  errorParams?: Record<string, string | number>;
  /** `queuedActions` holds an uncompleted `delete` (or `archive` for CatalogDraft). Never part of "Send N". */
  queuedDelete: boolean;
  /** ISO. Null until BR-1a (`scheduledSendAt` columns) is deployed. */
  scheduledSendAt: string | null;
  /** ISO; set for `synced` (visible 24 h). */
  syncedAt: string | null;
};

// ─── Row ────────────────────────────────────────────────────────────────────

export type ListingMoney = { amount: number; currency: string; from?: boolean };

/**
 * Why an inline price/qty cell is read-only (`listings.cell.variationsReadOnly` / `listings.cell.notTracked` /
 * `listings.cell.stockManaged`).
 *
 * `stock_managed`: the listing's quantity is owned by stock sync (BUILD_PLAN §7 item 7, same rule as
 * VariationEditor's `useStockManaged`). Adapters (G1) set `editable.qty = false, reason: 'stock_managed'`
 * (price stays editable); a staged qty would fight the stock-sync source of truth. Server-side detection is BR-11.
 */
export type ListingEditableReason = 'variations' | 'not_tracked' | 'stock_managed';

/** i18n key for each read-only reason (`listings.cell.*`). */
export const LISTING_EDITABLE_REASON_I18N: Record<ListingEditableReason, string> = {
  variations: 'listings.cell.variationsReadOnly',
  not_tracked: 'listings.cell.notTracked',
  stock_managed: 'listings.cell.stockManaged',
};

export type ListingHealth = {
  /** 0–100; null = never scored ("Not scored yet"). */
  score: number | null;
  /** Checks that counted / all listing checks (ScoreResult.checksUsed / checksTotal). 0/0 when unscored. */
  used: number;
  total: number;
  /** Failed check ids (`healthFails`). */
  fails: string[];
};

/** Per-marketplace extra cell values, keyed by `ListingColumnKey` (section, condition, brand, variants, views, …). */
export type ListingExtra = Partial<Record<ListingColumnKey, string | number | boolean | null>> &
  Record<string, string | number | boolean | null>;

export type ListingRow = {
  /** Marketplace id used everywhere: Etsy listing_id, eBay sku, Trendyol barcode, Wix wixProductId, Shopify shopifyProductId. */
  id: string;
  /** Entity-decoded at the adapter (DS P5). */
  title: string;
  /** e.g. ["ID 1490012234", "BB-PINK"]; rendered mono, joined with " · ". */
  metaLine: string[];
  thumbUrl: string | null;
  /** Major units. Null = no price known. */
  price: ListingMoney | null;
  /** Null = not tracked. */
  qty: number | null;
  editable: { price: boolean; qty: boolean; reason?: ListingEditableReason };
  status: ListingStatusKey;
  statusRaw: string;
  /** Trendyol reject reason (pill tooltip). */
  statusNote?: string;
  health: ListingHealth;
  /** ISO. */
  updatedAt: string | null;
  createdAt: string | null;
  extra: ListingExtra;
  externalUrl: string | null;
  sync: ListingRowSync | null;
};

// ─── Response ───────────────────────────────────────────────────────────────

/**
 * Listings per draft state (one draft per listing). `pending`, `syncing`, `failed` and `conflict` are disjoint.
 * `queuedDeletes` is NOT a fifth bucket: it is the subset of `pending + failed` whose draft has a queued
 * `delete` (conflict and syncing drafts are never counted in it, so it never overlaps `conflict`).
 * Use `sendableCount()` for the number "Send N" actually sends.
 */
export type ListingsSyncCounts = {
  pending: number;
  syncing: number;
  failed: number;
  conflict: number;
  /** Subset of `pending + failed` with a queued `delete` (excluded from "Send N", sent only via "Send deletion…"). */
  queuedDeletes: number;
};

export type ListingsCounts = {
  all: number;
  status: Partial<Record<ListingStatusKey, number>>;
  sync: ListingsSyncCounts;
  /** health < 50, scored rows only. */
  needsWork: number;
  /** healthScore null. */
  unscored: number;
};

export type ListingsStore = {
  id: string;
  name: string;
  currency: string;
  /** ISO of the last successful pull; null = connected, never pulled. */
  lastPulledAt: string | null;
};

export type ListingsResponse = {
  rows: ListingRow[];
  /** After filters. */
  total: number;
  counts: ListingsCounts;
  store: ListingsStore;
  /** For the breadcrumb switcher. */
  stores: { id: string; name: string }[];
};

/** Error body of every `/api/listings*` endpoint (non-2xx). */
export type ListingsErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_connected'
  | 'store_not_found'
  | 'server_error';

export type ListingsErrorBody = { error: ListingsErrorCode; message?: string; errorId?: string };

// ─── Columns, views, sort, filters ──────────────────────────────────────────

/** Master column list (§4). Config picks and orders. */
export const LISTING_COLUMN_KEYS = [
  'select',
  'thumb',
  'listing',
  'price',
  'qty',
  'status',
  'changes',
  'health',
  'updated',
  'section',
  'condition',
  'category',
  'format',
  'brand',
  'listPrice',
  'collection',
  'visible',
  'variants',
  'vendor',
  'productType',
  'compareAt',
  'views',
  'favorites',
  'created',
  'barcode',
  'ribbon',
  'actions',
] as const;

export type ListingColumnKey = (typeof LISTING_COLUMN_KEYS)[number];

/** Built-in saved views (§5), same keys on every marketplace. */
export const BUILT_IN_VIEW_KEYS = [
  'all',
  'active',
  'not_sent',
  'send_failed',
  'needs_work',
  'sold_out',
  'inactive',
  'review',
] as const;

export type BuiltInViewKey = (typeof BUILT_IN_VIEW_KEYS)[number];

export function isBuiltInViewKey(v: unknown): v is BuiltInViewKey {
  return typeof v === 'string' && (BUILT_IN_VIEW_KEYS as readonly string[]).includes(v);
}

export const LISTING_SORT_FIELDS = ['updated', 'title', 'price', 'qty', 'health', 'views', 'created'] as const;
export type ListingSortField = (typeof LISTING_SORT_FIELDS)[number];
export type ListingSortDir = 'asc' | 'desc';
/** Wire format: `"<field>.<dir>"`, e.g. `updated.desc`. */
export type ListingSortKey = `${ListingSortField}.${ListingSortDir}`;
export const DEFAULT_LISTING_SORT: ListingSortKey = 'updated.desc';

export const LISTING_PAGE_SIZES = [50, 100, 250] as const;
export type ListingPageSize = (typeof LISTING_PAGE_SIZES)[number];
export const DEFAULT_LISTING_PAGE_SIZE: ListingPageSize = 50;

/** `health` filter values (§5). Bands read `healthScore`, check-based ones read `healthFails`. */
export const HEALTH_FILTER_KEYS = [
  'lt50',
  '50-74',
  '75-89',
  'gte90',
  'missing_photos',
  'missing_tags',
  'no_video',
  'short_title',
] as const;
export type HealthFilterKey = (typeof HEALTH_FILTER_KEYS)[number];

export type PhotosFilterKey = 'lt5' | '5-9' | 'gte10';
export type StockFilterKey = 'in' | 'out';
/** Trendyol "Approval" sheet filter. */
export type ApprovalFilterKey = 'approved' | 'in_review' | 'rejected';

/** Marketplace-specific filter params of `GET /api/listings` (§9.1). Unknown params are ignored by the API. */
export type ListingsMarketplaceFilters = {
  section?: string; // Etsy shopSectionId
  condition?: string; // eBay
  category?: string; // eBay, Trendyol
  brand?: string; // Trendyol
  collection?: string; // Wix collection id
  productType?: string; // Shopify
  vendor?: string; // Shopify
  format?: string; // eBay
  hasVideo?: boolean; // Etsy
  personalizable?: boolean; // Etsy
  visible?: boolean; // Wix
  photos?: PhotosFilterKey;
  stock?: StockFilterKey;
  priceMin?: number;
  priceMax?: number;
  approval?: ApprovalFilterKey; // Trendyol
};

export type ListingsMarketplaceFilterKey = keyof ListingsMarketplaceFilters;

/** Parsed query of `GET /api/listings` (and `/export`, which takes the same filters without page/size). */
export type ListingsQuery = ListingsMarketplaceFilters & {
  marketplace: ListingMarketplace;
  /** shopId / WixSite.id / ShopifyShop.id; omitted = first store. */
  store?: string;
  q?: string;
  status?: ListingStatusKey[];
  sync?: ListingSyncKey[];
  health?: HealthFilterKey;
  sort: ListingSortKey;
  /** 1-based. */
  page: number;
  size: ListingPageSize;
};

/** Saved-view query (§5 "Query" column). `send_failed` = sync failed or conflict. */
export const BUILT_IN_VIEW_QUERY: Record<BuiltInViewKey, Partial<Pick<ListingsQuery, 'status' | 'sync' | 'health'>>> = {
  all: {},
  active: { status: ['active'] },
  not_sent: { sync: ['pending'] },
  send_failed: { sync: ['sync_failed', 'conflict'] },
  needs_work: { health: 'lt50' },
  sold_out: { status: ['sold_out'] },
  inactive: { status: ['inactive', 'draft', 'expired'] },
  review: { status: ['in_review', 'rejected'] },
};

/** Count shown next to a built-in view (§5 "Count source"). */
export function builtInViewCount(view: BuiltInViewKey, counts: ListingsCounts): number {
  const s = counts.status;
  switch (view) {
    case 'all':
      return counts.all;
    case 'active':
      return s.active ?? 0;
    case 'not_sent':
      return counts.sync.pending;
    case 'send_failed':
      return counts.sync.failed + counts.sync.conflict;
    case 'needs_work':
      return counts.needsWork;
    case 'sold_out':
      return s.sold_out ?? 0;
    case 'inactive':
      return (s.inactive ?? 0) + (s.draft ?? 0) + (s.expired ?? 0);
    case 'review':
      return (s.in_review ?? 0) + (s.rejected ?? 0);
    default:
      return 0;
  }
}

/** Default view: `active` on Etsy (today's default), `all` elsewhere. */
export function defaultViewFor(marketplace: ListingMarketplace): BuiltInViewKey {
  return marketplace === 'etsy' ? 'active' : 'all';
}

// ─── Query parsing (API wire format only) ────────────────────────────────────
// `parseListingsQuery` / `toListingsSearchParams` speak the `GET /api/listings` format (`store`, bare filter keys).
// They are NOT the page URL format (§5: `?shop=`/`?site=` via `config.storeParam`, `f.<key>=`, `view`, `open`,
// `tool`); the page maps its URL state to a `ListingsQuery` itself (useListings) before calling these.

type RawQuery = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = typeof s === 'string' ? s.trim() : '';
  return t === '' ? undefined : t;
}

function csv<T extends string>(v: string | string[] | undefined, allowed: readonly T[]): T[] | undefined {
  const parts = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
  const unique = Array.from(new Set(parts));
  return unique.length ? unique : undefined;
}

function oneOf<T extends string>(v: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const s = first(v);
  return s !== undefined && (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
}

function bool(v: string | string[] | undefined): boolean | undefined {
  const s = first(v);
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
}

function num(v: string | string[] | undefined): number | undefined {
  const s = first(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function isListingSortKey(v: unknown): v is ListingSortKey {
  if (typeof v !== 'string') return false;
  const [field, dir, ...rest] = v.split('.');
  return rest.length === 0 && (LISTING_SORT_FIELDS as readonly string[]).includes(field) && (dir === 'asc' || dir === 'desc');
}

export function splitSortKey(key: ListingSortKey): { field: ListingSortField; dir: ListingSortDir } {
  const [field, dir] = key.split('.') as [ListingSortField, ListingSortDir];
  return { field, dir };
}

const STRING_FILTERS = ['section', 'condition', 'category', 'brand', 'collection', 'productType', 'vendor', 'format'] as const;
const BOOL_FILTERS = ['hasVideo', 'personalizable', 'visible'] as const;

export type ParseListingsQueryResult = { ok: true; query: ListingsQuery } | { ok: false; error: 'bad_request'; message: string };

/**
 * Parses `req.query` (or URLSearchParams converted to a record). Lenient: invalid optional values are dropped,
 * page/size/sort fall back to defaults. Only a missing or unknown `marketplace` is an error.
 */
export function parseListingsQuery(raw: RawQuery): ParseListingsQueryResult {
  const marketplace = first(raw.marketplace);
  if (!isListingMarketplace(marketplace)) {
    return { ok: false, error: 'bad_request', message: 'marketplace must be one of etsy, ebay, trendyol, wix, shopify' };
  }
  const sortRaw = first(raw.sort);
  const pageRaw = Number(first(raw.page));
  const sizeRaw = Number(first(raw.size));
  const query: ListingsQuery = {
    marketplace,
    sort: isListingSortKey(sortRaw) ? sortRaw : DEFAULT_LISTING_SORT,
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    size: (LISTING_PAGE_SIZES as readonly number[]).includes(sizeRaw) ? (sizeRaw as ListingPageSize) : DEFAULT_LISTING_PAGE_SIZE,
  };
  const store = first(raw.store);
  if (store) query.store = store;
  const q = first(raw.q);
  if (q) query.q = q.slice(0, 200);
  const status = csv(raw.status, LISTING_STATUS_KEYS);
  if (status) query.status = status;
  const sync = csv(raw.sync, LISTING_SYNC_KEYS);
  if (sync) query.sync = sync;
  const health = oneOf(raw.health, HEALTH_FILTER_KEYS);
  if (health) query.health = health;
  for (const k of STRING_FILTERS) {
    const v = first(raw[k]);
    if (v) query[k] = v;
  }
  for (const k of BOOL_FILTERS) {
    const v = bool(raw[k]);
    if (v !== undefined) query[k] = v;
  }
  const photos = oneOf(raw.photos, ['lt5', '5-9', 'gte10'] as const);
  if (photos) query.photos = photos;
  const stock = oneOf(raw.stock, ['in', 'out'] as const);
  if (stock) query.stock = stock;
  const approval = oneOf(raw.approval, ['approved', 'in_review', 'rejected'] as const);
  if (approval) query.approval = approval;
  const priceMin = num(raw.priceMin);
  if (priceMin !== undefined) query.priceMin = priceMin;
  const priceMax = num(raw.priceMax);
  if (priceMax !== undefined) query.priceMax = priceMax;
  return { ok: true, query };
}

/**
 * Serialises a query for `fetch('/api/listings?' + …)`. Defaults (sort `updated.desc`, page 1, size 50) are
 * omitted so SWR keys stay short and stable; keys are emitted in a fixed order.
 */
export function toListingsSearchParams(query: Partial<ListingsQuery> & Pick<ListingsQuery, 'marketplace'>): URLSearchParams {
  const p = new URLSearchParams();
  p.set('marketplace', query.marketplace);
  if (query.store) p.set('store', query.store);
  if (query.q) p.set('q', query.q);
  if (query.status?.length) p.set('status', query.status.join(','));
  if (query.sync?.length) p.set('sync', query.sync.join(','));
  if (query.health) p.set('health', query.health);
  for (const k of STRING_FILTERS) {
    const v = query[k];
    if (v) p.set(k, v);
  }
  for (const k of BOOL_FILTERS) {
    const v = query[k];
    if (typeof v === 'boolean') p.set(k, String(v));
  }
  if (query.photos) p.set('photos', query.photos);
  if (query.stock) p.set('stock', query.stock);
  if (query.approval) p.set('approval', query.approval);
  if (typeof query.priceMin === 'number') p.set('priceMin', String(query.priceMin));
  if (typeof query.priceMax === 'number') p.set('priceMax', String(query.priceMax));
  if (query.sort && query.sort !== DEFAULT_LISTING_SORT) p.set('sort', query.sort);
  if (query.page && query.page !== 1) p.set('page', String(query.page));
  if (query.size && query.size !== DEFAULT_LISTING_PAGE_SIZE) p.set('size', String(query.size));
  return p;
}

/**
 * Listings with an unsent draft, excluding `syncing` (CRITIQUE C1): the "N changes not sent yet" status text.
 * NOT the number the "Send N" button sends; that is `sendableCount()`.
 */
export function unsentCount(counts: ListingsCounts): number {
  return counts.sync.pending + counts.sync.failed + counts.sync.conflict;
}

/**
 * What "Send N" sends (§6.2): `pending + failed`, minus queued deletes; conflicts are excluded by construction.
 * When `sendableCount < unsentCount`, the page confirms first (`listings.send.confirmExcluded` with
 * `conflicts = counts.sync.conflict`, `deletes = counts.sync.queuedDeletes`).
 */
export function sendableCount(counts: ListingsCounts): number {
  const s = counts.sync;
  return Math.max(0, s.pending + s.failed - s.queuedDeletes);
}

// ─── Duplicates + export (§9.4) ─────────────────────────────────────────────

export type DuplicateReason =
  | { kind: 'same_sku'; sku: string }
  | { kind: 'same_title' }
  /** Title Jaccard on content words ≥ 0.8; `similarity` is 0–100 (integer). */
  | { kind: 'similar_title'; similarity: number };

export type DuplicateGroup = { reason: DuplicateReason; ids: string[]; rows: ListingRow[] };

/** `GET /api/listings/duplicates?marketplace&store` — at most 200 groups. */
export type DuplicatesResponse = { groups: DuplicateGroup[]; truncated?: boolean };

/** `GET /api/listings/export` query: the list filters (no page/size) plus these. */
export type ListingsExportOptions = {
  /** Comma-separated listing ids for "Selected"; omitted = every row matching the filters. */
  ids?: string[];
  includeDescription?: boolean;
};

// ─── Staging adapter (§9.4; implemented by G5 `useStagedChanges`) ───────────

/** `listPrice`: CatalogDraft only (Trendyol list price, staged next to the sale price); other adapters ignore it. */
export type StagePatch = { price?: number; qty?: number; title?: string; tags?: string[]; listPrice?: number };

/** v1 queued actions the grid can stage. `delete` is never in "Send N"; it needs "Send deletion…". */
export type StagedAction =
  | { type: 'delete' | 'deactivate' | 'activate' | 'renew' | 'archive' | 'unarchive' | 'show' | 'hide' }
  /** Etsy: copy the listing into another of the seller's shops (draftService queued `copy`, sent explicitly). */
  | { type: 'copy'; targetShopId: string };

export type StageOptions = { queuedActions?: StagedAction[]; scheduledSendAt?: string | null };

export type SendResult = {
  sent: string[];
  failed: { id: string; errorKey: string; errorParams?: Record<string, string | number> }[];
  conflicts: string[];
  /** Not sent now because the shop's daily Etsy budget is used up; scheduled for the next window (Etsy bulk-sync). */
  scheduled?: string[];
};

export interface StagingAdapter {
  stage(id: string, patch: StagePatch, opts?: StageOptions): Promise<void>;
  discard(draftIds: string[]): Promise<void>;
  /** Chunks of ≤ 500. Callers must pre-filter conflicts and queued deletes (§6.2). */
  send(draftIds: string[]): Promise<SendResult>;
  schedule(draftIds: string[], at: Date | null): Promise<void>;
}

/** Max draft ids per send request (`/api/etsy-drafts/bulk-sync`, `/api/catalog-drafts/send`). */
export const SEND_CHUNK_SIZE = 500;
