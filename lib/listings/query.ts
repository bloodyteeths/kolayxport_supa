// lib/listings/query.ts — listings-grid §9.1 read engine (M5 G1).
// Reads ONLY the DB caches (EtsyListing, EbayListing, TrendyolProduct, WixProduct, ShopifyProduct and the draft
// tables); it never calls a marketplace. Each marketplace differs only through its adapter
// (lib/listings/adapters/<marketplace>.ts): store resolution, status `where`s, filters, sort, row mapping and the
// draft join. This file composes them into one list / count / export / duplicates pipeline.
//
// Schema guard (BUILD_PLAN §0.3): the BR-1a columns (`healthScore`, `healthChecksUsed`, `healthChecksTotal`,
// `healthFails`, `EtsyListing.skus`, `*Draft.scheduledSendAt`) and the `CatalogDraft` model may not be deployed
// yet. They are detected at runtime from the generated Prisma client (`Prisma.<Model>ScalarFieldEnum`) and are
// never selected, filtered or sorted on until they exist. Until then: health is `null` ("not scored yet"), the
// band filters match nothing, and the catalog draft join is empty.

import { Prisma } from '@prisma/client';
import { syncStatus, type ListingStatusKey } from '@/lib/ds/status';
import { contentWords, normalizeTitle } from '@/lib/etsy/seoRules';
import type {
  DuplicateReason,
  HealthFilterKey,
  ListingMarketplace,
  ListingRow,
  ListingRowSync,
  ListingSortDir,
  ListingSortField,
  ListingSyncKey,
  ListingsCounts,
  ListingsErrorCode,
  ListingsQuery,
  ListingsResponse,
  ListingsStore,
} from './types';
import { splitSortKey } from './types';
import { draftSendError, type SendError } from './sendError';

// ─── Prisma plumbing ────────────────────────────────────────────────────────

/** A Prisma `where` / `orderBy` / row object. The cache models gain columns at runtime (BR-1a), so these stay loose. */
export type Where = Record<string, any>;
export type OrderBy = Record<string, any>;
export type DbRow = Record<string, any>;
/** The subset of a Prisma model delegate the engine uses. */
export interface ModelDelegate {
  findMany(args: any): Promise<DbRow[]>;
  count(args: any): Promise<number>;
  findFirst?(args: any): Promise<DbRow | null>;
  aggregate?(args: any): Promise<any>;
}
/** The Prisma client (or a test fake with the same delegates). */
export type ListingsDb = Record<string, any>;

export type CacheModelName = 'EtsyListing' | 'EbayListing' | 'TrendyolProduct' | 'WixProduct' | 'ShopifyProduct';
export type DraftModelName = 'EtsyListingDraft' | 'EbayListingDraft' | 'CatalogDraft';

let fieldOverride: ((model: string, field: string) => boolean) | null = null;

/** Test hook: pretend the generated client has (or lacks) a column. Pass null to restore detection. */
export function setSchemaFieldOverrideForTests(fn: ((model: string, field: string) => boolean) | null): void {
  fieldOverride = fn;
}

/** True when the generated Prisma client knows `model.field` (i.e. the migration that adds it is in this build). */
export function modelHasField(model: string, field: string): boolean {
  if (fieldOverride) return fieldOverride(model, field);
  try {
    const e = (Prisma as unknown as Record<string, unknown>)[`${model}ScalarFieldEnum`];
    return !!e && typeof e === 'object' && Object.prototype.hasOwnProperty.call(e, field);
  } catch {
    return false;
  }
}

/** Schema capabilities for one marketplace, resolved once per request. */
export type SchemaCaps = {
  /** healthScore / healthChecksUsed / healthChecksTotal / healthFails exist on the cache model. */
  health: boolean;
  /** EtsyListing.skus exists (planned BR-1a column; not in the current schema). */
  skus: boolean;
  /**
   * Etsy SKUs come from the offerings cache (`EtsyListing.offerings` → `EtsyListingOffering.sku`), the only place the
   * current schema stores them. Optional so older callers / test literals stay valid (absent = false).
   */
  offeringSkus?: boolean;
  /** The draft model has scheduledSendAt. */
  scheduledSendAt: boolean;
  /** The draft model exists (CatalogDraft is new in BR-1a). */
  drafts: boolean;
};

export function schemaCaps(adapter: Pick<ListingsAdapter, 'model' | 'drafts'>): SchemaCaps {
  return {
    health: modelHasField(adapter.model, 'healthScore'),
    skus: adapter.model === 'EtsyListing' && modelHasField('EtsyListing', 'skus'),
    offeringSkus: adapter.model === 'EtsyListing' && modelHasField('EtsyListingOffering', 'sku'),
    scheduledSendAt: modelHasField(adapter.drafts.model, 'scheduledSendAt'),
    drafts: modelHasField(adapter.drafts.model, 'id'),
  };
}

/** Most SKUs read per listing (meta line shows the first; export / duplicates use the first non-empty). */
export const OFFERING_SKU_TAKE = 10;

