import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Box, Typography, Button, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, TextField } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import AddLinkIcon from '@mui/icons-material/AddLink';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { draftErrorI18n } from '@/lib/etsy/seoRules';
import { fetchEtsyDrafts, stageEtsyDraft, stageEtsyDraftFile } from '@/lib/etsy/draftClient';
// Embedded mode (listing editor M6, Group C): the video is the photo strip's trailing tile + the photo panel.
import type { StripVideo } from '@/components/ds/inputs/ImageGrid';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { useToast } from '@/components/ds/feedback/toast';
import { PhotoPanel } from '@/components/domain/listing-editor/sections/PhotoPanel';
import {
  EMPTY_STAGED_OPS, VIDEO_MAX_BYTES, VIDEO_TYPES, collectStagedOps, type StagedMediaOps,
} from '@/components/domain/listing-editor/sections/photosModel';

interface VideoInfo {
  video_id: number;
  thumbnail_url?: string;
  video_url?: string;
  state?: string;
}

interface VideoUploaderProps {
  listingId: string;
  shopId: string;
  videos: VideoInfo[];
  onVideoChanged: () => void;
  /**
   * Listing editor (M6) mode: renders no box of its own. The video shows as the photo strip's trailing tile
   * (`onTileChange` → ImageManager `video`), opens in the photo panel, and exposes `stage()` / `isDirty()` /
   * `pick()` / `open()` through the ref. Staging calls are the same (`stageEtsyDraftFile` kind video, media delete).
   */
  embedded?: boolean;
  /** Embedded: the tile to show (null = no video; the strip then shows "Add video"). */
  onTileChange?: (tile: StripVideo | null) => void;
  /** Embedded: drops one staged EtsyDraftMedia row (see ImageManager). Optional until the route exists. */
  removeStagedMedia?: (draftMediaId: string) => Promise<void>;
  /** Embedded: changes when the DB draft changed elsewhere → staged video ops are re-read. */
  draftVersion?: string | number | null;
  readOnly?: boolean;
  /** Embedded: a staging request started or settled → the editor recounts / schedules. */
  onLocalChange?: () => void;
}

/** Ref handle of the embedded VideoUploader (registered by PhotosSection as `photos:video`). */
export interface VideoUploaderHandle {
  /** Waits for a video upload/delete in flight; throws when that request fails. */
  stage(): Promise<void>;
  isDirty(): boolean;
  /** File picker: adds a video, or replaces the current one (its delete is staged first). */
  pick(): void;
  /** Opens the video panel (player, Replace, Remove). */
  open(): void;
  /** Undo a staged removal (only with `removeStagedMedia`). */
  undoRemove(): void;
}

