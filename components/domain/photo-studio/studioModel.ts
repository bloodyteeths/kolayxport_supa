// components/domain/photo-studio/studioModel.ts — M7-E PhotoStudio (pro-gating §4). Pure model, no React, no fetch.
//
// Turns each listing's Etsy photos + the staged EtsyDraftMedia rows of its DB draft into the strip the user sees
// (reusing the editor's `photosModel`: same tiles, same staged badges, same reorder rule), and plans one
// operation-row run ("Add 3 photos to 12 listings", "Delete photo 3 on 12 listings", …) into:
//   - `items`:   media ops per listing for `POST /api/etsy-drafts/batch-media` (URL uploads, deletes, reorders, alt)
//   - `uploads`: file uploads per listing for `POST /api/etsy-drafts/media` (one file per call, fanned out)
//   - `ai`:      AI jobs per listing / photo (generate image, improve, remove background, alt text), run by the hook
//   - `skipped`: listings left out, with the reason (counted in the result line, never silently dropped)
// Nothing here talks to Etsy: every op is staged into the listing's draft; sending stays on listings / BulkGrid.
//
// Safety rules (founder decisions + May 2026 hardening, enforced again server side):
//   - a listing whose draft has a queued delete is never touched (`queuedDelete`): its photos would be staged
//     onto a draft that deletes the listing, and the server refuses it anyway (DELETE_NOT_EXCLUSIVE);
//   - a listing that is being sent (`syncing`) is read-only;
//   - a delete never leaves a listing without photos; Etsy's 20-photo limit counts staged removals until send
//     (the sync uploads before it deletes), so Add / Replace skip a full listing.
import {
  PHOTO_MAX,
  ALT_TEXT_MAX,
  applyTileOrder,
  buildPhotoTiles,
  collectStagedOps,
  reorderOpsFor,
  type EtsyImageLike,
  type PhotoTile,
  type StagedMediaOps,
  type StagedMediaRow,
} from '@/components/domain/listing-editor/sections/photosModel';

export const STUDIO_MAX_PHOTOS = PHOTO_MAX.etsy;
export const STUDIO_ALT_MAX = ALT_TEXT_MAX;
/** `POST /api/etsy-drafts/batch-media` accepts at most this many listings per request. */
export const BATCH_MEDIA_MAX_ITEMS = 50;
/** Media ops per listing per request (the draft service refuses more than 50 in one call). */
export const BATCH_MEDIA_MAX_OPS = 50;
/** Requests in flight at once (bulk-grid §6.1 uses the same budget). */
export const BATCH_IN_FLIGHT = 2;
/** Single-file uploads and AI calls in flight (as today's BulkPhotoStudio). */
export const UPLOAD_CONCURRENCY = 3;
export const AI_CONCURRENCY = 3;
/** Image / alt-text runs above this many jobs are cut (accidental 500-image runs cost real credits). */
export const AI_BATCH_CAP = 60;
/** settings `billing.usage.aiHelp`: image 10 credits, alt text 1 credit. */
export const AI_CREDIT_COST = { image: 10, alt: 1 } as const;
/** Image fetches per listing in flight (pro-gating §4.3). */
export const IMAGE_FETCH_CONCURRENCY = 4;
/** `?ids=` cap: one listings page. */
export const MAX_STUDIO_IDS = 250;

export type StudioTab = 'photos' | 'video';
export type StudioOp = 'add' | 'replace' | 'delete' | 'move' | 'alt' | 'enhance' | 'removeBg' | 'copy' | 'watermark' | 'removeWatermark';
export type StudioSource = 'upload' | 'ai' | 'url';
export type StudioPosition = number | 'end';
export type StudioFilter = 'all' | 'noPhotos' | 'lt5' | 'missingAlt';
export type AltMode = 'manual' | 'ai';
export type VideoOp = 'add' | 'remove';
export type VideoSource = 'upload' | 'url';

export const STUDIO_OPS: readonly StudioOp[] = ['add', 'replace', 'delete', 'move', 'alt', 'enhance', 'removeBg', 'copy', 'watermark', 'removeWatermark'];
export const STUDIO_FILTERS: readonly StudioFilter[] = ['all', 'noPhotos', 'lt5', 'missingAlt'];
/** Ops whose result is an AI image (always staged as `ai_upload`). */
export const AI_IMAGE_OPS: ReadonlySet<StudioOp> = new Set(['enhance', 'removeBg']);

// ─── Input normalisation ──────────────────────────────────────────────────────────────────────────────

/** `?ids=1,2,3` → unique numeric Etsy listing ids (max one page). */
export function parseStudioIds(raw: string | string[] | undefined, max = MAX_STUDIO_IDS): string[] {
  if (raw === undefined) return [];
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => String(s).split(',')).map((s) => s.trim());
  return Array.from(new Set(parts.filter((s) => /^\d{1,20}$/.test(s)))).slice(0, max);
}

/** `?tab=` → tab (photos by default). */
export function parseStudioTab(raw: unknown): StudioTab {
  return raw === 'video' ? 'video' : 'photos';
}

