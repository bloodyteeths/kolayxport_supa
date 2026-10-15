// lib/reports/useSalesReport.ts — finance-analytics §6.1 / §6.3 (M9 Group C). Client data layer of Reports › Sales.
//
// `GET /api/analytics?from&to&tz&stores&currency&granularity[&compareFrom&compareTo]` (new params; the legacy
// `dateRange|month|day` shape keeps serving the legacy page). `compareFrom/compareTo` only for the This month preset.
// SWR key `['/api/analytics', from, to, tz, stores, currency, granularity, compare]`,
// `keepPreviousData` (a range change keeps the old numbers dimmed instead of a skeleton, §3).
//
// The response type below is the §6.1 contract Group A implements. `normalizeSalesReport` reads it defensively
// (missing arrays → [], `byCurrency` as an array or a map, non-finite numbers → 0, a delta that is not a finite
// number → null), so a partial rollout of the API never crashes the page.
import useSWR from 'swr';
import type { MarketplaceKey } from '@/components/ds/data/types';
import type { DayKey, DayRange, Granularity } from './dateRange';

export const SALES_REPORT_PATH = '/api/analytics';
export const SALES_CURRENCIES = ['TRY', 'USD', 'EUR'] as const;
export type SalesCurrency = (typeof SALES_CURRENCIES)[number];

export type SalesStoreMarketplace = MarketplaceKey | 'manual' | 'other';

export interface SalesTotals {
  revenue: number;
  /** Fraction vs the previous window; null when the previous window had nothing (B4). */
  revenueDelta: number | null;
  orders: number;
  ordersDelta: number | null;
  aov: number;
  aovDelta: number | null;
  units: number;
  unitsDelta: number | null;
}

export interface SalesFx {
  source: string;
  /** ISO instant of the rates. */
  asOf: string | null;
  stale: boolean;
  rates: Partial<Record<string, number>>;
  /** Orders left out of the converted totals: no rate for their currency. */
  excluded: { currency: string; orders: number }[];
}

