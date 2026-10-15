// components/domain/overview/OverviewPage.tsx (overview G6) — the Overview behind the `overview` flag (overview §1–§3).
// An action queue, not a report: what is broken, what is due, how it is going, what is connected.
//
// Data: one summary call (`useOverviewSummary`, G4) plus shared client caches (connections, notifications,
// message counts). Composition only — rows come from `attentionRows.ts`, deep links from `lib/nav/links.ts`
// (flag-aware), the refresh from `useSyncOrders` (click only, never automatic; it revalidates the summary).
//
// Primary rule (§1, P1): toShip > 0 → Go to orders · else Etsy/eBay connected → New listing · else no store →
// Connect a store · while unknown → none. Mobile: Go to orders → StickyActionBar; New listing → TopBar "+ New";
// Connect a store stays in the checklist card. State A (setup card visible) replaces the KPI row, and hides
// the chart and best sellers. The Home destination stays /app/analytics: this page is not a nav item.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Page, PageHeader, SyncMeta, usePageContext, type ActionSpec, type SyncMetaState } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { usePageActions } from '@/lib/ds/usePageActions';
import { useAsyncRegion } from '@/lib/ds/useAsyncState';
import { icons } from '@/lib/ds/icons';
import { getLogo } from '@/lib/ds/logos';
import { useFormatters } from '@/lib/format';
import { neutral, px, space } from '@/lib/ds/tokens';
import { useAuth } from '@/lib/auth-context';
import { useConnections, type ConnectionProvider } from '@/lib/hooks/useConnections';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { useOverviewSummary } from '@/lib/hooks/useOverviewSummary';
import { useSyncOrders } from '@/lib/hooks/useSyncOrders';
import useMessageCountStore from '@/lib/stores/useMessageCountStore';
import { useNavLinks } from '@/lib/nav/links';
import { RESEARCH_HOME } from '@/lib/nav/navConfig';
import { buildAttentionRows, queueState, usagePause, type ReconnectInput } from './attentionRows';
import { AttentionQueue } from './AttentionQueue';
import { KpiRow } from './KpiRow';
import { OrdersChartCard } from './OrdersChartCard';
import { BestSellersCard } from './BestSellersCard';
import { STORE_PROVIDERS, StoresStrip } from './StoresStrip';
import { SetupChecklist, shouldShowSetup, useSetupDismissed, type SetupFacts } from './SetupChecklist';

export const ETSY_NEW_LISTING_HREF = '/app/etsy-listings/new';
export const EBAY_NEW_LISTING_HREF = '/app/ebay-listings/new';
export const MESSAGES_HREF = '/app/mesajlar';
const CARRIERS: readonly ConnectionProvider[] = ['fedex', 'ups', 'mng'];

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening';

/** Pure: hour of `now` in `tz` → morning (< 12) · afternoon (< 18) · evening. */
export function greetingPeriod(now: Date, tz: string): GreetingPeriod {
  let hour = now.getUTCHours();
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now));
  } catch {
    /* unknown zone: UTC */
  }
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

type AuthUserLike = { email?: string | null; user_metadata?: { full_name?: string | null; name?: string | null } | null } | null | undefined;

/** Pure: first word of the full name → the email's local part → null. */
export function greetingName(user: AuthUserLike): string | null {
  const full = (user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '').trim();
  if (full) return full.split(/\s+/)[0] ?? null;
  const local = (user?.email ?? '').split('@')[0]?.trim();
  return local || null;
}

/** Pure: P1 primary for the header (null = none yet). */
export function overviewPrimary(args: {
  toShipCount: number | null;
  summaryKnown: boolean;
  anyMarketplace: boolean | undefined;
  newListingHref: string | null;
}): 'goToOrders' | 'newListing' | 'connectStore' | null {
  // §1 ranks open orders first: a seller with no store but manual orders to ship still gets Go to orders.
  if (!args.summaryKnown) return null;
  if ((args.toShipCount ?? 0) > 0) return 'goToOrders';
  if (args.anyMarketplace === false) return 'connectStore';
  if (args.newListingHref) return 'newListing';
  return null;
}

