// DataTable: the one list table (DESIGN_SYSTEM §3.4, §4.4; CRITIQUE C22; overview §6.2; finance A4).
// Headless over MUI Table. ≥ 900px: table with sticky header, selection, sorting, typed/edit cells,
// one inline action + ⋯, Columns menu, optional server pagination, caption. < 900px: the same rows and
// columns render as cards through each column's `mobile` role. No virtualization (v1, max 250 rows).
// `mode="grid"` (M7-A, bulk-grid.md §5.1) is the BulkGrid base: forced table layout, the host renders every
// cell and adds the grid roles/handlers/frozen offsets through `grid`; list-mode keyboard and row-open are off.
import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import {
  Box, Button, Checkbox, Skeleton, Table, TableBody, TableCell, TableHead, TableRow, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslations } from 'next-intl';
import {
  accent, neutral as n, tone as toneTokens, px, radius, space, control, elevation, layout, zIndex,
} from '@/lib/ds/tokens';
import { useDsFormat } from './fmt';
import {
  ColumnsMenu, EditCell, InlineAction, Pager, RowActionsMenu, cellKey, colAlign, isDesktopColumn, renderTypedCell,
  useColumnVisibility,
  type Column, type DataTablePagination, type MobileRole, type Sort,
} from './dataTableParts';
import { SortAscIcon, SortDescIcon, SortNoneIcon } from './dataIcons';
import type { ActionSpec, DsBaseProps } from './types';

export type { Column, ColumnType, DataTablePagination, MobileRole, PageSize, Sort } from './dataTableParts';

export type DataTableState = 'loading' | 'ready' | 'empty' | 'error';

/** Context passed to the grid-mode cell hooks. `colIndex` counts visible data columns (no checkbox column). */
export type DataTableGridCellCtx = { rowId: string; rowIndex: number; colIndex: number; selected: boolean };

/** Attributes + `sx` merged onto a grid-mode cell (`sx` is spread after the base cell style). */
export type DataTableGridCellProps = HTMLAttributes<HTMLTableCellElement> & { sx?: Record<string, unknown> } & Record<`data-${string}`, string | number | undefined>;

/**
 * `mode="grid"` hooks (BulkGrid only). DataTable keeps header, selection column, Columns menu, pagination,
 * skeleton and the horizontal scroller; the host owns cell content, focus and keyboard.
 */
export interface DataTableGridMode<T> {
  renderCell(col: Column<T>, row: T, ctx: DataTableGridCellCtx): ReactNode;
  cellProps?(col: Column<T>, row: T, ctx: DataTableGridCellCtx): DataTableGridCellProps;
  /** Extra sx for a header cell (frozen offset). */
  headCellSx?(col: Column<T>, colIndex: number): Record<string, unknown> | undefined;
  /** Extra sx for the checkbox column cells (header + body), e.g. sticky `left: 0`. */
  selectCellSx?: Record<string, unknown>;
  /** Spread on the `<table>` (role="grid", aria-rowcount, aria-colcount, ref-free attributes). */
  tableProps?: HTMLAttributes<HTMLTableElement> & Record<`aria-${string}` | `data-${string}`, string | number | undefined>;
  /** Spread on each body row (aria-rowindex…). */
  rowProps?(row: T, rowIndex: number): HTMLAttributes<HTMLTableRowElement> & Record<`aria-${string}` | `data-${string}`, string | number | boolean | undefined>;
  /** Handlers on the scroll container (keydown, paste, copy, focus, contextmenu). */
  containerProps?: HTMLAttributes<HTMLDivElement>;
  /** The scroll container element (BulkGrid queries its cells to move DOM focus). */
  containerRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** Controlled column visibility, shared with the host so paste targets match what is on screen. */
  visibility?: { hidden: Set<string>; toggle(key: string): void };
  /** Called when the table scrolls horizontally away from / back to the left edge (frozen-column shadow). */
  onHorizontalScroll?(scrolled: boolean): void;
}