/** Prisma `select` for a listing's offering SKUs (non-empty, stable order). */
export const OFFERING_SKUS_SELECT = {
  select: { sku: true },
  where: { AND: [{ sku: { not: null } }, { NOT: { sku: '' } }] },
  orderBy: { variantKey: 'asc' },
  take: OFFERING_SKU_TAKE,
} as const;

/** A Prisma `select` value: a scalar flag or a relation sub-select. */
export type SelectValue = true | Record<string, unknown>;

/** Extra columns (and the offerings relation) to select when the schema has them. */
export function capsSelect(caps: SchemaCaps): Record<string, SelectValue> {
  const s: Record<string, SelectValue> = {};
  if (caps.health) Object.assign(s, { healthScore: true, healthChecksUsed: true, healthChecksTotal: true, healthFails: true });
  if (caps.skus) s.skus = true;
  if (caps.offeringSkus) s.offerings = OFFERING_SKUS_SELECT;
  return s;
}

// ─── Store context ──────────────────────────────────────────────────────────

export type StoreContext = {
  userId: string;
  store: ListingsStore;
  stores: { id: string; name: string }[];
  /** Base `where` for the cache model: the user's rows in this store. */
  storeWhere: Where;
  /** Adapter-private values (shop domain, site URL, …). */
  meta: Record<string, string | null>;
};

export class ListingsQueryError extends Error {
  code: ListingsErrorCode;
  status: number;
  constructor(code: ListingsErrorCode, status: number, message?: string) {
    super(message ?? code);
    this.name = 'ListingsQueryError';
    this.code = code;
    this.status = status;
  }
}

// ─── Drafts ─────────────────────────────────────────────────────────────────

/** Draft statuses that hold unsent work (one per listing, service-enforced). */
export const OPEN_DRAFT_STATUSES = ['draft', 'failed', 'conflict', 'syncing'] as const;
/** "Sent" stays visible for 24h (DS §3.9 / lib/ds/status/sync.ts). */
export const SYNCED_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DraftOverlay = { changedFields: string[]; draft: ListingRowSync['draft'] };

export interface DraftSourceSpec {
  model: DraftModelName;
  /** Prisma delegate key: `etsyListingDraft`, `ebayListingDraft`, `catalogDraft`. */
  delegateKey: string;
  /** Column holding the marketplace id. */
  idField: string;
  where(ctx: StoreContext): Where;
  /** Marketplace id (string) → DB value; undefined = not a valid id (dropped). */
  toDbId(id: string): unknown;
  /** Patch → overlay and normalised changed field names. */
  overlay(draft: DbRow): DraftOverlay;
  /**
   * Queued action types that remove the listing from the marketplace (default `['delete']`). CatalogDraft also counts
   * `archive` (Trendyol's only queued action), matching lib/catalogDrafts/service.ts hasQueuedDelete.
   */
  destructiveActions?: readonly string[];
  /**
   * Relation holding the draft's sync attempts (`syncAttempts` on EtsyListingDraft / EbayListingDraft). When set, the
   * row loader includes the latest failed / conflict attempts so a stored error key gets the `result.errorParams` of
   * the attempt that recorded it (`result.errorKey`).
   */
  attemptsRelation?: 'syncAttempts';
}

/** Destructive queued action types for CatalogDraft sources (trendyol / wix / shopify). */
export const CATALOG_DESTRUCTIVE_ACTIONS: readonly string[] = ['delete', 'archive'];
const DEFAULT_DESTRUCTIVE_ACTIONS: readonly string[] = ['delete'];

export type DraftLite = { id: string; extId: string; status: string; queuedDelete: boolean; syncedAt: Date | null; updatedAt: Date | null };

function asDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isoOrNull(v: unknown): string | null {
  return asDate(v)?.toISOString() ?? null;
}

/** `queuedActions` contains an uncompleted destructive action (`delete`, plus `archive` for CatalogDraft). */
export function hasQueuedDelete(queuedActions: unknown, destructive: readonly string[] = DEFAULT_DESTRUCTIVE_ACTIONS): boolean {
  return (
    Array.isArray(queuedActions) &&
    queuedActions.some((a) => {
      if (!a || typeof a !== 'object') return false;
      const t = (a as { type?: unknown }).type;
      return typeof t === 'string' && destructive.includes(t) && !(a as { completedAt?: unknown }).completedAt;
    })
  );
}

function draftWindowWhere(now: Date): Where {
  return {
    OR: [
      { status: { in: [...OPEN_DRAFT_STATUSES] } },
      { status: 'synced', syncedAt: { gt: new Date(now.getTime() - SYNCED_WINDOW_MS) } },
    ],
  };
}

function isOpen(status: string): boolean {
  return (OPEN_DRAFT_STATUSES as readonly string[]).includes(status);
}

/** One draft per listing: the open one (newest) wins over a recently synced one. */
export function pickEffectiveDrafts<T extends { extId: string; status: string; updatedAt: Date | null; syncedAt: Date | null }>(drafts: T[]): Map<string, T> {
  const out = new Map<string, T>();
  const time = (d: T) => (isOpen(d.status) ? d.updatedAt : d.syncedAt ?? d.updatedAt)?.getTime() ?? 0;
  for (const d of drafts) {
    const cur = out.get(d.extId);
    if (!cur) {
      out.set(d.extId, d);
      continue;
    }
    const dOpen = isOpen(d.status);
    const cOpen = isOpen(cur.status);
    if (dOpen !== cOpen) {
      if (dOpen) out.set(d.extId, d);
      continue;
    }
    if (time(d) > time(cur)) out.set(d.extId, d);
  }
  return out;
}

