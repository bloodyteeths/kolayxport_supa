// lib/research/etsySearch.ts — Etsy public search for the research hub (research.md §5, §10; RR §4.3–§4.4, §6).
//
// One function (`searchEtsy`) replaces the body of `search_market` in pages/api/clawd/etsy.ts: R1-B makes
// the clawd action call it and map with `toLegacySearchMarket`, so old callers keep their shape.
//
// Rules:
// - Shared cross-user cache: `ResearchCache` rows with userId '__public__', key `public:etsy:<kind>:<sha1>`,
//   24 h (no migration: ResearchCache.userId has no FK). 50 users researching one phrase cost 3 Etsy calls.
// - Budget circuit breaker at 85 % of the app's daily Etsy quota (RR §4.4): cached-only mode, stale rows are
//   served with their original `fetchedAt` and the caller adds `research.error.budget`.
// - Entities decoded on read; prices only through `summarizePrices` (no mean anywhere); age from
//   `original_creation_timestamp` (never `created_timestamp`, which resets on renewal).
//
// Server-only (Prisma + fetch). The pure aggregation helpers at the bottom are unit-tested without I/O.

import { createHash } from 'crypto';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { etsyFetch, etsyPublicHeaders, ETSY_API_BASE } from '@/lib/etsy/http';
import { EtsyPriority, getBudgetSnapshot } from '@/lib/etsy/rateBudget';
import { normalizeTags } from '@/lib/etsy/seoRules';
import { convertCurrency } from '@/lib/finance/fx';
import { fmtDate, fmtMoney, fmtNum, fmtPercent } from '@/lib/formatCore';
import { buildFxTable, decodeEntities, summarizePrices, MIN_SAMPLE, type FxTable, type PriceSummary } from './stats';
import type { BuyerWord, Confidence, DemandInput, DemandSignal, Evidence, Fact, Guarded, TopListing } from './types';

export const SHARED_CACHE_USER = '__public__';
export const SEARCH_TTL_MS = 24 * 3_600_000;
export const SHOP_TTL_MS = 24 * 3_600_000;
export const DETAILS_TTL_MS = 24 * 3_600_000;
export const SIGNAL_TTL_MS = 24 * 3_600_000;
/** Cached-only mode above this share of the daily Etsy quota (85K of 100K). */
export const BUDGET_BREAKER = 0.85;
export const TOP_N = 48;
export const MAX_SEARCH_LIMIT = 300;
const DAY_MS = 86_400_000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EtsySearchParams {
  q: string;
  /** Buyer market. Etsy's public search has no buyer-country filter; it keys the cache and the FX target. */
  country?: string;
  taxonomyId?: number | null;
  sortOn?: 'score' | 'price' | 'created' | 'updated';
  sortOrder?: 'asc' | 'desc';
  /** ≤ 300 (3 pages of 100). Default 300. */
  limit?: number;
  minPrice?: number | null;
  maxPrice?: number | null;
}

export interface EtsySearchItem {
  listingId: string;
  /** Entity-decoded. */
  title: string;
  /** First 300 chars, decoded (legacy readers only). */
  description: string;
  /** Major units in `currency`; null when Etsy sent no price. */
  price: number | null;
  currency: string;
  /** Lifetime counters. */
  views: number;
  favorites: number;
  tags: string[];
  shopId: string | null;
  taxonomyId: number | null;
  url: string;
  quantity: number;
  /** Seconds. Real creation (age). */
  originalCreatedAt: number | null;
  /** Seconds. Last renew (legacy readers only, never for age). */
  renewedAt: number | null;
  state: string;
  isPersonalizable: boolean | null;
  hasVariations: boolean | null;
}

export interface EtsySearchResult {
  query: string;
  country: string;
  taxonomyId: number | null;
  /** Etsy `count` (supply). */
  total: number;
  items: EtsySearchItem[];
  /** ISO of the live fetch (kept when served from cache). */
  fetchedAt: string;
}

export interface Served<T> {
  data: T;
  fetchedAt: string;
  /** From the shared cache (fresh or stale). */
  cached: boolean;
  /** Past its TTL (served because of the budget breaker or an upstream failure). */
  stale: boolean;
  /** The budget breaker was active. */
  budgetLimited: boolean;
}

export interface EtsyShopInfo {
  shopId: string;
  name: string;
  url: string | null;
  iconUrl: string | null;
  /** Seconds (`create_date`). */
  createdAt: number | null;
  /** Lifetime shop sales counter (`transaction_sold_count`). */
  soldCount: number | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  activeCount: number | null;
  currency: string | null;
}

export interface EtsyListingDetail {
  listingId: string;
  /** null when Etsy did not return images for this call (includes not honored). */
  imageCount: number | null;
  thumbUrl: string | null;
  hasVideo: boolean | null;
  /** Free shipping to the buyer country; null when shipping data is missing. */
  freeShipping: boolean | null;
}

