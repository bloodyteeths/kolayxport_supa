// lib/reports/useFinanceReport.ts — Reports › Profit / Payouts / Transactions data layer (finance-analytics §6.2,
// §6.3; M9 group D). Replaces `useFinanceStore` for the new UI.
//
//   const scope = useFinanceScope();                       // mp, from, to, tz, granularity (group C's range + store hooks)
//   const report = useFinanceReport({ mp, from, to, tz }); // SWR on /api/finance/dashboard?compare=previous
//   const sync = useFinanceSync(mp, { from, to });         // POST settlements {action:'sync'}, then revalidate
//
// Everything that decides what the Profit tab shows is a pure function here (unit-tested): response
// normalisation (tolerates the pre-group-B shape: object `transactionTypeSummary`, no `currency`,
// `lastSyncedAt`, `previousSummary` or `costCoverage`), KPI maths, the P&L lines, the view state and the
// header primary (§4.1). Dates are `YYYY-MM-DD` in the seller timezone and never come from `toISOString` (B13).
import { useCallback, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useAsyncRegion, type AsyncState } from '@/lib/ds/useAsyncState';
import { DEFAULT_TIME_ZONE } from '@/lib/format';
import type { FilterDef } from '@/components/ds/toolbar/types';
import {
  FINANCE_MARKETPLACES, useReportMarketplace, useReportRange, type FinanceMarketplace,
} from '@/components/domain/reports/ReportsPage';
import type { CsvBlock } from '@/lib/reports/exportCsv';
import { autoGranularity, type DayRange, type Granularity, type NamedReportPreset, type ReportPreset } from '@/lib/reports/dateRange';

// ---------------------------------------------------------------------------
// Scope: marketplace + range, from the shared Reports frame (group C) so every tab resolves them the same way
// ---------------------------------------------------------------------------

export { FINANCE_MARKETPLACES, FINANCE_MARKETPLACE_NAME, type FinanceMarketplace } from '@/components/domain/reports/ReportsPage';

export function isFinanceMarketplace(v: unknown): v is FinanceMarketplace {
  return typeof v === 'string' && (FINANCE_MARKETPLACES as readonly string[]).includes(v);
}

const DAY_MS = 86_400_000;
const toUtc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

export interface FinanceScope {
  /** The marketplace shown (URL `mp`, else the first connected one, else Etsy). */
  mp: FinanceMarketplace;
  /** false when the URL names a marketplace without a payments ledger (Wix, Shopify, Hepsiburada). */
  supported: boolean;
  /** Raw URL `mp` (for the not-supported message). */
  requested: string | undefined;
  /** `useConnections().has(mp)`: undefined while unknown. */
  connected: boolean | undefined;
  setMp(mp: FinanceMarketplace): void;
  /** Store FilterDef + value for `ReportsPage.storeFilter` / `filterValues`. */
  storeFilter: FilterDef;
  storeValue: string;
  from: string;
  to: string;
  /** The comparison window (§4.2), for the "vs 1–31 Aug" delta label. */
  previous: DayRange;
  preset: ReportPreset;
  tz: string;
  granularity: Granularity;
  granularityOptions: Granularity[];
  /** Router parsed the query. */
  ready: boolean;
  setGranularity(g: Granularity): void;
  /** Range shortcut used by empty states ("Show last 90 days"). */
  setPreset(preset: NamedReportPreset): void;
}

/** One hook for Profit / Payouts / Transactions: `useReportMarketplace()` + `useReportRange()` (group C). */
export function useFinanceScope(now?: Date): FinanceScope {
  const range = useReportRange(now);
  const m = useReportMarketplace();
  return {
    mp: m.mp,
    supported: m.supported,
    requested: m.requested,
    connected: m.connected,
    setMp: m.setMp,
    storeFilter: m.filter,
    storeValue: m.value,
    from: range.from,
    to: range.to,
    previous: range.previous,
    preset: range.preset,
    tz: range.tz || DEFAULT_TIME_ZONE,
    granularity: range.granularity,
    granularityOptions: range.granularities,
    ready: range.ready,
    setGranularity: range.setGranularity,
    setPreset: range.setPreset,
  };
}

