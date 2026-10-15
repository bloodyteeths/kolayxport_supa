// components/domain/reports/transactions/TransactionsReport.tsx — Reports › Transactions (finance-analytics §2.3, §3,
// §4.1, §4.8, §6.2; M9 Group E). "Show me the line items behind those numbers."
//
// One marketplace in its own currency. Toolbar adds "Type" (categories with counts, from the dashboard's
// `transactionTypeSummary`), and the result count sits on the right. Table: Date · Type (translated category; the raw
// marketplace type in the tooltip, B16) · Product · Order (copyable) · Amount (signed, success/danger text only) · Fee.
// Server pagination through `GET /api/finance/settlements` (B14: errors surface as ErrorState, never "No transactions").
// Primary: Export CSV via `format=csv` (every row in range, not just the loaded page); above the API cap a confirm
// names the cap. Refresh from the marketplace lives in the meta ⟳ (shared `FinanceMeta`).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import type { ActionSpec } from '@/components/ds/page';
import { DataTable, type Column, type PageSize } from '@/components/ds/data';
import { Money } from '@/components/ds/format/Money';
import { CopyText } from '@/components/ds/format/CopyText';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { useConfirm } from '@/components/ds/overlay';
import { EmptyState, ErrorState, SlowState, TableSkeleton } from '@/components/ds/state';
import { useToast } from '@/components/ds/feedback';
import type { FilterDef, FilterOption, FilterValues } from '@/components/ds/toolbar/types';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { neutral, px, space, tone } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { useConnections } from '@/lib/hooks/useConnections';
import { useFeatureAccess } from '@/lib/billing/useFeatureAction';
import {
  ReportsPage, useReportMarketplace, useReportRange, FINANCE_MARKETPLACE_NAME, type FinanceMarketplace,
} from '@/components/domain/reports/ReportsPage';
import { useFinanceReport, useFinanceSync } from '@/lib/reports/useFinanceReport';
import { reportCsvFilename } from '@/lib/reports/exportCsv';
import {
  useTransactions, useTransactionsFilter, typeOptionsFromSummary, transactionsCsvUrl, downloadFromUrl,
  isTxCategory, TX_EXPORT_MAX_ROWS, TX_PAGE_SIZES, type TxRow, type TxCategory,
} from '@/lib/reports/useTransactions';
import {
  FinanceMeta, FinanceStateBody, effectiveConnected, financeTabView, isFinanceGated,
} from '@/components/domain/reports/payouts/PayoutsReport';

// ── pure helpers (unit-tested) ──────────────────────────────────────────────────────────────────────────

/** Type filter options: categories with counts; the current URL value is kept as an option even at count 0. */
export function buildTypeOptions(
  summary: Array<{ type: string; count: number; category: string | null }> | undefined,
  current: string | null,
  label: (c: TxCategory) => string,
): FilterOption[] {
  const opts = typeOptionsFromSummary(summary ?? []);
  const out: FilterOption[] = opts.map((o) => ({ value: o.value, label: label(o.value), count: o.count }));
  if (current && isTxCategory(current) && !opts.some((o) => o.value === current)) {
    out.push({ value: current, label: label(current), count: 0 });
  }
  return out;
}

/** Text tone of a signed amount (§5: success-fg positive, danger-fg negative, text only). */
export function amountTone(amount: number): 'success' | 'danger' | 'neutral' {
  if (amount > 0) return 'success';
  if (amount < 0) return 'danger';
  return 'neutral';
}

/** The table is "never synced": no cursor, no rows, no filter (otherwise it is a plain empty range). */
export function isTxNeverSynced(d: { rows: unknown[]; syncCursor: unknown } | undefined, type: string | null): boolean {
  return Boolean(d) && d!.syncCursor === null && d!.rows.length === 0 && !type;
}

// ── component ───────────────────────────────────────────────────────────────────────────────────────────

export interface TransactionsReportProps {
  /** Tests: fixed clock. */
  now?: Date;
}

