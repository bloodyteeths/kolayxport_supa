// lib/messages/savedReplies.ts — messages §6.4 (group G3): the SavedReply contract shared by
// `pages/api/messages/saved-replies.ts`, `lib/hooks/useSavedReplies.ts` and the saved-reply components.
// Pure and client-safe (no Prisma import), so the browser bundle can use the same validation as the server.

export type SavedReplyPlatform = 'wix' | 'trendyol';
export const SAVED_REPLY_PLATFORMS: readonly SavedReplyPlatform[] = ['wix', 'trendyol'];

/** Wire shape of one saved reply (GET list, POST/PATCH result). Dates are ISO strings. */
export interface SavedReply {
  id: string;
  title: string;
  body: string;
  /** null = all stores. */
  platform: SavedReplyPlatform | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export const SAVED_REPLY_TITLE_MAX = 60;
export const SAVED_REPLY_BODY_MAX = 1000;
/** Per-user limit (§6.4; the legacy browser list allowed 20). */
export const SAVED_REPLY_LIMIT = 50;
/** Import: titles are the first 40 characters of the legacy text. */
export const SAVED_REPLY_IMPORT_TITLE_LEN = 40;

/** Legacy per-browser list written by the old Messages page (string[]). */
export const legacySavedRepliesKey = (userId: string) => `kx.messages.savedReplies.${userId}`;

/** Error codes in every non-2xx JSON body: `{ code, field?, max? }`. */
export type SavedReplyErrorCode =
  | 'invalid' // field validation (see `field` + `reason`)
  | 'duplicate' // a saved reply with this title already exists
  | 'limit' // SAVED_REPLY_LIMIT reached (`max`)
  | 'notFound'
  | 'notEmpty' // import only runs when the user has 0 saved replies
  | 'notReady' // BR-4 migration not deployed yet: the table / Prisma delegate is missing
  | 'unauthorized'
  | 'unavailable';

export type SavedReplyField = 'title' | 'body' | 'platform' | 'items' | 'id';
export type SavedReplyInvalidReason = 'required' | 'tooLong' | 'invalidPlatform' | 'invalid';

export interface SavedReplyErrorBody {
  code: SavedReplyErrorCode;
  field?: SavedReplyField;
  reason?: SavedReplyInvalidReason;
  max?: number;
}

export interface SavedReplyInput {
  title: string;
  body: string;
  platform: SavedReplyPlatform | null;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: SavedReplyErrorBody };

export function isSavedReplyPlatform(v: unknown): v is SavedReplyPlatform {
  return v === 'wix' || v === 'trendyol';
}

function checkTitle(raw: unknown): ValidationResult<string> {
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (!title) return { ok: false, error: { code: 'invalid', field: 'title', reason: 'required' } };
  if (title.length > SAVED_REPLY_TITLE_MAX) {
    return { ok: false, error: { code: 'invalid', field: 'title', reason: 'tooLong', max: SAVED_REPLY_TITLE_MAX } };
  }
  return { ok: true, value: title };
}

function checkBody(raw: unknown): ValidationResult<string> {
  // Inner whitespace and line breaks are the seller's formatting; only the ends are trimmed.
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) return { ok: false, error: { code: 'invalid', field: 'body', reason: 'required' } };
  if (body.length > SAVED_REPLY_BODY_MAX) {
    return { ok: false, error: { code: 'invalid', field: 'body', reason: 'tooLong', max: SAVED_REPLY_BODY_MAX } };
  }
  return { ok: true, value: body };
}

function checkPlatform(raw: unknown): ValidationResult<SavedReplyPlatform | null> {
  if (raw === undefined || raw === null || raw === '' || raw === 'all') return { ok: true, value: null };
  if (isSavedReplyPlatform(raw)) return { ok: true, value: raw };
  return { ok: false, error: { code: 'invalid', field: 'platform', reason: 'invalidPlatform' } };
}

/** POST body → normalized input. */
export function validateSavedReplyInput(raw: unknown): ValidationResult<SavedReplyInput> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const title = checkTitle(o.title);
  if (!title.ok) return title;
  const body = checkBody(o.body);
  if (!body.ok) return body;
  const platform = checkPlatform(o.platform);
  if (!platform.ok) return platform;
  return { ok: true, value: { title: title.value, body: body.value, platform: platform.value } };
}

/** PATCH body → only the fields present; at least one is required. */
export function validateSavedReplyPatch(raw: unknown): ValidationResult<Partial<SavedReplyInput>> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Partial<SavedReplyInput> = {};
  if ('title' in o) {
    const r = checkTitle(o.title);
    if (!r.ok) return r;
    out.title = r.value;
  }
  if ('body' in o) {
    const r = checkBody(o.body);
    if (!r.ok) return r;
    out.body = r.value;
  }
  if ('platform' in o) {
    const r = checkPlatform(o.platform);
    if (!r.ok) return r;
    out.platform = r.value;
  }
  if (!Object.keys(out).length) return { ok: false, error: { code: 'invalid', reason: 'required' } };
  return { ok: true, value: out };
}

/** Case- and locale-insensitive title key used for the duplicate check (the DB constraint is exact). */
export function titleKey(title: string): string {
  return title.trim().toLocaleLowerCase('tr');
}

/** Parses the legacy localStorage value (JSON string[]); anything else → []. */
export function parseLegacySavedReplies(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Legacy texts → rows to create. Title = first 40 characters (single line, trimmed), de-duplicated with
 * " (2)", " (3)"…; identical texts are imported once; bodies are cut at SAVED_REPLY_BODY_MAX; at most
 * `limit` rows.
 */
export function buildImportRows(items: unknown, limit = SAVED_REPLY_LIMIT): SavedReplyInput[] {
  if (!Array.isArray(items)) return [];
  const seenBodies = new Set<string>();
  const seenTitles = new Set<string>();
  const rows: SavedReplyInput[] = [];
  for (const item of items) {
    if (rows.length >= limit) break;
    if (typeof item !== 'string') continue;
    const body = item.trim().slice(0, SAVED_REPLY_BODY_MAX).trim();
    if (!body || seenBodies.has(body)) continue;
    seenBodies.add(body);
    const base = body.replace(/\s+/g, ' ').slice(0, SAVED_REPLY_IMPORT_TITLE_LEN).trim();
    let title = base;
    for (let n = 2; seenTitles.has(titleKey(title)); n++) title = `${base} (${n})`;
    seenTitles.add(titleKey(title));
    rows.push({ title, body, platform: null });
  }
  return rows;
}

/** GET order: most used first, then title (locale-aware). */
export function sortSavedReplies<T extends Pick<SavedReply, 'usageCount' | 'title'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.usageCount - a.usageCount || a.title.localeCompare(b.title, 'tr'));
}

/** Replies offered for a thread on `platform`: the "all stores" ones plus that store's own. */
export function repliesForPlatform<T extends Pick<SavedReply, 'platform'>>(rows: readonly T[], platform: SavedReplyPlatform | null): T[] {
  if (!platform) return [...rows];
  return rows.filter((r) => r.platform === null || r.platform === platform);
}