export class ResearchBudgetError extends Error {
  constructor() {
    super('Etsy daily request budget is close: cached results only');
    this.name = 'ResearchBudgetError';
  }
}

export class EtsyUpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'EtsyUpstreamError';
    this.status = status;
  }
}

// ─── Budget + shared cache ──────────────────────────────────────────────────

/** True when research must not make live Etsy calls (RR §4.4 circuit breaker). */
export function etsyBudgetLimited(): boolean {
  try {
    const snap = getBudgetSnapshot();
    return typeof snap.usedFraction === 'number' && snap.usedFraction >= BUDGET_BREAKER;
  } catch {
    return false;
  }
}

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

export function normalizeQuery(q: string): string {
  return decodeEntities(String(q || '')).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function searchCacheKey(q: string, country = 'US', taxonomyId: number | null = null, extra = ''): string {
  return `public:etsy:search:${sha1([normalizeQuery(q), country.toUpperCase(), taxonomyId ?? '', extra].join('|'))}`;
}

interface CachedEnvelope<T> { v: 1; fetchedAt: string; data: T }

export async function readShared<T>(cacheKey: string, userId = SHARED_CACHE_USER): Promise<{ data: T; fetchedAt: string; fresh: boolean } | null> {
  try {
    const row = await prisma.researchCache.findUnique({ where: { userId_cacheKey: { userId, cacheKey } } });
    if (!row) return null;
    const env = row.data as unknown as CachedEnvelope<T> | null;
    if (!env || typeof env !== 'object' || env.v !== 1 || !('data' in env)) return null;
    return { data: env.data, fetchedAt: env.fetchedAt, fresh: row.expiresAt.getTime() > Date.now() };
  } catch (err) {
    logger.warn('[research] cache read failed', { cacheKey, error: (err as Error)?.message });
    return null;
  }
}

export async function writeShared<T>(cacheKey: string, data: T, ttlMs: number, fetchedAt = new Date().toISOString(), userId = SHARED_CACHE_USER): Promise<void> {
  const env: CachedEnvelope<T> = { v: 1, fetchedAt, data };
  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    await prisma.researchCache.upsert({
      where: { userId_cacheKey: { userId, cacheKey } },
      create: { userId, cacheKey, data: env as never, expiresAt },
      update: { data: env as never, expiresAt },
    });
  } catch (err) {
    logger.warn('[research] cache write failed', { cacheKey, error: (err as Error)?.message });
  }
}

/**
 * Cache-first with stale fallback. Fresh row → served. Budget breaker on → stale row or ResearchBudgetError.
 * Otherwise live; a live failure falls back to a stale row, else rethrows.
 */
export async function cachedLive<T>(
  cacheKey: string,
  ttlMs: number,
  live: () => Promise<T>,
  opts: { userId?: string; budgetAware?: boolean; force?: boolean } = {},
): Promise<Served<T>> {
  const userId = opts.userId ?? SHARED_CACHE_USER;
  const hit = await readShared<T>(cacheKey, userId);
  if (hit && hit.fresh && !opts.force) return { data: hit.data, fetchedAt: hit.fetchedAt, cached: true, stale: false, budgetLimited: false };
  const limited = opts.budgetAware !== false && etsyBudgetLimited();
  if (limited) {
    if (hit) return { data: hit.data, fetchedAt: hit.fetchedAt, cached: true, stale: true, budgetLimited: true };
    throw new ResearchBudgetError();
  }
  try {
    const data = await live();
    const fetchedAt = new Date().toISOString();
    await writeShared(cacheKey, data, ttlMs, fetchedAt, userId);
    return { data, fetchedAt, cached: false, stale: false, budgetLimited: false };
  } catch (err) {
    if (isBudgetError(err)) {
      if (hit) return { data: hit.data, fetchedAt: hit.fetchedAt, cached: true, stale: true, budgetLimited: true };
      throw new ResearchBudgetError();
    }
    if (hit) {
      logger.warn('[research] live fetch failed, serving stale cache', { cacheKey, error: (err as Error)?.message });
      return { data: hit.data, fetchedAt: hit.fetchedAt, cached: true, stale: true, budgetLimited: false };
    }
    throw err;
  }
}

/** The rate budget refuses with EtsyDeferError ('budget'); our own breaker throws ResearchBudgetError. */
export function isBudgetError(err: unknown): boolean {
  if (err instanceof ResearchBudgetError) return true;
  const e = err as { name?: string; reason?: string } | null;
  return !!e && (e.name === 'EtsyDeferError' || e.name === 'EtsyRateLimitedError') && (e.reason === 'budget' || e.reason === 'rate_limited');
}

// ─── Live Etsy calls (public API: x-api-key KEY:SECRET) ─────────────────────

