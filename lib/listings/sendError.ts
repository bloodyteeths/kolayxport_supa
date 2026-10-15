// lib/listings/sendError.ts — draft send-failure → i18n key, shared by the listings grid (server, lib/listings/query.ts)
// and the listing editor's failed banner (client). ISOMORPHIC: no server or Prisma imports.
//
// Source of truth (docs/integration/draft-sync-error-codes.md):
// - EtsyListingDraft / EbayListingDraft `lastSyncError` now stores a full next-intl key (`etsy.draftSync.<code>`,
//   `ebay.draftSync.<code>`, `etsy.validation.*`). The draft APIs expose it as `lastSyncErrorKey` and put English text
//   back into `lastSyncError` for the legacy pages, so new UI must read `lastSyncErrorKey`, never the text.
// - CatalogDraft already stored `listings.*` keys in `lastSyncError`.
// - ICU params live on the failed / conflict attempt that recorded the key: `syncAttempts[].result.{errorKey,errorParams}`.
// - Rows written before the change still hold English text: those are bucketed into `listings.sendError.*`.

export type SendError = { errorKey: string; errorParams?: Record<string, string | number> };

/** Generic fallback (also used when a key needs ICU params the attempt did not record). */
export const SEND_ERROR_GENERIC = 'listings.sendError.generic';

/** Same shape `lib/drafts/syncErrors.ts` `isStoredErrorKey` accepts. */
const I18N_KEY_RE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;

export function isI18nKey(v: unknown): v is string {
  return typeof v === 'string' && I18N_KEY_RE.test(v.trim());
}

function isFailedStatus(status: unknown): boolean {
  return status === 'failed' || status === 'conflict';
}

/** Old rows: English `lastSyncError` → coarse `listings.sendError.*` family. Never returns the text. */
export function legacySendErrorKey(status: string, text: unknown): string {
  if (status === 'conflict') return 'listings.sendError.conflict';
  const msg = typeof text === 'string' ? text.toLowerCase() : '';
  if (!msg) return SEND_ERROR_GENERIC;
  if (/server restart|interrupted/.test(msg)) return 'listings.sendError.interrupted';
  if (/token|unauthori[sz]ed|reconnect|invalid_grant|\b401\b|\b403\b|forbidden/.test(msg)) return 'listings.sendError.reconnect';
  if (/rate limit|too many requests|\b429\b/.test(msg)) return 'listings.sendError.rateLimited';
  if (/not found|\b404\b|no longer exists|deleted/.test(msg)) return 'listings.sendError.notFound';
  if (/price|quantity|title|tag|invalid|validation|must|required|\b400\b/.test(msg)) return 'listings.sendError.rejected';
  return SEND_ERROR_GENERIC;
}

function cleanParams(v: unknown): Record<string, string | number> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))) out[k] = x;
  }
  return Object.keys(out).length ? out : undefined;
}

type AttemptLike = { status?: unknown; result?: unknown; startedAt?: unknown };

/**
 * ICU params (`result.errorParams`) of the newest failed / conflict attempt that recorded `key` as its
 * `result.errorKey`. Attempts arrive newest first (`orderBy: { startedAt: 'desc' }`). A failed attempt with a
 * different or missing `errorKey` (e.g. eBay's concurrent "Draft is already syncing" attempt, a stale-recovery attempt)
 * is not the draft's failure and is skipped, so its params can never be shown under another key. `keys` lists the
 * spellings of the stored key that count as a match (raw and namespace-prefixed). No match → undefined.
 */
export function attemptErrorParams(attempts: unknown, keys: string | readonly string[]): Record<string, string | number> | undefined {
  if (!Array.isArray(attempts)) return undefined;
  const want = new Set((typeof keys === 'string' ? [keys] : keys).map((k) => k.trim()).filter(Boolean));
  if (!want.size) return undefined;
  const hit = (attempts as AttemptLike[]).find((a) => {
    if (!a || (a.status !== 'failed' && a.status !== 'conflict')) return false;
    const r = a.result;
    if (!r || typeof r !== 'object') return false;
    const k = (r as { errorKey?: unknown }).errorKey;
    return typeof k === 'string' && want.has(k.trim());
  });
  return hit ? cleanParams((hit.result as { errorParams?: unknown }).errorParams) : undefined;
}

