// components/domain/research/shops/shopModel.ts (research R3-B) — pure helpers of the Shop tracker (research.md §8).
// No React, no I/O: input parsing for "Watch a shop", quota rules, card lines, chart series, prefill payloads.
import { contentWords } from '@/lib/etsy/seoRules';
import { detectQuery } from '@/lib/research/detectQuery';
import { urlField } from '@/lib/ds/useUrlState';
import type { Guarded } from '@/lib/research/types';
import type { DsFormat } from '@/components/ds/data/fmt';
import type { AlertRules, SalesPoint, ShopWatchCreate, WatchListingLite, WatchQuota, WatchSummary } from '@/lib/research/hooks/useWatches';
import { AT_LEAST_KEY, DEFAULT_ALERT_RULES, NO_READING_KEY, PRICE_DROP_PCT, SALES_SPIKE_X, TRACKED_ITEMS_KEY } from '@/lib/research/hooks/useWatches';

/** Marketplaces the Shop tracker serves in v1 (Etsy shops, eBay sellers). Amazon ASIN watches stay on the legacy page. */
export type ShopMkt = 'etsy' | 'ebay';
export const SHOP_MKTS: readonly ShopMkt[] = ['etsy', 'ebay'];
export function isShopMkt(m: unknown): m is ShopMkt {
  return m === 'etsy' || m === 'ebay';
}

/** Translator over full keys (`research.*`). */
export type ShopT = {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
};

/** `?open=<watchId>` (panel) · `?add=<shop>` (opens "Watch a shop" prefilled; set by the Research Home router). */
export const SHOPS_URL_SCHEMA = {
  open: urlField.string(undefined, { maxLength: 64 }),
  add: urlField.string(undefined, { maxLength: 200 }),
};

// ─── "Watch a shop" input ────────────────────────────────────────────────────────────────────────────────

export type ParsedShop =
  | { ok: true; request: Omit<ShopWatchCreate, 'alertRules'>; name: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'unsupported' };

function etsy(name: string): ParsedShop {
  return { ok: true, request: { input: name, type: 'etsyShop', marketplace: 'etsy', refId: name, label: name }, name };
}
function ebay(name: string): ParsedShop {
  return { ok: true, request: { input: name, type: 'ebaySeller', marketplace: 'ebay', refId: name, label: name }, name };
}

/** Etsy shop names: letters and digits, up to 20 (Etsy's rule); we accept up to 40 for older shops. */
const ETSY_NAME = /^[A-Za-z0-9]{2,40}$/;
/** eBay user ids: letters, digits, `.`, `_`, `-`, `*`, up to 64. */
const EBAY_NAME = /^[A-Za-z0-9._*-]{2,64}$/;

/**
 * "Shop link or name" → a watch request. A link picks its marketplace (etsy.com/shop/…, ebay.com/usr/… or /str/…);
 * a plain name uses the hub's marketplace. Other links (a listing, Trendyol, Amazon) are `unsupported`.
 */
export function parseShopInput(input: string, mkt: ShopMkt): ParsedShop {
  const text = String(input ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const d = detectQuery(text);
  if (d.kind === 'etsyShop') {
    const name = safeDecode(d.shopName);
    return ETSY_NAME.test(name) ? etsy(name) : { ok: false, reason: 'invalid' };
  }
  if (d.kind === 'ebaySeller') {
    const name = safeDecode(d.seller);
    return EBAY_NAME.test(name) ? ebay(name) : { ok: false, reason: 'invalid' };
  }
  if (d.kind !== 'text') return { ok: false, reason: 'unsupported' };
  if (/^https?:\/\//i.test(text) || /\s/.test(text)) return { ok: false, reason: /\s/.test(text) ? 'invalid' : 'unsupported' };
  const name = text.replace(/^@/, '');
  if (mkt === 'etsy') return ETSY_NAME.test(name) ? etsy(name) : { ok: false, reason: 'invalid' };
  return EBAY_NAME.test(name) ? ebay(name) : { ok: false, reason: 'invalid' };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s).trim();
  } catch {
    return s.trim();
  }
}

/** The watch a parsed shop would duplicate (same marketplace; name = label, shop name or refId; case-insensitive). */
export function findExisting(rows: WatchSummary[], marketplace: 'etsy' | 'ebay', name: string): WatchSummary | null {
  const key = name.toLowerCase();
  return (
    rows.find(
      (r) => r.marketplace === marketplace && [r.refId, r.label, r.shop?.name ?? ''].some((v) => v.toLowerCase() === key),
    ) ?? null
  );
}