export async function etsyPublicGet(path: string): Promise<any> {
  const res = await etsyFetch(`${ETSY_API_BASE}${path}`, { headers: etsyPublicHeaders() }, { priority: EtsyPriority.Interactive });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new EtsyUpstreamError(res.status, `Etsy public API ${res.status}: ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Raw `/listings/active` result → item. Pure. */
export function mapEtsyListing(l: any): EtsySearchItem {
  const divisor = num(l?.price?.divisor) || 100;
  const amount = num(l?.price?.amount);
  return {
    listingId: String(l?.listing_id ?? ''),
    title: decodeEntities(l?.title || ''),
    description: decodeEntities(String(l?.description || '').slice(0, 300)),
    price: amount != null && amount > 0 ? amount / divisor : null,
    currency: String(l?.price?.currency_code || 'USD').toUpperCase(),
    views: num(l?.views) ?? 0,
    favorites: num(l?.num_favorers) ?? 0,
    tags: Array.isArray(l?.tags) ? l.tags.filter((t: unknown) => typeof t === 'string').map((t: string) => decodeEntities(t)) : [],
    shopId: l?.shop_id != null ? String(l.shop_id) : null,
    taxonomyId: num(l?.taxonomy_id),
    url: typeof l?.url === 'string' ? l.url : '',
    quantity: num(l?.quantity) ?? 0,
    originalCreatedAt: num(l?.original_creation_timestamp),
    renewedAt: num(l?.created_timestamp),
    state: typeof l?.state === 'string' ? l.state : 'active',
    isPersonalizable: typeof l?.is_personalizable === 'boolean' ? l.is_personalizable : null,
    hasVariations: typeof l?.has_variations === 'boolean' ? l.has_variations : null,
  };
}

async function fetchEtsySearchLive(p: Required<Pick<EtsySearchParams, 'q'>> & EtsySearchParams): Promise<EtsySearchResult> {
  const limit = Math.max(1, Math.min(p.limit ?? MAX_SEARCH_LIMIT, MAX_SEARCH_LIMIT));
  const pages = Math.ceil(limit / 100);
  const items: EtsySearchItem[] = [];
  let total = 0;
  for (let page = 0; page < pages; page++) {
    const params = new URLSearchParams({
      keywords: p.q,
      limit: String(Math.min(100, limit - page * 100)),
      offset: String(page * 100),
      sort_on: p.sortOn ?? 'score',
      sort_order: p.sortOrder ?? 'desc',
    });
    if (p.taxonomyId) params.set('taxonomy_id', String(p.taxonomyId));
    if (p.minPrice != null) params.set('min_price', String(p.minPrice));
    if (p.maxPrice != null) params.set('max_price', String(p.maxPrice));
    const data = await etsyPublicGet(`/listings/active?${params}`);
    if (page === 0) total = num(data?.count) ?? 0;
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    items.push(...results.map(mapEtsyListing).filter((i) => i.listingId));
    if (results.length < 100) break;
  }
  return {
    query: p.q.trim(),
    country: (p.country || 'US').toUpperCase(),
    taxonomyId: p.taxonomyId ?? null,
    total: Math.max(total, items.length),
    items,
    fetchedAt: new Date().toISOString(),
  };
}

/** Etsy keyword search through the shared cache + budget breaker. Throws ResearchBudgetError / EtsyUpstreamError. */
export async function searchEtsy(params: EtsySearchParams, opts: { force?: boolean } = {}): Promise<Served<EtsySearchResult>> {
  const q = String(params.q || '').trim();
  if (!q) throw new EtsyUpstreamError(400, 'empty query');
  const country = (params.country || 'US').toUpperCase();
  const extra = [params.sortOn ?? 'score', params.sortOrder ?? 'desc', params.limit ?? MAX_SEARCH_LIMIT, params.minPrice ?? '', params.maxPrice ?? ''].join(',');
  const key = searchCacheKey(q, country, params.taxonomyId ?? null, extra === `score,desc,${MAX_SEARCH_LIMIT},,` ? '' : extra);
  return cachedLive(key, SEARCH_TTL_MS, () => fetchEtsySearchLive({ ...params, q, country }), opts);
}

/** Raw `/shops/{id}` → info. Pure. */
export function mapEtsyShop(d: any): EtsyShopInfo {
  return {
    shopId: String(d?.shop_id ?? ''),
    name: decodeEntities(d?.shop_name || ''),
    url: typeof d?.url === 'string' ? d.url : null,
    iconUrl: typeof d?.icon_url_fullxfull === 'string' ? d.icon_url_fullxfull : null,
    createdAt: num(d?.create_date) ?? num(d?.created_timestamp),
    soldCount: num(d?.transaction_sold_count),
    reviewCount: num(d?.review_count),
    reviewAverage: num(d?.review_average),
    activeCount: num(d?.listing_active_count),
    currency: typeof d?.currency_code === 'string' ? d.currency_code : null,
  };
}

/**
 * Public shop info for up to `max` shops (shared cache 24 h each). Shops that are not cached and cannot be
 * fetched (budget, errors, over `maxLive`) are simply missing from the map; callers guard on coverage.
 */
export async function getEtsyShops(shopIds: string[], opts: { maxLive?: number } = {}): Promise<Map<string, EtsyShopInfo>> {
  const ids = Array.from(new Set(shopIds.filter((s) => /^\d{1,20}$/.test(String(s))))).slice(0, TOP_N);
  const out = new Map<string, EtsyShopInfo>();
  const missing: string[] = [];
  await Promise.all(ids.map(async (id) => {
    const hit = await readShared<EtsyShopInfo>(`public:etsy:shop:${id}`);
    if (hit && hit.fresh) out.set(id, hit.data);
    else missing.push(id);
  }));
  if (missing.length === 0 || etsyBudgetLimited()) return out;
  const live = missing.slice(0, Math.max(0, opts.maxLive ?? TOP_N));
  await mapLimit(live, 6, async (id) => {
    try {
      const info = mapEtsyShop(await etsyPublicGet(`/shops/${id}`));
      if (info.shopId) {
        out.set(id, info);
        await writeShared(`public:etsy:shop:${id}`, info, SHOP_TTL_MS);
      }
    } catch (err) {
      if (!isBudgetError(err)) logger.warn('[research] shop fetch failed', { shopId: id, error: (err as Error)?.message });
    }
  });
  return out;
}

/** Raw `/listings/batch?includes=Images,Shipping,Videos` result → detail. Pure. */
export function mapListingDetail(l: any, country = 'US'): EtsyListingDetail {
  const images = Array.isArray(l?.images) ? l.images : null;
  const videos = Array.isArray(l?.videos) ? l.videos : null;
  const dests: any[] = Array.isArray(l?.shipping_profile?.shipping_profile_destinations) ? l.shipping_profile.shipping_profile_destinations : [];
  let freeShipping: boolean | null = null;
  if (dests.length) {
    const c = country.toUpperCase();
    const match = dests.find((d) => String(d?.destination_country_iso || '').toUpperCase() === c)
      ?? dests.find((d) => !d?.destination_country_iso && (d?.destination_region === 'none' || !d?.destination_region))
      ?? null;
    if (match) freeShipping = (num(match?.primary_cost?.amount) ?? 1) === 0;
  }
  const first = images?.[0];
  return {
    listingId: String(l?.listing_id ?? ''),
    imageCount: images ? images.length : null,
    thumbUrl: first ? (first.url_170x135 || first.url_75x75 || first.url_570xN || null) : null,
    hasVideo: videos ? videos.length > 0 : null,
    freeShipping,
  };
}

/** Photos, video and shipping for ≤ 100 listings in ONE Etsy call (shared cache 24 h). */
export async function getEtsyListingDetails(listingIds: string[], country = 'US'): Promise<Served<Record<string, EtsyListingDetail>>> {
  const ids = Array.from(new Set(listingIds.filter((s) => /^\d{1,20}$/.test(String(s))))).slice(0, 100);
  if (ids.length === 0) return { data: {}, fetchedAt: new Date().toISOString(), cached: false, stale: false, budgetLimited: false };
  const key = `public:etsy:details:${sha1([...ids].sort().join(',') + '|' + country.toUpperCase())}`;
  return cachedLive(key, DETAILS_TTL_MS, async () => {
    const data = await etsyPublicGet(`/listings/batch?listing_ids=${ids.join(',')}&includes=Images,Shipping,Videos`);
    const out: Record<string, EtsyListingDetail> = {};
    for (const l of Array.isArray(data?.results) ? data.results : []) {
      const d = mapListingDetail(l, country);
      if (d.listingId) out[d.listingId] = d;
    }
    return out;
  });
}

// ─── Demand inputs (RR §6.2) ────────────────────────────────────────────────

let googleTrends: any = undefined;
function trendsLib(): any {
  if (googleTrends !== undefined) return googleTrends;
  try {
    googleTrends = require('google-trends-api');
  } catch {
    googleTrends = null;
  }
  return googleTrends;
}

/**
 * Google Trends US relative interest, 12-month mean (0–100). Null when the (unofficial) API fails. A failure, a timeout
 * or an empty timeline throws inside `live()`, so nothing is written to the shared cache (a stale value is served if
 * one exists) and one transient miss does not blank the input for every user for 24 h.
 */
export async function fetchTrendsMean(q: string): Promise<number | null> {
  const key = `public:trends:mean:${sha1(normalizeQuery(q))}`;
  try {
    const served = await cachedLive<number | null>(key, SIGNAL_TTL_MS, async () => {
      const lib = trendsLib();
      if (!lib) throw new Error('google-trends-api unavailable');
      const startTime = new Date(Date.now() - 365 * DAY_MS);
      const raw = await Promise.race([
        lib.interestOverTime({ keyword: q, startTime, geo: 'US' }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (!raw) throw new Error('trends timeout');
      const parsed = JSON.parse(raw);
      const values: number[] = (parsed?.default?.timelineData || []).map((d: any) => num(d?.value?.[0])).filter((v: number | null): v is number => v != null);
      if (values.length === 0) throw new Error('trends empty timeline');
      // Mean of a 0–100 relative index (not a price), as RR §6.2 defines the input.
      return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
    }, { budgetAware: false });
    return served.data;
  } catch {
    return null;
  }
}

async function suggestions(url: string, pick: (j: any) => unknown[]): Promise<string[]> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    const text = await res.text();
    const json = JSON.parse(text.replace(/^[^[{]*/, '').replace(/[^\]}]*$/, ''));
    return pick(json).filter((s): s is string => typeof s === 'string').map((s) => s.toLowerCase());
  } catch {
    return [];
  }
}

/** Autocomplete presence: in how many of Google, Amazon, eBay suggestions the phrase (or its prefix) appears (0–3). */
export async function fetchAutocompleteSources(q: string): Promise<number | null> {
  const phrase = normalizeQuery(q);
  if (!phrase) return null;
  const key = `public:autocomplete:sources:${sha1(phrase)}`;
  try {
    const served = await cachedLive<number | null>(key, SIGNAL_TTL_MS, async () => {
      const enc = encodeURIComponent(phrase);
      const [g, a, e] = await Promise.all([
        suggestions(`https://suggestqueries.google.com/complete/search?client=firefox&q=${enc}`, (j) => (Array.isArray(j?.[1]) ? j[1] : [])),
        suggestions(`https://completion.amazon.com/api/2017/suggestions?mid=ATVPDKIKX0DER&alias=aps&prefix=${enc}`, (j) => (Array.isArray(j?.suggestions) ? j.suggestions.map((s: any) => s?.value) : [])),
        suggestions(`https://autosug.ebay.com/autosug?kwd=${enc}&sId=0`, (j) => (Array.isArray(j?.res?.sug) ? j.res.sug : [])),
      ]);
      const lists = [g, a, e];
      // Every list empty = all three lookups failed or returned nothing: throw so no null is cached for 24 h.
      if (lists.every((l) => l.length === 0)) throw new Error('autocomplete unavailable');
      return autocompletePresence(phrase, lists);
    }, { budgetAware: false });
    return served.data;
  } catch {
    return null;
  }
}

