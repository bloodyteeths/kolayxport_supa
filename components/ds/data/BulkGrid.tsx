// ds/data/BulkGrid<T> (bulk-grid.md §4, §5.1, §5.3, §5.4; DESIGN_SYSTEM §3.17). A thin layer over DataTable
// `mode="grid"`: roving cell focus, cell editors (text/money/int inline; tags/select/combobox in a popover),
// frozen columns, TSV paste from Sheets/Excel, ⌘D fill-down, ⌘C copy, Revert cell/row, grid ARIA roles.
// Desktop only (the host shows the "larger screen" EmptyState below 900px). No undo stack (DS): Revert.
// BulkGrid never stages anything itself: it parses + validates and emits ONE `onCellsChange` per user action;
// the host (components/domain/bulk/useBulkStaging, M7-C) keeps invalid cells local and stages valid ones.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Box, Menu, MenuItem, Tooltip } from '@mui/material';
import { useTranslations } from 'next-intl';
import { accent, neutral as n, tone as toneTokens, px, space, zIndex } from '@/lib/ds/tokens';
import { useToast } from '@/components/ds/feedback/toast';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import type { ComboboxOption } from '@/components/ds/inputs/Combobox';
import {
  evaluateCellText, formatCellValue, isGridEditType, liveValue, planPaste, readOnlyReason, sameCellValue, validateCellValue,
  type CellPatch, type GridCellSpec, type GridEditType, type GridMessages, type GridOption, type PasteOutcome,
} from '@/lib/bulk/paste';
import { planFill, type FillOutcome } from '@/lib/bulk/fill';
import { parseTsv } from '@/lib/bulk/tsv';
import { DataTable, type DataTableGridMode, type DataTableProps, type DataTableState } from './DataTable';
import { colAlign, renderTypedCell, useColumnVisibility, type Column, type ColumnType, type MobileRole, type Sort } from './dataTableParts';
import { useDsFormat } from './fmt';
import { CellEditor, type EditorExit } from './grid/CellEditor';
import { TagsCellEditor, type TagsCellEditorProps } from './grid/TagsCellEditor';
import { SelectCellEditor } from './grid/SelectCellEditor';
import { ComboboxCellEditor } from './grid/ComboboxCellEditor';
import { frozenCellSx, frozenOffsets, orderFrozenFirst, useHorizontalScrolled, useMeasuredFrozenWidths } from './grid/FrozenColumns';
import { tabStep, useGridFocus, type GridPos } from './grid/useGridFocus';

export type { GridEditType, CellPatch, PasteOutcome, FillOutcome, GridOption };

export type CellOrigin = 'edit' | 'paste' | 'fill' | 'replace' | 'ai';

export interface GridColumn<T> extends Omit<Column<T>, 'type' | 'validate' | 'mobile' | 'readOnlyReason'>, GridCellSpec<T> {
  type?: ColumnType | GridEditType;
  frozen?: boolean;
  /** Unused by the grid (desktop only); kept so a list config can be reused. */
  mobile?: MobileRole;
  /** Display of the (overlay-aware) value. Default by type; read-only typed columns use `render` / typed cells. */
  renderValue?(value: unknown, row: T): ReactNode;
  /** tags-edit: TagInput rules per row (Etsy: cleanTag, tagKey, tagTitleOverlap, flagOverlapWith = title). */
  tagInputProps?(row: T): TagsCellEditorProps['tagInputProps'];
}

