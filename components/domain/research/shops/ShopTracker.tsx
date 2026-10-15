// components/domain/research/shops/ShopTracker.tsx (research R3-B) — Shop tracker (research.md §8): "What are my
// competitors doing?". ResearchLayout (tab `shops`, marketplace switch) · quota caption · DataTable of watched shops
// (cards < 900) · ShopPanel (`?open=<watchId>`) · "Watch a shop" Modal (`?add=<shop>` opens it prefilled).
//
// Honest data (research §3.1, RR §6): sales per day are Measured only from ≥ 2 daily readings of Etsy's
// `transaction_sold_count` (before that "—" + "First reading taken today. Daily sales appear tomorrow."); lifetime
// counters say "(all time)"; per-listing share of sales is an Estimate (`~`). No averages of prices anywhere.
//
// Plan quota (research §1.2, `limits.researchWatches`, a standing count, not a meter): "Watching 3 of 10 shops on your
// plan"; at the limit the primary is disabled with the reason. "Compare plans" renders only when the entitlement says
// `stripeUpsell` (shopify_free never sees a Stripe upsell).
//
// Writes: watch rows and alert rules in KolayXport only. Nothing here stages or sends a listing.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { DataTable, type DataTableState } from '@/components/ds/data';
import { useDsFormat } from '@/components/ds/data/fmt';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { ConfirmDialog } from '@/components/ds/overlay/ConfirmDialog';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { CardListSkeleton, TableSkeleton } from '@/components/ds/state/Skeletons';
import { ApiSourceNote } from '@/components/domain/research/products/ApiSourceNote';
import { prefillHref, writeListingPrefill } from '@/components/etsy/research/shared/listingPrefill';
import { CHOOSE_PLAN_HREF } from '@/lib/billing/billingState';
import { useEntitlement } from '@/lib/billing/useEntitlement';
import { icons } from '@/lib/ds/icons';
import { neutral as n } from '@/lib/ds/tokens';
import { useUiFlag } from '@/lib/ds/uiFlags';
import { useUrlState } from '@/lib/ds/useUrlState';
import { removeWatch, useWatches, watchErrorKind, type WatchListingLite, type WatchSummary } from '@/lib/research/hooks/useWatches';
import { useConnections } from '@/lib/hooks/useConnections';
import { MKT_NAME, ResearchLayout, useResearchMkt } from '../ResearchLayout';
import { CompareListingModal } from './CompareListingModal';
import { ShopPanel } from './ShopPanel';
import { WatchShopModal } from './WatchShopModal';
import { shopColumns } from './shopColumns';
import { SHOPS_URL_SCHEMA, isShopMkt, quotaFull, similarPrefill, type ShopMkt, type ShopT } from './shopModel';

export type ShopTrackerProps = {
  /** Test seam for navigation. */
  navigate?: (href: string, opts?: { newTab?: boolean }) => void;
};

export function ShopTracker({ navigate }: ShopTrackerProps = {}) {
  const market = useResearchMkt('shops');
  const t = useTranslations() as unknown as ShopT;
  if (!isShopMkt(market.mkt)) {
    return (
      <ResearchLayout tab="shops" market={market}>
        <EmptyState
          kind="no-results"
          title={t('research.shops.unavailableMkt', { marketplace: MKT_NAME[market.mkt] })}
          body={t('research.shops.unavailableMktBody')}
          action={{ id: 'shops-use-etsy', label: t('research.shops.useEtsy'), onClick: () => market.setMkt('etsy') }}
          data-testid="shops-unavailable"
        />
      </ResearchLayout>
    );
  }
  return <ShopTrackerFor mkt={market.mkt} market={market} navigate={navigate} />;
}

