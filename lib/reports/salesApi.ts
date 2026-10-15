/**
 * Reports › Sales data (finance-analytics §6.1, M9 group A). Server-only.
 * Served by `GET /api/analytics?from=&to=…` (`pages/api/analytics/index.ts`); the legacy
 * `dateRange|month|day` shape of that route is unchanged until the §8 cleanup.
 *
 * Fixes from §0.4:
 * - B1 series ascending, zero-filled in JS over every local day/hour of the range, no LIMIT.
 * - B2 day/hour keys in the seller's time zone: window bounds are local midnights (`zonedMidnight`),
 *   grouping uses `(ts AT TIME ZONE 'UTC') AT TIME ZONE $tz` (the columns are UTC-stored `timestamp`).
 * - B3 one `where` for both windows (same order date, same store filter, same listed-order rule).
 * - B4 deltas are null when the previous value is 0.
 * - B5 top products grouped by sku ‖ product name, units = SUM(quantity), image, top 10.
 * - B6/B7 no "customers", no monthly stats.
 * - B8 stores bucketed by `canonicalStore()` with the user's `EtsyShop.shopName` list.
 *
 * The order set is the Orders page's (`/api/orders` base clause, `LISTED_ORDER_SQL`): unpaid states
 * and NULL status are not counted; cancelled / refunded orders are counted and show in `statuses`.
 *
 * Shared definitions are imported, never copied (CRITIQUE C4, C5): FX `lib/fx.ts`, stores
 * `lib/marketplaces/canonical.ts`, listed-order rule `lib/orders/views.ts`, local midnight
 * `lib/overview/summary.ts`, day keys / comparison window / granularity `lib/reports/dayMath.ts`.
 */
import prisma from '@/lib/prisma';
import { convertToBase, getExchangeRates, normalizeCurrency, type FxRates, type RatesSnapshot } from '@/lib/fx';
import { canonicalStore, type CanonicalStore } from '@/lib/marketplaces/canonical';
import { LISTED_ORDER_SQL } from '@/lib/orders/views';
import { zonedMidnight } from '@/lib/overview/summary';
import { DEFAULT_TIMEZONE, isValidTimezone } from '@/lib/notificationCenter/time';
import { decodeEntities } from '@/lib/text/decodeEntities';
import {
  addDays,
  dayParts,
  dayUtcMs,
  diffDays,
  effectiveGranularityForDays,
  isDayKey,
  previousWindow as sharedPreviousWindow,
  rangeDays,
} from './dayMath';
import type {
  SalesBucket,
  SalesCurrency,
  SalesGranularity,
  SalesProductRow,
  SalesReportResponse,
  SalesStatusRow,
  SalesStoreRef,
  SalesStoreRow,
  SalesTotals,
} from './salesTypes';

/* -------------------------------------------------------------- constants */

export const SALES_CURRENCIES: readonly SalesCurrency[] = ['TRY', 'USD', 'EUR'];
export const SALES_GRANULARITIES: readonly SalesGranularity[] = ['hour', 'day', 'week', 'month'];
export const SALES_DEFAULT_TZ = DEFAULT_TIMEZONE;
/** Longest accepted range ("Last year" + a leap day + slack). Longer → 400 `range_too_long`. */
export const SALES_MAX_RANGE_DAYS = 732;
export const SALES_TOP_PRODUCTS = 10;
export const FX_SOURCE = 'exchangerate-api.com' as const;
const PLACEHOLDER_IMAGE = '/placeholder.png';

/* ------------------------------------------------------------- date keys */
// Day arithmetic, the comparison window and the granularity rules are the shared `./dayMath` (also behind the
// client's `dateRange.ts`), so `previousRange` here and the UI fallback label follow one rule (CRITIQUE C4/C5).

/** A real calendar day `YYYY-MM-DD` inside the accepted years (2000–2100). */
export function isDateKey(v: unknown): v is string {
  if (!isDayKey(v)) return false;
  const y = dayParts(v)[0];
  return y >= 2000 && y <= 2100;
}