/**
 * `?back=` → a same-app path to return to (BulkGrid, listings, Listing doctor), else null. Only `/app/…` paths
 * without a scheme or protocol-relative prefix are accepted (no open redirect).
 */
export function safeBackHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v.startsWith('/app/') || v.startsWith('//') || /[\s\\]/.test(v) || v.length > 2000) return null;
  return v;
}

/** One Etsy image as `/api/clawd/etsy?action=get_listing_images` returns it → the editor's image shape. */
export function normalizeEtsyImages(raw: unknown): EtsyImageLike[] {
  const list = raw && typeof raw === 'object'
    ? ((raw as { images?: unknown; results?: unknown }).images ?? (raw as { results?: unknown }).results)
    : null;
  if (!Array.isArray(list)) return [];
  return list
    .map((img: Record<string, unknown>) => ({
      listing_image_id: Number(img?.listing_image_id) || 0,
      url_75x75: typeof img?.url_75x75 === 'string' ? img.url_75x75 : undefined,
      url_170x135: typeof img?.url_170x135 === 'string' ? img.url_170x135 : undefined,
      url_570xN: typeof img?.url_570xN === 'string' ? img.url_570xN : String(img?.url_fullxfull ?? ''),
      url_fullxfull: typeof img?.url_fullxfull === 'string' ? img.url_fullxfull : undefined,
      rank: Number(img?.rank) || 0,
      alt_text: typeof img?.alt_text === 'string' ? img.alt_text : '',
    }))
    .filter((img) => img.listing_image_id > 0)
    .sort((a, b) => a.rank - b.rank);
}

export interface EtsyVideoLike {
  videoId: number;
  url?: string;
  thumbnailUrl?: string;
  state?: string;
}

/** `/api/clawd/etsy?action=get_listing_videos` → videos (Etsy allows one per listing). */
export function normalizeEtsyVideos(raw: unknown): EtsyVideoLike[] {
  const list = raw && typeof raw === 'object'
    ? ((raw as { videos?: unknown; results?: unknown }).videos ?? (raw as { results?: unknown }).results)
    : null;
  if (!Array.isArray(list)) return [];
  return list
    .map((v: Record<string, unknown>) => ({
      videoId: Number(v?.video_id) || 0,
      url: typeof v?.video_url === 'string' ? v.video_url : undefined,
      thumbnailUrl: typeof v?.thumbnail_url === 'string' ? v.thumbnail_url : undefined,
      state: typeof v?.video_state === 'string' ? v.video_state : undefined,
    }))
    .filter((v) => v.videoId > 0);
}

// ─── Draft state per listing ─────────────────────────────────────────────────────────────────────────

/** A staged media row as the draft API serialises it (`EtsyDraftMedia`). */
export interface StudioMediaRow extends StagedMediaRow {
  localPath?: string | null;
  contentType?: string | null;
}

/** The parts of one `EtsyListingDraft` the studio reads (from `GET /api/etsy-drafts` or a batch result). */
export interface StudioDraft {
  id: string;
  listingId: string;
  status: string;
  media: StudioMediaRow[];
  queuedDelete: boolean;
}

const LIVE_DRAFT = new Set(['draft', 'failed', 'conflict', 'syncing']);

/** `GET /api/etsy-drafts?shop_id=` → the live draft per listing id (newest wins; the API sorts by updatedAt desc). */
export function draftsByListing(raw: unknown): Map<string, StudioDraft> {
  const list = raw && typeof raw === 'object' ? (raw as { drafts?: unknown }).drafts : null;
  const out = new Map<string, StudioDraft>();
  if (!Array.isArray(list)) return out;
  for (const d of list) {
    const draft = toStudioDraft(d);
    if (!draft || out.has(draft.listingId)) continue;
    out.set(draft.listingId, draft);
  }
  return out;
}

/** One serialised draft → StudioDraft (null when it is not a live draft of a listing). */
export function toStudioDraft(raw: unknown): StudioDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const status = typeof d.status === 'string' ? d.status : '';
  if (!LIVE_DRAFT.has(status) || d.id == null || d.etsyListingId == null) return null;
  const actions = Array.isArray(d.queuedActions) ? d.queuedActions : [];
  const queuedDelete = actions.some((a) => a && typeof a === 'object' && (a as { type?: unknown }).type === 'delete' && !(a as { completedAt?: unknown }).completedAt);
  const media = Array.isArray(d.media) ? (d.media as Record<string, unknown>[]).map(toMediaRow).filter((m): m is StudioMediaRow => Boolean(m)) : [];
  return { id: String(d.id), listingId: String(d.etsyListingId), status, media, queuedDelete };
}

function toMediaRow(m: Record<string, unknown>): StudioMediaRow | null {
  if (!m || m.id == null || typeof m.kind !== 'string' || typeof m.operation !== 'string') return null;
  return {
    id: String(m.id),
    kind: m.kind,
    operation: m.operation,
    etsyMediaId: m.etsyMediaId == null ? null : String(m.etsyMediaId),
    rank: m.rank == null ? null : Number(m.rank),
    altText: typeof m.altText === 'string' ? m.altText : null,
    sourceUrl: typeof m.sourceUrl === 'string' ? m.sourceUrl : null,
    filename: typeof m.filename === 'string' ? m.filename : null,
    localPath: typeof m.localPath === 'string' ? m.localPath : null,
    contentType: typeof m.contentType === 'string' ? m.contentType : null,
  };
}

