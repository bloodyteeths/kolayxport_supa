/**
 * DB staging for Trendyol, Wix and Shopify listings (listings-grid §9.3–§9.4).
 * Server-only.
 *
 * Same model as the Etsy/eBay drafts: grid edits are staged into one open
 * `CatalogDraft` row per product, and the marketplace changes only when the
 * seller explicitly sends (POST /api/catalog-drafts/send) or a scheduled send
 * fires (lib/drafts/scheduledSend.ts). A send never forces a conflict and never
 * sends a queued delete/archive unless the caller passes that draft id in
 * `confirmDeleteIds` (the UI's type-to-confirm).
 *
 * v2 (marketplace-editors §6, §7.1, M6b-A): the full-page editors stage every
 * field of the §6 tables (keys and validation in ./schemas.ts), a new product
 * is staged as a draft with `externalId = 'new:<id>'` and a queued `create`
 * (nothing exists on the marketplace until the explicit send), and Review
 * differences works through `getCatalogDraftDiff` / `resolveCatalogDraft`.
 *
 * The `CatalogDraft` model ships with backend migration BR-1a. Until it is
 * deployed, `catalogDraftsAvailable()` is false and every entry point throws
 * `CatalogDraftError('UNAVAILABLE')` (HTTP 503) instead of crashing.
 */
import { randomBytes } from 'crypto';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { marketplaceDetail } from '@/lib/listings/failureFix';
import { logger } from '@/lib/logger';
import { isCatalogDraftEmpty, type EmptyDraftOptions } from '@/lib/drafts/emptyDraft';
import { channelEnabled, getStockSettings, isStockSyncActive } from '@/lib/stock/settings';
import {
  ALLOWED_FIELDS,
  CatalogDraftError,
  ERR,
  ERROR_META,
  NEW_ID_PREFIX,
  comparableValue,
  createPayloadOf,
  hasPendingCreate,
  hasQueuedDelete,
  isCatalogDraftError,
  isCatalogMarketplace,
  isNewExternalId,
  isOpKey,
  mergeQueuedActions,
  sameValue,
  scopedPatchValue,
  scopedToPatch,
  touchesStock,
  validateFieldPatch,
  validateQueuedActions,
  type CatalogFieldKey,
  type CatalogFieldPatch,
  type CatalogMarketplace,
  type CatalogQueuedAction,
} from './schemas';
import {
  shopifyValuesFromCache,
  trendyolValuesFromCache,
  wixValuesFromCache,
  type CanonicalValues,
} from './values';

// ---------------------------------------------------------------------------
// Types (field contract, actions and errors live in ./schemas; re-exported here)
// ---------------------------------------------------------------------------

export {
  ALLOWED_ACTIONS,
  ALLOWED_FIELDS,
  CATALOG_MARKETPLACES,
  CatalogDraftError,
  ERR,
  ERROR_META,
  FIELD_ALIASES,
  NEW_ID_PREFIX,
  TRENDYOL_CONTENT_KEYS,
  TRENDYOL_PRICE_KEYS,
  canonicalFieldKey,
  hasPendingCreate,
  hasQueuedDelete,
  isCatalogDraftError,
  isCatalogMarketplace,
  isNewExternalId,
  mergeQueuedActions,
  validateCreatePayload,
  validateFieldPatch,
  validateQueuedActions,
} from './schemas';
export type {
  CatalogDraftErrorCode,
  CatalogFieldKey,
  CatalogFieldPatch,
  CatalogMarketplace,
  CatalogQueuedAction,
  CatalogQueuedActionType,
  ShopifyImageOp,
  ShopifySeo,
  ShopifyVariantEdit,
  TrendyolAttributeValue,
  TrendyolCreatePayload,
  WixCreatePayload,
  WixCustomTextField,
  WixDiscount,
  WixMediaOp,
} from './schemas';
export type { CanonicalValues, CanonicalVariant } from './values';

export type CatalogDraftStatus = 'draft' | 'syncing' | 'failed' | 'conflict' | 'synced' | 'cancelled';
/** At most one draft per product in these states (the "open" draft). */
export const OPEN_STATUSES: CatalogDraftStatus[] = ['draft', 'failed', 'conflict', 'syncing'];
/** States a send may claim. A conflict is re-checked, never forced. */
export const SENDABLE_STATUSES: CatalogDraftStatus[] = ['draft', 'failed', 'conflict'];
export const STALE_SYNCING_MS = 10 * 60 * 1000;
/** A Trendyol batch still unresolved after this long is marked failed. */
export const BATCH_TIMEOUT_MS = 60 * 60 * 1000;
export const MAX_SEND_DRAFTS = 500;

/** baseSnapshot keys that are bookkeeping, never product values (stripped on rebase, never diffed). */
export const SNAPSHOT_META_KEYS = ['sentItem', 'sentBatches'];

export type CatalogDraftRecord = {
  id: string;
  userId: string;
  marketplace: CatalogMarketplace;
  storeId: string;
  /** barcode | wixProductId | shopifyProductId, or `new:<id>` for a staged create. */
  externalId: string;
  status: CatalogDraftStatus;
  baseUpdatedAt: Date | null;
  baseSnapshot: CanonicalValues & Record<string, unknown>;
  fieldPatch: CatalogFieldPatch;
  queuedActions: CatalogQueuedAction[];
  batchRequestId: string | null;
  lastSyncError: string | null;
  /** The failure key's params + `detail` (marketplace message). */
  lastSyncErrorParams: Record<string, string | number> | null;
  scheduledSendAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  syncedAt: Date | null;
};

/** JSON shape returned by the API (dates as ISO strings). */
export type CatalogDraftDTO = Omit<CatalogDraftRecord, 'userId' | 'baseUpdatedAt' | 'scheduledSendAt' | 'createdAt' | 'updatedAt' | 'syncedAt'> & {
  baseUpdatedAt: string | null;
  scheduledSendAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  /** True when queuedActions holds an uncompleted delete or archive. */
  queuedDelete: boolean;
  /** True while the draft is a staged create (an uncompleted `create` action; externalId is `new:<id>`). */
  isCreate: boolean;
};

export type SendResultStatus = 'success' | 'failed' | 'conflict' | 'pending' | 'skipped';
export type SendResult = {
  draftId: string;
  status: SendResultStatus;
  /** Full i18n key, e.g. 'listings.draftError.multiLocation'. */
  errorKey?: string;
  errorParams?: Record<string, string | number>;
  /** conflict: patched fields that changed remotely ([] when only the timestamp is known). */
  changedFields?: string[];
  /** skipped: why nothing was attempted. */
  /** `empty`: nothing left to send (every staged change undone); the draft was cancelled, nothing was called. */
  reason?: 'queued_delete' | 'not_sendable' | 'not_found' | 'empty';
  /**
   * The product's marketplace id after a create (success, or failed after the product was created).
   * The draft row's `externalId` already holds it; the editor replaces `/new` with it.
   */
  externalId?: string;
  /** Per-item failures the editor shows inline (Shopify variant rows, media/image ops). */
  details?: ExecutorFailureDetails;
};
export type SendSummary = {
  results: SendResult[];
  sent: string[];
  failed: { id: string; errorKey: string; errorParams?: Record<string, string | number> }[];
  conflicts: string[];
  /** Trendyol batches accepted but not final yet (draft stays `syncing`). */
  pending: string[];
  skipped: { id: string; reason: NonNullable<SendResult['reason']> }[];
};

export type ExecutorFailureDetails = {
  /** Shopify variant edits that failed (others were written). `code`: NOT_FOUND | INVALID_PRICE | NOT_TRACKED | NO_LOCATION | MULTI_LOCATION | STOCK_CHANGED | FAILED. */
  variants?: { id: string; code: string }[];
  /** Media / image operations that failed (index into the staged op list). */
  ops?: { index: number; op: string; key: string }[];
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** `{ status, body }` for an API route; unknown errors become 500 without leaking internals. */
export function catalogDraftErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } {
  if (isCatalogDraftError(err)) {
    return { status: err.status, body: { error: err.message, code: err.code, key: err.key, ...(err.params ? { params: err.params } : {}) } };
  }
  return { status: 500, body: { error: 'Catalog draft request failed', code: 'INTERNAL', key: `${ERR}.internal` } };
}

/** Thrown by executors; becomes a `failed` result with this i18n key. */
export class CatalogExecutorError extends Error {
  errorKey: string;
  errorParams?: Record<string, string | number>;
  /**
   * A create step failed AFTER the product was created on the marketplace: its new id. The draft is then turned
   * into an edit draft of that product (externalId rewritten, `create` completed) so Retry never creates twice;
   * re-sending re-runs the remaining (idempotent) steps.
   */
  createdExternalId?: string;
  details?: ExecutorFailureDetails;
  /**
   * Replacement values for fieldPatch keys after a partial failure (`null` drops the key): the operations that
   * already succeeded and are not idempotent (Shopify image adds, Wix media adds) are removed from the stored
   * draft so a Retry never runs them twice.
   */
  remainingPatch?: Record<string, unknown>;
  constructor(
    errorKey: string,
    message?: string,
    errorParams?: Record<string, string | number>,
    extra: ExecutorErrorExtra = {},
  ) {
    super(message || errorKey);
    this.name = 'CatalogExecutorError';
    this.errorKey = errorKey;
    this.errorParams = errorParams;
    if (extra.createdExternalId) this.createdExternalId = extra.createdExternalId;
    if (extra.details) this.details = extra.details;
    if (extra.remainingPatch) this.remainingPatch = extra.remainingPatch;
  }
}

