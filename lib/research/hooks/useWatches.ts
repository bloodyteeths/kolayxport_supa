// lib/research/hooks/useWatches.ts (research R3-B) — client data for the Shop tracker (research.md §8, §10).
//
// Contract: R3-A `pages/api/research/watches/{index,[id]}.ts` + `lib/research/watchAdapter.ts` (types imported with
// `import type` only: the adapter imports Prisma). Every response is the research envelope `{ data, source, errors? }`:
//
//   GET    /api/research/watches        → `WatchesData` { available, alertsAvailable, rows: WatchSummary[], quota, readingTimeUtc }
//   GET    /api/research/watches/[id]   → `WatchDetail` { watch, shop, sales, newListings, fastest, tagGap, tagGapAvailable, … }
//   POST   /api/research/watches        ← { input, type, marketplace, refId, label, alertRules } → `WatchCreateData` { watch, quota, created }
//   PATCH  /api/research/watches/[id]   ← { alertRules: Partial<AlertRules> } → { watch: WatchSummary }
//   DELETE /api/research/watches/[id]   → { id, removed: true } (soft; shared readings stay)
//
// Errors `{ error, key?, used?, limit? }`: 400 bad_request (research.watch.inputInvalid | rulesInvalid) · 404 not_found
// (research.watch.shopNotFound | notFound) · 409 quota_exceeded (research.shops.quotaFull) | read_only · 422 unsupported ·
// 429 rate_limited · 503 unavailable (research.shops.unavailable: BR-1c not deployed) | budget (research.error.budget).
//
// Honest data: every number is a `Guarded<number>` with its kind. Sales per day are Measured only from ≥ 2 daily
// readings of Etsy's `transaction_sold_count` (guard 7 drops are server-side); this module re-applies "fewer than 2
// readings → '—' with research.shops.firstReading" so a payload can never show a rate from one reading, and treats a
// negative daily value as a dropped point. Payloads are normalised defensively: a malformed field renders "—".
// Writes go to KolayXport rows only (watches, alert rules), never to a marketplace.
import * as React from 'react';
import useSWR from 'swr';
import { useAsyncRegion, type AsyncRegion } from '@/lib/ds/useAsyncState';
import { decodeEntities } from '@/lib/research/stats';
import type { Guarded, ResearchResponse, ResearchSectionError, SourceNoteProps } from '@/lib/research/types';
import { isResearchMkt } from '@/lib/research/types';
import type {
  AlertRules,
  FastestListing,
  SalesPoint,
  WatchDetail,
  WatchListingLite,
  WatchMetrics,
  WatchQuota,
  WatchItemInfo,
  WatchShopInfo,
  WatchSource,
  WatchSummary,
  WatchType,
  WatchesData,
} from '@/lib/research/watchAdapter';
import { ResearchFetchError, errorsOf } from './useResearchProducts';

export { ResearchFetchError };
export type { AlertRules, FastestListing, SalesPoint, WatchDetail, WatchItemInfo, WatchListingLite, WatchQuota, WatchSummary, WatchType, WatchesData };

export const WATCHES_PATH = '/api/research/watches';

/** The Shop tracker shows Etsy shops, eBay sellers and eBay items (ASIN / query / Trendyol watches live in their own tools). */
export const SHOP_WATCH_TYPES: readonly WatchType[] = ['etsyShop', 'ebaySeller', 'ebayItem'];

/** research.md §8.1 switches: new listings on, price drop > 10% on, sales spike off (on = 2×). Same as R3-A's default. */
export const DEFAULT_ALERT_RULES: AlertRules = { newListing: true, priceDropPct: 10, salesSpikeX: null };
export const PRICE_DROP_PCT = 10;
export const SALES_SPIKE_X = 2;

/** i18n key of the "first reading" guard (research §8.1). */
export const FIRST_READING_KEY = 'research.shops.firstReading';
/** No reading at all yet (a new watch before the snapshot job ran, or its first reading was skipped). */
export const NO_READING_KEY = 'research.shops.noReading';
/** Fallback for a guard reason the client has no message for (a newer server key). */
export const UNKNOWN_REASON_KEY = 'research.shops.noSales';