const UPLOAD_OPS = new Set(['upload', 'ai_upload']);

/** Preview URL of a staged upload: its public source URL, else the private staged-file preview. */
export function stagedPreviewUrl(m: Pick<StudioMediaRow, 'id' | 'sourceUrl'>): string {
  return m.sourceUrl || `/api/etsy-drafts/media-preview?id=${encodeURIComponent(m.id)}`;
}

/** A strip tile + the studio extras (AI badge). */
export interface StudioTile extends PhotoTile {
  /** Staged by an AI action (`ai_upload`). */
  ai: boolean;
}

export interface ListingPhotoView {
  tiles: StudioTile[];
  /** Photos after send (staged removals excluded). */
  liveCount: number;
  /** Slots used until send (staged removals included: the sync uploads before it deletes). */
  slotsUsed: number;
  /** Free slots under Etsy's 20. */
  room: number;
  /** Etsy photos (after send) without alt text. */
  missingAlt: number;
  /** Staged removals. */
  removing: number;
  ops: StagedMediaOps;
  /** Etsy rank per image id (for reorder ops). */
  originalRank: Map<number, number>;
  /** The ordered images the tiles were built from (Etsy images re-ranked by staged reorders + staged uploads). */
  ordered: EtsyImageLike[];
}

/**
 * Etsy images + staged media → the strip. Order: Etsy images by their staged rank (else Etsy's), then staged
 * uploads inserted at their staged rank (else appended), as the editor's ImageManager shows them.
 */
export function buildListingPhotoView(images: ReadonlyArray<EtsyImageLike>, draft: StudioDraft | null | undefined): ListingPhotoView {
  const ops = draft ? collectStagedOps([{ status: draft.status, media: draft.media }]) : collectStagedOps([]);
  const originalRank = new Map<number, number>();
  const sorted = images.slice().sort((a, b) => a.rank - b.rank);
  sorted.forEach((img, i) => originalRank.set(img.listing_image_id, i + 1));
  const etsy = sorted
    .map((img, i) => ({ img, eff: ops.imageReorders.get(img.listing_image_id) ?? i + 1, moved: ops.imageReorders.has(img.listing_image_id), i }))
    .sort((a, b) => a.eff - b.eff || Number(b.moved) - Number(a.moved) || a.i - b.i)
    .map((x) => x.img);

  const uploads = (draft?.media ?? [])
    .filter((m) => m.kind === 'image' && UPLOAD_OPS.has(m.operation))
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.rank ?? Number.MAX_SAFE_INTEGER) - (b.m.rank ?? Number.MAX_SAFE_INTEGER) || a.i - b.i);
  const ordered: EtsyImageLike[] = etsy.slice();
  const aiIds = new Set<string>();
  for (const { m } of uploads) {
    const src = stagedPreviewUrl(m);
    const pending: EtsyImageLike = {
      listing_image_id: 0,
      url_570xN: src,
      url_fullxfull: src,
      rank: m.rank ?? ordered.length + 1,
      alt_text: m.altText ?? '',
      is_pending_upload: true,
      pending_filename: m.filename ?? undefined,
      pending_media_id: m.id,
    };
    if (m.operation === 'ai_upload') aiIds.add(m.id);
    const at = m.rank != null ? Math.max(0, Math.min(ordered.length, m.rank - 1)) : ordered.length;
    ordered.splice(at, 0, pending);
  }

  const tiles: StudioTile[] = buildPhotoTiles(ordered, ops, originalRank).map((t) => ({ ...t, ai: Boolean(t.mediaId && aiIds.has(t.mediaId)) }));
  const removing = tiles.filter((t) => t.staged === 'delete').length;
  const liveCount = tiles.length - removing;
  const missingAlt = tiles.filter((t) => !t.pending && t.staged !== 'delete' && !t.alt.trim()).length;
  return {
    tiles,
    liveCount,
    slotsUsed: tiles.length,
    room: Math.max(0, STUDIO_MAX_PHOTOS - tiles.length),
    missingAlt,
    removing,
    ops,
    originalRank,
    ordered,
  };
}

export interface ListingVideoView {
  /** The video on Etsy (first; Etsy allows one). */
  remote: EtsyVideoLike | null;
  /** Staged video upload row. */
  stagedUpload: StudioMediaRow | null;
  /** The remote video is staged for removal. */
  removing: boolean;
  /** What the listing will have after send. */
  hasAfterSend: boolean;
}