export type DataTableProps<T> = DsBaseProps & {
  rows: T[];
  columns: Column<T>[];
  getRowId(r: T): string;
  state: DataTableState;
  /** Slot for `state="empty"` (an EmptyState). */
  empty?: ReactNode;
  /** Slot for `state="error"` (an ErrorState). */
  error?: ReactNode;
  /** Replaces the built-in skeleton rows for `state="loading"`. */
  loading?: ReactNode;
  selection?: { ids: string[]; onChange(ids: string[]): void };
  isRowSelectable?(r: T): boolean;
  onRowOpen?(r: T): void;
  /** `e` on a focused row (listings: open the editor). */
  onRowEdit?(r: T): void;
  inlineAction?(r: T): ActionSpec | null | undefined;
  rowActions?(r: T): ActionSpec[];
  density?: 'compact' | 'standard';
  sort?: Sort | null;
  onSortChange?(sort: Sort): void;
  /** Optional (CRITIQUE C22): an embedded table without it renders no footer. */
  pagination?: DataTablePagination;
  onCellCommit?(rowId: string, key: string, value: number | null): void;
  /** `${rowId}:${columnKey}` of cells with a staged, unsent value (attention tint). */
  dirtyCells?: Set<string>;
  /** Persists the Columns menu choice per page (localStorage). */
  columnStateKey: string;
  /** Visible caption under the table (SourceNote-style line) and its accessible description. */
  caption?: ReactNode;
  /** Accessible name of the table. */
  ariaLabel?: string;
  /** `auto` = cards below 900px. */
  layout?: 'auto' | 'table' | 'cards';
  /** Sticky header (default true). With `maxHeight` the table scrolls inside; otherwise the header sticks to
   *  the page at `var(--kx-table-sticky-top, var(--kx-topbar-current, 0px))`. When the columns are wider
   *  than the container (e.g. 900–1199px), the table scrolls horizontally instead (nothing is ever clipped
   *  out of reach) and the row-actions column stays pinned to the right edge; in that state the header
   *  sticks within the table, not the page. Mark low-priority columns `hideable` + `defaultHidden` to
   *  avoid it. */
  stickyHeader?: boolean;
  maxHeight?: number | string;
  /** Row whose panel is open (subtle highlight). */
  activeRowId?: string | null;
  /** `grid` = BulkGrid base (requires `grid`). Default `list`. */
  mode?: 'list' | 'grid';
  grid?: DataTableGridMode<T>;
};

const SKELETON_DELAY = 200;

/** Row-actions column pinned to the right edge of a horizontally scrolling table (never clipped). */
function pinRight(bg: string, shadow?: string) {
  const edge = `inset 1px 0 0 ${n[100]}`;
  return {
    position: 'sticky' as const,
    right: 0,
    bgcolor: bg,
    boxShadow: shadow && shadow !== 'none' ? `${shadow}, ${edge}` : edge,
  };
}

