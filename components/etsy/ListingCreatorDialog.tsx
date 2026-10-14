import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  Stepper,
  Step,
  StepLabel,
  TextField,
  Select,
  MenuItem,
  Autocomplete,
  Switch,
  Button,
  LinearProgress,
  Box,
  Typography,
  Paper,
  FormControl,
  InputLabel,
  FormControlLabel,
  Chip,
  useMediaQuery,
  useTheme,
  IconButton,
  Alert,
  CircularProgress,
  Tooltip,
  Divider,
  Checkbox,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import { toast } from 'react-hot-toast';
import { stageEtsyDraft, stageEtsyDraftFile, syncEtsyDraft } from '@/lib/etsy/draftClient';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/lib/hooks/useConfirm';
import SEOIndicator from './SEOIndicator';
import {
  aiErrorCode, AiRequestError, checkTags, checkTitle, normalizeTags, normalizeTitle, splitCommaList,
  ETSY_MAX_IMAGES, ETSY_WHEN_MADE_OPTIONS, normalizeWhenMade, TAG_MAX_COUNT, TAG_MAX_LEN, TITLE_MAX, TITLE_MIN, whenMadeLabelKey,
} from '@/lib/etsy/seoRules';
import type { MarketResearchData } from './MarketResearch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopySourceData {
  title: string;
  description: string;
  tags: string[];
  materials?: string[];
  price?: number;
  quantity?: number;
  who_made?: string;
  when_made?: string;
  is_supply?: boolean;
  shipping_profile_id?: number;
  return_policy_id?: number;
  /** null = the source had no section (kept as "no section", not filled from defaults). */
  shop_section_id?: number | null;
  taxonomy_id?: number;
  processing_min?: number;
  processing_max?: number;
  item_weight?: number;
  item_weight_unit?: string;
  item_length?: number;
  item_width?: number;
  item_height?: number;
  item_dimensions_unit?: string;
  /**
   * Public https image URLs to start from (duplicate / cross-list). They are
   * staged as draft media with a sourceUrl; the server downloads them only when
   * the draft is synced (the user's explicit publish/sync), never from the browser.
   */
  imageUrls?: string[];
  /** Where the prefill came from, for the info banner. */
  source?: 'etsy' | 'ebay';
}

/** Keep only plain https URLs, de-duplicated, capped at Etsy's photo limit. */
function cleanImageUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== 'string') continue;
    const v = u.trim();
    if (!/^https:\/\//i.test(v) || v.length > 2048 || out.includes(v)) continue;
    out.push(v);
    if (out.length >= ETSY_MAX_IMAGES) break;
  }
  return out;
}

interface ListingCreatorDialogProps {
  open: boolean;
  onClose: () => void;
  shopId: string;
  shopSections: Array<{ shop_section_id: number; title: string }>;
  shippingProfiles: Array<{ shipping_profile_id: number; title: string }>;
  returnPolicies: Array<{ return_policy_id: number; description?: string }>;
  onCreated: (listingId: number, draftId?: string) => void;
  marketResearchData?: MarketResearchData | null;
  copySource?: CopySourceData | null;
  /** Shop currency (ISO 4217) — Etsy prices are always in the shop's currency. */
  currencyCode?: string | null;
}

interface TaxonomyNode {
  id: number;
  name: string;
  children?: TaxonomyNode[];
  parent_id?: number;
  level?: number;
}

interface FlatTaxonomy {
  id: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_KEYS = ['stepContent', 'stepCategoryPrice', 'stepImages', 'stepPreview'] as const;

const WHO_MADE_KEYS_CR = ['i_did', 'collective', 'someone_else'] as const;
const WHO_MADE_I18N_CR: Record<string, string> = { i_did: 'iDid', collective: 'collective', someone_else: 'someoneElse' };

// Verified against Etsy Open API v3 spec — see ETSY_WHEN_MADE_OPTIONS in lib/etsy/seoRules.
const WHEN_MADE_KEYS_CR = ETSY_WHEN_MADE_OPTIONS;

/** Read a File as raw base64 (no data: prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Local persistence (this device only — nothing here reaches Etsy)
// ---------------------------------------------------------------------------

/** Work-in-progress listing (form fields, not photos), per shop. */
const draftStorageKey = (shopId: string) => `kx.etsy.listingDraft.v1:${shopId || 'default'}`;
/** Last-used shipping profile / return policy / shop section, per shop. */
const defaultsStorageKey = (shopId: string) => `kx.etsy.lastListingDefaults.v1:${shopId || 'default'}`;

interface CreatorSnapshot {
  savedAt: number;
  activeStep: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  whoMade: string;
  whenMade: string;
  isSupply: boolean;
  selectedTaxonomy: FlatTaxonomy | null;
  price: string;
  quantity: string;
  shopSectionId: number | '';
  shippingProfileId: number | '';
  returnPolicyId: number | '';
  processingMin: string;
  processingMax: string;
  itemWeight: string;
  itemWeightUnit: string;
  itemLength: string;
  itemWidth: string;
  itemHeight: string;
  itemDimensionsUnit: string;
}

interface ListingDefaults {
  shippingProfileId?: number | '';
  returnPolicyId?: number | '';
  shopSectionId?: number | '';
}

function readStorage<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode — persistence is a convenience, never a requirement.
  }
}

