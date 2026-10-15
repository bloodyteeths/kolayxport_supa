// lib/bulk/fill.ts — BulkGrid fill-down ⌘D (bulk-grid.md §5.4). Pure.
//  · With selected rows: the focused cell's value goes into the same column of every selected row
//    (the focused row need not be selected; it is never its own target).
//  · Without a selection: the value of the row ABOVE goes into the focused cell (Excel).
// Per-row read-only cells are skipped and counted. Origin `'fill'`.
import {
  isReadOnlyColumn, readOnlyReason, sameCellValue, validateCellValue, type CellPatch, type GridCellSpec, type GridMessages, type PasteSkip,
} from './paste';

export type FillInput<T> = {
  rows: T[];
  getRowId(r: T): string;
  /** VISIBLE columns in display order. */
  columns: GridCellSpec<T>[];
  focus: { rowIndex: number; colIndex: number };
  selectedIds?: readonly string[];
  /** Current value of a cell (draft overlay, else live). */
  getValue(row: T, col: GridCellSpec<T>): unknown;
  messages: GridMessages;
  /** `${rowId}:${field}` currently invalid: filling a valid value there is never dropped (it fixes the cell). */
  isInvalid?(rowId: string, field: string): boolean;
};

export type FillOutcome =
  | { kind: 'error'; code: 'readOnlyColumn'; column: string }
  | { kind: 'error'; code: 'noSource' }
  | {
      kind: 'ok';
      mode: 'selection' | 'above';
      field: string;
      colType?: string;
      /** The copied value. */
      value: unknown;
      patches: CellPatch[];
      /** Targets that already hold the value: not emitted. */
      unchanged: number;
      skipped: number;
      skippedReasons: PasteSkip[];
    };

const clone = (v: unknown): unknown => (Array.isArray(v) ? [...v] : v);

export function planFill<T>(input: FillInput<T>): FillOutcome {
  const { rows, getRowId, columns, focus, getValue, messages, isInvalid } = input;
  const col = columns[focus.colIndex];
  const focusRow = rows[focus.rowIndex];
  if (!col || !focusRow) return { kind: 'error', code: 'noSource' };
  if (isReadOnlyColumn(col)) return { kind: 'error', code: 'readOnlyColumn', column: col.header };

  const selected = new Set(input.selectedIds ?? []);
  const focusId = getRowId(focusRow);
  let mode: 'selection' | 'above';
  let source: T;
  let targets: T[];
  if (selected.size > 0) {
    mode = 'selection';
    source = focusRow;
    targets = rows.filter((r) => selected.has(getRowId(r)) && getRowId(r) !== focusId);
  } else {
    mode = 'above';
    const above = rows[focus.rowIndex - 1];
    if (!above) return { kind: 'error', code: 'noSource' };
    source = above;
    targets = [focusRow];
  }
  const value = getValue(source, col);

  const patches: CellPatch[] = [];
  const skipped = new Map<string, number>();
  let unchanged = 0;
  for (const row of targets) {
    const reason = readOnlyReason(col, row);
    if (reason !== null) { skipped.set(reason, (skipped.get(reason) ?? 0) + 1); continue; }
    const error = validateCellValue(col, row, value, messages);
    const rowId = getRowId(row);
    if (!error && !isInvalid?.(rowId, col.field) && sameCellValue(value, getValue(row, col))) { unchanged += 1; continue; }
    patches.push(error ? { rowId, field: col.field, value: clone(value), error } : { rowId, field: col.field, value: clone(value) });
  }
  const skippedReasons = Array.from(skipped, ([reason, count]) => ({ reason, count }));
  return {
    kind: 'ok', mode, field: col.field, colType: col.type, value, patches, unchanged,
    skipped: skippedReasons.reduce((s, x) => s + x.count, 0), skippedReasons,
  };
}
