// components/domain/orders/OrdersPage.tsx (orders G2) — the new Orders list at /app/labels behind the `orders`
// flag (orders §1, §2.1–2.3, §3.1, §7, §8). Composition only: data from G1 (`useOrdersList`), panels from
// G3 (OrderPanel), G4 (CreateLabelPanel, BulkCreateLabelsPanel) and G5 (ManualOrderPanel), mounted by their
// frozen props. One SidePanel at a time; "Create label" from the OrderPanel replaces it ("‹ Order" returns).
//
// Live: new/changed orders revalidate the list (SWR prefix `/api/orders`, plus an explicit
// `useLiveRevalidate` on the list's `mutate`), arrivals get a "New" chip for 10 min, and
// `?highlight=<id>` (new-order toast) opens that order (G1's legacy-query migration maps it to `?open=`).
import * as React from 'react';
import Box from '@mui/material/Box';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Page, PageHeader, SyncMeta, type ActionSpec } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { Toolbar, useLocalSavedViews, type FilterValues } from '@/components/ds/toolbar';
import { DataTable, LogoTile, type DataTableState } from '@/components/ds/data';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { CardListSkeleton, TableSkeleton } from '@/components/ds/state/Skeletons';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { useUrlState, writeUrlState, type UrlQuery } from '@/lib/ds/useUrlState';
import { useCommands, type Command } from '@/lib/ds/useCommand';
import { icons } from '@/lib/ds/icons';
import { copyText } from '@/lib/hooks/useCopy';
import { useConnections } from '@/lib/hooks/useConnections';
import { useMarketplaceOptions } from '@/lib/hooks/useMarketplaceOptions';
import { useOrder, useOrdersList } from '@/lib/hooks/useOrdersList';
import { useLimitDialogOptOut } from '@/lib/http/limitInterceptor';
import { canonicalStore, isMarketplaceStore } from '@/lib/marketplaces/canonical';
import { openPrintPage } from '@/lib/print/openPrintPage';
import type { OrderRow } from '@/lib/orders/types';
import { useLiveRevalidate, useRecentLiveOrders } from '@/components/live/useLiveEvent';
import { useOrderLifecycleFlags } from '@/components/orders-live/useOrderLifecycleFlags';
import { useOrderActions } from './panel/useOrderActions';
import { OrderPanel } from './panel/OrderPanel';
import { ManualOrderPanel } from './ManualOrderPanel';
import { CreateLabelPanel } from '@/components/domain/shipping/CreateLabelPanel';
import { BulkCreateLabelsPanel } from '@/components/domain/shipping/BulkCreateLabelsPanel';
import {
  ORDERS_URL_SCHEMA,
  SORT_KEYS,
  VIEW_DEFAULTS,
  applyViewPatch,
  baseViewOf,
  builtInViews,
  effectiveDateRange,
  effectiveSort,
  fromFilterValues,
  hasActiveFilters,
  hasExplicitDates,
  migrateOrdersQuery,
  ordersFilterDefs,
  savedViewQuery,
  toFilterValues,
  toOrdersQuery,
  viewLabelKey,
  type OrderSortKey,
  type OrdersUrlState,
  type SearchInKey,
  type StatusFilterKey,
} from './ordersFilters';
import { isLabelable, orderColumns, orderInlineAction, orderRowActions, pagePrimaryKind, type OrderRowHandlers, type OrdersT } from './orderColumns';
import { useOrdersBulkActions } from './OrdersBulkActions';
import { OrdersExportMenu } from './OrdersExportMenu';
import { OrdersEmptyState, ordersEmptyKind } from './OrdersEmptyState';

const DENSITY_KEY = 'kx.orders.density';
const SETTINGS_KEY = '/api/user/settings';

type Density = 'standard' | 'compact';

type SettingsSlice = {
  subscription?: ({ billingProvider?: string | null; subscriptionPlan?: string | null } & SubscriptionLimits) | null;
  shippingSettings?: { etgbEnabled?: boolean; etgbRecipientEmail?: string | null } | null;
};
type SubscriptionLimits = { limits?: { orderSync?: number | null } | null };

