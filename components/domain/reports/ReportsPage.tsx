// components/domain/reports/ReportsPage.tsx — finance-analytics §1, §2, §4.1–§4.3 (M9 Group C): the one frame every
// Reports tab renders in. Page (detail 1280) · PageHeader (title "Reports", tab meta, one primary, ⋯) · route Tabs
// (Sales · Profit · Payouts · Transactions) · one Toolbar row (DateRangeField first, then the tab's filters) · the
// tab body. Tabs D (Profit) and E (Payouts, Transactions) render inside it with the props published in §10:
//   { tab; title?; primary?; secondary?; overflow?; meta; toolbarExtra?; children }
// plus optional `storeFilter`, `filterValues`/`onFiltersChange`, `toolbarTrailing`, `resultCount`/`resultLabel`,
// `banners`, `mobilePrimary` (documented on the props).
//
// Founder decision (BUILD_PLAN M9, "analytics is Home"): Home stays `/app/analytics` (`HOME_HREF`), and Home *is* the
// Reports overview: `/app/analytics` (pages/app/analytics.tsx) and `/app/reports` render the same Sales
// report, and the Sales tab links Home (`SALES_TAB_PATH = HOME_HREF`). The nav has no separate Reports row: the
// Home row is active on every `/app/reports/*` tab (lib/nav/useNavModel.ts). Profit/Payouts/Transactions live under
// `/app/reports/*`.
//
// Shared URL state (§1): `from`, `to` (YYYY-MM-DD in the seller timezone), `preset`, `g` (granularity override).
// The tab links carry `from`/`to`/`preset`, so the range survives a tab switch, Back works and links are shareable.
//
// Pro gating (pro-gating §2, D-P1): Profit, Payouts and Transactions are the `financials` feature. A Stripe account
// without it sees the tabs (the gated body renders the locked state through `FeatureGate`); a neutral account
// (shopify_free / stripeUpsell false) never sees those tabs — with Sales alone left, no Tabs row is drawn. On a
// locked tab the header actions and the toolbar are not rendered (P1: nothing that cannot do anything).
import * as React from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Page, PageHeader, type ActionSpec } from '@/components/ds/page';
import { Tabs, type TabDef } from '@/components/ds/inputs/Tabs';
import { DateRangeField, type DateRangeValue, type PresetKey } from '@/components/ds/inputs/DateRangeField';
import { Toolbar } from '@/components/ds/toolbar/Toolbar';
import type { FilterDef, FilterOption, FilterValues } from '@/components/ds/toolbar/types';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { FeatureGate } from '@/components/domain/billing/FeatureGate';
import { useFeatureAccess } from '@/lib/billing/useFeatureAction';
import { isTabGated } from '@/lib/billing/featureMap';
import { urlField, useUrlState, type UrlQuery } from '@/lib/ds/useUrlState';
import { useFormatters } from '@/lib/format';
import { control, neutral, px, space } from '@/lib/ds/tokens';
import { HOME_HREF } from '@/lib/nav/navConfig';
import { useConnections } from '@/lib/hooks/useConnections';
import { useIsMobile } from '@/components/ds/page/useViewport';
import {
  DEFAULT_REPORT_PRESET,
  GRANULARITIES,
  REPORT_PRESETS,
  dayToPickerDate,
  effectiveGranularity,
  pickerDateToDay,
  previousWindow,
  dayKeyToDate,
  rangeDays,
  resolveReportRange,
  validGranularities,
  type DayKey,
  type DayRange,
  type Granularity,
  type ReportPreset,
} from '@/lib/reports/dateRange';

// ── tabs and routes ─────────────────────────────────────────────────────────────────────────────────────

export type ReportTab = 'sales' | 'profit' | 'payouts' | 'transactions';
export const REPORT_TABS: readonly ReportTab[] = ['sales', 'profit', 'payouts', 'transactions'];

/** The Reports hub route that also renders Sales (spec §0.3 `/app/reports`). */
export const REPORTS_INDEX_PATH = '/app/reports';