// ─── Pure aggregation (unit-tested) ─────────────────────────────────────────

/** Number of suggestion lists where the phrase or its 2-word prefix appears. */
export function autocompletePresence(phrase: string, lists: string[][]): number {
  const p = normalizeQuery(phrase);
  const prefix = p.split(' ').slice(0, 2).join(' ');
  return lists.filter((l) => l.some((s) => s === p || s.startsWith(`${p} `) || s.includes(p) || (prefix.length >= 4 && s.startsWith(prefix)))).length;
}

/** Robust price summary in `currency` (FX-normalized, plausibility-bounded, Tukey-trimmed). */
export async function priceSummaryFor(items: Array<Pick<EtsySearchItem, 'price' | 'currency'>>, currency = 'USD', fx?: FxTable): Promise<PriceSummary> {
  const points = items.map((i) => ({ amount: i.price, currency: i.currency }));
  const table = fx ?? await buildFxTable(points.map((p) => p.currency), currency, convertCurrency).catch(() => ({}));
  return summarizePrices(points, { currency, fx: table });
}

export function buyerWords(items: Array<Pick<EtsySearchItem, 'tags'>>, limit = 30): BuyerWord[] {
  const n = items.length;
  if (n === 0) return [];
  const counts = new Map<string, number>();
  for (const it of items) {
    const seen = new Set<string>();
    for (const t of it.tags) {
      const k = decodeEntities(t).toLowerCase().replace(/\s+/g, ' ').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count, share: Math.round((count / n) * 1000) / 1000 }));
}

