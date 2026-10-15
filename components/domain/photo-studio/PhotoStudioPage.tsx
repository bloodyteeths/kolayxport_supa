// components/domain/photo-studio/PhotoStudioPage.tsx — M7-E PhotoStudio (pro-gating §4, bulk-grid §7 "Edit photos…").
//
//   ← Back
//   Photo studio [24]  Pro                                          [Stage 18 photo changes]
//   24 listings · 18 photo changes staged here · not sent yet
//   (Photos) (Video)
//   ┌ Do [Add ▾] at position [End ▾] from [Upload ▾] [Choose files…]          Applies to 12 selected ┐
//   [⌕ Filter listings /] [Show: All ▾]  ☐ Select all
//   ☑ [48] Personalized Baby Blank…  [1★][2][3][4][5][6][+]                 6 / 20 · 2 need alt text
//
// Pro feature `bulkPhotoStudio` (tiers.md): `FeatureGate placement="page"` renders the studio for Pro / trial /
// unknown entitlements and the locked page otherwise (Stripe: "See plans"; shopify_free: neutral, no plans, no
// prices). The server gate (batch-media 402 featureLocked) swaps the page to locked through the interceptor.
// Header: in the locked state only the title and meta stay (no primary). Trial: `PlanTag` after the title.
// Below 900 px the studio is not offered (bulk-grid §3.4 message). PhotoStudio never sends: it stages, and the
// listings / BulkGrid "Send N changes" picks the drafts up.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Page } from '@/components/ds/page/Page';
import { PageHeader } from '@/components/ds/page/PageHeader';
import { useIsMobile } from '@/components/ds/page/useViewport';
import type { ActionSpec } from '@/components/ds/types/actions';
import { Tabs } from '@/components/ds/inputs/Tabs';
import { Select } from '@/components/ds/inputs/Select';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { PlanTag } from '@/components/ds/data/PlanTag';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { TableSkeleton } from '@/components/ds/state/Skeletons';
import { FeatureGate } from '@/components/domain/billing/FeatureGate';
import { useFeatureAccess } from '@/lib/billing/useFeatureAction';
import { useLimitDialogOptOut } from '@/lib/http/limitInterceptor';
import { icons } from '@/lib/ds/icons';
import { neutral, radius } from '@/lib/ds/tokens';
import { OperationBar } from './OperationBar';
import { ListingStripRow } from './ListingStripRow';
import { PhotoDetailPanel } from './PhotoDetailPanel';
import { VideoOperationBar, VideoRow } from './VideoTab';
import { usePhotoStudio, type RunResult, type StudioFailure, type UndoResult } from './usePhotoStudio';
import { stagingErrorKey, type MediaUndoPlan } from '@/components/domain/listing-editor/stagedMedia';
import {
  AI_BATCH_CAP,
  DEFAULT_PLAN_INPUT,
  STUDIO_FILTERS,
  matchesFilter,
  matchesQuery,
  planBlocker,
  planOperation,
  planVideo,
  topSkipReason,
  type PlanInput,
  type StudioFilter,
  type StudioTab,
  type VideoOp,
  type VideoSource,
} from './studioModel';

export interface PhotoStudioPageProps {
  /** `?shop=`; null = the account's only / default Etsy shop. */
  shopId: string | null;
  ids: string[];
  tab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  /** Where "← Back" returns (the caller with its URL state). */
  backHref: string;
}

const FILTER_KEY: Record<StudioFilter, string> = {
  all: 'filter.all', noPhotos: 'filter.noPhotos', lt5: 'filter.lt5', missingAlt: 'filter.missingAlt',
};

/** Entitlement states in which the studio renders (unknown: the server decides). */
const OPEN_ACCESS = new Set(['allowed', 'trial', 'unknown']);

