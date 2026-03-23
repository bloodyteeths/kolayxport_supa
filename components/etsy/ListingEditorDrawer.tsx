import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Switch,
  FormControlLabel,
  Chip,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Tooltip,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SaveIcon from '@mui/icons-material/Save';
import PublishIcon from '@mui/icons-material/Publish';
import DeleteIcon from '@mui/icons-material/Delete';
import BlockIcon from '@mui/icons-material/Block';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import UndoIcon from '@mui/icons-material/Undo';
import AddIcon from '@mui/icons-material/Add';
import HistoryIcon from '@mui/icons-material/History';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { toast } from 'react-hot-toast';

import SEOIndicator from './SEOIndicator';
import ImageManager from './ImageManager';
import VideoUploader from './VideoUploader';
import PersonalizationEditor, { type PersonalizationQuestion } from './PersonalizationEditor';
import VariationEditor from './VariationEditor';
import { SaveTemplateDialog, LoadTemplateDialog, TagProfileMenu } from './ListingTemplates';
import type { ListingTemplate } from './ListingTemplates';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import ScheduledUpdateDialog, {
  getScheduledUpdatesForListing,
  useScheduledUpdateExecutor,
  type ScheduledChanges,
} from './ScheduledUpdateDialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketContext {
  query: string;
  topTags: Array<{ tag: string; count: number; pct: number }>;
  topKeywords: Array<{ keyword: string; count: number; pct: number }>;
  priceStats: { min: number; avg: number; median: number; max: number } | null;
}

interface ListingEditorDrawerProps {
  open: boolean;
  onClose: () => void;
  listingId: string | null;
  shopId: string;
  shopSections: Array<{ shop_section_id: number; title: string }>;
  shippingProfiles: Array<{ shipping_profile_id: number; title: string }>;
  returnPolicies: Array<{ return_policy_id: number; description?: string; accepts_returns?: boolean; accepts_exchanges?: boolean }>;
  onSaved: () => void;
  marketResearchData?: MarketContext | null;
}

interface PriceInfo {
  amount: number;
  divisor: number;
  currency_code: string;
}

interface ImageInfo {
  listing_image_id: number;
  url_75x75: string;
  url_170x135: string;
  url_570xN: string;
  url_fullxfull?: string;
  rank: number;
  alt_text?: string;
}

interface VideoInfo {
  video_id: number;
  thumbnail_url?: string;
  video_url?: string;
  state?: string;
}

interface ListingData {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  price: PriceInfo | null;
  views: number;
  num_favorers: number;
  quantity: number;
  state: string;
  url: string;
  taxonomy_id?: number;
  shop_section_id?: number;
  processing_min?: number;
  processing_max?: number;
  who_made?: string;
  when_made?: string;
  is_supply?: boolean;
  item_weight?: number;
  item_weight_unit?: string;
  item_length?: number;
  item_width?: number;
  item_height?: number;
  item_dimensions_unit?: string;
  shipping_profile_id?: number;
  return_policy_id?: number;
  created_timestamp?: number;
  updated_timestamp?: number;
  is_personalizable: boolean;
  personalization_is_required: boolean;
  personalization_instructions: string;
  personalization_char_count_max: number;
  personalization_questions: PersonalizationQuestion[];
  images: ImageInfo[];
}