/** ≤ 13 tags, ≤ 20 chars, near-duplicates removed (normalizeTags), most used first. */
export function draftTagsFrom(words: BuyerWord[]): string[] {
  return normalizeTags(words.map((w) => w.tag)).tags;
}

const guardOk = (value: number, kind: Guarded<number>['kind'] = 'measured'): Guarded<number> => ({ value, kind, guard: { ok: true } });
const guardNo = (reasonKey: string, reasonParams?: Record<string, string | number>, kind: Guarded<number>['kind'] = 'measured'): Guarded<number> =>
  ({ value: null, kind, guard: { ok: false, reasonKey, ...(reasonParams ? { reasonParams } : {}) } });

/** Share (0–1) of the top listings held by the 5 shops with the most listings in it; one shop's duplicates are collapsed into its count. */
export function top5Share(items: Array<Pick<EtsySearchItem, 'shopId'>>): Guarded<number> {
  const withShop = items.filter((i) => i.shopId);
  if (withShop.length < MIN_SAMPLE) return guardNo('research.guard.insufficient');
  const per = new Map<string, number>();
  for (const i of withShop) per.set(i.shopId as string, (per.get(i.shopId as string) ?? 0) + 1);
  const top = Array.from(per.values()).sort((a, b) => b - a).slice(0, 5).reduce((s, v) => s + v, 0);
  return guardOk(Math.round((top / withShop.length) * 1000) / 1000);
}