function ShopTrackerFor({ mkt, market, navigate }: { mkt: ShopMkt; market: ReturnType<typeof useResearchMkt>; navigate?: ShopTrackerProps['navigate'] }) {
  const t = useTranslations() as unknown as ShopT;
  const fmt = useDsFormat();
  const toast = useToast();
  const mobile = useIsMobile();
  const router = useRouter();
  const entitlement = useEntitlement();
  const connections = useConnections();
  const listingsOn = useUiFlag(mkt === 'etsy' ? 'listings-etsy' : 'listings-ebay');
  const editorOn = useUiFlag(mkt === 'etsy' ? 'editor-etsy' : 'editor-ebay');

  const go = React.useCallback(
    (href: string, opts?: { newTab?: boolean }) => {
      if (navigate) return navigate(href, opts);
      if (opts?.newTab) window.open(href, '_blank', 'noopener,noreferrer');
      else void router.push(href);
    },
    [navigate, router],
  );

  const [url, setUrl] = useUrlState(SHOPS_URL_SCHEMA);
  const watches = useWatches();
  const rows = React.useMemo(() => watches.rows.filter((r) => r.marketplace === mkt), [watches.rows, mkt]);
  const quota = watches.quota;
  // Stripe upsell only when BOTH the server (quota) and the entitlement say so: shopify_free never sees it.
  const stripeUpsell = quota?.stripeUpsell === true && entitlement.data?.stripeUpsell === true;
  const available = watches.data ? watches.data.available : true;
  const full = quotaFull(quota);
  const quotaReason = full && quota?.limit != null ? t('research.shops.quotaFull', { limit: quota.limit }) : undefined;
  // The quota and BR-1c gate new Etsy watches only: eBay sellers are legacy tracked sellers the server adds without
  // either, so the eBay hub keeps "Watch a shop" enabled (and the modal applies the block per parsed target).
  const blockedReason = !available ? t('research.shops.error.unavailable') : quotaReason;
  const headerBlocked = mkt === 'etsy' ? blockedReason : undefined;

  // ── modal ("Watch a shop"; `?add=` opens it prefilled once) ──────────────────────────────────────────────
  const [modal, setModal] = React.useState<{ open: boolean; initial?: string }>({ open: false });
  const addParam = url.add;
  React.useEffect(() => {
    if (!addParam) return;
    setModal({ open: true, initial: addParam });
    setUrl({ add: undefined });
  }, [addParam, setUrl]);
  const openModal = React.useCallback(() => setModal({ open: true }), []);

  // ── panel (`?open=`) ─────────────────────────────────────────────────────────────────────────────────────
  const openId = url.open ?? null;
  const openRow = openId ? watches.rows.find((r) => r.id === openId) ?? null : null;
  const openIndex = openRow ? rows.findIndex((r) => r.id === openRow.id) : -1;
  const setOpen = React.useCallback((id: string | undefined, history: 'push' | 'replace' = 'replace') => setUrl({ open: id }, { history }), [setUrl]);
  const listSettled = watches.region.state === 'ready' || watches.region.state === 'empty' || watches.region.state === 'stale';
  React.useEffect(() => {
    if (openId && listSettled && watches.data && !openRow) setOpen(undefined);
  }, [openId, listSettled, watches.data, openRow, setOpen]);

  // ── remove (confirm) ─────────────────────────────────────────────────────────────────────────────────────
  const [removing, setRemoving] = React.useState<WatchSummary | null>(null);
  const confirmRemove = async () => {
    const row = removing;
    setRemoving(null);
    if (!row) return;
    try {
      await removeWatch(row.id);
      if (openId === row.id) setOpen(undefined);
      toast.success(t('research.shops.removed', { shop: row.label }));
      void watches.mutate();
    } catch (e) {
      toast.error(t(watchErrorKind(e) === 'notFound' ? 'research.shops.error.gone' : 'research.shops.removeFailed'), { persist: false });
      void watches.mutate();
    }
  };

  // ── compare / draft similar ──────────────────────────────────────────────────────────────────────────────
  const [compareOpen, setCompareOpen] = React.useState(false);
  const draftSimilar = React.useCallback(
    (listing: WatchListingLite, row: WatchSummary) => {
      const target: ShopMkt = row.marketplace === 'ebay' ? 'ebay' : 'etsy';
      if (!writeListingPrefill(similarPrefill(listing, target, row.label))) {
        toast.error(t('research.shops.prefillFailed'), { persist: false });
        return;
      }
      go(listingsOn && editorOn ? `/app/${target}-listings/new?prefill=session` : prefillHref(target));
    },
    [toast, t, go, listingsOn, editorOn],
  );

  // ── header ───────────────────────────────────────────────────────────────────────────────────────────────
  const primaryAction = {
    id: 'shops-watch',
    label: t('research.action.watchShop'),
    icon: icons.add,
    onClick: openModal,
    disabled: Boolean(headerBlocked),
    disabledReason: headerBlocked,
  };

  // The quota counts Etsy shop watches only (legacy eBay sellers aren't counted): shown on the Etsy hub.
  const quotaLine =
    mkt === 'etsy' && quota && quota.limit !== null ? (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', mb: '12px' }} data-testid="shops-quota">
        <Typography variant="caption" component="p" sx={{ m: 0, color: full ? n[800] : n[600] }}>
          {full ? quotaReason : t('research.shops.quota', { used: quota.used, limit: quota.limit })}
        </Typography>
        {stripeUpsell ? (
          <Typography variant="caption" component="a" href={CHOOSE_PLAN_HREF} sx={{ color: n[800], textDecoration: 'underline' }} data-testid="shops-compare-plans">
            {t('research.shops.comparePlans')}
          </Typography>
        ) : null}
      </Box>
    ) : null;

  // ── states ───────────────────────────────────────────────────────────────────────────────────────────────
  const state = watches.region.state;
  let tableState: DataTableState = 'ready';
  if (state === 'loading' || state === 'slow') tableState = 'loading';
  else if (state === 'error') tableState = 'error';
  else if (rows.length === 0) tableState = 'empty';

  const errKind = watches.error ? watchErrorKind(watches.error) : null;
  const errorCause = errKind === 'unavailable' || watches.error?.status === 404 ? t('research.shops.error.unavailable') : undefined;
  const unavailableNotice = mkt === 'etsy' && watches.data && !watches.data.available;
  const budget = watches.errors.some((e) => e.key === 'research.error.budget');

  const columns = React.useMemo(() => shopColumns({ t, fmt }), [t, fmt]);
  const caption = t('research.shops.footer', { marketplace: MKT_NAME[mkt] });

  return (
    <ResearchLayout tab="shops" market={market} primaryAction={primaryAction} data-testid="research-shops">
      <Box data-testid="shop-tracker">
        {quotaLine}
        {unavailableNotice ? (
          <Box sx={{ mb: '8px' }}>
            <Banner tone="info" title={t('research.shops.error.unavailable')} data-testid="shops-unavailable-banner" />
          </Box>
        ) : null}
        {budget ? (
          <Box sx={{ mb: '8px' }}>
            <Banner tone="info" title={t('research.error.budget')} data-testid="shops-budget" />
          </Box>
        ) : null}
        {state === 'stale' ? (
          <Box sx={{ mb: '8px' }}>
            <ErrorState variant="stale" onRetry={watches.region.retry} data-testid="shops-stale" />
          </Box>
        ) : null}

        <DataTable<WatchSummary>
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          state={tableState}
          loading={state === 'slow' ? <SlowState onRetry={watches.region.retry} data-testid="shops-slow" /> : mobile ? <CardListSkeleton count={4} thumb /> : <TableSkeleton rows={5} thumb />}
          empty={
            <EmptyState
              kind="first-use"
              icon={icons.research}
              title={t('research.empty.shops')}
              body={t('research.shops.emptyBody', { marketplace: MKT_NAME[mkt] })}
              action={{ ...primaryAction, id: 'shops-empty-watch' }}
              data-testid="shops-empty"
            />
          }
          error={<ErrorState variant="page" title={t('research.shops.loadFailed')} cause={errorCause} onRetry={watches.region.retry} data-testid="shops-error" />}
          onRowOpen={(r) => setOpen(r.id, 'push')}
          rowActions={(r) => [
            { id: 'shops-open', label: t('research.shops.open'), onClick: () => setOpen(r.id, 'push') },
            ...(r.url ? [{ id: 'shops-view', label: t('research.shops.viewOn', { marketplace: MKT_NAME[mkt] }), icon: icons.externalLink, onClick: () => go(r.url as string, { newTab: true }) }] : []),
            ...(r.capabilities.remove ? [{ id: 'shops-remove', label: t('research.shops.remove'), icon: icons.delete, tone: 'danger' as const, onClick: () => setRemoving(r) }] : []),
          ]}
          caption={rows.length && !watches.source ? caption : undefined}
          columnStateKey="research.shops.v1"
          ariaLabel={t('research.tabs.shops')}
          activeRowId={openId}
          data-testid="shops-table"
        />
        {rows.length && watches.source ? (
          <Box sx={{ mt: '4px', px: '12px' }}>
            <ApiSourceNote source={watches.source} sampleUnit="shops" data-testid="shops-source" />
          </Box>
        ) : null}
      </Box>

      <ShopPanel
        row={openRow}
        open={Boolean(openRow)}
        onClose={() => setOpen(undefined)}
        onPrev={openIndex > 0 ? () => setOpen(rows[openIndex - 1].id) : undefined}
        onNext={openIndex >= 0 && openIndex < rows.length - 1 ? () => setOpen(rows[openIndex + 1].id) : undefined}
        onCompare={() => setCompareOpen(true)}
        onDraftSimilar={draftSimilar}
        onRemove={(r) => setRemoving(r)}
        onAlertsSaved={() => void watches.mutate()}
        alertsAvailable={watches.data?.alertsAvailable !== false}
        etsyConnected={connections.has('etsy') !== false}
        go={go}
      />

      <WatchShopModal
        open={modal.open}
        initial={modal.initial}
        onClose={() => setModal({ open: false })}
        mkt={mkt}
        rows={watches.rows}
        quotaReason={blockedReason}
        onAdded={(watch, label, readingSkipped) => {
          // eBay sellers and skipped/failed first readings: no reading was taken today, so never say it was.
          const later = readingSkipped || (watch?.marketplace ?? mkt) !== 'etsy';
          toast.success(t(later ? 'research.shops.addedLater' : 'research.shops.added', { shop: watch?.label ?? label }));
          // Open the new row once the list has it (the `?open=` guard drops ids the list doesn't know).
          void watches.mutate().then(() => {
            if (watch) setOpen(watch.id, 'push');
          });
        }}
        onOpenExisting={(id) => setOpen(id, 'push')}
        onFailed={(kind) => {
          if (kind === 'quota' || kind === 'duplicate' || kind === 'unavailable') void watches.mutate();
        }}
      />

      <CompareListingModal open={compareOpen} onClose={() => setCompareOpen(false)} mkt={openRow?.marketplace === 'ebay' ? 'ebay' : mkt} go={(h) => go(h)} />

      <ConfirmDialog
        open={Boolean(removing)}
        title={t('research.shops.removeTitle', { shop: removing?.label ?? '' })}
        body={t('research.shops.removeBody')}
        confirmLabel={t('research.shops.remove')}
        tone="danger"
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
        data-testid="shops-remove-confirm"
      />
    </ResearchLayout>
  );
}

export default ShopTracker;
