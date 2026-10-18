import React, { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useTranslations } from 'next-intl';
import { AI_MAX_REFERENCE_IMAGES } from '@/lib/ai/referenceImages';
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
  Checkbox,
  FormControlLabel,
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
import { aiErrorCode, AiRequestError, draftErrorI18n, ETSY_MAX_IMAGES } from '@/lib/etsy/seoRules';
// Embedded mode (listing editor M6, Group C): DS strip + photo panel; staging calls below are the same ones.
import { ImageGrid, type StripVideo } from '@/components/ds/inputs/ImageGrid';
import { FormField as DsFormField } from '@/components/ds/inputs/FormField';
import { TextArea as DsTextArea } from '@/components/ds/inputs/TextArea';
import { Modal as DsModal } from '@/components/ds/overlay/Modal';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { useToast } from '@/components/ds/feedback/toast';
import { moveItem } from '@/components/ds/inputs/ImageGrid';
import { PhotoPanel, AltTextBatchPanel, defaultWriteAltText, type WriteAltText, type AltBatchItem } from '@/components/domain/listing-editor/sections/PhotoPanel';
import {
  EMPTY_STAGED_OPS, IMAGE_TYPES, applyTileOrder, buildPhotoTiles, cleanAltText, collectStagedOps, parseImageLinks,
  reorderOpsFor, splitImageFiles, tileIdFor, summarizeEtsyPhotos, type PhotoTile, type PhotosSummary, type StagedMediaOps,
} from '@/components/domain/listing-editor/sections/photosModel';

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
  /**
   * Listing editor (M6) mode: renders the DS photo strip (`ImageGrid variant="strip"`) and the photo SidePanel
   * instead of the legacy grid and dialogs, and exposes `stage()` / `isDirty()` through the ref. Uploads, deletes
   * and alt text still stage immediately with the same `stageEtsyDraft` / `stageEtsyDraftFile` calls; the photo
   * order is staged by `stage()` (or 800ms after the last move, as before).
   */
  embedded?: boolean;
  /** Embedded: listing title/description for AI alt text. */
  listingTitle?: string;
  listingDescription?: string;
  /** Embedded: AI alt writer (useListingAI); default `/api/ai/etsy generate_alt_text`; `null` hides AI. */
  writeAltText?: WriteAltText | null;
  /** Embedded: the strip's trailing video tile (from VideoUploader `onTileChange`). */
  video?: StripVideo | null;
  onOpenVideo?: () => void;
  onAddVideo?: () => void;
  onUndoDeleteVideo?: () => void;
  /** Embedded: what is on the strip and what is staged (score, preview, "Not sent yet"). */
  onSummary?: (summary: PhotosSummary) => void;
  /**
   * Embedded: drops one staged EtsyDraftMedia row (undo a staged delete, remove a staged upload). Not available
   * yet (no route); without it, staged deletes are confirmed first and staged uploads leave with Discard changes.
   */
  removeStagedMedia?: (draftMediaId: string) => Promise<void>;
  /** Embedded: changes when the DB draft changed elsewhere (send, discard, refresh) → staged media are re-read. */
  draftVersion?: string | number | null;
  /** Embedded: draft is being sent; the strip is read-only. */
  readOnly?: boolean;
  /** Embedded: text of the inline dropzone when there are no photos (create vs edit wording). */
  emptyMessage?: React.ReactNode;
  /** Embedded: the unsaved state changed (a photo moved, a staging request started or settled) → recount / schedule. */
  onLocalChange?: () => void;
}

