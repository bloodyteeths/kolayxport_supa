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
  Chip,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Tooltip,
  useMediaQuery,
  useTheme,
  Alert,
  Collapse,
  Paper,
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
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { toast } from 'react-hot-toast';

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

interface ListingEditorDrawerProps {
  open: boolean;
  onClose: () => void;
  sku: string;
  userId: string;
  fulfillmentPolicies: Policy[];
  returnPolicies: Policy[];
  paymentPolicies: Policy[];
  onSaved: () => void;
}

interface AspectMetadata {
  localizedAspectName: string;
  aspectConstraint: {
    aspectRequired: boolean;
    aspectMode: 'FREE_TEXT' | 'SELECTION_ONLY';
    aspectValues?: { localizedValue: string }[];
  };
}

interface EbayListingData {
  sku: string;
  isLegacy?: boolean;
  legacyItemId?: string;
  itemWebUrl?: string;
  product?: {
    title?: string;
    description?: string;
    subtitle?: string;
    aspects?: Record<string, string[]>;
    imageUrls?: string[];
    brand?: string;
  };
  condition?: string;
  conditionDescription?: string;
  availability?: {
    shipToLocationAvailability?: {
      quantity?: number;
    };
  };
  offers?: Array<{
    offerId?: string;
    status?: string;
    pricingSummary?: {
      price?: { value: string; currency: string };
    };
    listingPolicies?: {
      fulfillmentPolicyId?: string;
      returnPolicyId?: string;
      paymentPolicyId?: string;
    };
    categoryId?: string;
    listingDescription?: string;
  }>;
  packageWeightAndSize?: {
    weight?: { value: number; unit: string };
    dimensions?: {
      length: number;
      width: number;
      height: number;
      unit: string;
    };
  };
}

interface EditableFields {
  title: string;
  description: string;
  subtitle: string;
  images: string[];
  aspects: Record<string, string[]>;
  condition: string;
  conditionDescription: string;
  price: string;
  currency: string;
  quantity: number;
  fulfillmentPolicyId: string;
  returnPolicyId: string;
  paymentPolicyId: string;
  categoryId: string;
  weight: number | '';
  weightUnit: string;
  length: number | '';
  width: number | '';
  height: number | '';
  dimensionUnit: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DRAWER_WIDTH = 550;

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'GBP', label: 'GBP' },
  { value: 'EUR', label: 'EUR' },
  { value: 'TRY', label: 'TRY' },
];

const WEIGHT_UNITS = [
  { value: 'KILOGRAM', label: 'kg' },
  { value: 'POUND', label: 'lb' },
  { value: 'GRAM', label: 'g' },
  { value: 'OUNCE', label: 'oz' },
];

