import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Dialog,
  TextField,
  Select,
  MenuItem,
  Autocomplete,
  Button,
  LinearProgress,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Chip,
  useMediaQuery,
  useTheme,
  IconButton,
  Divider,
  Alert,
  AlertTitle,
  CircularProgress,
  Collapse,
  Paper,
  Tooltip,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import SEOIndicator from './SEOIndicator';
import ImageManager from './ImageManager';
import ItemSpecificsEditor from './ItemSpecificsEditor';
import ConditionSelector from './ConditionSelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Policy {
  policyId: string;
  name: string;
  description?: string;
}

interface ListingCreatorDialogProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  fulfillmentPolicies: Policy[];
  returnPolicies: Policy[];
  paymentPolicies: Policy[];
  onCreated: (sku: string) => void;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface AspectMetadata {
  localizedAspectName: string;
  aspectConstraint: {
    aspectRequired: boolean;
    aspectMode: 'FREE_TEXT' | 'SELECTION_ONLY';
    aspectValues?: { localizedValue: string }[];
  };
}

interface VariationAspect {
  name: string;
  values: string[];
}

interface VariationRow {
  combination: Record<string, string>;
  sku: string;
  price: string;
  quantity: string;
}

type AutofillStepId = 'research' | 'title' | 'category' | 'aspects' | 'price' | 'description';
type AutofillStatus = 'pending' | 'running' | 'done' | 'error';

const AUTOFILL_STEPS: AutofillStepId[] = [
  'research',
  'title',
  'category',
  'aspects',
  'price',
  'description',
];

const AUTOFILL_STEP_KEYS: Record<AutofillStepId, string> = {
  research: 'aiStepResearch',
  title: 'aiStepTitle',
  category: 'aiStepCategory',
  aspects: 'aiStepAspects',
  price: 'aiStepPrice',
  description: 'aiStepDescription',
};

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'GBP', label: 'GBP' },
  { value: 'EUR', label: 'EUR' },
  { value: 'TRY', label: 'TRY' },
];