/** Share (0–1) of the distinct top-listing shops opened less than 365 days ago (shops without data excluded). */
export function newcomerShare(items: Array<Pick<EtsySearchItem, 'shopId'>>, shops: Map<string, Pick<EtsyShopInfo, 'createdAt'>>, nowMs = Date.now()): Guarded<number> {
  const ids = Array.from(new Set(items.map((i) => i.shopId).filter((s): s is string => !!s)));
  const known = ids.map((id) => shops.get(id)?.createdAt).filter((c): c is number => typeof c === 'number' && c > 0);
  if (known.length < MIN_SAMPLE) return guardNo('research.guard.insufficient');
  const young = known.filter((c) => nowMs - c * 1000 < 365 * DAY_MS).length;
  return guardOk(Math.round((young / known.length) * 1000) / 1000);
}

/** Median favorites per month over listings older than 60 days (lifetime favorites ÷ months since real creation). */
export function engagementPerMonth(items: Array<Pick<EtsySearchItem, 'favorites' | 'originalCreatedAt'>>, nowMs = Date.now()): { value: number | null; n: number } {
  const rates: number[] = [];
  for (const i of items) {
    if (!i.originalCreatedAt) continue;
    const ageDays = (nowMs - i.originalCreatedAt * 1000) / DAY_MS;
    if (ageDays < 60) continue;
    rates.push(i.favorites / (ageDays / 30.44));
  }
  if (rates.length < MIN_SAMPLE) return { value: null, n: rates.length };
  rates.sort((a, b) => a - b);
  const mid = (rates.length - 1) / 2;
  return { value: Math.round(((rates[Math.floor(mid)] + rates[Math.ceil(mid)]) / 2) * 100) / 100, n: rates.length };
}

/**
 * Engagement baseline: v1 uses one global log scale (no per-taxonomy baseline is stored yet):
 * 0 favorites/month → 0, 20+/month → 1.
 */
export const ENGAGEMENT_FULL_SCALE = 20;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** RR §6.2: mean of the available normalized inputs → 1–5 dots (1 + round(mean × 4)); fewer than 2 inputs → no tier. */
export function demandSignal(raw: { trendsMean: number | null; autocompleteSources: number | null; engagement: number | null }): DemandSignal {
  const inputs: DemandInput[] = [
    raw.trendsMean == null
      ? { key: 'googleTrends', value: null, normalized: null, ok: false, reasonKey: 'research.demand.trendsUnavailable' }
      : { key: 'googleTrends', value: raw.trendsMean, normalized: clamp01(raw.trendsMean / 100), ok: true },
    raw.autocompleteSources == null
      ? { key: 'autocomplete', value: null, normalized: null, ok: false, reasonKey: 'research.demand.autocompleteUnavailable' }
      : { key: 'autocomplete', value: raw.autocompleteSources, normalized: clamp01(raw.autocompleteSources / 3), ok: true },
    raw.engagement == null
      ? { key: 'engagement', value: null, normalized: null, ok: false, reasonKey: 'research.demand.engagementUnavailable' }
      : { key: 'engagement', value: raw.engagement, normalized: clamp01(Math.log10(1 + raw.engagement) / Math.log10(1 + ENGAGEMENT_FULL_SCALE)), ok: true },
  ];
  const used = inputs.filter((i) => i.ok && i.normalized != null).map((i) => i.normalized as number);
  if (used.length < 2) return { tier: null, inputs, kind: 'signal' };
  const mean = used.reduce((s, v) => s + v, 0) / used.length;
  // 0 → 1 dot, 1 → 5 dots, evenly spaced.
  const tier = Math.max(1, Math.min(5, 1 + Math.round(mean * 4))) as 1 | 2 | 3 | 4 | 5;
  return { tier, inputs, kind: 'signal' };
}

export function signalDots(tier: number | null): string {
  if (!tier) return '';
  return '●'.repeat(tier) + '○'.repeat(5 - tier);
}