/**
 * Every guard reason key R3-A's watchAdapter can send (their messages ship with R3-B). A key outside this list is
 * replaced by `UNKNOWN_REASON_KEY` so a cell never shows a raw key path as its tooltip / aria-label.
 */
export const KNOWN_REASON_KEYS: readonly string[] = [
  'research.shops.firstReading',
  'research.shops.noReading',
  'research.shops.noRecentReading',
  'research.shops.anomaly',
  'research.shops.pointsDropped',
  'research.shops.needTwoWeeks',
  'research.shops.prevZero',
  'research.shops.needWeek',
  'research.shops.currencyChanged',
  'research.shops.priceSample',
  'research.shops.noListings',
  'research.shops.atLeast',
  'research.shops.ebayTrackedItems',
  'research.shops.ebayCollecting',
  'research.shops.ebayActiveUnknown',
  'research.shops.shareFromFavorites',
  'research.shops.favoritesOverDays',
  'research.shops.noSales',
  'research.shops.overQuota',
  'research.watch.notApplicable',
  'research.watch.noReadingsYet',
  'research.watch.ebayQueryUnsupported',
  // Shared research guards (already in messages/*.json).
  'research.guard.small',
  'research.guard.insufficient',
  'research.guard.noFx',
  'research.guard.outliers',
  'research.guard.notAvailableEbay',
  'research.guard.implausible',
  'research.guard.notEnoughSignal',
];
/** Guard qualifiers on a value that passed (rendered next to the number, research §3.1 honest data). */
export const AT_LEAST_KEY = 'research.shops.atLeast';
export const TRACKED_ITEMS_KEY = 'research.shops.ebayTrackedItems';

export function knownReasonKey(key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  return KNOWN_REASON_KEYS.includes(key) ? key : UNKNOWN_REASON_KEY;
}

/** `POST /api/research/watches` body the Shop tracker sends (R3-A `WatchCreateRequest`; the server resolves a shop name/link in `refId`). */
export interface ShopWatchCreate {
  input: string;
  type: 'etsyShop' | 'ebaySeller' | 'ebayItem';
  marketplace: 'etsy' | 'ebay';
  refId: string;
  label: string;
  alertRules: AlertRules;
}

// ─── Normalisation (pure, tolerant) ─────────────────────────────────────────────────────────────────────

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
const httpUrl = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};
const KINDS = ['measured', 'estimate', 'signal', 'user'] as const;
const WATCH_TYPES: readonly string[] = ['etsyShop', 'ebaySeller', 'ebayItem', 'query', 'asin', 'trendyolProduct'];
const SOURCES: readonly string[] = ['researchWatch', 'ebayTrackedSeller', 'ebayTrackedProduct', 'amazonTrackedProduct'];

/** A `Guarded<number>` from anything; a missing value fails its guard. `forceKind` pins the label (Estimate for shares). */
export function toGuarded(v: unknown, forceKind?: Guarded<number>['kind']): Guarded<number> {
  if (isObj(v)) {
    const g = isObj(v.guard) ? v.guard : {};
    const value = num(v.value);
    const kind = forceKind ?? ((KINDS as readonly string[]).includes(String(v.kind)) ? (v.kind as Guarded<number>['kind']) : 'measured');
    return {
      value,
      kind,
      guard: {
        ok: g.ok === undefined ? value !== null : g.ok !== false && value !== null,
        reasonKey: knownReasonKey(str(g.reasonKey)),
        reasonParams: isObj(g.reasonParams) ? (g.reasonParams as Record<string, string | number>) : undefined,
      },
    };
  }
  const n = num(v);
  return { value: n, kind: forceKind ?? 'measured', guard: { ok: n !== null } };
}

/**
 * Rates need two readings (honest-data rule). One reading → "First reading taken today…"; none → the server's own
 * reason (e.g. no reading yet / not applicable), never a claim that a reading was taken.
 */
