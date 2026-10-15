// lib/bulk/paste.ts — BulkGrid cell model + paste planner (bulk-grid.md §5.1, §5.3). Pure: no React, no DOM,
// no i18n lookups (messages are injected), so the 200 × 3 acceptance paste is unit-tested end to end.
import { mergeTags } from '@/components/ds/inputs/TagInput';
import { decodeEntities } from '@/lib/text/decodeEntities';
import { parseMoney, parseNumberText } from './parseMoney';
import { rectangleWidth } from './tsv';

export type GridEditType = 'text-edit' | 'money-edit' | 'int-edit' | 'tags-edit' | 'select-edit' | 'combobox-edit';
export type GridOption = { value: string; label: string };
export type GridOptions = GridOption[] | ((q: string) => Promise<GridOption[]>);
/** tags-edit rules shared by the popover editor (TagInput) and paste, so both entry paths agree. */
export type GridTagRules = {
  normalize?: (raw: string) => string;
  tagKey?: (tag: string) => string;
  validate?: (tag: string) => string | null;
};

/** The part of a BulkGrid column the pure helpers need (`GridColumn<T>` in ds/data/BulkGrid extends it). */
export interface GridCellSpec<T> {
  key: string;
  header: string;
  /** Staging field key (`price`, `tags`, `shop_section_id`…): `values`, `dirty`, `invalid` and patches use it. */
  field: string;
  type?: string;
  /** Live value. Default `row[key]`, then `row[field]`. */
  value?(r: T): unknown;
  currency?(r: T): string | undefined;
  /** `true` → editable; `{ reason }` → read-only for this row (tooltip). Omitted → editable. */
  editable?(row: T): true | { reason: string };
  /** Paste/typing text → value. Return `undefined` for "no such value". Replaces the default parser. */
  parse?(text: string, row: T): unknown;
  /** Value → copy / paste / edit text. */
  format?(value: unknown, row: T): string;
  /** A translated message, or null when valid. Runs after parse (and before the default `counter` check). */
  validate?(value: unknown, row: T): string | null;
  options?: GridOptions;
  maxTags?: number;
  maxTagLength?: number;
  /** tags-edit: per-row TagInput rules (Etsy: normalize = cleanTag, tagKey, validate). Paste applies them too. */
  tagInputProps?(row: T): GridTagRules | undefined;
  /** Text cells: character limit (caption `132/140`; over it the cell is invalid). */
  counter?: number;
}

export type CellPatch = {
  rowId: string;
  field: string;
  value: unknown;
  /**
   * Set when the value cannot be saved (BulkGrid parsed + validated it). The host keeps `value` (the raw text)
   * locally, marks `${rowId}:${field}` invalid with this message and never stages it (bulk-grid §1.2).
   */
  error?: string;
};

/** `error` set → `value` is the raw text (kept local); otherwise the parsed value. */
export type CellResult = { value: unknown; error: string | null };

/** Translated messages the default parsers emit (BulkGrid builds them from `ds.*` / `bulk.*`). */
export interface GridMessages {
  invalidNumber(): string;
  wholeNumber(): string;
  enterValue(): string;
  currency(currency: string): string;
  tooLong(max: number, length: number): string;
  tagTooLong(tag: string, length: number, max: number): string;
  tagOverLimit(max: number): string;
  /** A tag the column rules reject (normalize → empty, or `validate` without its own message). */
  tagInvalid(tag: string): string;
  noOption(value: string): string;
}

export const GRID_EDIT_TYPES: readonly GridEditType[] = ['text-edit', 'money-edit', 'int-edit', 'tags-edit', 'select-edit', 'combobox-edit'];

export function isGridEditType(type: string | undefined): type is GridEditType {
  return !!type && (GRID_EDIT_TYPES as readonly string[]).includes(type);
}

/** Whole-column read-only (thumb, health, status, changes, photos…): any column without a grid edit type. */
export function isReadOnlyColumn<T>(col: GridCellSpec<T>): boolean {
  return !isGridEditType(col.type);
}

/** Per-row editability: null = editable, otherwise the read-only reason. */
export function readOnlyReason<T>(col: GridCellSpec<T>, row: T): string | null {
  if (isReadOnlyColumn(col)) return '';
  const e = col.editable?.(row);
  if (e === undefined || e === true) return null;
  return e.reason;
}

/** Live value: `value(row)`, else `row[key]`, else `row[field]` (so `{ key: 'qty', field: 'quantity' }` works). */
export function liveValue<T>(col: GridCellSpec<T>, row: T): unknown {
  if (col.value) return col.value(row);
  const r = row as Record<string, unknown>;
  return col.key in r ? r[col.key] : r[col.field];
}

