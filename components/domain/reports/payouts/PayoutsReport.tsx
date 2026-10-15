// components/domain/reports/payouts/PayoutsReport.tsx — Reports › Payouts (finance-analytics §2.3, §3, §4.1, §6.2;
// M9 Group E). "What reached my bank, and what is still on the marketplace?"
//
// One marketplace at a time in its settlement currency (§1 scope rule): KPI tiles (Paid to bank · Balance on <mp> ·
// Held by eBay when the API reports held funds) · "Payouts over time" (bar, one accent series, value label on the
// tallest bar) · the payouts DataTable. Primary: Export CSV (§4.1); ⋯: Open Transactions (Type: Payout).
//
// Data: `useFinanceReport` (Group D, `/api/finance/dashboard?compare=previous`, same SWR key as Profit, so a tab switch
// is instant) and `useFinanceSync` for the meta ⟳ (§4.1: pull is never a button, except the never-synced empty
// state). Frame, tabs, range, Store filter and the `financials` FeatureGate come from `ReportsPage` (Group C); this
// component never fetches while the feature is locked or the marketplace is unknown / not connected.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { SyncMeta, Section, type ActionSpec } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { KpiTile } from '@/components/ds/data/KpiTile';
import { Chart } from '@/components/ds/data/Chart';
import { DataTable, type Column, type PageSize } from '@/components/ds/data';
import { Money } from '@/components/ds/format/Money';
import { Metric } from '@/components/ds/research/Metric';
import { ConnectState, EmptyState, ErrorState, KpiSkeleton, SlowState, TableSkeleton } from '@/components/ds/state';
import { useToast } from '@/components/ds/feedback';
import { icons } from '@/lib/ds/icons';
import { neutral, px, space, tone } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { settingsHref } from '@/lib/nav/links';
import { useConnections } from '@/lib/hooks/useConnections';
import { useFeatureAccess } from '@/lib/billing/useFeatureAction';
import {
  ReportsPage, reportTabHref, useReportMarketplace, useReportRange, FINANCE_MARKETPLACE_NAME,
  type FinanceMarketplace,
} from '@/components/domain/reports/ReportsPage';
import {
  useFinanceReport, useFinanceSync, isNeverSynced, isFinanceStale, type FinanceDashboard,
} from '@/lib/reports/useFinanceReport';
import { addDays, dayKeyToDate, diffDays, isDayKey, type Granularity } from '@/lib/reports/dateRange';
import { exportReportCsv } from '@/lib/reports/exportCsv';
import type { AsyncState } from '@/lib/ds/useAsyncState';

// ── pure helpers (unit-tested) ──────────────────────────────────────────────────────────────────────────

/** Which body a finance tab renders (§3), in precedence order. */
export type FinanceTabView = 'gated' | 'unknown' | 'notSupported' | 'connect' | 'loading' | 'slow' | 'error' | 'never' | 'ready';

export function financeTabView(i: {
  /** Entitlement locked / paused / neutral / still loading: ReportsPage's FeatureGate draws the body. */
  gated: boolean;
  supported: boolean;
  /** undefined = connections still loading. */
  connected: boolean | undefined;
  async: AsyncState;
  hasData: boolean;
  neverSynced: boolean;
}): FinanceTabView {
  if (i.gated) return 'gated';
  if (!i.supported) return 'notSupported';
  if (i.connected === undefined) return 'unknown';
  if (i.connected === false) return 'connect';
  if (!i.hasData) {
    if (i.async === 'error') return 'error';
    return i.async === 'slow' ? 'slow' : 'loading';
  }
  if (i.neverSynced) return 'never';
  return 'ready';
}

/** Access states in which ReportsPage shows the locked body (or its skeleton) instead of the tab. */
export function isFinanceGated(access: string): boolean {
  return access === 'loading' || access === 'locked' || access === 'paused' || access === 'neutral';
}

/**
 * `connected` for the scope: the Store filter's value, but when the connections endpoint failed (no map, an error)
 * the report renders and the finance API decides (the legacy page's fallback), never an endless skeleton.
 */
export function effectiveConnected(storeConnected: boolean | undefined, conn: { connections: unknown; error?: unknown }): boolean | undefined {
  if (storeConnected !== undefined) return storeConnected;
  return !conn.connections && conn.error ? true : undefined;
}

