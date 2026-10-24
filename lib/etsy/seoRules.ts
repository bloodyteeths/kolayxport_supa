/**
 * Etsy SEO rules — pure, dependency-free helpers shared by the browser and
 * the API routes. These encode the founder's listing rules:
 *
 *  Titles: Title Case, commas are the ONLY separator, 100–140 chars,
 *          no keyword stacking, no repeated words.
 *  Tags:   up to 13, each ≤ 20 chars (dropped, never cut mid-word),
 *          no word overlap with the title, no near-duplicates.
 *
 * Every function accepts `unknown` where AI output may flow in, because
 * Gemini sometimes returns arrays / objects / garbled text instead of strings.
 */

export const TITLE_MIN = 100;
export const TITLE_MAX = 140;
export const TAG_MAX_LEN = 20;
export const TAG_MAX_COUNT = 13;
/** Etsy raised the per-listing photo limit from 10 to 20 in 2025. */
export const ETSY_MAX_IMAGES = 20;

/** Words kept lowercase inside a title (unless they start a phrase). */
export const SMALL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'for', 'of', 'to', 'in', 'on',
  'at', 'by', 'with', 'from', 'as', 'per', 'via', 'vs',
]);

/** Words ignored when checking repetition / overlap / near-duplicates. */
const STOP_WORDS = new Set([
  ...Array.from(SMALL_WORDS),
  'is', 'it', 'be', 'are', 'my', 'your', 'our', 'her', 'his', 'their', 'this', 'that',
  'set', 'pc', 'pcs',
]);

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Coerce AI output into a single string. Arrays of words are joined with
 * spaces (String(array) would join with commas), objects with a `text`/`title`
 * field are unwrapped. Anything else → ''.
 */
export function coerceAiString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string')) {
      return (value as string[]).map((v) => v.trim()).filter(Boolean).join(' ').trim();
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const k of ['text', 'title', 'value', 'description', 'content']) {
      if (typeof o[k] === 'string') return (o[k] as string).trim();
    }
  }
  return '';
}

/** Coerce AI output into a string array (accepts array or comma-separated string). */
export function coerceAiStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : coerceAiString(v)))
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  if (typeof value === 'string') return splitCommaList(value);
  return [];
}

