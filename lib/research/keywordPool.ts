// lib/research/keywordPool.ts — Keyword explorer candidate pool + per-keyword metrics (research.md §6, §10; R2-A).
//
// Pool (per seed, shared cache 24 h): the seed itself ∪ the tags the seed's top 48 Etsy listings use ∪ Google /
// eBay / Amazon autocomplete for the seed. No AI expansion in R2 (it would cost the user a credit on every load);
// "Suggest seeds" (POST /api/research/seeds, 1 credit) covers that on demand.
//
// Metrics (per keyword, shared cache 24 h, one Etsy call each): competition = Etsy `count`; Top-48 use = how many of
// the keyword's own top 48 listings carry it as an exact tag; price band = robust p25–p75 of those 48 in the country
// currency; Demand Signal (RR §6.2) from Google Trends + autocomplete presence + favorites/month of the top 48;
// Google Trends monthly profile for the Seasonal view. Metrics resolve a few per request (`resolveBatch`), so the
// UI shows rows as they arrive instead of a blank table for 20 s.
//
// `ResearchKeywordNote` (BR-1b) is read through a guard: until the backend migration is deployed and the Prisma
// client regenerated, `keywordNotesAvailable()` is false and the note endpoint answers `unavailable`.
//
// Server-only. Pure helpers (row building, sort, filters, seasonality) are unit-tested without I/O.

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getApplicationToken } from '@/lib/integrations/ebayClient';
import { callEbayRateLimited } from '@/lib/integrations/ebayRateLimiter';
import { cleanTag, contentWords, tagKey, tagTitleOverlap } from '@/lib/etsy/seoRules';
import {
  buyerWords, cachedLive, demandSignal, engagementPerMonth, fetchAutocompleteSources, isBudgetError, normalizeQuery,
  priceSummaryFor, readShared, searchEtsy, sha1, writeShared, SIGNAL_TTL_MS, TOP_N, type EtsySearchItem,
} from './etsySearch';
import { decodeEntities, type PriceSummary } from './stats';
import type { DemandSignal, Guarded, KeywordView } from './types';
import {
  competitionBandOf, etsyVolumeTier, volumeDisagrees, KEYWORD_SMALL_SAMPLE, LONGTAIL_MAX_COMPETITION, LONGTAIL_MIN_WORDS,
  SEASONAL_MIN_RATIO, SEASONAL_WINDOW_DAYS,
  type KeywordFilters, type KeywordMkt, type KeywordOrigin, type KeywordRowExt,
} from './keywordTypes';

export const POOL_MAX = 40;
export const POOL_TTL_MS = 24 * 3_600_000;
export const METRICS_TTL_MS = 24 * 3_600_000;
/** A keyword whose search failed is not retried for an hour (counts as done, no row). */
export const FAILED_TTL_MS = 3_600_000;
/** Live metric resolutions per request (each = 1 marketplace call + cached signal lookups). */
export const RESOLVE_BATCH = 4;
/** Polls per view before `next` stops being offered (a stuck candidate never loops the UI forever). */
export const MAX_ROUNDS = 20;
const SUGGEST_PER_SOURCE = 10;
const DAY_MS = 86_400_000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PoolCandidate { keyword: string; origin: KeywordOrigin[] }

/** Cached per keyword × marketplace × country. */
export interface KeywordMetrics {
  keyword: string;
  mkt: KeywordMkt;
  country: string;
  /** Marketplace `count` (supply); null when the marketplace has no search here (Amazon). */
  total: number | null;
  /** Top listings fetched (≤ 48). */
  n: number;
  /** How many of them tag the keyword exactly (Etsy); null elsewhere. */
  top48: number | null;
  priceBand: Pick<PriceSummary, 'p25' | 'p75' | 'currency' | 'n'>;
  demand: Pick<DemandSignal, 'tier' | 'inputs'>;
  /** Google Trends US, 12-month monthly means (index 0 = January); null when Trends failed. */
  monthly: number[] | null;
  fetchedAt: string;
}

export interface FailedMetrics { failed: true; fetchedAt: string }

// ─── Pure: candidates, rows, views ─────────────────────────────────────────

/** Keyword cleanup for the pool: Etsy-tag cleaning, 2–60 characters, at least one letter. */
export function cleanCandidate(raw: unknown): string | null {
  const k = cleanTag(decodeEntities(typeof raw === 'string' ? raw : ''));
  if (k.length < 2 || k.length > 60 || !/\p{L}/u.test(k)) return null;
  return k;
}