/** Marketplaces whose balance is an estimate (§2.3 "~" + the existing reserve/approx notes); eBay reports real funds. */
export const BALANCE_NOTE: Partial<Record<FinanceMarketplace, 'etsy' | 'amazon' | 'trendyol'>> = {
  etsy: 'etsy',
  amazon: 'amazon',
  trendyol: 'trendyol',
};

/** Monday-start week key (pure calendar arithmetic). */
function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

function bucketStartOf(day: string, g: Granularity): string {
  if (g === 'week') return weekStart(day);
  if (g === 'month') return `${day.slice(0, 7)}-01`;
  return day;
}

function nextBucket(start: string, g: Granularity): string {
  if (g === 'week') return addDays(start, 7);
  if (g === 'month') {
    const y = Number(start.slice(0, 4));
    const m = Number(start.slice(5, 7));
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  }
  return addDays(start, 1);
}

export interface PayoutBucket {
  start: string;
  amount: number;
}

/**
 * Payouts summed per bucket over the whole range, ascending and zero-filled (B1), so quiet periods stay visible.
 * Hourly is meaningless for payouts and reads as daily. Payouts outside the range are ignored.
 */
export function payoutBuckets(
  disbursements: Array<{ date: string; amount: number }>,
  from: string,
  to: string,
  granularity: Granularity,
): PayoutBucket[] {
  if (!isDayKey(from) || !isDayKey(to) || diffDays(from, to) < 0) return [];
  const g: Granularity = granularity === 'hour' ? 'day' : granularity;
  const sums = new Map<string, number>();
  for (const d of disbursements) {
    const day = d.date.slice(0, 10);
    if (!isDayKey(day) || day < from || day > to) continue;
    const k = bucketStartOf(day, g);
    sums.set(k, Math.round(((sums.get(k) ?? 0) + Math.abs(d.amount)) * 100) / 100);
  }
  const out: PayoutBucket[] = [];
  let guard = 0;
  for (let k = bucketStartOf(from, g); k <= to && guard < 1000; k = nextBucket(k, g), guard += 1) {
    out.push({ start: k, amount: sums.get(k) ?? 0 });
  }
  return out;
}