const lower = (s: string) => s.trim().toLocaleLowerCase();

/** Value → text (copy, paste round trip, initial edit text). */
export function formatCellValue<T>(col: GridCellSpec<T>, row: T, value: unknown): string {
  if (col.format) return col.format(value, row);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'number') {
    if (col.type === 'money-edit' || col.type === 'money') {
      // Plain, ungrouped, 2 decimals: re-pastes identically in both UI languages.
      return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
    }
    return String(value);
  }
  if ((col.type === 'select-edit' || col.type === 'combobox-edit') && Array.isArray(col.options)) {
    const opt = col.options.find((o) => o.value === String(value));
    if (opt) return opt.label;
  }
  return String(value);
}

/** Runs the column checks on an already-parsed value: `validate`, then the `counter` limit. */
export function validateCellValue<T>(col: GridCellSpec<T>, row: T, value: unknown, msg: GridMessages): string | null {
  const custom = col.validate?.(value, row) ?? null;
  if (custom) return custom;
  if (col.counter != null && typeof value === 'string' && value.length > col.counter) return msg.tooLong(col.counter, value.length);
  return null;
}

function matchOption(options: GridOptions | undefined, text: string): GridOption | null {
  if (!Array.isArray(options)) return null;
  const q = lower(text);
  return options.find((o) => lower(o.value) === q) ?? options.find((o) => lower(o.label) === q) ?? null;
}

/** Text → value through the column parser (or the default for its type), then validation. */
export function evaluateCellText<T>(col: GridCellSpec<T>, row: T, text: string, msg: GridMessages): CellResult {
  let value: unknown;
  if (col.parse) {
    value = col.parse(text, row);
    if (value === undefined) return { value: text, error: msg.noOption(text.trim()) };
  } else {
    switch (col.type) {
      case 'money-edit': {
        const r = parseMoney(text, col.currency?.(row));
        if (!r.ok) {
          const error = r.code === 'empty' ? msg.enterValue() : r.code === 'currency' ? msg.currency(col.currency?.(row) ?? '') : msg.invalidNumber();
          return { value: text, error };
        }
        value = r.value;
        break;
      }
      case 'int-edit': {
        const r = parseNumberText(text);
        if (!r.ok) return { value: text, error: r.code === 'empty' ? msg.enterValue() : msg.invalidNumber() };
        if (!Number.isInteger(r.value)) return { value: text, error: msg.wholeNumber() };
        value = r.value;
        break;
      }
      case 'tags-edit': {
        // Paste replaces the listing's tags (not append): merge onto [] with the column limits.
        const pieces = text.split(/[,\n\t]/);
        // Same rules as the popover editor (normalize / tagKey / validate); duplicates are simply merged.
        const rules = col.tagInputProps?.(row) ?? {};
        const res = mergeTags([], pieces, {
          max: col.maxTags, maxLength: col.maxTagLength, normalize: rules.normalize, tagKey: rules.tagKey, validate: rules.validate,
        });
        const tooLong = res.rejected.find((r) => r.reason === 'too_long');
        if (tooLong) return { value: text, error: msg.tagTooLong(tooLong.tag, tooLong.tag.length, col.maxTagLength ?? 0) };
        const bad = res.rejected.find((r) => r.reason === 'invalid');
        if (bad) return { value: text, error: bad.message ?? msg.tagInvalid(bad.tag) };
        if (res.rejected.some((r) => r.reason === 'over_limit')) return { value: text, error: msg.tagOverLimit(col.maxTags ?? 0) };
        value = res.tags;
        break;
      }
      case 'select-edit':
      case 'combobox-edit': {
        if (!text.trim()) return { value: text, error: msg.enterValue() };
        const opt = matchOption(col.options, text);
        if (!opt) return { value: text, error: msg.noOption(text.trim()) };
        value = opt.value;
        break;
      }
      default:
        value = decodeEntities(text.trim());
    }
  }
  const error = validateCellValue(col, row, value, msg);
  // An invalid cell keeps exactly what the seller typed / pasted (shown with the danger outline, never staged).
  return error ? { value: text, error } : { value, error: null };
}

// ---------------------------------------------------------------------------
// Paste planner (§5.3 steps 3–8)
// ---------------------------------------------------------------------------

export type PasteInput<T> = {
  matrix: string[][];
  rows: T[];
  getRowId(r: T): string;
  /** VISIBLE columns in display order (frozen first). */
  columns: GridCellSpec<T>[];
  focus: { rowIndex: number; colIndex: number };
  selectedIds?: readonly string[];
  messages: GridMessages;
  /** Current cell value (draft overlay, else live). Given → valid cells equal to it are dropped (`unchanged`). */
  getValue?(row: T, col: GridCellSpec<T>): unknown;
  /** `${rowId}:${field}` currently invalid: a valid value there is never dropped (it fixes the cell). */
  isInvalid?(rowId: string, field: string): boolean;
};

