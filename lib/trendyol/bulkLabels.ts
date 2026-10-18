/**
 * Pure (client + server): which Trendyol orders the Orders page's bulk "Trendyol labels" prints
 * (pages/api/trendyol/cargo-bulk.ts), and how one bulk run is split into printed / skipped / remaining.
 *
 * Eligible = Trendyol order ∧ `cargoLabelPrintedAt` null ∧ the package is unshipped. The package status is
 * `Order.externalStatus` (the mapper stores Trendyol's raw package `status` there, lib/mappers/trendyol.ts;
 * `Order.status` is the normalized app enum, where Created/Picking/Invoiced/UnPacked/UnSupplied all collapse into
 * AWAITING_FULFILLMENT), falling back to the raw package's own `status` for rows written without it.
 * A label also needs Trendyol's cargo tracking number; eligible orders without one are counted, not printed.
 */
import { trendyolCargoInfo, type TrendyolCargoInfo } from './cargoInfo';

/** Trendyol package statuses before the carrier has the parcel. Everything else (Shipped, Delivered, Cancelled,
 *  UnDelivered, Returned, UnSupplied, UnPacked, …) is not printed in bulk. */
export const UNSHIPPED_PACKAGE_STATUSES = ['Created', 'Picking', 'Invoiced'] as const;

/** One bulk run prints at most this many labels; the rest stay for the next press. */
export const BULK_LABELS_MAX = 100;

export type BulkLabelFormat = 'pdf' | 'zpl';

export interface BulkLabelOrder {
  id: string;
  marketplace: string | null;
  externalStatus?: string | null;
  cargoLabelPrintedAt?: Date | string | null;
  rawData?: unknown;
}

const UNSHIPPED = new Set(UNSHIPPED_PACKAGE_STATUSES.map((s) => s.toLowerCase()));

const rawOf = (o: { rawData?: unknown }) => (o.rawData && typeof o.rawData === 'object' ? (o.rawData as Record<string, any>) : {});

/** Trendyol package status of a stored order: `externalStatus`, else the raw package's `status`. */
export function packageStatusOf(o: Pick<BulkLabelOrder, 'externalStatus' | 'rawData'>): string | null {
  const ext = typeof o.externalStatus === 'string' ? o.externalStatus.trim() : '';
  return ext || trendyolCargoInfo(rawOf(o)).packageStatus;
}

export function isUnshippedPackageStatus(status: string | null | undefined): boolean {
  return !!status && UNSHIPPED.has(status.trim().toLowerCase());
}

/** Trendyol ∧ not printed yet ∧ unshipped. (Cargo number is checked separately: no number → skipped, counted.) */
export function isBulkLabelEligible(o: BulkLabelOrder): boolean {
  if (String(o.marketplace || '').trim().toLowerCase() !== 'trendyol') return false;
  if (o.cargoLabelPrintedAt) return false;
  return isUnshippedPackageStatus(packageStatusOf(o));
}

export interface BulkLabelPlanItem<T extends BulkLabelOrder> {
  order: T;
  info: TrendyolCargoInfo;
}

export interface BulkLabelPlan<T extends BulkLabelOrder> {
  /** Orders this run prints (≤ max), in the given order. */
  include: BulkLabelPlanItem<T>[];
  /** Eligible orders that have a cargo number (the button's N). */
  eligible: number;
  /** Eligible but Trendyol has not assigned a cargo number yet. */
  skippedNoCargoNumber: number;
  /** ZPL only: eligible orders whose carrier has no Trendyol common label (Trendyol Express / Aras only). */
  skippedNotCommonLabel: number;
  /** Printable in this format but beyond `max`: the next press prints them. */
  remaining: number;
}

/**
 * Split candidate orders (already sorted oldest ship-by first) into this run. For ZPL, orders without a common label
 * are skipped and counted before the cap is applied, so they never hold a slot (they would be skipped every run and
 * starve the rest).
 */
export function planBulkLabels<T extends BulkLabelOrder>(orders: readonly T[], format: BulkLabelFormat, max = BULK_LABELS_MAX): BulkLabelPlan<T> {
  let skippedNoCargoNumber = 0;
  let skippedNotCommonLabel = 0;
  let eligible = 0;
  const printable: BulkLabelPlanItem<T>[] = [];
  for (const order of orders) {
    if (!isBulkLabelEligible(order)) continue;
    const info = trendyolCargoInfo(rawOf(order));
    if (!info.cargoNumber) {
      skippedNoCargoNumber++;
      continue;
    }
    eligible++;
    if (format === 'zpl' && !info.commonLabel) {
      skippedNotCommonLabel++;
      continue;
    }
    printable.push({ order, info });
  }
  const include = printable.slice(0, Math.max(0, max));
  return { include, eligible, skippedNoCargoNumber, skippedNotCommonLabel, remaining: printable.length - include.length };
}

/** One ZPL file from several labels: each document on its own, `^XA … ^XZ` blocks back to back. */
export function concatZpl(docs: readonly string[]): string {
  return docs
    .map((d) => String(d || '').trim())
    .filter(Boolean)
    .join('\n') + '\n';
}

/** Result of one bulk run, sent as response headers (file) or JSON (link delivery). */
export interface BulkLabelCounts {
  printed: number;
  skippedNoCargoNumber: number;
  skippedNotCommonLabel: number;
  /** ZPL: Trendyol refused or did not produce the label for these (not marked; the next run retries). */
  skippedFailed: number;
  /** ZPL: Trendyol has not enabled the common label for this store (COMMON_LABEL_NOT_ALLOWED). */
  commonLabelNotAllowed: boolean;
  remaining: number;
}

export const BULK_LABEL_HEADERS = {
  printed: 'X-Labels-Printed',
  skippedNoCargoNumber: 'X-Labels-Skipped-No-Cargo-Number',
  skippedNotCommonLabel: 'X-Labels-Skipped-Not-Common-Label',
  skippedFailed: 'X-Labels-Skipped-Failed',
  commonLabelNotAllowed: 'X-Labels-Common-Label-Not-Allowed',
  remaining: 'X-Labels-Remaining',
} as const;

export function countsToHeaders(c: BulkLabelCounts): Record<string, string> {
  return {
    [BULK_LABEL_HEADERS.printed]: String(c.printed),
    [BULK_LABEL_HEADERS.skippedNoCargoNumber]: String(c.skippedNoCargoNumber),
    [BULK_LABEL_HEADERS.skippedNotCommonLabel]: String(c.skippedNotCommonLabel),
    [BULK_LABEL_HEADERS.skippedFailed]: String(c.skippedFailed),
    [BULK_LABEL_HEADERS.commonLabelNotAllowed]: c.commonLabelNotAllowed ? '1' : '0',
    [BULK_LABEL_HEADERS.remaining]: String(c.remaining),
  };
}

export function countsFromHeaders(get: (name: string) => string | null): BulkLabelCounts {
  const n = (k: keyof typeof BULK_LABEL_HEADERS) => Math.max(0, Number(get(BULK_LABEL_HEADERS[k]) || 0) || 0);
  return {
    printed: n('printed'),
    skippedNoCargoNumber: n('skippedNoCargoNumber'),
    skippedNotCommonLabel: n('skippedNotCommonLabel'),
    skippedFailed: n('skippedFailed'),
    commonLabelNotAllowed: get(BULK_LABEL_HEADERS.commonLabelNotAllowed) === '1',
    remaining: n('remaining'),
  };
}
