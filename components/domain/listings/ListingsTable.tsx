// components/domain/listings/ListingsTable.tsx — listings-grid §4, §7 (G5): the DS DataTable with the listings
// columns, draft overlay (dirtyCells), inline price/qty staging, server pagination (desktop pages; mobile
// "Load more"), and every table-body state of §7 (skeleton, slow, error, first pull, empty shop, no results,
// "done" views, partial-score caption, refetch at 60% opacity).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { control, neutral } from '@/lib/ds/tokens';
import { DataTable, type DataTableState } from '@/components/ds/data';
import type { ActionSpec } from '@/components/ds/page';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { CardListSkeleton, TableSkeleton } from '@/components/ds/state/Skeletons';
import type { AsyncState } from '@/lib/ds/useAsyncState';
import { icons } from '@/lib/ds/icons';
import type { BuiltInViewKey, ListingPageSize, ListingRow, ListingsResponse } from '@/lib/listings/types';
import type { Column } from '@/components/ds/data';
import type { ListingsT } from './columns';

export type ListingsEmptyKind = 'firstPull' | 'noListings' | 'noResults' | 'doneNotSent' | 'doneFailed' | 'doneNeedsWork';

/** Which empty state the table shows (pure, unit-tested). Null = rows to show (or not loaded yet). */
export function listingsEmptyKind(args: {
  data: Pick<ListingsResponse, 'rows' | 'counts' | 'store'> | undefined;
  view: string;
  filtered: boolean;
}): ListingsEmptyKind | null {
  const { data, view, filtered } = args;
  if (!data || data.rows.length > 0) return null;
  if (data.counts.all === 0 && !filtered) return data.store.lastPulledAt ? 'noListings' : 'firstPull';
  if (!filtered) {
    if (view === 'not_sent') return 'doneNotSent';
    if (view === 'send_failed') return 'doneFailed';
    if (view === 'needs_work') return 'doneNeedsWork';
  }
  return 'noResults';
}

export type ListingsTableProps = {
  rows: ListingRow[];
  columns: Column<ListingRow>[];
  state: AsyncState;
  emptyKind: ListingsEmptyKind | null;
  mobile: boolean;
  t: ListingsT;
  marketplace: string;
  marketplaceName: string;
  storeName: string;
  /** Refetch with previous data on screen (§7 "Loading (page, sort or filter change)"). */
  refetching: boolean;
  onRetry: () => void;
  errorId?: string;
  onClearFilters: () => void;
  /** First-use primary: "Refresh from Etsy" (the only time pull is a button, §7). */
  onFirstPull?: () => void;
  pulling?: boolean;
  /** "+ New listing" for an empty shop; omitted when there is no create route. */
  newListing?: ActionSpec;
  selection: { ids: string[]; onChange(ids: string[]): void };
  isRowSelectable?: (r: ListingRow) => boolean;
  onRowOpen: (r: ListingRow) => void;
  onRowEdit: (r: ListingRow) => void;
  inlineAction: (r: ListingRow) => ActionSpec | null;
  rowActions: (r: ListingRow) => ActionSpec[];
  onCellCommit: (rowId: string, key: string, value: number | null) => void;
  dirtyCells: Set<string>;
  density: 'standard' | 'compact';
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  onSortChange: (s: { key: string; dir: 'asc' | 'desc' }) => void;
  page: number;
  pageSize: ListingPageSize;
  total: number | undefined;
  onPage: (next: { page: number; pageSize: ListingPageSize }) => void;
  columnStateKey: string;
  /** "12 listings not scored yet" (§7 partial: score missing). */
  unscored?: number;
  activeRowId?: string | null;
  ariaLabel: string;
  /** Cards: "205 results" / "Updating…", shown at the start of the "Select" row (one row instead of two). */
  mobileCountLabel?: string;
};

