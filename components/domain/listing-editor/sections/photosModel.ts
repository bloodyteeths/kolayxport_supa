// components/domain/listing-editor/sections/photosModel.ts — M6 editor Group C (listing-editor §6.5, §5.1).
// Pure helpers behind the embedded photo strip: turn the Etsy images + the staged EtsyDraftMedia rows into
// strip tiles, guard reorders, and summarise what is staged (rail "Not sent yet", score inputs, preview).
// No React, no fetch: everything here is unit-tested in test/listingEditor/c-photosModel.test.ts.
import { decodeEntities } from '@/lib/text/decodeEntities';

/** Etsy limits (seoRules.ETSY_MAX_IMAGES is 20; eBay allows 24 picture URLs). */
export const PHOTO_MAX = { etsy: 20, ebay: 24 } as const;
/** Etsy alt text limit as enforced by Etsy (the server slices to 500 but Etsy rejects > 250). */
export const ALT_TEXT_MAX = 250;

/** The listing image shape returned by `/api/clawd/etsy?action=listing` (subset used here). */
export interface EtsyImageLike {
  listing_image_id: number;
  url_75x75?: string;
  url_170x135?: string;
  url_570xN: string;
  url_fullxfull?: string;
  rank: number;
  alt_text?: string;
  is_pending_upload?: boolean;
  pending_filename?: string;
  pending_media_id?: string;
}

/** One serialised `EtsyDraftMedia` row as `GET /api/etsy-drafts` returns it. */
export interface StagedMediaRow {
  id: string;
  kind: string;
  operation: string;
  etsyMediaId?: string | number | null;
  rank?: number | null;
  altText?: string | null;
  sourceUrl?: string | null;
  filename?: string | null;
}

/** Staged delete / alt ops for existing Etsy media, keyed by Etsy media id. */
export interface StagedMediaOps {
  /** Etsy image id → EtsyDraftMedia row id of its staged delete. */
  imageDeletes: Map<number, string>;
  /** Etsy image id → staged alt text (decoded). Last op wins (mirrors the server's replaceable ops). */
  imageAlts: Map<number, string>;
  /** Etsy image id → EtsyDraftMedia row id of its staged `update_alt` (so an undo can drop the row). */
  imageAltRows: Map<number, string>;
  /** Etsy image id → staged rank of its reorder row (one row per image: the server replaces older ones). */
  imageReorders: Map<number, number>;
  /** Etsy video id → row id of its staged delete. */
  videoDeletes: Map<number, string>;
  /** Staged video uploads (file or URL). */
  videoUploads: StagedMediaRow[];
}

export const EMPTY_STAGED_OPS: StagedMediaOps = {
  imageDeletes: new Map(), imageAlts: new Map(), imageAltRows: new Map(), imageReorders: new Map(), videoDeletes: new Map(), videoUploads: [],
};

/** The draft list may hold more than one row historically; only editable ones carry live staged media. */
const LIVE_STATUSES = new Set(['draft', 'failed', 'conflict', 'syncing']);

export function collectStagedOps(drafts: ReadonlyArray<{ status?: string; media?: StagedMediaRow[] | null }> | null | undefined): StagedMediaOps {
  const ops: StagedMediaOps = { imageDeletes: new Map(), imageAlts: new Map(), imageAltRows: new Map(), imageReorders: new Map(), videoDeletes: new Map(), videoUploads: [] };
  for (const draft of drafts || []) {
    if (draft.status && !LIVE_STATUSES.has(draft.status)) continue;
    for (const m of draft.media || []) {
      const mediaId = m.etsyMediaId == null || m.etsyMediaId === '' ? null : Number(m.etsyMediaId);
      if (m.kind === 'image') {
        if (m.operation === 'delete' && mediaId != null) ops.imageDeletes.set(mediaId, m.id);
        else if (m.operation === 'update_alt' && mediaId != null) {
          ops.imageAlts.set(mediaId, decodeEntities(String(m.altText ?? '')));
          ops.imageAltRows.set(mediaId, m.id);
        }
        else if (m.operation === 'reorder' && mediaId != null && m.rank != null) ops.imageReorders.set(mediaId, Number(m.rank));
      } else if (m.kind === 'video') {
        if (m.operation === 'delete' && mediaId != null) ops.videoDeletes.set(mediaId, m.id);
        else if (m.operation === 'upload') ops.videoUploads.push(m);
      }
    }
  }
  return ops;
}

export type TileStage = 'add' | 'delete' | 'reorder';