export function buildListingVideoView(videos: ReadonlyArray<EtsyVideoLike>, draft: StudioDraft | null | undefined): ListingVideoView {
  const ops = draft ? collectStagedOps([{ status: draft.status, media: draft.media }]) : collectStagedOps([]);
  const remote = videos[0] ?? null;
  const removing = Boolean(remote && ops.videoDeletes.has(remote.videoId));
  const stagedUpload = (ops.videoUploads[0] as StudioMediaRow | undefined) ?? null;
  return { remote, stagedUpload, removing, hasAfterSend: Boolean(stagedUpload) || Boolean(remote && !removing) };
}

// ─── Filters ─────────────────────────────────────────────────────────────────────────────────────────

/** Show filter (pro-gating §4.2). A listing whose photos are not loaded yet is never hidden. */
export function matchesFilter(filter: StudioFilter, view: ListingPhotoView | null): boolean {
  if (filter === 'all' || !view) return true;
  if (filter === 'noPhotos') return view.liveCount === 0;
  if (filter === 'lt5') return view.liveCount < 5;
  return view.missingAlt > 0;
}

/** Client filter over title and id. */
export function matchesQuery(q: string, listing: { id: string; title: string }): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return listing.title.toLowerCase().includes(s) || listing.id.includes(s);
}

// ─── Operation planning ──────────────────────────────────────────────────────────────────────────────

/** One media op for the draft (whitelisted by the draft service: upload by URL, delete, reorder, update_alt). */
export type MediaOp =
  | { kind: 'image' | 'video'; operation: 'upload'; sourceUrl: string; rank?: number; altText?: string }
  | { kind: 'image' | 'video'; operation: 'delete'; etsyMediaId: number }
  | { kind: 'image'; operation: 'reorder'; etsyMediaId: number; rank: number }
  | { kind: 'image'; operation: 'update_alt'; etsyMediaId: number; altText: string };

export interface StudioListingRef {
  id: string;
  title: string;
  /** The listing's draft has a queued delete: never touched here. */
  queuedDelete?: boolean;
  /** The listing's draft is being sent. */
  syncing?: boolean;
}

export type SkipReason = 'notLoaded' | 'queuedDelete' | 'sending' | 'full' | 'noPhotoAtPosition' | 'lastPhoto' | 'pendingPhoto' | 'samePosition' | 'noVideo' | 'hasVideo' | 'isSource' | 'nothingToCopy' | 'noAltNeeded' | 'noWatermark' | 'photoChanged';

export interface PlannedUpload {
  listingId: string;
  /** Index into the chosen files. */
  fileIndex: number;
  rank: number;
  /** Etsy image id to delete first (Replace), staged in the same run. */
  replaceImageId?: number;
}

export interface PlannedAi {
  listingId: string;
  title: string;
  kind: 'image' | 'alt';
  /** image: rank of the staged result; alt: the photo. */
  rank: number;
  /** Image to improve / caption (enhance, remove background, alt) or the hero reference (add / replace). */
  refUrl?: string;
  /** Other photos of the listing as extra references (max 3 in total, as today). */
  extraRefs?: string[];
  /** Etsy image id the AI result replaces (Replace / Improve / Remove background), or the photo to caption. */
  targetImageId?: number;
}

/** Watermark: one photo to watermark (server, lib/media/watermark) and stage in its place (Replace semantics). */
export interface PlannedMark {
  listingId: string;
  rank: number;
  refUrl: string;
  targetImageId: number;
  /** 'restore' (Filigranı kaldır): refUrl is the stored original; it is staged back as-is. */
  restore?: boolean;
}

/**
 * Stored originals of watermarked photos per listing, matched to the listing's CURRENT photos (POST
 * /api/media/watermark-originals): `match` = the photo we placed (perceptual hash), wherever it is now; null = the
 * seller changed or removed it, so it is never overwritten.
 */
export type WatermarkOriginals = ReadonlyMap<string, ReadonlyArray<{ id: string; rank: number; match?: { imageId: number; rank: number } | null }>>;

export interface StudioPlan {
  /** Watermark jobs. */
  marks: PlannedMark[];
  /** Media ops per listing (batch-media). */
  items: { listingId: string; media: MediaOp[] }[];
  uploads: PlannedUpload[];
  ai: PlannedAi[];
  skipped: { listingId: string; reason: SkipReason }[];
  /** Listings that get at least one change. */
  listings: number;
  /** Photo changes this run stages (ops + uploads + AI results). */
  changes: number;
  /** AI credits the run costs (before any failure). */
  credits: number;
  /** AI jobs left out by `AI_BATCH_CAP`. */
  capped: number;
}

export interface PlanInput {
  op: StudioOp;
  source: StudioSource;
  position: StudioPosition;
  /** Move: destination position. */
  moveTo: number;
  /** Upload source: number of chosen files (Add fans them out, Replace uses the first). */
  fileCount: number;
  /** URL source. */
  url: string;
  /** Alt: manual text or AI. */
  altMode: AltMode;
  altText: string;
  /** Alt: every photo instead of the one at `position`. */
  altAll: boolean;
  /** Copy: the listing to copy photos from. */
  copyFromId: string | null;
  /** Watermark: every photo instead of the one at `position`. */
  wmAll: boolean;
}

