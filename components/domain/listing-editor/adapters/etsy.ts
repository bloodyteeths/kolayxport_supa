// components/domain/listing-editor/adapters/etsy.ts — Etsy staging for the editor (listing-editor §5.1, §7).
// Payload builders moved from `components/etsy/ListingEditorDrawer.tsx` (`buildInitialFields`,
// `overlayFieldPatch`, `getChangedFields`, `handleSave`) and `ListingCreatorDialog.tsx` (`handleCreate` body,
// last-used defaults). The server contract is unchanged: `stageEtsyDraft({ fields, replaceFields: true })`,
// queued actions, `syncEtsyDraft` without `force`, `discardEtsyDraft`, `removeEtsyDraftQueuedActions`.
// P5: marketplace text is entity-decoded on load and decoded again before staging, so "one&#39;s" never goes
// back to Etsy (CRITIQUE V2).
import {
  discardEtsyDraft,
  EtsyDraftClientError,
  fetchEtsyDrafts,
  removeEtsyDraftQueuedActions,
  stageEtsyDraft,
  syncEtsyDraft,
} from '@/lib/etsy/draftClient';
import { validateEtsyFields } from '@/lib/etsy/validation';
import { decodeEntities, decodeEntityFields, decodeEntityList } from '@/lib/text/decodeEntities';
import { sectionForField } from '@/lib/listingEditor/sections';
import type {
  CopySourceData,
  DraftMediaRow,
  DraftRow,
  DraftSyncAttempt,
  EditorMode,
  EtsyEditorFields,
  FieldIssue,
  FieldMap,
  FieldValue,
  ListingMeta,
  QueuedAction,
  RemoteImage,
} from '@/lib/listingEditor/types';
import { diffKeys, fieldEquals } from '../changeSummary';
import { storedDraftSendError } from '../draftSendError';
import { legacySendErrorKey } from '@/lib/listings/sendError';
import type { AdapterContext, AdapterErrorInfo, ListingEditorAdapter, LoadedListing, StageFieldsInput } from './types';

/** Etsy's photo limit per listing. */
export const ETSY_MAX_IMAGES = 20;

/** Server draft statuses whose patches are still pending (not yet on Etsy). Same set as the drawer. */
export const PENDING_DRAFT_STATUSES = ['draft', 'failed', 'conflict', 'syncing'];

/** Keys of `EtsyEditorFields`, in form order. */
export const ETSY_FIELD_KEYS = [
  'title',
  'description',
  'tags',
  'materials',
  'price',
  'quantity',
  'who_made',
  'when_made',
  'is_supply',
  'taxonomy_id',
  'shop_section_id',
  'shipping_profile_id',
  'return_policy_id',
  'processing_min',
  'processing_max',
  'readiness_state_id',
  'item_weight',
  'item_weight_unit',
  'item_length',
  'item_width',
  'item_height',
  'item_dimensions_unit',
] as const satisfies ReadonlyArray<keyof EtsyEditorFields>;

const TEXT_KEYS = ['title', 'description'] as const;
const LIST_KEYS = ['tags', 'materials'] as const;
/** Optional ids / numbers: '' = not set; never sent as '' (Etsy cannot unset them). */
const OPTIONAL_NUMBER_KEYS = [
  'taxonomy_id',
  'shop_section_id',
  'shipping_profile_id',
  'return_policy_id',
  'processing_min',
  'processing_max',
  'readiness_state_id',
  'item_weight',
  'item_length',
  'item_width',
  'item_height',
] as const;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Remote listing (`GET /api/clawd/etsy?action=listing`)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface EtsyPrice {
  amount: number;
  divisor: number;
  currency_code: string;
}

