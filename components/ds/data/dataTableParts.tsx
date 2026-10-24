// Internal building blocks of ds/data/DataTable: column types, typed cells, edit cell, row actions,
// columns menu, pager. Exported for BulkGrid (M7-A) and tests; pages import DataTable only.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import NextLink from 'next/link';
import {
  Box, Button, Checkbox, FormControlLabel, InputBase, Popover, Select, Tooltip, Typography,
} from '@mui/material';
import { useTranslations } from 'next-intl';
import type { DateMode } from '@/lib/format';
import { accent, neutral as n, tone as toneTokens, px, radius, space, control, zIndex } from '@/lib/ds/tokens';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { OverflowMenu } from '@/components/ds/overlay/OverflowMenu';
import { Money } from '@/components/ds/format/Money';
import { DateText } from '@/components/ds/format/DateText';
import { parseLocaleNumber, type DsFormat } from './fmt';
import { LogoTile } from './LogoTile';
import { ScoreMeter } from './ScoreMeter';
import { ShareBar } from './ShareBar';
import { StatusPill } from './StatusPill';
import { Thumb } from './Thumb';
import { ColumnsIcon, NextIcon, PrevIcon } from './dataIcons';
import type { ActionSpec } from './types';

export type MobileRole = 'media' | 'title' | 'subtitle' | 'meta' | 'status' | 'trailing' | 'action' | 'hidden';
export type ColumnType =
  | 'text' | 'money' | 'number' | 'date' | 'status' | 'score' | 'thumb' | 'brand' | 'money-edit' | 'int-edit' | 'share';

export interface Column<T> {
  key: string;
  /** Translated header; sentence case. Empty string for icon-only columns (thumb). */
  header: string;
  width?: number | string;
  minWidth?: number;
  align?: 'left' | 'right';
  sortable?: boolean;
  hideable?: boolean;
  /** Hidden until the user turns it on in the Columns menu. */
  defaultHidden?: boolean;
  type?: ColumnType;
  /** Raw value for typed cells and edit cells. Default: `row[key]`. */
  value?(r: T): unknown;
  /** Currency for `money` / `money-edit` (row currency, never summed across rows). */
  currency?(r: T): string | undefined;
  /** Accessible text for `thumb` cells. Omitted / empty = decorative thumb (aria-hidden placeholder). */
  thumbAlt?(r: T): string;
  /** `date` cells: DateText mode (default `date`, with the full date-time in a tooltip). */
  dateMode?: DateMode;
  /** `money` cells: the value is converted ("≈" prefix + this FX note as tooltip). */
  fxNote?(r: T): string | null | undefined;
  render?(r: T): ReactNode;
  /** Edit cells: return a translated error, or null when valid. */
  validate?(v: number | null): string | null;
  /** Edit cells: a translated reason makes the cell read-only for that row (tooltip). */
  readOnlyReason?(r: T): string | null | undefined;
  /** Tooltip for the cell, e.g. "On Etsy: $64.00" on a dirty cell. */
  cellTooltip?(r: T): string | null | undefined;
  mobile: MobileRole;
  /** Override for the card layout (e.g. logo only for `subtitle`). */
  mobileRender?(r: T): ReactNode;
  /**
   * Default true. `false` = card-only column: never a desktop column and never in the Columns menu.
   * Use it for a second card line that the desktop shows inside another cell, e.g. orders `order`
   * (title on line 1) + a card-only `orderMeta` column with `mobile: 'subtitle'` ("#1234 · buyer · US").
   */
  desktop?: boolean;
}

/** Columns rendered in the desktop table layout. */
export function isDesktopColumn<T>(col: Column<T>): boolean {
  return col.desktop !== false;
}

export type Sort = { key: string; dir: 'asc' | 'desc' };
export type PageSize = 50 | 100 | 250;

