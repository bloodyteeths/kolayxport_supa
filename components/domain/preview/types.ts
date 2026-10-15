// components/domain/preview/types.ts: the PreviewModel MarketplacePreview renders (listing-editor §4.5) and the
// pure helpers its four surfaces share. No React. Text is entity-decoded here (idempotent, DS P5) so a stale
// encoded cache value ("one&#39;s") never shows in the preview, and nothing in here writes back to a draft.
import { decodeEntities } from '@/lib/text/decodeEntities';

export type PreviewMarketplace = 'etsy' | 'ebay';
export type PreviewSurface = 'search' | 'listing';
export type PreviewDevice = 'desktop' | 'mobile';

export interface PreviewImage {
  /** Etsy CDN / eBay URL, or the staged-file URL from `/api/etsy-drafts/media-preview`. null = not available yet. */
  url: string | null;
  alt?: string | null;
}

/**
 * What the editor's draft view (remote values merged with the staged patch) maps to. Every field is optional
 * except `title` and `images`: a missing field is simply not rendered (honest preview, no invented data).
 */
export interface PreviewModel {
  title: string;
  /** eBay only (≤ 55). */
  subtitle?: string | null;
  /** Etsy: plain text (line breaks kept). eBay: seller HTML (rendered sanitized in a sandboxed iframe). */
  description?: string | null;
  price?: number | null;
  /** Variation price range; replaces `price` when min ≠ max. */
  priceRange?: { min: number; max: number } | null;
  /** ISO 4217 (shop currency for Etsy, offer currency for eBay). */
  currency?: string | null;
  /** Photos in staged order, pending deletes already removed. */
  images: PreviewImage[];
  /** Etsy shop name (`EtsyShop.shopName`). */
  shopName?: string | null;
  /** Etsy listing page: variation selects (labels only). */
  variations?: { name: string; options: string[] }[];
  /** Etsy listing page: personalization box. null/undefined = listing is not personalizable. */
  personalization?: { instructions?: string | null; required?: boolean; charLimit?: number | null } | null;
  /** Etsy `when_made === 'made_to_order'`. */
  madeToOrder?: boolean;
  /** Etsy processing time in business days (from the readiness state / profile). */
  processingDays?: { min: number; max: number } | null;
  /** eBay condition, as display text ("New", "Used"). */
  condition?: string | null;
  /** eBay item specifics, in display order (the item page shows the first 8). */
  specifics?: { name: string; value: string }[];
  /** eBay: true only when the fulfillment policy is known to be free; unknown → omit (never guessed). */
  freeShipping?: boolean | null;
}

/** Etsy mobile search shows about this many title characters (listing-editor §4.5). */
export const ETSY_MOBILE_TITLE_CHARS = 55;
/** Text edits reach the preview after this debounce; image changes are immediate. */
export const PREVIEW_DEBOUNCE_MS = 150;
/** Lines of description the Etsy listing page shows above "Learn more about this item". */
export const ETSY_DESCRIPTION_LEAD_LINES = 3;
/** Specifics rows the eBay item page preview shows. */
export const EBAY_SPECIFICS_SHOWN = 8;
/** Etsy search card crop (width / height). */
export const ETSY_CARD_RATIO = 4 / 3;

/** Decoded, trimmed text; '' for null/undefined. */
export function previewText(s: string | null | undefined): string {
  return decodeEntities(s ?? '').trim();
}

/**
 * Where Etsy cuts a title in mobile search. `visible` is what shoppers see (no trailing space or comma);
 * `cut` is false when the whole title fits.
 */
export function mobileTitleCut(title: string, chars = ETSY_MOBILE_TITLE_CHARS): { cut: boolean; visible: string } {
  const t = previewText(title);
  if (t.length <= chars) return { cut: false, visible: t };
  return { cut: true, visible: t.slice(0, chars).replace(/[\s,]+$/u, '') };
}

/**
 * Etsy renders descriptions as plain text: HTML tags are not interpreted, line breaks are kept.
 * Returns the decoded lines (blank lines kept so paragraphs stay apart, trailing blanks removed).
 */
export function plainDescriptionLines(description: string | null | undefined): string[] {
  const text = decodeEntities(description ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map((l) => l.replace(/\s+$/u, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines;
}

/** The first `count` non-empty description lines (Etsy listing page lead) and whether more text follows. */
export function descriptionLead(description: string | null | undefined, count = ETSY_DESCRIPTION_LEAD_LINES): { lines: string[]; more: boolean } {
  const all = plainDescriptionLines(description).filter((l) => l.trim());
  return { lines: all.slice(0, count), more: all.length > count };
}

/**
 * The dashed crop outline of the Etsy search card over the uncropped image, as percentages of the image box.
 * `ratio` = natural width / height. Taller than 4:3 → full width, partial height; wider → full height, partial width.
 */
export function cropBox(ratio: number, target = ETSY_CARD_RATIO): { widthPct: number; heightPct: number } {
  if (!Number.isFinite(ratio) || ratio <= 0) return { widthPct: 100, heightPct: 100 };
  if (ratio <= target) return { widthPct: 100, heightPct: Math.round((ratio / target) * 1000) / 10 };
  return { widthPct: Math.round((target / ratio) * 1000) / 10, heightPct: 100 };
}

const BLOCKED = 'script|style|iframe|frame|frameset|object|embed|link|meta|base|form|input|button|textarea|select|noscript|template';
/** Blocked element with its content (`<script>…</script>`). */
const BLOCKED_PAIRS = new RegExp(`<\\s*(${BLOCKED})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, 'gi');
/** Any leftover opening, closing or self-closing blocked tag. */
const BLOCKED_TAGS = new RegExp(`<\\s*\\/?\\s*(${BLOCKED})\\b[^>]*>`, 'gi');
const EVENT_ATTRS = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const SCRIPT_URLS = /\s+(href|src|xlink:href|action|formaction)\s*=\s*("|')?\s*(javascript|vbscript|data):[^"'>\s]*("|')?/gi;

/**
 * eBay descriptions are seller HTML. The security boundary is the preview's `iframe sandbox=""` (no scripts, no
 * same-origin, no forms): never loosen that sandbox. This regex pass is cosmetic only (keeps scripts, styles and
 * forms from cluttering the preview); it is NOT a sanitizer and is easy to bypass (`<img src=x/onerror=…>`,
 * entity-encoded `javascript&#58;` URLs). Do not reuse it to render HTML outside a sandboxed frame.
 */
export function sanitizeDescriptionHtml(html: string | null | undefined): string {
  let s = String(html ?? '');
  for (let i = 0; i < 3; i++) s = s.replace(BLOCKED_PAIRS, '').replace(BLOCKED_TAGS, '');
  return s.replace(EVENT_ATTRS, '').replace(SCRIPT_URLS, '');
}

/** The iframe `srcdoc` for an eBay description: sanitized body + neutral base styles (DS tokens passed in). */
export function descriptionSrcDoc(html: string | null | undefined, style: { font: string; color: string; size: number }): string {
  const body = sanitizeDescriptionHtml(html);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:8px;font-family:${style.font};font-size:${style.size}px;line-height:1.5;color:${style.color};overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${body}</body></html>`;
}