function needsTwo(g: Guarded<number>, readings: number): Guarded<number> {
  if (readings >= 2) return g;
  if (readings === 1) return { value: null, kind: 'measured', guard: { ok: false, reasonKey: FIRST_READING_KEY } };
  const keep = !g.guard.ok && g.guard.reasonKey;
  return {
    value: null,
    kind: 'measured',
    guard: { ok: false, reasonKey: keep ? g.guard.reasonKey : NO_READING_KEY, reasonParams: keep ? g.guard.reasonParams : undefined },
  };
}

export function normalizeAlertRules(v: unknown): AlertRules {
  const r = isObj(v) ? v : {};
  const drop = num(r.priceDropPct);
  const spike = num(r.salesSpikeX);
  return {
    newListing: r.newListing === true || r.newListings === true,
    priceDropPct: drop !== null && drop > 0 ? drop : null,
    salesSpikeX: spike !== null && spike > 1 ? spike : null,
  };
}

/** `ebayItem` rows: the latest reading (a non-positive price is no price). */
function itemInfo(v: unknown): WatchItemInfo | undefined {
  if (!isObj(v)) return undefined;
  const price = num(v.price);
  const sold = num(v.soldAllTime);
  const cur = str(v.currency);
  return {
    price: price !== null && price > 0 ? price : null,
    currency: cur && /^[A-Za-z]{3}$/.test(cur) ? cur.toUpperCase() : 'USD',
    soldAllTime: sold !== null && sold >= 0 ? Math.floor(sold) : null,
    condition: str(v.condition),
    seller: str(v.seller),
  };
}

function shopInfo(v: unknown, label: string): WatchShopInfo | null {
  if (!isObj(v)) return null;
  return {
    name: decodeEntities(str(v.name) ?? label) || label,
    url: httpUrl(v.url),
    iconUrl: httpUrl(v.iconUrl),
    openedAt: str(v.openedAt),
    reviewCount: num(v.reviewCount),
    reviewAverage: num(v.reviewAverage),
  };
}

export function normalizeWatchRow(raw: unknown): WatchSummary | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const type = str(raw.type);
  const marketplace = str(raw.marketplace);
  if (!id || !type || !WATCH_TYPES.includes(type) || !isResearchMkt(marketplace)) return null;
  const refId = str(raw.refId) ?? '';
  const label = decodeEntities(str(raw.label) ?? refId) || refId;
  if (!label) return null;
  const snap = isObj(raw.snapshots) ? raw.snapshots : {};
  // Aliases (`readings`, `salesPerDay7d`, `salesChange`, `flagged`) keep older adapter drafts readable.
  const count = Math.max(0, Math.floor(num(snap.count) ?? num(raw.readings) ?? 0));
  const m = isObj(raw.metrics) ? raw.metrics : {};
  const caps = isObj(raw.capabilities) ? raw.capabilities : {};
  const metrics: WatchMetrics = {
    salesPerDay: needsTwo(toGuarded(m.salesPerDay ?? m.salesPerDay7d, 'measured'), count),
    salesVsPrev: needsTwo(toGuarded(m.salesVsPrev ?? m.salesChange, 'measured'), count),
    active: toGuarded(m.active, 'measured'),
    new7d: needsTwo(toGuarded(m.new7d, 'measured'), count),
    priceChange: needsTwo(toGuarded(m.priceChange, 'measured'), count),
    price: null,
    soldItemsAllTime: num(m.soldItemsAllTime),
    droppedPoints: Math.max(0, Math.floor(num(m.droppedPoints) ?? num(raw.flagged) ?? 0)),
  };
  return {
    id,
    type: type as WatchType,
    marketplace,
    refId,
    label,
    source: (SOURCES.includes(String(raw.source)) ? raw.source : 'researchWatch') as WatchSource,
    url: httpUrl(raw.url),
    iconUrl: httpUrl(raw.iconUrl),
    capabilities: { alerts: caps.alerts !== false, remove: caps.remove !== false },
    alertRules: normalizeAlertRules(raw.alertRules),
    createdAt: str(raw.createdAt) ?? '',
    shop: shopInfo(raw.shop, label),
    metrics,
    snapshots: { count, first: str(snap.first), last: str(snap.last) },
    href: str(raw.href) ?? `/app/research/shops?open=${encodeURIComponent(id)}`,
    ...(type === 'ebayItem' ? { item: itemInfo(raw.item) ?? { price: null, currency: 'USD', soldAllTime: null, condition: null, seller: null } } : {}),
  };
}