function draftDelegate(db: ListingsDb, spec: DraftSourceSpec): ModelDelegate | null {
  const d = db[spec.delegateKey];
  return d && typeof d.findMany === 'function' ? (d as ModelDelegate) : null;
}

/** Store-wide effective drafts (light columns only), for counts and the `sync=` filter. */
export async function loadStoreDrafts(db: ListingsDb, spec: DraftSourceSpec, ctx: StoreContext, caps: SchemaCaps, now: Date): Promise<Map<string, DraftLite>> {
  const delegate = caps.drafts ? draftDelegate(db, spec) : null;
  if (!delegate) return new Map();
  const rows = await delegate.findMany({
    where: { AND: [spec.where(ctx), draftWindowWhere(now)] },
    select: { id: true, status: true, [spec.idField]: true, queuedActions: true, syncedAt: true, updatedAt: true },
  });
  const lite: DraftLite[] = rows.map((r) => ({
    id: String(r.id),
    extId: String(r[spec.idField]),
    status: String(r.status),
    queuedDelete: hasQueuedDelete(r.queuedActions, spec.destructiveActions),
    syncedAt: asDate(r.syncedAt),
    updatedAt: asDate(r.updatedAt),
  }));
  return pickEffectiveDrafts(lite);
}

/** The draft pill key of a draft, or null (cancelled, synced > 24h). */
export function draftSyncKey(d: { status: string; syncedAt?: Date | null; updatedAt?: Date | null }, now: Date): ListingSyncKey | null {
  const k = syncStatus({ status: d.status, syncedAt: d.syncedAt ?? null, updatedAt: d.updatedAt ?? null }, now);
  return k === 'pending' || k === 'syncing' || k === 'sync_failed' || k === 'conflict' || k === 'synced' ? k : null;
}

export function syncCountsFrom(drafts: Map<string, DraftLite>, now: Date): ListingsCounts['sync'] {
  const c = { pending: 0, syncing: 0, failed: 0, conflict: 0, queuedDeletes: 0 };
  for (const d of Array.from(drafts.values())) {
    const k = draftSyncKey(d, now);
    if (k === 'pending') c.pending += 1;
    else if (k === 'syncing') c.syncing += 1;
    else if (k === 'sync_failed') c.failed += 1;
    else if (k === 'conflict') c.conflict += 1;
    if (isOpen(d.status) && d.queuedDelete) c.queuedDeletes += 1;
  }
  return c;
}

/**
 * `lastSyncError` → i18n key, so raw error text never reaches the client (§4 cell rules). The draft tables store a
 * full key (`etsy.draftSync.<code>`, `ebay.draftSync.<code>`, CatalogDraft `listings.*`; see
 * docs/integration/draft-sync-error-codes.md), which passes through with the matching failed attempt's
 * `result.errorParams` (the attempt whose `result.errorKey` equals the stored key). Rows written before the code
 * migration hold English text, mapped to `listings.sendError.*`.
 */
export function sendErrorKey(status: string, lastSyncError: unknown, syncAttempts?: unknown): SendError | null {
  return draftSendError({ status, lastSyncError, syncAttempts });
}

/** Failed / conflict attempts the row loader reads to find the one that recorded the draft's stored error key. */
export const ATTEMPTS_FOR_PARAMS = 3;

/** Full drafts for the given marketplace ids → row `sync` objects. */
export async function loadRowSync(
  db: ListingsDb,
  spec: DraftSourceSpec,
  ctx: StoreContext,
  caps: SchemaCaps,
  ids: string[],
  now: Date,
): Promise<Map<string, ListingRowSync>> {
  const out = new Map<string, ListingRowSync>();
  const delegate = caps.drafts ? draftDelegate(db, spec) : null;
  const dbIds = ids.map((id) => spec.toDbId(id)).filter((v) => v !== undefined);
  if (!delegate || dbIds.length === 0) return out;
  const rows = await delegate.findMany({
    where: { AND: [spec.where(ctx), { [spec.idField]: { in: dbIds } }, draftWindowWhere(now)] },
    // ICU params for the stored error key live on the failed / conflict attempt whose `result.errorKey` matches it
    // (Etsy / eBay only). A few attempts, since the newest failed one may be an unrelated concurrent-send / stale
    // recovery attempt with no `errorKey`.
    ...(spec.attemptsRelation
      ? { include: { [spec.attemptsRelation]: { where: { status: { in: ['failed', 'conflict'] } }, orderBy: { startedAt: 'desc' }, take: ATTEMPTS_FOR_PARAMS, select: { status: true, result: true } } } }
      : {}),
  });
  const effective = pickEffectiveDrafts(
    rows.map((r) => ({ row: r, extId: String(r[spec.idField]), status: String(r.status), updatedAt: asDate(r.updatedAt), syncedAt: asDate(r.syncedAt) })),
  );
  for (const [extId, e] of Array.from(effective.entries())) {
    const key = draftSyncKey(e, now);
    if (!key) continue;
    const r = e.row;
    const { changedFields, draft } = spec.overlay(r);
    const err = sendErrorKey(e.status, r.lastSyncError, spec.attemptsRelation ? r[spec.attemptsRelation] : undefined);
    out.set(extId, {
      draftId: String(r.id),
      status: key,
      changedFields,
      draft,
      ...(err ? { errorKey: err.errorKey, ...(err.errorParams ? { errorParams: err.errorParams } : {}) } : {}),
      queuedDelete: isOpen(e.status) && hasQueuedDelete(r.queuedActions, spec.destructiveActions),
      scheduledSendAt: caps.scheduledSendAt ? isoOrNull(r.scheduledSendAt) : null,
      syncedAt: isoOrNull(r.syncedAt),
    });
  }
  return out;
}