// ---------------------------------------------------------------------------
// Response shape (§6.2) and normalisation
// ---------------------------------------------------------------------------

export interface FinanceSummary {
  grossRevenue: number;
  commissions: number;
  shipping: number;
  returns: number;
  discounts: number;
  adSpend: number;
  otherFees: number;
  cogs: number;
  netProfit: number;
  /** API margin in percent of gross sales (56.1 = 56.1 %). */
  margin: number;
  orderCount: number;
  returnCount: number;
  pendingCancellationCount: number;
  totalOrderCount: number;
  pendingSettlementCount: number;
  totalOrderRevenue: number;
  banked: number;
  disbursementCount: number;
  currentBalance: number | null;
  balanceCurrency: string | null;
  heldFunds: number | null;
  /** Settlement currency of every amount in the response (§6.2 `summary.currency`, B12). */
  currency: string;
}

export interface FinanceTimePoint {
  /** Bucket start: `YYYY-MM-DD` (day/week) or `YYYY-MM` (month). */
  period: string;
  revenue: number;
  returns: number;
  commissions: number;
  shipping: number;
  cogs: number;
  adSpend: number;
  otherFees: number;
  discounts: number;
  netSales: number;
  netProfit: number;
}

export interface FinanceProductRow {
  /** Stable row id: barcode ‖ sku ‖ name. */
  key: string;
  barcode: string | null;
  sku: string | null;
  productName: string;
  revenue: number;
  quantity: number;
  returnedQuantity: number;
  commissions: number;
  shipping: number;
  cogs: number;
  /** null = no product cost saved for this product. */
  unitCost: number | null;
  netProfit: number;
  /** Fraction of revenue; null when revenue is 0. */
  margin: number | null;
}

export interface FinanceTypeSummary {
  type: string;
  total: number;
  count: number;
  category: string | null;
}

export interface FinanceCostCoverage {
  products: number;
  productsWithCost: number;
  productsWithoutCost: number;
  unitsWithoutCost: number | null;
}

export interface FinanceDashboard {
  marketplace: string;
  summary: FinanceSummary;
  previousSummary: FinanceSummary | null;
  /**
   * The comparison window the server actually used for `previousSummary` (response `previous.from/to`). The
   * dashboard uses "same day count ending the day before `from`" (lib/finance/periods `previousKeys`), which is
   * not the client's calendar-month rule, so the delta label must come from here. null when not reported.
   */
  previousWindow: DayRange | null;
  /** `FinancialSyncCursor.updatedAt`; null = never synced. undefined = the API does not report it (pre group B). */
  lastSyncedAt: string | null | undefined;
  costCoverage: FinanceCostCoverage;
  cogsExcluded: Array<{ currency: string; products: number }>;
  /** ProductCost rows labelled TRY on a non-Trendyol tab: used as typed, currency to confirm. */
  cogsUnverified: Array<{ currency: string; products: number }>;
  /** Ledger rows in another currency, converted (≈). */
  ledgerConverted: Array<{ currency: string; rows: number }>;
  /** Ledger rows in another currency with no rate, left out. */
  ledgerExcluded: Array<{ currency: string; rows: number }>;
  timeSeries: FinanceTimePoint[];
  productBreakdown: FinanceProductRow[];
  transactionTypeSummary: FinanceTypeSummary[];
  disbursements: Array<{ date: string; amount: number }>;
}

type Raw = Record<string, unknown>;
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function currencyCounts<K extends 'products' | 'rows'>(v: unknown, field: K): Array<{ currency: string } & Record<K, number>> {
  return arr(v)
    .map((x) => { const o = obj(x); return { currency: String(o.currency ?? ''), [field]: num(o[field]) } as { currency: string } & Record<K, number>; })
    .filter((x) => x.currency && x[field] > 0);
}

/** Currency when the API does not send `summary.currency` (pre group B): Trendyol TRY, else the balance currency. */
export function fallbackCurrency(mp: string, s: Raw): string {
  if (mp === 'trendyol') return 'TRY';
  return str(s.currency) ?? str(s.balanceCurrency) ?? 'USD';
}

