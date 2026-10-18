/**
 * Marketplace search snapshots from the Chrome extension (Trendyol; Hepsiburada next).
 *
 * Trendyol answers our servers with 403 (bot protection) on search *and* category pages, so we never fetch them.
 * When the seller browses a Trendyol search page in their own browser, the extension reads the data the page already
 * holds (`window["__single-search-result__PROPS"]`: total, products with price, seller, rating, favorites, Trendyol's
 * order badge, sponsored flag) and posts it here. It is stored as a shared 24 h snapshot per query and Product finder
 * builds its answer from it (same ProductsResult shape as Etsy/eBay).
 *
 * The payload is untrusted (it comes from a browser): every field is type-checked and clamped, and nothing here is
 * ever written to a marketplace.
 */
import { decodeEntities, summarizeAmounts } from './stats';
import { normalizeQuery, sha1 } from './etsySearch';
import type { DemandSignal, Guarded, ProductsResult, TopListing, Evidence } from './types';

export type SnapshotMkt = 'trendyol';
export const SNAPSHOT_MKTS: readonly SnapshotMkt[] = ['trendyol'];
export const SNAPSHOT_TTL_MS = 24 * 3_600_000;
export const MAX_SNAPSHOT_ITEMS = 120;

export interface SnapshotItem {
  id: string;
  title: string;
  url: string | null;
  thumbUrl: string | null;
  /** In TRY. */
  price: number | null;
  brand: string | null;
  sellerId: string | null;
  favorites: number | null;
  /** Trendyol's own order badge as shown ("100+"), and its lower bound. */
  orderBadge: string | null;
  ordersAtLeast: number | null;
  rating: number | null;
  ratingCount: number | null;
  sponsored: boolean;
  category: string | null;
}

export interface MarketSnapshot {
  mkt: SnapshotMkt;
  query: string;
  /** Results Trendyol reports for the query. */
  total: number | null;
  items: SnapshotItem[];
  capturedAt: string;
}

export function snapshotKey(mkt: SnapshotMkt, q: string): string {
  return `public:${mkt}:search:${sha1(normalizeQuery(q))}`;
}

const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? decodeEntities(v.trim()).slice(0, max) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null;
};

/** "3K" → 3000, "1,2B" (bin) → 1200, "15K" → 15000, "360" → 360, "1.2M" → 1 200 000. */
export function parseCompact(raw: unknown): number | null {
  if (typeof raw === 'number') return num(raw);
  if (typeof raw !== 'string') return null;
  const m = raw.trim().replace(/\s+/g, '').match(/^(\d+(?:[.,]\d+)?)([KkBbMm])?\+?$/);
  if (!m) return null;
  const base = Number(m[1].replace(',', '.'));
  const mult = m[2] ? ({ k: 1e3, b: 1e3, m: 1e6 } as Record<string, number>)[m[2].toLowerCase()] : 1;
  return Number.isFinite(base) ? Math.round(base * mult) : null;
}