export const DEFAULT_PLAN_INPUT: PlanInput = {
  op: 'add', source: 'upload', position: 'end', moveTo: 1, fileCount: 0, url: '', altMode: 'ai', altText: '', altAll: true, copyFromId: null, wmAll: true,
};

function bestSrc(img: EtsyImageLike): string {
  return img.url_fullxfull || img.url_570xN || '';
}

/** Etsy photos of a view that will still be there after send, in strip order. */
function etsyPhotos(view: ListingPhotoView): { tile: StudioTile; img: EtsyImageLike }[] {
  const out: { tile: StudioTile; img: EtsyImageLike }[] = [];
  view.tiles.forEach((tile, i) => {
    if (tile.pending || tile.staged === 'delete' || tile.imageId == null) return;
    out.push({ tile, img: view.ordered[i] });
  });
  return out;
}

function refsFor(view: ListingPhotoView, first?: string): string[] {
  const refs: string[] = [];
  if (first) refs.push(first);
  for (const { img } of etsyPhotos(view)) {
    if (refs.length >= 3) break;
    const u = bestSrc(img);
    if (u && !refs.includes(u)) refs.push(u);
  }
  return refs;
}

/** Whether the op row is complete enough to plan (the header primary's disabled reason uses the same check). */
export type PlanBlocker = 'noSelection' | 'chooseFiles' | 'enterUrl' | 'enterAlt' | 'pickCopySource' | null;

export function planBlocker(input: PlanInput, selected: number): PlanBlocker {
  if (selected === 0) return 'noSelection';
  if (input.op === 'add' || input.op === 'replace') {
    if (input.source === 'upload' && input.fileCount === 0) return 'chooseFiles';
    if (input.source === 'url' && !isHttpsUrl(input.url)) return 'enterUrl';
  }
  if (input.op === 'alt' && input.altMode === 'manual' && !input.altText.trim()) return 'enterAlt';
  if (input.op === 'copy' && !input.copyFromId) return 'pickCopySource';
  return null;
}

export function isHttpsUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Plans one operation-row run over the selected listings (pure; unit-tested). `views` holds the loaded strip of
 * each listing; a listing whose photos are not loaded yet is skipped (`notLoaded`), never guessed.
 */