function normalizeSummary(raw: unknown, currency: string): FinanceSummary {
  const s = obj(raw);
  return {
    grossRevenue: num(s.grossRevenue),
    commissions: num(s.commissions),
    shipping: num(s.shipping),
    returns: num(s.returns),
    discounts: num(s.discounts),
    adSpend: num(s.adSpend),
    otherFees: num(s.otherFees),
    cogs: num(s.cogs),
    netProfit: num(s.netProfit),
    margin: num(s.margin),
    orderCount: num(s.orderCount),
    returnCount: num(s.returnCount),
    pendingCancellationCount: num(s.pendingCancellationCount),
    totalOrderCount: num(s.totalOrderCount),
    pendingSettlementCount: num(s.pendingSettlementCount),
    totalOrderRevenue: num(s.totalOrderRevenue),
    banked: num(s.banked),
    disbursementCount: num(s.disbursementCount),
    currentBalance: numOrNull(s.currentBalance),
    balanceCurrency: str(s.balanceCurrency),
    heldFunds: numOrNull(s.heldFunds),
    currency: str(s.currency) ?? currency,
  };
}

export function productRowKey(r: { barcode?: string | null; sku?: string | null; productName?: string | null }, i = 0): string {
  return r.barcode || r.sku || r.productName || `row-${i}`;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
function dayRangeOf(v: unknown): DayRange | null {
  const o = obj(v);
  const from = str(o.from);
  const to = str(o.to);
  return from && to && DAY_KEY.test(from) && DAY_KEY.test(to) && from <= to ? { from, to } : null;
}

/**
 * Cost coverage that agrees with the product rows. The server counts a product as covered whenever a cost row
 * exists, but it reports `unitCost: 0` both for "no cost" and for a saved cost of 0, and the table shows
 * "Add cost" for both. So the uncovered count is at least the number of sold rows showing "Add cost"; the banner,
 * the Net profit caption and "Product cost (x of y)" then match the rows. (Backend need: a per-row `hasCost`.)
 */
export function reconcileCoverage(cov: FinanceCostCoverage, rows: FinanceProductRow[]): FinanceCostCoverage {
  const missing = rows.filter((p) => p.quantity > 0 && p.unitCost === null);
  const without = Math.min(cov.products, Math.max(cov.productsWithoutCost, missing.length));
  const missingUnits = missing.reduce((n, p) => n + p.quantity, 0);
  return {
    products: cov.products,
    productsWithCost: Math.max(0, cov.products - without),
    productsWithoutCost: without,
    unitsWithoutCost: cov.unitsWithoutCost === null ? null : Math.max(cov.unitsWithoutCost, missingUnits),
  };
}

export function normalizeFinanceDashboard(raw: unknown, mp: string): FinanceDashboard {
  const r = obj(raw);
  const s = obj(r.summary);
  const currency = fallbackCurrency(mp, s);
  const summary = normalizeSummary(s, currency);

  const timeSeries: FinanceTimePoint[] = arr(r.timeSeries)
    .map((p) => {
      const o = obj(p);
      const revenue = num(o.revenue);
      const returns = num(o.returns);
      return {
        period: String(o.period ?? ''),
        revenue,
        returns,
        commissions: num(o.commissions),
        shipping: num(o.shipping),
        cogs: num(o.cogs),
        adSpend: num(o.adSpend),
        otherFees: num(o.otherFees),
        discounts: num(o.discounts),
        netSales: revenue - returns,
        netProfit: num(o.netProfit),
      };
    })
    .filter((p) => p.period)
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0)); // ascending (B1)

  const productBreakdown: FinanceProductRow[] = arr(r.productBreakdown).map((p, i) => {
    const o = obj(p);
    const revenue = num(o.revenue);
    const netProfit = num(o.netProfit);
    const unit = numOrNull(o.unitCost);
    const cogs = num(o.cogs);
    const row = {
      barcode: str(o.barcode),
      sku: str(o.sku),
      productName: str(o.productName) ?? str(o.barcode) ?? str(o.sku) ?? '—',
    };
    return {
      key: productRowKey(row, i),
      ...row,
      revenue,
      quantity: num(o.quantity),
      returnedQuantity: num(o.returnedQuantity),
      commissions: num(o.commissions),
      shipping: num(o.shipping),
      cogs,
      // The API reports 0 for "no cost saved"; a real zero cost with zero COGS reads the same, so it is
      // treated as missing (the seller sees "Add cost", never a silently inflated profit).
      unitCost: unit !== null && (unit > 0 || cogs > 0) ? unit : null,
      netProfit,
      margin: revenue !== 0 ? netProfit / revenue : null,
    };
  });

  const txRaw = r.transactionTypeSummary;
  const transactionTypeSummary: FinanceTypeSummary[] = Array.isArray(txRaw)
    ? txRaw.map((x) => { const o = obj(x); return { type: String(o.type ?? ''), total: num(o.total), count: num(o.count), category: str(o.category) }; })
    : Object.entries(obj(txRaw)).map(([type, v]) => { const o = obj(v); return { type, total: num(o.total), count: num(o.count), category: str(o.category) }; });

  const cov = r.costCoverage ? obj(r.costCoverage) : null;
  const products = cov ? num(cov.products) : productBreakdown.length;
  const productsWithCost = cov ? num(cov.productsWithCost) : productBreakdown.filter((p) => p.unitCost !== null).length;
  const costCoverage: FinanceCostCoverage = reconcileCoverage({
    products,
    productsWithCost,
    productsWithoutCost: Math.max(0, products - productsWithCost),
    unitsWithoutCost: cov ? numOrNull(cov.unitsWithoutCost) : null,
  }, productBreakdown);

  return {
    marketplace: str(r.marketplace) ?? mp,
    summary,
    previousSummary: r.previousSummary ? normalizeSummary(r.previousSummary, summary.currency) : null,
    previousWindow: r.previousSummary ? dayRangeOf(r.previous) : null,
    lastSyncedAt: 'lastSyncedAt' in r ? (str(r.lastSyncedAt) ?? null) : undefined,
    costCoverage,
    cogsExcluded: arr(r.cogsExcluded)
      .map((x) => { const o = obj(x); return { currency: String(o.currency ?? ''), products: num(o.products) }; })
      .filter((x) => x.currency && x.products > 0),
    cogsUnverified: currencyCounts(r.cogsUnverified, 'products'),
    ledgerConverted: currencyCounts(r.ledgerConverted, 'rows'),
    ledgerExcluded: currencyCounts(r.ledgerExcluded, 'rows'),
    timeSeries,
    productBreakdown,
    transactionTypeSummary,
    disbursements: arr(r.disbursements)
      .map((x) => { const o = obj(x); return { date: String(o.date ?? ''), amount: num(o.amount) }; })
      .filter((x) => x.date),
  };
}