/** A strip tile (the `GridImage` shape of `ds/inputs/ImageGrid` plus what the photo panel needs). */
export interface PhotoTile {
  /** Stable grid id: `img:<etsy id>` for photos on Etsy, `new:<draft media id or temp id>` for staged uploads. */
  id: string;
  src: string;
  fullSrc: string;
  /** Decoded alt text (staged alt wins over Etsy's). */
  alt: string;
  staged?: TileStage;
  /** Etsy image id; null for a staged upload. */
  imageId: number | null;
  /** EtsyDraftMedia row id of a staged upload. */
  mediaId: string | null;
  pending: boolean;
  /** Alt text differs from Etsy because of a staged `update_alt`. */
  altStaged: boolean;
}

export function tileIdFor(img: Pick<EtsyImageLike, 'listing_image_id' | 'is_pending_upload' | 'pending_media_id'>): string {
  if (img.is_pending_upload) return `new:${img.pending_media_id || img.listing_image_id}`;
  return `img:${img.listing_image_id}`;
}

/**
 * Builds the strip tiles from the editor's ordered local images (Etsy images re-ranked by staged reorders,
 * then staged uploads) and the staged delete/alt ops. `originalRank` is Etsy's rank per image id.
 */
export function buildPhotoTiles(
  ordered: ReadonlyArray<EtsyImageLike>,
  ops: StagedMediaOps,
  originalRank: ReadonlyMap<number, number>,
): PhotoTile[] {
  // A photo's position is counted among the photos already on Etsy only: staged uploads (e.g. a Replace placed
  // mid-strip) take no Etsy rank until Send, so they must not make the photos after them look moved.
  let etsyPosition = 0;
  return ordered.map((img) => {
    const pending = Boolean(img.is_pending_upload);
    if (!pending) etsyPosition += 1;
    const imageId = pending ? null : img.listing_image_id;
    const stagedAlt = imageId != null ? ops.imageAlts.get(imageId) : undefined;
    const alt = decodeEntities(String(stagedAlt ?? img.alt_text ?? ''));
    let staged: TileStage | undefined;
    if (pending) staged = 'add';
    else if (imageId != null && ops.imageDeletes.has(imageId)) staged = 'delete';
    else if (imageId != null && originalRank.has(imageId) && originalRank.get(imageId) !== etsyPosition) staged = 'reorder';
    return {
      id: tileIdFor(img),
      src: img.url_570xN || img.url_fullxfull || '',
      fullSrc: img.url_fullxfull || img.url_570xN || '',
      alt,
      staged,
      imageId,
      mediaId: pending ? img.pending_media_id ?? null : null,
      pending,
      altStaged: stagedAlt !== undefined && stagedAlt !== decodeEntities(String(img.alt_text ?? '')),
    };
  });
}

/**
 * Reorders may only move photos that are already on Etsy (a staged upload gets its rank at upload time;
 * the legacy editor blocks it the same way). Returns the reordered list, or null when a staged upload's
 * position would change.
 */
export function applyTileOrder<T extends { id: string; pending: boolean }>(tiles: ReadonlyArray<T>, nextIds: ReadonlyArray<string>): T[] | null {
  if (nextIds.length !== tiles.length) return null;
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const next: T[] = [];
  for (const id of nextIds) {
    const tile = byId.get(id);
    if (!tile) return null;
    next.push(tile);
  }
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i].pending && next[i].id !== tiles[i].id) return null;
  }
  return next;
}

/**
 * Reorder media ops for every Etsy photo whose position differs from Etsy (the legacy stager's rule), plus every
 * photo whose already-staged reorder row no longer matches its position: moving a photo back to its Etsy place
 * must overwrite the old row (the server keeps one reorder row per image, last write wins), otherwise the stale
 * row would still move it on Send. Ranks count Etsy photos only (staged uploads skipped) and are capped at 20.
 */
export function reorderOpsFor(
  ordered: ReadonlyArray<Pick<EtsyImageLike, 'listing_image_id' | 'is_pending_upload'>>,
  originalRank: ReadonlyMap<number, number>,
  stagedRanks: ReadonlyMap<number, number> = new Map(),
): Array<{ kind: 'image'; operation: 'reorder'; etsyMediaId: number; rank: number }> {
  const ops: Array<{ kind: 'image'; operation: 'reorder'; etsyMediaId: number; rank: number }> = [];
  // Ranks are positions among the photos already on Etsy (staged uploads skipped), as in buildPhotoTiles.
  let etsyPosition = 0;
  ordered.forEach((img) => {
    if (img.is_pending_upload) return;
    etsyPosition += 1;
    const rank = Math.min(etsyPosition, PHOTO_MAX.etsy);
    const id = img.listing_image_id;
    const staged = stagedRanks.get(id);
    const differsFromEtsy = originalRank.get(id) !== rank;
    const staleRow = staged !== undefined && staged !== rank;
    if (!differsFromEtsy && !staleRow) return;
    if (staged === rank) return;
    ops.push({ kind: 'image', operation: 'reorder', etsyMediaId: id, rank });
  });
  return ops;
}

