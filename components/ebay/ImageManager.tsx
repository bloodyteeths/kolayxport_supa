import React, { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
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
import { AI_MAX_REFERENCE_IMAGES } from '@/lib/ai/referenceImages';
// Embedded mode (listing editor M6, Group C): DS strip + photo panel. The picture list stays a controlled field.
import { ImageGrid, moveItem, type StripVideo } from '@/components/ds/inputs/ImageGrid';
import { PhotoPanel } from '@/components/domain/listing-editor/sections/PhotoPanel';
import { IMAGE_TYPES, summarizeEbayPhotos, type PhotosSummary } from '@/components/domain/listing-editor/sections/photosModel';

interface ImageManagerProps {
  images: string[];
  onImagesChanged: (newImages: string[]) => void;
  maxImages?: number;
  /** Optional product title for auto-prompting */
  productTitle?: string;
  /**
   * Listing editor (M6) mode: DS photo strip (`ImageGrid variant="strip"`) + photo SidePanel instead of the
   * dropzone grid and dialogs. The URL list stays controlled (`onImagesChanged` → the editor's `images` field,
   * staged by the eBay adapter); the ref's `stage()` waits for picture uploads in flight.
   */
  embedded?: boolean;
  /** Embedded: the URLs on eBay (staged badges, summary). Default: the images at mount. */
  baseline?: string[];
  /** Embedded: what is on the strip (score, preview, "Not sent yet"). */
  onSummary?: (summary: PhotosSummary) => void;
  readOnly?: boolean;
  /** Embedded: text of the inline dropzone when there are no photos. */
  emptyMessage?: React.ReactNode;
  /** Embedded: the listing video as the strip's trailing tile (components/ebay/VideoUploader). */
  video?: StripVideo | null;
  onOpenVideo?: () => void;
  /** Embedded: shows the "Add video" tile when there is no video. */
  onAddVideo?: () => void;
  onUndoDeleteVideo?: () => void;
}

/** Ref handle of the embedded eBay ImageManager (registered by PhotosSection as `photos:images`). */
export interface EbayImageManagerHandle {
  /** Waits for picture uploads in flight (the URL list itself is a field the adapter stages). */
  stage(): Promise<void>;
  /** A picture upload in flight (its URL is not in the field yet). */
  isDirty(): boolean;
  openUpload(): void;
  openGenerate(): void;
  openPhoto(index?: number): void;
}

/** Stable strip ids for a URL list (the same URL twice gets `#2`). */
function urlTileIds(urls: string[]): string[] {
  const seen = new Map<string, number>();
  return urls.map((u) => {
    const n = (seen.get(u) ?? 0) + 1;
    seen.set(u, n);
    return n > 1 ? `${u}#${n}` : u;
  });
}

const VALID_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_SIZE = 12 * 1024 * 1024; // 12MB

const ImageManager = forwardRef<EbayImageManagerHandle, ImageManagerProps>(function ImageManager({
  images, onImagesChanged, maxImages = 24, productTitle, embedded = false, baseline, onSummary, readOnly = false, emptyMessage,
  video, onOpenVideo, onAddVideo, onUndoDeleteVideo,
}, ref) {
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
  // Listing photos the seller took out of the references. Every listing photo is a reference by default, so the
  // AI keeps the real product instead of drawing one from the prompt alone.
  const [aiRefExcluded, setAiRefExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [aiUploading, setAiUploading] = useState(false);

  const sortedImages = images || [];
  const remaining = maxImages - sortedImages.length;
  /** The latest URL list: an embedded upload resolving later appends to it, keeping removals/moves made meanwhile. */
  const imagesRef = useRef(sortedImages);
  imagesRef.current = sortedImages;

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
      onImagesChanged([...(embedded ? imagesRef.current : sortedImages), ...newUrls]);
      toast.success(t('imagesUploaded', { count: newUrls.length }));
    }

    setUploading(false);
    setUploadProgress(0);
  }, [remaining, maxImages, sortedImages, onImagesChanged, uploadFile, embedded]);

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
    setAiRefExcluded(new Set());
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

      // An uploaded file plus every listing photo still selected (cover first), up to the model's reference limit.
      if (aiRefImage) body.reference_images = [{ data: aiRefImage.base64, mime_type: aiRefImage.mimeType }];
      const refUrls = sortedImages.filter((u) => !aiRefExcluded.has(u));
      if (refUrls.length) body.reference_image_urls = refUrls.slice(0, Math.max(0, AI_MAX_REFERENCE_IMAGES - (aiRefImage ? 1 : 0)));

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
        onImagesChanged([...(embedded ? imagesRef.current : sortedImages), url]);
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

  // AI image generation (reference input + dialog), shared by the legacy grid and the embedded strip; unchanged.
  const aiDialog = (
    <>
      <input
        ref={refImageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={handleRefImageSelect}
      />
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
                {/* Uploaded reference */}
                {aiRefImage && (
                  <>
                    <img
                      src={`data:${aiRefImage.mimeType};base64,${aiRefImage.base64}`}
                      alt={t('referenceAlt')}
                      style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '2px solid #1976d2' }}
                    />
                    <Button
                      size="small"
                      color="error"
                      onClick={() => setAiRefImage(null)}
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
                    {sortedImages.map((imgUrl, idx) => {
                      const selected = !aiRefExcluded.has(imgUrl);
                      return (
                      <Box
                        key={idx}
                        role="checkbox"
                        aria-checked={selected}
                        aria-label={t('refAlt', { index: idx + 1 })}
                        onClick={() => {
                          if (aiGenerating) return;
                          setAiRefExcluded((prev) => {
                            const next = new Set(prev);
                            if (next.has(imgUrl)) next.delete(imgUrl);
                            else next.add(imgUrl);
                            return next;
                          });
                        }}
                        sx={{
                          width: 44,
                          height: 44,
                          borderRadius: 1,
                          overflow: 'hidden',
                          cursor: aiGenerating ? 'default' : 'pointer',
                          border: selected ? '2px solid #1976d2' : '1px solid #ddd',
                          opacity: aiGenerating ? 0.5 : selected ? 1 : 0.4,
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
                      );
                    })}
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
                    onClick={embedded ? () => { void trackUpload(handleAcceptAIImage()); } : handleAcceptAIImage}
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
    </>
  );

  // --- Embedded (listing editor) -------------------------------------------------------------------------------
  const tLe = useTranslations('listingEditor');
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const baselineRef = useRef<string[]>(baseline ?? images ?? []);
  if (baseline) baselineRef.current = baseline;
  const inflightRef = useRef<Set<Promise<unknown>>>(new Set());
  const embeddedFileRef = useRef<HTMLInputElement>(null);

  const trackUpload = (work: Promise<unknown>) => {
    inflightRef.current.add(work);
    const done = () => { inflightRef.current.delete(work); };
    work.then(done, done);
    return work;
  };

  const tileIds = useMemo(() => urlTileIds(sortedImages), [sortedImages]);
  const baseSet = useMemo(() => new Set(baselineRef.current), [baseline, embedded]);
  const summary = useMemo(() => summarizeEbayPhotos(sortedImages, baselineRef.current), [sortedImages, baseline]);
  const summaryKey = JSON.stringify(summary);
  const onSummaryRef = useRef(onSummary);
  onSummaryRef.current = onSummary;
  useEffect(() => {
    if (embedded) onSummaryRef.current?.(summary);
    // summaryKey stands for `summary`.
  }, [embedded, summaryKey]);

  const replaceAt = async (index: number, file: File) => {
    if (readOnly) return;
    const work = (async () => {
      const url = await uploadFile(file);
      if (!url) return;
      const next = [...imagesRef.current];
      if (index < 0 || index >= next.length) return;
      next[index] = url;
      onImagesChanged(next);
    })();
    try {
      await trackUpload(work);
    } catch (err: any) {
      toast.error(err?.message || t('imageUploadFailed'));
    }
  };

  useImperativeHandle(ref, () => ({
    async stage() {
      await Promise.all(Array.from(inflightRef.current).map((p) => p.catch(() => undefined)));
    },
    isDirty() { return uploading || aiUploading || inflightRef.current.size > 0; },
    openUpload() { if (!readOnly) embeddedFileRef.current?.click(); },
    openGenerate() { if (!readOnly) handleOpenAI(); },
    openPhoto(index?: number) { if (imagesRef.current.length) setOpenIndex(index ?? 0); },
  }));

  if (embedded) {
    const openUrl = openIndex != null ? sortedImages[openIndex] : undefined;
    const step = (delta: number) => {
      if (openIndex == null || sortedImages.length < 2) return;
      setOpenIndex((openIndex + delta + sortedImages.length) % sortedImages.length);
    };
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }} data-testid="ebay-photo-strip">
        <ImageGrid
          variant="strip"
          images={sortedImages.map((src, i) => ({ id: tileIds[i], src, staged: baseSet.has(src) ? undefined : 'add' }))}
          max={maxImages}
          onReorder={(ids) => {
            const byId = new Map(tileIds.map((id, i) => [id, sortedImages[i]]));
            const next = ids.map((id) => byId.get(id)).filter((u): u is string => typeof u === 'string');
            if (next.length === sortedImages.length) onImagesChanged(next);
          }}
          onUpload={(files) => { void trackUpload(uploadFiles(files)); }}
          onDelete={(id) => {
            const i = tileIds.indexOf(id);
            if (i >= 0) onImagesChanged(sortedImages.filter((_, j) => j !== i));
          }}
          onOpen={(id) => { const i = tileIds.indexOf(id); if (i >= 0) setOpenIndex(i); }}
          flagMissingAlt={false}
          accept={IMAGE_TYPES.join(',')}
          disabled={readOnly || uploading}
          emptyMessage={emptyMessage ?? tLe('photos.noPhotos', { marketplace: 'eBay' })}
          video={video}
          onOpenVideo={onOpenVideo}
          onAddVideo={readOnly ? undefined : onAddVideo}
          onUndoDeleteVideo={readOnly ? undefined : onUndoDeleteVideo}
        />
        {uploading ? (
          <Box role="status" sx={{ fontSize: 12, lineHeight: '16px', color: 'text.secondary' }}>{t('uploadingProgress', { progress: uploadProgress })}</Box>
        ) : null}
        <input
          ref={embeddedFileRef}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            void trackUpload(uploadFiles(files));
          }}
        />
        <PhotoPanel
          open={openUrl !== undefined}
          onClose={() => setOpenIndex(null)}
          marketplaceName="eBay"
          media={openUrl !== undefined && openIndex != null ? {
            kind: 'photo',
            id: tileIds[openIndex],
            src: openUrl,
            fullSrc: openUrl,
            alt: '',
            position: openIndex + 1,
            total: sortedImages.length,
            pending: false,
            removing: false,
          } : null}
          onPrev={sortedImages.length > 1 ? () => step(-1) : undefined}
          onNext={sortedImages.length > 1 ? () => step(1) : undefined}
          onMakePrimary={openIndex != null && openIndex > 0 ? () => {
            onImagesChanged(moveItem(sortedImages, openIndex, 0));
            setOpenIndex(0);
          } : undefined}
          onReplace={openIndex != null ? (file) => replaceAt(openIndex, file) : undefined}
          onRemove={openIndex != null ? () => {
            onImagesChanged(sortedImages.filter((_, j) => j !== openIndex));
            setOpenIndex(null);
          } : undefined}
          readOnly={readOnly}
        />
        {aiDialog}
      </Box>
    );
  }

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

      {aiDialog}
    </Box>
  );
});

export default ImageManager;