const DIMENSION_UNITS = [
  { value: 'CENTIMETER', label: 'cm' },
  { value: 'INCH', label: 'in' },
  { value: 'METER', label: 'm' },
  { value: 'FEET', label: 'ft' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInitialFields(data: EbayListingData): EditableFields {
  const offer = data.offers?.[0];
  return {
    title: data.product?.title || '',
    description: data.product?.description || offer?.listingDescription || '',
    subtitle: data.product?.subtitle || '',
    images: data.product?.imageUrls || [],
    aspects: data.product?.aspects || {},
    condition: data.condition || 'NEW',
    conditionDescription: data.conditionDescription || '',
    price: offer?.pricingSummary?.price?.value || '0.00',
    currency: offer?.pricingSummary?.price?.currency || 'USD',
    quantity: data.availability?.shipToLocationAvailability?.quantity ?? 0,
    fulfillmentPolicyId: offer?.listingPolicies?.fulfillmentPolicyId || '',
    returnPolicyId: offer?.listingPolicies?.returnPolicyId || '',
    paymentPolicyId: offer?.listingPolicies?.paymentPolicyId || '',
    categoryId: offer?.categoryId || '',
    weight: data.packageWeightAndSize?.weight?.value ?? '',
    weightUnit: data.packageWeightAndSize?.weight?.unit || 'KILOGRAM',
    length: data.packageWeightAndSize?.dimensions?.length ?? '',
    width: data.packageWeightAndSize?.dimensions?.width ?? '',
    height: data.packageWeightAndSize?.dimensions?.height ?? '',
    dimensionUnit: data.packageWeightAndSize?.dimensions?.unit || 'CENTIMETER',
  };
}

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
    } else if (typeof orig === 'object' && typeof curr === 'object' && orig !== null && curr !== null) {
      if (JSON.stringify(orig) !== JSON.stringify(curr)) {
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
  sku,
  userId,
  fulfillmentPolicies,
  returnPolicies,
  paymentPolicies,
  onSaved,
}: ListingEditorDrawerProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Loading / data state
  const [loading, setLoading] = useState(false);
  const [listing, setListing] = useState<EbayListingData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Editable fields
  const [fields, setFields] = useState<EditableFields | null>(null);
  const originalFieldsRef = useRef<EditableFields | null>(null);

  // Item aspects metadata
  const [requiredAspects, setRequiredAspects] = useState<AspectMetadata[]>([]);
  const [recommendedAspects, setRecommendedAspects] = useState<AspectMetadata[]>([]);

  // Category search
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [categorySearching, setCategorySearching] = useState(false);
  const categorySearchTimeout = useRef<NodeJS.Timeout | null>(null);

  // Action states
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Accordion expanded state
  const [expanded, setExpanded] = useState<string | false>('basics');

  // AI & Market Research
  const [marketResearch, setMarketResearch] = useState<Record<string, any> | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<{ score: number; issues: any[]; tips: string[] } | null>(null);
  const [showMarketInsights, setShowMarketInsights] = useState(false);

  // --------------------------------------------------
  // Fetch listing details
  // --------------------------------------------------
  const fetchListing = useCallback(async () => {
    if (!sku || !userId) return;

    setLoading(true);
    setFetchError(null);

    try {
      const res = await fetch(
        `/api/clawd/ebay?action=listing&sku=${encodeURIComponent(sku)}&user_id=${userId}`,
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data: EbayListingData = await res.json();
      setListing(data);

      const initial = buildInitialFields(data);
      setFields(initial);
      originalFieldsRef.current = JSON.parse(JSON.stringify(initial));

      // Fetch item aspects if category is available
      const categoryId = data.offers?.[0]?.categoryId;
      if (categoryId) {
        fetchItemAspects(categoryId);
      }
    } catch (err: any) {
      setFetchError(err.message || 'Liste detayları yüklenemedi');
      toast.error('Liste detayları yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [sku, userId]);

  // --------------------------------------------------
  // Fetch item aspects for category
  // --------------------------------------------------
  const fetchItemAspects = async (categoryId: string) => {
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=item_aspects&category_id=${categoryId}&user_id=${userId}`,
      );
      if (!res.ok) return;

      const data = await res.json();
      const aspects: AspectMetadata[] = data.aspects || [];

      setRequiredAspects(aspects.filter((a) => a.aspectConstraint.aspectRequired));
      setRecommendedAspects(aspects.filter((a) => !a.aspectConstraint.aspectRequired));
    } catch {
      // Non-critical
    }
  };

  // --------------------------------------------------
  // Category search
  // --------------------------------------------------
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
      try {
        const res = await fetch(
          `/api/clawd/ebay?action=category_suggestions&q=${encodeURIComponent(query)}&user_id=${userId}`
        );
        if (res.ok) {
          const data = await res.json();
          setCategoryOptions(
            (data.categorySuggestions || []).map((c: any) => ({
              id: c.category?.categoryId || c.categoryId,
              name: c.category?.categoryName || c.categoryName || c.name,
            }))
          );
        }
      } catch {
        // ignore
      } finally {
        setCategorySearching(false);
      }
    }, 400);
  };

  // --------------------------------------------------
  // Trigger fetch on open / sku change
  // --------------------------------------------------
  useEffect(() => {
    if (open && sku) {
      fetchListing();
    }

    if (!open) {
      setListing(null);
      setFields(null);
      originalFieldsRef.current = null;
      setFetchError(null);
      setExpanded('basics');
      setRequiredAspects([]);
      setRecommendedAspects([]);
    }
  }, [open, sku, fetchListing]);

  // --------------------------------------------------
  // Field updaters
  // --------------------------------------------------
  const updateField = <K extends keyof EditableFields>(key: K, value: EditableFields[K]) => {
    setFields((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleAccordionChange = (panel: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  // --------------------------------------------------
  // Market Research & AI
  // --------------------------------------------------
  const fetchMarketResearch = useCallback(async (query: string) => {
    if (!query.trim() || !userId) return null;
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
  }, [userId]);

  const callAI = useCallback(async (action: string, body: Record<string, any>) => {
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
  }, [userId]);

  const handleAIOptimizeTitle = async () => {
    if (!fields?.title?.trim()) return;
    setAiLoading('title');
    try {
      const research = marketResearch || await fetchMarketResearch(fields.title);
      const data = await callAI('optimize_title', {
        title: fields.title.trim(),
        categoryName: fields.categoryId,
        marketResearch: research,
      });
      if (data.optimizedTitle) {
        updateField('title', data.optimizedTitle);
        toast.success(`Başlık optimize edildi (${data.score?.before || '?'} → ${data.score?.after || '?'})`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Başlık optimizasyonu başarısız');
    } finally {
      setAiLoading(null);
    }
  };

  const handleAIGenerateDescription = async () => {
    if (!fields?.title?.trim()) return;
    setAiLoading('description');
    try {
      const research = marketResearch || await fetchMarketResearch(fields.title);
      const data = await callAI('generate_description', {
        title: fields.title.trim(),
        aspects: Object.keys(fields.aspects).length > 0 ? fields.aspects : undefined,
        condition: fields.condition,
        price: fields.price ? parseFloat(fields.price) : undefined,
        marketResearch: research,
      });
      if (data.description) {
        updateField('description', data.description);
        toast.success('Açıklama oluşturuldu');
      }
    } catch (err: any) {
      toast.error(err.message || 'Açıklama oluşturma başarısız');
    } finally {
      setAiLoading(null);
    }
  };

  const handleAISuggestPrice = async () => {
    if (!fields?.title?.trim()) return;
    setAiLoading('price');
    try {
      const research = marketResearch || await fetchMarketResearch(fields.title);
      const data = await callAI('suggest_price', {
        title: fields.title.trim(),
        condition: fields.condition,
        marketResearch: research,
      });
      if (data.suggestedPrice) {
        updateField('price', String(data.suggestedPrice));
        toast.success(`Önerilen: ${data.suggestedPrice} (${data.priceRange?.min}-${data.priceRange?.max})`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Fiyat önerisi başarısız');
    } finally {
      setAiLoading(null);
    }
  };

  const handleAIAnalyzeListing = async () => {
    if (!fields?.title?.trim()) return;
    setAiLoading('analyze');
    try {
      const research = marketResearch || await fetchMarketResearch(fields.title);
      const data = await callAI('analyze_listing', {
        title: fields.title.trim(),
        description: fields.description?.trim(),
        price: fields.price ? parseFloat(fields.price) : undefined,
        imageCount: fields.images.length,
        aspects: Object.keys(fields.aspects).length > 0 ? fields.aspects : undefined,
        categoryName: fields.categoryId,
        marketResearch: research,
      });
      setAiAnalysis(data);
      setExpanded('ai');
    } catch (err: any) {
      toast.error(err.message || 'Analiz başarısız');
    } finally {
      setAiLoading(null);
    }
  };

  // Auto-fetch market research when listing loads
  useEffect(() => {
    if (listing && fields?.title && !marketResearch && !listing.isLegacy) {
      fetchMarketResearch(fields.title);
    }
  }, [listing]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------
  // Has changes?
  // --------------------------------------------------
  const hasChanges = (): boolean => {
    if (!fields || !originalFieldsRef.current) return false;
    return Object.keys(getChangedFields(originalFieldsRef.current, fields)).length > 0;
  };

  // --------------------------------------------------
  // Save
  // --------------------------------------------------
  const handleSave = async () => {
    if (!sku || !fields || !originalFieldsRef.current) return;

    const changed = getChangedFields(originalFieldsRef.current, fields);
    if (Object.keys(changed).length === 0) {
      toast('Değişiklik yok');
      return;
    }

    setSaving(true);
    try {
      // Build inventory item payload
      const inventoryPayload: Record<string, any> = {};
      const productPayload: Record<string, any> = {};

      if (changed.title !== undefined) productPayload.title = changed.title;
      if (changed.description !== undefined) productPayload.description = changed.description;
      if (changed.subtitle !== undefined) productPayload.subtitle = changed.subtitle;
      if (changed.images !== undefined) productPayload.imageUrls = changed.images;
      if (changed.aspects !== undefined) productPayload.aspects = changed.aspects;

      if (Object.keys(productPayload).length > 0) {
        inventoryPayload.product = productPayload;
      }

      if (changed.condition !== undefined) inventoryPayload.condition = changed.condition;
      if (changed.conditionDescription !== undefined) inventoryPayload.conditionDescription = changed.conditionDescription;

      if (changed.quantity !== undefined) {
        inventoryPayload.availability = {
          shipToLocationAvailability: { quantity: changed.quantity },
        };
      }

      // Build weight/dimensions
      if (changed.weight !== undefined || changed.weightUnit !== undefined ||
          changed.length !== undefined || changed.width !== undefined ||
          changed.height !== undefined || changed.dimensionUnit !== undefined) {
        const pkg: Record<string, any> = {};
        const w = changed.weight !== undefined ? changed.weight : fields.weight;
        const wu = changed.weightUnit !== undefined ? changed.weightUnit : fields.weightUnit;
        if (w !== '' && w !== undefined) {
          pkg.weight = { value: Number(w), unit: wu };
        }
        const l = changed.length !== undefined ? changed.length : fields.length;
        const wi = changed.width !== undefined ? changed.width : fields.width;
        const h = changed.height !== undefined ? changed.height : fields.height;
        const du = changed.dimensionUnit !== undefined ? changed.dimensionUnit : fields.dimensionUnit;
        if (l !== '' || wi !== '' || h !== '') {
          pkg.dimensions = {
            length: Number(l) || 0,
            width: Number(wi) || 0,
            height: Number(h) || 0,
            unit: du,
          };
        }
        inventoryPayload.packageWeightAndSize = pkg;
      }

      // Update inventory item
      if (Object.keys(inventoryPayload).length > 0) {
        const res = await fetch(
          `/api/clawd/ebay?action=update_inventory_item&sku=${encodeURIComponent(sku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(inventoryPayload),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Envanter öğesi güncellenemedi');
        }
      }

      // Update offer if price/policies/category changed
      const offer = listing?.offers?.[0];
      if (offer?.offerId) {
        const offerPayload: Record<string, any> = {};

        if (changed.price !== undefined || changed.currency !== undefined) {
          offerPayload.pricingSummary = {
            price: {
              value: changed.price !== undefined ? changed.price : fields.price,
              currency: changed.currency !== undefined ? changed.currency : fields.currency,
            },
          };
        }

        if (changed.fulfillmentPolicyId !== undefined || changed.returnPolicyId !== undefined || changed.paymentPolicyId !== undefined) {
          offerPayload.listingPolicies = {
            fulfillmentPolicyId: changed.fulfillmentPolicyId !== undefined ? changed.fulfillmentPolicyId : fields.fulfillmentPolicyId,
            returnPolicyId: changed.returnPolicyId !== undefined ? changed.returnPolicyId : fields.returnPolicyId,
            paymentPolicyId: changed.paymentPolicyId !== undefined ? changed.paymentPolicyId : fields.paymentPolicyId,
          };
        }

        if (changed.categoryId !== undefined) {
          offerPayload.categoryId = changed.categoryId;
        }

        if (Object.keys(offerPayload).length > 0) {
          const res = await fetch(
            `/api/clawd/ebay?action=update_offer&offer_id=${offer.offerId}&user_id=${userId}`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(offerPayload),
            }
          );

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Teklif güncellenemedi');
          }
        }
      }

      toast.success('Liste güncellendi');
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Güncelleme başarısız');
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------
  // Publish
  // --------------------------------------------------
  const handlePublish = async () => {
    const offer = listing?.offers?.[0];
    if (!offer?.offerId) {
      toast.error('Yayınlanacak teklif bulunamadı');
      return;
    }

    setPublishing(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=publish_offer&offer_id=${offer.offerId}&user_id=${userId}`,
        {
          method: 'POST',
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Yayınlama başarısız');
      }

      toast.success('Liste yayınlandı');
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Yayınlama başarısız');
    } finally {
      setPublishing(false);
    }
  };

  // --------------------------------------------------
  // Withdraw
  // --------------------------------------------------
  const handleWithdraw = async () => {
    const offer = listing?.offers?.[0];
    if (!offer?.offerId) return;

    setWithdrawing(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=withdraw_offer&offer_id=${offer.offerId}&user_id=${userId}`,
        {
          method: 'POST',
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Geri çekme başarısız');
      }

      toast.success('Liste geri çekildi');
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Geri çekme başarısız');
    } finally {
      setWithdrawing(false);
    }
  };

  // --------------------------------------------------
  // Copy
  // --------------------------------------------------
  const handleCopy = async () => {
    if (!sku || !fields) return;

    setCopying(true);
    try {
      const newSku = `${sku}-copy-${Date.now()}`;

      // Create inventory item copy
      const inventoryPayload: Record<string, any> = {
        product: {
          title: fields.title + ' (Kopya)',
          description: fields.description,
          aspects: fields.aspects,
          imageUrls: fields.images,
        },
        condition: fields.condition,
        conditionDescription: fields.conditionDescription,
        availability: {
          shipToLocationAvailability: { quantity: fields.quantity },
        },
      };

      const res = await fetch(
        `/api/clawd/ebay?action=create_inventory_item&sku=${encodeURIComponent(newSku)}&user_id=${userId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(inventoryPayload),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Kopyalama başarısız');
      }

      toast.success('Liste kopyalandı (taslak olarak)');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Kopyalama başarısız');
    } finally {
      setCopying(false);
    }
  };

  // --------------------------------------------------
  // Delete
  // --------------------------------------------------
  const handleDelete = async () => {
    if (!sku) return;

    setDeleting(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(sku)}&user_id=${userId}`,
        {
          method: 'DELETE',
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Silme başarısız');
      }

      toast.success('Liste silindi');
      setDeleteDialogOpen(false);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Silme başarısız');
    } finally {
      setDeleting(false);
    }
  };

  // --------------------------------------------------
  // Render helpers
  // --------------------------------------------------
  const rawStatus = listing?.offers?.[0]?.status;
  // Normalize: eBay Browse API returns 'ACTIVE', Inventory API returns 'PUBLISHED'
  const offerStatus = rawStatus === 'ACTIVE' ? 'PUBLISHED' : rawStatus;

  const renderHeader = () => {
    const truncatedTitle = fields?.title
      ? fields.title.length > 45
        ? fields.title.substring(0, 45) + '...'
        : fields.title
      : 'Liste Düzenle';

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 16px)', sm: 2 },
          pb: 2,
          px: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} noWrap title={fields?.title}>
            {truncatedTitle}
          </Typography>
          {listing && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <Chip
                label={
                  offerStatus === 'PUBLISHED'
                    ? 'Yayında'
                    : offerStatus === 'UNPUBLISHED'
                    ? 'Yayında Değil'
                    : offerStatus || 'Taslak'
                }
                size="small"
                color={
                  offerStatus === 'PUBLISHED'
                    ? 'success'
                    : offerStatus === 'UNPUBLISHED'
                    ? 'warning'
                    : 'default'
                }
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                SKU: {sku}
              </Typography>
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
          {(listing?.itemWebUrl || listing?.legacyItemId || (listing?.offers?.[0]?.offerId && offerStatus === 'PUBLISHED')) && (
            <Tooltip title="eBay'de Görüntüle">
              <IconButton
                size="small"
                component="a"
                href={listing?.itemWebUrl || (listing?.legacyItemId ? `https://www.ebay.com/itm/${listing.legacyItemId}` : `https://www.ebay.com/itm/${listing?.offers?.[0]?.offerId}`)}
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
  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: isMobile ? '100%' : DRAWER_WIDTH,
            maxWidth: '100vw',
          },
        }}
      >
        {renderHeader()}

        {loading ? (
          renderLoadingState()
        ) : fetchError ? (
          renderErrorState()
        ) : fields && listing ? (
          <Box sx={{ overflow: 'auto', flex: 1, pb: 10 }}>
            {listing.isLegacy && (
              <Box sx={{ mx: 2, mt: 1, mb: 0, p: 1.5, bgcolor: 'warning.light', borderRadius: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <BlockIcon sx={{ color: 'warning.dark', fontSize: 20 }} />
                <Box>
                  <Typography variant="body2" fontWeight={600} sx={{ color: 'warning.dark' }}>
                    Eski Liste (Salt Okunur)
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'warning.dark' }}>
                    Bu liste eBay Envanter API'si dışında oluşturulmuş. Düzenlemek için eBay Seller Hub'ı kullanın.
                  </Typography>
                </Box>
                {listing.itemWebUrl && (
                  <Button
                    size="small"
                    variant="outlined"
                    href={listing.itemWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ ml: 'auto', flexShrink: 0, color: 'warning.dark', borderColor: 'warning.dark' }}
                    startIcon={<OpenInNewIcon />}
                  >
                    eBay
                  </Button>
                )}
              </Box>
            )}
            {/* 1. Temel Bilgiler */}
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
                  {/* Market insights bar */}
                  {(marketResearch || marketLoading) && (
                    <Paper variant="outlined" sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                        <TrendingUpIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                        <Typography variant="caption" fontWeight={600} sx={{ mr: 0.5 }}>Pazar:</Typography>
                        {marketLoading && <CircularProgress size={12} />}
                        {marketResearch && (
                          <>
                            <Chip label={`Ort. ${marketResearch.avgPrice?.toFixed(0) || '?'} ${fields.currency}`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                            <Chip label={`Talep ${marketResearch.demandScore || '?'}`} size="small" color={marketResearch.demandScore > 60 ? 'success' : 'warning'} variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                            <Chip label={`Rekabet ${marketResearch.competitionScore || '?'}`} size="small" color={marketResearch.competitionScore < 50 ? 'success' : 'error'} variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                          </>
                        )}
                      </Box>
                    </Paper>
                  )}

                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end' }}>
                    <TextField
                      label="Başlık"
                      value={fields.title}
                      onChange={(e) => {
                        if (e.target.value.length <= 80) {
                          updateField('title', e.target.value);
                        }
                      }}
                      fullWidth
                      size="small"
                      helperText={`${fields.title.length}/80 karakter`}
                      inputProps={{ maxLength: 80 }}
                    />
                    {!listing?.isLegacy && (
                      <Tooltip title="AI ile başlığı optimize et">
                        <span>
                          <IconButton
                            size="small"
                            onClick={handleAIOptimizeTitle}
                            disabled={!!aiLoading}
                            sx={{ mb: 2.5 }}
                          >
                            {aiLoading === 'title' ? <CircularProgress size={18} /> : <AutoFixHighIcon fontSize="small" color="primary" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </Box>

                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
                    <TextField
                      label="Açıklama"
                      value={fields.description}
                      onChange={(e) => updateField('description', e.target.value)}
                      fullWidth
                      multiline
                      rows={4}
                      size="small"
                      helperText={`${fields.description.length} karakter`}
                    />
                    {!listing?.isLegacy && (
                      <Tooltip title="AI ile açıklama oluştur">
                        <span>
                          <IconButton
                            size="small"
                            onClick={handleAIGenerateDescription}
                            disabled={!!aiLoading}
                            sx={{ mt: 0.5 }}
                          >
                            {aiLoading === 'description' ? <CircularProgress size={18} /> : <AutoFixHighIcon fontSize="small" color="primary" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </Box>

                  <TextField
                    label="Alt Başlık (İsteğe Bağlı)"
                    value={fields.subtitle}
                    onChange={(e) => {
                      if (e.target.value.length <= 55) {
                        updateField('subtitle', e.target.value);
                      }
                    }}
                    fullWidth
                    size="small"
                    helperText={`${fields.subtitle.length}/55 karakter`}
                    inputProps={{ maxLength: 55 }}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* 2. SEO Analizi */}
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
                  title={fields.title}
                  description={fields.description}
                  aspects={fields.aspects}
                  imageCount={fields.images.length}
                  compact={false}
                />
              </AccordionDetails>
            </Accordion>

            {/* 3. Görseller */}
            <Accordion
              expanded={expanded === 'images'}
              onChange={handleAccordionChange('images')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={600}>Görseller</Typography>
                  <Chip label={fields.images.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <ImageManager
                  images={fields.images}
                  onImagesChanged={(newImages) => updateField('images', newImages)}
                  maxImages={24}
                  productTitle={fields.title}
                />
              </AccordionDetails>
            </Accordion>

            {/* 4. Ürün Özellikleri */}
            <Accordion
              expanded={expanded === 'aspects'}
              onChange={handleAccordionChange('aspects')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={600}>Ürün Özellikleri</Typography>
                  <Chip
                    label={Object.keys(fields.aspects).length}
                    size="small"
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <ItemSpecificsEditor
                  aspects={fields.aspects}
                  requiredAspects={requiredAspects}
                  recommendedAspects={recommendedAspects}
                  onChange={(newAspects) => updateField('aspects', newAspects)}
                  aiLoading={aiLoading === 'aspects'}
                  onAIFill={async (aspectNames, currentAspects) => {
                    setAiLoading('aspects');
                    try {
                      const research = marketResearch || await fetchMarketResearch(fields.title);
                      const data = await callAI('suggest_aspects', {
                        title: fields.title.trim(),
                        aspectNames,
                        currentAspects,
                        marketResearch: research,
                      });
                      if (data.aspects) {
                        toast.success('Özellikler AI ile dolduruldu');
                        return data.aspects;
                      }
                      return null;
                    } catch (err: any) {
                      toast.error(err.message || 'AI özellik önerisi başarısız');
                      return null;
                    } finally {
                      setAiLoading(null);
                    }
                  }}
                />
              </AccordionDetails>
            </Accordion>

            {/* 5. Durum */}
            <Accordion
              expanded={expanded === 'condition'}
              onChange={handleAccordionChange('condition')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Durum</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <ConditionSelector
                  condition={fields.condition}
                  conditionDescription={fields.conditionDescription}
                  onChange={(condition, description) => {
                    updateField('condition', condition);
                    updateField('conditionDescription', description);
                  }}
                />
              </AccordionDetails>
            </Accordion>

            {/* 6. Fiyat ve Stok */}
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
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end', flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField
                    label="Fiyat"
                    value={fields.price}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^\d*\.?\d{0,2}$/.test(val) || val === '') {
                        updateField('price', val);
                      }
                    }}
                    size="small"
                    sx={{ flex: 1, minWidth: 100 }}
                    helperText={marketResearch?.avgPrice ? `Pazar ort: ${marketResearch.avgPrice.toFixed(2)}` : undefined}
                  />
                  {!listing?.isLegacy && (
                    <Tooltip title="AI fiyat önerisi">
                      <span>
                        <IconButton
                          size="small"
                          onClick={handleAISuggestPrice}
                          disabled={!!aiLoading}
                          sx={{ mb: marketResearch?.avgPrice ? 2.5 : 0 }}
                        >
                          {aiLoading === 'price' ? <CircularProgress size={18} /> : <TrendingUpIcon fontSize="small" color="primary" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  <FormControl size="small" sx={{ minWidth: 90, width: { xs: '100%', sm: 'auto' } }}>
                    <InputLabel>Para Birimi</InputLabel>
                    <Select
                      value={fields.currency}
                      label="Para Birimi"
                      onChange={(e: SelectChangeEvent) => updateField('currency', e.target.value)}
                    >
                      {CURRENCY_OPTIONS.map((c) => (
                        <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    label="Stok"
                    type="number"
                    value={fields.quantity}
                    onChange={(e) => updateField('quantity', Math.max(0, parseInt(e.target.value) || 0))}
                    size="small"
                    sx={{ width: { xs: '100%', sm: 100 } }}
                    inputProps={{ min: 0 }}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* 7. Varyasyonlar */}
            <Accordion
              expanded={expanded === 'variations'}
              onChange={handleAccordionChange('variations')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Varyasyonlar</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <VariationEditor
                  sku={sku}
                  userId={userId}
                  onSaved={fetchListing}
                />
              </AccordionDetails>
            </Accordion>

            {/* 8. Kategori */}
            <Accordion
              expanded={expanded === 'category'}
              onChange={handleAccordionChange('category')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Kategori</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {fields.categoryId && (
                    <Chip
                      label={`Kategori ID: ${fields.categoryId}`}
                      variant="outlined"
                      size="small"
                    />
                  )}

                  <Autocomplete
                    freeSolo
                    options={categoryOptions}
                    getOptionLabel={(opt) =>
                      typeof opt === 'string' ? opt : opt.name
                    }
                    inputValue={categorySearchQuery}
                    onInputChange={(_, value) => handleCategorySearch(value)}
                    onChange={(_, value) => {
                      if (value && typeof value !== 'string') {
                        updateField('categoryId', value.id);
                        fetchItemAspects(value.id);
                        setCategorySearchQuery('');
                      }
                    }}
                    loading={categorySearching}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Kategori Ara"
                        size="small"
                        placeholder="Kategori adı yazın..."
                      />
                    )}
                    size="small"
                  />
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* 9. Liste Politikaları */}
            <Accordion
              expanded={expanded === 'policies'}
              onChange={handleAccordionChange('policies')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Liste Politikaları</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Teslimat Politikası</InputLabel>
                    <Select
                      value={fields.fulfillmentPolicyId}
                      label="Teslimat Politikası"
                      onChange={(e: SelectChangeEvent) => updateField('fulfillmentPolicyId', e.target.value)}
                    >
                      <MenuItem value=""><em>Seçilmedi</em></MenuItem>
                      {fulfillmentPolicies.map((p) => (
                        <MenuItem key={p.policyId} value={p.policyId}>{p.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl size="small" fullWidth>
                    <InputLabel>İade Politikası</InputLabel>
                    <Select
                      value={fields.returnPolicyId}
                      label="İade Politikası"
                      onChange={(e: SelectChangeEvent) => updateField('returnPolicyId', e.target.value)}
                    >
                      <MenuItem value=""><em>Seçilmedi</em></MenuItem>
                      {returnPolicies.map((p) => (
                        <MenuItem key={p.policyId} value={p.policyId}>{p.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl size="small" fullWidth>
                    <InputLabel>Ödeme Politikası</InputLabel>
                    <Select
                      value={fields.paymentPolicyId}
                      label="Ödeme Politikası"
                      onChange={(e: SelectChangeEvent) => updateField('paymentPolicyId', e.target.value)}
                    >
                      <MenuItem value=""><em>Seçilmedi</em></MenuItem>
                      {paymentPolicies.map((p) => (
                        <MenuItem key={p.policyId} value={p.policyId}>{p.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* 10. Boyutlar ve Ağırlık */}
            <Accordion
              expanded={expanded === 'dimensions'}
              onChange={handleAccordionChange('dimensions')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Boyutlar ve Ağırlık</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Typography variant="body2" fontWeight={500}>Ağırlık</Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                      label="Ağırlık"
                      type="number"
                      value={fields.weight}
                      onChange={(e) =>
                        updateField('weight', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <FormControl size="small" sx={{ minWidth: 80 }}>
                      <InputLabel>Birim</InputLabel>
                      <Select
                        value={fields.weightUnit}
                        label="Birim"
                        onChange={(e: SelectChangeEvent) => updateField('weightUnit', e.target.value)}
                      >
                        {WEIGHT_UNITS.map((u) => (
                          <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>

                  <Divider sx={{ my: 0.5 }} />
                  <Typography variant="body2" fontWeight={500}>Boyutlar</Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <TextField
                      label="Uzunluk"
                      type="number"
                      value={fields.length}
                      onChange={(e) =>
                        updateField('length', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1, minWidth: 80 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <TextField
                      label="Genişlik"
                      type="number"
                      value={fields.width}
                      onChange={(e) =>
                        updateField('width', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1, minWidth: 80 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <TextField
                      label="Yükseklik"
                      type="number"
                      value={fields.height}
                      onChange={(e) =>
                        updateField('height', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1, minWidth: 80 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <FormControl size="small" sx={{ minWidth: 70 }}>
                      <InputLabel>Birim</InputLabel>
                      <Select
                        value={fields.dimensionUnit}
                        label="Birim"
                        onChange={(e: SelectChangeEvent) => updateField('dimensionUnit', e.target.value)}
                      >
                        {DIMENSION_UNITS.map((u) => (
                          <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* AI Analiz */}
            <Accordion
              expanded={expanded === 'ai'}
              onChange={handleAccordionChange('ai')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={600}>AI Analiz</Typography>
                  {aiAnalysis && (
                    <Chip
                      label={`${aiAnalysis.score}/100`}
                      size="small"
                      color={aiAnalysis.score >= 80 ? 'success' : aiAnalysis.score >= 50 ? 'warning' : 'error'}
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={aiLoading === 'analyze' ? <CircularProgress size={16} /> : <AssessmentIcon />}
                    onClick={handleAIAnalyzeListing}
                    disabled={!!aiLoading || !fields?.title?.trim()}
                    fullWidth
                  >
                    {aiLoading === 'analyze' ? 'Analiz ediliyor...' : aiAnalysis ? 'Tekrar Analiz Et' : 'Listeyi Analiz Et'}
                  </Button>

                  {aiAnalysis && (
                    <>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5 }}>
                        <Box
                          sx={{
                            width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            bgcolor: aiAnalysis.score >= 80 ? 'success.light' : aiAnalysis.score >= 50 ? 'warning.light' : 'error.light',
                            color: aiAnalysis.score >= 80 ? 'success.dark' : aiAnalysis.score >= 50 ? 'warning.dark' : 'error.dark',
                          }}
                        >
                          <Typography variant="h6" fontWeight={700}>{aiAnalysis.score}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="subtitle2" fontWeight={600}>Kalite Skoru</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {aiAnalysis.score >= 80 ? 'Harika!' : aiAnalysis.score >= 50 ? 'İyileştirme önerileri var' : 'Önemli sorunlar'}
                          </Typography>
                        </Box>
                      </Box>

                      {(aiAnalysis.issues || []).length > 0 && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {aiAnalysis.issues.map((issue: any, i: number) => (
                            <Alert
                              key={i}
                              severity={issue.severity === 'critical' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}
                              sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.75rem' } }}
                            >
                              <strong>{issue.message}</strong>{issue.fix ? ` — ${issue.fix}` : ''}
                            </Alert>
                          ))}
                        </Box>
                      )}

                      {(aiAnalysis.tips || []).length > 0 && (
                        <Box>
                          <Typography variant="caption" fontWeight={600}>İpuçları:</Typography>
                          {aiAnalysis.tips.map((tip: string, i: number) => (
                            <Typography key={i} variant="caption" display="block" sx={{ ml: 1 }}>• {tip}</Typography>
                          ))}
                        </Box>
                      )}
                    </>
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* İşlemler — hidden for legacy listings */}
            {!listing?.isLegacy && (
              <Accordion
                expanded={expanded === 'actions'}
                onChange={handleAccordionChange('actions')}
                disableGutters
                elevation={0}
                sx={{ '&:before': { display: 'none' } }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography fontWeight={600}>İşlemler</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {offerStatus !== 'PUBLISHED' && listing?.offers?.[0]?.offerId && (
                      <Button
                        variant="contained"
                        color="success"
                        startIcon={publishing ? <CircularProgress size={18} color="inherit" /> : <PublishIcon />}
                        onClick={handlePublish}
                        disabled={publishing}
                        fullWidth
                      >
                        {publishing ? 'Yayınlanıyor...' : 'Yayınla'}
                      </Button>
                    )}

                    {offerStatus === 'PUBLISHED' && (
                      <Button
                        variant="outlined"
                        color="warning"
                        startIcon={withdrawing ? <CircularProgress size={18} color="inherit" /> : <BlockIcon />}
                        onClick={handleWithdraw}
                        disabled={withdrawing}
                        fullWidth
                      >
                        {withdrawing ? 'Geri çekiliyor...' : 'Geri Çek'}
                      </Button>
                    )}

                    <Button
                      variant="outlined"
                      startIcon={copying ? <CircularProgress size={18} /> : <ContentCopyIcon />}
                      onClick={handleCopy}
                      disabled={copying}
                      fullWidth
                    >
                      {copying ? 'Kopyalanıyor...' : 'Kopyala'}
                    </Button>

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
            )}
          </Box>
        ) : null}

        {/* Footer — Save button */}
        {fields && listing && !loading && !fetchError && !listing.isLegacy && (
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
            <Button
              variant="contained"
              fullWidth
              size="large"
              startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges()}
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </Box>
        )}
      </Drawer>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Listeyi Sil</DialogTitle>
        <DialogContent>
          <Typography>
            Bu listeyi kalıcı olarak silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
          </Typography>
          {fields?.title && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              &ldquo;{fields.title}&rdquo;
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            İptal
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
    </>
  );
}
