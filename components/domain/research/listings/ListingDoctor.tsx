// components/domain/research/listings/ListingDoctor.tsx — Listing doctor (research.md §7, R1-D).
// "Why isn't my listing selling, and what do I fix first?" — the user's own listings sorted by opportunity
// (server: lib/research/opportunity.ts), each with its ScorePanel checks and the peer comparison.
//
// Composition: Toolbar (search · Shop · Issue · Health · Sort) → DataTable (cards < 900) → DoctorPanel
// (`?open=`). Primary = "Stage N fixes" (selection bulk bar or the open panel): it STAGES drafts, never sends;
// the listings page's "Send N changes" picks them up (research §3.4). Bulk AI titles go to BulkGrid as dirty
// cells (M7), never straight into drafts.
//
// States (research §7.4, §3.6): not connected → ConnectState · connected, never pulled → first-use "Bring in
// your listings first" · filtered empty → no-results · every listing ≥ 75 → done · 15 s slow · 30 s error ·
// stale data + ErrorState stale · Etsy budget → info Banner (cached peers), never an error page.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { Toolbar } from '@/components/ds/toolbar/Toolbar';
import { FilterButton } from '@/components/ds/toolbar/FilterButton';
import type { FilterDef, FilterValues } from '@/components/ds/toolbar/types';
import { DataTable, type DataTableState, type PageSize } from '@/components/ds/data';
import { useDsFormat } from '@/components/ds/data/fmt';
import { SplitButton } from '@/components/ds/inputs/SplitButton';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { CardListSkeleton, TableSkeleton } from '@/components/ds/state/Skeletons';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { ApiSourceNote } from '@/components/domain/research/products/ApiSourceNote';
import { etsyConfig } from '@/components/domain/listings/config/etsy';
import { useUrlState } from '@/lib/ds/useUrlState';
import { icons } from '@/lib/ds/icons';
import { useConnections } from '@/lib/hooks/useConnections';
import { useEntitlement } from '@/lib/billing/useEntitlement';
import type { ResearchMkt } from '@/lib/research/types';
import {
  fetchDoctorPeers,
  isBudgetError,
  ResearchHttpError,
  useDoctorList,
  useDoctorStaging,
  type DoctorRow,
} from '@/lib/research/hooks/useDoctor';
import { DoctorPanel } from './DoctorPanel';
import { doctorColumns, type DoctorT } from './doctorColumns';
import {
  DOCTOR_HEALTH_BANDS,
  DOCTOR_SORTS,
  DOCTOR_URL_SCHEMA,
  bulkGridHref,
  hasDoctorFilters,
  isDoctorMkt,
  issueIdsFor,
  notSentHref,
  proposalsToPatch,
  suggestedPriceProposal,
  type DoctorHealthBand,
  type DoctorMkt,
  type DoctorUrlState,
} from './doctorModel';

export type ListingDoctorProps = {
  /** From ResearchLayout's `useResearchMkt('listings')`. */
  mkt: ResearchMkt;
  /** Switch the hub marketplace (the "not available here" state offers Etsy). */
  onMktChange?: (mkt: ResearchMkt) => void;
  /** Test seam for navigation. */
  navigate?: (href: string, opts?: { newTab?: boolean }) => void;
};

/**
 * Max listings per bulk "Apply suggested prices" run. One peers read each (a cold one is a live Etsy search);
 * the peers route allows 30 reads / 60 s per user and the open panel shares that bucket, so a run stays below it.
 */
export const BULK_PRICE_MAX = 25;
/** Parallel peers reads in a bulk run (small, so the progress label moves and the Etsy budget is not spiked). */
export const BULK_PRICE_CONCURRENCY = 3;
const MKT_NAME: Record<DoctorMkt, string> = { etsy: 'Etsy', ebay: 'eBay' };

export function ListingDoctor({ mkt, onMktChange, navigate }: ListingDoctorProps) {
  if (!isDoctorMkt(mkt)) {
    return <DoctorUnavailable onEtsy={onMktChange ? () => onMktChange('etsy') : undefined} />;
  }
  return <DoctorForMkt mkt={mkt} navigate={navigate} />;
}

function DoctorUnavailable({ onEtsy }: { onEtsy?: () => void }) {
  const t = useTranslations('research.doc');
  return (
    <EmptyState
      kind="no-results"
      title={t('unavailableMkt')}
      body={t('unavailableMktBody')}
      action={onEtsy ? { id: 'doctor-use-etsy', label: t('useEtsy'), onClick: onEtsy } : undefined}
      data-testid="doctor-unavailable"
    />
  );
}

