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
  LinearProgress,
  TextField,
  Collapse,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ImageIcon from '@mui/icons-material/Image';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

interface ImageManagerProps {
  images: string[];
  onImagesChanged: (newImages: string[]) => void;
  maxImages?: number;
  /** Optional product title for auto-prompting */
  productTitle?: string;
}

const VALID_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_SIZE = 12 * 1024 * 1024; // 12MB

export default function ImageManager({ images, onImagesChanged, maxImages = 24, productTitle }: ImageManagerProps) {
  const t = useTranslations('ebay.imageManager');
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0-100
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refImageInputRef = useRef<HTMLInputElement>(null);

  // AI Image Generation state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiFollowUp, setAiFollowUp] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ base64: string; mimeType: string } | null>(null);
  const [aiRefImage, setAiRefImage] = useState<{ base64: string; mimeType: string } | null>(null);
  const [aiRefUrl, setAiRefUrl] = useState<string | null>(null); // URL-based reference (from existing images)
  const [aiUploading, setAiUploading] = useState(false);

  const sortedImages = images || [];
  const remaining = maxImages - sortedImages.length;

  // Upload a single file and return the public URL
  const uploadFile = useCallback(async (file: File): Promise<string | null> => {
    if (!VALID_TYPES.includes(file.type)) {
      toast.error(t('unsupportedFormat', { name: file.name }));
      return null;
    }
    if (file.size > MAX_SIZE) {
      toast.error(t('fileTooLarge', { name: file.name }));
      return null;
    }

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/clawd/upload-image', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t('uploadFailedFile', { name: file.name }));
    }

    const data = await res.json();
    return data.url;
  }, []);

  // Upload multiple files sequentially with progress
  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const allowed = files.slice(0, remaining);
    if (allowed.length < files.length) {
      toast.error(t('maxImagesSkipped', { max: maxImages, count: files.length - allowed.length }));
    }
    if (allowed.length === 0) return;

    setUploading(true);
    setUploadProgress(0);
    const newUrls: string[] = [];
    let completed = 0;

    for (const file of allowed) {
      try {
        const url = await uploadFile(file);
        if (url) newUrls.push(url);
      } catch (err: any) {
        toast.error(err.message || t('imageUploadFailed'));
      }
      completed++;
      setUploadProgress(Math.round((completed / allowed.length) * 100));
    }

    if (newUrls.length > 0) {
      onImagesChanged([...sortedImages, ...newUrls]);
      toast.success(t('imagesUploaded', { count: newUrls.length }));
    }

    setUploading(false);
    setUploadProgress(0);
  }, [remaining, maxImages, sortedImages, onImagesChanged, uploadFile]);

  // File input change (click to browse)
  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await uploadFiles(Array.from(fileList));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadFiles]);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) {
      toast.error(t('onlyImageFiles'));
      return;
    }
    await uploadFiles(files);
  }, [uploadFiles]);

  // Reorder via drag between images
  const handleImageDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleImageDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const reordered = [...sortedImages];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);
    onImagesChanged(reordered);
    setDragIndex(index);
  }, [dragIndex, sortedImages, onImagesChanged]);

  const handleImageDragEnd = useCallback(() => {
    setDragIndex(null);
  }, []);

  const handleDelete = () => {
    if (deleteConfirmIndex === null) return;
    const newImages = sortedImages.filter((_, i) => i !== deleteConfirmIndex);
    onImagesChanged(newImages);
    setDeleteConfirmIndex(null);
  };

  // ---- AI Image Generation ----

  const handleOpenAI = () => {
    setAiOpen(true);
    setAiPreview(null);
    setAiRefImage(null);
    setAiRefUrl(null);
    // Auto-fill prompt from product title if available
    if (productTitle && !aiPrompt) {
      setAiPrompt(productTitle);
    }
  };

  const handleRefImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('refImageTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract base64 and mime
      const match = result.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        setAiRefImage({ base64: match[2], mimeType: match[1] });
      }
    };
    reader.readAsDataURL(file);
    if (refImageInputRef.current) refImageInputRef.current.value = '';
  };

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) {
      toast.error(t('promptRequired'));
      return;
    }

    setAiGenerating(true);
    setAiPreview(null);

    try {
      const body: Record<string, any> = {
        prompt: aiPrompt.trim(),
      };

      if (aiRefImage) {
        body.reference_image = aiRefImage.base64;
        body.reference_mime_type = aiRefImage.mimeType;
      } else if (aiRefUrl) {
        body.reference_image_url = aiRefUrl;
      }

      const res = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t('generationFailed', { status: String(res.status) }));
      }

      if (data.image_base64) {
        setAiPreview({
          base64: data.image_base64,
          mimeType: data.mime_type || 'image/jpeg',
        });
      } else {
        throw new Error(t('noImageReturned'));
      }
    } catch (err: any) {
      toast.error(err.message || t('aiGenerationFailed'));
    } finally {
      setAiGenerating(false);
    }
  };

  // Upload the AI-generated image (base64 → File → upload-image endpoint → URL)
  const handleAcceptAIImage = async () => {
    if (!aiPreview) return;
    if (remaining <= 0) {
      toast.error(t('maxImagesReached', { max: maxImages }));
      return;
    }

    setAiUploading(true);
    try {
      // Convert base64 to Blob then File
      const byteString = atob(aiPreview.base64);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const ext = aiPreview.mimeType === 'image/png' ? '.png' : '.jpg';
      const blob = new Blob([ab], { type: aiPreview.mimeType });
      const file = new File([blob], `ai-generated-${Date.now()}${ext}`, { type: aiPreview.mimeType });

      const url = await uploadFile(file);
      if (url) {
        onImagesChanged([...sortedImages, url]);
        toast.success(t('aiImageAdded'));
        setAiPreview(null);
        setAiOpen(false);
      }
    } catch (err: any) {
      toast.error(err.message || t('imageUploadFailed'));
    } finally {
      setAiUploading(false);
    }
  };

  return (
    <Box>
      {/* Drop zone */}
      <Box
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        sx={{
          border: dragOver ? '2px dashed #1976d2' : '2px dashed #cbd5e1',
          borderRadius: 2,
          p: sortedImages.length === 0 ? 4 : 2,
          mb: 2,
          textAlign: 'center',
          cursor: uploading ? 'wait' : 'pointer',
          bgcolor: dragOver ? '#e3f2fd' : uploading ? '#fafafa' : 'transparent',
          transition: 'all 0.2s',
          '&:hover': uploading ? {} : { borderColor: '#1976d2', bgcolor: '#f5f9ff' },
        }}
      >
        {uploading ? (
          <Box>
            <CircularProgress size={28} sx={{ mb: 1 }} />
            <Typography variant="body2" fontWeight={600}>
              {t('uploadingProgress', { progress: uploadProgress })}
            </Typography>
            <LinearProgress variant="determinate" value={uploadProgress} sx={{ mt: 1, mx: 'auto', maxWidth: 300, borderRadius: 1 }} />
          </Box>
        ) : (
          <Box>
            <AddPhotoAlternateIcon sx={{ fontSize: 36, color: dragOver ? '#1976d2' : '#94a3b8', mb: 0.5 }} />
            <Typography variant="body2" fontWeight={600} color={dragOver ? 'primary' : 'text.secondary'}>
              {sortedImages.length === 0
                ? t('dropOrClick')
                : t('addMore', { remaining })
              }
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('formatHint')}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Image grid */}
      {sortedImages.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            {t('imageCount', { count: sortedImages.length, max: maxImages })}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 1 }}>
            {sortedImages.map((imgUrl, index) => (
              <Box
                key={`${imgUrl}-${index}`}
                draggable
                onDragStart={() => handleImageDragStart(index)}
                onDragOver={(e) => handleImageDragOver(e, index)}
                onDragEnd={handleImageDragEnd}
                sx={{
                  position: 'relative',
                  aspectRatio: '1',
                  borderRadius: 1,
                  overflow: 'hidden',
                  border: index === 0 ? '2px solid #22c55e' : '1px solid #e5e7eb',
                  cursor: 'grab',
                  opacity: dragIndex === index ? 0.4 : 1,
                  transition: 'opacity 0.15s',
                  '&:hover .img-actions': { opacity: 1 },
                }}
              >
                <img
                  src={imgUrl}
                  alt={t('imageAlt', { index: index + 1 })}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                />
                {/* Rank badge */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    backgroundColor: index === 0 ? 'rgba(34,197,94,0.9)' : 'rgba(0,0,0,0.6)',
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
                  {index === 0 ? <DragIndicatorIcon sx={{ fontSize: 14 }} /> : index + 1}
                </Box>
                {/* Cover label for first image */}
                {index === 0 && (
                  <Box
                    sx={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      bgcolor: 'rgba(34,197,94,0.85)',
                      color: 'white',
                      fontSize: 10,
                      fontWeight: 700,
                      textAlign: 'center',
                      py: 0.25,
                    }}
                  >
                    {t('cover')}
                  </Box>
                )}
                {/* Delete button */}
                <IconButton
                  className="img-actions"
                  size="small"
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirmIndex(index); }}
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
          </Box>
        </>
      )}

      {/* AI Generate button */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<AutoFixHighIcon />}
          onClick={handleOpenAI}
          disabled={remaining <= 0}
        >
          {t('aiGenerate')}
        </Button>
      </Box>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />
      <input
        ref={refImageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={handleRefImageSelect}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmIndex !== null} onClose={() => setDeleteConfirmIndex(null)} maxWidth="xs" sx={{ zIndex: 1500 }}>
        <DialogTitle>{t('deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('deleteConfirm')}</Typography>
          {deleteConfirmIndex !== null && sortedImages[deleteConfirmIndex] && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <img
                src={sortedImages[deleteConfirmIndex]}
                alt={t('imageToDelete')}
                style={{ maxWidth: 120, borderRadius: 8 }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmIndex(null)}>{t('cancel')}</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            {t('delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Image Generation Dialog — high z-index for nesting inside other dialogs */}
      <Dialog
        open={aiOpen}
        onClose={() => !aiGenerating && !aiUploading && setAiOpen(false)}
        maxWidth="sm"
        fullWidth
        sx={{ zIndex: 1500 }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoFixHighIcon color="primary" />
            {t('aiGeneratorTitle')}
          </Box>
          <IconButton size="small" onClick={() => setAiOpen(false)} disabled={aiGenerating || aiUploading}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* Prompt */}
            <TextField
              label={t('promptLabel')}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              multiline
              rows={3}
              fullWidth
              size="small"
              placeholder={t('promptPlaceholder')}
              disabled={aiGenerating}
            />

            {/* Reference image */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                {t('referenceImageOptional')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ImageIcon />}
                  onClick={() => refImageInputRef.current?.click()}
                  disabled={aiGenerating}
                >
                  {t('uploadFromFile')}
                </Button>
                {/* Show current reference */}
                {(aiRefImage || aiRefUrl) && (
                  <>
                    <img
                      src={aiRefImage ? `data:${aiRefImage.mimeType};base64,${aiRefImage.base64}` : aiRefUrl!}
                      alt={t('referenceAlt')}
                      style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '2px solid #1976d2' }}
                    />
                    <Button
                      size="small"
                      color="error"
                      onClick={() => { setAiRefImage(null); setAiRefUrl(null); }}
                      disabled={aiGenerating}
                      sx={{ minWidth: 0, px: 1 }}
                    >
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </Button>
                  </>
                )}
              </Box>
              {/* Pick from existing listing images */}
              {sortedImages.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                    {t('orPickExisting')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {sortedImages.map((imgUrl, idx) => (
                      <Box
                        key={idx}
                        onClick={() => {
                          if (aiGenerating) return;
                          setAiRefImage(null);
                          setAiRefUrl(imgUrl);
                        }}
                        sx={{
                          width: 44,
                          height: 44,
                          borderRadius: 1,
                          overflow: 'hidden',
                          cursor: aiGenerating ? 'default' : 'pointer',
                          border: aiRefUrl === imgUrl ? '2px solid #1976d2' : '1px solid #ddd',
                          opacity: aiGenerating ? 0.5 : 1,
                          transition: 'border 0.15s',
                          '&:hover': aiGenerating ? {} : { borderColor: '#1976d2' },
                        }}
                      >
                        <img
                          src={imgUrl}
                          alt={t('refAlt', { index: idx + 1 })}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>

            {/* Generate button */}
            <Button
              variant="contained"
              onClick={handleAIGenerate}
              disabled={aiGenerating || !aiPrompt.trim()}
              startIcon={aiGenerating ? <CircularProgress size={18} color="inherit" /> : <AutoFixHighIcon />}
              fullWidth
            >
              {aiGenerating ? t('generating') : t('generateImage')}
            </Button>

            {/* Preview */}
            {aiPreview && (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                <img
                  src={`data:${aiPreview.mimeType};base64,${aiPreview.base64}`}
                  alt={t('aiGeneratedAlt')}
                  style={{ width: '100%', display: 'block' }}
                />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, bgcolor: '#f9fafb' }}>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={handleAcceptAIImage}
                    disabled={aiUploading}
                    startIcon={aiUploading ? <CircularProgress size={16} color="inherit" /> : <AddPhotoAlternateIcon />}
                    fullWidth
                  >
                    {aiUploading ? t('adding') : t('addToListing')}
                  </Button>

                  {/* Follow-up prompt for regeneration */}
                  <TextField
                    value={aiFollowUp}
                    onChange={(e) => setAiFollowUp(e.target.value)}
                    size="small"
                    fullWidth
                    placeholder={t('followUpPlaceholder')}
                    disabled={aiGenerating}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (aiFollowUp.trim()) {
                          setAiPrompt(aiFollowUp.trim());
                          setAiFollowUp('');
                        }
                        handleAIGenerate();
                      }
                    }}
                  />
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      variant="outlined"
                      onClick={() => {
                        if (aiFollowUp.trim()) {
                          setAiPrompt(aiFollowUp.trim());
                          setAiFollowUp('');
                        }
                        handleAIGenerate();
                      }}
                      disabled={aiGenerating}
                      startIcon={aiGenerating ? <CircularProgress size={14} /> : undefined}
                      fullWidth
                    >
                      {aiFollowUp.trim() ? t('regenerateWithChanges') : t('regenerateSamePrompt')}
                    </Button>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