export type DataTablePagination =
  | {
      mode: 'pages';
      /** 1-based. */
      page: number;
      pageSize: PageSize;
      total: number;
      onChange(next: { page: number; pageSize: PageSize }): void;
      /** Card layout: show "Load more" (the host appends the next page) instead of the compact pager. */
      onLoadMore?(): void;
      pageSizes?: PageSize[];
    }
  | { mode: 'cursor'; hasMore: boolean; onLoadMore(): void; loading?: boolean };

export const cellKey = (rowId: string, key: string) => `${rowId}:${key}`;

export function rawValue<T>(col: Column<T>, row: T): unknown {
  if (col.value) return col.value(row);
  return (row as Record<string, unknown>)[col.key];
}

export function isNumericType(type?: ColumnType): boolean {
  return type === 'money' || type === 'number' || type === 'money-edit' || type === 'int-edit' || type === 'share' || type === 'score';
}

export function colAlign<T>(col: Column<T>): 'left' | 'right' {
  return col.align ?? (isNumericType(col.type) && col.type !== 'score' ? 'right' : 'left');
}

/** Renders a typed cell when the column has no `render`. */
export function renderTypedCell<T>(col: Column<T>, row: T, fmt: DsFormat, ctx: { mobile?: boolean } = {}): ReactNode {
  if (ctx.mobile && col.mobileRender) return col.mobileRender(row);
  if (col.render) return col.render(row);
  const v = rawValue(col, row);
  const dash = '—';
  switch (col.type) {
    case 'money':
    case 'money-edit': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return dash;
      const fxNote = col.type === 'money' ? col.fxNote?.(row) || undefined : undefined;
      return <Money amount={v} currency={col.currency?.(row) ?? 'USD'} approx={!!fxNote} fxNote={fxNote} />;
    }
    case 'number':
    case 'int-edit':
      return typeof v === 'number' && Number.isFinite(v) ? fmt.num(v) : dash;
    case 'date':
      return v instanceof Date || typeof v === 'string' || typeof v === 'number'
        ? <DateText value={v} mode={col.dateMode ?? 'date'} />
        : dash;
    case 'share':
      return <ShareBar value={typeof v === 'number' ? v : null} compact={ctx.mobile} />;
    case 'score':
      return <ScoreMeter variant="cell" score={typeof v === 'number' ? v : null} />;
    case 'thumb':
      return <Thumb src={typeof v === 'string' ? v : null} alt={col.thumbAlt?.(row) ?? ''} size={ctx.mobile ? 64 : 48} preview={!ctx.mobile} />;
    case 'status': {
      const st = v as { domain?: string; status?: string; raw?: string } | null;
      if (st && typeof st === 'object' && st.domain && st.status) {
        return <StatusPill domain={st.domain as never} status={st.status as never} raw={st.raw} />;
      }
      return v === null || v === undefined || v === '' ? dash : String(v);
    }
    case 'brand':
      return typeof v === 'string' && v ? <LogoTile brand={v} size={16} withName={!ctx.mobile} /> : dash;
    default:
      return v === null || v === undefined || v === '' ? dash : String(v);
  }
}

// ---------------------------------------------------------------------------
// Column visibility (persisted per page under `columnStateKey`, localStorage guarded)
// ---------------------------------------------------------------------------

const storageKey = (k: string) => `kx.ds.columns.${k}`;

/** Explicit user choices only; columns the user never toggled follow their current `defaultHidden`. */
export type ColumnChoices = { hidden: string[]; shown: string[] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function readColumnChoices(columnStateKey: string): ColumnChoices | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(storageKey(columnStateKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Legacy shape (a bare array of hidden keys): read as explicit "hidden" choices only.
    if (Array.isArray(parsed)) return { hidden: strings(parsed), shown: [] };
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      return { hidden: strings(o.hidden), shown: strings(o.shown) };
    }
    return null;
  } catch {
    return null;
  }
}

/** Merges the user's explicit choices onto `defaultHidden` (a newly added default-hidden column stays hidden). */
export function resolveHiddenColumns<T>(columns: Column<T>[], choices: ColumnChoices | null): Set<string> {
  const out = new Set<string>();
  for (const c of columns) {
    if (!c.hideable) continue;
    const userHidden = choices?.hidden.includes(c.key);
    const userShown = choices?.shown.includes(c.key);
    if (userHidden || (!userShown && c.defaultHidden)) out.add(c.key);
  }
  return out;
}