/** Merge candidate sources in priority order; near-duplicates (tagKey) collapse into the first, origins merged. */
export function mergeCandidates(sources: Array<{ origin: KeywordOrigin; keywords: string[] }>, max = POOL_MAX): PoolCandidate[] {
  const byKey = new Map<string, PoolCandidate>();
  const order: string[] = [];
  for (const src of sources) {
    for (const raw of src.keywords) {
      const k = cleanCandidate(raw);
      if (!k) continue;
      const key = tagKey(k) || k;
      const hit = byKey.get(key);
      if (hit) { if (!hit.origin.includes(src.origin)) hit.origin.push(src.origin); continue; }
      if (order.length >= max) continue;
      byKey.set(key, { keyword: k, origin: [src.origin] });
      order.push(key);
    }
  }
  return order.map((k) => byKey.get(k) as PoolCandidate);
}

/**
 * A listing's own tag as a pool keyword: entities decoded, NFC, lower-cased, single-spaced (punctuation kept, so
 * "mom & dad" stays itself); 2–60 characters with a letter. The same normalizer keys `shopTagIndex` and `inCurrent`.
 */
export function normalizeListingTag(raw: unknown): string | null {
  const k = decodeEntities(typeof raw === 'string' ? raw : '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (k.length < 2 || k.length > 60 || !/\p{L}/u.test(k)) return null;
  return k;
}

/**
 * Adds keywords from one more source to a pool (no cap unless `max`). By default near-duplicates (tagKey) merge
 * their origin into the existing candidate; `exact: true` (the listing's own tags) merges only on the same string,
 * so every current tag keeps its own row ("necklace personalized" never folds into "personalized necklace").
 */
export function appendCandidates(
  pool: PoolCandidate[], origin: KeywordOrigin, keywords: string[], max = Infinity, opts: { exact?: boolean } = {},
): PoolCandidate[] {
  const out = pool.map((c) => ({ keyword: c.keyword, origin: [...c.origin] }));
  const keyOf = (k: string) => (opts.exact ? k : tagKey(k) || k);
  const byKey = new Map(out.map((c) => [keyOf(c.keyword), c]));
  for (const raw of keywords) {
    const k = opts.exact ? normalizeListingTag(raw) : cleanCandidate(raw);
    if (!k) continue;
    const key = keyOf(k);
    const hit = byKey.get(key);
    if (hit) { if (!hit.origin.includes(origin)) hit.origin.push(origin); continue; }
    if (out.length >= max) continue;
    const c: PoolCandidate = { keyword: k, origin: [origin] };
    out.push(c);
    byKey.set(key, c);
  }
  return out;
}

/** Google Trends weekly points → 12 monthly means (null when a month has no data in the year). */
export function monthlyProfile(points: Array<{ time: number; value: number }>): number[] | null {
  const sums = new Array(12).fill(0);
  const counts = new Array(12).fill(0);
  for (const p of points) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.value)) continue;
    const m = new Date(p.time * 1000).getUTCMonth();
    sums[m] += p.value;
    counts[m] += 1;
  }
  if (counts.filter((c) => c > 0).length < 10) return null;
  return sums.map((s, i) => (counts[i] ? Math.round((s / counts[i]) * 10) / 10 : 0));
}

/**
 * Seasonal view rule: the Trends peak month is ≥ 1.4 × the 12-month mean and starts within 90 days (0 = current month).
 * Returns null for non-seasonal keywords.
 */
export function seasonalPeak(monthly: number[] | null, nowMs = Date.now()): { peakMonth: number; inDays: number; ratio: number } | null {
  if (!monthly || monthly.length !== 12) return null;
  const mean = monthly.reduce((s, v) => s + v, 0) / 12;
  if (mean <= 0) return null;
  let peak = 0;
  for (let i = 1; i < 12; i++) if (monthly[i] > monthly[peak]) peak = i;
  const ratio = Math.round((monthly[peak] / mean) * 100) / 100;
  if (ratio < SEASONAL_MIN_RATIO) return null;
  const now = new Date(nowMs);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let inDays: number;
  if (peak === m) inDays = 0;
  else {
    const year = peak > m ? y : y + 1;
    inDays = Math.ceil((Date.UTC(year, peak, 1) - nowMs) / DAY_MS);
  }
  if (inDays > SEASONAL_WINDOW_DAYS) return null;
  return { peakMonth: peak + 1, inDays, ratio };
}