export function PhotoStudioPage({ shopId, ids, tab, onTabChange, backHref }: PhotoStudioPageProps) {
  const t = useTranslations('photoStudio');
  const mobile = useIsMobile();
  const { access, entitlement } = useFeatureAccess('bulkPhotoStudio');
  const open = OPEN_ACCESS.has(access);
  // 402s on this page (AI credits, the feature gate) are shown inline, never as the global dialog (C6).
  useLimitDialogOptOut();
  const studio = usePhotoStudio({ shopId, ids: open && !mobile ? ids : [] });
  const [header, setHeader] = React.useState<{ primary?: ActionSpec }>({});

  const count = open ? studio.listings.length || ids.length : undefined;
  const meta = !open
    ? undefined
    : studio.progress
      ? t('progress', { done: studio.progress.done, total: studio.progress.total })
      : t('meta', { listings: studio.listings.length || ids.length, count: studio.stagedHere });

  return (
    <Page title={t('title')} width="list" backHref={backHref}>
      <PageHeader
        title={t('title')}
        count={count}
        backHref={backHref}
        backLabel={t('back')}
        titleAdornment={access === 'trial' ? <PlanTag plan="pro" trialEndsAt={entitlement?.trialEndsAt ? new Date(entitlement.trialEndsAt) : undefined} stripeUpsell={entitlement?.stripeUpsell} /> : undefined}
        meta={meta}
        primaryAction={open && !mobile ? header.primary : undefined}
        mobilePrimary="none"
      />
      {mobile ? (
        <EmptyState
          kind="first-use"
          icon={icons.photos}
          title={t('mobileTitle')}
          body={t('mobile')}
          action={{ id: 'back', label: t('back'), href: backHref }}
          data-testid="photo-studio-mobile"
        />
      ) : (
        <FeatureGate feature="bulkPhotoStudio" placement="page" data-testid="photo-studio-gate">
          <StudioBody studio={studio} ids={ids} tab={tab} onTabChange={onTabChange} backHref={backHref} onHeader={setHeader} />
        </FeatureGate>
      )}
    </Page>
  );
}

interface StudioBodyProps {
  studio: ReturnType<typeof usePhotoStudio>;
  ids: string[];
  tab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  backHref: string;
  onHeader: (h: { primary?: ActionSpec }) => void;
}

