// components/domain/reports/sales/SalesReport.tsx — Reports › Sales (finance-analytics §2.1, §2.5, §3, §4, M9 Group C).
//
// "How much am I selling, where, and what?" for every connected store, converted to one display currency (`≈`, with
// the real FX source named: exchangerate-api.com, not TCMB). This is also **Home**: `/app/analytics` and
// `/app/reports` both render this component (founder decision; ReportsPage `REPORT_TAB_PATH.sales = HOME_HREF`).
//
// Data: `useSalesReport` (GET /api/analytics, §6.1) with the shared range (`useReportRange`), the Store filter
// (`stores`, canonical keys), "Show in" (`cur`, TRY/USD/EUR; default TRY or the remembered choice, ₺ / $ / € in the header) and the product
// search (`q`). Everything read-only: nothing here writes to a marketplace.
//
// States (§3): connections unknown → skeleton (never the connect screen) · no store → connect empty state · first
// load → KPI/chart/table skeletons, 15 s "Still loading… Retry", 30 s page error · range change → old data dimmed +
// "Updating…" · error over data → stale line · 0 orders → "No orders in this period" + Show last 90 days (or
// Clear filters when the Store filter excludes everything) · unconverted currencies / stale rates → warning banners.
// Primary (P1): Export CSV. Overflow: Open Orders for this period. Refresh is the meta ⟳ (re-query, our DB).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { SyncMeta, type ActionSpec, type SyncMetaState } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { Bone, KpiSkeleton, TableSkeleton } from '@/components/ds/state/Skeletons';
import type { FilterDef, FilterOption, FilterValues } from '@/components/ds/toolbar/types';
import { icons } from '@/lib/ds/icons';
import { getLogo } from '@/lib/ds/logos';
import { neutral, px, space } from '@/lib/ds/tokens';
import { useAsyncRegion } from '@/lib/ds/useAsyncState';
import { urlField, useUrlState } from '@/lib/ds/useUrlState';
import { useFormatters, type Formatters } from '@/lib/format';
import { useConnections, type ConnectionsMap } from '@/lib/hooks/useConnections';
import { canonicalStore } from '@/lib/marketplaces/canonical';
import { useNavLinks } from '@/lib/nav/links';
import { csvNumber, exportReportCsv, type CsvBlock } from '@/lib/reports/exportCsv';
import { dayKeyToDate, rangeDays, salesCompareWindow } from '@/lib/reports/dateRange';
import {
  SALES_CURRENCIES,
  useSalesReport,
  type SalesCurrency,
  type SalesReport as SalesReportData,
  type SalesStoreMarketplace,
} from '@/lib/reports/useSalesReport';
import { ReportsPage, useComparisonLabel, useReportRange } from '../ReportsPage';
import { DEFAULT_DISPLAY_CURRENCY, resolveDisplayCurrency, useStoredDisplayCurrency } from '../useDisplayCurrency';
import { SalesKpis } from './SalesKpis';
import { SalesTrendChart, type SalesMetric } from './SalesTrendChart';
import { StoreTable, currencySymbol, reportOrdersHref, storeDisplayName } from './StoreTable';
import { TopProductsTable } from './TopProductsTable';
import { StatusSummary } from './StatusSummary';
import WhatsAppHelp from '@/components/support/WhatsAppHelp';

export const SALES_URL_SCHEMA = {
  stores: urlField.list({ format: 'comma' }),
  cur: urlField.optionalEnum(SALES_CURRENCIES),
  q: urlField.string(undefined, { maxLength: 120 }),
};

const STORE_PROVIDERS = ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada'] as const;

/**
 * Pure: the default "Show in" currency = TRY (USABILITY_FINDINGS: "Home defaults to USD — must default to TL").
 * A URL `cur` (shared link) or the seller's remembered choice wins; see `resolveDisplayCurrency`.
 */
export function defaultSalesCurrency(): SalesCurrency {
  return DEFAULT_DISPLAY_CURRENCY;
}

export interface StoreChoice {
  key: string;
  marketplace: SalesStoreMarketplace;
  label: string;
}

/**
 * Pure: Store filter options = connected stores (Etsy: one per connected shop) + every store key seen in the
 * period's data (orders from a disconnected store still count, §4.3). Deduped by key, connected order first.
 */
