import React, { useState, useRef } from 'react';
import { Box, Typography, Button, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { toast } from 'react-hot-toast';

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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<VideoInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/')) {
      toast.error('Lütfen bir video dosyası seçin');
      return;
    }

    // Validate file size (100MB max)
    if (file.size > 100 * 1024 * 1024) {
      toast.error('Video dosyası maksimum 100MB olabilir');
      return;
    }

    // Check if already has a video
    if (videos.length > 0) {
      toast.error('Önce mevcut videoyu silmeniz gerekiyor');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('video', file);

      // Simulate progress since fetch doesn't support progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 5, 90));
      }, 500);

      const res = await fetch(
        `/api/clawd/etsy?action=upload_video&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'POST',
          body: formData,
        }
      );

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Video yüklenemedi');
      }

      toast.success('Video yüklendi! İşlenmesi birkaç dakika sürebilir.');
      onVideoChanged();
    } catch (err: any) {
      toast.error(err.message || 'Video yüklenirken hata oluştu');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
        throw new Error(err.error || 'Video silinemedi');
      }

      toast.success('Video silindi');
      setDeleteConfirm(null);
      onVideoChanged();
    } catch (err: any) {
      toast.error(err.message || 'Video silinirken hata oluştu');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Video ({videos.length}/1)
      </Typography>

      {videos.length > 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, border: '1px solid #e5e7eb', borderRadius: 1 }}>
          <VideoLibraryIcon sx={{ fontSize: 40, color: '#6366f1' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" fontWeight={600}>
              Video {videos[0].state === 'processing' ? '(İşleniyor...)' : '(Hazır)'}
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
          onClick={() => !uploading && fileInputRef.current?.click()}
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
          {uploading ? (
            <Box>
              <CircularProgress size={32} variant="determinate" value={uploadProgress} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Yükleniyor... %{uploadProgress}
              </Typography>
            </Box>
          ) : (
            <>
              <CloudUploadIcon sx={{ fontSize: 36, color: '#94a3b8' }} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Video yükle
              </Typography>
              <Typography variant="caption" color="text.secondary">
                MP4/MOV, maks. 100MB, 5-60 saniye
              </Typography>
            </>
          )}
        </Box>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/mov"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>Videoyu Sil</DialogTitle>
        <DialogContent>
          <Typography>Bu videoyu silmek istediğinize emin misiniz?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>İptal</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? <CircularProgress size={20} /> : 'Sil'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
