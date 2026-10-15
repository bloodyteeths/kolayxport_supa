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
 * The `CatalogDraft` model ships with backend migration BR-1a. Until it is
 * deployed, `catalogDraftsAvailable()` is false and every entry point throws
 * `CatalogDraftError('UNAVAILABLE')` (HTTP 503) instead of crashing.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { channelEnabled, getStockSettings, isStockSyncActive } from '@/lib/stock/settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const CATALOG_MARKETPLACES = ['trendyol', 'wix', 'shopify'] as const;
export type CatalogMarketplace = (typeof CATALOG_MARKETPLACES)[number];

export type CatalogDraftStatus = 'draft' | 'syncing' | 'failed' | 'conflict' | 'synced' | 'cancelled';
/** At most one draft per product in these states (the "open" draft). */
export const OPEN_STATUSES: CatalogDraftStatus[] = ['draft', 'failed', 'conflict', 'syncing'];
/** States a send may claim. A conflict is re-checked, never forced. */
export const SENDABLE_STATUSES: CatalogDraftStatus[] = ['draft', 'failed', 'conflict'];
export const STALE_SYNCING_MS = 10 * 60 * 1000;
/** A Trendyol batch still unresolved after this long is marked failed. */
export const BATCH_TIMEOUT_MS = 60 * 60 * 1000;
export const MAX_SEND_DRAFTS = 500;

export type CatalogFieldKey = 'title' | 'price' | 'quantity' | 'tags' | 'visible' | 'status';
export type CatalogFieldPatch = {
  title?: string;
  /** Major units (e.g. 24.9). Trendyol: salePrice. Shopify/Wix: the single variant's price. */
  price?: number;
  quantity?: number;
  /** Shopify only. */
  tags?: string[];
  /** Wix only. */
  visible?: boolean;
  /** Shopify only. */
  status?: 'active' | 'draft' | 'archived';
};

export type CatalogQueuedActionType = 'archive' | 'delete';
export type CatalogQueuedAction = { type: CatalogQueuedActionType; queuedAt: string; completedAt?: string };

/** Fields each marketplace accepts in v1 (listings-grid §9.3). */
export const ALLOWED_FIELDS: Record<CatalogMarketplace, CatalogFieldKey[]> = {
  // Title on Trendyol needs the full product payload (updateProducts) and puts
  // the product back into approval: not staged in v1.
  trendyol: ['price', 'quantity'],
  // collectionIds needs Wix collection endpoints the client does not have yet.
  wix: ['title', 'price', 'quantity', 'visible'],
  shopify: ['title', 'price', 'quantity', 'tags', 'status'],
};
export const ALLOWED_ACTIONS: Record<CatalogMarketplace, CatalogQueuedActionType[]> = {
  trendyol: ['archive'],
  wix: ['delete'],
  shopify: ['delete'],
};
const TITLE_MAX: Record<CatalogMarketplace, number> = { trendyol: 100, wix: 80, shopify: 255 };

/** Canonical values compared for conflicts and written back into the cache. */
export type CanonicalValues = {
  title?: string | null;
  price?: number | null;
  listPrice?: number | null;
  quantity?: number | null;
  tags?: string[];
  visible?: boolean;
  status?: string | null;
  variantCount?: number;
  trackInventory?: boolean;
  archived?: boolean;
  /** Wix: a sale price (priceData.discountedPrice) differs from the base price. */
  discounted?: boolean;
  /** Wix: sale price written back to the cache next to `price` (the grid shows discountPrice ?? price). */
  discountPrice?: number | null;
};