function StudioBody({ studio, ids, tab, onTabChange, backHref, onHeader }: StudioBodyProps) {
  const t = useTranslations('photoStudio');
  const tEtsy = useTranslations('etsy');
  const tEditor = useTranslations('listingEditor');
  const toast = useToast();
  const confirm = useConfirm();
  const [input, setInput] = React.useState<PlanInput>(DEFAULT_PLAN_INPUT);
  const [files, setFiles] = React.useState<File[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<StudioFilter>('all');
  const [videoOp, setVideoOp] = React.useState<VideoOp>('add');
  const [videoSource, setVideoSource] = React.useState<VideoSource>('upload');
  const [videoFile, setVideoFile] = React.useState<File | null>(null);
  const [videoUrl, setVideoUrl] = React.useState('');
  const [failures, setFailures] = React.useState<StudioFailure[]>([]);
  const [capped, setCapped] = React.useState(0);
  const [panel, setPanel] = React.useState<{ listingId: string; tileId: string } | null>(null);
  const running = Boolean(studio.progress);

  const { listings, photoViews, videoViews, selected, setSelected, loadVideos } = studio;
  React.useEffect(() => { if (tab === 'video') loadVideos(); }, [tab, loadVideos]);

  const selectedRefs = React.useMemo(() => listings.filter((l) => selected.has(l.id)), [listings, selected]);
  const plan = React.useMemo(() => planOperation(input, selectedRefs, photoViews), [input, selectedRefs, photoViews]);
  const videoPlan = React.useMemo(
    () => planVideo(videoOp, videoSource, videoUrl, Boolean(videoFile), selectedRefs, videoViews),
    [videoOp, videoSource, videoUrl, videoFile, selectedRefs, videoViews],
  );
  const blocker = tab === 'photos' ? planBlocker(input, selectedRefs.length) : selectedRefs.length === 0 ? 'noSelection' : null;
  const videoBlocker = tab === 'video' && videoOp === 'add' && (videoSource === 'upload' ? !videoFile : !videoUrl.trim()) ? (videoSource === 'upload' ? 'chooseVideo' : 'enterUrl') : null;
  const changes = tab === 'photos' ? plan.changes : videoPlan.changes;
  const skipped = tab === 'photos' ? plan.skipped : videoPlan.skipped;

  // Server keys are `etsy`-relative (batch-stage sends them with the `etsy.` prefix); a refusal without a key
  // (DRAFT_SENDING / DRAFT_SYNCING / DRAFT_NOT_EDITABLE) still names its translated cause.
  const keyText = React.useCallback((f: StudioFailure | undefined): string | null => {
    const key = stagingErrorKey(f);
    return key && tEtsy.has(key as never) ? tEtsy(key as never, f?.params as never) : null;
  }, [tEtsy]);
  const failureText = React.useCallback((f: StudioFailure | undefined) => keyText(f) ?? t('failure.generic'), [keyText, t]);

  const undoReport = React.useCallback((r: UndoResult) => {
    if (r.ok) toast.success(t('undo.done'));
    else if (r.skipped === 'lastPhoto') toast.info(t('skip.lastPhoto'));
    else if (r.skipped === 'nothing') toast.info(t('undo.nothing'));
    else toast.error(keyText(r.failure) ?? t('undo.failed'), { persist: false });
  }, [toast, t, keyText]);
  /** Every undo ends in a toast: a thrown undo (network) is the "couldn't undo" one, never an unhandled rejection. */
  const reportUndo = React.useCallback((p: Promise<UndoResult>): Promise<void> => (
    p.then(undoReport, () => undoReport({ ok: false }))
  ), [undoReport]);
  const runUndo = React.useCallback((u: { listingId: string; plan: MediaUndoPlan }) => reportUndo(studio.undo(u.listingId, u.plan)), [studio, reportUndo]);

  const report = React.useCallback((res: RunResult, single = false) => {
    if (res.stopped === 'locked') return; // the gate swaps the page to its locked state
    if (res.failures.length) {
      setFailures(res.failures);
      toast.error(single ? failureText(res.failures[0]) : t('result.partial', { staged: res.staged, failed: res.failed }), { persist: false });
    } else if (res.staged > 0) {
      // A single-tile edit can be taken back from its toast (PATCH removeMediaIds; nothing was sent).
      const undo = single ? res.undo : undefined;
      const message = single ? t('tile.staged') : t('result.staged', { count: res.staged });
      if (undo) toast.success(message, { undo: () => { void runUndo(undo); } });
      else toast.success(message);
    } else if (!single && res.stopped !== 'aiCredits') {
      toast.info(t('result.none'));
    }
    if (res.aiUnusable) toast.info(t('result.aiUnusable', { count: res.aiUnusable }));
  }, [toast, t, failureText, runUndo]);

  const run = React.useCallback(async () => {
    if (running) return;
    if (tab === 'photos') {
      if (input.op === 'delete') {
        const ok = await confirm({
          title: t('confirmDelete.title', { position: typeof input.position === 'number' ? input.position : 1, count: plan.listings }),
          body: t('confirmDelete.body'),
          tone: 'danger',
          items: selectedRefs.filter((l) => plan.items.some((i) => i.listingId === l.id)).map((l) => l.title),
          typeToConfirm: plan.listings > 10 ? String(plan.listings) : undefined,
        });
        if (!ok) return;
      }
      setFailures([]);
      setCapped(plan.capped);
      const res = await studio.runPlan(plan, { files, prompt, op: input.op });
      report(res);
      if (res.staged > 0 && (input.source === 'upload' || input.source === 'url')) {
        setFiles([]);
        setInput((i) => ({ ...i, fileCount: 0, url: '' }));
      }
      return;
    }
    if (videoOp === 'remove') {
      const ok = await confirm({
        title: t('video.confirmRemove', { count: videoPlan.items.length }),
        body: t('confirmDelete.body'),
        tone: 'danger',
        typeToConfirm: videoPlan.items.length > 10 ? String(videoPlan.items.length) : undefined,
      });
      if (!ok) return;
    }
    setFailures([]);
    const res = await studio.runVideoPlan(videoPlan, videoFile);
    report(res);
    if (res.staged > 0) { setVideoFile(null); setVideoUrl(''); }
  }, [running, tab, input, plan, selectedRefs, files, prompt, studio, report, confirm, t, videoOp, videoPlan, videoFile]);

  // One primary per view (P1): the header "Stage N photo changes" runs the operation row.
  const disabledReason = blocker ? t(`blocker.${blocker}`) : videoBlocker ? t(`blocker.${videoBlocker}`) : changes === 0 ? t('blocker.nothing') : undefined;
  const primaryKey = `${tab}:${changes}:${plan.credits}:${disabledReason ?? ''}:${running ? studio.progress?.done ?? 0 : -1}`;
  const runRef = React.useRef(run);
  runRef.current = run;
  React.useEffect(() => {
    onHeader({
      primary: studio.load === 'ready' && listings.length > 0 ? {
        id: 'stage',
        label: tab === 'photos'
          ? plan.credits > 0
            ? t('stageWithCredits', { stage: t('stage', { count: changes }), credits: t('credits', { count: plan.credits }) })
            : t('stage', { count: changes })
          : t('video.stage', { count: changes }),
        onClick: () => { void runRef.current(); },
        disabled: Boolean(disabledReason) || running,
        disabledReason: running ? t('blocker.running') : disabledReason,
        loading: running,
        loadingLabel: studio.progress ? t('progress', { done: studio.progress.done, total: studio.progress.total }) : undefined,
      } : undefined,
    });
    // primaryKey covers every displayed field.
  }, [primaryKey, studio.load, listings.length]);
  React.useEffect(() => () => onHeader({}), [onHeader]);

  // ── States ───────────────────────────────────────────────────────────────────────────────────────
  if (!ids.length) {
    return <EmptyState kind="no-results" title={t('empty.title')} body={t('empty.body')} action={{ id: 'back', label: t('empty.back'), href: backHref }} data-testid="photo-studio-empty" />;
  }
  if (studio.load === 'loading') return <TableSkeleton thumb rows={8} data-testid="photo-studio-loading" />;
  if (studio.load === 'notConnected') {
    return <ConnectState brand="etsy" title={tEditor('state.connectTitle')} body={tEditor('state.connectBody')} connectHref="/ayarlar?tab=connections" />;
  }
  if (studio.load === 'error' || studio.load === 'storeNotFound') {
    return <ErrorState variant="page" title={t('error.load')} onRetry={studio.retry} action={{ id: 'back', label: t('empty.back'), href: backHref }} />;
  }
  if (!listings.length) {
    return <EmptyState kind="no-results" title={t('empty.title')} body={t('empty.body')} action={{ id: 'back', label: t('empty.back'), href: backHref }} data-testid="photo-studio-empty" />;
  }

  const visible = listings.filter((l) => matchesQuery(query, l) && (tab === 'video' || matchesFilter(filter, photoViews.get(l.id) ?? null)));
  const selectable = visible.filter((l) => !l.queuedDelete && !l.syncing);
  const allVisibleSelected = selectable.length > 0 && selectable.every((l) => selected.has(l.id));
  const someVisibleSelected = selectable.some((l) => selected.has(l.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    setSelected(next);
  };
  const toggleAll = (on: boolean) => {
    const next = new Set(selected);
    for (const l of selectable) { if (on) next.add(l.id); else next.delete(l.id); }
    setSelected(next);
  };

  // Listings already at 20 photos are always counted on their own (pro-gating §4.3); the other skips share one line.
  const fullCount = tab === 'photos' ? skipped.filter((s) => s.reason === 'full').length : 0;
  const otherSkipped = fullCount ? skipped.filter((s) => s.reason !== 'full') : skipped;
  const skipReason = topSkipReason(otherSkipped);
  const summaryParts: string[] = [];
  if (blocker || videoBlocker) {
    summaryParts.push(blocker ? t(`blocker.${blocker}`) : t(`blocker.${videoBlocker}`));
  } else {
    summaryParts.push(changes > 0
      ? t('summary', { changes, listings: tab === 'photos' ? plan.listings : videoPlan.items.length + videoPlan.uploads.length })
      : t('blocker.nothing'));
    if (tab === 'photos' && plan.credits > 0) summaryParts.push(t('credits', { count: plan.credits }));
    if (fullCount) summaryParts.push(t('full', { count: fullCount }));
    if (otherSkipped.length && skipReason) summaryParts.push(t('skipped', { count: otherSkipped.length, reason: t(`skip.${skipReason}`) }));
  }
  const summary = summaryParts.join(' · ');

  // ── Single-tile edits (stage at once) ─────────────────────────────────────────────────────────────
  const onDeleteTile = async (listingId: string, tileId: string) => {
    const view = photoViews.get(listingId);
    const index = view ? view.tiles.findIndex((x) => x.id === tileId) : -1;
    const tile = index >= 0 && view ? view.tiles[index] : null;
    if (!tile || !view) return;
    // A new photo only lives in the draft: removing it un-stages its upload (no confirm, nothing on Etsy changes).
    if (tile.pending) { await reportUndo(studio.undoTile(listingId, tileId)); return; }
    if (view.liveCount <= 1) { toast.info(t('skip.lastPhoto')); return; }
    const ok = await confirm({ title: tEditor('photos.confirmRemoveTitle', { position: index + 1 }), body: tEditor('photos.confirmRemoveBody', { marketplace: 'Etsy' }), tone: 'danger' });
    if (!ok) return;
    report(await studio.removeTile(listingId, tileId), true);
  };
  const onReorder = async (listingId: string, nextIds: string[]) => {
    const res = await studio.reorder(listingId, nextIds);
    if (res === 'pending') { toast.info(tEditor('photos.pendingReorder', { marketplace: 'Etsy' })); return; }
    report(res, true);
  };
  const panelListing = panel ? listings.find((l) => l.id === panel.listingId) ?? null : null;
  const panelView = panel ? photoViews.get(panel.listingId) ?? null : null;
  const panelReadOnly = Boolean(panelListing?.queuedDelete || panelListing?.syncing || running);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="photo-studio">
      <Tabs<StudioTab>
        value={tab}
        onChange={onTabChange}
        tabs={[{ value: 'photos', label: t('tabs.photos') }, { value: 'video', label: t('tabs.video') }]}
        aria-label={t('title')}
      />
      {studio.aiCreditsOut ? <Banner tone="warning" title={t('aiCredits')} data-testid="photo-studio-ai-credits" /> : null}
      {failures.length ? (
        <Banner tone="danger" title={t('failures.banner', { count: new Set(failures.map((f) => f.listingId)).size })} data-testid="photo-studio-failures">
          {failureText(failures[0])}
        </Banner>
      ) : null}
      {capped > 0 ? <Banner tone="info" title={t('capped', { cap: AI_BATCH_CAP })} /> : null}

      {tab === 'photos' ? (
        <OperationBar
          input={input}
          onChange={setInput}
          files={files}
          onFiles={setFiles}
          prompt={prompt}
          onPrompt={setPrompt}
          copySources={listings.filter((l) => (photoViews.get(l.id)?.liveCount ?? 0) > 0).map((l) => ({ id: l.id, title: l.title }))}
          selectedCount={selectedRefs.length}
          summary={summary}
          disabled={running}
        />
      ) : (
        <VideoOperationBar
          op={videoOp}
          onOp={setVideoOp}
          source={videoSource}
          onSource={setVideoSource}
          file={videoFile}
          onFile={setVideoFile}
          url={videoUrl}
          onUrl={setVideoUrl}
          selectedCount={selectedRefs.length}
          summary={summary}
          disabled={running}
          onRejected={() => toast.error(t('video.rejected'))}
        />
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
        <SearchField value={query} onChange={setQuery} placeholder={t('filter.placeholder')} />
        {tab === 'photos' ? (
          <Box sx={{ width: 220 }}>
            <Select<StudioFilter>
              value={filter}
              onChange={setFilter}
              options={STUDIO_FILTERS.map((f) => ({ value: f, label: `${t('filter.label')}: ${t(FILTER_KEY[f])}` }))}
              size="sm"
              aria-label={t('filter.label')}
              data-testid="photo-studio-filter"
            />
          </Box>
        ) : null}
        <Checkbox
          checked={allVisibleSelected}
          indeterminate={!allVisibleSelected && someVisibleSelected}
          onChange={toggleAll}
          label={t('selectAll')}
          disabled={selectable.length === 0}
          data-testid="photo-studio-select-all"
        />
      </Box>

      <Box role="table" aria-label={t('title')} sx={{ border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`, overflow: 'hidden' }}>
        {visible.length === 0 ? (
          <EmptyState kind="no-results" compact title={t('noMatch')} />
        ) : tab === 'photos' ? (
          visible.map((l) => (
            <ListingStripRow
              key={l.id}
              listing={l}
              view={photoViews.get(l.id) ?? null}
              status={studio.imageStatus.get(l.id) ?? 'loading'}
              checked={selected.has(l.id)}
              onCheck={(on) => toggle(l.id, on)}
              onReorder={(next) => { void onReorder(l.id, next); }}
              onUpload={(list) => { void studio.addFiles(l.id, list).then((r) => report(r, true)); }}
              onDelete={(tileId) => { void onDeleteTile(l.id, tileId); }}
              onUndoDelete={(tileId) => { void reportUndo(studio.undoTile(l.id, tileId)); }}
              onUndoOrder={() => { void reportUndo(studio.undoOrder(l.id)); }}
              onOpen={(tileId) => setPanel({ listingId: l.id, tileId })}
              busy={running}
            />
          ))
        ) : (
          visible.map((l) => (
            <VideoRow
              key={l.id}
              listing={l}
              view={videoViews.get(l.id) ?? null}
              status={studio.videoStatus.get(l.id)}
              checked={selected.has(l.id)}
              onCheck={(on) => toggle(l.id, on)}
              onRemove={() => {
                void (async () => {
                  const ok = await confirm({ title: t('video.confirmRemove', { count: 1 }), body: t('confirmDelete.body'), tone: 'danger' });
                  if (ok) report(await studio.removeVideo(l.id), true);
                })();
              }}
              onAddFile={(file) => { void studio.addVideoFile(l.id, file).then((r) => report(r, true)); }}
              onUndo={() => { void reportUndo(studio.undoVideo(l.id)); }}
              busy={running}
            />
          ))
        )}
      </Box>
      <Box sx={{ fontSize: 13, color: neutral[500] }}>{t('footer', { from: visible.length ? 1 : 0, to: visible.length, total: listings.length })}</Box>

      <PhotoDetailPanel
        open={Boolean(panel)}
        onClose={() => setPanel(null)}
        view={panelView}
        tileId={panel?.tileId ?? null}
        onNavigate={(tileId) => setPanel((p) => (p ? { ...p, tileId } : p))}
        readOnly={panelReadOnly}
        onSaveAlt={async (alt) => {
          if (!panel) return;
          const res = await studio.saveAlt(panel.listingId, panel.tileId, alt);
          report(res, true);
          if (res.failures.length) throw new Error('stage failed');
        }}
        onWriteAlt={() => (panel ? studio.writeAlt(panel.listingId, panel.tileId) : Promise.reject(new Error('no photo')))}
        onMakePrimary={() => {
          if (!panel) return;
          const { listingId, tileId } = panel;
          void studio.makePrimary(listingId, tileId).then((res) => {
            if (res === 'pending') toast.info(tEditor('photos.pendingReorder', { marketplace: 'Etsy' }));
            else report(res, true);
          });
          setPanel(null);
        }}
        onReplace={async (file) => {
          if (!panel) return;
          report(await studio.replaceTile(panel.listingId, panel.tileId, file), true);
          setPanel(null);
        }}
        onRemove={() => {
          if (!panel) return;
          const { listingId, tileId } = panel;
          setPanel(null);
          void onDeleteTile(listingId, tileId);
        }}
        onUndoRemove={() => {
          if (!panel) return;
          void reportUndo(studio.undoTile(panel.listingId, panel.tileId));
        }}
      />
    </Box>
  );
}

export default PhotoStudioPage;