export interface SalesBucket {
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH` (hour buckets), in the request `tz`, ascending, zero-filled. */
  bucketStart: string;
  /** Last local day of the bucket inside its window (inclusive); null when the API did not send it. */
  bucketEnd: string | null;
  orders: number;
  revenue: number;
}

export interface SalesStoreRow {
  /** Canonical store key (`lib/marketplaces/canonical.ts`): `etsy`, `etsy:bellecouturegifts`, `manual`, `other:veeqo`. */
  key: string;
  marketplace: SalesStoreMarketplace;
  shopName: string | null;
  orders: number;
  units: number;
  /** In the requested `currency` (converted). */
  revenue: number;
  /** Original per-currency totals, never summed. */
  byCurrency: { currency: string; revenue: number }[];
  /** null when no order of the store could be converted. */
  aov: number | null;
  /** Revenue share 0–1; null when the total is 0. */
  share: number | null;
  /** Orders of this store left out of `revenue` (no exchange rate). */
  excludedOrders: number;
  /**
   * The exact `Order.marketplace` values merged into this row (the Orders store filter is an exact match).
   * null until the Sales API sends `rawMarketplaces` (Group A follow-up); the store link then only covers rows whose
   * raw value is known exactly.
   */
  rawMarketplaces: string[] | null;
}

export interface SalesStoreRef {
  key: string;
  marketplace: SalesStoreMarketplace;
  shopName: string | null;
}

export interface SalesProductRow {
  key: string;
  name: string;
  sku: string | null;
  image: string | null;
  units: number;
  revenue: number;
}

export interface SalesStatusRow {
  raw: string;
  marketplace: string | null;
  count: number;
}

export interface SalesReport {
  generatedAt: string;
  storesIncluded: string[];
  /** Every store with orders in either window, ignoring the store filter (Store filter options). */
  availableStores: SalesStoreRef[];
  /** The comparison window the deltas and `previousSeries` use (label the delta from it). */
  previousRange: { from: string; to: string } | null;
  currency: string;
  granularity: Granularity | null;
  totals: SalesTotals;
  fx: SalesFx;
  series: SalesBucket[];
  /** Same length as `series`, aligned by index. */
  /** Aligned by index with `series`; null where the (shorter) previous window has no bucket — draw a gap. */
  previousSeries: Array<SalesBucket | null>;
  stores: SalesStoreRow[];
  products: SalesProductRow[];
  statuses: SalesStatusRow[];
  /** Server request id for "Copy error ID" (optional). */
  requestId?: string;
}

export interface SalesReportParams {
  from: DayKey;
  to: DayKey;
  tz: string;
  /** Canonical store keys; empty = all stores. */
  stores: string[];
  currency: SalesCurrency;
  granularity: Granularity;
  /**
   * Explicit comparison window (`compareFrom`/`compareTo`), only when the server's own rule would differ — the
   * This month preset (`salesCompareWindow` in `dateRange.ts`). Omitted → the server's equal-length rule.
   */
  compare?: DayRange | null;
}

/** A failed request, with the server's request id when the body carried one. */
export class SalesReportError extends Error {
  status: number | null;
  requestId: string | null;
  constructor(status: number | null, requestId: string | null = null) {
    super(status == null ? 'Failed to load sales report (network)' : `Failed to load sales report (${status})`);
    this.name = 'SalesReportError';
    this.status = status;
    this.requestId = requestId;
  }
}

/** Pure: the request URL for a parameter set (stores sorted so the key is stable). */
export function salesReportUrl(p: SalesReportParams): string {
  const qs = new URLSearchParams({ from: p.from, to: p.to, tz: p.tz, currency: p.currency, granularity: p.granularity });
  const stores = [...p.stores].filter(Boolean).sort();
  if (stores.length) qs.set('stores', stores.join(','));
  if (p.compare) {
    qs.set('compareFrom', p.compare.from);
    qs.set('compareTo', p.compare.to);
  }
  return `${SALES_REPORT_PATH}?${qs.toString()}`;
}

/** Pure: the SWR key of §6.3. */
export function salesReportKey(p: SalesReportParams): readonly [string, string, string, string, string, string, string, string] {
  const compare = p.compare ? `${p.compare.from}..${p.compare.to}` : '';
  return [SALES_REPORT_PATH, p.from, p.to, p.tz, [...p.stores].sort().join(','), p.currency, p.granularity, compare] as const;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const delta = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

function byCurrency(v: unknown): { currency: string; revenue: number }[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => obj(x))
      .map((x) => ({ currency: (str(x.currency) ?? '').toUpperCase(), revenue: num(x.revenue ?? x.amount ?? x.total) }))
      .filter((x) => x.currency);
  }
  return Object.entries(obj(v)).map(([currency, revenue]) => ({ currency: currency.toUpperCase(), revenue: num(revenue) }));
}

function bucket(v: unknown): SalesBucket {
  const b = obj(v);
  return { bucketStart: str(b.bucketStart) ?? '', bucketEnd: str(b.bucketEnd), orders: num(b.orders), revenue: num(b.revenue) };
}

const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const STORE_MPS = new Set(['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'n11', 'manual', 'other']);

function storeRef(x: unknown): SalesStoreRef {
  const s = obj(x);
  const mp = str(s.marketplace)?.toLowerCase() ?? 'other';
  return { key: str(s.key) ?? mp, marketplace: (STORE_MPS.has(mp) ? mp : 'other') as SalesStoreMarketplace, shopName: str(s.shopName) };
}

/** Pure: tolerant read of the §6.1 response. */
export function normalizeSalesReport(raw: unknown): SalesReport {
  const r = obj(raw);
  const t = obj(r.totals);
  const fx = obj(r.fx);
  const rates = obj(fx.rates);
  return {
    generatedAt: str(r.generatedAt) ?? new Date().toISOString(),
    storesIncluded: arr<unknown>(r.storesIncluded).filter((s): s is string => typeof s === 'string'),
    availableStores: arr<unknown>(r.availableStores).map(storeRef),
    previousRange: (() => {
      const pr = obj(r.previousRange);
      return typeof pr.from === 'string' && typeof pr.to === 'string' && DAY.test(pr.from) && DAY.test(pr.to) ? { from: pr.from, to: pr.to } : null;
    })(),
    currency: (str(r.currency) ?? 'TRY').toUpperCase(),
    granularity: (['hour', 'day', 'week', 'month'] as const).find((g) => g === r.granularity) ?? null,
    totals: {
      revenue: num(t.revenue),
      revenueDelta: delta(t.revenueDelta),
      orders: num(t.orders),
      ordersDelta: delta(t.ordersDelta),
      aov: num(t.aov),
      aovDelta: delta(t.aovDelta),
      units: num(t.units),
      unitsDelta: delta(t.unitsDelta),
    },
    fx: {
      source: str(fx.source) ?? 'exchangerate-api.com',
      asOf: str(fx.asOf),
      stale: fx.stale === true,
      rates: Object.fromEntries(Object.entries(rates).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>,
      excluded: arr<unknown>(fx.excluded)
        .map((x) => obj(x))
        .map((x) => ({ currency: (str(x.currency) ?? '').toUpperCase(), orders: num(x.orders) }))
        .filter((x) => x.currency && x.orders > 0),
    },
    series: arr<unknown>(r.series).map(bucket),
    previousSeries: arr<unknown>(r.previousSeries).map((b) => (b == null ? null : bucket(b))),
    stores: arr<unknown>(r.stores).map((x) => {
      const s = obj(x);
      const share = optNum(s.share);
      return {
        ...storeRef(x),
        orders: num(s.orders),
        units: num(s.units),
        revenue: num(s.revenue),
        byCurrency: byCurrency(s.byCurrency),
        aov: optNum(s.aov),
        share: share == null ? null : Math.min(1, Math.max(0, share)),
        excludedOrders: num(s.excludedOrders),
        rawMarketplaces: Array.isArray(s.rawMarketplaces)
          ? Array.from(new Set(s.rawMarketplaces.filter((m): m is string => typeof m === 'string' && m.trim() !== '')))
          : null,
      };
    }),
    products: arr<unknown>(r.products).map((x, i) => {
      const p = obj(x);
      const name = str(p.name) ?? str(p.sku) ?? '';
      return { key: str(p.key) ?? `${str(p.sku) ?? name}#${i}`, name, sku: str(p.sku), image: str(p.image), units: num(p.units), revenue: num(p.revenue) };
    }),
    statuses: arr<unknown>(r.statuses).map((x) => {
      const s = obj(x);
      return { raw: str(s.raw) ?? '', marketplace: str(s.marketplace), count: num(s.count) };
    }),
    requestId: str(r.requestId) ?? undefined,
  };
}

