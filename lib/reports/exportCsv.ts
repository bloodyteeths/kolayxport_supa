// lib/reports/exportCsv.ts — finance-analytics §4.8 (M9 Group C; Profit and Payouts reuse it).
//
// The file is machine-readable whatever the UI locale (B17):
//   UTF-8 with BOM · comma separator · dot decimals · ISO dates (YYYY-MM-DD) · CRLF rows · a `currency` column on
//   every money row (the caller adds it) · headers translated in the UI locale (the caller passes them).
// File name: `kolayxport-<tab>-<from>_<to>.csv` (ASCII, never translated).
// No `.toFixed`, no `toLocaleString`: numbers are rounded arithmetically and written with `String()`.

export type CsvValue = string | number | boolean | Date | null | undefined;

/** One table in the file. Several blocks are separated by one empty row; a block may carry a title row. */
export interface CsvBlock {
  /** Optional first row (one cell), e.g. "Sales by store". */
  title?: string;
  header: string[];
  rows: CsvValue[][];
}

export const CSV_BOM = '﻿';
export const CSV_EOL = '\r\n';
/** §3 Export: "Export the first 10.000 transactions?" above this many rows. */
export const CSV_CONFIRM_ROWS = 10_000;

/**
 * Number → dot-decimal text. Money and ratios are rounded to `decimals` (default 2) without float noise
 * (0.1 + 0.2 → "0.3"); integers stay integers; non-finite → empty cell. Never exponent notation for normal values.
 */
export function csvNumber(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '';
  const f = 10 ** decimals;
  const r = Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
  // After rounding to ≤ 6 decimals String() never uses exponent form below 1e21 (no real amount gets there).
  return String(Object.is(r, -0) ? 0 : r);
}

/** ISO day of a Date in UTC (the caller passes day keys for seller-timezone days). */
function isoDay(d: Date): string {
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

/** One cell, quoted when it contains a comma, quote, CR or LF; formula-leading text is neutralized (CSV injection). */
export function csvCell(v: CsvValue): string {
  let s: string;
  if (v == null) s = '';
  else if (typeof v === 'number') s = csvNumber(v);
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (v instanceof Date) s = isoDay(v);
  else s = String(v);
  // Spreadsheet formula injection: text starting with = + - @ (or a tab/CR) gets a leading apostrophe.
  // Numbers were formatted above and never reach this branch, so "-12.5" stays numeric.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: CsvValue[]): string {
  return cells.map(csvCell).join(',');
}

/** The whole file (BOM first). Empty blocks (no rows) still write their header so the file shape is stable. */
export function buildCsv(blocks: CsvBlock[]): string {
  const lines: string[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) lines.push('');
    if (b.title) lines.push(csvRow([b.title]));
    lines.push(csvRow(b.header));
    for (const r of b.rows) lines.push(csvRow(r));
  });
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

const SAFE = /[^a-z0-9_-]+/g;

/** `kolayxport-<tab>-<from>_<to>.csv`, ASCII only (tab and days are sanitized). */
export function reportCsvFilename(tab: string, from: string, to: string): string {
  const clean = (s: string) => s.toLowerCase().replace(SAFE, '-').replace(/^-+|-+$/g, '') || 'report';
  const day = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : clean(s));
  return `kolayxport-${clean(tab)}-${day(from)}_${day(to)}.csv`;
}

/** Browser download of a CSV string. Returns false when the browser cannot (SSR, blocked Blob/URL). */
export function downloadCsv(filename: string, csv: string): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

/** Build + download in one call (Profit/Payouts use this shape too). */
export function exportReportCsv(tab: string, range: { from: string; to: string }, blocks: CsvBlock[]): boolean {
  return downloadCsv(reportCsvFilename(tab, range.from, range.to), buildCsv(blocks));
}