export function normalizeQuota(v: unknown, used: number): WatchQuota {
  const q = isObj(v) ? v : {};
  const u = num(q.used);
  const limit = num(q.limit);
  return {
    used: u !== null && u >= 0 ? Math.floor(u) : used,
    limit: limit !== null && limit >= 0 ? Math.floor(limit) : null,
    plan: (str(q.plan) as WatchQuota['plan']) ?? null,
    // Anything but an explicit true = no Stripe upsell (shopify_free safe direction).
    stripeUpsell: q.stripeUpsell === true,
  };
}

export function isShopWatch(r: Pick<WatchSummary, 'type'>): boolean {
  return (SHOP_WATCH_TYPES as readonly string[]).includes(r.type);
}

/** `data` of GET /api/research/watches. Rows of every type are kept; `useWatches().rows` keeps shop watches. */
export function normalizeWatches(raw: unknown): WatchesData {
  const d = isObj(raw) ? raw : {};
  const list = Array.isArray(d.rows) ? d.rows : [];
  const rows = list.map(normalizeWatchRow).filter((r): r is WatchSummary => r !== null);
  return {
    available: d.available !== false,
    alertsAvailable: d.alertsAvailable !== false,
    rows,
    quota: normalizeQuota(d.quota, rows.filter((r) => r.source === 'researchWatch').length),
    readingTimeUtc: str(d.readingTimeUtc) ?? '06:00',
  };
}

function listingLite(raw: unknown): WatchListingLite | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const title = decodeEntities(str(raw.title) ?? '');
  if (!id || !title) return null;
  const p = isObj(raw.price) ? raw.price : null;
  const amount = p ? num(p.amount) : null;
  const currency = p ? str(p.currency) : null;
  return {
    id,
    title,
    url: httpUrl(raw.url),
    thumbUrl: httpUrl(raw.thumbUrl),
    price: amount !== null && currency ? { amount, currency: currency.toUpperCase() } : null,
    favorites: Math.max(0, num(raw.favorites) ?? 0),
    createdAt: str(raw.createdAt),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string' && Boolean(t.trim())).map((t) => decodeEntities(t)) : [],
  };
}