const safeUrl = (v: unknown, host: RegExp): string | null => {
  const s = str(v, 600);
  if (!s) return null;
  try {
    const u = new URL(s, 'https://www.trendyol.com');
    return u.protocol === 'https:' && host.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
};

/** Pure: validate the extension payload. Null when it is not a usable snapshot. */
export function parseSnapshot(body: any, nowIso = new Date().toISOString()): MarketSnapshot | null {
  if (!body || typeof body !== 'object') return null;
  if (!SNAPSHOT_MKTS.includes(body.mkt)) return null;
  const query = str(body.query, 120);
  if (!query) return null;
  const rawItems: any[] = Array.isArray(body.items) ? body.items.slice(0, MAX_SNAPSHOT_ITEMS) : [];
  const items: SnapshotItem[] = [];
  const seen = new Set<string>();
  for (const r of rawItems) {
    const id = str(String(r?.id ?? ''), 30);
    if (!id || !/^\d{3,20}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const orderBadge = str(r?.orderBadge, 20);
    items.push({
      id,
      title: str(r?.title, 300) ?? '',
      url: safeUrl(r?.url, /(^|\.)trendyol\.com$/),
      thumbUrl: safeUrl(r?.thumbUrl, /(^|\.)dsmcdn\.com$/),
      price: num(r?.price),
      brand: str(r?.brand, 80),
      sellerId: r?.sellerId != null ? str(String(r.sellerId), 20) : null,
      favorites: parseCompact(r?.favorites),
      orderBadge,
      ordersAtLeast: parseCompact(orderBadge),
      rating: (() => { const n = num(r?.rating); return n != null && n <= 5 ? n : null; })(),
      ratingCount: num(r?.ratingCount),
      sponsored: r?.sponsored === true,
      category: str(r?.category, 120),
    });
  }
  if (items.length < 5) return null;
  return { mkt: body.mkt, query, total: num(body.total), items, capturedAt: nowIso };
}

const guardOk = (value: number): Guarded<number> => ({ value, kind: 'measured', guard: { ok: true } });
const guardNo = (reasonKey: string): Guarded<number> => ({ value: null, kind: 'measured', guard: { ok: false, reasonKey } });

/** Share of the organic (non-sponsored) top results held by the 5 biggest sellers. */
export function sellerTop5Share(items: SnapshotItem[], n = 48): Guarded<number> {
  const organic = items.filter((i) => !i.sponsored && i.sellerId).slice(0, n);
  if (organic.length < 10) return guardNo('research.guard.insufficient');
  const per = new Map<string, number>();
  for (const i of organic) per.set(i.sellerId as string, (per.get(i.sellerId as string) ?? 0) + 1);
  const top5 = [...per.values()].sort((a, b) => b - a).slice(0, 5).reduce((s, v) => s + v, 0);
  return guardOk(Math.round((top5 / organic.length) * 1000) / 1000);
}

export function toTopListingsFromSnapshot(s: MarketSnapshot, n = 48): TopListing[] {
  return s.items.filter((i) => !i.sponsored).slice(0, n).map((i) => ({
    id: i.id,
    title: i.title,
    url: i.url,
    thumbUrl: i.thumbUrl,
    price: i.price != null ? { amount: i.price, currency: 'TRY' } : null,
    favorites: i.favorites,
    ageDays: null,
    shop: { id: i.sellerId, name: i.brand, url: null },
    tags: [],
    orderBadge: i.orderBadge,
    ratingCount: i.ratingCount,
  }));
}

/**
 * Pure: ProductsResult from a snapshot (+ demand/evidence built by the caller from Google signals). Newcomers are
 * not measurable on Trendyol (no shop opening dates on the page) and say so.
 */
export function snapshotResult(
  s: MarketSnapshot,
  extras: { demand: DemandSignal; evidence: (p: { price: ProductsResult['price']; total: Guarded<number>; newcomers: Guarded<number>; demand: DemandSignal }) => Evidence; cached: boolean },
): ProductsResult {
  const organic = s.items.filter((i) => !i.sponsored);
  const price = summarizeAmounts(organic.map((i) => i.price).filter((p): p is number => p != null), 'TRY');
  const total = s.total != null ? guardOk(s.total) : guardNo('research.guard.insufficient');
  const newcomers = guardNo('research.guard.notAvailableTrendyol');
  return {
    query: s.query,
    mkt: 'trendyol',
    country: 'TR',
    evidence: extras.evidence({ price, total, newcomers, demand: extras.demand }),
    price,
    competition: { total, top5Share: sellerTop5Share(s.items) },
    demand: extras.demand,
    newcomers,
    buyerWords: [],
    top: toTopListingsFromSnapshot(s),
    categoryHint: null,
    draftTags: [],
    fetchedAt: s.capturedAt,
    cached: extras.cached,
  };
}

/** Extra Trendyol facts for the answer card (ads pressure, how many show Trendyol's order badge). */
export function snapshotFacts(s: MarketSnapshot): { sponsoredShare: number; withOrderBadge: number; organic: number } {
  const top = s.items.slice(0, 48);
  const organic = s.items.filter((i) => !i.sponsored).slice(0, 48);
  return {
    sponsoredShare: top.length ? Math.round((top.filter((i) => i.sponsored).length / top.length) * 1000) / 1000 : 0,
    withOrderBadge: organic.filter((i) => i.ordersAtLeast != null).length,
    organic: organic.length,
  };
}