/** Ledger rows in the range (sum of the per-type counts); null without data. Used for the "N new" toast delta. */
export function ledgerRowCount(d: FinanceDashboard | undefined | null): number | null {
  if (!d) return null;
  return d.transactionTypeSummary.reduce((n, x) => n + (Number.isFinite(x.count) ? x.count : 0), 0);
}

/**
 * The dashboard only when it belongs to `mp`. SWR `keepPreviousData` keeps the last response across key changes;
 * that is right for a range or granularity change (same marketplace, dimmed while updating) but never across a
 * marketplace switch: Etsy amounts must not show (or be edited) under "Trendyol payments ledger".
 */
export function ownDashboard(d: FinanceDashboard | undefined, mp: string | null | undefined): FinanceDashboard | undefined {
  return d && mp && d.marketplace.toLowerCase() === mp.toLowerCase() ? d : undefined;
}

/** No ledger activity in the range (zero-filled buckets count as empty). */
export function isFinanceRangeEmpty(d: FinanceDashboard): boolean {
  const s = d.summary;
  return (
    d.transactionTypeSummary.every((x) => x.count === 0) &&
    d.productBreakdown.length === 0 &&
    s.grossRevenue === 0 && s.orderCount === 0 && s.commissions === 0 && s.returns === 0 && s.banked === 0 &&
    d.timeSeries.every((p) => p.revenue === 0 && p.commissions === 0 && p.netProfit === 0)
  );
}