// ─── Quota (research §1.2: a standing count over active watches, not a monthly meter) ───────────────────

export function quotaFull(q: WatchQuota | null): boolean {
  return Boolean(q && q.limit !== null && q.used >= q.limit);
}

// ─── Alerts ──────────────────────────────────────────────────────────────────────────────────────────────

export type AlertKey = 'newListings' | 'priceDrop' | 'salesSpike';
export const ALERT_KEYS: readonly AlertKey[] = ['newListings', 'priceDrop', 'salesSpike'];

export function alertOn(rules: AlertRules, key: AlertKey): boolean {
  if (key === 'newListings') return rules.newListing;
  if (key === 'priceDrop') return rules.priceDropPct !== null;
  return rules.salesSpikeX !== null;
}

export function withAlert(rules: AlertRules, key: AlertKey, on: boolean): AlertRules {
  if (key === 'newListings') return { ...rules, newListing: on };
  if (key === 'priceDrop') return { ...rules, priceDropPct: on ? PRICE_DROP_PCT : null };
  return { ...rules, salesSpikeX: on ? SALES_SPIKE_X : null };
}

export { DEFAULT_ALERT_RULES };

// ─── Numbers (every one keeps its guard; null → "—") ─────────────────────────────────────────────────────

export function usable(g: Guarded<number> | undefined): g is Guarded<number> & { value: number } {
  return Boolean(g && g.guard.ok && typeof g.value === 'number' && Number.isFinite(g.value));
}

/** Sales/day at 1 decimal ("14.3"). */
export function salesText(row: WatchSummary, fmt: DsFormat): string | null {
  const g = row.metrics.salesPerDay;
  return usable(g) ? fmt.num(g.value, { decimals: 1 }) : null;
}

/** "▲ 22%" / "▼ 8%" / "0%" for a fraction change; null when guarded. */
export function deltaText(g: Guarded<number>, fmt: DsFormat): string | null {
  if (!usable(g)) return null;
  return fmt.delta(g.value, 'up')?.text ?? null;
}

/** A passed value that is a lower bound (the shop's listing fetch was truncated): "≥ +9", never "+9". */
export function isAtLeast(g: Guarded<number> | undefined): boolean {
  return Boolean(g && usable(g) && g.guard.reasonKey === AT_LEAST_KEY);
}

