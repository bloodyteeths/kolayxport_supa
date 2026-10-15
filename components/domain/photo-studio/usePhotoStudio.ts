// components/domain/photo-studio/usePhotoStudio.ts — M7-E PhotoStudio state (pro-gating §4.2–§4.4).
// Loads the selected listings (DB), their Etsy photos (one call per listing, concurrency 4, cached) and the shop's
// staged drafts; runs operation-row plans and single-tile edits by STAGING them (batch-media / single-file
// upload). It never sends: the listings / BulkGrid "Send N changes" picks the drafts up (one push place).
import * as React from 'react';
import { useFeatureLockStore } from '@/lib/http/limitInterceptor';
import type { EtsyImageLike } from '@/components/domain/listing-editor/sections/photosModel';
import {
  AiCreditsError,
  fetchStudioListings,
  FeatureLockedError,
  StudioHttpError,
  fetchListingImages,
  fetchListingVideos,
  fetchShopDrafts,
  generateStudioImage,
  stageBatchMedia,
  stageFile,
  removeStudioMedia,
  writeStudioAlt,
  type AiImageMode,
  type BatchItemResult,
} from './studioApi';
import {
  AI_CONCURRENCY,
  IMAGE_FETCH_CONCURRENCY,
  UPLOAD_CONCURRENCY,
  buildListingPhotoView,
  buildListingVideoView,
  groupByListing,
  makePrimaryOps,
  orderUndoIds,
  reorderTileOps,
  tileUndoIds,
  undoLeavesNoPhoto,
  videoUndoIds,
  runPool,
  type EtsyVideoLike,
  type ListingPhotoView,
  type ListingVideoView,
  type MediaOp,
  type StudioDraft,
  type StudioListingRef,
  type StudioMediaRow,
  type StudioOp,
  type StudioPlan,
  type VideoPlan,
} from './studioModel';
import { currentUndoPlan, isEmptyUndo, isSendingRefusal, mediaUndoPlan, type MediaUndoPlan } from '@/components/domain/listing-editor/stagedMedia';

export type LoadStatus = 'loading' | 'ready' | 'error';
export type StudioLoadState = 'loading' | 'ready' | 'error' | 'notConnected' | 'storeNotFound';

export interface StudioListing extends StudioListingRef {
  thumbUrl: string | null;
}

export interface StudioFailure {
  listingId: string;
  code: string;
  /** i18n key relative to the `etsy` namespace (draft service errors), when the server named one. */
  key?: string;
  params?: Record<string, string | number>;
}

export interface RunProgress {
  done: number;
  total: number;
}

export interface RunResult {
  /** Photo / video changes staged. */
  staged: number;
  /** Listings with at least one failed change. */
  failed: number;
  failures: StudioFailure[];
  /** AI jobs that returned nothing usable. */
  aiUnusable: number;
  /** The run stopped: the plan is not included (server 402) or AI credits ran out. */
  stopped: 'locked' | 'aiCredits' | null;
  /** Single-tile edits that staged cleanly: how to take exactly that change back (the toast's Undo). */
  undo?: { listingId: string; plan: MediaUndoPlan };
}

export interface UndoResult {
  ok: boolean;
  /** Set when the undo was refused or failed (409 DRAFT_SENDING / DRAFT_NOT_EDITABLE carry their key). */
  failure?: StudioFailure;
  /**
   * Nothing was changed on purpose: `nothing` (the change is no longer in the draft, or a later edit of the same
   * photo replaced it) or `lastPhoto` (taking it back would leave no photo while an Etsy photo is staged for removal).
   */
  skipped?: 'nothing' | 'lastPhoto';
}

export interface RunContext {
  files: File[];
  /** AI prompt (Add / Replace with AI) or extra instruction (Improve, Remove background). */
  prompt: string;
  op: StudioOp;
}

const EMPTY_RESULT: RunResult = { staged: 0, failed: 0, failures: [], aiUnusable: 0, stopped: null };

function failureOf(r: Extract<BatchItemResult, { ok: false }>): StudioFailure {
  return { listingId: r.listingId, code: r.code, key: r.key, params: r.params };
}

function clientFailure(listingId: string, err: unknown): StudioFailure {
  if (err && typeof err === 'object' && 'status' in err) {
    const e = err as { code?: string; key?: string; params?: Record<string, string | number>; status: number };
    return { listingId, code: e.code || `HTTP_${e.status}`, key: e.key, params: e.params };
  }
  return { listingId, code: 'STAGE_FAILED' };
}