/** Work-in-progress listings survive an accidental close or a page reload. */
const DRAFT_STORAGE_KEY = 'kx.ebay.listingDraft.v1';
/** Sellers pick the same three policies every time — remember the last choice. */
const POLICY_STORAGE_KEY = 'kx.ebay.lastPolicies.v1';

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ListingCreatorDialog({
  open,
  onClose,
  userId,
  fulfillmentPolicies,
  returnPolicies,
  paymentPolicies,
  onCreated,
}: ListingCreatorDialogProps) {
  const t = useTranslations('ebay.listing');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [creating, setCreating] = useState(false);
  /** Errors stay on screen until dismissed — a toast disappears before it can be read. */
  const [formError, setFormError] = useState<string | null>(null);

  // AI & Market Research
  const [marketResearch, setMarketResearch] = useState<Record<string, any> | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<{ score: number; issues: any[]; tips: string[] } | null>(null);
  const [showMarketInsights, setShowMarketInsights] = useState(false);

  // One-click autofill
  const [aiSeed, setAiSeed] = useState('');
  const [autofillStatus, setAutofillStatus] = useState<Record<AutofillStepId, AutofillStatus> | null>(null);
  const autofilling = autofillStatus !== null;

  // Listing content
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [condition, setCondition] = useState('NEW');
  const [conditionDescription, setConditionDescription] = useState('');

  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [categorySearching, setCategorySearching] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryOption | null>(null);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [quantity, setQuantity] = useState('1');
  const [aspects, setAspects] = useState<Record<string, string[]>>({});
  const [requiredAspects, setRequiredAspects] = useState<AspectMetadata[]>([]);
  const [recommendedAspects, setRecommendedAspects] = useState<AspectMetadata[]>([]);
  const [aspectsLoading, setAspectsLoading] = useState(false);

  const [images, setImages] = useState<string[]>([]);

  const [fulfillmentPolicyId, setFulfillmentPolicyId] = useState('');
  const [returnPolicyId, setReturnPolicyId] = useState('');
  const [paymentPolicyId, setPaymentPolicyId] = useState('');
  const [storeCategories, setStoreCategories] = useState<string[]>([]);
  const [selectedStoreCategory, setSelectedStoreCategory] = useState('');
  const [selectedStoreCategory2, setSelectedStoreCategory2] = useState('');

  const [hasVariations, setHasVariations] = useState(false);
  const [variationAspects, setVariationAspects] = useState<VariationAspect[]>([]);
  const [variationRows, setVariationRows] = useState<VariationRow[]>([]);

  const [draftRestored, setDraftRestored] = useState(false);

  const categorySearchTimeout = useRef<NodeJS.Timeout | null>(null);
  const marketResearchFetched = useRef(false);

  // Section anchors — the readiness checklist scrolls straight to what's missing.
  const photosRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const pricingRef = useRef<HTMLDivElement>(null);
  const shippingRef = useRef<HTMLDivElement>(null);

  // --------------------------------------------------
  // Persistence
  // --------------------------------------------------

  const resetForm = useCallback(() => {
    setTitle('');
    setDescription('');
    setSkuInput('');
    setCondition('NEW');
    setConditionDescription('');
    setCategorySearchQuery('');
    setCategoryOptions([]);
    setSelectedCategory(null);
    setPrice('');
    setCurrency('USD');
    setQuantity('1');
    setAspects({});
    setRequiredAspects([]);
    setRecommendedAspects([]);
    setImages([]);
    setFulfillmentPolicyId('');
    setReturnPolicyId('');
    setPaymentPolicyId('');
    setSelectedStoreCategory('');
    setSelectedStoreCategory2('');
    setHasVariations(false);
    setVariationAspects([]);
    setVariationRows([]);
    setMarketResearch(null);
    setAiLoading(null);
    setAiAnalysis(null);
    setAiSeed('');
    setAutofillStatus(null);
    setFormError(null);
    setShowMarketInsights(false);
    setDraftRestored(false);
    marketResearchFetched.current = false;
  }, []);

  /** Everything the user typed, in one serialisable blob. */
  const snapshot = useMemo(
    () => ({
      title,
      description,
      skuInput,
      condition,
      conditionDescription,
      categorySearchQuery,
      selectedCategory,
      price,
      currency,
      quantity,
      aspects,
      requiredAspects,
      recommendedAspects,
      images,
      fulfillmentPolicyId,
      returnPolicyId,
      paymentPolicyId,
      selectedStoreCategory,
      selectedStoreCategory2,
      hasVariations,
      variationAspects,
      variationRows,
    }),
    [
      title, description, skuInput, condition, conditionDescription, categorySearchQuery,
      selectedCategory, price, currency, quantity, aspects, requiredAspects, recommendedAspects,
      images, fulfillmentPolicyId, returnPolicyId, paymentPolicyId, selectedStoreCategory,
      selectedStoreCategory2, hasVariations, variationAspects, variationRows,
    ]
  );

  const hasContent = Boolean(
    title.trim() || description.trim() || images.length > 0 || selectedCategory || price
  );

  // Restore an interrupted listing when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const saved = readStorage<typeof snapshot>(DRAFT_STORAGE_KEY);
    if (saved && (saved.title || saved.images?.length || saved.description)) {
      setTitle(saved.title || '');
      setDescription(saved.description || '');
      setSkuInput(saved.skuInput || '');
      setCondition(saved.condition || 'NEW');
      setConditionDescription(saved.conditionDescription || '');
      setCategorySearchQuery(saved.categorySearchQuery || '');
      setSelectedCategory(saved.selectedCategory || null);
      setPrice(saved.price || '');
      setCurrency(saved.currency || 'USD');
      setQuantity(saved.quantity || '1');
      setAspects(saved.aspects || {});
      setRequiredAspects(saved.requiredAspects || []);
      setRecommendedAspects(saved.recommendedAspects || []);
      setImages(saved.images || []);
      setFulfillmentPolicyId(saved.fulfillmentPolicyId || '');
      setReturnPolicyId(saved.returnPolicyId || '');
      setPaymentPolicyId(saved.paymentPolicyId || '');
      setSelectedStoreCategory(saved.selectedStoreCategory || '');
      setSelectedStoreCategory2(saved.selectedStoreCategory2 || '');
      setHasVariations(Boolean(saved.hasVariations));
      setVariationAspects(saved.variationAspects || []);
      setVariationRows(saved.variationRows || []);
      setDraftRestored(true);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave while the dialog is open.
  useEffect(() => {
    if (!open || !hasContent) return;
    const id = setTimeout(() => writeStorage(DRAFT_STORAGE_KEY, snapshot), 600);
    return () => clearTimeout(id);
  }, [open, hasContent, snapshot]);

  // --------------------------------------------------
  // Policy defaults — no seller wants to pick these three every single time.
  // --------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const last = readStorage<Record<string, string>>(POLICY_STORAGE_KEY) || {};

    const pick = (
      list: Policy[],
      remembered: string | undefined,
      current: string,
      set: (v: string) => void
    ) => {
      if (current) return;
      if (remembered && list.some((p) => p.policyId === remembered)) {
        set(remembered);
      } else if (list.length > 0) {
        set(list[0].policyId);
      }
    };

    pick(fulfillmentPolicies, last.fulfillment, fulfillmentPolicyId, setFulfillmentPolicyId);
    pick(returnPolicies, last.return, returnPolicyId, setReturnPolicyId);
    pick(paymentPolicies, last.payment, paymentPolicyId, setPaymentPolicyId);
  }, [open, fulfillmentPolicies, returnPolicies, paymentPolicies]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch store categories when dialog opens
  useEffect(() => {
    if (open && storeCategories.length === 0) {
      fetch(`/api/clawd/ebay?action=store_categories&user_id=${userId}`)
        .then((r) => (r.ok ? r.json() : { categories: [] }))
        .then((data) => setStoreCategories(data.categories || []))
        .catch(() => {});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------
  // Market research
  // --------------------------------------------------
  const fetchMarketResearch = async (query: string): Promise<Record<string, any> | null> => {
    if (!query.trim()) return null;
    setMarketLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay-research?action=niche_analyze&q=${encodeURIComponent(query)}&marketplace_id=EBAY_US&user_id=${userId}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      const research = {
        avgPrice: data.avgPrice,
        medianPrice: data.medianPrice,
        priceRange: data.priceSpread,
        totalResults: data.totalResults,
        demandScore: data.demandScore,
        competitionScore: data.competitionScore,
        topSellers: data.topSellers,
        topProducts: data.topProducts,
        freeShippingPct: data.freeShippingPct,
        conditionBreakdown: data.conditionBreakdown,
      };
      setMarketResearch(research);
      return research;
    } catch {
      return null;
    } finally {
      setMarketLoading(false);
    }
  };

  useEffect(() => {
    if (title.trim().length >= 15 && !marketResearch && !marketResearchFetched.current && open && !autofilling) {
      marketResearchFetched.current = true;
      fetchMarketResearch(title.trim());
    }
  }, [title, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------
  // AI
  // --------------------------------------------------
  const callAI = async (action: string, body: Record<string, any>) => {
    const res = await fetch(`/api/clawd/ebay-ai?action=${action}&user_id=${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `AI error: ${res.status}`);
    }
    return res.json();
  };

  const fetchCategorySuggestions = async (query: string): Promise<CategoryOption[]> => {
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=category_suggestions&q=${encodeURIComponent(query)}&user_id=${userId}`
      );
      if (res.ok) {
        const data = await res.json();
        return (data.categorySuggestions || []).map((c: any) => ({
          id: c.category?.categoryId || c.categoryId,
          name: c.category?.categoryName || c.categoryName || c.name,
        }));
      }
    } catch {
      // ignore
    }
    return [];
  };

  /** Loads the aspect metadata for a category and hands it back to the caller. */
  const fetchAspectsForCategory = async (
    categoryId: string
  ): Promise<{ required: AspectMetadata[]; recommended: AspectMetadata[] }> => {
    setAspectsLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=item_aspects&category_id=${categoryId}&user_id=${userId}`
      );
      if (res.ok) {
        const data = await res.json();
        const all: AspectMetadata[] = data.aspects || [];
        const required = all.filter((a) => a.aspectConstraint.aspectRequired);
        const recommended = all.filter((a) => !a.aspectConstraint.aspectRequired);
        setRequiredAspects(required);
        setRecommendedAspects(recommended);
        return { required, recommended };
      }
    } catch {
      // Non-critical
    } finally {
      setAspectsLoading(false);
    }
    return { required: [], recommended: [] };
  };

  /** Ask the AI to fill the given aspect names, merging onto what's already there. */
  const fillAspectsWithAI = async (
    names: string[],
    seedTitle: string,
    categoryName: string | undefined,
    research: Record<string, any> | null,
    current: Record<string, string[]>
  ): Promise<Record<string, string[]>> => {
    if (names.length === 0) return current;
    const data = await callAI('suggest_aspects', {
      title: seedTitle,
      aspectNames: names,
      currentAspects: current,
      categoryName,
      marketResearch: research,
    });
    if (data?.aspects && typeof data.aspects === 'object') {
      const merged = { ...current, ...data.aspects };
      setAspects(merged);
      return merged;
    }
    return current;
  };

  const handleAIOptimizeTitle = async () => {
    if (!title.trim()) { toast.error(t('enterTitleFirst')); return; }
    setAiLoading('title');
    try {
      const research = marketResearch || (await fetchMarketResearch(title));
      const data = await callAI('optimize_title', {
        title: title.trim(),
        categoryName: selectedCategory?.name,
        marketResearch: research,
      });
      if (data.optimizedTitle) {
        setTitle(data.optimizedTitle);
        toast.success(t('titleOptimized', { before: data.score?.before || '?', after: data.score?.after || '?' }));
      }
    } catch (err: any) {
      toast.error(err.message || t('titleOptimizeFailed'));
    } finally {
      setAiLoading(null);
    }
  };

  const handleAIGenerateDescription = async () => {
    if (!title.trim()) { toast.error(t('enterTitleFirst')); return; }
    setAiLoading('description');
    try {
      const research = marketResearch || (await fetchMarketResearch(title));
      const data = await callAI('generate_description', {
        title: title.trim(),
        aspects: Object.keys(aspects).length > 0 ? aspects : undefined,
        condition,
        price: price ? parseFloat(price) : undefined,
        marketResearch: research,
      });
      if (data.description) {
        setDescription(data.description);
        toast.success(t('descriptionGenerated'));
      }
    } catch (err: any) {
      toast.error(err.message || t('descriptionGenerateFailed'));
    } finally {
      setAiLoading(null);
    }
  };

  const handleAISuggestPrice = async () => {
    if (!title.trim()) { toast.error(t('enterTitleFirst')); return; }
    setAiLoading('price');
    try {
      const research = marketResearch || (await fetchMarketResearch(title));
      const data = await callAI('suggest_price', {
        title: title.trim(),
        condition,
        categoryName: selectedCategory?.name,
        marketResearch: research,
      });
      if (data.suggestedPrice) {
        setPrice(String(data.suggestedPrice));
        toast.success(
          t('suggestedPrice', {
            price: data.suggestedPrice,
            currency,
            min: data.priceRange?.min,
            max: data.priceRange?.max,
          })
        );
      }
    } catch (err: any) {
      toast.error(err.message || t('priceSuggestFailed'));
    } finally {
      setAiLoading(null);
    }
  };

  const handleAIAnalyzeListing = async () => {
    if (!title.trim()) { toast.error(t('titleRequired')); return; }
    setAiLoading('analyze');
    try {
      const research = marketResearch || (await fetchMarketResearch(title));
      const data = await callAI('analyze_listing', {
        title: title.trim(),
        description: description.trim(),
        price: price ? parseFloat(price) : undefined,
        imageCount: images.length,
        aspects: Object.keys(aspects).length > 0 ? aspects : undefined,
        categoryName: selectedCategory?.name,
        marketResearch: research,
      });
      setAiAnalysis(data);
    } catch (err: any) {
      toast.error(err.message || t('analysisFailed'));
    } finally {
      setAiLoading(null);
    }
  };

  // --------------------------------------------------
  // One-click: research → title → category → specifics → price → description
  // --------------------------------------------------
  const runAiAutofill = async () => {
    const seed = (aiSeed.trim() || title.trim()).slice(0, 200);
    if (!seed) {
      setFormError(t('aiStartNeedsSeed'));
      return;
    }

    setFormError(null);
    const status: Record<AutofillStepId, AutofillStatus> = {
      research: 'pending', title: 'pending', category: 'pending',
      aspects: 'pending', price: 'pending', description: 'pending',
    };
    setAutofillStatus({ ...status });

    const mark = (id: AutofillStepId, s: AutofillStatus) => {
      status[id] = s;
      setAutofillStatus({ ...status });
    };

    // Each step is independently non-fatal: a failure marks that row and the
    // rest still run, so the seller always ends up with a partly filled form.
    let research: Record<string, any> | null = null;
    let workingTitle = seed;
    let category: CategoryOption | null = selectedCategory;
    let workingAspects: Record<string, string[]> = aspects;

    mark('research', 'running');
    try {
      research = await fetchMarketResearch(seed);
      mark('research', 'done');
    } catch {
      mark('research', 'error');
    }

    mark('title', 'running');
    try {
      const data = await callAI('optimize_title', {
        title: seed,
        categoryName: category?.name,
        marketResearch: research,
      });
      if (data.optimizedTitle) {
        workingTitle = String(data.optimizedTitle).slice(0, 80);
        setTitle(workingTitle);
        mark('title', 'done');
      } else {
        setTitle(seed.slice(0, 80));
        mark('title', 'error');
      }
    } catch {
      setTitle(seed.slice(0, 80));
      mark('title', 'error');
    }

    mark('category', 'running');
    try {
      if (!category) {
        const results = await fetchCategorySuggestions(workingTitle);
        setCategoryOptions(results);
        if (results.length > 0) {
          category = results[0];
          setSelectedCategory(category);
          setCategorySearchQuery(category.name);
        }
      }
      mark('category', category ? 'done' : 'error');
    } catch {
      mark('category', 'error');
    }

    mark('aspects', 'running');
    try {
      if (category) {
        const { required, recommended } = await fetchAspectsForCategory(category.id);
        const names = [...required, ...recommended]
          .slice(0, 15)
          .map((a) => a.localizedAspectName);
        workingAspects = await fillAspectsWithAI(
          names, workingTitle, category.name, research, workingAspects
        );
        mark('aspects', 'done');
      } else {
        mark('aspects', 'error');
      }
    } catch {
      mark('aspects', 'error');
    }

    mark('price', 'running');
    try {
      const data = await callAI('suggest_price', {
        title: workingTitle,
        condition,
        categoryName: category?.name,
        marketResearch: research,
      });
      if (data.suggestedPrice) {
        setPrice(String(data.suggestedPrice));
        mark('price', 'done');
      } else {
        mark('price', 'error');
      }
    } catch {
      mark('price', 'error');
    }

    mark('description', 'running');
    try {
      const data = await callAI('generate_description', {
        title: workingTitle,
        aspects: Object.keys(workingAspects).length > 0 ? workingAspects : undefined,
        condition,
        marketResearch: research,
      });
      if (data.description) {
        setDescription(data.description);
        mark('description', 'done');
      } else {
        mark('description', 'error');
      }
    } catch {
      mark('description', 'error');
    }

    setAutofillStatus(null);
    marketResearchFetched.current = true;
    toast.success(t('aiStartDone'));
  };

  // --------------------------------------------------
  // Category search
  // --------------------------------------------------
  const handleCategorySearch = (query: string) => {
    setCategorySearchQuery(query);

    if (categorySearchTimeout.current) clearTimeout(categorySearchTimeout.current);

    if (!query.trim()) {
      setCategoryOptions([]);
      return;
    }

    categorySearchTimeout.current = setTimeout(async () => {
      setCategorySearching(true);
      const results = await fetchCategorySuggestions(query);
      setCategoryOptions(results);
      setCategorySearching(false);
    }, 400);
  };

  /** Picking a category immediately pulls its aspects and has the AI fill the required ones. */
  const handleCategorySelected = async (value: CategoryOption) => {
    setSelectedCategory(value);
    setCategorySearchQuery(value.name);
    const { required } = await fetchAspectsForCategory(value.id);
    const unfilled = required
      .map((a) => a.localizedAspectName)
      .filter((name) => !aspects[name]?.length);
    if (unfilled.length === 0 || !title.trim()) return;

    setAiLoading('aspects');
    try {
      await fillAspectsWithAI(unfilled, title.trim(), value.name, marketResearch, aspects);
    } catch {
      // Silent — the seller can still fill them by hand or hit AI Fill.
    } finally {
      setAiLoading(null);
    }
  };

  // --------------------------------------------------
  // Variations
  // --------------------------------------------------
  const generateVariationRows = (defs: VariationAspect[]) => {
    const valid = defs.filter((a) => a.name && a.values.length > 0);
    if (valid.length === 0) {
      setVariationRows([]);
      return;
    }

    let combinations: Record<string, string>[] = [{}];
    for (const aspect of valid) {
      const next: Record<string, string>[] = [];
      for (const combo of combinations) {
        for (const value of aspect.values) {
          next.push({ ...combo, [aspect.name]: value });
        }
      }
      combinations = next;
    }

    setVariationRows(
      combinations.map((combo) => {
        const key = Object.values(combo).join('-');
        const existing = variationRows.find(
          (r) => Object.values(r.combination).join('-') === key
        );
        return {
          combination: combo,
          sku: existing?.sku || `${skuInput || 'VAR'}-${key}`,
          price: existing?.price || price || '',
          quantity: existing?.quantity || '1',
        };
      })
    );
  };

  // --------------------------------------------------
  // Readiness
  // --------------------------------------------------
  const missingRequiredAspects = useMemo(
    () =>
      requiredAspects
        .map((a) => a.localizedAspectName)
        .filter((name) => !aspects[name]?.length),
    [requiredAspects, aspects]
  );

  const checklist = useMemo(
    () => [
      { id: 'photos', ok: images.length > 0, label: t('checkPhotos'), ref: photosRef, blocksDraft: true },
      { id: 'title', ok: Boolean(title.trim()), label: t('checkTitle'), ref: contentRef, blocksDraft: true },
      { id: 'description', ok: Boolean(description.trim()), label: t('checkDescription'), ref: contentRef, blocksDraft: true },
      { id: 'category', ok: Boolean(selectedCategory), label: t('checkCategory'), ref: categoryRef, blocksDraft: true },
      { id: 'price', ok: Boolean(price) && parseFloat(price) > 0, label: t('checkPrice'), ref: pricingRef, blocksDraft: true },
      {
        id: 'specifics',
        ok: missingRequiredAspects.length === 0,
        label: missingRequiredAspects.length
          ? t('checkSpecificsMissing', { count: missingRequiredAspects.length })
          : t('checkSpecifics'),
        ref: categoryRef,
        blocksDraft: false,
      },
      {
        id: 'policies',
        ok: Boolean(fulfillmentPolicyId && returnPolicyId && paymentPolicyId),
        label: t('checkPolicies'),
        ref: shippingRef,
        blocksDraft: true,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      images.length, title, description, selectedCategory, price, missingRequiredAspects.length,
      fulfillmentPolicyId, returnPolicyId, paymentPolicyId,
    ]
  );

  const draftBlockers = checklist.filter((c) => c.blocksDraft && !c.ok);
  const publishBlockers = checklist.filter((c) => !c.ok);
  const canCreateDraft = draftBlockers.length === 0 && !creating && !autofilling;
  const canPublish = publishBlockers.length === 0 && !creating && !autofilling;

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // --------------------------------------------------
  // Create
  // --------------------------------------------------
  const handleClose = () => {
    if (creating) return;
    onClose();
  };

  const handleStartOver = () => {
    clearStorage(DRAFT_STORAGE_KEY);
    resetForm();
  };

  const handleCreate = async (publish: boolean) => {
    if (hasVariations && variationRows.length === 0) {
      setFormError(t('variationsRequired'));
      return;
    }
    const blockers = publish ? publishBlockers : draftBlockers;
    if (blockers.length > 0) {
      setFormError(t('readinessMissing', { items: blockers.map((b) => b.label).join(', ') }));
      scrollTo(blockers[0].ref);
      return;
    }

    setFormError(null);
    setCreating(true);
    try {
      const baseSku = skuInput.trim() || `SKU-${Date.now()}`;

      const storeCategoryNames: string[] = [];
      if (selectedStoreCategory) storeCategoryNames.push(selectedStoreCategory);
      if (selectedStoreCategory2) storeCategoryNames.push(selectedStoreCategory2);

      if (hasVariations && variationRows.length > 0) {
        // ---- VARIATION LISTING FLOW ----
        for (const row of variationRows) {
          const varAspects = { ...aspects };
          for (const [key, value] of Object.entries(row.combination)) {
            varAspects[key] = [value];
          }

          const inventoryRes = await fetch(
            `/api/clawd/ebay?action=create_inventory_item&sku=${encodeURIComponent(row.sku)}&user_id=${userId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                product: {
                  title: title.trim(),
                  description: description.trim(),
                  aspects: varAspects,
                  imageUrls: images,
                },
                condition,
                conditionDescription: condition !== 'NEW' ? conditionDescription : undefined,
                availability: {
                  shipToLocationAvailability: { quantity: parseInt(row.quantity) || 1 },
                },
              }),
            }
          );

          if (!inventoryRes.ok) {
            const err = await inventoryRes.json().catch(() => ({}));
            throw new Error(err.error || t('variationItemCreateFailed', { sku: row.sku }));
          }
        }

        const varAspectNames = variationAspects.filter((a) => a.name && a.values.length).map((a) => a.name);
        const groupRes = await fetch(
          `/api/clawd/ebay?action=create_inventory_item_group&sku=${encodeURIComponent(baseSku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: title.trim(),
              description: description.trim(),
              imageUrls: images,
              aspects: Object.fromEntries(
                Object.entries(aspects).filter(([key]) => !varAspectNames.includes(key))
              ),
              variantSKUs: variationRows.map((r) => r.sku),
              variesBy: {
                aspectsImageVariesBy: [],
                specifications: variationAspects
                  .filter((a) => a.name && a.values.length)
                  .map((a) => ({ name: a.name, values: a.values })),
              },
            }),
          }
        );

        if (!groupRes.ok) {
          const err = await groupRes.json().catch(() => ({}));
          throw new Error(err.error || t('variationGroupCreateFailed'));
        }

        let publishFailed = 0;
        for (const row of variationRows) {
          const offerPayload: Record<string, any> = {
            sku: row.sku,
            marketplaceId: 'EBAY_US',
            format: 'FIXED_PRICE',
            availableQuantity: parseInt(row.quantity) || 1,
            listingDuration: 'GTC',
            listingDescription: description.trim(),
            pricingSummary: { price: { value: String(row.price || price), currency } },
            listingPolicies: { fulfillmentPolicyId, returnPolicyId, paymentPolicyId },
            categoryId: selectedCategory!.id,
          };
          if (storeCategoryNames.length > 0) offerPayload.storeCategoryNames = storeCategoryNames;

          const offerRes = await fetch(
            `/api/clawd/ebay?action=create_offer&user_id=${userId}&marketplace_id=EBAY_US`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(offerPayload),
            }
          );

          const offerData = await offerRes.json().catch(() => ({}));
          if (!offerRes.ok) {
            throw new Error(offerData.error || t('variationOfferCreateFailed', { sku: row.sku }));
          }

          if (publish && offerData.offerId) {
            try {
              const pubRes = await fetch(
                `/api/clawd/ebay?action=publish_offer&offer_id=${offerData.offerId}&user_id=${userId}&marketplace_id=EBAY_US`,
                { method: 'POST' }
              );
              if (!pubRes.ok) publishFailed++;
            } catch {
              publishFailed++;
            }
          }
        }

        if (publish && publishFailed > 0) {
          toast.error(t('variationPublishPartial', { failed: publishFailed }));
        } else {
          toast.success(publish ? t('variationListingPublished') : t('variationDraftCreated'));
        }
      } else {
        // ---- SIMPLE LISTING FLOW ----
        const inventoryRes = await fetch(
          `/api/clawd/ebay?action=create_inventory_item&sku=${encodeURIComponent(baseSku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product: {
                title: title.trim(),
                description: description.trim(),
                aspects,
                imageUrls: images,
              },
              condition,
              conditionDescription: condition !== 'NEW' ? conditionDescription : undefined,
              availability: {
                shipToLocationAvailability: { quantity: parseInt(quantity) || 1 },
              },
            }),
          }
        );

        if (!inventoryRes.ok) {
          const err = await inventoryRes.json().catch(() => ({}));
          throw new Error(err.error || t('inventoryItemCreateFailed'));
        }

        const offerPayload: Record<string, any> = {
          sku: baseSku,
          marketplaceId: 'EBAY_US',
          format: 'FIXED_PRICE',
          availableQuantity: parseInt(quantity) || 1,
          listingDuration: 'GTC',
          listingDescription: description.trim(),
          pricingSummary: { price: { value: String(price), currency } },
          listingPolicies: { fulfillmentPolicyId, returnPolicyId, paymentPolicyId },
          categoryId: selectedCategory!.id,
        };
        if (storeCategoryNames.length > 0) offerPayload.storeCategoryNames = storeCategoryNames;

        const offerRes = await fetch(
          `/api/clawd/ebay?action=create_offer&user_id=${userId}&marketplace_id=EBAY_US`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(offerPayload),
          }
        );

        if (!offerRes.ok) {
          const err = await offerRes.json().catch(() => ({}));
          throw new Error(err.error || t('offerCreateFailed'));
        }

        const offerData = await offerRes.json();

        if (publish && offerData.offerId) {
          const publishRes = await fetch(
            `/api/clawd/ebay?action=publish_offer&offer_id=${offerData.offerId}&user_id=${userId}`,
            { method: 'POST' }
          );

          if (!publishRes.ok) {
            const err = await publishRes.json().catch(() => ({}));
            // The listing exists as a draft — say so instead of implying total failure.
            setFormError(err.error || t('listingCreatedButNotPublished'));
            toast.error(t('listingCreatedButNotPublished'));
            clearStorage(DRAFT_STORAGE_KEY);
            onCreated(baseSku);
            setCreating(false);
            return;
          }
          toast.success(t('listingCreatedAndPublished'));
        } else {
          toast.success(t('draftCreated'));
        }
      }

      writeStorage(POLICY_STORAGE_KEY, {
        fulfillment: fulfillmentPolicyId,
        return: returnPolicyId,
        payment: paymentPolicyId,
      });
      clearStorage(DRAFT_STORAGE_KEY);
      onCreated(baseSku);
      resetForm();
      onClose();
    } catch (err: any) {
      setFormError(err.message || t('createFailed'));
      toast.error(err.message || t('createFailed'));
    } finally {
      setCreating(false);
    }
  };

  // --------------------------------------------------
  // Render helpers
  // --------------------------------------------------

  const sectionSx = {
    p: { xs: 2, sm: 2.5 },
    borderRadius: 2,
    border: '1px solid',
    borderColor: 'divider',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  } as const;

  const renderSectionHeading = (label: string, hint?: string) => (
    <Box>
      <Typography variant="subtitle1" fontWeight={700}>{label}</Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">{hint}</Typography>
      )}
    </Box>
  );

  const renderAiQuickStart = () => (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'primary.light',
        bgcolor: 'action.hover',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesomeIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={700}>{t('aiStartTitle')}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">{t('aiStartHint')}</Typography>

      <Box sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
        <TextField
          value={aiSeed}
          onChange={(e) => setAiSeed(e.target.value)}
          placeholder={t('aiStartPlaceholder')}
          size="small"
          fullWidth
          disabled={autofilling}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !autofilling) runAiAutofill();
          }}
        />
        <Button
          variant="contained"
          onClick={runAiAutofill}
          disabled={autofilling}
          startIcon={autofilling ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {autofilling ? t('aiStartRunning') : title.trim() ? t('aiStartRegenerate') : t('aiStartButton')}
        </Button>
      </Box>

      <Collapse in={autofilling}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
          {AUTOFILL_STEPS.map((id) => {
            const status = autofillStatus?.[id] || 'pending';
            return (
              <Box key={id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {status === 'running' ? (
                  <CircularProgress size={14} />
                ) : status === 'done' ? (
                  <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                ) : status === 'error' ? (
                  <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                ) : (
                  <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                )}
                <Typography
                  variant="caption"
                  color={status === 'pending' ? 'text.disabled' : 'text.primary'}
                >
                  {t(AUTOFILL_STEP_KEYS[id])}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Collapse>
    </Paper>
  );

  const renderMarketInsights = () => {
    if (!marketResearch && !marketLoading) return null;
    return (
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: marketResearch ? 'pointer' : 'default' }}
          onClick={() => marketResearch && setShowMarketInsights((v) => !v)}
        >
          <TrendingUpIcon sx={{ fontSize: 18 }} color="primary" />
          <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
            {t('marketResearch')}
          </Typography>
          {marketLoading && <CircularProgress size={14} />}
        </Box>
        {marketResearch && (
          <>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
              {marketResearch.avgPrice !== undefined && (
                <Chip size="small" label={t('marketAvg', { avg: marketResearch.avgPrice.toFixed(0), currency })} />
              )}
              {marketResearch.demandScore !== undefined && (
                <Chip size="small" color="success" variant="outlined" label={t('marketDemand', { score: marketResearch.demandScore })} />
              )}
              {marketResearch.competitionScore !== undefined && (
                <Chip size="small" color="warning" variant="outlined" label={t('marketCompetition', { score: marketResearch.competitionScore })} />
              )}
            </Box>
            <Collapse in={showMarketInsights}>
              <Box sx={{ mt: 1 }}>
                {(marketResearch.topProducts || []).slice(0, 3).map((p: any, i: number) => (
                  <Typography key={i} variant="caption" display="block" color="text.secondary">
                    • {p.title?.substring(0, 50)} — {p.price} {currency}
                  </Typography>
                ))}
              </Box>
            </Collapse>
          </>
        )}
      </Paper>
    );
  };

  const renderReadiness = () => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="subtitle2" fontWeight={700} gutterBottom>
        {t('readinessTitle')}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {checklist.map((item) => (
          <Box
            key={item.id}
            onClick={() => !item.ok && scrollTo(item.ref)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              cursor: item.ok ? 'default' : 'pointer',
              '&:hover': item.ok ? {} : { color: 'primary.main' },
            }}
          >
            {item.ok ? (
              <CheckCircleIcon sx={{ fontSize: 17, color: 'success.main' }} />
            ) : (
              <RadioButtonUncheckedIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
            )}
            <Typography variant="caption" color={item.ok ? 'text.secondary' : 'text.primary'}>
              {item.label}
            </Typography>
          </Box>
        ))}
      </Box>
      {publishBlockers.length === 0 && (
        <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>
          {t('readinessAllSet')}
        </Typography>
      )}
    </Paper>
  );

  const renderActions = () => (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'row', md: 'column' }, gap: 1 }}>
      <Tooltip title={canPublish ? '' : t('publishBlocked')}>
        <span style={{ width: '100%' }}>
          <Button
            variant="contained"
            fullWidth
            onClick={() => handleCreate(true)}
            disabled={!canPublish}
          >
            {creating ? t('creating') : t('createAndPublish')}
          </Button>
        </span>
      </Tooltip>
      <Button
        variant="outlined"
        fullWidth
        onClick={() => handleCreate(false)}
        disabled={!canCreateDraft}
      >
        {creating ? t('creating') : t('createDraft')}
      </Button>
    </Box>
  );

  const renderSidebar = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {formError && (
        <Alert severity="error" onClose={() => setFormError(null)} sx={{ wordBreak: 'break-word' }}>
          <AlertTitle sx={{ fontSize: '0.85rem' }}>{t('errorTitle')}</AlertTitle>
          <Typography variant="caption">{formError}</Typography>
        </Alert>
      )}

      {renderReadiness()}

      <SEOIndicator
        title={title}
        description={description}
        aspects={aspects}
        imageCount={images.length}
      />

      {renderMarketInsights()}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Button
          fullWidth
          size="small"
          variant="text"
          startIcon={aiLoading === 'analyze' ? <CircularProgress size={14} /> : <AssessmentIcon />}
          onClick={handleAIAnalyzeListing}
          disabled={!!aiLoading || !title.trim()}
        >
          {aiAnalysis ? t('aiReanalyze') : t('aiAnalyzeButton')}
        </Button>
        {aiAnalysis && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {(aiAnalysis.issues || []).slice(0, 4).map((issue: any, i: number) => (
              <Alert
                key={i}
                severity={issue.severity === 'critical' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}
                sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.78rem' } }}
              >
                {issue.message}{issue.fix ? ` — ${issue.fix}` : ''}
              </Alert>
            ))}
            {(aiAnalysis.tips || []).slice(0, 3).map((tip: string, i: number) => (
              <Typography key={i} variant="caption" color="text.secondary">• {tip}</Typography>
            ))}
          </Box>
        )}
      </Paper>

      {!isMobile && renderActions()}
    </Box>
  );

  // --------------------------------------------------
  // Render
  // --------------------------------------------------
  return (
    <Dialog open={open} onClose={handleClose} fullScreen>
      {/* Header */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexShrink: 0,
        }}
      >
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
          {t('newListingTitle')}
        </Typography>
        {hasContent && (
          <Button size="small" color="inherit" onClick={handleStartOver} disabled={creating}>
            {t('draftStartOver')}
          </Button>
        )}
        <IconButton onClick={handleClose} disabled={creating} edge="end">
          <CloseIcon />
        </IconButton>
      </Box>

      {creating && <LinearProgress />}

      {/* Body */}
      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
        {/* Main column */}
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            px: { xs: 2, sm: 3 },
            py: 3,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
          }}
        >
          <Collapse in={draftRestored}>
            <Alert severity="info" onClose={() => setDraftRestored(false)}>
              {t('draftRestoredBanner')}
            </Alert>
          </Collapse>

          {renderAiQuickStart()}

          {/* Photos */}
          <Box ref={photosRef} sx={sectionSx}>
            {renderSectionHeading(t('sectionPhotos'), t('sectionPhotosHint'))}
            <ImageManager
              images={images}
              onImagesChanged={setImages}
              maxImages={24}
              productTitle={title}
            />
          </Box>

          {/* Title & description */}
          <Box ref={contentRef} sx={sectionSx}>
            {renderSectionHeading(t('sectionContent'))}

            <TextField
              label={t('title')}
              value={title}
              onChange={(e) => {
                if (e.target.value.length <= 80) setTitle(e.target.value);
              }}
              fullWidth
              size="small"
              helperText={t('titleCharCount', { count: title.length })}
              inputProps={{ maxLength: 80 }}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={aiLoading === 'title' ? <CircularProgress size={14} /> : <AutoFixHighIcon />}
              onClick={handleAIOptimizeTitle}
              disabled={!!aiLoading || !title.trim()}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('aiImproveTitle')}
            </Button>

            <TextField
              label={t('description')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={6}
              size="small"
              helperText={t('descCharCount', { count: description.length })}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={aiLoading === 'description' ? <CircularProgress size={14} /> : <AutoFixHighIcon />}
              onClick={handleAIGenerateDescription}
              disabled={!!aiLoading || !title.trim()}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('aiWriteDescription')}
            </Button>
          </Box>

          {/* Category & item specifics */}
          <Box ref={categoryRef} sx={sectionSx}>
            {renderSectionHeading(t('sectionCategory'), t('sectionCategoryHint'))}

            <Autocomplete
              options={categoryOptions}
              getOptionLabel={(opt) => (typeof opt === 'string' ? opt : opt.name)}
              inputValue={categorySearchQuery}
              onInputChange={(_, value) => handleCategorySearch(value)}
              value={selectedCategory}
              onChange={(_, value) => {
                if (value && typeof value !== 'string') handleCategorySelected(value);
              }}
              loading={categorySearching}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('categorySearch')}
                  size="small"
                  placeholder={t('categorySearchPlaceholder')}
                />
              )}
              size="small"
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              slotProps={{ popper: { style: { zIndex: 1600 } } }}
            />

            {selectedCategory && (
              <Chip
                label={`${selectedCategory.name} (ID: ${selectedCategory.id})`}
                onDelete={() => {
                  setSelectedCategory(null);
                  setRequiredAspects([]);
                  setRecommendedAspects([]);
                }}
                color="primary"
                variant="outlined"
                size="small"
                sx={{ alignSelf: 'flex-start' }}
              />
            )}

            {selectedCategory && (
              aspectsLoading ? (
                <LinearProgress />
              ) : (
                <ItemSpecificsEditor
                  aspects={aspects}
                  requiredAspects={requiredAspects}
                  recommendedAspects={recommendedAspects}
                  onChange={setAspects}
                  aiLoading={aiLoading === 'aspects'}
                  onAIFill={async (aspectNames, currentAspects) => {
                    setAiLoading('aspects');
                    try {
                      const research = marketResearch || (await fetchMarketResearch(title));
                      const data = await callAI('suggest_aspects', {
                        title: title.trim(),
                        aspectNames,
                        currentAspects,
                        categoryName: selectedCategory?.name,
                        marketResearch: research,
                      });
                      if (data.aspects) {
                        toast.success(t('featuresFilledAI'));
                        return data.aspects;
                      }
                      return null;
                    } catch (err: any) {
                      toast.error(err.message || t('aiAspectsFailed'));
                      return null;
                    } finally {
                      setAiLoading(null);
                    }
                  }}
                />
              )
            )}
          </Box>

          {/* Price & stock */}
          <Box ref={pricingRef} sx={sectionSx}>
            {renderSectionHeading(t('sectionPricing'))}

            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <TextField
                label={t('priceLabel')}
                value={price}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^\d*\.?\d{0,2}$/.test(val) || val === '') setPrice(val);
                }}
                size="small"
                sx={{ flex: 1 }}
                helperText={
                  marketResearch?.avgPrice
                    ? t('priceMarketAvg', { avg: marketResearch.avgPrice.toFixed(2) })
                    : undefined
                }
              />
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <InputLabel>{t('currency')}</InputLabel>
                <Select
                  value={currency}
                  label={t('currency')}
                  onChange={(e: SelectChangeEvent) => setCurrency(e.target.value)}
                  MenuProps={{ sx: { zIndex: 1600 } }}
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label={t('stockLabel')}
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                size="small"
                sx={{ width: { xs: '100%', sm: 110 } }}
                inputProps={{ min: 1 }}
              />
            </Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={aiLoading === 'price' ? <CircularProgress size={14} /> : <TrendingUpIcon />}
              onClick={handleAISuggestPrice}
              disabled={!!aiLoading || !title.trim()}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('aiSuggestPriceBtn')}
            </Button>

            <Divider />

            <ConditionSelector
              condition={condition}
              conditionDescription={conditionDescription}
              onChange={(c, d) => {
                setCondition(c);
                setConditionDescription(d);
              }}
            />

            <TextField
              label={t('skuLabel')}
              value={skuInput}
              onChange={(e) => setSkuInput(e.target.value)}
              fullWidth
              size="small"
              placeholder={t('skuPlaceholder')}
            />
          </Box>

          {/* Shipping & policies */}
          <Box ref={shippingRef} sx={sectionSx}>
            {renderSectionHeading(t('sectionShipping'), t('policiesAutoSelected'))}

            <FormControl size="small" fullWidth>
              <InputLabel>{t('fulfillmentPolicy')}</InputLabel>
              <Select
                value={fulfillmentPolicyId}
                label={t('fulfillmentPolicy')}
                onChange={(e: SelectChangeEvent) => setFulfillmentPolicyId(e.target.value)}
                MenuProps={{ sx: { zIndex: 1600 } }}
              >
                {fulfillmentPolicies.map((p) => (
                  <MenuItem key={p.policyId} value={p.policyId}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel>{t('returnPolicy')}</InputLabel>
              <Select
                value={returnPolicyId}
                label={t('returnPolicy')}
                onChange={(e: SelectChangeEvent) => setReturnPolicyId(e.target.value)}
                MenuProps={{ sx: { zIndex: 1600 } }}
              >
                {returnPolicies.map((p) => (
                  <MenuItem key={p.policyId} value={p.policyId}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel>{t('paymentPolicy')}</InputLabel>
              <Select
                value={paymentPolicyId}
                label={t('paymentPolicy')}
                onChange={(e: SelectChangeEvent) => setPaymentPolicyId(e.target.value)}
                MenuProps={{ sx: { zIndex: 1600 } }}
              >
                {paymentPolicies.map((p) => (
                  <MenuItem key={p.policyId} value={p.policyId}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {storeCategories.length > 0 && (
              <>
                <Divider />
                <FormControl size="small" fullWidth>
                  <InputLabel>{t('primaryStoreCategory')}</InputLabel>
                  <Select
                    value={selectedStoreCategory}
                    label={t('primaryStoreCategory')}
                    onChange={(e: SelectChangeEvent) => setSelectedStoreCategory(e.target.value)}
                    MenuProps={{ sx: { zIndex: 1600 } }}
                  >
                    <MenuItem value="">{t('notSelected')}</MenuItem>
                    {storeCategories.map((c) => (
                      <MenuItem key={c} value={c}>{c}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>{t('secondaryStoreCategory')}</InputLabel>
                  <Select
                    value={selectedStoreCategory2}
                    label={t('secondaryStoreCategory')}
                    onChange={(e: SelectChangeEvent) => setSelectedStoreCategory2(e.target.value)}
                    MenuProps={{ sx: { zIndex: 1600 } }}
                  >
                    <MenuItem value="">{t('notSelected')}</MenuItem>
                    {storeCategories.map((c) => (
                      <MenuItem key={c} value={c}>{c}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </>
            )}
          </Box>

          {/* Variations */}
          <Box sx={sectionSx}>
            {renderSectionHeading(t('sectionVariations'), t('variationsHint'))}
            <Button
              variant={hasVariations ? 'contained' : 'outlined'}
              size="small"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => {
                setHasVariations(!hasVariations);
                if (hasVariations) {
                  setVariationAspects([]);
                  setVariationRows([]);
                }
              }}
            >
              {hasVariations ? t('variationsActive') : t('addVariations')}
            </Button>

            <Collapse in={hasVariations}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {variationAspects.map((aspect, idx) => (
                  <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField
                      label={t('variationAspectName')}
                      value={aspect.name}
                      onChange={(e) => {
                        const updated = [...variationAspects];
                        updated[idx] = { ...updated[idx], name: e.target.value };
                        setVariationAspects(updated);
                      }}
                      size="small"
                      sx={{ width: 150 }}
                      placeholder={t('variationAspectNamePlaceholder')}
                    />
                    <TextField
                      label={t('variationAspectValues')}
                      value={aspect.values.join(', ')}
                      onChange={(e) => {
                        const updated = [...variationAspects];
                        updated[idx] = {
                          ...updated[idx],
                          values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                        };
                        setVariationAspects(updated);
                      }}
                      size="small"
                      sx={{ flex: 1 }}
                      placeholder={t('variationAspectValuesPlaceholder')}
                      onBlur={() => generateVariationRows(variationAspects)}
                    />
                    <Button
                      size="small"
                      color="error"
                      onClick={() => {
                        const updated = variationAspects.filter((_, i) => i !== idx);
                        setVariationAspects(updated);
                        generateVariationRows(updated);
                      }}
                      sx={{ minWidth: 36 }}
                    >
                      ✕
                    </Button>
                  </Box>
                ))}

                <Button
                  size="small"
                  variant="outlined"
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() => setVariationAspects([...variationAspects, { name: '', values: [] }])}
                >
                  {t('addAspect')}
                </Button>

                {variationRows.length > 0 && (
                  <Box
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      overflow: 'auto',
                      maxHeight: 320,
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ background: theme.palette.action.hover }}>
                          {variationAspects.filter((a) => a.name).map((a) => (
                            <th key={a.name} style={{ padding: '6px 8px', textAlign: 'left' }}>{a.name}</th>
                          ))}
                          <th style={{ padding: '6px 8px', textAlign: 'left' }}>SKU</th>
                          <th style={{ padding: '6px 8px', textAlign: 'left' }}>{t('variationTablePrice')}</th>
                          <th style={{ padding: '6px 8px', textAlign: 'left' }}>{t('variationTableStock')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variationRows.map((row, idx) => (
                          <tr key={idx}>
                            {variationAspects.filter((a) => a.name).map((a) => (
                              <td key={a.name} style={{ padding: '4px 8px' }}>{row.combination[a.name]}</td>
                            ))}
                            <td style={{ padding: '4px 8px' }}>
                              <input
                                value={row.sku}
                                onChange={(e) => {
                                  const updated = [...variationRows];
                                  updated[idx] = { ...updated[idx], sku: e.target.value };
                                  setVariationRows(updated);
                                }}
                                style={{ width: '100%', padding: '3px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: '0.8rem' }}
                              />
                            </td>
                            <td style={{ padding: '4px 8px' }}>
                              <input
                                type="number"
                                value={row.price}
                                onChange={(e) => {
                                  const updated = [...variationRows];
                                  updated[idx] = { ...updated[idx], price: e.target.value };
                                  setVariationRows(updated);
                                }}
                                style={{ width: 80, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: '0.8rem' }}
                              />
                            </td>
                            <td style={{ padding: '4px 8px' }}>
                              <input
                                type="number"
                                value={row.quantity}
                                onChange={(e) => {
                                  const updated = [...variationRows];
                                  updated[idx] = { ...updated[idx], quantity: e.target.value };
                                  setVariationRows(updated);
                                }}
                                style={{ width: 60, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: '0.8rem' }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                )}

                <Typography variant="caption" color="text.secondary">{t('variationNote')}</Typography>
              </Box>
            </Collapse>
          </Box>

          {/* Sidebar content inline on mobile */}
          {isMobile && renderSidebar()}
        </Box>

        {/* Sidebar */}
        {!isMobile && (
          <Box
            sx={{
              width: 340,
              flexShrink: 0,
              borderLeft: '1px solid',
              borderColor: 'divider',
              overflowY: 'auto',
              px: 2,
              py: 3,
            }}
          >
            {renderSidebar()}
          </Box>
        )}
      </Box>

      {/* Mobile action bar */}
      {isMobile && (
        <Box
          sx={{
            px: 2,
            py: 1.5,
            borderTop: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
            bgcolor: 'background.paper',
          }}
        >
          {renderActions()}
        </Box>
      )}
    </Dialog>
  );
}