export type DraftErrorSource = {
  status?: unknown;
  /** API field (Etsy / eBay draft routes): the stored key, or null for legacy text. Preferred. */
  lastSyncErrorKey?: unknown;
  /** DB column (a key on new rows) or API text (English for legacy pages). */
  lastSyncError?: unknown;
  /** Newest first; params come from `result.errorParams` of the attempt whose `result.errorKey` is the stored key. */
  syncAttempts?: unknown;
};

/**
 * A failed / conflict draft → `{ errorKey, errorParams? }`; null for any other status (a `synced` draft may carry an
 * English partial-sync warning, which is not a failure). Order: `lastSyncErrorKey` → `lastSyncError` when it is a key
 * (DB rows, CatalogDraft, the pre-existing `etsy.draftSync.remoteChanged` / `deletedOnEtsy`) → legacy text bucket.
 * `prefix` (e.g. `etsy.`) is added to a stored key that lacks a top-level namespace (`draftSync.x`, very old rows).
 */
export function draftSendError(d: DraftErrorSource, opts: { prefix?: string; extraParams?: Record<string, string | number> } = {}): SendError | null {
  const status = typeof d.status === 'string' ? d.status : '';
  if (!isFailedStatus(status)) return null;
  const stored = isI18nKey(d.lastSyncErrorKey) ? d.lastSyncErrorKey.trim() : isI18nKey(d.lastSyncError) ? d.lastSyncError.trim() : null;
  if (stored) {
    const key = withPrefix(stored, opts.prefix);
    const params = { ...(attemptErrorParams(d.syncAttempts, [stored, key]) ?? {}), ...(opts.extraParams ?? {}) };
    return Object.keys(params).length ? { errorKey: key, errorParams: params } : { errorKey: key };
  }
  return { errorKey: legacySendErrorKey(status, d.lastSyncError) };
}

const ROOT_NAMESPACES = ['etsy.', 'ebay.', 'listings.', 'trendyol.', 'wix.', 'shopify.', 'catalog.'];

function withPrefix(key: string, prefix?: string): string {
  if (!prefix || ROOT_NAMESPACES.some((ns) => key.startsWith(ns))) return key;
  return `${prefix}${key}`;
}

/** ICU argument names a message template needs (`{min}`, `{count, plural, …}`). Pure, tested. */
export function icuArgNames(template: string): string[] {
  const out = new Set<string>();
  // Top-level `{name` / `{name,` only; quoted ICU text ('{') is rare in these strings and treated literally.
  let depth = 0;
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if (ch === '{') {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(template.slice(i));
        if (m) out.add(m[1]);
      }
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return Array.from(out);
}

/** The subset of next-intl's `t` the renderer needs (root namespace). */
export type SendErrorTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has?: (key: string) => boolean;
  raw?: (key: string) => unknown;
};

/**
 * Renders a send error safely: a key the catalog lacks, or one whose ICU args the attempt did not record, falls back
 * to `fallbackKey` (default `listings.sendError.generic`) instead of throwing or showing a raw key.
 */
export function renderSendError(t: SendErrorTranslator, err: SendError | null | undefined, fallbackKey: string = SEND_ERROR_GENERIC): string {
  const key = err?.errorKey;
  if (!key || (t.has && !t.has(key))) return t(fallbackKey);
  const params = err?.errorParams ?? {};
  if (t.raw) {
    let tpl: unknown;
    try {
      tpl = t.raw(key);
    } catch {
      tpl = null;
    }
    if (typeof tpl === 'string' && icuArgNames(tpl).some((n) => !(n in params))) return t(fallbackKey);
  }
  try {
    return t(key, params);
  } catch {
    return t(fallbackKey);
  }
}