export interface UsePhotoStudio {
  load: StudioLoadState;
  retry: () => void;
  shop: { id: string; name: string } | null;
  listings: StudioListing[];
  imageStatus: ReadonlyMap<string, LoadStatus>;
  photoViews: ReadonlyMap<string, ListingPhotoView>;
  videoStatus: ReadonlyMap<string, LoadStatus>;
  videoViews: ReadonlyMap<string, ListingVideoView>;
  /** Starts loading videos (the Video tab). */
  loadVideos: () => void;
  selected: ReadonlySet<string>;
  setSelected: (next: ReadonlySet<string>) => void;
  /** Changes staged from this page in this visit. */
  stagedHere: number;
  progress: RunProgress | null;
  /** Out of AI credits (C6 inline Banner above the table). */
  aiCreditsOut: boolean;
  runPlan: (plan: StudioPlan, ctx: RunContext) => Promise<RunResult>;
  runVideoPlan: (plan: VideoPlan, file: File | null) => Promise<RunResult>;
  /** Single-tile edits stage at once. */
  reorder: (listingId: string, nextIds: string[]) => Promise<RunResult | 'pending'>;
  makePrimary: (listingId: string, tileId: string) => Promise<RunResult | 'pending'>;
  removeTile: (listingId: string, tileId: string) => Promise<RunResult>;
  saveAlt: (listingId: string, tileId: string, alt: string) => Promise<RunResult>;
  replaceTile: (listingId: string, tileId: string, file: File) => Promise<RunResult>;
  addFiles: (listingId: string, files: File[]) => Promise<RunResult>;
  removeVideo: (listingId: string) => Promise<RunResult>;
  addVideoFile: (listingId: string, file: File) => Promise<RunResult>;
  writeAlt: (listingId: string, tileId: string) => Promise<string>;
  /** Undo (PATCH removeMediaIds, then re-stage replaced reorder / alt rows). Never sends. */
  undo: (listingId: string, plan: MediaUndoPlan) => Promise<UndoResult>;
  /** Takes back one tile's staged upload or staged removal. */
  undoTile: (listingId: string, tileId: string) => Promise<UndoResult>;
  /** Drops the listing's staged reorders (Etsy order again). */
  undoOrder: (listingId: string) => Promise<UndoResult>;
  /** Takes back the staged video upload or video removal. */
  undoVideo: (listingId: string) => Promise<UndoResult>;
}