/** Ref handle of the embedded ImageManager (registered by PhotosSection as the `photos:images` DraftSection). */
export interface ImageManagerHandle {
  /** Writes the unsaved photo order into the DB draft and waits for uploads/deletes in flight. Throws on failure. */
  stage(): Promise<void>;
  /** A photo move not staged yet, or a staging request in flight. */
  isDirty(): boolean;
  openUpload(): void;
  openGenerate(): void;
  openPasteLinks(): void;
  /** Opens the photo panel (first photo when no id). */
  openPhoto(tileId?: string): void;
  /** Opens "Write alt text for N" (AI proposals for every photo without alt text). */
  writeMissingAlt(): void;
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

const ImageManager = forwardRef<ImageManagerHandle, ImageManagerProps>(function ImageManager({
  listingId, shopId, images, onImagesChanged,
  embedded = false, listingTitle, listingDescription, writeAltText, video, onOpenVideo, onAddVideo, onUndoDeleteVideo,
  onSummary, removeStagedMedia, draftVersion, readOnly = false, emptyMessage, onLocalChange,
}, ref) {
  const t = useTranslations('etsy.imageManager');
  const tAiErr = useTranslations('etsy.aiErrors');
  const tEtsyRoot = useTranslations('etsy');
  /** Server validation errors carry an i18n key (etsy.validation.*, etsy.draftSync.*); never show raw text. */
  const draftErr = (err: unknown, fallback: string): string => {
    const i18n = draftErrorI18n(err);
    return i18n && tEtsyRoot.has(i18n.key as any) ? tEtsyRoot(i18n.key as any, i18n.params as any) : fallback;
  };
  const [uploading, setUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ImageInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [draggingImageId, setDraggingImageId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<ImageInfo | null>(null);
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false);
  const [localImages, setLocalImages] = useState<ImageInfo[]>(() => sortImagesByRank(images));
  const [hasPendingOrder, setHasPendingOrder] = useState(false);
  const [draftMediaReloadKey, setDraftMediaReloadKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingObjectUrlsRef = useRef<string[]>([]);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const localImagesRef = useRef(localImages);
  localImagesRef.current = localImages;
  const hasPendingOrderRef = useRef(false);

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
  // Plain white background only for main product shots; off keeps a styled/lifestyle scene.
  const [aiWhiteBg, setAiWhiteBg] = useState(false);
  const aiRefInputRef = useRef<HTMLInputElement>(null);

  // Embedded-mode state (unused by the legacy grid).
  const tLe = useTranslations('listingEditor');
  const dsToast = useToast();
  const dsConfirm = useConfirm();
  const [stagedOps, setStagedOps] = useState<StagedMediaOps>(EMPTY_STAGED_OPS);
  const [openTileId, setOpenTileId] = useState<string | null>(null);
  const [altBatchOpen, setAltBatchOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksText, setLinksText] = useState('');
  const [linksSaving, setLinksSaving] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const embeddedFileRef = useRef<HTMLInputElement>(null);
  /** Local photo moves vs the last move written to the draft (isDirty / stage). */
  const reorderSeqRef = useRef(0);
  const reorderStagedSeqRef = useRef(0);
  const inflightRef = useRef<Set<Promise<unknown>>>(new Set());
  /** Set when the DB draft changed elsewhere (sent / discarded): local-only staged uploads are stale. */
  const dropLocalPendingRef = useRef(false);
  const draftVersionRef = useRef(draftVersion);
  if (embedded && draftVersionRef.current !== draftVersion) {
    draftVersionRef.current = draftVersion;
    dropLocalPendingRef.current = true;
  }
  useEffect(() => {
    // The draft was sent / discarded / refreshed: a photo order that is already in the draft no longer pins the
    // local order, so the next read shows the draft's (or Etsy's) order.
    if (!embedded || reorderSeqRef.current !== reorderStagedSeqRef.current) return;
    hasPendingOrderRef.current = false;
    setHasPendingOrder(false);
  }, [embedded, draftVersion]);

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
    [sourceImageKey],
  );

  useEffect(() => {
    if (images.length === 0 && localImagesRef.current.length > 0) return;
    pendingObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    pendingObjectUrlsRef.current = [];
    setLocalImages(sortImagesByRank(images));
    setHasPendingOrder(false);
    hasPendingOrderRef.current = false;
    setDraggingImageId(null);
  }, [listingId, sourceImageKey]);

  useEffect(() => {
    let cancelled = false;
    const loadDraftMedia = async () => {
      try {
        const drafts = await fetchEtsyDrafts(shopId, listingId);
        if (!cancelled) setStagedOps(collectStagedOps(drafts));
        if (cancelled || hasPendingOrderRef.current) return;
        const currentImages = imagesRef.current;
        const baseImages = sortImagesByRank(currentImages);

        const reorderMap = new Map<number, number>();
        const pendingUploads: ImageInfo[] = [];
        for (const draft of drafts || []) {
          for (const media of draft.media || []) {
            if (media.kind !== 'image') continue;
            if (media.operation === 'reorder' && media.etsyMediaId != null && media.rank != null) {
              reorderMap.set(Number(media.etsyMediaId), Number(media.rank));
            } else if (['upload', 'ai_upload'].includes(media.operation)) {
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
        }

        const reorderedBase = reorderMap.size > 0
          ? baseImages.map((img) => ({
            ...img,
            rank: reorderMap.get(img.listing_image_id) ?? img.rank,
          }))
          : baseImages;

        if (!cancelled && !hasPendingOrderRef.current) {
          // Merge — don't overwrite — pending uploads. The user may have
          // *just* added a pending image via appendPendingUploads (e.g., an AI
          // generation that hasn't reached this read yet because of replication
          // lag or because the DB write committed after this fetch started).
          // Without this merge, the freshly-added image visibly disappears.
          const dbPendingIds = new Set(pendingUploads.map((p) => p.pending_media_id).filter(Boolean));
          const dropLocal = dropLocalPendingRef.current;
          dropLocalPendingRef.current = false;
          const localOnlyPending = dropLocal ? [] : localImagesRef.current.filter((img) =>
            img.is_pending_upload && img.pending_media_id && !dbPendingIds.has(img.pending_media_id),
          );
          setLocalImages(sortImagesByRank([...reorderedBase, ...pendingUploads, ...localOnlyPending]));
        }
      } catch (err) {
        // Don't silently wipe pending uploads on a transient fetch failure.
        // Keep what we already have on screen; the next reload will reconcile.
        // eslint-disable-next-line no-console
        console.warn('[ImageManager] loadDraftMedia failed, keeping current images', err);
        if (!cancelled && !hasPendingOrderRef.current && localImagesRef.current.length === 0 && imagesRef.current.length > 0) {
          setLocalImages(sortImagesByRank(imagesRef.current));
        }
      }
    };
    loadDraftMedia();
    return () => { cancelled = true; };
  }, [shopId, listingId, sourceImageKey, draftMediaReloadKey, draftVersion]);

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

    const remainingSlots = Math.max(0, ETSY_MAX_IMAGES - sortedImages.length);
    const files = validFiles.slice(0, remainingSlots);
    if (validFiles.length > remainingSlots) {
      toast.error(t('maxImagesError', { max: ETSY_MAX_IMAGES }));
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

    if (sortedImages.length + uploadFiles.length > ETSY_MAX_IMAGES) {
      toast.error(t('maxImagesError', { max: ETSY_MAX_IMAGES }));
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
      toast.success(t('uploadStaged'));
      setUploadDialogOpen(false);
      uploadPreviews.forEach((url) => URL.revokeObjectURL(url));
      setUploadFiles([]);
      setUploadPreviews([]);
      setDraftMediaReloadKey((key) => key + 1);
      onImagesChanged();
    } catch (err: any) {
      console.error('[ImageManager] upload staging failed', err);
      toast.error(draftErr(err, t('uploadError')));
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
        toast.success(t('pendingRemoved'));
        setDeleteConfirm(null);
        return;
      }

      await stageEtsyDraft({
        shopId,
        listingId,
        media: [{ kind: 'image', operation: 'delete', etsyMediaId: deleteConfirm.listing_image_id }],
      });
      toast.success(t('deleteStaged'));
      setDeleteConfirm(null);
      onImagesChanged();
    } catch (err: any) {
      console.error('[ImageManager] delete staging failed', err);
      toast.error(draftErr(err, t('deleteError')));
    } finally {
      setDeleting(false);
    }
  };

  // --- Reorder (swap) ---

  const reorderLocally = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    setLocalImages((current) => {
      if (fromIndex >= current.length || toIndex >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const result = next.map((image, index) => ({ ...image, rank: index + 1 }));
      if (result.length !== current.length) return current;
      return result;
    });
    setHasPendingOrder(true);
    hasPendingOrderRef.current = true;
  }, []);

  const handleSwap = useCallback((direction: 'up' | 'down', img: ImageInfo) => {
    if (img.is_pending_upload) {
      toast.error(t('pendingReorderBlocked'));
      return;
    }

    const currentIndex = localImagesRef.current.findIndex((i) => i.listing_image_id === img.listing_image_id);
    const neighborIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (neighborIndex < 0 || neighborIndex >= localImagesRef.current.length) return;

    reorderLocally(currentIndex, neighborIndex);
  }, [reorderLocally]);

  const reorderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stageReorderToDraft = useCallback(async (currentImages: ImageInfo[]) => {
    const mediaOps: Array<Record<string, any>> = [];
    for (let i = 0; i < currentImages.length; i++) {
      const img = currentImages[i];
      if (img.is_pending_upload) continue;
      const nextRank = i + 1;
      if (originalRankByImageId.get(img.listing_image_id) === nextRank) continue;
      mediaOps.push({ kind: 'image', operation: 'reorder', etsyMediaId: img.listing_image_id, rank: nextRank });
    }
    if (mediaOps.length === 0) return;
    try {
      await stageEtsyDraft({ shopId, listingId, media: mediaOps });
    } catch { /* staging failure doesn't affect local UI */ }
  }, [listingId, shopId, originalRankByImageId]);

  useEffect(() => {
    if (!hasPendingOrder) return;
    if (reorderDebounceRef.current) clearTimeout(reorderDebounceRef.current);
    reorderDebounceRef.current = setTimeout(() => {
      // Embedded: same op list, but the outcome is tracked so the editor's save state is honest.
      if (embedded) { flushReorderRef.current().catch(() => undefined); return; }
      stageReorderToDraft([...localImagesRef.current]);
    }, 800);
    return () => { if (reorderDebounceRef.current) clearTimeout(reorderDebounceRef.current); };
  }, [hasPendingOrder, localImages, stageReorderToDraft, embedded]);

  const handleDropImage = useCallback((e: React.DragEvent<HTMLDivElement>, targetImageId: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingImageId || draggingImageId === targetImageId) return;
    if (draggingImageId < 0 || targetImageId < 0) {
      setDraggingImageId(null);
      toast.error(t('pendingReorderBlocked'));
      return;
    }

    const current = localImagesRef.current;
    const fromIndex = current.findIndex((img) => img.listing_image_id === draggingImageId);
    const toIndex = current.findIndex((img) => img.listing_image_id === targetImageId);
    reorderLocally(fromIndex, toIndex);
  }, [draggingImageId, reorderLocally]);

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

  /**
   * Generate an AI image. `promptOverride` fixes the stale-state bug where
   * setAiPrompt() + generate() still sent the old prompt; `refine` sends the
   * previous AI result as the first reference so follow-ups edit that image.
   * The listing's existing photos are used as references by default.
   */
  const handleAiGenerate = async (opts?: { promptOverride?: string; refine?: boolean }) => {
    const promptText = (opts?.promptOverride ?? aiPrompt).trim();
    if (!promptText) {
      toast.error(t('enterPrompt'));
      return;
    }

    const previous = opts?.refine ? aiResult : null;
    setAiGenerating(true);
    setAiResult(null);
    try {
      const referenceImages: Array<{ data: string; mime_type: string }> = [];
      if (previous) referenceImages.push({ data: previous.base64, mime_type: previous.mimeType });
      if (aiRefFile) referenceImages.push({ data: await fileToBase64(aiRefFile), mime_type: aiRefFile.type });

      // Explicitly chosen listing photo first, then the listing's photos (cover first) — staged ones too: their
      // relative preview URLs are read from disk by the server for this seller (lib/images/ownImage). Before, they
      // were skipped and the image was generated from text alone.
      const referenceUrls: string[] = [];
      if (aiRefUrl) referenceUrls.push(aiRefUrl);
      for (const img of sortedImages) {
        if (referenceImages.length + referenceUrls.length >= AI_MAX_REFERENCE_IMAGES) break;
        const url = img.url_fullxfull || img.url_570xN;
        if (url && (url.startsWith('https://') || url.startsWith('/api/')) && !referenceUrls.includes(url)) referenceUrls.push(url);
      }

      const res = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          marketplace: 'etsy',
          aspect_ratio: '4:3',
          white_background: aiWhiteBg,
          reference_images: referenceImages,
          reference_image_urls: referenceUrls.slice(0, Math.max(0, AI_MAX_REFERENCE_IMAGES - referenceImages.length)),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new AiRequestError(aiErrorCode(data));
      if (typeof data?.image_base64 !== 'string' || !data.image_base64) throw new AiRequestError('ai_image_failed');
      setAiResult({ base64: data.image_base64, mimeType: data.mime_type || 'image/jpeg' });
      toast.success(t('generateSuccess'));
    } catch (err: any) {
      if (previous) setAiResult(previous);
      toast.error(err instanceof AiRequestError && err.code ? tAiErr(err.code) : t('aiGenerateError'));
    } finally {
      setAiGenerating(false);
    }
  };

  /** Follow-up: refine the current result with extra instructions, or re-roll the same prompt. */
  const handleAiFollowUp = () => {
    const extra = aiFollowUp.trim();
    if (extra) {
      const nextPrompt = `${aiPrompt.trim()}. Additional changes: ${extra}`;
      setAiPrompt(nextPrompt);
      setAiFollowUp('');
      handleAiGenerate({ promptOverride: nextPrompt, refine: true });
    } else {
      handleAiGenerate();
    }
  };

  const handleAiAcceptAndUpload = async () => {
    if (!aiResult) return;
    // The listing editor stages through its own tracked path (capacity, capped rank, DS toast, Send vocabulary).
    if (embedded) {
      await acceptAiEmbedded();
      return;
    }

    if (sortedImages.length >= ETSY_MAX_IMAGES) {
      toast.error(t('maxImagesError', { max: ETSY_MAX_IMAGES }));
      return;
    }

    setAiUploading(true);
    try {
      const nextRank = sortedImages.length > 0
        ? Math.max(...sortedImages.map((i) => i.rank)) + 1
        : 1;
      const filename = aiResult.mimeType === 'image/jpeg'
        ? `ai-image-${Date.now()}.jpg`
        : `ai-image-${Date.now()}.png`;
      const aiFile = base64ToFile(aiResult.base64, aiResult.mimeType, filename);

      const staged = await stageEtsyDraftFile({
        shopId,
        listingId,
        file: aiFile,
        kind: 'image',
        operation: 'ai_upload',
        rank: nextRank,
      });

      if (!staged?.media?.id) {
        // eslint-disable-next-line no-console
        console.error('[ImageManager] AI upload returned no media id', staged);
        throw new Error('missing_media_id');
      }
      // eslint-disable-next-line no-console
      console.log('[ImageManager] AI image staged', { mediaId: staged.media.id, draftId: staged.draftId, rank: nextRank, size: aiFile.size });

      appendPendingUploads([aiFile], nextRank, undefined, [staged.media]);
      toast.success(t('aiImageStaged'));
      setAiDialogOpen(false);
      setDraftMediaReloadKey((key) => key + 1);
      onImagesChanged();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[ImageManager] AI upload failed', err);
      toast.error(err?.message === 'missing_media_id' ? t('aiUploadNoDraftId') : draftErr(err, t('uploadError')), { duration: 6000 });
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
      toast.error(t('pendingAltBlocked'));
      return;
    }
    setSavingAlt(true);
    try {
      await stageEtsyDraft({
        shopId,
        listingId,
        media: [{ kind: 'image', operation: 'update_alt', etsyMediaId: editAltImage.listing_image_id, altText: editAltText.trim() }],
      });
      toast.success(t('altTextStaged'));
      setEditAltImage(null);
      onImagesChanged();
    } catch (err: any) {
      console.error('[ImageManager] alt text staging failed', err);
      toast.error(draftErr(err, t('altTextUpdateError')));
    } finally {
      setSavingAlt(false);
    }
  };


  // --- Embedded (listing editor) -------------------------------------------------------------------------------

  const tiles: PhotoTile[] = useMemo(
    () => buildPhotoTiles(localImages, stagedOps, originalRankByImageId),
    [localImages, stagedOps, originalRankByImageId],
  );
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const liveCount = tiles.filter((tile) => tile.staged !== 'delete').length;

  /** Runs one staging request and keeps it visible to isDirty()/stage() until it settles. */
  const onLocalChangeRef = useRef(onLocalChange);
  onLocalChangeRef.current = onLocalChange;
  const track = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const p = work();
    inflightRef.current.add(p);
    setBusyCount((n) => n + 1);
    onLocalChangeRef.current?.();
    const done = () => {
      inflightRef.current.delete(p);
      setBusyCount((n) => Math.max(0, n - 1));
      onLocalChangeRef.current?.();
    };
    p.then(done, done);
    return p;
  }, []);

