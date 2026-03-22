import React, { useState, useRef } from 'react';
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
import LinkIcon from '@mui/icons-material/Link';
import { toast } from 'react-hot-toast';

interface ImageManagerProps {
  images: string[];
  onImagesChanged: (newImages: string[]) => void;
  maxImages?: number;
}

export default function ImageManager({ images, onImagesChanged, maxImages = 24 }: ImageManagerProps) {
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortedImages = images || [];

  const handleAddUrl = () => {
    const url = urlInput.trim();
    if (!url) {
      toast.error('Lütfen bir URL girin');
      return;
    }

    try {
      new URL(url);
    } catch {
      toast.error('Geçerli bir URL girin');
      return;
    }

    if (sortedImages.length >= maxImages) {
      toast.error(`Maksimum ${maxImages} görsel eklenebilir`);
      return;
    }

    onImagesChanged([...sortedImages, url]);
    setUrlInput('');
    setShowUrlInput(false);
    toast.success('Görsel eklendi');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Desteklenen formatlar: JPEG, PNG, GIF, WebP');
      return;
    }

    if (sortedImages.length >= maxImages) {
      toast.error(`Maksimum ${maxImages} görsel eklenebilir`);
      return;
    }

    // Convert to data URL
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onImagesChanged([...sortedImages, dataUrl]);
      toast.success('Görsel eklendi');
    };
    reader.onerror = () => {
      toast.error('Dosya okunamadı');
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = () => {
    if (deleteConfirmIndex === null) return;
    const newImages = sortedImages.filter((_, i) => i !== deleteConfirmIndex);
    onImagesChanged(newImages);
    setDeleteConfirmIndex(null);
    toast.success('Görsel silindi');
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Görseller ({sortedImages.length}/{maxImages})
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 1 }}>
        {sortedImages.map((imgUrl, index) => (
          <Box
            key={`${imgUrl}-${index}`}
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
              src={imgUrl}
              alt={`Görsel ${index + 1}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Rank badge */}
            <Box
              sx={{
                position: 'absolute',
                top: 4,
                left: 4,
                backgroundColor: index === 0 ? 'rgba(34,197,94,0.85)' : 'rgba(0,0,0,0.6)',
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
              {index + 1}
            </Box>
            {/* Delete button */}
            <IconButton
              className="delete-btn"
              size="small"
              onClick={() => setDeleteConfirmIndex(index)}
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

        {/* Add buttons */}
        {sortedImages.length < maxImages && (
          <>
            {/* File upload button */}
            <Box
              onClick={() => fileInputRef.current?.click()}
              sx={{
                aspectRatio: '1',
                borderRadius: 1,
                border: '2px dashed #cbd5e1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                '&:hover': { borderColor: '#3b82f6', backgroundColor: '#f0f9ff' },
                transition: 'all 0.2s',
              }}
            >
              <AddPhotoAlternateIcon sx={{ fontSize: 28, color: '#94a3b8' }} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                Dosya
              </Typography>
            </Box>

            {/* URL add button */}
            <Tooltip title="URL ile ekle">
              <Box
                onClick={() => setShowUrlInput(true)}
                sx={{
                  aspectRatio: '1',
                  borderRadius: 1,
                  border: '2px dashed #cbd5e1',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  '&:hover': { borderColor: '#8b5cf6', backgroundColor: '#faf5ff' },
                  transition: 'all 0.2s',
                }}
              >
                <LinkIcon sx={{ fontSize: 28, color: '#94a3b8' }} />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                  URL
                </Typography>
              </Box>
            </Tooltip>
          </>
        )}
      </Box>

      {/* URL input row */}
      {showUrlInput && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="https://example.com/image.jpg"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddUrl();
            }}
          />
          <Button variant="contained" size="small" onClick={handleAddUrl}>
            Ekle
          </Button>
          <Button size="small" onClick={() => { setShowUrlInput(false); setUrlInput(''); }}>
            İptal
          </Button>
        </Box>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmIndex !== null} onClose={() => setDeleteConfirmIndex(null)} maxWidth="xs">
        <DialogTitle>Görseli Sil</DialogTitle>
        <DialogContent>
          <Typography>Bu görseli silmek istediğinize emin misiniz?</Typography>
          {deleteConfirmIndex !== null && sortedImages[deleteConfirmIndex] && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <img
                src={sortedImages[deleteConfirmIndex]}
                alt="Silinecek görsel"
                style={{ maxWidth: 120, borderRadius: 8 }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmIndex(null)}>İptal</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Sil
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
