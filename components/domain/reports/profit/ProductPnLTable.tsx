// Reports › Profit "Profit by product" (finance-analytics §2.2, §4.6, §4.7). DataTable with a `/` search, client
// pagination (50/100/250), and a `money-edit` Unit cost cell: Enter/Tab saves the cost straight away (KolayXport
// data, no marketplace write, so no staging) in the dashboard currency, then the dashboard revalidates and a
// "Cost saved" toast shows. A failed save keeps the typed value visible with the "Couldn't save cost" tooltip.
// Missing cost: "— Add cost" (ghost) opens the cost panel at that product. No barcode and no SKU: read-only cell.
// A cost whose saved shipping is in another currency is not changed from the cell (the shipping number would be
// re-read in the new currency): the cell shows why and the cost panel opens at that product to re-enter both.
// The search is URL state `q` (spec §1), so a reload or a shared link keeps it.
// Negative profit / margin: danger-fg text only (no chips). Mobile: cards (title / "Sold 118 · Margin %47,5" /
// trailing profit / "Add cost").
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { DataTable, type DataTableState } from '@/components/ds/data/DataTable';
import type { Column, PageSize } from '@/components/ds/data/dataTableParts';
import { Button } from '@/components/ds/inputs/Button';
import { Money } from '@/components/ds/format/Money';
import { Section } from '@/components/ds/page/Section';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { useToast } from '@/components/ds/feedback/toast';
import { useFormatters } from '@/lib/format';
import { neutral as n, tone } from '@/lib/ds/tokens';
import { urlField, useUrlState } from '@/lib/ds/useUrlState';
import { CostCurrencyConflictError, upsertCost } from '@/lib/reports/productCosts';
import type { FinanceDashboard, FinanceProductRow } from '@/lib/reports/useFinanceReport';

export interface ProductPnLTableProps {
  data: FinanceDashboard;
  mp: string;
  /** Display name of the marketplace (lib/ds/logos). */
  mpName: string;
  state?: DataTableState;
  loading?: boolean;
  /** Revalidate the dashboard after a saved cost. */
  onSaved(): void;
  /** Open the cost panel at this product ("Add cost", Enter on a row). */
  onAddCost(row: FinanceProductRow): void;
  onRetry?(): void;
}

export const PROFIT_PRODUCTS_URL_SCHEMA = { q: urlField.string(undefined, { maxLength: 120 }) };

/** Pure filter for the search box: product name, barcode or SKU, case-insensitive. */
export function filterProducts(rows: FinanceProductRow[], q: string): FinanceProductRow[] {
  const s = q.trim().toLocaleLowerCase();
  if (!s) return rows;
  return rows.filter((r) => [r.productName, r.barcode, r.sku].some((v) => v && v.toLocaleLowerCase().includes(s)));
}

