// components/domain/listing-editor/adapters/catalog.ts — the shared CatalogDraft staging for the Trendyol, Wix and
// Shopify editor adapters (marketplace-editors §1 "Staging", §6, §7.1; M6b-C). One staging concept for all three:
// every edit is merged into the product's open `CatalogDraft` (`POST /api/catalog-drafts`, key by key, `null` drops a
// key); nothing reaches the marketplace until the footer's explicit Send (`POST /api/catalog-drafts/send`), which
// never forces a conflict and only sends a queued delete after the frame's type-to-confirm.
//
// Ids. The engine (`useListingDraft`) marks a not-yet-created listing with a NEGATIVE local id ("-…"). Catalog
// drafts mark it with `externalId = 'new:<id>'`. The two are mapped 1:1 here (`-<id>` ⇄ `new:<id>`); real ids
// (Trendyol barcode, Wix product GUID, Shopify numeric id) never start with "-".
//
// Queued actions. Catalog `create` is shown to the engine as `create_listing` (the engine's "create already ran"
// check reads that type), `delete` stays `delete` (the engine's type-to-confirm gate). Trendyol `archive` stays
// `archive`: it is only sent when the caller confirms it (`CatalogSendOptions.confirmedArchive`).
import {
  CatalogDraftClientError,
  discardCatalogDraft,
  fetchCatalogDraft,
  fetchCatalogDrafts,
  removeCatalogDraftQueuedActions,
  sendCatalogDrafts,
  stageCatalogDraft,
  type CatalogDraftDTO,
  type CatalogMarketplace as DraftCatalogMarketplace,
  type CatalogQueuedActionType,
  type SendSummary,
} from '@/lib/catalogDrafts/client';
import type { CatalogFieldPatch } from '@/lib/catalogDrafts/schemas';
import { isI18nKey, legacySendErrorKey } from '@/lib/listings/sendError';
import { listHref, readEditorNav } from '@/lib/listingEditor/editorNav';
import type {
  CopySourceData,
  DraftRow,
  EditorMode,
  FieldIssue,
  FieldMap,
  FieldValue,
  QueuedAction,
  SectionId,
} from '@/lib/listingEditor/types';
import { diffKeys, fieldEquals } from '../changeSummary';
import type {
  AdapterContext,
  AdapterErrorInfo,
  AdapterSendResult,
  ListingEditorAdapter,
  LoadedListing,
  SendOptions,
  StageFieldsInput,
} from './types';

/**
 * Catalog marketplaces served by the full-page editor frame. Hepsiburada stages CatalogDrafts too, but its listings
 * have no editable content (HB's catalog owns it), so it uses its own listing page (components/domain/hepsiburada).
 */
export type CatalogMarketplace = Exclude<DraftCatalogMarketplace, 'hepsiburada'>;

/** Brand names (not translated). */
export const CATALOG_DISPLAY_NAME: Record<CatalogMarketplace, string> = { trendyol: 'Trendyol', wix: 'Wix', shopify: 'Shopify' };

/** Open (not finished) draft statuses: the editor shows and stages these. */
export const CATALOG_OPEN_STATUSES = ['draft', 'failed', 'conflict', 'syncing'];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Ids
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const NEW_EXTERNAL_PREFIX = 'new:';

/** Engine listing id → CatalogDraft externalId (`-abc` → `new:abc`). */
export function toExternalId(listingId: string): string {
  return listingId.startsWith('-') ? `${NEW_EXTERNAL_PREFIX}${listingId.slice(1)}` : listingId;
}

/** CatalogDraft externalId → engine listing id (`new:abc` → `-abc`). */
export function toEngineId(externalId: string): string {
  return externalId.startsWith(NEW_EXTERNAL_PREFIX) ? `-${externalId.slice(NEW_EXTERNAL_PREFIX.length)}` : externalId;
}

/** A fresh local id for a new product (`-c…`, 25 base-36 characters; `new:c…` on the server). */
export function newCatalogLocalId(rand: () => number = Math.random): string {
  let out = 'c';
  for (let i = 0; i < 24; i += 1) out += Math.floor(rand() * 36).toString(36);
  return `-${out}`;
}