const guardOk = (value: number): Guarded<number> => ({ value, kind: 'measured', guard: { ok: true } });
const guardNo = (reasonKey: string, reasonParams?: Record<string, string | number>, value: number | null = null): Guarded<number> =>
  ({ value, kind: 'measured', guard: { ok: false, reasonKey, ...(reasonParams ? { reasonParams } : {}) } });

export interface RowContext {
  /** Lower-cased tag → own listings using it. */
  shopTags: Map<string, Array<{ id: string; shopId: string; title: string }>>;
  /** With `?listing`. */
  listing?: { title: string; tags: string[] };
  /** keyword → { value, enteredAt } (ResearchKeywordNote). */
  notes: Map<string, { value: number; enteredAt: string }>;
  /** keyword → tracked row for `?listing`. */
  tracked: Map<string, { id: string; rank: { now: number | null; delta7: number | null; best: number | null } }>;
  nowMs?: number;
}

/** Metrics → table row (guards: small sample under 20 top listings, insufficient under 5; eBay/Amazon have no tags). */
export function buildRow(c: PoolCandidate, m: KeywordMetrics, ctx: RowContext): KeywordRowExt {
  const k = c.keyword;
  let top48: Guarded<number>;
  if (m.mkt !== 'etsy') top48 = guardNo(m.mkt === 'ebay' ? 'research.guard.notAvailableEbay' : 'research.kw.amazonNoSearch');
  else if (m.n < 5) top48 = guardNo('research.guard.insufficient');
  else if (m.n < KEYWORD_SMALL_SAMPLE) top48 = guardNo('research.guard.small', { n: m.n }, m.top48);
  else top48 = guardOk(m.top48 ?? 0);
  const competition = m.total == null ? guardNo('research.kw.amazonNoSearch') : guardOk(m.total);
  const own = ctx.shopTags.get(k) ?? [];
  const note = ctx.notes.get(k);
  const tracked = ctx.tracked.get(k);
  const row: KeywordRowExt = {
    keyword: k,
    demand: m.demand,
    competition,
    top48,
    priceBand: m.priceBand,
    inMyShop: own.length,
    length: k.length,
    words: k.split(' ').filter(Boolean).length,
    origin: c.origin,
  };
  if (note) {
    row.etsyVolume = note;
    row.volumeTier = etsyVolumeTier(note.value);
    row.volumeDisagrees = volumeDisagrees(m.demand.tier, note.value);
  }
  if (tracked) { row.rank = tracked.rank; row.trackedId = tracked.id; }
  if (ctx.listing) {
    row.inCurrent = ctx.listing.tags.some((t) => normalizeListingTag(t) === k);
    row.titleOverlap = tagTitleOverlap(k, ctx.listing.title);
  }
  const season = seasonalPeak(m.monthly, ctx.nowMs);
  if (season) row.seasonal = season;
  if (own.length) row.listings = own.slice(0, 20);
  return row;
}

const num = (g: Guarded<number>) => (g.value == null ? null : g.value);
const desc = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : b - a);
const asc = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b);

/** View membership + order (research.md §6.1). `mine` rows come from the shop pool, so only the order differs. */
export function applyView(rows: KeywordRowExt[], view: KeywordView): KeywordRowExt[] {
  const byKeyword = (a: KeywordRowExt, b: KeywordRowExt) => (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0);
  if (view === 'longtail') {
    return rows
      .filter((r) => r.words >= LONGTAIL_MIN_WORDS && r.competition.guard.ok && (num(r.competition) ?? Infinity) < LONGTAIL_MAX_COMPETITION)
      .sort((a, b) => asc(num(a.competition), num(b.competition)) || desc(a.demand.tier, b.demand.tier) || byKeyword(a, b));
  }
  if (view === 'seasonal') {
    return rows.filter((r) => r.seasonal).sort((a, b) => (a.seasonal!.inDays - b.seasonal!.inDays) || (b.seasonal!.ratio - a.seasonal!.ratio) || byKeyword(a, b));
  }
  if (view === 'mine') {
    return [...rows].sort((a, b) => b.inMyShop - a.inMyShop || desc(num(a.top48), num(b.top48)) || byKeyword(a, b));
  }
  // suggested: Top-48 use, then Demand, then lower competition.
  return [...rows].sort((a, b) =>
    desc(a.top48.value ?? null, b.top48.value ?? null) || desc(a.demand.tier, b.demand.tier) || asc(num(a.competition), num(b.competition)) || byKeyword(a, b));
}