export type CatalogDraftRecord = {
  id: string;
  userId: string;
  marketplace: CatalogMarketplace;
  storeId: string;
  externalId: string;
  status: CatalogDraftStatus;
  baseUpdatedAt: Date | null;
  baseSnapshot: CanonicalValues & Record<string, unknown>;
  fieldPatch: CatalogFieldPatch;
  queuedActions: CatalogQueuedAction[];
  batchRequestId: string | null;
  lastSyncError: string | null;
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
  reason?: 'queued_delete' | 'not_sendable' | 'not_found';
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

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERR = 'listings.draftError';

export type CatalogDraftErrorCode =
  | 'UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'INVALID_MARKETPLACE'
  | 'STORE_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_NOT_EDITABLE'
  | 'FIELD_NOT_SUPPORTED'
  | 'ACTION_NOT_SUPPORTED'
  | 'INVALID_TITLE'
  | 'INVALID_PRICE'
  | 'INVALID_QUANTITY'
  | 'INVALID_TAGS'
  | 'INVALID_VISIBLE'
  | 'INVALID_STATUS'
  | 'MULTI_VARIANT'
  | 'NOT_TRACKED'
  | 'STOCK_MANAGED'
  | 'DELETE_NOT_EXCLUSIVE'
  | 'SCHEDULE_INVALID'
  | 'SCHEDULE_DELETE_REFUSED'
  | 'DISCOUNTED'
  | 'REMOTE_MISSING'
  | 'REMOTE_FAILED'
  | 'TOO_MANY';

const ERROR_META: Record<CatalogDraftErrorCode, { status: number; key: string }> = {
  UNAVAILABLE: { status: 503, key: `${ERR}.unavailable` },
  INVALID_INPUT: { status: 400, key: `${ERR}.invalidInput` },
  INVALID_MARKETPLACE: { status: 400, key: `${ERR}.invalidInput` },
  STORE_NOT_FOUND: { status: 404, key: `${ERR}.storeNotFound` },
  PRODUCT_NOT_FOUND: { status: 404, key: `${ERR}.productNotFound` },
  DRAFT_NOT_FOUND: { status: 404, key: `${ERR}.draftNotFound` },
  DRAFT_NOT_EDITABLE: { status: 409, key: `${ERR}.notEditable` },
  FIELD_NOT_SUPPORTED: { status: 400, key: `${ERR}.fieldNotSupported` },
  ACTION_NOT_SUPPORTED: { status: 400, key: `${ERR}.actionNotSupported` },
  INVALID_TITLE: { status: 400, key: `${ERR}.invalidTitle` },
  INVALID_PRICE: { status: 400, key: 'listings.validate.priceInvalid' },
  INVALID_QUANTITY: { status: 400, key: 'listings.validate.qtyInvalid' },
  INVALID_TAGS: { status: 400, key: `${ERR}.invalidTags` },
  INVALID_VISIBLE: { status: 400, key: `${ERR}.invalidInput` },
  INVALID_STATUS: { status: 400, key: `${ERR}.invalidInput` },
  MULTI_VARIANT: { status: 409, key: 'listings.cell.variationsReadOnly' },
  NOT_TRACKED: { status: 409, key: `${ERR}.notTracked` },
  STOCK_MANAGED: { status: 409, key: `${ERR}.stockManaged` },
  DELETE_NOT_EXCLUSIVE: { status: 409, key: `${ERR}.deleteNotExclusive` },
  SCHEDULE_INVALID: { status: 400, key: `${ERR}.scheduleInvalid` },
  SCHEDULE_DELETE_REFUSED: { status: 409, key: `${ERR}.scheduleDeleteRefused` },
  DISCOUNTED: { status: 409, key: `${ERR}.wixDiscounted` },
  REMOTE_MISSING: { status: 404, key: `${ERR}.remoteMissing` },
  REMOTE_FAILED: { status: 502, key: `${ERR}.remoteFailed` },
  TOO_MANY: { status: 400, key: `${ERR}.tooMany` },
};

export class CatalogDraftError extends Error {
  code: CatalogDraftErrorCode;
  status: number;
  key: string;
  params?: Record<string, string | number>;

  constructor(code: CatalogDraftErrorCode, message?: string, params?: Record<string, string | number>) {
    super(message || code);
    this.name = 'CatalogDraftError';
    this.code = code;
    this.status = ERROR_META[code].status;
    this.key = ERROR_META[code].key;
    this.params = params;
  }
}

export function isCatalogDraftError(err: unknown): err is CatalogDraftError {
  return err instanceof CatalogDraftError;
}

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
  constructor(errorKey: string, message?: string, errorParams?: Record<string, string | number>) {
    super(message || errorKey);
    this.name = 'CatalogExecutorError';
    this.errorKey = errorKey;
    this.errorParams = errorParams;
  }
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

// ---------------------------------------------------------------------------
// Executor contract (implemented in ./executors/*)
// ---------------------------------------------------------------------------

export type RemoteState = { exists: boolean; updatedAt: Date | null; values: CanonicalValues; raw?: unknown };
export type ApplyOutcome =
  | { kind: 'synced'; applied: CanonicalValues; deleted?: boolean }
  /** `sent`: the exact item sent in the batch, stored on the draft so the cron's poll reports what was really sent. */
  | { kind: 'pending'; batchRequestId: string; sent?: Record<string, unknown> };
export type BatchOutcome =
  | { kind: 'synced'; applied: CanonicalValues }
  | { kind: 'pending' }
  | { kind: 'failed'; errorKey: string; errorParams?: Record<string, string | number> };

export interface CatalogExecutorSession {
  readRemote(externalIds: string[]): Promise<Map<string, RemoteState>>;
  /** Apply one draft. Throw CatalogExecutorError (or any error) to fail it. */
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

export function isCatalogMarketplace(v: unknown): v is CatalogMarketplace {
  return typeof v === 'string' && (CATALOG_MARKETPLACES as readonly string[]).includes(v);
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
    scheduledSendAt: toDate(row.scheduledSendAt),
    createdAt: toDate(row.createdAt) || new Date(0),
    updatedAt: toDate(row.updatedAt) || new Date(0),
    syncedAt: toDate(row.syncedAt),
  };
}

export function hasQueuedDelete(actions: CatalogQueuedAction[]): boolean {
  return actions.some((a) => (a.type === 'delete' || a.type === 'archive') && !a.completedAt);
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
  };
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

/**
 * Validate and normalize an incoming field patch for one marketplace.
 * A key set to `null` means "drop this field from the draft" (returned in `remove`).
 */
export function validateFieldPatch(
  marketplace: CatalogMarketplace,
  input: unknown,
): { set: CatalogFieldPatch; remove: CatalogFieldKey[] } {
  if (input === undefined) return { set: {}, remove: [] };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CatalogDraftError('INVALID_INPUT', 'fields must be an object');
  const allowed = ALLOWED_FIELDS[marketplace];
  const set: CatalogFieldPatch = {};
  const remove: CatalogFieldKey[] = [];
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!(allowed as string[]).includes(key)) {
      throw new CatalogDraftError('FIELD_NOT_SUPPORTED', `Field "${key}" cannot be staged for ${marketplace}`, { field: key });
    }
    const k = key as CatalogFieldKey;
    if (raw === null) {
      remove.push(k);
      continue;
    }
    switch (k) {
      case 'title': {
        const max = TITLE_MAX[marketplace];
        const v = typeof raw === 'string' ? raw.trim() : '';
        if (!v || v.length > max) throw new CatalogDraftError('INVALID_TITLE', 'Invalid title', { max });
        set.title = v;
        break;
      }
      case 'price': {
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(',', '.')) : NaN;
        if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) throw new CatalogDraftError('INVALID_PRICE', 'Invalid price');
        set.price = Math.round(n * 100) / 100;
        break;
      }
      case 'quantity': {
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
        if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new CatalogDraftError('INVALID_QUANTITY', 'Invalid quantity', { min: 0, max: 1_000_000 });
        set.quantity = n;
        break;
      }
      case 'tags': {
        if (!Array.isArray(raw)) throw new CatalogDraftError('INVALID_TAGS', 'tags must be an array');
        const seen = new Set<string>();
        const tags: string[] = [];
        for (const t of raw) {
          if (typeof t !== 'string') throw new CatalogDraftError('INVALID_TAGS', 'tags must be strings');
          const v = t.trim();
          if (!v) continue;
          if (v.length > 255 || v.includes(',')) throw new CatalogDraftError('INVALID_TAGS', 'Invalid tag');
          const lk = v.toLocaleLowerCase('en');
          if (seen.has(lk)) continue;
          seen.add(lk);
          tags.push(v);
        }
        if (tags.length > 250) throw new CatalogDraftError('INVALID_TAGS', 'Too many tags', { max: 250 });
        set.tags = tags;
        break;
      }
      case 'visible': {
        if (typeof raw !== 'boolean') throw new CatalogDraftError('INVALID_VISIBLE', 'visible must be a boolean');
        set.visible = raw;
        break;
      }
      case 'status': {
        if (raw !== 'active' && raw !== 'draft' && raw !== 'archived') throw new CatalogDraftError('INVALID_STATUS', 'Invalid status');
        set.status = raw;
        break;
      }
    }
  }
  return { set, remove };
}