export function TransactionsReport({ now }: TransactionsReportProps = {}) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const toast = useToast();
  const confirm = useConfirm();
  const range = useReportRange(now);
  const store = useReportMarketplace();
  const conn = useConnections();
  const { access } = useFeatureAccess('financials');
  const gated = isFinanceGated(access);
  const connected = effectiveConnected(store.connected, conn);
  const mp = store.mp;
  const name = FINANCE_MARKETPLACE_NAME[mp];
  const filter = useTransactionsFilter(`${mp}|${range.from}|${range.to}`);
  const [pageSize, setPageSize] = React.useState<PageSize>(50);

  const enabled = !gated && store.supported && connected === true;
  const tx = useTransactions(
    enabled ? { mp, from: range.from, to: range.to, tz: range.tz, type: filter.type, page: filter.page, size: pageSize } : null,
  );
  // Type options + currency/freshness come from the dashboard (same SWR key as Profit/Payouts).
  const report = useFinanceReport({ mp, from: range.from, to: range.to, tz: range.tz, enabled });
  const sync = useFinanceSync(enabled ? mp : null, { from: range.from, to: range.to });
  const data = tx.data;
  const total = data?.total ?? 0;

  const neverSynced = isTxNeverSynced(data, filter.type);
  const view = financeTabView({
    gated,
    supported: store.supported,
    connected,
    async: tx.state === 'empty' ? 'ready' : tx.state,
    hasData: Boolean(data) || tx.state === 'error',
    neverSynced,
  });

  // ── refresh (meta ⟳) + "N new transactions" toast (only when something new arrived) ──
  // The delta is computed against a fresh read of the SAME key right after the sync resolves (no ref/effect
  // handoff: an armed ref would fire later on an unrelated filter/range change). `txMutate` is captured at
  // press time, so a scope change mid-sync still compares like with like.
  const txMutate = tx.mutate;
  const onPull = React.useCallback(async () => {
    const before = data?.total;
    const res = await sync.run();
    if (res === null) {
      toast.error(t('error.refresh', { name, mp }));
      return;
    }
    if (before === undefined) return;
    const fresh = await txMutate().catch(() => undefined);
    const added = fresh ? fresh.total - before : 0;
    if (added > 0) toast.info(t('toast.newTransactions', { count: added, name, mp }));
  }, [data, sync, txMutate, toast, t, name, mp]);

  // ── page past the end (stale link, 50→250 size change, backend dedupe): clamp to the last page ──
  const { setPage } = filter;
  React.useEffect(() => {
    if (!data || tx.isValidating || data.total <= 0 || data.rows.length > 0) return;
    if (data.page !== filter.page || filter.page <= 1) return;
    setPage(Math.max(1, Math.ceil(data.total / pageSize)));
  }, [data, tx.isValidating, filter.page, pageSize, setPage]);

  // ── export ──
  const [exporting, setExporting] = React.useState(false);
  const onExport = React.useCallback(async () => {
    if (exporting || total === 0) return;
    if (total > TX_EXPORT_MAX_ROWS) {
      const ok = await confirm({
        title: t('actions.exportCap', { count: fmt.num(TX_EXPORT_MAX_ROWS) }),
        confirmLabel: t('actions.exportCsv'),
      });
      if (!ok) return;
    }
    setExporting(true);
    try {
      await downloadFromUrl(
        transactionsCsvUrl({ mp, from: range.from, to: range.to, tz: range.tz, type: filter.type }),
        reportCsvFilename('transactions', range.from, range.to),
      );
    } catch {
      toast.error(t('actions.exportFailed'));
    } finally {
      setExporting(false);
    }
  }, [exporting, total, confirm, t, fmt, mp, range.from, range.to, range.tz, filter.type, toast]);

  const ready = view === 'ready';
  const primary: ActionSpec | undefined = ready
    ? {
        id: 'export-csv',
        label: t('actions.exportCsv'),
        icon: icons.download,
        onClick: () => void onExport(),
        loading: exporting,
        loadingLabel: t('actions.exporting'),
        disabled: total === 0,
        disabledReason: total === 0 ? t('actions.nothingToExport') : undefined,
      }
    : undefined;

  // ── toolbar: Store (from ReportsPage's scope) + Type ──
  const typeDef: FilterDef = {
    key: 'type',
    label: t('toolbar.type'),
    type: 'select',
    pinned: true,
    allLabel: t('toolbar.all'),
    options: buildTypeOptions(report.data?.transactionTypeSummary, filter.type, (c) => t(`tx.cat.${c}`)),
  };
  const filterValues: FilterValues = { mp: store.value, type: filter.type ?? undefined };
  const onFiltersChange = (v: FilterValues) => {
    const nextMp = typeof v.mp === 'string' ? v.mp : undefined;
    if (nextMp && nextMp !== store.value && nextMp in FINANCE_MARKETPLACE_NAME) {
      store.setMp(nextMp as FinanceMarketplace);
      return;
    }
    const nextType = typeof v.type === 'string' && v.type ? v.type : null;
    if (nextType !== filter.type) filter.setType(nextType);
  };

  const meta = enabled && view !== 'never' ? (
    <FinanceMeta
      mp={mp}
      lastSyncedAt={report.data?.lastSyncedAt ?? data?.syncCursor?.updatedAt}
      syncState={sync.state}
      onPull={() => void onPull()}
      currency={report.data?.summary.currency ?? data?.rows[0]?.currency ?? null}
      updating={Boolean(data) && tx.isValidating}
    />
  ) : null;

  const columns = React.useMemo(() => txColumns(t, name), [t, name]);
  const clearType: ActionSpec = { id: 'clear-filters', label: t('actions.clearFilters'), onClick: () => filter.setType(null) };
  const last90: ActionSpec = { id: 'last-90', label: t('actions.showLast90'), onClick: () => range.setPreset('last90') };

  const tableState = tx.state === 'loading' || tx.state === 'slow' ? 'loading' : tx.state === 'error' ? 'error' : tx.state === 'empty' ? 'empty' : 'ready';

  return (
    <ReportsPage
      tab="transactions"
      primary={primary}
      meta={meta}
      storeFilter={store.filter}
      toolbarExtra={ready ? [typeDef] : []}
      filterValues={filterValues}
      onFiltersChange={onFiltersChange}
      resultCount={ready && data ? total : undefined}
      resultLabel={ready && data ? t('tx.count', { count: total }) : undefined}
      hideToolbar={view === 'never'}
      data-testid="transactions-report"
    >
      {!ready ? (
        <FinanceStateBody
          view={view}
          mp={mp}
          requested={store.requested}
          connectTitleKey="tx.connect"
          errorTitle={t('error.transactions')}
          onRetry={tx.retry}
          onRefresh={() => void onPull()}
          refreshing={sync.state === 'pulling'}
          skeleton={<TableSkeleton rows={8} columns={6} data-testid="transactions-skeleton" />}
        />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[3]) }} data-testid="transactions-body">
          {tx.state === 'stale' ? <ErrorState variant="stale" onRetry={tx.retry} data-testid="transactions-stale" /> : null}
          <Box
            aria-busy={tx.isValidating || undefined}
            sx={{ opacity: tx.isValidating && data ? 0.6 : 1, transition: 'opacity 120ms linear' }}
          >
            <DataTable<TxRow>
              rows={data?.rows ?? []}
              columns={columns}
              getRowId={(r) => r.id}
              state={tableState}
              loading={tx.state === 'slow' ? <SlowState variant="inline" onRetry={tx.retry} /> : <TableSkeleton rows={8} columns={6} />}
              error={<ErrorState variant="inline" title={t('error.transactions')} onRetry={tx.retry} data-testid="transactions-error" />}
              empty={
                <EmptyState
                  kind="no-results"
                  title={t('tx.empty')}
                  action={filter.type ? clearType : last90}
                  data-testid="transactions-empty"
                />
              }
              density="standard"
              columnStateKey="reports.transactions"
              ariaLabel={t('tabs.transactions')}
              pagination={
                data && total > 0
                  ? {
                      mode: 'pages',
                      page: filter.page,
                      pageSize,
                      total,
                      pageSizes: [...TX_PAGE_SIZES],
                      onChange: (next) => {
                        if (next.pageSize !== pageSize) {
                          setPageSize(next.pageSize);
                          filter.setPage(1);
                        } else filter.setPage(next.page);
                      },
                    }
                  : undefined
              }
              data-testid="transactions-table"
            />
          </Box>
        </Box>
      )}
    </ReportsPage>
  );
}

