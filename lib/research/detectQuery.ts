// lib/research/detectQuery.ts — Research Home smart search (research.md §4.3) and the TR-input rule (§3.3).
// Pure: no I/O, no React. The UI decides "own listing or not" and passes it in.

import type { ResearchMkt } from './types';

export type DetectedQuery =
  | { kind: 'etsyListing'; listingId: string; slugTitle: string | null }
  | { kind: 'etsyShop'; shopName: string }
  | { kind: 'ebayItem'; itemId: string; slugTitle: string | null }
  | { kind: 'ebaySeller'; seller: string }
  | { kind: 'trendyolProduct'; productId: string; url: string; slugTitle: string | null }
  | { kind: 'amazonAsin'; asin: string }
  | { kind: 'text'; text: string };

export type QuestionChip = 'niche' | 'price' | 'tags' | 'notSelling' | 'competitors';
export const QUESTION_CHIPS: readonly QuestionChip[] = ['niche', 'price', 'tags', 'notSelling', 'competitors'];

function toUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes('.')) return null;
    return u;
  } catch {
    return null;
  }
}

/** "personalized-wooden-box" → "personalized wooden box". */
function slugToTitle(slug: string | undefined | null): string | null {
  if (!slug) return null;
  let decoded = slug;
  try { decoded = decodeURIComponent(slug); } catch { /* keep raw */ }
  const t = decoded.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

function hostIs(u: URL, domain: string): boolean {
  const h = u.hostname.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

/** eBay, Amazon and Etsy run country domains (ebay.co.uk, amazon.de, etsy.com). */
function hostMatches(u: URL, base: string): boolean {
  const h = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  return h === `${base}.com` || h.startsWith(`${base}.`) || hostIs(u, `${base}.com`);
}

export function detectQuery(input: string): DetectedQuery {
  const text = String(input ?? '').trim();
  const u = toUrl(text);
  if (u) {
    const parts = u.pathname.split('/').filter(Boolean);
    if (hostMatches(u, 'etsy')) {
      // /listing/<id>/<slug>  ·  /<lang>/listing/<id>  ·  /shop/<name>
      const li = parts.indexOf('listing');
      if (li >= 0 && /^\d{5,20}$/.test(parts[li + 1] || '')) {
        return { kind: 'etsyListing', listingId: parts[li + 1], slugTitle: slugToTitle(parts[li + 2]) };
      }
      const si = parts.indexOf('shop');
      if (si >= 0 && parts[si + 1]) return { kind: 'etsyShop', shopName: parts[si + 1] };
    }
    if (hostMatches(u, 'ebay')) {
      const ii = parts.indexOf('itm');
      if (ii >= 0) {
        // /itm/<id>  ·  /itm/<slug>/<id>
        const a = parts[ii + 1] || '';
        const b = parts[ii + 2] || '';
        if (/^\d{9,15}$/.test(a)) return { kind: 'ebayItem', itemId: a, slugTitle: null };
        if (/^\d{9,15}$/.test(b)) return { kind: 'ebayItem', itemId: b, slugTitle: slugToTitle(a) };
      }
      const ui = parts.findIndex((p) => p === 'str' || p === 'usr');
      if (ui >= 0 && parts[ui + 1]) return { kind: 'ebaySeller', seller: parts[ui + 1] };
    }
    if (hostMatches(u, 'trendyol')) {
      const last = parts[parts.length - 1] || '';
      const m = last.match(/^(.*)-p-(\d+)$/);
      if (m) return { kind: 'trendyolProduct', productId: m[2], url: u.toString(), slugTitle: slugToTitle(m[1]) };
    }
    if (hostMatches(u, 'amazon')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
      if (m) return { kind: 'amazonAsin', asin: m[1].toUpperCase() };
    }
  }
  return { kind: 'text', text };
}

/** Removes the last word ("Try a broader phrase"). Returns null when nothing would remain. */
export function broaderPhrase(q: string): string | null {
  const words = String(q || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return null;
  return words.slice(0, -1).join(' ');
}

// ─── Routing ────────────────────────────────────────────────────────────────

export interface RouteOptions {
  /** True when the Etsy listing id belongs to one of the viewer's shops (own → Listing doctor). */
  isOwnListing?: (listingId: string) => boolean;
  chip?: QuestionChip | null;
  mkt?: ResearchMkt;
  /** Trendyol Price gap (R4) is live; before it a Trendyol link opens Product finder with the title. */
  priceGapEnabled?: boolean;
}

function href(path: string, params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

const CHIP_ROUTE: Record<QuestionChip, { path: string; hash?: string; param: 'q' }> = {
  niche: { path: '/app/research/products', param: 'q' },
  price: { path: '/app/research/products', hash: '#price', param: 'q' },
  tags: { path: '/app/research/keywords', param: 'q' },
  notSelling: { path: '/app/research/listings', param: 'q' },
  competitors: { path: '/app/research/shops', param: 'q' },
};

/** Where a question chip goes with the current query prefilled (research.md §4.3). */
export function chipHref(chip: QuestionChip, q: string, mkt?: ResearchMkt): string {
  const r = CHIP_ROUTE[chip];
  const params: Record<string, string | undefined> = { mkt };
  // Listing doctor filters its own list by `q`; Shop tracker takes `add=` only for shop links.
  if (chip !== 'competitors') params[r.param] = q.trim() || undefined;
  return href(r.path, params) + (r.hash ?? '');
}

/** Research Home search → destination href. */
export function routeForQuery(input: string, opts: RouteOptions = {}): string {
  const d = detectQuery(input);
  const mkt = opts.mkt;
  switch (d.kind) {
    case 'etsyListing':
      if (opts.isOwnListing?.(d.listingId)) return href('/app/research/listings', { mkt: 'etsy', open: d.listingId });
      return href('/app/research/products', { mkt: 'etsy', q: d.slugTitle ?? undefined, compareListing: d.listingId });
    case 'etsyShop':
      return href('/app/research/shops', { mkt: 'etsy', add: d.shopName });
    case 'ebayItem':
      return href('/app/research/products', { mkt: 'ebay', q: d.slugTitle ?? undefined, compareItem: d.itemId });
    case 'ebaySeller':
      return href('/app/research/shops', { mkt: 'ebay', add: d.seller });
    case 'trendyolProduct':
      if (opts.priceGapEnabled) return href('/app/research/products', { source: 'trendyol', url: d.url });
      return href('/app/research/products', { mkt: 'trendyol', q: d.slugTitle ?? undefined });
    case 'amazonAsin':
      return href('/app/research/products', { mkt: 'amazon', q: d.asin });
    case 'text':
    default: {
      const q = d.kind === 'text' ? d.text : '';
      if (opts.chip) return chipHref(opts.chip, q, mkt);
      return href('/app/research/products', { mkt, q: q || undefined });
    }
  }
}

// ─── Turkish input (research.md §3.3) ──────────────────────────────────────

const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;

/** ASCII English function words + very common marketplace nouns. Any hit → treat the text as English. */
const EN_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'of', 'to', 'in', 'on', 'my', 'your', 'her', 'his', 'from', 'by',
  'gift', 'gifts', 'box', 'personalized', 'custom', 'wooden', 'wood', 'necklace', 'ring', 'baby', 'wedding', 'mom',
  'dad', 'kids', 'women', 'men', 'set', 'name', 'birthday', 'christmas', 'decor', 'home', 'jewelry', 'bag', 'shirt',
  'print', 'art', 'wall', 'mug', 'cup', 'handmade', 'vintage', 'leather', 'gold', 'silver', 'keepsake', 'memory',
  'toy', 'puzzle', 'sign', 'card', 'candle', 'blanket', 'pillow', 'ornament', 'earrings', 'bracelet',
]);

/** Common ASCII-typed Turkish words (users often type without Turkish characters). */
const TR_ASCII_HINTS = new Set([
  've', 'ile', 'icin', 'bir', 'hediye', 'kutu', 'kutusu', 'ahsap', 'kolye', 'yuzuk', 'bebek', 'dugun', 'anne', 'baba',
  'kisiye', 'ozel', 'isimli', 'el', 'yapimi', 'canta', 'taki', 'bileklik', 'kupe', 'tablo', 'dekor', 'ev', 'oyuncak',
  'deri', 'gumus', 'altin', 'hatira', 'ani', 'mum', 'battaniye', 'yastik', 'bardak', 'kupa',
]);

/**
 * True when the query should be offered "Translate to English keywords":
 * it contains Turkish letters, or it has an ASCII Turkish word, or the UI is Turkish and no English word matches.
 */
export function isLikelyTurkish(text: string, uiLocale?: string | null): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  if (TR_CHARS.test(s)) return true;
  const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.some((w) => TR_ASCII_HINTS.has(w))) return true;
  if (String(uiLocale || '').toLowerCase().startsWith('tr')) return !words.some((w) => EN_WORDS.has(w));
  return false;
}
