// components/domain/reports/profit/ProfitReport.tsx — Reports › Profit (finance-analytics §2.2, §3, §4.1, §4.6;
// M9 group D). One marketplace at a time, in its own settlement currency (§1 scope rule: never summed across
// currencies). Renders inside the shared `ReportsPage` frame (group C), which owns the date range, the tabs, the
// `financials` FeatureGate around this body and hides the header actions on a locked tab.
//
// Body by state (§3, `profitView`): not supported (Wix/Shopify/Hepsiburada deep link) · connect · skeleton ·
// page error · never synced ("Get your Etsy payments" + [Refresh from Etsy], the only action; no header primary) ·
// empty range ([Show last 90 days]) · ready (banners, 4 KPIs, P&L + trend chart side by side ≥ 1200, product table).
// Primary (§4.1): "Add product costs" while costs are missing (Export CSV becomes the secondary), else "Export CSV".
// Overflow: Manage product costs · Open Transactions. Mobile: the primary sits in the StickyActionBar.
// Pull is never a button outside the never-synced state: the meta ⟳ runs the ledger sync and a toast appears only
// when something new arrived (the ledger row count went up; the sync's `totalUpserted` also counts rows already
// stored). The delta label names the window the server compared against (`previous.from/to`). Product costs are KolayXport data (no marketplace write), so they save directly.
import { useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { ReportsPage, useComparisonLabel } from '@/components/domain/reports/ReportsPage';
import { SyncMeta } from '@/components/ds/page/SyncMeta';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { KpiSkeleton, TableSkeleton, Bone } from '@/components/ds/state/Skeletons';
import { SlowState } from '@/components/ds/state/SlowState';
import type { ActionSpec } from '@/components/ds/types/actions';
import type { FilterValues } from '@/components/ds/toolbar/types';
import { useFeatureAccess } from '@/lib/billing/useFeatureAction';
import { useConnections } from '@/lib/hooks/useConnections';
import { icons } from '@/lib/ds/icons';
import { getLogo } from '@/lib/ds/logos';
import { neutral as n, tone, px, space } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { exportReportCsv } from '@/lib/reports/exportCsv';
import { dayKeyToDate } from '@/lib/reports/dateRange';
import {
  FINANCE_MARKETPLACES, isFinanceStale, ledgerRowCount, profitCsvBlocks, profitPrimary, profitView, useFinanceReport, useFinanceScope,
  useFinanceSync, type FinanceDashboard, type FinanceMarketplace, type FinanceProductRow,
} from '@/lib/reports/useFinanceReport';
import { ProfitKpis } from './ProfitKpis';
import { ProfitStatement, useStatementLabel } from './ProfitStatement';
import { ProfitTrendChart } from './ProfitTrendChart';
import { ProductPnLTable } from './ProductPnLTable';
import { ProductCostsPanel, type CostsPanelProduct } from './ProductCostsPanel';

export const CONNECT_HREF = '/ayarlar?tab=connections';

/** Narrow currency symbol for the "amounts in $" meta ("$", "₺", "€"); the ISO code when Intl has none. */
export function currencySymbol(currency: string, intlLocale: string): string {
  try {
    const part = new Intl.NumberFormat(intlLocale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value || currency;
  } catch {
    return currency;
  }
}

function ProfitSkeleton() {
  return (
    <Box data-testid="profit-skeleton" sx={{ display: 'flex', flexDirection: 'column', gap: px(space[4]) }}>
      <KpiSkeleton count={4} />
      <Bone w="100%" h={280} r={8} />
      <TableSkeleton rows={5} columns={6} />
    </Box>
  );
}

export interface ProfitReportProps {
  /** Tests: fixed clock for the range and the staleness rule. */
  now?: Date;
}

export function ProfitReport({ now }: ProfitReportProps = {}) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const toast = useToast();
  const scope = useFinanceScope(now);
  const conn = useConnections();
  const { access } = useFeatureAccess('financials');
  const gated = access === 'locked' || access === 'paused' || access === 'neutral';
  const mp: FinanceMarketplace = scope.mp;
  const name = getLogo(mp)?.name ?? mp;
  // Connections that failed to load never block the report (the server decides); unknown while loading.
  const connected = scope.connected ?? (conn.error ? true : undefined);

  const report = useFinanceReport({
    mp,
    from: scope.from,
    to: scope.to,
    tz: scope.tz,
    granularity: scope.granularity,
    enabled: !gated && access !== 'loading' && scope.supported && connected === true,
  });
  const sync = useFinanceSync(mp, { from: scope.from, to: scope.to });
  const data = report.data;
  const view = profitView({ gated, accessLoading: access === 'loading', supported: scope.supported, connected, async: report.state, data });
  const [panel, setPanel] = useState<{ open: boolean; product: CostsPanelProduct | null }>({ open: false, product: null });
  const statementLabel = useStatementLabel();

  const ledger = t('meta.ledgerSource', { name });
  // The server's comparison window (same day count ending the day before `from`), not the client's calendar rule:
  // the label must name the days the deltas were computed from. Client window only when the API does not say.
  const prev = data?.previousWindow ?? scope.previous;
  const comparison = useComparisonLabel(prev);
  const busy = report.isValidating && Boolean(data);

  // "N new transactions" = ledger rows after − before, from a fresh read of the same key (`totalUpserted` counts
  // re-upserted rows too). `reportMutate` is captured at press time, so a scope change mid-sync compares like with like.
  const reportMutate = report.mutate;
  const pull = async () => {
    const before = ledgerRowCount(data);
    const res = await sync.run();
    if (res === null) {
      toast.error(t('error.refresh', { name, mp }));
      return;
    }
    if (before === null) return;
    const fresh = (await reportMutate().catch(() => undefined)) as FinanceDashboard | undefined;
    const added = (ledgerRowCount(fresh) ?? before) - before;
    if (added > 0) toast.info(t('toast.newTransactions', { count: added, name, mp }));
  };

  const openPanel = (row?: FinanceProductRow | null) =>
    setPanel({ open: true, product: row ? { productName: row.productName, barcode: row.barcode, sku: row.sku } : null });

  const exportCsv = () => {
    if (!data) return;
    const ok = exportReportCsv('profit', { from: scope.from, to: scope.to }, profitCsvBlocks(data, {
      statementTitle: t('profit.statement.title'),
      productsTitle: t('profit.products.title'),
      line: t('profit.statement.title'),
      amount: t('tx.amount'),
      share: t('profit.statement.share'),
      currency: t('costs.field.currency'),
      product: t('profit.products.product'),
      code: t('costs.field.code'),
      sold: t('profit.products.sold'),
      returned: t('profit.products.returnedHeader'),
      revenue: t('profit.products.revenue'),
      fees: t('profit.products.fees'),
      shipping: t('profit.products.shipping'),
      unitCost: t('profit.products.unitCost'),
      profit: t('profit.products.profit'),
      margin: t('profit.products.margin'),
      lineLabel: (k) => statementLabel(k),
    }));
    if (!ok) toast.error(t('actions.exportFailed'));
  };

  // ── header actions (§4.1) ──
  const primaryKind = view === 'ready' ? profitPrimary(data) : null;
  const exportAction: ActionSpec = { id: 'export-csv', label: t('actions.exportCsv'), icon: icons.download, onClick: exportCsv };
  const addCostsAction: ActionSpec = { id: 'add-costs', label: t('actions.addCosts'), icon: icons.add, onClick: () => openPanel() };
  const primary = primaryKind === 'addCosts' ? addCostsAction : primaryKind === 'export' ? exportAction : undefined;
  const secondary = primaryKind === 'addCosts' ? [exportAction] : undefined;
  const transactionsHref = `/app/reports/transactions?${new URLSearchParams({ mp, from: scope.from, to: scope.to })}`;
  const overflow: ActionSpec[] | undefined = view === 'ready' || view === 'empty'
    ? [
        { id: 'manage-costs', label: t('actions.manageCosts'), onClick: () => openPanel() },
        { id: 'open-transactions', label: t('actions.openTransactions'), href: transactionsHref },
      ]
    : undefined;

  // ── meta: Refreshed from Etsy 2 h ago ⟳ · Etsy payments ledger · amounts in $ ──
  const stale = isFinanceStale(data?.lastSyncedAt, now);
  const showMeta = view === 'ready' || view === 'empty' || view === 'never' || view === 'loading' || view === 'error';
  const meta = showMeta ? (
    <Box
      component="span"
      data-testid="profit-meta"
      data-stale={stale ? 'true' : undefined}
      sx={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', fontSize: 12, lineHeight: '16px', color: n[500], minWidth: 0, ...(stale ? { '& [data-testid="sync-meta"]': { color: tone.warning.fg } } : {}) }}
    >
      <SyncMeta source={mp} lastPulledAt={data?.lastSyncedAt ?? null} state={sync.state} onPull={() => { void pull(); }} now={now} />
      {busy && sync.state !== 'pulling' ? (
        <>
          <span aria-hidden>·</span>
          <span data-testid="profit-meta-updating">{t('meta.updating')}</span>
        </>
      ) : null}
      <span aria-hidden>·</span>
      <span>{ledger}</span>
      {data ? (
        <>
          <span aria-hidden>·</span>
          <span>{t('meta.amountsIn', { symbol: currencySymbol(data.summary.currency, fmt.intlLocale) })}</span>
        </>
      ) : null}
    </Box>
  ) : (
    <span />
  );

  // ── banners (§3) ──
  let banners: ReactNode = null;
  if (view === 'ready' && data) {
    const cov = data.costCoverage;
    const s = data.summary;
    const pendingParts = [
      s.pendingSettlementCount > 0 ? t('profit.banner.pending', { count: s.pendingSettlementCount, name }) : null,
      s.pendingCancellationCount > 0 ? t('profit.banner.cancelPending', { count: s.pendingCancellationCount }) : null,
    ].filter(Boolean) as string[];
    banners = (
      <>
        {cov.productsWithoutCost > 0 ? (
          <Banner
            tone="warning"
            title={t('profit.banner.costMissing', { count: cov.productsWithoutCost, total: cov.products })}
            action={{ id: 'banner-add-costs', label: t('actions.addCosts'), onClick: () => openPanel() }}
            data-testid="profit-banner-cost"
          />
        ) : null}
        {pendingParts.length ? (
          <Banner
            tone="info"
            title={pendingParts.join(' ')}
            dismissKey={`reports.profit.pending.${mp}.${scope.from}.${scope.to}`}
            data-testid="profit-banner-pending"
          />
        ) : null}
      </>
    );
    if (!cov.productsWithoutCost && !pendingParts.length) banners = null;
  }

  // ── body ──
  let body: ReactNode;
  switch (view) {
    case 'gated':
      body = null; // ReportsPage's FeatureGate renders the locked state
      break;
    case 'unknown':
    case 'loading':
      body = <ProfitSkeleton />;
      break;
    case 'slow':
      body = (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[3]) }}>
          <SlowState onRetry={report.retry} />
          <ProfitSkeleton />
        </Box>
      );
      break;
    case 'notSupported':
      body = <EmptyState kind="first-use" icon={icons.finance} title={t('profit.notSupported')} data-testid="profit-not-supported" />;
      break;
    case 'connect':
      body = <ConnectState brand={mp} title={t('profit.connect', { name })} connectHref={CONNECT_HREF} data-testid="profit-connect" />;
      break;
    case 'error':
      body = <ErrorState variant="page" title={t('error.profit', { name })} onRetry={report.retry} data-testid="profit-error" />;
      break;
    case 'never':
      body = (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[3]) }}>
          {sync.state === 'failed' ? (
            <ErrorState variant="inline" title={t('error.refresh', { name, mp })} onRetry={() => { void pull(); }} data-testid="profit-sync-error" />
          ) : null}
          <EmptyState
            kind="first-use"
            brand={mp}
            title={t('profit.never.title', { name })}
            body={t('profit.never.body', { name })}
            action={{
              id: 'refresh-ledger',
              label: t('meta.refreshFrom', { name, mp }),
              icon: icons.pull,
              onClick: () => { void pull(); },
              loading: sync.state === 'pulling',
              loadingLabel: t('meta.refreshingFrom', { name, mp }),
            }}
            data-testid="profit-never"
          />
        </Box>
      );
      break;
    case 'empty':
      body = (
        <EmptyState
          kind="no-results"
          title={t('profit.empty')}
          action={scope.preset === 'last90' ? undefined : { id: 'last-90', label: t('actions.showLast90'), onClick: () => scope.setPreset('last90') }}
          data-testid="profit-empty"
        />
      );
      break;
    case 'ready':
    default:
      body = data ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: px(space[4]), md: px(space[6]) }, '& > section': { mb: 0 } }} data-testid="profit-body">
          {report.state === 'stale' ? (
            <ErrorState
              variant="stale"
              title={t('error.profit', { name })}
              staleSince={data.lastSyncedAt ? new Date(data.lastSyncedAt) : undefined}
              onRetry={report.retry}
            />
          ) : null}
          <ProfitKpis data={data} period={comparison.short} periodDetail={comparison.detail} loading={busy} />
          <Box sx={{ display: 'grid', gap: px(space[4]), gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1fr) minmax(0,1fr)' } }}>
            <ProfitStatement data={data} loading={busy} />
            <ProfitTrendChart
              data={data}
              granularity={scope.granularity}
              options={scope.granularityOptions}
              onGranularityChange={scope.setGranularity}
              loading={busy}
            />
          </Box>
          <ProductPnLTable
            key={`${mp}:${scope.from}:${scope.to}`}
            data={data}
            mp={mp}
            mpName={name}
            loading={busy}
            onSaved={() => { void report.mutate(); }}
            onAddCost={openPanel}
            onRetry={report.retry}
          />
        </Box>
      ) : <ProfitSkeleton />;
  }

  const filterValues: FilterValues = { [scope.storeFilter.key]: scope.storeValue };
  const onFiltersChange = (v: FilterValues) => {
    const next = v[scope.storeFilter.key];
    if (typeof next === 'string' && (FINANCE_MARKETPLACES as readonly string[]).includes(next)) scope.setMp(next as FinanceMarketplace);
  };

  return (
    <ReportsPage
      tab="profit"
      primary={primary}
      secondary={secondary}
      overflow={overflow}
      meta={meta}
      storeFilter={scope.storeFilter}
      filterValues={filterValues}
      onFiltersChange={onFiltersChange}
      banners={banners}
      mobilePrimary={primaryKind === 'addCosts' ? 'sticky' : 'menu'}
      data-testid="reports-profit"
    >
      {body}
      {data && !gated ? (
        <ProductCostsPanel
          open={panel.open}
          onClose={() => setPanel({ open: false, product: null })}
          mp={mp}
          mpName={name}
          currency={data.summary.currency}
          initialProduct={panel.product}
          onSaved={() => { void report.mutate(); }}
        />
      ) : null}
    </ReportsPage>
  );
}

export default ProfitReport;