/** The fields of `action=listing` the editor reads (same shape as the drawer's `ListingData`). */
export interface EtsyListingData {
  listing_id: number;
  title?: string;
  description?: string;
  tags?: string[];
  materials?: string[];
  price?: EtsyPrice | null;
  views?: number;
  num_favorers?: number;
  quantity?: number;
  state?: string;
  url?: string;
  taxonomy_id?: number | null;
  shop_section_id?: number | null;
  processing_min?: number | null;
  processing_max?: number | null;
  readiness_state_id?: number | null;
  who_made?: string | null;
  when_made?: string | null;
  is_supply?: boolean | null;
  item_weight?: number | null;
  item_weight_unit?: string | null;
  item_length?: number | null;
  item_width?: number | null;
  item_height?: number | null;
  item_dimensions_unit?: string | null;
  shipping_profile_id?: number | null;
  return_policy_id?: number | null;
  updated_timestamp?: number | null;
  is_personalizable?: boolean;
  personalization_is_required?: boolean;
  personalization_instructions?: string;
  personalization_char_count_max?: number;
  personalization_questions?: unknown[];
  images?: Array<{
    listing_image_id: number;
    url_75x75?: string;
    url_170x135?: string;
    url_570xN?: string;
    url_fullxfull?: string;
    rank?: number;
    alt_text?: string | null;
  }>;
}

/** Thrown by `load` with the HTTP status (401 → reconnect, 404 → not on Etsy any more). */
export class EtsyEditorLoadError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message || `HTTP ${status}`);
    this.name = 'EtsyEditorLoadError';
    this.status = status;
  }
}