export function isLocalId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('-');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Draft rows
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Latest send's ICU params per draft (the catalog API keeps only the key in `lastSyncError`). */
const lastSendParams = new Map<string, Record<string, string | number>>();

const ENGINE_ACTION: Record<string, string> = { create: 'create_listing' };
const CATALOG_ACTION: Record<string, CatalogQueuedActionType> = { create_listing: 'create', delete: 'delete', archive: 'archive' };

/** `CatalogDraftDTO` → the editor's `DraftRow` (ids and action types mapped; raw kept for sub-editors). */
export function toCatalogDraftRow(dto: CatalogDraftDTO | null | undefined): DraftRow | null {
  if (!dto || typeof dto !== 'object' || !dto.id) return null;
  const queued: QueuedAction[] = (Array.isArray(dto.queuedActions) ? dto.queuedActions : []).map((a) => ({
    type: ENGINE_ACTION[a.type] ?? a.type,
    payload: a.payload,
    completedAt: a.completedAt ?? null,
  }));
  const key = typeof dto.lastSyncError === 'string' && isI18nKey(dto.lastSyncError) ? dto.lastSyncError : null;
  const params = lastSendParams.get(dto.id);
  return {
    id: String(dto.id),
    status: dto.status,
    listingId: toEngineId(String(dto.externalId ?? '')),
    fieldPatch: (dto.fieldPatch ?? {}) as Record<string, unknown>,
    queuedActions: queued,
    media: [],
    lastSyncError: dto.lastSyncError ?? null,
    syncAttempts: [],
    updatedAt: dto.updatedAt ?? null,
    syncedAt: dto.syncedAt ?? null,
    createdAt: dto.createdAt ?? null,
    // `lastSyncErrorKey` + attempts in the shape `storedDraftSendError` reads (the failed banner's ICU params).
    raw: {
      ...dto,
      lastSyncErrorKey: key,
      syncAttempts: key && params ? [{ status: String(dto.status), result: { errorKey: key, errorParams: params } }] : [],
    },
  };
}

/** The pending create's payload (create-only values) of a draft row. */
export function createPayloadOfRow(draft: Pick<DraftRow, 'queuedActions'> | null | undefined): Record<string, unknown> {
  const a = (draft?.queuedActions ?? []).find((x) => x.type === 'create_listing' && !x.completedAt);
  return a?.payload && typeof a.payload === 'object' ? (a.payload as Record<string, unknown>) : {};
}

function isOpen(dto: CatalogDraftDTO | null | undefined): boolean {
  return Boolean(dto && CATALOG_OPEN_STATUSES.includes(String(dto.status)));
}