export function ListingsTable(p: ListingsTableProps) {
  const { t } = p;
  let state: DataTableState = 'ready';
  if (p.state === 'loading' || p.state === 'slow') state = 'loading';
  else if (p.state === 'error') state = 'error';
  else if (p.emptyKind) state = 'empty';

  const on = t('listings.mp.on', { marketplace: p.marketplace });
  const to = t('listings.mp.to', { marketplace: p.marketplace });

  let empty: React.ReactNode = null;
  switch (p.emptyKind) {
    case 'firstPull':
      empty = (
        <EmptyState
          kind="first-use"
          brand={p.marketplace}
          title={t('listings.empty.firstPullTitle', { marketplace: p.marketplaceName })}
          body={t('listings.empty.firstPullBody', { on })}
          action={
            p.onFirstPull
              ? {
                  id: 'firstPull',
                  label: t('listings.meta.refresh', { from: t('listings.mp.from', { marketplace: p.marketplace }) }),
                  icon: icons.pull,
                  loading: p.pulling,
                  onClick: p.onFirstPull,
                }
              : undefined
          }
          data-testid="listings-empty-first-pull"
        />
      );
      break;
    case 'noListings':
      empty = (
        <EmptyState
          kind="first-use"
          brand={p.marketplace}
          title={t('listings.empty.noListingsTitle', { store: p.storeName })}
          action={p.newListing}
          data-testid="listings-empty-shop"
        />
      );
      break;
    case 'doneNotSent':
    case 'doneFailed':
    case 'doneNeedsWork':
      empty = (
        <EmptyState
          kind="done"
          compact
          title={
            p.emptyKind === 'doneNotSent'
              ? t('listings.empty.doneNotSent', { to })
              : p.emptyKind === 'doneFailed'
                ? t('listings.empty.doneFailed')
                : t('listings.empty.doneNeedsWork')
          }
          data-testid={`listings-empty-${p.emptyKind}`}
        />
      );
      break;
    case 'noResults':
      empty = (
        <EmptyState
          kind="no-results"
          compact
          title={t('listings.empty.noResults')}
          action={{ id: 'clearFilters', label: t('listings.empty.clearFilters'), onClick: p.onClearFilters }}
          data-testid="listings-empty-no-results"
        />
      );
      break;
    default:
      empty = null;
  }

  const pagination =
    p.total !== undefined && p.total > 0
      ? {
          mode: 'pages' as const,
          page: p.page,
          pageSize: p.pageSize,
          total: p.total,
          onChange: p.onPage,
          // Mobile: "Load more" grows the page (50 → 100 → 250), then pages on.
          onLoadMore:
            p.page * p.pageSize < p.total
              ? () => {
                  if (p.pageSize < 250) p.onPage({ page: 1, pageSize: p.pageSize === 50 ? 100 : 250 });
                  else p.onPage({ page: p.page + 1, pageSize: p.pageSize });
                }
              : undefined,
        }
      : undefined;

  // Cards: the count shares the DataTable "Select" row (it is right-aligned there). Zero-height so it takes no row
  // of its own; hidden while select mode shows "N selected" in the same spot.
  const mobileCount =
    p.mobile && state === 'ready' && p.mobileCountLabel && p.selection.ids.length === 0 ? (
      <Box sx={{ position: 'relative', height: 0 }}>
        <Typography
          variant="caption"
          component="span"
          className="tnum"
          aria-live="polite"
          data-testid="listings-mobile-count"
          sx={{ position: 'absolute', left: 0, top: 0, height: control.lg, display: 'flex', alignItems: 'center', color: neutral[600], whiteSpace: 'nowrap', zIndex: 1 }}
        >
          {p.mobileCountLabel}
        </Typography>
      </Box>
    ) : null;

  return (
    <Box
      sx={{
        opacity: p.refetching ? 0.6 : 1,
        transition: 'opacity 120ms',
        pointerEvents: p.refetching ? 'none' : undefined,
        // Select mode prints "N selected" at the start of the same row.
        '&:has([data-layout="cards"] > :first-child > .MuiTypography-root) [data-testid="listings-mobile-count"]': { visibility: 'hidden' },
      }}
      aria-busy={p.refetching || undefined}
      data-testid="listings-table-wrap"
    >
      {mobileCount}
      <DataTable<ListingRow>
        rows={p.rows}
        columns={p.columns}
        getRowId={(r) => r.id}
        state={state}
        loading={
          p.state === 'slow' ? (
            <SlowState onRetry={p.onRetry} data-testid="listings-slow" />
          ) : p.mobile ? (
            <CardListSkeleton count={5} thumb />
          ) : (
            <TableSkeleton rows={8} thumb density={p.density} />
          )
        }
        empty={empty}
        error={
          <ErrorState
            variant="page"
            title={t('listings.error.load', { marketplace: p.marketplaceName })}
            cause={t('listings.error.serverNoResponse')}
            errorId={p.errorId}
            onRetry={p.onRetry}
            data-testid="listings-error"
          />
        }
        selection={p.selection}
        isRowSelectable={p.isRowSelectable}
        onRowOpen={p.onRowOpen}
        onRowEdit={p.onRowEdit}
        inlineAction={p.inlineAction}
        rowActions={p.rowActions}
        onCellCommit={p.onCellCommit}
        dirtyCells={p.dirtyCells}
        density={p.density}
        sort={p.sort}
        onSortChange={p.onSortChange}
        pagination={pagination}
        columnStateKey={p.columnStateKey}
        caption={p.unscored && p.unscored > 0 ? t('listings.health.unscored', { count: p.unscored }) : undefined}
        ariaLabel={p.ariaLabel}
        activeRowId={p.activeRowId}
        data-testid="listings-table"
      />
    </Box>
  );
}

export default ListingsTable;
