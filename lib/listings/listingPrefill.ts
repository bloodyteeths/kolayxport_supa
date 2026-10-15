/**
 * lib/listings/listingPrefill.ts — listing prefill contract (research -> creator). Moved out of
 * components/etsy/research/shared/listingPrefill.ts so the Research hub and the creators no longer import the legacy
 * research screens; the legacy copy (same storage key and shape) goes with those screens.
 *
 * A research page writes sessionStorage 'kx:listingPrefill' and navigates to
 * /app/etsy-listings/new?prefill=session (or /app/ebay-listings/new?prefill=session).
 * The target page reads + removes the entry (only when `target` matches),
 * validates every field and opens its creator prefilled. Nothing is ever
 * published automatically — the creator only stages a local draft until the
 * user explicitly publishes / syncs.
 */
import type { MarketResearchData } from './marketResearchData';

export type { MarketResearchData };

export const LISTING_PREFILL_KEY = 'kx:listingPrefill';

export type ListingPrefillTarget = 'etsy' | 'ebay';
export type ListingPrefillSource = 'etsy-research' | 'ebay-research' | 'arbitrage' | 'trendyol-research';

export interface ListingPrefillV1 {
  v: 1;
  target: ListingPrefillTarget;
  source: ListingPrefillSource;
  title?: string;
  description?: string;
  tags?: string[];
  keywords?: string[];
  price?: number;
  currency?: string;
  imageUrls?: string[];
  categoryHint?: string;
  research?: any;
}

const SOURCES: ListingPrefillSource[] = ['etsy-research', 'ebay-research', 'arbitrage', 'trendyol-research'];

export function prefillHref(target: ListingPrefillTarget): string {
  return target === 'etsy' ? '/app/etsy-listings/new?prefill=session' : '/app/ebay-listings/new?prefill=session';
}

/** Write the prefill entry. Returns false when sessionStorage is unavailable. */
export function writeListingPrefill(payload: Omit<ListingPrefillV1, 'v'>): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.sessionStorage.setItem(LISTING_PREFILL_KEY, JSON.stringify({ v: 1, ...payload }));
    return true;
  } catch {
    return false;
  }
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

function strList(v: unknown, maxLen: number, maxCount: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.replace(/\s+/g, ' ').trim();
    if (!s || s.length > maxLen) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= maxCount) break;
  }
  return out;
}

function httpsList(v: unknown, maxCount: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const u of v) {
    if (typeof u !== 'string') continue;
    const s = u.trim();
    if (!/^https:\/\//i.test(s) || s.length > 2048 || out.includes(s)) continue;
    out.push(s);
    if (out.length >= maxCount) break;
  }
  return out;
}

/** Validate an untrusted parsed object against the contract for `target`. */
export function sanitizeListingPrefill(raw: unknown, target: ListingPrefillTarget): ListingPrefillV1 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || r.target !== target) return null;
  const source = SOURCES.includes(r.source as ListingPrefillSource) ? (r.source as ListingPrefillSource) : null;
  if (!source) return null;
  const isEtsy = target === 'etsy';
  const priceNum = typeof r.price === 'number' ? r.price : Number.NaN;
  const currency = typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency.trim().toUpperCase())
    ? r.currency.trim().toUpperCase() : undefined;
  return {
    v: 1,
    target,
    source,
    title: str(r.title, isEtsy ? 140 : 80),
    description: typeof r.description === 'string' && r.description.trim() ? r.description.trim().slice(0, 10000) : undefined,
    // Etsy: max 13 tags, each <= 20 chars. eBay has no tags; keep a loose list.
    tags: strList(r.tags, isEtsy ? 20 : 65, isEtsy ? 13 : 30),
    keywords: strList(r.keywords, 60, 30),
    price: Number.isFinite(priceNum) && priceNum > 0 && priceNum < 1_000_000 ? Math.round(priceNum * 100) / 100 : undefined,
    currency,
    imageUrls: httpsList(r.imageUrls, isEtsy ? 20 : 24),
    categoryHint: str(r.categoryHint, 200),
    research: r.research && typeof r.research === 'object' ? r.research : undefined,
  };
}