/** What the photos section reports upward (rail change list, score, preview, section-nav dot). */
export interface PhotosSummary {
  marketplace: 'etsy' | 'ebay';
  /** Photos that will be on the listing after Send, in order (staged deletes excluded). */
  images: Array<{ id: string; src: string; alt: string; staged?: 'add' | 'reorder' }>;
  count: number;
  /**
   * Slots the listing uses until Send finishes: every tile, staged removals included. The server sends uploads
   * before image deletes, so a removed photo still occupies its slot while new photos upload (Etsy max 20).
   */
  slots: number;
  max: number;
  /** Photos on Etsy (not staged uploads) without alt text; Etsy only. */
  missingAlt: number;
  hasVideo: boolean;
  changes: { added: number; removed: number; order: boolean; alt: number; video: boolean };
  /** Number of change groups (Photos, Photo order, Alt text, Video) for the "N edits not sent" count. */
  changeGroups: number;
}

export function summarizeEtsyPhotos(tiles: ReadonlyArray<PhotoTile>, video: { has: boolean; staged: boolean }): PhotosSummary {
  const visible = tiles.filter((t) => t.staged !== 'delete');
  const added = tiles.filter((t) => t.pending).length;
  const removed = tiles.filter((t) => t.staged === 'delete').length;
  // Position changes are read from the tiles (local order vs Etsy rank), so an unsent drag counts too.
  const order = tiles.some((t) => t.staged === 'reorder');
  const alt = tiles.filter((t) => t.altStaged && t.staged !== 'delete').length;
  const changes = { added, removed, order, alt, video: video.staged };
  return {
    marketplace: 'etsy',
    images: visible.map((t) => ({ id: t.id, src: t.src, alt: t.alt, ...(t.staged === 'add' || t.staged === 'reorder' ? { staged: t.staged } : {}) })),
    count: visible.length,
    slots: tiles.length,
    max: PHOTO_MAX.etsy,
    missingAlt: visible.filter((t) => !t.pending && !t.alt.trim()).length,
    hasVideo: video.has,
    changes,
    changeGroups: (added || removed ? 1 : 0) + (order ? 1 : 0) + (alt ? 1 : 0) + (video.staged ? 1 : 0),
  };
}

/** eBay photos are picture URLs held in the draft view; dirtiness is a comparison with the baseline. */
export function summarizeEbayPhotos(current: ReadonlyArray<string>, baseline: ReadonlyArray<string>): PhotosSummary {
  const base = new Set(baseline);
  const cur = new Set(current);
  const added = current.filter((u) => !base.has(u)).length;
  const removed = baseline.filter((u) => !cur.has(u)).length;
  const kept = current.filter((u) => base.has(u));
  const keptBase = baseline.filter((u) => cur.has(u));
  const order = kept.some((u, i) => keptBase[i] !== u);
  return {
    marketplace: 'ebay',
    images: current.map((u, i) => ({ id: `url:${i}:${u}`, src: u, alt: '', ...(base.has(u) ? {} : { staged: 'add' as const }) })),
    count: current.length,
    slots: current.length,
    max: PHOTO_MAX.ebay,
    missingAlt: 0,
    hasVideo: false,
    changes: { added, removed, order, alt: 0, video: false },
    changeGroups: (added || removed ? 1 : 0) + (order ? 1 : 0),
  };
}

export function sameUrlList(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((u, i) => u === b[i]);
}

/** "Paste image links": one https URL per line (or comma/space separated); duplicates and non-https dropped. */
export function parseImageLinks(text: string, room: number): { urls: string[]; rejected: number } {
  const parts = text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const urls: string[] = [];
  let rejected = 0;
  for (const p of parts) {
    let ok = false;
    try {
      const u = new URL(p);
      ok = u.protocol === 'https:' && Boolean(u.hostname);
    } catch { ok = false; }
    if (!ok || seen.has(p)) { rejected += 1; continue; }
    seen.add(p);
    if (urls.length < Math.max(0, room)) urls.push(p);
    else rejected += 1;
  }
  return { urls, rejected };
}

/** Alt text that goes to Etsy: decoded (never entities), trimmed, capped at Etsy's limit. */
export function cleanAltText(text: string): string {
  return decodeEntities(String(text ?? '')).replace(/\s+/g, ' ').trim().slice(0, ALT_TEXT_MAX);
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

export function splitImageFiles(files: ReadonlyArray<File>, room: number): { accepted: File[]; badType: number; overLimit: number } {
  const valid = files.filter((f) => (IMAGE_TYPES as readonly string[]).includes(f.type));
  const accepted = valid.slice(0, Math.max(0, room));
  return { accepted, badType: files.length - valid.length, overLimit: valid.length - accepted.length };
}