/** Validate incoming queued actions (`[{ type }]`); stamps queuedAt. */
export function validateQueuedActions(marketplace: CatalogMarketplace, input: unknown, now: Date = new Date()): CatalogQueuedAction[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new CatalogDraftError('INVALID_INPUT', 'queuedActions must be an array');
  const out: CatalogQueuedAction[] = [];
  for (const a of input) {
    const type = a && typeof a === 'object' ? (a as any).type : undefined;
    if (!(ALLOWED_ACTIONS[marketplace] as string[]).includes(type)) {
      throw new CatalogDraftError('ACTION_NOT_SUPPORTED', `Action "${String(type)}" cannot be queued for ${marketplace}`, { action: String(type) });
    }
    out.push({ type, queuedAt: now.toISOString() });
  }
  return out;
}

/** Existing actions + incoming ones, deduped by type (the first stays). */
export function mergeQueuedActions(existing: CatalogQueuedAction[], incoming: CatalogQueuedAction[]): CatalogQueuedAction[] {
  const out = [...existing];
  for (const a of incoming) {
    if (!out.some((e) => e.type === a.type && !e.completedAt)) out.push(a);
  }
  return out;
}

/** Editability rules the grid also shows (`editable.reason`), enforced server-side. */
export function assertEditable(marketplace: CatalogMarketplace, patch: CatalogFieldPatch, snapshot: CanonicalValues) {
  const touchesPriceOrQty = patch.price !== undefined || patch.quantity !== undefined;
  if (touchesPriceOrQty && marketplace !== 'trendyol' && (snapshot.variantCount ?? 1) > 1) {
    throw new CatalogDraftError('MULTI_VARIANT', 'Price and stock of products with variations are edited per variation');
  }
  if (patch.quantity !== undefined && snapshot.trackInventory === false) {
    throw new CatalogDraftError('NOT_TRACKED', 'Stock is not tracked for this product');
  }
  if (patch.price !== undefined && marketplace === 'wix' && snapshot.discounted) {
    // Wix applies the discount on top of priceData.price: editing the shown
    // (discounted) price would write the base price and get discounted again.
    throw new CatalogDraftError('DISCOUNTED', 'Price of a discounted Wix product is edited in Wix');
  }
}

