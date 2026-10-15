// lib/research/opportunity.ts — Listing doctor opportunity sort (research.md §7.3). Pure, deterministic.
//
//   1. Traffic without sales: views30d ≥ max(50, shop p50 views) and sales30d = 0 → by views desc.
//   2. Can't be found: tracked main-keyword rank > 100 or null (not in top 500) → by views desc.
//   3. Health gaps: health < 50 → by the summed gain of failing/warning checks desc.
//   4. Everything else → by health asc.
// A listing with fewer than MIN_DAILY_ROWS daily-stat rows (`collecting`) has no measured views/sales: it falls back
// to rule 3 (rules 1 and 2 are skipped; spec §7.3). eBay has no views: rules 2–4 only.

import type { Check } from '@/lib/listingScore/types';
import type { DoctorSort, Guarded, OpportunityRule } from './types';

export const MIN_DAILY_ROWS = 7;
export const TRAFFIC_MIN_VIEWS = 50;
export const RANK_LOST = 100;
export const HEALTH_GAP = 50;
export const DOCTOR_WINDOW_DAYS = 30;

export interface OpportunityInput {
  id: string;
  /** Measured views over 30 days, null when unknown (collecting, or eBay). */
  views30d: number | null;
  /** Measured sales over 30 days, null when unknown. */
  sales30d: number | null;
  /** Etsy: fewer than MIN_DAILY_ROWS daily-stat rows → rules 1 and 2 are skipped (falls back to rule 3). */
  collecting?: boolean;
  /** True when the main keyword is a tracked keyword (rule 2 only applies then). */
  tracked: boolean;
  /** Latest tracked rank; null = not in top 500. Ignored when `tracked` is false. */
  rank: number | null;
  /** 0–100; null = not scored. */
  health: number | null;
  /** Sum of `gain` of failing + warning listing checks. */
  failingGain: number;
}

const RULE_ORDER: Record<OpportunityRule, number> = { traffic_no_sales: 0, cant_be_found: 1, health_gaps: 2, other: 3 };

/** Median of the known views (the shop's p50); null when nothing is measured. */
export function shopP50Views(rows: Array<Pick<OpportunityInput, 'views30d'>>): number | null {
  const v = rows.map((r) => r.views30d).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = (v.length - 1) / 2;
  return (v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2;
}

export function classifyOpportunity(row: OpportunityInput, shopP50: number | null): OpportunityRule {
  const threshold = Math.max(TRAFFIC_MIN_VIEWS, shopP50 ?? 0);
  if (row.views30d != null && row.sales30d != null && row.views30d >= threshold && row.sales30d === 0) return 'traffic_no_sales';
  if (!row.collecting && row.tracked && (row.rank == null || row.rank > RANK_LOST)) return 'cant_be_found';
  if (row.health != null && row.health < HEALTH_GAP) return 'health_gaps';
  return 'other';
}

const views = (r: OpportunityInput) => r.views30d ?? 0;
const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
};

function compareWithinRule(rule: OpportunityRule, a: OpportunityInput, b: OpportunityInput): number {
  switch (rule) {
    case 'traffic_no_sales':
    case 'cant_be_found':
      return views(b) - views(a);
    case 'health_gaps':
      return b.failingGain - a.failingGain || nullsLast(a.health, b.health, 1);
    default:
      return nullsLast(a.health, b.health, 1);
  }
}

export interface Ranked<T> {
  item: T;
  rule: OpportunityRule;
  /** 1-based position in the opportunity order (also returned for other sorts). */
  rank: number;
}

/**
 * Sorts rows. Every sort ends with a stable tie-break on `id` so pages never shuffle.
 * `health` = lowest first · `views` / `sales` = most first (unknown last) · `opportunity` = §7.3.
 */