/** §3 "never synced": the API reports no cursor and the range has no rows. Unknown cursor → not never. */
export function isNeverSynced(d: FinanceDashboard): boolean {
  return d.lastSyncedAt === null && isFinanceRangeEmpty(d);
}

/** Meta turns warning-fg after 12h without a refresh (§3). */
export const FINANCE_STALE_MS = 12 * 60 * 60 * 1000;
export function isFinanceStale(lastSyncedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastSyncedAt) return false;
  const t = Date.parse(lastSyncedAt);
  return Number.isFinite(t) && now.getTime() - t > FINANCE_STALE_MS;
}

// ---------------------------------------------------------------------------
// KPIs, P&L, primary, view state (pure)
// ---------------------------------------------------------------------------

/** Relative change; null when there is no previous value or it is 0 (B4: never a fake "0 %"). */
export function relDelta(cur: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || !Number.isFinite(prev) || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export const netSalesOf = (s: FinanceSummary) => s.grossRevenue - s.returns;
export const costsOf = (s: FinanceSummary) => s.commissions + s.adSpend + s.shipping + s.otherFees + s.discounts + s.cogs;

export interface FinanceKpis {
  netSales: number;
  costs: number;
  netProfit: number;
  /** Fraction (API margin / 100). */
  margin: number;
  /** Fees and costs as a fraction of net sales; null when net sales is 0. */
  costsShare: number | null;
  deltas: { netSales: number | null; costs: number | null; netProfit: number | null; /** percentage points */ marginPts: number | null };
}

export function financeKpis(s: FinanceSummary, prev: FinanceSummary | null): FinanceKpis {
  const netSales = netSalesOf(s);
  const costs = costsOf(s);
  const margin = s.margin / 100;
  const prevHasSales = prev ? prev.grossRevenue !== 0 : false;
  return {
    netSales,
    costs,
    netProfit: s.netProfit,
    margin,
    costsShare: netSales !== 0 ? costs / netSales : null,
    deltas: {
      netSales: prev ? relDelta(netSales, netSalesOf(prev)) : null,
      costs: prev ? relDelta(costs, costsOf(prev)) : null,
      netProfit: prev ? relDelta(s.netProfit, prev.netProfit) : null,
      marginPts: prev && prevHasSales && s.grossRevenue !== 0 ? Math.round((s.margin - prev.margin) * 10) / 10 : null,
    },
  };
}

export type StatementLineKey = 'gross' | 'refunds' | 'discounts' | 'fees' | 'ads' | 'shipping' | 'otherFees' | 'productCost' | 'net';
export interface StatementLine {
  key: StatementLineKey;
  /** Signed: income positive, costs negative. */
  amount: number;
  /** |amount| / gross sales; null when gross is 0. */
  share: number | null;
}

export function profitStatement(s: FinanceSummary): StatementLine[] {
  const gross = s.grossRevenue;
  const share = (v: number) => (gross !== 0 ? Math.abs(v) / Math.abs(gross) : null);
  const cost = (key: StatementLineKey, v: number): StatementLine => ({ key, amount: v === 0 ? 0 : -Math.abs(v), share: share(v) });
  return [
    { key: 'gross', amount: gross, share: gross !== 0 ? 1 : null },
    cost('refunds', s.returns),
    cost('discounts', s.discounts),
    cost('fees', s.commissions),
    cost('ads', s.adSpend),
    cost('shipping', s.shipping),
    cost('otherFees', s.otherFees),
    cost('productCost', s.cogs),
    { key: 'net', amount: s.netProfit, share: gross !== 0 ? s.netProfit / Math.abs(gross) : null },
  ];
}

/** §4.1 Profit primary: "Add product costs" while costs are missing, else "Export CSV". */
export function profitPrimary(d: FinanceDashboard | null | undefined): 'addCosts' | 'export' | null {
  if (!d || isNeverSynced(d)) return null;
  return d.costCoverage.productsWithoutCost > 0 ? 'addCosts' : 'export';
}

export type ProfitView =
  | 'gated' | 'unknown' | 'notSupported' | 'connect' | 'loading' | 'slow' | 'error' | 'never' | 'empty' | 'ready';

/** Which body the Profit tab renders (§3 table), in precedence order. */
export function profitView(i: {
  gated: boolean;
  /** Entitlement still loading. */
  accessLoading?: boolean;
  /** The URL marketplace has a payments ledger. */
  supported: boolean;
  connected: boolean | undefined;
  async: AsyncState;
  data: FinanceDashboard | undefined;
}): ProfitView {
  if (i.gated) return 'gated';
  if (i.accessLoading) return 'unknown';
  if (!i.supported) return 'notSupported';
  if (i.connected === false) return 'connect';
  if (i.connected === undefined) return 'unknown';
  if (i.async === 'error') return 'error';
  if (!i.data) return i.async === 'slow' ? 'slow' : 'loading';
  if (isNeverSynced(i.data)) return 'never';
  if (isFinanceRangeEmpty(i.data)) return 'empty';
  return 'ready';
}

// ---------------------------------------------------------------------------
// CSV (Profit exports the P&L lines and the product table, §4.8; written by group C's lib/reports/exportCsv.ts)
// ---------------------------------------------------------------------------

export interface ProfitCsvHeaders {
  statementTitle: string;
  productsTitle: string;
  line: string;
  amount: string;
  share: string;
  currency: string;
  product: string;
  code: string;
  sold: string;
  returned: string;
  revenue: string;
  fees: string;
  shipping: string;
  unitCost: string;
  profit: string;
  margin: string;
  lineLabel(k: StatementLineKey): string;
}

/** Machine-readable blocks: raw numbers (exportCsv writes dot decimals), ratios as fractions, a currency column. */
export function profitCsvBlocks(d: FinanceDashboard, h: ProfitCsvHeaders): CsvBlock[] {
  const c = d.summary.currency;
  return [
    {
      title: h.statementTitle,
      header: [h.line, h.amount, h.share, h.currency],
      rows: profitStatement(d.summary).map((l) => [h.lineLabel(l.key), l.amount, l.share, c]),
    },
    {
      title: h.productsTitle,
      header: [h.product, h.code, h.sold, h.returned, h.revenue, h.fees, h.shipping, h.unitCost, h.profit, h.margin, h.currency],
      rows: d.productBreakdown.map((p) => [
        p.productName, p.barcode ?? p.sku ?? '', p.quantity, p.returnedQuantity, p.revenue, p.commissions, p.shipping,
        p.unitCost, p.netProfit, p.margin, c,
      ]),
    },
  ];
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** Non-2xx finance response; `status` feeds ErrorState / the 402 lock interceptor. */
export class FinanceFetchError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    const body = data && typeof data === 'object' ? (data as Raw) : null;
    super(typeof body?.error === 'string' ? body.error : `HTTP ${status}`);
    this.name = 'FinanceFetchError';
    this.status = status;
    this.data = data;
  }
}

