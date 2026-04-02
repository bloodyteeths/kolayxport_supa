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
  Alert,
  Collapse,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
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
import SearchIcon from '@mui/icons-material/Search';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import ImageIcon from '@mui/icons-material/Image';
import VideocamIcon from '@mui/icons-material/Videocam';
import BrushIcon from '@mui/icons-material/Brush';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TuneIcon from '@mui/icons-material/Tune';
import SettingsIcon from '@mui/icons-material/Settings';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { toast } from 'react-hot-toast';

import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
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
  onOpenListing?: (listingId: string) => void;
  marketResearchData?: MarketContext | null;
  refreshKey?: number;
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

const WHO_MADE_KEYS = ['i_did', 'collective', 'someone_else'] as const;
const WHO_MADE_I18N: Record<string, string> = { i_did: 'iDid', collective: 'collective', someone_else: 'someoneElse' };

const WHEN_MADE_KEYS = ['made_to_order', '2020_2025', '2010_2019', '2004_2009', 'before_2004', '2000_2003', '1990s', '1980s', '1970s', '1960s'] as const;
const WHEN_MADE_I18N: Record<string, string> = { made_to_order: 'madeToOrder', '2020_2025': '2020_2025', '2010_2019': '2010_2019', '2004_2009': '2004_2009', before_2004: 'before_2004', '2000_2003': '2000_2003', '1990s': '1990s', '1980s': '1980s', '1970s': '1970s', '1960s': '1960s' };

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
];