// Editable fields tracked for dirty-checking
interface EditableFields {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  price: string; // displayed as decimal string e.g. "12.50"
  quantity: number;
  who_made: string;
  when_made: string;
  is_supply: boolean;
  shop_section_id: number | '';
  shipping_profile_id: number | '';
  return_policy_id: number | '';
  processing_min: number | '';
  processing_max: number | '';
  item_weight: number | '';
  item_weight_unit: string;
  item_length: number | '';
  item_width: number | '';
  item_height: number | '';
  item_dimensions_unit: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WHO_MADE_OPTIONS = [
  { value: 'i_did', label: 'Ben yaptim' },
  { value: 'collective', label: 'Ekibimiz yapti' },
  { value: 'someone_else', label: 'Baskasi yapti' },
];

const WHEN_MADE_OPTIONS = [
  { value: 'made_to_order', label: 'Siparise ozel' },
  { value: '2020_2025', label: '2020-2025' },
  { value: '2010_2019', label: '2010-2019' },
  { value: '2004_2009', label: '2004-2009' },
  { value: 'before_2004', label: '2004 oncesi' },
  { value: '2000_2003', label: '2000-2003' },
  { value: '1990s', label: '1990\'lar' },
  { value: '1980s', label: '1980\'ler' },
  { value: '1970s', label: '1970\'ler' },
  { value: '1960s', label: '1960\'lar' },
];

const WEIGHT_UNITS = [
  { value: 'oz', label: 'oz' },
  { value: 'lb', label: 'lb' },
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
];

const DIMENSION_UNITS = [
  { value: 'in', label: 'in' },
  { value: 'ft', label: 'ft' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'm', label: 'm' },
];

const DRAWER_WIDTH = 550;

// ---------------------------------------------------------------------------
// Draft persistence (localStorage)
// ---------------------------------------------------------------------------

const DRAFT_KEY_PREFIX = 'listing_draft_';

function getDraftKey(listingId: string): string {
  return `${DRAFT_KEY_PREFIX}${listingId}`;
}

function saveDraft(listingId: string, fields: EditableFields): void {
  try {
    localStorage.setItem(getDraftKey(listingId), JSON.stringify(fields));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

function loadDraft(listingId: string): EditableFields | null {
  try {
    const raw = localStorage.getItem(getDraftKey(listingId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearDraft(listingId: string): void {
  try {
    localStorage.removeItem(getDraftKey(listingId));
  } catch {
    // Silently ignore
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function priceToDecimal(price: PriceInfo | null): string {
  if (!price) return '0.00';
  return (price.amount / (price.divisor || 100)).toFixed(2);
}

function buildInitialFields(listing: ListingData): EditableFields {
  return {
    title: listing.title,
    description: listing.description,
    tags: [...listing.tags],
    materials: [...listing.materials],
    price: priceToDecimal(listing.price),
    quantity: listing.quantity,
    who_made: listing.who_made || 'i_did',
    when_made: listing.when_made || 'made_to_order',
    is_supply: listing.is_supply ?? false,
    shop_section_id: listing.shop_section_id ?? '',
    shipping_profile_id: listing.shipping_profile_id ?? '',
    return_policy_id: listing.return_policy_id ?? '',
    processing_min: listing.processing_min ?? '',
    processing_max: listing.processing_max ?? '',
    item_weight: listing.item_weight ?? '',
    item_weight_unit: listing.item_weight_unit || 'g',
    item_length: listing.item_length ?? '',
    item_width: listing.item_width ?? '',
    item_height: listing.item_height ?? '',
    item_dimensions_unit: listing.item_dimensions_unit || 'cm',
  };
}

/** Shallow compare two EditableFields objects and return changed keys */
function getChangedFields(
  original: EditableFields,
  current: EditableFields,
): Partial<Record<keyof EditableFields, any>> {
  const changed: Partial<Record<keyof EditableFields, any>> = {};
  const keys = Object.keys(original) as (keyof EditableFields)[];

  for (const key of keys) {
    const orig = original[key];
    const curr = current[key];

    if (Array.isArray(orig) && Array.isArray(curr)) {
      if (orig.length !== curr.length || orig.some((v, i) => v !== curr[i])) {
        changed[key] = curr;
      }
    } else if (orig !== curr) {
      (changed as any)[key] = curr;
    }
  }

  return changed;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ListingEditorDrawer({
  open,
  onClose,
  listingId,
  shopId,
  shopSections,
  shippingProfiles,
  returnPolicies,
  onSaved,
  marketResearchData,
}: ListingEditorDrawerProps) {
  // Loading / data state
  const [loading, setLoading] = useState(false);
  const [listing, setListing] = useState<ListingData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Editable fields
  const [fields, setFields] = useState<EditableFields | null>(null);
  const fieldsRef = useRef<EditableFields | null>(null);
  const originalFieldsRef = useRef<EditableFields | null>(null);

  // Videos (fetched separately)
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);

  // Action states
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [copying, setCopying] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Template / profile state
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);

  // AI state
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiTagSuggestions, setAiTagSuggestions] = useState<string[]>([]);

  // Accordion expanded state
  const [expanded, setExpanded] = useState<string | false>('basics');

  // Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'unsaved' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Change history for undo (stores up to 10 snapshots)
  const [history, setHistory] = useState<EditableFields[]>([]);
  const MAX_HISTORY = 10;

  // Scheduled updates
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [pendingScheduleCount, setPendingScheduleCount] = useState(0);

  // Keep fieldsRef in sync for use in cleanup effects
  useEffect(() => { fieldsRef.current = fields; }, [fields]);

  // Execute scheduled updates (polls every 30s)
  useScheduledUpdateExecutor();

  // Creation dialog states
  const [createShippingOpen, setCreateShippingOpen] = useState(false);
  const [createReturnOpen, setCreateReturnOpen] = useState(false);
  const [createSectionOpen, setCreateSectionOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  // Shipping profile creation form
  const [newShipping, setNewShipping] = useState({
    title: '', origin_country_iso: 'TR', primary_cost: '0', secondary_cost: '0',
    min_processing_days: '1', max_processing_days: '3',
    destination_country_iso: '',
  });

  // Return policy creation form
  const [newReturn, setNewReturn] = useState({
    accepts_returns: true, accepts_exchanges: true, return_deadline: '30',
  });

  // Section creation form
  const [newSectionTitle, setNewSectionTitle] = useState('');

  const handleCreateShippingProfile = async () => {
    if (!newShipping.title.trim()) {
      toast.error('Profil adi zorunludur');
      return;
    }
    if (Number(newShipping.min_processing_days) > Number(newShipping.max_processing_days)) {
      toast.error('Min hazirlama suresi max\'tan buyuk olamaz');
      return;
    }
    setCreateLoading(true);
    try {
      const payload: Record<string, any> = {
        title: newShipping.title.trim(),
        origin_country_iso: newShipping.origin_country_iso,
        primary_cost: parseFloat(newShipping.primary_cost) || 0,
        secondary_cost: parseFloat(newShipping.secondary_cost) || 0,
        min_processing_days: parseInt(newShipping.min_processing_days) || 1,
        max_processing_days: parseInt(newShipping.max_processing_days) || 3,
      };
      if (newShipping.destination_country_iso) {
        payload.destination_country_iso = newShipping.destination_country_iso;
      }

      const res = await fetch(`/api/clawd/etsy?shop_id=${shopId}&action=create_shipping_profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Kargo profili olusturulamadi');
      }
      toast.success('Kargo profili olusturuldu');
      setCreateShippingOpen(false);
      setNewShipping({ title: '', origin_country_iso: 'TR', primary_cost: '0', secondary_cost: '0', min_processing_days: '1', max_processing_days: '3', destination_country_iso: '' });
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Hata olustu');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCreateReturnPolicy = async () => {
    setCreateLoading(true);
    try {
      const res = await fetch(`/api/clawd/etsy?shop_id=${shopId}&action=create_return_policy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accepts_returns: newReturn.accepts_returns,
          accepts_exchanges: newReturn.accepts_exchanges,
          return_deadline: newReturn.return_deadline ? parseInt(newReturn.return_deadline) : undefined,
        }),
      });
      if (!res.ok) throw new Error('Iade politikasi olusturulamadi');
      toast.success('Iade politikasi olusturuldu');
      setCreateReturnOpen(false);
      setNewReturn({ accepts_returns: true, accepts_exchanges: true, return_deadline: '30' });
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Hata olustu');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCreateSection = async () => {
    setCreateLoading(true);
    try {
      const res = await fetch(`/api/clawd/etsy?shop_id=${shopId}&action=create_shop_section`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newSectionTitle }),
      });
      if (!res.ok) throw new Error('Bolum olusturulamadi');
      toast.success('Magaza bolumu olusturuldu');
      setCreateSectionOpen(false);
      setNewSectionTitle('');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Hata olustu');
    } finally {
      setCreateLoading(false);
    }
  };

  // --------------------------------------------------
  // Fetch listing details
  // --------------------------------------------------
  const fetchListing = useCallback(async () => {
    if (!listingId || !shopId) return;

    setLoading(true);
    setFetchError(null);

    try {
      const res = await fetch(
        `/api/clawd/etsy?action=listing&listing_id=${listingId}&shop_id=${shopId}`,
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data: ListingData = await res.json();
      setListing(data);

      const initial = buildInitialFields(data);
      setFields(initial);
      originalFieldsRef.current = { ...initial, tags: [...initial.tags], materials: [...initial.materials] };
    } catch (err: any) {
      setFetchError(err.message || 'Liste detaylari yuklenemedi');
      toast.error('Liste detaylari yuklenemedi');
    } finally {
      setLoading(false);
    }
  }, [listingId, shopId]);

  // --------------------------------------------------
  // Fetch videos
  // --------------------------------------------------
  const fetchVideos = useCallback(async () => {
    if (!listingId || !shopId) return;

    setVideosLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=get_listing_videos&listing_id=${listingId}&shop_id=${shopId}`,
      );
      if (res.ok) {
        const data = await res.json();
        setVideos(data.videos || data.results || []);
      }
    } catch {
      // Non-critical, silently ignore
    } finally {
      setVideosLoading(false);
    }
  }, [listingId, shopId]);

  // --------------------------------------------------
  // AI helper
  // --------------------------------------------------
  const callAI = useCallback(async (action: string): Promise<any> => {
    if (!fields) return null;

    setAiLoading((prev) => ({ ...prev, [action]: true }));
    try {
      const payload: Record<string, any> = {
        action,
        title: fields.title,
        description: fields.description,
        tags: fields.tags,
        tags_current: fields.tags,
        materials: fields.materials,
        price: fields.price,
      };
      if (marketResearchData) {
        payload.market_context = {
          query: marketResearchData.query,
          topTags: marketResearchData.topTags.slice(0, 20),
          topKeywords: marketResearchData.topKeywords.slice(0, 15),
          priceStats: marketResearchData.priceStats,
        };
      }

      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `AI istegi basarisiz (HTTP ${res.status})`);
      }

      return await res.json();
    } catch (err: any) {
      toast.error(err.message || 'AI istegi basarisiz');
      return null;
    } finally {
      setAiLoading((prev) => ({ ...prev, [action]: false }));
    }
  }, [fields, marketResearchData]);

  const handleAIOptimizeTitle = useCallback(async () => {
    const result = await callAI('optimize_title');
    const newTitle = result?.optimized_title || result?.title;
    if (newTitle) {
      updateField('title', newTitle);
      if (result.explanation) {
        toast.success(result.explanation);
      } else {
        toast.success('Baslik optimize edildi');
      }
    }
  }, [callAI]);

  const handleAIGenerateDescription = useCallback(async () => {
    const result = await callAI('generate_description');
    if (result?.description) {
      updateField('description', result.description);
      toast.success('Aciklama olusturuldu');
    }
  }, [callAI]);

  const handleAISuggestTags = useCallback(async () => {
    const result = await callAI('suggest_tags');
    const tags = result?.suggestions || result?.tags;
    if (tags && Array.isArray(tags)) {
      setAiTagSuggestions(tags);
      toast.success(`${tags.length} etiket onerisi alindi`);
    }
  }, [callAI]);

  // --------------------------------------------------
  // Trigger fetch on open / listingId change
  // --------------------------------------------------
  useEffect(() => {
    if (open && listingId) {
      fetchListing().then(() => {
        // After fetching from Etsy, check for a localStorage draft
        const draft = loadDraft(listingId);
        if (draft && originalFieldsRef.current) {
          const draftChanges = getChangedFields(originalFieldsRef.current, draft);
          if (Object.keys(draftChanges).length > 0) {
            setFields(draft);
            setAutoSaveStatus('saved');
            toast('Kaydedilmemis taslak yuklendi', { icon: '\u270F\uFE0F' });
          }
        }
      });
      fetchVideos();
    }

    // Reset state when drawer closes — save draft if there are unsaved changes
    if (!open) {
      if (listingId && fieldsRef.current && originalFieldsRef.current) {
        const changed = getChangedFields(originalFieldsRef.current, fieldsRef.current);
        if (Object.keys(changed).length > 0) {
          saveDraft(listingId, fieldsRef.current);
        }
      }
      setListing(null);
      setFields(null);
      originalFieldsRef.current = null;
      setFetchError(null);
      setVideos([]);
      setExpanded('basics');
      setAiTagSuggestions([]);
      setAutoSaveStatus('idle');
      setLastSavedAt(null);
      setHistory([]);
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    }
  }, [open, listingId, fetchListing, fetchVideos]);

  // --------------------------------------------------
  // Track pending scheduled updates count
  // --------------------------------------------------
  useEffect(() => {
    if (open && listingId) {
      setPendingScheduleCount(getScheduledUpdatesForListing(listingId).length);
    }
  }, [open, listingId, scheduleDialogOpen]);

  // --------------------------------------------------
  // Field updaters
  // --------------------------------------------------
  const updateField = <K extends keyof EditableFields>(key: K, value: EditableFields[K]) => {
    // Push current state to history before making the change
    setFields((prev) => {
      if (!prev) return prev;

      // Save snapshot to history
      setHistory((h) => {
        const snapshot = { ...prev, tags: [...prev.tags], materials: [...prev.materials] };
        const next = [...h, snapshot];
        if (next.length > MAX_HISTORY) next.shift();
        return next;
      });

      return { ...prev, [key]: value };
    });

    // Mark as unsaved and trigger debounced auto-save
    setAutoSaveStatus('unsaved');
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      // Transition to 'saving' which triggers the auto-save effect
      setAutoSaveStatus('saving');
    }, 3000);
  };

  const handleAccordionChange = (panel: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  // --------------------------------------------------
  // Has changes?
  // --------------------------------------------------
  const hasChanges = (): boolean => {
    if (!fields || !originalFieldsRef.current) return false;
    return Object.keys(getChangedFields(originalFieldsRef.current, fields)).length > 0;
  };

  // --------------------------------------------------
  // Undo — revert to previous state from history
  // --------------------------------------------------
  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFields({ ...prev, tags: [...prev.tags], materials: [...prev.materials] });

    // Re-evaluate auto-save status after undo
    if (originalFieldsRef.current) {
      const changed = getChangedFields(originalFieldsRef.current, prev);
      if (Object.keys(changed).length === 0) {
        setAutoSaveStatus('idle');
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
      } else {
        setAutoSaveStatus('unsaved');
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
        autoSaveTimerRef.current = setTimeout(() => {
          setAutoSaveStatus('saving');
        }, 3000);
      }
    }
  };

  // --------------------------------------------------
  // Apply listing template
  // --------------------------------------------------
  const handleApplyTemplate = useCallback((template: ListingTemplate) => {
    if (!fields) return;

    const f = template.fields;
    if (f.title !== undefined) updateField('title', f.title);
    if (f.description !== undefined) updateField('description', f.description);
    if (f.tags !== undefined) updateField('tags', [...f.tags]);
    if (f.materials !== undefined) updateField('materials', [...f.materials]);
    if (f.who_made !== undefined) updateField('who_made', f.who_made);
    if (f.when_made !== undefined) updateField('when_made', f.when_made);
    if (f.is_supply !== undefined) updateField('is_supply', f.is_supply);
    if (f.shipping_profile_id !== undefined) updateField('shipping_profile_id', f.shipping_profile_id);
    if (f.return_policy_id !== undefined) updateField('return_policy_id', f.return_policy_id);

    toast.success(`"${template.name}" profili uygulandi`);
  }, [fields]);

  // --------------------------------------------------
  // Auto-save effect — saves draft to localStorage (NOT to Etsy)
  // Manual "Kaydet" button pushes to Etsy API.
  // --------------------------------------------------
  useEffect(() => {
    if (autoSaveStatus !== 'saving') return;
    if (!listingId || !fields || !originalFieldsRef.current) {
      setAutoSaveStatus('idle');
      return;
    }

    const changed = getChangedFields(originalFieldsRef.current, fields);
    if (Object.keys(changed).length === 0) {
      setAutoSaveStatus('idle');
      return;
    }

    // Save draft to localStorage — does NOT touch Etsy API
    saveDraft(listingId, fields);
    setLastSavedAt(new Date());
    setAutoSaveStatus('saved');
    // Note: originalFieldsRef is NOT updated here — it tracks Etsy state,
    // so hasChanges() stays true and the "Kaydet" button remains enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveStatus]);

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // --------------------------------------------------
  // Save (update listing)
  // --------------------------------------------------
  const handleSave = async () => {
    if (!listingId || !fields || !originalFieldsRef.current) return;

    const changed = getChangedFields(originalFieldsRef.current, fields);
    if (Object.keys(changed).length === 0) {
      toast('Degisiklik yok', { icon: '\u2139\uFE0F' });
      return;
    }

    setSaving(true);
    try {
      // Build the API payload
      const payload: Record<string, any> = {};

      if (changed.title !== undefined) payload.title = changed.title;
      if (changed.description !== undefined) payload.description = changed.description;
      if (changed.tags !== undefined) payload.tags = changed.tags;
      if (changed.materials !== undefined) payload.materials = changed.materials;
      if (changed.price !== undefined) payload.price = changed.price;
      if (changed.quantity !== undefined) payload.quantity = changed.quantity;
      if (changed.who_made !== undefined) payload.who_made = changed.who_made;
      if (changed.when_made !== undefined) payload.when_made = changed.when_made;
      if (changed.is_supply !== undefined) payload.is_supply = changed.is_supply;
      if (changed.shop_section_id !== undefined && changed.shop_section_id !== '') {
        payload.shop_section_id = changed.shop_section_id;
      }
      if (changed.shipping_profile_id !== undefined && changed.shipping_profile_id !== '') {
        payload.shipping_profile_id = changed.shipping_profile_id;
      }
      if (changed.return_policy_id !== undefined && changed.return_policy_id !== '') {
        payload.return_policy_id = changed.return_policy_id;
      }
      if (changed.processing_min !== undefined && changed.processing_min !== '') {
        payload.processing_min = Number(changed.processing_min);
      }
      if (changed.processing_max !== undefined && changed.processing_max !== '') {
        payload.processing_max = Number(changed.processing_max);
      }
      if (changed.item_weight !== undefined && changed.item_weight !== '') {
        payload.item_weight = Number(changed.item_weight);
      }
      if (changed.item_weight_unit !== undefined) payload.item_weight_unit = changed.item_weight_unit;
      if (changed.item_length !== undefined && changed.item_length !== '') {
        payload.item_length = Number(changed.item_length);
      }
      if (changed.item_width !== undefined && changed.item_width !== '') {
        payload.item_width = Number(changed.item_width);
      }
      if (changed.item_height !== undefined && changed.item_height !== '') {
        payload.item_height = Number(changed.item_height);
      }
      if (changed.item_dimensions_unit !== undefined) payload.item_dimensions_unit = changed.item_dimensions_unit;

      if (Object.keys(payload).length === 0) {
        toast('Degisiklik yok', { icon: '\u2139\uFE0F' });
        setSaving(false);
        return;
      }

      const res = await fetch(
        `/api/clawd/etsy?action=update_listing&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      toast.success('Liste guncellendi');

      // Clear the localStorage draft — changes are now on Etsy
      if (listingId) clearDraft(listingId);

      // Reset auto-save state and history
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      setAutoSaveStatus('saved');
      setLastSavedAt(new Date());
      setHistory([]);

      // Refresh listing data to reset dirty state
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Guncelleme basarisiz');
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------
  // Publish
  // --------------------------------------------------
  const handlePublish = async () => {
    if (!listingId) return;

    setPublishing(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=publish&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'POST',
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Yayinlama basarisiz');
      }

      toast.success('Liste yayinlandi');
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Yayinlama basarisiz');
    } finally {
      setPublishing(false);
    }
  };

  // --------------------------------------------------
  // Deactivate
  // --------------------------------------------------
  const handleDeactivate = async () => {
    if (!listingId) return;

    setDeactivating(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=update_listing&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ state: 'inactive' }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Deaktif etme basarisiz');
      }

      toast.success('Liste deaktif edildi');
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Deaktif etme basarisiz');
    } finally {
      setDeactivating(false);
    }
  };

  // --------------------------------------------------
  // Copy
  // --------------------------------------------------
  const handleCopy = async () => {
    if (!listingId) return;

    setCopying(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=copy_listing&shop_id=${shopId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ source_listing_id: listingId }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Kopyalama basarisiz');
      }

      toast.success('Liste kopyalandi (taslak olarak)');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Kopyalama basarisiz');
    } finally {
      setCopying(false);
    }
  };

  // --------------------------------------------------
  // Delete
  // --------------------------------------------------
  const handleDelete = async () => {
    if (!listingId) return;

    setDeleting(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=delete_listing&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'DELETE',
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Silme basarisiz');
      }

      toast.success('Liste silindi');
      setDeleteDialogOpen(false);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Silme basarisiz');
    } finally {
      setDeleting(false);
    }
  };

  // --------------------------------------------------
  // Render helpers
  // --------------------------------------------------
  const renderHeader = () => {
    const truncatedTitle = listing?.title
      ? listing.title.length > 45
        ? listing.title.substring(0, 45) + '...'
        : listing.title
      : 'Liste Duzenle';

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} noWrap title={listing?.title}>
            {truncatedTitle}
          </Typography>
          {listing && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <Chip
                label={
                  listing.state === 'active'
                    ? 'Aktif'
                    : listing.state === 'draft'
                    ? 'Taslak'
                    : listing.state === 'inactive'
                    ? 'Deaktif'
                    : listing.state === 'expired'
                    ? 'Suresi Doldu'
                    : listing.state
                }
                size="small"
                color={
                  listing.state === 'active'
                    ? 'success'
                    : listing.state === 'draft'
                    ? 'warning'
                    : 'default'
                }
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
              <Typography variant="caption" color="text.secondary">
                {listing.views} goruntulenme &middot; {listing.num_favorers} favori
              </Typography>
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
          {fields && (
            <>
              <Tooltip title="Profil Kaydet">
                <IconButton size="small" onClick={() => setSaveTemplateOpen(true)}>
                  <BookmarkBorderIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Profil Uygula">
                <IconButton size="small" onClick={() => setLoadTemplateOpen(true)}>
                  <FolderOpenIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
          {listing?.url && (
            <Tooltip title="Etsy'de Goruntule">
              <IconButton
                size="small"
                component="a"
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Kopyala">
            <IconButton size="small" onClick={handleCopy} disabled={copying}>
              {copying ? <CircularProgress size={18} /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </Box>
    );
  };

  const renderLoadingState = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 4 }}>
      <CircularProgress />
    </Box>
  );

  const renderErrorState = () => (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="error" gutterBottom>
        {fetchError}
      </Typography>
      <Button variant="outlined" onClick={fetchListing}>
        Tekrar Dene
      </Button>
    </Box>
  );

  // --------------------------------------------------
  // Main render
  // --------------------------------------------------
  if (!fields && !loading && !fetchError) {
    // Drawer is open but no data yet — nothing to render
  }

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: DRAWER_WIDTH },
            maxWidth: '100vw',
          },
        }}
      >
        {/* Header — always shown */}
        {renderHeader()}

        {/* Auto-save status & Undo bar */}
        {fields && listing && !loading && !fetchError && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              py: 0.75,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: 'grey.50',
              minHeight: 36,
            }}
          >
            {/* Auto-save status */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor:
                    autoSaveStatus === 'unsaved'
                      ? 'warning.main'
                      : autoSaveStatus === 'saving'
                      ? 'info.main'
                      : autoSaveStatus === 'saved'
                      ? 'success.main'
                      : autoSaveStatus === 'error'
                      ? 'error.main'
                      : 'grey.400',
                  flexShrink: 0,
                }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                {autoSaveStatus === 'unsaved' && 'Degisiklik var'}
                {autoSaveStatus === 'saving' && 'Taslak kaydediliyor...'}
                {autoSaveStatus === 'saved' &&
                  `Taslak kaydedildi${lastSavedAt ? ` ${lastSavedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
                {autoSaveStatus === 'error' && 'Taslak kayit hatasi'}
                {autoSaveStatus === 'idle' && ''}
              </Typography>
            </Box>

            {/* Undo button */}
            <Tooltip title={history.length > 0 ? `Geri Al (${history.length} adim)` : 'Gecmis yok'}>
              <span>
                <Button
                  size="small"
                  startIcon={<UndoIcon sx={{ fontSize: 16 }} />}
                  onClick={handleUndo}
                  disabled={history.length === 0}
                  sx={{
                    textTransform: 'none',
                    fontSize: '0.7rem',
                    minWidth: 0,
                    py: 0.25,
                    px: 1,
                  }}
                >
                  Geri Al{history.length > 0 ? ` (${history.length})` : ''}
                </Button>
              </span>
            </Tooltip>
          </Box>
        )}

        {/* Content */}
        {loading ? (
          renderLoadingState()
        ) : fetchError ? (
          renderErrorState()
        ) : fields && listing ? (
          <Box sx={{ overflow: 'auto', flex: 1, pb: 10 }}>
            {/* ============================================================ */}
            {/* 1. Temel Bilgiler */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'basics'}
              onChange={handleAccordionChange('basics')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Temel Bilgiler</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Title */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>Baslik</Typography>
                      <Button
                        size="small"
                        startIcon={aiLoading.optimize_title ? <CircularProgress size={14} /> : <AutoFixHighIcon sx={{ fontSize: 16 }} />}
                        onClick={handleAIOptimizeTitle}
                        disabled={!!aiLoading.optimize_title || !fields.title}
                        sx={{ textTransform: 'none', fontSize: '0.75rem', minWidth: 0, py: 0.25, px: 1 }}
                      >
                        AI ile Optimize Et
                      </Button>
                    </Box>
                    <TextField
                      value={fields.title}
                      onChange={(e) => {
                        if (e.target.value.length <= 140) {
                          updateField('title', e.target.value);
                        }
                      }}
                      fullWidth
                      size="small"
                      helperText={`${fields.title.length}/140 karakter`}
                      inputProps={{ maxLength: 140 }}
                    />
                  </Box>

                  {/* Description */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>Aciklama</Typography>
                      <Button
                        size="small"
                        startIcon={aiLoading.generate_description ? <CircularProgress size={14} /> : <AutoFixHighIcon sx={{ fontSize: 16 }} />}
                        onClick={handleAIGenerateDescription}
                        disabled={!!aiLoading.generate_description || !fields.title}
                        sx={{ textTransform: 'none', fontSize: '0.75rem', minWidth: 0, py: 0.25, px: 1 }}
                      >
                        AI ile Olustur
                      </Button>
                    </Box>
                    <TextField
                      value={fields.description}
                      onChange={(e) => updateField('description', e.target.value)}
                      fullWidth
                      multiline
                      rows={6}
                      size="small"
                      helperText={`${fields.description.length} karakter`}
                    />
                  </Box>

                  {/* Tags */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        Etiketler
                      </Typography>
                      <TagProfileMenu
                        currentTags={fields.tags}
                        onApplyTags={(tags) => updateField('tags', tags)}
                      />
                    </Box>
                    <Autocomplete
                      multiple
                      freeSolo
                      options={[]}
                      value={fields.tags}
                      onChange={(_, newValue) => {
                        if (newValue.length <= 13) {
                          updateField('tags', newValue as string[]);
                        }
                      }}
                      renderTags={(value, getTagProps) =>
                        value.map((tag, index) => (
                          <Chip
                            {...getTagProps({ index })}
                            key={tag}
                            label={tag}
                            size="small"
                            sx={{ maxWidth: 180 }}
                          />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          size="small"
                          placeholder={fields.tags.length < 13 ? 'Etiket ekle...' : ''}
                          helperText={`${fields.tags.length}/13 etiket`}
                        />
                      )}
                    />
                  </Box>

                  {/* Materials */}
                  <Autocomplete
                    multiple
                    freeSolo
                    options={[]}
                    value={fields.materials}
                    onChange={(_, newValue) => {
                      if (newValue.length <= 13) {
                        updateField('materials', newValue as string[]);
                      }
                    }}
                    renderTags={(value, getTagProps) =>
                      value.map((mat, index) => (
                        <Chip
                          {...getTagProps({ index })}
                          key={mat}
                          label={mat}
                          size="small"
                          sx={{ maxWidth: 180 }}
                        />
                      ))
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Malzemeler"
                        size="small"
                        placeholder={fields.materials.length < 13 ? 'Malzeme ekle...' : ''}
                        helperText={`${fields.materials.length}/13 malzeme`}
                      />
                    )}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 2. SEO Analizi */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'seo'}
              onChange={handleAccordionChange('seo')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>SEO Analizi</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <SEOIndicator
                  tags={fields.tags}
                  title={fields.title}
                  description={fields.description}
                  compact={false}
                />

                {/* AI Tag Suggestions */}
                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={aiLoading.suggest_tags ? <CircularProgress size={14} /> : <AutoFixHighIcon sx={{ fontSize: 16 }} />}
                      onClick={handleAISuggestTags}
                      disabled={!!aiLoading.suggest_tags || !fields.title}
                      sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                    >
                      AI Etiket Oner
                    </Button>
                  </Box>

                  {aiTagSuggestions.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          Onerilen etiketler:
                        </Typography>
                        <Button
                          size="small"
                          onClick={() => {
                            const newTags = aiTagSuggestions.filter(
                              (t) => !fields.tags.includes(t),
                            );
                            const merged = [...fields.tags, ...newTags].slice(0, 13);
                            updateField('tags', merged);
                            setAiTagSuggestions([]);
                            toast.success(`${merged.length - fields.tags.length} etiket eklendi`);
                          }}
                          disabled={aiTagSuggestions.every((t) => fields.tags.includes(t))}
                          sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0, minWidth: 0 }}
                        >
                          Tumunu Ekle
                        </Button>
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {aiTagSuggestions.map((tag) => {
                          const alreadyExists = fields.tags.includes(tag);
                          const isFull = fields.tags.length >= 13;
                          return (
                            <Chip
                              key={tag}
                              label={tag}
                              size="small"
                              variant={alreadyExists ? 'filled' : 'outlined'}
                              color={alreadyExists ? 'default' : 'primary'}
                              disabled={alreadyExists}
                              onClick={
                                alreadyExists || isFull
                                  ? undefined
                                  : () => {
                                      updateField('tags', [...fields.tags, tag]);
                                    }
                              }
                              sx={{
                                cursor: alreadyExists || isFull ? 'default' : 'pointer',
                                opacity: alreadyExists ? 0.5 : 1,
                                maxWidth: 180,
                              }}
                            />
                          );
                        })}
                      </Box>
                    </Box>
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 3. Fiyat ve Stok */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'pricing'}
              onChange={handleAccordionChange('pricing')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Fiyat ve Stok</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField
                    label="Fiyat"
                    value={fields.price}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Allow digits and one decimal point
                      if (/^\d*\.?\d{0,2}$/.test(val) || val === '') {
                        updateField('price', val);
                      }
                    }}
                    size="small"
                    sx={{ flex: 1 }}
                    InputProps={{
                      endAdornment: (
                        <Typography variant="caption" color="text.secondary">
                          {listing.price?.currency_code || 'USD'}
                        </Typography>
                      ),
                    }}
                  />
                  <TextField
                    label="Stok"
                    type="number"
                    value={fields.quantity}
                    onChange={(e) => updateField('quantity', Math.max(0, parseInt(e.target.value) || 0))}
                    size="small"
                    sx={{ width: 120 }}
                    inputProps={{ min: 0 }}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 4. Gorseller */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'images'}
              onChange={handleAccordionChange('images')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={600}>Gorseller</Typography>
                  <Chip label={listing.images.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <ImageManager
                  listingId={String(listing.listing_id)}
                  shopId={shopId}

                  images={listing.images}
                  onImagesChanged={fetchListing}
                />
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 5. Video */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'video'}
              onChange={handleAccordionChange('video')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={600}>Video</Typography>
                  {videos.length > 0 && (
                    <Chip label={videos.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                {videosLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : (
                  <VideoUploader
                    listingId={String(listing.listing_id)}
                    shopId={shopId}
  
                    videos={videos}
                    onVideoChanged={fetchVideos}
                  />
                )}
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 6. Kisiselleistirme */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'personalization'}
              onChange={handleAccordionChange('personalization')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={600}>Kisilestirme</Typography>
                  {listing.is_personalizable && (
                    <Chip label="Aktif" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <PersonalizationEditor
                  listingId={String(listing.listing_id)}
                  shopId={shopId}

                  questions={listing.personalization_questions}
                  legacy={{
                    is_personalizable: listing.is_personalizable || false,
                    personalization_is_required: listing.personalization_is_required || false,
                    personalization_instructions: listing.personalization_instructions || '',
                    personalization_char_count_max: listing.personalization_char_count_max || 0,
                  }}
                  onSaved={fetchListing}
                />
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 7. Varyasyonlar ve Envanter */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'variations'}
              onChange={handleAccordionChange('variations')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Varyasyonlar ve Envanter</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <VariationEditor
                  listingId={String(listing.listing_id)}
                  shopId={shopId}

                  onSaved={fetchListing}
                />
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 8. Liste Detaylari */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'details'}
              onChange={handleAccordionChange('details')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Liste Detaylari</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Who made */}
                  <FormControl size="small" fullWidth>
                    <InputLabel>Kim yapti</InputLabel>
                    <Select
                      value={fields.who_made}
                      label="Kim yapti"
                      onChange={(e: SelectChangeEvent) => updateField('who_made', e.target.value)}
                    >
                      {WHO_MADE_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* When made */}
                  <FormControl size="small" fullWidth>
                    <InputLabel>Ne zaman yapildi</InputLabel>
                    <Select
                      value={fields.when_made}
                      label="Ne zaman yapildi"
                      onChange={(e: SelectChangeEvent) => updateField('when_made', e.target.value)}
                    >
                      {WHEN_MADE_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Is supply */}
                  <FormControlLabel
                    control={
                      <Switch
                        checked={fields.is_supply}
                        onChange={(e) => updateField('is_supply', e.target.checked)}
                      />
                    }
                    label="Bu bir malzeme veya araci mi?"
                  />

                  <Divider sx={{ my: 0.5 }} />

                  {/* Shop section */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <FormControl size="small" fullWidth>
                      <InputLabel>Magaza bolumu</InputLabel>
                      <Select
                        value={String(fields.shop_section_id)}
                        label="Magaza bolumu"
                        onChange={(e: SelectChangeEvent) =>
                          updateField('shop_section_id', e.target.value ? Number(e.target.value) : '')
                        }
                      >
                        <MenuItem value="">
                          <em>Secilmedi</em>
                        </MenuItem>
                        {shopSections.map((sec) => (
                          <MenuItem key={sec.shop_section_id} value={String(sec.shop_section_id)}>
                            {sec.title}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Tooltip title="Yeni bolum ekle">
                      <IconButton size="small" onClick={() => setCreateSectionOpen(true)} sx={{ mt: 0.5 }}>
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>

                  {/* Shipping profile */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <FormControl size="small" fullWidth>
                      <InputLabel>Kargo profili</InputLabel>
                      <Select
                        value={String(fields.shipping_profile_id)}
                        label="Kargo profili"
                        onChange={(e: SelectChangeEvent) =>
                          updateField('shipping_profile_id', e.target.value ? Number(e.target.value) : '')
                        }
                      >
                        <MenuItem value="">
                          <em>Secilmedi</em>
                        </MenuItem>
                        {shippingProfiles.map((sp) => (
                          <MenuItem key={sp.shipping_profile_id} value={String(sp.shipping_profile_id)}>
                            {sp.title}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Tooltip title="Yeni kargo profili ekle">
                      <IconButton size="small" onClick={() => setCreateShippingOpen(true)} sx={{ mt: 0.5 }}>
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>

                  {/* Return policy */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <FormControl size="small" fullWidth>
                      <InputLabel>Iade politikasi</InputLabel>
                      <Select
                        value={String(fields.return_policy_id)}
                        label="Iade politikasi"
                        onChange={(e: SelectChangeEvent) =>
                          updateField('return_policy_id', e.target.value ? Number(e.target.value) : '')
                        }
                      >
                        <MenuItem value="">
                          <em>Secilmedi</em>
                        </MenuItem>
                        {returnPolicies.map((rp) => {
                          const label = rp.description
                            ? rp.description
                            : [
                                rp.accepts_returns ? 'Iade Var' : 'Iade Yok',
                                rp.accepts_exchanges ? 'Degisim Var' : 'Degisim Yok',
                              ].join(', ');
                          return (
                            <MenuItem key={rp.return_policy_id} value={String(rp.return_policy_id)}>
                              {label}
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                    <Tooltip title="Yeni iade politikasi ekle">
                      <IconButton size="small" onClick={() => setCreateReturnOpen(true)} sx={{ mt: 0.5 }}>
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>

                  <Divider sx={{ my: 0.5 }} />

                  {/* Processing time */}
                  <Typography variant="body2" fontWeight={500}>
                    Hazirlama suresi (gun)
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                      label="Min"
                      type="number"
                      value={fields.processing_min}
                      onChange={(e) =>
                        updateField('processing_min', e.target.value ? parseInt(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 1 }}
                    />
                    <TextField
                      label="Max"
                      type="number"
                      value={fields.processing_max}
                      onChange={(e) =>
                        updateField('processing_max', e.target.value ? parseInt(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 1 }}
                    />
                  </Box>

                  <Divider sx={{ my: 0.5 }} />

                  {/* Weight */}
                  <Typography variant="body2" fontWeight={500}>
                    Agirlik
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                      label="Agirlik"
                      type="number"
                      value={fields.item_weight}
                      onChange={(e) =>
                        updateField('item_weight', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <FormControl size="small" sx={{ minWidth: 80 }}>
                      <InputLabel>Birim</InputLabel>
                      <Select
                        value={fields.item_weight_unit}
                        label="Birim"
                        onChange={(e: SelectChangeEvent) => updateField('item_weight_unit', e.target.value)}
                      >
                        {WEIGHT_UNITS.map((u) => (
                          <MenuItem key={u.value} value={u.value}>
                            {u.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>

                  {/* Dimensions */}
                  <Typography variant="body2" fontWeight={500}>
                    Boyutlar
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <TextField
                      label="Uzunluk"
                      type="number"
                      value={fields.item_length}
                      onChange={(e) =>
                        updateField('item_length', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1, minWidth: 80 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <TextField
                      label="Genislik"
                      type="number"
                      value={fields.item_width}
                      onChange={(e) =>
                        updateField('item_width', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1, minWidth: 80 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <TextField
                      label="Yukseklik"
                      type="number"
                      value={fields.item_height}
                      onChange={(e) =>
                        updateField('item_height', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1, minWidth: 80 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <FormControl size="small" sx={{ minWidth: 70 }}>
                      <InputLabel>Birim</InputLabel>
                      <Select
                        value={fields.item_dimensions_unit}
                        label="Birim"
                        onChange={(e: SelectChangeEvent) =>
                          updateField('item_dimensions_unit', e.target.value)
                        }
                      >
                        {DIMENSION_UNITS.map((u) => (
                          <MenuItem key={u.value} value={u.value}>
                            {u.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 9. Islemler */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'actions'}
              onChange={handleAccordionChange('actions')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Islemler</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {/* Publish — only for draft/inactive */}
                  {(listing.state === 'draft' || listing.state === 'inactive') && (
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={publishing ? <CircularProgress size={18} color="inherit" /> : <PublishIcon />}
                      onClick={handlePublish}
                      disabled={publishing}
                      fullWidth
                    >
                      {publishing ? 'Yayinlaniyor...' : 'Yayinla'}
                    </Button>
                  )}

                  {/* Deactivate — only for active */}
                  {listing.state === 'active' && (
                    <Button
                      variant="outlined"
                      color="warning"
                      startIcon={
                        deactivating ? <CircularProgress size={18} color="inherit" /> : <BlockIcon />
                      }
                      onClick={handleDeactivate}
                      disabled={deactivating}
                      fullWidth
                    >
                      {deactivating ? 'Deaktif ediliyor...' : 'Deaktif Et'}
                    </Button>
                  )}

                  {/* Copy */}
                  <Button
                    variant="outlined"
                    startIcon={copying ? <CircularProgress size={18} /> : <ContentCopyIcon />}
                    onClick={handleCopy}
                    disabled={copying}
                    fullWidth
                  >
                    {copying ? 'Kopyalaniyor...' : 'Kopyala'}
                  </Button>

                  {/* Delete */}
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={() => setDeleteDialogOpen(true)}
                    fullWidth
                  >
                    Sil
                  </Button>
                </Box>
              </AccordionDetails>
            </Accordion>
          </Box>
        ) : null}

        {/* ================================================================ */}
        {/* Footer — Save button */}
        {/* ================================================================ */}
        {fields && listing && !loading && !fetchError && (
          <Box
            sx={{
              position: 'sticky',
              bottom: 0,
              p: 2,
              borderTop: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              zIndex: 10,
            }}
          >
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                size="large"
                sx={{ flex: 1 }}
                startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
                onClick={handleSave}
                disabled={saving || !hasChanges()}
              >
                {saving ? 'Kaydediliyor...' : listing?.state === 'active' ? 'Degisiklikleri Kaydet' : 'Draft Olarak Kaydet'}
              </Button>
              <Button
                variant="outlined"
                size="large"
                startIcon={<ScheduleIcon />}
                onClick={() => setScheduleDialogOpen(true)}
                disabled={saving}
                sx={{ position: 'relative', minWidth: 'auto', px: 2 }}
              >
                Zamanla
                {pendingScheduleCount > 0 && (
                  <Chip
                    label={pendingScheduleCount}
                    size="small"
                    color="warning"
                    sx={{
                      position: 'absolute',
                      top: -8,
                      right: -8,
                      height: 20,
                      minWidth: 20,
                      fontSize: '0.7rem',
                    }}
                  />
                )}
              </Button>
            </Box>
            {pendingScheduleCount > 0 && (
              <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
                {pendingScheduleCount} bekleyen guncelleme
              </Typography>
            )}
          </Box>
        )}
      </Drawer>

      {/* ================================================================ */}
      {/* Delete Confirmation Dialog */}
      {/* ================================================================ */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Listeyi Sil</DialogTitle>
        <DialogContent>
          <Typography>
            Bu listeyi kalici olarak silmek istediginizden emin misiniz? Bu islem geri alinamaz.
          </Typography>
          {listing?.title && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              &ldquo;{listing.title}&rdquo;
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Iptal
          </Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={18} color="inherit" /> : <DeleteIcon />}
          >
            {deleting ? 'Siliniyor...' : 'Sil'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================ */}
      {/* Scheduled Update Dialog */}
      {/* ================================================================ */}
      {listing && fields && originalFieldsRef.current && (
        <ScheduledUpdateDialog
          open={scheduleDialogOpen}
          onClose={() => setScheduleDialogOpen(false)}
          listingId={String(listing.listing_id)}
          shopId={shopId}
          listingTitle={listing.title}
          changes={(() => {
            const changed = getChangedFields(originalFieldsRef.current!, fields);
            const sc: ScheduledChanges = {};
            if (changed.title !== undefined) sc.title = changed.title;
            if (changed.description !== undefined) sc.description = changed.description;
            if (changed.tags !== undefined) sc.tags = changed.tags;
            if (changed.price !== undefined) sc.price = changed.price;
            if (changed.quantity !== undefined) sc.quantity = changed.quantity;
            return sc;
          })()}
          onScheduled={() => {
            setPendingScheduleCount(getScheduledUpdatesForListing(String(listing.listing_id)).length);
          }}
        />
      )}

      {/* ================================================================ */}
      {/* Listing Template Dialogs */}
      {/* ================================================================ */}
      {fields && (
        <>
          <SaveTemplateDialog
            open={saveTemplateOpen}
            onClose={() => setSaveTemplateOpen(false)}
            currentFields={{
              title: fields.title,
              description: fields.description,
              tags: fields.tags,
              materials: fields.materials,
              who_made: fields.who_made,
              when_made: fields.when_made,
              is_supply: fields.is_supply,
              shipping_profile_id: fields.shipping_profile_id,
              return_policy_id: fields.return_policy_id,
            }}
          />
          <LoadTemplateDialog
            open={loadTemplateOpen}
            onClose={() => setLoadTemplateOpen(false)}
            onApply={handleApplyTemplate}
          />
        </>
      )}

      {/* Create Shipping Profile Dialog */}
      <Dialog open={createShippingOpen} onClose={() => setCreateShippingOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Yeni Kargo Profili Olustur</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '12px !important' }}>
          <TextField
            label="Profil Adi"
            placeholder="ornek: Turkiye'den ABD'ye Standart Kargo"
            size="small"
            fullWidth
            required
            value={newShipping.title}
            onChange={(e) => setNewShipping(s => ({ ...s, title: e.target.value }))}
            helperText="Bu isim listing duzenlerken kargo profili secerken gorunecek"
          />

          <Divider />

          {/* Origin & Destination */}
          <Typography variant="subtitle2" color="text.secondary">Gonderim Rotasi</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl fullWidth size="small" required>
              <InputLabel>Gonderim Ulkesi</InputLabel>
              <Select
                value={newShipping.origin_country_iso}
                label="Gonderim Ulkesi"
                onChange={(e) => setNewShipping(s => ({ ...s, origin_country_iso: e.target.value }))}
              >
                <MenuItem value="TR">Turkiye</MenuItem>
                <MenuItem value="US">ABD</MenuItem>
                <MenuItem value="GB">Ingiltere</MenuItem>
                <MenuItem value="DE">Almanya</MenuItem>
                <MenuItem value="FR">Fransa</MenuItem>
                <MenuItem value="CA">Kanada</MenuItem>
                <MenuItem value="AU">Avustralya</MenuItem>
                <MenuItem value="NL">Hollanda</MenuItem>
                <MenuItem value="IT">Italya</MenuItem>
                <MenuItem value="ES">Ispanya</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Hedef Ulke</InputLabel>
              <Select
                value={newShipping.destination_country_iso}
                label="Hedef Ulke"
                onChange={(e) => setNewShipping(s => ({ ...s, destination_country_iso: e.target.value }))}
              >
                <MenuItem value=""><em>Tum Dunya (varsayilan)</em></MenuItem>
                <MenuItem value="US">ABD</MenuItem>
                <MenuItem value="GB">Ingiltere</MenuItem>
                <MenuItem value="DE">Almanya</MenuItem>
                <MenuItem value="FR">Fransa</MenuItem>
                <MenuItem value="CA">Kanada</MenuItem>
                <MenuItem value="AU">Avustralya</MenuItem>
                <MenuItem value="TR">Turkiye</MenuItem>
                <MenuItem value="NL">Hollanda</MenuItem>
                <MenuItem value="IT">Italya</MenuItem>
                <MenuItem value="ES">Ispanya</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Divider />

          {/* Shipping costs */}
          <Typography variant="subtitle2" color="text.secondary">Kargo Ucretleri (USD)</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Ilk Urun Kargo Ucreti"
              type="number"
              size="small"
              fullWidth
              value={newShipping.primary_cost}
              onChange={(e) => setNewShipping(s => ({ ...s, primary_cost: e.target.value }))}
              inputProps={{ min: 0, step: '0.01' }}
              helperText="Siparisin ilk urunu icin"
            />
            <TextField
              label="Ek Urun Kargo Ucreti"
              type="number"
              size="small"
              fullWidth
              value={newShipping.secondary_cost}
              onChange={(e) => setNewShipping(s => ({ ...s, secondary_cost: e.target.value }))}
              inputProps={{ min: 0, step: '0.01' }}
              helperText="Her ek urun icin"
            />
          </Box>

          <Divider />

          {/* Processing time */}
          <Typography variant="subtitle2" color="text.secondary">Hazirlama Suresi (is gunu)</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Minimum"
              type="number"
              size="small"
              fullWidth
              value={newShipping.min_processing_days}
              onChange={(e) => setNewShipping(s => ({ ...s, min_processing_days: e.target.value }))}
              inputProps={{ min: 1, max: 45 }}
              helperText="Siparis sonrasi min hazirlama"
            />
            <TextField
              label="Maksimum"
              type="number"
              size="small"
              fullWidth
              value={newShipping.max_processing_days}
              onChange={(e) => setNewShipping(s => ({ ...s, max_processing_days: e.target.value }))}
              inputProps={{ min: 1, max: 45 }}
              helperText="Siparis sonrasi max hazirlama"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateShippingOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            onClick={handleCreateShippingProfile}
            disabled={createLoading || !newShipping.title.trim()}
          >
            {createLoading ? <CircularProgress size={20} /> : 'Kargo Profili Olustur'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Return Policy Dialog */}
      <Dialog open={createReturnOpen} onClose={() => setCreateReturnOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Yeni Iade Politikasi</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <FormControlLabel
            control={<Switch checked={newReturn.accepts_returns} onChange={(e) => setNewReturn(s => ({ ...s, accepts_returns: e.target.checked }))} />}
            label="Iade kabul ediliyor"
          />
          <FormControlLabel
            control={<Switch checked={newReturn.accepts_exchanges} onChange={(e) => setNewReturn(s => ({ ...s, accepts_exchanges: e.target.checked }))} />}
            label="Degisim kabul ediliyor"
          />
          {newReturn.accepts_returns && (
            <TextField label="Iade suresi (gun)" type="number" size="small" fullWidth value={newReturn.return_deadline} onChange={(e) => setNewReturn(s => ({ ...s, return_deadline: e.target.value }))} inputProps={{ min: 1 }} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateReturnOpen(false)}>Iptal</Button>
          <Button variant="contained" onClick={handleCreateReturnPolicy} disabled={createLoading}>
            {createLoading ? <CircularProgress size={20} /> : 'Olustur'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Shop Section Dialog */}
      <Dialog open={createSectionOpen} onClose={() => setCreateSectionOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Yeni Magaza Bolumu</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField label="Bolum adi" size="small" fullWidth value={newSectionTitle} onChange={(e) => setNewSectionTitle(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateSectionOpen(false)}>Iptal</Button>
          <Button variant="contained" onClick={handleCreateSection} disabled={createLoading || !newSectionTitle}>
            {createLoading ? <CircularProgress size={20} /> : 'Olustur'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