function clearStorage(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function snapshotHasContent(s: Partial<CreatorSnapshot> | null | undefined): boolean {
  if (!s) return false;
  return Boolean(
    (s.title || '').trim() || (s.description || '').trim() || (s.tags?.length || 0) > 0 ||
    (s.materials?.length || 0) > 0 || s.selectedTaxonomy || (s.price || '').trim(),
  );
}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenTaxonomy(nodes: TaxonomyNode[], prefix = ''): FlatTaxonomy[] {
  const result: FlatTaxonomy[] = [];
  for (const node of nodes) {
    const label = prefix ? `${prefix} > ${node.name}` : node.name;
    result.push({ id: node.id, label });
    if (node.children && node.children.length > 0) {
      result.push(...flattenTaxonomy(node.children, label));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ListingCreatorDialog({
  open,
  onClose,
  shopId,
  shopSections,
  shippingProfiles,
  returnPolicies,
  onCreated,
  marketResearchData,
  copySource,
  currencyCode,
}: ListingCreatorDialogProps) {
  const t = useTranslations('etsy.creator');
  const tEtsy = useTranslations('etsy');
  const tAiErr = useTranslations('etsy.aiErrors');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [activeStep, setActiveStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  // Create & Publish: the staged draft is synced to Etsy right away.
  const [syncingToEtsy, setSyncingToEtsy] = useState(false);

  // Step 1 — Content
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [whoMade, setWhoMade] = useState('i_did');
  const [whenMade, setWhenMade] = useState('made_to_order');
  const [isSupply, setIsSupply] = useState(false);

  // Step 2 — Category & Price
  const [taxonomyOptions, setTaxonomyOptions] = useState<FlatTaxonomy[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);
  const [selectedTaxonomy, setSelectedTaxonomy] = useState<FlatTaxonomy | null>(null);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [shopSectionId, setShopSectionId] = useState<number | ''>('');
  const [shippingProfileId, setShippingProfileId] = useState<number | ''>('');
  const [returnPolicyId, setReturnPolicyId] = useState<number | ''>('');
  const [processingMin, setProcessingMin] = useState('');
  const [processingMax, setProcessingMax] = useState('');
  const [itemWeight, setItemWeight] = useState('');
  const [itemWeightUnit, setItemWeightUnit] = useState('g');
  const [itemLength, setItemLength] = useState('');
  const [itemWidth, setItemWidth] = useState('');
  const [itemHeight, setItemHeight] = useState('');
  const [itemDimensionsUnit, setItemDimensionsUnit] = useState('cm');

  // Step 3 — Images
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Photos imported by URL (duplicate / cross-list); staged as sourceUrl media.
  const [urlImages, setUrlImages] = useState<string[]>([]);
  const imageCount = urlImages.length + selectedFiles.length;
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI image generation
  const [aiImagePrompt, setAiImagePrompt] = useState('');
  const [aiImageRefFile, setAiImageRefFile] = useState<File | null>(null);
  const [aiImageRefPreview, setAiImageRefPreview] = useState<string | null>(null);
  const [aiImageGenerating, setAiImageGenerating] = useState(false);
  const [aiImageResult, setAiImageResult] = useState<{ base64: string; mimeType: string } | null>(null);
  const [aiImageFollowUp, setAiImageFollowUp] = useState('');
  // Plain white background only for the main product shot; lifestyle shots keep a styled scene.
  const [aiImageWhiteBg, setAiImageWhiteBg] = useState(true);
  const aiImageRefInputRef = useRef<HTMLInputElement>(null);

  // AI state
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiTagSuggestions, setAiTagSuggestions] = useState<string[]>([]);
  // Inline feedback for tags that were dropped (over 20 chars / over 13).
  const [tagFeedback, setTagFeedback] = useState<string[]>([]);

  /** Replace the tag list through the shared rules; over-long tags are dropped, not truncated. */
  const applyTags = useCallback((candidate: string[]) => {
    const { tags: next, dropped } = normalizeTags(candidate, { max: TAG_MAX_COUNT });
    setTagFeedback(dropped.filter((d) => d.reason === 'too_long' || d.reason === 'over_limit').map((d) => d.tag));
    setTags(next);
  }, []);

  // Quick-start
  const [quickStartKeyword, setQuickStartKeyword] = useState('');

  // --------------------------------------------------
  // Pre-fill from copy source when dialog opens
  // --------------------------------------------------
  useEffect(() => {
    if (!open || !copySource) return;
    // No "COPY - " prefix: dashes break the commas-only title rule (and validation).
    setTitle(copySource.title ? normalizeTitle(copySource.title).slice(0, TITLE_MAX) : '');
    setDescription(copySource.description || '');
    setTags(normalizeTags(copySource.tags || [], { max: TAG_MAX_COUNT }).tags);
    setMaterials(copySource.materials || []);
    if (copySource.price) setPrice(String(copySource.price));
    if (copySource.quantity) setQuantity(String(copySource.quantity));
    if (copySource.who_made) setWhoMade(copySource.who_made);
    if (copySource.when_made) setWhenMade(normalizeWhenMade(copySource.when_made) || 'made_to_order');
    if (copySource.is_supply !== undefined) setIsSupply(copySource.is_supply);
    if (copySource.shipping_profile_id) setShippingProfileId(copySource.shipping_profile_id);
    if (copySource.return_policy_id) setReturnPolicyId(copySource.return_policy_id);
    if (copySource.shop_section_id) setShopSectionId(copySource.shop_section_id);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? String(v) : '');
    if (num(copySource.processing_min)) setProcessingMin(num(copySource.processing_min));
    if (num(copySource.processing_max)) setProcessingMax(num(copySource.processing_max));
    if (num(copySource.item_weight)) {
      setItemWeight(num(copySource.item_weight));
      if (WEIGHT_UNITS.some((u) => u.value === copySource.item_weight_unit)) setItemWeightUnit(copySource.item_weight_unit as string);
    }
    if (num(copySource.item_length) || num(copySource.item_width) || num(copySource.item_height)) {
      setItemLength(num(copySource.item_length));
      setItemWidth(num(copySource.item_width));
      setItemHeight(num(copySource.item_height));
      if (DIMENSION_UNITS.some((u) => u.value === copySource.item_dimensions_unit)) setItemDimensionsUnit(copySource.item_dimensions_unit as string);
    }
    setUrlImages(cleanImageUrls(copySource.imageUrls));
    setActiveStep(0); // Start from step 1 so user can review
  }, [open, copySource]);

  // Pre-select the copied category once the taxonomy list is loaded.
  const copyTaxonomyId = open ? copySource?.taxonomy_id : undefined;
  useEffect(() => {
    if (!copyTaxonomyId || taxonomyOptions.length === 0) return;
    const match = taxonomyOptions.find((o) => o.id === Number(copyTaxonomyId));
    if (match) setSelectedTaxonomy((cur) => cur || match);
  }, [copyTaxonomyId, taxonomyOptions]);

  // --------------------------------------------------
  // Autosave to this device + "Restore unsaved listing?" offer
  // --------------------------------------------------
  const confirm = useConfirm();
  const tCommon = useTranslations('common');
  const [pendingRestore, setPendingRestore] = useState<CreatorSnapshot | null>(null);

  const snapshot: CreatorSnapshot = {
    savedAt: 0,
    activeStep, title, description, tags, materials, whoMade, whenMade, isSupply,
    selectedTaxonomy, price, quantity, shopSectionId, shippingProfileId, returnPolicyId,
    processingMin, processingMax, itemWeight, itemWeightUnit, itemLength, itemWidth,
    itemHeight, itemDimensionsUnit,
  };
  const snapshotJson = JSON.stringify(snapshot);
  const formHasContent = snapshotHasContent(snapshot) || imageCount > 0;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Offer the saved work when the dialog opens (a copy prefill takes precedence).
  useEffect(() => {
    if (!open) return;
    if (copySource) { setPendingRestore(null); return; }
    const saved = readStorage<CreatorSnapshot>(draftStorageKey(shopId));
    setPendingRestore(saved && snapshotHasContent(saved) ? saved : null);
  }, [open, shopId, copySource]);

  // Debounced autosave while open. Paused while the restore offer is pending so
  // a stray keystroke can't overwrite the saved listing before the user decides.
  // A copy/cross-list prefill is never written to this device: it would
  // overwrite the user's own unsaved new listing under the same per-shop key.
  const isCopySession = Boolean(copySource);
  useEffect(() => {
    // Also paused while creating, so a late write can't resurrect a listing just staged.
    if (!open || creating || isCopySession || pendingRestore || !snapshotHasContent(snapshotRef.current)) return;
    const id = setTimeout(() => {
      writeStorage(draftStorageKey(shopId), { ...snapshotRef.current, savedAt: Date.now() });
    }, 800);
    return () => clearTimeout(id);
  }, [open, shopId, creating, isCopySession, pendingRestore, snapshotJson]);

  // Typing a new listing while the offer is unanswered counts as "Start fresh":
  // drop the offer so autosave resumes and the new work is kept (and the close
  // confirm's "stays on this device" stays true).
  useEffect(() => {
    if (!open || creating || !pendingRestore || !snapshotHasContent(snapshotRef.current)) return;
    setPendingRestore(null);
    toast(t('restore.replacedByEdit'), { icon: '\u2139\uFE0F' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, creating, pendingRestore, snapshotJson]);

  const handleRestore = () => {
    const saved = pendingRestore;
    if (!saved) return;
    setActiveStep(Math.min(Math.max(Number(saved.activeStep) || 0, 0), 2));
    setTitle(saved.title || '');
    setDescription(saved.description || '');
    setTags(normalizeTags(saved.tags || [], { max: TAG_MAX_COUNT }).tags);
    setMaterials(Array.isArray(saved.materials) ? saved.materials : []);
    setWhoMade(saved.whoMade || 'i_did');
    setWhenMade(normalizeWhenMade(saved.whenMade) || 'made_to_order');
    setIsSupply(Boolean(saved.isSupply));
    setSelectedTaxonomy(saved.selectedTaxonomy || null);
    setPrice(saved.price || '');
    setQuantity(saved.quantity || '1');
    const sectionOk = saved.shopSectionId === '' || shopSections.some((x) => x.shop_section_id === saved.shopSectionId);
    if (sectionOk && saved.shopSectionId !== undefined) setShopSectionId(saved.shopSectionId);
    if (saved.shippingProfileId && shippingProfiles.some((x) => x.shipping_profile_id === saved.shippingProfileId)) {
      setShippingProfileId(saved.shippingProfileId);
    }
    if (saved.returnPolicyId && returnPolicies.some((x) => x.return_policy_id === saved.returnPolicyId)) {
      setReturnPolicyId(saved.returnPolicyId);
    }
    setProcessingMin(saved.processingMin || '');
    setProcessingMax(saved.processingMax || '');
    setItemWeight(saved.itemWeight || '');
    setItemWeightUnit(saved.itemWeightUnit || 'g');
    setItemLength(saved.itemLength || '');
    setItemWidth(saved.itemWidth || '');
    setItemHeight(saved.itemHeight || '');
    setItemDimensionsUnit(saved.itemDimensionsUnit || 'cm');
    setPendingRestore(null);
    toast.success(t('restore.restored'));
  };

  const handleDiscardRestore = () => {
    clearStorage(draftStorageKey(shopId));
    setPendingRestore(null);
  };

  // --------------------------------------------------
  // Defaults: shipping profile / return policy / shop section.
  // One option → pick it. Otherwise → the last one used for this shop.
  // Stable id keys, not the array props, drive the effect.
  // --------------------------------------------------
  const shippingKey = shippingProfiles.map((p) => p.shipping_profile_id).join(',');
  const returnKey = returnPolicies.map((p) => p.return_policy_id).join(',');
  const sectionKey = shopSections.map((p) => p.shop_section_id).join(',');

  // A copy prefill sets its own ids first; these updaters keep any valid one
  // and only fill the gaps (e.g. an eBay cross-list carries no Etsy profiles).
  useEffect(() => {
    if (!open) return;
    const last = readStorage<ListingDefaults>(defaultsStorageKey(shopId)) || {};
    const ids = (key: string) => (key ? key.split(',').map(Number) : []);
    const shipIds = ids(shippingKey);
    const retIds = ids(returnKey);
    const secIds = ids(sectionKey);

    setShippingProfileId((cur) => {
      if (cur !== '' && shipIds.includes(cur)) return cur;
      if (shipIds.length === 1) return shipIds[0];
      return typeof last.shippingProfileId === 'number' && shipIds.includes(last.shippingProfileId) ? last.shippingProfileId : cur;
    });
    setReturnPolicyId((cur) => {
      if (cur !== '' && retIds.includes(cur)) return cur;
      if (retIds.length === 1) return retIds[0];
      return typeof last.returnPolicyId === 'number' && retIds.includes(last.returnPolicyId) ? last.returnPolicyId : cur;
    });
    // The section is optional: a remembered "no section" is respected.
    const copyHasNoSection = copySource?.shop_section_id === null;
    setShopSectionId((cur) => {
      if (cur !== '') return cur;
      // A duplicated listing that had no section stays without one.
      if (copyHasNoSection) return '';
      if ('shopSectionId' in last) {
        return typeof last.shopSectionId === 'number' && secIds.includes(last.shopSectionId) ? last.shopSectionId : '';
      }
      return secIds.length === 1 ? secIds[0] : cur;
    });
  }, [open, shopId, copySource, shippingKey, returnKey, sectionKey]);

  // --------------------------------------------------
  // Fetch taxonomy on open
  // --------------------------------------------------
  useEffect(() => {
    if (open && taxonomyOptions.length === 0) {
      setTaxonomyLoading(true);
      fetch(`/api/clawd/etsy?action=taxonomy&shop_id=${shopId}`)
        .then((res) => res.json())
        .then((data) => {
          const nodes: TaxonomyNode[] = data.results || data;
          const flat = flattenTaxonomy(Array.isArray(nodes) ? nodes : []);
          setTaxonomyOptions(flat);
        })
        .catch(() => {
          toast.error(t('categoryLoadFailed'));
        })
        .finally(() => setTaxonomyLoading(false));
    }
  }, [open, shopId, taxonomyOptions.length]);

  // Generate previews for selected files
  useEffect(() => {
    const urls = selectedFiles.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [selectedFiles]);

  // --------------------------------------------------
  // AI helper
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
    setAiLoading((prev) => ({ ...prev, [action]: true }));
    try {
      const currentTitle = overrides?.title ?? title;
      const payload: Record<string, any> = {
        action,
        title: currentTitle,
        description: overrides?.description ?? description,
        tags: overrides?.tags ?? tags,
        tags_current: overrides?.tags_current ?? tags,
        materials,
        price,
        category: selectedTaxonomy?.label || undefined,
        ...(overrides?.mode ? { mode: overrides.mode } : {}),
      };

      // Use prop research data, local cache, or auto-fetch
      let research = marketResearchData
        ? { query: marketResearchData.query, topTags: marketResearchData.topTags.slice(0, 20), topKeywords: marketResearchData.topKeywords.slice(0, 15), priceStats: marketResearchData.priceStats }
        : localResearchRef.current;

      if (!research && currentTitle.trim().length >= 10) {
        const searchQuery = currentTitle.split(',')[0].trim().substring(0, 60);
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
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new AiRequestError(aiErrorCode(data));
      if (!data || typeof data !== 'object') throw new AiRequestError('invalid_ai_response');
      return data;
    } catch (err: any) {
      toast.error(err instanceof AiRequestError && err.code ? tAiErr(err.code) : t('aiRequestFailed'));
      return null;
    } finally {
      setAiLoading((prev) => ({ ...prev, [action]: false }));
    }
  }, [title, description, tags, materials, price, marketResearchData, selectedTaxonomy, fetchQuickResearch]);

  const handleAIOptimizeTitle = useCallback(async () => {
    const result = await callAI('optimize_title');
    if (!result) return;
    const newTitle = normalizeTitle(result.optimized_title);
    if (!newTitle) {
      toast.error(t('aiBrokenTitle'));
      return;
    }
    setTitle(newTitle.slice(0, TITLE_MAX));
    toast.success(t('titleOptimized'));
  }, [callAI]);

  const handleAIGenerateDescription = useCallback(async () => {
    const result = await callAI('generate_description');
    if (typeof result?.description === 'string' && result.description.trim()) {
      setDescription(result.description);
      toast.success(t('descriptionCreated'));
    }
  }, [callAI]);

  const handleAISuggestTags = useCallback(async () => {
    const result = await callAI('suggest_tags', { mode: 'add' });
    if (!result) return;
    const { tags: suggested } = normalizeTags(result.suggestions, { title, dropTitleOverlap: true });
    if (suggested.length > 0) {
      setAiTagSuggestions(suggested);
      toast.success(t('tagSuggestionsReceived', { count: suggested.length }));
    } else {
      toast.error(tAiErr('ai_tags_failed'));
    }
  }, [callAI]);

  // --------------------------------------------------
  // Quick-start: AI generates title + description + tags from a keyword
  // --------------------------------------------------
  const handleQuickStart = useCallback(async () => {
    const keyword = quickStartKeyword.trim();
    if (!keyword) {
      toast.error(t('enterProductIdea'));
      return;
    }
    setAiLoading((prev) => ({ ...prev, quick_start: true }));
    try {
      // 1. Generate optimized title from keyword
      const titleResult = await callAI('optimize_title', { title: keyword });
      const newTitle = normalizeTitle(titleResult?.optimized_title) || normalizeTitle(keyword);
      setTitle(newTitle.slice(0, TITLE_MAX));

      // 2. Generate description
      const descResult = await callAI('generate_description', { title: newTitle });
      if (typeof descResult?.description === 'string' && descResult.description.trim()) setDescription(descResult.description);

      // 3. Suggest tags
      const tagResult = await callAI('suggest_tags', { title: newTitle, tags_current: [], mode: 'replace' });
      const { tags: suggested } = normalizeTags(tagResult?.suggestions, { title: newTitle, dropTitleOverlap: true });
      if (suggested.length > 0) setTags(suggested);

      toast.success(t('aiContentCreated'));
    } catch {
      toast.error(t('aiContentFailed'));
    } finally {
      setAiLoading((prev) => ({ ...prev, quick_start: false }));
    }
  }, [quickStartKeyword, callAI, t]);

  // --------------------------------------------------
  // Reset
  // --------------------------------------------------
  const resetForm = useCallback(() => {
    setActiveStep(0);
    setTitle('');
    setDescription('');
    setTags([]);
    setMaterials([]);
    setWhoMade('i_did');
    setWhenMade('made_to_order');
    setIsSupply(false);
    setSelectedTaxonomy(null);
    setPrice('');
    setQuantity('1');
    setShopSectionId('');
    setShippingProfileId('');
    setReturnPolicyId('');
    setProcessingMin('');
    setProcessingMax('');
    setItemWeight('');
    setItemWeightUnit('g');
    setItemLength('');
    setItemWidth('');
    setItemHeight('');
    setItemDimensionsUnit('cm');
    setSelectedFiles([]);
    setUrlImages([]);
    setCreating(false);
    setSyncingToEtsy(false);
    setUploadProgress(0);
    setUploadTotal(0);
    setAiTagSuggestions([]);
    setQuickStartKeyword('');
    setAiImagePrompt('');
    setAiImageRefFile(null);
    setAiImageRefPreview(null);
    setAiImageResult(null);
    setAiImageFollowUp('');
    setAiImageWhiteBg(true);
    setTagFeedback([]);
    setPendingRestore(null);
  }, []);

  const handleClose = async () => {
    if (creating) return;
    if (formHasContent) {
      const ok = await confirm({
        title: t('closeConfirm.title'),
        description: isCopySession
          ? t('closeConfirm.descriptionCopy')
          : imageCount > 0 ? t('closeConfirm.descriptionWithPhotos') : t('closeConfirm.description'),
        confirmLabel: tCommon('close'),
        cancelLabel: t('closeConfirm.keepEditing'),
      });
      if (!ok) return;
      // Flush the latest state so the debounce can't drop the last edits.
      if (!isCopySession && !pendingRestore && snapshotHasContent(snapshotRef.current)) {
        writeStorage(draftStorageKey(shopId), { ...snapshotRef.current, savedAt: Date.now() });
      }
    }
    resetForm();
    onClose();
  };

  // --------------------------------------------------
  // Validation
  // --------------------------------------------------
  /** Toast the first title-rule problem; returns false if the title can't be saved. */
  const validateTitleRules = (strict: boolean): boolean => {
    const tc = checkTitle(title.trim());
    if (tc.issues.includes('empty')) { toast.error(t('titleRequired')); return false; }
    if (tc.issues.includes('too_long')) { toast.error(t('titleTooLong', { max: TITLE_MAX, count: tc.length })); return false; }
    if (tc.issues.includes('bad_first_char')) { toast.error(t('titleBadFirstChar')); return false; }
    if (tc.issues.includes('disallowed_separator')) { toast.error(t('titleCommasOnly')); return false; }
    if (strict) {
      if (tc.issues.includes('too_short')) { toast.error(t('titleTooShort', { min: TITLE_MIN, max: TITLE_MAX, count: tc.length })); return false; }
      if (tc.issues.includes('repeated_words')) { toast.error(t('titleRepeatedWords', { words: tc.repeatedWords.join(', ') })); return false; }
      if (tc.issues.includes('keyword_stacking')) { toast.error(t('titleKeywordStacking')); return false; }
    }
    return true;
  };

  /** Toast the first tag-rule problem; returns false if tags break the rules. */
  const validateTagRules = (): boolean => {
    const tg = checkTags(tags, title.trim());
    if (tg.issues.includes('too_many')) { toast.error(t('maxTagsTrimmed')); return false; }
    if (tg.tooLong.length) { toast.error(t('tagsTooLong', { max: TAG_MAX_LEN, tags: tg.tooLong.join(', ') })); return false; }
    if (tg.duplicates.length) { toast.error(t('tagsDuplicate', { tags: tg.duplicates.map(([a, b]) => `${a} ≈ ${b}`).join(', ') })); return false; }
    if (tg.overlapping.length) { toast.error(t('tagsOverlapTitle', { tags: tg.overlapping.map((o) => o.tag).join(', ') })); return false; }
    return true;
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        if (!validateTitleRules(false)) return false;
        if (!description.trim()) {
          toast.error(t('descriptionRequired'));
          return false;
        }
        if (description.trim().length < 10) {
          toast.error(t('descriptionMinLength'));
          return false;
        }
        if (!validateTagRules()) return false;
        if (!(ETSY_WHEN_MADE_OPTIONS as readonly string[]).includes(whenMade)) {
          toast.error(t('whenMadeInvalid'));
          return false;
        }
        return true;
      case 1:
        if (!selectedTaxonomy) {
          toast.error(t('categoryRequired'));
          return false;
        }
        if (!price || parseFloat(price) <= 0) {
          toast.error(t('validPriceRequired'));
          return false;
        }
        if (!shippingProfileId) {
          toast.error(t('shippingProfileRequired'));
          return false;
        }
        if (!returnPolicyId) {
          toast.error(t('returnPolicyRequired'));
          return false;
        }
        if (processingMin && processingMax && Number(processingMin) > Number(processingMax)) {
          toast.error(t('minGreaterThanMax'));
          return false;
        }
        return true;
      case 2:
        return true;
      default:
        return true;
    }
  };

  /** A queued publish must satisfy every listing rule, including at least one photo. */
  const validateForPublish = (): boolean => {
    if (!validateStep(0) || !validateStep(1)) return false;
    if (!validateTitleRules(true)) return false;
    if (tags.length < 1) { toast.error(t('tagsRequiredForPublish')); return false; }
    if (imageCount === 0) { toast.error(t('imageRequiredForPublish')); return false; }
    return true;
  };

  const handleNext = () => {
    if (validateStep(activeStep)) {
      setActiveStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  // --------------------------------------------------
  // File handling
  // --------------------------------------------------
  // --------------------------------------------------
  // AI Image Generation (for new listings)
  // --------------------------------------------------
  /**
   * Generate an AI image. `promptOverride` avoids the stale-state bug where
   * setAiImagePrompt() + generate() would still send the previous prompt.
   * `refine` sends the previous AI result as the first reference so a
   * follow-up edits that image instead of starting over.
   */
  const handleAiImageGenerate = async (opts?: { promptOverride?: string; refine?: boolean }) => {
    const promptText = (opts?.promptOverride ?? aiImagePrompt).trim();
    if (!promptText) {
      toast.error(t('enterPrompt'));
      return;
    }

    const previous = opts?.refine ? aiImageResult : null;
    setAiImageGenerating(true);
    setAiImageResult(null);
    try {
      const references: Array<{ data: string; mime_type: string }> = [];
      if (previous) references.push({ data: previous.base64, mime_type: previous.mimeType });
      if (aiImageRefFile) references.push({ data: await fileToBase64(aiImageRefFile), mime_type: aiImageRefFile.type });
      // The seller's own product photos keep the AI on-product (max 3 refs total, ≤ 5MB each).
      for (const f of selectedFiles) {
        if (references.length >= 3) break;
        if (f.size > 5 * 1024 * 1024 || f.name.startsWith('ai-generated-')) continue;
        references.push({ data: await fileToBase64(f), mime_type: f.type });
      }

      const res = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          marketplace: 'etsy',
          aspect_ratio: '4:3',
          white_background: aiImageWhiteBg,
          reference_images: references,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new AiRequestError(aiErrorCode(data));
      if (typeof data?.image_base64 !== 'string' || !data.image_base64) throw new AiRequestError('ai_image_failed');
      setAiImageResult({ base64: data.image_base64, mimeType: data.mime_type || 'image/jpeg' });
      toast.success(t('imageCreated'));
    } catch (err: any) {
      // Keep the previous result visible if a refinement fails.
      if (previous) setAiImageResult(previous);
      toast.error(err instanceof AiRequestError && err.code ? tAiErr(err.code) : t('aiImageError'));
    } finally {
      setAiImageGenerating(false);
    }
  };

  /** Follow-up: refine the current AI image with extra instructions, or re-roll the same prompt. */
  const handleAiImageFollowUp = () => {
    const extra = aiImageFollowUp.trim();
    if (extra) {
      const nextPrompt = `${aiImagePrompt.trim()}. Additional changes: ${extra}`;
      setAiImagePrompt(nextPrompt);
      setAiImageFollowUp('');
      handleAiImageGenerate({ promptOverride: nextPrompt, refine: true });
    } else {
      handleAiImageGenerate();
    }
  };

  const handleAiImageAccept = () => {
    if (!aiImageResult) return;
    if (imageCount >= ETSY_MAX_IMAGES) { toast.error(t('maxImages', { max: ETSY_MAX_IMAGES })); return; }

    // Convert base64 to File
    const byteStr = atob(aiImageResult.base64);
    const arr = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
    const blob = new Blob([arr], { type: aiImageResult.mimeType });
    const ext = aiImageResult.mimeType === 'image/png' ? 'png' : 'jpg';
    const file = new File([blob], `ai-generated-${Date.now()}.${ext}`, { type: aiImageResult.mimeType });

    setSelectedFiles((prev) => [...prev, file]);
    setAiImageResult(null);
    setAiImagePrompt('');
    toast.success(t('aiImageAdded'));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles = Array.from(files);
    const total = imageCount + newFiles.length;
    if (total > ETSY_MAX_IMAGES) {
      toast.error(t('maxImages', { max: ETSY_MAX_IMAGES }));
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const validFiles = newFiles.filter((f) => {
      if (!validTypes.includes(f.type)) {
        toast.error(t('unsupportedFormatFile', { name: f.name }));
        return false;
      }
      return true;
    });

    setSelectedFiles((prev) => [...prev, ...validFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeUrlImage = (index: number) => {
    setUrlImages((prev) => prev.filter((_, i) => i !== index));
  };

  // --------------------------------------------------
  // Create listing
  // --------------------------------------------------
  const handleCreate = async (publish: boolean) => {
    if (publish ? !validateForPublish() : (!validateStep(0) || !validateStep(1))) return;
    setCreating(true);
    try {
      const localDraftListingId = -Date.now();
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        tags,
        materials,
        who_made: whoMade,
        when_made: whenMade,
        is_supply: isSupply,
        taxonomy_id: selectedTaxonomy!.id,
        price: parseFloat(price),
        // Etsy always prices in the shop's currency; only send it when known.
        ...(currencyCode ? { currency_code: currencyCode } : {}),
        quantity: parseInt(quantity) || 1,
        shipping_profile_id: shippingProfileId,
        return_policy_id: returnPolicyId,
      };
      if (shopSectionId) body.shop_section_id = shopSectionId;
      if (processingMin) body.processing_min = Number(processingMin);
      if (processingMax) body.processing_max = Number(processingMax);
      if (itemWeight) {
        body.item_weight = parseFloat(itemWeight);
        body.item_weight_unit = itemWeightUnit;
      }
      if (itemLength || itemWidth || itemHeight) {
        if (itemLength) body.item_length = parseFloat(itemLength);
        if (itemWidth) body.item_width = parseFloat(itemWidth);
        if (itemHeight) body.item_height = parseFloat(itemHeight);
        body.item_dimensions_unit = itemDimensionsUnit;
      }

      const draft = await stageEtsyDraft({
        shopId,
        listingId: localDraftListingId,
        fields: body,
        queuedActions: [{ type: 'create_listing', payload: body }, ...(publish ? [{ type: 'publish' }] : [])],
      });

      // The listing now lives in a DB draft: drop the device copy, remember the picks.
      // A copy session never wrote the device copy, so it leaves the user's own one alone.
      if (!isCopySession) clearStorage(draftStorageKey(shopId));
      writeStorage(defaultsStorageKey(shopId), {
        shippingProfileId,
        returnPolicyId,
        shopSectionId,
      } satisfies ListingDefaults);

      // Imported photos first (they keep the source listing's order), staged by
      // URL only: the server downloads them when this draft is synced.
      let stagedImages = 0;
      const totalImages = urlImages.length + selectedFiles.length;
      if (urlImages.length > 0) {
        try {
          await stageEtsyDraft({
            shopId,
            listingId: localDraftListingId,
            media: urlImages.map((sourceUrl, i) => ({ kind: 'image', operation: 'upload', sourceUrl, rank: i + 1 })),
          });
          stagedImages += urlImages.length;
        } catch (err: any) {
          const reason = err?.key && tEtsy.has(err.key) ? tEtsy(err.key, err.params || {}) : '';
          toast.error(reason ? `${t('importedImagesFailed')} ${reason}` : t('importedImagesFailed'));
        }
      }

      // Upload images
      if (selectedFiles.length > 0) {
        setUploadTotal(selectedFiles.length);
        for (let i = 0; i < selectedFiles.length; i++) {
          setUploadProgress(i + 1);
          const file = selectedFiles[i];

          try {
            await stageEtsyDraftFile({
              shopId,
              listingId: localDraftListingId,
              file,
              kind: 'image',
              operation: 'upload',
              rank: urlImages.length + i + 1,
            });
            stagedImages++;
          } catch {
            toast.error(t('imageUploadFailed', { index: i + 1 }));
          }
        }
      }

      // "Save as Draft" only stages; the draft is listed on the listings page
      // and goes to Etsy when the user syncs it there. If any picked photo
      // failed to stage, don't go live with fewer photos than chosen: keep it
      // a local draft the user can fix and sync from the pinned row.
      if (!publish || !draft?.id || stagedImages === 0 || stagedImages < totalImages) {
        toast.success(t(publish ? 'draftSavedPublish' : 'draftSavedCreate'));
        onCreated(localDraftListingId, draft?.id);
        resetForm();
        onClose();
        return;
      }

      // "Create & Publish" is the explicit go-live action: sync this draft now.
      setSyncingToEtsy(true);
      let createdListingId = localDraftListingId;
      try {
        const result = await syncEtsyDraft(draft.id);
        if (result?.etsyListingId) createdListingId = Number(result.etsyListingId);
        toast.success(t('publishedOnEtsy'));
        const warnings: any[] = Array.isArray(result?.warnings) ? result.warnings : [];
        if (warnings.length > 0) {
          const details = warnings
            .map((w) => (w?.key && tEtsy.has(w.key) ? tEtsy(w.key, w.params || {}) : w?.message))
            .filter(Boolean)
            .join(' • ');
          toast(tEtsy('draftSync.syncedWithWarnings', { details }), { icon: '⚠️', duration: 10000 });
        }
      } catch (syncErr: any) {
        // The draft is kept (status failed) and shown as a pinned row on the
        // listings page, where the user can fix it and retry.
        const reason = syncErr?.key && tEtsy.has(syncErr.key)
          ? tEtsy(syncErr.key, syncErr.params || {})
          : (syncErr?.message || t('errorOccurred'));
        toast.error(t('publishSyncFailed', { error: reason }), { duration: 10000 });
      }

      onCreated(createdListingId, draft.id);
      resetForm();
      onClose();
    } catch (err: any) {
      console.error('[ListingCreator] create failed:', err);
      toast.error(t('errorOccurred'));
    } finally {
      setCreating(false);
    }
  };

  // --------------------------------------------------
  // Render helpers
  // --------------------------------------------------
  const isAnyAILoading = Object.values(aiLoading).some(Boolean);
  const STEPS = STEP_KEYS.map((k) => t(k));

  const whoMadeLabel = WHO_MADE_I18N_CR[whoMade] ? tEtsy(`whoMade.${WHO_MADE_I18N_CR[whoMade]}`) : whoMade;
  const whenMadeLabel = (ETSY_WHEN_MADE_OPTIONS as readonly string[]).includes(whenMade) ? tEtsy(`whenMade.${whenMadeLabelKey(whenMade)}`) : whenMade;

  // ================================================================
  // Step 1: Content & AI
  // ================================================================
  const renderStep1 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* ---- Quick Start with AI ---- */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          bgcolor: 'primary.50',
          borderColor: 'primary.200',
          background: 'linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 100%)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <RocketLaunchIcon sx={{ color: 'primary.main', fontSize: 20 }} />
          <Typography variant="subtitle2" color="primary.main">
            {t('aiQuickStart')}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {t('aiQuickStartDesc')}
          {marketResearchData ? ` ${t('marketDataWillBeUsed')}` : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t('quickStartPlaceholder')}
            value={quickStartKeyword}
            onChange={(e) => setQuickStartKeyword(e.target.value)}
            disabled={!!aiLoading.quick_start}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !aiLoading.quick_start) {
                e.preventDefault();
                handleQuickStart();
              }
            }}
          />
          <Button
            variant="contained"
            size="small"
            onClick={handleQuickStart}
            disabled={!!aiLoading.quick_start || !quickStartKeyword.trim()}
            startIcon={aiLoading.quick_start ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
            sx={{ whiteSpace: 'nowrap', minWidth: 120 }}
          >
            {aiLoading.quick_start ? t('creating') : t('fillWithAI')}
          </Button>
        </Box>
      </Paper>

      {/* ---- Market Research Context Banner ---- */}
      {marketResearchData && (
        <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
          <Typography variant="caption" fontWeight={600}>
            {t('marketData')}: &quot;{marketResearchData.query}&quot;
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {marketResearchData.topTags.slice(0, 8).map((tagItem) => (
              <Chip
                key={tagItem.tag}
                label={`${tagItem.tag} (${tagItem.pct}%)`}
                size="small"
                variant="outlined"
                sx={{ fontSize: '0.82rem', height: 26, cursor: 'pointer' }}
                onClick={() => {
                  if (tags.length < TAG_MAX_COUNT && !tags.includes(tagItem.tag)) {
                    if (tagItem.tag.length > TAG_MAX_LEN) { toast.error(t('tagsTooLong', { max: TAG_MAX_LEN, tags: tagItem.tag })); return; }
                    applyTags([...tags, tagItem.tag]);
                    toast.success(t('tagAdded', { tag: tagItem.tag }));
                  }
                }}
              />
            ))}
          </Box>
          {marketResearchData.priceStats && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {t('priceRange', { min: marketResearchData.priceStats.min, max: marketResearchData.priceStats.max, avg: marketResearchData.priceStats.avg })}
            </Typography>
          )}
        </Alert>
      )}

      <Divider />

      {/* ---- Title ---- */}
      <Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            label={t('titleLabel')}
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 140))}
            required
            fullWidth
            helperText={t('titleHelperText', { count: title.length })}
            error={title.length > 0 && checkTitle(title).issues.some((i) => i === 'disallowed_separator' || i === 'bad_first_char')}
            inputProps={{ maxLength: 140 }}
          />
          <Tooltip title={t('optimizeTitleAI')}>
            <span>
              <IconButton
                onClick={handleAIOptimizeTitle}
                disabled={!!aiLoading.optimize_title || !title.trim()}
                color="primary"
                sx={{ mt: 1 }}
  >
                {aiLoading.optimize_title ? <CircularProgress size={20} /> : <AutoFixHighIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* ---- Description ---- */}
      <Box>
        <TextField
          label={t('descriptionLabel')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          fullWidth
          multiline
          minRows={4}
          helperText={t('descriptionHelperText', { count: description.length })}
        />
        <Button
          size="small"
          startIcon={aiLoading.generate_description ? <CircularProgress size={14} /> : <AutoFixHighIcon />}
          onClick={handleAIGenerateDescription}
          disabled={!!aiLoading.generate_description || !title.trim()}
          sx={{ mt: 0.5, textTransform: 'none' }}
        >
          {t('generateDescriptionAI')}
        </Button>
      </Box>

      {/* ---- Tags ---- */}
      <Box>
        <Autocomplete
          multiple
          freeSolo
          options={[]}
          value={tags}
          onChange={(_, newVal) => {
            const expanded = newVal.flatMap((v) =>
              typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [v]
            );
            applyTags(expanded as string[]);
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip
                {...getTagProps({ index })}
                key={option}
                label={option}
                size="small"
                color={option.length > TAG_MAX_LEN ? 'error' : undefined}
              />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('tagsLabel')}
              helperText={tagFeedback.length > 0
                ? t('tagsDroppedFeedback', { max: TAG_MAX_LEN, tags: tagFeedback.join(', ') })
                : t('tagsHelperText', { count: tags.length })}
              error={tagFeedback.length > 0}
              onKeyDown={(e) => {
                if (e.key === ',') {
                  e.preventDefault();
                  const input = (e.target as HTMLInputElement).value.trim();
                  if (input) {
                    applyTags([...tags, ...splitCommaList(input)]);
                    const autocompleteInput = (e.target as HTMLInputElement);
                    autocompleteInput.value = '';
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
                  applyTags([...tags, ...splitCommaList(pasted)]);
                }
              }}
            />
          )}
        />
        <Button
          size="small"
          startIcon={aiLoading.suggest_tags ? <CircularProgress size={14} /> : <AutoFixHighIcon />}
          onClick={handleAISuggestTags}
          disabled={!!aiLoading.suggest_tags || !title.trim()}
          sx={{ mt: 0.5, textTransform: 'none' }}
        >
          {t('suggestTagsAI')}
        </Button>

        {/* AI Tag Suggestions */}
        {aiTagSuggestions.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {t('suggestedTags')}:
              </Typography>
              <Button
                size="small"
                onClick={() => {
                  const { tags: merged } = normalizeTags([...tags, ...aiTagSuggestions], { max: TAG_MAX_COUNT });
                  setTags(merged);
                  setAiTagSuggestions([]);
                  toast.success(t('tagsAdded', { count: Math.max(0, merged.length - tags.length) }));
                }}
                disabled={aiTagSuggestions.every((tag) => tags.includes(tag))}
                sx={{ textTransform: 'none', fontSize: '0.85rem', py: 0, minWidth: 0 }}
              >
                {t('addAllTags')}
              </Button>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {aiTagSuggestions.map((tag) => {
                const alreadyExists = tags.includes(tag);
                const isFull = tags.length >= TAG_MAX_COUNT;
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
                        : () => applyTags([...tags, tag])
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

      {/* ---- Materials ---- */}
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={materials}
        onChange={(_, newVal) => {
          if (newVal.length <= 13) setMaterials(newVal as string[]);
          else toast.error(t('maxMaterials'));
        }}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option}
              label={option}
              size="small"
            />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={t('materialsLabel')}
            helperText={t('materialsHelperText', { count: materials.length })}
          />
        )}
      />

      {/* ---- Who/When/Supply ---- */}
      <FormControl fullWidth required>
        <InputLabel>{t('whoMadeLabel')}</InputLabel>
        <Select
          value={whoMade}
          label={t('whoMadeLabel')}
          onChange={(e) => setWhoMade(e.target.value)}
        >
          {WHO_MADE_KEYS_CR.map((val) => (
            <MenuItem key={val} value={val}>
              {tEtsy(`whoMade.${WHO_MADE_I18N_CR[val]}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl fullWidth required>
        <InputLabel>{t('whenMadeLabel')}</InputLabel>
        <Select
          value={whenMade}
          label={t('whenMadeLabel')}
          onChange={(e) => setWhenMade(e.target.value)}
        >
          {WHEN_MADE_KEYS_CR.map((val) => (
            <MenuItem key={val} value={val}>
              {tEtsy(`whenMade.${whenMadeLabelKey(val)}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControlLabel
        control={
          <Switch
            checked={isSupply}
            onChange={(e) => setIsSupply(e.target.checked)}
          />
        }
        label={t('isSupply')}
      />

      {/* ---- Live SEO Indicator ---- */}
      {(title || tags.length > 0) && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <SEOIndicator tags={tags} title={title} description={description} />
        </Paper>
      )}
    </Box>
  );

  // ================================================================
  // Step 2: Category & Price
  // ================================================================
  const renderStep2 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Autocomplete
        options={taxonomyOptions}
        getOptionLabel={(opt) => opt.label}
        value={selectedTaxonomy}
        onChange={(_, newVal) => setSelectedTaxonomy(newVal)}
        loading={taxonomyLoading}
        renderInput={(params) => (
          <TextField
            {...params}
            label={t('categoryLabel')}
            required
            helperText={t('categoryHelperText')}
          />
        )}
        isOptionEqualToValue={(opt, val) => opt.id === val.id}
        noOptionsText={t('categoryNotFound')}
        loadingText={t('loading')}
      />

      {/* Price with market hint */}
      <Box>
        <TextField
          label={t('priceLabel')}
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
          fullWidth
          inputProps={{ min: 0, step: '0.01' }}
        />
        {marketResearchData?.priceStats && !price && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {t('marketAvgPrice', { avg: marketResearchData.priceStats.avg, min: marketResearchData.priceStats.min, max: marketResearchData.priceStats.max })}
          </Typography>
        )}
      </Box>

      <TextField
        label={t('quantityLabel')}
        type="number"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        fullWidth
        inputProps={{ min: 1 }}
      />

      <FormControl fullWidth>
        <InputLabel>{t('shopSectionLabel')}</InputLabel>
        <Select
          value={shopSectionId}
          label={t('shopSectionLabel')}
          onChange={(e) => setShopSectionId(e.target.value as number | '')}
        >
          <MenuItem value="">
            <em>{t('noSelection')}</em>
          </MenuItem>
          {shopSections.map((s) => (
            <MenuItem key={s.shop_section_id} value={s.shop_section_id}>
              {s.title}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth required>
        <InputLabel>{t('shippingProfileLabel')}</InputLabel>
        <Select
          value={shippingProfileId}
          label={t('shippingProfileLabel')}
          onChange={(e) => setShippingProfileId(e.target.value as number)}
        >
          {shippingProfiles.map((s) => (
            <MenuItem key={s.shipping_profile_id} value={s.shipping_profile_id}>
              {s.title}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {shippingProfiles.length === 0 && (
        <Typography variant="caption" color="warning.main">
          {t('loadFailed')}
        </Typography>
      )}

      <FormControl fullWidth required>
        <InputLabel>{t('returnPolicyLabel')}</InputLabel>
        <Select
          value={returnPolicyId}
          label={t('returnPolicyLabel')}
          onChange={(e) => setReturnPolicyId(e.target.value as number)}
        >
          {returnPolicies.map((r) => (
            <MenuItem key={r.return_policy_id} value={r.return_policy_id}>
              {r.description || `${t('policy')} #${r.return_policy_id}`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {returnPolicies.length === 0 && (
        <Typography variant="caption" color="warning.main">
          {t('loadFailed')}
        </Typography>
      )}

      <Divider sx={{ my: 0.5 }} />

      {/* Processing time */}
      <Typography variant="subtitle2" color="text.secondary">{t('processingTime')}</Typography>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label={t('minLabel')}
          type="number"
          value={processingMin}
          onChange={(e) => setProcessingMin(e.target.value)}
          fullWidth
          inputProps={{ min: 1 }}
          size="small"
        />
        <TextField
          label={t('maxLabel')}
          type="number"
          value={processingMax}
          onChange={(e) => setProcessingMax(e.target.value)}
          fullWidth
          inputProps={{ min: 1 }}
          size="small"
        />
      </Box>

      {/* Weight & Dimensions */}
      <Typography variant="subtitle2" color="text.secondary">{t('weightAndDimensions')}</Typography>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label={t('weight')}
          type="number"
          value={itemWeight}
          onChange={(e) => setItemWeight(e.target.value)}
          sx={{ flex: 2 }}
          inputProps={{ min: 0, step: '0.1' }}
          size="small"
        />
        <FormControl sx={{ flex: 1, minWidth: 80 }} size="small">
          <InputLabel>{t('unit')}</InputLabel>
          <Select
            value={itemWeightUnit}
            label={t('unit')}
            onChange={(e) => setItemWeightUnit(e.target.value)}
          >
            {WEIGHT_UNITS.map((u) => (
              <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField label={t('length')} type="number" value={itemLength} onChange={(e) => setItemLength(e.target.value)} size="small" inputProps={{ min: 0 }} sx={{ flex: 1 }} />
        <TextField label={t('width')} type="number" value={itemWidth} onChange={(e) => setItemWidth(e.target.value)} size="small" inputProps={{ min: 0 }} sx={{ flex: 1 }} />
        <TextField label={t('height')} type="number" value={itemHeight} onChange={(e) => setItemHeight(e.target.value)} size="small" inputProps={{ min: 0 }} sx={{ flex: 1 }} />
        <FormControl sx={{ minWidth: 70 }} size="small">
          <InputLabel>{t('unit')}</InputLabel>
          <Select
            value={itemDimensionsUnit}
            label={t('unit')}
            onChange={(e) => setItemDimensionsUnit(e.target.value)}
          >
            {DIMENSION_UNITS.map((u) => (
              <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    </Box>
  );

  // ================================================================
  // Step 3: Images
  // ================================================================
  const renderStep3 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {t('imageHint')}
      </Typography>

      {/* File upload + AI generate buttons */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        hidden
        onChange={handleFileSelect}
      />
      <input
        ref={aiImageRefInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setAiImageRefFile(file);
          setAiImageRefPreview(URL.createObjectURL(file));
        }}
      />

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          startIcon={<CloudUploadIcon />}
          onClick={() => fileInputRef.current?.click()}
          disabled={imageCount >= ETSY_MAX_IMAGES}
        >
          {t('selectImages', { count: imageCount })}
        </Button>
      </Box>

      {imageCount === 0 && !aiImageResult && (
        <Alert severity="warning">
          {t('imageRequiredWarning')}
        </Alert>
      )}

      {/* Photos imported by URL (duplicate / cross-list) */}
      {urlImages.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('importedImagesHint', { count: urlImages.length })}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 1.5,
            }}
          >
            {urlImages.map((src, i) => (
              <Box
                key={src}
                sx={{
                  position: 'relative',
                  borderRadius: 1,
                  overflow: 'hidden',
                  border: i === 0 ? '2px solid' : '1px solid',
                  borderColor: i === 0 ? 'primary.main' : 'divider',
                }}
              >
                <img
                  src={src}
                  alt={`${t('image')} ${i + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
                />
                <IconButton
                  size="small"
                  aria-label={t('remove')}
                  onClick={() => removeUrlImage(i)}
                  sx={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 44,
                    height: 44,
                    bgcolor: 'rgba(0,0,0,0.5)',
                    color: 'white',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
                <Typography
                  variant="caption"
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    bgcolor: 'rgba(0,0,0,0.5)',
                    color: 'white',
                    textAlign: 'center',
                    py: 0.25,
                  }}
                >
                  {i === 0 ? t('cover') : i + 1}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Uploaded file previews */}
      {previews.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 1.5,
          }}
        >
          {previews.map((src, i) => (
            <Box
              key={i}
              sx={{
                position: 'relative',
                borderRadius: 1,
                overflow: 'hidden',
                border: urlImages.length + i === 0 ? '2px solid' : '1px solid',
                borderColor: urlImages.length + i === 0 ? 'primary.main' : 'divider',
              }}
>
              <img
                src={src}
                alt={`${t('image')} ${urlImages.length + i + 1}`}
                style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
              />
              <IconButton
                size="small"
                onClick={() => removeFile(i)}
                sx={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  bgcolor: 'rgba(0,0,0,0.5)',
                  color: 'white',
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                }}
  >
                <DeleteIcon fontSize="small" />
              </IconButton>
              <Typography
                variant="caption"
                sx={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  bgcolor: 'rgba(0,0,0,0.5)',
                  color: 'white',
                  textAlign: 'center',
                  py: 0.25,
                }}
  >
                {urlImages.length + i === 0 ? t('cover') : urlImages.length + i + 1}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      <Divider />

      {/* AI Image Generation Section */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderColor: '#c084fc',
          background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <AutoFixHighIcon sx={{ color: '#a855f7', fontSize: 20 }} />
          <Typography variant="subtitle2" color="#7c3aed">
            {t('aiImageGenTitle')}
          </Typography>
        </Box>

        <TextField
          label={t('promptLabel')}
          placeholder={t('aiImagePromptPlaceholder')}
          fullWidth
          multiline
          minRows={2}
          size="small"
          value={aiImagePrompt}
          onChange={(e) => setAiImagePrompt(e.target.value)}
          disabled={aiImageGenerating}
          sx={{ mb: 1.5 }}
          helperText={t('aiImageHelperText')}
        />

        {/* Reference image */}
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            {t('referenceImageDesc')}
          </Typography>
          {!aiImageRefPreview ? (
            <Button
              variant="outlined"
              size="small"
              onClick={() => aiImageRefInputRef.current?.click()}
              disabled={aiImageGenerating}
              startIcon={<AddPhotoAlternateIcon />}
              sx={{ borderColor: '#c084fc', color: '#7c3aed' }}
>
              {t('selectReference')}
            </Button>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <img
                src={aiImageRefPreview}
                alt={t('reference')}
                style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Button
                size="small"
                color="error"
                onClick={() => {
                  setAiImageRefFile(null);
                  setAiImageRefPreview(null);
                  if (aiImageRefInputRef.current) aiImageRefInputRef.current.value = '';
                }}
  >
                {t('remove')}
              </Button>
            </Box>
          )}
        </Box>

        <FormControlLabel
          control={<Checkbox size="small" checked={aiImageWhiteBg} onChange={(e) => setAiImageWhiteBg(e.target.checked)} disabled={aiImageGenerating} />}
          label={<Typography variant="caption">{t('aiImageWhiteBg')}</Typography>}
          sx={{ mb: 1 }}
        />
        <Button
          variant="contained"
          fullWidth
          onClick={() => handleAiImageGenerate()}
          disabled={aiImageGenerating || !aiImagePrompt.trim() || imageCount >= ETSY_MAX_IMAGES}
          startIcon={aiImageGenerating ? <CircularProgress size={18} color="inherit" /> : <AutoFixHighIcon />}
          sx={{ bgcolor: '#a855f7', '&:hover': { bgcolor: '#9333ea' } }}
        >
          {aiImageGenerating ? t('generating') : t('generateImage')}
        </Button>

        {/* AI result preview */}
        {aiImageResult && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ textAlign: 'center' }}>{t('generatedImage')}:</Typography>
            <Box sx={{ textAlign: 'center' }}>
              <img
                src={`data:${aiImageResult.mimeType};base64,${aiImageResult.base64}`}
                alt={t('generatedImage')}
                style={{
                  maxWidth: '100%',
                  maxHeight: 250,
                  borderRadius: 8,
                  border: '2px solid #a855f7',
                }}
              />
            </Box>

            <TextField
              size="small"
              fullWidth
              placeholder={t('followUpPlaceholder')}
              value={aiImageFollowUp}
              onChange={(e) => setAiImageFollowUp(e.target.value)}
              disabled={aiImageGenerating}
              sx={{ mt: 1.5 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !aiImageGenerating) {
                  e.preventDefault();
                  handleAiImageFollowUp();
                }
              }}
            />

            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                onClick={handleAiImageFollowUp}
                disabled={aiImageGenerating}
                size="small"
                startIcon={aiImageGenerating ? <CircularProgress size={14} /> : null}
  >
                {aiImageFollowUp.trim() ? t('generateWithChanges') : t('regenerateSamePrompt')}
              </Button>
              <Button
                variant="contained"
                onClick={handleAiImageAccept}
                disabled={imageCount >= ETSY_MAX_IMAGES}
                color="success"
                size="small"
  >
                {t('acceptAndAdd')}
              </Button>
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );

  // ================================================================
  // Step 4: Preview & Create
  // ================================================================
  const renderStep4 = () => {
    const sectionLabel = shopSections.find((s) => s.shop_section_id === shopSectionId)?.title;
    const shippingLabel = shippingProfiles.find((s) => s.shipping_profile_id === shippingProfileId)?.title;
    const returnLabel =
      returnPolicies.find((r) => r.return_policy_id === returnPolicyId)?.description ||
      (returnPolicyId ? `${t('policy')} #${returnPolicyId}` : '');

    const summaryFields: Array<{ label: string; value: string | number }> = [
      { label: t('summaryTitle'), value: title },
      { label: t('summaryDescription'), value: description.length > 200 ? description.slice(0, 200) + '...' : description },
      { label: t('summaryTags'), value: tags.join(', ') || '-' },
      { label: t('summaryMaterials'), value: materials.join(', ') || '-' },
      { label: t('summaryWhoMade'), value: whoMadeLabel },
      { label: t('summaryWhenMade'), value: whenMadeLabel },
      { label: t('summaryIsSupply'), value: isSupply ? t('yes') : t('no') },
      { label: t('summaryCategory'), value: selectedTaxonomy?.label || '-' },
      { label: t('summaryPrice'), value: `$${price}` },
      { label: t('summaryQuantity'), value: quantity },
      { label: t('shopSectionLabel'), value: sectionLabel || '-' },
      { label: t('shippingProfileLabel'), value: shippingLabel || '-' },
      { label: t('returnPolicyLabel'), value: returnLabel || '-' },
      { label: t('summaryProcessing'), value: processingMin && processingMax ? `${processingMin}-${processingMax} ${t('businessDays')}` : '-' },
      { label: t('summaryWeight'), value: itemWeight ? `${itemWeight} ${itemWeightUnit}` : '-' },
      { label: t('summaryDimensions'), value: itemLength ? `${itemLength}x${itemWidth}x${itemHeight} ${itemDimensionsUnit}` : '-' },
      { label: t('summaryImages'), value: `${imageCount} ${t('items')}` },
    ];

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            {t('listingSummary')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {summaryFields.map((field) => (
              <Box
                key={field.label}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  py: 0.5,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
  >
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, flexShrink: 0 }}>
                  {field.label}
                </Typography>
                <Typography variant="body2" sx={{ textAlign: 'right', wordBreak: 'break-word' }}>
                  {field.value}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <SEOIndicator tags={tags} title={title} description={description} />
        </Paper>

        {creating && syncingToEtsy && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {t('syncingToEtsy')}
            </Typography>
            <LinearProgress sx={{ height: 6, borderRadius: 3 }} />
          </Box>
        )}

        {creating && !syncingToEtsy && uploadTotal > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {t('uploadingImages', { progress: uploadProgress, total: uploadTotal })}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(uploadProgress / uploadTotal) * 100}
              sx={{ height: 6, borderRadius: 3 }}
            />
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 2, mt: 1, flexDirection: isMobile ? 'column' : 'row' }}>
          <Button
            variant="contained"
            onClick={() => handleCreate(false)}
            disabled={creating}
            sx={{ flex: 1, minWidth: 180 }}
          >
            {creating ? t('creating') : t('saveAsDraft')}
          </Button>
          <Button
            variant="outlined"
            color="success"
            onClick={() => handleCreate(true)}
            disabled={creating || imageCount === 0}
            sx={{ flex: 1, minWidth: 180 }}
          >
            {creating ? t('creating') : t('createAndPublish')}
          </Button>
        </Box>
        {imageCount === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            {t('publishRequiresImage')}
          </Typography>
        )}
      </Box>
    );
  };

  const stepContent = [renderStep1, renderStep2, renderStep3, renderStep4];

  // ================================================================
  // Dialog
  // ================================================================
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullScreen={isMobile}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: isMobile ? '100vh' : '70vh' },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="h6">{t('dialogTitle')}</Typography>
        <IconButton onClick={handleClose} disabled={creating} aria-label={tCommon('close')} sx={{ minWidth: 44, minHeight: 44 }}>
          <CloseIcon />
        </IconButton>
      </Box>

      {(creating || isAnyAILoading) && <LinearProgress />}

      <Box sx={{ px: 3, pt: 3 }}>
        <Stepper activeStep={activeStep} alternativeLabel={!isMobile}>
          {STEPS.map((label, idx) => (
            <Step key={label}>
              <StepLabel>{isMobile && activeStep !== idx ? '' : label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <Box sx={{ px: 3, py: 3, flex: 1, overflow: 'auto' }}>
        {copySource?.source && activeStep === 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t(copySource.source === 'ebay' ? 'prefilledFromEbay' : 'prefilledFromEtsy')}
          </Alert>
        )}
        {pendingRestore && (
          <Alert
            severity="info"
            sx={{ mb: 2, alignItems: { xs: 'flex-start', sm: 'center' }, '& .MuiAlert-message': { flex: 1 } }}
          >
            <Typography variant="subtitle2" fontWeight={700}>
              {t('restore.title')}
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {pendingRestore.title?.trim()
                ? t('restore.bodyWithTitle', { title: pendingRestore.title.trim().slice(0, 80) })
                : t('restore.body')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="contained" size="small" onClick={handleRestore} sx={{ minHeight: { xs: 44, sm: 32 } }}>
                {t('restore.restore')}
              </Button>
              <Button size="small" color="inherit" onClick={handleDiscardRestore} sx={{ minHeight: { xs: 44, sm: 32 } }}>
                {t('restore.discard')}
              </Button>
            </Box>
          </Alert>
        )}
        {stepContent[activeStep]()}
      </Box>

      {activeStep < 3 && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            px: 3,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Button disabled={activeStep === 0} onClick={handleBack}>
            {t('back')}
          </Button>
          <Button variant="contained" onClick={handleNext}>
            {t('next')}
          </Button>
        </Box>
      )}

      {activeStep === 3 && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-start',
            px: 3,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Button disabled={creating} onClick={handleBack}>
            {t('back')}
          </Button>
        </Box>
      )}
    </Dialog>
  );
}
