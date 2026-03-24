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
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import { toast } from 'react-hot-toast';
import SEOIndicator from './SEOIndicator';
import type { MarketResearchData } from './MarketResearch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListingCreatorDialogProps {
  open: boolean;
  onClose: () => void;
  shopId: string;
  shopSections: Array<{ shop_section_id: number; title: string }>;
  shippingProfiles: Array<{ shipping_profile_id: number; title: string }>;
  returnPolicies: Array<{ return_policy_id: number; description?: string }>;
  onCreated: (listingId: number) => void;
  marketResearchData?: MarketResearchData | null;
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

const STEPS = ['Icerik & AI', 'Kategori & Fiyat', 'Gorseller', 'Onizleme'];

const WHO_MADE_OPTIONS = [
  { value: 'i_did', label: 'Ben yaptim' },
  { value: 'collective', label: 'Kolektif / Atolye' },
  { value: 'someone_else', label: 'Baskasi yapti' },
];

const WHEN_MADE_OPTIONS = [
  { value: 'made_to_order', label: 'Siparise gore yapiliyor' },
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
}: ListingCreatorDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [activeStep, setActiveStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);

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
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI image generation
  const [aiImagePrompt, setAiImagePrompt] = useState('');
  const [aiImageRefFile, setAiImageRefFile] = useState<File | null>(null);
  const [aiImageRefPreview, setAiImageRefPreview] = useState<string | null>(null);
  const [aiImageGenerating, setAiImageGenerating] = useState(false);
  const [aiImageResult, setAiImageResult] = useState<{ base64: string; mimeType: string } | null>(null);
  const [aiImageFollowUp, setAiImageFollowUp] = useState('');
  const aiImageRefInputRef = useRef<HTMLInputElement>(null);

  // AI state
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiTagSuggestions, setAiTagSuggestions] = useState<string[]>([]);

  // Quick-start
  const [quickStartKeyword, setQuickStartKeyword] = useState('');

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
          toast.error('Kategoriler yuklenemedi');
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
  }, [title, description, tags, materials, price, marketResearchData, selectedTaxonomy, fetchQuickResearch]);

  const handleAIOptimizeTitle = useCallback(async () => {
    const result = await callAI('optimize_title');
    const newTitle = result?.optimized_title || result?.title;
    if (newTitle && typeof newTitle === 'string') {
      // Sanity check: reject garbled single-character output
      if (newTitle.split(/[\s,]+/).filter(Boolean).every((w: string) => w.length <= 1)) {
        toast.error('AI bozuk baslik uretti — tekrar deneyin');
        return;
      }
      setTitle(newTitle);
      toast.success('Baslik optimize edildi');
    }
  }, [callAI]);

  const handleAIGenerateDescription = useCallback(async () => {
    const result = await callAI('generate_description');
    if (result?.description) {
      setDescription(result.description);
      toast.success('Aciklama olusturuldu');
    }
  }, [callAI]);

  const handleAISuggestTags = useCallback(async () => {
    const result = await callAI('suggest_tags');
    const suggested = result?.suggestions || result?.tags;
    if (suggested && Array.isArray(suggested)) {
      setAiTagSuggestions(suggested);
      toast.success(`${suggested.length} etiket onerisi alindi`);
    }
  }, [callAI]);

  // --------------------------------------------------
  // Quick-start: AI generates title + description + tags from a keyword
  // --------------------------------------------------
  const handleQuickStart = useCallback(async () => {
    const keyword = quickStartKeyword.trim();
    if (!keyword) {
      toast.error('Bir urun fikri veya anahtar kelime girin');
      return;
    }
    setAiLoading((prev) => ({ ...prev, quick_start: true }));
    try {
      // 1. Generate optimized title from keyword
      const titleResult = await callAI('optimize_title', { title: keyword });
      const newTitle = titleResult?.optimized_title || keyword;
      setTitle(newTitle);

      // 2. Generate description
      const descResult = await callAI('generate_description', { title: newTitle });
      if (descResult?.description) setDescription(descResult.description);

      // 3. Suggest tags
      const tagResult = await callAI('suggest_tags', { title: newTitle, tags_current: [] });
      const suggested = tagResult?.suggestions || tagResult?.tags;
      if (suggested && Array.isArray(suggested)) {
        setTags(suggested.slice(0, 13));
      }

      toast.success('AI ile icerik olusturuldu! Kontrol edin ve duzenleyin.');
    } catch {
      toast.error('AI icerik olusturma basarisiz');
    } finally {
      setAiLoading((prev) => ({ ...prev, quick_start: false }));
    }
  }, [quickStartKeyword, callAI]);

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
    setCreating(false);
    setUploadProgress(0);
    setUploadTotal(0);
    setAiTagSuggestions([]);
    setQuickStartKeyword('');
    setAiImagePrompt('');
    setAiImageRefFile(null);
    setAiImageRefPreview(null);
    setAiImageResult(null);
    setAiImageFollowUp('');
  }, []);

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
          toast.error('Baslik zorunludur');
          return false;
        }
        if (title.trim().length < 3) {
          toast.error('Baslik en az 3 karakter olmalidir');
          return false;
        }
        if (!description.trim()) {
          toast.error('Aciklama zorunludur');
          return false;
        }
        if (description.trim().length < 10) {
          toast.error('Aciklama en az 10 karakter olmalidir');
          return false;
        }
        return true;
      case 1:
        if (!selectedTaxonomy) {
          toast.error('Kategori secimi zorunludur');
          return false;
        }
        if (!price || parseFloat(price) <= 0) {
          toast.error('Gecerli bir fiyat giriniz');
          return false;
        }
        if (!shippingProfileId) {
          toast.error('Kargo profili secimi zorunludur');
          return false;
        }
        if (!returnPolicyId) {
          toast.error('Iade politikasi secimi zorunludur');
          return false;
        }
        if (processingMin && processingMax && Number(processingMin) > Number(processingMax)) {
          toast.error('Min hazirlama suresi max\'tan buyuk olamaz');
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
  // File handling
  // --------------------------------------------------
  // --------------------------------------------------
  // AI Image Generation (for new listings)
  // --------------------------------------------------
  const handleAiImageGenerate = async () => {
    if (!aiImagePrompt.trim()) {
      toast.error('Bir prompt girin');
      return;
    }

    setAiImageGenerating(true);
    setAiImageResult(null);
    try {
      const payload: Record<string, any> = {
        prompt: aiImagePrompt.trim(),
      };

      if (aiImageRefFile) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(aiImageRefFile);
        });
        payload.reference_image = base64;
        payload.reference_mime_type = aiImageRefFile.type;
      }

      const res = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Gorsel olusturulamadi');
      }

      const data = await res.json();
      if (data.image_base64) {
        setAiImageResult({ base64: data.image_base64, mimeType: data.mime_type || 'image/png' });
        toast.success('Gorsel olusturuldu!');
      } else {
        throw new Error(data.text || 'Gorsel olusturulamadi');
      }
    } catch (err: any) {
      toast.error(err.message || 'AI gorsel olusturma hatasi');
    } finally {
      setAiImageGenerating(false);
    }
  };

  const handleAiImageAccept = () => {
    if (!aiImageResult || selectedFiles.length >= 10) return;

    // Convert base64 to File
    const byteStr = atob(aiImageResult.base64);
    const arr = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
    const blob = new Blob([arr], { type: aiImageResult.mimeType });
    const file = new File([blob], `ai-generated-${Date.now()}.png`, { type: aiImageResult.mimeType });

    setSelectedFiles((prev) => [...prev, file]);
    setAiImageResult(null);
    setAiImagePrompt('');
    toast.success('AI gorseli eklendi');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles = Array.from(files);
    const total = selectedFiles.length + newFiles.length;
    if (total > 10) {
      toast.error('Maksimum 10 gorsel secilebilir');
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const validFiles = newFiles.filter((f) => {
      if (!validTypes.includes(f.type)) {
        toast.error(`${f.name}: Desteklenmeyen format`);
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

  // --------------------------------------------------
  // Create listing
  // --------------------------------------------------
  const handleCreate = async (publish: boolean) => {
    setCreating(true);
    try {
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
        currency_code: 'USD',
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

      const createRes = await fetch(
        `/api/clawd/etsy?action=create_listing&shop_id=${shopId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error || 'Listing olusturulamadi');
      }

      const created = await createRes.json();
      const newId = created.listing_id;

      // Upload images
      if (selectedFiles.length > 0) {
        setUploadTotal(selectedFiles.length);
        for (let i = 0; i < selectedFiles.length; i++) {
          setUploadProgress(i + 1);
          const file = selectedFiles[i];

          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const uploadRes = await fetch(
            `/api/clawd/etsy?action=upload_image&listing_id=${newId}&shop_id=${shopId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image_base64: base64,
                image_content_type: file.type,
                image_filename: file.name,
                rank: i + 1,
              }),
            }
          );

          if (!uploadRes.ok) {
            toast.error(`Gorsel ${i + 1} yuklenemedi`);
          }
        }
      }

      // Publish if requested
      if (publish) {
        const pubRes = await fetch(
          `/api/clawd/etsy?action=publish&listing_id=${newId}&shop_id=${shopId}`,
          { method: 'POST' }
        );
        if (!pubRes.ok) {
          toast.error('Listing yayinlanamadi, taslak olarak kaydedildi');
        } else {
          toast.success('Listing olusturuldu ve yayinlandi!');
        }
      } else {
        toast.success('Listing taslak olarak olusturuldu!');
      }

      onCreated(newId);
      resetForm();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Bir hata olustu');
    } finally {
      setCreating(false);
    }
  };

  // --------------------------------------------------
  // Render helpers
  // --------------------------------------------------
  const isAnyAILoading = Object.values(aiLoading).some(Boolean);

  const whoMadeLabel = WHO_MADE_OPTIONS.find((o) => o.value === whoMade)?.label || whoMade;
  const whenMadeLabel = WHEN_MADE_OPTIONS.find((o) => o.value === whenMade)?.label || whenMade;

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
            AI ile Hizli Baslangic
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Urun fikrinizi yazin, AI baslik, aciklama ve etiketleri otomatik olustursun.
          {marketResearchData ? ' Pazar arastirma verileri de kullanilacak.' : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="ornek: boho flower girl dress, wooden phone stand..."
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
            {aiLoading.quick_start ? 'Olusturuluyor...' : 'AI ile Doldur'}
          </Button>
        </Box>
      </Paper>

      {/* ---- Market Research Context Banner ---- */}
      {marketResearchData && (
        <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
          <Typography variant="caption" fontWeight={600}>
            Pazar Verileri: &quot;{marketResearchData.query}&quot;
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {marketResearchData.topTags.slice(0, 8).map((t) => (
              <Chip
                key={t.tag}
                label={`${t.tag} (${t.pct}%)`}
                size="small"
                variant="outlined"
                sx={{ fontSize: '0.65rem', height: 22, cursor: 'pointer' }}
                onClick={() => {
                  if (tags.length < 13 && !tags.includes(t.tag)) {
                    setTags((prev) => [...prev, t.tag]);
                    toast.success(`"${t.tag}" eklendi`);
                  }
                }}
              />
            ))}
          </Box>
          {marketResearchData.priceStats && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              Fiyat araligi: ${marketResearchData.priceStats.min} - ${marketResearchData.priceStats.max} (ort: ${marketResearchData.priceStats.avg})
            </Typography>
          )}
        </Alert>
      )}

      <Divider />

      {/* ---- Title ---- */}
      <Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            label="Baslik"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 140))}
            required
            fullWidth
            helperText={`${title.length}/140 karakter`}
            inputProps={{ maxLength: 140 }}
          />
          <Tooltip title="AI ile baslik optimize et">
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
          label="Aciklama"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          fullWidth
          multiline
          minRows={4}
          helperText={`${description.length} karakter`}
        />
        <Button
          size="small"
          startIcon={aiLoading.generate_description ? <CircularProgress size={14} /> : <AutoFixHighIcon />}
          onClick={handleAIGenerateDescription}
          disabled={!!aiLoading.generate_description || !title.trim()}
          sx={{ mt: 0.5, textTransform: 'none' }}
        >
          AI ile Aciklama Olustur
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
            const unique = [...new Set(expanded)].map((t) => t.substring(0, 20)).slice(0, 13);
            setTags(unique);
            if (expanded.length > 13) toast.error('Maksimum 13 etiket — fazlası kesildi');
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip
                {...getTagProps({ index })}
                key={option}
                label={option}
                size="small"
                color={option.length > 20 ? 'error' : undefined}
              />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Etiketler"
              helperText={`${tags.length}/13 etiket — virgül veya Enter ile ekleyin (maks 20 karakter/etiket)`}
              onKeyDown={(e) => {
                if (e.key === ',') {
                  e.preventDefault();
                  const input = (e.target as HTMLInputElement).value.trim();
                  if (input && tags.length < 13) {
                    const newTags = input.split(',').map((s) => s.trim()).filter(Boolean).map((t) => t.substring(0, 20));
                    const merged = [...new Set([...tags, ...newTags])].slice(0, 13);
                    setTags(merged);
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
                  const newTags = pasted.split(',').map((s) => s.trim()).filter(Boolean).map((t) => t.substring(0, 20));
                  const merged = [...new Set([...tags, ...newTags])].slice(0, 13);
                  setTags(merged);
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
          AI Etiket Oner
        </Button>

        {/* AI Tag Suggestions */}
        {aiTagSuggestions.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Onerilen etiketler:
              </Typography>
              <Button
                size="small"
                onClick={() => {
                  const newTags = aiTagSuggestions.filter((t) => !tags.includes(t));
                  const merged = [...tags, ...newTags].slice(0, 13);
                  setTags(merged);
                  setAiTagSuggestions([]);
                  toast.success(`${merged.length - tags.length} etiket eklendi`);
                }}
                disabled={aiTagSuggestions.every((t) => tags.includes(t))}
                sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0, minWidth: 0 }}
              >
                Tumunu Ekle
              </Button>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {aiTagSuggestions.map((tag) => {
                const alreadyExists = tags.includes(tag);
                const isFull = tags.length >= 13;
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
                        : () => setTags((prev) => [...prev, tag])
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
          else toast.error('Maksimum 13 malzeme eklenebilir');
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
            label="Malzemeler"
            helperText={`${materials.length}/13 malzeme`}
          />
        )}
      />

      {/* ---- Who/When/Supply ---- */}
      <FormControl fullWidth required>
        <InputLabel>Kim yapti?</InputLabel>
        <Select
          value={whoMade}
          label="Kim yapti?"
          onChange={(e) => setWhoMade(e.target.value)}
        >
          {WHO_MADE_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl fullWidth required>
        <InputLabel>Ne zaman yapildi?</InputLabel>
        <Select
          value={whenMade}
          label="Ne zaman yapildi?"
          onChange={(e) => setWhenMade(e.target.value)}
        >
          {WHEN_MADE_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
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
        label="Bu bir malzeme/aractir (supply)"
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
            label="Kategori"
            required
            helperText="Kategori agacindan arayarak secin"
          />
        )}
        isOptionEqualToValue={(opt, val) => opt.id === val.id}
        noOptionsText="Kategori bulunamadi"
        loadingText="Yukleniyor..."
      />

      {/* Price with market hint */}
      <Box>
        <TextField
          label="Fiyat (USD)"
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
          fullWidth
          inputProps={{ min: 0, step: '0.01' }}
        />
        {marketResearchData?.priceStats && !price && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            Pazar ortalamasi: ${marketResearchData.priceStats.avg} (${marketResearchData.priceStats.min} - ${marketResearchData.priceStats.max})
          </Typography>
        )}
      </Box>

      <TextField
        label="Miktar"
        type="number"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        fullWidth
        inputProps={{ min: 1 }}
      />

      <FormControl fullWidth>
        <InputLabel>Magaza Bolumu</InputLabel>
        <Select
          value={shopSectionId}
          label="Magaza Bolumu"
          onChange={(e) => setShopSectionId(e.target.value as number | '')}
        >
          <MenuItem value="">
            <em>Secim yok</em>
          </MenuItem>
          {shopSections.map((s) => (
            <MenuItem key={s.shop_section_id} value={s.shop_section_id}>
              {s.title}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth required>
        <InputLabel>Kargo Profili</InputLabel>
        <Select
          value={shippingProfileId}
          label="Kargo Profili"
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
          Yuklenemedi — sayfayi yenileyin
        </Typography>
      )}

      <FormControl fullWidth required>
        <InputLabel>Iade Politikasi</InputLabel>
        <Select
          value={returnPolicyId}
          label="Iade Politikasi"
          onChange={(e) => setReturnPolicyId(e.target.value as number)}
        >
          {returnPolicies.map((r) => (
            <MenuItem key={r.return_policy_id} value={r.return_policy_id}>
              {r.description || `Politika #${r.return_policy_id}`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {returnPolicies.length === 0 && (
        <Typography variant="caption" color="warning.main">
          Yuklenemedi — sayfayi yenileyin
        </Typography>
      )}

      <Divider sx={{ my: 0.5 }} />

      {/* Processing time */}
      <Typography variant="subtitle2" color="text.secondary">Hazirlama Suresi (is gunu)</Typography>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Min"
          type="number"
          value={processingMin}
          onChange={(e) => setProcessingMin(e.target.value)}
          fullWidth
          inputProps={{ min: 1 }}
          size="small"
        />
        <TextField
          label="Max"
          type="number"
          value={processingMax}
          onChange={(e) => setProcessingMax(e.target.value)}
          fullWidth
          inputProps={{ min: 1 }}
          size="small"
        />
      </Box>

      {/* Weight & Dimensions */}
      <Typography variant="subtitle2" color="text.secondary">Agirlik & Boyutlar</Typography>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Agirlik"
          type="number"
          value={itemWeight}
          onChange={(e) => setItemWeight(e.target.value)}
          sx={{ flex: 2 }}
          inputProps={{ min: 0, step: '0.1' }}
          size="small"
        />
        <FormControl sx={{ flex: 1, minWidth: 80 }} size="small">
          <InputLabel>Birim</InputLabel>
          <Select
            value={itemWeightUnit}
            label="Birim"
            onChange={(e) => setItemWeightUnit(e.target.value)}
          >
            {WEIGHT_UNITS.map((u) => (
              <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField label="Uzunluk" type="number" value={itemLength} onChange={(e) => setItemLength(e.target.value)} size="small" inputProps={{ min: 0 }} sx={{ flex: 1 }} />
        <TextField label="Genislik" type="number" value={itemWidth} onChange={(e) => setItemWidth(e.target.value)} size="small" inputProps={{ min: 0 }} sx={{ flex: 1 }} />
        <TextField label="Yukseklik" type="number" value={itemHeight} onChange={(e) => setItemHeight(e.target.value)} size="small" inputProps={{ min: 0 }} sx={{ flex: 1 }} />
        <FormControl sx={{ minWidth: 70 }} size="small">
          <InputLabel>Birim</InputLabel>
          <Select
            value={itemDimensionsUnit}
            label="Birim"
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
        Ilk gorsel kapak gorseli olarak kullanilir. Etsy icin 2000x2000px oneriliyor.
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
          disabled={selectedFiles.length >= 10}
        >
          Gorsel Sec ({selectedFiles.length}/10)
        </Button>
      </Box>

      {selectedFiles.length === 0 && !aiImageResult && (
        <Alert severity="warning">
          Etsy listingi yayinlamak icin en az 1 gorsel gereklidir. Gorselsiz sadece taslak olusturulabilir.
        </Alert>
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
                border: i === 0 ? '2px solid' : '1px solid',
                borderColor: i === 0 ? 'primary.main' : 'divider',
              }}
            >
              <img
                src={src}
                alt={`Gorsel ${i + 1}`}
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
                {i === 0 ? 'Kapak' : i + 1}
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
            AI ile Gorsel Olustur
          </Typography>
        </Box>

        <TextField
          label="Prompt"
          placeholder="ornek: Professional product photo of a handmade knitted baby blanket on white background"
          fullWidth
          multiline
          minRows={2}
          size="small"
          value={aiImagePrompt}
          onChange={(e) => setAiImagePrompt(e.target.value)}
          disabled={aiImageGenerating}
          sx={{ mb: 1.5 }}
          helperText="Ingilizce prompt daha iyi sonuc verir. Gorsel 2000x2000px JPEG olarak olusturulur."
        />

        {/* Reference image */}
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Referans Gorsel (opsiyonel — benzer stil/urun icin)
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
              Referans Sec
            </Button>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <img
                src={aiImageRefPreview}
                alt="Referans"
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
                Kaldir
              </Button>
            </Box>
          )}
        </Box>

        <Button
          variant="contained"
          fullWidth
          onClick={handleAiImageGenerate}
          disabled={aiImageGenerating || !aiImagePrompt.trim() || selectedFiles.length >= 10}
          startIcon={aiImageGenerating ? <CircularProgress size={18} color="inherit" /> : <AutoFixHighIcon />}
          sx={{ bgcolor: '#a855f7', '&:hover': { bgcolor: '#9333ea' } }}
        >
          {aiImageGenerating ? 'Olusturuluyor...' : 'Gorsel Olustur'}
        </Button>

        {/* AI result preview */}
        {aiImageResult && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ textAlign: 'center' }}>Olusturulan Gorsel:</Typography>
            <Box sx={{ textAlign: 'center' }}>
              <img
                src={`data:${aiImageResult.mimeType};base64,${aiImageResult.base64}`}
                alt="AI gorsel"
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
              placeholder="Degisiklik istegi: ornek: make background white, add soft shadow..."
              value={aiImageFollowUp}
              onChange={(e) => setAiImageFollowUp(e.target.value)}
              disabled={aiImageGenerating}
              sx={{ mt: 1.5 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !aiImageGenerating) {
                  e.preventDefault();
                  if (aiImageFollowUp.trim()) {
                    setAiImagePrompt(`${aiImagePrompt}. Additional changes: ${aiImageFollowUp.trim()}`);
                    setAiImageFollowUp('');
                  }
                  handleAiImageGenerate();
                }
              }}
            />

            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                onClick={() => {
                  if (aiImageFollowUp.trim()) {
                    setAiImagePrompt(`${aiImagePrompt}. Additional changes: ${aiImageFollowUp.trim()}`);
                    setAiImageFollowUp('');
                  }
                  handleAiImageGenerate();
                }}
                disabled={aiImageGenerating}
                size="small"
                startIcon={aiImageGenerating ? <CircularProgress size={14} /> : null}
              >
                {aiImageFollowUp.trim() ? 'Degisiklikle Olustur' : 'Ayni Promptla Olustur'}
              </Button>
              <Button
                variant="contained"
                onClick={handleAiImageAccept}
                disabled={selectedFiles.length >= 10}
                color="success"
                size="small"
              >
                Kabul Et ve Ekle
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
      (returnPolicyId ? `Politika #${returnPolicyId}` : '');

    const summaryFields: Array<{ label: string; value: string | number }> = [
      { label: 'Baslik', value: title },
      { label: 'Aciklama', value: description.length > 200 ? description.slice(0, 200) + '...' : description },
      { label: 'Etiketler', value: tags.join(', ') || '-' },
      { label: 'Malzemeler', value: materials.join(', ') || '-' },
      { label: 'Kim yapti', value: whoMadeLabel },
      { label: 'Ne zaman yapildi', value: whenMadeLabel },
      { label: 'Malzeme/Arac', value: isSupply ? 'Evet' : 'Hayir' },
      { label: 'Kategori', value: selectedTaxonomy?.label || '-' },
      { label: 'Fiyat', value: `$${price}` },
      { label: 'Miktar', value: quantity },
      { label: 'Magaza Bolumu', value: sectionLabel || '-' },
      { label: 'Kargo Profili', value: shippingLabel || '-' },
      { label: 'Iade Politikasi', value: returnLabel || '-' },
      { label: 'Hazirlama', value: processingMin && processingMax ? `${processingMin}-${processingMax} is gunu` : '-' },
      { label: 'Agirlik', value: itemWeight ? `${itemWeight} ${itemWeightUnit}` : '-' },
      { label: 'Boyutlar', value: itemLength ? `${itemLength}x${itemWidth}x${itemHeight} ${itemDimensionsUnit}` : '-' },
      { label: 'Gorseller', value: `${selectedFiles.length} adet` },
    ];

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Listing Ozeti
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

        {creating && uploadTotal > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Gorseller yukleniyor: {uploadProgress}/{uploadTotal}
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
            {creating ? 'Olusturuluyor...' : 'Draft Olarak Kaydet'}
          </Button>
          <Button
            variant="outlined"
            color="success"
            onClick={() => handleCreate(true)}
            disabled={creating || selectedFiles.length === 0}
            sx={{ flex: 1, minWidth: 180 }}
          >
            {creating ? 'Olusturuluyor...' : 'Olustur ve Yayinla'}
          </Button>
        </Box>
        {selectedFiles.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            Yayinlamak icin en az 1 gorsel gereklidir
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
        <Typography variant="h6">Yeni Listing Olustur</Typography>
        <IconButton onClick={handleClose} disabled={creating}>
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
            Geri
          </Button>
          <Button variant="contained" onClick={handleNext}>
            Ileri
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
            Geri
          </Button>
        </Box>
      )}
    </Dialog>
  );
}
