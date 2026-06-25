import React, { useRef, useState } from 'react';
import { Box, Typography, Button, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, TextField } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import AddLinkIcon from '@mui/icons-material/AddLink';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { stageEtsyDraft, stageEtsyDraftFile } from '@/lib/etsy/draftClient';

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
}

export default function VideoUploader({ listingId, shopId, videos, onVideoChanged }: VideoUploaderProps) {
  const t = useTranslations('etsy.video');
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
      toast.success('Video upload saved to draft. Sync to Etsy when ready.');
      onVideoChanged();
    } catch (err: any) {
      const detail = `${err?.message || t('uploadError')} (${(file.size / 1024 / 1024).toFixed(1)} MB, ${file.type || 'unknown'})`;
      console.error('[VideoUploader] upload failed', { name: file.name, size: file.size, type: file.type, error: err });
      toast.error(detail, { duration: 6000 });
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
      toast.success('Video URL saved to draft. Sync to Etsy when ready.');
      setUrlDialogOpen(false);
      setVideoUrl('');
      onVideoChanged();
    } catch (err: any) {
      toast.error(err.message || t('uploadError'));
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
      toast.success('Video delete saved to draft. Sync to Etsy when ready.');
      setDeleteConfirm(null);
      onVideoChanged();
    } catch (err: any) {
      toast.error(err.message || t('deleteError'));
    } finally {
      setDeleting(false);
    }
  };

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
}
