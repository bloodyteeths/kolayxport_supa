// components/domain/reports/sales/TopProductsTable.tsx — finance-analytics §2.1 "Top products" (M9 Group C).
// Top 10 by revenue, grouped by SKU (else name) and counted in units sold (B5). Thumb · product + SKU · units ·
// revenue (≈ when converted). The search (`/`, URL `q`) filters the loaded rows by name or SKU.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { DataTable } from '@/components/ds/data/DataTable';
import type { Column } from '@/components/ds/data/dataTableParts';
import { Section } from '@/components/ds/page/Section';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import type { SalesProductRow } from '@/lib/reports/useSalesReport';

/** Pure: case- and accent-insensitive match on name or SKU (Turkish dotted/dotless i folded). */
export function matchesProduct(row: Pick<SalesProductRow, 'name' | 'sku'>, q: string): boolean {
  const fold = (s: string) =>
    s
      .toLocaleLowerCase('tr')
      .replace(/ı/g, 'i')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  const needle = fold(q.trim());
  if (!needle) return true;
  return fold(row.name).includes(needle) || (row.sku ? fold(row.sku).includes(needle) : false);
}

export interface TopProductsTableProps {
  rows: SalesProductRow[];
  currency: string;
  approx: boolean;
  fxNote?: string;
  q: string;
  onQueryChange: (q: string) => void;
}

export function TopProductsTable({ rows, currency, approx, fxNote, q, onQueryChange }: TopProductsTableProps) {
  const t = useTranslations('reports');
  const shown = React.useMemo(() => rows.filter((r) => matchesProduct(r, q)), [rows, q]);

  const columns: Column<SalesProductRow>[] = [
    { key: 'image', header: '', type: 'thumb', thumbAlt: (r) => r.name, mobile: 'media', width: 64 },
    {
      key: 'name',
      header: t('sales.products.product'),
      mobile: 'title',
      minWidth: 200,
      render: (r) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: 420 }}>
          <Box component="span" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', color: neutral[900] }} title={r.name}>
            {r.name || '—'}
          </Box>
          {r.sku ? (
            <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500], fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
              {r.sku}
            </Box>
          ) : null}
        </Box>
      ),
    },
    { key: 'units', header: t('sales.products.units'), type: 'number', mobile: 'meta' },
    {
      key: 'revenue',
      header: t('sales.products.revenue'),
      type: 'money',
      currency: () => currency,
      fxNote: () => (approx ? fxNote ?? null : null),
      mobile: 'trailing',
    },
  ];

  const empty = q.trim() ? (
    <EmptyState
      kind="no-results"
      icon={icons.noResults}
      title={t('empty.noProductMatch', { q: q.trim() })}
      action={{ id: 'clear-search', label: t('actions.clearSearch'), onClick: () => onQueryChange('') }}
      compact
    />
  ) : (
    <EmptyState kind="no-results" icon={icons.noResults} title={t('empty.noProducts')} compact />
  );

  return (
    <Section
      title={t('sales.products.title')}
      headerSlot={
        rows.length ? (
          <SearchField
            value={q}
            onChange={onQueryChange}
            placeholder={t('sales.products.search')}
            width={240}
            data-testid="sales-products-search"
          />
        ) : null
      }
      data-testid="sales-products"
    >
      <DataTable<SalesProductRow>
        rows={shown}
        columns={columns}
        getRowId={(r) => r.key}
        state={shown.length ? 'ready' : 'empty'}
        empty={empty}
        columnStateKey="reports.sales.products"
        ariaLabel={t('sales.products.title')}
        stickyHeader={false}
      />
    </Section>
  );
}

export default TopProductsTable;