export function applyFilters(rows: KeywordRowExt[], f: KeywordFilters): KeywordRowExt[] {
  return rows.filter((r) => {
    if (f.notInTitle && r.titleOverlap && r.titleOverlap.length > 0) return false;
    if (f.maxLen20 && r.length > 20) return false;
    if (f.competition && competitionBandOf(num(r.competition)) !== f.competition) return false;
    if (f.demandMin && (r.demand.tier ?? 0) < f.demandMin) return false;
    return true;
  });
}

/** `f.notInTitle=1&f.maxLen=20&f.competition=lt1k&f.demand=3` (also accepts `f[notInTitle]` objects from Next). */
export function parseKeywordFilters(query: Record<string, unknown>): KeywordFilters {
  const get = (k: string): string | undefined => {
    const v = query[`f.${k}`] ?? (query.f && typeof query.f === 'object' ? (query.f as Record<string, unknown>)[k] : undefined);
    const x = Array.isArray(v) ? v[0] : v;
    return typeof x === 'string' ? x.trim() : undefined;
  };
  const out: KeywordFilters = {};
  const truthy = (v?: string) => v === '1' || v === 'true';
  if (truthy(get('notInTitle'))) out.notInTitle = true;
  const maxLen = get('maxLen');
  if (maxLen === '20' || truthy(get('maxLen20'))) out.maxLen20 = true;
  const comp = get('competition');
  if (comp === 'lt1k' || comp === '1to10k' || comp === 'gt10k') out.competition = comp;
  const d = Number(get('demand'));
  if (Number.isInteger(d) && d >= 1 && d <= 5) out.demandMin = d as KeywordFilters['demandMin'];
  return out;
}

/** Own listings' tags → normalizeListingTag(tag) → listings (most recent first, as given). */
export function shopTagIndex(listings: Array<{ id: string; shopId: string; title: string; tags: string[] }>): RowContext['shopTags'] {
  const idx: RowContext['shopTags'] = new Map();
  for (const l of listings) {
    const seen = new Set<string>();
    for (const t of l.tags) {
      const k = normalizeListingTag(String(t || ''));
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const arr = idx.get(k) ?? [];
      arr.push({ id: l.id, shopId: l.shopId, title: decodeEntities(l.title) });
      idx.set(k, arr);
    }
  }
  return idx;
}

/** "Used in my shop" pool: the user's tags by listing count (ties: alphabetical), ≤ POOL_MAX. */
export function minePool(shopTags: RowContext['shopTags'], max = POOL_MAX): PoolCandidate[] {
  return Array.from(shopTags.entries())
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([keyword]) => ({ keyword, origin: ['shop'] }));
}

/** How many of the listings tag `keyword` exactly (case/space-insensitive). */
export function exactTagUse(items: Array<Pick<EtsySearchItem, 'tags'>>, keyword: string): number {
  const k = keyword.toLowerCase().replace(/\s+/g, ' ').trim();
  return items.filter((i) => i.tags.some((t) => decodeEntities(t).toLowerCase().replace(/\s+/g, ' ').trim() === k)).length;
}

/** Main keyword of a listing title: the lead phrase before the first separator, ≤ 4 content words. */
export function seedFromTitle(title: string): string {
  const lead = decodeEntities(title).split(/[,|–—:;(]/)[0] ?? '';
  const words = contentWords(lead).slice(0, 4);
  return words.join(' ').toLowerCase().trim();
}

// ─── I/O: suggestions, trends, pool, metrics ───────────────────────────────

async function suggestList(url: string, pick: (j: any) => unknown[]): Promise<string[]> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    const text = await res.text();
    const json = JSON.parse(text.replace(/^[^[{]*/, '').replace(/[^\]}]*$/, ''));
    return pick(json).filter((s): s is string => typeof s === 'string').slice(0, SUGGEST_PER_SOURCE);
  } catch {
    return [];
  }
}

