// Batch staging contract for the bulk grid (bulk-grid.md §6.2, M7-B).
//
// Pure module: no Prisma, no fetch. The three route files
//   POST /api/etsy-drafts/batch-stage
//   POST /api/ebay-drafts/batch-stage
//   POST /api/catalog-drafts { items: [...] }
// share these types, limits and helpers, and the client queue (M7-C
// `useBulkStaging`) imports the types from here.
//
// Every `key` in a batch result is FULLY QUALIFIED (namespace included, e.g.
// `etsy.validation.titleTooLong`, `ebay.draftSync.rejected`,
// `listings.draftError.invalidTitle`, `bulk.stage.budget`), so the client can
// call the root translator `t(key, params)` without knowing which engine
// produced it. Staging never writes to a marketplace: batch items cannot carry
// queued actions (so no delete can be queued here) or media.

import { validateEtsyFieldPatch, type FieldError } from '@/lib/etsy/validation';

/** Max items per batch request (client chunks above this). */
export const BATCH_STAGE_MAX_ITEMS = 50;
/** Items staged in parallel inside one request (a new Etsy draft costs ~2 live reads). */
export const BATCH_STAGE_CONCURRENCY = 5;
/** Etsy calls a new draft costs (listing + inventory snapshot) — used for the daily budget gate. */
export const ETSY_CALLS_PER_NEW_DRAFT = 2;

export type BatchStageIssue = {
  field: string;
  /** Fully-qualified i18n key. */
  key: string;
  params?: Record<string, string | number>;
};

export type BatchStageOk = {
  /** Etsy listing id, eBay SKU, or catalog externalId (the row id the grid sent). */
  listingId: string;
  ok: true;
  draftId: string;
  status: 'draft' | 'failed' | 'conflict';
  /** Fields that were NOT staged (invalid values); the rest of the item was staged. */
  rejected?: BatchStageIssue[];
  /** Staged, but Etsy will refuse them at send until fixed (block_sync). */
  warnings?: BatchStageIssue[];
};

export type BatchStageFail = {
  listingId: string;
  ok: false;
  code: string;
  /** Fully-qualified i18n key. */
  key: string;
  params?: Record<string, string | number>;
  /** Per-field reasons when code is VALIDATION_FAILED. */
  issues?: BatchStageIssue[];
};

export type BatchStageResult = BatchStageOk | BatchStageFail;
export type BatchStageResponse = { results: BatchStageResult[] };

/** Etsy request item. */
export type EtsyBatchStageItem = {
  listingId: string;
  fields?: Record<string, unknown>;
  inventory?: Record<string, unknown>;
  replaceFields?: boolean;
};

/** eBay request item (eBay drafts are keyed by SKU). */
export type EbayBatchStageItem = {
  sku: string;
  offerId?: string;
  inventoryFields?: Record<string, unknown>;
  offerFields?: Record<string, unknown>;
  replaceFields?: boolean;
};