export function storeChoices(connections: ConnectionsMap | null, seen: StoreChoice[]): StoreChoice[] {
  const out = new Map<string, StoreChoice>();
  if (connections) {
    for (const p of STORE_PROVIDERS) {
      const e = connections[p];
      if (!e?.connected) continue;
      const name = getLogo(p)?.name ?? p;
      if (p === 'etsy' && e.accounts?.length) {
        for (const a of e.accounts) {
          const shop = (a.name ?? '').trim();
          const c = shop ? canonicalStore(shop, [shop]) : { key: 'etsy', marketplace: 'etsy' as const, shopName: null };
          out.set(c.key, { key: c.key, marketplace: 'etsy', label: c.shopName ?? name });
        }
      } else {
        out.set(p, { key: p, marketplace: p, label: name });
      }
    }
  }
  for (const s of seen) if (!out.has(s.key)) out.set(s.key, s);
  return Array.from(out.values());
}

/** Pure: `fx.excluded` currencies (no rate: left out of the totals, not converted). */
export function excludedCurrencies(report: SalesReportData | undefined): string[] {
  return report ? Array.from(new Set(report.fx.excluded.map((x) => x.currency))).sort() : [];
}

/** Pure: currencies (other than the display one) that were converted — the `≈` rule. Excluded currencies are not. */
export function convertedCurrencies(report: SalesReportData | undefined, display: string): string[] {
  if (!report) return [];
  const excluded = new Set(excludedCurrencies(report));
  const set = new Set<string>();
  for (const s of report.stores) {
    for (const c of s.byCurrency) if (c.revenue !== 0 && c.currency !== display && !excluded.has(c.currency)) set.add(c.currency);
  }
  return Array.from(set).sort();
}

/** Pure: the API rejected the range itself (400 `range_too_long` / `invalid_range`): a retry cannot help. */
export function isRangeRejected(error: { status?: number | null } | null | undefined): boolean {
  return error?.status === 400;
}

/** Pure: the Sales CSV (§4.8): stores, top products, series — machine-readable, headers in the UI locale. */
export function salesCsvBlocks(
  report: SalesReportData,
  opts: {
    currency: string;
    t: (key: string, values?: Record<string, string | number>) => string;
    manualLabel: string;
  },
): CsvBlock[] {
  const { t, currency } = opts;
  return [
    {
      title: t('sales.stores.title'),
      header: [t('sales.stores.store'), t('csv.marketplace'), t('sales.stores.orders'), t('sales.stores.units'), t('sales.products.revenue'), t('csv.currency'), t('sales.stores.share'), t('sales.stores.aov')],
      // Share is a fraction: 4 decimals keep the UI's 0.1 % precision (57.14 % → 0.5714, not 0.57).
      rows: report.stores.map((s) => [storeDisplayName(s, opts.manualLabel), s.marketplace, s.orders, s.units, s.revenue, currency, s.share == null ? null : csvNumber(s.share, 4), s.aov]),
    },
    {
      title: t('sales.products.title'),
      header: [t('sales.products.product'), t('csv.sku'), t('sales.products.units'), t('sales.products.revenue'), t('csv.currency')],
      rows: report.products.map((p) => [p.name, p.sku ?? '', p.units, p.revenue, currency]),
    },
    {
      title: t('sales.chart.revenueTitle'),
      header: [t('csv.bucket'), t('sales.chart.metricOrders'), t('sales.chart.metricRevenue'), t('csv.currency'), t('csv.previousOrders'), t('csv.previousRevenue')],
      rows: report.series.map((b, i) => [b.bucketStart, b.orders, b.revenue, currency, report.previousSeries[i]?.orders ?? null, report.previousSeries[i]?.revenue ?? null]),
    },
  ];
}

/** Pure: "≈ converted at exchangerate-api.com rates, 15 Oct 10:00" meta text (null when nothing is converted). */
function fxMetaText(report: SalesReportData | undefined, converted: string[], fmt: Formatters, t: ReturnType<typeof useTranslations>): string | null {
  if (!report || !converted.length) return null;
  return t('meta.fxNote', { source: report.fx.source, date: report.fx.asOf ? fmt.date(report.fx.asOf, 'datetime') : '—' });
}

export interface SalesReportProps {
  /** Tests: fixed clock. */
  now?: Date;
}