/** `data` of GET /api/research/watches/[id]; `fallback` (the list row) stands in when `watch` is missing. */
export function normalizeDetail(raw: unknown, fallback: WatchSummary | null): WatchDetail | null {
  if (!isObj(raw)) return null;
  const watch = normalizeWatchRow(raw.watch) ?? fallback;
  if (!watch) return null;
  const shop = isObj(raw.shop) ? raw.shop : {};
  const sales: SalesPoint[] = [];
  const rawSales = Array.isArray(raw.sales) ? raw.sales : Array.isArray(raw.series) ? raw.series : null;
  if (rawSales) {
    for (const p of rawSales) {
      if (!isObj(p)) continue;
      const date = str(p.date);
      if (!date) continue;
      const dropped = p.dropped === true || p.flagged === true;
      const value = dropped ? null : num(p.value);
      // Guard 7 on the client too: a negative daily count is a counter reset, never a sale.
      const bad = value !== null && value < 0;
      sales.push({ date, value: bad ? null : value, dropped: dropped || bad });
    }
  }
  const fastest: FastestListing[] = [];
  if (Array.isArray(raw.fastest)) {
    for (const f of raw.fastest) {
      const base = listingLite(f);
      if (!base || !isObj(f)) continue;
      fastest.push({ ...base, favoritesDelta7d: toGuarded(f.favoritesDelta7d, 'measured'), shareOfSales: toGuarded(f.shareOfSales, 'estimate') });
    }
  }
  return {
    watch,
    shop: { since: str(shop.since), rating: num(shop.rating), reviewCount: num(shop.reviewCount) },
    sales: sales.slice(-30),
    newListings: Array.isArray(raw.newListings) ? raw.newListings.map(listingLite).filter((l): l is WatchListingLite => l !== null) : [],
    fastest,
    tagGap: Array.isArray(raw.tagGap)
      ? raw.tagGap
          .filter(isObj)
          .map((g) => ({ tag: decodeEntities(str(g.tag) ?? ''), count: Math.max(0, num(g.count) ?? 0), share: num(g.share) ?? 0 }))
          .filter((g) => g.tag)
      : [],
    tagGapAvailable: raw.tagGapAvailable !== false,
    listingsSampled: Math.max(0, num(raw.listingsSampled) ?? 0),
    listingsComplete: raw.listingsComplete !== false,
    ...(Array.isArray(raw.prices)
      ? {
          prices: raw.prices
            .filter(isObj)
            .map((p) => {
              const v = num(p.value);
              return { date: str(p.date) ?? '', value: v !== null && v > 0 ? v : null };
            })
            .filter((p) => p.date)
            .slice(-30),
        }
      : {}),
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────────────────────────────────────

async function readError(res: Response): Promise<ResearchFetchError> {
  let key: string | undefined;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: unknown; key?: unknown };
    if (typeof body?.key === 'string') key = body.key;
    if (typeof body?.error === 'string') code = body.error;
  } catch {
    /* non-JSON error body */
  }
  return new ResearchFetchError(res.status, key, code);
}

async function envelope<T>(url: string): Promise<ResearchResponse<T>> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!res.ok) throw await readError(res);
  const body = (await res.json()) as unknown;
  if (!isObj(body) || !('data' in body)) throw new ResearchFetchError(502);
  return body as unknown as ResearchResponse<T>;
}

export function watchUrl(id: string): string {
  return `${WATCHES_PATH}/${encodeURIComponent(id)}`;
}

export type UseWatches = {
  data: WatchesData | null;
  /** Shop watches only (etsyShop, ebaySeller), every marketplace. */
  rows: WatchSummary[];
  quota: WatchQuota | null;
  source: SourceNoteProps | null;
  errors: ResearchSectionError[];
  region: AsyncRegion;
  error: ResearchFetchError | null;
  isValidating: boolean;
  mutate: () => Promise<unknown>;
};

const NO_ROWS: WatchSummary[] = [];

/** The viewer's watches + quota (one key, all marketplaces; the page filters by marketplace). */
export function useWatches(enabled = true): UseWatches {
  const swr = useSWR<ResearchResponse<unknown>>(enabled ? WATCHES_PATH : null, envelope, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  });
  const data = React.useMemo(() => (swr.data ? normalizeWatches(swr.data.data) : null), [swr.data]);
  const rows = React.useMemo(() => (data ? data.rows.filter(isShopWatch) : NO_ROWS), [data]);
  const region = useAsyncRegion({ ...swr, data: data ?? undefined }, { isEmpty: (d) => !d || !d.rows.some(isShopWatch) });
  const mutate = swr.mutate;
  return {
    data,
    rows,
    quota: data?.quota ?? null,
    source: swr.data?.source ?? null,
    errors: errorsOf(swr.data),
    region,
    error: swr.error instanceof ResearchFetchError ? swr.error : swr.error ? new ResearchFetchError(0) : null,
    isValidating: swr.isValidating,
    mutate: React.useCallback(() => mutate(), [mutate]),
  };
}

export type UseWatchDetail = {
  data: WatchDetail | null;
  source: SourceNoteProps | null;
  errors: ResearchSectionError[];
  region: AsyncRegion;
};