/** Payout rows newest first (the table order). */
export function payoutRows(disbursements: Array<{ date: string; amount: number }>): Array<{ id: string; date: string; amount: number }> {
  return disbursements
    .map((d, i) => ({ id: `${d.date}-${i}`, date: d.date.slice(0, 10), amount: Math.abs(d.amount) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Sum of ledger rows in the range (for the "N new transactions" toast after a refresh). */
export function ledgerRowCount(d: FinanceDashboard | undefined): number | null {
  if (!d) return null;
  return d.transactionTypeSummary.reduce((n, x) => n + (Number.isFinite(x.count) ? x.count : 0), 0);
}

/** Narrow currency symbol in the UI locale ("$", "₺", "€"); the code when Intl cannot. */
export function currencySymbol(code: string, intlLocale: string): string {
  try {
    const p = new Intl.NumberFormat(intlLocale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    return p.find((x) => x.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

// ── shared pieces (Transactions reuses them) ────────────────────────────────────────────────────────────

export interface FinanceMetaProps {
  mp: FinanceMarketplace;
  lastSyncedAt: string | null | undefined;
  syncState: 'idle' | 'pulling' | 'failed';
  onPull: () => void;
  /** Settlement currency; omitted until the dashboard answered. */
  currency?: string | null;
  updating?: boolean;
}

/** "Refreshed from Etsy 2 h ago ⟳ · Etsy payments ledger · Amounts in $" (§2.2 meta; P6 freshness). */
export function FinanceMeta({ mp, lastSyncedAt, syncState, onPull, currency, updating }: FinanceMetaProps) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const name = FINANCE_MARKETPLACE_NAME[mp];
  const parts: string[] = [t('meta.ledgerSource', { name })];
  if (currency) parts.push(t('meta.amountsIn', { symbol: currencySymbol(currency, fmt.intlLocale) }));
  if (updating && syncState !== 'pulling') parts.push(t('meta.updating'));
  const stale = syncState === 'idle' && isFinanceStale(lastSyncedAt);
  return (
    <Box
      component="span"
      data-testid="finance-meta"
      data-stale={stale || undefined}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: 0, flexWrap: 'wrap', fontSize: 12, lineHeight: '16px', color: neutral[500] }}
    >
      {/* §3: older than 12 h → warning-fg text only (no banner). */}
      <Box component="span" sx={stale ? { '& [data-testid="sync-meta"]': { color: tone.warning.fg } } : undefined}>
        <SyncMeta source={mp} lastPulledAt={lastSyncedAt ?? null} state={syncState} onPull={onPull} />
      </Box>
      {parts.map((p) => (
        <React.Fragment key={p}>
          <Box component="span" aria-hidden>·</Box>
          <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{p}</Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

/** Bodies shared by Payouts and Transactions for the non-data views (§3). */
export function FinanceStateBody({
  view, mp, requested, connectTitleKey, errorTitle, onRetry, onRefresh, refreshing, skeleton,
}: {
  view: Exclude<FinanceTabView, 'ready'>;
  mp: FinanceMarketplace;
  requested?: string;
  connectTitleKey: 'payouts.connect' | 'tx.connect';
  errorTitle: string;
  onRetry: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  skeleton: React.ReactNode;
}) {
  const t = useTranslations('reports');
  const name = FINANCE_MARKETPLACE_NAME[mp];
  switch (view) {
    case 'gated':
      return null; // ReportsPage's FeatureGate renders the locked state / its skeleton
    case 'notSupported':
      return <EmptyState kind="first-use" title={t('finance.notSupported')} data-testid="finance-not-supported" footnote={requested || undefined} />;
    case 'connect':
      return <ConnectState brand={mp} title={t(connectTitleKey, { name })} connectHref={settingsHref('connections', mp)} data-testid="finance-connect" />;
    case 'error':
      return <ErrorState variant="page" title={errorTitle} onRetry={onRetry} data-testid="finance-error" />;
    case 'slow':
      return <SlowState variant="page" onRetry={onRetry} data-testid="finance-slow" />;
    case 'never':
      return (
        <EmptyState
          kind="first-use"
          brand={mp}
          title={t('profit.never.title', { name })}
          body={t('profit.never.body', { name })}
          action={{
            id: 'refresh-ledger',
            label: t('meta.refreshFrom', { name, mp }),
            icon: icons.pull,
            onClick: onRefresh,
            loading: refreshing,
            loadingLabel: t('meta.refreshingFrom', { name, mp }),
          }}
          data-testid="finance-never"
        />
      );
    case 'unknown':
    case 'loading':
    default:
      return <>{skeleton}</>;
  }
}

// ── Payouts ─────────────────────────────────────────────────────────────────────────────────────────────

type PayoutRow = ReturnType<typeof payoutRows>[number];

export interface PayoutsReportProps {
  /** Tests: fixed clock. */
  now?: Date;
}

export function PayoutsReport({ now }: PayoutsReportProps = {}) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const toast = useToast();
  const mobile = useIsMobile();
  const range = useReportRange(now);
  const store = useReportMarketplace();
  const conn = useConnections();
  const { access } = useFeatureAccess('financials');
  const gated = isFinanceGated(access);
  const connected = effectiveConnected(store.connected, conn);
  const mp = store.mp;
  const name = FINANCE_MARKETPLACE_NAME[mp];

  const enabled = !gated && store.supported && connected === true;
  const report = useFinanceReport({ mp, from: range.from, to: range.to, tz: range.tz, enabled });
  const sync = useFinanceSync(enabled ? mp : null, { from: range.from, to: range.to });
  const data = report.data;
  const currency = data?.summary.currency ?? null;

  const view = financeTabView({
    gated,
    supported: store.supported,
    connected,
    async: report.state,
    hasData: Boolean(data),
    neverSynced: data ? isNeverSynced(data) : false,
  });

  // ── refresh (meta ⟳; the never-synced view's one button) ──
  // Delta from a fresh read of the same key after the sync resolves (no armed ref that a later range change
  // could trip). `reportMutate` is captured at press time.
  const reportMutate = report.mutate;
  const onPull = React.useCallback(async () => {
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
  }, [data, sync, reportMutate, toast, t, name, mp]);

  // ── rows, chart ──
  const rows = React.useMemo(() => payoutRows(data?.disbursements ?? []), [data]);
  const buckets = React.useMemo(
    () => payoutBuckets(data?.disbursements ?? [], range.from, range.to, range.granularity),
    [data, range.from, range.to, range.granularity],
  );
  const [pager, setPager] = React.useState<{ page: number; pageSize: PageSize }>({ page: 1, pageSize: 50 });
  React.useEffect(() => setPager((p) => ({ ...p, page: 1 })), [mp, range.from, range.to]);
  const pageRows = rows.slice((pager.page - 1) * pager.pageSize, pager.page * pager.pageSize);

  // ── actions ──
  const onExport = React.useCallback(() => {
    if (!data || !currency) return;
    const ok = exportReportCsv('payouts', range, [
      {
        header: [t('payouts.table.date'), t('payouts.table.amount'), t('payouts.table.currency')],
        rows: rows.map((r) => [r.date, r.amount, currency]),
      },
    ]);
    if (!ok) toast.error(t('actions.exportFailed'));
  }, [data, currency, range, rows, t, toast]);

  const ready = view === 'ready';
  const primary: ActionSpec | undefined = ready
    ? {
        id: 'export-csv',
        label: t('actions.exportCsv'),
        icon: icons.download,
        onClick: onExport,
        disabled: rows.length === 0,
        disabledReason: rows.length === 0 ? t('actions.nothingToExport') : undefined,
      }
    : undefined;
  const overflow: ActionSpec[] = ready
    ? [{ id: 'open-transactions', label: t('actions.openTransactions'), icon: icons.finance, href: reportTabHref('transactions', range.query, { mp, type: 'disbursement' }), paletteGroup: 'goto' }]
    : [];

  const showMeta = enabled && view !== 'never';
  const meta = showMeta ? (
    <FinanceMeta
      mp={mp}
      lastSyncedAt={data?.lastSyncedAt}
      syncState={sync.state}
      onPull={() => void onPull()}
      currency={currency}
      updating={Boolean(data) && report.isValidating}
    />
  ) : null;

  const skeleton = (
    <Box data-testid="payouts-skeleton">
      <KpiSkeleton count={3} />
      <Box sx={{ mt: px(space[6]) }}><TableSkeleton rows={5} /></Box>
    </Box>
  );

  return (
    <ReportsPage
      tab="payouts"
      primary={primary}
      overflow={overflow}
      meta={meta}
      storeFilter={store.filter}
      filterValues={{ mp: store.value }}
      onFiltersChange={(v) => {
        const next = typeof v.mp === 'string' ? v.mp : undefined;
        if (next && next !== store.value && next in FINANCE_MARKETPLACE_NAME) store.setMp(next as FinanceMarketplace);
      }}
      hideToolbar={view === 'never'}
      data-testid="payouts-report"
    >
      {!ready || !data || !currency ? (
        <FinanceStateBody
          view={ready ? 'loading' : view}
          mp={mp}
          requested={store.requested}
          connectTitleKey="payouts.connect"
          errorTitle={t('error.profit', { name })}
          onRetry={report.retry}
          onRefresh={() => void onPull()}
          refreshing={sync.state === 'pulling'}
          skeleton={skeleton}
        />
      ) : (
        <Box
          aria-busy={report.isValidating || undefined}
          sx={{ display: 'flex', flexDirection: 'column', gap: px(space[6]), opacity: report.isValidating ? 0.6 : 1, transition: 'opacity 120ms linear' }}
          data-testid="payouts-body"
        >
          {report.state === 'stale' ? <ErrorState variant="stale" onRetry={report.retry} data-testid="payouts-stale" /> : null}
          <PayoutTiles data={data} mp={mp} currency={currency} />
          {rows.length === 0 ? (
            <EmptyState kind="done" compact title={t('payouts.empty')} data-testid="payouts-empty" />
          ) : (
            <>
              <Section title={t('payouts.chart.title')} flush>
                <Chart
                  type="bar"
                  series={[{ name: t('payouts.kpi.paid'), data: buckets.map((b) => b.amount), role: 'primary' }]}
                  categories={buckets.map((b) => dayKeyToDate(b.start))}
                  format="money"
                  currency={currency}
                  height={mobile ? 200 : 240}
                  directLabel="max"
                  maxSlots={4}
                  actions="table"
                  ariaLabel={`${t('payouts.chart.title')} · ${fmt.dateRange(dayKeyToDate(range.from), dayKeyToDate(range.to))}`}
                  data-testid="payouts-chart"
                />
              </Section>
              <Section title={t('payouts.table.title')} flush>
                <DataTable<PayoutRow>
                  rows={pageRows}
                  columns={payoutColumns(t, currency)}
                  getRowId={(r) => r.id}
                  state="ready"
                  density="standard"
                  columnStateKey="reports.payouts"
                  ariaLabel={t('payouts.table.title')}
                  pagination={{
                    mode: 'pages',
                    page: pager.page,
                    pageSize: pager.pageSize,
                    total: rows.length,
                    onChange: (next) => setPager(next),
                  }}
                  data-testid="payouts-table"
                />
              </Section>
            </>
          )}
        </Box>
      )}
    </ReportsPage>
  );
}

function payoutColumns(t: ReturnType<typeof useTranslations>, currency: string): Column<PayoutRow>[] {
  return [
    { key: 'date', header: t('payouts.table.date'), type: 'date', value: (r) => dayKeyToDate(r.date), mobile: 'title' },
    { key: 'amount', header: t('payouts.table.amount'), type: 'money', value: (r) => r.amount, currency: () => currency, mobile: 'trailing' },
  ];
}

function PayoutTiles({ data, mp, currency }: { data: FinanceDashboard; mp: FinanceMarketplace; currency: string }) {
  const t = useTranslations('reports');
  const name = FINANCE_MARKETPLACE_NAME[mp];
  const s = data.summary;
  // P6: never invent ledger freshness. Without `lastSyncedAt` the time shown is the moment these numbers were
  // read from our API (stable per response), and the source says the ledger was not refreshed from {name}.
  // KpiTile requires `asOf`; an optional as-of is a DS need (outOfScopeNeeds).
  const readAt = React.useMemo(() => new Date(), [data]);
  const asOf = data.lastSyncedAt ? new Date(data.lastSyncedAt) : readAt;
  const source = data.lastSyncedAt ? t('meta.ledgerSource', { name }) : t('meta.ledgerSourceNotRefreshed', { name });
  const balanceCurrency = s.balanceCurrency || currency;
  const note = BALANCE_NOTE[mp];
  const showHeld = s.heldFunds !== null;

  const balanceValue = s.currentBalance === null ? (
    <Metric value={null} kind="measured" size="display" guard={{ ok: false, reason: t('payouts.kpi.noBalance', { name }) }} data-testid="payouts-balance-none" />
  ) : note ? (
    <Metric
      value={<Money amount={s.currentBalance} currency={balanceCurrency} compact={Math.abs(s.currentBalance) >= 100_000} />}
      kind="estimate"
      size="display"
      tooltip={t(`payouts.balanceNote.${note}`)}
      data-testid="payouts-balance-estimate"
    />
  ) : (
    <Money amount={s.currentBalance} currency={balanceCurrency} compact={Math.abs(s.currentBalance) >= 100_000} />
  );

  return (
    <Box
      sx={{
        display: 'grid',
        gap: px(space[4]),
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
      }}
      data-testid="payouts-kpis"
    >
      <KpiTile
        label={t('payouts.kpi.paid')}
        value={<Money amount={s.banked} currency={currency} compact={Math.abs(s.banked) >= 100_000} />}
        caption={t('payouts.kpi.count', { count: s.disbursementCount })}
        source={source}
        asOf={asOf}
        data-testid="payouts-kpi-paid"
      />
      <KpiTile
        label={t('payouts.kpi.balance', { name })}
        value={balanceValue}
        caption={t('payouts.kpi.balanceHint')}
        source={source}
        asOf={asOf}
        data-testid="payouts-kpi-balance"
      />
      {showHeld ? (
        <KpiTile
          label={t('payouts.kpi.held', { name })}
          value={<Money amount={s.heldFunds} currency={balanceCurrency} compact={Math.abs(s.heldFunds ?? 0) >= 100_000} />}
          caption={t('payouts.kpi.heldHint')}
          source={source}
          asOf={asOf}
          data-testid="payouts-kpi-held"
        />
      ) : null}
    </Box>
  );
}

export default PayoutsReport;