// ─── Adapter contract ───────────────────────────────────────────────────────

export type ListingBase = Omit<ListingRow, 'sync'>;

/** Values the export and duplicates tools need that `ListingRow` does not carry. */
/** `materials`: Etsy only (exported as a `materials` column; Find & replace reads it). */
export type ListingExportFields = { sku: string | null; tags: string[]; description: string | null; materials?: string[] };

export interface ListingsAdapter {
  marketplace: ListingMarketplace;
  model: CacheModelName;
  /** Prisma delegate key of the cache model (`etsyListing`, …). */
  delegateKey: string;
  /** Column holding the marketplace id. */
  idField: string;
  /** Marketplace id → DB value; undefined = invalid (dropped). */
  toDbId(id: string): unknown;
  /** Listing status keys this marketplace can produce (count pill + SavedViews). */
  statusKeys: readonly ListingStatusKey[];
  /** Resolves the store (`?store=`, else the first). null = not connected. Throws `store_not_found`. */
  resolveStore(db: ListingsDb, userId: string, store: string | undefined): Promise<StoreContext | null>;
  /** Prisma `where` matching exactly the rows `listingStatus()` maps to `key` (null = never matches). */
  statusWhere(key: ListingStatusKey): Where | null;
  /** Free-text search across title and ids. */
  searchWhere(q: string, caps: SchemaCaps): Where;
  /** Marketplace-specific filters (section, condition, …), stock and price (unless `memoryPrice`). */
  filterWheres(q: ListingsQuery, caps: SchemaCaps): Where[];
  /** Column fallbacks for check-based health filters before BR-1a (null = no proxy → matches nothing). */
  healthProxy(key: HealthFilterKey): Where | null;
  /** Sort column for a field, or null when unsupported (falls back to `updated`). `price` may be 'memory'. */
  sortColumn(field: ListingSortField, caps: SchemaCaps): { column: string; nullable: boolean } | 'memory' | null;
  /** When set, price sort/filter run in memory over this projection (eBay stores price as a string). */
  memoryPrice?: { select: Record<string, true>; price(row: DbRow): number | null };
  /** Columns to read for the row mapper (description excluded; caps columns added by the engine). */
  select: Record<string, true>;
  /** Extra columns for export (`description`, tags…). */
  exportSelect: Record<string, true>;
  toRow(row: DbRow, ctx: StoreContext, caps: SchemaCaps): ListingBase;
  exportFields(row: DbRow, caps: SchemaCaps): ListingExportFields;
  /** Per-marketplace extra export columns, read from `row.extra` (order = CSV order). */
  exportExtras: readonly string[];
  drafts: DraftSourceSpec;
}

// ─── Shared helpers for adapters ────────────────────────────────────────────

export function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function health(row: DbRow, caps: SchemaCaps): ListingRow['health'] {
  if (!caps.health) return { score: null, used: 0, total: 0, fails: [] };
  const score = toNumber(row.healthScore);
  return {
    score: score == null ? null : Math.round(score),
    used: toNumber(row.healthChecksUsed) ?? 0,
    total: toNumber(row.healthChecksTotal) ?? 0,
    fails: Array.isArray(row.healthFails) ? row.healthFails.filter((s: unknown): s is string => typeof s === 'string') : [],
  };
}

/** Case-insensitive equality on a string column. */
export function ieq(column: string, value: string): Where {
  return { [column]: { equals: value, mode: 'insensitive' } };
}

/** Rows whose nullable string column is NOT `value` (case-insensitive), NULLs included. */
export function notIeq(column: string, value: string, nullable: boolean): Where {
  const not = { NOT: ieq(column, value) };
  return nullable ? { OR: [{ [column]: null }, not] } : not;
}