const VideoUploader = forwardRef<VideoUploaderHandle, VideoUploaderProps>(function VideoUploader({
  listingId, shopId, videos, onVideoChanged, embedded = false, onTileChange, removeStagedMedia, draftVersion, readOnly = false, onLocalChange,
}, ref) {
  const t = useTranslations('etsy.video');
  const tEtsyRoot = useTranslations('etsy');
  /** Server validation errors carry an i18n key (etsy.validation.*, etsy.draftSync.*); never show raw text. */
  const draftErr = (err: unknown, fallback: string): string => {
    const i18n = draftErrorI18n(err);
    return i18n && tEtsyRoot.has(i18n.key as any) ? tEtsyRoot(i18n.key as any, i18n.params as any) : fallback;
  };
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<VideoInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (videos.length > 0) {
      toast.error(t('deleteExistingFirst'));
      return;
    }

    // Validate file type
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowedTypes.includes(file.type)) {
      toast.error(t('unsupportedFormat'));
      return;
    }

    // Validate file size (100MB)
    if (file.size > 100 * 1024 * 1024) {
      toast.error(t('fileTooLarge'));
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      await stageEtsyDraftFile({ shopId, listingId, file, kind: 'video', operation: 'upload' });
      setUploadProgress(100);
      toast.success(t('uploadStaged'));
      onVideoChanged();
    } catch (err: any) {
      console.error('[VideoUploader] upload failed', { name: file.name, size: file.size, type: file.type, error: err });
      toast.error(draftErr(err, t('uploadErrorDetail', { size: (file.size / 1024 / 1024).toFixed(1), type: file.type || '?' })), { duration: 6000 });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleUploadByUrl = async () => {
    if (!videoUrl.trim()) {
      toast.error(t('enterVideoUrl'));
      return;
    }

    if (videos.length > 0) {
      toast.error(t('deleteExistingFirst'));
      return;
    }

    setUploading(true);

    try {
      await stageEtsyDraft({
        shopId,
        listingId,
        media: [{ kind: 'video', operation: 'upload', sourceUrl: videoUrl.trim() }],
      });
      toast.success(t('urlStaged'));
      setUrlDialogOpen(false);
      setVideoUrl('');
      onVideoChanged();
    } catch (err: any) {
      console.error('[VideoUploader] URL staging failed', err);
      toast.error(draftErr(err, t('uploadError')));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await stageEtsyDraft({
        shopId,
        listingId,
        media: [{ kind: 'video', operation: 'delete', etsyMediaId: deleteConfirm.video_id }],
      });
      toast.success(t('deleteStaged'));
      setDeleteConfirm(null);
      onVideoChanged();
    } catch (err: any) {
      console.error('[VideoUploader] delete staging failed', err);
      toast.error(draftErr(err, t('deleteError')));
    } finally {
      setDeleting(false);
    }
  };


  // --- Embedded (listing editor) -------------------------------------------------------------------------------
  const tLe = useTranslations('listingEditor');
  const dsToast = useToast();
  const dsConfirm = useConfirm();
  const [stagedOps, setStagedOps] = useState<StagedMediaOps>(EMPTY_STAGED_OPS);
  const [reloadKey, setReloadKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const inflightRef = useRef<Set<Promise<unknown>>>(new Set());
  const embeddedFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!embedded) return undefined;
    let cancelled = false;
    fetchEtsyDrafts(shopId, listingId)
      .then((drafts) => { if (!cancelled) setStagedOps(collectStagedOps(drafts)); })
      .catch(() => { /* keep the last known staged state; the editor's own draft check reports failures */ });
    return () => { cancelled = true; };
  }, [embedded, shopId, listingId, draftVersion, reloadKey]);

  const remote = videos[0] || null;
  const stagedUpload = stagedOps.videoUploads.length ? stagedOps.videoUploads[stagedOps.videoUploads.length - 1] : null;
  const remoteDeleteRow = remote ? stagedOps.videoDeletes.get(Number(remote.video_id)) ?? null : null;
  const tile: StripVideo | null = useMemo(() => {
    if (stagedUpload) {
      return { src: stagedUpload.sourceUrl || `/api/etsy-drafts/media-preview?id=${encodeURIComponent(stagedUpload.id)}`, staged: 'add' };
    }
    if (remote) return { src: remote.video_url, poster: remote.thumbnail_url, staged: remoteDeleteRow ? 'delete' : undefined };
    return null;
  }, [stagedUpload, remote, remoteDeleteRow]);
  const tileKey = JSON.stringify(tile);
  const onTileChangeRef = useRef(onTileChange);
  onTileChangeRef.current = onTileChange;
  useEffect(() => {
    if (embedded) onTileChangeRef.current?.(tile);
    // tileKey stands for `tile`.
  }, [embedded, tileKey]);

  const onLocalChangeRef = useRef(onLocalChange);
  onLocalChangeRef.current = onLocalChange;
  const track = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const p = work();
    inflightRef.current.add(p);
    onLocalChangeRef.current?.();
    const done = () => { inflightRef.current.delete(p); onLocalChangeRef.current?.(); };
    p.then(done, done);
    return p;
  }, []);

  const embeddedError = (err: unknown, fallback: string) => {
    console.error('[VideoUploader] embedded staging failed', err);
    dsToast.error(draftErr(err, fallback));
  };

  const stageVideoFile = async (file: File) => {
    if (readOnly) return;
    if (!(VIDEO_TYPES as readonly string[]).includes(file.type)) {
      dsToast.error(tLe('video.unsupported'), { persist: false });
      return;
    }
    if (file.size > VIDEO_MAX_BYTES) {
      dsToast.error(tLe('video.tooLarge'), { persist: false });
      return;
    }
    if (stagedUpload && !removeStagedMedia) {
      // A second staged upload would make Send try two videos; Etsy allows one.
      dsToast.info(tLe('video.pendingRemoveViaDiscard'));
      return;
    }
    try {
      await track(async () => {
        // Upload first: if it is rejected (type, size, 413, network) nothing else changes, so a failed Replace can
        // never leave a staged delete of the live video behind. Etsy allows one video; the server sends video
        // deletes before uploads whatever order the rows were staged in.
        await stageEtsyDraftFile({ shopId, listingId, file, kind: 'video', operation: 'upload' });
        if (stagedUpload && removeStagedMedia) await removeStagedMedia(stagedUpload.id);
        if (remote && !remoteDeleteRow) {
          const draft = await stageEtsyDraft({ shopId, listingId, media: [{ kind: 'video', operation: 'delete', etsyMediaId: remote.video_id }] });
          if (draft) setStagedOps(collectStagedOps([draft]));
        }
      });
    } catch (err) {
      embeddedError(err, t('uploadErrorDetail', { size: Math.round(file.size / 1024 / 1024), type: file.type || '?' }));
    } finally {
      setReloadKey((k) => k + 1);
      onVideoChanged();
    }
  };

  const removeVideoEmbedded = async () => {
    if (readOnly) return;
    if (stagedUpload) {
      if (!removeStagedMedia) { dsToast.info(tLe('video.pendingRemoveViaDiscard')); return; }
      try {
        await track(() => removeStagedMedia(stagedUpload.id));
        setPanelOpen(false);
      } catch (err) { embeddedError(err, t('deleteError')); }
      setReloadKey((k) => k + 1);
      onVideoChanged();
      return;
    }
    if (!remote || remoteDeleteRow) return;
    if (!removeStagedMedia) {
      const ok = await dsConfirm({
        title: tLe('video.confirmRemoveTitle'),
        body: tLe('photos.confirmRemoveBody', { marketplace: 'Etsy' }),
        confirmLabel: tLe('photos.remove'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    try {
      const draft = await track(() => stageEtsyDraft({ shopId, listingId, media: [{ kind: 'video', operation: 'delete', etsyMediaId: remote.video_id }] }));
      if (draft) setStagedOps(collectStagedOps([draft]));
      onVideoChanged();
    } catch (err) { embeddedError(err, t('deleteError')); }
  };

  const undoRemoveEmbedded = async () => {
    if (!remoteDeleteRow || !removeStagedMedia) return;
    try {
      await track(() => removeStagedMedia(remoteDeleteRow));
    } catch (err) { embeddedError(err, t('deleteError')); }
    setReloadKey((k) => k + 1);
    onVideoChanged();
  };

  useImperativeHandle(ref, () => ({
    async stage() {
      // Rejects when a video upload/delete still in flight fails (it was already shown as a toast).
      await Promise.all(Array.from(inflightRef.current));
    },
    isDirty() { return inflightRef.current.size > 0; },
    pick() { if (!readOnly) embeddedFileRef.current?.click(); },
    open() { if (tile) setPanelOpen(true); else embeddedFileRef.current?.click(); },
    undoRemove() { void undoRemoveEmbedded(); },
  }));

  if (embedded) {
    return (
      <>
        <input
          ref={embeddedFileRef}
          type="file"
          accept={VIDEO_TYPES.join(',')}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void stageVideoFile(file);
          }}
        />
        <PhotoPanel
          open={panelOpen && Boolean(tile)}
          onClose={() => setPanelOpen(false)}
          marketplaceName="Etsy"
          media={tile ? {
            kind: 'video',
            src: tile.src,
            poster: tile.poster,
            pending: tile.staged === 'add',
            removing: tile.staged === 'delete',
            processing: !stagedUpload && remote?.state === 'processing',
          } : null}
          onReplace={(file) => stageVideoFile(file)}
          onRemove={stagedUpload && !removeStagedMedia ? undefined : () => { void removeVideoEmbedded(); }}
          onUndoRemove={remoteDeleteRow && removeStagedMedia ? () => { void undoRemoveEmbedded(); } : undefined}
          readOnly={readOnly}
          data-testid="video-panel"
        />
      </>
    );
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t('videoCount', { current: videos.length, max: 1 })}
      </Typography>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />

      {videos.length > 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, border: '1px solid #e5e7eb', borderRadius: 1 }}>
          <VideoLibraryIcon sx={{ fontSize: 40, color: '#6366f1' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" fontWeight={600}>
              Video {videos[0].state === 'processing' ? t('processing') : t('ready')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ID: {videos[0].video_id}
            </Typography>
          </Box>
          <IconButton
            onClick={() => setDeleteConfirm(videos[0])}
            color="error"
            size="small"
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ) : uploading ? (
        <Box sx={{ p: 3, border: '2px dashed #6366f1', borderRadius: 1, textAlign: 'center', backgroundColor: '#f5f3ff' }}>
          <CircularProgress size={36} variant={uploadProgress > 0 ? 'determinate' : 'indeterminate'} value={uploadProgress} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {uploadProgress > 0 ? `${t('uploading')} ${uploadProgress}%` : t('uploading')}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {/* Direct file upload */}
          <Box
            onClick={() => fileInputRef.current?.click()}
            sx={{
              flex: 1,
              p: 3,
              border: '2px dashed #cbd5e1',
              borderRadius: 1,
              textAlign: 'center',
              cursor: 'pointer',
              '&:hover': { borderColor: '#6366f1', backgroundColor: '#f5f3ff' },
              transition: 'all 0.2s',
            }}
          >
            <CloudUploadIcon sx={{ fontSize: 36, color: '#6366f1' }} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('uploadFile')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('formatHint')}
            </Typography>
          </Box>

          {/* URL upload */}
          <Box
            onClick={() => setUrlDialogOpen(true)}
            sx={{
              flex: 1,
              p: 3,
              border: '2px dashed #cbd5e1',
              borderRadius: 1,
              textAlign: 'center',
              cursor: 'pointer',
              '&:hover': { borderColor: '#94a3b8', backgroundColor: '#f8fafc' },
              transition: 'all 0.2s',
            }}
          >
            <AddLinkIcon sx={{ fontSize: 36, color: '#94a3b8' }} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('addByUrl')}
            </Typography>
          </Box>
        </Box>
      )}

      {/* URL input dialog */}
      <Dialog open={urlDialogOpen} onClose={() => !uploading && setUrlDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('addByUrlTitle')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Video URL"
            placeholder="https://example.com/video.mp4"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            disabled={uploading}
            sx={{ mt: 1 }}
            helperText={t('formatHelperText')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setUrlDialogOpen(false); setVideoUrl(''); }} disabled={uploading}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleUploadByUrl}
            variant="contained"
            disabled={uploading || !videoUrl.trim()}
          >
            {uploading ? <CircularProgress size={20} /> : t('add')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>{t('deleteVideoTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('deleteConfirm')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>{t('cancel')}</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? <CircularProgress size={20} /> : t('delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});

export default VideoUploader;
