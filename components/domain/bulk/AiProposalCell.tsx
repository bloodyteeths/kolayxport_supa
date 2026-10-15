// components/domain/bulk/AiProposalCell.tsx — bulk-grid §7 "Improve with AI" (M7-D): the Sparkles marker on a
// grid cell whose value is an AI suggestion, with the tooltip "AI suggestion · Revert to keep yours".
//
// The cell is still an ordinary dirty edit (attention bar from BulkGrid, DS §2.6); this only adds the marker. It
// never takes focus or handles keys (the grid owns roving focus, bulk-grid §4), so the icon is aria-hidden and the
// suggestion is announced through visually hidden text instead.
//
// Two ways to use it:
//   1. `<AiProposalCell active={ai.isProposal(rowId, 'title', value)}>{display}</AiProposalCell>` inside a renderer.
//   2. `withAiMarker(column, { isProposal, getRowId, isDirty })` wraps a BulkGrid column's `renderValue` (the
//      overlay-aware value) so the marker and its tooltip show while the cell is an unsent AI proposal.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { accent } from '@/lib/ds/tokens';

const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, p: 0, m: '-1px', overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

export interface AiProposalCellProps {
  /** True when the cell's current value is an AI suggestion (`useBulkAi().isProposal`). */
  active: boolean;
  /** The cell's normal display content. */
  children: React.ReactNode;
  /** Show the tooltip on the marker (default true). Pass false when the column's `cellTooltip` already shows it. */
  tooltip?: boolean;
  'data-testid'?: string;
}

/** Renders `children` unchanged when inactive; otherwise prefixes the AI marker. */
export function AiProposalCell({ active, children, tooltip = true, ...rest }: AiProposalCellProps) {
  const t = useTranslations();
  if (!active) return <>{children}</>;
  const label = t('bulk.ai.suggestion');
  const Icon = icons.ai;
  const marker = (
    <Box
      component="span"
      data-ai-marker=""
      sx={{ display: 'inline-flex', flexShrink: 0, color: accent[600], lineHeight: 0 }}
    >
      <Icon size={12} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
    </Box>
  );
  return (
    <Box
      component="span"
      data-ai-proposal=""
      data-testid={rest['data-testid']}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: 0, maxWidth: '100%' }}
    >
      {tooltip ? <Tooltip title={label}>{marker}</Tooltip> : marker}
      <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</Box>
      <Box component="span" sx={SR_ONLY}>{label}</Box>
    </Box>
  );
}

/** Structural subset of a BulkGrid `GridColumn<T>` that the marker decorates. */
export interface AiMarkableColumn<T> {
  key: string;
  /** BulkGrid staging field key; falls back to `key`. */
  field?: string;
  renderValue?(value: unknown, row: T): React.ReactNode;
}

export interface WithAiMarkerOptions<T> {
  /** `useBulkAi().isProposal`. */
  isProposal(rowId: string, field: string, currentValue?: unknown, dirty?: boolean): boolean;
  getRowId(r: T): string;
  /** True while the cell is an unsent draft edit (the grid's `dirty` set). Omitted = not checked. */
  isDirty?(rowId: string, field: string): boolean;
}

/** Default display when the column has no `renderValue`: arrays joined with ", ", empty as an em dash. */
function plainDisplay(v: unknown): React.ReactNode {
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : '\u2014';
  return v === null || v === undefined || v === '' ? '\u2014' : String(v);
}

/**
 * BulkGrid only: returns a copy of `column` whose `renderValue` shows the AI marker (with its own tooltip, since
 * grid cells never read `cellTooltip`) while the cell's value is still the AI suggestion and unsent. It wraps
 * `renderValue`, which BulkGrid calls with the overlay-aware (draft) value; `render` is skipped by BulkGrid for
 * cells with a draft overlay, which every AI proposal has. Not for read-only DataTable columns.
 */
export function withAiMarker<T, C extends AiMarkableColumn<T>>(column: C, o: WithAiMarkerOptions<T>): C {
  const field = column.field ?? column.key;
  const inner = column.renderValue;
  return {
    ...column,
    renderValue: (v: unknown, r: T) => {
      const rowId = o.getRowId(r);
      const active = o.isProposal(rowId, field, v, o.isDirty ? o.isDirty(rowId, field) : undefined);
      return <AiProposalCell active={active}>{inner ? inner(v, r) : plainDisplay(v)}</AiProposalCell>;
    },
  };
}

export default AiProposalCell;