export async function financeFetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new FinanceFetchError(res.status, body);
  return body;
}

export interface FinanceReportArgs {
  mp: string | null | undefined;
  from: string;
  to: string;
  tz: string;
  granularity?: Granularity;
  /** false = paused (gated, unconnected or unsupported marketplace). Default true. */
  enabled?: boolean;
}

export const FINANCE_DASHBOARD_PATH = '/api/finance/dashboard';

/** §6.2 new-UI query: local `from`/`to` days + `tz` (the handler builds the window in the seller timezone). */
export function financeDashboardUrl(a: { mp: string; from: string; to: string; tz: string; granularity?: Granularity }): string {
  const p = new URLSearchParams({
    marketplace: a.mp,
    from: a.from,
    to: a.to,
    tz: a.tz,
    granularity: a.granularity ?? autoGranularity(a.from, a.to),
    compare: 'previous',
  });
  return `${FINANCE_DASHBOARD_PATH}?${p}`;
}

export interface FinanceReport {
  data: FinanceDashboard | undefined;
  state: AsyncState;
  error: unknown;
  isValidating: boolean;
  mutate: () => Promise<unknown>;
  retry: () => void;
}

/** `useFinanceReport({ mp, from, to, tz }) → { data, state, error, mutate }` (signature shared with group E). */
export function useFinanceReport({ mp, from, to, tz, granularity, enabled = true }: FinanceReportArgs): FinanceReport {
  const key = enabled && mp && isFinanceMarketplace(mp) ? financeDashboardUrl({ mp, from, to, tz, granularity }) : null;
  const swr = useSWR<FinanceDashboard>(
    key,
    // The marketplace comes from the key itself, so a response is always tagged with the marketplace it was asked for.
    async (url: string) => {
      const keyMp = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('marketplace') ?? String(mp);
      return { ...normalizeFinanceDashboard(await financeFetchJson(url), keyMp), marketplace: keyMp };
    },
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      shouldRetryOnError: (err: unknown) => !(err instanceof FinanceFetchError && err.status >= 400 && err.status < 500),
      errorRetryCount: 2,
    },
  );
  // Another marketplace's previous response counts as no data: loading / slow / error, never 'ready' or 'stale'.
  const data = ownDashboard(swr.data, mp);
  const foreign = swr.data !== undefined && data === undefined;
  // A 4xx (incl. 402 featureLocked) is final; the region shows the error or the locked state immediately.
  const region = useAsyncRegion(
    { data, error: swr.error, isLoading: swr.isLoading || (foreign && key !== null), isValidating: swr.isValidating, mutate: swr.mutate },
    { isEmpty: () => false, idle: 'empty' },
  );
  const { mutate } = swr;
  const doMutate = useCallback(() => mutate(), [mutate]);
  return { data, state: region.state, error: swr.error, isValidating: swr.isValidating, mutate: doMutate, retry: region.retry };
}

