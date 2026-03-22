import React, { useState, useRef, useCallback } from 'react';
import {
  Box,
  IconButton,
  Typography,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Tooltip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import StarIcon from '@mui/icons-material/Star';
import { toast } from 'react-hot-toast';

interface ImageInfo {
  listing_image_id: number;
  url_75x75: string;
  url_170x135: string;
  url_570xN: string;
  url_fullxfull?: string;
  rank: number;
  alt_text?: string;
}

interface ImageManagerProps {
  listingId: string;
  shopId: string;
  images: ImageInfo[];
  onImagesChanged: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:image/...;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ImageManager({ listingId, shopId, images, onImagesChanged }: ImageManagerProps) {
  const [uploading, setUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ImageInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [swapping, setSwapping] = useState<number | null>(null); // rank being swapped
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload dialog state
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadAltText, setUploadAltText] = useState('');

  const sortedImages = [...(images || [])].sort((a, b) => a.rank - b.rank);

  const uploadEndpoint = `/api/clawd/etsy?action=upload_image&listing_id=${listingId}&shop_id=${shopId}`;

  // --- Upload Dialog ---

  const openUploadDialog = () => {
    setUploadFile(null);
    setUploadPreview(null);
    setUploadAltText('');
    setUploadDialogOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Desteklenen formatlar: JPEG, PNG, GIF, WebP');
      return;
    }

    setUploadFile(file);
    const url = URL.createObjectURL(file);
    setUploadPreview(url);
  };

  const handleUploadSubmit = async () => {
    if (!uploadFile) return;

    if (sortedImages.length >= 10) {
      toast.error('Maksimum 10 görsel yüklenebilir');
      return;
    }

    setUploading(true);
    try {
      const base64 = await fileToBase64(uploadFile);
      const nextRank = sortedImages.length > 0
        ? Math.max(...sortedImages.map((i) => i.rank)) + 1
        : 1;

      const body: Record<string, unknown> = {
        image_base64: base64,
        image_content_type: uploadFile.type,
        rank: nextRank,
      };
      if (uploadAltText.trim()) {
        body.alt_text = uploadAltText.trim();
      }

      const res = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Görsel yüklenemedi');
      }

      toast.success('Görsel yüklendi');
      setUploadDialogOpen(false);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Görsel yüklenirken hata oluştu');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- Delete ---

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=delete_image&listing_id=${listingId}&image_id=${deleteConfirm.listing_image_id}&shop_id=${shopId}`,
        { method: 'DELETE' }
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

  // --- Reorder (swap) ---

  const handleSwap = useCallback(async (direction: 'up' | 'down', img: ImageInfo) => {
    const currentIndex = sortedImages.findIndex((i) => i.listing_image_id === img.listing_image_id);
    const neighborIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (neighborIndex < 0 || neighborIndex >= sortedImages.length) return;

    const neighbor = sortedImages[neighborIndex];
    const rankA = img.rank;
    const rankB = neighbor.rank;

    setSwapping(img.rank);
    try {
      // Step 1: Upload image A's URL to rank B (overwrite)
      const uploadA = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: img.url_fullxfull || img.url_570xN,
          rank: rankB,
          overwrite: true,
        }),
      });
      if (!uploadA.ok) {
        const err = await uploadA.json();
        throw new Error(err.error || 'Sıralama değiştirilemedi (adım 1)');
      }

      // Step 2: Upload image B's URL to rank A (overwrite)
      const uploadB = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: neighbor.url_fullxfull || neighbor.url_570xN,
          rank: rankA,
          overwrite: true,
        }),
      });
      if (!uploadB.ok) {
        const err = await uploadB.json();
        throw new Error(err.error || 'Sıralama değiştirilemedi (adım 2)');
      }

      toast.success('Sıralama güncellendi');
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Sıralama değiştirilirken hata oluştu');
    } finally {
      setSwapping(null);
    }
  }, [sortedImages, uploadEndpoint, onImagesChanged]);

  // --- Render ---

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Görseller ({sortedImages.length}/10)
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 1,
        }}
      >
        {sortedImages.map((img, idx) => {
          const isPrimary = img.rank === 1;
          const isSwapping = swapping === img.rank;

          return (
            <Box
              key={img.listing_image_id}
              sx={{
                position: 'relative',
                aspectRatio: '1',
                borderRadius: 1,
                overflow: 'hidden',
                border: isPrimary ? '2px solid #f59e0b' : '1px solid #e5e7eb',
                opacity: isSwapping ? 0.5 : 1,
                transition: 'opacity 0.2s',
                '&:hover .img-controls': { opacity: 1 },
              }}
            >
              <img
                src={img.url_570xN}
                alt={img.alt_text || `Görsel ${img.rank}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />

              {/* Loading overlay during swap */}
              {isSwapping && (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.6)',
                  }}
                >
                  <CircularProgress size={28} />
                </Box>
              )}

              {/* Rank badge + primary star */}
              <Box
                sx={{
                  position: 'absolute',
                  top: 4,
                  left: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                }}
              >
                {isPrimary && (
                  <Tooltip title="Ana görsel">
                    <StarIcon sx={{ fontSize: 18, color: '#f59e0b', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }} />
                  </Tooltip>
                )}
                <Box
                  sx={{
                    backgroundColor: isPrimary ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.6)',
                    color: 'white',
                    borderRadius: '50%',
                    width: 22,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {img.rank}
                </Box>
              </Box>

              {/* Alt text indicator */}
              {img.alt_text && (
                <Tooltip title={img.alt_text}>
                  <Box
                    sx={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: 'rgba(0,0,0,0.6)',
                      color: 'white',
                      fontSize: 10,
                      px: 0.5,
                      py: 0.25,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {img.alt_text}
                  </Box>
                </Tooltip>
              )}

              {/* Controls overlay (delete + reorder) */}
              <Box
                className="img-controls"
                sx={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.3,
                  opacity: 0,
                  transition: 'opacity 0.2s',
                }}
              >
                {/* Delete button */}
                <IconButton
                  size="small"
                  onClick={() => setDeleteConfirm(img)}
                  disabled={isSwapping}
                  sx={{
                    backgroundColor: 'rgba(239,68,68,0.9)',
                    color: 'white',
                    width: 24,
                    height: 24,
                    '&:hover': { backgroundColor: 'rgba(220,38,38,1)' },
                  }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>

                {/* Move up */}
                {idx > 0 && (
                  <Tooltip title="Yukarı taşı" placement="left">
                    <IconButton
                      size="small"
                      onClick={() => handleSwap('up', img)}
                      disabled={!!swapping}
                      sx={{
                        backgroundColor: 'rgba(59,130,246,0.85)',
                        color: 'white',
                        width: 24,
                        height: 24,
                        '&:hover': { backgroundColor: 'rgba(37,99,235,1)' },
                      }}
                    >
                      <ArrowUpwardIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                )}

                {/* Move down */}
                {idx < sortedImages.length - 1 && (
                  <Tooltip title="Aşağı taşı" placement="left">
                    <IconButton
                      size="small"
                      onClick={() => handleSwap('down', img)}
                      disabled={!!swapping}
                      sx={{
                        backgroundColor: 'rgba(59,130,246,0.85)',
                        color: 'white',
                        width: 24,
                        height: 24,
                        '&:hover': { backgroundColor: 'rgba(37,99,235,1)' },
                      }}
                    >
                      <ArrowDownwardIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          );
        })}

        {/* Add image button */}
        {sortedImages.length < 10 && (
          <Box
            onClick={() => !uploading && !swapping && openUploadDialog()}
            sx={{
              aspectRatio: '1',
              borderRadius: 1,
              border: '2px dashed #cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: uploading || swapping ? 'wait' : 'pointer',
              '&:hover': { borderColor: '#3b82f6', backgroundColor: '#f0f9ff' },
              transition: 'all 0.2s',
              minHeight: 120,
            }}
          >
            <AddPhotoAlternateIcon sx={{ fontSize: 32, color: '#94a3b8' }} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              Ekle
            </Typography>
          </Box>
        )}
      </Box>

      {/* Hidden file input for upload dialog */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* Upload dialog */}
      <Dialog
        open={uploadDialogOpen}
        onClose={() => !uploading && setUploadDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Görsel Yükle</DialogTitle>
        <DialogContent>
          {/* File picker area */}
          {!uploadPreview ? (
            <Box
              onClick={() => fileInputRef.current?.click()}
              sx={{
                border: '2px dashed #cbd5e1',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                cursor: 'pointer',
                '&:hover': { borderColor: '#3b82f6', backgroundColor: '#f0f9ff' },
                transition: 'all 0.2s',
              }}
            >
              <AddPhotoAlternateIcon sx={{ fontSize: 48, color: '#94a3b8' }} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Görsel seçmek için tıklayın
              </Typography>
              <Typography variant="caption" color="text.secondary">
                JPEG, PNG, GIF, WebP
              </Typography>
            </Box>
          ) : (
            <Box sx={{ textAlign: 'center', mb: 2 }}>
              <img
                src={uploadPreview}
                alt="Önizleme"
                style={{
                  maxWidth: '100%',
                  maxHeight: 200,
                  borderRadius: 8,
                  objectFit: 'contain',
                }}
              />
              <Typography
                variant="caption"
                color="primary"
                sx={{ display: 'block', mt: 1, cursor: 'pointer' }}
                onClick={() => fileInputRef.current?.click()}
              >
                Farklı görsel seç
              </Typography>
            </Box>
          )}

          {/* Alt text input */}
          <TextField
            label="Alt Metin (SEO)"
            placeholder="Ör: el yapımı ahşap bileklik, doğal taş"
            fullWidth
            size="small"
            value={uploadAltText}
            onChange={(e) => setUploadAltText(e.target.value)}
            sx={{ mt: 2 }}
            helperText="Arama motorları için açıklayıcı metin"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)} disabled={uploading}>
            İptal
          </Button>
          <Button
            onClick={handleUploadSubmit}
            variant="contained"
            disabled={!uploadFile || uploading}
          >
            {uploading ? <CircularProgress size={20} /> : 'Yükle'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onClose={() => !deleting && setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>Görseli Sil</DialogTitle>
        <DialogContent>
          <Typography>Bu görseli silmek istediğinize emin misiniz?</Typography>
          {deleteConfirm && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <img
                src={deleteConfirm.url_570xN}
                alt="Silinecek görsel"
                style={{ maxWidth: 160, borderRadius: 8 }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>
            İptal
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? <CircularProgress size={20} /> : 'Sil'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