/** Google + Amazon + eBay autocomplete for the seed (shared cache 24 h; nothing cached when every source failed). */
export async function fetchSuggestions(seed: string): Promise<string[]> {
  const phrase = normalizeQuery(seed);
  if (!phrase) return [];
  try {
    const served = await cachedLive<string[]>(`public:autocomplete:list:${sha1(phrase)}`, SIGNAL_TTL_MS, async () => {
      const enc = encodeURIComponent(phrase);
      const lists = await Promise.all([
        suggestList(`https://suggestqueries.google.com/complete/search?client=firefox&q=${enc}`, (j) => (Array.isArray(j?.[1]) ? j[1] : [])),
        suggestList(`https://completion.amazon.com/api/2017/suggestions?mid=ATVPDKIKX0DER&alias=aps&prefix=${enc}`, (j) => (Array.isArray(j?.suggestions) ? j.suggestions.map((s: any) => s?.value) : [])),
        suggestList(`https://autosug.ebay.com/autosug?kwd=${enc}&sId=0`, (j) => (Array.isArray(j?.res?.sug) ? j.res.sug : [])),
      ]);
      if (lists.every((l) => l.length === 0)) throw new Error('autocomplete unavailable');
      // Interleave so one source cannot fill the pool.
      const out: string[] = [];
      for (let i = 0; i < SUGGEST_PER_SOURCE; i++) for (const l of lists) if (l[i]) out.push(l[i].toLowerCase());
      return out;
    }, { budgetAware: false });
    return served.data;
  } catch {
    return [];
  }
}

let trendsMod: any = undefined;
function trendsLib(): any {
  if (trendsMod !== undefined) return trendsMod;
  try { trendsMod = require('google-trends-api'); } catch { trendsMod = null; }
  return trendsMod;
}