  const applyDraft = useCallback((draft: { status?: string; media?: any[] } | null | undefined) => {
    if (draft) setStagedOps(collectStagedOps([draft]));
  }, []);

  const stagedOpsRef = useRef(stagedOps);
  stagedOpsRef.current = stagedOps;

  const flushReorder = useCallback(async () => {
    const seq = reorderSeqRef.current;
    if (seq === reorderStagedSeqRef.current) return;
    const ops = reorderOpsFor(localImagesRef.current, originalRankByImageId, stagedOpsRef.current.imageReorders);
    if (ops.length) {
      const draft = await track(() => stageEtsyDraft({ shopId, listingId, media: ops }));
      applyDraft(draft);
      onImagesChanged();
    }
    // A newer move while this one was in flight keeps the section dirty.
    if (reorderSeqRef.current === seq) reorderStagedSeqRef.current = seq;
    onLocalChangeRef.current?.();
  }, [shopId, listingId, originalRankByImageId, track, applyDraft, onImagesChanged]);
  const flushReorderRef = useRef(flushReorder);
  flushReorderRef.current = flushReorder;

  const embeddedError = (err: unknown) => {
    console.error('[ImageManager] embedded staging failed', err);
    dsToast.error(draftErr(err, tLe('photos.stageFailed')));
  };