export type FinanceSyncState = 'idle' | 'pulling' | 'failed';

/** Ledger window for a sync, padded by a day each side so every timezone's local day is covered (upserts are idempotent). */
export function syncWindow(from: string, to: string, now: Date = new Date()): { startDate: number; endDate: number } {
  const startDate = toUtc(from) - DAY_MS;
  const endDate = Math.min(toUtc(to) + 2 * DAY_MS - 1, now.getTime());
  return { startDate, endDate: Math.max(startDate, endDate) };
}

/** True for every SWR key the finance tabs read (dashboard, transactions list). */
export const isFinanceKey = (key: unknown) =>
  typeof key === 'string' && (key.startsWith(FINANCE_DASHBOARD_PATH) || key.startsWith('/api/finance/settlements'));

/**
 * `useFinanceSync(mp)` — POST `/api/finance/settlements {action:'sync'}` (existing), then revalidate every
 * finance key. Resolves with the API's `totalUpserted`, or null on failure (state `failed`).
 * `totalUpserted` counts every upserted row, including rows that were already stored, so it is NOT a "new"
 * count: callers toast the difference of `ledgerRowCount` before and after (backend need: a `created` count).
 */
export function useFinanceSync(mp: string | null | undefined, range: { from: string; to: string }) {
  const { mutate } = useSWRConfig();
  const [state, setState] = useState<FinanceSyncState>('idle');
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async (): Promise<number | null> => {
    if (!mp || !isFinanceMarketplace(mp)) return null;
    setState('pulling');
    setError(null);
    try {
      const body = await financeFetchJson('/api/finance/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', marketplace: mp, ...syncWindow(range.from, range.to) }),
      });
      setState('idle');
      await mutate(isFinanceKey);
      return num(obj(body).totalUpserted);
    } catch (err) {
      setState('failed');
      setError(err);
      return null;
    }
  }, [mp, range.from, range.to, mutate]);
  return useMemo(() => ({ state, error, run }), [state, error, run]);
}