export function ProductPnLTable({ data, mp, mpName, state, loading, onSaved, onAddCost, onRetry }: ProductPnLTableProps) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const toast = useToast();
  const currency = data.summary.currency;
  const [url, setUrl] = useUrlState(PROFIT_PRODUCTS_URL_SCHEMA);
  const q = url.q ?? '';
  const setQ = (v: string) => setUrl({ q: v || undefined });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(50);
  /** Saved or failed values shown until the dashboard returns the new numbers. */
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [failed, setFailed] = useState<Map<string, string>>(() => new Map());

  const rows = useMemo(() => filterProducts(data.productBreakdown, q), [data.productBreakdown, q]);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const byKey = useMemo(() => new Map(data.productBreakdown.map((r) => [r.key, r])), [data.productBreakdown]);

  const unitCostOf = (r: FinanceProductRow) => (r.key in overrides ? overrides[r.key] : r.unitCost);
  const noCode = (r: FinanceProductRow) => (!r.barcode && !r.sku ? t('profit.products.noCode') : null);

  const commit = async (rowId: string, value: number | null) => {
    const row = byKey.get(rowId);
    if (!row || value === null) return;
    setOverrides((o) => ({ ...o, [rowId]: value }));
    setFailed((f) => { const next = new Map(f); next.delete(rowId); return next; });
    try {
      await upsertCost(mp, row, value, currency);
      toast.success(t('profit.products.costSaved'));
      onSaved();
    } catch (err) {
      const msg = err instanceof CostCurrencyConflictError
        ? t('profit.products.costCurrencyConflict', { from: err.saved.costCurrency, to: currency })
        : t('profit.products.costSaveFailed');
      setFailed((f) => new Map(f).set(rowId, msg));
      toast.error(msg);
      if (err instanceof CostCurrencyConflictError) onAddCost(row);
    }
  };

  const signed = (v: number | null, kind: 'money' | 'percent') => {
    if (v === null) return '—';
    const color = v < 0 ? tone.danger.fg : 'inherit';
    return (
      <Box component="span" sx={{ color, fontVariantNumeric: 'tabular-nums' }}>
        {kind === 'money' ? <Money amount={v} currency={currency} /> : fmt.percent(v)}
      </Box>
    );
  };

  const subtitle = (r: FinanceProductRow) => {
    const parts = [r.barcode ?? r.sku, r.returnedQuantity > 0 ? t('profit.products.returned', { count: r.returnedQuantity }) : null].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  };

  const addCostButton = (r: FinanceProductRow) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => { e.stopPropagation(); onAddCost(r); }}
      data-testid={`add-cost-${r.key}`}
    >
      {t('profit.products.addCost')}
    </Button>
  );

  const columns: Column<FinanceProductRow>[] = [
    {
      key: 'product',
      header: t('profit.products.product'),
      mobile: 'title',
      minWidth: 220,
      render: (r) => (
        // Capped width + 2-line clamp: a nowrap title made this column 1600px wide and pushed every number off screen.
        <Box sx={{ minWidth: 0, maxWidth: 420 }}>
          <Box title={r.productName} sx={{ color: n[900], display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.productName}</Box>
          {subtitle(r) ? <Box sx={{ color: n[500], fontSize: 12, lineHeight: '16px' }}>{subtitle(r)}</Box> : null}
        </Box>
      ),
      mobileRender: (r) => r.productName,
    },
    {
      key: 'mobileMeta',
      header: '',
      desktop: false,
      mobile: 'subtitle',
      render: (r) => [
        `${t('profit.products.sold')} ${fmt.num(r.quantity)}`,
        // No cost entered → the margin is meaningless (it read "Margin 100%"); the row's "Add cost" says what's missing.
        r.margin === null || unitCostOf(r) == null ? null : `${t('profit.products.margin')} ${fmt.percent(r.margin)}`,
      ].filter(Boolean).join(' · '),
    },
    { key: 'quantity', header: t('profit.products.sold'), type: 'number', mobile: 'hidden', sortable: false },
    { key: 'revenue', header: t('profit.products.revenue'), type: 'money', currency: () => currency, mobile: 'hidden' },
    { key: 'commissions', header: t('profit.products.fees'), type: 'money', currency: () => currency, mobile: 'hidden', hideable: true },
    { key: 'shipping', header: t('profit.products.shipping'), type: 'money', currency: () => currency, mobile: 'hidden', hideable: true },
    {
      key: 'unitCost',
      header: t('profit.products.unitCost'),
      type: 'money-edit',
      currency: () => currency,
      value: unitCostOf,
      validate: (v) => (v !== null && v < 0 ? t('costs.reason.badCost') : null),
      readOnlyReason: noCode,
      cellTooltip: (r) => failed.get(r.key) ?? null,
      render: (r) => {
        const v = unitCostOf(r);
        if (v === null || v === undefined) {
          return (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: n[500] }}>
              {'—'}
              {noCode(r) ? null : addCostButton(r)}
            </Box>
          );
        }
        return (
          <Box component="span" data-failed={failed.has(r.key) ? 'true' : undefined} sx={failed.has(r.key) ? { outline: `1px solid ${tone.danger.solid}`, borderRadius: '4px', px: '4px' } : undefined}>
            <Money amount={v} currency={currency} />
          </Box>
        );
      },
      mobile: 'action',
      mobileRender: (r) => (unitCostOf(r) === null && !noCode(r) ? addCostButton(r) : null),
    },
    { key: 'netProfit', header: t('profit.products.profit'), align: 'right', mobile: 'trailing', render: (r) => signed(r.netProfit, 'money') },
    { key: 'margin', header: t('profit.products.margin'), align: 'right', mobile: 'hidden', render: (r) => signed(r.margin, 'percent') },
  ];

  const tableState: DataTableState = state ?? (rows.length ? 'ready' : 'empty');
  const empty = q.trim()
    ? (
      <EmptyState
        kind="no-results"
        compact
        title={t('empty.noProductMatch', { q: q.trim() })}
        action={{ id: 'clear-search', label: t('actions.clearSearch'), onClick: () => { setQ(''); setPage(1); } }}
      />
    )
    : <EmptyState kind="no-results" compact title={t('empty.noProducts')} />;

  return (
    <Section
      title={t('profit.products.title')}
      headerSlot={
        <SearchField
          value={q}
          onChange={(v) => { setQ(v); setPage(1); }}
          placeholder={t('sales.products.search')}
          size="sm"
          width={260}
          data-testid="profit-products-search"
        />
      }
      data-testid="profit-products"
    >
      <Box aria-busy={loading || undefined} sx={{ opacity: loading ? 0.6 : 1 }}>
        <DataTable<FinanceProductRow>
          rows={pageRows}
          columns={columns}
          getRowId={(r) => r.key}
          state={tableState}
          empty={empty}
          error={<ErrorState variant="inline" title={t('error.profit', { name: mpName })} onRetry={onRetry} />}
          onRowOpen={(r) => onAddCost(r)}
          onCellCommit={(rowId, _key, value) => { void commit(rowId, value); }}
          columnStateKey="reports.profit.products"
          ariaLabel={t('profit.products.title')}
          pagination={rows.length > 50 ? {
            mode: 'pages',
            page,
            pageSize,
            total: rows.length,
            onChange: (next) => { setPage(next.page); setPageSize(next.pageSize); },
          } : undefined}
        />
      </Box>
    </Section>
  );
}

export default ProductPnLTable;