  /**
   * Free photo slots before Send. A staged removal still holds its slot: the server sends uploads before image
   * deletes, so Etsy would reject a 21st upload while the removed photo is still there (the legacy grid's rule).
   */
  const roomLeft = () => ETSY_MAX_IMAGES - tilesRef.current.length;
  const capacityMessage = (count: number) => (
    tilesRef.current.some((tile) => tile.staged === 'delete')
      ? tLe('photos.fullUntilSent', { max: ETSY_MAX_IMAGES, marketplace: 'Etsy' })
      : tLe('photos.overLimit', { count, max: ETSY_MAX_IMAGES, marketplace: 'Etsy' })
  );

  const stageFilesEmbedded = async (files: File[]) => {
    if (readOnly || files.length === 0) return;
    const { accepted, badType, overLimit } = splitImageFiles(files, roomLeft());
    if (badType) dsToast.error(tLe('photos.badType', { count: badType }), { persist: false });
    if (overLimit) dsToast.error(capacityMessage(overLimit), { persist: false });
    if (!accepted.length) return;
    const current = localImagesRef.current;
    const startRank = current.length > 0 ? Math.max(...current.map((i) => i.rank)) + 1 : 1;
    const done: File[] = [];
    const stagedMedia: any[] = [];
    try {
      await track(async () => {
        for (let i = 0; i < accepted.length; i++) {
          const staged = await stageEtsyDraftFile({
            shopId, listingId, file: accepted[i], kind: 'image', operation: 'upload', rank: Math.min(startRank + i, ETSY_MAX_IMAGES),
          });
          done.push(accepted[i]);
          stagedMedia.push(staged.media);
        }
      });
    } catch (err) {
      embeddedError(err);
    } finally {
      if (done.length) {
        appendPendingUploads(done, startRank, undefined, stagedMedia);
        setDraftMediaReloadKey((key) => key + 1);
        onImagesChanged();
      }
    }
  };

