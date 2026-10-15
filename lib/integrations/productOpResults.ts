/**
 * Shared result shape for per-operation marketplace writes (Wix media and
 * collections, Shopify images). Server-safe and dependency free, so both the
 * API action blocks and the catalog-draft executors can use it.
 *
 * `key` is always a full next-intl key (root namespace), never raw English,
 * matching docs/integration/draft-sync-error-codes.md.
 */

export type ProductOpCode =
  | 'INVALID_INPUT'
  | 'INVALID_URL'
  | 'NOT_FOUND'
  | 'TOO_MANY'
  | 'MEDIA_SET_MISMATCH'
  /** Wix: reorder refused because option choices have linked media (nothing written). */
  | 'MEDIA_CHOICE_LINKED'
  /** Wix: reorder failed AND the original media could not be re-attached (product may have no media). */
  | 'MEDIA_RESTORE_FAILED'
  | 'COLLECTION_PROTECTED'
  | 'NOT_CONNECTED'
  | 'RATE_LIMITED'
  | 'REMOTE_MISSING'
  | 'FAILED';

export type ProductOpResult = {
  /** Position of the op in the request (`ops[index]`), or of the id in a list request. */
  index: number;
  op: string;
  /** Media / image / collection id the op targets (new image id for a Shopify add). */
  id?: string;
  ok: boolean;
  /** True when nothing was written because the op was redundant (already gone, superseded). */
  skipped?: boolean;
  code?: ProductOpCode;
  key?: string;
  params?: Record<string, string | number>;
};

export const OP_KEYS: Record<ProductOpCode, string> = {
  INVALID_INPUT: 'listings.draftError.invalidInput',
  INVALID_URL: 'listingEditor.media.invalidUrl',
  NOT_FOUND: 'listingEditor.media.imageMissing',
  TOO_MANY: 'listingEditor.media.tooMany',
  MEDIA_SET_MISMATCH: 'listingEditor.media.orderStale',
  MEDIA_CHOICE_LINKED: 'listingEditor.media.choiceLinked',
  MEDIA_RESTORE_FAILED: 'listingEditor.media.restoreFailed',
  COLLECTION_PROTECTED: 'listingEditor.wix.collectionProtected',
  NOT_CONNECTED: 'listings.draftError.notConnected',
  RATE_LIMITED: 'listings.draftError.rateLimited',
  REMOTE_MISSING: 'listings.draftError.remoteMissing',
  FAILED: 'listings.draftError.remoteFailed',
};

/** HTTP status from a client error (`Wix API 404: …`, `Shopify API … failed: 404 - …`, or `err.status`). */
export function statusOfError(err: any): number | null {
  if (!err) return null;
  if (typeof err.status === 'number') return err.status;
  const m = String(err.message || '').match(/(?:failed: |API )(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

/** Map a thrown client error to a stable op code. */
export function opCodeOfError(err: any): ProductOpCode {
  if (err && typeof err.code === 'string' && err.code in OP_KEYS) return err.code as ProductOpCode;
  const status = statusOfError(err);
  if (status === 401 || status === 403) return 'NOT_CONNECTED';
  if (status === 404) return 'REMOTE_MISSING';
  if (status === 429) return 'RATE_LIMITED';
  return 'FAILED';
}

export function okResult(index: number, op: string, id?: string, extra: Partial<ProductOpResult> = {}): ProductOpResult {
  return { index, op, ...(id !== undefined ? { id } : {}), ok: true, ...extra };
}

export function failResult(
  index: number,
  op: string,
  code: ProductOpCode,
  id?: string,
  params?: Record<string, string | number>,
): ProductOpResult {
  return { index, op, ...(id !== undefined ? { id } : {}), ok: false, code, key: OP_KEYS[code], ...(params ? { params } : {}) };
}

export function skippedResult(index: number, op: string, code: ProductOpCode, id?: string): ProductOpResult {
  return { index, op, ...(id !== undefined ? { id } : {}), ok: true, skipped: true, code, key: OP_KEYS[code] };
}

/** Public https URL (what Wix and Shopify can fetch). */
export function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '[::1]') return false;
  return true;
}

export function sortByIndex(results: ProductOpResult[]): ProductOpResult[] {
  return [...results].sort((a, b) => a.index - b.index);
}