/** Every day key of `from..to`, oldest first. */
export function dayKeys(from: string, to: string): string[] {
  const n = rangeDays(from, to);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

/** Monday of the ISO week containing `k` (Postgres `date_trunc('week')`). */
export function weekStart(k: string): string {
  const dow = new Date(dayUtcMs(k)).getUTCDay(); // 0 = Sunday
  return addDays(k, -((dow + 6) % 7));
}

/**
 * The comparison window when the request has no `compareFrom`/`compareTo` (finance §4.2, `./dayMath`): the
 * previous period of equal length (a single day → the previous day), a whole calendar month → the whole previous
 * month. The This month preset's same-days-of-last-month window cannot be told apart from e.g. Last 7 days on the
 * 7th, so the client sends it explicitly.
 */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  return sharedPreviousWindow(from, to);
}

/** A requested override when the UI could offer it for this range (same set as the client control), else auto. */
export function resolveGranularity(requested: unknown, days: number): SalesGranularity {
  return effectiveGranularityForDays(days, requested);
}

/* --------------------------------------------------------------- buckets */

export interface BucketPlan {
  /** Keys of the current window that fall in each bucket (day or hour keys). */
  current: string[][];
  /** Same index: keys of the previous window, shifted by the window offset (may be shorter at the end). */
  previous: string[][];
}