/** Two-decimal API string (Etsy staging format, not display: display goes through <Money>). */
export function decimal2(n: number): string {
  const cents = Math.round(n * 100);
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function priceToDecimal(price: EtsyPrice | null | undefined): string {
  if (!price) return '0.00';
  return decimal2(price.amount / (price.divisor || 100));
}

const num = (v: number | null | undefined): number | '' => (typeof v === 'number' && Number.isFinite(v) ? v : '');

/** `buildInitialFields` from the drawer, plus `taxonomy_id` (Category is an input now) and entity decoding. */
export function etsyFieldsFromListing(listing: EtsyListingData): EtsyEditorFields {
  return {
    title: decodeEntities(listing.title ?? ''),
    description: decodeEntities(listing.description ?? ''),
    tags: decodeEntityList(listing.tags ?? []),
    materials: decodeEntityList(listing.materials ?? []),
    price: priceToDecimal(listing.price ?? null),
    quantity: typeof listing.quantity === 'number' ? listing.quantity : 0,
    who_made: listing.who_made || 'i_did',
    when_made: listing.when_made || 'made_to_order',
    is_supply: listing.is_supply ?? false,
    taxonomy_id: num(listing.taxonomy_id),
    shop_section_id: num(listing.shop_section_id),
    shipping_profile_id: num(listing.shipping_profile_id),
    return_policy_id: num(listing.return_policy_id),
    processing_min: num(listing.processing_min),
    processing_max: num(listing.processing_max),
    readiness_state_id: num(listing.readiness_state_id),
    item_weight: num(listing.item_weight),
    item_weight_unit: listing.item_weight_unit || 'g',
    item_length: num(listing.item_length),
    item_width: num(listing.item_width),
    item_height: num(listing.item_height),
    item_dimensions_unit: listing.item_dimensions_unit || 'cm',
  };
}

export function etsyMetaFromListing(listing: EtsyListingData): ListingMeta {
  const images: RemoteImage[] = (listing.images ?? [])
    .map((img, i) => ({
      id: String(img.listing_image_id),
      src: img.url_570xN || img.url_fullxfull || img.url_170x135 || '',
      fullSrc: img.url_fullxfull,
      thumbSrc: img.url_170x135 || img.url_75x75,
      rank: typeof img.rank === 'number' ? img.rank : i + 1,
      alt: decodeEntities(img.alt_text ?? ''),
    }))
    .sort((a, b) => a.rank - b.rank);
  return {
    id: String(listing.listing_id),
    state: listing.state ?? null,
    url: listing.url ?? `https://www.etsy.com/listing/${listing.listing_id}`,
    updatedAt: listing.updated_timestamp ? new Date(listing.updated_timestamp * 1000) : null,
    views: Number(listing.views) || 0,
    favorites: Number(listing.num_favorers) || 0,
    currency: listing.price?.currency_code ?? null,
    images,
    personalization: {
      is_personalizable: Boolean(listing.is_personalizable),
      personalization_is_required: Boolean(listing.personalization_is_required),
      personalization_instructions: decodeEntities(listing.personalization_instructions ?? ''),
      personalization_char_count_max: listing.personalization_char_count_max ?? null,
      personalization_questions: listing.personalization_questions ?? [],
    },
    raw: listing,
  };
}

export function blankEtsyFields(defaults: Partial<EtsyEditorFields> = {}): EtsyEditorFields {
  return {
    title: '',
    description: '',
    tags: [],
    materials: [],
    price: '',
    quantity: 1,
    who_made: 'i_did',
    when_made: 'made_to_order',
    is_supply: false,
    taxonomy_id: '',
    shop_section_id: '',
    shipping_profile_id: '',
    return_policy_id: '',
    processing_min: '',
    processing_max: '',
    readiness_state_id: '',
    item_weight: '',
    item_weight_unit: 'g',
    item_length: '',
    item_width: '',
    item_height: '',
    item_dimensions_unit: 'cm',
    ...defaults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Draft overlay + payloads (moved from the drawer; behaviour identical)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Overlay a DB draft's `fieldPatch` onto editor fields (W3 §1 / §10, I0 8b). `fieldPatch` keys are snake_case
 * and match `EtsyEditorFields` one to one; keys the editor has no input for are returned in `extra` so the next
 * stage (`replaceFields`) re-sends them instead of dropping them.
 */
export function overlayEtsyFieldPatch(
  base: EtsyEditorFields,
  patch: Record<string, unknown> | null | undefined,
): { fields: EtsyEditorFields; extra: Record<string, unknown>; applied: number } {
  const next: EtsyEditorFields = { ...base, tags: [...base.tags], materials: [...base.materials] };
  const extra: Record<string, unknown> = {};
  let applied = 0;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { fields: next, extra, applied };
  const target = next as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    if (k in next) {
      if (k === 'price' && typeof v === 'number' && Number.isFinite(v)) target[k] = decimal2(v);
      else if ((LIST_KEYS as readonly string[]).includes(k) && Array.isArray(v)) target[k] = decodeEntityList(v as string[]);
      else if ((TEXT_KEYS as readonly string[]).includes(k) && typeof v === 'string') target[k] = decodeEntities(v);
      else target[k] = Array.isArray(v) ? [...v] : v;
      applied += 1;
    } else {
      extra[k] = v;
    }
  }
  return { fields: next, extra, applied };
}

/** Keys of `current` that differ from `remote` (`remote` null → every non-blank key). */
export function etsyChangedKeys(remote: EtsyEditorFields | null, current: EtsyEditorFields): string[] {
  return diffKeys(remote, current).filter((k) => (ETSY_FIELD_KEYS as readonly string[]).includes(k));
}

function cleanText(v: unknown): string {
  return decodeEntities(String(v ?? ''));
}

/** One field → the value staged in `fieldPatch` (drawer `handleSave` rules), or undefined when not sendable. */
function payloadValue(key: string, value: unknown): unknown {
  if ((TEXT_KEYS as readonly string[]).includes(key)) return cleanText(value);
  if ((LIST_KEYS as readonly string[]).includes(key)) return decodeEntityList(Array.isArray(value) ? (value as string[]) : []);
  if ((OPTIONAL_NUMBER_KEYS as readonly string[]).includes(key)) {
    if (value === '' || value === null || value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return value;
}

/**
 * Edit mode: the `fieldPatch` for `stageEtsyDraft({ fields, replaceFields: true })`: every changed field
 * (vs Etsy) with the drawer's rules, plus the draft keys the form has no input for.
 */
export function buildEtsyEditPayload(
  remote: EtsyEditorFields,
  current: EtsyEditorFields,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of etsyChangedKeys(remote, current)) {
    const v = payloadValue(key, (current as Record<string, unknown>)[key]);
    if (v !== undefined) payload[key] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    if (payload[k] === undefined) payload[k] = v;
  }
  return payload;
}

/** Create mode: the full field set (creator `handleCreate` body; blanks are left out). */
export function buildEtsyCreatePayload(current: EtsyEditorFields, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of ETSY_FIELD_KEYS) {
    const raw = (current as Record<string, unknown>)[key];
    if (key === 'price') {
      const p = parseFloat(String(raw ?? ''));
      if (Number.isFinite(p)) body.price = p;
      continue;
    }
    if (key === 'quantity') {
      body.quantity = Number.parseInt(String(raw ?? ''), 10) || 1;
      continue;
    }
    if (key === 'title' || key === 'description') {
      const v = cleanText(raw).trim();
      if (v) body[key] = v;
      continue;
    }
    const v = payloadValue(key, raw);
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    body[key] = v;
  }
  // Units only when their measurement is set (creator rule).
  if (body.item_weight === undefined) delete body.item_weight_unit;
  if (body.item_length === undefined && body.item_width === undefined && body.item_height === undefined) {
    delete body.item_dimensions_unit;
  }
  for (const [k, v] of Object.entries(extra)) {
    if (body[k] === undefined) body[k] = v;
  }
  return body;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Draft rows
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

type ServerDraft = Record<string, unknown>;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Serialised `EtsyListingDraft` (`/api/etsy-drafts`) → `DraftRow`. */
export function toDraftRow(d: ServerDraft | null | undefined): DraftRow | null {
  if (!d || typeof d !== 'object' || !d.id) return null;
  const media: DraftMediaRow[] = Array.isArray(d.media)
    ? (d.media as ServerDraft[]).map((m) => ({
        id: String(m.id),
        kind: String(m.kind ?? ''),
        operation: String(m.operation ?? ''),
        etsyMediaId: str(m.etsyMediaId),
        rank: typeof m.rank === 'number' ? m.rank : null,
        altText: str(m.altText),
        sourceUrl: str(m.sourceUrl),
        filename: str(m.filename),
        status: str(m.status),
      }))
    : [];
  const syncAttempts: DraftSyncAttempt[] = Array.isArray(d.syncAttempts)
    ? (d.syncAttempts as ServerDraft[]).map((a) => ({
        id: String(a.id),
        status: String(a.status ?? ''),
        startedAt: String(a.startedAt ?? ''),
        finishedAt: str(a.finishedAt),
        error: str(a.error),
      }))
    : [];
  return {
    id: String(d.id),
    status: String(d.status ?? 'draft'),
    listingId: String(d.etsyListingId ?? ''),
    fieldPatch: obj(d.fieldPatch) ?? {},
    taxonomyPatch: obj(d.taxonomyPatch),
    inventoryPatch: obj(d.inventoryPatch),
    variationImagesPatch: d.variationImagesPatch ?? null,
    personalizationPatch: d.personalizationPatch ?? null,
    queuedActions: Array.isArray(d.queuedActions) ? (d.queuedActions as QueuedAction[]) : [],
    media,
    lastSyncError: str(d.lastSyncError),
    syncAttempts,
    updatedAt: str(d.updatedAt),
    syncedAt: str(d.syncedAt),
    createdAt: str(d.createdAt),
    raw: d,
  };
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** Nothing staged at all (no patch, media or pending action). */
export function isDraftEmpty(draft: DraftRow): boolean {
  return (
    isEmptyValue(draft.fieldPatch) &&
    isEmptyValue(draft.taxonomyPatch) &&
    isEmptyValue(draft.inventoryPatch) &&
    isEmptyValue(draft.variationImagesPatch) &&
    isEmptyValue(draft.personalizationPatch) &&
    draft.media.length === 0 &&
    !draft.queuedActions.some((a) => a && !a.completedAt)
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const I18N_KEY_RE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;

export function etsyErrorInfo(err: unknown): AdapterErrorInfo {
  if (err instanceof EtsyDraftClientError) {
    const issues: FieldIssue[] | undefined = err.issues?.map((i) => ({
      field: i.field,
      section: sectionForField(i.field) ?? 'title',
      severity: i.severity === 'block_save' ? 'block_save' : 'block_sync',
      key: `etsy.${i.key}`,
      params: i.params,
      message: i.message,
    }));
    return {
      status: err.status,
      network: false,
      conflict: err.isConflict,
      key: err.key ? `etsy.${err.key}` : null,
      params: err.params,
      issues,
    };
  }
  if (err instanceof EtsyEditorLoadError) {
    return { status: err.status, network: false, conflict: false, key: null };
  }
  // fetch() rejects with a TypeError when the request never reached the server.
  const network = err instanceof TypeError || (err instanceof Error && /network|failed to fetch|load failed/i.test(err.message));
  return { status: null, network, conflict: false, key: null };
}

/**
 * Failed-banner cause key. The API's `lastSyncErrorKey` (`etsy.draftSync.<code>`) wins; old rows that still hold
 * English `lastSyncError` text fall back to the listings grid families (`listings.sendError.*`).
 */
export function etsyFailureCauseKey(draft: Pick<DraftRow, 'status' | 'lastSyncError' | 'raw'>): string {
  const stored = storedDraftSendError(draft, 'etsy.');
  if (stored) return stored.errorKey;
  const raw = typeof draft.lastSyncError === 'string' ? draft.lastSyncError.trim() : '';
  if (raw && I18N_KEY_RE.test(raw)) return raw.startsWith('etsy.') || raw.startsWith('listings.') ? raw : `etsy.${raw}`;
  if (draft.status === 'conflict') return 'listings.sendError.conflict';
  // One classifier for the grid and the editor: Etsy's wording → the exact field (lib/drafts/syncErrors).
  return legacySendErrorKey(String(draft.status), raw, 'etsy');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Validation (client; the server re-validates on stage and on sync)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function validateEtsyEditorFields(fields: EtsyEditorFields, mode: EditorMode): FieldIssue[] {
  const issues: FieldIssue[] = validateEtsyFields({
    title: fields.title,
    description: fields.description,
    tags: fields.tags,
    materials: fields.materials,
    price: fields.price,
    quantity: fields.quantity,
    who_made: fields.who_made,
    when_made: fields.when_made,
    is_supply: fields.is_supply,
    taxonomy_id: fields.taxonomy_id,
    shipping_profile_id: fields.shipping_profile_id,
  }).map((e) => ({
    field: e.field,
    section: sectionForField(e.field) ?? 'title',
    severity: e.severity,
    key: `etsy.${e.key || 'validation.generic'}`,
    params: e.params,
    message: e.message,
  }));
  // Drawer rule: processing min must not exceed max.
  const min = Number(fields.processing_min);
  const max = Number(fields.processing_max);
  if (fields.processing_min !== '' && fields.processing_max !== '' && min > 0 && max > 0 && min > max) {
    issues.push({ field: 'processing_min', section: 'shipping', severity: 'block_save', key: 'etsy.editor.prepTimeError' });
  }
  // Create and edit share Etsy's rules; the server re-validates the create payload on Send.
  void mode;
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Local storage (device copy + last-used defaults); every access wrapped
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Existing drawer key (`listing_draft_<id>`), reused for the offline fallback only (§5.1). */
export const DEVICE_COPY_PREFIX = 'listing_draft_';
/** Existing creator key (last shipping profile / return policy / section per shop). */
export const defaultsStorageKey = (shopId: string) => `kx.etsy.lastListingDefaults.v1:${shopId || 'default'}`;

function readJson(key: string): unknown {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

/** Device copy: v2 `{ v: 2, savedAt, fields }`; the drawer's v1 (bare fields, no time) reads as savedAt 0. */
export function readEtsyDeviceCopy(key: string): { fields: Partial<EtsyEditorFields>; savedAt: number } | null {
  const raw = obj(readJson(`${DEVICE_COPY_PREFIX}${key}`));
  if (!raw) return null;
  if (raw.v === 2 && obj(raw.fields)) {
    return { fields: raw.fields as Partial<EtsyEditorFields>, savedAt: Number(raw.savedAt) || 0 };
  }
  // v1 was written by the legacy drawer from un-decoded Etsy text ("one&#39;s"): decode it like `load` does (P5).
  if (typeof raw.title === 'string') {
    const decoded = decodeEntityFields(raw, ['title', 'description', 'tags', 'materials']);
    return { fields: decoded as Partial<EtsyEditorFields>, savedAt: 0 };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Network
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EtsyEditorLoadError(res.status, body?.error);
  }
  return res.json();
}

function q(v: string) {
  return encodeURIComponent(v);
}

export async function loadEtsyListing(ctx: AdapterContext): Promise<LoadedListing<EtsyEditorFields>> {
  if (!ctx.listingId) throw new EtsyEditorLoadError(404);
  const data = (await getJson(`/api/clawd/etsy?action=listing&listing_id=${q(ctx.listingId)}&shop_id=${q(ctx.shopId)}`)) as EtsyListingData;
  return { fields: etsyFieldsFromListing(data), meta: etsyMetaFromListing(data) };
}

/** `?copy=<id>`: the source listing as a create prefill (legacy "Copy listing", photos staged by URL on create). */
export async function loadEtsyCopySource(ctx: AdapterContext): Promise<CopySourceData | null> {
  if (!ctx.listingId) return null;
  const data = (await getJson(`/api/clawd/etsy?action=listing&listing_id=${q(ctx.listingId)}&shop_id=${q(ctx.shopId)}`)) as EtsyListingData;
  const f = etsyFieldsFromListing(data);
  const imageUrls = (data.images ?? [])
    .slice()
    .sort((a, b) => (Number(a?.rank) || 99) - (Number(b?.rank) || 99))
    .map((img) => img?.url_fullxfull || img?.url_570xN)
    .filter((u): u is string => typeof u === 'string' && /^https:\/\//i.test(u))
    .slice(0, ETSY_MAX_IMAGES);
  const n = (v: number | '') => (v === '' ? undefined : v);
  const price = parseFloat(f.price);
  return {
    source: 'etsy',
    // Same convention as the legacy copy: no "COPY - " prefix (dashes break the commas-only title rule).
    title: f.title,
    description: f.description,
    tags: f.tags,
    materials: f.materials,
    price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : undefined,
    quantity: f.quantity || undefined,
    who_made: f.who_made,
    when_made: f.when_made,
    is_supply: f.is_supply,
    shipping_profile_id: n(f.shipping_profile_id),
    return_policy_id: n(f.return_policy_id),
    shop_section_id: f.shop_section_id === '' ? null : f.shop_section_id,
    taxonomy_id: n(f.taxonomy_id),
    processing_min: n(f.processing_min),
    processing_max: n(f.processing_max),
    item_weight: n(f.item_weight),
    item_weight_unit: f.item_weight_unit,
    item_length: n(f.item_length),
    item_width: n(f.item_width),
    item_height: n(f.item_height),
    item_dimensions_unit: f.item_dimensions_unit,
    imageUrls,
  };
}

export function etsyFieldsFromCopy(src: CopySourceData): Partial<EtsyEditorFields> {
  const out: Partial<EtsyEditorFields> = {
    title: decodeEntities(src.title ?? ''),
    description: decodeEntities(src.description ?? ''),
    tags: decodeEntityList(src.tags ?? []),
    materials: decodeEntityList(src.materials ?? []),
  };
  if (typeof src.price === 'number' && Number.isFinite(src.price)) out.price = decimal2(src.price);
  if (typeof src.quantity === 'number') out.quantity = src.quantity;
  if (src.who_made) out.who_made = src.who_made;
  if (src.when_made) out.when_made = src.when_made;
  if (typeof src.is_supply === 'boolean') out.is_supply = src.is_supply;
  if (typeof src.taxonomy_id === 'number') out.taxonomy_id = src.taxonomy_id;
  if (typeof src.shipping_profile_id === 'number') out.shipping_profile_id = src.shipping_profile_id;
  if (typeof src.return_policy_id === 'number') out.return_policy_id = src.return_policy_id;
  if (typeof src.shop_section_id === 'number') out.shop_section_id = src.shop_section_id;
  if (typeof src.processing_min === 'number') out.processing_min = src.processing_min;
  if (typeof src.processing_max === 'number') out.processing_max = src.processing_max;
  if (typeof src.item_weight === 'number') out.item_weight = src.item_weight;
  if (src.item_weight_unit) out.item_weight_unit = src.item_weight_unit;
  if (typeof src.item_length === 'number') out.item_length = src.item_length;
  if (typeof src.item_width === 'number') out.item_width = src.item_width;
  if (typeof src.item_height === 'number') out.item_height = src.item_height;
  if (src.item_dimensions_unit) out.item_dimensions_unit = src.item_dimensions_unit;
  return out;
}

/** Research prefill (`?prefill=session`, `ListingPrefillV1`) → copy data. */
export function copyFromPrefill(p: {
  title?: string;
  description?: string;
  tags?: string[];
  price?: number;
  imageUrls?: string[];
}): CopySourceData {
  return {
    source: 'research',
    title: p.title ?? '',
    description: p.description ?? '',
    tags: Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === 'string') : [],
    price: typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0 ? p.price : undefined,
    imageUrls: Array.isArray(p.imageUrls)
      ? p.imageUrls.filter((u) => typeof u === 'string' && /^https:\/\//i.test(u)).slice(0, ETSY_MAX_IMAGES)
      : [],
  };
}

/** Stage the copy's image URLs on a new local listing (server downloads them only on Send). */
export async function stageEtsyImageUrls(ctx: AdapterContext, urls: string[]): Promise<DraftRow | null> {
  if (!ctx.listingId || urls.length === 0) return null;
  const draft = await stageEtsyDraft({
    shopId: ctx.shopId,
    listingId: ctx.listingId,
    media: urls.slice(0, ETSY_MAX_IMAGES).map((sourceUrl, i) => ({ kind: 'image', operation: 'upload', sourceUrl, rank: i + 1 })),
  });
  return toDraftRow(draft);
}

export async function loadEtsyDraft(input: { shopId: string; listingId?: string | null; draftId?: string | null }): Promise<DraftRow | null> {
  if (!input.shopId) return null;
  if (input.draftId) {
    const all = (await fetchEtsyDrafts(input.shopId)) as ServerDraft[];
    return toDraftRow(all.find((d) => String(d.id) === input.draftId) ?? null);
  }
  if (!input.listingId) return null;
  const drafts = (await fetchEtsyDrafts(input.shopId, input.listingId)) as ServerDraft[];
  // Same pick as the drawer: the newest pending draft (the API orders by updatedAt desc).
  const pending = drafts.find((d) => PENDING_DRAFT_STATUSES.includes(String(d?.status)));
  return toDraftRow(pending ?? null);
}

export async function stageEtsyFields(input: StageFieldsInput<EtsyEditorFields>): Promise<DraftRow | null> {
  const { ctx, mode, remote, current, extra, draft } = input;
  if (!ctx.listingId) throw new Error('stageEtsyFields: listingId is required');

  if (mode === 'create') {
    const body = buildEtsyCreatePayload(current, extra);
    const staged = await stageEtsyDraft({
      shopId: ctx.shopId,
      listingId: ctx.listingId,
      fields: body,
      replaceFields: true,
      // Always sent: the server dedupes identical actions, and a media-only draft staged first by the photo
      // section must still get its create. The server merges `payload` with `fieldPatch` on Send.
      queuedActions: [{ type: 'create_listing', payload: {} }],
    });
    return toDraftRow(staged);
  }

  if (!remote) throw new Error('stageEtsyFields: remote values are required in edit mode');
  const payload = buildEtsyEditPayload(remote, current, extra);
  if (Object.keys(payload).length === 0 && !draft) return null; // nothing to stage; never create an empty draft
  const staged = toDraftRow(await stageEtsyDraft({ shopId: ctx.shopId, listingId: ctx.listingId, fields: payload, replaceFields: true }));
  // Everything reverted: an empty plain draft is discarded so the listing reads "Up to date" (§5.1).
  if (staged && staged.status === 'draft' && isDraftEmpty(staged)) {
    // Photo / video sub-editors stage outside the engine queue: re-read the row right before the discard and
    // keep it when anything landed on it meanwhile (an atomic server-side "discard if empty" is requested
    // from backend BR-3; until then this narrows the window to one round-trip).
    const fresh = (await fetchEtsyDrafts(ctx.shopId, ctx.listingId)) as ServerDraft[];
    const again = toDraftRow(fresh.find((d) => String(d?.id) === staged.id) ?? null);
    if (!again) return null;
    if (again.status !== 'draft' || !isDraftEmpty(again) || again.updatedAt !== staged.updatedAt) return again;
    await discardEtsyDraft(staged.id);
    return null;
  }
  return staged;
}

export function newEtsyLocalListingId(): string {
  return String(-Date.now());
}

export const etsyAdapter: ListingEditorAdapter<EtsyEditorFields> = {
  marketplace: 'etsy',
  displayName: 'Etsy',
  blankFields: blankEtsyFields,
  fieldsFromCopy: etsyFieldsFromCopy,
  readCreateDefaults(shopId) {
    const last = obj(readJson(defaultsStorageKey(shopId)));
    if (!last) return {};
    const out: Partial<EtsyEditorFields> = {};
    if (typeof last.shippingProfileId === 'number') out.shipping_profile_id = last.shippingProfileId;
    if (typeof last.returnPolicyId === 'number') out.return_policy_id = last.returnPolicyId;
    if (typeof last.shopSectionId === 'number') out.shop_section_id = last.shopSectionId;
    return out;
  },
  writeCreateDefaults(shopId, fields) {
    writeJson(defaultsStorageKey(shopId), {
      shippingProfileId: fields.shipping_profile_id,
      returnPolicyId: fields.return_policy_id,
      shopSectionId: fields.shop_section_id,
    });
  },
  newLocalListingId: newEtsyLocalListingId,
  load: loadEtsyListing,
  loadCopySource: loadEtsyCopySource,
  loadDraft: loadEtsyDraft,
  overlay(base, draft) {
    return overlayEtsyFieldPatch(base, draft?.fieldPatch ?? null);
  },
  changedKeys: etsyChangedKeys,
  stageFields: stageEtsyFields,
  async stageActions(ctx, actions, fields) {
    if (!ctx.listingId) throw new Error('stageActions: listingId is required');
    return toDraftRow(
      await stageEtsyDraft({ shopId: ctx.shopId, listingId: ctx.listingId, queuedActions: actions, ...(fields ? { fields } : {}) }),
    );
  },
  async removeActions(draftId, types) {
    return toDraftRow(await removeEtsyDraftQueuedActions(draftId, types));
  },
  stageImageUrls: stageEtsyImageUrls,
  async discard(draftId) {
    await discardEtsyDraft(draftId);
  },
  async send(draft) {
    // Never `force`: a conflict goes through Review differences (listing-editor §6.4).
    const result = (await syncEtsyDraft(draft.id)) as { etsyListingId?: unknown; warnings?: unknown; deleted?: unknown };
    const warnings = Array.isArray(result?.warnings)
      ? (result.warnings as Array<{ key?: string; params?: Record<string, string | number>; message?: string }>).map((w) => ({
          key: w?.key ? `etsy.${w.key}` : undefined,
          params: w?.params,
          message: w?.message,
        }))
      : [];
    return {
      listingId: result?.etsyListingId != null ? String(result.etsyListingId) : null,
      deleted: result?.deleted === true,
      warnings,
    };
  },
  validate: validateEtsyEditorFields,
  errorInfo: etsyErrorInfo,
  failureCauseKey: etsyFailureCauseKey,
  readDeviceCopy: readEtsyDeviceCopy,
  writeDeviceCopy(key, fields) {
    return writeJson(`${DEVICE_COPY_PREFIX}${key}`, { v: 2, savedAt: Date.now(), fields });
  },
  clearDeviceCopy(key) {
    removeKey(`${DEVICE_COPY_PREFIX}${key}`);
  },
};

/** True when a device copy differs from the given fields (restore banner). */
export function deviceCopyDiffers(copy: Partial<EtsyEditorFields>, fields: EtsyEditorFields): boolean {
  return Object.entries(copy).some(
    ([k, v]) => (ETSY_FIELD_KEYS as readonly string[]).includes(k) && !fieldEquals(v as FieldValue, (fields as FieldMap)[k]),
  );
}

export default etsyAdapter;