/** A delete/archive cannot ride with field changes (mirrors Etsy's assertDeleteIsExclusive). */
export function assertDeleteIsExclusive(patch: CatalogFieldPatch, actions: CatalogQueuedAction[]) {
  if (hasQueuedDelete(actions) && Object.keys(patch).length > 0) {
    throw new CatalogDraftError('DELETE_NOT_EXCLUSIVE', 'A delete or archive cannot be combined with other staged changes');
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

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
    return {
      snapshot: {
        title: p.title,
        price: num(p.salePrice),
        listPrice: num(p.listPrice),
        quantity: p.quantity,
        archived: p.archived,
        variantCount: 1,
        trackInventory: true,
      },
      updatedAt: p.trendyolLastUpdate ?? null,
    };
  }
  if (marketplace === 'wix') {
    const p = await prisma.wixProduct.findUnique({
      where: { userId_wixSiteId_wixProductId: { userId, wixSiteId: storeId, wixProductId: externalId } },
    });
    if (!p) return null;
    const variants = Array.isArray(p.variants) ? (p.variants as unknown[]) : [];
    const base = num(p.price);
    const sale = num(p.discountPrice);
    return {
      snapshot: {
        title: p.title,
        // The grid shows discountPrice ?? price. Price edits are refused while a
        // sale price differs (DISCOUNTED), so base and shown price agree here.
        price: base,
        discounted: sale !== null && base !== null && Math.round(sale * 100) !== Math.round(base * 100),
        quantity: p.quantity,
        visible: p.visible,
        trackInventory: p.trackInventory,
        variantCount: Math.max(1, variants.length),
      },
      updatedAt: p.wixUpdatedDate ?? null,
    };
  }
  const p = await prisma.shopifyProduct.findUnique({
    where: { userId_shopifyShopId_shopifyProductId: { userId, shopifyShopId: storeId, shopifyProductId: externalId } },
  });
  if (!p) return null;
  return {
    snapshot: {
      title: p.title,
      price: num(p.price),
      quantity: p.totalInventory,
      tags: p.tags || [],
      status: p.status ?? null,
      trackInventory: p.trackInventory,
      variantCount: Math.max(1, p.variantCount || 1),
    },
    updatedAt: p.shopifyUpdatedAt ?? null,
  };
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
  externalId: string;
  fields?: unknown;
  queuedActions?: unknown;
  /** Action types to drop from the queue (e.g. ['delete']). */
  removeQueuedActions?: unknown;
  scheduledSendAt?: unknown;
};

