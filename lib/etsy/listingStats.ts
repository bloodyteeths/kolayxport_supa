/**
 * Public Etsy listing stats for the Chrome extension overlay.
 *
 * Design rule: never present a guess as a fact. Every sales number carries
 *   - kind:        'measured'  -> derived from a real delta of Etsy's shop
 *                                 transaction_sold_count between two snapshots
 *                  'estimated' -> derived from this shop's own sales-per-review
 *                                 ratio x this listing's recent review velocity
 *                  'insufficient' -> we do not have enough data; no number shown
 *   - confidence:  high | medium | low
 *   - inputs:      the raw numbers that went into the formula, so the UI can show
 *                  "Shop sold +37 in 6.0 days; this listing has 41% of recent reviews".
 *
 * Snapshots (EtsyPublicListingSnapshot) are written on every view (throttled per
 * listing). Velocity math only ever uses Etsy API values, never page-scraped values,
 * because the page values come from the client and could be forged.
 */
import prisma from '@/lib/prisma';
import { etsyFetch } from './http';
import { moneyToNumber } from './searchSummary';
import { groupMedian } from '@/lib/research/stats';
import { ETSY_OPENAPI_BASE } from '@/lib/etsy/apiBase';

const ETSY_BASE = ETSY_OPENAPI_BASE;
const DAY_MS = 24 * 3600 * 1000;

/** How recent reviews must be to count toward "recent" velocity/share. */
export const REVIEW_WINDOW_DAYS = 90;
/** Do not write more than one snapshot per listing per this interval. */
const SNAPSHOT_MIN_INTERVAL_MS = 60 * 60 * 1000;
/** Minimum time between two shop snapshots before a delta counts as "measured". */
const MIN_MEASURE_SPAN_DAYS = 1;
/** Preferred look-back for the baseline snapshot. */
const MEASURE_LOOKBACK_DAYS = 30;
/** Hard cap: older baselines are too stale to be meaningful. */
const MEASURE_MAX_LOOKBACK_DAYS = 180;

/** In-process cache of the Etsy API bundle (saves QPD when many users view one listing). */
const API_CACHE_TTL_MS = 10 * 60 * 1000;
const apiCache = new Map<string, { at: number; bundle: EtsyBundle }>();

type Confidence = 'high' | 'medium' | 'low';

export interface PageSignals {
  boughtLast24h?: number | null;
  inCarts?: number | null;
  inCartsPlus?: boolean | null;
  shopSalesOnPage?: number | null;
  itemReviewsOnPage?: number | null;
  isBestseller?: boolean | null;
  isStarSeller?: boolean | null;
  onlyLeft?: number | null;
  pagePrice?: number | null;
  pageCurrency?: string | null;
  /**
   * Shop id read from the listing page (untrusted). Only used to start the shop fetch in
   * parallel with the listing call; the listing's own shop_id is authoritative and a wrong
   * hint just costs the speculative fetch.
   */
  shopIdHint?: string | null;
}

/**
 * Per-request bookkeeping: Etsy calls actually made (for the research budget) and
 * phase timings in ms since the request started (profiling; logged by tests).
 */
export interface StatsMeta {
  apiCalls?: number;
  timings?: Record<string, number>;
}

function metaCall(meta: StatsMeta | undefined, n = 1) {
  if (meta) meta.apiCalls = (meta.apiCalls ?? 0) + n;
}

function metaMark(meta: StatsMeta | undefined, t0: number, label: string) {
  if (meta) (meta.timings ??= {})[label] = Date.now() - t0;
}

interface EtsyBundle {
  listing: any;
  listingReviews: { count: number; timestamps: number[] } | null;
  shop: any | null;
  shopReviews: { count: number; items: Array<{ listingId: string; ts: number }> } | null;
  imageCount: number;
  fetchedAt: number;
}

function etsyKey(): string {
  const apiKey = (process.env.ETSY_API_KEY || '').trim().replace(/^"|"$/g, '');
  const apiSecret = (process.env.ETSY_API_SECRET || '').trim().replace(/^"|"$/g, '');
  return `${apiKey}:${apiSecret}`;
}