/** Catalog (Trendyol/Wix/Shopify) request item. `null` field values remove the key from the patch. */
export type CatalogBatchStageItem = {
  externalId: string;
  fields?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Request-level errors (whole request refused: HTTP 400)
// ---------------------------------------------------------------------------

export class BatchStageRequestError extends Error {
  code: string;
  key: string;
  params?: Record<string, string | number>;
  constructor(code: string, key: string, message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'BatchStageRequestError';
    this.code = code;
    this.key = key;
    this.params = params;
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Validates the `items` envelope: array, 1..50 entries, plain objects. */
export function assertItemsArray(items: unknown): Record<string, unknown>[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new BatchStageRequestError('INVALID_INPUT', 'bulk.stage.invalidRequest', 'items must be a non-empty array');
  }
  if (items.length > BATCH_STAGE_MAX_ITEMS) {
    throw new BatchStageRequestError('TOO_MANY', 'bulk.stage.tooMany', `At most ${BATCH_STAGE_MAX_ITEMS} items per request`, { max: BATCH_STAGE_MAX_ITEMS });
  }
  if (items.some((it) => !isPlainObject(it))) {
    throw new BatchStageRequestError('INVALID_INPUT', 'bulk.stage.invalidRequest', 'every item must be an object');
  }
  return items as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

/**
 * Maps `items` through `fn` with at most `limit` calls in flight, preserving
 * input order. `fn` must not throw (wrap errors into a result); if it does, the
 * error propagates.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Etsy field sanitising (stricter than the editor: invalid cells stay local)
// ---------------------------------------------------------------------------

/**
 * Listing fields the bulk grid may stage (bulk-grid §6.1 field mapping plus
 * the description Find & replace edits and the processing column). Anything
 * else (e.g. `state`) is refused per field: state changes go through queued
 * actions, which this endpoint never accepts.
 */
export const ETSY_BATCH_FIELDS = new Set([
  'title',
  'description',
  'tags',
  'materials',
  'price',
  'quantity',
  'shop_section_id',
  'who_made',
  'when_made',
  'is_supply',
  'taxonomy_id',
  'shipping_profile_id',
  'readiness_state_id',
  'processing_min',
  'processing_max',
]);

/**
 * Fields whose value is self-contained: any validator error on them (even a
 * block_sync one the editor tolerates while typing) means the pasted value is
 * wrong, so it is not staged. Provenance (who_made/when_made/is_supply)
 * combinations depend on values outside the patch, so their block_sync issues
 * are staged and reported as warnings instead.
 */
const SELF_CONTAINED = new Set(['title', 'description', 'tags', 'materials', 'price', 'quantity', 'processing_min', 'processing_max']);

/** A strict decimal: "12", "12.5", "12.50". Locale parsing is the client's job (lib/bulk/parseMoney). */
const STRICT_DECIMAL = /^\d{1,9}(\.\d{1,2})?$/;
const ID_LIKE = /^\d{1,20}$/;
/** Never staged through this endpoint, even on a revert: state changes are queued actions. */
const NEVER_STAGED = new Set(['state']);

function issue(field: string, key: string, params?: Record<string, string | number>): BatchStageIssue {
  return { field, key, ...(params ? { params } : {}) };
}

/** Qualify an `etsy`-relative key (`validation.x`, `draftSync.y`). */
export function etsyKey(key: string | undefined, fallback = 'draftSync.failed'): string {
  const k = key || fallback;
  return k.startsWith('etsy.') ? k : `etsy.${k}`;
}

/** Qualify an `ebay`-relative key. */
export function ebayKey(key: string | undefined, fallback = 'draftSync.failed'): string {
  const k = key || fallback;
  return k.startsWith('ebay.') ? k : `ebay.${k}`;
}

function toIssue(e: FieldError): BatchStageIssue {
  return issue(e.field, etsyKey(e.key, 'validation.generic'), e.params);
}

export type SanitizedEtsyFields = {
  fields: Record<string, unknown>;
  rejected: BatchStageIssue[];
  warnings: BatchStageIssue[];
};

/**
 * Splits an Etsy batch item's `fields` into what may be staged and what is
 * refused. Pure.
 *  - unknown keys → rejected `bulk.stage.fieldNotEditable`
 *  - price must be a finite number > 0 with ≤ 2 decimals or a strict decimal string
 *    (≤ 0 → `etsy.validation.pricePositive`, bad format → `bulk.stage.priceFormat`)
 *  - quantity must be an integer 0..999 (number or digit string) → `bulk.stage.quantityRange`
 *  - id fields must be numeric ids (or null/'' to clear) → `bulk.stage.idInvalid`
 *  - `validateEtsyFieldPatch`: block_save → rejected; block_sync on a
 *    self-contained field → rejected; other block_sync → staged + warning
 *
 * `replaceFields` (a revert, §6.3) carries the draft's WHOLE remaining
 * fieldPatch, which may hold editor-only keys (return_policy_id, item_weight,
 * should_auto_renew, …) and values the editor staged with block_sync issues.
 * In that mode keys outside the grid set pass through (except `state`, which
 * only queued actions may change), and block_sync issues are warnings; only
 * format errors and block_save refuse the item.
 */
export function sanitizeEtsyBatchFields(raw: Record<string, unknown> | undefined, opts: { replaceFields?: boolean } = {}): SanitizedEtsyFields {
  const replace = opts.replaceFields === true;
  const fields: Record<string, unknown> = {};
  const rejected: BatchStageIssue[] = [];
  if (!raw) return { fields, rejected, warnings: [] };

  for (const [k, v] of Object.entries(raw)) {
    if (!ETSY_BATCH_FIELDS.has(k)) {
      if (replace && !NEVER_STAGED.has(k)) { fields[k] = v; continue; }
      rejected.push(issue(k, 'bulk.stage.fieldNotEditable', { field: k }));
      continue;
    }
    if (k === 'price') {
      const ok = (typeof v === 'number' && Number.isFinite(v) && v > 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6)
        || (typeof v === 'string' && STRICT_DECIMAL.test(v.trim()) && Number(v) > 0);
      if (!ok) {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
        rejected.push(Number.isFinite(n) && n <= 0 ? issue('price', 'etsy.validation.pricePositive') : issue('price', 'bulk.stage.priceFormat'));
        continue;
      }
      fields.price = typeof v === 'string' ? Number(v.trim()) : v;
      continue;
    }
    if (k === 'quantity') {
      const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN);
      if (!Number.isInteger(n) || n < 0 || n > 999) { rejected.push(issue('quantity', 'bulk.stage.quantityRange', { min: 0, max: 999 })); continue; }
      fields.quantity = n;
      continue;
    }
    if (k === 'shop_section_id' || k === 'taxonomy_id' || k === 'shipping_profile_id' || k === 'readiness_state_id') {
      if (v === null || v === '') { fields[k] = v; continue; }
      if (!(typeof v === 'number' && Number.isInteger(v) && v > 0) && !(typeof v === 'string' && ID_LIKE.test(v))) {
        rejected.push(issue(k, 'bulk.stage.idInvalid', { field: k }));
        continue;
      }
      fields[k] = typeof v === 'string' ? Number(v) : v;
      continue;
    }
    fields[k] = v;
  }

  const warnings: BatchStageIssue[] = [];
  const drop = new Set<string>();
  for (const raw of validateEtsyFieldPatch(fields)) {
    // The processing pair is reported on processing_min; attribute it to
    // processing_max when that is the only half in the patch.
    const e = raw.field === 'processing_min' && !('processing_min' in fields) && 'processing_max' in fields
      ? { ...raw, field: 'processing_max' }
      : raw;
    if (!(e.field in fields)) {
      // Cross-field issue reported on a field this patch doesn't carry
      // (e.g. provenance): not this patch's value, keep it as a warning.
      warnings.push(toIssue(e));
      continue;
    }
    if (e.severity === 'block_save' || (!replace && SELF_CONTAINED.has(e.field))) {
      if (!drop.has(e.field)) rejected.push(toIssue(e));
      drop.add(e.field);
    } else {
      warnings.push(toIssue(e));
    }
  }
  for (const f of drop) delete fields[f];
  // processing_min/max are validated as a pair; the validator reports on
  // processing_min. Never stage half of a refused pair.
  if (drop.has('processing_min') && 'processing_max' in fields) {
    delete fields.processing_max;
    rejected.push(issue('processing_max', rejected.find((r) => r.field === 'processing_min')?.key || 'etsy.validation.processingInvalid'));
  }
  return { fields, rejected, warnings };
}

/** Normalise a draft status into the batch result's status. */
export function resultStatus(status: unknown): BatchStageOk['status'] {
  return status === 'conflict' ? 'conflict' : status === 'failed' ? 'failed' : 'draft';
}