/**
 * Merge into the product's open draft, creating it (with the cache row as base
 * snapshot) when there is none. Same semantics as `stageEtsyDraft`:
 * fields merge key by key (`null` drops a key), queued actions dedupe by type,
 * a conflict stays a conflict, a failed draft returns to `draft`.
 * The one-open-draft invariant is enforced under a per-product advisory lock.
 */
export async function stageCatalogDraft(input: StageInput): Promise<CatalogDraftRecord> {
  const d = db();
  if (!isCatalogMarketplace(input.marketplace)) throw new CatalogDraftError('INVALID_MARKETPLACE', 'Unknown marketplace');
  const externalId = String(input.externalId || '').trim();
  if (!externalId || externalId.length > 200) throw new CatalogDraftError('INVALID_INPUT', 'externalId is required');
  const marketplace = input.marketplace;
  const { set, remove } = validateFieldPatch(marketplace, input.fields);
  const incomingActions = validateQueuedActions(marketplace, input.queuedActions);
  const removeTypes = Array.isArray(input.removeQueuedActions) ? input.removeQueuedActions.map(String) : [];
  const scheduledSendAt = parseScheduledSendAt(input.scheduledSendAt);
  const storeId = await resolveStoreId(input.userId, marketplace, input.storeId);

  const cached = await loadCacheSnapshot(input.userId, marketplace, storeId, externalId);
  if (!cached) throw new CatalogDraftError('PRODUCT_NOT_FOUND', 'Product is not in the local cache; refresh first');
  assertEditable(marketplace, set, cached.snapshot);
  if (set.quantity !== undefined && (await isCatalogStockManaged(input.userId, marketplace, externalId))) {
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
    const fieldPatch: CatalogFieldPatch = { ...(prev?.fieldPatch || {}), ...set };
    for (const k of remove) delete (fieldPatch as Record<string, unknown>)[k];
    let actions = prev?.queuedActions || [];
    if (incomingActions) actions = mergeQueuedActions(actions, incomingActions);
    if (removeTypes.length) actions = actions.filter((a) => !removeTypes.includes(a.type));
    assertDeleteIsExclusive(fieldPatch, actions);
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
          baseSnapshot: cached.snapshot,
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
  return rows.map(toRecord);
}

export async function getCatalogDraft(id: string, userId: string): Promise<CatalogDraftRecord> {
  const row = await db().findFirst({ where: { id, userId } });
  if (!row) throw new CatalogDraftError('DRAFT_NOT_FOUND', 'Draft not found');
  return toRecord(row);
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
  const current = await getCatalogDraft(id, userId);
  if (!(SENDABLE_STATUSES as string[]).includes(current.status)) {
    throw new CatalogDraftError('DRAFT_NOT_EDITABLE', `Draft is not editable (${current.status})`, { status: current.status });
  }
  const actions = removeTypes.length ? current.queuedActions.filter((a) => !removeTypes.includes(a.type)) : current.queuedActions;
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
  return getCatalogDraft(id, userId);
}

/** Statuses a seller may rebase from ("Review differences" → "Keep my changes"). */
export const REBASABLE_STATUSES: CatalogDraftStatus[] = ['conflict', 'failed'];

/**
 * "Keep my changes" after reviewing a conflict (listings-grid §6.2/§6.4
 * Review differences). Re-reads the product on the marketplace, takes it as the
 * draft's new base (`baseSnapshot` / `baseUpdatedAt`) and puts the draft back
 * to `draft`. It never sends: the seller still sends explicitly, and that send
 * runs the normal conflict check against the new base. A product that is gone
 * remotely cannot be rebased (discard is the way out).
 */
export async function rebaseCatalogDraft(
  id: string,
  userId: string,
  opts: { executors?: CatalogExecutors } = {},
): Promise<CatalogDraftRecord> {
  const d = db();
  const current = await getCatalogDraft(id, userId);
  if (!(REBASABLE_STATUSES as string[]).includes(current.status)) {
    throw new CatalogDraftError('DRAFT_NOT_EDITABLE', `Draft cannot be rebased (${current.status})`, { status: current.status });
  }
  const executors = opts.executors || (await loadDefaultExecutors());
  let remote: RemoteState | undefined;
  try {
    const session = await executors[current.marketplace].open(userId, current.storeId);
    remote = (await session.readRemote([current.externalId])).get(current.externalId);
  } catch (err) {
    const e = toExecutorError(err);
    if (e.errorKey === `${ERR}.remoteMissing`) throw new CatalogDraftError('REMOTE_MISSING', 'Product not found on the marketplace');
    throw new CatalogDraftError('REMOTE_FAILED', e.message);
  }
  if (!remote?.exists) throw new CatalogDraftError('REMOTE_MISSING', 'Product not found on the marketplace');
  // The new base must still allow the staged edit (variants added, stock
  // tracking turned off or a Wix sale price since the draft started).
  const { sentItem: _sentItem, ...prevBase } = current.baseSnapshot as Record<string, unknown>;
  const baseSnapshot = { ...prevBase, ...remote.values };
  assertEditable(current.marketplace, current.fieldPatch, baseSnapshot);
  const res = await d.updateMany({
    // Only if nothing changed the draft since it was read (no stage, send or discard in between).
    where: { id, userId, status: current.status, updatedAt: current.updatedAt },
    data: { status: 'draft', lastSyncError: null, baseSnapshot, baseUpdatedAt: remote.updatedAt ?? null },
  });
  if (res.count === 0) throw new CatalogDraftError('DRAFT_NOT_EDITABLE', 'Draft changed while rebasing');
  logger.info('catalogDrafts.rebase', { userId, draftId: id, marketplace: current.marketplace, from: current.status });
  return getCatalogDraft(id, userId);
}

// ---------------------------------------------------------------------------
// Conflict check
// ---------------------------------------------------------------------------

function comparable(key: string, v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (key === 'price' || key === 'listPrice') {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 100)) : null;
  }
  if (key === 'quantity') {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.trunc(n)) : null;
  }
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => String(x).trim().toLocaleLowerCase('en')).sort());
  if (typeof v === 'string') return v.trim();
  return JSON.stringify(v);
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
 * Queued delete/archive drafts only check that the product still exists.
 */