const hourKeys = (day: string) => Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}`);

/**
 * Bucket plan for the chart. Current buckets cover `from..to` exactly (edge weeks/months are
 * clipped to the range). Previous bucket `i` holds the previous-window days at the same offsets
 * from the window start; days past the previous window's end are dropped, so the series lines up
 * by index while `previousTotals` still covers the whole previous window.
 */
export function planBuckets(
  from: string,
  to: string,
  prev: { from: string; to: string },
  granularity: SalesGranularity,
): BucketPlan {
  if (granularity === 'hour') {
    const cur = dayKeys(from, to).flatMap(hourKeys);
    const prevHours = dayKeys(prev.from, prev.to).flatMap(hourKeys);
    return { current: cur.map((k) => [k]), previous: cur.map((_, i) => (i < prevHours.length ? [prevHours[i]] : [])) };
  }
  const days = dayKeys(from, to);
  const groups: string[][] = [];
  let lastLabel = '';
  for (const d of days) {
    const label = granularity === 'day' ? d : granularity === 'week' ? weekStart(d) : d.slice(0, 7);
    if (label !== lastLabel || groups.length === 0) {
      groups.push([]);
      lastLabel = label;
    }
    groups[groups.length - 1].push(d);
  }
  const prevLen = rangeDays(prev.from, prev.to);
  const previous = groups.map((g) =>
    g.map((d) => diffDays(from, d)).filter((i) => i < prevLen).map((i) => addDays(prev.from, i)),
  );
  return { current: groups, previous };
}

/* ----------------------------------------------------------------- parse */

export interface SalesParams {
  from: string;
  to: string;
  tz: string;
  currency: SalesCurrency;
  granularity: SalesGranularity;
  /** Canonical store keys; null = all stores. */
  stores: string[] | null;
  previous: { from: string; to: string };
}

export type ParseResult = { ok: true; params: SalesParams } | { ok: false; error: 'invalid_range' | 'range_too_long' | 'invalid_compare' };

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** `true` when the request asks for the Reports shape (any of `from` / `to` present). */
export function isSalesReportQuery(query: Record<string, unknown>): boolean {
  return query.from !== undefined || query.to !== undefined;
}

/**
 * Query → params. `from`/`to` required (YYYY-MM-DD, from ≤ to, ≤ 732 days); `tz` IANA (else
 * Europe/Istanbul); `currency` TRY|USD|EUR (else TRY); `granularity` an allowed override (else auto);
 * `stores` comma list of canonical keys (empty → all); `compareFrom`/`compareTo` optional override of
 * the comparison window (both or neither, equal-or-shorter-than-range rules not enforced, must end
 * before `from`).
 */
export function parseSalesQuery(query: Record<string, unknown>): ParseResult {
  const from = first(query.from);
  const to = first(query.to);
  if (!isDateKey(from) || !isDateKey(to) || from > to) return { ok: false, error: 'invalid_range' };
  const days = rangeDays(from, to);
  if (days > SALES_MAX_RANGE_DAYS) return { ok: false, error: 'range_too_long' };

  const tzRaw = first(query.tz);
  const tz = isValidTimezone(tzRaw) ? tzRaw : SALES_DEFAULT_TZ;

  const curRaw = String(first(query.currency) ?? '').trim().toUpperCase();
  const currency = (SALES_CURRENCIES as readonly string[]).includes(curRaw) ? (curRaw as SalesCurrency) : 'TRY';

  const storesRaw = first(query.stores);
  const stores =
    typeof storesRaw === 'string'
      ? Array.from(new Set(storesRaw.split(',').map((s) => s.trim().toLocaleLowerCase('en')).filter(Boolean)))
      : [];

  const cf = first(query.compareFrom);
  const ct = first(query.compareTo);
  let previous = previousWindow(from, to);
  if (cf !== undefined || ct !== undefined) {
    if (!isDateKey(cf) || !isDateKey(ct) || cf > ct || ct >= from || rangeDays(cf, ct) > SALES_MAX_RANGE_DAYS) {
      return { ok: false, error: 'invalid_compare' };
    }
    previous = { from: cf, to: ct };
  }

  return {
    ok: true,
    params: {
      from,
      to,
      tz,
      currency,
      granularity: resolveGranularity(first(query.granularity), days),
      stores: stores.length ? stores : null,
      previous,
    },
  };
}

/* ------------------------------------------------------------------- SQL */
// Each statement starts with a `/* sales:<name> */` tag (log readability and test dispatch).
// Params: $1 userId · $2/$3 current window [start, end) · $4/$5 previous window · ISO strings.

const TS = `COALESCE(o."uiOrderDate", o."createdAt")`;
const utc = (n: number) => `($${n}::timestamptz AT TIME ZONE 'UTC')`;
const inWindow = (a: number, b: number) => `(${TS} >= ${utc(a)} AND ${TS} < ${utc(b)})`;
const BOTH_WINDOWS = `(${inWindow(2, 3)} OR ${inWindow(4, 5)})`;
const KIND = `CASE WHEN ${inWindow(2, 3)} THEN 'cur' ELSE 'prev' END`;
const CURRENCY = `UPPER(COALESCE(NULLIF(BTRIM(o."currency"), ''), 'TRY'))`;
/** Store filter on the raw `Order.marketplace` values resolved from canonical keys. */
const storeSql = (n: number) => `AND o."marketplace" = ANY($${n}::text[])`;
const localKey = (tzParam: number, granularity: SalesGranularity) =>
  `to_char((${TS} AT TIME ZONE 'UTC') AT TIME ZONE $${tzParam}, '${granularity === 'hour' ? 'YYYY-MM-DD"T"HH24' : 'YYYY-MM-DD'}')`;

/** Raw marketplace values with orders in either window (store options, store filter resolution). $1–$5. */
export const STORES_SQL = `/* sales:stores */
SELECT DISTINCT o."marketplace" AS "marketplace"
FROM "Order" o
WHERE o."userId" = $1 AND ${LISTED_ORDER_SQL} AND ${BOTH_WINDOWS}`;

/** Orders and revenue per window × local day (or hour) × currency. $1–$5, $6 tz, [$7 stores]. */
export function seriesSql(granularity: SalesGranularity, filtered: boolean): string {
  return `/* sales:series */
SELECT ${KIND} AS "kind", ${localKey(6, granularity)} AS "key", ${CURRENCY} AS "currency",
  COUNT(*) AS "orders", COALESCE(SUM(o."totalPrice"), 0)::float8 AS "amount"
FROM "Order" o
WHERE o."userId" = $1 AND ${LISTED_ORDER_SQL} AND ${BOTH_WINDOWS} ${filtered ? storeSql(7) : ''}
GROUP BY 1, 2, 3`;
}

/** Current window per raw marketplace × currency. $1–$3, [$4 stores]. */
export function byStoreSql(filtered: boolean): string {
  return `/* sales:byStore */
