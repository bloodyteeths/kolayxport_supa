import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Checkbox, TextField, Chip, Tooltip,
  ToggleButton, ToggleButtonGroup, CircularProgress, Switch, LinearProgress, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions, InputAdornment,
} from '@mui/material';
import {
  Add as AddIcon,
  SwapHoriz as SwapIcon,
  Delete as DeleteIcon,
  Reorder as ReorderIcon,
  Title as AltIcon,
  AutoAwesome as AIIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Close as CloseIcon,
  Image as ImageIcon,
  UploadFile as UploadIcon,
  Refresh as RefreshIcon,
  AutoFixHigh as EnhanceIcon,
  Wallpaper as BgIcon,
  Star as StarIcon,
  FilterList as FilterIcon,
  Save as SaveIcon,
  ContentCopy as CopyIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { stageEtsyDraft, stageEtsyDraftFile } from '@/lib/etsy/draftClient';

// ---------------------------------------------------------------------------
// Types (kept loose to avoid tight coupling with BulkEditor internals)
// ---------------------------------------------------------------------------
export interface StudioListing {
  listing_id: number;
  title: string;
  thumbnail?: { url_75x75?: string } | null;
}

export interface StudioImage {
  listing_image_id: number;
  url_75x75?: string;
  url_170x135?: string;
  url_570xN?: string;
  url_fullxfull?: string;
  rank: number;
  alt_text?: string;
  is_pending_upload?: boolean;
  pending_filename?: string;
}

interface BulkPhotoStudioProps {
  shopId: string;
  listings: StudioListing[]; // already filtered by parent search
  checkedIds: Set<number>;
  onToggleChecked: (id: number) => void;
  onToggleAll: () => void;
  onSetChecked: (ids: number[]) => void;
  allChecked: boolean;
  someChecked: boolean;
  searchTerm: string;
  onSearchChange: (v: string) => void;
  listingImagesById: Record<number, StudioImage[]>;
  setListingImagesById: React.Dispatch<React.SetStateAction<Record<number, StudioImage[]>>>;
  listingImagesLoading: boolean;
  refreshListingImages: (ids: number[], force?: boolean) => Promise<void>;
  onCompleted: () => void;
}

type StudioOp = 'add' | 'replace' | 'delete' | 'reorder' | 'alt' | 'enhance' | 'removebg' | 'copy';
type MediaSource = 'upload' | 'ai' | 'url';
type PositionTarget = number | 'end';
type FilterMode = 'all' | 'nophotos' | 'lt5' | 'full' | 'missingalt';

const MAX_IMAGES = 10;
const AI_CONCURRENCY = 3;
const AI_BATCH_CAP = 60; // guard against enormous accidental AI runs

const REMOVEBG_PROMPT = 'Remove the background completely and place the exact same product on a pure solid white (#FFFFFF) studio background. Keep the product identical, sharp, well-lit and centered, with a soft natural shadow. No text, no props.';
const ENHANCE_PROMPT = 'Enhance this product photo: increase sharpness and clarity, fix lighting and white balance, reduce noise, boost detail. Keep the exact same product, framing and background. Photorealistic, high resolution.';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function base64ToFile(base64: string, mimeType: string, filename: string): File {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([arr], filename, { type: mimeType });
}

function sortByRank(images: StudioImage[]): StudioImage[] {
  return images.slice().sort((a, b) => a.rank - b.rank);
}

// Run async tasks with limited concurrency, reporting progress as each finishes.
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  onProgress?: () => void,
): Promise<void> {
  let cursor = 0;
  const runNext = async (): Promise<void> => {
    while (cursor < items.length) {
      const idx = cursor++;
      try { await worker(items[idx], idx); } catch { /* per-item errors handled by worker */ }
      onProgress?.();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
}

interface AiPreview {
  listingId: number;
  title: string;
  base64: string | null;
  mimeType: string;
  refUrl?: string;
  status: 'pending' | 'done' | 'error';
  accepted: boolean;
  followUp: string;
  regenerating?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function BulkPhotoStudio(props: BulkPhotoStudioProps) {
  const {
    shopId, listings, checkedIds, onToggleChecked, onToggleAll, onSetChecked, allChecked, someChecked,
    searchTerm, onSearchChange, listingImagesById, setListingImagesById,
    listingImagesLoading, refreshListingImages, onCompleted,
  } = props;
  const t = useTranslations('etsy.bulkEditor');

  const [op, setOp] = useState<StudioOp>('add');
  const [source, setSource] = useState<MediaSource>('upload');
  const [position, setPosition] = useState<PositionTarget>('end');
  const [reorderFrom, setReorderFrom] = useState<number>(1);
  const [reorderTo, setReorderTo] = useState<number>(1);
  const [uploadFiles, setUploadFiles] = useState<{ file: File; url: string }[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [copySourceId, setCopySourceId] = useState<number | ''>('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [altMode, setAltMode] = useState<'manual' | 'ai'>('ai');
  const [altText, setAltText] = useState('');
  const [altAllPositions, setAltAllPositions] = useState(true);

  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [previews, setPreviews] = useState<AiPreview[] | null>(null);
  const [dragging, setDragging] = useState<{ listingId: number; slot: number } | null>(null);
  const [lightbox, setLightbox] = useState<{ listingId: number; title: string; img: StudioImage } | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState('');
  const [lightboxSaving, setLightboxSaving] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<string[]>([]);
  // Per-listing add: which listing+slot a single-listing upload targets.
  const singleAddRef = useRef<{ listingId: number; slot: number } | null>(null);
  const singleAddInputRef = useRef<HTMLInputElement>(null);
  const lightboxReplaceRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const checkedListings = useMemo(
    () => listings.filter(l => checkedIds.has(l.listing_id)),
    [listings, checkedIds],
  );

  // Preload images for visible listings.
  useEffect(() => {
    refreshListingImages(listings.map(l => l.listing_id));
  }, [listings, refreshListingImages]);

  // "End" only makes sense for Add — every other op targets a concrete position.
  useEffect(() => {
    if (op !== 'add' && position === 'end') setPosition(1);
  }, [op, position]);

  const imagesFor = useCallback(
    (listingId: number) => sortByRank(listingImagesById[listingId] || []),
    [listingImagesById],
  );

  const isAiOp = op === 'add' || op === 'replace' || op === 'enhance' || op === 'removebg';
  const isReplaceLike = op === 'replace' || op === 'enhance' || op === 'removebg';

  // Resolve a concrete 1-based rank for the current op/position on a given listing.
  const resolveRank = useCallback((listingId: number): number => {
    const count = imagesFor(listingId).length;
    if (position === 'end') return Math.min(count + 1, MAX_IMAGES);
    return typeof position === 'number' ? position : 1;
  }, [imagesFor, position]);

  // Smart filter: narrow which listings are shown so bulk actions can target the ones that need work.
  const displayedListings = useMemo(() => {
    if (filterMode === 'all') return listings;
    return listings.filter(l => {
      const imgs = listingImagesById[l.listing_id];
      if (imgs === undefined) return true; // not loaded yet — don't hide
      const synced = imgs.filter(im => !im.is_pending_upload && im.listing_image_id > 0);
      switch (filterMode) {
        case 'nophotos': return synced.length === 0;
        case 'lt5': return synced.length < 5;
        case 'full': return synced.length >= MAX_IMAGES;
        case 'missingalt': return synced.length > 0 && synced.some(im => !im.alt_text);
        default: return true;
      }
    });
  }, [listings, filterMode, listingImagesById]);

  // Pre-flight: how many checked listings the current op will actually affect vs skip.
  const preflight = useMemo(() => {
    const pos = typeof position === 'number' ? position : 1;
    let apply = 0, skip = 0;
    for (const l of checkedListings) {
      const imgs = imagesFor(l.listing_id);
      const synced = imgs.filter(im => !im.is_pending_upload && im.listing_image_id > 0);
      let ok = true;
      if (op === 'add') ok = imgs.length < MAX_IMAGES;
      else if (op === 'delete') ok = !!imgs[pos - 1] && imgs.length > 1;
      else if (op === 'reorder') ok = imgs.length >= reorderFrom && imgs.length >= 2;
      else if (op === 'alt') ok = synced.length > 0;
      else if (op === 'enhance' || op === 'removebg') { const t0 = imgs[pos - 1]; ok = !!t0 && !t0.is_pending_upload && t0.listing_image_id > 0; }
      // 'replace' always applies (adds if empty)
      if (ok) apply++; else skip++;
    }
    return { apply, skip };
  }, [checkedListings, op, position, reorderFrom, imagesFor]);

  const trackObjectUrl = (url: string) => { objectUrlsRef.current.push(url); return url; };

  const reportResult = useCallback((success: number, failed: number, skipped: number) => {
    if (failed === 0 && skipped === 0) toast.success(t('photoStudio.stagedOk', { count: success }));
    else toast(t('photoStudio.stagedPartial', { success, failed, skipped }), { icon: failed ? '⚠️' : 'ℹ️' });
  }, [t]);

  // -------------------------------------------------------------------------
  // Optimistic helpers
  // -------------------------------------------------------------------------
  const insertPendingImage = useCallback((listingId: number, rank: number, objectUrl: string, filename: string) => {
    setListingImagesById(prev => {
      const current = sortByRank(prev[listingId] || []);
      const pending: StudioImage = {
        listing_image_id: -Date.now() - Math.floor(Math.random() * 1000) - listingId,
        url_75x75: objectUrl, url_170x135: objectUrl, url_570xN: objectUrl, url_fullxfull: objectUrl,
        rank, is_pending_upload: true, pending_filename: filename,
      };
      const insertIdx = Math.max(0, Math.min(current.length, rank - 1));
      const next = [...current.slice(0, insertIdx), pending, ...current.slice(insertIdx)];
      return { ...prev, [listingId]: next.map((img, i) => ({ ...img, rank: i + 1 })) };
    });
  }, [setListingImagesById]);

  const removeImageAtRank = useCallback((listingId: number, rank: number) => {
    setListingImagesById(prev => {
      const current = sortByRank(prev[listingId] || []);
      const next = current.filter((_, i) => i !== rank - 1);
      return { ...prev, [listingId]: next.map((img, i) => ({ ...img, rank: i + 1 })) };
    });
  }, [setListingImagesById]);

  // -------------------------------------------------------------------------
  // Direct per-listing interactions: drag reorder + single-photo delete
  // -------------------------------------------------------------------------
  const dragReorder = useCallback(async (listingId: number, fromSlot: number, toSlot: number) => {
    if (fromSlot === toSlot) return;
    const imgs = imagesFor(listingId);
    const moving = imgs[fromSlot - 1];
    const dest = imgs[toSlot - 1];
    if (!moving) return;
    if (moving.is_pending_upload || moving.listing_image_id <= 0 || (dest && dest.is_pending_upload)) {
      toast(t('photoStudio.pendingReorderBlocked'), { icon: 'ℹ️' });
      return;
    }
    // Optimistic local reorder (compute new order from a snapshot before mutating state).
    const arr = imgs.slice();
    const [m] = arr.splice(fromSlot - 1, 1);
    arr.splice(toSlot - 1, 0, m);
    setListingImagesById(prev => ({ ...prev, [listingId]: arr.map((im, i) => ({ ...im, rank: i + 1 })) }));

    // Stage a reorder op for every synced image whose position actually changed,
    // fully specifying the target order for the draft executor.
    try {
      for (let i = 0; i < arr.length; i++) {
        const im = arr[i];
        const newRank = i + 1;
        if (im.is_pending_upload || im.listing_image_id <= 0 || im.rank === newRank) continue;
        await stageEtsyDraft({ shopId, listingId,
          media: [{ kind: 'image', operation: 'reorder', etsyMediaId: im.listing_image_id, rank: newRank }] });
      }
      toast.success(t('photoStudio.reorderStaged'));
      onCompleted();
    } catch {
      toast.error(t('photoStudio.reorderFailed'));
      refreshListingImages([listingId], true);
    }
  }, [imagesFor, setListingImagesById, shopId, onCompleted, refreshListingImages, t]);

  const deleteSinglePhoto = useCallback(async (listingId: number, slot: number) => {
    const imgs = imagesFor(listingId);
    const target = imgs[slot - 1];
    if (!target) return;
    if (target.is_pending_upload || target.listing_image_id <= 0) {
      toast(t('photoStudio.pendingReorderBlocked'), { icon: 'ℹ️' });
      return;
    }
    if (imgs.length <= 1) { toast.error(t('photoStudio.cantDeleteLast')); return; }
    if (!confirm(t('photoStudio.confirmDeleteOne', { position: slot }))) return;
    try {
      await stageEtsyDraft({ shopId, listingId,
        media: [{ kind: 'image', operation: 'delete', etsyMediaId: target.listing_image_id }] });
      removeImageAtRank(listingId, slot);
      toast.success(t('photoStudio.deleteStaged'));
      onCompleted();
    } catch {
      toast.error(t('photoStudio.reorderFailed'));
    }
  }, [imagesFor, shopId, removeImageAtRank, onCompleted, t]);

  const setAsMain = useCallback((listingId: number, slot: number) => {
    if (slot === 1) return;
    dragReorder(listingId, slot, 1);
    setLightbox(null);
  }, [dragReorder]);

  const openLightbox = useCallback((listingId: number, title: string, img: StudioImage) => {
    setLightbox({ listingId, title, img });
    setLightboxAlt(img.alt_text || '');
  }, []);

  const saveLightboxAlt = useCallback(async () => {
    if (!lightbox || lightbox.img.is_pending_upload || lightbox.img.listing_image_id <= 0) {
      toast(t('photoStudio.pendingReorderBlocked'), { icon: 'ℹ️' });
      return;
    }
    const text = lightboxAlt.trim().slice(0, 250);
    setLightboxSaving(true);
    try {
      await stageEtsyDraft({ shopId, listingId: lightbox.listingId,
        media: [{ kind: 'image', operation: 'update_alt', etsyMediaId: lightbox.img.listing_image_id, altText: text }] });
      setListingImagesById(prev => ({
        ...prev,
        [lightbox.listingId]: (prev[lightbox.listingId] || []).map(im =>
          im.listing_image_id === lightbox.img.listing_image_id ? { ...im, alt_text: text } : im),
      }));
      toast.success(t('photoStudio.altSaved'));
      onCompleted();
      setLightbox(null);
    } catch { toast.error(t('photoStudio.reorderFailed')); }
    finally { setLightboxSaving(false); }
  }, [lightbox, lightboxAlt, shopId, setListingImagesById, onCompleted, t]);

  // Add a single photo to one listing at a specific slot (empty-slot click).
  const onSingleAddFile = useCallback(async (file: File | null) => {
    const target = singleAddRef.current;
    singleAddRef.current = null;
    if (!file || !target) return;
    const valid = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!valid.includes(file.type)) { toast.error(t('photos.unsupportedFiles')); return; }
    const { listingId, slot } = target;
    const rank = Math.min(slot, imagesFor(listingId).length + 1, MAX_IMAGES);
    try {
      await stageEtsyDraftFile({ shopId, listingId, file, kind: 'image', operation: 'upload', rank });
      insertPendingImage(listingId, rank, trackObjectUrl(URL.createObjectURL(file)), file.name);
      toast.success(t('photoStudio.stagedOk', { count: 1 }));
      onCompleted();
    } catch { toast.error(t('photoStudio.reorderFailed')); }
  }, [imagesFor, shopId, insertPendingImage, onCompleted, t]);

  const triggerSingleAdd = useCallback((listingId: number, slot: number) => {
    singleAddRef.current = { listingId, slot };
    singleAddInputRef.current?.click();
  }, []);

  // Replace the single photo currently open in the lightbox with an uploaded file.
  const onLightboxReplaceFile = useCallback(async (file: File | null) => {
    if (!file || !lightbox) return;
    const valid = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!valid.includes(file.type)) { toast.error(t('photos.unsupportedFiles')); return; }
    const { listingId, img } = lightbox;
    const rank = img.rank;
    try {
      if (!img.is_pending_upload && img.listing_image_id > 0) {
        await stageEtsyDraft({ shopId, listingId, media: [{ kind: 'image', operation: 'delete', etsyMediaId: img.listing_image_id }] });
        removeImageAtRank(listingId, rank);
      }
      await stageEtsyDraftFile({ shopId, listingId, file, kind: 'image', operation: 'upload', rank });
      insertPendingImage(listingId, rank, trackObjectUrl(URL.createObjectURL(file)), file.name);
      toast.success(t('photoStudio.stagedOk', { count: 1 }));
      onCompleted();
      setLightbox(null);
    } catch { toast.error(t('photoStudio.reorderFailed')); }
  }, [lightbox, shopId, removeImageAtRank, insertPendingImage, onCompleted, t]);

  // -------------------------------------------------------------------------
  // File selection (upload source) — supports multiple files
  // -------------------------------------------------------------------------
  const clearUploadFiles = useCallback(() => {
    setUploadFiles(prev => { prev.forEach(u => URL.revokeObjectURL(u.url)); return []; });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const onPickFiles = useCallback((files: File[]) => {
    const valid = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const ok = files.filter(f => valid.includes(f.type));
    if (ok.length !== files.length) toast.error(t('photos.unsupportedFiles'));
    if (ok.length === 0) return;
    setUploadFiles(ok.slice(0, MAX_IMAGES).map(file => ({ file, url: URL.createObjectURL(file) })));
  }, [t]);

  // -------------------------------------------------------------------------
  // Apply: manual Add / Replace from uploaded file(s) or a URL
  // -------------------------------------------------------------------------
  const applyManualAddOrReplace = useCallback(async (kind: 'file' | 'url') => {
    if (kind === 'file' && uploadFiles.length === 0) { toast.error(t('photoStudio.chooseFileFirst')); return; }
    if (kind === 'url' && !imageUrl.trim()) { toast.error(t('photoStudio.enterUrl')); return; }
    if (checkedListings.length === 0) { toast.error(t('photoStudio.selectListings')); return; }
    // Replace uses a single source; Add can fan multiple files across positions.
    const items = kind === 'url'
      ? [{ url: imageUrl.trim(), name: 'url-image', preview: imageUrl.trim(), file: null as File | null }]
      : (op === 'replace' ? uploadFiles.slice(0, 1) : uploadFiles).map(u => ({ url: '', name: u.file.name, preview: u.url, file: u.file }));

    setApplying(true); setProgress(0);
    let success = 0, failed = 0, skipped = 0;
    for (let i = 0; i < checkedListings.length; i++) {
      const listing = checkedListings[i];
      try {
        const startRank = resolveRank(listing.listing_id);
        for (let k = 0; k < items.length; k++) {
          const item = items[k];
          const imgs = imagesFor(listing.listing_id);
          const rank = Math.min(startRank + k, imgs.length + 1, MAX_IMAGES);
          if (op === 'add' && imgs.length >= MAX_IMAGES) { skipped++; continue; }
          if (op === 'replace') {
            const existing = imgs[rank - 1];
            if (existing && !existing.is_pending_upload && existing.listing_image_id > 0) {
              await stageEtsyDraft({ shopId, listingId: listing.listing_id,
                media: [{ kind: 'image', operation: 'delete', etsyMediaId: existing.listing_image_id }] });
              removeImageAtRank(listing.listing_id, rank);
            }
          }
          let previewUrl: string;
          if (item.file) {
            await stageEtsyDraftFile({ shopId, listingId: listing.listing_id, file: item.file, kind: 'image', operation: 'upload', rank });
            previewUrl = trackObjectUrl(URL.createObjectURL(item.file)); // fresh URL — recipe-bar thumbnails get revoked on clear
          } else {
            await stageEtsyDraft({ shopId, listingId: listing.listing_id, media: [{ kind: 'image', operation: 'upload', sourceUrl: item.url, rank }] });
            previewUrl = item.url;
          }
          insertPendingImage(listing.listing_id, rank, previewUrl, item.name);
          success++;
        }
      } catch { failed++; }
      setProgress(Math.round(((i + 1) / checkedListings.length) * 100));
      if (i < checkedListings.length - 1) await new Promise(r => setTimeout(r, 120));
    }

    setApplying(false);
    if (kind === 'file') clearUploadFiles(); else setImageUrl('');
    reportResult(success, failed, skipped);
    onCompleted();
  }, [uploadFiles, imageUrl, checkedListings, op, shopId, imagesFor, resolveRank, insertPendingImage, removeImageAtRank, onCompleted, clearUploadFiles, t]);

  // -------------------------------------------------------------------------
  // Apply: Copy one listing's photos to the other selected listings (append)
  // -------------------------------------------------------------------------
  const applyCopy = useCallback(async () => {
    if (!copySourceId) { toast.error(t('photoStudio.pickCopySource')); return; }
    const sourceImgs = imagesFor(copySourceId as number)
      .filter(im => !im.is_pending_upload && im.listing_image_id > 0 && (im.url_fullxfull || im.url_570xN));
    if (sourceImgs.length === 0) { toast.error(t('photoStudio.copySourceEmpty')); return; }
    const targets = checkedListings.filter(l => l.listing_id !== copySourceId);
    if (targets.length === 0) { toast.error(t('photoStudio.copyNoTargets')); return; }

    setApplying(true); setProgress(0);
    let success = 0, failed = 0, skipped = 0;
    for (let i = 0; i < targets.length; i++) {
      const listing = targets[i];
      try {
        let count = imagesFor(listing.listing_id).length;
        let addedAny = false;
        for (const src of sourceImgs) {
          if (count >= MAX_IMAGES) { skipped++; break; }
          const rank = count + 1;
          const url = src.url_fullxfull || src.url_570xN!;
          await stageEtsyDraft({ shopId, listingId: listing.listing_id,
            media: [{ kind: 'image', operation: 'upload', sourceUrl: url, rank, altText: src.alt_text || undefined }] });
          insertPendingImage(listing.listing_id, rank, url, 'copied');
          count++; addedAny = true;
        }
        if (addedAny) success++;
      } catch { failed++; }
      setProgress(Math.round(((i + 1) / targets.length) * 100));
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 120));
    }
    setApplying(false);
    reportResult(success, failed, skipped);
    onCompleted();
  }, [copySourceId, checkedListings, imagesFor, shopId, insertPendingImage, onCompleted, t]);

  // -------------------------------------------------------------------------
  // Apply: Delete at position
  // -------------------------------------------------------------------------
  const applyDelete = useCallback(async () => {
    if (checkedListings.length === 0) { toast.error(t('photoStudio.selectListings')); return; }
    const pos = typeof position === 'number' ? position : MAX_IMAGES;
    if (!confirm(t('photoStudio.confirmDelete', { position: pos, count: checkedListings.length }))) return;

    setApplying(true); setProgress(0);
    let success = 0, failed = 0, skipped = 0;
    for (let i = 0; i < checkedListings.length; i++) {
      const listing = checkedListings[i];
      const imgs = imagesFor(listing.listing_id);
      const target = imgs[pos - 1];
      try {
        if (!target || target.is_pending_upload || target.listing_image_id <= 0) { skipped++; }
        else if (imgs.length <= 1) { skipped++; } // Etsy requires >= 1 photo
        else {
          await stageEtsyDraft({ shopId, listingId: listing.listing_id,
            media: [{ kind: 'image', operation: 'delete', etsyMediaId: target.listing_image_id }] });
          removeImageAtRank(listing.listing_id, pos);
          success++;
        }
      } catch { failed++; }
      setProgress(Math.round(((i + 1) / checkedListings.length) * 100));
      if (i < checkedListings.length - 1) await new Promise(r => setTimeout(r, 100));
    }
    setApplying(false);
    reportResult(success, failed, skipped);
    onCompleted();
  }, [checkedListings, position, shopId, imagesFor, removeImageAtRank, onCompleted, t]);

  // -------------------------------------------------------------------------
  // Apply: Reorder position X -> Y
  // -------------------------------------------------------------------------
  const applyReorder = useCallback(async () => {
    if (checkedListings.length === 0) { toast.error(t('photoStudio.selectListings')); return; }
    if (reorderFrom === reorderTo) { toast.error(t('photoStudio.samePosition')); return; }

    setApplying(true); setProgress(0);
    let success = 0, failed = 0, skipped = 0;
    for (let i = 0; i < checkedListings.length; i++) {
      const listing = checkedListings[i];
      const imgs = imagesFor(listing.listing_id);
      const moving = imgs[reorderFrom - 1];
      try {
        if (!moving || moving.is_pending_upload || moving.listing_image_id <= 0 || imgs.length < reorderFrom) { skipped++; }
        else {
          await stageEtsyDraft({ shopId, listingId: listing.listing_id,
            media: [{ kind: 'image', operation: 'reorder', etsyMediaId: moving.listing_image_id, rank: reorderTo }] });
          // optimistic local reorder
          setListingImagesById(prev => {
            const cur = sortByRank(prev[listing.listing_id] || []);
            const from = reorderFrom - 1, to = Math.min(reorderTo - 1, cur.length - 1);
            if (from < 0 || from >= cur.length) return prev;
            const arr = cur.slice();
            const [m] = arr.splice(from, 1);
            arr.splice(to, 0, m);
            return { ...prev, [listing.listing_id]: arr.map((img, idx) => ({ ...img, rank: idx + 1 })) };
          });
          success++;
        }
      } catch { failed++; }
      setProgress(Math.round(((i + 1) / checkedListings.length) * 100));
      if (i < checkedListings.length - 1) await new Promise(r => setTimeout(r, 100));
    }
    setApplying(false);
    reportResult(success, failed, skipped);
    onCompleted();
  }, [checkedListings, reorderFrom, reorderTo, shopId, imagesFor, setListingImagesById, onCompleted, t]);

  // -------------------------------------------------------------------------
  // Apply: Alt text (manual or AI) at a position or all
  // -------------------------------------------------------------------------
  const applyAltText = useCallback(async () => {
    if (checkedListings.length === 0) { toast.error(t('photoStudio.selectListings')); return; }
    if (altMode === 'manual' && !altText.trim()) { toast.error(t('photoStudio.enterAltText')); return; }
    const pos = typeof position === 'number' ? position : MAX_IMAGES;

    setApplying(true); setProgress(0);
    let success = 0, failed = 0, skipped = 0;
    for (let i = 0; i < checkedListings.length; i++) {
      const listing = checkedListings[i];
      const imgs = imagesFor(listing.listing_id).filter(im => !im.is_pending_upload && im.listing_image_id > 0);
      const targets = altAllPositions ? imgs : (imgs[pos - 1] ? [imgs[pos - 1]] : []);
      if (targets.length === 0) { skipped++; setProgress(Math.round(((i + 1) / checkedListings.length) * 100)); continue; }
      try {
        let text = altText.trim();
        if (altMode === 'ai') {
          const res = await fetch('/api/ai/etsy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'generate_alt_text', title: listing.title }),
          });
          const data = await res.json();
          text = String(data?.alt_text || '').slice(0, 250);
          if (!text) { failed++; setProgress(Math.round(((i + 1) / checkedListings.length) * 100)); continue; }
        }
        for (const img of targets) {
          await stageEtsyDraft({ shopId, listingId: listing.listing_id,
            media: [{ kind: 'image', operation: 'update_alt', etsyMediaId: img.listing_image_id, altText: text }] });
        }
        // reflect alt in local state
        setListingImagesById(prev => {
          const cur = (prev[listing.listing_id] || []).map(im =>
            targets.some(tg => tg.listing_image_id === im.listing_image_id) ? { ...im, alt_text: text } : im);
          return { ...prev, [listing.listing_id]: cur };
        });
        success++;
      } catch { failed++; }
      setProgress(Math.round(((i + 1) / checkedListings.length) * 100));
      if (i < checkedListings.length - 1) await new Promise(r => setTimeout(r, altMode === 'ai' ? 200 : 100));
    }
    setApplying(false);
    reportResult(success, failed, skipped);
    onCompleted();
  }, [checkedListings, altMode, altText, position, altAllPositions, shopId, imagesFor, setListingImagesById, onCompleted, t]);

  // -------------------------------------------------------------------------
  // AI generation (Add / Replace with unique per-listing images)
  // -------------------------------------------------------------------------
  const generateOne = useCallback(async (listing: StudioListing, extraPrompt = ''): Promise<{ base64: string | null; mimeType: string; refUrl?: string }> => {
    const imgs = imagesFor(listing.listing_id);
    const pos = typeof position === 'number' ? position : 1;
    let refUrl: string | undefined;
    let basePrompt: string;
    if (op === 'enhance' || op === 'removebg') {
      // Reference the actual photo being processed, with a preset instruction.
      const target = imgs[pos - 1];
      refUrl = target?.url_fullxfull || target?.url_570xN;
      basePrompt = op === 'removebg' ? REMOVEBG_PROMPT : ENHANCE_PROMPT;
      if (aiPrompt.trim()) basePrompt = `${basePrompt} ${aiPrompt.trim()}`;
    } else {
      // Add/Replace: reference the listing's hero for on-brand consistency.
      const hero = imgs.find(im => !im.is_pending_upload && im.listing_image_id > 0);
      refUrl = hero?.url_fullxfull || hero?.url_570xN;
      basePrompt = aiPrompt.trim() || t('photoStudio.defaultAiPrompt');
    }
    const prompt = extraPrompt ? `${basePrompt}. ${extraPrompt.trim()}` : basePrompt;
    try {
      const res = await fetch('/api/ai/generate-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${prompt}. Product context: ${listing.title}`,
          ...(refUrl ? { reference_image_url: refUrl } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.image_base64) return { base64: null, mimeType: 'image/jpeg', refUrl };
      return { base64: data.image_base64, mimeType: data.mime_type || 'image/jpeg', refUrl };
    } catch {
      return { base64: null, mimeType: 'image/jpeg', refUrl };
    }
  }, [imagesFor, aiPrompt, op, position, t]);

  const startAiGeneration = useCallback(async () => {
    if (checkedListings.length === 0) { toast.error(t('photoStudio.selectListings')); return; }
    if ((op === 'add' || op === 'replace') && !aiPrompt.trim()) { toast.error(t('photoStudio.enterPrompt')); return; }

    const pos = typeof position === 'number' ? position : 1;
    let batch = checkedListings;
    if (op === 'add') batch = batch.filter(l => imagesFor(l.listing_id).length < MAX_IMAGES);
    if (op === 'enhance' || op === 'removebg') batch = batch.filter(l => {
      const target0 = imagesFor(l.listing_id)[pos - 1];
      return target0 && !target0.is_pending_upload && target0.listing_image_id > 0;
    });
    if (batch.length === 0) { toast.error(op === 'add' ? t('photoStudio.allFull') : t('photoStudio.noPhotoAtPosition')); return; }
    let capped = false;
    if (batch.length > AI_BATCH_CAP) { batch = batch.slice(0, AI_BATCH_CAP); capped = true; }

    setGenerating(true); setGenProgress(0);
    const init: AiPreview[] = batch.map(l => ({
      listingId: l.listing_id, title: l.title, base64: null, mimeType: 'image/jpeg',
      status: 'pending', accepted: true, followUp: '',
    }));
    setPreviews(init);

    let done = 0;
    await runPool(batch, AI_CONCURRENCY, async (listing) => {
      const r = await generateOne(listing);
      setPreviews(prev => (prev || []).map(p => p.listingId === listing.listing_id
        ? { ...p, base64: r.base64, mimeType: r.mimeType, refUrl: r.refUrl, status: r.base64 ? 'done' : 'error', accepted: !!r.base64 }
        : p));
    }, () => { done++; setGenProgress(Math.round((done / batch.length) * 100)); });

    setGenerating(false);
    if (capped) toast(t('photoStudio.batchCapped', { cap: AI_BATCH_CAP }));
  }, [checkedListings, aiPrompt, op, position, imagesFor, generateOne, t]);

  const regenerateOne = useCallback(async (listingId: number) => {
    const preview = (previews || []).find(p => p.listingId === listingId);
    const listing = checkedListings.find(l => l.listing_id === listingId);
    if (!preview || !listing) return;
    setPreviews(prev => (prev || []).map(p => p.listingId === listingId ? { ...p, regenerating: true } : p));
    const r = await generateOne(listing, preview.followUp);
    setPreviews(prev => (prev || []).map(p => p.listingId === listingId
      ? { ...p, base64: r.base64 ?? p.base64, mimeType: r.mimeType, status: r.base64 ? 'done' : 'error', regenerating: false, accepted: r.base64 ? true : p.accepted }
      : p));
  }, [previews, checkedListings, generateOne]);

  const stageAiResults = useCallback(async () => {
    const accepted = (previews || []).filter(p => p.accepted && p.base64);
    if (accepted.length === 0) { toast.error(t('photoStudio.noneAccepted')); return; }

    setApplying(true); setProgress(0);
    let success = 0, failed = 0;
    for (let i = 0; i < accepted.length; i++) {
      const p = accepted[i];
      const listing = checkedListings.find(l => l.listing_id === p.listingId);
      if (!listing || !p.base64) { failed++; continue; }
      const rank = resolveRank(p.listingId);
      try {
        if (isReplaceLike) {
          const existing = imagesFor(p.listingId)[rank - 1];
          if (existing && !existing.is_pending_upload && existing.listing_image_id > 0) {
            await stageEtsyDraft({ shopId, listingId: p.listingId,
              media: [{ kind: 'image', operation: 'delete', etsyMediaId: existing.listing_image_id }] });
            removeImageAtRank(p.listingId, rank);
          }
        }
        const file = base64ToFile(p.base64, p.mimeType, `ai-${p.listingId}-${Date.now()}.jpg`);
        await stageEtsyDraftFile({ shopId, listingId: p.listingId, file, kind: 'image', operation: 'ai_upload', rank });
        insertPendingImage(p.listingId, rank, trackObjectUrl(URL.createObjectURL(file)), file.name);
        success++;
      } catch { failed++; }
      setProgress(Math.round(((i + 1) / accepted.length) * 100));
      if (i < accepted.length - 1) await new Promise(r => setTimeout(r, 120));
    }
    setApplying(false);
    setPreviews(null);
    reportResult(success, failed, 0);
    onCompleted();
  }, [previews, checkedListings, isReplaceLike, shopId, resolveRank, imagesFor, removeImageAtRank, insertPendingImage, onCompleted, t]);

  // -------------------------------------------------------------------------
  // Primary apply dispatcher
  // -------------------------------------------------------------------------
  const primaryApply = useCallback(() => {
    if (op === 'add' || op === 'replace') {
      if (source === 'ai') startAiGeneration();
      else if (source === 'url') applyManualAddOrReplace('url');
      else applyManualAddOrReplace('file');
    } else if (op === 'enhance' || op === 'removebg') startAiGeneration();
    else if (op === 'copy') applyCopy();
    else if (op === 'delete') applyDelete();
    else if (op === 'reorder') applyReorder();
    else if (op === 'alt') applyAltText();
  }, [op, source, startAiGeneration, applyManualAddOrReplace, applyCopy, applyDelete, applyReorder, applyAltText]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  const OPS: { key: StudioOp; label: string; icon: React.ReactNode }[] = [
    { key: 'add', label: t('photoStudio.opAdd'), icon: <AddIcon fontSize="small" /> },
    { key: 'replace', label: t('photoStudio.opReplace'), icon: <SwapIcon fontSize="small" /> },
    { key: 'delete', label: t('photoStudio.opDelete'), icon: <DeleteIcon fontSize="small" /> },
    { key: 'reorder', label: t('photoStudio.opReorder'), icon: <ReorderIcon fontSize="small" /> },
    { key: 'alt', label: t('photoStudio.opAlt'), icon: <AltIcon fontSize="small" /> },
    { key: 'copy', label: t('photoStudio.opCopy'), icon: <CopyIcon fontSize="small" /> },
    { key: 'removebg', label: t('photoStudio.opRemoveBg'), icon: <BgIcon fontSize="small" /> },
    { key: 'enhance', label: t('photoStudio.opEnhance'), icon: <EnhanceIcon fontSize="small" /> },
  ];

  const highlightSlot = useCallback((listingId: number, slot: number): 'target' | 'from' | 'to' | null => {
    if (op === 'reorder') {
      if (slot === reorderFrom) return 'from';
      if (slot === reorderTo) return 'to';
      return null;
    }
    if (op === 'alt' && altAllPositions) return 'target';
    const rank = resolveRank(listingId);
    return slot === rank ? 'target' : null;
  }, [op, reorderFrom, reorderTo, altAllPositions, resolveRank]);

  const positionChips = (value: PositionTarget, onChange: (p: PositionTarget) => void, allowEnd: boolean) => (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
      {Array.from({ length: MAX_IMAGES }, (_, i) => i + 1).map(n => (
        <Chip key={n} label={n} size="small"
          color={value === n ? 'primary' : 'default'}
          variant={value === n ? 'filled' : 'outlined'}
          onClick={() => onChange(n)}
          sx={{ minWidth: 34, fontWeight: 700, cursor: 'pointer' }} />
      ))}
      {allowEnd && (
        <Chip label={t('photoStudio.end')} size="small"
          color={value === 'end' ? 'primary' : 'default'}
          variant={value === 'end' ? 'filled' : 'outlined'}
          onClick={() => onChange('end')}
          sx={{ fontWeight: 700, cursor: 'pointer' }} />
      )}
    </Box>
  );

  const isAiFlow = ((op === 'add' || op === 'replace') && source === 'ai') || op === 'enhance' || op === 'removebg';
  const applyDisabled = applying || generating;

  const FILTERS: { key: FilterMode; label: string }[] = [
    { key: 'all', label: t('photoStudio.filterAll') },
    { key: 'nophotos', label: t('photoStudio.filterNoPhotos') },
    { key: 'lt5', label: t('photoStudio.filterLt5') },
    { key: 'missingalt', label: t('photoStudio.filterMissingAlt') },
    { key: 'full', label: t('photoStudio.filterFull') },
  ];

  return (
    <Box>
      {/* ---------------- Recipe bar ---------------- */}
      <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        {/* Operation selector */}
        <ToggleButtonGroup
          exclusive size="small" value={op}
          onChange={(_, v) => v && setOp(v)}
          sx={{ mb: 1.5, flexWrap: 'wrap', '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: 1.5, gap: 0.5, borderRadius: '8px !important', border: '1px solid #e5e7eb !important', mr: 0.5, mb: 0.5 } }}
        >
          {OPS.map(o => (
            <ToggleButton key={o.key} value={o.key}>{o.icon}{o.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        {/* Per-operation controls */}
        {(op === 'add' || op === 'replace') && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                {op === 'add' ? t('photoStudio.insertAt') : t('photoStudio.replaceAt')}
              </Typography>
              {positionChips(position, setPosition, op === 'add')}
            </Box>
            <ToggleButtonGroup exclusive size="small" value={source} onChange={(_, v) => v && setSource(v)}
              sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: 2, gap: 0.5 } }}>
              <ToggleButton value="upload"><UploadIcon fontSize="small" />{t('photoStudio.sourceUpload')}</ToggleButton>
              <ToggleButton value="url"><LinkIcon fontSize="small" />{t('photoStudio.sourceUrl')}</ToggleButton>
              <ToggleButton value="ai"><AIIcon fontSize="small" />{t('photoStudio.sourceAi')}</ToggleButton>
            </ToggleButtonGroup>

            {source === 'upload' ? (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple={op === 'add'} style={{ display: 'none' }}
                  onChange={(e) => onPickFiles(Array.from(e.target.files || []))} />
                <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => fileInputRef.current?.click()}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px' }}>
                  {t('photos.selectFiles')}
                </Button>
                {uploadFiles.map((u, idx) => (
                  <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <img src={u.url} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', border: '1px solid #e5e7eb' }} />
                  </Box>
                ))}
                {uploadFiles.length > 0 && (
                  <Chip label={t('photos.filesSelected', { count: uploadFiles.length })} size="small" onDelete={clearUploadFiles} />
                )}
                <Typography variant="caption" color="text.secondary">
                  {op === 'add' && uploadFiles.length > 1 ? t('photoStudio.multiFileNote') : t('photoStudio.sameFileNote')}
                </Typography>
              </Box>
            ) : source === 'url' ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <TextField size="small" fullWidth placeholder={t('photoStudio.urlPlaceholder')}
                  value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
                <Typography variant="caption" color="text.secondary">{t('photoStudio.urlHelper')}</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <TextField multiline minRows={2} size="small" fullWidth
                  placeholder={t('photoStudio.aiPromptPlaceholder')}
                  value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} />
                <Typography variant="caption" color="text.secondary">{t('photoStudio.aiPromptHelper')}</Typography>
              </Box>
            )}
          </Box>
        )}

        {op === 'copy' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{t('photoStudio.copyFrom')}</Typography>
              <TextField select size="small" SelectProps={{ native: true }} value={copySourceId}
                onChange={(e) => setCopySourceId(e.target.value ? Number(e.target.value) : '')}
                sx={{ minWidth: 240 }}>
                <option value="">{t('photoStudio.pickCopySource')}</option>
                {listings.map(l => (
                  <option key={l.listing_id} value={l.listing_id}>{l.title}</option>
                ))}
              </TextField>
            </Box>
            <Typography variant="caption" color="text.secondary">{t('photoStudio.copyHelper')}</Typography>
          </Box>
        )}

        {(op === 'enhance' || op === 'removebg') && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                {op === 'removebg' ? t('photoStudio.removeBgAt') : t('photoStudio.enhanceAt')}
              </Typography>
              {positionChips(position === 'end' ? 1 : position, (p) => setPosition(p), false)}
            </Box>
            <TextField size="small" fullWidth
              placeholder={op === 'removebg' ? t('photoStudio.removeBgTweak') : t('photoStudio.enhanceTweak')}
              value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} />
            <Typography variant="caption" color="text.secondary">
              {op === 'removebg' ? t('photoStudio.removeBgHelper') : t('photoStudio.enhanceHelper')}
            </Typography>
          </Box>
        )}

        {op === 'delete' && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{t('photoStudio.deleteAt')}</Typography>
            {positionChips(position === 'end' ? 1 : position, (p) => setPosition(p), false)}
            <Typography variant="caption" color="error">{t('photoStudio.deleteNote')}</Typography>
          </Box>
        )}

        {op === 'reorder' && (
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{t('photoStudio.movePosition')}</Typography>
            {positionChips(reorderFrom, (p) => setReorderFrom(p as number), false)}
            <SwapIcon fontSize="small" sx={{ color: 'text.disabled' }} />
            {positionChips(reorderTo, (p) => setReorderTo(p as number), false)}
          </Box>
        )}

        {op === 'alt' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <ToggleButtonGroup exclusive size="small" value={altMode} onChange={(_, v) => v && setAltMode(v)}
                sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: 1.5, gap: 0.5 } }}>
                <ToggleButton value="ai"><AIIcon fontSize="small" />{t('photoStudio.altAi')}</ToggleButton>
                <ToggleButton value="manual">{t('photoStudio.altManual')}</ToggleButton>
              </ToggleButtonGroup>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Switch size="small" checked={altAllPositions} onChange={(e) => setAltAllPositions(e.target.checked)} />
                <Typography variant="caption">{t('photoStudio.altAllPhotos')}</Typography>
              </Box>
              {!altAllPositions && positionChips(position === 'end' ? 1 : position, (p) => setPosition(p), false)}
            </Box>
            {altMode === 'manual' && (
              <TextField size="small" fullWidth placeholder={t('photoStudio.altPlaceholder')}
                value={altText} onChange={(e) => setAltText(e.target.value.slice(0, 250))} />
            )}
          </Box>
        )}

        {/* Apply */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.75, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={primaryApply} disabled={applyDisabled || checkedListings.length === 0}
            startIcon={applyDisabled ? <CircularProgress size={16} sx={{ color: 'white' }} /> : (isAiFlow ? <AIIcon /> : <ImageIcon />)}
            sx={{ minHeight: 42, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '10px',
              ...(isAiFlow ? { background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' } : {}) }}>
            {applying ? `${progress}%` : generating ? `${genProgress}%`
              : isAiFlow ? t('photoStudio.generatePreviews', { count: checkedListings.length })
              : t('photoStudio.applyToN', { count: checkedListings.length })}
          </Button>
          {!applyDisabled && checkedListings.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {preflight.skip > 0
                ? t('photoStudio.preflightWithSkip', { apply: preflight.apply, skip: preflight.skip })
                : t('photoStudio.preflightAll', { apply: preflight.apply })}
            </Typography>
          )}
          {(applying || generating) && <LinearProgress variant="determinate" value={applying ? progress : genProgress} sx={{ flex: 1, minWidth: 120, borderRadius: 2 }} />}
        </Box>
      </Paper>

      {/* ---------------- Search + select all ---------------- */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
        <Checkbox checked={allChecked} indeterminate={someChecked} onChange={onToggleAll} sx={{ p: 0.5 }} />
        <TextField size="small" placeholder={t('search.placeholder')} value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)} sx={{ flex: 1, minWidth: 120, maxWidth: 400 }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment>,
            endAdornment: searchTerm ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => onSearchChange('')}><ClearIcon sx={{ fontSize: 16 }} /></IconButton>
              </InputAdornment>) : undefined,
          }} />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {t('search.selected', { selected: checkedListings.length, total: listings.length })}
        </Typography>
        {listingImagesLoading && <CircularProgress size={16} />}
      </Box>

      {/* ---------------- Smart filters ---------------- */}
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
        <FilterIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        {FILTERS.map(f => (
          <Chip key={f.key} label={f.label} size="small"
            color={filterMode === f.key ? 'primary' : 'default'}
            variant={filterMode === f.key ? 'filled' : 'outlined'}
            onClick={() => setFilterMode(f.key)}
            sx={{ fontWeight: 600, cursor: 'pointer' }} />
        ))}
        {filterMode !== 'all' && (
          <Button size="small" variant="text" onClick={() => onSetChecked(displayedListings.map(l => l.listing_id))}
            sx={{ textTransform: 'none', fontWeight: 700 }}>
            {t('photoStudio.selectFiltered', { count: displayedListings.length })}
          </Button>
        )}
      </Box>

      {/* Hidden inputs for single-listing add / lightbox replace */}
      <input ref={singleAddInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }} onChange={(e) => { onSingleAddFile(e.target.files?.[0] || null); if (e.target) e.target.value = ''; }} />
      <input ref={lightboxReplaceRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }} onChange={(e) => { onLightboxReplaceFile(e.target.files?.[0] || null); if (e.target) e.target.value = ''; }} />

      {displayedListings.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          {t('photoStudio.dragHint')}
        </Typography>
      )}

      {/* ---------------- Per-listing position grid ---------------- */}
      {displayedListings.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{searchTerm || filterMode !== 'all' ? t('search.noMatch') : t('search.noListings')}</Typography>
        </Paper>
      ) : displayedListings.map(listing => {
        const imgs = imagesFor(listing.listing_id);
        const isChecked = checkedIds.has(listing.listing_id);
        return (
          <Paper key={listing.listing_id} variant="outlined"
            sx={{ p: { xs: 1, sm: 1.25 }, mb: 1, opacity: isChecked ? 1 : 0.45, transition: 'opacity 0.15s' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Checkbox checked={isChecked} onChange={() => onToggleChecked(listing.listing_id)} sx={{ p: 0.5 }} />
              <Box
                sx={{ width: 34, height: 34, borderRadius: 1, flexShrink: 0, bgcolor: '#f1f5f9',
                  backgroundImage: listing.thumbnail?.url_75x75 ? `url(${listing.thumbnail.url_75x75})` : 'none',
                  backgroundSize: 'cover', backgroundPosition: 'center' }} />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {listing.title}
              </Typography>
              <Chip size="small" label={t('photos.imageCount', { count: imgs.length })} sx={{ fontWeight: 600 }} />
            </Box>
            {/* Slot strip — drag a photo onto another slot to reorder */}
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75, flexWrap: 'wrap', pl: { xs: 0, sm: 5 } }}>
              {Array.from({ length: MAX_IMAGES }, (_, i) => i + 1).map(slot => {
                const img = imgs[slot - 1];
                const hl = highlightSlot(listing.listing_id, slot);
                const ring = hl === 'from' ? '#f59e0b' : hl === 'to' ? '#10b981' : hl === 'target' ? '#2563eb' : 'transparent';
                const src = img?.url_170x135 || img?.url_75x75 || img?.url_570xN;
                const isDragSrc = dragging?.listingId === listing.listing_id && dragging.slot === slot;
                const canDrag = !!img && !img.is_pending_upload && img.listing_image_id > 0;
                const isAddSlot = !img && slot === imgs.length + 1 && imgs.length < MAX_IMAGES;
                return (
                  <Tooltip key={slot} title={img ? (img.alt_text || t('photoStudio.clickPreviewDragReorder')) : isAddSlot ? t('photoStudio.addHereHint') : t('photoStudio.emptySlot', { position: slot })}>
                    <Box
                      draggable={canDrag}
                      onDragStart={() => canDrag && setDragging({ listingId: listing.listing_id, slot })}
                      onDragOver={(e) => { if (dragging?.listingId === listing.listing_id) e.preventDefault(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragging && dragging.listingId === listing.listing_id && img) {
                          dragReorder(listing.listing_id, dragging.slot, slot);
                        }
                        setDragging(null);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => {
                        if (dragging) return;
                        if (img) openLightbox(listing.listing_id, listing.title, img);
                        else if (isAddSlot) triggerSingleAdd(listing.listing_id, slot);
                      }}
                      sx={{ position: 'relative', width: 52, height: 52, borderRadius: 1.5, overflow: 'hidden',
                        border: '2px ' + (isAddSlot ? 'dashed' : 'solid'), borderColor: isAddSlot ? '#94a3b8' : ring, boxShadow: hl ? `0 0 0 1px ${ring}55` : 'none',
                        bgcolor: img ? '#fff' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: isDragSrc ? 0.4 : 1, cursor: img ? (canDrag ? 'grab' : 'pointer') : (isAddSlot ? 'pointer' : 'default'),
                        '&:active': canDrag ? { cursor: 'grabbing' } : undefined,
                        '&:hover .slot-del': { opacity: img ? 1 : 0 },
                        '&:hover': isAddSlot ? { borderColor: 'primary.main', bgcolor: 'primary.50' } : undefined,
                        transition: 'opacity 0.12s, border-color 0.12s' }}>
                      {src ? (
                        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                      ) : isAddSlot ? (
                        <AddIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                      ) : (
                        <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 700 }}>{slot}</Typography>
                      )}
                      {img && (
                        <Box sx={{ position: 'absolute', top: 1, left: 1, minWidth: 14, height: 14, px: 0.3, borderRadius: '999px',
                          bgcolor: slot === 1 ? 'rgba(245,158,11,0.95)' : 'rgba(15,23,42,0.72)', color: 'white', fontSize: 9, lineHeight: '14px', textAlign: 'center', fontWeight: 700 }}>
                          {slot}
                        </Box>
                      )}
                      {canDrag && (
                        <IconButton className="slot-del" size="small"
                          onClick={(e) => { e.stopPropagation(); deleteSinglePhoto(listing.listing_id, slot); }}
                          sx={{ position: 'absolute', top: -2, right: -2, p: '2px', opacity: 0, bgcolor: 'rgba(220,38,38,0.92)',
                            color: 'white', '&:hover': { bgcolor: '#b91c1c' }, transition: 'opacity 0.12s' }}>
                          <CloseIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                      )}
                      {img?.is_pending_upload && (
                        <Box sx={{ position: 'absolute', bottom: 1, left: 1, px: 0.4, height: 13, borderRadius: '999px',
                          bgcolor: 'rgba(37,99,235,0.9)', color: 'white', fontSize: 8, lineHeight: '13px', fontWeight: 700 }}>
                          {t('photoStudio.draftBadge')}
                        </Box>
                      )}
                      {img?.alt_text && (
                        <Box sx={{ position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: '50%',
                          bgcolor: 'rgba(16,185,129,0.9)', color: 'white', fontSize: 8, lineHeight: '13px', textAlign: 'center', fontWeight: 700 }}>A</Box>
                      )}
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          </Paper>
        );
      })}

      {/* ---------------- AI review dialog ---------------- */}
      <Dialog open={!!previews} onClose={() => !applying && !generating && setPreviews(null)} maxWidth="lg" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
          <AIIcon sx={{ color: '#8b5cf6' }} />{t('photoStudio.reviewTitle')}
          {generating && <Chip size="small" label={`${genProgress}%`} color="secondary" sx={{ ml: 1 }} />}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t('photoStudio.reviewHelper')}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            {(previews || []).map(p => (
              <Paper key={p.listingId} variant="outlined" sx={{ p: 1, borderRadius: 2,
                borderColor: p.accepted && p.base64 ? 'primary.main' : 'divider' }}>
                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.title}
                </Typography>
                <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 1.5, overflow: 'hidden', bgcolor: '#f8fafc',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 0.75 }}>
                  {p.status === 'pending' || p.regenerating ? <CircularProgress size={24} />
                    : p.base64 ? <img src={`data:${p.mimeType};base64,${p.base64}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Typography variant="caption" color="error">{t('photoStudio.genFailed')}</Typography>}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Switch size="small" checked={p.accepted} disabled={!p.base64}
                      onChange={(e) => setPreviews(prev => (prev || []).map(x => x.listingId === p.listingId ? { ...x, accepted: e.target.checked } : x))} />
                    <Typography variant="caption">{p.accepted ? t('photoStudio.accepted') : t('photoStudio.skipped')}</Typography>
                  </Box>
                  <Tooltip title={t('photoStudio.regenerate')}>
                    <span>
                      <IconButton size="small" disabled={p.regenerating || generating} onClick={() => regenerateOne(p.listingId)}>
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                <TextField size="small" fullWidth placeholder={t('photoStudio.followUpPlaceholder')}
                  value={p.followUp}
                  onChange={(e) => setPreviews(prev => (prev || []).map(x => x.listingId === p.listingId ? { ...x, followUp: e.target.value } : x))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); regenerateOne(p.listingId); } }}
                  InputProps={{ sx: { fontSize: '0.78rem' } }} />
              </Paper>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setPreviews(null)} disabled={applying} sx={{ textTransform: 'none', fontWeight: 600 }}>
            {t('photoStudio.cancel')}
          </Button>
          <Button variant="contained" onClick={stageAiResults} disabled={applying || generating}
            startIcon={applying ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <ImageIcon />}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}>
            {applying ? `${progress}%` : t('photoStudio.stageAccepted', { count: (previews || []).filter(p => p.accepted && p.base64).length })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---------------- Photo lightbox ---------------- */}
      <Dialog open={!!lightbox} onClose={() => setLightbox(null)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, fontWeight: 700 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lightbox?.title}
          </Typography>
          <IconButton size="small" onClick={() => setLightbox(null)}><CloseIcon fontSize="small" /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {lightbox && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 300px' }, gap: 2, alignItems: 'start' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f8fafc', borderRadius: 2, p: 1, minHeight: 240 }}>
                <img src={lightbox.img.url_fullxfull || lightbox.img.url_570xN || lightbox.img.url_170x135}
                  alt={lightbox.img.alt_text || ''}
                  style={{ maxWidth: '100%', maxHeight: '62vh', borderRadius: 8, objectFit: 'contain' }} />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                <Chip size="small" label={`${t('photoStudio.position')} ${lightbox.img.rank}${lightbox.img.rank === 1 ? ' · ' + t('photoStudio.mainBadge') : ''}`}
                  color={lightbox.img.rank === 1 ? 'warning' : 'default'} sx={{ fontWeight: 700, alignSelf: 'flex-start' }} />
                {lightbox.img.is_pending_upload ? (
                  <Typography variant="caption" color="text.secondary">{t('photoStudio.pendingReorderBlocked')}</Typography>
                ) : (
                  <>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{t('photoStudio.altLabel')}</Typography>
                    <TextField size="small" fullWidth multiline minRows={2} placeholder={t('photoStudio.altPlaceholder')}
                      value={lightboxAlt} onChange={(e) => setLightboxAlt(e.target.value.slice(0, 250))} />
                    <Button variant="contained" size="small" onClick={saveLightboxAlt} disabled={lightboxSaving}
                      startIcon={lightboxSaving ? <CircularProgress size={14} sx={{ color: 'white' }} /> : <SaveIcon />}
                      sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}>
                      {t('photoStudio.saveAlt')}
                    </Button>
                    <Divider flexItem />
                    <Button variant="outlined" size="small" startIcon={<StarIcon />}
                      disabled={lightbox.img.rank === 1} onClick={() => setAsMain(lightbox.listingId, lightbox.img.rank)}
                      sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px' }}>
                      {t('photoStudio.setAsMain')}
                    </Button>
                    <Button variant="outlined" size="small" startIcon={<SwapIcon />} onClick={() => lightboxReplaceRef.current?.click()}
                      sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px' }}>
                      {t('photoStudio.replacePhoto')}
                    </Button>
                    <Button variant="outlined" color="error" size="small" startIcon={<DeleteIcon />}
                      onClick={() => { const s = lightbox.img.rank; setLightbox(null); deleteSinglePhoto(lightbox.listingId, s); }}
                      sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px' }}>
                      {t('photoStudio.opDelete')}
                    </Button>
                  </>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
