// components/ebay/VideoUploader.tsx — the eBay listing video in the editor's Photos section (same feel as Etsy's
// embedded VideoUploader): the photo strip's trailing tile, the video panel (player, Replace, Remove, Undo) and the
// staging calls. Nothing here talks to eBay's listing: a picked file or a Video Studio result is staged as an
// EbayDraftMedia row (kind 'video'); a removal of the listing's video is a staged 'delete' row. The video reaches
// eBay (Media API upload, then product.videoIds / VideoDetails) only with the footer's "Send changes".
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { StripVideo } from '@/components/ds/inputs/ImageGrid';
import { useToast } from '@/components/ds/feedback/toast';
import { PhotoPanel } from '@/components/domain/listing-editor/sections/PhotoPanel';
import {
  fetchEbayDrafts,
  fetchEbayVideoInfo,
  removeEbayDraftMedia,
  stageEbayAiVideo,
  stageEbayDraft,
  stageEbayDraftFile,
  type EbayVideoInfoView,
} from '@/lib/ebay/draftClient';

/** eBay listing video: MP4 / MOV, at most 150 MB (Media API createVideo size max 157,286,400 bytes). */
export const EBAY_VIDEO_ACCEPT = ['video/mp4', 'video/quicktime'] as const;
export const EBAY_VIDEO_MAX = 157_286_400;

interface MediaRow {
  id: string;
  kind: string;
  operation: string;
  payload?: Record<string, unknown> | null;
}

export interface EbayStagedVideo {
  draftId: string | null;
  draftError: string | null;
  upload: MediaRow | null;
  remove: MediaRow | null;
}

const NONE: EbayStagedVideo = { draftId: null, draftError: null, upload: null, remove: null };

/** The staged video rows of a SKU's open draft (newest upload; a removal). Pure, exported for tests. */
export function stagedVideoOf(drafts: unknown[], sku: string): EbayStagedVideo {
  const d = (Array.isArray(drafts) ? drafts : []).find((x: any) => x && String(x.sku) === sku) as any;
  if (!d) return NONE;
  const rows: MediaRow[] = (Array.isArray(d.media) ? d.media : []).filter((m: any) => m?.kind === 'video');
  const uploads = rows.filter((m) => m.operation === 'upload');
  return {
    draftId: String(d.id),
    draftError: typeof d.lastSyncError === 'string' ? d.lastSyncError : null,
    upload: uploads.length ? uploads[uploads.length - 1] : null,
    remove: rows.find((m) => m.operation === 'delete') ?? null,
  };
}

export interface EbayVideoStatus {
  /** A staged upload eBay is still processing (sent once; the next send attaches it). */
  processing: boolean;
  /** eBay rejected the staged video (BLOCKED / PROCESSING_FAILED). */
  rejected: boolean;
  /** The eBay token cannot use the Media API: reconnect eBay. */
  reconnect: boolean;
  /** A staging request is running. */
  busy: boolean;
}

interface Props {
  /** eBay SKU (edit) or the local SKU of a new listing. */
  sku: string;
  /** The listing's current eBay video id (Inventory product.videoIds[0] / Trading VideoDetails.VideoID). */
  remoteVideoId: string | null;
  /** New listing: the draft may not exist yet (the server creates it without reading eBay). */
  isNew?: boolean;
  /** Called before the first staging of a new listing (saves the fields so the draft carries the create action). */
  ensureDraft?: () => Promise<void>;
  onVideoChanged: () => void;
  onTileChange?: (tile: StripVideo | null) => void;
  onStatus?: (status: EbayVideoStatus) => void;
  /** Changes when the DB draft changed elsewhere → staged rows are re-read. */
  draftVersion?: string | number | null;
  readOnly?: boolean;
  onLocalChange?: () => void;
}

export interface EbayVideoUploaderHandle {
  stage(): Promise<void>;
  isDirty(): boolean;
  pick(): void;
  open(): void;
  undoRemove(): void;
  stageFile(file: File): Promise<void>;
  /** Stages a finished Video Studio video by its job id (copied server side). */
  stageAiVideo(jobId: string): Promise<void>;
}