export class EtsyPublicApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function etsyGet(path: string): Promise<any> {
  // Through etsyFetch for the shared rate budget; priority from the caller's
  // context (Interactive by default); no retries (unchanged behaviour).
  const res = await etsyFetch(`${ETSY_BASE}${path}`, { headers: { 'x-api-key': etsyKey() } }, { retries: 0 });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new EtsyPublicApiError(res.status, `Etsy API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function etsyGetSafe(path: string): Promise<any | null> {
  try {
    return await etsyGet(path);
  } catch {
    return null;
  }
}

function tsOf(r: any): number {
  return Number(r?.created_timestamp ?? r?.create_timestamp ?? 0) * 1000;
}

function num(v: any): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

interface ShopBundle {
  shop: any | null;
  shopReviews: { count: number; items: Array<{ listingId: string; ts: number }> } | null;
  fetchedAt: number;
}
/** Shop data is shared by every listing of the shop — cached separately (2 Etsy calls per shop). */
const shopCache = new Map<string, ShopBundle>();
const SHOP_CACHE_MAX_AGE_MS = 6 * 3600 * 1000;

function peekShopBundle(shopId: string, maxAgeMs: number): ShopBundle | null {
  const c = shopCache.get(shopId);
  return c && Date.now() - c.fetchedAt < maxAgeMs ? c : null;
}

/** In-flight shop fetches: concurrent requests for one shop share the 2 Etsy calls. */
const shopInflight = new Map<string, Promise<ShopBundle>>();

async function fetchShopBundle(shopId: string, maxAgeMs: number, meta?: StatsMeta): Promise<ShopBundle> {
  const cached = peekShopBundle(shopId, maxAgeMs);
  if (cached) return cached;
  const inflight = shopInflight.get(shopId);
  if (inflight) return inflight;
  metaCall(meta, 2);
  const p = loadShopBundle(shopId).finally(() => shopInflight.delete(shopId));
  shopInflight.set(shopId, p);
  return p;
}

async function loadShopBundle(shopId: string): Promise<ShopBundle> {
  const [shop, shopReviewsRaw] = await Promise.all([
    etsyGetSafe(`/shops/${shopId}`),
    etsyGetSafe(`/shops/${shopId}/reviews?limit=100`),
  ]);
  const bundle: ShopBundle = {
    shop,
    shopReviews: shopReviewsRaw
      ? {
          count: Number(shopReviewsRaw.count ?? 0) || 0,
          items: (shopReviewsRaw.results || [])
            .map((r: any) => ({ listingId: String(r.listing_id ?? ''), ts: tsOf(r) }))
            .filter((r: { ts: number }) => r.ts > 0),
        }
      : null,
    fetchedAt: Date.now(),
  };
  // Don't pin a failed fetch for hours.
  if (shop) {
    shopCache.set(shopId, bundle);
    if (shopCache.size > 5000) {
      const entries = [...shopCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
      for (const [k] of entries.slice(0, 1000)) shopCache.delete(k);
    }
  }
  return bundle;
}

/**
 * The shop's recent-review window: the last 90 days, or — when the 100 fetched
 * reviews don't reach back that far (busy shop) — only the period they cover, so
 * numerator and denominator always describe the same time span.
 */
function shopReviewWindow(sr: ShopBundle['shopReviews'], now: number) {
  if (!sr || sr.items.length === 0) return null;
  const oldest = Math.min(...sr.items.map(i => i.ts));
  const fetchedAll = sr.items.length >= sr.count;
  const windowStart = fetchedAll ? now - REVIEW_WINDOW_DAYS * DAY_MS : Math.max(oldest, now - REVIEW_WINDOW_DAYS * DAY_MS);
  const inWindow = sr.items.filter(i => i.ts >= windowStart);
  return { windowStart, windowDays: Math.max(1, (now - windowStart) / DAY_MS), inWindow };
}

/** This shop's real sales-per-review ratio (replaces the old universal "reviews x 8"). */
function salesPerReviewOf(shopSold: number | null, shopReviewCount: number | null): number | null {
  return shopSold !== null && shopReviewCount !== null && shopReviewCount >= 10 && shopSold >= shopReviewCount
    ? shopSold / shopReviewCount
    : null;
}

/**
 * The bare listing (GET /listings/:id), shared by the panel's fast "core" request and the full
 * stats: cached in-process for API_CACHE_TTL_MS and de-duplicated while in flight, so the two
 * requests of one page view make one Etsy call.
 */
const listingCache = new Map<string, { at: number; promise: Promise<any> }>();

function fetchListing(listingId: string, meta?: StatsMeta): Promise<any> {
  const c = listingCache.get(listingId);
  if (c && Date.now() - c.at < API_CACHE_TTL_MS) return c.promise;
  metaCall(meta);
  const promise = etsyGet(`/listings/${listingId}`);
  listingCache.set(listingId, { at: Date.now(), promise });
  promise.catch(() => { if (listingCache.get(listingId)?.promise === promise) listingCache.delete(listingId); });
  if (listingCache.size > 2000) {
    const entries = [...listingCache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of entries.slice(0, 500)) listingCache.delete(k);
  }
  return promise;
}

/** Test hook: forget the in-process Etsy caches. */
export function __clearListingCaches() {
  apiCache.clear();
  listingCache.clear();
  shopCache.clear();
}

const validShopId = (v: unknown): string | null => (v !== null && v !== undefined && /^\d{1,15}$/.test(String(v)) ? String(v) : null);

/**
 * All Etsy calls of the listing panel in ONE parallel round: listing, listing reviews, images
 * and — when the page told us the shop id — shop + shop reviews. Without a (correct) hint the
 * shop calls start as soon as the listing answers (the only dependency).
 */
async function fetchBundle(listingId: string, opts: { shopIdHint?: string | null; meta?: StatsMeta; t0?: number } = {}): Promise<EtsyBundle> {
  const cached = apiCache.get(listingId);
  if (cached && Date.now() - cached.at < API_CACHE_TTL_MS) return cached.bundle;
  const { meta } = opts;
  const t0 = opts.t0 ?? Date.now();
  const timed = <T>(label: string, p: Promise<T>) => p.finally(() => metaMark(meta, t0, label));

  const listingP = timed('etsy_listing', fetchListing(listingId, meta));
  metaCall(meta, 2);
  const reviewsP = timed('etsy_listing_reviews', etsyGetSafe(`/listings/${listingId}/reviews?limit=100`));
  const imagesP = timed('etsy_images', etsyGetSafe(`/listings/${listingId}/images`));
  const hint = validShopId(opts.shopIdHint);
  const speculativeShopP = hint ? timed('etsy_shop', fetchShopBundle(hint, API_CACHE_TTL_MS, meta)) : null;

  const listing = await listingP;
  const shopId = validShopId(listing?.shop_id);
  const shopP = !shopId ? Promise.resolve(null)
    : shopId === hint && speculativeShopP ? speculativeShopP
    : timed('etsy_shop', fetchShopBundle(shopId, API_CACHE_TTL_MS, meta));
  const [listingReviewsRaw, images, shopBundle] = await Promise.all([reviewsP, imagesP, shopP]);

  const bundle: EtsyBundle = {
    listing,
    listingReviews: listingReviewsRaw
      ? {
          count: Number(listingReviewsRaw.count ?? (listingReviewsRaw.results || []).length) || 0,
          timestamps: (listingReviewsRaw.results || []).map(tsOf).filter((t: number) => t > 0),
        }
      : null,
    shop: shopBundle?.shop ?? null,
    shopReviews: shopBundle?.shopReviews ?? null,
    imageCount: images?.results?.length ?? images?.count ?? 0,
    fetchedAt: Date.now(),
  };

  apiCache.set(listingId, { at: Date.now(), bundle });
  if (apiCache.size > 2000) {
    // crude eviction: drop the oldest quarter
    const entries = [...apiCache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of entries.slice(0, 500)) apiCache.delete(k);
  }
  return bundle;
}

/** Clamp + validate page signals sent by the extension (untrusted input). */
export function sanitizePageSignals(raw: any): PageSignals {
  if (!raw || typeof raw !== 'object') return {};
  const hint = raw.shopIdHint;
  const int = (v: any, max: number) => {
    const n = num(v);
    return n !== null && n >= 0 && n <= max ? Math.round(n) : null;
  };
  const bool = (v: any) => (typeof v === 'boolean' ? v : null);
  const cur = typeof raw.pageCurrency === 'string' && /^[A-Z]{3}$/.test(raw.pageCurrency) ? raw.pageCurrency : null;
  const price = num(raw.pagePrice);
  return {
    boughtLast24h: int(raw.boughtLast24h, 100000),
    inCarts: int(raw.inCarts, 100000),
    inCartsPlus: bool(raw.inCartsPlus),
    shopSalesOnPage: int(raw.shopSalesOnPage, 100000000),
    itemReviewsOnPage: int(raw.itemReviewsOnPage, 10000000),
    isBestseller: bool(raw.isBestseller),
    isStarSeller: bool(raw.isStarSeller),
    onlyLeft: int(raw.onlyLeft, 100000),
    pagePrice: price !== null && price >= 0 && price < 1e7 ? price : null,
    pageCurrency: cur,
    shopIdHint: (typeof hint === 'string' || typeof hint === 'number') && /^\d{1,15}$/.test(String(hint)) ? String(hint) : null,
  };
}

function round(n: number, digits = 1): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

/**
 * The monthly-sales figure exactly as the extension displays it
 * (formatSales: >= 10 -> whole number, otherwise one decimal).
 */
export function shownMonthlySales(monthly: number): number {
  return monthly >= 10 ? Math.round(monthly) : Math.round(monthly * 10) / 10;
}

/**
 * Revenue = displayed sales x unit price, so the two numbers on screen multiply out.
 * Returns null when either side is unknown.
 */
export function revenueFor(monthly: number | null | undefined, price: number | null | undefined): number | null {
  if (monthly == null || price == null || !Number.isFinite(monthly) || !Number.isFinite(price) || price <= 0) return null;
  return Math.round(shownMonthlySales(monthly) * price);
}

/**
 * Unit price for revenue on the listing page. The price the shopper sees on the page
 * (sale price, in the page currency) wins over the API price, which is the pre-discount
 * LIST price (Etsy's public API does not expose sales). Page price needs a currency.
 */
export function pickRevenuePrice(
  page: Pick<PageSignals, 'pagePrice' | 'pageCurrency'>,
  apiPrice: number | null,
  apiCurrency: string | null,
): { price: number | null; currency: string | null; source: 'page' | 'list_price' | 'none' } {
  if (page.pagePrice != null && page.pagePrice > 0 && page.pageCurrency) {
    return { price: page.pagePrice, currency: page.pageCurrency, source: 'page' };
  }
  if (apiPrice != null && apiPrice > 0) return { price: apiPrice, currency: apiCurrency, source: 'list_price' };
  return { price: null, currency: apiCurrency, source: 'none' };
}

function seoScore(listing: any, imageCount: number) {
  const titleLen = (listing.title || '').length;
  const tagCount = (listing.tags || []).length;
  const descLen = (listing.description || '').length;
  const title = titleLen >= 100 ? 25 : titleLen >= 60 ? 18 : titleLen >= 30 ? 12 : 5;
  const tags = tagCount >= 13 ? 25 : tagCount >= 10 ? 20 : tagCount >= 5 ? 12 : 5;
  const description = descLen >= 300 ? 25 : descLen >= 100 ? 18 : descLen > 0 ? 10 : 0;
  const images = imageCount >= 8 ? 25 : imageCount >= 5 ? 20 : imageCount >= 3 ? 15 : 5;
  return { total: title + tags + description + images, title, tags, description, images };
}

export interface ListingStatsResult {
  listingId: string;
  fetchedAt: string;
  listing: {
    title: string;
    state: string | null;
    /** Etsy API list price (before any seller sale). */
    price: number | null;
    currency: string | null;
    favorites: number | null;
    views: number | null;
    /** Seller-set available quantity — often a placeholder (e.g. 999), not real stock. */
    quantity: number | null;
    tags: string[];
    tagCount: number;
    imageCount: number;
    reviewCount: number | null;
    createdAt: string | null;
    ageDays: number | null;
  };
  shop: {
    shopId: string;
    shopName: string | null;
    soldCount: number | null;
    reviewCount: number | null;
    rating: number | null;
    createdAt: string | null;
    ageYears: number | null;
    salesPerReview: number | null;
  } | null;
  pageSignals: PageSignals;
  reviewShare: {
    windowDays: number;
    listingReviews: number;
    shopReviews: number;
    share: number | null;
    source: 'recent_reviews' | 'lifetime_reviews' | 'none';
  };
  shopVelocity: {
    kind: 'measured' | 'none';
    soldPerDay: number | null;
    delta: number | null;
    spanDays: number | null;
    baselineAt: string | null;
  };
  listingDeltas: {
    spanDays: number;
    favorites: number | null;
    reviews: number | null;
    baselineAt: string;
  } | null;
  sales: {
    kind: 'measured' | 'estimated' | 'insufficient';
    method: 'shop_delta_x_review_share' | 'review_velocity_x_shop_ratio' | 'none';
    confidence: Confidence | null;
    monthlySales: number | null;
    /** When kind=estimated but there were no recent reviews: upper bound only. */
    monthlySalesUpperBound: number | null;
    /** = shownMonthlySales(monthlySales) x priceUsed. */
    monthlyRevenue: number | null;
    currency: string | null;
    /** Unit price behind monthlyRevenue. */
    priceUsed: number | null;
    /** 'page' = price displayed on etsy.com (sale price); 'list_price' = Etsy API pre-discount price. */
    priceSource: 'page' | 'list_price' | 'none';
    inputs: Record<string, number | string | null>;
  };
  tracking: {
    snapshotCount: number;
    firstSnapshotAt: string | null;
    /** True when we wrote a snapshot on this request. */
    recorded: boolean;
  };
  seoScore: ReturnType<typeof seoScore>;
}

/** The listing facts that need only GET /listings/:id (shared by the core and full answers). */
function listingBasics(L: any, now: number) {
  // `price` is a Money object (amount in minor units / divisor). It is the LIST price:
  // Etsy's public API does not reflect seller sales, so revenue prefers the page price.
  const price = moneyToNumber(L.price);
  const currency: string | null = L.price?.currency_code || null;
  const favorites = num(L.num_favorers);
  // Etsy has been phasing `views` out of public responses — treat 0/absent as unknown.
  const views = num(L.views) && Number(L.views) > 0 ? Number(L.views) : null;
  const createdSec = num(L.original_creation_timestamp) ?? num(L.created_timestamp) ?? num(L.creation_timestamp);
  const createdMs = createdSec ? createdSec * 1000 : null;
  const ageDays = createdMs ? Math.max(0, (now - createdMs) / DAY_MS) : null;
  const tags: string[] = Array.isArray(L.tags) ? L.tags : [];
  return { price, currency, favorites, views, createdMs, ageDays, tags };
}

export interface ListingCoreResult {
  listingId: string;
  /** Marks the fast answer: listing facts only, no sales / shop / SEO (those come with the full answer). */
  phase: 'core';
  fetchedAt: string;
  listing: {
    title: string;
    state: string | null;
    price: number | null;
    currency: string | null;
    favorites: number | null;
    views: number | null;
    quantity: number | null;
    tags: string[];
    tagCount: number;
    createdAt: string | null;
    ageDays: number | null;
  };
  pageSignals: PageSignals;
}

/**
 * The panel's fast first answer: one Etsy call (GET /listings/:id, de-duplicated with the
 * full request running alongside it), no DB, no shop data.
 */
export async function getListingCore(listingId: string, rawPage: any, meta?: StatsMeta): Promise<ListingCoreResult> {
  const t0 = Date.now();
  const page = sanitizePageSignals(rawPage);
  const L = (await fetchListing(listingId, meta)) || {};
  metaMark(meta, t0, 'etsy_listing');
  const now = Date.now();
  const x = listingBasics(L, now);
  return {
    listingId,
    phase: 'core',
    fetchedAt: new Date(now).toISOString(),
    listing: {
      title: L.title || '',
      state: L.state || null,
      price: x.price,
      currency: x.currency,
      favorites: x.favorites,
      views: x.views,
      quantity: num(L.quantity),
      tags: x.tags,
      tagCount: x.tags.length,
      createdAt: x.createdMs ? new Date(x.createdMs).toISOString() : null,
      ageDays: x.ageDays !== null ? Math.round(x.ageDays) : null,
    },
    pageSignals: page,
  };
}

/** Swallow a rejection for now (it is still observed by the later `await`). */
function settledLater<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}

export async function getListingStats(listingId: string, rawPage: any, meta?: StatsMeta): Promise<ListingStatsResult> {
  const t0 = Date.now();
  const page = sanitizePageSignals(rawPage);
  const hint = validShopId(page.shopIdHint);

  // ---- Snapshot history, read in parallel with the Etsy calls (BEFORE writing the current one) ----
  // The listing's own history needs only its id; the shop baseline starts from the page's shop-id
  // hint and is redone below if the listing turns out to belong to another shop.
  const listingDbP = settledLater(Promise.all([
    findListingBaseline(listingId, t0),
    prisma.etsyPublicListingSnapshot.count({ where: { listingId } }),
    prisma.etsyPublicListingSnapshot.findFirst({ where: { listingId }, orderBy: { capturedAt: 'asc' }, select: { capturedAt: true } }),
    prisma.etsyPublicListingSnapshot.findFirst({ where: { listingId }, orderBy: { capturedAt: 'desc' }, select: { capturedAt: true } }),
  ]).finally(() => metaMark(meta, t0, 'db_listing_history')));
  const hintBaselineP = hint ? settledLater(findShopBaseline(hint, t0)) : null;

  const b = await fetchBundle(listingId, { shopIdHint: hint, meta, t0 });
  metaMark(meta, t0, 'etsy_all');
  const now = Date.now();
  const L = b.listing || {};
  const S = b.shop;
  const shopId = L.shop_id ? String(L.shop_id) : '';

  // ---- Listing basics (Etsy API) ----
  const { price, currency, favorites, views, createdMs, ageDays } = listingBasics(L, now);
  const rev = pickRevenuePrice(page, price, currency);
  const listingReviewCount = b.listingReviews ? b.listingReviews.count : null;

  // ---- Shop basics ----
  const shopSold = S ? num(S.transaction_sold_count) : null;
  const shopReviewCount = S ? num(S.review_count) : null;
  const shopCreatedSec = S ? num(S.created_timestamp) ?? num(S.create_date) ?? num(S.create_timestamp) : null;
  const salesPerReview = salesPerReviewOf(shopSold, shopReviewCount);

  // ---- Review share of this listing within the shop's recent reviews ----
  let reviewShare: ListingStatsResult['reviewShare'] = {
    windowDays: REVIEW_WINDOW_DAYS,
    listingReviews: 0,
    shopReviews: 0,
    share: null,
    source: 'none',
  };
  const rw = shopReviewWindow(b.shopReviews, now);
  if (rw) {
    const inWindow = rw.inWindow;
    const mine = inWindow.filter(i => i.listingId === listingId).length;
    if (inWindow.length >= 5) {
      reviewShare = {
        windowDays: round(rw.windowDays, 1),
        listingReviews: mine,
        shopReviews: inWindow.length,
        share: Math.min(1, mine / inWindow.length),
        source: 'recent_reviews',
      };
    }
  }
  if (reviewShare.share === null && listingReviewCount !== null && shopReviewCount && shopReviewCount >= 5) {
    reviewShare = {
      windowDays: 0,
      listingReviews: listingReviewCount,
      shopReviews: shopReviewCount,
      share: Math.min(1, listingReviewCount / shopReviewCount),
      source: 'lifetime_reviews',
    };
  }

  // ---- Snapshots: history was read in parallel with the Etsy calls (before writing the current one) ----
  const [shopBaseline, [listingBaseline, snapshotCount, firstSnap, lastListingSnap]] = await Promise.all([
    !shopId ? Promise.resolve(null) : hintBaselineP && shopId === hint ? hintBaselineP : findShopBaseline(shopId, now),
    listingDbP,
  ]);
  metaMark(meta, t0, 'db_history');

  let recorded = false;
  if (shopId && (!lastListingSnap || now - lastListingSnap.capturedAt.getTime() >= SNAPSHOT_MIN_INTERVAL_MS)) {
    try {
      await prisma.etsyPublicListingSnapshot.create({
        data: {
          listingId,
          shopId,
          shopSoldCount: shopSold,
          shopReviewCount,
          listingFavorites: favorites,
          listingReviewCount,
          listingViews: views,
          price,
          currency,
          pageBoughtLast24h: page.boughtLast24h ?? null,
          pageInCarts: page.inCarts ?? null,
        },
      });
      recorded = true;
    } catch (e) {
      console.error('[listingStats] snapshot write failed', (e as Error)?.message);
    }
  }

  // ---- Measured shop velocity (real delta of transaction_sold_count) ----
  let shopVelocity: ListingStatsResult['shopVelocity'] = {
    kind: 'none', soldPerDay: null, delta: null, spanDays: null, baselineAt: null,
  };
  if (shopBaseline && shopSold !== null && shopBaseline.shopSoldCount !== null) {
    const spanDays = (now - shopBaseline.capturedAt.getTime()) / DAY_MS;
    const delta = shopSold - shopBaseline.shopSoldCount;
    if (spanDays >= MIN_MEASURE_SPAN_DAYS && delta >= 0) {
      shopVelocity = {
        kind: 'measured',
        soldPerDay: round(delta / spanDays, 2),
        delta,
        spanDays: round(spanDays, 1),
        baselineAt: shopBaseline.capturedAt.toISOString(),
      };
    }
  }

  // ---- Listing deltas (favorites/reviews gained since baseline) ----
  let listingDeltas: ListingStatsResult['listingDeltas'] = null;
  if (listingBaseline) {
    const spanDays = (now - listingBaseline.capturedAt.getTime()) / DAY_MS;
    if (spanDays >= 1 / 24) {
      listingDeltas = {
        spanDays: round(spanDays, 1),
        favorites: favorites !== null && listingBaseline.listingFavorites !== null ? favorites - listingBaseline.listingFavorites : null,
        reviews: listingReviewCount !== null && listingBaseline.listingReviewCount !== null ? listingReviewCount - listingBaseline.listingReviewCount : null,
        baselineAt: listingBaseline.capturedAt.toISOString(),
      };
    }
  }

  // ---- Sales: measured > estimated > insufficient ----
  let sales: ListingStatsResult['sales'] = {
    kind: 'insufficient', method: 'none', confidence: null,
    monthlySales: null, monthlySalesUpperBound: null, monthlyRevenue: null, currency: rev.currency,
    priceUsed: rev.price, priceSource: rev.source,
    inputs: {},
  };

  if (shopVelocity.kind === 'measured' && reviewShare.share !== null) {
    const monthly = (shopVelocity.soldPerDay as number) * 30 * reviewShare.share;
    const span = shopVelocity.spanDays as number;
    const sample = reviewShare.shopReviews;
    let confidence: Confidence = 'low';
    if (span >= 7 && sample >= 20 && reviewShare.source === 'recent_reviews') confidence = 'high';
    else if (span >= 2 && sample >= 5) confidence = 'medium';
    sales = {
      kind: 'measured',
      method: 'shop_delta_x_review_share',
      confidence,
      monthlySales: round(monthly, 1),
      monthlySalesUpperBound: null,
      monthlyRevenue: revenueFor(round(monthly, 1), rev.price),
      currency: rev.currency,
      priceUsed: rev.price,
      priceSource: rev.source,
      inputs: {
        shopSoldDelta: shopVelocity.delta,
        spanDays: span,
        shopSoldPerDay: shopVelocity.soldPerDay,
        share: round(reviewShare.share * 100, 1),
        shareListingReviews: reviewShare.listingReviews,
        shareShopReviews: reviewShare.shopReviews,
        shareWindowDays: reviewShare.windowDays,
        shareSource: reviewShare.source,
        price,
      },
    };
  } else if (salesPerReview !== null && b.listingReviews) {
    // Estimate: this listing's recent review velocity x this shop's real sales/review ratio.
    const listingAge = ageDays ?? REVIEW_WINDOW_DAYS;
    let windowDays = Math.max(14, Math.min(REVIEW_WINDOW_DAYS, listingAge));
    const ts = b.listingReviews.timestamps;
    // If the listing has >100 reviews and we only fetched 100, they may not reach back the full window.
    if (ts.length >= 100 && b.listingReviews.count > ts.length) {
      const oldest = Math.min(...ts);
      windowDays = Math.max(1, Math.min(windowDays, (now - oldest) / DAY_MS));
    }
    const recent = ts.filter(t => t >= now - windowDays * DAY_MS).length;
    const perDay = recent / windowDays;
    if (recent > 0) {
      const monthly = perDay * salesPerReview * 30;
      sales = {
        kind: 'estimated',
        method: 'review_velocity_x_shop_ratio',
        confidence: recent >= 10 ? 'medium' : 'low',
        monthlySales: round(monthly, 1),
        monthlySalesUpperBound: null,
        monthlyRevenue: revenueFor(round(monthly, 1), rev.price),
        currency: rev.currency,
        priceUsed: rev.price,
        priceSource: rev.source,
        inputs: {
          recentListingReviews: recent,
          windowDays: round(windowDays, 0),
          salesPerReview: round(salesPerReview, 1),
          shopSold: shopSold,
          shopReviewCount: shopReviewCount,
          price,
        },
      };
    } else {
      // No reviews in the window: the honest statement is an upper bound
      // (fewer sales than one review's worth over the window).
      const upper = (1 / windowDays) * salesPerReview * 30;
      sales = {
        kind: 'estimated',
        method: 'review_velocity_x_shop_ratio',
        confidence: 'low',
        monthlySales: null,
        monthlySalesUpperBound: round(upper, 1),
        monthlyRevenue: null,
        currency: rev.currency,
        priceUsed: rev.price,
        priceSource: rev.source,
        inputs: {
          recentListingReviews: 0,
          windowDays: round(windowDays, 0),
          salesPerReview: round(salesPerReview, 1),
          shopSold: shopSold,
          shopReviewCount: shopReviewCount,
          price,
        },
      };
    }
  }

  // One number per listing: the listing page reads this listing's own reviews, which is more direct than
  // the search card's share-of-shop-reviews, so search cards reuse it for a day (see getBatchListingStats).
  if (sales && (sales.kind === 'estimated' || sales.kind === 'measured')) {
    rememberPageEstimate(listingId, sales);
  }

  const shopAgeYears = shopCreatedSec ? round((now - shopCreatedSec * 1000) / (365 * DAY_MS), 1) : null;

  return {
    listingId,
    fetchedAt: new Date(b.fetchedAt).toISOString(),
    listing: {
      title: L.title || '',
      state: L.state || null,
      price,
      currency,
      favorites,
      views,
      quantity: num(L.quantity),
      tags: Array.isArray(L.tags) ? L.tags : [],
      tagCount: Array.isArray(L.tags) ? L.tags.length : 0,
      imageCount: b.imageCount,
      reviewCount: listingReviewCount,
      createdAt: createdMs ? new Date(createdMs).toISOString() : null,
      ageDays: ageDays !== null ? Math.round(ageDays) : null,
    },
    shop: S
      ? {
          shopId,
          shopName: S.shop_name || null,
          soldCount: shopSold,
          reviewCount: shopReviewCount,
          rating: num(S.review_average),
          createdAt: shopCreatedSec ? new Date(shopCreatedSec * 1000).toISOString() : null,
          ageYears: shopAgeYears,
          salesPerReview: salesPerReview !== null ? round(salesPerReview, 1) : null,
        }
      : null,
    pageSignals: page,
    reviewShare: { ...reviewShare, share: reviewShare.share !== null ? round(reviewShare.share, 4) : null },
    shopVelocity,
    listingDeltas,
    sales,
    tracking: {
      snapshotCount: snapshotCount + (recorded ? 1 : 0),
      firstSnapshotAt: firstSnap?.capturedAt.toISOString() ?? (recorded ? new Date(now).toISOString() : null),
      recorded,
    },
    seoScore: seoScore(L, b.imageCount),
  };
}

/**
 * Baseline for the shop delta: the OLDEST snapshot of this shop within the last
 * 30 days that is at least MIN_MEASURE_SPAN_DAYS old (longest span = least noise).
 * If none, fall back to the most recent snapshot older than 30 days (up to 180).
 */
async function findShopBaseline(shopId: string, now: number) {
  const minAge = new Date(now - MIN_MEASURE_SPAN_DAYS * DAY_MS);
  const lookback = new Date(now - MEASURE_LOOKBACK_DAYS * DAY_MS);
  const recent = await prisma.etsyPublicListingSnapshot.findFirst({
    where: { shopId, shopSoldCount: { not: null }, capturedAt: { gte: lookback, lte: minAge } },
    orderBy: { capturedAt: 'asc' },
    select: { capturedAt: true, shopSoldCount: true },
  });
  if (recent) return recent;
  return prisma.etsyPublicListingSnapshot.findFirst({
    where: {
      shopId,
      shopSoldCount: { not: null },
      capturedAt: { gte: new Date(now - MEASURE_MAX_LOOKBACK_DAYS * DAY_MS), lt: lookback },
    },
    orderBy: { capturedAt: 'desc' },
    select: { capturedAt: true, shopSoldCount: true },
  });
}

async function findListingBaseline(listingId: string, now: number) {
  // Batch (search-page) snapshots don't know the listing's review count, so the
  // review baseline is looked up separately from the favorites baseline.
  const since = new Date(now - MEASURE_LOOKBACK_DAYS * DAY_MS);
  const [first, firstWithReviews] = await Promise.all([
    prisma.etsyPublicListingSnapshot.findFirst({
      where: { listingId, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true, listingFavorites: true, listingReviewCount: true },
    }),
    prisma.etsyPublicListingSnapshot.findFirst({
      where: { listingId, capturedAt: { gte: since }, listingReviewCount: { not: null } },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true, listingReviewCount: true },
    }),
  ]);
  if (!first) return null;
  // Only use the review baseline if it's from (nearly) the same time as the favorites one.
  const sameSpan = firstWithReviews && firstWithReviews.capturedAt.getTime() - first.capturedAt.getTime() < 6 * 3600 * 1000;
  return { ...first, listingReviewCount: sameSpan ? firstWithReviews!.listingReviewCount : null };
}

// ===========================================================================
// Batch (search / shop grid) and shop-level stats
// ===========================================================================

export type SalesKind = 'measured' | 'estimated' | 'insufficient' | 'pending';

export interface CardStats {
  listingId: string;
  shopId: string | null;
  price: number | null;
  currency: string | null;
  favorites: number | null;
  quantity: number | null;
  sales: {
    kind: SalesKind;
    confidence: Confidence | null;
    monthlySales: number | null;
    monthlySalesUpperBound: number | null;
    /** shownMonthlySales x API LIST price (pre-discount). The extension prefers the card's displayed price. */
    monthlyRevenue: number | null;
    /** Compact inputs for a tooltip: reviews in window, window days, ratio, measured shop delta. */
    inputs: Record<string, number | string | null>;
  };
}

const listingBasicCache = new Map<string, { at: number; item: any }>();

/** The listing page's estimate per listing id, reused by search cards for 24h so both show the same figure. */
const PAGE_ESTIMATE_TTL_MS = 24 * 60 * 60 * 1000;
// Kept on globalThis: Next.js bundles each API route separately, so a plain module-level Map would give
// /api/ext/listing-stats and /api/ext/research two different caches inside the same server process.
type PageEstimate = { at: number; sales: { kind: SalesKind; confidence: Confidence | null; monthlySales: number | null; monthlySalesUpperBound: number | null; inputs: Record<string, any> } };
const pageEstimateCache: Map<string, PageEstimate> =
  ((globalThis as any).__kxPageEstimates ??= new Map<string, PageEstimate>());

function rememberPageEstimate(listingId: string, sales: any) {
  pageEstimateCache.set(String(listingId), {
    at: Date.now(),
    sales: {
      kind: sales.kind,
      confidence: sales.confidence ?? null,
      monthlySales: sales.monthlySales ?? null,
      monthlySalesUpperBound: sales.monthlySalesUpperBound ?? null,
      inputs: { ...(sales.inputs || {}), source: 'listing_page' },
    },
  });
  if (pageEstimateCache.size > 50000) {
    const oldest = [...pageEstimateCache.entries()].sort((x, y) => x[1].at - y[1].at).slice(0, 10000);
    for (const [k] of oldest) pageEstimateCache.delete(k);
  }
}

/** Test hook. */
export function __clearPageEstimates() { pageEstimateCache.clear(); }

/**
 * Override card stats with fresher listing-page estimates. Card results can come from the 6 h shared cache, so
 * this runs on every response (cached or live) and the search card always matches the listing page.
 */
export function applyPageEstimates(listings: Record<string, CardStats> | undefined | null, now = Date.now()) {
  if (!listings) return listings;
  for (const id of Object.keys(listings)) {
    const pe = pageEstimateCache.get(id);
    const card = listings[id];
    if (!pe || !card || now - pe.at >= PAGE_ESTIMATE_TTL_MS) continue;
    listings[id] = { ...card, sales: { ...pe.sales, monthlyRevenue: revenueFor(pe.sales.monthlySales, card.price) } as CardStats['sales'] };
  }
  return listings;
}

/** Record a listing page's estimate from a (possibly cached) getListingStats() result body. */
export function rememberListingResult(body: any) {
  const sales = body?.sales;
  const id = body?.listingId;
  if (id && sales && (sales.kind === 'estimated' || sales.kind === 'measured')) rememberPageEstimate(String(id), sales);
}

/** Test hook: store a listing-page estimate directly. */
export function __rememberPageEstimateForTest(listingId: string, sales: any) { rememberPageEstimate(listingId, sales); }
const LISTING_BASIC_TTL_MS = 30 * 60 * 1000;
/** Max shops fetched fresh from Etsy per batch request (2 calls each); the rest come back as 'pending'. */
const DEFAULT_MAX_NEW_SHOPS = 12;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Oldest usable baseline per shop (same rules as findShopBaseline), in two queries total. */
async function findShopBaselines(shopIds: string[], now: number) {
  const result = new Map<string, { capturedAt: Date; shopSoldCount: number | null }>();
  if (shopIds.length === 0) return result;
  const minAge = new Date(now - MIN_MEASURE_SPAN_DAYS * DAY_MS);
  const lookback = new Date(now - MEASURE_LOOKBACK_DAYS * DAY_MS);
  const recent = await prisma.etsyPublicListingSnapshot.findMany({
    where: { shopId: { in: shopIds }, shopSoldCount: { not: null }, capturedAt: { gte: lookback, lte: minAge } },
    orderBy: { capturedAt: 'asc' },
    distinct: ['shopId'],
    select: { shopId: true, capturedAt: true, shopSoldCount: true },
  });
  recent.forEach(r => result.set(r.shopId, r));
  const missing = shopIds.filter(id => !result.has(id));
  if (missing.length) {
    const older = await prisma.etsyPublicListingSnapshot.findMany({
      where: {
        shopId: { in: missing },
        shopSoldCount: { not: null },
        capturedAt: { gte: new Date(now - MEASURE_MAX_LOOKBACK_DAYS * DAY_MS), lt: lookback },
      },
      orderBy: { capturedAt: 'desc' },
      distinct: ['shopId'],
      select: { shopId: true, capturedAt: true, shopSoldCount: true },
    });
    older.forEach(r => result.set(r.shopId, r));
  }
  return result;
}

function measuredShopVelocity(
  baseline: { capturedAt: Date; shopSoldCount: number | null } | undefined | null,
  shopSold: number | null,
  at: number,
) {
  if (!baseline || baseline.shopSoldCount === null || shopSold === null) return null;
  const spanDays = (at - baseline.capturedAt.getTime()) / DAY_MS;
  const delta = shopSold - baseline.shopSoldCount;
  if (spanDays < MIN_MEASURE_SPAN_DAYS || delta < 0) return null;
  return { delta, spanDays, perDay: delta / spanDays, baselineAt: baseline.capturedAt };
}

/**
 * Stats for many listings at once (search results / shop grid) without N Etsy
 * calls per page: 1 /listings/batch call + 2 calls per *uncached* shop (capped),
 * shop data shared across users for up to 6h, snapshot baselines from the DB.
 * Listing share/velocity comes from the shop's last 100 reviews (which name the
 * listing), so no per-listing review calls are needed.
 */
export async function getBatchListingStats(
  rawIds: string[],
  opts: { maxNewShops?: number } = {},
): Promise<{ listings: Record<string, CardStats>; pendingIds: string[] }> {
  const ids = [...new Set(rawIds.filter(id => /^\d{4,20}$/.test(id)))].slice(0, 100);
  const now = Date.now();
  const listings: Record<string, CardStats> = {};
  if (ids.length === 0) return { listings, pendingIds: [] };

  // 1) Listing basics — one batch call for whatever isn't cached.
  const need = ids.filter(id => {
    const c = listingBasicCache.get(id);
    return !c || now - c.at > LISTING_BASIC_TTL_MS;
  });
  if (need.length) {
    const data = await etsyGetSafe(`/listings/batch?listing_ids=${need.join(',')}`);
    for (const item of data?.results || []) {
      listingBasicCache.set(String(item.listing_id), { at: now, item });
    }
    if (listingBasicCache.size > 20000) {
      const entries = [...listingBasicCache.entries()].sort((a, b) => a[1].at - b[1].at);
      for (const [k] of entries.slice(0, 5000)) listingBasicCache.delete(k);
    }
  }

  // 2) Shops — cached bundles first, then a capped number of fresh fetches.
  const shopIds = [...new Set(ids.map(id => listingBasicCache.get(id)?.item?.shop_id).filter(Boolean).map(String))];
  const shops = new Map<string, ShopBundle>();
  const uncached: string[] = [];
  for (const sid of shopIds) {
    const c = peekShopBundle(sid, SHOP_CACHE_MAX_AGE_MS);
    if (c) shops.set(sid, c);
    else uncached.push(sid);
  }
  const maxNew = Math.max(0, Math.min(opts.maxNewShops ?? DEFAULT_MAX_NEW_SHOPS, 25));
  const toFetch = uncached.slice(0, maxNew);
  // 8 shops (16 Etsy calls) at a time: the cards fill in one or two round trips instead of three;
  // etsyFetch's shared token bucket still paces the actual calls.
  const fetched = await mapLimit(toFetch, 8, sid => fetchShopBundle(sid, SHOP_CACHE_MAX_AGE_MS));
  toFetch.forEach((sid, i) => { if (fetched[i]?.shop) shops.set(sid, fetched[i]); });

  // 3) Baselines from snapshots (2 queries for all shops).
  const baselines = await findShopBaselines([...shops.keys()], now);

  const pendingIds: string[] = [];
  const snapshotRows: any[] = [];

  for (const id of ids) {
    const item = listingBasicCache.get(id)?.item;
    const base: CardStats = {
      listingId: id,
      shopId: item?.shop_id ? String(item.shop_id) : null,
      // List price (Money object). Etsy's API does not include sale discounts; the extension
      // recomputes revenue with the price displayed on the card when it can read it.
      price: moneyToNumber(item?.price),
      currency: item?.price?.currency_code || null,
      favorites: item ? num(item.num_favorers) : null,
      quantity: item ? num(item.quantity) : null,
      sales: { kind: 'insufficient', confidence: null, monthlySales: null, monthlySalesUpperBound: null, monthlyRevenue: null, inputs: {} },
    };
    listings[id] = base;
    if (!item) continue;
    const pageEst = pageEstimateCache.get(id);
    if (pageEst && now - pageEst.at < PAGE_ESTIMATE_TTL_MS) {
      base.sales = {
        ...pageEst.sales,
        monthlyRevenue: revenueFor(pageEst.sales.monthlySales, base.price),
      } as CardStats['sales'];
      continue;
    }
    const sb = base.shopId ? shops.get(base.shopId) : undefined;
    if (!sb) {
      base.sales.kind = 'pending';
      pendingIds.push(id);
      continue;
    }

    const shopSold = num(sb.shop?.transaction_sold_count);
    const shopReviewCount = num(sb.shop?.review_count);
    const spr = salesPerReviewOf(shopSold, shopReviewCount);
    const rw = shopReviewWindow(sb.shopReviews, sb.fetchedAt);
    const mine = rw ? rw.inWindow.filter(r => r.listingId === id).length : 0;
    const createdSec = num(item.original_creation_timestamp) ?? num(item.created_timestamp);
    const ageDays = createdSec ? Math.max(1, (sb.fetchedAt - createdSec * 1000) / DAY_MS) : null;
    const mv = measuredShopVelocity(base.shopId ? baselines.get(base.shopId) : null, shopSold, sb.fetchedAt);

    if (mv && rw && rw.inWindow.length >= 5) {
      const share = mine / rw.inWindow.length;
      const monthly = mv.perDay * 30 * share;
      let confidence: Confidence = 'low';
      if (mv.spanDays >= 7 && rw.inWindow.length >= 20) confidence = 'high';
      else if (mv.spanDays >= 2) confidence = 'medium';
      base.sales = {
        kind: 'measured', confidence,
        monthlySales: round(monthly, 1), monthlySalesUpperBound: null,
        monthlyRevenue: revenueFor(round(monthly, 1), base.price),
        inputs: {
          shopSoldDelta: mv.delta, spanDays: round(mv.spanDays, 1),
          shareListingReviews: mine, shareShopReviews: rw.inWindow.length, shareWindowDays: round(rw.windowDays, 0),
        },
      };
    } else if (spr !== null && rw) {
      const days = Math.max(3, Math.min(rw.windowDays, ageDays ?? rw.windowDays));
      if (mine > 0) {
        const monthly = (mine / days) * spr * 30;
        base.sales = {
          kind: 'estimated', confidence: mine >= 10 ? 'medium' : 'low',
          monthlySales: round(monthly, 1), monthlySalesUpperBound: null,
          monthlyRevenue: revenueFor(round(monthly, 1), base.price),
          inputs: { recentListingReviews: mine, windowDays: round(days, 0), salesPerReview: round(spr, 1) },
        };
      } else {
        base.sales = {
          kind: 'estimated', confidence: 'low',
          monthlySales: null, monthlySalesUpperBound: round((1 / days) * spr * 30, 1), monthlyRevenue: null,
          inputs: { recentListingReviews: 0, windowDays: round(days, 0), salesPerReview: round(spr, 1) },
        };
      }
    }

    snapshotRows.push({
      listingId: id,
      shopId: base.shopId,
      shopSoldCount: shopSold,
      shopReviewCount,
      listingFavorites: base.favorites,
      listingReviewCount: null,
      listingViews: num(item.views) && Number(item.views) > 0 ? Number(item.views) : null,
      price: base.price,
      currency: base.currency,
      capturedAt: new Date(sb.fetchedAt),
    });
  }

  // 4) Snapshots (throttled per listing).
  if (snapshotRows.length) {
    try {
      const recent = await prisma.etsyPublicListingSnapshot.findMany({
        where: { listingId: { in: snapshotRows.map(r => r.listingId) }, capturedAt: { gte: new Date(now - SNAPSHOT_MIN_INTERVAL_MS) } },
        select: { listingId: true },
        distinct: ['listingId'],
      });
      const skip = new Set(recent.map(r => r.listingId));
      const rows = snapshotRows.filter(r => !skip.has(r.listingId));
      if (rows.length) await prisma.etsyPublicListingSnapshot.createMany({ data: rows });
    } catch (e) {
      console.error('[listingStats] batch snapshot write failed', (e as Error)?.message);
    }
  }

  return { listings, pendingIds };
}

export interface ShopStatsResult {
  fetchedAt: string;
  shop: {
    shop_id: number | string;
    shop_name: string;
    num_sales: number | null;
    rating: number | null;
    review_count: number | null;
    listing_count: number | null;
    created: number | null;
    shopAgeYears: number | null;
    currency: string;
    salesPerReview: number | null;
  };
  sales: {
    kind: 'measured' | 'estimated' | 'insufficient';
    confidence: Confidence | null;
    monthlySales: number | null;
    monthlyRevenue: number | null;
    currency: string;
    inputs: Record<string, number | string | null>;
  };
  /** Median LIST price (shop currency). Legacy name kept for older extensions. */
  avgPrice: number;
  lowStockCount: number;
  topListings: Array<{ listing_id: string; title: string; recentReviews: number; price: number | null }>;
}

/** Shop overlay: measured shop velocity when snapshots allow, else review velocity x sales/review. */
export async function getShopStats(shopIdOrName: string): Promise<ShopStatsResult | null> {
  let shopId: string;
  if (/^\d+$/.test(shopIdOrName)) {
    shopId = shopIdOrName;
  } else {
    const lookup = await etsyGet(`/shops?shop_name=${encodeURIComponent(shopIdOrName)}`);
    const results = lookup.results || [];
    const match = results.find((s: any) => String(s.shop_name).toLowerCase() === shopIdOrName.toLowerCase()) || results[0];
    if (!match) return null;
    shopId = String(match.shop_id);
  }

  // Shop, its active listings and its snapshot baseline in parallel.
  const [sb, active, shopBaseline] = await Promise.all([
    fetchShopBundle(shopId, API_CACHE_TTL_MS),
    etsyGetSafe(`/shops/${shopId}/listings/active?limit=100&sort_on=score`),
    findShopBaseline(shopId, Date.now()),
  ]);
  const S = sb.shop;
  if (!S) return null;

  const now = sb.fetchedAt;
  const shopSold = num(S.transaction_sold_count);
  const shopReviewCount = num(S.review_count);
  const spr = salesPerReviewOf(shopSold, shopReviewCount);
  const currency = S.currency_code || 'USD';
  const items: any[] = active?.results || [];
  // Median LIST price of the shop's top-100 active listings, in the shop currency. Only
  // listings priced in the shop currency are used (never mix currencies). Median, not mean:
  // one $500 custom piece must not double a $20 shop's revenue.
  const prices = items
    .filter(l => !l.price?.currency_code || l.price.currency_code === currency)
    .map(l => moneyToNumber(l.price))
    .filter((p): p is number => p !== null);
  const avgPrice = groupMedian(prices) ?? 0;

  const rw = shopReviewWindow(sb.shopReviews, now);
  const mv = measuredShopVelocity(shopBaseline, shopSold, now);

  let sales: ShopStatsResult['sales'] = { kind: 'insufficient', confidence: null, monthlySales: null, monthlyRevenue: null, currency, inputs: {} };
  if (mv) {
    const monthly = mv.perDay * 30;
    sales = {
      kind: 'measured',
      confidence: mv.spanDays >= 7 ? 'high' : mv.spanDays >= 2 ? 'medium' : 'low',
      monthlySales: round(monthly, 1),
      monthlyRevenue: revenueFor(round(monthly, 1), avgPrice || null),
      currency,
      inputs: { shopSoldDelta: mv.delta, spanDays: round(mv.spanDays, 1), avgPrice: round(avgPrice, 2) },
    };
  } else if (spr !== null && rw && rw.inWindow.length >= 5) {
    const monthly = (rw.inWindow.length / rw.windowDays) * spr * 30;
    sales = {
      kind: 'estimated',
      confidence: rw.inWindow.length >= 30 ? 'medium' : 'low',
      monthlySales: round(monthly, 1),
      monthlyRevenue: revenueFor(round(monthly, 1), avgPrice || null),
      currency,
      inputs: {
        recentShopReviews: rw.inWindow.length, windowDays: round(rw.windowDays, 0),
        salesPerReview: round(spr, 1), avgPrice: round(avgPrice, 2),
      },
    };
  }

  // Top listings = most reviews in the recent window (real buyer reviews, not a formula).
  const counts = new Map<string, number>();
  (rw?.inWindow || []).forEach(r => counts.set(r.listingId, (counts.get(r.listingId) || 0) + 1));
  const byId = new Map(items.map(l => [String(l.listing_id), l]));
  const topListings = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lid, n]) => {
      const l = byId.get(lid);
      return {
        listing_id: lid,
        title: l?.title || '',
        recentReviews: n,
        price: moneyToNumber(l?.price),
      };
    });

  const createdSec = num(S.created_timestamp) ?? num(S.create_date) ?? num(S.create_timestamp);
  return {
    fetchedAt: new Date(now).toISOString(),
    shop: {
      shop_id: S.shop_id,
      shop_name: S.shop_name,
      num_sales: shopSold,
      rating: num(S.review_average),
      review_count: shopReviewCount,
      listing_count: num(S.listing_active_count),
      created: createdSec,
      shopAgeYears: createdSec ? round((Date.now() - createdSec * 1000) / (365 * DAY_MS), 1) : null,
      currency,
      salesPerReview: spr !== null ? round(spr, 1) : null,
    },
    sales,
    avgPrice: round(avgPrice, 2),
    lowStockCount: items.filter(l => { const q = num(l.quantity); return q !== null && q > 0 && q <= 3; }).length,
    topListings,
  };
}