export async function loadCatalogDraftRow(
  marketplace: CatalogMarketplace,
  input: { shopId: string; listingId?: string | null; draftId?: string | null },
): Promise<DraftRow | null> {
  if (input.draftId) {
    try {
      const d = await fetchCatalogDraft(input.draftId);
      return d && d.marketplace === marketplace && isOpen(d) ? toCatalogDraftRow(d) : null;
    } catch (err) {
      // Discarded / sent / someone else's: start fresh (the engine then makes a new workspace).
      if (err instanceof CatalogDraftClientError && (err.status === 404 || err.status === 403)) return null;
      throw err;
    }
  }
  if (!input.listingId) return null;
  const drafts = await fetchCatalogDrafts({
    marketplace,
    storeId: input.shopId || undefined,
    ids: [toExternalId(input.listingId)],
  });
  const open = drafts.filter(isOpen).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return toCatalogDraftRow(open[0] ?? null);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Load failure of the marketplace product (status drives the frame's not-found / reconnect state). */
export class CatalogEditorLoadError extends Error {
  status: number | null;
  key: string | null;
  constructor(status: number | null, key: string | null = null, message?: string) {
    super(message || `load failed (${status ?? 'network'})`);
    this.name = 'CatalogEditorLoadError';
    this.status = status;
    this.key = key;
  }
}

/** Send outcome that is not a success (conflict, failure, skip), thrown so the engine runs its failure path. */
export class CatalogSendError extends Error {
  status: number;
  key: string;
  params?: Record<string, string | number>;
  conflict: boolean;
  /** Field the failure belongs to (`errorParams.field`), when the executor named one. */
  field?: string;
  constructor(key: string, opts: { status?: number; conflict?: boolean; params?: Record<string, string | number> } = {}) {
    super(key);
    this.name = 'CatalogSendError';
    this.key = key;
    this.status = opts.status ?? (opts.conflict ? 409 : 502);
    this.conflict = Boolean(opts.conflict);
    this.params = opts.params;
    const f = opts.params?.field;
    if (typeof f === 'string') this.field = f;
  }
}

export interface CatalogErrorSpec {
  marketplace: CatalogMarketplace;
  /** Server (canonical `CatalogFieldPatch`) key → form key (e.g. Shopify `seo` → `seoTitle`). Default: same key. */
  formKeyFor?: (serverKey: string) => string;
  sectionFor: (formKey: string) => SectionId;
}

/** Normalised failure (never raw text in the UI: `key` is a full i18n key). */
export function catalogErrorInfo(spec: CatalogErrorSpec, err: unknown): AdapterErrorInfo {
  if (err instanceof CatalogDraftClientError) {
    const params = err.params;
    const field = typeof params?.field === 'string' ? params.field : null;
    const key = err.key && isI18nKey(err.key) ? err.key : null;
    const issues: FieldIssue[] | undefined =
      err.status === 400 && field && key
        ? [issueFor(spec, field, key, params, 'block_save')]
        : undefined;
    return {
      status: err.status,
      network: false,
      // A 409 is a conflict only when the marketplace changed (DRAFT_NOT_EDITABLE / ARCHIVED are refusals).
      conflict: err.status === 409 && err.code === 'CONFLICT',
      key,
      params,
      issues,
    };
  }
  if (err instanceof CatalogSendError) {
    return {
      status: err.status,
      network: false,
      conflict: err.conflict,
      key: err.key,
      params: err.params,
      issues: err.field ? [issueFor(spec, err.field, err.key, err.params, 'block_sync')] : undefined,
    };
  }
  if (err instanceof CatalogEditorLoadError) {
    return { status: err.status, network: err.status === null, conflict: false, key: err.key };
  }
  const network = err instanceof TypeError || (err instanceof Error && /network|failed to fetch|load failed/i.test(err.message));
  return { status: null, network, conflict: false, key: null };
}

function issueFor(
  spec: CatalogErrorSpec,
  serverField: string,
  key: string,
  params: Record<string, string | number> | undefined,
  severity: FieldIssue['severity'],
): FieldIssue {
  const field = spec.formKeyFor ? spec.formKeyFor(serverField) : serverField;
  return { field, section: spec.sectionFor(field), severity, key, params };
}

/** Failed-banner cause: the stored key (catalog drafts store `listings.draftError.*`), else a coarse bucket. */
export function catalogFailureCauseKey(draft: Pick<DraftRow, 'status' | 'lastSyncError'>): string {
  const raw = typeof draft.lastSyncError === 'string' ? draft.lastSyncError.trim() : '';
  if (raw && isI18nKey(raw)) return raw;
  if (draft.status === 'conflict') return 'listings.draftError.conflict';
  return legacySendErrorKey(String(draft.status), raw);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Send
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CatalogSendOptions extends SendOptions {
  /** Trendyol: the seller confirmed the queued archive (type-to-confirm). Without it a queued archive is not sent. */
  confirmedArchive?: boolean;
}

/** `pending` = a Trendyol batch the server is still waiting on (the draft stays `syncing`). */
export interface CatalogSendResult extends AdapterSendResult {
  pending?: boolean;
}

/** HTTP-like status of the thrown "create is still processing" outcome (not a failure; see `sendCatalogDraftRow`). */
export const CATALOG_PENDING_STATUS = 202;

/**
 * Local ids (`-…`) whose create was sent successfully. The engine keeps the create workspace when the new id is not
 * numeric (Wix GUID, alphanumeric Trendyol barcode) — the route navigates instead — and a late autosave on that
 * workspace must never stage a second create (the server would open a fresh `new:` draft → duplicate product).
 */
const sentCreates = new Set<string>();

export function markCreateSent(localId: string | null | undefined): void {
  if (localId && isLocalId(localId)) sentCreates.add(localId);
}

export function createWasSent(localId: string | null | undefined): boolean {
  return Boolean(localId && sentCreates.has(localId));
}

/**
 * Explicit send of one draft. Success → the created product's id (create) or null; `deleted` when a confirmed
 * queued delete ran. Conflict / failure / skip → throws `CatalogSendError` (never forced).
 * The engine only reaches `send` for a draft with a queued delete after the type-to-confirm, so a pending
 * `delete` is confirmed here; a pending `archive` only with `confirmedArchive` (no editor path sets it yet: such a
 * draft is refused before the request, with a pointer to the grid's confirm flow).
 * Pending Trendyol batch: an edit is a success with `pending` (the engine's refresh reloads the `syncing` draft,
 * which makes the form read-only); a create throws `CATALOG_PENDING_STATUS` so the engine's create-failure path
 * reloads the `syncing` draft by id instead of keeping an editable workspace on it.
 */
export async function sendCatalogDraftRow(draft: DraftRow, opts: CatalogSendOptions = {}): Promise<CatalogSendResult> {
  const pending = (draft.queuedActions ?? []).filter((a) => !a.completedAt).map((a) => a.type);
  if (pending.includes('archive') && !opts.confirmedArchive) {
    throw new CatalogSendError('listingEditor.catalog.archiveInGrid', { status: 409 });
  }
  const isCreate = pending.includes('create_listing');
  const queuedDelete = pending.includes('delete');
  const confirm = queuedDelete || (pending.includes('archive') && opts.confirmedArchive) ? [draft.id] : [];
  const summary: SendSummary = await sendCatalogDrafts([draft.id], { confirmDeleteIds: confirm });
  const result = interpretSendSummary(draft.id, summary);
  if (result.pending && isCreate) {
    throw new CatalogSendError('listingEditor.catalog.sendPending', { status: CATALOG_PENDING_STATUS });
  }
  if (isCreate && !result.pending) markCreateSent(draft.listingId);
  // The server's result has no deleted flag: a success of a draft with a confirmed queued delete removed the product.
  if (queuedDelete && !result.pending) return { ...result, deleted: true };
  return result;
}

/** Pure: one draft's send summary → result or thrown `CatalogSendError` (exported for tests). */
export function interpretSendSummary(draftId: string, summary: SendSummary): CatalogSendResult {
  const r = (summary?.results ?? []).find((x) => x.draftId === draftId);
  if (!r) throw new CatalogSendError('listings.draftError.internal', { status: 500 });
  if (r.status === 'success') {
    lastSendParams.delete(draftId);
    const created = typeof r.externalId === 'string' && r.externalId ? r.externalId : null;
    return { listingId: created, warnings: [] };
  }
  if (r.status === 'pending') {
    lastSendParams.delete(draftId);
    return { listingId: null, warnings: [], pending: true };
  }
  if (r.status === 'conflict') {
    throw new CatalogSendError(r.errorKey && isI18nKey(r.errorKey) ? r.errorKey : 'listings.draftError.conflict', { conflict: true });
  }
  if (r.status === 'skipped') {
    const key =
      r.reason === 'queued_delete'
        ? 'listingEditor.catalog.confirmRemoval'
        : r.reason === 'not_found'
          ? 'listings.draftError.draftNotFound'
          : 'listings.draftError.notEditable';
    throw new CatalogSendError(key, { status: 409 });
  }
  const key = r.errorKey && isI18nKey(r.errorKey) ? r.errorKey : 'listings.draftError.remoteFailed';
  if (r.errorParams && Object.keys(r.errorParams).length) lastSendParams.set(draftId, r.errorParams);
  throw new CatalogSendError(key, { params: r.errorParams });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Local storage (device copy, create defaults); every access is wrapped (private windows, blocked storage)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function readJson(key: string): unknown {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Field ⇄ patch helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `''` / null / NaN → null; numbers and numeric strings ("12,50") → number. */
export function numOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** number | '' form value. */
export function numOrBlank(v: unknown): number | '' {
  const n = numOrNull(v);
  return n === null ? '' : n;
}

export function strOf(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

export function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** JSON array form value (string or array) → array; malformed → []. */
export function jsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string' || !v.trim()) return [];
  try {
    const parsed = JSON.parse(v) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The fields-patch builder every catalog adapter shares. `toPatch(current, remote, mode)` returns the canonical
 * patch values the form currently means (`undefined` = this key is not set by the form). Keys whose value equals the
 * remote (edit) are sent as `null` (drop), so a stage always leaves the draft equal to the form for the keys the
 * form owns; keys the form has no input for (`extra`) are never sent and stay in the draft.
 */
export type PatchValues = Partial<Record<keyof CatalogFieldPatch, unknown>>;

export function patchForStage(next: PatchValues, base: PatchValues | null, ownedKeys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ownedKeys) {
    const v = (next as Record<string, unknown>)[k];
    const b = base ? (base as Record<string, unknown>)[k] : undefined;
    if (v === undefined || (base && sameJson(v, b))) out[k] = null;
    else out[k] = v;
  }
  return out;
}

/** Order-sensitive structural equality of plain JSON values (numbers compared exactly). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return a === b;
  return stableJson(a) === stableJson(b);
}

export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The adapter factory
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CatalogAdapterSpec<F extends FieldMap> {
  marketplace: CatalogMarketplace;
  blankFields(defaults?: Partial<F>): F;
  /** Form keys that are display labels or read-only facts: never staged, never a change. */
  displayOnlyKeys: readonly string[];
  /** Form keys that only exist while creating (→ `queuedActions.create.payload`); read-only in edit. */
  createOnlyKeys: readonly string[];
  /** Canonical `fieldPatch` keys the form owns (re-sent, or dropped with `null`, on every stage). */
  patchKeys: (mode: EditorMode, fields: F, remote: F | null) => readonly string[];
  /** Form → canonical patch values (`undefined` = not set). `remote` = the marketplace values (edit) or null. */
  toPatch: (fields: F, remote: F | null, mode: EditorMode) => PatchValues;
  /** Create-only values → the create payload (`null` drops a key). */
  toCreatePayload?: (fields: F) => Record<string, unknown>;
  /**
   * Last word on the staged `fields` body (after unchanged keys became `null`): e.g. Wix re-sends the discount with
   * a price edit of a discounted product (server rule DISCOUNTED).
   */
  finalizePatch?: (body: Record<string, unknown>, ctx: { current: F; remote: F | null; mode: EditorMode; next: PatchValues }) => Record<string, unknown>;
  /** Draft `fieldPatch` (+ create payload) over base fields. Returns the keys it applied and the keys without input. */
  overlayPatch: (base: F, patch: Record<string, unknown>, createPayload: Record<string, unknown>) => { fields: F; extra: Record<string, unknown>; applied: number };
  load: (ctx: AdapterContext) => Promise<LoadedListing<F>>;
  loadCopySource?: (ctx: AdapterContext) => Promise<CopySourceData | null>;
  fieldsFromCopy: (src: CopySourceData) => Partial<F>;
  validate: (fields: F, mode: EditorMode) => FieldIssue[];
  error: CatalogErrorSpec;
  /** Form keys remembered from the last create on this store ("From your last product"). */
  defaultKeys: readonly (keyof F & string)[];
  /** Called after a create stage with the draft (e.g. keep Trendyol category / brand labels for `?draft=`). */
  afterCreateStage?: (draft: DraftRow, fields: F) => void;
}

export function catalogDeviceKey(marketplace: CatalogMarketplace, id: string): string {
  return `catalog_listing_draft_${marketplace}_${id}`;
}

export function catalogDefaultsKey(marketplace: CatalogMarketplace, storeId: string): string {
  return `kx.${marketplace}.createDefaults.${storeId || 'default'}`;
}

/** Keys that differ between remote (or blank) and current, without display-only (and, in edit, create-only) keys. */
export function catalogChangedKeys<F extends FieldMap>(spec: Pick<CatalogAdapterSpec<F>, 'displayOnlyKeys' | 'createOnlyKeys'>, remote: F | null, current: F, mode: EditorMode): string[] {
  const skip = new Set<string>([...spec.displayOnlyKeys, ...(mode === 'edit' ? spec.createOnlyKeys : [])]);
  return diffKeys(remote, current).filter((k) => !skip.has(k));
}

export function createCatalogAdapter<F extends FieldMap>(spec: CatalogAdapterSpec<F>): ListingEditorAdapter<F> & {
  send(draft: DraftRow, opts?: CatalogSendOptions): Promise<CatalogSendResult>;
} {
  const mp = spec.marketplace;
  const modeOf = (ctx: AdapterContext, draft: DraftRow | null): EditorMode =>
    isLocalId(ctx.listingId) || (draft ? draft.queuedActions.some((a) => a.type === 'create_listing' && !a.completedAt) : false) ? 'create' : 'edit';

  async function stage(ctx: AdapterContext, body: {
    fields?: Record<string, unknown>;
    queuedActions?: { type: CatalogQueuedActionType; payload?: Record<string, unknown> }[];
    removeQueuedActions?: CatalogQueuedActionType[];
  }): Promise<DraftRow | null> {
    if (!ctx.listingId) throw new Error('stage: listingId is required');
    const dto = await stageCatalogDraft({
      marketplace: mp,
      storeId: ctx.shopId || undefined,
      externalId: toExternalId(ctx.listingId),
      ...body,
    } as Parameters<typeof stageCatalogDraft>[0]);
    return toCatalogDraftRow(dto);
  }

  return {
    marketplace: mp,
    displayName: CATALOG_DISPLAY_NAME[mp],
    blankFields: (defaults) => spec.blankFields(defaults),
    fieldsFromCopy: spec.fieldsFromCopy,
    readCreateDefaults(shopId) {
      const raw = readJson(catalogDefaultsKey(mp, shopId));
      if (!isObj(raw)) return {};
      const blank = spec.blankFields();
      const out: Partial<F> = {};
      for (const k of spec.defaultKeys) {
        const v = raw[k];
        // Only values of the field's own type (a stale or edited entry never breaks the form).
        if (v === undefined || v === null || v === '') continue;
        if (typeof v === typeof blank[k] || (blank[k] === '' && typeof v === 'number')) (out as Record<string, unknown>)[k] = v;
      }
      return out;
    },
    writeCreateDefaults(shopId, fields) {
      const out: Record<string, unknown> = {};
      for (const k of spec.defaultKeys) out[k] = fields[k];
      writeJson(catalogDefaultsKey(mp, shopId), out);
    },
    newLocalListingId: () => newCatalogLocalId(),
    load: spec.load,
    loadCopySource: spec.loadCopySource,
    loadDraft: (input) => loadCatalogDraftRow(mp, input),
    overlay(base, draft) {
      if (!draft) return { fields: base, extra: {}, applied: 0 };
      return spec.overlayPatch(base, draft.fieldPatch ?? {}, createPayloadOfRow(draft));
    },
    // Create: compared with the blank workspace (defaults such as VAT 20% or status Draft are not "changes").
    changedKeys: (remote, current) => catalogChangedKeys(spec, remote ?? spec.blankFields(), current, remote ? 'edit' : 'create'),
    async stageFields(input: StageFieldsInput<F>) {
      const { ctx, current, draft } = input;
      const mode = input.mode === 'create' || modeOf(ctx, draft) === 'create' ? 'create' : 'edit';
      const remote = mode === 'edit' ? input.remote : null;
      const keys = spec.patchKeys(mode, current, remote);
      const next = spec.toPatch(current, remote, mode);
      const base = remote ? spec.toPatch(remote, remote, mode) : null;
      const raw = patchForStage(next, base, keys);
      const fields = spec.finalizePatch ? spec.finalizePatch(raw, { current, remote, mode, next }) : raw;
      const anyValue = Object.values(fields).some((v) => v !== null);
      if (mode === 'create') {
        // The create already went out from this workspace: never stage a second one (reload opens the product).
        if (createWasSent(ctx.listingId)) throw new CatalogSendError('listingEditor.catalog.createdReload', { status: 409 });
        const payload = spec.toCreatePayload ? spec.toCreatePayload(current) : {};
        const row = await stage(ctx, { fields, queuedActions: [{ type: 'create', payload }] });
        if (row) spec.afterCreateStage?.(row, current);
        return row;
      }
      // Edit: nothing differs and nothing is staged → no draft (never create an empty one).
      if (!anyValue && !draft) return null;
      const row = await stage(ctx, { fields });
      // Every form value is back to the marketplace's and nothing else is staged: drop the empty draft.
      if (row && !anyValue && Object.keys(row.fieldPatch ?? {}).length === 0 && !row.queuedActions.some((a) => !a.completedAt)) {
        if (row.status === 'draft') {
          await discardCatalogDraft(row.id);
          return null;
        }
      }
      return row;
    },
    async stageActions(ctx, actions) {
      const mapped = actions
        .map((a) => CATALOG_ACTION[a.type])
        .filter((t): t is CatalogQueuedActionType => Boolean(t) && t !== 'create');
      // `publish` (the engine's create primary) and Etsy-only actions do not exist here: nothing to stage.
      if (!mapped.length) return null;
      return stage(ctx, { queuedActions: Array.from(new Set(mapped)).map((type) => ({ type })) });
    },
    async removeActions(draftId, types) {
      const mapped = Array.from(new Set(types.map((t) => CATALOG_ACTION[t]).filter((t): t is CatalogQueuedActionType => Boolean(t) && t !== 'create')));
      if (!mapped.length) return null;
      return toCatalogDraftRow(await removeCatalogDraftQueuedActions(draftId, mapped));
    },
    async stageImageUrls() {
      // Copy / prefill photos are already the `images` field (staged as URLs with the fields).
      return null;
    },
    async discard(draftId) {
      await discardCatalogDraft(draftId);
    },
    send: (draft, opts) => sendCatalogDraftRow(draft, opts as CatalogSendOptions | undefined),
    validate: spec.validate,
    errorInfo: (err) => catalogErrorInfo(spec.error, err),
    failureCauseKey: catalogFailureCauseKey,
    readDeviceCopy(key) {
      const raw = readJson(catalogDeviceKey(mp, key));
      if (!isObj(raw) || raw.v !== 1 || !isObj(raw.fields)) return null;
      return { fields: raw.fields as Partial<F>, savedAt: Number(raw.savedAt) || 0 };
    },
    writeDeviceCopy(key, fields) {
      return writeJson(catalogDeviceKey(mp, key), { v: 1, savedAt: Date.now(), fields });
    },
    clearDeviceCopy(key) {
      removeKey(catalogDeviceKey(mp, key));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Reads shared by the three loaders
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    let key: string | null = null;
    try {
      const body = (await res.json()) as { key?: unknown };
      key = typeof body?.key === 'string' && isI18nKey(body.key) ? body.key : null;
    } catch {
      /* no body */
    }
    throw new CatalogEditorLoadError(res.status, key);
  }
  return res.json();
}

/** The grid's row for one product (`GET /api/listings?ids=`): status, link, health, store currency. */
export interface CatalogListingRow {
  row: Record<string, unknown> | null;
  store: { id: string; name: string; currency: string } | null;
}

export async function loadListingRow(marketplace: CatalogMarketplace, storeId: string, id: string): Promise<CatalogListingRow> {
  const qs = new URLSearchParams({ marketplace, ids: id });
  if (storeId) qs.set('store', storeId);
  try {
    const data = (await getJson(`/api/listings?${qs.toString()}`)) as { rows?: unknown[]; store?: Record<string, unknown> };
    const row = Array.isArray(data?.rows) ? (data.rows.find((r) => isObj(r) && r.id === id) as Record<string, unknown> | undefined) : undefined;
    const s = isObj(data?.store) ? data.store : null;
    return {
      row: row ?? null,
      store: s ? { id: String(s.id ?? ''), name: String(s.name ?? ''), currency: String(s.currency ?? '') } : null,
    };
  } catch {
    // Best effort: the editor works without it (no status pill, no link).
    return { row: null, store: null };
  }
}

/** Back target: the list with its URL state when the editor was opened from it. */
export function catalogBackHref(marketplace: CatalogMarketplace, storeId: string | null): string {
  const nav = readEditorNav();
  if (nav && nav.marketplace === marketplace && (!nav.shopId || !storeId || nav.shopId === storeId) && nav.query) {
    return listHref(marketplace, storeId, nav.query);
  }
  return listHref(marketplace, storeId);
}

/** Pure: a field value equals its remote value (re-export for the per-marketplace adapters). */
export function sameField(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  return fieldEquals(a, b);
}