/**
 * Read + remove the prefill entry for `target`. An entry for another target
 * is left in place (it belongs to the other creator).
 */
export function consumeListingPrefill(target: ListingPrefillTarget): ListingPrefillV1 | null {
  try {
    if (typeof window === 'undefined') return null;
    const rawText = window.sessionStorage.getItem(LISTING_PREFILL_KEY);
    if (!rawText) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(rawText); } catch {
      window.sessionStorage.removeItem(LISTING_PREFILL_KEY);
      return null;
    }
    const p = parsed as Record<string, unknown> | null;
    if (!p || typeof p !== 'object' || p.target !== target) return null;
    window.sessionStorage.removeItem(LISTING_PREFILL_KEY);
    return sanitizeListingPrefill(parsed, target);
  } catch {
    return null;
  }
}

/** Validate an untrusted research payload into the creator's MarketResearchData. */
export function toMarketResearchData(raw: unknown): MarketResearchData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const query = typeof r.query === 'string' ? r.query.trim().slice(0, 200) : '';
  const topTags = Array.isArray(r.topTags)
    ? r.topTags
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as any).tag === 'string' && (x as any).tag.trim())
      .slice(0, 30)
      .map((x) => ({ tag: String(x.tag).trim().slice(0, 40), count: num(x.count), pct: num(x.pct) }))
    : [];
  const topKeywords = Array.isArray(r.topKeywords)
    ? r.topKeywords
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as any).keyword === 'string' && (x as any).keyword.trim())
      .slice(0, 30)
      .map((x) => ({ keyword: String(x.keyword).trim().slice(0, 60), count: num(x.count), pct: num(x.pct) }))
    : [];
  let priceStats: MarketResearchData['priceStats'] = null;
  const ps = r.priceStats as Record<string, unknown> | null | undefined;
  if (ps && typeof ps === 'object') {
    const min = num(ps.min), avg = num(ps.avg), median = num(ps.median), max = num(ps.max);
    if (max > 0 && min >= 0 && min <= max) priceStats = { min, avg, median, max };
  }
  if (!query && topTags.length === 0 && topKeywords.length === 0) return null;
  return { query, topTags, topKeywords, priceStats };
}

/** Most common currency code among items, or undefined when mixed/unknown. */
export function dominantCurrency(items: Array<{ currency_code?: string }>): string | undefined {
  const counts: Record<string, number> = {};
  for (const i of items) {
    const c = typeof i.currency_code === 'string' ? i.currency_code.toUpperCase() : '';
    if (/^[A-Z]{3}$/.test(c)) counts[c] = (counts[c] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return undefined;
  // Only trust it when it clearly dominates (a median over mixed currencies is meaningless).
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return entries[0][1] / total >= 0.8 ? entries[0][0] : undefined;
}

/**
 * R0: research → prefill price context from a robust summary. The legacy
 * `avg` slot (read by the listing creator) carries the median, never a mean.
 * Returns null when the sample is too small or implausible.
 */
export function prefillPriceStats(
  ps: { min: number | null; max: number | null; median: number | null; quality?: string } | null | undefined,
): MarketResearchData['priceStats'] {
  if (!ps || ps.median == null || ps.min == null || ps.max == null) return null;
  if (ps.quality === 'insufficient' || ps.quality === 'implausible') return null;
  return { min: ps.min, avg: ps.median, median: ps.median, max: ps.max };
}

/** Suggested price from a robust summary: the median, only when the sample is ok. */
export function prefillPrice(ps: { median: number | null; quality?: string } | null | undefined): number | undefined {
  return ps && ps.median != null && (ps.quality === undefined || ps.quality === 'ok') ? ps.median : undefined;
}