export function planOperation(
  input: PlanInput,
  selected: ReadonlyArray<StudioListingRef>,
  views: ReadonlyMap<string, ListingPhotoView>,
  originals: WatermarkOriginals = new Map(),
): StudioPlan {
  const items: StudioPlan['items'] = [];
  const marks: PlannedMark[] = [];
  const uploads: PlannedUpload[] = [];
  let ai: PlannedAi[] = [];
  const skipped: StudioPlan['skipped'] = [];
  const touched = new Set<string>();
  const pos = typeof input.position === 'number' ? input.position : null;
  const sourceView = input.op === 'copy' && input.copyFromId ? views.get(input.copyFromId) ?? null : null;
  const copySources = sourceView ? etsyPhotos(sourceView).map(({ tile, img }) => ({ url: bestSrc(img), alt: tile.alt })).filter((s) => s.url) : [];

  const skip = (listingId: string, reason: SkipReason) => skipped.push({ listingId, reason });
  const pushOps = (listingId: string, media: MediaOp[]) => {
    if (!media.length) return;
    touched.add(listingId);
    for (let i = 0; i < media.length; i += BATCH_MEDIA_MAX_OPS) items.push({ listingId, media: media.slice(i, i + BATCH_MEDIA_MAX_OPS) });
  };

  for (const listing of selected) {
    const id = listing.id;
    if (listing.queuedDelete) { skip(id, 'queuedDelete'); continue; }
    if (listing.syncing) { skip(id, 'sending'); continue; }
    const view = views.get(id);
    if (!view) { skip(id, 'notLoaded'); continue; }
    const target = pos != null ? view.tiles[pos - 1] ?? null : null;
    const targetIsEtsy = Boolean(target && !target.pending && target.staged !== 'delete' && target.imageId != null);

    switch (input.op) {
      case 'add': {
        if (view.room <= 0) { skip(id, 'full'); break; }
        const start = pos != null ? Math.min(pos, view.slotsUsed + 1) : view.slotsUsed + 1;
        if (input.source === 'ai') {
          ai.push({ listingId: id, title: listing.title, kind: 'image', rank: Math.min(start, STUDIO_MAX_PHOTOS), extraRefs: refsFor(view) });
          touched.add(id);
          break;
        }
        const count = input.source === 'upload' ? Math.min(input.fileCount, view.room) : 1;
        if (input.source === 'url') {
          pushOps(id, [{ kind: 'image', operation: 'upload', sourceUrl: input.url.trim(), rank: Math.min(start, STUDIO_MAX_PHOTOS) }]);
          break;
        }
        for (let k = 0; k < count; k++) uploads.push({ listingId: id, fileIndex: k, rank: Math.min(start + k, STUDIO_MAX_PHOTOS) });
        if (count > 0) touched.add(id);
        break;
      }
      case 'replace':
      case 'enhance':
      case 'removeBg': {
        if (!target || !targetIsEtsy || target.imageId == null || pos == null) { skip(id, target?.pending ? 'pendingPhoto' : 'noPhotoAtPosition'); break; }
        if (view.room <= 0) { skip(id, 'full'); break; }
        const img = view.ordered[pos - 1];
        if (input.op !== 'replace' || input.source === 'ai') {
          ai.push({
            listingId: id,
            title: listing.title,
            kind: 'image',
            rank: pos,
            refUrl: bestSrc(img),
            extraRefs: refsFor(view, bestSrc(img)).slice(1),
            targetImageId: target.imageId,
          });
          touched.add(id);
          break;
        }
        if (input.source === 'url') {
          pushOps(id, [
            { kind: 'image', operation: 'delete', etsyMediaId: target.imageId },
            { kind: 'image', operation: 'upload', sourceUrl: input.url.trim(), rank: pos },
          ]);
          break;
        }
        uploads.push({ listingId: id, fileIndex: 0, rank: pos, replaceImageId: target.imageId });
        touched.add(id);
        break;
      }
      case 'delete': {
        if (!target || pos == null) { skip(id, 'noPhotoAtPosition'); break; }
        if (!targetIsEtsy || target.imageId == null) { skip(id, target.pending ? 'pendingPhoto' : 'noPhotoAtPosition'); break; }
        if (view.liveCount <= 1) { skip(id, 'lastPhoto'); break; }
        pushOps(id, [{ kind: 'image', operation: 'delete', etsyMediaId: target.imageId }]);
        break;
      }
      case 'move': {
        if (!target || pos == null) { skip(id, 'noPhotoAtPosition'); break; }
        if (!targetIsEtsy) { skip(id, target.pending ? 'pendingPhoto' : 'noPhotoAtPosition'); break; }
        const to = Math.max(1, Math.min(input.moveTo, view.tiles.length));
        if (to === pos) { skip(id, 'samePosition'); break; }
        const ids = view.tiles.map((t) => t.id);
        const [moved] = ids.splice(pos - 1, 1);
        ids.splice(to - 1, 0, moved);
        const next = applyTileOrder(view.tiles, ids);
        if (!next) { skip(id, 'pendingPhoto'); break; }
        const byTile = new Map(view.tiles.map((t, i) => [t.id, view.ordered[i]]));
        const ops = reorderOpsFor(next.map((t) => byTile.get(t.id) as EtsyImageLike), view.originalRank, view.ops.imageReorders);
        if (!ops.length) { skip(id, 'samePosition'); break; }
        pushOps(id, ops);
        break;
      }
      case 'alt': {
        const photos = etsyPhotos(view);
        const chosen = input.altAll ? photos : pos != null && targetIsEtsy ? photos.filter(({ tile }) => tile.id === target?.id) : [];
        if (!chosen.length) { skip(id, input.altAll ? 'noPhotoAtPosition' : target?.pending ? 'pendingPhoto' : 'noPhotoAtPosition'); break; }
        if (input.altMode === 'manual') {
          const text = input.altText.trim().slice(0, STUDIO_ALT_MAX);
          const ops = chosen
            .filter(({ tile }) => tile.alt.trim() !== text)
            .map(({ tile }) => ({ kind: 'image' as const, operation: 'update_alt' as const, etsyMediaId: tile.imageId as number, altText: text }));
          if (!ops.length) { skip(id, 'noAltNeeded'); break; }
          pushOps(id, ops);
          break;
        }
        for (const { tile, img } of chosen) {
          const rank = view.tiles.indexOf(tile) + 1;
          ai.push({ listingId: id, title: listing.title, kind: 'alt', rank, refUrl: bestSrc(img), targetImageId: tile.imageId as number });
        }
        touched.add(id);
        break;
      }
      case 'watermark': {
        // Replace semantics: the watermarked copy is staged at the photo's rank and the original's delete is staged
        // with it, so the original stays on the marketplace until Send. Staged removals keep their slot until then,
        // so at most `room` photos per listing fit in one run.
        const photos = etsyPhotos(view);
        const chosen = input.wmAll ? photos : pos != null && targetIsEtsy ? photos.filter(({ tile }) => tile.id === target?.id) : [];
        if (!chosen.length) { skip(id, !input.wmAll && target?.pending ? 'pendingPhoto' : 'noPhotoAtPosition'); break; }
        if (view.room <= 0) { skip(id, 'full'); break; }
        for (const { tile, img } of chosen.slice(0, view.room)) {
          const src = bestSrc(img);
          if (src) marks.push({ listingId: id, rank: view.tiles.indexOf(tile) + 1, refUrl: src, targetImageId: tile.imageId as number });
        }
        touched.add(id);
        break;
      }
      case 'removeWatermark': {
        // Each watermarked slot gets its stored original back (upload at the slot + delete of the photo there).
        // Only the photo we placed is replaced: matched by its fingerprint among the current photos (it may have moved).
        const rows = originals.get(id) ?? [];
        if (rows.some((r) => !r.match)) skip(id, 'photoChanged');
        const jobs = rows.flatMap((r) => {
          if (!r.match) return [];
          const tile = view.tiles.find((t) => t.imageId === r.match!.imageId);
          return tile && !tile.pending && tile.staged !== 'delete'
            ? [{ listingId: id, rank: view.tiles.indexOf(tile) + 1, refUrl: `/api/media/watermark-originals?id=${encodeURIComponent(r.id)}`, targetImageId: r.match.imageId, restore: true }]
            : [];
        });
        if (!jobs.length) { if (!rows.length) skip(id, 'noWatermark'); break; }
        if (view.room <= 0) { skip(id, 'full'); break; }
        marks.push(...jobs.slice(0, view.room));
        touched.add(id);
        break;
      }
      case 'copy': {
        if (id === input.copyFromId) { skip(id, 'isSource'); break; }
        if (!copySources.length) { skip(id, 'nothingToCopy'); break; }
        if (view.room <= 0) { skip(id, 'full'); break; }
        const n = Math.min(copySources.length, view.room);
        pushOps(id, copySources.slice(0, n).map((s, k) => ({
          kind: 'image' as const,
          operation: 'upload' as const,
          sourceUrl: s.url,
          rank: Math.min(view.slotsUsed + 1 + k, STUDIO_MAX_PHOTOS),
          ...(s.alt ? { altText: s.alt.slice(0, STUDIO_ALT_MAX) } : {}),
        })));
        break;
      }
      default:
        break;
    }
  }

  let capped = 0;
  if (ai.length > AI_BATCH_CAP) {
    capped = ai.length - AI_BATCH_CAP;
    ai = ai.slice(0, AI_BATCH_CAP);
    // Listings whose every AI job was cut are no longer touched.
    const kept = new Set(ai.map((a) => a.listingId));
    for (const id of Array.from(touched)) {
      const hasOther = items.some((i) => i.listingId === id) || uploads.some((u) => u.listingId === id);
      if (!kept.has(id) && !hasOther) touched.delete(id);
    }
  }

  const changes = items.reduce((n, i) => n + i.media.filter((m) => m.operation !== 'delete' || !isReplacePair(i.media, m)).length, 0)
    + uploads.length + ai.length + marks.length;
  const credits = ai.reduce((n, a) => n + (a.kind === 'alt' ? AI_CREDIT_COST.alt : AI_CREDIT_COST.image), 0);
  return { marks, items, uploads, ai, skipped, listings: touched.size, changes, credits, capped };
}