SELECT o."marketplace" AS "marketplace", ${CURRENCY} AS "currency",
  COUNT(*) AS "orders", COALESCE(SUM(o."totalPrice"), 0)::float8 AS "amount"
FROM "Order" o
WHERE o."userId" = $1 AND ${LISTED_ORDER_SQL} AND ${inWindow(2, 3)} ${filtered ? storeSql(4) : ''}
GROUP BY 1, 2`;
}

/** Units (SUM(quantity)) per window × raw marketplace. $1–$5, [$6 stores]. */
export function unitsSql(filtered: boolean): string {
  return `/* sales:units */
SELECT ${KIND} AS "kind", o."marketplace" AS "marketplace", COALESCE(SUM(i."quantity"), 0) AS "units"
FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
WHERE o."userId" = $1 AND ${LISTED_ORDER_SQL} AND ${BOTH_WINDOWS} ${filtered ? storeSql(6) : ''}
GROUP BY 1, 2`;
}

/** Current window per product key × currency. $1–$3, [$4 stores]. */
export function productsSql(filtered: boolean): string {
  return `/* sales:products */
SELECT COALESCE(NULLIF(BTRIM(i."sku"), ''), LOWER(NULLIF(BTRIM(i."productName"), ''))) AS "key",
  MAX(i."productName") AS "name", MAX(NULLIF(BTRIM(i."sku"), '')) AS "sku",
  MAX(NULLIF(NULLIF(i."image", ''), '${PLACEHOLDER_IMAGE}')) AS "image",
  ${CURRENCY} AS "currency",
  COALESCE(SUM(i."quantity"), 0) AS "units", COUNT(DISTINCT i."orderId") AS "orders",
  COALESCE(SUM(COALESCE(i."totalPrice", i."unitPrice" * i."quantity", 0)), 0)::float8 AS "amount"
FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
WHERE o."userId" = $1 AND ${LISTED_ORDER_SQL} AND ${inWindow(2, 3)} ${filtered ? storeSql(4) : ''}
  AND COALESCE(NULLIF(BTRIM(i."sku"), ''), NULLIF(BTRIM(i."productName"), '')) IS NOT NULL
GROUP BY 1, 5`;
}

/** Current window per raw status × raw marketplace. $1–$3, [$4 stores]. */
export function statusesSql(filtered: boolean): string {
  return `/* sales:statuses */