export type ExecutorErrorExtra = { createdExternalId?: string; details?: ExecutorFailureDetails; remainingPatch?: Record<string, unknown> };

/** The stored fieldPatch after a failure: `remaining` replaces keys (`null` drops one). */
export function applyRemainingPatch(patch: CatalogFieldPatch, remaining?: Record<string, unknown>): CatalogFieldPatch {
  if (!remaining) return patch;
  const out: Record<string, unknown> = { ...patch };
  for (const [k, v] of Object.entries(remaining)) {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete out[k];
    else out[k] = v;
  }
  return out as CatalogFieldPatch;
}

/** Best-effort HTTP status out of the three clients' error shapes. */
export function httpStatusOf(err: any): number | null {
  if (!err) return null;
  if (typeof err.status === 'number') return err.status;
  const msg = String(err.message || '');
  const m = msg.match(/(?:failed: |API |Wix API )(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

/** Map a raw client error to an executor error with a stable key. */
export function toExecutorError(err: unknown): CatalogExecutorError {
  if (err instanceof CatalogExecutorError) return err;
  const status = httpStatusOf(err);
  if (status === 401 || status === 403) return new CatalogExecutorError(`${ERR}.notConnected`, 'Marketplace auth failed');
  if (status === 404) return new CatalogExecutorError(`${ERR}.remoteMissing`, 'Product not found on marketplace');
  if (status === 429) return new CatalogExecutorError(`${ERR}.rateLimited`, 'Rate limited');
  return new CatalogExecutorError(`${ERR}.remoteFailed`, (err as any)?.message ? String((err as any).message).slice(0, 300) : 'Remote write failed');
}

/**
 * A step after the first successful write failed (marketplace-editors §5.2, §8): key
 * `listings.draftError.partial.<step>` (params `{ step }`). Steps: inventory, collections, media, images, seo,
 * variants, price.
 */
export function partialStepError(
  step: 'inventory' | 'collections' | 'media' | 'images' | 'seo' | 'variants' | 'price',
  cause: unknown,
  extra: ExecutorErrorExtra = {},
): CatalogExecutorError {
  const base = cause instanceof CatalogExecutorError ? cause : toExecutorError(cause);
  return new CatalogExecutorError(`${ERR}.partial.${step}`, base.message, { step }, {
    createdExternalId: extra.createdExternalId ?? base.createdExternalId,
    details: extra.details ?? base.details,
    remainingPatch: extra.remainingPatch ?? base.remainingPatch,
  });
}

// ---------------------------------------------------------------------------
// Executor contract (implemented in ./executors/*)
// ---------------------------------------------------------------------------

export type RemoteState = { exists: boolean; updatedAt: Date | null; values: CanonicalValues; raw?: unknown };

/** One Trendyol batch a draft is waiting on (stored in `baseSnapshot.sentBatches`). */
export type SentBatch = { kind: 'content' | 'price' | 'archive' | 'create'; batchRequestId: string; item: Record<string, unknown> };

export type ApplyOutcome =
  /** `externalId`: set by a create (the new product's id); the draft row is rewritten to it. */
  | { kind: 'synced'; applied: CanonicalValues; deleted?: boolean; externalId?: string }
  /**
   * `sent`: the exact item sent in the batch, stored on the draft so the cron's poll reports what was really sent.
   * `batches`: every batch this draft waits on (Trendyol content + price), stored as `baseSnapshot.sentBatches`.
   */
  | { kind: 'pending'; batchRequestId: string; sent?: Record<string, unknown>; batches?: SentBatch[] };
export type BatchOutcome =
  | { kind: 'synced'; applied: CanonicalValues; externalId?: string }
  | { kind: 'pending' }
  | { kind: 'failed'; errorKey: string; errorParams?: Record<string, string | number> };

export interface CatalogExecutorSession {
  /**
   * Live products by id. `opts.keys`: the union of the field keys the drafts patch, so a session can skip
   * extra reads nobody needs (Shopify SEO is read only when `seo` is among them).
   */
  readRemote(externalIds: string[], opts?: { keys?: string[] }): Promise<Map<string, RemoteState>>;
  /** Apply one draft. Throw CatalogExecutorError (or any error) to fail it. Creates arrive with remote.exists=false. */
  apply?(draft: CatalogDraftRecord, remote: RemoteState): Promise<ApplyOutcome>;
  /** Batch apply (Trendyol). Returns one outcome or error per draft id. */
  applyMany?(items: { draft: CatalogDraftRecord; remote: RemoteState }[]): Promise<Map<string, ApplyOutcome | CatalogExecutorError>>;
  /** Resolve an async batch (Trendyol). */
  pollBatch?(batchRequestId: string, drafts: CatalogDraftRecord[]): Promise<Map<string, BatchOutcome>>;
  /** Mirror an applied change into the local cache row (or delete it). */
  writeCache(externalId: string, applied: CanonicalValues, opts?: { deleted?: boolean }): Promise<void>;
}

export interface CatalogExecutor {
  open(userId: string, storeId: string): Promise<CatalogExecutorSession>;
}

export type CatalogExecutors = Record<CatalogMarketplace, CatalogExecutor>;

let defaultExecutors: CatalogExecutors | null = null;
async function loadDefaultExecutors(): Promise<CatalogExecutors> {
  if (defaultExecutors) return defaultExecutors;
  const [{ trendyolExecutor }, { wixExecutor }, { shopifyExecutor }] = await Promise.all([
    import('./executors/trendyol'),
    import('./executors/wix'),
    import('./executors/shopify'),
  ]);
  defaultExecutors = { trendyol: trendyolExecutor, wix: wixExecutor, shopify: shopifyExecutor };
  return defaultExecutors;
}

// ---------------------------------------------------------------------------
// DB access (guarded until BR-1a is deployed)
// ---------------------------------------------------------------------------

function delegate(): any | null {
  const d = (prisma as any).catalogDraft;
  return d && typeof d.findMany === 'function' ? d : null;
}

export function catalogDraftsAvailable(): boolean {
  return delegate() !== null;
}

function db(): any {
  const d = delegate();
  if (!d) throw new CatalogDraftError('UNAVAILABLE', 'CatalogDraft model is not deployed yet (backend BR-1a)');
  return d;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function asObject(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function asActions(v: unknown): CatalogQueuedAction[] {
  return Array.isArray(v) ? (v.filter((a) => a && typeof a === 'object' && typeof a.type === 'string') as CatalogQueuedAction[]) : [];
}

export function toRecord(row: any): CatalogDraftRecord {
  return {
    id: String(row.id),
    userId: String(row.userId),
    marketplace: row.marketplace,
    storeId: String(row.storeId),
    externalId: String(row.externalId),
    status: row.status,
    baseUpdatedAt: toDate(row.baseUpdatedAt),
    baseSnapshot: asObject(row.baseSnapshot),
    fieldPatch: asObject(row.fieldPatch) as CatalogFieldPatch,
    queuedActions: asActions(row.queuedActions),
    batchRequestId: row.batchRequestId ?? null,
    lastSyncError: row.lastSyncError ?? null,
    lastSyncErrorParams: row.lastSyncErrorParams && typeof row.lastSyncErrorParams === 'object' && !Array.isArray(row.lastSyncErrorParams) ? row.lastSyncErrorParams as Record<string, string | number> : null,
    scheduledSendAt: toDate(row.scheduledSendAt),
    createdAt: toDate(row.createdAt) || new Date(0),
    updatedAt: toDate(row.updatedAt) || new Date(0),
    syncedAt: toDate(row.syncedAt),
  };
}

export function toDTO(row: any): CatalogDraftDTO {
  const r = toRecord(row);
  const { userId: _userId, ...rest } = r;
  return {
    ...rest,
    baseUpdatedAt: r.baseUpdatedAt ? r.baseUpdatedAt.toISOString() : null,
    scheduledSendAt: r.scheduledSendAt ? r.scheduledSendAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    syncedAt: r.syncedAt ? r.syncedAt.toISOString() : null,
    queuedDelete: hasQueuedDelete(r.queuedActions),
    isCreate: hasPendingCreate(r.queuedActions),
  };
}

/** A staged create: `new:<id>` with an uncompleted `create` action. */
export function isCreateDraft(draft: Pick<CatalogDraftRecord, 'externalId' | 'queuedActions'>): boolean {
  return isNewExternalId(draft.externalId) && hasPendingCreate(draft.queuedActions);
}

/** A fresh `new:<id>` external id (24 lowercase base-36 chars, cuid-like). */
export function newCatalogExternalId(): string {
  const bytes = randomBytes(24);
  let out = 'c';
  for (const b of bytes) out += (b % 36).toString(36);
  return `${NEW_ID_PREFIX}${out.slice(0, 25)}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** One year ahead is the latest accepted schedule; one minute of clock skew is tolerated. */
export const SCHEDULE_MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
const SCHEDULE_SKEW_MS = 60 * 1000;

/**
 * `undefined` → leave unchanged · `null` → unschedule · ISO string → Date.
 * Throws CatalogDraftError('SCHEDULE_INVALID') for anything else, a past time
 * or a time more than a year ahead.
 */
export function parseScheduledSendAt(input: unknown, now: Date = new Date()): Date | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || input === '') return null;
  if (typeof input !== 'string') throw new CatalogDraftError('SCHEDULE_INVALID', 'scheduledSendAt must be an ISO string or null');
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new CatalogDraftError('SCHEDULE_INVALID', 'scheduledSendAt is not a valid date');
  if (d.getTime() < now.getTime() - SCHEDULE_SKEW_MS) throw new CatalogDraftError('SCHEDULE_INVALID', 'scheduledSendAt is in the past');
  if (d.getTime() > now.getTime() + SCHEDULE_MAX_AHEAD_MS) throw new CatalogDraftError('SCHEDULE_INVALID', 'scheduledSendAt is too far ahead');
  return d;
}

/** Shopify keys that write the single variant (refused on multi-variant products, like price/quantity). */
const SINGLE_VARIANT_KEYS: CatalogFieldKey[] = ['price', 'quantity', 'compareAtPrice', 'sku', 'weight', 'weightUnit'];

/**
 * Editability rules the grid and the editor also show, enforced server-side over the merged patch
 * (`patch` = the whole draft patch after this stage) and the product's base snapshot.
 */
export function assertEditable(marketplace: CatalogMarketplace, patch: CatalogFieldPatch, snapshot: CanonicalValues) {
  const multi = (snapshot.variantCount ?? 1) > 1;
  if (multi && marketplace === 'shopify' && SINGLE_VARIANT_KEYS.some((k) => patch[k] !== undefined)) {
    throw new CatalogDraftError('MULTI_VARIANT', 'Price and stock of products with variations are edited per variation');
  }
  if (multi && marketplace === 'wix' && (patch.price !== undefined || patch.quantity !== undefined || patch.inStock !== undefined)) {
    throw new CatalogDraftError('MULTI_VARIANT', 'Price and stock of products with variations are edited per variation');
  }
  // Wix may turn tracking on in the same draft; Shopify/Trendyol tracking is not editable here.
  const tracked = patch.trackInventory ?? snapshot.trackInventory;
  if (patch.quantity !== undefined && tracked === false) {
    throw new CatalogDraftError('NOT_TRACKED', 'Stock is not tracked for this product');
  }
  if (patch.inStock !== undefined && tracked !== false) {
    throw new CatalogDraftError('IN_STOCK_TRACKED', 'In stock is set by the quantity while stock is tracked');
  }
  if (patch.price !== undefined && marketplace === 'wix' && snapshot.discounted && patch.discount === undefined) {
    // Wix applies the discount on top of priceData.price: editing the shown
    // (discounted) price alone would write the base price and get discounted again.
    throw new CatalogDraftError('DISCOUNTED', 'Price of a discounted Wix product is edited together with its discount');
  }
  if (marketplace === 'wix' && patch.discount?.type === 'AMOUNT') {
    const price = patch.price ?? snapshot.price;
    if (typeof price === 'number' && patch.discount.value >= price) {
      throw new CatalogDraftError('INVALID_DISCOUNT', 'The discount must be below the price', { field: 'discount' });
    }
  }
  if (marketplace === 'trendyol') {
    if (snapshot.archived && Object.keys(patch).length > 0) {
      throw new CatalogDraftError('ARCHIVED', "Archived products can't be changed");
    }
    const sale = patch.price ?? snapshot.price;
    if (patch.listPrice !== undefined && typeof sale === 'number' && patch.listPrice < sale) {
      throw new CatalogDraftError('LIST_BELOW_SALE', 'The list price must not be below the sale price', { field: 'listPrice' });
    }
  }
}

/** A delete/archive cannot ride with field changes or a create (mirrors Etsy's assertDeleteIsExclusive). */
export function assertDeleteIsExclusive(patch: CatalogFieldPatch, actions: CatalogQueuedAction[]) {
  if (hasQueuedDelete(actions) && (Object.keys(patch).length > 0 || hasPendingCreate(actions))) {
    throw new CatalogDraftError('DELETE_NOT_EXCLUSIVE', 'A delete or archive cannot be combined with other staged changes');
  }
}

/** An unarchive (Trendyol) is sent alone: never next to an archive, a create or field changes. */
export function assertUnarchiveIsExclusive(patch: CatalogFieldPatch, actions: CatalogQueuedAction[]) {
  const open = actions.filter((a) => !a.completedAt);
  if (!open.some((a) => a.type === 'unarchive')) return;
  if (open.some((a) => a.type !== 'unarchive') || Object.keys(patch).length > 0) {
    throw new CatalogDraftError('DELETE_NOT_EXCLUSIVE', 'An unarchive cannot be combined with other staged changes');
  }
}

// ---------------------------------------------------------------------------
// Stores and cache rows
// ---------------------------------------------------------------------------

/** Resolve (and authorize) the store id: Trendyol supplierId · WixSite.id · ShopifyShop.id. */
export async function resolveStoreId(userId: string, marketplace: CatalogMarketplace, storeId?: string | null): Promise<string> {
  const wanted = storeId ? String(storeId) : null;
  if (marketplace === 'trendyol') {
    const cred = await prisma.credential.findUnique({ where: { userId }, select: { trendyolSupplierId: true } });
    const supplierId = cred?.trendyolSupplierId ? String(cred.trendyolSupplierId) : null;
    if (!supplierId || (wanted && wanted !== supplierId)) throw new CatalogDraftError('STORE_NOT_FOUND', 'Trendyol store not found');
    return supplierId;
  }
  if (marketplace === 'wix') {
    const site = await prisma.wixSite.findFirst({
      where: { userId, isActive: true, ...(wanted ? { id: wanted } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!site) throw new CatalogDraftError('STORE_NOT_FOUND', 'Wix site not found');
    return site.id;
  }
  const shop = await prisma.shopifyShop.findFirst({
    where: { userId, isActive: true, ...(wanted ? { id: wanted } : {}) },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!shop) throw new CatalogDraftError('STORE_NOT_FOUND', 'Shopify store not found');
  return shop.id;
}

/** Canonical snapshot + remote updated time from the cache row (null when not cached). */
export async function loadCacheSnapshot(
  userId: string,
  marketplace: CatalogMarketplace,
  storeId: string,
  externalId: string,
): Promise<{ snapshot: CanonicalValues; updatedAt: Date | null } | null> {
  if (marketplace === 'trendyol') {
    const p = await prisma.trendyolProduct.findUnique({
      where: { userId_supplierId_barcode: { userId, supplierId: storeId, barcode: externalId } },
    });
    if (!p) return null;
    return { snapshot: trendyolValuesFromCache(p), updatedAt: p.trendyolLastUpdate ?? null };
  }
  if (marketplace === 'wix') {
    const p = await prisma.wixProduct.findUnique({
      where: { userId_wixSiteId_wixProductId: { userId, wixSiteId: storeId, wixProductId: externalId } },
    });
    if (!p) return null;
    return { snapshot: wixValuesFromCache(p), updatedAt: p.wixUpdatedDate ?? null };
  }
  const p = await prisma.shopifyProduct.findUnique({
    where: { userId_shopifyShopId_shopifyProductId: { userId, shopifyShopId: storeId, shopifyProductId: externalId } },
  });
  if (!p) return null;
  return { snapshot: shopifyValuesFromCache(p), updatedAt: p.shopifyUpdatedAt ?? null };
}

/**
 * A product a create draft made (the draft's `create` is completed and its externalId is this id), not yet
 * in the local cache: the values that create staged that the editability rules read (single variant,
 * tracking), or null when no such draft exists.
 */
export async function createdProductBase(
  userId: string,
  marketplace: CatalogMarketplace,
  storeId: string,
  externalId: string,
): Promise<CanonicalValues | null> {
  const d = delegate();
  if (!d) return null;
  const rows = await d.findMany({
    where: { userId, marketplace, storeId, externalId, status: { in: [...OPEN_STATUSES, 'synced'] } },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  });
  const made = rows.map(toRecord).find((r: CatalogDraftRecord) => r.queuedActions.some((a) => a.type === 'create' && a.completedAt));
  if (!made) return null;
  const out: CanonicalValues = { variantCount: 1 };
  if (typeof made.fieldPatch.trackInventory === 'boolean') out.trackInventory = made.fieldPatch.trackInventory;
  return out;
}

/** True when stock sync owns this product's quantity (an active StockLink while stock sync is on). */
export async function isCatalogStockManaged(userId: string, marketplace: CatalogMarketplace, externalId: string): Promise<boolean> {
  try {
    const settings = await getStockSettings(userId);
    if (!isStockSyncActive(settings) || !channelEnabled(settings, marketplace)) return false;
    const link = await (prisma as any).stockLink.findFirst({
      where: { userId, channel: marketplace, externalId, status: 'active' },
      select: { id: true },
    });
    return Boolean(link);
  } catch (err) {
    logger.warn('catalogDrafts.stock_managed_check_failed', { userId, marketplace, externalId, error: String(err) });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stage / list / discard / schedule
// ---------------------------------------------------------------------------

export type StageInput = {
  userId: string;
  marketplace: CatalogMarketplace;
  storeId?: string | null;
  /** barcode | wixProductId | shopifyProductId; `new:<id>` for a staged create; `new` (or empty) + a create action = start one. */
  externalId: string;
  fields?: unknown;
  /** `[{ type }]`, and `[{ type: 'create', payload? }]` for a new product (payload merges into the pending create). */
  queuedActions?: unknown;
  /** Action types to drop from the queue (e.g. ['delete']). A pending `create` cannot be dropped (discard the draft). */
  removeQueuedActions?: unknown;
  scheduledSendAt?: unknown;
};

/**
 * Merge into the product's open draft, creating it (with the cache row as base
 * snapshot) when there is none. Same semantics as `stageEtsyDraft`:
 * fields merge key by key (`null` drops a key), queued actions dedupe by type,
 * a conflict stays a conflict, a failed draft returns to `draft`.
 * The one-open-draft invariant is enforced under a per-product advisory lock.
 *
 * Creates (marketplace-editors §5): `externalId` `new` (or empty) with `queuedActions: [{ type: 'create' }]`
 * starts a draft with a fresh `new:<id>` and an empty base; later stages use that `new:<id>`. Nothing is
 * written to the marketplace until the explicit send.
 */
export async function stageCatalogDraft(input: StageInput): Promise<CatalogDraftRecord> {
  const d = db();
  if (!isCatalogMarketplace(input.marketplace)) throw new CatalogDraftError('INVALID_MARKETPLACE', 'Unknown marketplace');
  const marketplace = input.marketplace;
  const { set, remove } = validateFieldPatch(marketplace, input.fields);
  const incomingActions = validateQueuedActions(marketplace, input.queuedActions);
  const removeTypes = Array.isArray(input.removeQueuedActions) ? input.removeQueuedActions.map(String) : [];
  const scheduledSendAt = parseScheduledSendAt(input.scheduledSendAt);
  const incomingCreate = Boolean(incomingActions?.some((a) => a.type === 'create'));

  let externalId = String(input.externalId ?? '').trim();
  if ((externalId === '' || externalId === 'new') && incomingCreate) externalId = newCatalogExternalId();
  if (!externalId || externalId.length > 200) throw new CatalogDraftError('INVALID_INPUT', 'externalId is required');
  const isNew = isNewExternalId(externalId);
  if (incomingCreate && !isNew) {
    throw new CatalogDraftError('ACTION_NOT_SUPPORTED', 'Only a new product (externalId new:<id>) can be created', { action: 'create' });
  }
  if (isNew && removeTypes.includes('create')) {
    throw new CatalogDraftError('INVALID_INPUT', 'A pending create cannot be removed; discard the draft instead');
  }
  const storeId = await resolveStoreId(input.userId, marketplace, input.storeId);

  // Creates have no cache row: an empty base (nothing to conflict with).
  let cached: { snapshot: CanonicalValues; updatedAt: Date | null } | null;
  /** Snapshot the editability rules check against (= the base, except for a product a create just made). */
  let rulesSnapshot: CanonicalValues | null = null;
  if (isNew) {
    cached = { snapshot: {}, updatedAt: null };
  } else {
    cached = await loadCacheSnapshot(input.userId, marketplace, storeId, externalId);
    if (!cached) {
      // A product made by a create has no cache row until the next pull: edit it on an empty base
      // (like markCreatedButFailed), with the values that create staged for the editability rules.
      const made = await createdProductBase(input.userId, marketplace, storeId, externalId);
      if (!made) throw new CatalogDraftError('PRODUCT_NOT_FOUND', 'Product is not in the local cache; refresh first');
      cached = { snapshot: {}, updatedAt: null };
      rulesSnapshot = made;
    }
  }
  const snapshot = cached.snapshot;
  if (!isNew && touchesStock(set) && (await isCatalogStockManaged(input.userId, marketplace, externalId))) {
    throw new CatalogDraftError('STOCK_MANAGED', 'Stock sync manages this quantity');
  }

  const lockKey = `catalogDraft:${input.userId}:${marketplace}:${storeId}:${externalId}`;
  const row = await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const txd = tx.catalogDraft ?? d;
    const existing = await txd.findFirst({
      where: { userId: input.userId, marketplace, storeId, externalId, status: { in: OPEN_STATUSES } },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing && existing.status === 'syncing') {
      throw new CatalogDraftError('DRAFT_NOT_EDITABLE', 'Draft is being sent', { status: 'syncing' });
    }
    const prev = existing ? toRecord(existing) : null;
    if (isNew && !prev && !incomingCreate) {
      // A `new:<id>` that is not open any more (sent, discarded) or never existed.
      throw new CatalogDraftError('DRAFT_NOT_FOUND', 'This new product draft no longer exists');
    }
    const fieldPatch: CatalogFieldPatch = { ...(prev?.fieldPatch || {}), ...set };
    for (const k of remove) delete (fieldPatch as Record<string, unknown>)[k];
    let actions = prev?.queuedActions || [];
    if (incomingActions) actions = mergeQueuedActions(actions, incomingActions);
    if (removeTypes.length) actions = actions.filter((a) => a.completedAt || !removeTypes.includes(a.type));
    assertDeleteIsExclusive(fieldPatch, actions);
    assertUnarchiveIsExclusive(fieldPatch, actions);
    // Check the whole draft as it will be sent (only on what this stage touches, so an old draft whose
    // product changed since is still editable until its send re-checks it).
    if (Object.keys(set).length > 0) assertEditable(marketplace, fieldPatch, rulesSnapshot ?? snapshot);
    if (scheduledSendAt && hasQueuedDelete(actions)) {
      throw new CatalogDraftError('SCHEDULE_DELETE_REFUSED', 'A delete or archive cannot be scheduled');
    }
    if (scheduledSendAt && prev?.status === 'conflict') {
      throw new CatalogDraftError('DRAFT_NOT_EDITABLE', 'A conflicted draft must be reviewed before it can be scheduled', { status: 'conflict' });
    }

    if (!prev) {
      return txd.create({
        data: {
          userId: input.userId,
          marketplace,
          storeId,
          externalId,
          status: 'draft',
          baseUpdatedAt: cached.updatedAt,
          baseSnapshot: snapshot,
          fieldPatch,
          queuedActions: actions,
          ...(scheduledSendAt !== undefined ? { scheduledSendAt } : {}),
        },
      });
    }
    return txd.update({
      where: { id: prev.id },
      data: {
        // A conflict stays a conflict until the seller discards or the remote
        // matches again at the next send; editing never clears it silently.
        status: prev.status === 'conflict' ? 'conflict' : 'draft',
        lastSyncError: prev.status === 'conflict' ? prev.lastSyncError : null,
        fieldPatch,
        queuedActions: actions,
        ...(scheduledSendAt !== undefined ? { scheduledSendAt } : {}),
      },
    });
  });
  // A stage that removed fields / actions or unscheduled may leave nothing to send: close the draft.
  if ((remove.length > 0 || removeTypes.length > 0 || scheduledSendAt === null) && (await cancelDraftIfEmpty(String(row.id), input.userId))) {
    return getCatalogDraft(String(row.id), input.userId);
  }
  return toRecord(row);
}

export async function listCatalogDrafts(params: {
  userId: string;
  marketplace: CatalogMarketplace;
  storeId?: string | null;
  externalIds?: string[];
  /** Also return drafts synced within the last 24 h (row overlay "Sent"). */
  includeRecentSynced?: boolean;
  /** Only drafts with a scheduledSendAt (Scheduled sends panel). */
  scheduledOnly?: boolean;
}): Promise<CatalogDraftRecord[]> {
  const d = db();
  const storeId = await resolveStoreId(params.userId, params.marketplace, params.storeId);
  const statusOr: any[] = [{ status: { in: OPEN_STATUSES } }];
  if (params.includeRecentSynced) statusOr.push({ status: 'synced', syncedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
  const rows = await d.findMany({
    where: {
      userId: params.userId,
      marketplace: params.marketplace,
      storeId,
      ...(params.externalIds?.length ? { externalId: { in: params.externalIds.slice(0, 1000) } } : {}),
      ...(params.scheduledOnly ? { scheduledSendAt: { not: null } } : {}),
      OR: statusOr,
    },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  });
  // An open draft whose every change was undone holds nothing to send: it is not a pending change.
  return rows.map(toRecord).filter((r: CatalogDraftRecord) => !((SENDABLE_STATUSES as string[]).includes(r.status) && isDraftEmpty(r)));
}

export async function getCatalogDraft(id: string, userId: string): Promise<CatalogDraftRecord> {
  const row = await db().findFirst({ where: { id, userId } });
  if (!row) throw new CatalogDraftError('DRAFT_NOT_FOUND', 'Draft not found');
  return toRecord(row);
}

/**
 * True when the draft holds nothing to send: no non-empty field patch, no queued action and no scheduledSendAt
 * (lib/drafts/emptyDraft).
 */
export function isDraftEmpty(draft: Pick<CatalogDraftRecord, 'fieldPatch' | 'queuedActions' | 'scheduledSendAt'>, opts: EmptyDraftOptions = {}): boolean {
  return isCatalogDraftEmpty(draft as Record<string, any>, opts);
}

/**
 * Cancel an open draft (draft / failed / conflict) that holds nothing any more (every staged change undone).
 * Keeps the row (status `cancelled`), never calls the marketplace. Atomic on the checked row version
 * (status + updatedAt), so it cannot race a send claim or a new stage. True when cancelled.
 */
export async function cancelDraftIfEmpty(id: string, userId: string, opts: EmptyDraftOptions = {}): Promise<boolean> {
  const d = db();
  const row = await d.findFirst({ where: { id, userId } });
  if (!row) return false;
  const draft = toRecord(row);
  if (!(SENDABLE_STATUSES as string[]).includes(draft.status) || !isDraftEmpty(draft, opts)) return false;
  const res = await d.updateMany({
    where: { id, userId, status: draft.status, updatedAt: row.updatedAt },
    data: { status: 'cancelled', scheduledSendAt: null },
  });
  if (res.count === 0) return false;
  logger.info('catalogDrafts.cancelled_empty', { userId, draftId: id, marketplace: draft.marketplace });
  return true;
}

/** Discard = status `cancelled` (the row stays for history). Refused while sending. */
export async function discardCatalogDraft(id: string, userId: string): Promise<CatalogDraftRecord> {
  const d = db();
  const res = await d.updateMany({
    where: { id, userId, status: { in: SENDABLE_STATUSES } },
    data: { status: 'cancelled', scheduledSendAt: null },
  });
  if (res.count === 0) {
    const row = await d.findFirst({ where: { id, userId } });
    if (!row) throw new CatalogDraftError('DRAFT_NOT_FOUND', 'Draft not found');
    if (row.status === 'cancelled') return toRecord(row);
    throw new CatalogDraftError('DRAFT_NOT_EDITABLE', `Draft is not discardable (${row.status})`, { status: row.status });
  }
  return getCatalogDraft(id, userId);
}

/** PATCH: change the schedule and/or un-queue actions on an open draft. */
export async function patchCatalogDraft(
  id: string,
  userId: string,
  patch: { scheduledSendAt?: unknown; removeQueuedActions?: unknown },
): Promise<CatalogDraftRecord> {
  const d = db();
  const scheduledSendAt = parseScheduledSendAt(patch.scheduledSendAt);
  const removeTypes = Array.isArray(patch.removeQueuedActions) ? patch.removeQueuedActions.map(String) : [];
  if (scheduledSendAt === undefined && removeTypes.length === 0) {
    throw new CatalogDraftError('INVALID_INPUT', 'Nothing to change: pass scheduledSendAt and/or removeQueuedActions');
  }
  if (removeTypes.includes('create')) {
    throw new CatalogDraftError('INVALID_INPUT', 'A pending create cannot be removed; discard the draft instead');
  }
  const current = await getCatalogDraft(id, userId);
  if (!(SENDABLE_STATUSES as string[]).includes(current.status)) {
    throw new CatalogDraftError('DRAFT_NOT_EDITABLE', `Draft is not editable (${current.status})`, { status: current.status });
  }
  const actions = removeTypes.length ? current.queuedActions.filter((a) => a.completedAt || !removeTypes.includes(a.type)) : current.queuedActions;
  if (scheduledSendAt && hasQueuedDelete(actions)) {
    throw new CatalogDraftError('SCHEDULE_DELETE_REFUSED', 'A delete or archive cannot be scheduled');
  }
  if (scheduledSendAt && current.status === 'conflict') {
    throw new CatalogDraftError('DRAFT_NOT_EDITABLE', 'A conflicted draft must be reviewed before it can be scheduled', { status: 'conflict' });
  }
  const res = await d.updateMany({
    where: { id, userId, status: { in: SENDABLE_STATUSES } },
    data: {
      ...(scheduledSendAt !== undefined ? { scheduledSendAt } : {}),
      ...(removeTypes.length ? { queuedActions: actions } : {}),
    },
  });
  if (res.count === 0) throw new CatalogDraftError('DRAFT_NOT_EDITABLE', 'Draft changed while updating');
  // Un-queuing the last action / unscheduling may leave nothing to send: close the draft.
  await cancelDraftIfEmpty(id, userId);
  return getCatalogDraft(id, userId);
}

/** Statuses a seller may rebase / resolve from ("Review differences" → "Keep my changes" / "Keep my choices"). */
export const REBASABLE_STATUSES: CatalogDraftStatus[] = ['conflict', 'failed'];
/** Statuses Review differences can be opened on (read only). */
export const DIFFABLE_STATUSES: CatalogDraftStatus[] = ['draft', 'failed', 'conflict'];

function stripMeta(snapshot: Record<string, unknown>): Record<string, unknown> {
  const out = { ...snapshot };
  for (const k of SNAPSHOT_META_KEYS) delete out[k];
  return out;
}

/** Read one product live through the draft's executor (CatalogDraftError on failure / gone). */
async function readLiveProduct(current: CatalogDraftRecord, executors: CatalogExecutors): Promise<RemoteState> {
  let remote: RemoteState | undefined;
  try {
    const session = await executors[current.marketplace].open(current.userId, current.storeId);
    remote = (await session.readRemote([current.externalId], { keys: Object.keys(current.fieldPatch) })).get(current.externalId);
  } catch (err) {
    const e = toExecutorError(err);
    if (e.errorKey === `${ERR}.remoteMissing`) throw new CatalogDraftError('REMOTE_MISSING', 'Product not found on the marketplace');
    throw new CatalogDraftError('REMOTE_FAILED', e.message);
  }
  if (!remote?.exists) throw new CatalogDraftError('REMOTE_MISSING', 'Product not found on the marketplace');
  return remote;
}

/**
 * "Keep my choices" after Review differences (marketplace-editors §6 conflict check; listing-editor §6.4
 * contract). Re-reads the product, drops from the patch every field that changed on the marketplace and is
 * NOT in `keep` (the seller chose the marketplace's value), keeps every other staged field, takes the live
 * product as the new base (`baseSnapshot` / `baseUpdatedAt`) and puts the draft back to `draft`.
 * It never sends and never touches queued actions (a queued delete is removed only through
 * PATCH removeQueuedActions). The remaining patch must still be allowed on the new base.
 * `keep = null` keeps every staged field (= `rebaseCatalogDraft`).
 */
export async function resolveCatalogDraft(
  id: string,
  userId: string,
  keep: string[] | null,
  opts: { executors?: CatalogExecutors } = {},
): Promise<CatalogDraftRecord> {
  const d = db();
  const current = await getCatalogDraft(id, userId);
  if (!(REBASABLE_STATUSES as string[]).includes(current.status)) {
    throw new CatalogDraftError('DRAFT_NOT_EDITABLE', `Draft cannot be rebased (${current.status})`, { status: current.status });
  }
  if (isCreateDraft(current)) throw new CatalogDraftError('CREATE_DRAFT', 'A new product has nothing to compare yet');
  const executors = opts.executors || (await loadDefaultExecutors());
  const remote = await readLiveProduct(current, executors);

  const fieldPatch: CatalogFieldPatch = { ...current.fieldPatch };
  const dropped: string[] = [];
  if (keep) {
    const kept = new Set(keep);
    for (const key of conflictingKeys(current, remote)) {
      if (!kept.has(key)) {
        delete (fieldPatch as Record<string, unknown>)[key];
        dropped.push(key);
      }
    }
  }
  // The new base must still allow the staged edit (variants added, stock
  // tracking turned off or a Wix sale price since the draft started).
  const baseSnapshot = { ...stripMeta(current.baseSnapshot), ...remote.values };
  assertEditable(current.marketplace, fieldPatch, baseSnapshot);
  const res = await d.updateMany({
    // Only if nothing changed the draft since it was read (no stage, send or discard in between).
    where: { id, userId, status: current.status, updatedAt: current.updatedAt },
    data: { status: 'draft', lastSyncError: null, lastSyncErrorParams: Prisma.DbNull, baseSnapshot, baseUpdatedAt: remote.updatedAt ?? null, fieldPatch },
  });
  if (res.count === 0) throw new CatalogDraftError('DRAFT_NOT_EDITABLE', 'Draft changed while rebasing');
  logger.info('catalogDrafts.resolve', { userId, draftId: id, marketplace: current.marketplace, from: current.status, dropped });
  // Keeping the marketplace's value for every staged field leaves nothing to send: close the draft.
  if (dropped.length) await cancelDraftIfEmpty(id, userId);
  return getCatalogDraft(id, userId);
}

/**
 * "Keep my changes" after reviewing a conflict (listings-grid §6.2/§6.4
 * Review differences): `resolveCatalogDraft` keeping every staged field.
 * It never sends: the seller still sends explicitly, and that send runs the
 * normal conflict check against the new base. A product that is gone
 * remotely cannot be rebased (discard is the way out).
 */
export async function rebaseCatalogDraft(
  id: string,
  userId: string,
  opts: { executors?: CatalogExecutors } = {},
): Promise<CatalogDraftRecord> {
  return resolveCatalogDraft(id, userId, null, opts);
}

// ---------------------------------------------------------------------------
// Conflict check and diff
// ---------------------------------------------------------------------------

/** Patch keys compared for conflicts (op lists are never compared: stale ids are skipped at send). */
function comparedPatchKeys(draft: CatalogDraftRecord): string[] {
  return Object.keys(draft.fieldPatch).filter((k) => !isOpKey(draft.marketplace, k));
}

function hasKey(obj: Record<string, unknown>, k: string): boolean {
  return k in obj && obj[k] !== undefined;
}

/**
 * Per patched key: did the marketplace change it after the base, and does the remote not already hold the
 * patched value (an earlier, partly failed send applied it)? Only keys known on both sides are compared.
 */
function fieldConflicts(draft: CatalogDraftRecord, remote: RemoteState): { comparable: string[]; changed: string[] } {
  const base = draft.baseSnapshot as Record<string, unknown>;
  const live = remote.values as Record<string, unknown>;
  const patch = draft.fieldPatch as Record<string, unknown>;
  const comparable = comparedPatchKeys(draft).filter((k) => hasKey(base, k) && hasKey(live, k));
  const changed = comparable.filter((k) => {
    const remoteV = scopedToPatch(k, live[k], patch[k]);
    if (sameValue(k, remoteV, scopedPatchValue(k, patch[k]))) return false;
    return !sameValue(k, scopedToPatch(k, base[k], patch[k]), remoteV);
  });
  return { comparable, changed };
}

/** Patched keys that changed remotely (what Review differences asks about). */
export function conflictingKeys(draft: CatalogDraftRecord, remote: RemoteState): string[] {
  return fieldConflicts(draft, remote).changed;
}

/**
 * Did the product change remotely after the draft's base?
 *  - Product gone → conflict.
 *  - Remote updated time known and not newer than the base → no conflict.
 *  - Otherwise compare each patched field (base snapshot vs remote): any
 *    difference is a conflict, unless the remote already holds the patched
 *    value (already applied by an earlier partial send). When no field can be compared, a newer remote
 *    timestamp alone is a conflict (conservative). Without timestamps
 *    (Trendyol) only the field comparison counts.
 *  - Operation lists (Wix `media`, Shopify `images`) are never compared; patches holding only those never
 *    conflict (the executor validates every id against the live product and skips stale ones).
 * Queued delete/archive drafts only check that the product still exists.
 */
export function detectConflict(draft: CatalogDraftRecord, remote: RemoteState): { conflict: boolean; changedFields: string[] } {
  if (!remote.exists) return { conflict: true, changedFields: [] };
  if (comparedPatchKeys(draft).length === 0) return { conflict: false, changedFields: [] };
  const base = draft.baseUpdatedAt;
  const newer = base && remote.updatedAt ? remote.updatedAt.getTime() > base.getTime() : null;
  if (newer === false) return { conflict: false, changedFields: [] };
  const { comparable, changed } = fieldConflicts(draft, remote);
  if (changed.length) return { conflict: true, changedFields: changed };
  if (comparable.length === 0 && newer === true) return { conflict: true, changedFields: [] };
  return { conflict: false, changedFields: [] };
}

/** One field of GET /api/catalog-drafts/:id/diff (same contract as pages/api/etsy-drafts/[id]/diff.ts). */
export type CatalogDiffField = {
  /** Canonical fieldPatch key (`title`, `price`, `seo`, `variants`, ...). */
  key: string;
  /** Value in the draft's base snapshot (seo/variants: only the parts the draft touches). */
  base: unknown;
  /** Value on the marketplace now (same scoping). */
  remote: unknown;
  /** Staged value (undefined when `inDraft` is false). */
  draft: unknown;
  changedRemotely: boolean;
  inDraft: boolean;
};
export type CatalogDraftDiff = {
  remoteUpdatedAt: string | null;
  /** Both sides first, then draft-only, then marketplace-only. */
  fields: CatalogDiffField[];
  /** Uncompleted queued actions, a delete/archive first. */
  queuedActions: CatalogQueuedAction[];
  hasQueuedDelete: boolean;
};

/** Keys never shown in the diff (bookkeeping and derived flags). */
const DIFF_HIDDEN = new Set([...SNAPSHOT_META_KEYS, 'variantCount', 'discounted', 'discountPrice', 'mediaItems', 'archived', 'productMainId', 'brandId', 'categoryId', 'cargoCompanyId']);

/** Pure: the diff of a draft against a live product (exported for tests). */
export function buildCatalogDiff(draft: CatalogDraftRecord, remote: RemoteState): CatalogDraftDiff {
  const base = draft.baseSnapshot as Record<string, unknown>;
  const live = remote.values as Record<string, unknown>;
  const patch = draft.fieldPatch as Record<string, unknown>;
  const allowed = new Set<string>(ALLOWED_FIELDS[draft.marketplace]);
  const changedSet = new Set(conflictingKeys(draft, remote));
  const fields: CatalogDiffField[] = [];
  const keys = new Set<string>([...Object.keys(patch), ...Object.keys(base).filter((k) => allowed.has(k))]);
  for (const key of Array.from(keys)) {
    if (DIFF_HIDDEN.has(key)) continue;
    const inDraft = hasKey(patch, key);
    if (inDraft) {
      const op = isOpKey(draft.marketplace, key);
      fields.push({
        key,
        base: op ? undefined : scopedToPatch(key, base[key], patch[key]),
        remote: op ? live.mediaItems ?? undefined : scopedToPatch(key, live[key], patch[key]),
        draft: scopedPatchValue(key, patch[key]),
        changedRemotely: changedSet.has(key),
        inDraft: true,
      });
    } else if (hasKey(base, key) && hasKey(live, key) && comparableValue(key, base[key]) !== comparableValue(key, live[key])) {
      fields.push({ key, base: base[key], remote: live[key], draft: undefined, changedRemotely: true, inDraft: false });
    }
  }
  const rank = (f: CatalogDiffField) => (f.inDraft && f.changedRemotely ? 0 : f.inDraft ? 1 : 2);
  const sorted = fields.map((f, i) => ({ f, i })).sort((x, y) => rank(x.f) - rank(y.f) || x.i - y.i).map(({ f }) => f);
  const open = draft.queuedActions.filter((a) => !a.completedAt);
  const isDel = (a: CatalogQueuedAction) => a.type === 'delete' || a.type === 'archive';
  return {
    remoteUpdatedAt: remote.updatedAt ? remote.updatedAt.toISOString() : null,
    fields: sorted,
    queuedActions: [...open.filter(isDel), ...open.filter((a) => !isDel(a))],
    hasQueuedDelete: hasQueuedDelete(draft.queuedActions),
  };
}

/** Review differences data: the draft against the live product. Read-only; never sends. */
export async function getCatalogDraftDiff(id: string, userId: string, opts: { executors?: CatalogExecutors } = {}): Promise<CatalogDraftDiff> {
  const current = await getCatalogDraft(id, userId);
  if (!(DIFFABLE_STATUSES as string[]).includes(current.status)) {
    throw new CatalogDraftError('DRAFT_NOT_EDITABLE', `Draft cannot be compared (${current.status})`, { status: current.status });
  }
  if (isCreateDraft(current)) throw new CatalogDraftError('CREATE_DRAFT', 'A new product has nothing to compare yet');
  const executors = opts.executors || (await loadDefaultExecutors());
  const remote = await readLiveProduct(current, executors);
  return buildCatalogDiff(current, remote);
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type SendOptions = {
  /** Draft ids whose queued delete/archive the seller confirmed (type-to-confirm). Others are skipped. */
  confirmDeleteIds?: string[];
  /** Test / cron injection. */
  executors?: CatalogExecutors;
  /** Pause between per-draft writes (rate limits). Default 250 ms. */
  interDraftDelayMs?: number;
  now?: () => Date;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emptySummary(): SendSummary {
  return { results: [], sent: [], failed: [], conflicts: [], pending: [], skipped: [] };
}

function pushResult(summary: SendSummary, r: SendResult) {
  summary.results.push(r);
  if (r.status === 'success') summary.sent.push(r.draftId);
  else if (r.status === 'failed') summary.failed.push({ id: r.draftId, errorKey: r.errorKey || `${ERR}.remoteFailed`, ...(r.errorParams ? { errorParams: r.errorParams } : {}) });
  else if (r.status === 'conflict') summary.conflicts.push(r.draftId);
  else if (r.status === 'pending') summary.pending.push(r.draftId);
  else if (r.status === 'skipped' && r.reason) summary.skipped.push({ id: r.draftId, reason: r.reason });
}

/**
 * Stored with the key so the exact reason survives a reload: the key's ICU params plus `detail`, the
 * marketplace's own message (shown under general keys such as `remoteFailed`). Pure, exported for tests.
 */
export function failureParamsOf(e?: { errorParams?: Record<string, string | number>; message?: string; errorKey?: string } | null): Record<string, string | number> | null {
  if (!e) return null;
  const out: Record<string, string | number> = { ...(e.errorParams || {}) };
  const detail = marketplaceDetail(e.message && e.message !== e.errorKey ? e.message : null);
  if (detail) out.detail = detail.slice(0, 300);
  return Object.keys(out).length ? out : null;
}

async function markFailed(draftId: string, errorKey: string, fieldPatch?: CatalogFieldPatch, e?: Parameters<typeof failureParamsOf>[0]) {
  await db().update({
    where: { id: draftId },
    data: { status: 'failed', lastSyncError: errorKey, lastSyncErrorParams: failureParamsOf(e) ?? Prisma.DbNull, batchRequestId: null, ...(fieldPatch ? { fieldPatch } : {}) },
  });
}

/**
 * A create step failed after the product was created: the draft becomes an edit draft of the new product
 * (externalId rewritten, `create` completed, empty base so nothing conflicts) and is marked failed, so a retry
 * re-runs the remaining steps on that product and never creates a second one.
 */
async function markCreatedButFailed(draft: CatalogDraftRecord, externalId: string, errorKey: string, now: Date, remaining?: Record<string, unknown>, e?: Parameters<typeof failureParamsOf>[0]) {
  const queuedActions = draft.queuedActions.map((a) => (a.type === 'create' && !a.completedAt ? { ...a, completedAt: now.toISOString() } : a));
  await db().update({
    where: { id: draft.id },
    data: {
      status: 'failed', lastSyncError: errorKey, lastSyncErrorParams: failureParamsOf(e) ?? Prisma.DbNull, batchRequestId: null, externalId, queuedActions, baseSnapshot: {}, baseUpdatedAt: null,
      ...(remaining ? { fieldPatch: applyRemainingPatch(draft.fieldPatch, remaining) } : {}),
    },
  });
}

async function markSynced(
  session: CatalogExecutorSession,
  draft: CatalogDraftRecord,
  applied: CanonicalValues,
  deleted: boolean,
  now: Date,
  newExternalId?: string,
) {
  const completedActions = draft.queuedActions.map((a) => (a.completedAt ? a : { ...a, completedAt: now.toISOString() }));
  const externalId = newExternalId && newExternalId !== draft.externalId ? newExternalId : null;
  await db().update({
    where: { id: draft.id },
    data: {
      status: 'synced', syncedAt: now, lastSyncError: null, lastSyncErrorParams: Prisma.DbNull, batchRequestId: null, scheduledSendAt: null, queuedActions: completedActions,
      ...(externalId ? { externalId } : {}),
    },
  });
  try {
    await session.writeCache(externalId || draft.externalId, applied, { deleted });
  } catch (err) {
    // The marketplace has the change; the next pull fixes the cache.
    logger.warn('catalogDrafts.cache_write_failed', { draftId: draft.id, error: String(err) });
  }
}

/**
 * Recompute listing health for the sent ids (listings-grid §9.3/§9.4) so the
 * Health column, `needs_work` and the health sort follow a send without a full
 * pull. Best effort: a health refresh never fails a send.
 */
async function refreshHealthBestEffort(marketplace: CatalogMarketplace, storeId: string, userId: string, ids: string[]) {
  if (ids.length === 0) return;
  try {
    const { refreshHealth } = await import('@/lib/listings/refreshHealth');
    const res = await refreshHealth(marketplace, { storeId, userId, ids });
    if (res?.error) logger.warn('catalogDrafts.health_refresh_failed', { marketplace, storeId, userId, error: res.error });
  } catch (err) {
    logger.warn('catalogDrafts.health_refresh_failed', { marketplace, storeId, userId, error: String(err) });
  }
}

/**
 * Send drafts (≤ 500). Per draft: skip queued deletes not in confirmDeleteIds,
 * claim atomically (`draft|failed|conflict` or a stale `syncing` → `syncing`),
 * re-read the remote product, mark `conflict` when it changed (never forced),
 * otherwise apply through the marketplace executor. Failures keep the draft as
 * `failed` with an i18n key in lastSyncError. Trendyol batches that are not
 * final yet stay `syncing` with `batchRequestId` and resolve via
 * `resolvePendingCatalogBatches` (cron).
 */
export async function sendCatalogDrafts(userId: string, draftIds: string[], opts: SendOptions = {}): Promise<SendSummary> {
  const d = db();
  const ids = Array.from(new Set((draftIds || []).map(String).filter(Boolean)));
  if (ids.length === 0) throw new CatalogDraftError('INVALID_INPUT', 'draftIds is required');
  if (ids.length > MAX_SEND_DRAFTS) throw new CatalogDraftError('TOO_MANY', `At most ${MAX_SEND_DRAFTS} drafts per send`, { max: MAX_SEND_DRAFTS });
  const now = opts.now || (() => new Date());
  const executors = opts.executors || (await loadDefaultExecutors());
  const confirmed = new Set((opts.confirmDeleteIds || []).map(String));
  const delayMs = opts.interDraftDelayMs ?? 250;
  const summary = emptySummary();

  const rows = await d.findMany({ where: { id: { in: ids }, userId } });
  const byId = new Map<string, CatalogDraftRecord>(rows.map((r: any) => [String(r.id), toRecord(r)]));

  // 1. Pre-filter and claim.
  const claimed: CatalogDraftRecord[] = [];
  for (const id of ids) {
    const draft = byId.get(id);
    if (!draft) {
      pushResult(summary, { draftId: id, status: 'skipped', reason: 'not_found' });
      continue;
    }
    if (hasQueuedDelete(draft.queuedActions) && !confirmed.has(id)) {
      pushResult(summary, { draftId: id, status: 'skipped', reason: 'queued_delete' });
      continue;
    }
    // Nothing staged any more (every change undone): cancel instead of calling the marketplace. Conditional on
    // the version read above, so a stage landing in between is sent normally.
    if ((SENDABLE_STATUSES as string[]).includes(draft.status) && isDraftEmpty(draft, { ignoreSchedule: true })) {
      const cancel = await d.updateMany({
        where: { id, userId, status: draft.status, updatedAt: draft.updatedAt },
        data: { status: 'cancelled', scheduledSendAt: null },
      });
      if (cancel.count === 1) {
        pushResult(summary, { draftId: id, status: 'skipped', reason: 'empty' });
        continue;
      }
    }
    const staleCutoff = new Date(now().getTime() - STALE_SYNCING_MS);
    const claim = await d.updateMany({
      where: {
        id,
        userId,
        OR: [
          { status: { in: SENDABLE_STATUSES } },
          { status: 'syncing', batchRequestId: null, updatedAt: { lt: staleCutoff } },
        ],
      },
      data: { status: 'syncing', lastSyncError: null },
    });
    if (claim.count === 0) {
      pushResult(summary, { draftId: id, status: 'skipped', reason: 'not_sendable' });
      continue;
    }
    // Re-read after the claim: a stage that landed between the read above and
    // the claim must be the version that is sent (and marked synced), and a
    // delete queued in that window must still need its confirmation.
    const freshRow = await d.findFirst({ where: { id, userId } });
    const fresh = freshRow ? toRecord(freshRow) : null;
    if (!fresh || fresh.status !== 'syncing') {
      pushResult(summary, { draftId: id, status: 'skipped', reason: 'not_sendable' });
      continue;
    }
    if (hasQueuedDelete(fresh.queuedActions) && !confirmed.has(id)) {
      const back: CatalogDraftStatus = (SENDABLE_STATUSES as string[]).includes(draft.status) ? draft.status : 'draft';
      await d.updateMany({ where: { id, userId, status: 'syncing' }, data: { status: back, lastSyncError: draft.lastSyncError } });
      pushResult(summary, { draftId: id, status: 'skipped', reason: 'queued_delete' });
      continue;
    }
    claimed.push(fresh);
  }

  // 2. Per marketplace + store: one executor session.
  const groups = new Map<string, CatalogDraftRecord[]>();
  for (const draft of claimed) {
    const key = `${draft.marketplace}|${draft.storeId}`;
    groups.set(key, [...(groups.get(key) || []), draft]);
  }

  for (const drafts of Array.from(groups.values())) {
    const { marketplace, storeId } = drafts[0];
    let session: CatalogExecutorSession;
    try {
      session = await executors[marketplace].open(userId, storeId);
    } catch (err) {
      const e = toExecutorError(err);
      for (const draft of drafts) {
        await markFailed(draft.id, e.errorKey, undefined, e);
        pushResult(summary, { draftId: draft.id, status: 'failed', errorKey: e.errorKey, errorParams: e.errorParams });
      }
      continue;
    }

    // Creates have nothing to read: they apply against an absent remote and skip the conflict check.
    const edits = drafts.filter((x) => !isCreateDraft(x));
    let remotes: Map<string, RemoteState>;
    try {
      const keys = Array.from(new Set(edits.flatMap((x) => Object.keys(x.fieldPatch))));
      remotes = edits.length ? await session.readRemote(edits.map((x) => x.externalId), { keys }) : new Map();
    } catch (err) {
      const e = toExecutorError(err);
      for (const draft of drafts) {
        await markFailed(draft.id, e.errorKey, undefined, e);
        pushResult(summary, { draftId: draft.id, status: 'failed', errorKey: e.errorKey, errorParams: e.errorParams });
      }
      continue;
    }

    // 3. Conflict check (never forced) and the stock-managed guard.
    const ready: { draft: CatalogDraftRecord; remote: RemoteState }[] = [];
    for (const draft of drafts) {
      const remote = remotes.get(draft.externalId) || { exists: false, updatedAt: null, values: {} };
      if (isCreateDraft(draft)) {
        ready.push({ draft, remote });
        continue;
      }
      const { conflict, changedFields } = detectConflict(draft, remote);
      if (conflict) {
        const key = remote.exists ? `${ERR}.conflict` : `${ERR}.remoteMissing`;
        await d.update({ where: { id: draft.id }, data: { status: 'conflict', lastSyncError: key } });
        pushResult(summary, { draftId: draft.id, status: 'conflict', errorKey: key, changedFields });
        continue;
      }
      if (touchesStock(draft.fieldPatch) && (await isCatalogStockManaged(userId, marketplace, draft.externalId))) {
        const key = ERROR_META.STOCK_MANAGED.key;
        await markFailed(draft.id, key);
        pushResult(summary, { draftId: draft.id, status: 'failed', errorKey: key });
        continue;
      }
      ready.push({ draft, remote });
    }
    if (ready.length === 0) continue;

    // 4. Apply.
    const healthIds: string[] = [];
    const outcomes = new Map<string, ApplyOutcome | CatalogExecutorError>();
    if (session.applyMany) {
      try {
        const res = await session.applyMany(ready);
        res.forEach((v, k) => outcomes.set(k, v));
      } catch (err) {
        const e = toExecutorError(err);
        for (const { draft } of ready) outcomes.set(draft.id, e);
      }
    } else if (session.apply) {
      for (let i = 0; i < ready.length; i++) {
        const { draft, remote } = ready[i];
        try {
          outcomes.set(draft.id, await session.apply(draft, remote));
        } catch (err) {
          outcomes.set(draft.id, toExecutorError(err));
        }
        if (delayMs > 0 && i < ready.length - 1) await sleep(delayMs);
      }
    }

    for (const { draft } of ready) {
      const out = outcomes.get(draft.id) || new CatalogExecutorError(`${ERR}.remoteFailed`, 'No result from executor');
      if (out instanceof CatalogExecutorError) {
        const created = isCreateDraft(draft) && out.createdExternalId ? out.createdExternalId : undefined;
        if (created) await markCreatedButFailed(draft, created, out.errorKey, now(), out.remainingPatch, out);
        else await markFailed(draft.id, out.errorKey, out.remainingPatch ? applyRemainingPatch(draft.fieldPatch, out.remainingPatch) : undefined, out);
        pushResult(summary, {
          draftId: draft.id, status: 'failed', errorKey: out.errorKey, errorParams: out.errorParams,
          ...(created ? { externalId: created } : {}),
          ...(out.details ? { details: out.details } : {}),
        });
        logger.warn('catalogDrafts.send_failed', { userId, draftId: draft.id, marketplace, errorKey: out.errorKey, message: out.message, created: created ?? null });
      } else if (out.kind === 'pending') {
        // Always replace the bookkeeping: an earlier send's `sentBatches` / `sentItem` must never be polled
        // for this send's batch.
        const extra: Record<string, unknown> = {};
        if (out.sent) extra.sentItem = out.sent;
        if (out.batches?.length) extra.sentBatches = out.batches;
        await d.update({
          where: { id: draft.id },
          data: {
            status: 'syncing',
            batchRequestId: out.batchRequestId,
            baseSnapshot: { ...stripMeta(draft.baseSnapshot), ...extra },
          },
        });
        pushResult(summary, { draftId: draft.id, status: 'pending' });
      } else {
        const newId = isCreateDraft(draft) ? out.externalId : undefined;
        await markSynced(session, draft, out.applied, Boolean(out.deleted), now(), newId);
        pushResult(summary, { draftId: draft.id, status: 'success', ...(newId ? { externalId: newId } : {}) });
        if (!out.deleted) healthIds.push(newId || draft.externalId);
      }
    }
    await refreshHealthBestEffort(marketplace, storeId, userId, healthIds);
  }

  logger.info('catalogDrafts.send', {
    userId,
    requested: ids.length,
    sent: summary.sent.length,
    failed: summary.failed.length,
    conflicts: summary.conflicts.length,
    pending: summary.pending.length,
    skipped: summary.skipped.length,
  });
  return summary;
}

/**
 * Resolve Trendyol batches left `syncing` with a batchRequestId. Called by the
 * scheduled-send cron every run (and safe to call anywhere). A batch still
 * unresolved after BATCH_TIMEOUT_MS fails with `batchTimeout`.
 */
export async function resolvePendingCatalogBatches(opts: { userId?: string; executors?: CatalogExecutors; now?: () => Date; limit?: number } = {}): Promise<{ synced: number; failed: number; pending: number }> {
  const d = delegate();
  const out = { synced: 0, failed: 0, pending: 0 };
  if (!d) return out;
  const now = opts.now || (() => new Date());
  const executors = opts.executors || (await loadDefaultExecutors());
  const rows = await d.findMany({
    where: { status: 'syncing', batchRequestId: { not: null }, ...(opts.userId ? { userId: opts.userId } : {}) },
    orderBy: { updatedAt: 'asc' },
    take: opts.limit ?? 500,
  });
  const groups = new Map<string, CatalogDraftRecord[]>();
  for (const r of rows.map(toRecord)) {
    const key = `${r.userId}|${r.marketplace}|${r.storeId}|${r.batchRequestId}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  // A batch that cannot be polled (session gone, credentials removed, store
  // changed, batch id expired) must still time out, or the draft stays locked
  // in `syncing` forever (send, stage and discard all refuse it).
  const timeoutOrPending = async (drafts: CatalogDraftRecord[]) => {
    for (const draft of drafts) {
      if (now().getTime() - draft.updatedAt.getTime() > BATCH_TIMEOUT_MS) {
        await markFailed(draft.id, `${ERR}.batchTimeout`);
        out.failed++;
      } else {
        out.pending++;
      }
    }
  };
  for (const drafts of Array.from(groups.values())) {
    const { userId, marketplace, storeId, batchRequestId } = drafts[0];
    let session: CatalogExecutorSession;
    try {
      session = await executors[marketplace].open(userId, storeId);
    } catch (err) {
      logger.warn('catalogDrafts.batch_session_failed', { userId, marketplace, error: String(err) });
      await timeoutOrPending(drafts);
      continue;
    }
    if (!session.pollBatch || !batchRequestId) {
      await timeoutOrPending(drafts);
      continue;
    }
    let results: Map<string, BatchOutcome>;
    try {
      results = await session.pollBatch(batchRequestId, drafts);
    } catch (err) {
      logger.warn('catalogDrafts.batch_poll_failed', { userId, batchRequestId, error: String(err) });
      await timeoutOrPending(drafts);
      continue;
    }
    const healthIds: string[] = [];
    const undecided: CatalogDraftRecord[] = [];
    for (const draft of drafts) {
      const r = results.get(draft.id) || { kind: 'pending' as const };
      if (r.kind === 'synced') {
        const newId = isCreateDraft(draft) ? r.externalId : undefined;
        await markSynced(session, draft, r.applied, false, now(), newId);
        out.synced++;
        healthIds.push(newId || draft.externalId);
      } else if (r.kind === 'failed') {
        await markFailed(draft.id, r.errorKey, undefined, r);
        out.failed++;
      } else {
        undecided.push(draft);
      }
    }
    await timeoutOrPending(undecided);
    await refreshHealthBestEffort(marketplace, storeId, userId, healthIds);
  }
  return out;
}