/** Google Trends US, 12 months: overall mean (Demand input) + monthly profile (Seasonal). Null pair on failure. */
export async function fetchTrendsProfile(q: string): Promise<{ mean: number | null; monthly: number[] | null }> {
  try {
    const served = await cachedLive<{ mean: number; monthly: number[] | null }>(`public:trends:monthly:${sha1(normalizeQuery(q))}`, SIGNAL_TTL_MS, async () => {
      const lib = trendsLib();
      if (!lib) throw new Error('google-trends-api unavailable');
      const raw = await Promise.race([
        lib.interestOverTime({ keyword: q, startTime: new Date(Date.now() - 365 * DAY_MS), geo: 'US' }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
      ]);
      if (!raw) throw new Error('trends timeout');
      const parsed = JSON.parse(raw);
      const points = (parsed?.default?.timelineData || [])
        .map((d: any) => ({ time: Number(d?.time), value: Number(d?.value?.[0]) }))
        .filter((p: { time: number; value: number }) => Number.isFinite(p.time) && Number.isFinite(p.value));
      if (points.length === 0) throw new Error('trends empty timeline');
      // Mean of a 0–100 relative index (not a price), as RR §6.2 defines the input.
      const mean = Math.round(points.reduce((s: number, p: { value: number }) => s + p.value, 0) / points.length);
      return { mean, monthly: monthlyProfile(points) };
    }, { budgetAware: false });
    return served.data;
  } catch {
    return { mean: null, monthly: null };
  }
}

export function poolCacheKey(mkt: KeywordMkt, seed: string, country: string): string {
  return `public:${mkt}:kwpool:${sha1([normalizeQuery(seed), country.toUpperCase()].join('|'))}`;
}

export function metricsCacheKey(mkt: KeywordMkt, keyword: string, country: string): string {
  return `public:${mkt}:kwmetrics:${sha1([normalizeQuery(keyword), country.toUpperCase()].join('|'))}`;
}

/**
 * Seed pool (shared 24 h): Etsy = seed ∪ top-48 tags ∪ autocomplete; eBay / Amazon = seed ∪ autocomplete.
 * Throws ResearchBudgetError when the Etsy search is needed and the breaker is on with nothing cached.
 */
export async function buildSeedPool(mkt: KeywordMkt, seed: string, country: string): Promise<{ pool: PoolCandidate[]; fetchedAt: string; stale: boolean; budgetLimited: boolean }> {
  const served = await cachedLive<PoolCandidate[]>(poolCacheKey(mkt, seed, country), POOL_TTL_MS, async () => {
    const [tags, suggestions] = await Promise.all([
      mkt === 'etsy'
        ? searchEtsy({ q: seed, country }).then((s) => buyerWords(s.data.items.slice(0, TOP_N), 30).map((w) => w.tag))
        : Promise.resolve([] as string[]),
      fetchSuggestions(seed),
    ]);
    return mergeCandidates([
      { origin: 'seed', keywords: [seed] },
      { origin: 'tags', keywords: tags },
      { origin: 'autocomplete', keywords: suggestions },
    ]);
  }, { budgetAware: mkt === 'etsy' });
  return { pool: served.data, fetchedAt: served.fetchedAt, stale: served.stale, budgetLimited: served.budgetLimited };
}

const EBAY_MARKETPLACE: Record<string, string> = { US: 'EBAY_US', GB: 'EBAY_GB', DE: 'EBAY_DE', CA: 'EBAY_CA', AU: 'EBAY_AU' };
let ebayToken: { token: string; exp: number } | null = null;
async function ebayAppToken(): Promise<string> {
  if (ebayToken && ebayToken.exp > Date.now()) return ebayToken.token;
  const token = await getApplicationToken();
  ebayToken = { token, exp: Date.now() + 90 * 60_000 };
  return token;
}

/** One live metrics computation (1 marketplace call + cached Trends/autocomplete). */
async function computeMetrics(mkt: KeywordMkt, keyword: string, country: string, currency: string): Promise<KeywordMetrics> {
  const signals = Promise.all([fetchTrendsProfile(keyword), fetchAutocompleteSources(keyword)]);
  let total: number | null = null;
  let top48: number | null = null;
  let priceItems: Array<{ price: number | null; currency: string }> = [];
  let engagement: number | null = null;
  let n = 0;
  if (mkt === 'etsy') {
    const s = await searchEtsy({ q: keyword, country, limit: TOP_N });
    const items = s.data.items.slice(0, TOP_N);
    total = s.data.total;
    n = items.length;
    top48 = exactTagUse(items, keyword);
    priceItems = items;
    engagement = engagementPerMonth(items).value;
  } else if (mkt === 'ebay') {
    const marketplaceId = EBAY_MARKETPLACE[country] ?? 'EBAY_US';
    const token = await ebayAppToken();
    const params = new URLSearchParams({ q: keyword, limit: String(TOP_N), filter: 'buyingOptions:{FIXED_PRICE}' });
    const data = await callEbayRateLimited<any>(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, { token, marketplaceId });
    const items: any[] = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
    total = Math.max(Number(data?.total) || 0, items.length);
    n = items.length;
    priceItems = items.map((i) => {
      const v = Number(i?.price?.value);
      return { price: Number.isFinite(v) && v > 0 ? v : null, currency: String(i?.price?.currency || 'USD').toUpperCase() };
    });
  }
  const [trends, autocompleteSources] = await signals;
  const price = await priceSummaryFor(priceItems, currency);
  const demand = demandSignal({ trendsMean: trends.mean, autocompleteSources, engagement });
  return {
    keyword,
    mkt,
    country,
    total,
    n,
    top48,
    priceBand: { p25: price.p25, p75: price.p75, currency: price.currency, n: price.n },
    demand: { tier: demand.tier, inputs: demand.inputs },
    monthly: trends.monthly,
    fetchedAt: new Date().toISOString(),
  };
}

export interface ResolveResult {
  metrics: Map<string, KeywordMetrics>;
  /** Keywords whose metrics failed recently (counted as done, no row). */
  failed: Set<string>;
  /** Keywords still unresolved after this round. */
  pending: string[];
  budgetLimited: boolean;
}

/**
 * Reads every candidate's cached metrics (fresh or stale) and computes up to `batch` missing/expired ones live.
 * The budget breaker stops live work (stale rows still count as resolved).
 */
export async function resolveBatch(
  mkt: KeywordMkt,
  candidates: PoolCandidate[],
  country: string,
  currency: string,
  opts: { batch?: number; budgetLimited?: () => boolean; compute?: typeof computeMetrics } = {},
): Promise<ResolveResult> {
  const batch = opts.batch ?? RESOLVE_BATCH;
  const compute = opts.compute ?? computeMetrics;
  const metrics = new Map<string, KeywordMetrics>();
  const failed = new Set<string>();
  const todo: Array<{ keyword: string; stale?: KeywordMetrics }> = [];
  const hits = await Promise.all(candidates.map((c) => readShared<KeywordMetrics | FailedMetrics>(metricsCacheKey(mkt, c.keyword, country))));
  candidates.forEach((c, i) => {
    const hit = hits[i];
    if (!hit) { todo.push({ keyword: c.keyword }); return; }
    const d = hit.data;
    if (!d || typeof d !== 'object' || 'failed' in d) {
      if (hit.fresh && d && 'failed' in d) failed.add(c.keyword); else todo.push({ keyword: c.keyword });
      return;
    }
    if (hit.fresh) metrics.set(c.keyword, d);
    else todo.push({ keyword: c.keyword, stale: d });
  });

  let budgetLimited = false;
  const refreshed = new Set<string>();
  const live = todo.slice(0, batch);
  const limited = opts.budgetLimited ?? (() => false);
  if (live.length && limited()) budgetLimited = true;
  else {
    await Promise.all(live.map(async ({ keyword, stale }) => {
      try {
        const m = await compute(mkt, keyword, country, currency);
        metrics.set(keyword, m);
        refreshed.add(keyword);
        await writeShared(metricsCacheKey(mkt, keyword, country), m, METRICS_TTL_MS, m.fetchedAt);
      } catch (err) {
        if (isBudgetError(err)) { budgetLimited = true; return; }
        logger.warn('[research/keywords] metrics failed', { mkt, keyword, error: (err as Error)?.message });
        if (stale) { refreshed.add(keyword); return; } // keep the stale row; retry after its TTL, not every poll
        failed.add(keyword);
        await writeShared(metricsCacheKey(mkt, keyword, country), { failed: true, fetchedAt: new Date().toISOString() } satisfies FailedMetrics, FAILED_TTL_MS);
      }
    }));
  }
  // Stale rows still show (with their original fetchedAt) while they wait for a refresh round. Under the budget
  // breaker no refresh will come, so a stale row counts as done; a keyword with nothing cached stays pending.
  const pending: string[] = [];
  for (const t of todo) {
    if (refreshed.has(t.keyword) && metrics.has(t.keyword)) continue;
    if (failed.has(t.keyword)) continue;
    if (t.stale) metrics.set(t.keyword, t.stale);
    if (refreshed.has(t.keyword)) continue;
    if (!t.stale || !budgetLimited) pending.push(t.keyword);
  }
  return { metrics, failed, pending, budgetLimited };
}

// ─── ResearchKeywordNote (BR-1b) guard ─────────────────────────────────────

type NoteDelegate = {
  findMany(args: unknown): Promise<Array<{ keyword: string; etsySearches30d: number; enteredAt: Date }>>;
  upsert(args: unknown): Promise<{ keyword: string; etsySearches30d: number; enteredAt: Date }>;
  deleteMany(args: unknown): Promise<{ count: number }>;
};

/** The Prisma delegate when the generated client has the model; null until BR-1b is generated. */
export function keywordNoteDelegate(): NoteDelegate | null {
  const d = (prisma as unknown as Record<string, unknown>).researchKeywordNote as NoteDelegate | undefined;
  return d && typeof d.findMany === 'function' && typeof d.upsert === 'function' ? d : null;
}

/** Missing table/column (client generated before the migration ran on this DB). */
export function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'P2021' || code === 'P2022';
}

export function keywordNotesAvailable(): boolean {
  return keywordNoteDelegate() !== null;
}

/** keyword → note for the user. Empty map (never throws) when the model or table is missing. */
export async function readKeywordNotes(userId: string, keywords: string[]): Promise<Map<string, { value: number; enteredAt: string }>> {
  const out = new Map<string, { value: number; enteredAt: string }>();
  const d = keywordNoteDelegate();
  if (!d || keywords.length === 0) return out;
  try {
    const rows = await d.findMany({ where: { userId, keyword: { in: keywords } }, select: { keyword: true, etsySearches30d: true, enteredAt: true } });
    for (const r of rows) out.set(r.keyword, { value: r.etsySearches30d, enteredAt: r.enteredAt.toISOString() });
  } catch (err) {
    if (!isMissingTableError(err)) logger.warn('[research/keywords] note read failed', { error: (err as Error)?.message });
  }
  return out;
}