/** HLS plays natively only in Safari / iOS; elsewhere the panel shows the poster. */
function canPlayHls(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
  } catch {
    return false;
  }
}

const EbayVideoUploader = forwardRef<EbayVideoUploaderHandle, Props>(function EbayVideoUploader({
  sku, remoteVideoId, isNew = false, ensureDraft, onVideoChanged, onTileChange, onStatus, draftVersion, readOnly = false, onLocalChange,
}, ref) {
  const t = useTranslations('listingEditor');
  const tEbay = useTranslations('ebay');
  const toast = useToast();
  const [staged, setStaged] = useState<EbayStagedVideo>(NONE);
  const [reloadKey, setReloadKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [remote, setRemote] = useState<EbayVideoInfoView | null>(null);
  const [reconnect, setReconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflightRef = useRef<Set<Promise<unknown>>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sku) return undefined;
    let cancelled = false;
    fetchEbayDrafts(sku)
      .then((drafts: unknown[]) => { if (!cancelled) setStaged(stagedVideoOf(drafts, sku)); })
      .catch(() => { /* keep the last known staged state; the editor's draft check reports failures */ });
    return () => { cancelled = true; };
  }, [sku, draftVersion, reloadKey]);

  useEffect(() => {
    if (!remoteVideoId) { setRemote(null); return undefined; }
    let cancelled = false;
    fetchEbayVideoInfo(remoteVideoId)
      .then((info) => { if (!cancelled) { setRemote(info); setReconnect(false); } })
      .catch((err: any) => {
        if (cancelled) return;
        // The tile still shows (no poster); a scope / token problem asks for a reconnect.
        setRemote({ videoId: remoteVideoId, status: 'UNKNOWN' });
        if (err?.code === 'VIDEO_RECONNECT') setReconnect(true);
      });
    return () => { cancelled = true; };
  }, [remoteVideoId]);

  const uploadPayload = (staged.upload?.payload ?? {}) as Record<string, unknown>;
  const rejected = Boolean(staged.upload && uploadPayload.rejected);
  const processing = Boolean(staged.upload && !rejected && uploadPayload.ebayVideoId);
  const sendReconnect = staged.draftError === 'ebay.draftSync.videoReconnect';

  const tile: StripVideo | null = useMemo(() => {
    if (staged.upload) return { src: `/api/ebay-drafts/media-preview?id=${encodeURIComponent(staged.upload.id)}`, staged: 'add' };
    if (remoteVideoId) {
      return {
        src: remote?.playUrl && canPlayHls() ? remote.playUrl : undefined,
        poster: remote?.thumbnailUrl,
        staged: staged.remove ? 'delete' : undefined,
      };
    }
    return null;
  }, [staged.upload, staged.remove, remoteVideoId, remote]);
  const tileKey = JSON.stringify(tile);
  const onTileChangeRef = useRef(onTileChange);
  onTileChangeRef.current = onTileChange;
  useEffect(() => { onTileChangeRef.current?.(tile); }, [tileKey]); // tileKey stands for `tile`

  const status: EbayVideoStatus = { processing, rejected, reconnect: reconnect || sendReconnect, busy };
  const statusKey = JSON.stringify(status);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => { onStatusRef.current?.(status); }, [statusKey]); // statusKey stands for `status`

  const onLocalChangeRef = useRef(onLocalChange);
  onLocalChangeRef.current = onLocalChange;
  const track = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const p = work();
    inflightRef.current.add(p);
    setBusy(true);
    onLocalChangeRef.current?.();
    const done = () => {
      inflightRef.current.delete(p);
      setBusy(inflightRef.current.size > 0);
      onLocalChangeRef.current?.();
    };
    p.then(done, done);
    return p;
  }, []);

  const errorText = (err: any, fallback: string) => {
    const key = typeof err?.key === 'string' ? err.key : null;
    return key && tEbay.has(key as any) ? tEbay(key as any, err?.params ?? {}) : fallback;
  };

  const after = () => {
    setReloadKey((k) => k + 1);
    onVideoChanged();
  };

  const stageVideoFile = async (file: File) => {
    if (readOnly) return;
    if (!(EBAY_VIDEO_ACCEPT as readonly string[]).includes(file.type)) {
      toast.error(t('video.ebayUnsupported'), { persist: false });
      return;
    }
    if (file.size > EBAY_VIDEO_MAX) {
      toast.error(t('video.ebayTooLarge'), { persist: false });
      return;
    }
    try {
      await track(async () => {
        if (isNew && !staged.draftId) await ensureDraft?.();
        // The server keeps one staged video per listing (an earlier staged upload / removal is dropped).
        await stageEbayDraftFile({ sku, file, kind: 'video', operation: 'upload', isNew });
      });
      toast.success(t('video.ebayStaged'));
    } catch (err) {
      toast.error(errorText(err, t('video.ebayStageFailed')));
    } finally {
      after();
    }
  };

  const stageAi = async (jobId: string) => {
    if (readOnly) return;
    try {
      await track(async () => {
        if (isNew && !staged.draftId) await ensureDraft?.();
        await stageEbayAiVideo({ sku, jobId, isNew });
      });
      toast.success(t('aiVideo.used'));
    } catch (err) {
      toast.error(errorText(err, t('aiVideo.error.use')));
    } finally {
      after();
    }
  };

  const removeVideo = async () => {
    if (readOnly) return;
    try {
      if (staged.upload && staged.draftId) {
        // A staged video leaves the draft; the listing's own video (if any) stays.
        const draftId = staged.draftId;
        const rowId = staged.upload.id;
        await track(() => removeEbayDraftMedia(draftId, [rowId]));
        setPanelOpen(false);
      } else if (remoteVideoId && !staged.remove) {
        await track(() => stageEbayDraft({ sku, media: [{ kind: 'video', operation: 'delete', payload: { videoId: remoteVideoId } }] }));
      }
    } catch (err) {
      toast.error(errorText(err, t('video.ebayStageFailed')));
    } finally {
      after();
    }
  };

  const undoRemove = async () => {
    if (!staged.remove || !staged.draftId || readOnly) return;
    const draftId = staged.draftId;
    const rowId = staged.remove.id;
    try {
      await track(() => removeEbayDraftMedia(draftId, [rowId]));
    } catch (err) {
      toast.error(errorText(err, t('video.ebayStageFailed')));
    } finally {
      after();
    }
  };

  useImperativeHandle(ref, () => ({
    async stage() { await Promise.all(Array.from(inflightRef.current)); },
    isDirty() { return inflightRef.current.size > 0; },
    pick() { if (!readOnly) fileRef.current?.click(); },
    open() { if (tile) setPanelOpen(true); else if (!readOnly) fileRef.current?.click(); },
    undoRemove() { void undoRemove(); },
    async stageFile(file: File) { await stageVideoFile(file); },
    async stageAiVideo(jobId: string) { await stageAi(jobId); },
  }));

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={[...EBAY_VIDEO_ACCEPT, '.mp4', '.mov'].join(',')}
        hidden
        data-testid="ebay-video-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void stageVideoFile(file);
        }}
      />
      <PhotoPanel
        open={panelOpen && Boolean(tile)}
        onClose={() => setPanelOpen(false)}
        marketplaceName="eBay"
        media={tile ? {
          kind: 'video',
          src: tile.src,
          poster: tile.poster,
          pending: tile.staged === 'add',
          removing: tile.staged === 'delete',
          processing: staged.upload ? processing : remote?.status === 'PROCESSING' || remote?.status === 'PENDING_UPLOAD',
        } : null}
        onReplace={(file) => stageVideoFile(file)}
        onRemove={staged.upload || (remoteVideoId && !staged.remove) ? () => { void removeVideo(); } : undefined}
        onUndoRemove={staged.remove && !staged.upload ? () => { void undoRemove(); } : undefined}
        readOnly={readOnly}
        data-testid="ebay-video-panel"
      />
    </>
  );
});

export default EbayVideoUploader;