export function sortDoctor<T>(items: T[], pick: (t: T) => OpportunityInput, sort: DoctorSort = 'opportunity'): Ranked<T>[] {
  const inputs = items.map(pick);
  const p50 = shopP50Views(inputs);
  const rows = items.map((item, i) => ({ item, input: inputs[i], rule: classifyOpportunity(inputs[i], p50) }));
  const byId = (a: OpportunityInput, b: OpportunityInput) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const opp = [...rows].sort((a, b) =>
    RULE_ORDER[a.rule] - RULE_ORDER[b.rule] || compareWithinRule(a.rule, a.input, b.input) || byId(a.input, b.input));
  const oppRank = new Map(opp.map((r, i) => [r, i + 1]));
  let sorted = opp;
  if (sort === 'health') sorted = [...rows].sort((a, b) => nullsLast(a.input.health, b.input.health, 1) || byId(a.input, b.input));
  if (sort === 'views') sorted = [...rows].sort((a, b) => nullsLast(a.input.views30d, b.input.views30d, -1) || byId(a.input, b.input));
  if (sort === 'sales') sorted = [...rows].sort((a, b) => nullsLast(a.input.sales30d, b.input.sales30d, -1) || byId(a.input, b.input));
  return sorted.map((r) => ({ item: r.item, rule: r.rule, rank: oppRank.get(r) ?? 0 }));
}

// ─── Metrics helpers ────────────────────────────────────────────────────────

export interface DailyStatLike {
  views: number | null;
  unitsSold: number;
}

/** 30-day sums; `days` = rows seen. Views stay null when no row carried a views delta. */
export function sumDailyStats(rows: DailyStatLike[]): { views: number | null; sales: number; days: number } {
  let v = 0;
  let anyViews = false;
  let s = 0;
  for (const r of rows) {
    if (typeof r.views === 'number' && Number.isFinite(r.views) && r.views >= 0) { v += r.views; anyViews = true; }
    if (Number.isFinite(r.unitsSold) && r.unitsSold > 0) s += r.unitsSold;
  }
  return { views: anyViews ? v : null, sales: s, days: rows.length };
}

const ok = (value: number): Guarded<number> => ({ value, kind: 'measured', guard: { ok: true } });
const blocked = (reasonKey: string, reasonParams?: Record<string, string | number>): Guarded<number> =>
  ({ value: null, kind: 'measured', guard: { ok: false, reasonKey, ...(reasonParams ? { reasonParams } : {}) } });

/**
 * Etsy 30-day metrics with the §7.3 guard: fewer than 7 daily rows → "—" with
 * "Collecting daily stats since {date}" (date = the listing's first row, else the shop's).
 */
export function etsyDoctorMetrics(
  sums: { views: number | null; sales: number; days: number },
  since: string | null,
): { views30d: Guarded<number>; sales30d: Guarded<number>; conversion: Guarded<number>; measured: boolean } {
  if (sums.days < MIN_DAILY_ROWS) {
    const g = blocked('research.doc.collecting', { date: since ?? '' });
    return { views30d: g, sales30d: g, conversion: g, measured: false };
  }
  const views30d = sums.views == null ? blocked('research.guard.insufficient') : ok(sums.views);
  const sales30d = ok(sums.sales);
  const conversion = sums.views && sums.views > 0 ? ok(Math.round((sums.sales / sums.views) * 10_000) / 10_000) : blocked('research.guard.insufficient');
  return { views30d, sales30d, conversion, measured: sums.views != null };
}

/** eBay: views are not available; sales come from orders (`OrderItem.listingRef`). */
export function ebayDoctorMetrics(sales: number | null): { views30d: Guarded<number>; sales30d: Guarded<number>; conversion: Guarded<number> } {
  const na = blocked('research.doc.noViewsEbay');
  return { views30d: na, sales30d: sales == null ? blocked('research.doc.noSalesEbay') : ok(sales), conversion: na };
}

/** Listing checks that are failing or warning (peer checks excluded). */
export function failingChecks(checks: Check[]): Check[] {
  return checks.filter((c) => (c.group ?? 'listing') === 'listing' && (c.status === 'fail' || c.status === 'warn'));
}

/** The failing/warning check with the biggest gain (fails before warns on ties). */
export function biggestIssue(checks: Check[]): Check | null {
  const f = failingChecks(checks);
  if (f.length === 0) return null;
  return [...f].sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0) || (a.status === 'fail' ? -1 : 1) - (b.status === 'fail' ? -1 : 1) || b.impact - a.impact)[0];
}