export function useColumnVisibility<T>(columnStateKey: string, columns: Column<T>[]) {
  const [choices, setChoices] = useState<ColumnChoices | null>(null);
  useEffect(() => {
    setChoices(readColumnChoices(columnStateKey));
  }, [columnStateKey]);
  const hiddenSet = useMemo(() => resolveHiddenColumns(columns, choices), [columns, choices]);
  const toggle = useCallback((key: string) => {
    const nowHidden = hiddenSet.has(key);
    setChoices((prev) => {
      const base = prev ?? { hidden: [], shown: [] };
      const next: ColumnChoices = nowHidden
        ? { hidden: base.hidden.filter((k) => k !== key), shown: [...base.shown.filter((k) => k !== key), key] }
        : { hidden: [...base.hidden.filter((k) => k !== key), key], shown: base.shown.filter((k) => k !== key) };
      try { window.localStorage.setItem(storageKey(columnStateKey), JSON.stringify(next)); } catch { /* storage blocked */ }
      return next;
    });
  }, [columnStateKey, hiddenSet]);
  return { hidden: hiddenSet, toggle };
}

export function ColumnsMenu<T>({ columns, hidden, onToggle }: { columns: Column<T>[]; hidden: Set<string>; onToggle(key: string): void }) {
  const t = useTranslations('ds.table');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const hideable = columns.filter((c) => c.hideable && c.header && isDesktopColumn(c));
  if (hideable.length === 0) return null;
  return (
    <>
      <IconButton
        icon={ColumnsIcon}
        label={t('columns')}
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget)}
      />
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ zIndex: zIndex.popover }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', p: px(space[2]), minWidth: px(200) }}>
          <Typography variant="caption" sx={{ px: px(space[2]), pb: px(space[1]), fontWeight: 500 }}>{t('showColumns')}</Typography>
          {hideable.map((c) => (
            <FormControlLabel
              key={c.key}
              sx={{ mx: 0, px: px(space[1]) }}
              control={<Checkbox size="small" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />}
              label={<Typography variant="dense">{c.header}</Typography>}
            />
          ))}
        </Box>
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row actions: at most one inline icon action + ⋯ (danger items last, separated)
// ---------------------------------------------------------------------------

export function orderActions(items: ActionSpec[]): { normal: ActionSpec[]; danger: ActionSpec[] } {
  return { normal: items.filter((a) => a.tone !== 'danger'), danger: items.filter((a) => a.tone === 'danger') };
}