const settingsFetcher = async (url: string): Promise<SettingsSlice> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json();
};

function readDensity(): Density {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'standard';
  } catch {
    return 'standard';
  }
}

function writeDensity(d: Density) {
  try {
    window.localStorage.setItem(DENSITY_KEY, d);
  } catch {
    /* storage unavailable */
  }
}

export type OrdersPageProps = {
  /** Test seam: `now` for view defaults (dates) and the "New" chip. */
  now?: Date;
};

export function OrdersPage({ now }: OrdersPageProps = {}) {
  const t = useTranslations('orders') as unknown as OrdersT;
  const tStatus = useTranslations('status');
  const tLive = useTranslations('liveOrders');
  const tPrint = useTranslations('printSlips');
  const toast = useToast();
  const confirm = useConfirm();
  const mobile = useIsMobile();

  // 402 from a pull shows the inline usage Banner here instead of the global dialog (CRITIQUE C6).
  useLimitDialogOptOut();

  const [url, setUrl] = useUrlState(ORDERS_URL_SCHEMA, { migrate: migrateOrdersQuery });
  const baseView = baseViewOf(url);
  const activeView = url.view ?? 'to_ship';
  const query = React.useMemo(() => toOrdersQuery(url, now), [url, now]);
  const list = useOrdersList(query);
  const rows = list.rows;

  // ── side data ────────────────────────────────────────────────────────────────────────────────────────
  const { data: settings } = useSWR<SettingsSlice>(SETTINGS_KEY, settingsFetcher, { revalidateOnFocus: false, dedupingInterval: 300_000, keepPreviousData: true });
  const sub = settings?.subscription ?? null;
  const shopifyFree = sub?.billingProvider === 'shopify_free' || sub?.subscriptionPlan === 'shopify_free';
  /** "See plans" only for a known, non-shopify_free account (never while unknown; pro-gating §1, Shopify review). */
  const stripeUpsell = sub != null && !shopifyFree;
  const syncLimit = sub?.limits?.orderSync;
  const limitText = typeof syncLimit === 'number' && syncLimit > 0 ? t('limit.syncs', { limit: syncLimit }) : t('limit.syncsReached');
  const etgbEnabled = Boolean(settings?.shippingSettings?.etgbEnabled);
  const etgbRecipientEmail = settings?.shippingSettings?.etgbRecipientEmail ?? null;

  const connections = useConnections();
  const { marketplaceOptions } = useMarketplaceOptions();
  const storeOptions = React.useMemo(
    () =>
      marketplaceOptions.map((o) => {
        const store = canonicalStore(o.value);
        return { value: o.value, label: o.label, count: o.count, brand: isMarketplaceStore(store) ? store.marketplace : null };
      }),
    [marketplaceOptions],
  );
  const storeBrands = React.useMemo(() => Array.from(new Set(storeOptions.map((s) => s.brand).filter((b): b is NonNullable<typeof b> => Boolean(b)))), [storeOptions]);

  const recent = useRecentLiveOrders();
  const visibleIds = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const visibleKey = visibleIds.join(',');
  const lifecycleIds = React.useMemo(() => (visibleKey ? visibleKey.split(',') : []), [visibleKey]);
  const { flags: lifecycle, mutate: refreshLifecycle } = useOrderLifecycleFlags(lifecycleIds);

  // Live order / shipment events: refresh this list even if its SWR key ever stops starting with /api/orders.
  useLiveRevalidate(['order', 'shipment'], list.mutate, { throttleMs: 1500 });

  // ── density (per viewer, localStorage) ───────────────────────────────────────────────────────────────
  const [density, setDensity] = React.useState<Density>('standard');
  React.useEffect(() => setDensity(readDensity()), []);
  const changeDensity = (d: Density) => {
    setDensity(d);
    writeDensity(d);
  };

  // ── saved views ──────────────────────────────────────────────────────────────────────────────────────
  const userViews = useLocalSavedViews('orders');
  const views = React.useMemo(() => builtInViews((k) => t(k), list.counts, userViews.views), [t, list.counts, userViews.views]);

  // ── selection (kept across pages; rows are remembered when they leave the page) ──────────────────────
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const knownRows = React.useRef(new Map<string, OrderRow>());
  rows.forEach((r) => knownRows.current.set(r.id, r));
  const selectedRows = React.useMemo(
    () => selectedIds.map((id) => knownRows.current.get(id)).filter((r): r is OrderRow => Boolean(r)),
    // `rows` refreshes the remembered map (read through the ref).
    [selectedIds, rows],
  );
  const clearSelection = React.useCallback(() => setSelectedIds([]), []);
  // A different view or filter set starts a fresh selection.
  const filterKey = `${url.view}|${url.q ?? ''}|${url.store.join(',')}|${url.status.join(',')}|${url.from ?? ''}|${url.to ?? ''}|${url.preset ?? ''}`;
  React.useEffect(() => setSelectedIds([]), [filterKey]);

  // ── panels ───────────────────────────────────────────────────────────────────────────────────────────
  const [panelAction, setPanelAction] = React.useState<'addTracking' | 'messageBuyer' | null>(null);
  const [labelMode, setLabelMode] = React.useState<'create' | 'fixAddress'>('create');
  const [labelFromPanel, setLabelFromPanel] = React.useState(false);
  const [bulkRows, setBulkRows] = React.useState<OrderRow[] | null>(null);

  const openId = url.open ?? null;
  const rowOnPage = openId ? rows.find((r) => r.id === openId) ?? null : null;
  const needsFetch = Boolean(openId && url.panel === 'label' && !rowOnPage);
  const fetched = useOrder(needsFetch ? openId : null);
  const labelOrder = url.panel === 'label' ? rowOnPage ?? fetched.row ?? null : null;

  // Opening/closing a panel keeps the list page (useUrlState resets `page` on any other field change).
  const setPanelUrl = React.useCallback(
    (patch: Pick<Partial<OrdersUrlState>, 'open' | 'panel'>, opts?: { history?: 'replace' | 'push' }) =>
      setUrl((prev) => ({ ...patch, page: prev.page }), opts),
    [setUrl],
  );
  const openOrder = React.useCallback((id: string) => setPanelUrl({ open: id, panel: undefined }, { history: 'push' }), [setPanelUrl]);
  const closePanels = React.useCallback(() => {
    setPanelAction(null);
    setPanelUrl({ open: undefined, panel: undefined });
    setLabelFromPanel(false);
    setBulkRows(null);
  }, [setPanelUrl]);
  const openCreateLabel = React.useCallback(
    (row: OrderRow, opts: { mode?: 'create' | 'fixAddress'; fromPanel?: boolean } = {}) => {
      setLabelMode(opts.mode ?? 'create');
      setLabelFromPanel(Boolean(opts.fromPanel));
      setPanelUrl({ open: row.id, panel: 'label' }, { history: 'push' });
    },
    [setPanelUrl],
  );
  const openBulk = React.useCallback(
    (orders: OrderRow[]) => {
      setBulkRows(orders);
      setPanelUrl({ open: undefined, panel: 'bulk-label' }, { history: 'push' });
    },
    [setPanelUrl],
  );
  const openManual = React.useCallback(() => setPanelUrl({ open: undefined, panel: 'manual' }, { history: 'push' }), [setPanelUrl]);

  // ── live toast "Open" while this page is mounted (orders §8) ─────────────────────────────────────────
  // The new-order / cancelled-order toasts push `/app/labels?highlight=<id>`. On a cold mount useUrlState's
  // one-time `migrate` maps it to `?open=`; when the page is already mounted, Next keeps it mounted and
  // the migration does not run again, so react to the param here: restore the view/filters the push
  // dropped, open that order, and remove `highlight`.
  const router = useRouter();
  const rawHighlight = router?.query?.highlight;
  const highlight = typeof rawHighlight === 'string' && rawHighlight ? rawHighlight : null;
  const lastUrlRef = React.useRef<OrdersUrlState>(url);
  const prevHighlight = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (!router?.isReady) return;
    const prev = prevHighlight.current;
    prevHighlight.current = highlight;
    // First ready render: a `highlight` already in the URL is handled by `migrateOrdersQuery`.
    if (prev === undefined || !highlight || highlight === prev) return;
    setPanelAction(null);
    const { highlight: _drop, ...rest } = (router.query ?? {}) as UrlQuery;
    void _drop;
    const out = writeUrlState(ORDERS_URL_SCHEMA, rest, { ...lastUrlRef.current, open: highlight, panel: undefined });
    const clean: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(out)) if (v !== undefined) clean[k] = v;
    void router.replace({ pathname: router.pathname, query: clean }, undefined, { shallow: true, scroll: false });
  }, [highlight, router]);
  React.useEffect(() => {
    if (!highlight) lastUrlRef.current = url;
  }, [url, highlight]);

  const refreshAll = React.useCallback(() => {
    void list.mutate();
    void refreshLifecycle();
  }, [list, refreshLifecycle]);

  const [headerExportOpen, setHeaderExportOpen] = React.useState(false);

  // ── pull (⟳): G1's pull never rejects; a 402 becomes the usage Banner, other failures the SyncMeta "failed" line.
  const limitHit = list.pullError?.status === 402;
  const pullFailed = list.pullState === 'failed' && !limitHit;
  const pull = React.useCallback(() => list.pull(), [list]);

  // ── row handlers (side effects shared with the OrderPanel through G3's useOrderActions) ─────────────
  const actions = useOrderActions({ onChanged: refreshAll });
  const rowHandlers: OrderRowHandlers = React.useMemo(
    () => ({
      open: (r) => {
        setPanelAction(null);
        openOrder(r.id);
      },
      createLabel: (r) => openCreateLabel(r),
      fixAddress: (r) => openCreateLabel(r, { mode: 'fixAddress' }),
      printLabel: (r) => actions.printLabel(r),
      copyTracking: (r) => {
        const tn = r.label?.trackingNumber;
        if (tn) void copyText(tn).then((ok) => (ok ? toast.success(t('row.trackingCopied')) : toast.error(t('bulk.copyFailed'), { persist: false })));
      },
      // The tracking modal and the Amazon message modal live in the OrderPanel (G3, `initialAction`).
      addTracking: (r) => {
        setPanelAction('addTracking');
        openOrder(r.id);
      },
      messageBuyer: (r) => {
        setPanelAction('messageBuyer');
        openOrder(r.id);
      },
      copyAddress: (r, style) => void actions.copyAddress(r, style),
      openOnMarketplace: (r) => {
        if (r.marketplaceUrl) window.open(r.marketplaceUrl, '_blank', 'noopener,noreferrer');
      },
      printPackingSlip: (r) => actions.printPackingSlip(r),
      deleteLabel: (r) => {
        if (!r.label?.shipmentId) return;
        void confirm({
          title: t('confirm.deleteLabel.title', { number: `#${r.orderNumber}` }),
          body: t('confirm.deleteLabel.body'),
          confirmLabel: t('confirm.deleteLabel.confirm'),
          tone: 'danger',
        }).then((ok) => (ok ? actions.deleteLabel(r) : false));
      },
      deleteOrder: (r) => {
        void confirm({
          title: t('confirm.deleteOrder.title', { number: `#${r.orderNumber}` }),
          body: t('confirm.deleteOrder.body', { marketplace: r.isManual ? t('row.manualStore') : r.storeName }),
          confirmLabel: t('confirm.deleteOrder.confirm'),
          tone: 'danger',
        }).then(async (ok) => {
          if (ok && (await actions.deleteOrder(r))) setSelectedIds((ids) => ids.filter((id) => id !== r.id));
        });
      },
    }),
    [openOrder, openCreateLabel, toast, t, confirm, actions],
  );

  // ── columns ──────────────────────────────────────────────────────────────────────────────────────────
  const columns = React.useMemo(
    () => orderColumns(t, { recent, lifecycle, onLifecycleChanged: () => void refreshLifecycle(), newLabel: tLive('badge.new'), now }),
    [t, recent, lifecycle, refreshLifecycle, tLive, now],
  );

  // ── toolbar ──────────────────────────────────────────────────────────────────────────────────────────
  const dateDefault = React.useMemo(() => {
    if (hasExplicitDates(url) || url.q) return null;
    const r = effectiveDateRange(url, now);
    return r.from || r.to ? { from: r.from, to: r.to, preset: r.preset } : null;
  }, [url, now]);
  const filterDefs = React.useMemo(
    () =>
      ordersFilterDefs(
        {
          store: t('toolbar.store'),
          storeAll: t('toolbar.storeAll'),
          status: t('toolbar.status'),
          orderDate: t('toolbar.orderDate'),
          anyDate: t('toolbar.anyDate'),
          searchIn: t('toolbar.searchIn'),
          sort: t('toolbar.sort'),
          statusLabel: (k: StatusFilterKey) => (k === 'label_failed' ? tStatus('label.label_failed') : tStatus(`order.${k}`)),
          searchInLabel: (k: SearchInKey) => t(`searchIn.${k}`),
          sortLabel: (id) => t(`sort.${id}`),
        },
        storeOptions,
        { mobile, dateDefault },
      ),
    [t, tStatus, storeOptions, mobile, dateDefault],
  );
  const filterValues = React.useMemo(() => toFilterValues(url, now), [url, now]);
  const onFilters = (values: FilterValues) => setUrl(fromFilterValues(values, url, now));
  const resetToView = () => setUrl(applyViewPatch(activeView, userViews.views));

  const bulk = useOrdersBulkActions({
    selected: selectedRows,
    query,
    matchingTotal: list.total,
    etgbEnabled,
    etgbRecipientEmail,
    onCreateLabels: (orders) => openBulk(orders),
    onClear: clearSelection,
  });

  // ── header (orders §1.4) ─────────────────────────────────────────────────────────────────────────────
  const labelableOnPage = React.useMemo(() => rows.filter(isLabelable), [rows]);
  const primaryKind = pagePrimaryKind(rows, selectedIds.length);
  const createLabelsAction: ActionSpec = {
    id: 'createLabels',
    label: t('actions.createLabels', { count: labelableOnPage.length }),
    icon: icons.label,
    onClick: () => openBulk(labelableOnPage),
  };
  const manualAction: ActionSpec = { id: 'addManualOrder', label: t('actions.addManualOrder'), icon: icons.add, onClick: openManual };
  const pickListAction: ActionSpec = {
    id: 'printPickListPage',
    label: t('actions.printPickListPage'),
    icon: icons.print,
    disabled: rows.length === 0,
    disabledReason: rows.length === 0 ? t('export.empty') : undefined,
    onClick: () => {
      const res = openPrintPage('pick-list', visibleIds);
      if (!res.ok && res.reason === 'blocked') toast.info(tPrint('popupBlocked'));
    },
  };
  // With a selection the header primary demotes (the bulk bar owns the primary).
  const headerPrimary = primaryKind === 'createLabels' ? createLabelsAction : primaryKind === 'addManualOrder' ? manualAction : undefined;
  const headerOverflow: ActionSpec[] = [
    ...(primaryKind === 'createLabels' || primaryKind === 'none' ? [manualAction] : []),
    pickListAction,
    { id: 'refreshOrders', label: t('actions.refresh'), icon: icons.pull, onClick: () => void pull(), disabled: list.pulling },
  ];

  // ⌘K: saved views as "Go to …" (header actions register themselves through PageHeader).
  const viewCommands = React.useMemo<Command[]>(
    () =>
      views
        .filter((v) => v.builtIn !== false)
        .map((v) => ({ id: `orders.view.${v.id}`, label: t('views.goTo', { view: v.label }), group: 'goto' as const, run: () => setUrl(applyViewPatch(v.id, [])) })),
    [views, t, setUrl],
  );
  useCommands(viewCommands);

  const syncState = list.pulling ? 'pulling' : pullFailed ? 'failed' : 'idle';
  const meta = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <SyncMeta
        source="all"
        lastPulledAt={list.lastPulledAt ?? null}
        state={syncState}
        onPull={() => void pull()}
        pullDisabledReason={limitHit ? limitText : undefined}
        copy={{
          refreshed: (time) => t('meta.refreshed', { time }),
          refreshing: t('meta.refreshing'),
          failed: t('meta.refreshFailed'),
          pullLabel: t('actions.refresh'),
        }}
        now={now}
        data-testid="orders-sync-meta"
      />
      {storeBrands.length ? (
        <Box component="span" data-testid="orders-stores-summary" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 12 }}>
          <span aria-hidden>{'·'}</span>
          {storeBrands.slice(0, 6).map((b) => (
            <LogoTile key={b} brand={b} size={16} />
          ))}
          <span>{t('meta.stores', { count: storeOptions.length })}</span>
        </Box>
      ) : null}
    </Box>
  );

  // ── table state (orders §7.1) ────────────────────────────────────────────────────────────────────────
  const filtered = hasActiveFilters(url);
  const emptyKind = ordersEmptyKind({
    view: baseView,
    empty: list.state === 'empty' || (list.state === 'ready' && rows.length === 0),
    filtered,
    anyStoreConnected: connections.anyMarketplace,
  });
  let tableState: DataTableState = 'ready';
  if (list.state === 'loading' || list.state === 'slow') tableState = 'loading';
  else if (list.state === 'error') tableState = 'error';
  else if (emptyKind) tableState = 'empty';

  const sort = effectiveSort(url);
  const sortable = (k: string): k is OrderSortKey => (SORT_KEYS as readonly string[]).includes(k);
  const onRowOpen = React.useCallback(
    (r: OrderRow) => {
      setPanelAction(null);
      openOrder(r.id);
    },
    [openOrder],
  );

  // Next labelable order after a created label ("Create label for the next order").
  const nextLabelable = React.useCallback(
    (fromId: string) => {
      const i = rows.findIndex((r) => r.id === fromId);
      return rows.slice(i + 1).find(isLabelable) ?? null;
    },
    [rows],
  );

  // A total is only meaningful once the list answered (G1 reports 0 while loading).
  const knownTotal = list.state === 'ready' || list.state === 'empty' || list.state === 'stale' ? list.total : undefined;

  const bulkOpen = url.panel === 'bulk-label';
  const bulkOrders = bulkOpen ? bulkRows ?? labelableOnPage : [];

  return (
    <Page title={t('page.title')} width="list">
      <PageHeader
        title={t('page.title')}
        count={knownTotal}
        meta={meta}
        actionsSlot={mobile ? undefined : <OrdersExportMenu selectedIds={[]} query={query} matchingTotal={list.total} data-testid="orders-header-export" />}
        primaryAction={headerPrimary}
        secondaryActions={primaryKind === 'none' ? [createLabelsAction].filter(() => labelableOnPage.length > 0) : undefined}
        overflowActions={mobile ? [...headerOverflow, { id: 'export', label: t('actions.export'), icon: icons.download, onClick: () => setHeaderExportOpen(true) }] : headerOverflow}
        data-testid="orders-header"
      />
      {mobile ? (
        <OrdersExportMenu selectedIds={[]} query={query} matchingTotal={list.total} hideTrigger open={headerExportOpen} onOpenChange={setHeaderExportOpen} data-testid="orders-header-export" />
      ) : null}

      <Toolbar
        search={{
          value: url.q ?? '',
          onChange: (q) => setUrl({ q: q || undefined }),
          placeholder: t('toolbar.searchPlaceholder'),
        }}
        filters={filterDefs}
        values={filterValues}
        onChange={onFilters}
        onClearAll={resetToView}
        resultCount={knownTotal}
        resultLabel={list.isValidating ? t('toolbar.updating') : knownTotal !== undefined ? t('toolbar.results', { count: knownTotal }) : undefined}
        views={{
          views,
          activeId: activeView,
          onSelect: (id) => setUrl(applyViewPatch(id, userViews.views)),
          onSave: (label) => {
            const v = userViews.save(label, savedViewQuery(url));
            setUrl({ view: v.id, base: baseView });
          },
          onDelete: (id) => {
            userViews.remove(id);
            if (url.view === id) setUrl(applyViewPatch(baseView, []));
          },
          label: t('views.label'),
        }}
        density={{ value: density, onChange: changeDensity }}
        selection={selectedIds.length > 0 ? bulk : undefined}
        data-testid="orders-toolbar"
      />

      {limitHit ? (
        <Box sx={{ mb: '8px' }}>
          <Banner
            tone="warning"
            title={limitText}
            action={stripeUpsell ? { id: 'seePlans', label: t('limit.seePlans'), href: '/fiyatlandirma?from=orders' } : undefined}
            data-testid="orders-limit-banner"
          />
        </Box>
      ) : list.state === 'stale' ? (
        <Box sx={{ mb: '8px' }}>
          <ErrorState variant="stale" onRetry={() => void list.mutate()} data-testid="orders-stale" />
        </Box>
      ) : null}

      <DataTable<OrderRow>
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        state={tableState}
        loading={
          list.state === 'slow' ? (
            <SlowState onRetry={() => void list.mutate()} data-testid="orders-slow" />
          ) : mobile ? (
            <CardListSkeleton count={6} thumb />
          ) : (
            <TableSkeleton rows={8} thumb density={density} />
          )
        }
        empty={
          emptyKind ? <OrdersEmptyState kind={emptyKind} view={baseView} query={url.q} onClearFilters={resetToView} /> : null
        }
        error={<ErrorState variant="page" title={t('error.title')} onRetry={() => void list.mutate()} data-testid="orders-error" />}
        selection={{ ids: selectedIds, onChange: setSelectedIds }}
        onRowOpen={onRowOpen}
        inlineAction={(r) => orderInlineAction(r, rowHandlers, t)}
        rowActions={(r) => orderRowActions(r, rowHandlers, t)}
        density={density}
        sort={{ key: sort.key, dir: sort.dir }}
        onSortChange={(s) => {
          if (sortable(s.key)) setUrl({ sort: s.key, dir: s.dir });
        }}
        pagination={
          knownTotal !== undefined && knownTotal > 0
            ? {
                mode: 'pages',
                page: url.page,
                pageSize: (url.size as 50 | 100 | 250) ?? 50,
                total: knownTotal,
                onChange: ({ page, pageSize }) => setUrl({ page, size: pageSize }),
              }
            : undefined
        }
        columnStateKey="orders.v1"
        ariaLabel={t(viewLabelKey(baseView))}
        activeRowId={openId}
        data-testid="orders-table"
      />

      {/* One SidePanel at a time (orders §1.1). */}
      <OrderPanel
        orderId={url.panel ? null : openId}
        rows={rows}
        onClose={closePanels}
        onNavigate={(id) => {
          setPanelAction(null);
          setPanelUrl({ open: id, panel: undefined });
        }}
        initialAction={panelAction}
        onCreateLabel={(r) => openCreateLabel(r, { fromPanel: true })}
        onChanged={refreshAll}
      />
      <CreateLabelPanel
        order={labelOrder}
        open={url.panel === 'label' && Boolean(openId)}
        mode={labelMode}
        onClose={closePanels}
        onBack={labelFromPanel && openId ? () => setPanelUrl({ open: openId, panel: undefined }) : undefined}
        onCreated={() => refreshAll()}
        onNext={
          openId && nextLabelable(openId)
            ? () => {
                const next = nextLabelable(openId);
                if (next) openCreateLabel(next);
              }
            : undefined
        }
      />
      <BulkCreateLabelsPanel
        orders={bulkOrders}
        open={bulkOpen && bulkOrders.length > 0}
        onClose={closePanels}
        onFixOrder={(id) => {
          const r = knownRows.current.get(id);
          if (r) openCreateLabel(r, { mode: 'fixAddress' });
        }}
        onDone={() => {
          clearSelection();
          refreshAll();
        }}
      />
      <ManualOrderPanel
        open={url.panel === 'manual'}
        onClose={closePanels}
        onCreated={(orderId) => {
          refreshAll();
          setPanelUrl({ panel: undefined, open: orderId });
        }}
      />
    </Page>
  );
}

export default OrdersPage;

// Re-exported for tests (view defaults are part of the page contract).
export { VIEW_DEFAULTS };
export type { OrdersUrlState };
