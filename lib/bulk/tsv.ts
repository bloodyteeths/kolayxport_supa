// lib/bulk/tsv.ts — clipboard TSV for BulkGrid (bulk-grid.md §5.3 step 2). Pure, no DOM.
// Excel / Google Sheets quoting: a field that starts with `"` may contain tabs, newlines and `""` (an escaped
// quote). `\r\n` and lone `\r` are read as `\n`; one trailing newline is dropped (Sheets always adds one).

/** Parses clipboard text into rows × cells. Empty input → `[]`. */
export function parseTsv(input: string): string[][] {
  if (!input) return [];
  const text = input.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let atCellStart = true;
  while (i < text.length) {
    const ch = text[i];
    if (atCellStart && ch === '"') {
      // Quoted field: runs to the closing quote that is not doubled.
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < text.length) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { value += '"'; j += 2; continue; }
          closed = true;
          j += 1;
          break;
        }
        value += text[j];
        j += 1;
      }
      if (closed && (j >= text.length || text[j] === '\t' || text[j] === '\n')) {
        cell = value;
        i = j;
        atCellStart = false;
        continue;
      }
      // Not a well-formed quoted field (e.g. `"5" wide`): read it literally.
      cell += ch;
      i += 1;
      atCellStart = false;
      continue;
    }
    if (ch === '\t') { row.push(cell); cell = ''; atCellStart = true; i += 1; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; atCellStart = true; i += 1; continue; }
    cell += ch;
    atCellStart = false;
    i += 1;
  }
  // The last line: kept unless the text ended with a newline (the "one trailing newline" rule).
  if (!atCellStart || cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Drops trailing empty cells of one row (Sheets pads ragged selections with them). Keeps at least one cell. */
export function trimRow(row: string[]): string[] {
  let end = row.length;
  while (end > 1 && row[end - 1] === '') end -= 1;
  return row.slice(0, end);
}

/**
 * Rectangle check (§5.3 step 4) after trimming trailing empty cells per row. Returns the column count, or
 * null when rows have different lengths. A block whose right-most column is empty in every row keeps its width.
 */
export function rectangleWidth(rows: string[][]): number | null {
  if (rows.length === 0) return null;
  const raw = rows[0].length;
  if (rows.every((r) => r.length === raw)) return raw;
  const widths = rows.map((r) => trimRow(r).length);
  const w = widths[0];
  return widths.every((x) => x === w) ? w : null;
}

/** Encodes one cell for the clipboard (quotes it when it contains a tab, newline or quote). */
export function tsvCell(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rows × cells → clipboard text (no trailing newline). */
export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map(tsvCell).join('\t')).join('\n');
}