function DoctorForMkt({ mkt, navigate }: { mkt: DoctorMkt; navigate?: ListingDoctorProps['navigate'] }) {
  const root = useTranslations() as unknown as DoctorT;
  const t = useTranslations('research.doc');
  const fmt = useDsFormat();
  const toast = useToast();
  const mobile = useIsMobile();
  const entitlement = useEntitlement();
  const photoStudio = Boolean(entitlement.data?.features.bulkPhotoStudio);
  const connections = useConnections();
  const connected = connections.has(mkt);

  const [url, setUrl] = useUrlState(DOCTOR_URL_SCHEMA);
  const query = React.useMemo(
    () =>
      connected === false
        ? null
        : {
            mkt,
            shop: url.shop,
            sort: url.sort,
            issue: url['f.issue'],
            health: url['f.health'],
            q: url.q,
            page: url.page,
            size: url.size,
          },
    [connected, mkt, url],
  );
  const list = useDoctorList(query);
  const data = list.data;
  const rows = list.rows;
  const shopId = url.shop ?? data?.store?.id ?? null;

  // ── selection (kept while the filters stay the same) ────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const filterKey = `${mkt}|${url.shop ?? ''}|${url.q ?? ''}|${url['f.issue'] ?? ''}|${url['f.health'] ?? ''}|${url.sort}`;
  React.useEffect(() => setSelectedIds([]), [filterKey]);
  const knownRows = React.useRef(new Map<string, DoctorRow>());
  rows.forEach((r) => knownRows.current.set(r.listing.id, r));

  // ── staging ──────────────────────────────────────────────────────────────────────────────────────────
  const currencyOf = React.useCallback((id: string) => knownRows.current.get(id)?.listing.price?.currency, []);
  const { stageMany } = useDoctorStaging({ mkt, shopId, currencyOf });
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkProgress, setBulkProgress] = React.useState<{ done: number; total: number } | null>(null);
  const bulkCancel = React.useRef(false);
  // Suggested prices compare against Etsy peers; peers are Etsy only in R1 (research §10).
  const pricesAvailable = mkt === 'etsy';
  const router = useRouter();
  const go = React.useCallback(
    (href: string, opts?: { newTab?: boolean }) => {
      if (navigate) return navigate(href, opts);
      if (opts?.newTab) window.open(href, '_blank', 'noopener,noreferrer');
      else void router.push(href);
    },
    [navigate, router],
  );

  const applySuggestedPrices = React.useCallback(async () => {
    const picked = selectedIds.map((id) => knownRows.current.get(id)).filter((r): r is DoctorRow => Boolean(r));
    if (!pricesAvailable || !picked.length || bulkBusy) return;
    const batch = picked.slice(0, BULK_PRICE_MAX);
    const overLimit = picked.length - batch.length;
    bulkCancel.current = false;
    setBulkBusy(true);
    setBulkProgress({ done: 0, total: batch.length });
    try {
      const items: { id: string; patch: ReturnType<typeof proposalsToPatch> }[] = [];
      let skipped = 0; // checked, no suggested price fits
      let notChecked = 0; // never read (rate limit, error, stopped)
      let rateLimited = false;
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < batch.length) {
          if (rateLimited || bulkCancel.current) return;
          const r = batch[next++];
          try {
            const res = await fetchDoctorPeers(r.listing.id, { shop: shopId });
            const p = res.data ? suggestedPriceProposal(r.listing, res.data.peers, res.data.checks) : null;
            if (p) items.push({ id: r.listing.id, patch: proposalsToPatch([p]) });
            else skipped += 1;
          } catch (err) {
            if (err instanceof ResearchHttpError && err.status === 429) rateLimited = true;
            notChecked += 1;
          }
          done += 1;
          setBulkProgress({ done, total: batch.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(BULK_PRICE_CONCURRENCY, batch.length) }, worker));
      notChecked += batch.length - done; // left unread after a 429 or Stop

      if (items.length) {
        const out = await stageMany(items);
        if (out.staged.length) {
          toast.info(t('bulk.staged', { count: out.staged.length, skipped: skipped + out.failed.length }), {
            action: { label: t('goToListings'), onClick: () => go(notSentHref(mkt, shopId)) },
          });
          setSelectedIds([]);
          void list.mutate();
        } else {
          toast.error(t('stageFailed'), { persist: false });
        }
      } else if (!notChecked && !overLimit) {
        toast.info(t('bulk.nothingToStage'));
      }
      // Listings that were never checked are reported apart from "no change needed".
      if (notChecked) toast.info(t(rateLimited ? 'bulk.notCheckedRate' : 'bulk.notChecked', { count: notChecked }));
      if (overLimit) toast.info(t('bulk.notCheckedLimit', { count: overLimit, max: BULK_PRICE_MAX }));
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }, [selectedIds, pricesAvailable, bulkBusy, shopId, stageMany, toast, t, go, mkt, list]);

  // ── panel (one at a time; `?open=` keeps the page) ───────────────────────────────────────────────────
  const openId = url.open ?? null;
  const listSettled = list.state === 'ready' || list.state === 'stale' || list.state === 'empty';
  const localOpen = openId ? rows.find((r) => r.listing.id === openId) ?? knownRows.current.get(openId) ?? null : null;
  // Deep link (`?open=<id>` from the Omnibox, research §4) to a listing that is not on this page: look it up by id
  // (the list API matches an exact listing id in `q`) without the page's filters.
  const probeQuery = React.useMemo(
    () => (openId && !localOpen && listSettled && query ? { mkt, shop: query.shop, sort: 'opportunity' as const, q: openId, page: 1, size: 25 } : null),
    [openId, localOpen, listSettled, query, mkt],
  );
  const probe = useDoctorList(probeQuery);
  const probed = openId ? probe.rows.find((r) => r.listing.id === openId) ?? null : null;
  if (probed) knownRows.current.set(probed.listing.id, probed);
  const openRow = localOpen ?? probed;
  const openIndex = openId ? rows.findIndex((r) => r.listing.id === openId) : -1;
  const setOpen = React.useCallback(
    (id: string | undefined, history: 'push' | 'replace' = 'replace') => setUrl((prev) => ({ open: id, page: prev.page }), { history }),
    [setUrl],
  );
  // Settled lookup without the row (or a failed one) → say so and drop the dead `?open=` from the URL.
  const probeMissed = probeQuery !== null && !probed && !probe.isValidating && probe.state !== 'loading' && probe.state !== 'slow';
  React.useEffect(() => {
    if (!probeMissed) return;
    toast.info(t('openNotFound'));
    setOpen(undefined);
  }, [probeMissed, toast, t, setOpen]);

  // ── pull (connected, never pulled) ───────────────────────────────────────────────────────────────────
  const [pulling, setPulling] = React.useState(false);
  const pull = React.useCallback(async () => {
    if (mkt !== 'etsy' || pulling) return;
    setPulling(true);
    try {
      const req = etsyConfig.pull({ storeId: shopId, userId: null });
      const res = await fetch(req.url, { method: req.method, credentials: 'same-origin' });
      if (!res.ok) toast.error(t('pullFailed', { marketplace: MKT_NAME[mkt] }), { persist: false });
      await list.mutate();
    } catch {
      toast.error(t('pullFailed', { marketplace: MKT_NAME[mkt] }), { persist: false });
    } finally {
      setPulling(false);
    }
  }, [mkt, pulling, shopId, toast, t, list]);

  // ── toolbar ──────────────────────────────────────────────────────────────────────────────────────────
  const stores = data?.stores ?? [];
  const filterDefs = React.useMemo<FilterDef[]>(() => {
    const defs: FilterDef[] = [];
    if (stores.length > 1) {
      defs.push({ key: 'shop', label: t('filter.shop'), type: 'select', pinned: true, options: stores.map((s) => ({ value: s.id, label: s.name })) });
    }
    defs.push({
      key: 'issue',
      label: t('filter.issue'),
      type: 'select',
      pinned: true,
      allLabel: t('filter.any'),
      options: issueIdsFor(mkt).map((id) => ({ value: id, label: root(`research.doc.issue.${id}`) })),
    });
    defs.push({
      key: 'health',
      label: t('filter.health'),
      type: 'select',
      pinned: true,
      options: DOCTOR_HEALTH_BANDS.map((b) => ({ value: b, label: t(`filter.healthBand.${b}`) })),
    });
    return defs;
  }, [stores, t, root, mkt]);
  const filterValues: FilterValues = { shop: stores.length > 1 ? url.shop ?? data?.store?.id : undefined, issue: url['f.issue'], health: url['f.health'] };
  const onFilters = (v: FilterValues) => {
    const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
    const patch: Partial<DoctorUrlState> = {
      'f.issue': str(v.issue),
      'f.health': str(v.health) as DoctorHealthBand | undefined,
    };
    if (stores.length > 1) patch.shop = str(v.shop);
    setUrl(patch);
  };
  const clearAll = () => setUrl({ q: undefined, 'f.issue': undefined, 'f.health': undefined });
  const sortButton = (
    <FilterButton
      label={t('sortLabel')}
      value={url.sort}
      required
      options={DOCTOR_SORTS.map((s) => ({ value: s, label: root(`research.doc.sort.${s}`) }))}
      onChange={(v) => {
        const next = Array.isArray(v) ? v[0] : v;
        if (next && (DOCTOR_SORTS as readonly string[]).includes(next)) setUrl({ sort: next as DoctorUrlState['sort'] });
      }}
      data-testid="doctor-sort"
    />
  );

  // ── bulk bar ("6 selected · [Stage fixes ▾] · [Open in BulkGrid] · Clear") ───────────────────────────
  const stageFixesAction = {
    id: 'doctor-bulk-stage',
    label: t('bulk.stageFixes'),
    icon: icons.edit,
    onClick: () => void applySuggestedPrices(),
    loading: bulkBusy,
    loadingLabel: bulkProgress ? t('bulk.checking', { done: bulkProgress.done, total: bulkProgress.total }) : t('staging'),
    disabled: !pricesAvailable,
    disabledReason: pricesAvailable ? undefined : t('bulk.pricesEtsyOnly'),
  };
  const bulkOptions = [
    {
      id: 'doctor-bulk-prices',
      label: t('bulk.applyPrices'),
      onClick: () => void applySuggestedPrices(),
      disabled: bulkBusy || !pricesAvailable,
      disabledReason: pricesAvailable ? undefined : t('bulk.pricesEtsyOnly'),
    },
    { id: 'doctor-bulk-tags', label: t('bulk.addTags'), disabled: true, disabledReason: t('bulk.addTagsSoon') },
    {
      id: 'doctor-bulk-titles',
      label: t('bulk.aiTitles'),
      disabled: mobile,
      disabledReason: mobile ? t('bulk.gridUnavailable') : undefined,
      onClick: () => go(`${bulkGridHref(mkt, selectedIds, shopId)}&ai=title`),
    },
  ];
  const selection =
    selectedIds.length > 0
      ? {
          count: selectedIds.length,
          primarySlot: mobile ? undefined : <SplitButton primary={stageFixesAction} options={bulkOptions} size="sm" data-testid="doctor-bulk-split" />,
          primary: mobile ? stageFixesAction : undefined,
          actions: [
            ...(bulkBusy ? [{ id: 'doctor-bulk-stop', label: t('bulk.stop'), onClick: () => { bulkCancel.current = true; } }] : []),
            ...(!mobile
              ? [{ id: 'doctor-bulk-grid', label: root('research.action.openBulkGrid'), icon: icons.columns, onClick: () => go(bulkGridHref(mkt, selectedIds, shopId)) }]
              : []),
          ],
          overflow: mobile ? bulkOptions : undefined,
          onClear: () => setSelectedIds([]),
          'data-testid': 'doctor-bulk-bar',
        }
      : undefined;

  // ── states ───────────────────────────────────────────────────────────────────────────────────────────
  if (connected === false || (data && data.connected === false)) {
    return (
      <ConnectState
        brand={mkt}
        title={root('ui.connectEmpty.title', { name: MKT_NAME[mkt] })}
        body={t('connectBody', { marketplace: MKT_NAME[mkt] })}
        actionLabel={root('ui.connectEmpty.cta', { name: MKT_NAME[mkt] })}
        connectHref="/ayarlar?tab=connections"
        data-testid="doctor-connect"
      />
    );
  }

  const filtered = hasDoctorFilters(url);
  const neverPulled = Boolean(data && data.total === 0 && !filtered && data.store && data.store.lastPulledAt === null);
  const emptyRegion = list.state === 'empty' || (list.state === 'ready' && rows.length === 0);
  const allGood =
    !filtered && url.page === 1 && rows.length > 0 && (list.state === 'ready' || list.state === 'stale') &&
    rows.every((r) => r.issues === 0 && (r.listing.health.score ?? 0) >= 75);

  let tableState: DataTableState = 'ready';
  if (list.state === 'loading' || list.state === 'slow') tableState = 'loading';
  else if (list.state === 'error') tableState = 'error';
  else if (emptyRegion) tableState = 'empty';

  const empty = neverPulled || (emptyRegion && !filtered) ? (
    <EmptyState
      kind="first-use"
      title={t('firstUse', { marketplace: MKT_NAME[mkt] })}
      body={t('firstUseBody')}
      action={
        mkt === 'etsy'
          ? { id: 'doctor-pull', label: t('pull', { marketplace: MKT_NAME[mkt] }), icon: icons.pull, onClick: () => void pull(), loading: pulling }
          : { id: 'doctor-open-listings', label: t('openListings', { marketplace: MKT_NAME[mkt] }), href: '/app/ebay-listings' }
      }
      data-testid="doctor-first-use"
    />
  ) : (
    <EmptyState
      kind="no-results"
      title={t('noMatches')}
      body={root('research.empty.broader')}
      action={{ id: 'doctor-clear', label: t('clearFilters'), onClick: clearAll }}
      data-testid="doctor-no-results"
    />
  );

  // Table footer = the source line (research §7.1): the spec caption once the daily stats have a timestamp,
  // otherwise the API's SourceNote under the table (a <p> cannot nest in the caption <p>).
  const caption = data?.statsUpdatedAt ? t('statsSource', { time: fmt.time(data.statsUpdatedAt) }) : undefined;
  const sourceBelow = !caption && list.source ? <ApiSourceNote source={list.source} data-testid="doctor-source" /> : null;

  const knownTotal = list.state === 'ready' || list.state === 'stale' || list.state === 'empty' ? list.total : undefined;
  const columns = doctorColumns({ t: root, fmt });

  return (
    <Box data-testid="listing-doctor">
      <Toolbar
        search={{ value: url.q ?? '', onChange: (q) => setUrl({ q: q || undefined }), placeholder: t('searchPlaceholder'), debounceMs: 400 }}
        filters={filterDefs}
        values={filterValues}
        onChange={onFilters}
        onClearAll={clearAll}
        trailing={sortButton}
        resultCount={knownTotal}
        resultLabel={list.isValidating && knownTotal === undefined ? undefined : knownTotal !== undefined ? t('resultCount', { count: knownTotal }) : undefined}
        selection={selection}
        data-testid="doctor-toolbar"
      />

      {isBudgetError(list.errors) ? (
        <Box sx={{ mb: '8px' }}>
          <Banner tone="info" title={root('research.error.budget')} data-testid="doctor-budget-banner" />
        </Box>
      ) : null}
      {list.state === 'stale' ? (
        <Box sx={{ mb: '8px' }}>
          <ErrorState variant="stale" onRetry={list.retry} data-testid="doctor-stale" />
        </Box>
      ) : null}
      {allGood ? (
        <Box sx={{ mb: '8px' }}>
          <EmptyState kind="done" compact title={root('research.doc.doneEmpty')} data-testid="doctor-done" />
        </Box>
      ) : null}

      <DataTable<DoctorRow>
        rows={rows}
        columns={columns}
        getRowId={(r) => r.listing.id}
        state={tableState}
        loading={
          list.state === 'slow' ? (
            <SlowState onRetry={list.retry} data-testid="doctor-slow" />
          ) : mobile ? (
            <CardListSkeleton count={6} thumb />
          ) : (
            <TableSkeleton rows={8} thumb />
          )
        }
        empty={tableState === 'empty' ? empty : null}
        error={<ErrorState variant="page" title={t('loadFailed')} onRetry={list.retry} data-testid="doctor-error" />}
        selection={{ ids: selectedIds, onChange: setSelectedIds }}
        onRowOpen={(r) => setOpen(r.listing.id, 'push')}
        rowActions={(r) => [
          { id: 'doctor-open', label: t('openDoctor'), onClick: () => setOpen(r.listing.id, 'push') },
          ...(r.listing.externalUrl
            ? [{ id: 'doctor-row-external', label: t('viewOn', { marketplace: MKT_NAME[mkt] }), icon: icons.externalLink, onClick: () => go(r.listing.externalUrl ?? '', { newTab: true }) }]
            : []),
        ]}
        pagination={
          knownTotal !== undefined && knownTotal > 0
            ? {
                mode: 'pages',
                page: url.page,
                pageSize: url.size as PageSize,
                total: knownTotal,
                onChange: ({ page, pageSize }) => setUrl({ page, size: pageSize }),
              }
            : undefined
        }
        caption={caption}
        columnStateKey={`research.doctor.${mkt}.v1`}
        ariaLabel={root('research.tabs.listings')}
        activeRowId={openId}
        data-testid="doctor-table"
      />
      {sourceBelow ? <Box sx={{ mt: '4px', px: '12px' }}>{sourceBelow}</Box> : null}

      <DoctorPanel
        row={openRow}
        open={Boolean(openRow)}
        mkt={mkt}
        shopId={shopId}
        onClose={() => setOpen(undefined)}
        onPrev={openIndex > 0 ? () => setOpen(rows[openIndex - 1].listing.id) : undefined}
        onNext={openIndex >= 0 && openIndex < rows.length - 1 ? () => setOpen(rows[openIndex + 1].listing.id) : undefined}
        photoStudio={photoStudio}
        stage={stageMany}
        onStaged={() => void list.mutate()}
        navigate={navigate}
      />
    </Box>
  );
}

export default ListingDoctor;
