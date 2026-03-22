import React, { useState, useRef } from 'react';
import { Box, IconButton, Typography, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, Button, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import { toast } from 'react-hot-toast';

interface ImageInfo {
  listing_image_id: number;
  url_75x75: string;
  url_170x135: string;
  url_570xN: string;
  url_fullxfull?: string;
  rank: number;
}

interface ImageManagerProps {
  listingId: string;
  shopId: string;
  images: ImageInfo[];
  onImagesChanged: () => void;
}

export default function ImageManager({ listingId, shopId, images, onImagesChanged }: ImageManagerProps) {
  const [uploading, setUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ImageInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortedImages = [...(images || [])].sort((a, b) => a.rank - b.rank);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Desteklenen formatlar: JPEG, PNG, GIF, WebP');
      return;
    }

    // Validate max 10 images
    if (sortedImages.length >= 10) {
      toast.error('Maksimum 10 görsel yüklenebilir');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch(
        `/api/clawd/etsy?action=upload_image&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Görsel yüklenemedi');
      }

      toast.success('Görsel yüklendi');
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Görsel yüklenirken hata oluştu');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=delete_image&listing_id=${listingId}&image_id=${deleteConfirm.listing_image_id}&shop_id=${shopId}`,
        {
          method: 'DELETE',
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Görsel silinemedi');
      }

      toast.success('Görsel silindi');
      setDeleteConfirm(null);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Görsel silinirken hata oluştu');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Görseller ({sortedImages.length}/10)
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 1 }}>
        {sortedImages.map((img) => (
          <Box
            key={img.listing_image_id}
            sx={{
              position: 'relative',
              aspectRatio: '1',
              borderRadius: 1,
              overflow: 'hidden',
              border: '1px solid #e5e7eb',
              '&:hover .delete-btn': { opacity: 1 },
            }}
          >
            <img
              src={img.url_170x135}
              alt={`Görsel ${img.rank}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Rank badge */}
            <Box
              sx={{
                position: 'absolute',
                top: 4,
                left: 4,
                backgroundColor: 'rgba(0,0,0,0.6)',
                color: 'white',
                borderRadius: '50%',
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {img.rank}
            </Box>
            {/* Delete button */}
            <IconButton
              className="delete-btn"
              size="small"
              onClick={() => setDeleteConfirm(img)}
              sx={{
                position: 'absolute',
                top: 2,
                right: 2,
                opacity: 0,
                transition: 'opacity 0.2s',
                backgroundColor: 'rgba(239,68,68,0.9)',
                color: 'white',
                width: 22,
                height: 22,
                '&:hover': { backgroundColor: 'rgba(220,38,38,1)' },
              }}
            >
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ))}

        {/* Upload button */}
        {sortedImages.length < 10 && (
          <Box
            onClick={() => !uploading && fileInputRef.current?.click()}
            sx={{
              aspectRatio: '1',
              borderRadius: 1,
              border: '2px dashed #cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: uploading ? 'wait' : 'pointer',
              '&:hover': { borderColor: '#3b82f6', backgroundColor: '#f0f9ff' },
              transition: 'all 0.2s',
            }}
          >
            {uploading ? (
              <CircularProgress size={24} />
            ) : (
              <>
                <AddPhotoAlternateIcon sx={{ fontSize: 28, color: '#94a3b8' }} />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                  Ekle
                </Typography>
              </>
            )}
          </Box>
        )}
      </Box>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>Görseli Sil</DialogTitle>
        <DialogContent>
          <Typography>Bu görseli silmek istediğinize emin misiniz?</Typography>
          {deleteConfirm && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <img
                src={deleteConfirm.url_170x135}
                alt="Silinecek görsel"
                style={{ maxWidth: 120, borderRadius: 8 }}
              />
            </Box>
          )}
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