/** Most common taxonomy id of the given listings (the "Draft a listing" category hint). */
export function modeTaxonomy(items: Array<Pick<EtsySearchItem, 'taxonomyId'>>): string | null {
  const c = new Map<number, number>();
  for (const i of items) if (i.taxonomyId) c.set(i.taxonomyId, (c.get(i.taxonomyId) ?? 0) + 1);
  const best = Array.from(c.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best ? String(best[0]) : null;
}

export interface MoneyFormatter { (value: number, currency: string): string }

/** Confidence from n (DS EvidenceSummary). Etsy shares no search volume, so Etsy evidence caps at medium. */
export function confidenceFor(n: number, opts: { capMedium?: boolean } = {}): Confidence {
  const c: Confidence = n >= 100 ? 'high' : n >= 20 ? 'medium' : 'low';
  return opts.capMedium && c === 'high' ? 'medium' : c;
}

/**
 * 2–4 computed facts (i18n keys from research.md §13) + confidence + basis. Facts are only added when their
 * number passed its guard, so the evidence never states a guarded number.
 */
export function buildEvidence(input: {
  price: PriceSummary;
  total: Guarded<number>;
  newcomers: Guarded<number>;
  demand: DemandSignal;
  money: MoneyFormatter;
  percent: (v: number) => string;
  count: (v: number) => string;
  /** No search volume (Etsy, eBay): cap confidence at medium. */
  noVolume: boolean;
  /** Basis fact key (params `{ n }`); default `research.evidence.basisNoVolume` / `research.evidence.basis`. */
  basisKey?: string;
}): Evidence {
  const facts: Fact[] = [];
  const p = input.price;
  if (p.quality === 'ok' && p.median != null && p.p25 != null && p.p75 != null) {
    facts.push({ key: 'research.evidence.priceBand', params: { p25: input.money(p.p25, p.currency), p75: input.money(p.p75, p.currency), median: input.money(p.median, p.currency) } });
  }
  if (input.newcomers.guard.ok && input.newcomers.value != null) {
    facts.push({ key: 'research.evidence.newcomers', params: { pct: input.percent(input.newcomers.value) } });
  }
  if (input.total.guard.ok && input.total.value != null) {
    facts.push({ key: 'research.evidence.competing', params: { count: input.count(input.total.value) } });
  }
  if (input.demand.tier != null) {
    facts.push({ key: 'research.evidence.demand', params: { dots: signalDots(input.demand.tier), inputs: input.demand.inputs.filter((i) => i.ok).length } });
  }
  const confidence = confidenceFor(p.n, { capMedium: input.noVolume });
  const basis: Fact = { key: input.basisKey ?? (input.noVolume ? 'research.evidence.basisNoVolume' : 'research.evidence.basis'), params: { n: p.n } };
  return { facts: facts.slice(0, 4), confidence, basis };
}

/** Top listings for the table (entity-decoded, age from the real creation date). */
export function toTopListings(
  items: EtsySearchItem[],
  shops: Map<string, Pick<EtsyShopInfo, 'name' | 'url'>>,
  details: Record<string, Pick<EtsyListingDetail, 'thumbUrl'>> = {},
  nowMs = Date.now(),
): TopListing[] {
  return items.map((i) => ({
    id: i.listingId,
    title: i.title,
    url: i.url || null,
    thumbUrl: details[i.listingId]?.thumbUrl ?? null,
    price: i.price != null ? { amount: i.price, currency: i.currency } : null,
    favorites: i.favorites,
    ageDays: i.originalCreatedAt ? Math.max(0, Math.floor((nowMs - i.originalCreatedAt * 1000) / DAY_MS)) : null,
    shop: { id: i.shopId, name: i.shopId ? shops.get(i.shopId)?.name ?? null : null, url: i.shopId ? shops.get(i.shopId)?.url ?? null : null },
    tags: i.tags,
  }));
}

// ─── Legacy shape for pages/api/clawd/etsy.ts `search_market` (R1-B) ────────

export interface LegacySearchMarket {
  total: number;
  items: Array<{
    listing_id: string; title: string; description: string; price: number; currency_code: string; views: number;
    num_favorers: number; tags: string[]; shop_id: string | null; taxonomy_id: number | null; url: string; quantity: number;
    image_url: string; created_timestamp: number; original_creation_timestamp: number; state: string;
  }>;
  /** Robust USD summary. `avg` carries the MEDIAN (never a mean) only so old readers keep working, as R0 did. */
  priceStats: (PriceSummary & { count: number; avg: number | null }) | null;
  tagFrequency: Array<{ tag: string; count: number; pct: number }>;
  titleKeywords: Array<{ keyword: string; count: number; pct: number }>;
  shopIds: string[];
}

const TITLE_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be',
  'are', 'was', 'has', 'have', 'do', 'does', 'not', 'no', 'set', '&', '-', '/', '|', '+', 'x', 'her', 'him', 'his', 'she',
  'he', 'they', 'this', 'that', 'these', 'those', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
]);

