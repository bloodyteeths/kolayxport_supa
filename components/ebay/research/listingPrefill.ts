/**
 * Research -> listing creator hand-off ("listing prefill contract").
 *
 * A research page writes one payload to sessionStorage under LISTING_PREFILL_KEY
 * and navigates to /app/<etsy|ebay>-listings?prefill=session. The target page
 * reads + removes it (only when `target` matches), validates every field, and
 * opens its creator prefilled. Nothing is ever published automatically.
 */

export const LISTING_PREFILL_KEY = 'kx:listingPrefill';

export type ListingPrefillTarget = 'etsy' | 'ebay';
export type ListingPrefillSource = 'etsy-research' | 'ebay-research' | 'arbitrage' | 'trendyol-research';

export interface ListingPrefillPayload {
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
  research?: unknown;
}

const SOURCES: ListingPrefillSource[] = ['etsy-research', 'ebay-research', 'arbitrage', 'trendyol-research'];
const MAX_RESEARCH_BYTES = 200_000;

function cleanString(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

function cleanStringList(v: unknown, maxLen: number, maxCount: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
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
  return out.length ? out : undefined;
}

function cleanImageUrls(v: unknown, maxCount: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    if (!out.includes(s)) out.push(s);
    if (out.length >= maxCount) break;
  }
  return out.length ? out : undefined;
}

/** Validate an untrusted payload for `target`. Returns null when it is not for this target or is malformed. */
export function sanitizeListingPrefill(raw: unknown, target: ListingPrefillTarget): ListingPrefillPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || r.target !== target) return null;
  const source = SOURCES.includes(r.source as ListingPrefillSource) ? (r.source as ListingPrefillSource) : null;
  if (!source) return null;

  const isEtsy = target === 'etsy';
  const out: ListingPrefillPayload = { v: 1, target, source };
  out.title = cleanString(r.title, isEtsy ? 140 : 200);
  out.description = cleanText(r.description, 20_000);
  // Etsy: 13 tags, 20 chars each. eBay has no tags; keep the same per-item limit.
  out.tags = cleanStringList(r.tags, 20, isEtsy ? 13 : 30);
  out.keywords = cleanStringList(r.keywords, 60, 30);
  const price = typeof r.price === 'number' ? r.price : NaN;
  if (Number.isFinite(price) && price > 0 && price < 1_000_000) out.price = Math.round(price * 100) / 100;
  const currency = typeof r.currency === 'string' ? r.currency.trim().toUpperCase() : '';
  if (/^[A-Z]{3}$/.test(currency)) out.currency = currency;
  out.imageUrls = cleanImageUrls(r.imageUrls, isEtsy ? 10 : 24);
  out.categoryHint = cleanString(r.categoryHint, 200);
  if (r.research && typeof r.research === 'object') {
    try {
      if (JSON.stringify(r.research).length <= MAX_RESEARCH_BYTES) out.research = r.research;
    } catch {
      /* not serialisable — drop it */
    }
  }
  // Drop undefined keys so consumers can spread safely.
  (Object.keys(out) as (keyof ListingPrefillPayload)[]).forEach((k) => {
    if (out[k] === undefined) delete out[k];
  });
  return out;
}

/** Store a payload for the target page. Returns false when sessionStorage is unavailable. */
export function writeListingPrefill(payload: ListingPrefillPayload): boolean {
  try {
    window.sessionStorage.setItem(LISTING_PREFILL_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the stored payload for `target`. The entry is removed only when it was
 * meant for this target, so a stale Etsy payload can't be eaten by the eBay page.
 */
export function readListingPrefill(target: ListingPrefillTarget): ListingPrefillPayload | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(LISTING_PREFILL_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try { window.sessionStorage.removeItem(LISTING_PREFILL_KEY); } catch { /* ignore */ }
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as any).target !== target) return null;
  try { window.sessionStorage.removeItem(LISTING_PREFILL_KEY); } catch { /* ignore */ }
  return sanitizeListingPrefill(parsed, target);
}

/** Path the source page navigates to after writing the payload. */
export function listingPrefillPath(target: ListingPrefillTarget): string {
  return target === 'etsy' ? '/app/etsy-listings?prefill=session' : '/app/ebay-listings?prefill=session';
}

/** Marketplace name shown in the creator's "copied from" banner. */
export function listingPrefillSourceLabel(source: ListingPrefillSource): string {
  switch (source) {
    case 'arbitrage':
    case 'trendyol-research':
      return 'Trendyol';
    case 'etsy-research':
      return 'Etsy';
    case 'ebay-research':
    default:
      return 'eBay';
  }
}