function useDelayed(flag: boolean, ms: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!flag) { setOn(false); return; }
    const id = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(id);
  }, [flag, ms]);
  return on;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    rows, columns, getRowId, state, empty, error, loading, selection, isRowSelectable, onRowOpen, onRowEdit,
    inlineAction, rowActions, density = 'standard', sort, onSortChange, pagination, onCellCommit, dirtyCells,
    columnStateKey, caption, ariaLabel, layout: layoutMode = 'auto', stickyHeader = true, maxHeight, activeRowId,
    mode = 'list', grid: gridMode, className, 'data-testid': testId,
  } = props;
  const grid = mode === 'grid' ? gridMode : undefined;
  const t = useTranslations('ds.table');
  const fmt = useDsFormat();
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'));
  const cards = !grid && (layoutMode === 'cards' || (layoutMode === 'auto' && isNarrow));
  const ownVisibility = useColumnVisibility(columnStateKey, columns);
  const { hidden, toggle } = grid?.visibility ?? ownVisibility;
  const showSkeleton = useDelayed(state === 'loading', SKELETON_DELAY);

  const desktopCols = useMemo(() => columns.filter(isDesktopColumn), [columns]);
  const visibleCols = useMemo(() => desktopCols.filter((c) => !hidden.has(c.key)), [desktopCols, hidden]);
  const selectedSet = useMemo(() => new Set(selection?.ids ?? []), [selection?.ids]);
  const anySelected = selectedSet.size > 0;
  const selectableRows = useMemo(
    () => rows.filter((r) => (isRowSelectable ? isRowSelectable(r) : true)),
    [rows, isRowSelectable],
  );
  const pageIds = selectableRows.map(getRowId);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));
  const someSelected = pageIds.some((id) => selectedSet.has(id));
  const hasActions = !!inlineAction || !!rowActions;
  const hasHideable = desktopCols.some((c) => c.hideable && c.header);
  const showActionsCol = hasActions || hasHideable;
  const rowH = density === 'compact' ? layout.rowHCompact : layout.rowH;

  const toggleRow = (id: string) => {
    if (!selection) return;
    const next = selectedSet.has(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id];
    selection.onChange(next);
  };
  const togglePage = () => {
    if (!selection) return;
    if (allSelected) selection.onChange(selection.ids.filter((id) => !pageIds.includes(id)));
    else selection.onChange(Array.from(new Set([...selection.ids, ...pageIds])));
  };

  // Sticky header shadow once scrolled (e1).
  const sentinel = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  // Horizontal overflow (page-sticky mode): `overflow-x: clip` keeps the header sticking to the page, but
  // would cut off columns wider than the container. When the table is wider, switch to `overflow-x: auto`.
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [hOverflow, setHOverflow] = useState(false);
  useEffect(() => {
    if (cards || maxHeight !== undefined) return;
    const box = scroller.current;
    const table = tableRef.current;
    if (!box || !table) return;
    const measure = () => setHOverflow(table.scrollWidth > box.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(table);
    return () => ro.disconnect();
  }, [cards, maxHeight, visibleCols.length]);

  const onHScroll = grid?.onHorizontalScroll;
  useEffect(() => {
    const el = scroller.current;
    if (!onHScroll || !el) return;
    let last = false;
    const onScroll = () => { const now = el.scrollLeft > 0; if (now !== last) { last = now; onHScroll(now); } };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [onHScroll, cards, state]);

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (cards || !stickyHeader) return;
    if (maxHeight === undefined && hOverflow) { setScrolled(false); return; }
    if (maxHeight !== undefined) {
      const el = scroller.current;
      if (!el) return;
      const onScroll = () => setScrolled(el.scrollTop > 0);
      el.addEventListener('scroll', onScroll, { passive: true });
      return () => el.removeEventListener('scroll', onScroll);
    }
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [cards, stickyHeader, maxHeight, hOverflow]);

  // Keyboard: j/k/↑/↓ move, x toggles, Enter opens, e edits, ⌘/Ctrl+A selects the page, Esc clears.
  const onBodyKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (grid) return; // the grid host owns the keyboard
    const target = e.target as HTMLElement;
    if (isTypingTarget(target)) return;
    const rowEl = target.closest<HTMLElement>('[data-row-id]');
    if (!rowEl) return;
    if (target !== rowEl && e.key !== 'Escape') return; // a focused button/cell inside the row handles itself
    const id = rowEl.dataset.rowId as string;
    const row = rows.find((r) => getRowId(r) === id);
    const move = (dir: 1 | -1) => {
      const all = Array.from(rowEl.parentElement?.querySelectorAll<HTMLElement>('[data-row-id]') ?? []);
      const idx = all.indexOf(rowEl);
      all[idx + dir]?.focus();
    };
    const key = e.key;
    if (key === 'j' || key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (key === 'k' || key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (key === 'x' && selection && row && (!isRowSelectable || isRowSelectable(row))) { e.preventDefault(); toggleRow(id); }
    else if (key === 'Enter' && row && onRowOpen) { e.preventDefault(); onRowOpen(row); }
    else if (key === 'e' && row && onRowEdit) { e.preventDefault(); onRowEdit(row); }
    else if ((key === 'a' || key === 'A') && (e.metaKey || e.ctrlKey) && selection) { e.preventDefault(); if (!allSelected) togglePage(); }
    else if (key === 'Escape' && selection && anySelected) { e.preventDefault(); selection.onChange([]); }
  };

  // Card select mode ("Select" button, no long-press).
  const [selectMode, setSelectMode] = useState(false);
  useEffect(() => { if (anySelected) setSelectMode(true); }, [anySelected]);

  const onRowClick = (e: React.MouseEvent<HTMLElement>, row: T) => {
    if (grid) return;
    const el = e.target as HTMLElement;
    if (el.closest('[data-row-stop],button,a,input,label')) return;
    if (cards && selection && selectMode) { toggleRow(getRowId(row)); return; }
    onRowOpen?.(row);
  };

  const captionNode = caption ? (
    <Typography variant="caption" component="p" sx={{ m: 0, px: px(space[3]), py: px(space[2]), color: n[500] }}>{caption}</Typography>
  ) : null;

  const footer = pagination ? (
    pagination.mode === 'cursor' ? (
      pagination.hasMore ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: px(space[3]) }}>
          <Button variant="outlined" onClick={pagination.onLoadMore} disabled={pagination.loading} sx={{ minHeight: px(control.md) }}>
            {pagination.loading ? t('loadingMore') : t('loadMore')}
          </Button>
        </Box>
      ) : null
    ) : cards && pagination.onLoadMore ? (
      pagination.page * pagination.pageSize < pagination.total ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: px(space[3]) }}>
          <Button variant="outlined" onClick={pagination.onLoadMore} sx={{ minHeight: px(control.lg), width: '100%' }}>{t('loadMore')}</Button>
        </Box>
      ) : null
    ) : (
      <Pager pagination={pagination} fmt={fmt} compact={cards} />
    )
  ) : null;

  const surface = {
    bgcolor: n[0], border: `1px solid ${n[200]}`, borderRadius: px(radius.md),
  } as const;

  // ---------------- states shared by both layouts ----------------
  if (state === 'empty' || state === 'error') {
    return (
      <Box className={className} data-testid={testId} data-state={state} sx={{ ...surface, p: px(space[6]) }}>
        {state === 'empty'
          ? (empty ?? <Typography variant="dense" sx={{ color: n[500], textAlign: 'center' }}>{t('empty')}</Typography>)
          : (error ?? <Typography variant="dense" role="alert" sx={{ color: toneTokens.danger.fg, textAlign: 'center' }}>{t('error')}</Typography>)}
      </Box>
    );
  }

  if (state === 'loading' && loading) {
    return <Box className={className} data-testid={testId} data-state="loading">{loading}</Box>;
  }

  // ---------------- cards (< 900px) ----------------
  if (cards) {
    // Card-only columns (`desktop: false`) take part here; user-hidden desktop columns do too (the Columns
    // menu is a desktop affordance).
    const byRole = (role: MobileRole) => columns.filter((c) => c.mobile === role);
    const media = byRole('media')[0];
    const titleCols = byRole('title');
    const subtitleCols = byRole('subtitle');
    const metaCols = byRole('meta');
    const statusCol = byRole('status')[0];
    const trailingCol = byRole('trailing')[0];
    const actionCol = byRole('action')[0];
    const cell = (c: Column<T>, r: T) => renderTypedCell(c, r, fmt, { mobile: true });

    return (
      <Box className={className} data-testid={testId} data-layout="cards" data-state={state} aria-busy={state === 'loading' || undefined}>
        {selection && state === 'ready' && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: px(space[2]), pb: px(space[2]) }}>
            {selectMode && (
              <Typography variant="caption" sx={{ color: n[600], mr: 'auto' }}>{t('selectedCount', { count: selectedSet.size })}</Typography>
            )}
            <Button
              variant="text"
              onClick={() => { if (selectMode) { selection.onChange([]); setSelectMode(false); } else setSelectMode(true); }}
              sx={{ minHeight: px(control.lg) }}
            >
              {selectMode ? t('done') : t('select')}
            </Button>
          </Box>
        )}
        <Box component="ul" aria-label={ariaLabel} sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
          {state === 'loading'
            ? (showSkeleton
              ? Array.from({ length: 5 }, (_, i) => (
                <Box component="li" key={i} sx={{ ...surface, p: px(space[3]), display: 'flex', gap: px(space[3]) }}>
                  <Skeleton variant="rounded" width={64} height={64} />
                  <Box sx={{ flex: 1 }}><Skeleton width="80%" /><Skeleton width="50%" /><Skeleton width="30%" /></Box>
                </Box>
              ))
              : null)
            : rows.map((r) => {
              const id = getRowId(r);
              const selected = selectedSet.has(id);
              const selectable = !isRowSelectable || isRowSelectable(r);
              const metas = metaCols.map((c) => ({ key: c.key, node: cell(c, r) })).filter((m) => m.node !== null && m.node !== '—');
              const ia = inlineAction?.(r);
              const overflow = rowActions?.(r) ?? [];
              return (
                <Box
                  component="li"
                  key={id}
                  data-row-id={id}
                  aria-selected={selection ? selected : undefined}
                  tabIndex={onRowOpen ? 0 : undefined}
                  onClick={(e) => onRowClick(e, r)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget && onRowOpen) onRowOpen(r); }}
                  sx={{
                    ...surface,
                    p: px(space[3]),
                    display: 'flex',
                    gap: px(space[3]),
                    position: 'relative',
                    cursor: onRowOpen || selectMode ? 'pointer' : 'default',
                    ...(selected ? { bgcolor: accent[50], boxShadow: `inset 2px 0 0 ${accent[600]}` } : {}),
                    '&:focus-visible': { outline: `2px solid ${accent[600]}`, outlineOffset: px(2) },
                  }}
                >
                  {selection && selectMode && (
                    <Checkbox
                      checked={selected}
                      disabled={!selectable}
                      onChange={() => toggleRow(id)}
                      inputProps={{ 'aria-label': t('selectRow') }}
                      data-row-stop="true"
                      sx={{ alignSelf: 'flex-start', m: px(-space[2]), width: px(control.lg), height: px(control.lg) }}
                    />
                  )}
                  {media && <Box sx={{ flexShrink: 0 }}>{cell(media, r)}</Box>}
                  <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: px(space[1]) }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: px(space[2]) }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {titleCols.map((c) => (
                          <Typography
                            key={c.key}
                            variant="label"
                            component="div"
                            sx={{ color: n[900], display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          >
                            {cell(c, r)}
                          </Typography>
                        ))}
                      </Box>
                      {overflow.length > 0 && (
                        <Box data-row-stop="true" sx={{ mt: px(-space[1]), mr: px(-space[1]) }}>
                          <RowActionsMenu actions={overflow} label={t('moreActions')} />
                        </Box>
                      )}
                    </Box>
                    {subtitleCols.length > 0 && (
                      <Typography variant="caption" component="div" sx={{ color: n[600], display: 'flex', alignItems: 'center', gap: px(space[1]), flexWrap: 'wrap' }}>
                        {subtitleCols.map((c, i) => (
                          <Box component="span" key={c.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[1]) }}>
                            {i > 0 && <Box component="span" aria-hidden>{'·'}</Box>}
                            {cell(c, r)}
                          </Box>
                        ))}
                      </Typography>
                    )}
                    {(trailingCol || statusCol) && (
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: px(space[2]) }}>
                        <Typography variant="label" component="div" sx={{ color: n[900], fontVariantNumeric: 'tabular-nums' }}>
                          {trailingCol ? cell(trailingCol, r) : null}
                        </Typography>
                        {statusCol && <Box>{cell(statusCol, r)}</Box>}
                      </Box>
                    )}
                    {metas.length > 0 && (
                      <Typography variant="caption" component="div" sx={{ color: n[600] }}>
                        {metas.map((m, i) => (
                          <Box component="span" key={m.key}>
                            {i > 0 && <Box component="span" aria-hidden sx={{ px: px(space[1]) }}>{'·'}</Box>}
                            {m.node}
                          </Box>
                        ))}
                      </Typography>
                    )}
                    {(actionCol || ia) && !selectMode && (
                      <Box data-row-stop="true" sx={{ pt: px(space[1]) }}>
                        {actionCol ? cell(actionCol, r) : ia ? <InlineAction action={ia} size="lg" /> : null}
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
        </Box>
        {captionNode}
        {state === 'ready' && footer}
      </Box>
    );
  }

  // ---------------- table (≥ 900px) ----------------
  const pageScrollSticky = stickyHeader && maxHeight === undefined && !hOverflow;
  const scrollsX = maxHeight !== undefined || hOverflow;
  const headCellSx = {
    height: px(36),
    py: 0,
    px: px(space[3]),
    bgcolor: n[25],
    color: n[500],
    fontSize: px(12),
    lineHeight: px(16),
    fontWeight: 500,
    borderBottom: `1px solid ${n[200]}`,
    whiteSpace: 'nowrap' as const,
    ...(stickyHeader
      ? {
          position: 'sticky' as const,
          top: pageScrollSticky ? 'var(--kx-table-sticky-top, var(--kx-topbar-current, 0px))' : 0,
          zIndex: zIndex.stickyHeader,
          boxShadow: scrolled ? elevation.e1 : 'none',
        }
      : {}),
  };
  const bodyCellSx = {
    height: px(rowH),
    py: 0,
    px: px(space[3]),
    fontSize: px(13),
    lineHeight: px(18),
    color: n[800],
    borderBottom: `1px solid ${n[100]}`,
  };
  const colCount = visibleCols.length + (selection ? 1 : 0) + (showActionsCol ? 1 : 0);

  return (
    <Box
      className={className}
      data-testid={testId}
      data-layout="table"
      data-state={state}
      aria-busy={state === 'loading' || undefined}
      data-hscroll={hOverflow ? 'true' : undefined}
      // `clip`, not `hidden`: clips the rounded corners without creating a scroll container, so the
      // page-scroll sticky header sticks to the page (DS §3.4).
      sx={{ ...surface, overflow: 'clip' }}
    >
      {pageScrollSticky && <div ref={sentinel} aria-hidden style={{ height: 0 }} />}
      <Box
        ref={(el: HTMLDivElement | null) => { scroller.current = el; if (grid?.containerRef) grid.containerRef.current = el; }}
        {...(grid?.containerProps ?? {})}
        sx={{
          overflowX: scrollsX ? 'auto' : 'clip',
          ...(maxHeight !== undefined ? { maxHeight, overflowY: 'auto' } : {}),
        }}
      >
        <Table
          ref={tableRef}
          aria-label={ariaLabel}
          {...(grid?.tableProps ?? {})}
          size="small"
          sx={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'auto', width: '100%', '& caption': { captionSide: 'bottom' } }}
        >
          {caption && (
            <Box component="caption" sx={{ p: '0 !important', textAlign: 'left' }}>{captionNode}</Box>
          )}
          <TableHead>
            <TableRow>
              {selection && (
                <TableCell padding="checkbox" sx={{ ...headCellSx, width: px(40), px: px(space[1]), ...(grid?.selectCellSx ?? {}), ...(grid && stickyHeader ? { zIndex: zIndex.stickyHeader + 1 } : {}) }}>
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={!allSelected && someSelected}
                    disabled={pageIds.length === 0}
                    onChange={togglePage}
                    inputProps={{ 'aria-label': t('selectPage') }}
                  />
                </TableCell>
              )}
              {visibleCols.map((c, hi) => {
                const active = sort?.key === c.key;
                const dir = active ? sort?.dir : undefined;
                const align = colAlign(c);
                const SortIcon = dir === 'asc' ? SortAscIcon : dir === 'desc' ? SortDescIcon : SortNoneIcon;
                return (
                  <TableCell
                    key={c.key}
                    align={align}
                    aria-sort={c.sortable ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined}
                    sx={{ ...headCellSx, width: c.width, minWidth: c.minWidth, ...(grid?.headCellSx?.(c, hi) ?? {}) }}
                  >
                    {c.sortable && onSortChange ? (
                      <Box
                        component="button"
                        type="button"
                        onClick={() => onSortChange({ key: c.key, dir: active && dir === 'asc' ? 'desc' : 'asc' })}
                        sx={{
                          all: 'unset',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: px(space[1]),
                          flexDirection: align === 'right' ? 'row-reverse' : 'row',
                          color: active ? n[800] : 'inherit',
                          borderRadius: px(radius.xs),
                          '&:focus-visible': { outline: `2px solid ${accent[600]}`, outlineOffset: px(2) },
                          '& .kx-sort': { opacity: active ? 1 : 0 },
                          '&:hover .kx-sort, &:focus-visible .kx-sort': { opacity: 1 },
                        }}
                      >
                        {c.header}
                        <Box component="span" className="kx-sort" sx={{ display: 'inline-flex' }}>
                          <SortIcon size={12} strokeWidth={2} aria-hidden />
                        </Box>
                      </Box>
                    ) : (
                      c.header
                    )}
                  </TableCell>
                );
              })}
              {showActionsCol && (
                <TableCell align="right" sx={{ ...headCellSx, width: px(80), ...(scrollsX ? pinRight(n[25], stickyHeader && scrolled ? elevation.e1 : undefined) : {}) }}>
                  {hasHideable && <ColumnsMenu columns={desktopCols} hidden={hidden} onToggle={toggle} />}
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody onKeyDown={onBodyKeyDown}>
            {state === 'loading'
              ? (showSkeleton
                ? Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: colCount }, (__, j) => (
                      <TableCell key={j} sx={bodyCellSx}><Skeleton variant="text" /></TableCell>
                    ))}
                  </TableRow>
                ))
                : (
                  <TableRow><TableCell colSpan={colCount} sx={{ ...bodyCellSx, borderBottom: 'none' }} /></TableRow>
                ))
              : rows.map((r, ri) => {
                const id = getRowId(r);
                const selected = selectedSet.has(id);
                const selectable = !isRowSelectable || isRowSelectable(r);
                const ia = inlineAction?.(r) ?? null;
                const overflow = rowActions?.(r) ?? [];
                return (
                  <TableRow
                    key={id}
                    data-row-id={id}
                    {...(grid?.rowProps?.(r, ri) ?? {})}
                    tabIndex={!grid && (onRowOpen || selection) ? 0 : undefined}
                    aria-selected={selection ? selected : undefined}
                    onClick={(e) => onRowClick(e, r)}
                    sx={{
                      cursor: onRowOpen && !grid ? 'pointer' : 'default',
                      bgcolor: selected ? accent[50] : activeRowId === id ? n[50] : n[0],
                      transition: 'background-color 80ms linear',
                      '&:hover': { bgcolor: selected ? accent[100] : n[50] },
                      '&:focus-visible': { outline: `2px solid ${accent[600]}`, outlineOffset: px(-2) },
                      '& .kx-sel': { opacity: anySelected || selected ? 1 : 0 },
                      '& .kx-row-actions': { opacity: 0 },
                      '&:hover .kx-sel, &:focus-within .kx-sel, &:hover .kx-row-actions, &:focus-within .kx-row-actions': { opacity: 1 },
                      '@media (pointer: coarse)': { '& .kx-sel, & .kx-row-actions': { opacity: 1 } },
                      '&:last-of-type > td': { borderBottom: 'none' },
                    }}
                  >
                    {selection && (
                      <TableCell
                        padding="checkbox"
                        data-row-stop="true"
                        sx={{
                          ...bodyCellSx, px: px(space[1]),
                          ...(grid ? { ...(grid.selectCellSx ?? {}), bgcolor: selected ? accent[50] : n[0] } : {}),
                          ...(selected ? { boxShadow: `inset 2px 0 0 ${accent[600]}` } : {}),
                        }}
                      >
                        <Checkbox
                          className="kx-sel"
                          size="small"
                          checked={selected}
                          disabled={!selectable}
                          onChange={() => toggleRow(id)}
                          inputProps={{ 'aria-label': t('selectRow') }}
                        />
                      </TableCell>
                    )}
                    {visibleCols.map((c, ci) => {
                      if (grid) {
                        const ctx = { rowId: id, rowIndex: ri, colIndex: ci, selected };
                        const { sx: gridSx, ...attrs } = grid.cellProps?.(c, r, ctx) ?? {};
                        return (
                          <TableCell
                            key={c.key}
                            align={colAlign(c)}
                            {...attrs}
                            sx={{ ...bodyCellSx, ...(colAlign(c) === 'right' ? { fontVariantNumeric: 'tabular-nums' } : {}), ...(gridSx ?? {}) }}
                          >
                            {grid.renderCell(c, r, ctx)}
                          </TableCell>
                        );
                      }
                      const dirty = !!dirtyCells?.has(cellKey(id, c.key));
                      const isEdit = c.type === 'money-edit' || c.type === 'int-edit';
                      const tip = !isEdit ? c.cellTooltip?.(r) : null;
                      return (
                        <TableCell
                          key={c.key}
                          align={colAlign(c)}
                          data-dirty={dirty ? 'true' : undefined}
                          title={tip || undefined}
                          sx={{
                            ...bodyCellSx,
                            ...(colAlign(c) === 'right' ? { fontVariantNumeric: 'tabular-nums' } : {}),
                            ...(ci === 0 && !selection && selected ? { boxShadow: `inset 2px 0 0 ${accent[600]}` } : {}),
                            ...(dirty ? { bgcolor: toneTokens.attention.bg, boxShadow: `inset 2px 0 0 ${toneTokens.attention.solid}` } : {}),
                          }}
                        >
                          {isEdit ? (
                            <EditCell col={c} row={r} rowId={id} fmt={fmt} dirty={dirty} onCommit={onCellCommit} />
                          ) : (
                            renderTypedCell(c, r, fmt)
                          )}
                        </TableCell>
                      );
                    })}
                    {showActionsCol && (
                      <TableCell
                        align="right"
                        data-row-stop="true"
                        sx={{ ...bodyCellSx, px: px(space[2]), whiteSpace: 'nowrap', ...(scrollsX ? pinRight('inherit') : {}) }}
                      >
                        {/* The row's main action is always visible (sellers missed a hover-only icon); only ⋯ waits for hover. */}
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[1]) }}>
                          {ia && <InlineAction action={ia} size="md" />}
                          {overflow.length > 0 && <Box component="span" className="kx-row-actions" sx={{ display: 'inline-flex' }}><RowActionsMenu actions={overflow} label={t('moreActions')} /></Box>}
                        </Box>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Box>
      {state === 'ready' && footer && <Box sx={{ borderTop: `1px solid ${n[100]}`, bgcolor: n[25] }}>{footer}</Box>}
    </Box>
  );
}

export default DataTable;