export function usePhotoStudio({ shopId, ids }: { shopId: string | null; ids: string[] }): UsePhotoStudio {
  const idsKey = ids.join(',');
  const [nonce, setNonce] = React.useState(0);
  const [load, setLoad] = React.useState<StudioLoadState>('loading');
  /** Which `shop:ids:nonce` the current `load` belongs to (a new selection is 'loading' from its first render). */
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  const loadKey = `${shopId ?? ''}:${idsKey}:${nonce}`;
  const [shop, setShop] = React.useState<{ id: string; name: string } | null>(null);
  const [listings, setListings] = React.useState<StudioListing[]>([]);
  const [images, setImages] = React.useState<Map<string, EtsyImageLike[]>>(new Map());
  const [imageStatus, setImageStatus] = React.useState<Map<string, LoadStatus>>(new Map());
  const [videos, setVideos] = React.useState<Map<string, EtsyVideoLike[]>>(new Map());
  const [videoStatus, setVideoStatus] = React.useState<Map<string, LoadStatus>>(new Map());
  const [videosWanted, setVideosWanted] = React.useState(false);
  const [drafts, setDraftsState] = React.useState<Map<string, StudioDraft>>(new Map());
  // Synchronous mirror: an undo plan compares a listing's rows before / after one staging call.
  const draftsRef = React.useRef<Map<string, StudioDraft>>(drafts);
  const setDrafts = React.useCallback((next: Map<string, StudioDraft> | ((m: Map<string, StudioDraft>) => Map<string, StudioDraft>)) => {
    draftsRef.current = typeof next === 'function' ? next(draftsRef.current) : next;
    setDraftsState(draftsRef.current);
  }, []);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [stagedHere, setStagedHere] = React.useState(0);
  const [progress, setProgress] = React.useState<RunProgress | null>(null);
  const [aiCreditsOut, setAiCreditsOut] = React.useState(false);
  const cancel = React.useRef({ cancelled: false });

  React.useEffect(() => {
    const signal = { cancelled: false };
    cancel.current = signal;
    return () => { signal.cancelled = true; };
  }, []);

  // ── Load listings + drafts, then photos (per row) ─────────────────────────────────────────────────
  React.useEffect(() => {
    let dead = false;
    setLoad('loading');
    setImages(new Map());
    setImageStatus(new Map());
    setVideos(new Map());
    setVideoStatus(new Map());
    const list = idsKey ? idsKey.split(',') : [];
    const done = (state: StudioLoadState) => { setLoad(state); setLoadedFor(loadKey); };
    if (!list.length) {
      setListings([]);
      done('ready');
      return undefined;
    }
    void (async () => {
      try {
        const res = await fetchStudioListings(shopId, list);
        if (dead) return;
        const storeId = res.store?.id ? String(res.store.id) : shopId;
        if (!storeId) { done('notConnected'); return; }
        setShop({ id: storeId, name: res.store?.name ?? storeId });
        const rows: StudioListing[] = res.rows.map((r) => ({
          id: r.id,
          title: r.title,
          thumbUrl: r.thumbUrl,
          queuedDelete: Boolean(r.sync?.queuedDelete),
          syncing: r.sync?.status === 'syncing',
        }));
        setListings(rows);
        setSelected(new Set(rows.filter((r) => !r.queuedDelete && !r.syncing).map((r) => r.id)));
        const draftMap = await fetchShopDrafts(storeId).catch(() => new Map<string, StudioDraft>());
        if (dead) return;
        setDrafts(draftMap);
        done('ready');
        setImageStatus(new Map(rows.map((r) => [r.id, 'loading' as LoadStatus])));
        await runPool(rows, IMAGE_FETCH_CONCURRENCY, async (row) => {
          try {
            const imgs = await fetchListingImages(storeId, row.id);
            if (dead) return;
            setImages((m) => new Map(m).set(row.id, imgs));
            setImageStatus((m) => new Map(m).set(row.id, 'ready'));
          } catch {
            if (!dead) setImageStatus((m) => new Map(m).set(row.id, 'error'));
          }
        });
      } catch (err) {
        if (dead) return;
        if (err instanceof StudioHttpError && err.code === 'not_connected') done('notConnected');
        else if (err instanceof StudioHttpError && err.code === 'store_not_found') done('storeNotFound');
        else done('error');
      }
    })();
    return () => { dead = true; };
    // loadKey is derived from these three.
  }, [shopId, idsKey, nonce]);

  // ── Videos (lazy: only when the Video tab is opened) ─────────────────────────────────────────────
  const listingIdsKey = listings.map((l) => l.id).join(',');
  React.useEffect(() => {
    if (!videosWanted || !shop || !listingIdsKey) return undefined;
    let dead = false;
    const rows = listingIdsKey.split(',');
    setVideoStatus(new Map(rows.map((id) => [id, 'loading' as LoadStatus])));
    void runPool(rows, IMAGE_FETCH_CONCURRENCY, async (id) => {
      try {
        const v = await fetchListingVideos(shop.id, id);
        if (dead) return;
        setVideos((m) => new Map(m).set(id, v));
        setVideoStatus((m) => new Map(m).set(id, 'ready'));
      } catch {
        if (!dead) setVideoStatus((m) => new Map(m).set(id, 'error'));
      }
    });
    return () => { dead = true; };
  }, [videosWanted, shop, listingIdsKey]);

  const photoViews = React.useMemo(() => {
    const out = new Map<string, ListingPhotoView>();
    for (const l of listings) {
      const imgs = images.get(l.id);
      if (imgs) out.set(l.id, buildListingPhotoView(imgs, drafts.get(l.id)));
    }
    return out;
  }, [listings, images, drafts]);

  const videoViews = React.useMemo(() => {
    const out = new Map<string, ListingVideoView>();
    for (const l of listings) {
      const v = videos.get(l.id);
      if (v) out.set(l.id, buildListingVideoView(v, drafts.get(l.id)));
    }
    return out;
  }, [listings, videos, drafts]);

  // Latest views for the async runners (closures would otherwise see the views of the render that started them).
  const viewsRef = React.useRef(photoViews);
  viewsRef.current = photoViews;
  const imagesRef = React.useRef(images);
  imagesRef.current = images;
  const videoViewsRef = React.useRef(videoViews);
  videoViewsRef.current = videoViews;
  const listingsRef = React.useRef(listings);
  listingsRef.current = listings;

  // ── Draft bookkeeping ───────────────────────────────────────────────────────────────────────────
  const applyBatchResult = React.useCallback((r: BatchItemResult) => {
    if (!r.ok) return;
    setDrafts((m) => {
      const prev = m.get(r.listingId);
      return new Map(m).set(r.listingId, { id: r.draftId, listingId: r.listingId, status: r.status, media: r.media, queuedDelete: prev?.queuedDelete ?? false });
    });
  }, [setDrafts]);

  const appendMedia = React.useCallback((listingId: string, draftId: string, row: StudioMediaRow | null) => {
    if (!row) return;
    setDrafts((m) => {
      const prev = m.get(listingId);
      const media = [...(prev?.media ?? []).filter((x) => x.id !== row.id), row];
      return new Map(m).set(listingId, { id: prev?.id ?? draftId, listingId, status: prev?.status === 'conflict' ? 'conflict' : 'draft', media, queuedDelete: prev?.queuedDelete ?? false });
    });
  }, [setDrafts]);

  /** A listing whose draft is being sent: read-only and out of the selection until the page reloads. */
  const markSending = React.useCallback((failures: ReadonlyArray<StudioFailure>) => {
    const ids = new Set(failures.filter((f) => isSendingRefusal(f)).map((f) => f.listingId));
    if (!ids.size) return;
    setListings((ls) => ls.map((l) => (ids.has(l.id) ? { ...l, syncing: true } : l)));
    setSelected((sel) => {
      if (![...ids].some((id) => sel.has(id))) return sel;
      const next = new Set(sel);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const markLocked = React.useCallback(() => {
    useFeatureLockStore.getState().markLocked({ feature: 'bulkPhotoStudio', at: Date.now() });
  }, []);

  /** Stages ops for many listings; counts per listing. */
  const stageOps = React.useCallback(async (
    items: { listingId: string; media: MediaOp[] }[],
    tick: () => void,
  ): Promise<{ okListings: Set<string>; failures: StudioFailure[]; staged: number; locked: boolean }> => {
    const okListings = new Set<string>();
    const failures: StudioFailure[] = [];
    let staged = 0;
    let locked = false;
    const countOf = new Map<string, number>();
    for (const i of items) countOf.set(i.listingId, (countOf.get(i.listingId) ?? 0) + i.media.filter((m) => !(m.operation === 'delete' && i.media.some((o) => o.operation === 'upload'))).length);
    if (!shop || !items.length) return { okListings, failures, staged, locked };
    try {
      await stageBatchMedia(shop.id, items, (r) => {
        tick();
        if (r.ok) {
          okListings.add(r.listingId);
          applyBatchResult(r);
        } else failures.push(failureOf(r));
      }, cancel.current);
    } catch (err) {
      if (err instanceof FeatureLockedError) { locked = true; markLocked(); } else throw err;
    }
    for (const id of okListings) staged += countOf.get(id) ?? 0;
    return { okListings, failures, staged, locked };
  }, [shop, applyBatchResult, markLocked]);

  const finish = React.useCallback((res: RunResult): RunResult => {
    setProgress(null);
    markSending(res.failures);
    if (res.staged) setStagedHere((n) => n + res.staged);
    if (res.stopped === 'aiCredits') setAiCreditsOut(true);
    return res;
  }, [markSending]);

  // ── Per-listing write order ─────────────────────────────────────────────────────────────────────
  // Two writes to one listing's draft must never run at the same time (a listing without a draft would get two).
  // Single-tile edits queue per listing and behind a running plan; a plan waits for queued tile edits.
  const chains = React.useRef(new Map<string, Promise<void>>());
  const planRun = React.useRef<Promise<void>>(Promise.resolve());
  const serial = React.useCallback(<T,>(listingId: string, fn: () => Promise<T>): Promise<T> => {
    const prev = chains.current.get(listingId) ?? Promise.resolve();
    const next = Promise.all([prev, planRun.current]).then(fn);
    const settled = next.then(() => undefined, () => undefined);
    chains.current.set(listingId, settled);
    void settled.then(() => { if (chains.current.get(listingId) === settled) chains.current.delete(listingId); });
    return next;
  }, []);
  const asPlan = React.useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = Promise.all([planRun.current, ...Array.from(chains.current.values())]).then(fn);
    planRun.current = p.then(() => undefined, () => undefined);
    return p;
  }, []);

  /**
   * Stages image files, one listing per pool slot, the files of a listing one after another. Returns the
   * uploads that were staged (Replace / AI edits stage the old photo's delete only for those).
   */
  const stageImageFiles = React.useCallback(async <U extends { listingId: string }>(
    jobs: ReadonlyArray<U>,
    fileOf: (job: U) => File | undefined,
    rankOf: (job: U) => number,
    operation: 'upload' | 'ai_upload',
    onDone: (ok: boolean, job: U, err?: unknown) => void,
  ): Promise<U[]> => {
    const ok: U[] = [];
    if (!shop) return ok;
    await runPool(groupByListing(jobs), UPLOAD_CONCURRENCY, async (group) => {
      for (const job of group) {
        if (cancel.current.cancelled) return;
        try {
          const file = fileOf(job);
          if (!file) throw new Error('no file');
          const r = await stageFile({ shopId: shop.id, listingId: job.listingId, file, kind: 'image', operation, rank: rankOf(job) });
          appendMedia(job.listingId, r.draftId, r.media);
          ok.push(job);
          onDone(true, job);
        } catch (err) {
          onDone(false, job, err);
        }
      }
    }, cancel.current);
    return ok;
  }, [shop, appendMedia]);

  // ── Operation-row run ───────────────────────────────────────────────────────────────────────────
  const runPlanNow = React.useCallback(async (plan: StudioPlan, ctx: RunContext): Promise<RunResult> => {
    if (!shop) return EMPTY_RESULT;
    const altJobs = plan.ai.filter((a) => a.kind === 'alt').length;
    // AI images tick twice (generate + stage), AI alt text once (generate; its staging is one batch).
    const total = plan.items.length + plan.uploads.length + (plan.ai.length - altJobs) * 2 + altJobs;
    let done = 0;
    const tick = () => { done += 1; setProgress({ done: Math.min(done, total), total }); };
    setProgress({ done: 0, total });
    const failures: StudioFailure[] = [];
    let staged = 0;
    let aiUnusable = 0;
    let stopped: RunResult['stopped'] = null;
    const failedListing = new Set<string>();
    const fail = (f: StudioFailure) => { failures.push(f); failedListing.add(f.listingId); };
    const locked = () => finish({ staged, failed: failedListing.size, failures, aiUnusable, stopped: 'locked' });
    /** Replace-type edits: the old photo's delete is staged only once its new photo is staged (the send uploads
     *  before it deletes), so a failed or cancelled upload never leaves a delete without a replacement. A
     *  replace counts as one change (the upload); its delete is not counted again. */
    const stageReplaceDeletes = async (pairs: { listingId: string; imageId: number }[]): Promise<boolean> => {
      if (!pairs.length) return true;
      const del = await stageOps(pairs.map((p) => ({ listingId: p.listingId, media: [{ kind: 'image' as const, operation: 'delete' as const, etsyMediaId: p.imageId }] })), () => undefined);
      del.failures.forEach(fail);
      return !del.locked;
    };

    // 1. Media ops (URL uploads, deletes, reorders, manual alt).
    const opsRes = await stageOps(plan.items, tick);
    staged += opsRes.staged;
    opsRes.failures.forEach(fail);
    if (opsRes.locked) return locked();

    // 2. File uploads, then (Replace) the delete of each replaced photo.
    if (plan.uploads.length) {
      const ok = await stageImageFiles(plan.uploads, (u) => ctx.files[u.fileIndex], (u) => u.rank, 'upload', (good, u, err) => {
        if (good) staged += 1; else fail(clientFailure(u.listingId, err));
        tick();
      });
      const pairs = ok.filter((u) => u.replaceImageId != null).map((u) => ({ listingId: u.listingId, imageId: u.replaceImageId as number }));
      if (!(await stageReplaceDeletes(pairs))) return locked();
    }

    // 3. AI jobs: generate / caption first (concurrency 3), then stage in one pass.
    if (plan.ai.length && !stopped) {
      const altOps = new Map<string, MediaOp[]>();
      const images: { listingId: string; job: (typeof plan.ai)[number]; file: File }[] = [];
      const mode: AiImageMode = ctx.op === 'enhance' ? 'enhance' : ctx.op === 'removeBg' ? 'removeBg' : 'generate';
      await runPool(plan.ai, AI_CONCURRENCY, async (job) => {
        if (stopped) { tick(); return; }
        try {
          if (job.kind === 'alt') {
            const text = await writeStudioAlt({ imageUrl: job.refUrl ?? '', title: job.title });
            const list = altOps.get(job.listingId) ?? [];
            list.push({ kind: 'image', operation: 'update_alt', etsyMediaId: job.targetImageId as number, altText: text });
            altOps.set(job.listingId, list);
          } else {
            const refs = [job.refUrl, ...(job.extraRefs ?? [])].filter((u): u is string => Boolean(u));
            const file = await generateStudioImage({ mode, title: job.title, prompt: ctx.prompt, refUrls: refs, listingId: job.listingId });
            images.push({ listingId: job.listingId, job, file });
          }
        } catch (err) {
          if (err instanceof AiCreditsError) stopped = 'aiCredits';
          else aiUnusable += 1;
        } finally {
          tick();
        }
      }, cancel.current);

      if (altOps.size) {
        const r = await stageOps(Array.from(altOps, ([listingId, media]) => ({ listingId, media })), () => undefined);
        staged += r.staged;
        r.failures.forEach(fail);
        if (r.locked) return locked();
      }
      if (images.length) {
        const ok = await stageImageFiles(images, (i) => i.file, (i) => i.job.rank, 'ai_upload', (good, i, err) => {
          if (good) staged += 1; else fail(clientFailure(i.listingId, err));
          tick();
        });
        const pairs = ok.filter((i) => i.job.targetImageId != null).map((i) => ({ listingId: i.listingId, imageId: i.job.targetImageId as number }));
        if (!(await stageReplaceDeletes(pairs))) return locked();
      }
    }
    return finish({ staged, failed: failedListing.size, failures, aiUnusable, stopped });
  }, [shop, stageOps, stageImageFiles, finish]);

  const runPlan = React.useCallback((plan: StudioPlan, ctx: RunContext) => asPlan(() => runPlanNow(plan, ctx)), [asPlan, runPlanNow]);

  const runVideoPlanNow = React.useCallback(async (plan: VideoPlan, file: File | null): Promise<RunResult> => {
    if (!shop) return EMPTY_RESULT;
    const total = plan.items.length + plan.uploads.length;
    let done = 0;
    const tick = () => { done += 1; setProgress({ done: Math.min(done, total), total }); };
    setProgress({ done: 0, total });
    const failures: StudioFailure[] = [];
    const r = await stageOps(plan.items, tick);
    let staged = r.staged;
    failures.push(...r.failures);
    if (r.locked) return finish({ staged, failed: new Set(failures.map((f) => f.listingId)).size, failures, aiUnusable: 0, stopped: 'locked' });
    if (file && plan.uploads.length) {
      // One video per listing (planVideo lists each listing once), so these never share a draft.
      await runPool(plan.uploads, UPLOAD_CONCURRENCY, async (listingId) => {
        try {
          const res = await stageFile({ shopId: shop.id, listingId, file, kind: 'video', operation: 'upload' });
          appendMedia(listingId, res.draftId, res.media);
          staged += 1;
        } catch (err) {
          failures.push(clientFailure(listingId, err));
        } finally {
          tick();
        }
      }, cancel.current);
    }
    return finish({ staged, failed: new Set(failures.map((f) => f.listingId)).size, failures, aiUnusable: 0, stopped: null });
  }, [shop, stageOps, appendMedia, finish]);

  const runVideoPlan = React.useCallback((plan: VideoPlan, file: File | null) => asPlan(() => runVideoPlanNow(plan, file)), [asPlan, runVideoPlanNow]);

  // ── Single-tile edits (each queued per listing; ops are computed from the views when it runs) ───────
  const stageOne = React.useCallback(async (listingId: string, media: MediaOp[]): Promise<RunResult> => {
    if (!media.length) return EMPTY_RESULT;
    const r = await stageOps([{ listingId, media }], () => undefined);
    return finish({ staged: r.staged, failed: r.failures.length ? 1 : 0, failures: r.failures, aiUnusable: 0, stopped: r.locked ? 'locked' : null });
  }, [stageOps, finish]);

  const tileOf = (listingId: string, tileId: string) => viewsRef.current.get(listingId)?.tiles.find((t) => t.id === tileId) ?? null;

  /** Runs one single-tile staging call and attaches the plan that takes exactly that change back. */
  const withUndo = React.useCallback(async (listingId: string, fn: () => Promise<RunResult>): Promise<RunResult> => {
    const before = draftsRef.current.get(listingId)?.media ?? [];
    const res = await fn();
    if (res.staged <= 0 || res.failures.length || res.stopped) return res;
    const plan = mediaUndoPlan(before, draftsRef.current.get(listingId)?.media ?? []);
    return isEmptyUndo(plan) ? res : { ...res, undo: { listingId, plan } };
  }, []);

  const reorder = React.useCallback((listingId: string, nextIds: string[]) => serial(listingId, async () => {
    const view = viewsRef.current.get(listingId);
    if (!view) return EMPTY_RESULT;
    const ops = reorderTileOps(view, nextIds);
    if (ops === null) return 'pending' as const;
    return withUndo(listingId, () => stageOne(listingId, ops));
  }), [serial, stageOne, withUndo]);

  const makePrimary = React.useCallback((listingId: string, tileId: string) => serial(listingId, async () => {
    const view = viewsRef.current.get(listingId);
    if (!view) return EMPTY_RESULT;
    const ops = makePrimaryOps(view, tileId);
    if (ops === null) return 'pending' as const;
    return withUndo(listingId, () => stageOne(listingId, ops));
  }), [serial, stageOne, withUndo]);

  const removeTile = React.useCallback((listingId: string, tileId: string) => serial(listingId, async () => {
    const tile = tileOf(listingId, tileId);
    if (!tile || tile.imageId == null || tile.staged === 'delete') return EMPTY_RESULT;
    const imageId = tile.imageId;
    return withUndo(listingId, () => stageOne(listingId, [{ kind: 'image', operation: 'delete', etsyMediaId: imageId }]));
  }), [serial, stageOne, withUndo]);

  const saveAlt = React.useCallback((listingId: string, tileId: string, alt: string) => serial(listingId, async () => {
    const tile = tileOf(listingId, tileId);
    if (!tile || tile.imageId == null) return EMPTY_RESULT;
    const imageId = tile.imageId;
    return withUndo(listingId, () => stageOne(listingId, [{ kind: 'image', operation: 'update_alt', etsyMediaId: imageId, altText: alt }]));
  }), [serial, stageOne, withUndo]);

  const uploadOne = React.useCallback(async (listingId: string, file: File, rank: number, kind: 'image' | 'video'): Promise<RunResult> => {
    if (!shop) return EMPTY_RESULT;
    try {
      const r = await stageFile({ shopId: shop.id, listingId, file, kind, operation: 'upload', rank: kind === 'image' ? rank : undefined });
      appendMedia(listingId, r.draftId, r.media);
      return finish({ staged: 1, failed: 0, failures: [], aiUnusable: 0, stopped: null });
    } catch (err) {
      return finish({ staged: 0, failed: 1, failures: [clientFailure(listingId, err)], aiUnusable: 0, stopped: null });
    }
  }, [shop, appendMedia, finish]);

  // Replace: the new photo is staged first and the old one's delete only after it (the send uploads before it
  // deletes), so a failed upload never leaves a delete without a replacement. Counts as one change.
  const replaceTile = React.useCallback((listingId: string, tileId: string, file: File) => serial(listingId, () => withUndo(listingId, async (): Promise<RunResult> => {
    const view = viewsRef.current.get(listingId);
    const tile = tileOf(listingId, tileId);
    if (!view || !tile || tile.imageId == null) return EMPTY_RESULT;
    const imageId = tile.imageId;
    const rank = view.tiles.indexOf(tile) + 1;
    const up = await uploadOne(listingId, file, rank, 'image');
    if (up.failed) return up;
    const del = await stageOps([{ listingId, media: [{ kind: 'image', operation: 'delete', etsyMediaId: imageId }] }], () => undefined);
    if (!del.failures.length && !del.locked) return up;
    markSending(del.failures);
    return { ...up, failed: 1, failures: del.failures, stopped: del.locked ? 'locked' : null };
  })), [serial, uploadOne, stageOps, withUndo, markSending]);

  const addFiles = React.useCallback((listingId: string, files: File[]) => serial(listingId, () => withUndo(listingId, async (): Promise<RunResult> => {
    const view = viewsRef.current.get(listingId);
    if (!view) return EMPTY_RESULT;
    let staged = 0;
    const failures: StudioFailure[] = [];
    let rank = view.slotsUsed + 1;
    for (const f of files.slice(0, view.room)) {
      const r = await uploadOne(listingId, f, Math.min(rank, 20), 'image');
      staged += r.staged;
      failures.push(...r.failures);
      rank += 1;
    }
    return { staged, failed: failures.length ? 1 : 0, failures, aiUnusable: 0, stopped: null };
  })), [serial, uploadOne, withUndo]);

  const removeVideo = React.useCallback((listingId: string) => serial(listingId, async () => {
    const v = videoViewsRef.current.get(listingId);
    if (!v?.remote || v.removing) return EMPTY_RESULT;
    const videoId = v.remote.videoId;
    return withUndo(listingId, () => stageOne(listingId, [{ kind: 'video', operation: 'delete', etsyMediaId: videoId }]));
  }), [serial, stageOne, withUndo]);

  const addVideoFile = React.useCallback(
    (listingId: string, file: File) => serial(listingId, () => withUndo(listingId, () => uploadOne(listingId, file, 0, 'video'))),
    [serial, uploadOne, withUndo],
  );

  // ── Undo (un-stage; queued per listing like every write) ─────────────────────────────────────────
  const undoNow = React.useCallback(async (listingId: string, stored: MediaUndoPlan): Promise<UndoResult> => {
    const draft = draftsRef.current.get(listingId);
    // The plan was computed when the edit was staged: run it only while the rows it removes are still the draft's.
    const plan = draft ? currentUndoPlan(stored, draft.media) : null;
    if (!draft || !plan || isEmptyUndo(plan)) return { ok: false, skipped: 'nothing' };
    if (undoLeavesNoPhoto(imagesRef.current.get(listingId), draft, plan.removeIds)) return { ok: false, skipped: 'lastPhoto' };
    if (plan.removeIds.length) {
      try {
        const next = await removeStudioMedia(draft.id, plan.removeIds);
        const gone = new Set(plan.removeIds);
        setDrafts((m) => {
          const prev = m.get(listingId);
          if (!prev) return m;
          const media = next && next.id === prev.id ? next.media : prev.media.filter((x) => !gone.has(x.id));
          return new Map(m).set(listingId, { ...prev, status: next?.status ?? prev.status, media });
        });
      } catch (err) {
        const failure = clientFailure(listingId, err);
        markSending([failure]);
        return { ok: false, failure };
      }
    }
    if (plan.restore.length) {
      try {
        const r = await stageOps([{ listingId, media: plan.restore }], () => undefined);
        markSending(r.failures);
        if (r.failures.length || r.locked) return { ok: false, failure: r.failures[0] ?? { listingId, code: 'STAGE_FAILED' } };
      } catch (err) {
        return { ok: false, failure: clientFailure(listingId, err) };
      }
    }
    return { ok: true };
  }, [setDrafts, stageOps, markSending]);

  const undo = React.useCallback((listingId: string, plan: MediaUndoPlan) => serial(listingId, () => undoNow(listingId, plan)), [serial, undoNow]);

  const undoTile = React.useCallback((listingId: string, tileId: string) => serial(listingId, () => (
    undoNow(listingId, { removeIds: tileUndoIds(viewsRef.current.get(listingId), tileId), restore: [] })
  )), [serial, undoNow]);

  const undoOrder = React.useCallback((listingId: string) => serial(listingId, () => (
    undoNow(listingId, { removeIds: orderUndoIds(draftsRef.current.get(listingId)), restore: [] })
  )), [serial, undoNow]);

  const undoVideo = React.useCallback((listingId: string) => serial(listingId, () => (
    undoNow(listingId, { removeIds: videoUndoIds(videoViewsRef.current.get(listingId), draftsRef.current.get(listingId)), restore: [] })
  )), [serial, undoNow]);

  const writeAlt = React.useCallback(async (listingId: string, tileId: string) => {
    const tile = tileOf(listingId, tileId);
    const listing = listingsRef.current.find((l) => l.id === listingId);
    try {
      return await writeStudioAlt({ imageUrl: tile?.fullSrc || tile?.src || '', title: listing?.title ?? '' });
    } catch (err) {
      if (err instanceof AiCreditsError) setAiCreditsOut(true);
      throw err;
    }
  }, []);

  const retry = React.useCallback(() => setNonce((n) => n + 1), []);
  const loadVideos = React.useCallback(() => setVideosWanted(true), []);

  return {
    load: loadedFor === loadKey ? load : 'loading',
    retry, shop, listings, imageStatus, photoViews, videoStatus, videoViews, loadVideos,
    selected, setSelected, stagedHere, progress, aiCreditsOut,
    runPlan, runVideoPlan, reorder, makePrimary, removeTile, saveAlt, replaceTile, addFiles, removeVideo, addVideoFile, writeAlt,
    undo, undoTile, undoOrder, undoVideo,
  };
}

export default usePhotoStudio;