/** sm = icon button; md = small labelled button (desktop rows: the main action must be readable, not a bare icon); lg = mobile card. */
export function InlineAction({ action, size = 'sm' }: { action: ActionSpec; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = action.icon;
  const disabled = action.disabled || action.loading;
  const label = action.loading && action.loadingLabel ? action.loadingLabel : action.label;
  const linkProps = action.href ? { component: NextLink, href: action.href } : {};
  if (size !== 'sm' || !Icon) {
    return (
      <Tooltip title={action.disabled && action.disabledReason ? action.disabledReason : ''}>
        <span>
          <Button
            variant="outlined"
            size="small"
            disabled={disabled}
            onClick={(e) => { e.stopPropagation(); action.onClick?.(); }}
            {...linkProps}
            title={size === 'md' ? label : undefined}
            sx={{ minHeight: px(size === 'lg' ? control.lg : control.sm), whiteSpace: 'nowrap', ...(size === 'md' ? { maxWidth: 156, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', lineHeight: px(control.sm - 2) } : {}) }}
          >
            {label}
          </Button>
        </span>
      </Tooltip>
    );
  }
  // DS IconButton: 32px on fine pointers, 44px on coarse pointers (DS P3).
  return (
    <IconButton
      icon={Icon}
      label={action.label}
      size="sm"
      href={action.href}
      disabled={disabled}
      disabledReason={action.disabled ? action.disabledReason : undefined}
      onClick={(e) => { e.stopPropagation(); action.onClick?.(); }}
    />
  );
}

/**
 * Row ⋯ menu: the DS OverflowMenu (danger last after a divider, 44px trigger on coarse pointers).
 * The wrapper stops clicks, including clicks on menu items rendered in the portal (React events bubble
 * through portals), from reaching the row's open handler.
 */
export function RowActionsMenu({ actions, label }: { actions: ActionSpec[]; label: string }) {
  if (actions.length === 0) return null;
  return (
    <Box
      component="span"
      data-row-stop="true"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      sx={{ display: 'inline-flex' }}
    >
      <OverflowMenu items={actions} label={label} size="sm" align="right" />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Edit cell (money-edit / int-edit): click or Enter edits; Enter/Tab commit (stages); Esc cancels.
// ---------------------------------------------------------------------------

export function EditCell<T>({
  col, row, rowId, fmt, dirty, onCommit,
}: {
  col: Column<T>; row: T; rowId: string; fmt: DsFormat; dirty: boolean;
  onCommit?(rowId: string, key: string, value: number | null): void;
}) {
  const t = useTranslations('ds.table');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const readOnlyReason = col.readOnlyReason?.(row) || null;
  const editable = !!onCommit && !readOnlyReason;
  const value = rawValue(col, row);
  const isMoney = col.type === 'money-edit';

  const start = () => {
    if (!editable) return;
    const v = typeof value === 'number' && Number.isFinite(value) ? value : null;
    setDraft(v === null ? '' : isMoney ? fmt.num(v, { decimals: 2 }).replace(/\s/g, '') : String(v));
    setError(null);
    setEditing(true);
  };
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = (): boolean => {
    const parsed = draft.trim() === '' ? null : parseLocaleNumber(draft, fmt.locale);
    if (draft.trim() !== '' && parsed === null) { setError(t('invalidNumber')); return false; }
    if (!isMoney && parsed !== null && !Number.isInteger(parsed)) { setError(t('wholeNumber')); return false; }
    const custom = col.validate?.(parsed) ?? null;
    if (custom) { setError(custom); return false; }
    setEditing(false);
    setError(null);
    if (parsed !== (typeof value === 'number' ? value : null)) onCommit?.(rowId, col.key, parsed);
    return true;
  };

  // An editable number reads as editable (usability review): dashed underline, a pencil on hover, and a "click to
  // edit" tooltip when nothing more specific applies.
  const tip = readOnlyReason || error || col.cellTooltip?.(row) || (editable ? t('clickToEdit') : '');

  if (editing) {
    return (
      <Tooltip key="edit" title={error ?? ''} open={!!error} placement="top">
        <InputBase
          inputRef={inputRef}
          value={draft}
          autoFocus
          inputProps={{
            inputMode: isMoney ? 'decimal' : 'numeric',
            'aria-label': col.header,
            'aria-invalid': error ? true : undefined,
            'data-row-stop': 'true',
          }}
          onChange={(e) => { setDraft(e.target.value); if (error) setError(null); }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === 'Tab') { if (!commit()) e.preventDefault(); }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setError(null); }
          }}
          // An invalid value is never dropped silently: the cell stays in edit mode with the inline error
          // (aria-invalid + tooltip) until it is fixed or Esc cancels.
          onBlur={() => { commit(); }}
          sx={{
            width: '100%',
            height: px(28),
            px: px(space[2]),
            fontSize: px(13),
            fontVariantNumeric: 'tabular-nums',
            bgcolor: n[0],
            border: `1px solid ${error ? toneTokens.danger.solid : accent[600]}`,
            borderRadius: px(radius.sm),
            '& input': { textAlign: colAlign(col), p: 0 },
          }}
        />
      </Tooltip>
    );
  }

  const display = renderTypedCell(col, row, fmt);
  return (
    <Tooltip key="view" title={tip}>
      <Box
        component="span"
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        data-row-stop="true"
        data-dirty={dirty ? 'true' : undefined}
        aria-label={editable ? t('editCell', { column: col.header }) : undefined}
        onClick={(e) => { if (editable) { e.stopPropagation(); start(); } }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && editable) { e.preventDefault(); e.stopPropagation(); start(); }
        }}
        sx={{
          display: 'block',
          width: '100%',
          textAlign: colAlign(col),
          cursor: editable ? 'text' : 'default',
          borderRadius: px(radius.xs),
          ...(!editable
            ? {}
            : {
                textDecoration: 'underline dashed',
                textDecorationColor: n[300],
                textUnderlineOffset: px(3),
                '&:hover': { outline: `1px solid ${n[300]}`, outlineOffset: px(2), textDecorationColor: accent[600] },
                '&:hover::after': { content: '"✎"', ml: px(4), fontSize: px(11), color: accent[600] },
              }),
          '&:focus-visible': { outline: `2px solid ${accent[600]}`, outlineOffset: px(2) },
        }}
      >
        {display}
      </Box>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Pager: "1–50 of 1,284  Rows 50 ▾  ‹ 1 2 … 26 ›"
// ---------------------------------------------------------------------------

export function pageList(page: number, pageCount: number): Array<number | 'gap'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const set = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = Array.from(set).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

export function Pager({ pagination, fmt, compact }: {
  pagination: Extract<DataTablePagination, { mode: 'pages' }>; fmt: DsFormat; compact?: boolean;
}) {
  const t = useTranslations('ds.table');
  const { page, pageSize, total, onChange } = pagination;
  const sizes = pagination.pageSizes ?? [50, 100, 250];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const sizeId = useId();
  const btn = { minWidth: px(control.sm), height: px(control.sm), px: px(space[2]), borderRadius: px(radius.sm) };
  return (
    <Box
      component="nav"
      aria-label={t('pagination')}
      sx={{ display: 'flex', alignItems: 'center', gap: px(space[3]), flexWrap: 'wrap', px: px(space[3]), py: px(space[2]) }}
    >
      <Typography variant="caption" sx={{ color: n[600], fontVariantNumeric: 'tabular-nums' }}>
        {t('range', { from: fmt.num(from), to: fmt.num(to), total: fmt.num(total) })}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {!compact && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[2]) }}>
          <Typography variant="caption" component="label" htmlFor={sizeId} sx={{ color: n[600] }}>{t('rows')}</Typography>
          <Select
            native
            size="small"
            value={pageSize}
            inputProps={{ id: sizeId }}
            onChange={(e) => onChange({ page: 1, pageSize: Number(e.target.value) as PageSize })}
            sx={{ height: px(control.sm), fontSize: px(13), '& select': { py: 0 } }}
          >
            {sizes.map((s) => <option key={s} value={s}>{fmt.num(s)}</option>)}
          </Select>
        </Box>
      )}
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[1]) }}>
        <IconButton icon={PrevIcon} label={t('prevPage')} size="sm" disabled={page <= 1} onClick={() => onChange({ page: page - 1, pageSize })} />
        {!compact && pageList(page, pageCount).map((p, i) =>
          p === 'gap' ? (
            <Typography key={`g${i}`} variant="caption" component="span" sx={{ color: n[500], px: px(space[1]) }}>{'…'}</Typography>
          ) : (
            <Button
              key={p}
              size="small"
              variant={p === page ? 'outlined' : 'text'}
              aria-current={p === page ? 'page' : undefined}
              aria-label={t('page', { page: p })}
              onClick={() => onChange({ page: p, pageSize })}
              sx={{ ...btn, color: p === page ? n[900] : n[600], fontVariantNumeric: 'tabular-nums' }}
            >
              {fmt.num(p)}
            </Button>
          ),
        )}
        <IconButton icon={NextIcon} label={t('nextPage')} size="sm" disabled={page >= pageCount} onClick={() => onChange({ page: page + 1, pageSize })} />
      </Box>
    </Box>
  );
}
