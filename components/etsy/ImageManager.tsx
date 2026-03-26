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
  Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import StarIcon from '@mui/icons-material/Star';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import EditIcon from '@mui/icons-material/Edit';
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
  const [swapping, setSwapping] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload dialog state
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadAltText, setUploadAltText] = useState('');

  // AI Image generation state
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiRefFile, setAiRefFile] = useState<File | null>(null);
  const [aiRefPreview, setAiRefPreview] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<{ base64: string; mimeType: string } | null>(null);
  const [aiUploading, setAiUploading] = useState(false);
  const [aiFollowUp, setAiFollowUp] = useState('');
  const [aiRefUrl, setAiRefUrl] = useState<string | null>(null); // URL of existing listing image used as reference
  const aiRefInputRef = useRef<HTMLInputElement>(null);

  // Alt text editing state
  const [editAltImage, setEditAltImage] = useState<ImageInfo | null>(null);
  const [editAltText, setEditAltText] = useState('');
  const [savingAlt, setSavingAlt] = useState(false);

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
      toast.error('Maksimum 10 gorsel yuklenebilir');
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
        throw new Error(err.error || 'Gorsel yuklenemedi');
      }

      toast.success('Gorsel yuklendi');
      setUploadDialogOpen(false);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Gorsel yuklenirken hata olustu');
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
        throw new Error(err.error || 'Gorsel silinemedi');
      }

      toast.success('Gorsel silindi');
      setDeleteConfirm(null);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Gorsel silinirken hata olustu');
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
        throw new Error(err.error || 'Siralama degistirilemedi (adim 1)');
      }

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
        throw new Error(err.error || 'Siralama degistirilemedi (adim 2)');
      }

      toast.success('Siralama guncellendi');
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Siralama degistirilirken hata olustu');
    } finally {
      setSwapping(null);
    }
  }, [sortedImages, uploadEndpoint, onImagesChanged]);

  // --- AI Image Generation ---

  const openAiDialog = () => {
    setAiPrompt('');
    setAiRefFile(null);
    setAiRefPreview(null);
    setAiRefUrl(null);
    setAiResult(null);
    setAiFollowUp('');
    setAiDialogOpen(true);
  };

  const handleAiRefSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAiRefFile(file);
    setAiRefPreview(URL.createObjectURL(file));
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) {
      toast.error('Bir prompt girin');
      return;
    }

    setAiGenerating(true);
    setAiResult(null);
    try {
      const payload: Record<string, any> = {
        prompt: aiPrompt.trim(),
      };

      // Add reference image if provided (uploaded file or existing listing image URL)
      if (aiRefFile) {
        const base64 = await fileToBase64(aiRefFile);
        payload.reference_image = base64;
        payload.reference_mime_type = aiRefFile.type;
      } else if (aiRefUrl) {
        payload.reference_image_url = aiRefUrl;
      }

      const res = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Gorsel olusturulamadi');
      }

      const data = await res.json();
      if (data.image_base64) {
        setAiResult({ base64: data.image_base64, mimeType: data.mime_type || 'image/png' });
        toast.success('Gorsel olusturuldu!');
      } else {
        throw new Error(data.text || 'Gorsel olusturulamadi');
      }
    } catch (err: any) {
      toast.error(err.message || 'AI gorsel olusturma hatasi');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiAcceptAndUpload = async () => {
    if (!aiResult) return;

    if (sortedImages.length >= 10) {
      toast.error('Maksimum 10 gorsel yuklenebilir');
      return;
    }

    setAiUploading(true);
    try {
      const nextRank = sortedImages.length > 0
        ? Math.max(...sortedImages.map((i) => i.rank)) + 1
        : 1;

      const res = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: aiResult.base64,
          image_content_type: aiResult.mimeType,
          rank: nextRank,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Gorsel yuklenemedi');
      }

      toast.success('AI gorseli listinge yuklendi!');
      setAiDialogOpen(false);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Gorsel yuklenirken hata olustu');
    } finally {
      setAiUploading(false);
    }
  };

  // --- Alt Text Edit ---

  const openAltEdit = (img: ImageInfo) => {
    setEditAltImage(img);
    setEditAltText(img.alt_text || '');
  };

  const handleSaveAltText = async () => {
    if (!editAltImage) return;
    setSavingAlt(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=update_listing_image&listing_id=${listingId}&image_id=${editAltImage.listing_image_id}&shop_id=${shopId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alt_text: editAltText.trim() }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Alt metin guncellenemedi');
      }
      toast.success('Alt metin guncellendi');
      setEditAltImage(null);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Alt metin guncellenirken hata olustu');
    } finally {
      setSavingAlt(false);
    }
  };

  // --- Render ---

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Gorseller ({sortedImages.length}/10)
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
                alt={img.alt_text || `Gorsel ${img.rank}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />

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
                  <Tooltip title="Ana gorsel">
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

              {/* Alt text indicator — click to edit */}
              <Tooltip title={img.alt_text ? `${img.alt_text} (duzenlemek icin tikla)` : 'Alt metin ekle (tikla)'}>
                <Box
                  onClick={(e) => { e.stopPropagation(); openAltEdit(img); }}
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: img.alt_text ? 'rgba(0,0,0,0.6)' : 'rgba(245,158,11,0.7)',
                    color: 'white',
                    fontSize: 10,
                    px: 0.5,
                    py: 0.25,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: img.alt_text ? 'rgba(0,0,0,0.8)' : 'rgba(245,158,11,0.9)' },
                  }}
                >
                  {img.alt_text || '+ Alt metin ekle'}
                </Box>
              </Tooltip>

              {/* Controls overlay */}
              <Box
                className="img-controls"
                sx={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.3,
                  opacity: { xs: 1, md: 0 },
                  transition: 'opacity 0.2s',
                }}
              >
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

                {idx > 0 && (
                  <Tooltip title="Yukari tasi" placement="left">
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

                {idx < sortedImages.length - 1 && (
                  <Tooltip title="Asagi tasi" placement="left">
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

                <Tooltip title="Alt metin duzenle" placement="left">
                  <IconButton
                    size="small"
                    onClick={() => openAltEdit(img)}
                    disabled={!!swapping}
                    sx={{
                      backgroundColor: 'rgba(16,185,129,0.85)',
                      color: 'white',
                      width: 24,
                      height: 24,
                      '&:hover': { backgroundColor: 'rgba(5,150,105,1)' },
                    }}
                  >
                    <EditIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
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

        {/* AI generate image button */}
        {sortedImages.length < 10 && (
          <Box
            onClick={() => !aiGenerating && openAiDialog()}
            sx={{
              aspectRatio: '1',
              borderRadius: 1,
              border: '2px dashed #c084fc',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: aiGenerating ? 'wait' : 'pointer',
              '&:hover': { borderColor: '#a855f7', backgroundColor: '#faf5ff' },
              transition: 'all 0.2s',
              minHeight: 120,
            }}
          >
            <AutoFixHighIcon sx={{ fontSize: 32, color: '#a855f7' }} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              AI Gorsel
            </Typography>
          </Box>
        )}
      </Box>

      {/* Hidden file input */}
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
        <DialogTitle>Gorsel Yukle</DialogTitle>
        <DialogContent>
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
                Gorsel secmek icin tiklayin
              </Typography>
              <Typography variant="caption" color="text.secondary">
                JPEG, PNG, GIF, WebP
              </Typography>
            </Box>
          ) : (
            <Box sx={{ textAlign: 'center', mb: 2 }}>
              <img
                src={uploadPreview}
                alt="Onizleme"
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
                Farkli gorsel sec
              </Typography>
            </Box>
          )}

          <TextField
            label="Alt Metin (SEO)"
            placeholder="Or: el yapimi ahsap bileklik, dogal tas"
            fullWidth
            size="small"
            value={uploadAltText}
            onChange={(e) => setUploadAltText(e.target.value)}
            sx={{ mt: 2 }}
            helperText="Arama motorlari icin aciklayici metin"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)} disabled={uploading}>
            Iptal
          </Button>
          <Button
            onClick={handleUploadSubmit}
            variant="contained"
            disabled={!uploadFile || uploading}
          >
            {uploading ? <CircularProgress size={20} /> : 'Yukle'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Image Generation Dialog */}
      <Dialog
        open={aiDialogOpen}
        onClose={() => !aiGenerating && !aiUploading && setAiDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoFixHighIcon sx={{ color: '#a855f7' }} />
          AI ile Gorsel Olustur
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Urun gorselinizi AI ile olusturun. Referans gorsel ekleyerek benzer stil/urun gorseli uretebilirsiniz.
          </Typography>

          <TextField
            label="Prompt"
            placeholder="ornek: Professional product photo of a handmade wooden phone stand on white background, studio lighting"
            fullWidth
            multiline
            minRows={3}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            disabled={aiGenerating}
            sx={{ mb: 2 }}
            helperText="Ingilizce prompt daha iyi sonuc verir"
          />

          {/* Reference image (optional) */}
          <input
            ref={aiRefInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={handleAiRefSelect}
          />

          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Referans Gorsel (opsiyonel)
            </Typography>

            {/* Selected reference preview */}
            {aiRefPreview ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <img
                  src={aiRefPreview}
                  alt="Referans"
                  style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '2px solid #a855f7' }}
                />
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {aiRefFile ? 'Yuklenen gorsel' : 'Listing gorseli'}
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => {
                      setAiRefFile(null);
                      setAiRefPreview(null);
                      setAiRefUrl(null);
                      if (aiRefInputRef.current) aiRefInputRef.current.value = '';
                    }}
                  >
                    Kaldir
                  </Button>
                </Box>
              </Box>
            ) : (
              <>
                {/* Existing listing images as selectable references */}
                {sortedImages.length > 0 && (
                  <Box sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      Mevcut gorsellerden sec:
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {sortedImages.map((img) => (
                        <Box
                          key={img.listing_image_id}
                          onClick={() => {
                            if (aiGenerating) return;
                            const fullUrl = img.url_fullxfull || img.url_570xN;
                            setAiRefUrl(fullUrl);
                            setAiRefPreview(img.url_570xN);
                            setAiRefFile(null);
                          }}
                          sx={{
                            width: 56,
                            height: 56,
                            borderRadius: 1,
                            overflow: 'hidden',
                            border: '2px solid #e5e7eb',
                            cursor: aiGenerating ? 'not-allowed' : 'pointer',
                            '&:hover': { borderColor: '#a855f7', transform: 'scale(1.05)' },
                            transition: 'all 0.15s',
                          }}
                        >
                          <img
                            src={img.url_170x135 || img.url_75x75}
                            alt={img.alt_text || `Gorsel ${img.rank}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Upload new reference image */}
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => aiRefInputRef.current?.click()}
                  disabled={aiGenerating}
                  startIcon={<AddPhotoAlternateIcon />}
                >
                  Bilgisayardan Yukle
                </Button>
              </>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Generate button */}
          <Button
            variant="contained"
            fullWidth
            onClick={handleAiGenerate}
            disabled={aiGenerating || !aiPrompt.trim()}
            startIcon={aiGenerating ? <CircularProgress size={18} color="inherit" /> : <AutoFixHighIcon />}
            sx={{
              bgcolor: '#a855f7',
              '&:hover': { bgcolor: '#9333ea' },
            }}
          >
            {aiGenerating ? 'Olusturuluyor...' : 'Gorsel Olustur'}
          </Button>

          {/* Result preview */}
          {aiResult && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ textAlign: 'center' }}>Olusturulan Gorsel:</Typography>
              <Box sx={{ textAlign: 'center' }}>
                <img
                  src={`data:${aiResult.mimeType};base64,${aiResult.base64}`}
                  alt="AI gorsel"
                  style={{
                    maxWidth: '100%',
                    maxHeight: 300,
                    borderRadius: 8,
                    border: '2px solid #a855f7',
                  }}
                />
              </Box>

              {/* Follow-up prompt for regeneration */}
              <TextField
                size="small"
                fullWidth
                placeholder="Degisiklik istegi: ornek: make the background darker, add more contrast..."
                value={aiFollowUp}
                onChange={(e) => setAiFollowUp(e.target.value)}
                disabled={aiGenerating}
                sx={{ mt: 1.5 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !aiGenerating) {
                    e.preventDefault();
                    // Use follow-up as new prompt with reference to current result
                    const followUpPrompt = aiFollowUp.trim()
                      ? `${aiPrompt}. Additional changes: ${aiFollowUp.trim()}`
                      : aiPrompt;
                    setAiPrompt(followUpPrompt);
                    setAiFollowUp('');
                    handleAiGenerate();
                  }
                }}
              />

              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  onClick={() => {
                    if (aiFollowUp.trim()) {
                      setAiPrompt(`${aiPrompt}. Additional changes: ${aiFollowUp.trim()}`);
                      setAiFollowUp('');
                    }
                    handleAiGenerate();
                  }}
                  disabled={aiGenerating}
                  size="small"
                  startIcon={aiGenerating ? <CircularProgress size={14} /> : null}
                >
                  {aiFollowUp.trim() ? 'Degisiklikle Olustur' : 'Ayni Promptla Olustur'}
                </Button>
                <Button
                  variant="contained"
                  onClick={handleAiAcceptAndUpload}
                  disabled={aiUploading}
                  startIcon={aiUploading ? <CircularProgress size={16} color="inherit" /> : null}
                  color="success"
                  size="small"
                >
                  {aiUploading ? 'Yukleniyor...' : 'Kabul Et ve Yukle'}
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiDialogOpen(false)} disabled={aiGenerating || aiUploading}>
            Kapat
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onClose={() => !deleting && setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>Gorseli Sil</DialogTitle>
        <DialogContent>
          <Typography>Bu gorseli silmek istediginize emin misiniz?</Typography>
          {deleteConfirm && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <img
                src={deleteConfirm.url_570xN}
                alt="Silinecek gorsel"
                style={{ maxWidth: 160, borderRadius: 8 }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>
            Iptal
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? <CircularProgress size={20} /> : 'Sil'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Alt text edit dialog */}
      <Dialog
        open={!!editAltImage}
        onClose={() => !savingAlt && setEditAltImage(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Alt Metin Duzenle</DialogTitle>
        <DialogContent>
          {editAltImage && (
            <Box sx={{ textAlign: 'center', mb: 2 }}>
              <img
                src={editAltImage.url_570xN}
                alt="Duzenlenecek gorsel"
                style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8, objectFit: 'contain' }}
              />
            </Box>
          )}
          <TextField
            label="Alt Metin (SEO)"
            placeholder="Or: handmade wooden bracelet, natural stone beads"
            fullWidth
            size="small"
            multiline
            minRows={2}
            value={editAltText}
            onChange={(e) => setEditAltText(e.target.value)}
            disabled={savingAlt}
            helperText="Arama motorlari icin aciklayici metin (Ingilizce onerilir)"
            inputProps={{ maxLength: 250 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
            {editAltText.length}/250
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditAltImage(null)} disabled={savingAlt}>
            Iptal
          </Button>
          <Button
            onClick={handleSaveAltText}
            variant="contained"
            disabled={savingAlt}
            color="success"
          >
            {savingAlt ? <CircularProgress size={20} /> : 'Kaydet'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