/** The Sales tab's href: Home (`/app/analytics`), which renders `SalesReport`. */
export const SALES_TAB_PATH: string = HOME_HREF;

/** Canonical path per tab. Sales = Home in the end state (founder decision; see `SALES_TAB_PATH`). */
export const REPORT_TAB_PATH: Record<ReportTab, string> = {
  sales: SALES_TAB_PATH,
  profit: '/app/reports/profit',
  payouts: '/app/reports/payouts',
  transactions: '/app/reports/transactions',
};

/** Keys a tab switch keeps (§1). */
export const SHARED_RANGE_KEYS = ['from', 'to', 'preset'] as const;

/** Pure: the href of a tab with the shared range query (and optional extra pairs, e.g. `mp`, `type`). */
export function reportTabHref(tab: ReportTab, query: UrlQuery = {}, extra: Record<string, string | undefined> = {}): string {
  const sp = new URLSearchParams();
  for (const k of SHARED_RANGE_KEYS) {
    const v = query[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s) sp.set(k, s);
  }
  for (const [k, v] of Object.entries(extra)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${REPORT_TAB_PATH[tab]}?${qs}` : REPORT_TAB_PATH[tab];
}

// ── shared range state ──────────────────────────────────────────────────────────────────────────────────

export const REPORT_RANGE_SCHEMA = {
  from: urlField.date(),
  to: urlField.date(),
  preset: urlField.optionalEnum(REPORT_PRESETS),
  g: urlField.optionalEnum(GRANULARITIES),
};

export interface ReportRange extends DayRange {
  /** False until the router has parsed the query (the range is the default until then). */
  ready: boolean;
  preset: ReportPreset;
  /** Seller timezone (IANA). */
  tz: string;
  days: number;
  /** The comparison window (§4.2). */
  previous: DayRange;
  /** Effective granularity (URL `g` when valid, else automatic). */
  granularity: Granularity;
  /** Options for the granularity control (one = hide the control). */
  granularities: Granularity[];
  /** The DateRangeField value. */
  pickerValue: DateRangeValue;
  /** Apply a DateRangeField change (named presets are recomputed in the seller timezone). */
  setPickerValue: (v: DateRangeValue) => void;
  setPreset: (p: Exclude<ReportPreset, 'custom'>) => void;
  setDays: (from: DayKey, to: DayKey) => void;
  setGranularity: (g: Granularity) => void;
  /** The current query (for `reportTabHref`). */
  query: UrlQuery;
}

/** Shared date range of every tab (one instance per consumer; all read the same URL). */
export function useReportRange(now?: Date): ReportRange {
  const router = useRouter();
  const fmt = useFormatters();
  const tz = fmt.timeZone;
  const [url, setUrl, helpers] = useUrlState(REPORT_RANGE_SCHEMA);
  const nowKey = now ? now.getTime() : null;
  const resolved = React.useMemo(
    () => resolveReportRange({ from: url.from, to: url.to, preset: url.preset }, tz, nowKey == null ? new Date() : new Date(nowKey)),
    [url.from, url.to, url.preset, tz, nowKey],
  );
  const granularity = effectiveGranularity(resolved.from, resolved.to, url.g);
  const granularities = validGranularities(resolved.from, resolved.to);

  const setPreset = React.useCallback(
    (p: Exclude<ReportPreset, 'custom'>) => setUrl({ preset: p === DEFAULT_REPORT_PRESET ? undefined : p, from: undefined, to: undefined, g: undefined }),
    [setUrl],
  );
  const setDays = React.useCallback(
    (from: DayKey, to: DayKey) => setUrl({ preset: 'custom', from, to, g: undefined }),
    [setUrl],
  );
  const setPickerValue = React.useCallback(
    (v: DateRangeValue) => {
      if (v.preset && v.preset !== 'custom' && (REPORT_PRESETS as readonly string[]).includes(v.preset)) {
        setPreset(v.preset as Exclude<ReportPreset, 'custom'>);
        return;
      }
      if (v.from) setDays(pickerDateToDay(v.from), pickerDateToDay(v.to ?? v.from));
    },
    [setPreset, setDays],
  );
  const setGranularity = React.useCallback(
    (g: Granularity) => setUrl({ g: g === effectiveGranularity(resolved.from, resolved.to, null) ? undefined : g }),
    [setUrl, resolved.from, resolved.to],
  );

  return {
    ready: helpers.ready,
    from: resolved.from,
    to: resolved.to,
    preset: resolved.preset,
    tz,
    days: rangeDays(resolved.from, resolved.to),
    previous: previousWindow(resolved.from, resolved.to, resolved.preset),
    granularity,
    granularities,
    pickerValue: { from: dayToPickerDate(resolved.from), to: dayToPickerDate(resolved.to), preset: resolved.preset as PresetKey },
    setPickerValue,
    setPreset,
    setDays,
    setGranularity,
    query: (router?.query ?? {}) as UrlQuery,
  };
}

// ── finance marketplace scope (Profit, Payouts, Transactions; §1 scope rule, §4.3) ─────────────────────

export const FINANCE_MARKETPLACES = ['etsy', 'ebay', 'amazon', 'trendyol'] as const;
export type FinanceMarketplace = (typeof FINANCE_MARKETPLACES)[number];
export const FINANCE_MARKETPLACE_NAME: Record<FinanceMarketplace, string> = { etsy: 'Etsy', ebay: 'eBay', amazon: 'Amazon', trendyol: 'Trendyol' };

const MP_SCHEMA = { mp: urlField.string(undefined, { maxLength: 32 }) };

/** Pure: URL `mp` when it is a finance marketplace, else the first connected one (Etsy → eBay → Amazon → Trendyol), else Etsy. */
export function resolveFinanceMarketplace(
  urlMp: string | null | undefined,
  connected: Partial<Record<FinanceMarketplace, boolean | undefined>>,
): { mp: FinanceMarketplace; supported: boolean } {
  const v = (urlMp ?? '').toLowerCase();
  if ((FINANCE_MARKETPLACES as readonly string[]).includes(v)) return { mp: v as FinanceMarketplace, supported: true };
  const first = FINANCE_MARKETPLACES.find((m) => connected[m]);
  // A deep link to Wix/Shopify/Hepsiburada is "not supported" (§3), not silently another marketplace.
  return { mp: first ?? 'etsy', supported: !v };
}

export interface ReportMarketplace {
  mp: FinanceMarketplace;
  /** false when the URL names a marketplace without finance data (§3 "Profit reports are available for …"). */
  supported: boolean;
  /** The raw URL value (for the not-supported message). */
  requested: string | undefined;
  connected: boolean | undefined;
  setMp: (mp: FinanceMarketplace) => void;
  /** The single-select "Store" FilterDef for `ReportsPage.storeFilter` (value key `mp`). */
  filter: FilterDef;
  /** `filterValues` entry for the filter. */
  value: string;
}

/** Profit / Payouts / Transactions store scope (one marketplace at a time, URL `mp`). */
export function useReportMarketplace(): ReportMarketplace {
  const t = useTranslations('reports');
  const conn = useConnections();
  const [url, setUrl] = useUrlState(MP_SCHEMA);
  const connected = React.useMemo(
    () => Object.fromEntries(FINANCE_MARKETPLACES.map((m) => [m, conn.has(m)])) as Partial<Record<FinanceMarketplace, boolean | undefined>>,
    [conn],
  );
  const { mp, supported } = resolveFinanceMarketplace(url.mp, connected);
  // Only this seller's connected stores (plus the one in the URL), never every marketplace we support.
  const options: FilterOption[] = FINANCE_MARKETPLACES.filter((m) => connected[m] !== false || m === mp).map((m) => ({
    value: m,
    label: connected[m] === false ? t('toolbar.notConnected', { name: FINANCE_MARKETPLACE_NAME[m] }) : FINANCE_MARKETPLACE_NAME[m],
    leading: <LogoTile brand={m} size={16} />,
  }));
  const setMp = React.useCallback((m: FinanceMarketplace) => setUrl({ mp: m }), [setUrl]);
  return {
    mp,
    supported,
    requested: url.mp,
    connected: connected[mp],
    setMp,
    filter: { key: 'mp', label: t('toolbar.store'), type: 'select', pinned: true, options, allLabel: FINANCE_MARKETPLACE_NAME[mp] },
    value: mp,
  };
}

// ── comparison label (KPI tiles) ────────────────────────────────────────────────────────────────────

/**
 * Short comparison for KPI tiles ("önceki 30 güne göre") + the exact window for the tooltip ("18 Ağu – 16 Eyl
 * 2026"). The long "{range} dönemine göre" wrapped into 3 lines on a 2-column mobile grid.
 */
export function useComparisonLabel(previous: DayRange): { short: string; detail: string } {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  return {
    short: t('delta.vsPreviousDays', { days: rangeDays(previous.from, previous.to) }),
    detail: fmt.dateRange(dayKeyToDate(previous.from), dayKeyToDate(previous.to)),
  };
}

// ── the frame ───────────────────────────────────────────────────────────────────────────────────────────

export interface ReportsPageProps {
  tab: ReportTab;
  /** Default "Home" / "Ana sayfa" (the nav label: Home *is* the Reports overview). */
  title?: string;
  /** The tab's one primary (§4.1). */
  primary?: ActionSpec;
  /** ≤ 2 (Profit: Export CSV while the primary is "Add product costs"). */
  secondary?: ActionSpec[];
  overflow?: ActionSpec[];
  /** Freshness line for the tab (SyncMeta / "Orders as of 10:42 ⟳ · ≈ converted …"). */
  meta: React.ReactNode;
  /** The scope's Store filter, drawn first after the date range (Sales multiselect `stores`, finance single `mp`). */
  storeFilter?: FilterDef;
  /** Tab-specific filters after Store (Sales "Show in", Transactions "Type"). */
  toolbarExtra?: FilterDef[];
  /** Values of `storeFilter` + `toolbarExtra` by key (controlled; the tab owns their URL state). */
  filterValues?: FilterValues;
  onFiltersChange?: (values: FilterValues) => void;
  /** Extra controls at the end of the toolbar row. */
  toolbarTrailing?: React.ReactNode;
  /** Right side of the toolbar (Transactions only). */
  resultCount?: number;
  resultLabel?: string;
  /** Banners between the toolbar and the body (cost missing, FX, pending settlements). */
  banners?: React.ReactNode;
  /** Mobile placement of the primary (default: 'menu' — Sales has no state-driven primary; Profit passes 'sticky'). */
  mobilePrimary?: 'sticky' | 'menu' | 'none';
  /** Hide the toolbar (e.g. a never-synced empty state). */
  hideToolbar?: boolean;
  /**
   * One compact control that must stay one tap away (Home's ₺ / $ / € switch): in the header title row on desktop,
   * at the end of the meta line on mobile (the shell owns the mobile title row). Never inside the Filters drawer.
   */
  headerControl?: React.ReactNode;
  children: React.ReactNode;
  'data-testid'?: string;
}

export function ReportsPage({
  tab,
  title,
  primary,
  secondary,
  overflow,
  meta,
  storeFilter,
  toolbarExtra = [],
  filterValues = {},
  onFiltersChange,
  toolbarTrailing,
  resultCount,
  resultLabel,
  banners,
  mobilePrimary = 'menu',
  hideToolbar = false,
  headerControl,
  children,
  'data-testid': testId = 'reports-page',
}: ReportsPageProps) {
  const t = useTranslations('reports');
  const range = useReportRange();
  const mobile = useIsMobile();
  const { access } = useFeatureAccess('financials');
  const feature = isTabGated(tab);
  const blocked = Boolean(feature) && (access === 'locked' || access === 'paused' || access === 'neutral');

  // Gated tabs: never shown to a neutral account (shopify_free / stripeUpsell false, pro-gating §2), and not while
  // the entitlement is loading (no flash of tabs such an account must not see) — except the tab being viewed.
  // `unknown` shows them (the server decides). With Sales alone left, no Tabs row is drawn.
  const visibleTabs = REPORT_TABS.filter((k) => !isTabGated(k) || (access !== 'neutral' && (access !== 'loading' || k === tab)));
  const tabDefs: TabDef<ReportTab>[] = visibleTabs.map((k) => ({ value: k, label: t(`tabs.${k}`), href: reportTabHref(k, range.query) }));
  const showTabs = tabDefs.length > 1 && visibleTabs.includes(tab);
  // While the entitlement loads the row's space is held (no gated tabs drawn, no layout shift when they arrive);
  // only a resolved neutral account loses the row.
  const holdTabsRow = !showTabs && access === 'loading';
  const today = resolveReportRange({ preset: 'today' }, range.tz).to;

  const filters = [...(storeFilter ? [storeFilter] : []), ...toolbarExtra];
  const pickerPresets = REPORT_PRESETS as unknown as PresetKey[];

  return (
    <Page title={title ?? t('page.title')} width="detail" data-testid={testId}>
      <PageHeader
        title={title ?? t('page.title')}
        meta={blocked || (mobile && headerControl) ? undefined : meta}
        actionsSlot={!blocked && !mobile && headerControl ? headerControl : undefined}
        primaryAction={blocked ? undefined : primary}
        secondaryActions={blocked ? [] : secondary}
        overflowActions={blocked ? [] : overflow}
        mobilePrimary={mobilePrimary}
      />
      {!blocked && mobile && headerControl ? (
        <Box
          data-testid="reports-mobile-meta"
          sx={{ display: 'flex', alignItems: 'center', gap: px(space[2]), mb: px(space[3]), mt: px(-space[2]) }}
        >
          {/* Phones: freshness + rate source clamp to 2 lines next to the currency switch (it was 3–4 lines). */}
          <Box sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: '16px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{meta}</Box>
          <Box sx={{ flexShrink: 0 }}>{headerControl}</Box>
        </Box>
      ) : null}
      {showTabs ? (
        <Box sx={{ mb: px(space[4]) }}>
          <Tabs<ReportTab> value={tab} tabs={tabDefs} aria-label={t('page.title')} data-testid="reports-tabs" />
        </Box>
      ) : holdTabsRow ? (
        <Box
          aria-hidden
          data-testid="reports-tabs-pending"
          sx={{ mb: px(space[4]), minHeight: control.md, borderBottom: `1px solid ${neutral[200]}`, boxSizing: 'border-box' }}
        />
      ) : null}
      {blocked || hideToolbar ? null : (
        <Box sx={{ mb: px(space[4]) }}>
          <Toolbar
            leading={
              <DateRangeField
                value={range.pickerValue}
                onChange={range.setPickerValue}
                presets={pickerPresets}
                // No `min`: a fixed min would block older ranges; spans over REPORT_MAX_RANGE_DAYS are clamped in
                // `resolveReportRange` (and a 400 from the API gets its own message in the tab).
                max={dayToPickerDate(today)}
                data-testid="reports-date-range"
              />
            }
            filters={filters}
            values={filterValues}
            onChange={onFiltersChange}
            trailing={toolbarTrailing}
            resultCount={resultCount}
            resultLabel={resultLabel}
            hideChips
            data-testid="reports-toolbar"
          />
        </Box>
      )}
      {banners && !blocked ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]), mb: px(space[4]) }} data-testid="reports-banners">
          {banners}
        </Box>
      ) : null}
      {feature ? (
        <FeatureGate feature={feature} placement="region" data-testid={`reports-gate-${tab}`}>
          {children}
        </FeatureGate>
      ) : (
        children
      )}
    </Page>
  );
}

export default ReportsPage;