export async function salesReportFetcher(url: string): Promise<SalesReport> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    throw new SalesReportError(null);
  }
  if (!res.ok) {
    let requestId: string | null = null;
    try {
      const body = (await res.json()) as { requestId?: unknown } | null;
      if (body && typeof body.requestId === 'string') requestId = body.requestId;
    } catch {
      /* non-JSON error body */
    }
    throw new SalesReportError(res.status, requestId);
  }
  return normalizeSalesReport(await res.json());
}

export const SALES_REPORT_SWR_OPTIONS = {
  keepPreviousData: true,
  revalidateOnFocus: true,
  errorRetryCount: 2,
} as const;

export interface UseSalesReportResult {
  data: SalesReport | undefined;
  error: SalesReportError | undefined;
  isLoading: boolean;
  isValidating: boolean;
  /** The shown data belongs to another parameter set (keepPreviousData while the new key loads). */
  isPrevious: boolean;
  mutate: () => Promise<SalesReport | undefined>;
  /** The URL of the current key. */
  url: string;
}

/** `enabled: false` pauses the request (no store connected, flag off). */
export function useSalesReport(params: SalesReportParams | null, opts: { enabled?: boolean } = {}): UseSalesReportResult {
  const enabled = opts.enabled !== false && params != null;
  const url = params ? salesReportUrl(params) : '';
  const key = enabled && params ? salesReportKey(params) : null;
  const swr = useSWR<SalesReport, SalesReportError>(key, () => salesReportFetcher(url), SALES_REPORT_SWR_OPTIONS);
  // keepPreviousData: while a new key has no cached value SWR reports `isLoading` and still returns the old data.
  const isPrevious = Boolean(swr.data) && swr.isLoading;
  return {
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    isPrevious,
    mutate: () => swr.mutate(),
    url,
  };
}