const DRAWER_WIDTH = 1100;

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
  onOpenListing,
  marketResearchData,
  refreshKey,
}: ListingEditorDrawerProps) {
  const t = useTranslations('etsy');
  const { config, formatDate, formatNumber } = useLocale();

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
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);

  // Template / profile state
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);

  // AI state
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiTagSuggestions, setAiTagSuggestions] = useState<string[]>([]);
  const [researchBannerOpen, setResearchBannerOpen] = useState(true);

  // Rank check state
  const [rankKeyword, setRankKeyword] = useState('');
  const [rankResult, setRankResult] = useState<{ rank: number | null; page: number | null; totalResults: number } | null>(null);
  const [rankLoading, setRankLoading] = useState(false);

  // Tracked keywords for this listing
  const [trackedKeywords, setTrackedKeywords] = useState<Array<{
    id: string; keyword: string; rank: number | null; page: number | null;
    totalResults: number; change: number | null; checkedAt: string | null;
    firstCheckedAt?: string | null; snapshotCount?: number;
  }>>([]);
  const [trackedLoading, setTrackedLoading] = useState(false);

  // Ranking analysis state
  const [rankAnalysis, setRankAnalysis] = useState<any>(null);
  const [rankAnalysisLoading, setRankAnalysisLoading] = useState<string | null>(null); // keyword being analyzed
  const [rankAnalysisOpen, setRankAnalysisOpen] = useState(false);

  // Tab state — replaces accordion expanded state
  const [activeTab, setActiveTab] = useState<string>('images');
  // Keep expanded for backwards compat — maps to activeTab
  const expanded = activeTab;
  const theme = useTheme();
  const isMobileEditor = useMediaQuery(theme.breakpoints.down('md'));

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
    title: '', origin_country_iso: config.defaultCountryOfOrigin || 'TR', primary_cost: '0', secondary_cost: '0',
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
      toast.error(t('editor.profileNameRequired'));
      return;
    }
    if (Number(newShipping.min_processing_days) > Number(newShipping.max_processing_days)) {
      toast.error(t('editor.minGreaterThanMax'));
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
        throw new Error(err.error || t('editor.shippingProfileFailed'));
      }
      toast.success(t('editor.shippingProfileCreated'));
      setCreateShippingOpen(false);
      setNewShipping({ title: '', origin_country_iso: config.defaultCountryOfOrigin || 'TR', primary_cost: '0', secondary_cost: '0', min_processing_days: '1', max_processing_days: '3', destination_country_iso: '' });
      onSaved();
    } catch (e: any) {
      toast.error(e.message || t('editor.errorOccurred'));
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
      if (!res.ok) throw new Error(t('editor.returnPolicyFailed'));
      toast.success(t('editor.returnPolicyCreated'));
      setCreateReturnOpen(false);
      setNewReturn({ accepts_returns: true, accepts_exchanges: true, return_deadline: '30' });
      onSaved();
    } catch (e: any) {
      toast.error(e.message || t('editor.errorOccurred'));
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
      if (!res.ok) throw new Error(t('editor.shopSectionFailed'));
      toast.success(t('editor.shopSectionCreated'));
      setCreateSectionOpen(false);
      setNewSectionTitle('');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || t('editor.errorOccurred'));
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
      setFetchError(err.message || t('editor.listingDetailsFailed'));
      toast.error(t('editor.listingDetailsFailed'));
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
  // AI helper — auto-fetches market research if missing
  // --------------------------------------------------
  const localResearchRef = useRef<{ query: string; topTags: any[]; topKeywords: any[]; priceStats: any } | null>(null);

  const fetchQuickResearch = useCallback(async (query: string) => {
    try {
      const params = new URLSearchParams({
        action: 'search_market', keywords: query.trim(),
        limit: '100', sort_on: 'score', sort_order: 'desc',
      });
      const res = await fetch(`/api/clawd/etsy?${params}`);
      if (!res.ok) return null;
      const data = await res.json();
      const tagFreq = data.tagFrequency || [];
      const keywords = data.titleKeywords || [];
      const items = data.items || [];
      const prices = items.map((i: any) => i.price?.amount && i.price?.divisor ? i.price.amount / i.price.divisor : 0).filter((p: number) => p > 0);
      const priceStats = prices.length > 0
        ? { min: Math.min(...prices).toFixed(2), max: Math.max(...prices).toFixed(2), avg: (prices.reduce((a: number, b: number) => a + b, 0) / prices.length).toFixed(2) }
        : null;
      const research = { query, topTags: tagFreq.slice(0, 20), topKeywords: keywords.slice(0, 15), priceStats };
      localResearchRef.current = research;
      return research;
    } catch {
      return null;
    }
  }, []);

  const callAI = useCallback(async (action: string, overrides?: Record<string, any>): Promise<any> => {
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
        category: listing?.taxonomy_id ? String(listing.taxonomy_id) : undefined,
        ...overrides,
      };

      // Use prop research data, local cache, or auto-fetch
      let research = marketResearchData
        ? { query: marketResearchData.query, topTags: marketResearchData.topTags.slice(0, 20), topKeywords: marketResearchData.topKeywords.slice(0, 15), priceStats: marketResearchData.priceStats }
        : localResearchRef.current;

      if (!research && fields.title.trim().length >= 10) {
        // Extract first meaningful phrase from title for research query
        const searchQuery = fields.title.split(',')[0].trim().substring(0, 60);
        research = await fetchQuickResearch(searchQuery);
      }

      if (research) {
        payload.market_context = research;
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
      toast.error(err.message || t('editor.aiRequestFailed'));
      return null;
    } finally {
      setAiLoading((prev) => ({ ...prev, [action]: false }));
    }
  }, [fields, marketResearchData, fetchQuickResearch]);

  const handleAIOptimizeTitle = useCallback(async () => {
    const result = await callAI('optimize_title');
    const newTitle = result?.optimized_title || result?.title;
    if (!newTitle) {
      toast.error(t('editor.aiTitleFailed'));
      return;
    }
    // Reject garbled single-character output
    if (typeof newTitle !== 'string' || newTitle.split(/[\s,]+/).filter(Boolean).every((w: string) => w.length <= 1)) {
      toast.error(t('editor.aiBrokenTitle'));
      return;
    }
    updateField('title', newTitle);
    toast.success(t('editor.titleOptimized'));
  }, [callAI]);

  const handleAIGenerateDescription = useCallback(async () => {
    const result = await callAI('generate_description');
    if (result?.description) {
      updateField('description', result.description);
      toast.success(t('editor.descriptionCreated'));
    }
  }, [callAI]);

  const handleAISuggestTags = useCallback(async () => {
    const result = await callAI('suggest_tags');
    const tags = result?.suggestions || result?.tags;
    if (tags && Array.isArray(tags)) {
      setAiTagSuggestions(tags);
      toast.success(t('editor.tagSuggestionsReceived', { count: tags.length }));
    }
  }, [callAI]);

  const handleRankCheck = useCallback(async () => {
    if (!rankKeyword.trim() || !listingId) return;
    setRankLoading(true);
    setRankResult(null);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=check_keyword_rank&keyword=${encodeURIComponent(rankKeyword.trim())}&listing_id=${listingId}&shop_id=${shopId}`
      );
      if (!res.ok) throw new Error(t('editor.rankCheckFailed'));
      const data = await res.json();
      setRankResult(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRankLoading(false);
    }
  }, [rankKeyword, listingId, shopId]);

  // Fetch tracked keywords for this listing (filter server-side)
  const fetchTrackedKeywords = useCallback(async () => {
    if (!listingId || !shopId) return;
    setTrackedLoading(true);
    try {
      const res = await fetch(`/api/clawd/etsy?action=get_tracked_keywords&shop_id=${shopId}&listing_id=${listingId}`);
      if (!res.ok) return;
      const data = await res.json();
      setTrackedKeywords(data.keywords || []);
    } catch {
      // silent
    } finally {
      setTrackedLoading(false);
    }
  }, [listingId, shopId]);

  // Auto-track listing tags as keywords when drawer opens
  const autoTrackRef = useRef<string>('');
  useEffect(() => {
    if (!open || !listingId || !shopId || !fields?.tags?.length) return;
    // Only auto-track once per listing open (avoid re-triggering on tag edits)
    const key = `${listingId}:${fields.tags.length}`;
    if (autoTrackRef.current === key) return;
    autoTrackRef.current = key;

    (async () => {
      try {
        await fetch(`/api/clawd/etsy?action=auto_track_listing_tags&shop_id=${shopId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            listing_id: listingId,
            listing_title: fields.title || '',
            tags: fields.tags,
          }),
        });
      } catch {
        // silent — auto-track is best-effort
      }
      fetchTrackedKeywords();
    })();
  }, [open, listingId, shopId, fields?.tags, fields?.title, fetchTrackedKeywords]);

  const handleAddToTracking = useCallback(async () => {
    if (!rankKeyword.trim() || !listingId) return;
    try {
      const res = await fetch(`/api/clawd/etsy?action=add_tracked_keyword&shop_id=${shopId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: rankKeyword.trim(),
          listing_id: listingId,
          listing_title: fields?.title || '',
        }),
      });
      if (!res.ok) throw new Error(t('editor.trackingFailed'));
      toast.success(t('editor.addedToTracking'));
      setRankKeyword('');
      setRankResult(null);
      fetchTrackedKeywords();
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [rankKeyword, listingId, shopId, fields?.title, fetchTrackedKeywords]);

  const handleAnalyzeRanking = useCallback(async (keyword: string) => {
    if (!listingId || !shopId) return;
    setRankAnalysisLoading(keyword);
    try {
      const res = await fetch(`/api/clawd/etsy?action=analyze_keyword_ranking&shop_id=${shopId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, listing_id: listingId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRankAnalysis(data);
      setRankAnalysisOpen(true);
    } catch (err: any) {
      toast.error(err.message || t('editor.analysisFailed'));
    } finally {
      setRankAnalysisLoading(null);
    }
  }, [listingId, shopId]);

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
            toast(t('editor.draftLoaded'), { icon: '\u270F\uFE0F' });
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
      setActiveTab('basics');
      setAiTagSuggestions([]);
      setAutoSaveStatus('idle');
      setLastSavedAt(null);
      setHistory([]);
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    }
  }, [open, listingId, fetchListing, fetchVideos, refreshKey]);

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
    setActiveTab(panel);
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
    if (f.processing_min !== undefined) updateField('processing_min', f.processing_min);
    if (f.processing_max !== undefined) updateField('processing_max', f.processing_max);
    if (f.item_weight !== undefined) updateField('item_weight', f.item_weight);
    if (f.item_weight_unit !== undefined) updateField('item_weight_unit', f.item_weight_unit);
    if (f.item_length !== undefined) updateField('item_length', f.item_length);
    if (f.item_width !== undefined) updateField('item_width', f.item_width);
    if (f.item_height !== undefined) updateField('item_height', f.item_height);
    if (f.item_dimensions_unit !== undefined) updateField('item_dimensions_unit', f.item_dimensions_unit);
    if (f.shop_section_id !== undefined) updateField('shop_section_id', f.shop_section_id);
    if (f.price !== undefined) updateField('price', f.price);
    if (f.quantity !== undefined) updateField('quantity', f.quantity);

    toast.success(t('editor.profileApplied', { name: template.name }));
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

    // Validate processing days
    if (fields.processing_min && fields.processing_max) {
      const min = Number(fields.processing_min);
      const max = Number(fields.processing_max);
      if (min > 0 && max > 0 && min > max) {
        toast.error(t('editor.prepTimeError'));
        return;
      }
    }

    const changed = getChangedFields(originalFieldsRef.current, fields);
    if (Object.keys(changed).length === 0) {
      toast(t('editor.noChanges'), { icon: '\u2139\uFE0F' });
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
        toast(t('editor.noChanges'), { icon: '\u2139\uFE0F' });
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

      toast.success(t('editor.listingUpdated'));

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
      toast.error(err.message || t('editor.updateFailed'));
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
        throw new Error(err.error || t('editor.publishFailed'));
      }

      toast.success(t('editor.publishSuccess'));
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || t('editor.publishFailed'));
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
        throw new Error(err.error || t('editor.deactivateFailed'));
      }

      toast.success(t('editor.deactivateSuccess'));
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || t('editor.deactivateFailed'));
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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t('editor.copyFailed'));
      }

      toast.success(t('editor.listingCopied'));
      onSaved(); // refresh parent listing list

      // Open the copied listing in the editor
      if (data.new_listing_id && onOpenListing) {
        onOpenListing(String(data.new_listing_id));
      }
    } catch (err: any) {
      toast.error(err.message || t('editor.copyFailed'));
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
        throw new Error(err.error || err.details || t('editor.deleteFailed'));
      }

      toast.success(t('editor.listingDeleted'));
      setDeleteDialogOpen(false);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || t('editor.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  // --------------------------------------------------
  // Render helpers
  // --------------------------------------------------
  // renderHeader removed — header is now inline in the main render

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
        {t('editor.retry')}
      </Button>
    </Box>
  );

  // --------------------------------------------------
  // Main render
  // --------------------------------------------------
  if (!fields && !loading && !fetchError) {
    // Drawer is open but no data yet — nothing to render
  }

  // Tab config for sidebar navigation
  const editorTabs = [
    { id: 'images', label: t('editor.tabImages'), icon: <ImageIcon fontSize="small" /> },
    { id: 'video', label: t('editor.tabVideo'), icon: <VideocamIcon fontSize="small" /> },
    { id: 'seo', label: t('editor.tabSeo'), icon: <SearchIcon fontSize="small" /> },
    { id: 'basics', label: t('editor.tabBasics'), icon: <TextFieldsIcon fontSize="small" /> },
    { id: 'details', label: t('editor.tabDetails'), icon: <TuneIcon fontSize="small" /> },
    { id: 'pricing', label: t('editor.tabPricing'), icon: <AttachMoneyIcon fontSize="small" /> },
    { id: 'variations', label: t('editor.tabVariations'), icon: <ViewModuleIcon fontSize="small" /> },
    { id: 'personalization', label: t('editor.tabPersonalization'), icon: <BrushIcon fontSize="small" /> },
    { id: 'actions', label: t('editor.tabActions'), icon: <SettingsIcon fontSize="small" /> },
  ];

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: '100vw',
          },
        }}
      >
        {/* Header — full-width with back button */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 8px)', sm: 1 },
            pb: 1,
            px: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          {/* Back button + Title */}
          <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, mr: 1 }}>
            <IconButton onClick={onClose} sx={{ mr: 1, minWidth: 44, minHeight: 44 }}>
              <ArrowBackIcon />
            </IconButton>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="h6" fontWeight={700} noWrap title={listing?.title} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {listing?.title || t('editor.editListing')}
              </Typography>
              {listing && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                  <Chip
                    label={
                      listing.state === 'active' ? t('editor.active')
                        : listing.state === 'draft' ? t('editor.draft')
                        : listing.state === 'inactive' ? t('editor.inactive')
                        : listing.state === 'expired' ? t('editor.expired')
                        : listing.state
                    }
                    size="small"
                    color={
                      listing.state === 'active' ? 'success'
                        : listing.state === 'draft' ? 'default'
                        : listing.state === 'inactive' ? 'error'
                        : 'warning'
                    }
                    sx={{ height: 28, fontSize: '0.85rem' }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {listing.views} {t('editor.views')} · {listing.num_favorers} {t('editor.favorites')}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>

          {/* Action buttons */}
          <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, alignItems: 'center' }}>
            {/* Auto-save indicator */}
            {fields && (
              <Box
                sx={{
                  width: 10, height: 10, borderRadius: '50%', mr: 0.5,
                  bgcolor:
                    autoSaveStatus === 'unsaved' ? 'warning.main'
                    : autoSaveStatus === 'saving' ? 'info.main'
                    : autoSaveStatus === 'saved' ? 'success.main'
                    : autoSaveStatus === 'error' ? 'error.main'
                    : 'grey.400',
                }}
              />
            )}
            <Tooltip title={history.length > 0 ? t('editor.undoTooltip', { count: history.length }) : t('editor.noHistory')}>
              <span>
                <IconButton onClick={handleUndo} disabled={history.length === 0} sx={{ minWidth: 44, minHeight: 44 }}>
                  <UndoIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            {fields && (
              <Tooltip title={t('editor.applyProfile')}>
                <IconButton onClick={() => setLoadTemplateOpen(true)} sx={{ minWidth: 44, minHeight: 44 }}>
                  <FolderOpenIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Content — sidebar + main area */}
        {loading ? (
          renderLoadingState()
        ) : fetchError ? (
          renderErrorState()
        ) : fields && listing ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* Horizontal tabs at top — GetVela style */}
            <Box
              sx={{
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                '&::-webkit-scrollbar': { height: 0 },
                display: 'flex',
                gap: 0,
                px: { xs: 1, md: 2 },
                flexShrink: 0,
              }}
            >
              {editorTabs.map((tab) => (
                <Box
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: { xs: 1.5, md: 2.5 },
                    py: 1.5,
                    cursor: 'pointer',
                    flexShrink: 0,
                    borderBottom: '2px solid',
                    borderColor: activeTab === tab.id ? 'primary.main' : 'transparent',
                    color: activeTab === tab.id ? 'primary.main' : 'text.secondary',
                    fontWeight: activeTab === tab.id ? 600 : 400,
                    transition: 'all 0.15s ease',
                    '&:hover': {
                      color: activeTab === tab.id ? 'primary.main' : 'text.primary',
                      bgcolor: activeTab === tab.id ? 'transparent' : 'action.hover',
                    },
                  }}
                >
                  {tab.icon}
                  <Typography variant="body2" sx={{ fontWeight: 'inherit', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                    {tab.label}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* Main content area */}
            <Box sx={{ flex: 1, overflow: 'auto', pb: 8, '& .MuiFormHelperText-root': { fontSize: '0.8125rem', mt: 0.75 } }}>
            {/* ============================================================ */}
            {/* SEO Analizi */}
            {/* ============================================================ */}
            {activeTab === 'seo' && (
              <Box sx={{ p: { xs: 2, md: 2.5 } }}>
                <SEOIndicator
                  tags={fields.tags}
                  title={fields.title}
                  description={fields.description}
                  compact={false}
                />

                {/* Organic Rank Tracking — inline */}
                <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #eee' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                    {t('editor.organicSearchRanking')}
                  </Typography>

                  {/* Tracked keywords table */}
                  {trackedLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                      <CircularProgress size={20} />
                    </Box>
                  ) : trackedKeywords.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                      {trackedKeywords.map((kw) => (
                        <Box
                          key={kw.id}
                          sx={{
                            display: 'flex', alignItems: 'center', gap: 1.5,
                            p: 1.5, bgcolor: '#f8f9fa', borderRadius: '8px',
                            border: '1px solid #eee',
                          }}
                        >
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {kw.keyword}
                            </Typography>
                            {kw.checkedAt ? (
                              <Typography variant="caption" color="text.secondary">
                                {formatDate(new Date(kw.checkedAt), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                {(kw.snapshotCount ?? 0) > 1 && ' · '}
                                {(kw.snapshotCount ?? 0) > 1 && `${kw.snapshotCount} kontrol`}
                              </Typography>
                            ) : (
                              <Typography variant="caption" sx={{ color: '#999', fontStyle: 'italic' }}>
                                {t('editor.rankWaiting')}
                              </Typography>
                            )}
                          </Box>
                          <Box sx={{ textAlign: 'right', minWidth: 60 }}>
                            {kw.rank != null ? (
                              <>
                                <Typography
                                  variant="body1"
                                  sx={{
                                    fontWeight: 800,
                                    color: kw.rank <= 10 ? '#11998e' : kw.rank <= 48 ? '#F2994A' : '#eb3349',
                                    lineHeight: 1,
                                  }}
                                >
                                  #{kw.rank}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Sayfa {kw.page}
                                  {kw.change != null && kw.change !== 0 && (
                                    <span style={{ color: kw.change > 0 ? '#11998e' : '#eb3349', fontWeight: 700, marginLeft: 4 }}>
                                      {kw.change > 0 ? `↑${kw.change}` : `↓${Math.abs(kw.change)}`}
                                    </span>
                                  )}
                                </Typography>
                              </>
                            ) : kw.checkedAt ? (
                              <Typography variant="caption" color="text.secondary">500+</Typography>
                            ) : (
                              <Typography variant="caption" sx={{ color: '#bbb' }}>—</Typography>
                            )}
                          </Box>
                          <Tooltip title={t('editor.rankingAnalysisTooltip')}>
                            <IconButton
                              onClick={() => handleAnalyzeRanking(kw.keyword)}
                              disabled={rankAnalysisLoading === kw.keyword}
                              sx={{ color: '#666', '&:hover': { color: '#1976d2' }, minWidth: 44, minHeight: 44 }}
                            >
                              {rankAnalysisLoading === kw.keyword ? <CircularProgress size={18} /> : <AutoFixHighIcon fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                          <IconButton
                            onClick={async () => {
                              try {
                                await fetch(`/api/clawd/etsy?action=remove_tracked_keyword&keyword_id=${kw.id}&shop_id=${shopId}`, { method: 'DELETE' });
                                setTrackedKeywords(prev => prev.filter(k => k.id !== kw.id));
                              } catch { /* silent */ }
                            }}
                            sx={{ color: '#999', '&:hover': { color: '#eb3349' }, minWidth: 44, minHeight: 44 }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {t('editor.noTrackedKeywords')}
                    </Typography>
                  )}

                  {/* Inline rank check */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField
                      size="medium"
                      placeholder={t('editor.enterKeyword')}
                      value={rankKeyword}
                      onChange={(e) => setRankKeyword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRankCheck(); }}
                      sx={{ flex: 1 }}
                    />
                    <Button
                      variant="contained"
                      size="small"
                      onClick={handleRankCheck}
                      disabled={rankLoading || !rankKeyword.trim()}
                      sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', minWidth: 80, minHeight: 44 }}
                    >
                      {rankLoading ? <CircularProgress size={16} /> : t('editor.checkRank')}
                    </Button>
                  </Box>

                  {/* Rank check result */}
                  {rankResult && (
                    <Box sx={{ mt: 1.5, p: 1.5, bgcolor: '#f0f7ff', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ flex: 1 }}>
                        {rankResult.rank != null ? (
                          <Typography variant="body2">
                            <strong style={{ color: rankResult.rank <= 10 ? '#11998e' : rankResult.rank <= 48 ? '#F2994A' : '#eb3349', fontSize: '1.1rem' }}>
                              #{rankResult.rank}
                            </strong>
                            {' '}· {t('editor.page')} {rankResult.page} · {formatNumber(rankResult.totalResults)} {t('editor.results')}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            {t('editor.notFoundIn500')} ({formatNumber(rankResult.totalResults)} {t('editor.total')})
                          </Typography>
                        )}
                      </Box>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleAddToTracking}
                        sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', whiteSpace: 'nowrap' }}
                      >
                        {t('editor.addToTracking')}
                      </Button>
                    </Box>
                  )}
                </Box>
              </Box>
            )}

            {/* ============================================================ */}
            {/* Temel Bilgiler */}
            {/* ============================================================ */}
            {activeTab === 'basics' && (
              <Box sx={{ p: { xs: 2, md: 2.5 } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  {/* Title */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>{t('editor.titleLabel')}</Typography>
                      <Button
                        size="medium"
                        startIcon={aiLoading.optimize_title ? <CircularProgress size={14} /> : <AutoFixHighIcon sx={{ fontSize: 16 }} />}
                        onClick={handleAIOptimizeTitle}
                        disabled={!!aiLoading.optimize_title || !fields.title}
                        sx={{ textTransform: 'none', fontSize: '0.875rem', minWidth: 0, minHeight: 40 }}
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
                      size="medium"
                      helperText={`${fields.title.length}/140 karakter`}
                      inputProps={{ maxLength: 140 }}
                    />
                  </Box>

                  {/* Description */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>{t('editor.descriptionLabel')}</Typography>
                      <Button
                        size="medium"
                        startIcon={aiLoading.generate_description ? <CircularProgress size={14} /> : <AutoFixHighIcon sx={{ fontSize: 16 }} />}
                        onClick={handleAIGenerateDescription}
                        disabled={!!aiLoading.generate_description || !fields.title}
                        sx={{ textTransform: 'none', fontSize: '0.875rem', minWidth: 0, minHeight: 40 }}
                      >
                        AI ile Olustur
                      </Button>
                    </Box>
                    <TextField
                      value={fields.description}
                      onChange={(e) => updateField('description', e.target.value)}
                      fullWidth
                      multiline
                      rows={8}
                      size="medium"
                      helperText={`${fields.description.length} karakter`}
                    />
                  </Box>

                  {/* Tags */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="subtitle2" fontWeight={600}>
                        Etiketler
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <TagProfileMenu
                          currentTags={fields.tags}
                          onApplyTags={(tags) => updateField('tags', tags)}
                        />
                      </Box>
                    </Box>

                    {/* Market Research Data Banner */}
                    {marketResearchData && (
                      <Alert
                        severity="info"
                        sx={{
                          mb: 1.5,
                          py: 0.5,
                          '& .MuiAlert-message': { width: '100%' },
                          '& .MuiAlert-icon': { py: 0.5 },
                        }}
                        action={
                          <IconButton
                            size="small"
                            onClick={() => setResearchBannerOpen((prev) => !prev)}
                            sx={{ mt: -0.5 }}
                          >
                            <ExpandMoreIcon
                              sx={{
                                fontSize: 18,
                                transform: researchBannerOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s',
                              }}
                            />
                          </IconButton>
                        }
                      >
                        <Typography variant="caption" fontWeight={600} sx={{ cursor: 'pointer' }} onClick={() => setResearchBannerOpen((prev) => !prev)}>
                          {t('editor.marketData')}: &quot;{marketResearchData.query}&quot;
                        </Typography>
                        <Collapse in={researchBannerOpen}>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                            {marketResearchData.topTags.slice(0, 10).map((tagItem) => (
                              <Chip
                                key={tagItem.tag}
                                label={`${tagItem.tag} (${tagItem.pct}%)`}
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontSize: '0.82rem',
                                  height: 26,
                                  cursor: 'pointer',
                                  '&:hover': { bgcolor: 'action.hover' },
                                }}
                                onClick={() => {
                                  if (fields.tags.length >= 13) {
                                    toast.error(t('editor.maxTagsError'));
                                    return;
                                  }
                                  if (fields.tags.includes(tagItem.tag)) {
                                    toast(t('editor.tagExists'), { icon: 'ℹ️' });
                                    return;
                                  }
                                  updateField('tags', [...fields.tags, tagItem.tag]);
                                  toast.success(`"${tagItem.tag}" ${t('editor.tagAdded')}`);
                                }}
                              />
                            ))}
                          </Box>
                          {marketResearchData.priceStats && (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                              {t('editor.priceRange', { min: marketResearchData.priceStats.min, max: marketResearchData.priceStats.max, avg: marketResearchData.priceStats.avg })}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontStyle: 'italic', fontSize: '0.875rem' }}>
                            {t('editor.marketDataWillBeUsed')}
                          </Typography>
                        </Collapse>
                      </Alert>
                    )}

                    <Autocomplete
                      multiple
                      freeSolo
                      options={[]}
                      value={fields.tags}
                      onChange={(_, newValue) => {
                        // Split any comma-separated entries and flatten
                        const expanded = newValue.flatMap((v) =>
                          typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [v]
                        );
                        // Deduplicate, enforce 20-char limit, limit to 13
                        const unique = [...new Set(expanded)]
                          .map((t) => t.substring(0, 20))
                          .slice(0, 13);
                        updateField('tags', unique);
                      }}
                      renderTags={(value, getTagProps) =>
                        value.map((tag, index) => (
                          <Chip
                            {...getTagProps({ index })}
                            key={tag}
                            label={tag}
                            size="small"
                            color={tag.length > 20 ? 'error' : undefined}
                            sx={{ maxWidth: 180 }}
                          />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          size="medium"
                          placeholder={fields.tags.length < 13 ? t('editor.bulkEditTags') : ''}
                          helperText={t('editor.tagHelperText', { count: fields.tags.length })}
                          onKeyDown={(e) => {
                            if (e.key === ',') {
                              e.preventDefault();
                              const input = (e.target as HTMLInputElement).value.trim();
                              if (input && fields.tags.length < 13) {
                                const newTags = input.split(',').map((s) => s.trim()).filter(Boolean).map((t) => t.substring(0, 20));
                                const merged = [...new Set([...fields.tags, ...newTags])].slice(0, 13);
                                updateField('tags', merged);
                                // Clear the input
                                const autocompleteInput = (e.target as HTMLInputElement);
                                autocompleteInput.value = '';
                                // Trigger a change event to reset MUI's internal state
                                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                                nativeInputValueSetter?.call(autocompleteInput, '');
                                autocompleteInput.dispatchEvent(new Event('input', { bubbles: true }));
                              }
                            }
                          }}
                          onPaste={(e) => {
                            const pasted = e.clipboardData.getData('text');
                            if (pasted.includes(',')) {
                              e.preventDefault();
                              const newTags = pasted.split(',').map((s) => s.trim()).filter(Boolean).map((t) => t.substring(0, 20));
                              const merged = [...new Set([...fields.tags, ...newTags])].slice(0, 13);
                              updateField('tags', merged);
                            }
                          }}
                        />
                      )}
                    />

                    {/* AI Tag Buttons — right under the tags field */}
                    <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                      <Button
                        size="medium"
                        variant="outlined"
                        startIcon={aiLoading.suggest_tags ? <CircularProgress size={14} /> : <AutoFixHighIcon sx={{ fontSize: 16 }} />}
                        onClick={handleAISuggestTags}
                        disabled={!!aiLoading.suggest_tags || !fields.title}
                        sx={{ textTransform: 'none', fontSize: '0.875rem', minHeight: 40 }}
                      >
                        AI Etiket Oner
                      </Button>
                      {fields.tags.length > 0 && (
                        <Button
                          size="medium"
                          variant="outlined"
                          color="secondary"
                          startIcon={aiLoading.suggest_tags ? <CircularProgress size={14} /> : <AutoFixHighIcon sx={{ fontSize: 16 }} />}
                          onClick={async () => {
                            const result = await callAI('suggest_tags');
                            const suggested = result?.suggestions || result?.tags;
                            if (suggested && Array.isArray(suggested)) {
                              updateField('tags', suggested.slice(0, 13));
                              toast.success(t('editor.tagsReplaced', { count: Math.min(suggested.length, 13) }));
                            }
                          }}
                          disabled={!!aiLoading.suggest_tags || !fields.title}
                          sx={{ textTransform: 'none', fontSize: '0.875rem', minHeight: 40 }}
                        >
                          {t('editor.aiReplaceAll')}
                        </Button>
                      )}
                      {/* Research data availability indicator */}
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: '0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          ml: 'auto',
                          color: marketResearchData ? 'success.main' : 'warning.main',
                        }}
                      >
                        {marketResearchData
                          ? t('editor.hasResearchData')
                          : t('editor.noResearchData')}
                      </Typography>
                    </Box>

                    {/* AI Tag Suggestions */}
                    {aiTagSuggestions.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            {t('editor.suggestedTags')}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {fields.tags.length >= 13 && (
                              <Button
                                size="medium"
                                color="secondary"
                                onClick={() => {
                                  updateField('tags', aiTagSuggestions.slice(0, 13));
                                  setAiTagSuggestions([]);
                                  toast.success(t('editor.allTagsReplaced'));
                                }}
                                sx={{ textTransform: 'none', fontSize: '0.875rem', minWidth: 0, minHeight: 40 }}
                              >
                                {t('editor.replaceAll')}
                              </Button>
                            )}
                            <Button
                              size="small"
                              onClick={() => {
                                const newTags = aiTagSuggestions.filter((t) => !fields.tags.includes(t));
                                const merged = [...fields.tags, ...newTags].slice(0, 13);
                                updateField('tags', merged);
                                setAiTagSuggestions([]);
                                toast.success(t('editor.tagsAdded', { count: merged.length - fields.tags.length }));
                              }}
                              disabled={fields.tags.length >= 13 || aiTagSuggestions.every((t) => fields.tags.includes(t))}
                              sx={{ textTransform: 'none', fontSize: '0.875rem', minWidth: 0, minHeight: 40 }}
                            >
                              {t('editor.addToGaps')}
                            </Button>
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {aiTagSuggestions.map((tag) => {
                            const alreadyExists = fields.tags.includes(tag);
                            return (
                              <Chip
                                key={tag}
                                label={tag}
                                size="small"
                                variant={alreadyExists ? 'filled' : 'outlined'}
                                color={alreadyExists ? 'default' : 'primary'}
                                disabled={alreadyExists}
                                onClick={
                                  alreadyExists
                                    ? undefined
                                    : () => {
                                        if (fields.tags.length < 13) {
                                          updateField('tags', [...fields.tags, tag]);
                                        } else {
                                          // Replace the last tag when full
                                          const newTags = [...fields.tags];
                                          newTags[newTags.length - 1] = tag;
                                          updateField('tags', newTags);
                                          toast.success(t('editor.tagReplacedWith', { tag }));
                                        }
                                      }
                                }
                                sx={{
                                  cursor: alreadyExists ? 'default' : 'pointer',
                                  opacity: alreadyExists ? 0.5 : 1,
                                  maxWidth: 180,
                                }}
                              />
                            );
                          })}
                        </Box>
                        {fields.tags.length >= 13 && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            {t('editor.tagsFull')}
                          </Typography>
                        )}
                      </Box>
                    )}
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
                        label={t('editor.materialsLabel')}
                        size="medium"
                        placeholder={fields.materials.length < 13 ? t('editor.materialsPlaceholder') : ''}
                        helperText={t('editor.materialsHelperText', { count: fields.materials.length })}
                      />
                    )}
                  />
                </Box>
              </Box>
            )}

            {/* ============================================================ */}
            {/* Price and Stock */}
            {/* ============================================================ */}
            {activeTab === 'pricing' && (
              <Box sx={{ p: { xs: 2, md: 2.5 } }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField
                    label={t('editor.price')}
                    value={fields.price}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Allow digits and one decimal point
                      if (/^\d*\.?\d{0,2}$/.test(val) || val === '') {
                        updateField('price', val);
                      }
                    }}
                    size="medium"
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
                    label={t('editor.stockLabel')}
                    type="number"
                    value={fields.quantity}
                    onChange={(e) => updateField('quantity', Math.max(0, parseInt(e.target.value) || 0))}
                    size="medium"
                    sx={{ width: 120 }}
                    inputProps={{ min: 0 }}
                  />
                </Box>
              </Box>
            )}

            {/* ============================================================ */}
            {/* Gorseller */}
            {/* ============================================================ */}
            {activeTab === 'images' && (
              <Box sx={{ p: { xs: 2, md: 2.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Typography variant="h6" fontWeight={600}>{t('editor.images')}</Typography>
                  <Chip label={listing.images.length} size="small" sx={{ height: 26, fontSize: '0.85rem' }} />
                </Box>
                <ImageManager
                  listingId={String(listing.listing_id)}
                  shopId={shopId}
                  images={listing.images}
                  onImagesChanged={fetchListing}
                />
              </Box>
            )}

            {/* ============================================================ */}
            {/* Video */}
            {/* ============================================================ */}
            {activeTab === 'video' && (
              <Box sx={{ p: { xs: 2, md: 2.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Typography variant="h6" fontWeight={600}>Video</Typography>
                  {videos.length > 0 && (
                    <Chip label={videos.length} size="small" sx={{ height: 26, fontSize: '0.85rem' }} />
                  )}
                </Box>
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
              </Box>
            )}

            {/* ============================================================ */}
            {/* Kişiselleştirme */}
            {/* ============================================================ */}
            {activeTab === 'personalization' && (
              <Box sx={{ p: { xs: 2, md: 2.5 } }}>
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
              </Box>
            )}

            {/* ============================================================ */}
            {/* Varyasyonlar ve Envanter */}
            {/* ============================================================ */}
            {activeTab === 'variations' && (
              <Box sx={{ p: { xs: 2, md: 2.5 } }}>
                <VariationEditor
                  listingId={String(listing.listing_id)}
                  shopId={shopId}
                  onSaved={fetchListing}
                />
              </Box>
            )}

            {/* ============================================================ */}
            {/* Liste Detayları */}
            {/* ============================================================ */}
            {activeTab === 'details' && (
              <Box sx={{ p: { xs: 2, md: 2.5 } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  {/* Who made */}
                  <FormControl size="medium" fullWidth>
                    <InputLabel>{t('editor.whoMadeLabel')}</InputLabel>
                    <Select
                      value={fields.who_made}
                      label={t('editor.whoMadeLabel')}
                      onChange={(e: SelectChangeEvent) => updateField('who_made', e.target.value)}
                    >
                      {WHO_MADE_KEYS.map((val) => (
                        <MenuItem key={val} value={val}>
                          {t(`whoMade.${WHO_MADE_I18N[val]}`)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* When made */}
                  <FormControl size="medium" fullWidth>
                    <InputLabel>{t('editor.whenMadeLabel')}</InputLabel>
                    <Select
                      value={fields.when_made}
                      label={t('editor.whenMadeLabel')}
                      onChange={(e: SelectChangeEvent) => updateField('when_made', e.target.value)}
                    >
                      {WHEN_MADE_KEYS.map((val) => (
                        <MenuItem key={val} value={val}>
                          {t(`whenMade.${WHEN_MADE_I18N[val]}`)}
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
                    label={t('editor.isSupplyLabel')}
                  />

                  <Divider sx={{ my: 2 }} />

                  {/* Shop section */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <FormControl size="medium" fullWidth>
                      <InputLabel>{t('editor.shopSection')}</InputLabel>
                      <Select
                        value={String(fields.shop_section_id)}
                        label={t('editor.shopSection')}
                        onChange={(e: SelectChangeEvent) =>
                          updateField('shop_section_id', e.target.value ? Number(e.target.value) : '')
                        }
                      >
                        <MenuItem value="">
                          <em>{t('editor.notSelected')}</em>
                        </MenuItem>
                        {shopSections.map((sec) => (
                          <MenuItem key={sec.shop_section_id} value={String(sec.shop_section_id)}>
                            {sec.title}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Tooltip title={t('editor.addNewSection')}>
                      <IconButton onClick={() => setCreateSectionOpen(true)} sx={{ minWidth: 44, minHeight: 44 }}>
                        <AddIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {shopSections.length === 0 && (
                    <Typography variant="caption" color="warning.main">
                      {t('editor.couldNotLoad')}
                    </Typography>
                  )}

                  {/* Shipping profile */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <FormControl size="medium" fullWidth>
                      <InputLabel>{t('editor.shippingProfile')}</InputLabel>
                      <Select
                        value={String(fields.shipping_profile_id)}
                        label={t('editor.shippingProfile')}
                        onChange={(e: SelectChangeEvent) =>
                          updateField('shipping_profile_id', e.target.value ? Number(e.target.value) : '')
                        }
                      >
                        <MenuItem value="">
                          <em>{t('editor.notSelected')}</em>
                        </MenuItem>
                        {shippingProfiles.map((sp) => (
                          <MenuItem key={sp.shipping_profile_id} value={String(sp.shipping_profile_id)}>
                            {sp.title}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Tooltip title={t('editor.addNewShippingProfile')}>
                      <IconButton onClick={() => setCreateShippingOpen(true)} sx={{ minWidth: 44, minHeight: 44 }}>
                        <AddIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {shippingProfiles.length === 0 && (
                    <Typography variant="caption" color="warning.main">
                      {t('editor.couldNotLoad')}
                    </Typography>
                  )}

                  {/* Return policy */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <FormControl size="medium" fullWidth>
                      <InputLabel>{t('editor.returnPolicy')}</InputLabel>
                      <Select
                        value={String(fields.return_policy_id)}
                        label={t('editor.returnPolicy')}
                        onChange={(e: SelectChangeEvent) =>
                          updateField('return_policy_id', e.target.value ? Number(e.target.value) : '')
                        }
                      >
                        <MenuItem value="">
                          <em>{t('editor.notSelected')}</em>
                        </MenuItem>
                        {returnPolicies.map((rp) => {
                          const label = rp.description
                            ? rp.description
                            : [
                                rp.accepts_returns ? t('editor.acceptsReturnsLabel') : t('editor.noReturnsLabel'),
                                rp.accepts_exchanges ? t('editor.acceptsExchangesLabel') : t('editor.noExchangesLabel'),
                              ].join(', ');
                          return (
                            <MenuItem key={rp.return_policy_id} value={String(rp.return_policy_id)}>
                              {label}
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                    <Tooltip title={t('editor.addNewReturnPolicy')}>
                      <IconButton onClick={() => setCreateReturnOpen(true)} sx={{ minWidth: 44, minHeight: 44 }}>
                        <AddIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {returnPolicies.length === 0 && (
                    <Typography variant="caption" color="warning.main">
                      {t('editor.couldNotLoad')}
                    </Typography>
                  )}

                  <Divider sx={{ my: 2 }} />

                  {/* Processing time */}
                  <Typography variant="subtitle2" fontWeight={600}>
                    {t('editor.processingTimeDays')}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                    <TextField
                      label={t('editor.minLabel')}
                      type="number"
                      value={fields.processing_min}
                      onChange={(e) =>
                        updateField('processing_min', e.target.value ? parseInt(e.target.value) : '')
                      }
                      size="medium"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 1 }}
                    />
                    <TextField
                      label={t('editor.maxLabel')}
                      type="number"
                      value={fields.processing_max}
                      onChange={(e) =>
                        updateField('processing_max', e.target.value ? parseInt(e.target.value) : '')
                      }
                      size="medium"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 1 }}
                    />
                  </Box>

                  <Divider sx={{ my: 2 }} />

                  {/* Weight */}
                  <Typography variant="subtitle2" fontWeight={600}>
                    {t('editor.weightTitle')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                      label={t('editor.weightLabel')}
                      type="number"
                      value={fields.item_weight}
                      onChange={(e) =>
                        updateField('item_weight', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="medium"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <FormControl size="medium" sx={{ minWidth: 80 }}>
                      <InputLabel>{t('editor.unitLabel')}</InputLabel>
                      <Select
                        value={fields.item_weight_unit}
                        label={t('editor.unitLabel')}
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
                  <Typography variant="subtitle2" fontWeight={600}>
                    {t('editor.dimensionsTitle')}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: '1fr 1fr 1fr auto' }, gap: 1.5 }}>
                    <TextField
                      label={t('editor.lengthLabel')}
                      type="number"
                      value={fields.item_length}
                      onChange={(e) =>
                        updateField('item_length', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="medium"
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <TextField
                      label={t('editor.widthLabel')}
                      type="number"
                      value={fields.item_width}
                      onChange={(e) =>
                        updateField('item_width', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="medium"
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <TextField
                      label={t('editor.heightLabel')}
                      type="number"
                      value={fields.item_height}
                      onChange={(e) =>
                        updateField('item_height', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="medium"
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <FormControl size="medium" sx={{ minWidth: 70 }}>
                      <InputLabel>{t('editor.unitLabel')}</InputLabel>
                      <Select
                        value={fields.item_dimensions_unit}
                        label={t('editor.unitLabel')}
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
              </Box>
            )}

            {/* ============================================================ */}
            {/* İşlemler */}
            {/* ============================================================ */}
            {activeTab === 'actions' && (
              <Box sx={{ p: { xs: 2, md: 2.5 } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Publish — only for draft/inactive */}
                  {(listing.state === 'draft' || listing.state === 'inactive') && (
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={publishing ? <CircularProgress size={18} color="inherit" /> : <PublishIcon />}
                      onClick={() => setPublishDialogOpen(true)}
                      disabled={publishing}
                      fullWidth
                      sx={{ minHeight: 48, fontSize: '1rem' }}
                    >
                      {publishing ? t('editor.publishing') : t('editor.publish')}
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
                      onClick={() => setDeactivateDialogOpen(true)}
                      disabled={deactivating}
                      fullWidth
                      sx={{ minHeight: 48, fontSize: '1rem' }}
                    >
                      {deactivating ? t('editor.deactivating') : t('editor.deactivateButton')}
                    </Button>
                  )}

                  {/* Copy */}
                  <Button
                    variant="outlined"
                    startIcon={copying ? <CircularProgress size={18} /> : <ContentCopyIcon />}
                    onClick={handleCopy}
                    disabled={copying}
                    fullWidth
                    sx={{ minHeight: 48, fontSize: '1rem' }}
                  >
                    {copying ? t('editor.copying') : t('editor.copy')}
                  </Button>

                  {/* Delete */}
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={() => setDeleteDialogOpen(true)}
                    fullWidth
                    sx={{ minHeight: 48, fontSize: '1rem' }}
                  >
                    {t('editor.delete')}
                  </Button>
                </Box>
              </Box>
            )}
            </Box>

            {/* ================================================================ */}
          </Box>
        ) : null}

        {/* Footer — GetVela-style bottom bar */}
        {fields && listing && !loading && !fetchError && (
          <Box
            sx={{
              position: 'sticky',
              bottom: 0,
              px: { xs: 1.5, md: 2.5 },
              py: 1.5,
              borderTop: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              zIndex: 10,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            {/* Cancel */}
            <Button
              variant="outlined"
              size="medium"
              onClick={onClose}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: '8px',
                borderColor: '#e2e8f0',
                color: '#475569',
                minHeight: 44,
                '&:hover': { borderColor: '#cbd5e1', bgcolor: '#f8fafc' },
              }}
            >
              {t('editor.cancel')}
            </Button>

            {/* View on Etsy */}
            {listing?.url && (
              <Button
                variant="outlined"
                size="medium"
                component="a"
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<OpenInNewIcon sx={{ fontSize: '16px !important' }} />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 600,
                  borderRadius: '8px',
                  borderColor: '#e2e8f0',
                  color: '#475569',
                  minHeight: 44,
                  '&:hover': { borderColor: '#cbd5e1', bgcolor: '#f8fafc' },
                  display: { xs: 'none', md: 'inline-flex' },
                }}
              >
                {t('editor.viewOnEtsy')}
              </Button>
            )}

            {/* Save as Profile */}
            <Button
              variant="outlined"
              size="medium"
              onClick={() => setSaveTemplateOpen(true)}
              startIcon={<BookmarkBorderIcon sx={{ fontSize: '16px !important' }} />}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: '8px',
                borderColor: '#e2e8f0',
                color: '#475569',
                minHeight: 44,
                '&:hover': { borderColor: '#cbd5e1', bgcolor: '#f8fafc' },
                display: { xs: 'none', lg: 'inline-flex' },
              }}
            >
              {t('editor.saveProfile')}
            </Button>

            {/* Copy */}
            <Button
              variant="outlined"
              size="medium"
              onClick={handleCopy}
              disabled={copying}
              startIcon={copying ? <CircularProgress size={16} /> : <ContentCopyIcon sx={{ fontSize: '16px !important' }} />}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: '8px',
                borderColor: '#e2e8f0',
                color: '#475569',
                minHeight: 44,
                '&:hover': { borderColor: '#cbd5e1', bgcolor: '#f8fafc' },
                display: { xs: 'none', lg: 'inline-flex' },
              }}
            >
              {t('editor.copy')}
            </Button>

            {/* Schedule */}
            <Button
              variant="outlined"
              size="medium"
              startIcon={<ScheduleIcon sx={{ fontSize: '16px !important' }} />}
              onClick={() => setScheduleDialogOpen(true)}
              disabled={saving}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: '8px',
                borderColor: '#e2e8f0',
                color: '#475569',
                minHeight: 44,
                position: 'relative',
                '&:hover': { borderColor: '#cbd5e1', bgcolor: '#f8fafc' },
                display: { xs: 'none', md: 'inline-flex' },
              }}
            >
              {t('editor.schedule')}
              {pendingScheduleCount > 0 && (
                <Chip
                  label={pendingScheduleCount}
                  size="small"
                  color="warning"
                  sx={{
                    position: 'absolute',
                    top: -8,
                    right: -8,
                    height: 26,
                    minWidth: 20,
                    fontSize: '0.85rem',
                  }}
                />
              )}
            </Button>

            {/* Spacer */}
            <Box sx={{ flex: 1 }} />

            {/* Save/Publish — green button, rightmost */}
            <Button
              variant="contained"
              size="medium"
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #10b981, #059669)',
                boxShadow: '0 2px 8px rgba(5,150,105,0.3)',
                px: 3,
                minHeight: 48,
                '&:hover': { background: 'linear-gradient(135deg, #059669, #047857)' },
                '&.Mui-disabled': { background: '#e2e8f0', color: '#94a3b8' },
              }}
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges()}
            >
              {saving ? t('editor.saving') : t('editor.save')}
            </Button>
          </Box>
        )}
      </Drawer>

      {/* ================================================================ */}
      {/* Delete Confirmation Dialog */}
      {/* ================================================================ */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('editor.deleteListing')}</DialogTitle>
        <DialogContent>
          <Typography>
{t('editor.deleteConfirmText')}
          </Typography>
          {listing?.title && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              &ldquo;{listing.title}&rdquo;
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            {t('editor.cancel')}
          </Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={18} color="inherit" /> : <DeleteIcon />}
          >
            {deleting ? t('editor.deleting') : t('editor.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================ */}
      {/* Publish Confirmation Dialog */}
      {/* ================================================================ */}
      <Dialog open={publishDialogOpen} onClose={() => setPublishDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('editor.publishListing')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('editor.publishConfirm')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPublishDialogOpen(false)} disabled={publishing}>
            {t('editor.cancel')}
          </Button>
          <Button
            onClick={() => {
              setPublishDialogOpen(false);
              handlePublish();
            }}
            color="success"
            variant="contained"
            disabled={publishing}
            startIcon={publishing ? <CircularProgress size={18} color="inherit" /> : <PublishIcon />}
          >
            {t('editor.publish')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================ */}
      {/* Deactivate Confirmation Dialog */}
      {/* ================================================================ */}
      <Dialog open={deactivateDialogOpen} onClose={() => setDeactivateDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('editor.deactivateListing')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('editor.deactivateConfirm')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivateDialogOpen(false)} disabled={deactivating}>
            {t('editor.cancel')}
          </Button>
          <Button
            onClick={() => {
              setDeactivateDialogOpen(false);
              handleDeactivate();
            }}
            color="error"
            variant="contained"
            disabled={deactivating}
            startIcon={deactivating ? <CircularProgress size={18} color="inherit" /> : <BlockIcon />}
          >
            {t('editor.deactivateButton')}
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
              processing_min: fields.processing_min,
              processing_max: fields.processing_max,
              item_weight: fields.item_weight,
              item_weight_unit: fields.item_weight_unit,
              item_length: fields.item_length,
              item_width: fields.item_width,
              item_height: fields.item_height,
              item_dimensions_unit: fields.item_dimensions_unit,
              shop_section_id: fields.shop_section_id,
              price: fields.price,
              quantity: fields.quantity,
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
        <DialogTitle>{t('editor.createShippingTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '12px !important' }}>
          <TextField
            label={t('editor.profileName')}
            placeholder={t('editor.profileNamePlaceholder')}
            size="small"
            fullWidth
            required
            value={newShipping.title}
            onChange={(e) => setNewShipping(s => ({ ...s, title: e.target.value }))}
            helperText={t('editor.profileNameHelperText')}
          />

          <Divider />

          {/* Origin & Destination */}
          <Typography variant="subtitle2" color="text.secondary">{t('editor.shippingRoute')}</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl fullWidth size="small" required>
              <InputLabel>{t('editor.originCountry')}</InputLabel>
              <Select
                value={newShipping.origin_country_iso}
                label={t('editor.originCountry')}
                onChange={(e) => setNewShipping(s => ({ ...s, origin_country_iso: e.target.value }))}
              >
                {['TR','US','GB','DE','FR','CA','AU','NL','IT','ES'].map(code => (
                  <MenuItem key={code} value={code}>{t(`countries.${code}`)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t('editor.destinationCountry')}</InputLabel>
              <Select
                value={newShipping.destination_country_iso}
                label={t('editor.destinationCountry')}
                onChange={(e) => setNewShipping(s => ({ ...s, destination_country_iso: e.target.value }))}
              >
                <MenuItem value=""><em>{t('editor.allWorldDefault')}</em></MenuItem>
                {['US','GB','DE','FR','CA','AU','TR','NL','IT','ES'].map(code => (
                  <MenuItem key={code} value={code}>{t(`countries.${code}`)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Divider />

          {/* Shipping costs */}
          <Typography variant="subtitle2" color="text.secondary">{t('editor.shippingCosts')}</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label={t('editor.primaryShippingCost')}
              type="number"
              size="small"
              fullWidth
              value={newShipping.primary_cost}
              onChange={(e) => setNewShipping(s => ({ ...s, primary_cost: e.target.value }))}
              inputProps={{ min: 0, step: '0.01' }}
              helperText={t('editor.primaryShippingHelperText')}
            />
            <TextField
              label={t('editor.secondaryShippingCost')}
              type="number"
              size="small"
              fullWidth
              value={newShipping.secondary_cost}
              onChange={(e) => setNewShipping(s => ({ ...s, secondary_cost: e.target.value }))}
              inputProps={{ min: 0, step: '0.01' }}
              helperText={t('editor.secondaryShippingHelperText')}
            />
          </Box>

          <Divider />

          {/* Processing time */}
          <Typography variant="subtitle2" color="text.secondary">{t('editor.processingTime')}</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label={t('editor.minimum')}
              type="number"
              size="small"
              fullWidth
              value={newShipping.min_processing_days}
              onChange={(e) => setNewShipping(s => ({ ...s, min_processing_days: e.target.value }))}
              inputProps={{ min: 1, max: 45 }}
              helperText={t('editor.minProcessingHelperText')}
            />
            <TextField
              label={t('editor.maximum')}
              type="number"
              size="small"
              fullWidth
              value={newShipping.max_processing_days}
              onChange={(e) => setNewShipping(s => ({ ...s, max_processing_days: e.target.value }))}
              inputProps={{ min: 1, max: 45 }}
              helperText={t('editor.maxProcessingHelperText')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateShippingOpen(false)}>{t('editor.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleCreateShippingProfile}
            disabled={createLoading || !newShipping.title.trim()}
          >
            {createLoading ? <CircularProgress size={20} /> : t('editor.createShippingProfile')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Return Policy Dialog */}
      <Dialog open={createReturnOpen} onClose={() => setCreateReturnOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('editor.createReturnPolicyTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <FormControlLabel
            control={<Switch checked={newReturn.accepts_returns} onChange={(e) => setNewReturn(s => ({ ...s, accepts_returns: e.target.checked }))} />}
            label={t('editor.acceptsReturns')}
          />
          <FormControlLabel
            control={<Switch checked={newReturn.accepts_exchanges} onChange={(e) => setNewReturn(s => ({ ...s, accepts_exchanges: e.target.checked }))} />}
            label={t('editor.acceptsExchanges')}
          />
          {newReturn.accepts_returns && (
            <TextField label={t('editor.returnDeadline')} type="number" size="small" fullWidth value={newReturn.return_deadline} onChange={(e) => setNewReturn(s => ({ ...s, return_deadline: e.target.value }))} inputProps={{ min: 1 }} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateReturnOpen(false)}>{t('editor.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateReturnPolicy} disabled={createLoading}>
            {createLoading ? <CircularProgress size={20} /> : t('editor.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Shop Section Dialog */}
      <Dialog open={createSectionOpen} onClose={() => setCreateSectionOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('editor.createSectionTitle')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField label={t('editor.sectionName')} size="small" fullWidth value={newSectionTitle} onChange={(e) => setNewSectionTitle(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateSectionOpen(false)}>{t('editor.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateSection} disabled={createLoading || !newSectionTitle}>
            {createLoading ? <CircularProgress size={20} /> : t('editor.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Ranking Analysis Dialog */}
      <Dialog open={rankAnalysisOpen} onClose={() => setRankAnalysisOpen(false)} maxWidth="md" fullWidth sx={{ zIndex: 1500 }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('editor.rankingAnalysis')}</Typography>
            {rankAnalysis?.market && (
              <Typography variant="caption" color="text.secondary">
                {t('editor.rankAnalysisTitle', { rank: rankAnalysis.market.userRank ?? '500+', total: formatNumber(rankAnalysis.market.totalResults || 0) })}
              </Typography>
            )}
          </Box>
          <IconButton onClick={() => setRankAnalysisOpen(false)}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {rankAnalysis?.analysis && (() => {
            const a = rankAnalysis.analysis;
            return (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, bgcolor: '#f8f9fa', borderRadius: 2 }}>
                  <Box sx={{
                    width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: a.overall_score >= 70 ? '#e8f5e9' : a.overall_score >= 40 ? '#fff3e0' : '#fce4ec',
                    color: a.overall_score >= 70 ? '#2e7d32' : a.overall_score >= 40 ? '#e65100' : '#c62828',
                    fontWeight: 800, fontSize: '1.2rem',
                  }}>
                    {a.overall_score}
                  </Box>
                  <Box>
<Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('editor.difficulty', { level: a.estimated_page1_difficulty })}</Typography>
                    <Typography variant="body2" color="text.secondary">
{t('editor.competitorAvg', { views: rankAnalysis.market.avgViews, favorites: rankAnalysis.market.avgFavorites, price: rankAnalysis.market.avgPrice })}
                    </Typography>
                  </Box>
                </Box>
                {a.priority_actions?.length > 0 && (
                  <Box sx={{ p: 2, bgcolor: '#e3f2fd', borderRadius: 2, border: '1px solid #bbdefb' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#1565c0' }}>{t('editor.priorityActions')}</Typography>
                    {a.priority_actions.map((action: string, i: number) => (
                      <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: '#1565c0', minWidth: 20 }}>{i + 1}.</Typography>
                        <Typography variant="body2">{action}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
                {a.factors?.length > 0 && (
                  <Box>
<Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('editor.factorAnalysis')}</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {a.factors.map((f: any, i: number) => (
                        <Box key={i} sx={{ p: 1.5, borderRadius: 1, border: '1px solid #eee', bgcolor: '#fafafa' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{f.name}</Typography>
                            <Chip label={`${f.score}/10`} size="small" sx={{
                              fontWeight: 700, height: 26,
                              bgcolor: f.status === 'iyi' ? '#e8f5e9' : f.status === 'orta' ? '#fff3e0' : '#fce4ec',
                              color: f.status === 'iyi' ? '#2e7d32' : f.status === 'orta' ? '#e65100' : '#c62828',
                            }} />
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{f.finding}</Typography>
                          <Typography variant="caption" sx={{ color: '#1565c0', fontWeight: 500 }}>→ {f.action}</Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
                {(a.missing_keywords?.length > 0 || rankAnalysis.market?.missingTags?.length > 0) && (
                  <Box>
<Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('editor.missingKeywords')}</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {(a.missing_keywords || []).map((kw: string, i: number) => (
                        <Chip key={i} label={kw} size="small" variant="outlined" sx={{ fontSize: '0.85rem' }} />
                      ))}
                      {(rankAnalysis.market?.missingTags || []).map((tag: string, i: number) => (
                        <Chip key={`t${i}`} label={tag} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.85rem' }} />
                      ))}
                    </Box>
                  </Box>
                )}
                {a.suggested_title && (
                  <Box sx={{ p: 2, bgcolor: '#f3e5f5', borderRadius: 2, border: '1px solid #ce93d8' }}>
<Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, color: '#6a1b9a' }}>{t('editor.suggestedTitle')}</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>{a.suggested_title}</Typography>
                    <Button size="small" sx={{ mt: 1, textTransform: 'none' }} onClick={() => {
                      updateField('title', a.suggested_title);
                      toast.success(t('editor.titleApplied'));
                    }}>
                      {t('editor.applyTitle')}
                    </Button>
                  </Box>
                )}
              </Box>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
