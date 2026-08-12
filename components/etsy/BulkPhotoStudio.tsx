import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Checkbox, TextField, Chip, Tooltip,
  ToggleButton, ToggleButtonGroup, CircularProgress, Switch, LinearProgress,
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

type StudioOp = 'add' | 'replace' | 'delete' | 'reorder' | 'alt';
type MediaSource = 'upload' | 'ai';
type PositionTarget = number | 'end';

const MAX_IMAGES = 10;
const AI_CONCURRENCY = 3;
const AI_BATCH_CAP = 60; // guard against enormous accidental AI runs

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
    shopId, listings, checkedIds, onToggleChecked, onToggleAll, allChecked, someChecked,
    searchTerm, onSearchChange, listingImagesById, setListingImagesById,
    listingImagesLoading, refreshListingImages, onCompleted,
  } = props;
  const t = useTranslations('etsy.bulkEditor');

  const [op, setOp] = useState<StudioOp>('add');
  const [source, setSource] = useState<MediaSource>('upload');
  const [position, setPosition] = useState<PositionTarget>('end');
  const [reorderFrom, setReorderFrom] = useState<number>(1);
  const [reorderTo, setReorderTo] = useState<number>(1);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
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
  const [lightbox, setLightbox] = useState<{ title: string; img: StudioImage } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<string[]>([]);

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

  // Resolve a concrete 1-based rank for the current op/position on a given listing.
  const resolveRank = useCallback((listingId: number): number => {
    const count = imagesFor(listingId).length;
    if (position === 'end') return Math.min(count + 1, MAX_IMAGES);
    return position;
  }, [imagesFor, position]);

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

  // -------------------------------------------------------------------------
  // File selection (upload source)
  // -------------------------------------------------------------------------
  const onPickFile = useCallback((file: File | null) => {
    if (uploadPreview) { URL.revokeObjectURL(uploadPreview); }
    if (!file) { setUploadFile(null); setUploadPreview(null); return; }
    const valid = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!valid.includes(file.type)) { toast.error(t('photos.unsupportedFiles')); return; }
    setUploadFile(file);
    setUploadPreview(URL.createObjectURL(file));
  }, [uploadPreview, t]);

  // -------------------------------------------------------------------------
  // Apply: upload-based Add / Replace
  // -------------------------------------------------------------------------
  const applyUploadAddOrReplace = useCallback(async () => {
    if (!uploadFile) { toast.error(t('photoStudio.chooseFileFirst')); return; }
    if (checkedListings.length === 0) { toast.error(t('photoStudio.selectListings')); return; }

    setApplying(true); setProgress(0);
    let success = 0, failed = 0, skipped = 0;

    for (let i = 0; i < checkedListings.length; i++) {
      const listing = checkedListings[i];
      const imgs = imagesFor(listing.listing_id);
      const rank = resolveRank(listing.listing_id);
      try {
        if (op === 'add' && imgs.length >= MAX_IMAGES) { skipped++; }
        else {
          if (op === 'replace') {
            const existing = imgs[rank - 1];
            if (existing && !existing.is_pending_upload && existing.listing_image_id > 0) {
              await stageEtsyDraft({ shopId, listingId: listing.listing_id,
                media: [{ kind: 'image', operation: 'delete', etsyMediaId: existing.listing_image_id }] });
              removeImageAtRank(listing.listing_id, rank);
            }
          }
          await stageEtsyDraftFile({ shopId, listingId: listing.listing_id, file: uploadFile,
            kind: 'image', operation: 'upload', rank });
          insertPendingImage(listing.listing_id, rank,
            trackObjectUrl(URL.createObjectURL(uploadFile)), uploadFile.name);
          success++;
        }
      } catch { failed++; }
      setProgress(Math.round(((i + 1) / checkedListings.length) * 100));
      if (i < checkedListings.length - 1) await new Promise(r => setTimeout(r, 120));
    }

    setApplying(false);
    onPickFile(null);
    reportResult(success, failed, skipped);
    onCompleted();
  }, [uploadFile, checkedListings, op, shopId, imagesFor, resolveRank, insertPendingImage, removeImageAtRank, onCompleted, onPickFile, t]);

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
    const hero = imagesFor(listing.listing_id).find(im => !im.is_pending_upload && im.listing_image_id > 0);
    const refUrl = hero?.url_fullxfull || hero?.url_570xN;
    const basePrompt = aiPrompt.trim() || t('photoStudio.defaultAiPrompt');
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
  }, [imagesFor, aiPrompt, t]);

  const startAiGeneration = useCallback(async () => {
    if (checkedListings.length === 0) { toast.error(t('photoStudio.selectListings')); return; }
    if (!aiPrompt.trim()) { toast.error(t('photoStudio.enterPrompt')); return; }

    let batch = checkedListings;
    if (op === 'add') batch = batch.filter(l => imagesFor(l.listing_id).length < MAX_IMAGES);
    if (batch.length === 0) { toast.error(t('photoStudio.allFull')); return; }
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
  }, [checkedListings, aiPrompt, op, imagesFor, generateOne, t]);

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
        if (op === 'replace') {
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
    setAiPrompt('');
    reportResult(success, failed, 0);
    onCompleted();
  }, [previews, checkedListings, op, shopId, resolveRank, imagesFor, removeImageAtRank, insertPendingImage, onCompleted, t]);

  // -------------------------------------------------------------------------
  // Primary apply dispatcher
  // -------------------------------------------------------------------------
  const primaryApply = useCallback(() => {
    if (op === 'add' || op === 'replace') {
      if (source === 'ai') startAiGeneration();
      else applyUploadAddOrReplace();
    } else if (op === 'delete') applyDelete();
    else if (op === 'reorder') applyReorder();
    else if (op === 'alt') applyAltText();
  }, [op, source, startAiGeneration, applyUploadAddOrReplace, applyDelete, applyReorder, applyAltText]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  const OPS: { key: StudioOp; label: string; icon: React.ReactNode }[] = [
    { key: 'add', label: t('photoStudio.opAdd'), icon: <AddIcon fontSize="small" /> },
    { key: 'replace', label: t('photoStudio.opReplace'), icon: <SwapIcon fontSize="small" /> },
    { key: 'delete', label: t('photoStudio.opDelete'), icon: <DeleteIcon fontSize="small" /> },
    { key: 'reorder', label: t('photoStudio.opReorder'), icon: <ReorderIcon fontSize="small" /> },
    { key: 'alt', label: t('photoStudio.opAlt'), icon: <AltIcon fontSize="small" /> },
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

  const isAiFlow = (op === 'add' || op === 'replace') && source === 'ai';
  const applyDisabled = applying || generating;

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
              <ToggleButton value="ai"><AIIcon fontSize="small" />{t('photoStudio.sourceAi')}</ToggleButton>
            </ToggleButtonGroup>

            {source === 'upload' ? (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: 'none' }} onChange={(e) => onPickFile(e.target.files?.[0] || null)} />
                <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => fileInputRef.current?.click()}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px' }}>
                  {t('photos.selectFiles')}
                </Button>
                {uploadPreview && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <img src={uploadPreview} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', border: '1px solid #e5e7eb' }} />
                    <Chip label={uploadFile?.name} size="small" onDelete={() => onPickFile(null)} sx={{ maxWidth: 200 }} />
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary">{t('photoStudio.sameFileNote')}</Typography>
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

      {listings.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          {t('photoStudio.dragHint')}
        </Typography>
      )}

      {/* ---------------- Per-listing position grid ---------------- */}
      {listings.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{searchTerm ? t('search.noMatch') : t('search.noListings')}</Typography>
        </Paper>
      ) : listings.map(listing => {
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
                return (
                  <Tooltip key={slot} title={img ? (img.alt_text || t('photoStudio.clickPreviewDragReorder')) : t('photoStudio.emptySlot', { position: slot })}>
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
                      onClick={() => { if (img && !dragging) setLightbox({ title: listing.title, img }); }}
                      sx={{ position: 'relative', width: 52, height: 52, borderRadius: 1.5, overflow: 'hidden',
                        border: '2px solid', borderColor: ring, boxShadow: hl ? `0 0 0 1px ${ring}55` : 'none',
                        bgcolor: img ? '#fff' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: isDragSrc ? 0.4 : 1, cursor: img ? (canDrag ? 'grab' : 'pointer') : 'default',
                        '&:active': canDrag ? { cursor: 'grabbing' } : undefined,
                        '&:hover .slot-del': { opacity: img ? 1 : 0 },
                        transition: 'opacity 0.12s, border-color 0.12s' }}>
                      {src ? (
                        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
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
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <img src={lightbox.img.url_fullxfull || lightbox.img.url_570xN || lightbox.img.url_170x135}
                alt={lightbox.img.alt_text || ''}
                style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8, objectFit: 'contain' }} />
              <Typography variant="caption" color="text.secondary">
                {t('photoStudio.position')}: {lightbox.img.rank}
                {lightbox.img.alt_text ? ` · ${lightbox.img.alt_text}` : ''}
              </Typography>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
