/**
 * `GET /api/analytics?from=&to=` response (finance-analytics §6.1, Reports › Sales).
 * Client-safe: types only, no runtime imports. Built by `lib/reports/salesApi.ts` (M9 group A).
 *
 * Conventions:
 * - Money values are numbers in `currency` (the "Show in" currency), rounded to 2 decimals.
 *   They are converted (`≈`) unless an order was already in that currency.
 * - Deltas and shares are **fractions** (0.124 = +12.4 %), the unit `KpiTile.delta.value`,
 *   `fmt.percent` and `ShareBar` expect. A delta is `null` when the previous value is 0 (B4):
 *   render `—` with "No data in the previous period".
 * - Day keys are `YYYY-MM-DD` in `range.tz`; hour keys are `YYYY-MM-DDTHH` (local hour, 00–23).
 */
import type { MarketplaceKey } from '@/components/ds/data/types';

export type SalesGranularity = 'hour' | 'day' | 'week' | 'month';
export type SalesCurrency = 'TRY' | 'USD' | 'EUR';
export type SalesStoreMarketplace = MarketplaceKey | 'manual' | 'other';

export interface SalesStoreRef {
  /** Canonical store key from `lib/marketplaces/canonical.ts` (`etsy:bellecouturegifts`, `trendyol`, `manual`, `other:veeqo`). */
  key: string;
  marketplace: SalesStoreMarketplace;
  /** Etsy shop name or legacy aggregator name; null for a plain marketplace. */
  shopName: string | null;
}

export interface SalesBucket {
  /** First local day (or hour) of the bucket inside its window: `YYYY-MM-DD` or `YYYY-MM-DDTHH`. */
  bucketStart: string;
  /** Last local day of the bucket inside its window (inclusive, `YYYY-MM-DD`); for hours, the same hour key. */
  bucketEnd: string;
  orders: number;
  /** Converted to `currency`; orders without a rate are left out (see `fx.excluded`). */
  revenue: number;
}

export interface SalesTotals {
  revenue: number;
  orders: number;
  /** revenue / orders that could be converted (0 when none). */
  aov: number;
  units: number;
}

export interface SalesTotalsWithDelta extends SalesTotals {
  revenueDelta: number | null;
  ordersDelta: number | null;
  aovDelta: number | null;
  unitsDelta: number | null;
  /** Orders whose amount is inside `revenue` (the AOV divisor). */
  convertedOrders: number;
}

export interface SalesStoreRow extends SalesStoreRef {
  orders: number;
  units: number;
  /** Converted revenue in `currency`. */
  revenue: number;
  /** Original totals per currency, never summed across currencies: `{ USD: 2910.1, EUR: 410 }`. */
  byCurrency: Record<string, number>;
  /** revenue / converted orders of this store; null when none could be converted. */
  aov: number | null;
  /** Revenue share of `totals.revenue` (fraction); null when the total is 0. */
  share: number | null;
  /** Orders of this store left out of `revenue` (no exchange rate). */
  excludedOrders: number;
}

export interface SalesProductRow {
  /** `sku`, else the lower-cased product name. */
  key: string;
  name: string | null;
  sku: string | null;
  image: string | null;
  units: number;
  /** Distinct orders containing the product. */
  orders: number;
  /** Converted line revenue in `currency`. */
  revenue: number;
}

export interface SalesStatusRow {
  /** `Order.status` as stored; map with `orderStatus(raw, marketplace)` from `lib/ds/status/orders.ts`. */
  raw: string | null;
  marketplace: SalesStoreMarketplace;
  count: number;
}

export interface SalesFx {
  source: 'exchangerate-api.com';
  /** When the rates in use were fetched (ISO); null when no rates were ever fetched. */
  asOf: string | null;
  /** Live rates could not be fetched; last-known (or no) rates were used. */
  stale: boolean;
  /** TRY per one unit; null when unknown. */
  rates: { USD: number | null; EUR: number | null };
  /** Currencies left out of the current period's totals: orders per currency (B12 caption, warning banner). */
  excluded: Array<{ currency: string; orders: number }>;
}

export interface SalesReportResponse {
  version: 2;
  generatedAt: string;
  currency: SalesCurrency;
  range: { from: string; to: string; tz: string; granularity: SalesGranularity; days: number };
  /** The comparison window the deltas and `previousSeries` use. Label the delta from this ("vs 1–31 Aug"). */
  previousRange: { from: string; to: string };
  totals: SalesTotalsWithDelta;
  previousTotals: SalesTotals;
  /** Store keys with at least one order in the current period (after the store filter). */
  storesIncluded: string[];
  /** Every store key with orders in either window, ignoring the store filter (Store filter options). */
  availableStores: SalesStoreRef[];
  fx: SalesFx;
  /** Ascending, zero-filled, no gaps (B1). */
  series: SalesBucket[];
  /**
   * Same length as `series`, aligned by index (bucket i of the previous window, shifted by the window offset).
   * null where the previous window is shorter and has no day for that bucket (e.g. the 29–31 Mar buckets against
   * 1–28 Feb): the chart draws a gap there; `previousTotals` still covers the whole previous window.
   */
  previousSeries: Array<SalesBucket | null>;
  /** Sorted by revenue, then orders. */
  stores: SalesStoreRow[];
  /** Top 10 by units (B5). */
  products: SalesProductRow[];
  statuses: SalesStatusRow[];
}

export interface SalesReportError {
  error: 'invalid_range' | 'range_too_long' | 'invalid_compare' | 'Not authenticated' | 'Internal server error' | string;
  details?: string;
}