/** A Replace by URL is a delete + an upload; it counts as one photo change. */
function isReplacePair(media: ReadonlyArray<MediaOp>, m: MediaOp): boolean {
  return m.operation === 'delete' && media.some((o) => o.operation === 'upload');
}

/** Most frequent skip reason (for the one-line result). */
export function topSkipReason(skipped: ReadonlyArray<{ reason: SkipReason }>): SkipReason | null {
  const counts = new Map<SkipReason, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  let best: SkipReason | null = null;
  let n = 0;
  for (const [r, c] of counts) if (c > n) { best = r; n = c; }
  return best;
}

// ─── Single-tile edits (stage immediately) ───────────────────────────────────────────────────────────

/** Drag / keyboard reorder of one strip → reorder ops (null when a staged upload would move). */
export function reorderTileOps(view: ListingPhotoView, nextIds: ReadonlyArray<string>): MediaOp[] | null {
  const next = applyTileOrder(view.tiles, nextIds);
  if (!next) return null;
  const byTile = new Map(view.tiles.map((t, i) => [t.id, view.ordered[i]]));
  return reorderOpsFor(next.map((t) => byTile.get(t.id) as EtsyImageLike), view.originalRank, view.ops.imageReorders);
}

/** "Make primary": move the tile to position 1. */
export function makePrimaryOps(view: ListingPhotoView, tileId: string): MediaOp[] | null {
  const ids = view.tiles.map((t) => t.id);
  const at = ids.indexOf(tileId);
  if (at <= 0) return null;
  ids.splice(at, 1);
  ids.unshift(tileId);
  return reorderTileOps(view, ids);
}

// ─── Video ───────────────────────────────────────────────────────────────────────────────────────────

export interface VideoPlan {
  /** URL adds and removals (batch-media). */
  items: { listingId: string; media: MediaOp[] }[];
  /** Listings that get the chosen file. */
  uploads: string[];
  skipped: { listingId: string; reason: SkipReason }[];
  changes: number;
}