/** Same value? Arrays compare element-wise (tags). */
export function sameCellValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b || (a == null && b == null);
}

export type PasteSkip = { reason: string; count: number };

export type PasteOutcome =
  | { kind: 'error'; code: 'empty' | 'notRect' }
  | { kind: 'error'; code: 'readOnlyColumn'; column: string }
  | {
      kind: 'ok';
      /** Every applied cell (valid ones without `error`, invalid ones with it): one `onCellsChange` call. */
      patches: CellPatch[];
      rows: number;
      /** Columns actually applied (clipboard width minus `colOverflow`). */
      cols: number;
      /** Valid cells that change something (staged). */
      edits: number;
      /** Valid cells equal to the current value: not emitted. */
      unchanged: number;
      /** Cells that stay local with an error. */
      invalid: number;
      /** Per-row read-only cells (variations, stock-managed, sending), with their reasons. */
      skipped: number;
      skippedReasons: PasteSkip[];
      /** Clipboard rows that didn't fit on this page. */
      overflow: number;
      /** Clipboard columns to the right of the last visible column (dropped). */
      colOverflow: number;
      /** true when a single value was pasted into every selected row. */
      intoSelection: boolean;
      /** Distinct rows that received a patch. */
      rowIds: string[];
    };

/** Plans a paste. Never mutates; the caller emits `patches` once with origin `'paste'`. */
export function planPaste<T>(input: PasteInput<T>): PasteOutcome {
  const { rows, getRowId, columns, focus, messages, getValue, isInvalid } = input;
  const matrix = input.matrix.filter((_, i, all) => !(i === all.length - 1 && all.length > 1 && all[i].every((c) => c === '')));
  if (matrix.length === 0) return { kind: 'error', code: 'empty' };
  const width = rectangleWidth(matrix);
  if (width === null) return { kind: 'error', code: 'notRect' };

  const selected = new Set(input.selectedIds ?? []);
  const focusRow = rows[focus.rowIndex];
  const single = matrix.length === 1 && width === 1;
  const intoSelection = single && !!focusRow && selected.size > 0 && selected.has(getRowId(focusRow));

  const targetCols = columns.slice(focus.colIndex, focus.colIndex + width);
  const lockedCol = targetCols.find((c) => isReadOnlyColumn(c));
  if (lockedCol) return { kind: 'error', code: 'readOnlyColumn', column: lockedCol.header };
  const colsFit = targetCols.length; // a block wider than the remaining columns: the extra columns are dropped

  let targetRows: T[];
  let overflow = 0;
  if (intoSelection) {
    targetRows = rows.filter((r) => selected.has(getRowId(r)));
  } else {
    targetRows = rows.slice(focus.rowIndex, focus.rowIndex + matrix.length);
    overflow = Math.max(0, matrix.length - targetRows.length);
  }

  const patches: CellPatch[] = [];
  const skipped = new Map<string, number>();
  const rowIds = new Set<string>();
  let invalid = 0;
  let unchanged = 0;
  targetRows.forEach((row, ri) => {
    const rowId = getRowId(row);
    const line = intoSelection ? matrix[0] : matrix[ri];
    for (let ci = 0; ci < colsFit; ci += 1) {
      const col = targetCols[ci];
      const reason = readOnlyReason(col, row);
      if (reason !== null) { skipped.set(reason, (skipped.get(reason) ?? 0) + 1); continue; }
      const text = line[ci] ?? '';
      const res = evaluateCellText(col, row, text, messages);
      if (res.error) { invalid += 1; patches.push({ rowId, field: col.field, value: res.value, error: res.error }); }
      else if (getValue && !isInvalid?.(rowId, col.field) && sameCellValue(res.value, getValue(row, col))) { unchanged += 1; continue; }
      else patches.push({ rowId, field: col.field, value: res.value });
      rowIds.add(rowId);
    }
  });

  const skippedReasons = Array.from(skipped, ([reason, count]) => ({ reason, count }));
  return {
    kind: 'ok',
    patches,
    rows: intoSelection ? targetRows.length : matrix.length,
    cols: colsFit,
    edits: patches.length - invalid,
    unchanged,
    invalid,
    skipped: skippedReasons.reduce((s, x) => s + x.count, 0),
    skippedReasons,
    overflow,
    colOverflow: width - colsFit,
    intoSelection,
    rowIds: Array.from(rowIds),
  };
}
