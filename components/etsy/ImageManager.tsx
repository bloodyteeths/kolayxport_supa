import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
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
import { fetchEtsyDrafts, stageEtsyDraft, stageEtsyDraftFile } from '@/lib/etsy/draftClient';

interface ImageInfo {
  listing_image_id: number;
  url_75x75: string;
  url_170x135: string;
  url_570xN: string;
  url_fullxfull?: string;
  rank: number;
  alt_text?: string;
  is_pending_upload?: boolean;
  pending_filename?: string;
  pending_media_id?: string;
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

function sortImagesByRank(images: ImageInfo[]): ImageInfo[] {
  return [...(images || [])].sort((a, b) => a.rank - b.rank);
}

function stableNegativeId(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return -Math.max(1, Math.abs(hash));
}

function base64ToFile(base64: string, mimeType: string, filename: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mimeType });
}

export default function ImageManager({ listingId, shopId, images, onImagesChanged }: ImageManagerProps) {
  const t = useTranslations('etsy.imageManager');
  const reorderToastId = `etsy-image-reorder-${listingId}`;
  const [uploading, setUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ImageInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [swapping, setSwapping] = useState<number | null>(null);
  const [draggingImageId, setDraggingImageId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<ImageInfo | null>(null);
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false);
  const [localImages, setLocalImages] = useState<ImageInfo[]>(() => sortImagesByRank(images));
  const [hasPendingOrder, setHasPendingOrder] = useState(false);
  const [draftMediaReloadKey, setDraftMediaReloadKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reorderInFlightRef = useRef(false);
  const pendingObjectUrlsRef = useRef<string[]>([]);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Upload dialog state
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadPreviews, setUploadPreviews] = useState<string[]>([]);
  const [uploadAltText, setUploadAltText] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

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

  const sourceImageKey = useMemo(
    () => sortImagesByRank(images).map((img) => `${img.listing_image_id}:${img.rank}`).join('|'),
    [images],
  );
  const originalRankByImageId = useMemo(
    () => new Map(sortImagesByRank(images).map((img) => [img.listing_image_id, img.rank])),
    [sourceImageKey, images],
  );

  useEffect(() => {
    pendingObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    pendingObjectUrlsRef.current = [];
    setLocalImages(sortImagesByRank(images));
    setHasPendingOrder(false);
    setDraggingImageId(null);
  }, [listingId, sourceImageKey]);

  useEffect(() => {
    let cancelled = false;
    const loadDraftMedia = async () => {
      try {
        const drafts = await fetchEtsyDrafts(shopId, listingId);
        if (cancelled) return;
        const currentImages = imagesRef.current;
        const baseImages = sortImagesByRank(currentImages);
        const pendingUploads: ImageInfo[] = [];
        for (const draft of drafts || []) {
          for (const media of draft.media || []) {
            if (media.kind !== 'image' || !['upload', 'ai_upload'].includes(media.operation)) continue;
            const previewUrl = media.sourceUrl || `/api/etsy-drafts/media-preview?id=${encodeURIComponent(media.id)}`;
            pendingUploads.push({
              listing_image_id: stableNegativeId(media.id),
              url_75x75: previewUrl,
              url_170x135: previewUrl,
              url_570xN: previewUrl,
              url_fullxfull: previewUrl,
              rank: Number(media.rank) || baseImages.length + pendingUploads.length + 1,
              alt_text: media.altText || '',
              is_pending_upload: true,
              pending_filename: media.filename,
              pending_media_id: media.id,
            });
          }
        }
        setLocalImages(sortImagesByRank([...baseImages, ...pendingUploads]));
      } catch {
        if (!cancelled) setLocalImages(sortImagesByRank(imagesRef.current));
      }
    };
    loadDraftMedia();
    return () => { cancelled = true; };
  }, [shopId, listingId, sourceImageKey, draftMediaReloadKey]);

  const sortedImages = localImages;

  useEffect(() => () => {
    pendingObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    uploadPreviews.forEach((url) => URL.revokeObjectURL(url));
    if (aiRefPreview?.startsWith('blob:')) URL.revokeObjectURL(aiRefPreview);
  }, []);

  const appendPendingUploads = useCallback((files: File[], startRank: number, altText?: string, stagedMedia: any[] = []) => {
    const pendingImages = files.map((file, index) => {
      const media = stagedMedia[index]?.media || stagedMedia[index];
      const objectUrl = media?.id
        ? `/api/etsy-drafts/media-preview?id=${encodeURIComponent(media.id)}`
        : URL.createObjectURL(file);
      if (!media?.id) pendingObjectUrlsRef.current.push(objectUrl);
      return {
        listing_image_id: media?.id ? stableNegativeId(media.id) : -Date.now() - index,
        url_75x75: objectUrl,
        url_170x135: objectUrl,
        url_570xN: objectUrl,
        url_fullxfull: objectUrl,
        rank: startRank + index,
        alt_text: files.length === 1 ? altText : undefined,
        is_pending_upload: true,
        pending_filename: file.name,
        pending_media_id: media?.id,
      };
    });

    setLocalImages((current) => {
      const existingPendingIds = new Set(current.map((image) => image.pending_media_id).filter(Boolean));
      return sortImagesByRank([...current, ...pendingImages.filter((image) => !image.pending_media_id || !existingPendingIds.has(image.pending_media_id))]);
    });
  }, []);

  // --- Upload Dialog ---

  const openUploadDialog = () => {
    uploadPreviews.forEach((url) => URL.revokeObjectURL(url));
    setUploadFiles([]);
    setUploadPreviews([]);
    setUploadAltText('');
    setUploadProgress(0);
    setUploadDialogOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    applySelectedUploadFiles(selected);
  };

  const applySelectedUploadFiles = (selected: File[]) => {
    if (selected.length === 0) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const validFiles = selected.filter((file) => validTypes.includes(file.type));
    if (validFiles.length !== selected.length) {
      toast.error(t('supportedFormats'));
    }
    if (validFiles.length === 0) {
      return;
    }

    const remainingSlots = Math.max(0, 10 - sortedImages.length);
    const files = validFiles.slice(0, remainingSlots);
    if (validFiles.length > remainingSlots) {
      toast.error(t('maxImagesError'));
    }

    uploadPreviews.forEach((url) => URL.revokeObjectURL(url));
    setUploadFiles(files);
    setUploadPreviews(files.map((file) => URL.createObjectURL(file)));
  };

  const handleUploadDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (uploading) return;
    applySelectedUploadFiles(Array.from(e.dataTransfer.files || []));
  };

  const openPreview = (img: ImageInfo) => {
    setPreviewImageLoaded(false);
    setPreviewImage(img);
  };

  const closePreview = () => {
    setPreviewImage(null);
    setPreviewImageLoaded(false);
  };

  const handleUploadSubmit = async () => {
    if (uploadFiles.length === 0) return;

    if (sortedImages.length + uploadFiles.length > 10) {
      toast.error(t('maxImagesError'));
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const startRank = sortedImages.length > 0
        ? Math.max(...sortedImages.map((i) => i.rank)) + 1
        : 1;

      const stagedMedia: any[] = [];
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        const staged = await stageEtsyDraftFile({
          shopId,
          listingId,
          file,
          kind: 'image',
          operation: 'upload',
          rank: startRank + i,
          altText: uploadAltText.trim() && uploadFiles.length === 1 ? uploadAltText.trim() : undefined,
        });
        stagedMedia.push(staged.media);
        setUploadProgress(Math.round(((i + 1) / uploadFiles.length) * 100));
      }

      appendPendingUploads(uploadFiles, startRank, uploadAltText.trim() || undefined, stagedMedia);
      toast.success('Image upload saved to draft. Sync to Etsy when ready.');
      setUploadDialogOpen(false);
      uploadPreviews.forEach((url) => URL.revokeObjectURL(url));
      setUploadFiles([]);
      setUploadPreviews([]);
      setDraftMediaReloadKey((key) => key + 1);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || t('uploadError'));
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- Delete ---

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      if (deleteConfirm.is_pending_upload) {
        setLocalImages((current) => (
          sortImagesByRank(current.filter((img) => img.listing_image_id !== deleteConfirm.listing_image_id))
            .map((img, index) => ({ ...img, rank: index + 1 }))
        ));
        toast.success('Pending image removed from this view. Discard the draft to remove it permanently.');
        setDeleteConfirm(null);
        return;
      }

      await stageEtsyDraft({
        shopId,
        listingId,
        media: [{ kind: 'image', operation: 'delete', etsyMediaId: deleteConfirm.listing_image_id }],
      });
      toast.success('Image delete saved to draft. Sync to Etsy when ready.');
      setDeleteConfirm(null);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || t('deleteError'));
    } finally {
      setDeleting(false);
    }
  };

  // --- Reorder (swap) ---

  const reorderLocally = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex || reorderInFlightRef.current) return;

    setLocalImages((current) => {
      if (fromIndex >= current.length || toIndex >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next.map((image, index) => ({ ...image, rank: index + 1 }));
    });
    setHasPendingOrder(true);
  }, []);

  const handleSwap = useCallback((direction: 'up' | 'down', img: ImageInfo) => {
    if (reorderInFlightRef.current || swapping !== null) return;
    if (img.is_pending_upload) {
      toast.error('Pending uploads can be reordered after they are synced to Etsy.');
      return;
    }

    const currentIndex = sortedImages.findIndex((i) => i.listing_image_id === img.listing_image_id);
    const neighborIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (neighborIndex < 0 || neighborIndex >= sortedImages.length) return;

    reorderLocally(currentIndex, neighborIndex);
  }, [sortedImages, reorderLocally, swapping]);

  const saveImageOrder = useCallback(async () => {
    if (reorderInFlightRef.current || !hasPendingOrder) return;

    reorderInFlightRef.current = true;
    setSwapping(-1);
    try {
      for (let i = 0; i < sortedImages.length; i++) {
        const img = sortedImages[i];
        if (img.is_pending_upload) continue;
        const nextRank = i + 1;
        if (originalRankByImageId.get(img.listing_image_id) === nextRank) continue;

        await stageEtsyDraft({
          shopId,
          listingId,
          media: [{ kind: 'image', operation: 'reorder', etsyMediaId: img.listing_image_id, rank: nextRank }],
        });
      }
      toast.success('Image order saved to draft. Sync to Etsy when ready.', { id: reorderToastId });
      setHasPendingOrder(false);
      onImagesChanged();
    } catch (err: any) {
      toast.error(t('reorderError'), { id: reorderToastId });
      onImagesChanged();
    } finally {
      reorderInFlightRef.current = false;
      setSwapping(null);
      setDraggingImageId(null);
    }
  }, [listingId, shopId, onImagesChanged, t, reorderToastId, sortedImages, hasPendingOrder, originalRankByImageId]);

  const discardImageOrder = useCallback(() => {
    setLocalImages(sortImagesByRank(images));
    setHasPendingOrder(false);
    setDraggingImageId(null);
  }, [images]);

  const handleDropImage = useCallback((e: React.DragEvent<HTMLDivElement>, targetImageId: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingImageId || draggingImageId === targetImageId || swapping !== null || reorderInFlightRef.current) return;
    if (draggingImageId < 0 || targetImageId < 0) {
      setDraggingImageId(null);
      toast.error('Pending uploads can be reordered after they are synced to Etsy.');
      return;
    }

    const fromIndex = sortedImages.findIndex((img) => img.listing_image_id === draggingImageId);
    const toIndex = sortedImages.findIndex((img) => img.listing_image_id === targetImageId);
    reorderLocally(fromIndex, toIndex);
  }, [draggingImageId, sortedImages, reorderLocally, swapping]);

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
      toast.error(t('enterPrompt'));
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
        throw new Error(err.error || t('generateFailed'));
      }

      const data = await res.json();
      if (data.image_base64) {
        setAiResult({ base64: data.image_base64, mimeType: data.mime_type || 'image/png' });
        toast.success(t('generateSuccess'));
      } else {
        throw new Error(data.text || t('generateFailed'));
      }
    } catch (err: any) {
      toast.error(err.message || t('aiGenerateError'));
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiAcceptAndUpload = async () => {
    if (!aiResult) return;

    if (sortedImages.length >= 10) {
      toast.error(t('maxImagesError'));
      return;
    }

    setAiUploading(true);
    try {
      const nextRank = sortedImages.length > 0
        ? Math.max(...sortedImages.map((i) => i.rank)) + 1
        : 1;
      const aiFile = base64ToFile(aiResult.base64, aiResult.mimeType, `ai-image-${Date.now()}.png`);

      const staged = await stageEtsyDraftFile({
        shopId,
        listingId,
        file: aiFile,
        kind: 'image',
        operation: 'ai_upload',
        rank: nextRank,
      });

      appendPendingUploads([aiFile], nextRank, undefined, [staged.media]);
      toast.success('AI image saved to draft. Sync to Etsy when ready.');
      setAiDialogOpen(false);
      setDraftMediaReloadKey((key) => key + 1);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || t('uploadError'));
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
    if (editAltImage.is_pending_upload) {
      toast.error('Alt text for pending uploads is saved during upload. Sync or discard the draft first.');
      return;
    }
    setSavingAlt(true);
    try {
      await stageEtsyDraft({
        shopId,
        listingId,
        media: [{ kind: 'image', operation: 'update_alt', etsyMediaId: editAltImage.listing_image_id, altText: editAltText.trim() }],
      });
      toast.success('Alt text saved to draft. Sync to Etsy when ready.');
      setEditAltImage(null);
      onImagesChanged();
    } catch (err: any) {
      toast.error(err.message || t('altTextUpdateError'));
    } finally {
      setSavingAlt(false);
    }
  };

  // --- Render ---

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t('imagesCount', { count: sortedImages.length })}
      </Typography>

      {hasPendingOrder && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t('unsavedOrderHint')}
          </Typography>
          <Button
            size="small"
            variant="contained"
            onClick={saveImageOrder}
            disabled={swapping !== null}
            sx={{ textTransform: 'none', borderRadius: 1 }}
          >
            {swapping === -1 ? <CircularProgress size={16} color="inherit" /> : t('saveOrder')}
          </Button>
          <Button
            size="small"
            variant="text"
            onClick={discardImageOrder}
            disabled={swapping !== null}
            sx={{ textTransform: 'none' }}
          >
            {t('discardOrder')}
          </Button>
        </Box>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 1,
        }}
      >
        {sortedImages.map((img, idx) => {
          const isPrimary = img.rank === 1;
          const isSwapping = swapping === img.rank || swapping === -1;
          const isPendingUpload = !!img.is_pending_upload;

          return (
            <Box
              key={img.listing_image_id}
              draggable={!isSwapping && !isPendingUpload}
              onDragStart={(e) => {
                if (reorderInFlightRef.current || isPendingUpload) return;
                e.dataTransfer.effectAllowed = 'move';
                setDraggingImageId(img.listing_image_id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => handleDropImage(e, img.listing_image_id)}
              onDragEnd={() => setDraggingImageId(null)}
              onClick={() => openPreview(img)}
              sx={{
                position: 'relative',
                aspectRatio: '1',
                borderRadius: 1,
                overflow: 'hidden',
                border: isPrimary ? '2px solid #f59e0b' : '1px solid #e5e7eb',
                opacity: isSwapping ? 0.5 : draggingImageId === img.listing_image_id ? 0.65 : 1,
                cursor: isSwapping ? 'wait' : isPendingUpload ? 'pointer' : 'grab',
                transition: 'opacity 0.2s, border-color 0.2s',
                '&:hover .img-controls': { opacity: 1 },
                '&:active': { cursor: isPendingUpload ? 'pointer' : 'grabbing' },
              }}
            >
              <img
                src={img.url_570xN}
                alt={img.alt_text || t('imageRankAlt', { rank: img.rank })}
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

              {isPendingUpload && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    px: 0.75,
                    py: 0.25,
                    borderRadius: '999px',
                    bgcolor: 'rgba(37,99,235,0.9)',
                    color: 'white',
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  Draft
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
                  <Tooltip title={t('primaryImage')}>
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
              <Tooltip title={isPendingUpload ? 'Pending upload. Sync to Etsy before editing alt text.' : img.alt_text ? t('altTextClickToEdit', { text: img.alt_text }) : t('addAltText')}>
                <Box
                  onClick={(e) => { e.stopPropagation(); if (!isPendingUpload) openAltEdit(img); }}
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
                    cursor: isPendingUpload ? 'default' : 'pointer',
                    '&:hover': { backgroundColor: img.alt_text ? 'rgba(0,0,0,0.8)' : 'rgba(245,158,11,0.9)' },
                  }}
                >
                  {isPendingUpload ? 'Pending upload' : img.alt_text || t('addAltTextShort')}
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
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(img); }}
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
                  <Tooltip title={t('moveUp')} placement="left">
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); handleSwap('up', img); }}
                      disabled={!!swapping || isPendingUpload}
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
                  <Tooltip title={t('moveDown')} placement="left">
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); handleSwap('down', img); }}
                      disabled={!!swapping || isPendingUpload}
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

                <Tooltip title={t('editAltText')} placement="left">
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); if (!isPendingUpload) openAltEdit(img); }}
                    disabled={!!swapping || isPendingUpload}
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
              {t('add')}
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
              {t('aiImage')}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
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
        <DialogTitle>{t('uploadDialogTitle')}</DialogTitle>
        <DialogContent>
          {uploadPreviews.length === 0 ? (
            <Box
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleUploadDrop}
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
                {t('clickToSelectImage')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('formatsList')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {t('multiUploadHint')}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ textAlign: 'center', mb: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: uploadPreviews.length > 1 ? 'repeat(3, 1fr)' : '1fr', gap: 1 }}>
                {uploadPreviews.slice(0, 9).map((preview, idx) => (
                  <img
                    key={preview}
                    src={preview}
                    alt={`${t('preview')} ${idx + 1}`}
                    style={{
                      width: '100%',
                      height: uploadPreviews.length > 1 ? 120 : 320,
                      borderRadius: 8,
                      objectFit: 'cover',
                    }}
                  />
                ))}
              </Box>
              {uploadFiles.length > 1 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  {t('filesSelected', { count: uploadFiles.length })}
                </Typography>
              )}
              <Typography
                variant="caption"
                color="primary"
                sx={{ display: 'block', mt: 1, cursor: 'pointer' }}
                onClick={() => fileInputRef.current?.click()}
              >
                {t('selectDifferentImage')}
              </Typography>
            </Box>
          )}

          <TextField
            label={t('altTextSeoLabel')}
            placeholder={t('altTextPlaceholder')}
            fullWidth
            size="small"
            value={uploadAltText}
            onChange={(e) => setUploadAltText(e.target.value)}
            sx={{ mt: 2 }}
            helperText={t('altTextHelperText')}
            disabled={uploadFiles.length > 1}
          />
          {uploading && uploadFiles.length > 1 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {uploadProgress}%
              </Typography>
              <Box sx={{ height: 4, borderRadius: 999, bgcolor: '#e5e7eb', overflow: 'hidden', mt: 0.5 }}>
                <Box sx={{ width: `${uploadProgress}%`, height: '100%', bgcolor: 'primary.main', transition: 'width 0.2s' }} />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)} disabled={uploading}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleUploadSubmit}
            variant="contained"
            disabled={uploadFiles.length === 0 || uploading}
          >
            {uploading ? <CircularProgress size={20} /> : t('upload')}
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
          {t('aiDialogTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('aiDialogDescription')}
          </Typography>

          <TextField
            label={t('promptLabel')}
            placeholder={t('promptPlaceholder')}
            fullWidth
            multiline
            minRows={3}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            disabled={aiGenerating}
            sx={{ mb: 2 }}
            helperText={t('promptHelperText')}
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
              {t('referenceImage')}
            </Typography>

            {/* Selected reference preview */}
            {aiRefPreview ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <img
                  src={aiRefPreview}
                  alt={t('referenceImage')}
                  style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '2px solid #a855f7' }}
                />
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {aiRefFile ? t('uploadedImage') : t('listingImage')}
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
                    {t('remove')}
                  </Button>
                </Box>
              </Box>
            ) : (
              <>
                {/* Existing listing images as selectable references */}
                {sortedImages.length > 0 && (
                  <Box sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      {t('selectFromExisting')}
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
                            alt={img.alt_text || t('imageRankAlt', { rank: img.rank })}
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
                  {t('uploadFromComputer')}
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
            {aiGenerating ? t('generating') : t('generateImage')}
          </Button>

          {/* Result preview */}
          {aiResult && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ textAlign: 'center' }}>{t('generatedImage')}</Typography>
              <Box sx={{ textAlign: 'center' }}>
                <img
                  src={`data:${aiResult.mimeType};base64,${aiResult.base64}`}
                  alt={t('aiImageAlt')}
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
                placeholder={t('followUpPlaceholder')}
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
                  {aiFollowUp.trim() ? t('regenerateWithChanges') : t('regenerateSamePrompt')}
                </Button>
                <Button
                  variant="contained"
                  onClick={handleAiAcceptAndUpload}
                  disabled={aiUploading}
                  startIcon={aiUploading ? <CircularProgress size={16} color="inherit" /> : null}
                  color="success"
                  size="small"
                >
                  {aiUploading ? t('uploading') : t('acceptAndUpload')}
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiDialogOpen(false)} disabled={aiGenerating || aiUploading}>
            {t('close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onClose={() => !deleting && setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>{t('deleteDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('deleteConfirmation')}</Typography>
          {deleteConfirm && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <img
                src={deleteConfirm.url_570xN}
                alt={t('imageToDelete')}
                style={{ maxWidth: 160, borderRadius: 8 }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>
            {t('cancel')}
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? <CircularProgress size={20} /> : t('delete')}
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
        <DialogTitle>{t('altTextEditTitle')}</DialogTitle>
        <DialogContent>
          {editAltImage && (
            <Box sx={{ textAlign: 'center', mb: 2 }}>
              <img
                src={editAltImage.url_570xN}
                alt={t('imageToEdit')}
                style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 8, objectFit: 'contain' }}
              />
            </Box>
          )}
          <TextField
            label={t('altTextSeoLabel')}
            placeholder={t('altTextEditPlaceholder')}
            fullWidth
            size="small"
            multiline
            minRows={2}
            value={editAltText}
            onChange={(e) => setEditAltText(e.target.value)}
            disabled={savingAlt}
            helperText={t('altTextEditHelperText')}
            inputProps={{ maxLength: 250 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
            {editAltText.length}/250
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditAltImage(null)} disabled={savingAlt}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSaveAltText}
            variant="contained"
            disabled={savingAlt}
            color="success"
          >
            {savingAlt ? <CircularProgress size={20} /> : t('save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Image preview dialog */}
      <Dialog
        open={!!previewImage}
        onClose={closePreview}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{previewImage ? t('imageRankAlt', { rank: previewImage.rank }) : t('preview')}</DialogTitle>
        <DialogContent>
          {previewImage && (
            <Box
              sx={{
                position: 'relative',
                minHeight: { xs: 280, sm: 420 },
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: '#f8fafc',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              {!previewImageLoaded && (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundImage: previewImage.url_170x135 ? `url(${previewImage.url_170x135})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      backdropFilter: previewImage.url_170x135 ? 'blur(14px)' : 'none',
                      backgroundColor: previewImage.url_170x135 ? 'rgba(248,250,252,0.72)' : '#f8fafc',
                    },
                  }}
                >
                  <CircularProgress size={28} sx={{ position: 'relative', zIndex: 1 }} />
                </Box>
              )}
              <img
                src={previewImage.url_fullxfull || previewImage.url_570xN}
                alt={previewImage.alt_text || t('imageRankAlt', { rank: previewImage.rank })}
                onLoad={() => setPreviewImageLoaded(true)}
                onError={() => setPreviewImageLoaded(true)}
                style={{
                  maxWidth: '100%',
                  maxHeight: '72vh',
                  borderRadius: 8,
                  objectFit: 'contain',
                  opacity: previewImageLoaded ? 1 : 0,
                  transition: 'opacity 0.18s ease',
                }}
              />
              {previewImage.alt_text && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    position: 'absolute',
                    left: 12,
                    right: 12,
                    bottom: 12,
                    bgcolor: 'rgba(15,23,42,0.68)',
                    color: 'white',
                    borderRadius: 1,
                    px: 1,
                    py: 0.5,
                    opacity: previewImageLoaded ? 1 : 0,
                    transition: 'opacity 0.18s ease',
                  }}
                >
                  {previewImage.alt_text}
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {previewImage && (
            <Button onClick={() => { openAltEdit(previewImage); closePreview(); }}>
              {t('editAltText')}
            </Button>
          )}
          <Button onClick={closePreview}>{t('close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
