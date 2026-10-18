/**
 * eBay Inventory API payload rules, enforced server-side.
 *
 * eBay accepts a malformed inventory item at creation and only rejects it at
 * publish, often with a generic "The request has errors (eBay 2004)" that names
 * nothing. Each rule below cost a separate bug report before it was found, so
 * they live here rather than in whichever dialog happened to be edited last.
 *
 * Applied at both places that PUT an inventory item — the /api/clawd/ebay route
 * and lib/ebay/draftService — so every UI path is covered, including ones added
 * later.
 */

/** eBay rejects an item-specific value longer than this, at publish time. */
export const ASPECT_VALUE_MAX = 65;
/** eBay rejects an item-specific name longer than this. */
export const ASPECT_NAME_MAX = 40;
/** eBay truncates/rejects listing titles beyond this. */
export const TITLE_MAX = 80;

/**
 * Inventory API ConditionEnum. The used grades carry a USED_ prefix; the bare
 * VERY_GOOD / GOOD / ACCEPTABLE are not valid values and make eBay answer
 * "Could not serialize field [condition]".
 */
const LEGACY_CONDITION_MAP: Record<string, string> = {
  VERY_GOOD: 'USED_VERY_GOOD',
  GOOD: 'USED_GOOD',
  ACCEPTABLE: 'USED_ACCEPTABLE',
  USED: 'USED_EXCELLENT',
};

export function normalizeCondition(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const upper = value.trim().toUpperCase();
  return LEGACY_CONDITION_MAP[upper] || upper;
}

/**
 * Drop empty item specifics and clamp over-long ones. Empty values are their own
 * rejection (eBay 25719); over-long ones fail only on publish (eBay 25002).
 */
export function sanitizeAspects(
  aspects: unknown
): Record<string, string[]> | undefined {
  if (!aspects || typeof aspects !== 'object') return undefined;

  const clean: Record<string, string[]> = {};
  for (const [rawName, rawValues] of Object.entries(aspects as Record<string, unknown>)) {
    const name = String(rawName ?? '').trim().slice(0, ASPECT_NAME_MAX);
    if (!name) continue;

    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    const kept = values
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .map((v) => (v.length > ASPECT_VALUE_MAX ? v.slice(0, ASPECT_VALUE_MAX).trim() : v))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    if (kept.length > 0) clean[name] = kept;
  }
  return clean;
}

/** Names whose value exceeds eBay's limit — for warning a seller before publish. */
export function overlongAspectNames(aspects: unknown): string[] {
  if (!aspects || typeof aspects !== 'object') return [];
  return Object.entries(aspects as Record<string, unknown>)
    .filter(([, values]) =>
      (Array.isArray(values) ? values : [values]).some(
        (v) => String(v ?? '').trim().length > ASPECT_VALUE_MAX
      )
    )
    .map(([name]) => name);
}

/**
 * Normalise a full inventory-item payload in place of ad-hoc per-caller cleanup.
 * Only touches fields that are present, so it is safe for partial PATCH-style
 * updates where omitting a key means "leave it alone".
 */
export function sanitizeInventoryItemPayload<T extends Record<string, any>>(body: T): T {
  if (!body || typeof body !== 'object') return body;

  const next: Record<string, any> = { ...body };

  if (next.product && typeof next.product === 'object') {
    const product: Record<string, any> = { ...next.product };

    if (typeof product.title === 'string') {
      product.title = product.title.trim().slice(0, TITLE_MAX);
    }
    if ('aspects' in product) {
      const cleaned = sanitizeAspects(product.aspects);
      // An aspects map that cleans down to nothing must be dropped, not sent as
      // {} — eBay treats an empty object as a malformed field.
      if (cleaned && Object.keys(cleaned).length > 0) product.aspects = cleaned;
      else delete product.aspects;
    }
    if (Array.isArray(product.imageUrls)) {
      product.imageUrls = product.imageUrls
        .map((u: unknown) => String(u ?? '').trim())
        .filter(Boolean);
    }

    next.product = product;
  }

  if ('condition' in next) {
    const normalized = normalizeCondition(next.condition);
    if (normalized) next.condition = normalized;
    else delete next.condition;
  }

  return next as T;
}

// ---------------------------------------------------------------------------
// Condition: defaulting and per-category validation
// ---------------------------------------------------------------------------

/**
 * Conditions every category accepts at publish. eBay's condition-policy
 * endpoint returns nothing for most categories, yet publish still enforces one:
 * NEW and USED_EXCELLENT publish everywhere, while LIKE_NEW and the graded
 * USED_VERY_GOOD / USED_GOOD / USED_ACCEPTABLE are media-only grades.
 * (ConditionSelector offers these when the category lists none.)
 */
export const UNIVERSAL_CONDITIONS = ['NEW', 'NEW_OTHER', 'USED_EXCELLENT', 'FOR_PARTS_OR_NOT_WORKING'] as const;

/** New-equivalent conditions, best first. */
const NEW_FAMILY = ['NEW', 'NEW_OTHER', 'NEW_WITH_DEFECTS'];
/** Used grades, best first. */
const USED_FAMILY = ['LIKE_NEW', 'USED_EXCELLENT', 'USED_VERY_GOOD', 'USED_GOOD', 'USED_ACCEPTABLE'];