SELECT o."status" AS "raw", o."marketplace" AS "marketplace", COUNT(*) AS "count"
FROM "Order" o
WHERE o."userId" = $1 AND ${LISTED_ORDER_SQL} AND ${inWindow(2, 3)} ${filtered ? storeSql(4) : ''}
GROUP BY 1, 2`;
}

/* ------------------------------------------------------------- raw rows */

export interface SeriesRow { kind: string; key: string; currency: string | null; orders: unknown; amount: unknown }
export interface ByStoreRow { marketplace: string | null; currency: string | null; orders: unknown; amount: unknown }
export interface UnitsRow { kind: string; marketplace: string | null; units: unknown }
export interface ProductRow { key: string; name: string | null; sku: string | null; image: string | null; currency: string | null; units: unknown; orders: unknown; amount: unknown }
export interface StatusRow { raw: string | null; marketplace: string | null; count: unknown }

export interface SalesRawData {
  series: SeriesRow[];
  byStore: ByStoreRow[];
  units: UnitsRow[];
  products: ProductRow[];
  statuses: StatusRow[];
  /** Raw marketplace values with orders in either window (unfiltered). */
  marketplaces: Array<string | null>;
}

/* --------------------------------------------------------------- helpers */

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'bigint' ? Number(v) : Number(typeof v === 'object' ? String(v) : v);
  return Number.isFinite(n) ? n : 0;
}

function count(v: unknown): number {
  const n = num(v);
  return n > 0 ? Math.floor(n) : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** (cur − prev) / prev as a fraction, rounded to 4 places; null when prev is 0 (B4). */
export function delta(cur: number, prev: number): number | null {
  if (!prev || !Number.isFinite(prev) || !Number.isFinite(cur)) return null;
  return Math.round(((cur - prev) / prev) * 10_000) / 10_000;
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = decodeEntities(v).trim();
  return s || null;
}

/**
 * Raw `Order.marketplace` values whose canonical key is in `stores` (case-insensitive key match).
 * Empty array = the filter matches nothing (the UI shows "No stores match this filter").
 */
export function resolveStoreFilter(
  stores: readonly string[],
  marketplaces: ReadonlyArray<string | null>,
  etsyShopNames: readonly string[],
): string[] {
  const wanted = new Set(stores.map((s) => s.toLocaleLowerCase('en')));
  const out = new Set<string>();
  for (const raw of marketplaces) {
    if (typeof raw !== 'string') continue;
    if (wanted.has(canonicalStore(raw, etsyShopNames).key.toLocaleLowerCase('en'))) out.add(raw);
  }
  return Array.from(out);
}

/* ---------------------------------------------------------------- build */

export interface BuildInput {
  params: SalesParams;
  rates: RatesSnapshot;
  etsyShopNames: readonly string[];
  raw: SalesRawData;
  now?: Date;
}

interface Acc { orders: number; revenue: number; converted: number }

/** Pure: raw rows → the response. */
export function buildSalesReport({ params, rates, etsyShopNames, raw, now = new Date() }: BuildInput): SalesReportResponse {
  const { currency } = params;
  const fxRates: FxRates = rates.rates;
  const convert = (amount: number, cur: string | null) => convertToBase(amount, cur, fxRates, currency);
  const canConvert = (cur: string | null) => convertToBase(1, cur, fxRates, currency) !== null;
  const storeOf = (mp: string | null): CanonicalStore => canonicalStore(mp, etsyShopNames);

  // Series + totals.
  const perKey = { cur: new Map<string, Acc>(), prev: new Map<string, Acc>() };
  const totals = { cur: { orders: 0, revenue: 0, converted: 0 }, prev: { orders: 0, revenue: 0, converted: 0 } };
  const excluded = new Map<string, number>();
  for (const r of raw.series) {
    const kind = r.kind === 'cur' ? 'cur' : 'prev';
    const orders = count(r.orders);
    const value = convert(num(r.amount), r.currency);
    const ok = value !== null && canConvert(r.currency);
    const t = totals[kind];
    t.orders += orders;
    if (ok) {
      t.revenue += value as number;
      t.converted += orders;
    } else if (kind === 'cur' && orders > 0) {
      const c = normalizeCurrency(r.currency);
      excluded.set(c, (excluded.get(c) ?? 0) + orders);
    }
    const m = perKey[kind];
    const a = m.get(r.key) ?? { orders: 0, revenue: 0, converted: 0 };
    a.orders += orders;
    if (ok) a.revenue += value as number;
    m.set(r.key, a);
  }

  const plan = planBuckets(params.from, params.to, params.previous, params.granularity);
  const toBucket = (keys: string[], map: Map<string, Acc>, fallbackStart: string): SalesBucket => {
    let orders = 0;
    let revenue = 0;
    for (const k of keys) {
      const a = map.get(k);
      if (a) {
        orders += a.orders;
        revenue += a.revenue;
      }
    }
    return {
      bucketStart: keys[0] ?? fallbackStart,
      bucketEnd: keys[keys.length - 1] ?? fallbackStart,
      orders,
      revenue: round2(revenue),
    };
  };
  const series = plan.current.map((keys) => toBucket(keys, perKey.cur, params.from));
  // A previous bucket with no days (the previous window is shorter: 1–31 Mar vs 1–28 Feb) is null — a gap, not
  // a zero point labelled with the previous window's last day.
  const previousSeries = plan.previous.map((keys) => (keys.length ? toBucket(keys, perKey.prev, params.previous.to) : null));

  // Units per window and per store.
  const units = { cur: 0, prev: 0 };
  const unitsByStore = new Map<string, number>();
  for (const r of raw.units) {
    const u = count(r.units);
    if (r.kind === 'cur') {
      units.cur += u;
      const key = storeOf(r.marketplace).key;
      unitsByStore.set(key, (unitsByStore.get(key) ?? 0) + u);
    } else {
      units.prev += u;
    }
  }

  const aov = (t: Acc) => (t.converted > 0 ? t.revenue / t.converted : 0);
  const cur = totals.cur;
  const prev = totals.prev;

  // Stores.
  const storeMap = new Map<string, SalesStoreRef & { orders: number; revenue: number; converted: number; excluded: number; byCurrency: Record<string, number> }>();
  for (const r of raw.byStore) {
    const s = storeOf(r.marketplace);
    const e = storeMap.get(s.key) ?? { ...s, orders: 0, revenue: 0, converted: 0, excluded: 0, byCurrency: {} };
    const orders = count(r.orders);
    const amount = num(r.amount);
    const c = normalizeCurrency(r.currency);
    const value = convert(amount, r.currency);
    e.orders += orders;
    e.byCurrency[c] = (e.byCurrency[c] ?? 0) + amount;
    if (value !== null && canConvert(r.currency)) {
      e.revenue += value;
      e.converted += orders;
    } else {
      e.excluded += orders;
    }
    storeMap.set(s.key, e);
  }
  const stores: SalesStoreRow[] = Array.from(storeMap.values())
    .map((e) => ({
      key: e.key,
      marketplace: e.marketplace,
      shopName: e.shopName,
      orders: e.orders,
      units: unitsByStore.get(e.key) ?? 0,
      revenue: round2(e.revenue),
      byCurrency: Object.fromEntries(Object.entries(e.byCurrency).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, round2(v)])),
      aov: e.converted > 0 ? round2(e.revenue / e.converted) : null,
      share: cur.revenue > 0 ? Math.round((e.revenue / cur.revenue) * 10_000) / 10_000 : null,
      excludedOrders: e.excluded,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || a.key.localeCompare(b.key));

  // Available stores (unfiltered, both windows), stable order by key.
  const available = new Map<string, SalesStoreRef>();
  for (const mp of raw.marketplaces) {
    const s = storeOf(mp);
    if (!available.has(s.key)) available.set(s.key, s);
  }

  // Products.
  const prodMap = new Map<string, SalesProductRow>();
  for (const r of raw.products) {
    if (!r.key) continue;
    const e = prodMap.get(r.key) ?? { key: r.key, name: null, sku: null, image: null, units: 0, orders: 0, revenue: 0 };
    e.name = e.name ?? cleanText(r.name);
    e.sku = e.sku ?? cleanText(r.sku);
    e.image = e.image ?? cleanText(r.image);
    e.units += count(r.units);
    e.orders += count(r.orders);
    const value = convert(num(r.amount), r.currency);
    if (value !== null && canConvert(r.currency)) e.revenue += value;
    prodMap.set(r.key, e);
  }
  const products = Array.from(prodMap.values())
    .map((p) => ({ ...p, revenue: round2(p.revenue) }))
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.key.localeCompare(b.key))
    .slice(0, SALES_TOP_PRODUCTS);

  // Statuses: merged per (raw, canonical marketplace).
  const statusMap = new Map<string, SalesStatusRow>();
  for (const r of raw.statuses) {
    const marketplace = storeOf(r.marketplace).marketplace;
    const rawStatus = typeof r.raw === 'string' ? r.raw : null;
    const k = `${rawStatus ?? ''}\u0000${marketplace}`;
    const e = statusMap.get(k) ?? { raw: rawStatus, marketplace, count: 0 };
    e.count += count(r.count);
    statusMap.set(k, e);
  }
  const statuses = Array.from(statusMap.values()).sort((a, b) => b.count - a.count);

  const rate = (code: string) => {
    const v = Number(fxRates[code]);
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  const curAov = aov(cur);
  const prevAov = aov(prev);
  const previousTotals: SalesTotals = { revenue: round2(prev.revenue), orders: prev.orders, aov: round2(prevAov), units: units.prev };

  return {
    version: 2,
    generatedAt: now.toISOString(),
    currency,
    range: { from: params.from, to: params.to, tz: params.tz, granularity: params.granularity, days: rangeDays(params.from, params.to) },
    previousRange: params.previous,
    totals: {
      revenue: round2(cur.revenue),
      orders: cur.orders,
      aov: round2(curAov),
      units: units.cur,
      revenueDelta: delta(cur.revenue, prev.revenue),
      ordersDelta: delta(cur.orders, prev.orders),
      aovDelta: delta(curAov, prevAov),
      unitsDelta: delta(units.cur, units.prev),
      convertedOrders: cur.converted,
    },
    previousTotals,
    storesIncluded: stores.filter((s) => s.orders > 0).map((s) => s.key),
    availableStores: Array.from(available.values()).sort((a, b) => a.key.localeCompare(b.key)),
    fx: {
      source: FX_SOURCE,
      asOf: rates.asOf ? new Date(rates.asOf).toISOString() : null,
      stale: rates.stale,
      rates: { USD: rate('USD'), EUR: rate('EUR') },
      excluded: Array.from(excluded.entries())
        .map(([c, orders]) => ({ currency: c, orders }))
        .sort((a, b) => b.orders - a.orders || a.currency.localeCompare(b.currency)),
    },
    series,
    previousSeries,
    stores,
    products,
    statuses,
  };
}

/* ------------------------------------------------------------------ load */

/** UTC instants of the local window `[from 00:00, to+1 00:00)` in `tz`, as ISO strings. */
export function windowBounds(from: string, to: string, tz: string): [string, string] {
  const [fy, fm, fd] = dayParts(from);
  const [ty, tm, td] = dayParts(addDays(to, 1));
  return [zonedMidnight(fy, fm, fd, tz).toISOString(), zonedMidnight(ty, tm, td, tz).toISOString()];
}

/** Loads every raw row for `params` and builds the response. Throws on a DB error (the route answers 500). */
export async function getSalesReport(userId: string, params: SalesParams, now: Date = new Date()): Promise<SalesReportResponse> {
  const [curStart, curEnd] = windowBounds(params.from, params.to, params.tz);
  const [prevStart, prevEnd] = windowBounds(params.previous.from, params.previous.to, params.tz);
  const base = [userId, curStart, curEnd, prevStart, prevEnd] as const;
  const cur3 = [userId, curStart, curEnd] as const;

  const [shops, marketplaceRows, rates] = await Promise.all([
    prisma.etsyShop.findMany({ where: { userId }, select: { shopName: true } }),
    prisma.$queryRawUnsafe<Array<{ marketplace: string | null }>>(STORES_SQL, ...base),
    getExchangeRates(),
  ]);
  const etsyShopNames = shops.map((s) => (s.shopName ?? '').trim()).filter(Boolean);
  const marketplaces = marketplaceRows.map((r) => r.marketplace);

  const filter = params.stores ? resolveStoreFilter(params.stores, marketplaces, etsyShopNames) : null;
  const f = filter !== null;
  const extra = f ? [filter] : [];

  const [series, byStore, units, products, statuses] = await Promise.all([
    prisma.$queryRawUnsafe<SeriesRow[]>(seriesSql(params.granularity, f), ...base, params.tz, ...extra),
    prisma.$queryRawUnsafe<ByStoreRow[]>(byStoreSql(f), ...cur3, ...extra),
    prisma.$queryRawUnsafe<UnitsRow[]>(unitsSql(f), ...base, ...extra),
    prisma.$queryRawUnsafe<ProductRow[]>(productsSql(f), ...cur3, ...extra),
    prisma.$queryRawUnsafe<StatusRow[]>(statusesSql(f), ...cur3, ...extra),
  ]);

  return buildSalesReport({
    params,
    rates,
    etsyShopNames,
    raw: { series, byStore, units, products, statuses, marketplaces },
    now,
  });
}