function SignedAmount({ amount, currency }: { amount: number; currency: string }) {
  const tn = amountTone(amount);
  return (
    <Box component="span" data-tone={tn} sx={{ color: tn === 'neutral' ? neutral[800] : tone[tn].fg, fontVariantNumeric: 'tabular-nums' }}>
      <Money amount={amount} currency={currency} sign={amount !== 0} />
    </Box>
  );
}

function TypeCell({ row, label, tip }: { row: TxRow; label: string; tip: string }) {
  const Info = icons.info;
  return (
    <Tooltip title={tip}>
      <Box
        component="span"
        tabIndex={0}
        aria-label={`${label} (${tip})`}
        data-testid="tx-type"
        data-raw={row.rawType}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: neutral[800], cursor: 'default' }}
      >
        {label}
        <Info size={12} strokeWidth={ICON_STROKE} aria-hidden style={{ color: neutral[400] }} />
      </Box>
    </Tooltip>
  );
}

function txColumns(t: ReturnType<typeof useTranslations>, name: string): Column<TxRow>[] {
  const catLabel = (r: TxRow) => t(`tx.cat.${r.category}`);
  return [
    { key: 'date', header: t('tx.date'), type: 'date', value: (r) => r.date || null, width: 112, mobile: 'meta' },
    {
      key: 'type',
      header: t('tx.type'),
      render: (r) => <TypeCell row={r} label={catLabel(r)} tip={t('tx.rawType', { name, raw: r.rawType || '—' })} />,
      mobileRender: (r) => catLabel(r),
      width: 160,
      mobile: 'subtitle',
    },
    {
      key: 'product',
      header: t('tx.product'),
      render: (r) => r.productName ?? '—',
      mobileRender: (r) => r.productName ?? catLabel(r),
      minWidth: 200,
      mobile: 'title',
    },
    {
      key: 'order',
      header: t('tx.order'),
      render: (r) => (r.orderNumber ? <CopyText value={r.orderNumber} mono /> : '—'),
      mobileRender: (r) => r.orderNumber ?? '',
      width: 160,
      mobile: 'meta',
    },
    {
      key: 'amount',
      header: t('tx.amount'),
      align: 'right',
      render: (r) => <SignedAmount amount={r.amount} currency={r.currency} />,
      width: 140,
      mobile: 'trailing',
    },
    {
      key: 'fee',
      header: t('tx.fee'),
      type: 'money',
      value: (r) => (r.commission !== null && r.commission !== 0 ? Math.abs(r.commission) : null),
      currency: (r) => r.currency,
      width: 112,
      hideable: true,
      mobile: 'hidden',
    },
  ];
}

export default TransactionsReport;
