// lib/listings/csv.ts — the shared listings CSV serializer (listings-grid §9.4 export, §10 Import template).
// Pure: no Prisma, no React. Export and the Import template (G6) use the same columns so a downloaded file
// round-trips through Import CSV.
//
// Format: UTF-8 with BOM (Excel opens Turkish characters correctly), comma separator, CRLF line ends,
// RFC 4180 quoting. Tags are joined with ", " in one cell. Text cells that start with = + - @ or a tab/CR get a
// leading apostrophe so spreadsheet apps never evaluate them as formulas (CSV injection); Import strips one
// leading apostrophe from text cells.

import type { ListingMarketplace } from './types';

export const CSV_BOM = '﻿';
export const CSV_EOL = '\r\n';
export const TAG_SEPARATOR = ', ';

/** The base export columns, in order (§9.4). Header names are machine keys, never translated. */
export const LISTINGS_EXPORT_BASE_COLUMNS = ['id', 'title', 'price', 'currency', 'quantity', 'status', 'sku', 'tags', 'health', 'url'] as const;
export type ListingsExportBaseColumn = (typeof LISTINGS_EXPORT_BASE_COLUMNS)[number];

/** The id column's meaning per marketplace (Import maps it back). */
export const EXPORT_ID_MEANING: Record<ListingMarketplace, string> = {
  etsy: 'listing_id',
  ebay: 'sku',
  trendyol: 'barcode',
  wix: 'id',
  shopify: 'id',
  hepsiburada: 'hb_sku',
};

export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

/** Escapes one cell. Numbers and booleans are written as-is; text is formula-guarded and quoted when needed. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: readonly CsvCell[]): string {
  return cells.map(csvCell).join(',');
}

/** Serialises a header row plus records (keyed by column) into one CSV document. */
export function toCsv(columns: readonly string[], records: readonly Record<string, CsvCell>[], opts: { bom?: boolean } = {}): string {
  const lines = [csvLine(columns), ...records.map((r) => csvLine(columns.map((c) => r[c])))];
  return (opts.bom === false ? '' : CSV_BOM) + lines.join(CSV_EOL) + CSV_EOL;
}

/** Columns for one marketplace: base + per-marketplace extras (+ description last when asked). */
export function exportColumns(extras: readonly string[], includeDescription: boolean): string[] {
  const cols: string[] = [...LISTINGS_EXPORT_BASE_COLUMNS];
  for (const e of extras) if (!cols.includes(e)) cols.push(e);
  if (includeDescription) cols.push('description');
  return cols;
}

/** `etsy-listings-belle-couture-gifts-2026-10-15.csv`. ASCII-only slug (Turkish letters folded). */
export function exportFilename(marketplace: ListingMarketplace, storeName: string, date: Date = new Date()): string {
  const fold: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  const slug = storeName
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => fold[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${marketplace}-listings-${slug ? `${slug}-` : ''}${y}-${m}-${d}.csv`;
}

/** `Content-Disposition` value with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
