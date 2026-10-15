// components/domain/listings/stockManaged.tsx — stock-managed quantities in the listings grid (M5) and BulkGrid (M7).
// One batch request per page (`useStockManagedMany`, BR-11) instead of a hook per row. A quantity is "managed"
// only when stock sync is LIVE and the listing has managed variants; while loading, on error, in dry run
// (`live=false`) or on other marketplaces nothing is marked and the cells behave exactly as before.
import * as React from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { useStockManagedMany, type StockManagedResponse } from '@/components/stock/useStockManaged';
import { normalizeListingIds } from '@/lib/stock/managedIds';
import { accent, neutral } from '@/lib/ds/tokens';
import { icons } from '@/lib/ds/icons';
import type { ListingMarketplace, ListingRow } from '@/lib/listings/types';

/** Stock sync page (the "why" link next to a managed quantity). */
export const STOCK_SYNC_HREF = '/app/stok-senkron';

const EMPTY: ReadonlySet<string> = new Set<string>();
const StockIcon = icons.stockSync;

/**
 * Row ids whose quantity is owned by live stock sync (pure). `live=false` (dry run / sync off) → empty set.
 * Row ids are matched in the normalised form the endpoint answers with.
 */
export function stockManagedIdsOf(
  rows: ReadonlyArray<Pick<ListingRow, 'id'>>,
  stock: { live: boolean; byListing: ReadonlyMap<string, StockManagedResponse> },
): ReadonlySet<string> {
  if (!stock.live || stock.byListing.size === 0) return EMPTY;
  const out = new Set<string>();
  for (const r of rows) {
    const id = normalizeListingIds([r.id])[0];
    const info = id ? stock.byListing.get(id) : undefined;
    if (info?.managed) out.add(r.id);
  }
  return out.size ? out : EMPTY;
}

/** Marketplaces whose quantities stock sync can manage (the endpoint is Etsy-only). */
export function stockSyncApplies(marketplace: ListingMarketplace): boolean {
  return marketplace === 'etsy';
}

/**
 * Ids of the loaded rows whose quantity stock sync manages. One `GET /api/stock/etsy-managed?ids=…` for all
 * rows (SWR key built from the sorted ids, so re-renders never refetch); no request off Etsy.
 */
export function useStockManagedRows(rows: ReadonlyArray<Pick<ListingRow, 'id'>>, marketplace: ListingMarketplace, storeId: string | null): ReadonlySet<string> {
  const applies = stockSyncApplies(marketplace);
  const ids = React.useMemo(() => (applies ? rows.map((r) => r.id) : []), [applies, rows]);
  const stock = useStockManagedMany(ids, applies ? storeId : null);
  const { live, byListing } = stock;
  return React.useMemo(() => (applies ? stockManagedIdsOf(rows, { live, byListing }) : EMPTY), [applies, rows, live, byListing]);
}

/**
 * The row as the stock modal must see it: a managed quantity is not editable (`editable.qty = false`). The shared
 * `reason` is only set to `stock_managed` when price is still editable, so a price reason is never overwritten.
 */
export function withStockManaged(row: ListingRow, managedIds: ReadonlySet<string>): ListingRow {
  if (!managedIds.has(row.id) || !row.editable.qty) return row;
  return { ...row, editable: { ...row.editable, qty: false, reason: row.editable.price ? 'stock_managed' : row.editable.reason } };
}

/**
 * Lock icon linking to the stock sync page, shown after a managed quantity. Clicks never reach the row (quick
 * view) or the grid cell (edit start). On touch the hit area grows to 44×44 (an absolutely positioned ::before).
 */
export function StockManagedMark({ label }: { label: string }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Tooltip title={label}>
      <Box
        component={Link}
        href={STOCK_SYNC_HREF}
        aria-label={label}
        data-row-stop="true"
        data-testid="stock-managed-link"
        onClick={stop}
        onMouseDown={stop}
        onKeyDown={stop}
        sx={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          verticalAlign: 'middle',
          // DS: ≥ 44×44 touch target under a coarse pointer, without changing the line height (14px glyph + 15px each side).
          '@media (pointer: coarse)': { '&::before': { content: '""', position: 'absolute', inset: '-15px' } },
          ml: '4px',
          color: neutral[500],
          borderRadius: '4px',
          '&:hover': { color: accent[600] },
          '&:focus-visible': { outline: `2px solid ${accent[600]}`, outlineOffset: '1px' },
        }}
      >
        <StockIcon size={14} aria-hidden />
      </Box>
    </Tooltip>
  );
}

/** Quantity text + the stock sync mark (grid cells). */
export function StockManagedQty({ text, label }: { text: React.ReactNode; label: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0, whiteSpace: 'nowrap' }} data-testid="stock-managed-qty">
      {text}
      <StockManagedMark label={label} />
    </Box>
  );
}