export function csvValues(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function photosWhere(photos: ListingsQuery['photos']): Where | null {
  if (photos === 'lt5') return { imageCount: { lt: 5 } };
  if (photos === '5-9') return { imageCount: { gte: 5, lte: 9 } };
  if (photos === 'gte10') return { imageCount: { gte: 10 } };
  return null;
}

export function rangeWhere(column: string, min: number | undefined, max: number | undefined, scale = 1): Where | null {
  if (min === undefined && max === undefined) return null;
  const r: Record<string, number> = {};
  if (min !== undefined) r.gte = scale === 1 ? min : Math.round(min * scale);
  if (max !== undefined) r.lte = scale === 1 ? max : Math.round(max * scale);
  return { [column]: r };
}

// ─── Health filter ──────────────────────────────────────────────────────────

/** Check ids (lib/listingScore/*) behind each check-based health filter. Any listed id in `healthFails` matches. */
export const HEALTH_FAIL_CHECKS: Record<'missing_photos' | 'missing_tags' | 'no_video' | 'short_title', string[]> = {
  missing_photos: ['photos_count'],
  missing_tags: ['tags_count'],
  no_video: ['video'],
  short_title: ['title_length'],
};

const NEVER: Where = { id: { in: [] } };

export function healthWhere(key: HealthFilterKey, adapter: ListingsAdapter, caps: SchemaCaps): Where {
  if (!caps.health) return adapter.healthProxy(key) ?? NEVER;
  switch (key) {
    case 'lt50':
      return { healthScore: { lt: 50 } };
    case '50-74':
      return { healthScore: { gte: 50, lte: 74 } };
    case '75-89':
      return { healthScore: { gte: 75, lte: 89 } };
    case 'gte90':
      return { healthScore: { gte: 90 } };
    default:
      return { healthFails: { hasSome: HEALTH_FAIL_CHECKS[key] } };
  }
}

// ─── Where / orderBy composition ────────────────────────────────────────────

export function statusFilterWhere(adapter: ListingsAdapter, keys: ListingStatusKey[] | undefined): Where | null {
  if (!keys?.length) return null;
  const parts = keys.map((k) => adapter.statusWhere(k)).filter((w): w is Where => w !== null);
  return parts.length ? { OR: parts } : NEVER;
}

/** Everything except the store where, ids and memory price. */
export function filterWheres(adapter: ListingsAdapter, q: ListingsQuery, caps: SchemaCaps): Where[] {
  const out: Where[] = [];
  const st = statusFilterWhere(adapter, q.status);
  if (st) out.push(st);
  if (q.q) out.push(adapter.searchWhere(q.q, caps));
  if (q.health) out.push(healthWhere(q.health, adapter, caps));
  const ph = photosWhere(q.photos);
  if (ph) out.push(ph);
  out.push(...adapter.filterWheres(q, caps));
  return out;
}

export function idsWhere(adapter: ListingsAdapter, ids: string[]): Where {
  const dbIds = ids.map((id) => adapter.toDbId(id)).filter((v) => v !== undefined);
  return { [adapter.idField]: { in: dbIds } };
}

export function orderByFor(adapter: ListingsAdapter, field: ListingSortField, dir: ListingSortDir, caps: SchemaCaps): OrderBy[] | 'memory' {
  let col = adapter.sortColumn(field, caps);
  if (col === 'memory') return 'memory';
  let d = dir;
  if (!col) {
    col = adapter.sortColumn('updated', caps) as { column: string; nullable: boolean };
    d = 'desc';
  }
  const primary = col.nullable ? { [col.column]: { sort: d, nulls: 'last' } } : { [col.column]: d };
  return [primary, { id: 'asc' }];
}

function needsMemoryPrice(adapter: ListingsAdapter, q: ListingsQuery, caps: SchemaCaps): boolean {
  if (!adapter.memoryPrice) return false;
  const { field } = splitSortKey(q.sort);
  return q.priceMin !== undefined || q.priceMax !== undefined || adapter.sortColumn(field, caps) === 'memory';
}

function delegateOf(db: ListingsDb, adapter: ListingsAdapter): ModelDelegate {
  const d = db[adapter.delegateKey];
  if (!d) throw new ListingsQueryError('server_error', 500, `missing delegate ${adapter.delegateKey}`);
  return d as ModelDelegate;
}

// ─── Plan: resolve store, drafts and the where once ─────────────────────────

export type ListingsPlan = {
  adapter: ListingsAdapter;
  ctx: StoreContext;
  caps: SchemaCaps;
  drafts: Map<string, DraftLite>;
  /** Filters + store + sync ids + explicit ids (no memory price). */
  where: Where;
  now: Date;
};

export type PlanOptions = { ids?: string[]; now?: Date };

export async function planListingsQuery(db: ListingsDb, adapter: ListingsAdapter, userId: string, q: ListingsQuery, opts: PlanOptions = {}): Promise<ListingsPlan> {
  const now = opts.now ?? new Date();
  const ctx = await adapter.resolveStore(db, userId, q.store);
  if (!ctx) throw new ListingsQueryError('not_connected', 404);
  const caps = schemaCaps(adapter);
  const drafts = await loadStoreDrafts(db, adapter.drafts, ctx, caps, now);
  const and: Where[] = [ctx.storeWhere, ...filterWheres(adapter, q, caps)];
  if (q.sync?.length) {
    const wanted = new Set<string>(q.sync);
    const ids = Array.from(drafts.values())
      .filter((d) => {
        const k = draftSyncKey(d, now);
        return k !== null && wanted.has(k);
      })
      .map((d) => d.extId);
    and.push(idsWhere(adapter, ids));
  }
  if (opts.ids) and.push(idsWhere(adapter, opts.ids));
  return { adapter, ctx, caps, drafts, where: { AND: and }, now };
}

function selectFor(plan: ListingsPlan, extra?: Record<string, true>): Record<string, SelectValue> {
  return { ...plan.adapter.select, ...capsSelect(plan.caps), ...(extra ?? {}) };
}

/** Ordered marketplace ids for the eBay-style in-memory price path. */
async function memoryOrderedIds(db: ListingsDb, plan: ListingsPlan, q: ListingsQuery): Promise<string[]> {
  const { adapter, caps } = plan;
  const mp = adapter.memoryPrice!;
  const rows = await delegateOf(db, adapter).findMany({
    where: plan.where,
    select: { ...mp.select, [adapter.idField]: true, id: true, ...(sortSelect(adapter, caps)) },
  });
  let items = rows.map((r) => ({ id: String(r[adapter.idField]), price: mp.price(r), row: r }));
  if (q.priceMin !== undefined) items = items.filter((i) => i.price !== null && i.price >= q.priceMin!);
  if (q.priceMax !== undefined) items = items.filter((i) => i.price !== null && i.price <= q.priceMax!);
  const { field, dir } = splitSortKey(q.sort);
  let col = adapter.sortColumn(field, caps);
  let sign = dir === 'asc' ? 1 : -1;
  if (col === null) {
    col = adapter.sortColumn('updated', caps);
    sign = -1;
  }
  const keyOf = (i: (typeof items)[number]): number | string | null => {
    if (col === 'memory') return i.price;
    if (!col) return null;
    const v = i.row[col.column];
    return v instanceof Date ? v.getTime() : v == null ? null : typeof v === 'number' ? v : String(v);
  };
  items.sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka !== null && kb !== null) {
      if (ka < kb) return -sign;
      if (ka > kb) return sign;
    } else if (ka !== kb) {
      return ka === null ? 1 : -1; // nulls last
    }
    return String(a.row.id).localeCompare(String(b.row.id));
  });
  return items.map((i) => i.id);
}