export function isNewCondition(value: unknown): boolean {
  const c = normalizeCondition(value);
  return !!c && NEW_FAMILY.includes(c);
}

/**
 * The condition as the category allows it. `allowed` is the category's list
 * (`item_conditions`; empty or missing = eBay names none, so the universal set).
 * A new condition the category lacks becomes its new-equivalent (NEW, else
 * NEW_OTHER); a used grade becomes the nearest allowed used grade.
 */
export function conditionForCategory(condition: unknown, allowed?: readonly string[] | null): string {
  const list = (allowed && allowed.length ? allowed : UNIVERSAL_CONDITIONS)
    .map((c) => normalizeCondition(c))
    .filter((c): c is string => !!c);
  const c = normalizeCondition(condition) || 'NEW';
  if (list.includes(c)) return c;
  const family = USED_FAMILY.includes(c) ? USED_FAMILY : NEW_FAMILY.includes(c) ? NEW_FAMILY : null;
  if (family) {
    const i = Math.max(0, family.indexOf(c));
    // Same grade or worse first (never claim a better condition than the item has), then better.
    const order = [...family.slice(i), ...family.slice(0, i).reverse()];
    const hit = order.find((x) => list.includes(x));
    if (hit) return hit;
  }
  return list.includes('NEW') ? 'NEW' : list[0] || 'NEW';
}

/** The seller's own words say the item is used ("never used" / "unused" do not count). */
export function sellerSaysUsed(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  const s = text.toLowerCase().replace(/\b(never|not|un)[\s-]*used\b/g, ' ');
  return /\b(used|pre-?owned|second[\s-]?hand|secondhand)\b/.test(s) || /ikinci\s*el|kullan[ıi]lm[ıi][şs]/.test(s);
}

/**
 * The condition an AI photo read proposes. A product is NEW unless the photos
 * clearly show use or wear (`wearVisible`) or the seller says it is used; only
 * then is the model's used grade kept. The result is valid for the category.
 */
export function resolveAiCondition(input: {
  suggested?: unknown;
  wearVisible?: unknown;
  sellerText?: unknown;
  allowed?: readonly string[] | null;
}): string {
  const used = input.wearVisible === true || sellerSaysUsed(input.sellerText);
  let condition = 'NEW';
  if (used) {
    const s = normalizeCondition(input.suggested);
    condition = s && !NEW_FAMILY.includes(s) ? s : 'USED_EXCELLENT';
  }
  return conditionForCategory(condition, input.allowed);
}

// ---------------------------------------------------------------------------
// Description: the editor holds plain text (or HTML a seller typed); eBay gets HTML
// ---------------------------------------------------------------------------

const HTML_TAG_RE = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/i;

/** True when the text contains an HTML tag (a seller-typed or eBay-loaded HTML description). */
export function looksLikeHtml(text: unknown): boolean {
  return typeof text === 'string' && HTML_TAG_RE.test(text);
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BULLET_RE = /^(?:[•*\-–]|\d+[.)])\s+/;

/**
 * Description field → the HTML eBay gets. HTML (typed by the seller, or an
 * existing listing's description) is sent as it is; plain text becomes
 * paragraphs (blank line = new paragraph, line break = <br>) and bullet lines
 * ("• ", "- ", "1. ") become a list. Idempotent.
 */
export function descriptionToEbayHtml(text: unknown): string {
  if (typeof text !== 'string') return '';
  const s = text.replace(/\r\n?/g, '\n').trim();
  if (!s || looksLikeHtml(s)) return s;
  return s
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
    .flatMap((lines) => {
      // Runs of bullet lines become a list; the other runs stay a paragraph ("Features:" then bullets).
      const runs: Array<{ list: boolean; lines: string[] }> = [];
      for (const l of lines) {
        const list = BULLET_RE.test(l);
        const last = runs[runs.length - 1];
        if (last && last.list === list) last.lines.push(l);
        else runs.push({ list, lines: [l] });
      }
      return runs.map((r) => (r.list
        ? `<ul>${r.lines.map((l) => `<li>${escapeHtmlText(l.replace(BULLET_RE, ''))}</li>`).join('')}</ul>`
        : `<p>${r.lines.map(escapeHtmlText).join('<br>')}</p>`));
    })
    .join('\n');
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bull: '•' };

function decodeBasicEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * HTML (an AI description) → the plain text the description field shows:
 * paragraphs and headings separated by a blank line, list items as "• " lines,
 * styles / scripts dropped. Plain text comes back trimmed.
 */
export function ebayHtmlToText(html: unknown): string {
  if (typeof html !== 'string') return '';
  if (!looksLikeHtml(html)) return html.replace(/\r\n?/g, '\n').trim();
  const s = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(p|div|h[1-6]|ul|ol|section|article|table|tr|blockquote)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return decodeBasicEntities(s)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    // Markup whitespace between <li>s must not split one list into several.
    .replace(/^(• .*)\n\n(?=• )/gm, '$1\n')
    .trim();
}