export function SalesReport({ now }: SalesReportProps = {}) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const toast = useToast();
  const mobile = useIsMobile();
  const links = useNavLinks();
  const conn = useConnections();
  const range = useReportRange(now);
  const [url, setUrl] = useUrlState(SALES_URL_SCHEMA);
  const [metric, setMetric] = React.useState<SalesMetric>('revenue');

  // Show in: URL `cur` → the remembered choice → TRY. No wait on the settings call (the old sender-profile default
  // showed USD to sellers with a US sender address and delayed the first request).
  const [storedCur, setStoredCur] = useStoredDisplayCurrency();
  const currency: SalesCurrency = resolveDisplayCurrency(url.cur, storedCur);
  const setCurrency = (c: SalesCurrency) => {
    setStoredCur(c);
    if (url.cur) setUrl({ cur: undefined });
  };
  const manualLabel = t('sales.stores.manual');

  // Connections unknown → wait (tri-state rule); errored without data → let the report decide.
  const connKnown = conn.anyMarketplace !== undefined || Boolean(conn.error);
  const enabled = range.ready && connKnown && conn.anyMarketplace !== false;
  const params = React.useMemo(
    () => ({
      from: range.from,
      to: range.to,
      tz: range.tz,
      stores: url.stores,
      currency,
      granularity: range.granularity,
      compare: salesCompareWindow(range.from, range.to, range.preset),
    }),
    [range.from, range.to, range.tz, range.preset, url.stores, currency, range.granularity],
  );
  const report = useSalesReport(params, { enabled });
  const data = report.data;

  const region = useAsyncRegion(
    { data, error: report.error, isLoading: enabled ? report.isLoading || !data : false, isValidating: report.isValidating, mutate: report.mutate },
    { isEmpty: () => false, idle: 'loading' },
  );

  // Store options remember every store seen in this session's responses (a filtered response lists fewer).
  const [seen, setSeen] = React.useState<{ key: string; marketplace: SalesStoreMarketplace; label: string }[]>([]);
  React.useEffect(() => {
    const refs = data ? [...data.availableStores, ...data.stores] : [];
    if (!refs.length) return;
    setSeen((prev) => {
      const map = new Map(prev.map((s) => [s.key, s]));
      let changed = false;
      for (const s of refs) {
        if (!map.has(s.key)) {
          map.set(s.key, { key: s.key, marketplace: s.marketplace, label: storeDisplayName(s, manualLabel) });
          changed = true;
        }
      }
      return changed ? Array.from(map.values()) : prev;
    });
  }, [data, manualLabel]);
  const choices = React.useMemo(() => storeChoices(conn.connections, seen), [conn.connections, seen]);

  const converted = convertedCurrencies(data, currency);
  const excludedCur = excludedCurrencies(data);
  const approx = converted.length > 0;
  const fxNote = data && approx
    ? t('fx.approx', { currencies: converted.join(', '), source: data.fx.source, date: data.fx.asOf ? fmt.date(data.fx.asOf, 'datetime') : '—' })
    : undefined;
  // The API's comparison window wins (it is what the deltas used); the client rule is the same before data arrives.
  const prevRange = data?.previousRange ?? range.previous;
  const previousLabel = fmt.dateRange(dayKeyToDate(prevRange.from), dayKeyToDate(prevRange.to));
  const comparison = useComparisonLabel(prevRange);

  // ── filters ──
  const storeOptions: FilterOption[] = choices.map((c) => ({
    value: c.key,
    label: c.label,
    leading: c.marketplace === 'manual' || c.marketplace === 'other' ? undefined : <LogoTile brand={c.marketplace} size={16} />,
  }));
  const storeFilter: FilterDef = {
    key: 'stores',
    label: t('toolbar.store'),
    type: 'multiselect',
    pinned: true,
    allLabel: t('toolbar.all'),
    options: storeOptions,
    searchable: storeOptions.length > 8,
  };
  // ₺ / $ / € — one tap in the header row (desktop) / meta line (mobile), never inside the Filters drawer.
  const currencySwitch = (
    <SegmentedControl<SalesCurrency>
      value={currency}
      onChange={setCurrency}
      options={SALES_CURRENCIES.map((c) => ({ value: c, label: currencySymbol(c, fmt.intlLocale) }))}
      size="sm"
      aria-label={t('toolbar.showIn')}
      data-testid="sales-currency"
    />
  );
  const filterValues: FilterValues = { stores: url.stores };
  const onFiltersChange = (v: FilterValues) => {
    const stores = Array.isArray(v.stores) ? (v.stores as string[]) : [];
    setUrl({ stores });
  };
  const clearFilters = () => setUrl({ stores: [] });

  // ── actions ──
  const nothing = !data || data.totals.orders === 0;
  const onExport = React.useCallback(() => {
    // Bounded file (stores + top 10 + ≤ ~400 buckets): no row cap, so no confirm (§3's cap is Transactions-only).
    if (!data) return;
    const ok = exportReportCsv('sales', range, salesCsvBlocks(data, {
      currency,
      t: (k, v) => t(k as never, v as never),
      manualLabel,
    }));
    if (!ok) toast.error(t('actions.exportFailed'));
  }, [data, range, currency, t, toast, manualLabel]);
  const exportAction: ActionSpec = {
    id: 'reports-export',
    label: t('actions.exportCsv'),
    icon: icons.download,
    onClick: onExport,
    disabled: nothing,
    disabledReason: nothing ? t('actions.nothingToExport') : undefined,
  };
  const ordersLink = reportOrdersHref({ from: range.from, to: range.to });
  const overflow: ActionSpec[] = [{ id: 'reports-open-orders', label: t('actions.openOrders'), icon: icons.order, href: ordersLink }];

  // ── meta ──
  const syncState: SyncMetaState = report.isValidating ? 'pulling' : report.error && data ? 'failed' : 'idle';
  const fxMeta = fxMetaText(data, converted, fmt, t);
  const storeCount = data ? data.storesIncluded.length || data.stores.length : 0;
  const meta = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', columnGap: px(space[2]), minWidth: 0 }} data-testid="sales-meta">
      <SyncMeta
        source="all"
        lastPulledAt={data?.generatedAt ?? null}
        state={syncState}
        onPull={() => void report.mutate()}
        now={now}
        copy={{
          refreshed: () => t('meta.ordersAsOf', { time: data ? fmt.date(data.generatedAt, 'time') : '—' }),
          refreshing: t('meta.updating'),
          failed: t('error.sales'),
          pullLabel: t('meta.refresh'),
        }}
      />
      {storeCount > 0 ? (
        // Phones: one header line (time + refresh). Store count and the exchange-rate source stay on wider screens;
        // the "≈" on converted amounts still marks conversion.
        <Typography variant="caption" component="span" sx={{ color: neutral[500], display: { xs: 'none', sm: 'inline' } }} data-testid="sales-store-count">
          {t('meta.storeCount', { count: storeCount })}
        </Typography>
      ) : null}
      {fxMeta ? (
        <Tooltip title={fxNote ?? fxMeta}>
          <Typography variant="caption" component="span" sx={{ color: neutral[500], display: { xs: 'none', sm: 'inline' } }} tabIndex={0} data-testid="sales-fx-meta">
            {fxMeta}
          </Typography>
        </Tooltip>
      ) : null}
    </Box>
  );

  // ── banners ──
  const banners: React.ReactNode[] = [];
  if (data?.fx.excluded.length) {
    const count = data.fx.excluded.reduce((s, x) => s + x.orders, 0);
    banners.push(
      <Banner
        key="fx-excluded"
        tone="warning"
        title={t('fx.unconverted', { count, currencies: data.fx.excluded.map((x) => x.currency).join(', ') })}
        data-testid="sales-banner-unconverted"
      />,
    );
  }
  if (data?.fx.stale) {
    banners.push(
      <Banner
        key="fx-stale"
        tone="warning"
        title={t('fx.stale', { date: data.fx.asOf ? fmt.date(data.fx.asOf, 'datetime') : '—' })}
        data-testid="sales-banner-stale-rates"
      />,
    );
  }

  // ── body ──
  const chartHeight = mobile ? 200 : 280;
  const firstLoadSkeleton = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[6]) }} data-testid="sales-loading" aria-busy>
      <KpiSkeleton count={4} />
      <Bone w="100%" h={chartHeight} />
      <TableSkeleton rows={5} />
    </Box>
  );

  let body: React.ReactNode;
  if (!connKnown || !range.ready) {
    body = firstLoadSkeleton;
  } else if (conn.anyMarketplace === false) {
    body = (
      <EmptyState
        kind="first-use"
        icon={icons.connections}
        title={t('empty.connect.title')}
        body={t('empty.connect.body')}
        action={{ id: 'connect-store', label: t('empty.connect.action'), icon: icons.add, href: links.settingsHref('connections') }}
        data-testid="sales-connect"
      >
        <WhatsAppHelp />
      </EmptyState>
    );
  } else if (isRangeRejected(report.error)) {
    // 400 range_too_long / invalid_range: explain the limit; Retry would fail the same way.
    body = (
      <EmptyState
        kind="no-results"
        icon={icons.noResults}
        title={t('error.rangeTooLong')}
        action={{ id: 'show-last-90', label: t('actions.showLast90'), onClick: () => range.setPreset('last90') }}
        data-testid="sales-range-too-long"
      />
    );
  } else if (!data) {
    if (region.state === 'error') {
      body = (
        <ErrorState
          variant="page"
          title={t('error.sales')}
          errorId={report.error?.requestId ?? undefined}
          onRetry={region.retry}
          retrying={report.isValidating}
          data-testid="sales-error"
        />
      );
    } else if (region.state === 'slow') {
      body = (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[4]) }}>
          <SlowState variant="inline" onRetry={region.retry} />
          {firstLoadSkeleton}
        </Box>
      );
    } else {
      body = firstLoadSkeleton;
    }
  } else {
    const updating = report.isPrevious;
    const stale = report.error ? (
      <ErrorState variant="stale" staleSince={new Date(data.generatedAt)} onRetry={region.retry} retrying={report.isValidating} data-testid="sales-stale" />
    ) : null;
    if (data.totals.orders === 0) {
      body = (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[4]) }}>
          {stale}
          {url.stores.length ? (
            <EmptyState
              kind="no-results"
              icon={icons.noResults}
              title={t('empty.noMatch')}
              action={{ id: 'clear-filters', label: t('actions.clearFilters'), onClick: clearFilters }}
              data-testid="sales-empty-filtered"
            />
          ) : (
            <EmptyState
              kind="no-results"
              icon={icons.noResults}
              title={t('empty.noOrders.title')}
              body={t('empty.noOrders.body')}
              action={range.preset === 'last90' || range.days >= 90 ? undefined : { id: 'show-last-90', label: t('actions.showLast90'), onClick: () => range.setPreset('last90') }}
              data-testid="sales-empty"
            />
          )}
        </Box>
      );
    } else {
      body = (
        <Box
          aria-busy={updating || undefined}
          data-updating={updating || undefined}
          sx={{ display: 'flex', flexDirection: 'column', gap: { xs: px(space[4]), md: px(space[6]) }, '& > section': { mb: 0 }, opacity: updating ? 0.6 : 1, transition: 'opacity 120ms linear' }}
        >
          {stale}
          <SalesKpis report={data} loading={false} currency={currency} approx={approx} fxNote={fxNote} periodLabel={comparison.short} periodDetail={comparison.detail} />
          <SalesTrendChart
            series={data.series}
            previousSeries={data.previousSeries}
            granularity={rangeDays(range.from, range.to) <= 1 ? 'hour' : range.granularity}
            granularities={range.granularities}
            onGranularityChange={range.setGranularity}
            rangeTo={range.to}
            previousLabel={previousLabel}
            currency={currency}
            intlLocale={fmt.intlLocale}
            loading={false}
            metric={metric}
            onMetricChange={setMetric}
          />
          <StoreTable
            rows={data.stores}
            currency={currency}
            fxNote={fxNote}
            excludedCurrencies={excludedCur}
            from={range.from}
            to={range.to}
            empty={
              <EmptyState
                kind="no-results"
                icon={icons.noResults}
                title={t('empty.noMatch')}
                action={{ id: 'clear-filters', label: t('actions.clearFilters'), onClick: clearFilters }}
                compact
              />
            }
          />
          <Box
            sx={{
              display: 'grid',
              gap: { xs: px(space[6]), md: px(space[4]) },
              gridTemplateColumns: '1fr',
              '@media (min-width: 1100px)': { gridTemplateColumns: 'minmax(0, 8fr) minmax(0, 4fr)' },
            }}
          >
            <TopProductsTable
              rows={data.products}
              currency={currency}
              approx={approx}
              fxNote={fxNote}
              q={url.q ?? ''}
              onQueryChange={(q) => setUrl({ q: q || undefined })}
            />
            <StatusSummary rows={data.statuses} from={range.from} to={range.to} />
          </Box>
        </Box>
      );
    }
  }

  const noStore = conn.anyMarketplace === false;
  return (
    <ReportsPage
      tab="sales"
      primary={noStore ? undefined : exportAction}
      overflow={noStore ? [] : overflow}
      meta={noStore ? undefined : meta}
      storeFilter={storeFilter}
      headerControl={noStore ? undefined : currencySwitch}
      filterValues={filterValues}
      onFiltersChange={onFiltersChange}
      hideToolbar={noStore}
      banners={banners.length ? banners : undefined}
      mobilePrimary="menu"
      data-testid="sales-report"
    >
      {body}
    </ReportsPage>
  );
}

export default SalesReport;