export interface BulkGridProps<T> {
  rows: T[];
  getRowId(r: T): string;
  columns: GridColumn<T>[];
  /** Draft overlay (staged + local) by row id → field. A present key wins over the live value. */
  values: Record<string, Record<string, unknown>>;
  /** `${rowId}:${field}` staged or pending. */
  dirty: Set<string>;
  /** `${rowId}:${field}` → message (local only, never staged). */
  invalid: Map<string, string>;
  /** One call per user action. A patch with `error` is invalid: keep it local, don't stage it. */
  onCellsChange(patches: CellPatch[], origin: CellOrigin): void;
  /** `field` undefined = the whole row. */
  onRevert(cells: { rowId: string; field?: string }[]): void;
  selection: { ids: string[]; onChange(ids: string[]): void };
  pagination?: DataTableProps<T>['pagination'];
  columnStateKey: string;
  /** e.g. "Will be deleted on send" — shown under the first frozen column's value. */
  rowMeta?(r: T): ReactNode;
  state?: DataTableState;
  empty?: ReactNode;
  error?: ReactNode;
  loading?: ReactNode;
  sort?: Sort | null;
  onSortChange?(sort: Sort): void;
  ariaLabel?: string;
  maxHeight?: number | string;
  /** Paste result for the page Banner (§3.3), including refusals (`kind: 'error'`). See `usePasteSummary`. */
  onPasteResult?(outcome: PasteOutcome): void;
  /** Fill result (after the patches were emitted, or a refusal). BulkGrid already shows the "Filled N" toast. */
  onFillResult?(outcome: FillOutcome): void;
  /** ⌘F inside the grid: open Find & replace with this field preselected. */
  onFind?(field: string | null): void;
  /** ⌘↵: the page primary (Send N changes) — the host confirms. */
  onSend?(): void;
  /** ⌘S: flush the staging debounce now. */
  onFlush?(): void;
  /** Marketplace name for the "no undo" hint on ⌘Z ("…restore the value on Etsy"). */
  sourceLabel?: string;
  /** Tag fill over > 10 rows asks first. Default: DS `useConfirm`. */
  confirmFill?(info: { count: number; tags: number }): Promise<boolean>;
  className?: string;
  'data-testid'?: string;
}

const FILL_CONFIRM_ABOVE = 10;
const FLASH_MS = 2500;
const INLINE_TYPES = new Set<string>(['text-edit', 'money-edit', 'int-edit']);

type Editing = { rowId: string; colKey: string; initial?: string; replace?: boolean; anchor?: HTMLElement | null };

/** Horizontal padding of a body cell (DataTable bodyCellSx `px: space[3]`), both sides. */
const CELL_PAD_X = space[3] * 2;
const MAX_SKIP_REASONS = 2;

/** Translated messages for the default parsers. */
function useGridMessages(): GridMessages {
  const tt = useTranslations('ds.table');
  const tg = useTranslations('ds.grid');
  const tb = useTranslations('bulk');
  const ttag = useTranslations('ds.inputs.tagInput');
  return useMemo<GridMessages>(() => ({
    invalidNumber: () => tt('invalidNumber'),
    wholeNumber: () => tt('wholeNumber'),
    enterValue: () => tb('invalid.enterValue'),
    currency: (currency) => tb('invalid.currency', { currency }),
    tooLong: (max, length) => tg('tooLong', { max, length }),
    tagTooLong: (tag, length, max) => ttag('tooLong', { tag, length, max }),
    tagOverLimit: (max) => ttag('overLimit', { max }),
    tagInvalid: (tag) => ttag('invalid', { tag }),
    noOption: (value) => tg('noOption', { value }),
  }), [tt, tg, tb, ttag]);
}

/** Banner text + tone for a paste outcome (bulk-grid §3.3). null = nothing to say (empty clipboard). */
export function usePasteSummary(): (o: PasteOutcome) => { tone: 'success' | 'warning' | 'danger'; message: string } | null {
  const tb = useTranslations('bulk');
  return useCallback((o: PasteOutcome) => {
    if (o.kind === 'error') {
      if (o.code === 'notRect') return { tone: 'danger' as const, message: tb('paste.notRect') };
      if (o.code === 'readOnlyColumn') return { tone: 'danger' as const, message: tb('paste.readOnlyColumn', { column: o.column }) };
      return null;
    }
    const parts = [tb('paste.result', { rows: o.rows, cols: o.cols, edits: o.edits, invalid: o.invalid, skipped: o.skipped })];
    if (o.overflow > 0) parts.push(tb('paste.overflow', { count: o.overflow }));
    if (o.colOverflow > 0) parts.push(tb('paste.colOverflow', { count: o.colOverflow }));
    for (const s of o.skippedReasons.slice(0, MAX_SKIP_REASONS)) {
      if (s.reason) parts.push(tb('paste.skippedReason', { count: s.count, reason: s.reason }));
    }
    if (o.unchanged > 0) parts.push(tb('paste.unchanged', { count: o.unchanged }));
    const tone = o.invalid > 0 || o.overflow > 0 || o.skipped > 0 || o.colOverflow > 0 ? 'warning' as const : 'success' as const;
    return { tone, message: parts.join(' · ') };
  }, [tb]);
}