function sortSelect(adapter: ListingsAdapter, caps: SchemaCaps): Record<string, true> {
  const s: Record<string, true> = {};
  for (const f of ['updated', 'title', 'qty', 'health', 'views', 'created'] as ListingSortField[]) {
    const c = adapter.sortColumn(f, caps);
    if (c && c !== 'memory') s[c.column] = true;
  }
  return s;
}

/** Fetches rows by marketplace id in the given order. */
async function rowsByIds(db: ListingsDb, plan: ListingsPlan, ids: string[], extraSelect?: Record<string, true>): Promise<DbRow[]> {
  if (!ids.length) return [];
  const rows = await delegateOf(db, plan.adapter).findMany({
    where: { AND: [plan.ctx.storeWhere, idsWhere(plan.adapter, ids)] },
    select: selectFor(plan, extraSelect),
  });
  const pos = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (pos.get(String(a[plan.adapter.idField])) ?? 0) - (pos.get(String(b[plan.adapter.idField])) ?? 0));
}

// ─── Counts ─────────────────────────────────────────────────────────────────

export async function loadCounts(db: ListingsDb, plan: ListingsPlan): Promise<ListingsCounts> {
  const { adapter, ctx, caps } = plan;
  const model = delegateOf(db, adapter);
  const base = ctx.storeWhere;
  const statusEntries = adapter.statusKeys
    .map((k) => [k, adapter.statusWhere(k)] as const)
    .filter((e): e is readonly [ListingStatusKey, Where] => e[1] !== null);
  const [all, needsWork, unscored, ...statusCounts] = await Promise.all([
    model.count({ where: base }),
    caps.health ? model.count({ where: { AND: [base, { healthScore: { lt: 50 } }] } }) : Promise.resolve(0),
    caps.health ? model.count({ where: { AND: [base, { healthScore: null }] } }) : Promise.resolve(-1),
    ...statusEntries.map(([, w]) => model.count({ where: { AND: [base, w] } })),
  ]);
  const status: ListingsCounts['status'] = {};
  statusEntries.forEach(([k], i) => {
    status[k] = statusCounts[i];
  });
  return { all, status, sync: syncCountsFrom(plan.drafts, plan.now), needsWork, unscored: unscored < 0 ? all : unscored };
}

// ─── Rows ───────────────────────────────────────────────────────────────────

export async function toListingRows(db: ListingsDb, plan: ListingsPlan, dbRows: DbRow[]): Promise<ListingRow[]> {
  const base = dbRows.map((r) => plan.adapter.toRow(r, plan.ctx, plan.caps));
  const sync = await loadRowSync(db, plan.adapter.drafts, plan.ctx, plan.caps, base.map((r) => r.id), plan.now);
  return base.map((r) => ({ ...r, sync: sync.get(r.id) ?? null }));
}

