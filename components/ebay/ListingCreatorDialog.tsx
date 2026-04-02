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
  CircularProgress,
  Collapse,
  Paper,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import SEOIndicator from './SEOIndicator';
import ImageManager from './ImageManager';
import ItemSpecificsEditor from './ItemSpecificsEditor';
import ConditionSelector from './ConditionSelector';
import VariationEditor from './VariationEditor';

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

// STEPS is now computed inside the component using t()

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'GBP', label: 'GBP' },
  { value: 'EUR', label: 'EUR' },
  { value: 'TRY', label: 'TRY' },
];

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
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const STEPS = [t('stepBasicInfo'), t('stepCategoryPrice'), t('stepImagesVariations'), t('stepPoliciesPreview')];

  const [activeStep, setActiveStep] = useState(0);
  const [creating, setCreating] = useState(false);

  // AI & Market Research
  const [marketResearch, setMarketResearch] = useState<Record<string, any> | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState<string | null>(null); // which AI action is loading
  const [aiAnalysis, setAiAnalysis] = useState<{ score: number; issues: any[]; tips: string[] } | null>(null);
  const [showMarketInsights, setShowMarketInsights] = useState(false);

  // Step 1: Basic Info
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [condition, setCondition] = useState('NEW');
  const [conditionDescription, setConditionDescription] = useState('');

  // Step 2: Category & Price
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

  // Step 3: Images
  const [images, setImages] = useState<string[]>([]);

  // Step 4: Policies & Store
  const [fulfillmentPolicyId, setFulfillmentPolicyId] = useState('');
  const [returnPolicyId, setReturnPolicyId] = useState('');
  const [paymentPolicyId, setPaymentPolicyId] = useState('');
  const [storeCategories, setStoreCategories] = useState<string[]>([]);
  const [selectedStoreCategory, setSelectedStoreCategory] = useState('');
  const [selectedStoreCategory2, setSelectedStoreCategory2] = useState('');

  // Variations
  const [hasVariations, setHasVariations] = useState(false);
  const [variationAspects, setVariationAspects] = useState<VariationAspect[]>([]);
  const [variationRows, setVariationRows] = useState<VariationRow[]>([]);

  const categorySearchTimeout = useRef<NodeJS.Timeout | null>(null);
  const [autoSuggestedCategories, setAutoSuggestedCategories] = useState(false);

  // Fetch store categories when dialog opens
  useEffect(() => {
    if (open && storeCategories.length === 0) {
      fetch(`/api/clawd/ebay?action=store_categories&user_id=${userId}`)
        .then(r => r.ok ? r.json() : { categories: [] })
        .then(data => setStoreCategories(data.categories || []))
        .catch(() => {});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------
  // Market Research
  // --------------------------------------------------
  const fetchMarketResearch = async (query: string): Promise<Record<string, any> | null> => {
    if (!query.trim()) return null;
    setMarketLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay-research?action=niche_analyze&q=${encodeURIComponent(query)}&marketplace_id=EBAY_US&user_id=${userId}`,
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

  // --------------------------------------------------
  // AI Helpers
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

  const handleAIOptimizeTitle = async () => {
    if (!title.trim()) { toast.error(t('enterTitleFirst')); return; }
    setAiLoading('title');
    try {
      const research = marketResearch || await fetchMarketResearch(title);
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
      const research = marketResearch || await fetchMarketResearch(title);
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
      const research = marketResearch || await fetchMarketResearch(title);
      const data = await callAI('suggest_price', {
        title: title.trim(),
        condition,
        categoryName: selectedCategory?.name,
        marketResearch: research,
      });
      if (data.suggestedPrice) {
        setPrice(String(data.suggestedPrice));
        toast.success(
          t('suggestedPrice', { price: data.suggestedPrice, currency, min: data.priceRange?.min, max: data.priceRange?.max })
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
      const research = marketResearch || await fetchMarketResearch(title);
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

  // Auto-fetch market research when title is substantial enough
  const marketResearchFetched = useRef(false);
  useEffect(() => {
    if (title.trim().length >= 15 && !marketResearch && !marketResearchFetched.current && open) {
      marketResearchFetched.current = true;
      fetchMarketResearch(title.trim());
    }
  }, [title, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------
  // Category search with debounce
  // --------------------------------------------------
  const fetchCategorySuggestions = async (query: string): Promise<CategoryOption[]> => {
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=category_suggestions&q=${encodeURIComponent(query)}&user_id=${userId}`,
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

  const handleCategorySearch = (query: string) => {
    setCategorySearchQuery(query);

    if (categorySearchTimeout.current) {
      clearTimeout(categorySearchTimeout.current);
    }

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

  // Auto-suggest categories based on title when entering step 2
  useEffect(() => {
    if (activeStep === 1 && title.trim() && !autoSuggestedCategories && !selectedCategory) {
      setAutoSuggestedCategories(true);
      setCategorySearching(true);
      fetchCategorySuggestions(title.trim()).then((results) => {
        setCategoryOptions(results);
        setCategorySearching(false);
        // Auto-select the first suggestion (most relevant)
        if (results.length > 0 && !selectedCategory) {
          setSelectedCategory(results[0]);
          setCategorySearchQuery(results[0].name);
          fetchAspectsForCategory(results[0].id);
        }
      });
    }
  }, [activeStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------
  // Fetch item aspects when category selected
  // --------------------------------------------------
  const fetchAspectsForCategory = async (categoryId: string) => {
    setAspectsLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=item_aspects&category_id=${categoryId}&user_id=${userId}`,
      );
      if (res.ok) {
        const data = await res.json();
        const allAspects: AspectMetadata[] = data.aspects || [];
        setRequiredAspects(allAspects.filter((a) => a.aspectConstraint.aspectRequired));
        setRecommendedAspects(allAspects.filter((a) => !a.aspectConstraint.aspectRequired));
      }
    } catch {
      // Non-critical
    } finally {
      setAspectsLoading(false);
    }
  };

  // --------------------------------------------------
  // Reset form
  // --------------------------------------------------
  const resetForm = useCallback(() => {
    setActiveStep(0);
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
    setCreating(false);
    setAutoSuggestedCategories(false);
    setSelectedStoreCategory('');
    setSelectedStoreCategory2('');
    setHasVariations(false);
    setVariationAspects([]);
    setVariationRows([]);
    setMarketResearch(null);
    setAiLoading(null);
    setAiAnalysis(null);
    setShowMarketInsights(false);
    marketResearchFetched.current = false;
  }, []);

  // Generate variation rows from aspects
  const generateVariationRows = (aspects: VariationAspect[]) => {
    const validAspects = aspects.filter(a => a.name && a.values.length > 0);
    if (validAspects.length === 0) {
      setVariationRows([]);
      return;
    }

    // Cartesian product of all aspect values
    const combinations: Record<string, string>[] = [{}];
    for (const aspect of validAspects) {
      const newCombinations: Record<string, string>[] = [];
      for (const combo of combinations) {
        for (const value of aspect.values) {
          newCombinations.push({ ...combo, [aspect.name]: value });
        }
      }
      combinations.length = 0;
      combinations.push(...newCombinations);
    }

    // Preserve existing row data where possible
    const rows: VariationRow[] = combinations.map((combo) => {
      const key = Object.values(combo).join('-');
      const existing = variationRows.find(r =>
        Object.values(r.combination).join('-') === key
      );
      return {
        combination: combo,
        sku: existing?.sku || `${skuInput || 'VAR'}-${key}`,
        price: existing?.price || price || '',
        quantity: existing?.quantity || '1',
      };
    });

    setVariationRows(rows);
  };

  const handleClose = () => {
    if (creating) return;
    resetForm();
    onClose();
  };

  // --------------------------------------------------
  // Validation
  // --------------------------------------------------
  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        if (!title.trim()) {
          toast.error(t('titleRequired'));
          return false;
        }
        if (!description.trim()) {
          toast.error(t('descriptionRequired'));
          return false;
        }
        return true;
      case 1:
        if (!selectedCategory) {
          toast.error(t('categoryRequired'));
          return false;
        }
        if (!price || parseFloat(price) <= 0) {
          toast.error(t('validPriceRequired'));
          return false;
        }
        return true;
      case 2:
        return true;
      default:
        return true;
    }
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
  // Create listing
  // --------------------------------------------------
  const handleCreate = async (publish: boolean) => {
    // Validate policies
    if (!fulfillmentPolicyId) {
      toast.error(t('fulfillmentPolicyRequired'));
      return;
    }
    if (!returnPolicyId) {
      toast.error(t('returnPolicyRequired'));
      return;
    }
    if (!paymentPolicyId) {
      toast.error(t('paymentPolicyRequired'));
      return;
    }

    // Validate variations
    if (hasVariations && variationRows.length === 0) {
      toast.error(t('variationsRequired'));
      return;
    }

    setCreating(true);
    try {
      const baseSku = skuInput.trim() || `SKU-${Date.now()}`;

      const storeCategoryNames: string[] = [];
      if (selectedStoreCategory) storeCategoryNames.push(selectedStoreCategory);
      if (selectedStoreCategory2) storeCategoryNames.push(selectedStoreCategory2);

      if (hasVariations && variationRows.length > 0) {
        // ---- VARIATION LISTING FLOW ----
        // 1. Create individual inventory items for each variation
        for (const row of variationRows) {
          const varAspects = { ...aspects };
          // Add variation-specific aspects
          for (const [key, value] of Object.entries(row.combination)) {
            varAspects[key] = [value];
          }

          const inventoryPayload = {
            product: {
              title: title.trim(),
              description: description.trim(),
              aspects: varAspects,
              imageUrls: images,
            },
            condition,
            conditionDescription: condition !== 'NEW' ? conditionDescription : undefined,
            availability: {
              shipToLocationAvailability: {
                quantity: parseInt(row.quantity) || 1,
              },
            },
          };

          const inventoryRes = await fetch(
            `/api/clawd/ebay?action=create_inventory_item&sku=${encodeURIComponent(row.sku)}&user_id=${userId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(inventoryPayload),
            }
          );

          if (!inventoryRes.ok) {
            const err = await inventoryRes.json().catch(() => ({}));
            throw new Error(err.error || t('variationItemCreateFailed', { sku: row.sku }));
          }
        }

        // 2. Create inventory item group
        const varAspectNames = variationAspects.filter(a => a.name && a.values.length).map(a => a.name);
        const groupPayload = {
          title: title.trim(),
          description: description.trim(),
          imageUrls: images,
          aspects: Object.fromEntries(
            Object.entries(aspects).filter(([key]) => !varAspectNames.includes(key))
          ),
          variantSKUs: variationRows.map(r => r.sku),
          variesBy: {
            aspectsImageVariesBy: [],
            specifications: variationAspects
              .filter(a => a.name && a.values.length)
              .map(a => ({ name: a.name, values: a.values })),
          },
        };

        const groupRes = await fetch(
          `/api/clawd/ebay?action=create_inventory_item_group&sku=${encodeURIComponent(baseSku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(groupPayload),
          }
        );

        if (!groupRes.ok) {
          const err = await groupRes.json().catch(() => ({}));
          throw new Error(err.error || t('variationGroupCreateFailed'));
        }

        // 3. Create offers for each variation SKU
        for (const row of variationRows) {
          const offerPayload: Record<string, any> = {
            sku: row.sku,
            marketplaceId: 'EBAY_US',
            format: 'FIXED_PRICE',
            availableQuantity: parseInt(row.quantity) || 1,
            listingDuration: 'GTC',
            listingDescription: description.trim(),
            pricingSummary: {
              price: { value: row.price || price, currency },
            },
            listingPolicies: { fulfillmentPolicyId, returnPolicyId, paymentPolicyId },
            categoryId: selectedCategory!.id,
          };
          if (storeCategoryNames.length > 0) {
            offerPayload.storeCategoryNames = storeCategoryNames;
          }

          const offerRes = await fetch(
            `/api/clawd/ebay?action=create_offer&user_id=${userId}`,
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

          // Publish each offer if requested
          if (publish && offerData.offerId) {
            await fetch(
              `/api/clawd/ebay?action=publish_offer&offer_id=${offerData.offerId}&user_id=${userId}`,
              { method: 'POST' }
            ).catch(() => {});
          }
        }

        toast.success(publish ? t('variationListingPublished') : t('variationDraftCreated'));
      } else {
        // ---- SIMPLE LISTING FLOW ----
        // 1. Create inventory item
        const inventoryPayload = {
          product: {
            title: title.trim(),
            description: description.trim(),
            aspects,
            imageUrls: images,
          },
          condition,
          conditionDescription: condition !== 'NEW' ? conditionDescription : undefined,
          availability: {
            shipToLocationAvailability: {
              quantity: parseInt(quantity) || 1,
            },
          },
        };

        const inventoryRes = await fetch(
          `/api/clawd/ebay?action=create_inventory_item&sku=${encodeURIComponent(baseSku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inventoryPayload),
          }
        );

        if (!inventoryRes.ok) {
          const err = await inventoryRes.json().catch(() => ({}));
          throw new Error(err.error || t('inventoryItemCreateFailed'));
        }

        // 2. Create offer — include all fields required for publishing
        const offerPayload: Record<string, any> = {
          sku: baseSku,
          marketplaceId: 'EBAY_US',
          format: 'FIXED_PRICE',
          availableQuantity: parseInt(quantity) || 1,
          listingDuration: 'GTC',
          listingDescription: description.trim(),
          pricingSummary: {
            price: { value: price, currency },
          },
          listingPolicies: { fulfillmentPolicyId, returnPolicyId, paymentPolicyId },
          categoryId: selectedCategory!.id,
        };

        if (storeCategoryNames.length > 0) {
          offerPayload.storeCategoryNames = storeCategoryNames;
        }

        const offerRes = await fetch(
          `/api/clawd/ebay?action=create_offer&user_id=${userId}`,
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

        // 3. Optionally publish
        if (publish && offerData.offerId) {
          const publishRes = await fetch(
            `/api/clawd/ebay?action=publish_offer&offer_id=${offerData.offerId}&user_id=${userId}`,
            { method: 'POST' }
          );

          if (!publishRes.ok) {
            toast.error(t('listingCreatedButNotPublished'));
          } else {
            toast.success(t('listingCreatedAndPublished'));
          }
        } else {
          toast.success(t('draftCreated'));
        }
      }

      onCreated(baseSku);
      handleClose();
    } catch (err: any) {
      toast.error(err.message || t('createFailed'));
    } finally {
      setCreating(false);
    }
  };

  // --------------------------------------------------
  // Render steps
  // --------------------------------------------------
  const renderMarketInsightsBar = () => {
    if (!marketResearch && !marketLoading) return null;
    return (
      <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: marketResearch && showMarketInsights ? 1 : 0 }}>
          <TrendingUpIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
            {t('marketResearch')}
            {marketLoading && ` ${t('loading')}`}
          </Typography>
          {marketLoading && <CircularProgress size={14} />}
          {marketResearch && (
            <>
              <Chip label={`${t('avg')} ${marketResearch.avgPrice?.toFixed(0) || '?'} ${currency}`} size="small" color="info" variant="outlined" sx={{ height: 26, fontSize: '0.85rem' }} />
              <Chip label={`${t('demand')}: ${marketResearch.demandScore || '?'}/100`} size="small" color={marketResearch.demandScore > 60 ? 'success' : 'warning'} variant="outlined" sx={{ height: 26, fontSize: '0.85rem' }} />
              <Chip label={`${t('competition')}: ${marketResearch.competitionScore || '?'}/100`} size="small" color={marketResearch.competitionScore < 50 ? 'success' : 'error'} variant="outlined" sx={{ height: 26, fontSize: '0.85rem' }} />
              <Button size="small" sx={{ minWidth: 0, fontSize: '0.85rem', p: 0.5 }} onClick={() => setShowMarketInsights(!showMarketInsights)}>
                {showMarketInsights ? t('hide') : t('details')}
              </Button>
            </>
          )}
        </Box>
        <Collapse in={showMarketInsights && !!marketResearch}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 0.5 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('priceRange')}</Typography>
              <Typography variant="body2" fontWeight={600}>
                {marketResearch?.priceRange?.min?.toFixed(0)} - {marketResearch?.priceRange?.max?.toFixed(0)} {currency}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('medianPrice')}</Typography>
              <Typography variant="body2" fontWeight={600}>{marketResearch?.medianPrice?.toFixed(2)} {currency}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('totalResults')}</Typography>
              <Typography variant="body2" fontWeight={600}>{marketResearch?.totalResults?.toLocaleString()}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('freeShipping')}</Typography>
              <Typography variant="body2" fontWeight={600}>{marketResearch?.freeShippingPct?.toFixed(0)}%</Typography>
            </Box>
            {(marketResearch?.topProducts || []).length > 0 && (
              <Box sx={{ width: '100%' }}>
                <Typography variant="caption" color="text.secondary">{t('topSellers')}:</Typography>
                {marketResearch!.topProducts.slice(0, 3).map((p: any, i: number) => (
                  <Typography key={i} variant="caption" display="block" sx={{ ml: 1 }}>
                    • {p.title?.substring(0, 60)} — {p.price} {currency} ({p.soldQuantity || 0} {t('salesCount')})
                  </Typography>
                ))}
              </Box>
            )}
          </Box>
        </Collapse>
      </Paper>
    );
  };

  const renderStep0 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2 }}>
      {/* Market insights bar */}
      {renderMarketInsightsBar()}

      <Box sx={{ display: 'flex', gap: 1, alignItems: { xs: 'stretch', sm: 'flex-end' }, flexDirection: { xs: 'column', sm: 'row' } }}>
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
          autoFocus
        />
        <Button
          variant="outlined"
          size="small"
          onClick={handleAIOptimizeTitle}
          disabled={!!aiLoading || !title.trim()}
          sx={{ minWidth: 0, px: 1.5, mb: { xs: 0, sm: 2.5 }, flexShrink: 0 }}
          title={t('titleAITooltip')}
        >
          {aiLoading === 'title' ? <CircularProgress size={18} /> : <AutoFixHighIcon sx={{ fontSize: 18 }} />}
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: { xs: 'stretch', sm: 'flex-start' }, flexDirection: { xs: 'column', sm: 'row' } }}>
        <TextField
          label={t('description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={5}
          size="small"
          helperText={t('descCharCount', { count: description.length })}
        />
        <Button
          variant="outlined"
          size="small"
          onClick={handleAIGenerateDescription}
          disabled={!!aiLoading || !title.trim()}
          sx={{ minWidth: 0, px: 1.5, mt: { xs: 0, sm: 0.5 }, flexShrink: 0 }}
          title={t('descAITooltip')}
        >
          {aiLoading === 'description' ? <CircularProgress size={18} /> : <AutoFixHighIcon sx={{ fontSize: 18 }} />}
        </Button>
      </Box>

      {/* Quick actions */}
      {title.trim().length >= 5 && !marketResearch && !marketLoading && (
        <Button
          variant="text"
          size="small"
          startIcon={<TrendingUpIcon />}
          onClick={() => fetchMarketResearch(title.trim())}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('doMarketResearch')}
        </Button>
      )}

      <TextField
        label={t('skuLabel')}
        value={skuInput}
        onChange={(e) => setSkuInput(e.target.value)}
        fullWidth
        size="small"
        placeholder={t('skuPlaceholder')}
      />

      <ConditionSelector
        condition={condition}
        conditionDescription={conditionDescription}
        onChange={(c, d) => {
          setCondition(c);
          setConditionDescription(d);
        }}
      />
    </Box>
  );

  const renderStep1 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2 }}>
      {/* Category search */}
      <Autocomplete
        options={categoryOptions}
        getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.name}
        inputValue={categorySearchQuery}
        onInputChange={(_, value) => handleCategorySearch(value)}
        value={selectedCategory}
        onChange={(_, value) => {
          if (value && typeof value !== 'string') {
            setSelectedCategory(value);
            fetchAspectsForCategory(value.id);
          }
        }}
        loading={categorySearching}
        renderInput={(params) => (
          <TextField
            {...params}
            label={t('categorySearch')}
            size="small"
            placeholder={t('categorySearchPlaceholder')}
            required
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
        />
      )}

      {/* Market insights on price step too */}
      {renderMarketInsightsBar()}

      <Box sx={{ display: 'flex', gap: 2, alignItems: { xs: 'stretch', sm: 'flex-end' }, flexDirection: { xs: 'column', sm: 'row' } }}>
        <TextField
          label={t('priceLabel')}
          value={price}
          onChange={(e) => {
            const val = e.target.value;
            if (/^\d*\.?\d{0,2}$/.test(val) || val === '') {
              setPrice(val);
            }
          }}
          size="small"
          sx={{ flex: 1 }}
          required
          helperText={marketResearch?.avgPrice ? t('priceMarketAvg', { avg: marketResearch.avgPrice.toFixed(2) }) : undefined}
        />
        <Button
          variant="outlined"
          size="small"
          onClick={handleAISuggestPrice}
          disabled={!!aiLoading || !title.trim()}
          sx={{ minWidth: 0, px: 1.5, mb: { xs: 0, sm: marketResearch?.avgPrice ? 2.5 : 0 }, flexShrink: 0 }}
          title={t('priceAITooltip')}
        >
          {aiLoading === 'price' ? <CircularProgress size={18} /> : <TrendingUpIcon sx={{ fontSize: 18 }} />}
        </Button>
        <FormControl size="small" sx={{ minWidth: 90, width: { xs: '100%', sm: 'auto' } }}>
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
          sx={{ width: { xs: '100%', sm: 100 } }}
          inputProps={{ min: 1 }}
        />
      </Box>

      {/* Item specifics */}
      {selectedCategory && (
        <>
          <Divider />
          {aspectsLoading ? (
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
                  const research = marketResearch || await fetchMarketResearch(title);
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
          )}
        </>
      )}
    </Box>
  );

  const renderStep2 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2 }}>
      <Typography variant="subtitle2" fontWeight={600}>{t('imagesSection')}</Typography>
      <ImageManager
        images={images}
        onImagesChanged={setImages}
        maxImages={24}
        productTitle={title}
      />

      <Divider />

      <Typography variant="subtitle2" fontWeight={600}>{t('variationsSection')}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          variant={hasVariations ? 'contained' : 'outlined'}
          size="small"
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
        {!hasVariations && (
          <Typography variant="caption" color="text.secondary">
            {t('variationsHint')}
          </Typography>
        )}
      </Box>

      {hasVariations && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Variation aspect definitions */}
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
                sx={{ width: 140 }}
                placeholder={t('variationAspectNamePlaceholder')}
              />
              <TextField
                label={t('variationAspectValues')}
                value={aspect.values.join(', ')}
                onChange={(e) => {
                  const updated = [...variationAspects];
                  updated[idx] = {
                    ...updated[idx],
                    values: e.target.value.split(',').map(v => v.trim()).filter(Boolean),
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
                X
              </Button>
            </Box>
          ))}

          <Button
            size="small"
            variant="outlined"
            onClick={() => setVariationAspects([...variationAspects, { name: '', values: [] }])}
          >
            {t('addAspect')}
          </Button>

          {/* Variation rows table */}
          {variationRows.length > 0 && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'auto', maxHeight: 300, maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    {variationAspects.filter(a => a.name).map(a => (
                      <th key={a.name} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>{a.name}</th>
                    ))}
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>SKU</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>{t('variationTablePrice')}</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>{t('variationTableStock')}</th>
                  </tr>
                </thead>
                <tbody>
                  {variationRows.map((row, idx) => (
                    <tr key={idx}>
                      {variationAspects.filter(a => a.name).map(a => (
                        <td key={a.name} style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                          {row.combination[a.name]}
                        </td>
                      ))}
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
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
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
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
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
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

          <Typography variant="caption" color="text.secondary">
            {t('variationNote')}
          </Typography>
        </Box>
      )}
    </Box>
  );

  const renderStep3 = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2 }}>
      {/* Policy selects */}
      <FormControl size="small" fullWidth required>
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

      <FormControl size="small" fullWidth required>
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

      <FormControl size="small" fullWidth required>
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

      {/* Store categories */}
      {storeCategories.length > 0 && (
        <>
          <Divider />
          <Typography variant="subtitle2" fontWeight={500}>{t('storeCategories')}</Typography>
          <FormControl size="small" fullWidth>
            <InputLabel>{t('primaryStoreCategory')}</InputLabel>
            <Select
              value={selectedStoreCategory}
              label={t('primaryStoreCategory')}
              onChange={(e: SelectChangeEvent) => setSelectedStoreCategory(e.target.value)}
              MenuProps={{ sx: { zIndex: 1600 } }}
            >
              <MenuItem value=""><em>{t('notSelected')}</em></MenuItem>
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
              <MenuItem value=""><em>{t('notSelected')}</em></MenuItem>
              {storeCategories.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </>
      )}

      <Divider />

      {/* Summary / Preview */}
      <Typography variant="subtitle2" fontWeight={600}>{t('summary')}</Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">{t('summaryTitle')}</Typography>
          <Typography variant="caption" fontWeight={600}>
            {title.length > 50 ? title.slice(0, 50) + '...' : title}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">{t('summaryCategory')}</Typography>
          <Typography variant="caption" fontWeight={600}>{selectedCategory?.name || '-'}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">{t('summaryPrice')}</Typography>
          <Typography variant="caption" fontWeight={600}>{price} {currency}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">{t('summaryStock')}</Typography>
          <Typography variant="caption" fontWeight={600}>{quantity}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">{t('summaryImages')}</Typography>
          <Typography variant="caption" fontWeight={600}>{images.length}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">{t('summaryCondition')}</Typography>
          <Typography variant="caption" fontWeight={600}>{condition}</Typography>
        </Box>
      </Box>

      {/* SEO score */}
      <SEOIndicator
        title={title}
        description={description}
        aspects={aspects}
        imageCount={images.length}
      />

      {/* AI Analysis */}
      <Button
        variant="outlined"
        size="small"
        startIcon={aiLoading === 'analyze' ? <CircularProgress size={16} /> : <AssessmentIcon />}
        onClick={handleAIAnalyzeListing}
        disabled={!!aiLoading || !title.trim()}
        fullWidth
      >
        {aiLoading === 'analyze' ? t('analyzing') : t('aiListingAnalysis')}
      </Button>

      {aiAnalysis && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Box
              sx={{
                width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: aiAnalysis.score >= 80 ? 'success.light' : aiAnalysis.score >= 50 ? 'warning.light' : 'error.light',
                color: aiAnalysis.score >= 80 ? 'success.dark' : aiAnalysis.score >= 50 ? 'warning.dark' : 'error.dark',
              }}
            >
              <Typography variant="h6" fontWeight={700}>{aiAnalysis.score}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" fontWeight={600}>{t('listingQualityScore')}</Typography>
              <Typography variant="caption" color="text.secondary">
                {aiAnalysis.score >= 80 ? t('scoreGreat') : aiAnalysis.score >= 50 ? t('scoreMedium') : t('scorePoor')}
              </Typography>
            </Box>
          </Box>

          {(aiAnalysis.issues || []).length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
              {aiAnalysis.issues.map((issue: any, i: number) => (
                <Alert
                  key={i}
                  severity={issue.severity === 'critical' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}
                  sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.85rem' } }}
                >
                  <strong>{issue.message}</strong>{issue.fix ? ` — ${issue.fix}` : ''}
                </Alert>
              ))}
            </Box>
          )}

          {(aiAnalysis.tips || []).length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" fontWeight={600}>{t('tips')}</Typography>
              {aiAnalysis.tips.map((tip: string, i: number) => (
                <Typography key={i} variant="caption" display="block" sx={{ ml: 1 }}>• {tip}</Typography>
              ))}
            </Box>
          )}
        </Paper>
      )}

      {/* Create buttons */}
      <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
        <Button
          variant="outlined"
          fullWidth
          onClick={() => handleCreate(false)}
          disabled={creating}
        >
          {creating ? t('creating') : t('createDraft')}
        </Button>
        <Button
          variant="contained"
          fullWidth
          onClick={() => handleCreate(true)}
          disabled={creating}
        >
          {creating ? t('creating') : t('createAndPublish')}
        </Button>
      </Box>
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullScreen={isMobile}
      maxWidth="md"
      fullWidth
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 3, pt: 2 }}>
        <Typography variant="h6" fontWeight={600}>
          {t('newListingTitle')}
        </Typography>
        <IconButton onClick={handleClose} disabled={creating}>
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Stepper */}
      <Box sx={{ px: 3, pt: 2 }}>
        <Stepper activeStep={activeStep} alternativeLabel={isMobile}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      {/* Step content */}
      <Box sx={{ px: 3, pb: 3, overflow: 'auto', flex: 1 }}>
        {creating && <LinearProgress sx={{ mt: 2 }} />}

        {activeStep === 0 && renderStep0()}
        {activeStep === 1 && renderStep1()}
        {activeStep === 2 && renderStep2()}
        {activeStep === 3 && renderStep3()}

        {/* Navigation buttons (not on last step — it has its own buttons) */}
        {activeStep < 3 && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
            <Button
              onClick={handleBack}
              disabled={activeStep === 0 || creating}
            >
              {t('back')}
            </Button>
            <Button
              variant="contained"
              onClick={handleNext}
              disabled={creating}
            >
              {t('next')}
            </Button>
          </Box>
        )}

        {activeStep === 3 && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 2 }}>
            <Button onClick={handleBack} disabled={creating}>
              {t('back')}
            </Button>
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
