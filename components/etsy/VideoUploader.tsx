import React, { useState } from 'react';
import { Box, Typography, Button, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, TextField } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import AddLinkIcon from '@mui/icons-material/AddLink';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

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
  const [deleteConfirm, setDeleteConfirm] = useState<VideoInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');

  const handleUploadByUrl = async () => {
    if (!videoUrl.trim()) {
      toast.error(t('enterVideoUrl'));
      return;
    }

    // Check if already has a video
    if (videos.length > 0) {
      toast.error(t('deleteExistingFirst'));
      return;
    }

    setUploading(true);

    try {
      const res = await fetch(
        `/api/clawd/etsy?action=upload_video&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_url: videoUrl.trim() }),
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t('uploadFailed'));
      }

      toast.success(t('uploadSuccess'));
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
      const res = await fetch(
        `/api/clawd/etsy?action=delete_video&listing_id=${listingId}&video_id=${deleteConfirm.video_id}&shop_id=${shopId}`,
        {
          method: 'DELETE',
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t('deleteFailed'));
      }

      toast.success(t('deleteSuccess'));
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
      ) : (
        <Box
          onClick={() => !uploading && setUrlDialogOpen(true)}
          sx={{
            p: 3,
            border: '2px dashed #cbd5e1',
            borderRadius: 1,
            textAlign: 'center',
            cursor: uploading ? 'wait' : 'pointer',
            '&:hover': { borderColor: '#6366f1', backgroundColor: '#f5f3ff' },
            transition: 'all 0.2s',
          }}
        >
          <AddLinkIcon sx={{ fontSize: 36, color: '#94a3b8' }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('addByUrl')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('formatHint')}
          </Typography>
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