/** On mobile with the shell owning the title row, the greeting moves into the content (§2.3). */
function MobileGreeting({ greeting }: { greeting: string }) {
  const page = usePageContext();
  const mobile = useIsMobile();
  if (!mobile || !page?.shellManaged) return null;
  return (
    <Box sx={{ mb: px(space[1]) }} data-testid="overview-mobile-greeting">
      <Typography variant="titleMd" component="p" sx={{ m: 0, color: neutral[900] }}>
        {greeting}
      </Typography>
    </Box>
  );
}

export interface OverviewPageProps {
  /** Tests: fixed clock. */
  now?: Date;
}

export function OverviewPage({ now: nowProp }: OverviewPageProps = {}) {
  const t = useTranslations('overview');
  const fmt = useFormatters();
  const { user } = useAuth() as { user: (AuthUserLike & { id?: string }) | null };
  const links = useNavLinks();
  const conn = useConnections();
  const notifications = useNotifications();
  const counts = useMessageCountStore((s) => s.counts);
  const fetchedAt = useMessageCountStore((s) => s.fetchedAt);
  const messagesFailed = useMessageCountStore((s) => s.failed);
  const ov = useOverviewSummary();
  const sync = useSyncOrders();
  const mobile = useIsMobile();
  const [dismissed, dismiss] = useSetupDismissed(user?.id ?? null);
  const now = nowProp ?? new Date();

  const summary = ov.summary;
  const usage = summary?.usage ?? null;
  const hideBilling = Boolean(usage?.hideBilling);

  // ── connections-derived facts ──
  const hasEtsy = conn.has('etsy') === true;
  const hasEbay = conn.has('ebay') === true;
  const newListingHref = hasEtsy ? ETSY_NEW_LISTING_HREF : hasEbay ? EBAY_NEW_LISTING_HREF : null;
  const firstStore = React.useMemo(() => {
    for (const p of STORE_PROVIDERS) {
      const e = conn.connections?.[p];
      if (e?.connected) return { provider: p, name: e.accounts?.[0]?.name || getLogo(p)?.name || p };
    }
    return null;
  }, [conn.connections]);
  const hasCarrier = CARRIERS.some((c) => conn.has(c) === true);

  const facts: SetupFacts | null = summary?.setup
    ? {
        storeConnected: conn.anyMarketplace === true,
        storeName: firstStore?.name ?? null,
        storeProvider: firstStore?.provider ?? null,
        senderComplete: summary.setup.senderComplete,
        hasLabel: summary.setup.hasLabel,
        hasOrders: summary.setup.hasOrders,
        hasCarrier,
      }
    : null;
  const setupVisible = shouldShowSetup({ connectionsLoaded: Boolean(conn.connections), facts, dismissed });

  // ── refresh (click only) ──
  // Only the order-sync meter (or a whole-account block) pauses refresh: a used-up label meter does not.
  const refreshDisabledReason = usagePause(usage).orderSync ? (hideBilling ? t('meta.refreshPausedSupport') : t('meta.refreshPaused')) : undefined;
  const orderSyncLimit = usage?.orderSync.limit ?? null;
  const onRefresh = React.useCallback(() => {
    void sync.sync();
  }, [sync]);
  const syncState: SyncMetaState = sync.syncing
    ? 'pulling'
    : sync.lastResult && !sync.lastResult.ok && (sync.lastResult.reason === 'failed' || sync.lastResult.reason === 'unauthorized')
      ? 'failed' // tooSoon / nothingToSync are benign (timed toasts in useSyncOrders), limit has its own toast
      : 'idle';

  const refreshAction: ActionSpec = {
    id: 'refreshOrders',
    label: t('actions.refreshOrders'),
    icon: icons.pull,
    onClick: onRefresh,
    loading: sync.syncing,
    loadingLabel: t('meta.refreshing'),
    disabled: Boolean(refreshDisabledReason),
    disabledReason: refreshDisabledReason,
  };
  usePageActions([refreshAction]);

  // ── header actions ──
  // Mobile sticky bar carries the count ("Go to orders (12)", §2.3); the desktop header does not (§2.1).
  const toShipCount = summary?.toShip?.count ?? 0;
  const goToOrders: ActionSpec = {
    id: 'goToOrders',
    label: mobile && toShipCount > 0 ? t('actions.goToOrdersCount', { count: toShipCount }) : t('actions.goToOrders'),
    icon: icons.order,
    href: links.ordersHref('to_ship'),
  };
  const newListing: ActionSpec | null = newListingHref ? { id: 'newListing', label: t('actions.newListing'), icon: icons.add, href: newListingHref } : null;
  const connectStore: ActionSpec = { id: 'connectStore', label: t('actions.connectStore'), icon: icons.connections, href: links.settingsHref('connections') };
  const primaryKind = overviewPrimary({
    toShipCount: summary?.toShip?.count ?? null,
    summaryKnown: Boolean(summary) || ov.isError,
    anyMarketplace: conn.anyMarketplace,
    newListingHref,
  });
  const primary = primaryKind === 'goToOrders' ? goToOrders : primaryKind === 'newListing' ? newListing ?? undefined : primaryKind === 'connectStore' ? connectStore : undefined;
  const secondary: ActionSpec[] = newListing && primaryKind !== 'newListing' ? [newListing] : [];
  const overflow: ActionSpec[] = [
    { id: 'addManualOrder', label: t('actions.addManualOrder'), icon: icons.add, href: '/app/labels?panel=manual' },
    { id: 'research', label: t('actions.research'), icon: icons.research, href: RESEARCH_HOME },
    { id: 'reports', label: t('actions.reports'), icon: icons.reports, href: links.reportsHref() },
  ];

  // ── greeting ──
  const period = greetingPeriod(now, fmt.timeZone);
  const name = greetingName(user);
  const greeting = name ? t(`greeting.${period}`, { name }) : t(`greeting.${period}NoName`);
  const subtitle = [fmt.date(now, 'weekday'), conn.anyMarketplace ? t('subtitle.allStores') : null].filter(Boolean).join(' · ');

  const meta = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', columnGap: px(space[2]), minWidth: 0 }}>
      {summary && !summary.ordersLastSyncedAt && syncState === 'idle' ? (
        <Typography variant="caption" component="span" sx={{ color: neutral[500] }}>
          {t('meta.ordersNeverRefreshed')}
        </Typography>
      ) : null}
      <SyncMeta
        source="all"
        lastPulledAt={summary?.ordersLastSyncedAt ?? null}
        state={syncState}
        onPull={onRefresh}
        pullDisabledReason={refreshDisabledReason}
        pullHint={orderSyncLimit != null && usage ? t('meta.refreshQuota', { limit: orderSyncLimit, used: usage.orderSync.used }) : undefined}
        copy={{
          refreshed: (time) => t('meta.ordersRefreshed', { time }),
          refreshing: t('meta.refreshing'),
          failed: t('toast.refreshFailed'),
          pullLabel: t('actions.refreshOrders'),
        }}
      />
      {summary ? (
        <Typography variant="caption" component="span" sx={{ color: neutral[500] }} data-testid="overview-updated">
          {t('meta.updated', { time: fmt.relative(new Date(summary.receivedAt ?? summary.generatedAt), now) })}
        </Typography>
      ) : null}
    </Box>
  );

  // ── queue ──
  const reconnect: ReconnectInput[] = conn.needsReauth.map((p) => {
    const e = conn.get(p);
    return { provider: p, name: getLogo(p)?.name ?? p, reason: e?.reason ?? e?.accounts?.find((a) => a.needsReauth)?.reason ?? null };
  });
  const model = buildAttentionRows({
    summary: summary ?? (ov.isError ? null : undefined),
    reconnect,
    syncFailures: notifications.items,
    extensionDetected: conn.extension?.detected,
    anyMarketplace: conn.anyMarketplace,
    now,
  });
  // DS P6: 15 s → "Still loading… Retry", 30 s → the whole-error state (never a stuck skeleton).
  const region = useAsyncRegion(
    { data: summary, error: ov.error, isLoading: ov.isLoading, isValidating: ov.isValidating, mutate: ov.refresh },
    { isEmpty: () => false },
  );
  const wholeError = ov.isError || region.timedOut;
  const slow = region.state === 'slow';
  const qState = queueState({ summary, wholeError, model, anyMarketplace: conn.anyMarketplace, setupCardVisible: setupVisible });
  const retryRegion = region.retry;
  const retry = React.useCallback(() => retryRegion(), [retryRegion]);

  const sectionFailed = (k: 'series' | 'topSellers') => (summary ? summary.errors.includes(k) : wholeError);
  const firstLoad = !summary && !wholeError;

  return (
    <Page title={t('pageTitle')} width="detail" mobileAction={newListing ?? undefined} data-testid="overview-page">
      <MobileGreeting greeting={greeting} />
      <PageHeader
        title={greeting}
        subtitle={subtitle}
        meta={meta}
        primaryAction={primary}
        secondaryActions={secondary}
        overflowActions={overflow}
        mobilePrimary={primaryKind === 'goToOrders' ? 'sticky' : 'none'}
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: px(space[6]), md: px(space[8]) } }}>
        {setupVisible && facts ? (
          <SetupChecklist
            facts={facts}
            onDismiss={dismiss}
            onRefreshOrders={onRefresh}
            refreshing={sync.syncing}
            orderSyncLimit={orderSyncLimit}
            refreshDisabledReason={refreshDisabledReason}
            toShipHref={links.ordersHref('to_ship')}
          />
        ) : (
          <KpiRow
            summary={summary}
            loading={firstLoad}
            messages={{ counts, fetchedAt, failed: messagesFailed, wix: conn.has('wix') === true, trendyol: conn.has('trendyol') === true }}
            hrefs={{ toShip: links.ordersHref('to_ship'), overdue: links.ordersHref('overdue'), revenue: links.reportsHref(), messages: MESSAGES_HREF }}
            onRetry={retry}
          />
        )}

        <AttentionQueue
          model={model}
          state={qState}
          slow={slow}
          requestId={summary?.requestId}
          staleSince={ov.isStale && summary ? new Date(summary.receivedAt) : null}
          onRetry={retry}
          retrying={ov.isValidating}
          onRefreshOrders={onRefresh}
          refreshing={sync.syncing}
          refreshDisabledReason={refreshDisabledReason}
          orderSyncLimit={orderSyncLimit}
        />

        {setupVisible ? null : (
          <Box
            sx={{
              display: 'grid',
              gap: { xs: px(space[6]), md: px(space[4]) },
              gridTemplateColumns: '1fr',
              '@media (min-width: 1100px)': { gridTemplateColumns: 'minmax(0, 8fr) minmax(0, 4fr)' },
            }}
          >
            <OrdersChartCard
              series={summary?.series}
              tz={summary?.tz ?? ov.tz}
              loading={firstLoad}
              failed={sectionFailed('series')}
              errorId={summary?.requestId}
              onRetry={retry}
            />
            <BestSellersCard
              topSellers={summary?.topSellers}
              failed={sectionFailed('topSellers')}
              errorId={summary?.requestId}
              onRetry={retry}
              searchHref={(q) => links.ordersHref('search', null, null, q)}
            />
          </Box>
        )}

        <StoresStrip connections={conn.connections} loading={conn.isLoading} checkFailed={Boolean(conn.error) && !conn.connections} />
      </Box>
    </Page>
  );
}

export default OverviewPage;