export function BulkGrid<T>(props: BulkGridProps<T>) {
  const {
    rows, getRowId, columns, values, dirty, invalid, onCellsChange, onRevert, selection, pagination, columnStateKey,
    rowMeta, state = 'ready', empty, error, loading, sort, onSortChange, ariaLabel, maxHeight, onPasteResult, onFillResult,
    onFind, onSend, onFlush, sourceLabel, confirmFill, className, 'data-testid': testId,
  } = props;
  const tg = useTranslations('ds.grid');
  const tb = useTranslations('bulk');
  const fmt = useDsFormat();
  const messages = useGridMessages();
  const toast = useToast();
  const dsConfirm = useConfirm();
  const statusId = `${useId().replace(/:/g, '')}-grid-status`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Combobox labels picked in this session, keyed by field + VALUE (never by cell): a label only shows for its value. */
  const labelCache = useRef(new Map<string, string>());
  const [scrolled, setScrolled] = useHorizontalScrolled();

  // ---------- columns ----------
  const ordered = useMemo(() => orderFrozenFirst(columns), [columns]);
  const byKey = useMemo(() => new Map(ordered.map((c) => [c.key, c])), [ordered]);
  const dtColumns = useMemo<Column<T>[]>(() => ordered.map((c) => ({
    ...(c as unknown as Column<T>),
    type: isGridEditType(c.type) ? undefined : (c.type as ColumnType | undefined),
    mobile: c.mobile ?? 'hidden',
    validate: undefined,
    readOnlyReason: undefined,
  })), [ordered]);
  const visibility = useColumnVisibility(columnStateKey, dtColumns);
  const visibleCols = useMemo(
    () => ordered.filter((c) => c.desktop !== false && !visibility.hidden.has(c.key)),
    [ordered, visibility.hidden],
  );
  const colKeys = useMemo(() => visibleCols.map((c) => c.key), [visibleCols]);
  const rowIds = useMemo(() => rows.map(getRowId), [rows, getRowId]);
  const rowById = useMemo(() => new Map(rows.map((r) => [getRowId(r), r])), [rows, getRowId]);
  // The checkbox column is always there (selection is required), frozen at left 0. Offsets come from the
  // rendered header widths (table-layout auto), the declared widths only until measured.
  const frozenCount = useMemo(() => { let i = 0; while (i < visibleCols.length && visibleCols[i].frozen) i += 1; return i; }, [visibleCols]);
  const measuredFrozen = useMeasuredFrozenWidths(containerRef, colKeys, frozenCount, true);
  const frozen = useMemo(() => frozenOffsets(visibleCols, true, measuredFrozen), [visibleCols, measuredFrozen]);
  const selectedSet = useMemo(() => new Set(selection.ids), [selection.ids]);

  // ---------- focus / editing / transient message ----------
  const { pos, setPos, focusDom } = useGridFocus({ rowIds, colKeys, containerRef });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [flash, setFlash] = useState<{ key: string; message: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; rowId: string; field: string } | null>(null);
  useEffect(() => {
    if (!flash) return undefined;
    const h = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(h);
  }, [flash]);
  useEffect(() => {
    if (editing && !rowById.has(editing.rowId)) setEditing(null);
  }, [editing, rowById]);

  const getValue = useCallback((row: T, col: GridCellSpec<T>): unknown => {
    const ov = values[getRowId(row)];
    if (ov && Object.prototype.hasOwnProperty.call(ov, col.field)) return ov[col.field];
    return liveValue(col, row);
  }, [values, getRowId]);

  const cellAt = (p: GridPos) => ({ row: rows[p.rowIndex], col: visibleCols[p.colIndex] });
  const keyOf = (rowId: string, field: string) => `${rowId}:${field}`;

  const emit = useCallback((patches: CellPatch[], origin: CellOrigin) => {
    if (patches.length > 0) onCellsChange(patches, origin);
  }, [onCellsChange]);

  // ---------- editing ----------
  const startEdit = (p: GridPos, typed?: string) => {
    const { row, col } = cellAt(p);
    if (!row || !col) return;
    const reason = readOnlyReason(col, row);
    if (reason !== null) { if (reason) setFlash({ key: keyOf(getRowId(row), col.field), message: reason }); return; }
    const rowId = getRowId(row);
    if (INLINE_TYPES.has(col.type ?? '')) {
      if (typed !== undefined) { setEditing({ rowId, colKey: col.key, initial: typed, replace: true }); return; }
      const v = getValue(row, col);
      const initial = col.type === 'money-edit' && typeof v === 'number' && !col.format
        ? fmt.num(v, { decimals: 2 }).replace(/\s/g, '')
        : formatCellValue(col, row, v);
      setEditing({ rowId, colKey: col.key, initial });
      return;
    }
    const anchor = containerRef.current?.querySelector<HTMLElement>(`[data-gr="${p.rowIndex}"][data-gc="${p.colIndex}"]`) ?? null;
    setEditing({ rowId, colKey: col.key, anchor });
  };

  const exitMove = (p: GridPos, exit: EditorExit) => {
    if (exit === 'stay') { setPos(p); return; }
    if (exit === 'down') setPos({ rowIndex: p.rowIndex + 1, colIndex: p.colIndex });
    else if (exit === 'up') setPos({ rowIndex: p.rowIndex - 1, colIndex: p.colIndex });
    else {
      const next = tabStep(p, exit === 'right' ? 1 : -1, rows.length, visibleCols.length);
      setPos(next ?? p);
    }
  };

  const commitValue = (rowId: string, col: GridColumn<T>, value: unknown, error: string | null) => {
    const row = rowById.get(rowId);
    if (!row) return;
    const k = keyOf(rowId, col.field);
    if (!error && !invalid.has(k) && sameCellValue(value, getValue(row, col))) return; // nothing changed
    emit([error ? { rowId, field: col.field, value, error } : { rowId, field: col.field, value }], 'edit');
  };

  const closeEditor = (exit: EditorExit | null) => {
    const ed = editing;
    setEditing(null);
    if (!ed || exit === 'blur') return;
    const r = rowIds.indexOf(ed.rowId);
    const c = colKeys.indexOf(ed.colKey);
    if (r < 0 || c < 0) return;
    if (exit) exitMove({ rowIndex: r, colIndex: c }, exit);
    else setTimeout(() => focusDom({ rowIndex: r, colIndex: c }), 0);
  };

  // ---------- revert / fill / clear ----------
  const revertAt = (p: GridPos) => {
    const { row, col } = cellAt(p);
    if (!row || !col) return;
    if (selection.ids.length > 0) onRevert(rows.filter((r) => selectedSet.has(getRowId(r))).map((r) => ({ rowId: getRowId(r) })));
    else onRevert([{ rowId: getRowId(row), field: col.field }]);
  };

  const runFill = async (p: GridPos) => {
    const { row, col } = cellAt(p);
    if (!row || !col) return;
    // A local invalid value is never copied into other rows.
    const sourceRow = selection.ids.length > 0 ? row : rows[p.rowIndex - 1];
    if (sourceRow) {
      const msg = invalid.get(keyOf(getRowId(sourceRow), col.field));
      if (msg) { setFlash({ key: keyOf(getRowId(row), col.field), message: msg }); return; }
    }
    const outcome = planFill({
      rows, getRowId, columns: visibleCols, focus: p, selectedIds: selection.ids, getValue, messages,
      isInvalid: (rowId, field) => invalid.has(keyOf(rowId, field)),
    });
    if (outcome.kind === 'ok' && outcome.patches.length > 0) {
      if (outcome.colType === 'tags-edit' && outcome.patches.length > FILL_CONFIRM_ABOVE) {
        const tagsCount = Array.isArray(outcome.value) ? outcome.value.length : 0;
        const ask = confirmFill ?? ((info: { count: number; tags: number }) => dsConfirm({ title: tb('fill.confirmTags', info) }));
        if (!(await ask({ count: outcome.patches.length, tags: tagsCount }))) return;
      }
      emit(outcome.patches, 'fill');
      const cells = outcome.patches.map((x) => ({ rowId: x.rowId, field: x.field }));
      toast.success(tb('fill.done', { count: outcome.patches.length }), { undo: () => onRevert(cells), undoLabel: tg('revert') });
    }
    onFillResult?.(outcome);
  };

  const clearAt = (p: GridPos) => {
    const { row, col } = cellAt(p);
    if (!row || !col) return;
    const rowId = getRowId(row);
    const reason = readOnlyReason(col, row);
    if (reason !== null) { if (reason) setFlash({ key: keyOf(rowId, col.field), message: reason }); return; }
    if (col.type === 'text-edit') commitValue(rowId, col, '', validateCellValue(col, row, '', messages));
    else if (col.type === 'tags-edit') commitValue(rowId, col, [], validateCellValue(col, row, [], messages));
    else setFlash({ key: keyOf(rowId, col.field), message: messages.enterValue() });
  };

  // ---------- keyboard (navigate mode) ----------
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.dataset || target.dataset.gc === undefined || editing || !pos) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    const move = (p: GridPos) => { e.preventDefault(); setPos(p); setFlash(null); };
    const last = { row: rows.length - 1, col: visibleCols.length - 1 };

    if (key === 'ArrowDown') return move(mod ? { rowIndex: last.row, colIndex: pos.colIndex } : { rowIndex: pos.rowIndex + 1, colIndex: pos.colIndex });
    if (key === 'ArrowUp') return move(mod ? { rowIndex: 0, colIndex: pos.colIndex } : { rowIndex: pos.rowIndex - 1, colIndex: pos.colIndex });
    if (key === 'ArrowRight') return move({ rowIndex: pos.rowIndex, colIndex: pos.colIndex + 1 });
    if (key === 'ArrowLeft') return move({ rowIndex: pos.rowIndex, colIndex: pos.colIndex - 1 });
    if (key === 'Home') return move({ rowIndex: pos.rowIndex, colIndex: 0 });
    if (key === 'End') return move({ rowIndex: pos.rowIndex, colIndex: last.col });
    if (key === 'Tab') {
      const next = tabStep(pos, e.shiftKey ? -1 : 1, rows.length, visibleCols.length);
      if (next) move(next); // at either end Tab leaves the grid (no preventDefault)
      return;
    }
    if (key === 'Enter' && mod) { if (onSend) { e.preventDefault(); onSend(); } return; }
    if (key === 'Enter' || key === 'F2') { e.preventDefault(); startEdit(pos); return; }
    if (key === 'Backspace' && e.altKey) { e.preventDefault(); revertAt(pos); return; }
    if ((key === 'Delete' || key === 'Backspace') && !mod) { e.preventDefault(); clearAt(pos); return; }
    if (key === ' ' && !mod) {
      e.preventDefault();
      const id = rowIds[pos.rowIndex];
      selection.onChange(selectedSet.has(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id]);
      return;
    }
    if (key === 'Escape') {
      if (selection.ids.length > 0) { e.preventDefault(); selection.onChange([]); }
      else target.blur();
      return;
    }
    if (mod && (key === 'a' || key === 'A')) { e.preventDefault(); selection.onChange(Array.from(new Set([...selection.ids, ...rowIds]))); return; }
    if (mod && (key === 'd' || key === 'D')) { e.preventDefault(); void runFill(pos); return; }
    if (mod && (key === 'f' || key === 'F')) { if (onFind) { e.preventDefault(); onFind(visibleCols[pos.colIndex]?.field ?? null); } return; }
    if (mod && (key === 'c' || key === 'C')) {
      // The copy event below fills the clipboard when the browser fires it on the focused cell; this covers
      // browsers that don't fire `copy` without a text selection. Write-only: no clipboard read permission.
      const sel = typeof window !== 'undefined' ? window.getSelection?.()?.toString() : '';
      const { row, col } = cellAt(pos);
      if (!sel && row && col && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(formatCellValue(col, row, getValue(row, col))).catch(() => { /* blocked: nothing to do */ });
      }
      return;
    }
    if (mod && (key === 's' || key === 'S')) { e.preventDefault(); onFlush?.(); return; }
    if (mod && (key === 'z' || key === 'Z')) {
      e.preventDefault();
      const { row, col } = cellAt(pos);
      if (row && col) setFlash({ key: keyOf(getRowId(row), col.field), message: tb('shortcuts.noUndo', { on: sourceLabel ?? '' }) });
      return;
    }
    // Printable key: edit and replace the value (text, money, int only).
    if (key.length === 1 && !mod && !e.altKey) {
      const col = visibleCols[pos.colIndex];
      if (col && INLINE_TYPES.has(col.type ?? '')) { e.preventDefault(); startEdit(pos, key); }
    }
  };

  // ---------- clipboard ----------
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (editing || !pos || !target.dataset || target.dataset.gc === undefined) return; // inside an editor: native paste
    const text = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    const outcome = planPaste({
      matrix: parseTsv(text), rows, getRowId, columns: visibleCols, focus: pos, selectedIds: selection.ids, messages,
      getValue, isInvalid: (rowId, field) => invalid.has(keyOf(rowId, field)),
    });
    if (outcome.kind === 'ok') emit(outcome.patches, 'paste');
    onPasteResult?.(outcome);
  };

  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (editing || !pos || !target.dataset || target.dataset.gc === undefined) return;
    const { row, col } = cellAt(pos);
    if (!row || !col) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', formatCellValue(col, row, getValue(row, col)));
  };

  // ---------- rendering ----------
  const labelKey = (col: GridColumn<T>, v: unknown) => `${col.field}\u0000${String(v)}`;
  const optionLabel = (col: GridColumn<T>, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(col.options)) {
      const o = col.options.find((x) => x.value === String(v));
      if (o) return o.label;
    }
    return labelCache.current.get(labelKey(col, v)) ?? String(v);
  };

  const display = (col: GridColumn<T>, dtCol: Column<T>, row: T, rowId: string): ReactNode => {
    const k = keyOf(rowId, col.field);
    const v = getValue(row, col);
    if (invalid.has(k)) return Array.isArray(v) ? v.join(', ') : String(v ?? '');
    if (col.renderValue) return col.renderValue(v, row);
    const hasOverlay = !!values[rowId] && Object.prototype.hasOwnProperty.call(values[rowId], col.field);
    if (!isGridEditType(col.type)) return renderTypedCell(dtCol, row, fmt);
    if (!hasOverlay && col.render) return col.render(row);
    switch (col.type) {
      case 'money-edit':
        return typeof v === 'number' && Number.isFinite(v) ? fmt.money(v, col.currency?.(row) ?? 'USD') : '—';
      case 'int-edit':
        return typeof v === 'number' && Number.isFinite(v) ? fmt.num(v) : '—';
      case 'tags-edit': {
        const list = Array.isArray(v) ? v.map(String) : [];
        if (list.length === 0) return '—';
        return (
          <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: px(space[1]), minWidth: 0 }}>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{list.join(', ')}</Box>
            <Box component="span" sx={{ flexShrink: 0, color: n[500], fontSize: px(12), fontVariantNumeric: 'tabular-nums' }}>{fmt.num(list.length)}</Box>
          </Box>
        );
      }
      case 'select-edit':
      case 'combobox-edit':
        return col.format ? col.format(v, row) : optionLabel(col, v);
      default:
        return v === null || v === undefined || v === '' ? '—' : String(v);
    }
  };

  const focusedKey = pos && rows[pos.rowIndex] && visibleCols[pos.colIndex]
    ? keyOf(getRowId(rows[pos.rowIndex]), visibleCols[pos.colIndex].field)
    : null;
  const firstMetaCol = visibleCols.find((c) => c.frozen && c.type !== 'thumb') ?? null;

  const statusText = (() => {
    if (!pos) return '';
    const { row, col } = cellAt(pos);
    if (!row || !col) return '';
    const k = keyOf(getRowId(row), col.field);
    const parts: string[] = [];
    const ro = readOnlyReason(col, row);
    if (ro) parts.push(tg('readOnly', { reason: ro }));
    if (invalid.has(k)) parts.push(tg('invalid', { reason: invalid.get(k) ?? '' }));
    else if (dirty.has(k)) parts.push(tg('edited'));
    if (flash && flash.key === k) parts.push(flash.message);
    return parts.join(' · ');
  })();

  const grid: DataTableGridMode<T> = {
    containerRef,
    visibility,
    onHorizontalScroll: setScrolled,
    tableProps: {
      role: 'grid',
      'aria-rowcount': rows.length + 1,
      'aria-colcount': visibleCols.length + 1,
      'aria-multiselectable': 'true',
    },
    containerProps: { onKeyDown, onPaste, onCopy },
    rowProps: (r, ri) => ({ 'aria-rowindex': ri + 2, 'aria-selected': selectedSet.has(getRowId(r)) }),
    selectCellSx: { position: 'sticky', left: 0, zIndex: 1 },
    headCellSx: (c) => {
      const left = frozen.left.get(c.key);
      return left === undefined ? undefined : frozenCellSx(left, { header: true, last: frozen.lastKey === c.key, scrolled, bg: n[25] });
    },
    cellProps: (dtCol, row, ctx) => {
      const col = byKey.get(dtCol.key);
      if (!col) return {};
      const k = keyOf(ctx.rowId, col.field);
      const isDirty = dirty.has(k);
      const invalidMsg = invalid.get(k);
      const ro = readOnlyReason(col, row);
      const focused = !!pos && pos.rowIndex === ctx.rowIndex && pos.colIndex === ctx.colIndex;
      const isEditing = !!editing && editing.rowId === ctx.rowId && editing.colKey === col.key && INLINE_TYPES.has(col.type ?? '');
      const left = frozen.left.get(col.key);
      const shadows: string[] = [];
      if (isDirty && !invalidMsg) shadows.push(`inset 2px 0 0 ${toneTokens.attention.solid}`);
      if (invalidMsg) shadows.push(`inset 0 0 0 1px ${toneTokens.danger.solid}`);
      if (focused && !isEditing) shadows.push(`inset 0 0 0 2px ${accent[600]}`);
      const frozenSx = left === undefined ? {} : frozenCellSx(left, { last: frozen.lastKey === col.key, scrolled, bg: ctx.selected ? accent[50] : n[0] });
      if (left !== undefined && frozen.lastKey === col.key && scrolled) shadows.push(String(frozenSx.boxShadow));
      return {
        role: 'gridcell',
        tabIndex: focused ? 0 : -1,
        'aria-colindex': ctx.colIndex + 2,
        'aria-readonly': ro !== null ? true : undefined,
        'aria-invalid': invalidMsg ? true : undefined,
        'aria-describedby': focused ? statusId : undefined,
        'data-gr': ctx.rowIndex,
        'data-gc': ctx.colIndex,
        'data-dirty': isDirty ? 'true' : undefined,
        'data-invalid': invalidMsg ? 'true' : undefined,
        title: !focused ? (invalidMsg || ro || undefined) : undefined,
        onMouseDown: (e) => {
          if (isEditing || e.button !== 0) return;
          setFlash(null);
          setPos({ rowIndex: ctx.rowIndex, colIndex: ctx.colIndex });
        },
        onDoubleClick: () => startEdit({ rowIndex: ctx.rowIndex, colIndex: ctx.colIndex }),
        onContextMenu: (e) => {
          e.preventDefault();
          setPos({ rowIndex: ctx.rowIndex, colIndex: ctx.colIndex });
          setMenu({ x: e.clientX, y: e.clientY, rowId: ctx.rowId, field: col.field });
        },
        sx: {
          ...frozenSx,
          ...(isDirty && !invalidMsg ? { bgcolor: toneTokens.attention.bg } : {}),
          ...(invalidMsg ? { bgcolor: toneTokens.danger.bg } : {}),
          boxShadow: shadows.length ? shadows.join(', ') : 'none',
          outline: 'none',
          cursor: 'default',
          whiteSpace: 'nowrap',
          ...(isEditing ? { px: px(space[1]) } : {}),
          ...(ro !== null && isGridEditType(col.type) ? { color: n[500] } : {}),
        },
      };
    },
    renderCell: (dtCol, row, ctx) => {
      const col = byKey.get(dtCol.key);
      if (!col) return null;
      const k = keyOf(ctx.rowId, col.field);
      const ed = editing && editing.rowId === ctx.rowId && editing.colKey === col.key ? editing : null;
      if (ed && INLINE_TYPES.has(col.type ?? '')) {
        return (
          <CellEditor
            initial={ed.initial ?? ''}
            replace={ed.replace}
            type={col.type as 'text-edit' | 'money-edit' | 'int-edit'}
            align={colAlign(dtCol)}
            label={col.header}
            counter={col.counter}
            describedBy={statusId}
            onCommit={(text, exit) => {
              const res = evaluateCellText(col, row, text, messages);
              commitValue(ctx.rowId, col, res.value, res.error);
              closeEditor(exit);
            }}
            onCancel={() => closeEditor('stay')}
          />
        );
      }
      const focused = focusedKey === k && !!pos && pos.rowIndex === ctx.rowIndex;
      const tipMsg = focused ? (flash?.key === k ? flash.message : invalid.get(k)) : undefined;
      const value = display(col, dtCol, row, ctx.rowId);
      const meta = rowMeta && firstMetaCol?.key === col.key ? rowMeta(row) : null;
      const showCounter = focused && col.counter != null && col.type === 'text-edit';
      const current = showCounter ? getValue(row, col) : null;
      let content: ReactNode = (meta || showCounter) ? (
        <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: px(16) }}>
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</Box>
          <Box component="span" sx={{ fontSize: px(11), color: n[500], display: 'flex', gap: px(space[2]), overflow: 'hidden' }}>
            {showCounter && (
              <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: typeof current === 'string' && current.length > (col.counter ?? 0) ? toneTokens.danger.fg : undefined }}>
                {tg('counter', { value: typeof current === 'string' ? current.length : 0, max: col.counter ?? 0 })}
              </Box>
            )}
            {meta && <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</Box>}
          </Box>
        </Box>
      ) : value;
      // Browsers ignore max-width on table cells: the declared width caps an inner block instead, so long
      // titles end in an ellipsis and the column (and the frozen block) never grows past it.
      const capPx = isGridEditType(col.type) && typeof col.width === 'number' ? Math.max(col.width - CELL_PAD_X, 0) : null;
      if (capPx !== null) {
        content = <Box component="span" data-cell-cap="true" sx={{ display: 'block', maxWidth: px(capPx), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{content}</Box>;
      }
      if (tipMsg) {
        content = (
          <Tooltip title={tipMsg} open placement="top" arrow slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}>
            <Box component="span" sx={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{content}</Box>
          </Tooltip>
        );
      }
      if (!ed || !ed.anchor) return content;
      const v = getValue(row, col);
      return (
        <>
          {content}
          {col.type === 'tags-edit' && (
            <TagsCellEditor
              anchorEl={ed.anchor}
              initial={Array.isArray(v) ? v.map(String) : []}
              label={col.header}
              max={col.maxTags}
              maxLength={col.maxTagLength}
              tagInputProps={col.tagInputProps?.(row)}
              onCommit={(tags) => { commitValue(ctx.rowId, col, tags, validateCellValue(col, row, tags, messages)); closeEditor(null); }}
              onCancel={() => closeEditor(null)}
            />
          )}
          {col.type === 'select-edit' && (
            <SelectCellEditor
              anchorEl={ed.anchor}
              value={v === null || v === undefined ? null : String(v)}
              options={Array.isArray(col.options) ? col.options : []}
              label={col.header}
              onCommit={(next) => { commitValue(ctx.rowId, col, next, validateCellValue(col, row, next, messages)); closeEditor(null); }}
              onCancel={() => closeEditor(null)}
            />
          )}
          {col.type === 'combobox-edit' && (
            <ComboboxCellEditor
              anchorEl={ed.anchor}
              value={v === null || v === undefined || v === '' ? null : { value: String(v), label: optionLabel(col, v) } as ComboboxOption}
              options={col.options ?? []}
              label={col.header}
              onCommit={(opt) => {
                labelCache.current.set(labelKey(col, opt.value), opt.label);
                commitValue(ctx.rowId, col, opt.value, validateCellValue(col, row, opt.value, messages));
                closeEditor(null);
              }}
              onCancel={() => closeEditor(null)}
            />
          )}
        </>
      );
    },
  };

  const menuRowDirty = menu ? visibleCols.some((c) => dirty.has(keyOf(menu.rowId, c.field)) || invalid.has(keyOf(menu.rowId, c.field))) : false;
  const menuCellDirty = menu ? dirty.has(keyOf(menu.rowId, menu.field)) || invalid.has(keyOf(menu.rowId, menu.field)) : false;

  return (
    <Box className={className} data-testid={testId} data-bulk-grid="true">
      <DataTable<T>
        mode="grid"
        grid={grid}
        layout="table"
        rows={rows}
        columns={dtColumns}
        getRowId={getRowId}
        state={state}
        empty={empty}
        error={error}
        loading={loading}
        selection={selection}
        sort={sort}
        onSortChange={onSortChange}
        pagination={pagination}
        columnStateKey={columnStateKey}
        ariaLabel={ariaLabel}
        maxHeight={maxHeight}
      />
      <Box component="span" id={statusId} sx={visuallyHidden}>{statusText}</Box>
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        sx={{ zIndex: zIndex.popover }}
      >
        <MenuItem dense disabled={!menuCellDirty} onClick={() => { if (menu) onRevert([{ rowId: menu.rowId, field: menu.field }]); setMenu(null); }}>
          {tb('revert.cell')}
        </MenuItem>
        <MenuItem dense disabled={!menuRowDirty} onClick={() => { if (menu) onRevert([{ rowId: menu.rowId }]); setMenu(null); }}>
          {tb('revert.row')}
        </MenuItem>
        {selection.ids.length > 0 && (
          <MenuItem dense onClick={() => { onRevert(selection.ids.map((id) => ({ rowId: id }))); setMenu(null); }}>
            {tb('revert.selected')}
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}

const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, p: 0, m: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

export default BulkGrid;