export function detectConflict(draft: CatalogDraftRecord, remote: RemoteState): { conflict: boolean; changedFields: string[] } {
  if (!remote.exists) return { conflict: true, changedFields: [] };
  const keys = Object.keys(draft.fieldPatch);
  if (keys.length === 0) return { conflict: false, changedFields: [] };
  const base = draft.baseUpdatedAt;
  const newer = base && remote.updatedAt ? remote.updatedAt.getTime() > base.getTime() : null;
  if (newer === false) return { conflict: false, changedFields: [] };
  const comparableKeys = keys.filter((k) => k in draft.baseSnapshot && (draft.baseSnapshot as any)[k] !== undefined && k in remote.values);
  // A field whose remote value already equals the patched value is not a
  // conflict: an earlier, partly failed send of this draft applied it (Wix and
  // Shopify write in several steps), or the remote reached the same value.
  const changedFields = comparableKeys.filter((k) => {
    const remoteV = comparable(k, (remote.values as any)[k]);
    if (remoteV === comparable(k, (draft.fieldPatch as any)[k])) return false;
    return comparable(k, (draft.baseSnapshot as any)[k]) !== remoteV;
  });
  if (changedFields.length) return { conflict: true, changedFields };
  if (comparableKeys.length === 0 && newer === true) return { conflict: true, changedFields: [] };
  return { conflict: false, changedFields: [] };
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

async function markFailed(draftId: string, errorKey: string) {
  await db().update({ where: { id: draftId }, data: { status: 'failed', lastSyncError: errorKey, batchRequestId: null } });
}

async function markSynced(session: CatalogExecutorSession, draft: CatalogDraftRecord, applied: CanonicalValues, deleted: boolean, now: Date) {
  const completedActions = draft.queuedActions.map((a) => (a.completedAt ? a : { ...a, completedAt: now.toISOString() }));
  await db().update({
    where: { id: draft.id },
    data: { status: 'synced', syncedAt: now, lastSyncError: null, batchRequestId: null, scheduledSendAt: null, queuedActions: completedActions },
  });
  try {
    await session.writeCache(draft.externalId, applied, { deleted });
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
        await markFailed(draft.id, e.errorKey);
        pushResult(summary, { draftId: draft.id, status: 'failed', errorKey: e.errorKey, errorParams: e.errorParams });
      }
      continue;
    }

    let remotes: Map<string, RemoteState>;
    try {
      remotes = await session.readRemote(drafts.map((x) => x.externalId));
    } catch (err) {
      const e = toExecutorError(err);
      for (const draft of drafts) {
        await markFailed(draft.id, e.errorKey);
        pushResult(summary, { draftId: draft.id, status: 'failed', errorKey: e.errorKey, errorParams: e.errorParams });
      }
      continue;
    }

    // 3. Conflict check (never forced) and the stock-managed guard.
    const ready: { draft: CatalogDraftRecord; remote: RemoteState }[] = [];
    for (const draft of drafts) {
      const remote = remotes.get(draft.externalId) || { exists: false, updatedAt: null, values: {} };
      const { conflict, changedFields } = detectConflict(draft, remote);
      if (conflict) {
        const key = remote.exists ? `${ERR}.conflict` : `${ERR}.remoteMissing`;
        await d.update({ where: { id: draft.id }, data: { status: 'conflict', lastSyncError: key } });
        pushResult(summary, { draftId: draft.id, status: 'conflict', errorKey: key, changedFields });
        continue;
      }
      if (draft.fieldPatch.quantity !== undefined && (await isCatalogStockManaged(userId, marketplace, draft.externalId))) {
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
        await markFailed(draft.id, out.errorKey);
        pushResult(summary, { draftId: draft.id, status: 'failed', errorKey: out.errorKey, errorParams: out.errorParams });
        logger.warn('catalogDrafts.send_failed', { userId, draftId: draft.id, marketplace, errorKey: out.errorKey, message: out.message });
      } else if (out.kind === 'pending') {
        await d.update({
          where: { id: draft.id },
          data: {
            status: 'syncing',
            batchRequestId: out.batchRequestId,
            ...(out.sent ? { baseSnapshot: { ...draft.baseSnapshot, sentItem: out.sent } } : {}),
          },
        });
        pushResult(summary, { draftId: draft.id, status: 'pending' });
      } else {
        await markSynced(session, draft, out.applied, Boolean(out.deleted), now());
        pushResult(summary, { draftId: draft.id, status: 'success' });
        if (!out.deleted) healthIds.push(draft.externalId);
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
        await markSynced(session, draft, r.applied, false, now());
        out.synced++;
        healthIds.push(draft.externalId);
      } else if (r.kind === 'failed') {
        await markFailed(draft.id, r.errorKey);
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