export function titleKeywords(titles: string[]): Array<{ keyword: string; count: number; pct: number }> {
  const freq = new Map<string, number>();
  for (const t of titles) {
    for (const w of t.toLowerCase().split(/[\s,;:!?()[\]{}"'|/-]+/)) {
      if (w.length > 1 && !TITLE_STOP.has(w) && !/^\d+$/.test(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const total = Math.max(titles.length, 1);
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([keyword, count]) => ({ keyword, count, pct: Math.round((count / total) * 100) }));
}

/** Maps a hub search result to the old `search_market` JSON (`avg` = median, legacy readers only). */
export function toLegacySearchMarket(r: EtsySearchResult, priceUsd: PriceSummary | null): LegacySearchMarket {
  const words = buyerWords(r.items, 100);
  return {
    total: r.total,
    items: r.items.map((i) => ({
      listing_id: i.listingId,
      title: i.title,
      description: i.description,
      price: i.price ?? 0,
      currency_code: i.currency,
      views: i.views,
      num_favorers: i.favorites,
      tags: i.tags,
      shop_id: i.shopId,
      taxonomy_id: i.taxonomyId,
      url: i.url,
      quantity: i.quantity,
      image_url: '',
      created_timestamp: i.renewedAt ?? 0,
      original_creation_timestamp: i.originalCreatedAt ?? 0,
      state: i.state,
    })),
    priceStats: priceUsd && priceUsd.n > 0 ? { ...priceUsd, count: priceUsd.n, avg: priceUsd.median } : null,
    tagFrequency: words.map((w) => ({ tag: w.tag, count: w.count, pct: Math.round(w.share * 100) })),
    titleKeywords: titleKeywords(r.items.map((i) => i.title)),
    shopIds: Array.from(new Set(r.items.map((i) => i.shopId).filter((s): s is string => !!s))).slice(0, 30),
  };
}

// ─── Response helpers shared by pages/api/research/* ────────────────────────

export type ResearchLocale = 'en' | 'tr';

/** UI locale of the request: `?locale=`, then `X-KX-Locale`, then Accept-Language. */
export function requestLocale(req: { query?: Record<string, unknown>; headers?: Record<string, unknown> }): ResearchLocale {
  const pick = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const candidates = [pick(req.query?.locale), pick(req.headers?.['x-kx-locale']), pick(req.headers?.['accept-language'])];
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    const s = c.toLowerCase();
    if (s.startsWith('tr')) return 'tr';
    if (s.startsWith('en')) return 'en';
  }
  return 'en';
}

export interface Formatters {
  money: MoneyFormatter;
  percent: (v: number) => string;
  count: (v: number) => string;
  date: (iso: string) => string;
}

/** Locale formatters for i18n params: lib/format.ts (DS §3.12; never "$" concatenation, RR §6.3 #10). */
export function formattersFor(locale: ResearchLocale): Formatters {
  return {
    money: (value, currency) => fmtMoney(value, currency, { locale, wholeIfIntegral: true, approx: false }),
    percent: (v) => fmtPercent(v, { locale, decimals: 0 }),
    count: (v) => fmtNum(v, { locale, decimals: 0 }),
    date: (iso) => fmtDate(iso.length === 10 ? `${iso}T12:00:00Z` : iso, 'date', { locale, timeZone: 'UTC' }),
  };
}

export function firstParam(v: unknown): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === 'string' && x.trim() ? x.trim() : undefined;
}

export function allParams(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : v == null ? [] : [v];
  return arr.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
}

const userBuckets = new Map<string, { count: number; resetAt: number }>();

/** In-memory per-user limiter (single node). Returns false when the user is over `max` calls per window. */
export function userRateLimit(userId: string, bucket: string, max: number, windowMs = 60_000, nowMs = Date.now()): boolean {
  const key = `${bucket}:${userId}`;
  const e = userBuckets.get(key);
  if (!e || e.resetAt <= nowMs) {
    userBuckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    if (userBuckets.size > 10_000) {
      for (const [k, v] of userBuckets) if (v.resetAt <= nowMs) userBuckets.delete(k);
    }
    return true;
  }
  e.count += 1;
  return e.count <= max;
}

/** Display currency of a buyer country for marketplace prices. */
export function currencyForCountry(country: string): string {
  const c = String(country || 'US').toUpperCase();
  return ({ US: 'USD', GB: 'GBP', DE: 'EUR', FR: 'EUR', NL: 'EUR', IT: 'EUR', ES: 'EUR', CA: 'CAD', AU: 'AUD', TR: 'TRY' } as Record<string, string>)[c] ?? 'USD';
}