/** One watch's panel data. `row` stands in for `watch` while (or if) the detail lacks it. */
export function useWatchDetail(id: string | null, row: WatchSummary | null): UseWatchDetail {
  const swr = useSWR<ResearchResponse<unknown>>(id ? watchUrl(id) : null, envelope, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    shouldRetryOnError: false,
  });
  const data = React.useMemo(() => (swr.data ? normalizeDetail(swr.data.data, row) : undefined), [swr.data, row]);
  const region = useAsyncRegion({ ...swr, data }, { isEmpty: (d) => !d, idle: 'empty' });
  return { data: data ?? null, source: swr.data?.source ?? null, errors: errorsOf(swr.data), region };
}

// ─── Writes (KolayXport rows only) ──────────────────────────────────────────────────────────────────────

async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<unknown> {
  return (await sendEnvelope(url, method, body)).data;
}

/** The write's `data` plus the envelope's section `errors` (e.g. the first reading was skipped). */
async function sendEnvelope(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<{ data: unknown; errors: ResearchSectionError[] }> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  if (res.status === 204) return { data: null, errors: [] };
  const json = (await res.json().catch(() => null)) as { data?: unknown; errors?: unknown } | null;
  const data = json && 'data' in json ? json.data ?? null : null;
  const errors = json && Array.isArray(json.errors)
    ? json.errors.filter(isObj).flatMap((e) => (typeof e.key === 'string' ? [{ section: typeof e.section === 'string' ? e.section : '', key: e.key } as ResearchSectionError] : []))
    : [];
  return { data, errors };
}

/** `data.watch` (contract) or the row itself. */
function watchOf(data: unknown): WatchSummary | null {
  return normalizeWatchRow(isObj(data) && 'watch' in data ? data.watch : data);
}

export type WatchCreateResult = {
  watch: WatchSummary | null;
  quota: WatchQuota | null;
  created: boolean;
  /** The first reading was skipped or failed (`section: 'reading'`): it is taken at the next daily run instead. */
  readingSkipped: boolean;
  errors: ResearchSectionError[];
};

/** POST /api/research/watches → the new (or already active) watch + the updated quota (+ first-reading errors). */
export async function createWatch(req: ShopWatchCreate): Promise<WatchCreateResult> {
  const { data, errors } = await sendEnvelope(WATCHES_PATH, 'POST', req);
  const d = isObj(data) ? data : {};
  return {
    watch: watchOf(data),
    quota: isObj(d.quota) ? normalizeQuota(d.quota, 0) : null,
    created: d.created !== false,
    readingSkipped: errors.some((e) => e.section === 'reading'),
    errors,
  };
}

export async function updateWatchAlerts(id: string, alertRules: AlertRules): Promise<WatchSummary | null> {
  return watchOf(await send(watchUrl(id), 'PATCH', { alertRules }));
}

export async function removeWatch(id: string): Promise<void> {
  await send(watchUrl(id), 'DELETE');
}

/** What a failed write means for the UI (pure). */
export type WatchErrorKind = 'quota' | 'duplicate' | 'notFound' | 'invalid' | 'unsupported' | 'readOnly' | 'budget' | 'rateLimited' | 'unavailable' | 'failed';

export function watchErrorKind(e: unknown): WatchErrorKind {
  if (!(e instanceof ResearchFetchError)) return 'failed';
  if (e.code === 'quota_exceeded' || e.code === 'quota' || e.key === 'research.shops.quotaFull' || e.status === 402) return 'quota';
  if (e.code === 'read_only') return 'readOnly';
  if (e.code === 'budget' || e.key === 'research.error.budget') return 'budget';
  if (e.code === 'unsupported' || e.status === 422) return 'unsupported';
  if (e.status === 409) return 'duplicate';
  if (e.status === 404) return 'notFound';
  if (e.status === 400) return 'invalid';
  if (e.status === 429) return 'rateLimited';
  if (e.status === 503 || e.status === 501) return 'unavailable';
  return 'failed';
}
