// components/domain/bulk/BulkToolbar.tsx — bulk-grid §2 toolbar row (M7-C):
//   [⌕ Filter rows in this grid  /]  [Show: All · Edited · Can't be saved ▾]          24 rows · page 1 of 1
// With rows selected the BulkActionBar replaces the row in place (§3.2). The row filter and "Show" are local to the
// grid page (they never change the server query): paste and fill-down follow the filtered display order.
import * as React from 'react';
import Box from '@mui/material/Box';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { BulkActionBar, type BulkActionBarProps } from '@/components/ds/toolbar/BulkActionBar';
import { Select } from '@/components/ds/inputs/Select';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow } from '@/lib/listings/types';
import type { ListingsT } from '@/components/domain/listings/columns';

export type BulkShow = 'all' | 'edited' | 'invalid';

export const BULK_SHOW_VALUES = ['all', 'edited', 'invalid'] as const satisfies readonly BulkShow[];

/** Local row filter (pure): text matches title or id; `edited` = any dirty cell; `invalid` = any invalid cell. */
export function filterGridRows(
  rows: ListingRow[],
  opts: { q: string; show: BulkShow; dirtyRows: ReadonlySet<string>; invalidRows: ReadonlySet<string> },
): ListingRow[] {
  const q = opts.q.trim().toLocaleLowerCase();
  return rows.filter((r) => {
    if (opts.show === 'edited' && !opts.dirtyRows.has(r.id)) return false;
    if (opts.show === 'invalid' && !opts.invalidRows.has(r.id)) return false;
    if (!q) return true;
    return r.title.toLocaleLowerCase().includes(q) || r.id.toLocaleLowerCase().includes(q) || r.metaLine.some((m) => m.toLocaleLowerCase().includes(q));
  });
}

export type BulkToolbarProps = {
  t: ListingsT;
  q: string;
  onQ: (q: string) => void;
  show: BulkShow;
  onShow: (show: BulkShow) => void;
  /** Rows shown / rows on the page. */
  shown: number;
  page: number;
  pages: number;
  selection?: BulkActionBarProps;
};

export function BulkToolbar({ t, q, onQ, show, onShow, shown, page, pages, selection }: BulkToolbarProps) {
  if (selection && selection.count > 0) {
    return (
      <Box sx={{ mb: '8px' }} data-testid="bulk-toolbar-selection">
        <BulkActionBar {...selection} variant="bar" />
      </Box>
    );
  }
  return (
    <Box
      data-testid="bulk-toolbar"
      sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', mb: '8px', minHeight: 40 }}
    >
      <SearchField value={q} onChange={onQ} placeholder={t('bulk.filter.placeholder')} size="sm" data-testid="bulk-row-filter" />
      <Box sx={{ minWidth: 180 }}>
        <Select<BulkShow>
          value={show}
          onChange={onShow}
          size="sm"
          aria-label={t('bulk.show.label')}
          options={BULK_SHOW_VALUES.map((v) => ({ value: v, label: t(`bulk.show.${v}`) }))}
          data-testid="bulk-show"
        />
      </Box>
      <Box sx={{ flex: 1 }} />
      <Box component="span" sx={{ fontSize: 13, color: neutral[600], fontVariantNumeric: 'tabular-nums' }} data-testid="bulk-row-count">
        {t('bulk.rows', { count: shown, page, pages })}
      </Box>
    </Box>
  );
}

export default BulkToolbar;