  const findTile = (id: string) => tilesRef.current.find((tile) => tile.id === id) || null;

  const removeTileEmbedded = async (id: string) => {
    const tile = findTile(id);
    if (!tile || readOnly) return;
    if (tile.pending) {
      if (!removeStagedMedia || !tile.mediaId) {
        dsToast.info(tLe('photos.pendingRemoveViaDiscard'));
        return;
      }
      try {
        await track(() => removeStagedMedia(tile.mediaId as string));
        setLocalImages((cur) => sortImagesByRank(cur.filter((img) => img.pending_media_id !== tile.mediaId)));
        setDraftMediaReloadKey((key) => key + 1);
        onImagesChanged();
      } catch (err) { embeddedError(err); }
      return;
    }
    if (tile.imageId == null) return;
    if (!removeStagedMedia) {
      const position = tilesRef.current.findIndex((x) => x.id === id) + 1;
      const ok = await dsConfirm({
        title: tLe('photos.confirmRemoveTitle', { position }),
        body: tLe('photos.confirmRemoveBody', { marketplace: 'Etsy' }),
        confirmLabel: tLe('photos.remove'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    try {
      const draft = await track(() => stageEtsyDraft({
        shopId, listingId, media: [{ kind: 'image', operation: 'delete', etsyMediaId: tile.imageId }],
      }));
      applyDraft(draft);
      onImagesChanged();
    } catch (err) { embeddedError(err); }
  };

  const undoRemoveEmbedded = async (id: string) => {
    const tile = findTile(id);
    if (!tile || tile.imageId == null || !removeStagedMedia) return;
    const rowId = stagedOpsRef.current.imageDeletes.get(tile.imageId);
    if (!rowId) return;
    try {
      await track(() => removeStagedMedia(rowId));
      setStagedOps((ops) => {
        const imageDeletes = new Map(ops.imageDeletes);
        imageDeletes.delete(tile.imageId as number);
        return { ...ops, imageDeletes };
      });
      setDraftMediaReloadKey((key) => key + 1);
      onImagesChanged();
    } catch (err) { embeddedError(err); }
  };

  const reorderEmbedded = (nextIds: string[]) => {
    if (readOnly) return;
    const next = applyTileOrder(tilesRef.current, nextIds);
    if (!next) {
      dsToast.info(tLe('photos.pendingReorder', { marketplace: 'Etsy' }));
      return;
    }
    const byTile = new Map(localImagesRef.current.map((img) => [tileIdFor(img), img]));
    const reordered = next.map((tile) => byTile.get(tile.id)).filter((img): img is ImageInfo => Boolean(img));
    if (reordered.length !== localImagesRef.current.length) return;
    setLocalImages(reordered.map((img, index) => ({ ...img, rank: index + 1 })));
    reorderSeqRef.current += 1;
    hasPendingOrderRef.current = true;
    setHasPendingOrder(true);
    onLocalChangeRef.current?.();
  };

  const makePrimaryEmbedded = (id: string) => {
    const ids = tilesRef.current.map((tile) => tile.id);
    const from = ids.indexOf(id);
    if (from > 0) reorderEmbedded(moveItem(ids, from, 0));
  };

  const saveAltEmbedded = async (id: string, alt: string) => {
    const tile = findTile(id);
    if (!tile || tile.imageId == null || tile.pending) return;
    try {
      const draft = await track(() => stageEtsyDraft({
        shopId, listingId, media: [{ kind: 'image', operation: 'update_alt', etsyMediaId: tile.imageId, altText: cleanAltText(alt) }],
      }));
      applyDraft(draft);
      onImagesChanged();
    } catch (err) {
      embeddedError(err);
      throw err;
    }
  };

  const replaceEmbedded = async (id: string, file: File) => {
    const tile = findTile(id);
    if (!tile || tile.imageId == null || tile.pending || readOnly) return;
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      dsToast.error(tLe('photos.badType', { count: 1 }), { persist: false });
      return;
    }
    if (roomLeft() <= 0) {
      // The new photo uploads before the old one is removed, so it needs a free slot on Etsy.
      dsToast.info(capacityMessage(1));
      return;
    }
    const position = Math.min(tilesRef.current.findIndex((x) => x.id === id) + 1, ETSY_MAX_IMAGES);
    try {
      // Upload first, then remove the old photo: the server sends uploads before deletes, and never deletes the
      // last photo of a listing, so a failed upload cannot leave the listing without this photo.
      const staged = await track(() => stageEtsyDraftFile({
        shopId, listingId, file, kind: 'image', operation: 'upload', rank: position, altText: tile.alt || undefined,
      }));
      appendPendingUploads([file], position, tile.alt || undefined, [staged.media]);
      const draft = await track(() => stageEtsyDraft({
        shopId, listingId, media: [{ kind: 'image', operation: 'delete', etsyMediaId: tile.imageId }],
      }));
      applyDraft(draft);
      setDraftMediaReloadKey((key) => key + 1);
      onImagesChanged();
      setOpenTileId(null);
    } catch (err) { embeddedError(err); }
  };

  const acceptAiEmbedded = async () => {
    if (!aiResult || readOnly) return;
    if (roomLeft() <= 0) {
      dsToast.error(capacityMessage(1), { persist: false });
      return;
    }
    const current = localImagesRef.current;
    const rank = Math.min(current.length > 0 ? Math.max(...current.map((i) => i.rank)) + 1 : 1, ETSY_MAX_IMAGES);
    const aiFile = base64ToFile(aiResult.base64, aiResult.mimeType, `ai-image-${Date.now()}.${aiResult.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`);
    setAiUploading(true);
    try {
      const staged = await track(() => stageEtsyDraftFile({
        shopId, listingId, file: aiFile, kind: 'image', operation: 'ai_upload', rank,
      }));
      if (!staged?.media?.id) throw new Error('missing_media_id');
      appendPendingUploads([aiFile], rank, undefined, [staged.media]);
      dsToast.success(tLe('photos.aiPhotoAdded', { marketplace: 'Etsy' }));
      setAiDialogOpen(false);
      setDraftMediaReloadKey((key) => key + 1);
      onImagesChanged();
    } catch (err) {
      embeddedError(err);
    } finally {
      setAiUploading(false);
    }
  };

  const stageLinksEmbedded = async () => {
    const room = roomLeft();
    if (room <= 0) {
      dsToast.error(capacityMessage(1), { persist: false });
      return;
    }
    const { urls, rejected } = parseImageLinks(linksText, room);
    if (!urls.length) {
      dsToast.error(tLe('photos.linksRejected', { count: Math.max(1, rejected) }), { persist: false });
      return;
    }
    const current = localImagesRef.current;
    const startRank = current.length > 0 ? Math.max(...current.map((i) => i.rank)) + 1 : 1;
    setLinksSaving(true);
    try {
      const draft = await track(() => stageEtsyDraft({
        shopId,
        listingId,
        media: urls.map((sourceUrl, i) => ({ kind: 'image', operation: 'upload', sourceUrl, rank: Math.min(startRank + i, ETSY_MAX_IMAGES) })),
      }));
      applyDraft(draft);
      if (rejected) dsToast.info(tLe('photos.linksRejected', { count: rejected }));
      setLinksOpen(false);
      setLinksText('');
      setDraftMediaReloadKey((key) => key + 1);
      onImagesChanged();
    } catch (err) {
      embeddedError(err);
    } finally {
      setLinksSaving(false);
    }
  };

  const altWriter: WriteAltText | null = writeAltText === null ? null : (writeAltText ?? defaultWriteAltText);
  const altBatchItems: AltBatchItem[] = tiles
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => !tile.pending && tile.staged !== 'delete' && !tile.alt.trim())
    .map(({ tile, index }) => ({ id: tile.id, src: tile.src, position: index + 1 }));

  const useBatchAlts = async (accepted: Array<{ id: string; alt: string }>) => {
    const previous = accepted.map((a) => ({ id: a.id, alt: findTile(a.id)?.alt ?? '' }));
    for (const a of accepted) await saveAltEmbedded(a.id, a.alt);
    // Re-staging the old alt text would leave update_alt rows behind (the draft stays "Not sent yet" and Send
    // still writes to Etsy), so Undo waits for the route that drops staged rows, as removal does.
    if (!removeStagedMedia) {
      dsToast.success(tLe('ai.replaced', { field: tLe('photos.altLabel') }));
      return;
    }
    const removeRow = removeStagedMedia;
    dsToast.success(tLe('ai.replaced', { field: tLe('photos.altLabel') }), {
      undo: () => {
        void (async () => {
          for (const p of previous) {
            const tile = findTile(p.id);
            if (!tile || tile.imageId == null) continue;
            const etsyAlt = (String(localImagesRef.current.find((img) => !img.is_pending_upload && img.listing_image_id === tile.imageId)?.alt_text ?? ''));
            const rowId = stagedOpsRef.current.imageAltRows.get(tile.imageId);
            try {
              if (rowId && cleanAltText(p.alt) === cleanAltText(etsyAlt)) {
                // Back to Etsy's text: drop the staged row so nothing is left to send.
                await track(() => removeRow(rowId));
                setStagedOps((ops) => {
                  const imageAlts = new Map(ops.imageAlts);
                  const imageAltRows = new Map(ops.imageAltRows);
                  imageAlts.delete(tile.imageId as number);
                  imageAltRows.delete(tile.imageId as number);
                  return { ...ops, imageAlts, imageAltRows };
                });
                setDraftMediaReloadKey((key) => key + 1);
                onImagesChanged();
              } else {
                await saveAltEmbedded(p.id, p.alt);
              }
            } catch (err) {
              // saveAltEmbedded already showed its toast.
              if (rowId && cleanAltText(p.alt) === cleanAltText(etsyAlt)) embeddedError(err);
            }
          }
        })();
      },
    });
  };

  const summary = useMemo(
    () => summarizeEtsyPhotos(tiles, { has: Boolean(video) && video?.staged !== 'delete', staged: Boolean(video?.staged) }),
    [tiles, video],
  );
  const summaryKey = JSON.stringify(summary);
  const onSummaryRef = useRef(onSummary);
  onSummaryRef.current = onSummary;
  useEffect(() => {
    if (embedded) onSummaryRef.current?.(summary);
    // summaryKey stands for `summary` (a new object whenever tiles re-memoise).
  }, [embedded, summaryKey]);

  useImperativeHandle(ref, () => ({
    async stage() {
      if (reorderDebounceRef.current) clearTimeout(reorderDebounceRef.current);
      await flushReorderRef.current();
      await Promise.all(Array.from(inflightRef.current));
    },
    isDirty() {
      return reorderSeqRef.current !== reorderStagedSeqRef.current || inflightRef.current.size > 0;
    },
    openUpload() { embeddedFileRef.current?.click(); },
    openGenerate() { openAiDialog(); },
    openPasteLinks() { setLinksOpen(true); },
    openPhoto(tileId?: string) {
      const id = tileId ?? tilesRef.current[0]?.id;
      if (id) setOpenTileId(id);
    },
    writeMissingAlt() { if (altWriter) setAltBatchOpen(true); },
  }));

  // --- Render ---

  // AI image generation dialog (shared by the legacy grid and the embedded strip; unchanged).
  const aiDialog = (
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

          <FormControlLabel
            control={<Checkbox size="small" checked={aiWhiteBg} onChange={(e) => setAiWhiteBg(e.target.checked)} disabled={aiGenerating} />}
            label={<Typography variant="caption">{t('aiWhiteBg')}</Typography>}
            sx={{ mb: 1 }}
          />

          {/* Generate button */}
          <Button
            variant="contained"
            fullWidth
            onClick={() => handleAiGenerate()}
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
                    handleAiFollowUp();
                  }
                }}
              />

              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  onClick={handleAiFollowUp}
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
  );

  if (embedded) {
    const openIndex = openTileId ? tiles.findIndex((tile) => tile.id === openTileId) : -1;
    const openTile = openIndex >= 0 ? tiles[openIndex] : null;
    const step = (delta: number) => {
      if (openIndex < 0 || tiles.length < 2) return;
      setOpenTileId(tiles[(openIndex + delta + tiles.length) % tiles.length].id);
    };
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }} data-testid="etsy-photo-strip">
        <ImageGrid
          variant="strip"
          images={tiles.map((tile) => ({ id: tile.id, src: tile.src, alt: tile.alt, staged: tile.staged }))}
          max={ETSY_MAX_IMAGES}
          onReorder={reorderEmbedded}
          onUpload={(files) => { void stageFilesEmbedded(files); }}
          onDelete={(id) => { void removeTileEmbedded(id); }}
          onUndoDelete={removeStagedMedia ? (id) => { void undoRemoveEmbedded(id); } : undefined}
          onOpen={setOpenTileId}
          flagMissingAlt
          accept={IMAGE_TYPES.join(',')}
          disabled={readOnly}
          video={video ?? null}
          onOpenVideo={onOpenVideo}
          onAddVideo={onAddVideo}
          onUndoDeleteVideo={onUndoDeleteVideo}
          emptyMessage={emptyMessage ?? tLe('photos.noPhotos', { marketplace: 'Etsy' })}
        />
        {busyCount > 0 ? (
          <Box role="status" sx={{ fontSize: 12, lineHeight: '16px', color: 'text.secondary' }}>{tLe('photos.saving')}</Box>
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
            void stageFilesEmbedded(files);
          }}
        />
        <PhotoPanel
          open={Boolean(openTile)}
          onClose={() => setOpenTileId(null)}
          marketplaceName="Etsy"
          media={openTile ? {
            kind: 'photo',
            id: openTile.id,
            src: openTile.src,
            fullSrc: openTile.fullSrc,
            alt: openTile.alt,
            position: openIndex + 1,
            total: tiles.length,
            pending: openTile.pending,
            removing: openTile.staged === 'delete',
          } : null}
          onPrev={tiles.length > 1 ? () => step(-1) : undefined}
          onNext={tiles.length > 1 ? () => step(1) : undefined}
          alt={openTile ? {
            editable: !openTile.pending,
            onSave: (alt) => saveAltEmbedded(openTile.id, alt),
            write: altWriter && !openTile.pending
              ? () => altWriter({ imageUrl: openTile.fullSrc || openTile.src, title: listingTitle || '', description: listingDescription })
              : undefined,
          } : undefined}
          onMakePrimary={openTile ? () => makePrimaryEmbedded(openTile.id) : undefined}
          onReplace={openTile && !openTile.pending ? (file) => replaceEmbedded(openTile.id, file) : undefined}
          onRemove={openTile && (!openTile.pending || removeStagedMedia) ? () => { void removeTileEmbedded(openTile.id); } : undefined}
          onUndoRemove={openTile && removeStagedMedia ? () => { void undoRemoveEmbedded(openTile.id); } : undefined}
          readOnly={readOnly}
        />
        {altWriter ? (
          <AltTextBatchPanel
            open={altBatchOpen}
            onClose={() => setAltBatchOpen(false)}
            marketplaceName="Etsy"
            items={altBatchItems}
            write={(item) => {
              const tile = findTile(item.id);
              return altWriter({ imageUrl: tile?.fullSrc || item.src, title: listingTitle || '', description: listingDescription });
            }}
            onUse={useBatchAlts}
          />
        ) : null}
        <DsModal
          open={linksOpen}
          onClose={() => { if (!linksSaving) setLinksOpen(false); }}
          title={tLe('photos.pasteLinks')}
          size="md"
          primary={{
            id: 'add-links',
            label: tLe('photos.linksAdd'),
            onClick: () => { void stageLinksEmbedded(); },
            loading: linksSaving,
            disabled: !linksText.trim(),
            disabledReason: tLe('photos.linksEmpty'),
          }}
        >
          <DsFormField label={tLe('photos.linksLabel')} helper={tLe('photos.linksHelper', { marketplace: 'Etsy' })}>
            <DsTextArea value={linksText} onChange={setLinksText} minRows={4} maxRows={10} />
          </DsFormField>
        </DsModal>
        {aiDialog}
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t('imagesCount', { count: sortedImages.length })}
      </Typography>

      {hasPendingOrder && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="caption" color="primary">
            {t('unsavedOrderHint')}
          </Typography>
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
          const isPendingUpload = !!img.is_pending_upload;

          return (
            <Box
              key={img.listing_image_id}
              draggable={!isPendingUpload}
              onDragStart={(e) => {
                if (isPendingUpload) return;
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
                opacity: draggingImageId === img.listing_image_id ? 0.65 : 1,
                cursor: isPendingUpload ? 'pointer' : 'grab',
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
                      disabled={isPendingUpload}
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
                      disabled={isPendingUpload}
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
                    disabled={isPendingUpload}
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
        {sortedImages.length < ETSY_MAX_IMAGES && (
          <Box
            onClick={() => !uploading && openUploadDialog()}
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
        {sortedImages.length < ETSY_MAX_IMAGES && (
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

      {aiDialog}

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
});

export default ImageManager;
