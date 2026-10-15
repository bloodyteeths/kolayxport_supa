// lib/research/exportCsv.ts — client CSV download for the Research hub tables (Product finder, Keyword explorer).
// Moved out of components/etsy/research/shared/exportUtils.ts (only `exportToCSV` was used outside the legacy
// research screens). UTF-8 BOM so Excel opens Turkish characters correctly; CRLF line ends.

export type CsvColumn = { key: string; label: string };

function escapeCell(val: unknown): string {
  if (val == null) return '';
  const str = Array.isArray(val) ? val.join('; ') : String(val);
  // Quote when the cell holds a comma, a quote or a line break.
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Pure: the CSV text (with BOM) for `data`; columns default to the first row's keys. Empty data → ''. */
export function buildCsv(data: Record<string, unknown>[], columns?: CsvColumn[]): string {
  if (!data.length) return '';
  const cols = columns ?? Object.keys(data[0]).map((k) => ({ key: k, label: k }));
  const header = cols.map((c) => escapeCell(c.label)).join(',');
  const rows = data.map((row) => cols.map((c) => escapeCell(row[c.key])).join(','));
  return `﻿${[header, ...rows].join('\r\n')}`;
}

/** Downloads `data` as `<filename>.csv`. No-op for empty data or outside the browser. */
export function exportToCSV(data: Record<string, unknown>[], filename: string, columns?: CsvColumn[]): void {
  const csv = buildCsv(data, columns);
  if (!csv || typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