export function planVideo(
  op: VideoOp,
  source: VideoSource,
  url: string,
  hasFile: boolean,
  selected: ReadonlyArray<StudioListingRef>,
  views: ReadonlyMap<string, ListingVideoView>,
): VideoPlan {
  const items: VideoPlan['items'] = [];
  const uploads: string[] = [];
  const skipped: VideoPlan['skipped'] = [];
  for (const l of selected) {
    if (l.queuedDelete) { skipped.push({ listingId: l.id, reason: 'queuedDelete' }); continue; }
    if (l.syncing) { skipped.push({ listingId: l.id, reason: 'sending' }); continue; }
    const v = views.get(l.id);
    if (!v) { skipped.push({ listingId: l.id, reason: 'notLoaded' }); continue; }
    if (op === 'add') {
      if (v.hasAfterSend) { skipped.push({ listingId: l.id, reason: 'hasVideo' }); continue; }
      if (source === 'url') {
        if (isHttpsUrl(url)) items.push({ listingId: l.id, media: [{ kind: 'video', operation: 'upload', sourceUrl: url.trim() }] });
      } else if (hasFile) uploads.push(l.id);
      continue;
    }
    if (!v.remote || v.removing) { skipped.push({ listingId: l.id, reason: 'noVideo' }); continue; }
    items.push({ listingId: l.id, media: [{ kind: 'video', operation: 'delete', etsyMediaId: v.remote.videoId }] });
  }
  return { items, uploads, skipped, changes: items.length + uploads.length };
}

// ─── Async helpers ───────────────────────────────────────────────────────────────────────────────────

export function chunk<T>(list: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Runs `worker` over `items` with at most `limit` in flight; errors are the worker's to report. */
export async function runPool<T>(items: ReadonlyArray<T>, limit: number, worker: (item: T, index: number) => Promise<void>, signal?: { cancelled: boolean }): Promise<void> {
  let cursor = 0;
  const next = async (): Promise<void> => {
    while (cursor < items.length) {
      if (signal?.cancelled) return;
      const idx = cursor++;
      try {
        await worker(items[idx], idx);
      } catch {
        // per-item errors are reported by the worker
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(0, Math.min(limit, items.length)) }, next));
}

/**
 * Batch items grouped so that one listing never has two requests in flight (two writes to one draft would
 * race): items of the same listing go to later waves. Each wave is then cut into requests of ≤ 50 items.
 */
export function batchWaves<T extends { listingId: string }>(items: ReadonlyArray<T>): T[][] {
  const waves: T[][] = [];
  const seen: Map<string, number> = new Map();
  for (const item of items) {
    const wave = seen.get(item.listingId) ?? 0;
    seen.set(item.listingId, wave + 1);
    (waves[wave] ??= []).push(item);
  }
  return waves;
}

/**
 * Groups items by listing (first-seen order). File uploads run one listing per pool slot and the files of one
 * listing one after another: each upload is its own request, and two concurrent writes to a listing that has no
 * draft yet would each create one (EtsyListingDraft has no unique key on the listing).
 */
export function groupByListing<T extends { listingId: string }>(items: ReadonlyArray<T>): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const g = groups.get(item.listingId);
    if (g) g.push(item); else groups.set(item.listingId, [item]);
  }
  return Array.from(groups.values());
}

// ─── Undo (un-stage rows with PATCH removeMediaIds) ──────────────────────────────────────────────────

/**
 * Rows that undo one tile's staged state: a staged upload (its own row), or a staged removal (the delete row).
 * Empty when the tile has nothing staged that a tap can take back (reorders / alt text undo from their toast).
 */
export function tileUndoIds(view: ListingPhotoView | null | undefined, tileId: string): string[] {
  const tile = view?.tiles.find((t) => t.id === tileId);
  if (!tile) return [];
  if (tile.pending) return tile.mediaId ? [tile.mediaId] : [];
  if (tile.staged === 'delete' && tile.imageId != null) {
    const row = view?.ops.imageDeletes.get(tile.imageId);
    return row ? [row] : [];
  }
  return [];
}

/** Every staged reorder row of the listing ("Undo order": photos go back to Etsy's order). */
export function orderUndoIds(draft: Pick<StudioDraft, 'media'> | null | undefined): string[] {
  return (draft?.media ?? []).filter((m) => m.kind === 'image' && m.operation === 'reorder').map((m) => m.id);
}

/** The staged video upload, or the staged removal of the Etsy video. */
export function videoUndoIds(view: ListingVideoView | null | undefined, draft: Pick<StudioDraft, 'media'> | null | undefined): string[] {
  if (!view) return [];
  if (view.stagedUpload) return [view.stagedUpload.id];
  if (view.remote && view.removing) {
    const row = (draft?.media ?? []).find((m) => m.kind === 'video' && m.operation === 'delete' && Number(m.etsyMediaId) === view.remote?.videoId);
    return row ? [row.id] : [];
  }
  return [];
}

/**
 * True when un-staging `removeIds` would leave the listing with no photo after send while an Etsy photo is
 * still staged for removal (e.g. removing the new photo of a Replace without its paired delete). Etsy needs at
 * least one photo, and the send would delete every remaining one. A listing with no staged removal is never
 * blocked (taking back a lone new photo leaves Etsy as it is).
 */
export function undoLeavesNoPhoto(
  images: ReadonlyArray<EtsyImageLike> | null | undefined,
  draft: StudioDraft | null | undefined,
  removeIds: ReadonlyArray<string>,
): boolean {
  if (!draft || !removeIds.length) return false;
  const gone = new Set(removeIds);
  const after = buildListingPhotoView(images ?? [], { ...draft, media: draft.media.filter((m) => !gone.has(m.id)) });
  return after.liveCount <= 0 && after.removing > 0;
}