/** One page of rows + total after filters. */
export async function loadPage(db: ListingsDb, plan: ListingsPlan, q: ListingsQuery): Promise<{ rows: DbRow[]; total: number }> {
  const { adapter, caps } = plan;
  const skip = (q.page - 1) * q.size;
  if (needsMemoryPrice(adapter, q, caps)) {
    const ids = await memoryOrderedIds(db, plan, q);
    return { rows: await rowsByIds(db, plan, ids.slice(skip, skip + q.size)), total: ids.length };
  }
  const { field, dir } = splitSortKey(q.sort);
  const orderBy = orderByFor(adapter, field, dir, caps) as OrderBy[];
  const model = delegateOf(db, adapter);
  const [total, rows] = await Promise.all([
    model.count({ where: plan.where }),
    model.findMany({ where: plan.where, orderBy, skip, take: q.size, select: selectFor(plan) }),
  ]);
  return { rows, total };
}

/** `GET /api/listings`. */
export async function listListings(db: ListingsDb, adapter: ListingsAdapter, userId: string, q: ListingsQuery, opts: PlanOptions = {}): Promise<ListingsResponse> {
  const plan = await planListingsQuery(db, adapter, userId, q, opts);
  const [{ rows, total }, counts] = await Promise.all([loadPage(db, plan, q), loadCounts(db, plan)]);
  return {
    rows: await toListingRows(db, plan, rows),
    total,
    counts,
    store: plan.ctx.store,
    stores: plan.ctx.stores,
  };
}

// ─── Export ─────────────────────────────────────────────────────────────────

/** Hard cap for one export (shops have ≤ 5,000 listings; this only guards runaway queries). */
export const EXPORT_MAX_ROWS = 20_000;
const EXPORT_BATCH = 500;

export type ExportItem = { row: ListingRow; fields: ListingExportFields };

/** Every row matching the filters (not only one page), in the list's sort order, without the draft join. */
export async function collectExportRows(
  db: ListingsDb,
  plan: ListingsPlan,
  q: ListingsQuery,
  opts: { includeDescription?: boolean } = {},
): Promise<{ items: ExportItem[]; truncated: boolean }> {
  const { adapter, caps, ctx } = plan;
  const extra: Record<string, true> = { ...adapter.exportSelect, ...(opts.includeDescription ? { description: true } : {}) };
  const toItem = (r: DbRow): ExportItem => ({ row: { ...adapter.toRow(r, ctx, caps), sync: null }, fields: adapter.exportFields(r, caps) });
  if (needsMemoryPrice(adapter, q, caps)) {
    const ids = await memoryOrderedIds(db, plan, q);
    const items: ExportItem[] = [];
    const capped = ids.slice(0, EXPORT_MAX_ROWS);
    for (let i = 0; i < capped.length; i += EXPORT_BATCH) {
      const batch = await rowsByIds(db, plan, capped.slice(i, i + EXPORT_BATCH), extra);
      items.push(...batch.map(toItem));
    }
    return { items, truncated: ids.length > EXPORT_MAX_ROWS };
  }
  const { field, dir } = splitSortKey(q.sort);
  const orderBy = orderByFor(adapter, field, dir, caps) as OrderBy[];
  const model = delegateOf(db, adapter);
  const items: ExportItem[] = [];
  for (let skip = 0; skip < EXPORT_MAX_ROWS; skip += EXPORT_BATCH) {
    const rows = await model.findMany({ where: plan.where, orderBy, skip, take: EXPORT_BATCH, select: selectFor(plan, extra) });
    items.push(...rows.map(toItem));
    if (rows.length < EXPORT_BATCH) return { items, truncated: false };
  }
  const more = await model.count({ where: plan.where });
  return { items, truncated: more > items.length };
}

// ─── Duplicates ─────────────────────────────────────────────────────────────

export const DUPLICATE_GROUP_LIMIT = 200;
export const SIMILAR_TITLE_THRESHOLD = 0.8;

export type DuplicateCandidate = { id: string; sku: string | null; title: string };
export type DuplicateGroupIds = { reason: DuplicateReason; ids: string[] };

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** Content words of the normalised title, in order. Numbers are kept even when one digit ("Size 2" ≠ "Size 3"). */
export function titleWords(title: string): string[] {
  return normalizeTitle(title)
    .toLowerCase()
    .split(/[\s,|/\\:;·•—–\-]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => /^\p{N}+$/u.test(w) || contentWords(w).length > 0);
}

/**
 * Groups listings that look like duplicates (§9.4): the same SKU, the same normalised title (content words in
 * order), or title Jaccard ≥ 0.8 on content-word sets. Pure. Uses prefix filtering so 5,000 titles stay fast.
 * A group whose id set equals an earlier (stronger) group is dropped. Order: SKU, title, similar (desc).
 */