/** eBay seller sales/day summed over only the user's tracked items of that seller: their count, else null. */
export function trackedItems(g: Guarded<number> | undefined): number | null {
  if (!g || !usable(g) || g.guard.reasonKey !== TRACKED_ITEMS_KEY) return null;
  const n = Number(g.guard.reasonParams?.items);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "Before two readings" wording: one reading → "First reading taken today…"; none → "No reading yet…". */
export function notYetKey(row: WatchSummary): string {
  return row.snapshots.count === 0 ? NO_READING_KEY : 'research.shops.firstReading';
}

/** eBay lifetime "items sold at least once" (all time), or null. */
export function soldAllTime(row: WatchSummary): number | null {
  const v = row.metrics.soldItemsAllTime;
  return row.marketplace === 'ebay' && typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function cardSubtitle(row: WatchSummary, t: ShopT, fmt: DsFormat): string {
  const s = salesText(row, fmt);
  if (s === null) {
    const sold = soldAllTime(row);
    if (sold !== null) return t('research.shops.ebaySoldAllTime', { count: sold, value: fmt.num(sold) });
    return row.snapshots.count < 2 ? t(notYetKey(row)) : t('research.shops.noSales');
  }
  const d = deltaText(row.metrics.salesVsPrev, fmt);
  const items = trackedItems(row.metrics.salesPerDay);
  const base = t('research.shops.card.sales', { value: s });
  return [base, items !== null ? t('research.shops.fromTrackedItems', { count: items }) : null, d].filter(Boolean).join(' · ');
}

/** "+9" or, when the count is a lower bound, "≥ +9". */
export function newCountText(g: Guarded<number>, fmt: DsFormat): string | null {
  if (!usable(g)) return null;
  const v = `+${fmt.num(g.value)}`;
  return isAtLeast(g) ? `≥ ${v}` : v;
}

/** Card meta (research §8.2): "412 active · +9 new". */
export function cardMeta(row: WatchSummary, t: ShopT, fmt: DsFormat): string {
  const parts: string[] = [];
  if (usable(row.metrics.active)) parts.push(t('research.shops.card.active', { value: fmt.num(row.metrics.active.value) }));
  if (usable(row.metrics.new7d)) {
    const value = fmt.num(row.metrics.new7d.value);
    parts.push(t(isAtLeast(row.metrics.new7d) ? 'research.shops.card.newAtLeast' : 'research.shops.card.new', { value }));
  }
  return parts.join(' · ');
}

// ─── Panel chart ─────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
export const SERIES_DAYS = 30;

/** UTC midnight of a `YYYY-MM-DD…` / ISO date, or null. */
function utcDayMs(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = new Date(date).getTime();
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) * DAY_MS : null;
}

/**
 * Up-to-30-day series for `Chart line`: one category per UTC day from the first point in the window to the latest (Date objects, so the axis and
 * "Show as table" use DS date formatting). Dropped points (guard 7) and days without a point are gaps (null), never
 * zeros, and the line never bridges a missing day.
 */
export function salesSeries(points: SalesPoint[]): { categories: Date[]; data: Array<number | null>; dropped: number; measured: number } {
  const byDay = new Map<number, SalesPoint>();
  for (const p of points) {
    const d = utcDayMs(p.date);
    if (d !== null) byDay.set(d, p);
  }
  if (byDay.size === 0) return { categories: [], data: [], dropped: 0, measured: 0 };
  const days = Array.from(byDay.keys());
  const end = Math.max(...days);
  // From the first reading in the window (a new watch isn't padded with a month of empty days) to the latest.
  const start = Math.max(Math.min(...days), end - (SERIES_DAYS - 1) * DAY_MS);
  const categories: Date[] = [];
  const data: Array<number | null> = [];
  let dropped = 0;
  let measured = 0;
  for (let day = start; day <= end; day += DAY_MS) {
    const p = byDay.get(day);
    categories.push(new Date(day));
    if (!p) {
      data.push(null);
      continue;
    }
    if (p.dropped) dropped++;
    const v = p.dropped ? null : p.value;
    if (v !== null) measured++;
    data.push(v);
  }
  return { categories, data, dropped, measured };
}

// ─── Actions ─────────────────────────────────────────────────────────────────────────────────────────────

/** Product finder seed for "Research this idea": the title's lead phrase, ≤ 4 content words (never their title). */
export function ideaQuery(title: string): string {
  const lead = String(title || '').split(/[,|–—]/)[0] || '';
  const words = contentWords(lead).slice(0, 4);
  return words.join(' ') || String(title || '').trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase();
}

function href(path: string, params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export function researchIdeaHref(listing: Pick<WatchListingLite, 'title'>, mkt: ShopMkt): string {
  return href('/app/research/products', { mkt, q: ideaQuery(listing.title) });
}

export function keywordHref(tag: string, mkt: ShopMkt): string {
  return href('/app/research/keywords', { mkt, q: tag });
}

/** "Compare with my listing" → Product finder with the listing's main keyword (title lead phrase) and the listing. */
export function compareHref(listing: { id: string; title: string }, mkt: ShopMkt): string {
  return href('/app/research/products', {
    mkt,
    q: ideaQuery(listing.title),
    ...(mkt === 'etsy' ? { compareListing: listing.id } : { compareItem: listing.id }),
  });
}

/**
 * "Draft a similar listing" prefill (research §8.1): NO title (the creator writes OUR AI title from the keywords,
 * never theirs), their tags that fit Etsy's 20-char limit (Etsy only), the idea keywords, no price, no images.
 */
export function similarPrefill(listing: WatchListingLite, mkt: ShopMkt, shop: string) {
  return {
    target: mkt,
    source: mkt === 'ebay' ? ('ebay-research' as const) : ('etsy-research' as const),
    title: undefined,
    tags: mkt === 'etsy' ? listing.tags.filter((tag) => tag.length <= 20).slice(0, 13) : [],
    keywords: [ideaQuery(listing.title), ...contentWords(listing.title).slice(0, 12)],
    research: { from: 'research-hub', tool: 'shops', shop, basedOn: { id: listing.id, url: listing.url } },
  };
}

/** Year the shop opened ("since 2021"), or null. */
export function sinceYear(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.getUTCFullYear() : null;
}