/** Split a comma (or newline / semicolon) separated bulk entry. */
export function splitCommaList(input: string): string[] {
  return String(input || '')
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Detects mostly-garbage output (e.g. a title made of single letters). */
export function looksGarbled(text: string): boolean {
  const words = text.split(/[\s,]+/).filter(Boolean);
  if (words.length === 0) return true;
  const singles = words.filter((w) => w.length <= 1 && !SMALL_WORDS.has(w.toLowerCase()) && !/\d/.test(w));
  if (words.length > 3 && singles.length > words.length * 0.4) return true;
  // Mostly non-letter characters
  const letters = (text.match(/\p{L}/gu) || []).length;
  return text.length > 10 && letters < text.length * 0.5;
}

// ---------------------------------------------------------------------------
// Word helpers
// ---------------------------------------------------------------------------

/** Lightweight stemmer: lowercase + strip simple plural suffixes. */
export function stemWord(word: string): string {
  let w = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  return w;
}

/** Content words (no stop words, ≥ 2 chars) of a phrase. Hyphens split. */
export function contentWords(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,|/\\:;·•—–\-]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

function smartCaseWord(word: string, forceCap: boolean, preserveCaps: boolean): string {
  if (!word) return word;
  // Hyphenated compounds: T-Shirt, Hand-Painted
  if (word.includes('-')) {
    return word.split('-').map((p, i) => smartCaseWord(p, forceCap || i > 0, preserveCaps)).join('-');
  }
  const lead = word.match(/^[^\p{L}\p{N}]*/u)?.[0] || '';
  const trail = word.match(/[^\p{L}\p{N}]*$/u)?.[0] || '';
  const core = word.slice(lead.length, word.length - trail.length);
  if (!core) return word;

  let out: string;
  if (/\d/.test(core)) {
    // 3d → 3D, 4k → 4K; other number tokens (16oz, 8x10, 2pcs) unchanged
    out = /^\d+[a-z]$/i.test(core) && /[dk]$/i.test(core) ? core.toUpperCase() : core;
  } else if (preserveCaps && core.length >= 2 && core.length <= 5 && core === core.toUpperCase() && /\p{L}/u.test(core)) {
    out = core; // acronym: USA, LED, SVG, DIY
  } else if (/^\p{Ll}+\p{Lu}/u.test(core) || /^\p{Lu}\p{Ll}+\p{Lu}/u.test(core)) {
    out = core; // camel/brand case: iPhone, McDonald, AirPods
  } else {
    const lower = core.toLowerCase();
    if (!forceCap && SMALL_WORDS.has(lower)) out = lower;
    else out = lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return lead + out + trail;
}

/**
 * Normalize a title to the house style:
 * - every non-comma separator (| - – — : ; / \ • ·) used between words → comma
 * - disallowed characters stripped (Etsy rejects most symbols; we allow
 *   letters, numbers, spaces, commas, apostrophes, in-word hyphens, & . % + ™ © ®)
 * - collapsed whitespace / duplicate commas
 * - smart Title Case (acronyms, 3D, T-Shirt, numbers preserved)
 * Words are NOT removed — use checkTitle() to detect repetition.
 */
export function normalizeTitle(input: unknown): string {
  let s = coerceAiString(input);
  if (!s) return '';
  s = s.normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”"]/g, '')
    .replace(/\s*[|–—:;/\\•·]\s*/g, ', ')
    .replace(/\s+-+\s+/g, ', ')            // spaced hyphen used as separator
    .replace(/[^\p{L}\p{N}\s,'&.%+\-™©®]/gu, ' ')
    .replace(/(^|\s)-+|-+(?=\s|,|$)/g, '$1') // dangling hyphens
    .replace(/\.(?!\d)/g, ' ')              // periods only allowed inside numbers
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(,\s*){2,}/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();

  // Etsy: %, &, + may appear only once each
  for (const ch of ['%', '&', '+']) {
    let seen = false;
    s = s.split('').filter((c) => {
      if (c !== ch) return true;
      if (seen) return false;
      seen = true;
      return true;
    }).join('');
  }

  const letters = s.replace(/[^\p{L}]/gu, '');
  const mostlyCaps = letters.length > 0 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.6;

  const phrases = s.split(/\s*,\s*/).filter(Boolean);
  const cased = phrases.map((phrase) =>
    phrase.split(' ').filter(Boolean).map((w, i) => smartCaseWord(w, i === 0, !mostlyCaps)).join(' '),
  );
  return cased.join(', ').replace(/\s+/g, ' ').trim();
}

export type TitleIssue =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'bad_first_char'
  | 'disallowed_separator'
  | 'repeated_words'
  | 'keyword_stacking'
  | 'not_title_case'
  | 'all_caps';

export interface TitleCheck {
  ok: boolean;
  length: number;
  issues: TitleIssue[];
  repeatedWords: string[];
}

/** Repeated content words in a title (stemmed, stop words ignored). */
export function repeatedTitleWords(title: string): string[] {
  const counts = new Map<string, { n: number; display: string }>();
  for (const w of contentWords(title)) {
    const k = stemWord(w);
    if (!k) continue;
    const e = counts.get(k);
    if (e) e.n += 1; else counts.set(k, { n: 1, display: w });
  }
  return Array.from(counts.values()).filter((e) => e.n > 1).map((e) => e.display);
}

export function checkTitle(input: unknown): TitleCheck {
  const title = typeof input === 'string' ? input.trim() : coerceAiString(input);
  const issues: TitleIssue[] = [];
  const length = title.length;
  if (!title) return { ok: false, length: 0, issues: ['empty'], repeatedWords: [] };

  if (length < TITLE_MIN) issues.push('too_short');
  if (length > TITLE_MAX) issues.push('too_long');
  if (!/^[\p{L}\p{N}]/u.test(title)) issues.push('bad_first_char');
  if (/[|:;/\\–—•·]|\s-\s/.test(title)) issues.push('disallowed_separator');

  const repeated = repeatedTitleWords(title);
  if (repeated.length > 0) issues.push('repeated_words');

  // Keyword stacking: long run of words with no comma, or many repeats
  const phrases = title.split(',').map((p) => p.trim()).filter(Boolean);
  const longestPhrase = Math.max(0, ...phrases.map((p) => p.split(/\s+/).filter(Boolean).length));
  if (longestPhrase > 8 || (length > 60 && phrases.length === 1) || repeated.length >= 3) {
    issues.push('keyword_stacking');
  }

  const letters = title.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  if (letters.length > 10 && upper / letters.length > 0.6) issues.push('all_caps');
  else if (normalizeTitle(title) !== title.replace(/\s+/g, ' ')) {
    // Only case differences count here; separator issues are reported above
    const a = normalizeTitle(title).toLowerCase();
    const b = title.replace(/\s+/g, ' ').toLowerCase();
    if (a === b) issues.push('not_title_case');
  }

  return { ok: issues.length === 0, length, issues, repeatedWords: repeated };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export type TagDropReason = 'invalid' | 'too_long' | 'duplicate' | 'title_overlap' | 'over_limit';

export interface DroppedTag {
  tag: string;
  reason: TagDropReason;
}

export interface NormalizeTagsOptions {
  /** If given and dropTitleOverlap is true, tags sharing a word with it are dropped. */
  title?: string;
  dropTitleOverlap?: boolean;
  /** Max tag count (default 13). */
  max?: number;
}

/** Clean one tag: lowercase, Etsy-allowed chars only, collapsed spaces. */
export function cleanTag(input: unknown): string {
  const s = typeof input === 'string' ? input : coerceAiString(input);
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}\s'\-™©®]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'-]+|[\s'-]+$/g, '')
    .trim();
}

/** Canonical key for near-duplicate detection ("mom gifts" ≈ "gift for mom"). */
export function tagKey(tag: string): string {
  const words = contentWords(tag).map(stemWord).filter(Boolean);
  return Array.from(new Set(words)).sort().join(' ');
}

/** Words of the tag that also appear in the title (stemmed, stop words ignored). */
export function tagTitleOverlap(tag: string, title: string): string[] {
  if (!title) return [];
  const titleStems = new Set(contentWords(title).map(stemWord));
  return contentWords(tag).filter((w) => titleStems.has(stemWord(w)));
}

/**
 * Normalize a tag list. Over-long tags are DROPPED (never truncated
 * mid-word) and reported in `dropped` so the UI can show feedback.
 */
export function normalizeTags(input: unknown, opts: NormalizeTagsOptions = {}): { tags: string[]; dropped: DroppedTag[] } {
  const max = opts.max ?? TAG_MAX_COUNT;
  const raw = coerceAiStringArray(input);
  const tags: string[] = [];
  const dropped: DroppedTag[] = [];
  const keys = new Set<string>();

  for (const r of raw) {
    const tag = cleanTag(r);
    if (!tag || !/\p{L}|\p{N}/u.test(tag)) { if (r.trim()) dropped.push({ tag: r.trim(), reason: 'invalid' }); continue; }
    if (tag.length > TAG_MAX_LEN) { dropped.push({ tag, reason: 'too_long' }); continue; }
    const key = tagKey(tag) || tag;
    if (keys.has(key)) { dropped.push({ tag, reason: 'duplicate' }); continue; }
    if (opts.dropTitleOverlap && opts.title && tagTitleOverlap(tag, opts.title).length > 0) {
      dropped.push({ tag, reason: 'title_overlap' });
      continue;
    }
    if (tags.length >= max) { dropped.push({ tag, reason: 'over_limit' }); continue; }
    keys.add(key);
    tags.push(tag);
  }
  return { tags, dropped };
}

export type TagIssue = 'too_many' | 'too_few' | 'too_long' | 'duplicates' | 'title_overlap' | 'single_word' | 'invalid_chars';

export interface TagsCheck {
  ok: boolean;
  issues: TagIssue[];
  tooLong: string[];
  overlapping: Array<{ tag: string; words: string[] }>;
  duplicates: Array<[string, string]>;
  singleWord: string[];
}

export function checkTags(input: unknown, title = ''): TagsCheck {
  const tags = coerceAiStringArray(input).map((t) => t.trim()).filter(Boolean);
  const issues: TagIssue[] = [];
  const tooLong = tags.filter((t) => t.length > TAG_MAX_LEN);
  const overlapping = tags
    .map((tag) => ({ tag, words: tagTitleOverlap(tag, title) }))
    .filter((o) => o.words.length > 0);
  const duplicates: Array<[string, string]> = [];
  const seen = new Map<string, string>();
  for (const t of tags) {
    const k = tagKey(t) || t.toLowerCase();
    const prev = seen.get(k);
    if (prev !== undefined) duplicates.push([prev, t]);
    else seen.set(k, t);
  }
  const singleWord = tags.filter((t) => t.split(/\s+/).filter(Boolean).length === 1);

  if (tags.length > TAG_MAX_COUNT) issues.push('too_many');
  if (tags.length < TAG_MAX_COUNT) issues.push('too_few');
  if (tooLong.length) issues.push('too_long');
  if (duplicates.length) issues.push('duplicates');
  if (overlapping.length) issues.push('title_overlap');
  if (singleWord.length) issues.push('single_word');
  if (tags.some((t) => cleanTag(t) !== t.toLowerCase().replace(/\s+/g, ' ').trim())) issues.push('invalid_chars');

  return { ok: issues.length === 0, issues, tooLong, overlapping, duplicates, singleWord };
}

/**
 * Parse a comma bulk-entry for tags and merge into an existing list.
 * Returns the merged list and the entries that were rejected with reasons.
 * Title overlap is NOT dropped here (manual entry) — callers flag it.
 */
export function mergeTagInput(existing: string[], input: string, max = TAG_MAX_COUNT): { tags: string[]; dropped: DroppedTag[] } {
  const { tags, dropped } = normalizeTags([...(existing || []), ...splitCommaList(input)], { max });
  // Don't report existing tags as dropped duplicates of themselves
  return { tags, dropped: dropped.filter((d) => !(existing || []).map((e) => e.toLowerCase()).includes(d.tag)) };
}

// ---------------------------------------------------------------------------
// SEO score (0–100) — shared by SEOIndicator and graders
// ---------------------------------------------------------------------------

export interface SeoScoreInput {
  title: string;
  tags: string[];
  description?: string;
  imageCount?: number;
  hasCategory?: boolean;
  hasMaterials?: boolean;
}

export function computeSeoScore(input: SeoScoreInput): number {
  const title = input.title || '';
  const tags = Array.isArray(input.tags) ? input.tags : [];
  const tc = checkTitle(title);
  const tg = checkTags(tags, title);
  const descLen = (input.description || '').length;

  // Title (35)
  let titleScore = title.length >= TITLE_MIN && title.length <= TITLE_MAX ? 20 : title.length >= 80 && title.length <= TITLE_MAX ? 14 : title.length >= 40 ? 8 : title.length > 0 ? 3 : 0;
  if (title.length >= 40) {
    if (!tc.issues.includes('repeated_words')) titleScore += 5;
    if (!tc.issues.includes('keyword_stacking')) titleScore += 5;
    if (!tc.issues.includes('disallowed_separator') && !tc.issues.includes('all_caps') && !tc.issues.includes('not_title_case')) titleScore += 5;
  }

  // Tags (35)
  const validCount = tags.length - tg.tooLong.length;
  let tagScore = Math.min(Math.max(validCount, 0) / TAG_MAX_COUNT, 1) * 20;
  tagScore += tags.length ? (1 - tg.overlapping.length / tags.length) * 10 : 0; // overlap is penalized
  if (tg.duplicates.length === 0 && tags.length > 0) tagScore += 5;

  // Description (15)
  const descScore = descLen >= 300 ? 15 : descLen >= 100 ? 10 : descLen > 0 ? 5 : 0;

  // Completeness (15)
  let attr = 0;
  if (input.hasCategory) attr += 5;
  if (input.hasMaterials) attr += 5;
  if (input.imageCount === undefined || input.imageCount >= 5) attr += 5;
  else if (input.imageCount > 0) attr += 2;

  return Math.round(Math.min(titleScore + tagScore + descScore + attr, 100));
}

// ---------------------------------------------------------------------------
// AI error codes — the API returns { error, code }; clients translate `code`
// via the `etsy.aiErrors.<code>` i18n namespace and never toast raw errors.
// ---------------------------------------------------------------------------

export const AI_ERROR_CODES = [
  'reference_too_large',
  'missing_title',
  'missing_query',
  'no_listings',
  'too_many_listings',
  'invalid_ai_response',
  'ai_title_failed',
  'ai_description_failed',
  'ai_tags_failed',
  'ai_image_failed',
  'ai_image_blocked',
  'invalid_reference_image',
  'missing_prompt',
  'rate_limited',
  'unauthorized',
  'ai_not_configured',
  'ai_failed',
  'invalid_action',
  'method_not_allowed',
] as const;
export type AiErrorCode = typeof AI_ERROR_CODES[number];

/** Extract a known AI error code from an API JSON body (or null). */
export function aiErrorCode(body: unknown): AiErrorCode | null {
  const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  return typeof code === 'string' && (AI_ERROR_CODES as readonly string[]).includes(code) ? (code as AiErrorCode) : null;
}

/** Error carrying an AI error code, so catch blocks can translate it. */
export class AiRequestError extends Error {
  code: AiErrorCode | null;
  constructor(code: AiErrorCode | null) {
    super(code || 'ai_failed');
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Etsy `when_made` enum — verified against Etsy Open API v3 OAS
// (https://www.etsy.com/openapi/generated/oas/3.0.0.json, fetched 2026-10-14).
// Etsy rolls the first ranges forward each year; keep in sync with the spec.
// ---------------------------------------------------------------------------

// Single source of truth lives in lib/etsy/validation.ts (dependency-free).
export { ETSY_WHEN_MADE_VALUES as ETSY_WHEN_MADE_OPTIONS, normalizeWhenMade } from './validation';

/** i18n key under `etsy.whenMade.*` for a when_made value. */
export function whenMadeLabelKey(value: string): string {
  return value === 'made_to_order' ? 'madeToOrder' : value;
}

/**
 * i18n key + params (relative to the `etsy` namespace) carried by a draft
 * client error (EtsyDraftClientError), or null. Duck-typed to keep this module
 * dependency-free.
 */
export function draftErrorI18n(err: unknown): { key: string; params?: Record<string, string | number> } | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { key?: unknown; params?: unknown };
  if (typeof e.key !== 'string' || !e.key) return null;
  const params = e.params && typeof e.params === 'object' ? (e.params as Record<string, string | number>) : undefined;
  return { key: e.key, params };
}