export function groupDuplicates(items: DuplicateCandidate[], limit = DUPLICATE_GROUP_LIMIT): { groups: DuplicateGroupIds[]; truncated: boolean } {
  const groups: DuplicateGroupIds[] = [];
  const seen: string[][] = [];
  const push = (reason: DuplicateReason, ids: string[]) => {
    if (seen.some((s) => sameSet(s, ids))) return;
    seen.push(ids);
    groups.push({ reason, ids });
  };

  // 1. Same SKU (case-insensitive, trimmed).
  const bySku = new Map<string, { sku: string; ids: string[] }>();
  for (const it of items) {
    const sku = (it.sku ?? '').trim();
    if (!sku) continue;
    const k = sku.toLowerCase();
    const g = bySku.get(k) ?? { sku, ids: [] };
    g.ids.push(it.id);
    bySku.set(k, g);
  }
  for (const g of Array.from(bySku.values())) if (g.ids.length > 1) push({ kind: 'same_sku', sku: g.sku }, g.ids);

  // 2. Same normalised title.
  const words = items.map((it) => titleWords(it.title));
  const titleKey = words.map((w) => w.join(' '));
  const byTitle = new Map<string, string[]>();
  items.forEach((it, i) => {
    if (!titleKey[i]) return;
    const g = byTitle.get(titleKey[i]) ?? [];
    g.push(it.id);
    byTitle.set(titleKey[i], g);
  });
  for (const ids of Array.from(byTitle.values())) if (ids.length > 1) push({ kind: 'same_title' }, ids);

  // 3. Similar titles: Jaccard on content-word sets, prefix-filtered candidates, union-find components.
  const sets = words.map((w) => Array.from(new Set(w)));
  const freq = new Map<string, number>();
  for (const s of sets) for (const w of s) freq.set(w, (freq.get(w) ?? 0) + 1);
  const ordered = sets.map((s) => [...s].sort((a, b) => (freq.get(a)! - freq.get(b)!) || (a < b ? -1 : a > b ? 1 : 0)));
  const edges: { i: number; j: number; jac: number }[] = [];
  const index = new Map<string, number[]>();
  const t = SIMILAR_TITLE_THRESHOLD;
  for (let i = 0; i < items.length; i += 1) {
    const si = ordered[i];
    if (si.length < 2) continue;
    const prefix = si.length - Math.ceil(t * si.length) + 1;
    const cands = new Set<number>();
    for (let p = 0; p < prefix; p += 1) for (const j of index.get(si[p]) ?? []) cands.add(j);
    const setI = new Set(si);
    for (const j of Array.from(cands)) {
      if (titleKey[i] === titleKey[j]) continue;
      const sj = ordered[j];
      if (Math.min(si.length, sj.length) / Math.max(si.length, sj.length) < t) continue;
      let inter = 0;
      for (const w of sj) if (setI.has(w)) inter += 1;
      const jac = inter / (si.length + sj.length - inter);
      if (jac >= t) edges.push({ i, j, jac });
    }
    for (let p = 0; p < prefix; p += 1) {
      const list = index.get(si[p]) ?? [];
      list.push(i);
      index.set(si[p], list);
    }
  }
  const parent = items.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const n = parent[x];
      parent[x] = r;
      x = n;
    }
    return r;
  };
  for (const e of edges) {
    const a = find(e.i);
    const b = find(e.j);
    if (a !== b) parent[a] = b;
  }
  const minSim = new Map<number, number>();
  for (const e of edges) {
    const r = find(e.i);
    minSim.set(r, Math.min(minSim.get(r) ?? 1, e.jac));
  }
  const comps = new Map<number, string[]>();
  items.forEach((it, i) => {
    const r = find(i);
    if (!minSim.has(r)) return;
    const g = comps.get(r) ?? [];
    g.push(it.id);
    comps.set(r, g);
  });
  const similar = Array.from(comps.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([r, ids]) => ({ ids, similarity: Math.round((minSim.get(r) ?? t) * 100) }))
    .sort((a, b) => b.similarity - a.similarity || b.ids.length - a.ids.length);
  for (const g of similar) push({ kind: 'similar_title', similarity: g.similarity }, g.ids);

  return { groups: groups.slice(0, limit), truncated: groups.length > limit };
}

/** Every row of the store (light columns) → duplicate groups with full `ListingRow`s. */
export async function findDuplicates(db: ListingsDb, plan: ListingsPlan): Promise<{ groups: { reason: DuplicateReason; ids: string[]; rows: ListingRow[] }[]; truncated: boolean }> {
  const { adapter, caps } = plan;
  const all = await delegateOf(db, adapter).findMany({
    where: plan.ctx.storeWhere,
    select: selectFor(plan, adapter.exportSelect),
    take: EXPORT_MAX_ROWS,
  });
  const byId = new Map<string, DbRow>();
  const cands: DuplicateCandidate[] = all.map((r) => {
    const base = adapter.toRow(r, plan.ctx, caps);
    byId.set(base.id, r);
    return { id: base.id, sku: adapter.exportFields(r, caps).sku, title: base.title };
  });
  const { groups, truncated } = groupDuplicates(cands);
  const ids = Array.from(new Set(groups.flatMap((g) => g.ids)));
  const rows = await toListingRows(db, plan, ids.map((id) => byId.get(id)!).filter(Boolean));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  return {
    groups: groups.map((g) => ({ ...g, rows: g.ids.map((id) => rowById.get(id)).filter((r): r is ListingRow => !!r) })),
    truncated,
  };
}
