import React, { useState, useMemo } from 'react';
import {
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  RadioGroup,
  Radio,
  FormControlLabel,
  Chip,
  Select,
  MenuItem,
  LinearProgress,
  Typography,
  Box,
  InputLabel,
  FormControl,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Menu,
  ListItemIcon,
  ListItemText,
  SwipeableDrawer,
  List,
  ListItem,
  ListItemButton,
  useMediaQuery,
  useTheme,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  DeleteOutline,
  LocalOfferOutlined,
  AttachMoneyOutlined,
  DriveFileMoveOutlined,
  PublishOutlined,
  RemoveCircleOutline,
  AutoFixHigh,
  ContentCopy as ContentCopyIcon,
  ImageOutlined,
  RefreshOutlined,
  Celebration as CelebrationIcon,
  TuneOutlined,
  MoreHoriz as MoreHorizIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  FileDownload as FileDownloadIcon,
  Edit as EditIcon,
  CheckBox as CheckBoxIcon,
  CheckBoxOutlineBlank as CheckBoxBlankIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { stageEtsyDraft } from '@/lib/etsy/draftClient';

interface ListingPrice {
  amount: number;
  divisor: number;
  currency_code: string;
}

interface SelectedListing {
  listing_id: number;
  title: string;
  price: ListingPrice | null;
  tags: string[];
  state: string;
  shop_section_id: number | null;
}

interface ShopSection {
  shop_section_id: number;
  title: string;
}

interface ShopInfo {
  shopId: string;
  shopName: string;
}

interface BulkOperationsBarProps {
  selectedCount: number;
  selectedListings: SelectedListing[];
  shopSections: ShopSection[];
  shopId: string;
  allShops?: ShopInfo[];
  onCompleted: () => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  onSelectCurrentPage?: () => void;
  onOpenBulkEditor?: () => void;
}

type PriceMode = 'percent_increase' | 'percent_decrease' | 'fixed_add' | 'fixed_subtract';

type SeasonTagMode = 'add' | 'replace';

interface SeasonPreset {
  label: string;
  tags: string[];
}

const SEASON_PRESETS: SeasonPreset[] = [
  { label: 'seasonChristmas', tags: ['christmas gift', 'holiday gift', 'stocking stuffer', 'xmas present', 'holiday decor'] },
  { label: 'seasonValentines', tags: ['valentines gift', 'valentine day', 'romantic gift', 'gift for her', 'love gift'] },
  { label: 'seasonMothersDay', tags: ['mothers day gift', 'gift for mom', 'mom birthday', 'mama gift'] },
  { label: 'seasonFathersDay', tags: ['fathers day gift', 'gift for dad', 'dad birthday', 'papa gift'] },
  { label: 'seasonHalloween', tags: ['halloween decor', 'spooky gift', 'trick or treat', 'halloween costume'] },
  { label: 'seasonSummer', tags: ['summer decor', 'beach gift', 'outdoor', 'summer vibes'] },
  { label: 'seasonWinter', tags: ['winter decor', 'cozy gift', 'holiday season', 'winter vibes'] },
];

type VariationPriceMode = 'percent_increase' | 'percent_decrease' | 'fixed_add' | 'fixed_subtract';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callUpdateListing(
  shopId: string,
  listingId: number,
  body: Record<string, any>
): Promise<Response> {
  await stageEtsyDraft({ shopId, listingId, fields: body });
  return { ok: true, status: 200, clone: () => ({ json: async () => ({}) }), json: async () => ({}) } as any;
}

async function callDeleteListing(
  shopId: string,
  listingId: number
): Promise<Response> {
  await stageEtsyDraft({ shopId, listingId, queuedActions: [{ type: 'delete' }] });
  return { ok: true, status: 200, clone: () => ({ json: async () => ({}) }), json: async () => ({}) } as any;
}

export default function BulkOperationsBar({
  selectedCount,
  selectedListings,
  shopSections,
  shopId,
  allShops,
  onCompleted,
  onSelectAll,
  onSelectNone,
  onSelectCurrentPage,
  onOpenBulkEditor,
}: BulkOperationsBarProps) {
  // Dialog states
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [addTagDialogOpen, setAddTagDialogOpen] = useState(false);
  const [removeTagDialogOpen, setRemoveTagDialogOpen] = useState(false);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [aiOptimizeDialogOpen, setAiOptimizeDialogOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);

  // Copy state
  const [targetShopId, setTargetShopId] = useState<string>('');
  const [copyProcessing, setCopyProcessing] = useState(false);
  const [copyProgress, setCopyProgress] = useState(0);

  // Alt Text state
  const [altTextDialogOpen, setAltTextDialogOpen] = useState(false);
  const [altTextProcessing, setAltTextProcessing] = useState(false);
  const [altTextProgress, setAltTextProgress] = useState(0);

  // Renew state
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [renewProcessing, setRenewProcessing] = useState(false);
  const [renewProgress, setRenewProgress] = useState(0);

  // Season Tags state
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<SeasonPreset | null>(null);
  const [seasonTagMode, setSeasonTagMode] = useState<SeasonTagMode>('add');

  // Variation Price state
  const [variationPriceDialogOpen, setVariationPriceDialogOpen] = useState(false);
  const [variationPropertyName, setVariationPropertyName] = useState('');
  const [variationPropertyValue, setVariationPropertyValue] = useState('');
  const [variationPriceMode, setVariationPriceMode] = useState<VariationPriceMode>('percent_increase');
  const [variationPriceAmount, setVariationPriceAmount] = useState('');
  const [variationProcessing, setVariationProcessing] = useState(false);
  const [variationProgress, setVariationProgress] = useState(0);

  // AI Optimize state
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiResult, setAiResult] = useState<{ success: number; failed: number } | null>(null);

  // Progress
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Price dialog state
  const [priceMode, setPriceMode] = useState<PriceMode>('percent_increase');
  const [priceAmount, setPriceAmount] = useState('');

  // Tag dialog state
  const [newTags, setNewTags] = useState('');
  const [tagsToRemove, setTagsToRemove] = useState<Set<string>>(new Set());

  // Section dialog state
  const [targetSectionId, setTargetSectionId] = useState<number | ''>('');

  const visible = !processing;
  const hasSelection = selectedCount > 0;

  // Menu anchors
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const t = useTranslations('etsy.bulkOps');
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Selection dropdown anchor
  const [selectionMenuAnchor, setSelectionMenuAnchor] = useState<null | HTMLElement>(null);

  // Collect all unique tags from selected listings
  const allUniqueTags = useMemo(() => {
    const tagSet = new Set<string>();
    selectedListings.forEach((l) => l.tags.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [selectedListings]);

  // Price preview calculation
  const pricePreview = useMemo(() => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) return [];
    return selectedListings
      .filter((l) => l.price)
      .slice(0, 10)
      .map((l) => {
        const current = l.price!.amount / l.price!.divisor;
        let newPrice: number;
        switch (priceMode) {
          case 'percent_increase': newPrice = current * (1 + amt / 100); break;
          case 'percent_decrease': newPrice = current * (1 - amt / 100); break;
          case 'fixed_add': newPrice = current + amt; break;
          case 'fixed_subtract': newPrice = current - amt; break;
        }
        newPrice = Math.max(0, Math.round(newPrice * 100) / 100);
        return {
          title: l.title.length > 40 ? l.title.slice(0, 40) + '...' : l.title,
          currency: l.price!.currency_code,
          current,
          newPrice,
        };
      });
  }, [selectedListings, priceMode, priceAmount]);

  // Execute bulk operation with progress tracking
  async function executeBulk<T>(
    items: T[],
    operation: (item: T) => Promise<Response>,
    actionLabel: string
  ) {
    setProcessing(true);
    setProgress(0);

    const results: PromiseSettledResult<Response>[] = [];
    for (let i = 0; i < items.length; i++) {
      const result = await Promise.allSettled([operation(items[i])]);
      results.push(result[0]);
      setProgress(((i + 1) / items.length) * 100);
      if (i < items.length - 1) await delay(100);
    }

    let succeeded = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const resp = r.value as Response;
        if (resp.ok) {
          succeeded++;
        } else if (actionLabel === 'Delete' && resp.status === 403) {
          succeeded++;
        }
      }
    }
    const failed = results.length - succeeded;

    if (failed > 0) {
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error(`${actionLabel} failed (rejected):`, r.reason);
        } else if (r.status === 'fulfilled' && !(r.value as Response).ok) {
          const resp = r.value as Response;
          if (actionLabel === 'Delete' && resp.status === 403) continue;
          try {
            const errBody = await resp.clone().json();
            console.error(`${actionLabel} failed (${resp.status}):`, errBody);
          } catch { console.error(`${actionLabel} failed (${resp.status})`); }
        }
      }
    }

    if (failed === 0) {
      toast.success(t('toastBulkSuccess', { action: actionLabel, count: succeeded }));
    } else {
      toast.error(t('toastBulkPartial', { action: actionLabel, succeeded, failed }));
    }

    setProcessing(false);
    setProgress(0);
    onCompleted();
  }

  // --- Handlers ---

  const handlePriceSubmit = async () => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) { toast.error(t('toastEnterValidAmount')); return; }
    const listingsWithPrice = selectedListings.filter((l) => l.price);
    setPriceDialogOpen(false);
    await executeBulk(listingsWithPrice, (listing) => {
      const current = listing.price!.amount / listing.price!.divisor;
      let newPrice: number;
      switch (priceMode) {
        case 'percent_increase': newPrice = current * (1 + amt / 100); break;
        case 'percent_decrease': newPrice = current * (1 - amt / 100); break;
        case 'fixed_add': newPrice = current + amt; break;
        case 'fixed_subtract': newPrice = current - amt; break;
      }
      newPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);
      return callUpdateListing(shopId, listing.listing_id, { price: newPrice });
    }, 'Price update');
    setPriceAmount('');
    setPriceMode('percent_increase');
  };

  const handleAddTagsSubmit = async () => {
    const tagsToAdd = newTags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    if (tagsToAdd.length === 0) { toast.error(t('toastEnterAtLeastOneTag')); return; }
    const violations = selectedListings.filter((l) => l.tags.length + tagsToAdd.length > 13);
    if (violations.length > 0) {
      toast.error(t('toastTagLimitExceeded', { count: violations.length }));
      return;
    }
    setAddTagDialogOpen(false);
    await executeBulk(selectedListings, (listing) => {
      const mergedTags = Array.from(new Set([...listing.tags, ...tagsToAdd])).slice(0, 13);
      return callUpdateListing(shopId, listing.listing_id, { tags: mergedTags });
    }, 'Add tags');
    setNewTags('');
  };

  const handleRemoveTagsSubmit = async () => {
    if (tagsToRemove.size === 0) { toast.error(t('toastSelectTagToRemove')); return; }
    setRemoveTagDialogOpen(false);
    await executeBulk(selectedListings, (listing) => {
      const filtered = listing.tags.filter((t) => !tagsToRemove.has(t));
      return callUpdateListing(shopId, listing.listing_id, { tags: filtered });
    }, 'Remove tags');
    setTagsToRemove(new Set());
  };

  const handleSectionSubmit = async () => {
    if (targetSectionId === '') { toast.error(t('toastSelectTargetSection')); return; }
    setSectionDialogOpen(false);
    await executeBulk(selectedListings, (listing) =>
      callUpdateListing(shopId, listing.listing_id, { shop_section_id: targetSectionId }),
      'Move section');
    setTargetSectionId('');
  };

  const handleDeleteSubmit = async () => {
    setDeleteDialogOpen(false);
    await executeBulk(selectedListings, (listing) => callDeleteListing(shopId, listing.listing_id), 'Delete');
  };

  const handleToggleState = async (targetState: 'active' | 'inactive') => {
    const label = targetState === 'active' ? t('publish') : t('deactivate');
    await executeBulk(selectedListings, (listing) =>
      callUpdateListing(shopId, listing.listing_id, { state: targetState }), label);
  };

  const handleAiOptimizeSubmit = async () => {
    setAiOptimizeDialogOpen(false);
    setAiProcessing(true);
    setAiProgress(0);
    setAiResult(null);
    try {
      const payload = selectedListings.map((l) => ({ listing_id: l.listing_id, title: l.title, tags: l.tags }));
      const aiRes = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_optimize', listings: payload }),
      });
      if (!aiRes.ok) {
        const errData = await aiRes.json().catch(() => ({}));
        toast.error(errData.error || t('toastAiOptimizationFailed'));
        setAiProcessing(false);
        return;
      }
      const { optimized } = await aiRes.json() as {
        optimized: Array<{ listing_id: number; title?: string; tags?: string[]; description?: string }>;
      };
      let success = 0, failed = 0;
      for (let i = 0; i < optimized.length; i++) {
        const item = optimized[i];
        const updateBody: Record<string, any> = {};
        if (item.title) updateBody.title = item.title;
        if (item.tags) updateBody.tags = item.tags;
        if (item.description) updateBody.description = item.description;
        try {
          const res = await callUpdateListing(shopId, item.listing_id, updateBody);
          if (res.ok) success++; else failed++;
        } catch { failed++; }
        setAiProgress(((i + 1) / optimized.length) * 100);
        if (i < optimized.length - 1) await delay(100);
      }
      setAiResult({ success, failed });
      if (failed === 0) toast.success(t('toastAiSuccess', { count: success }));
      else toast.error(t('toastAiPartial', { succeeded: success, failed }));
      onCompleted();
    } catch { toast.error(t('toastAiOptimizationFailed')); }
    finally { setAiProcessing(false); setAiProgress(0); }
  };

  const otherShops = useMemo(() => (allShops || []).filter((s) => s.shopId !== shopId), [allShops, shopId]);

  const handleCopySubmit = async () => {
    if (!targetShopId) { toast.error(t('toastSelectTargetShop')); return; }
    setCopyDialogOpen(false);
    setCopyProcessing(true);
    setCopyProgress(0);
    let success = 0, failed = 0;
    for (let i = 0; i < selectedListings.length; i++) {
      const listing = selectedListings[i];
      try {
        await stageEtsyDraft({ shopId, listingId: listing.listing_id, queuedActions: [{ type: 'copy', targetShopId }] });
        success++;
      } catch { failed++; }
      setCopyProgress(((i + 1) / selectedListings.length) * 100);
      if (i < selectedListings.length - 1) await delay(100);
    }
    setCopyProcessing(false);
    setCopyProgress(0);
    setTargetShopId('');
    if (failed === 0) toast.success(t('toastCopySuccess', { count: success }));
    else toast.error(t('toastCopyPartial', { succeeded: success, failed }));
    onCompleted();
  };

  const handleAltTextSubmit = async () => {
    setAltTextDialogOpen(false);
    setAltTextProcessing(true);
    setAltTextProgress(0);
    let success = 0, failed = 0;
    for (let i = 0; i < selectedListings.length; i++) {
      const listing = selectedListings[i];
      try {
        const aiRes = await fetch('/api/ai/etsy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate_alt_text', title: listing.title }),
        });
        if (!aiRes.ok) { failed++; setAltTextProgress(((i + 1) / selectedListings.length) * 100); if (i < selectedListings.length - 1) await delay(100); continue; }
        const aiData = await aiRes.json();
        const generatedAltText: string = aiData.alt_text || '';
        if (!generatedAltText) { failed++; setAltTextProgress(((i + 1) / selectedListings.length) * 100); if (i < selectedListings.length - 1) await delay(100); continue; }
        const imagesRes = await fetch(`/api/clawd/etsy?action=get_listing_images&listing_id=${listing.listing_id}&shop_id=${shopId}`);
        if (!imagesRes.ok) { failed++; setAltTextProgress(((i + 1) / selectedListings.length) * 100); if (i < selectedListings.length - 1) await delay(100); continue; }
        const imagesData = await imagesRes.json();
        const images: Array<{ listing_image_id: number }> = imagesData.images || imagesData.results || [];
        let listingSuccess = true;
        for (let j = 0; j < images.length; j++) {
          try {
            await stageEtsyDraft({
              shopId,
              listingId: listing.listing_id,
              media: [{ kind: 'image', operation: 'update_alt', etsyMediaId: images[j].listing_image_id, altText: generatedAltText }],
            });
          } catch { listingSuccess = false; }
          if (j < images.length - 1) await delay(50);
        }
        if (listingSuccess) success++; else failed++;
      } catch { failed++; }
      setAltTextProgress(((i + 1) / selectedListings.length) * 100);
      if (i < selectedListings.length - 1) await delay(100);
    }
    setAltTextProcessing(false);
    setAltTextProgress(0);
    if (failed === 0) toast.success(t('toastAltTextSuccess', { count: success }));
    else toast.error(t('toastAltTextPartial', { succeeded: success, failed }));
    onCompleted();
  };

  const handleRenewSubmit = async () => {
    setRenewDialogOpen(false);
    setRenewProcessing(true);
    setRenewProgress(0);
    let success = 0, failed = 0;
    for (let i = 0; i < selectedListings.length; i++) {
      const listing = selectedListings[i];
      try {
        await stageEtsyDraft({ shopId, listingId: listing.listing_id, queuedActions: [{ type: 'renew' }] });
        success++;
      } catch { failed++; }
      setRenewProgress(((i + 1) / selectedListings.length) * 100);
      if (i < selectedListings.length - 1) await delay(100);
    }
    setRenewProcessing(false);
    setRenewProgress(0);
    if (failed === 0) toast.success(t('toastRenewSuccess', { count: success }));
    else toast.error(t('toastRenewPartial', { succeeded: success, failed }));
    onCompleted();
  };

  const toggleTagToRemove = (tag: string) => {
    setTagsToRemove((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const handleSeasonTagsSubmit = async () => {
    if (!selectedSeason) { toast.error(t('toastSelectSeason')); return; }
    const seasonTags = selectedSeason.tags;
    if (seasonTagMode === 'add') {
      const violations = selectedListings.filter((l) => l.tags.length + seasonTags.length > 13);
      if (violations.length > 0) {
        toast.error(t('toastTagLimitExceeded', { count: violations.length }));
        return;
      }
    }
    setSeasonDialogOpen(false);
    await executeBulk(selectedListings, (listing) => {
      let finalTags: string[];
      if (seasonTagMode === 'replace') finalTags = [...seasonTags].slice(0, 13);
      else finalTags = Array.from(new Set([...listing.tags, ...seasonTags])).slice(0, 13);
      return callUpdateListing(shopId, listing.listing_id, { tags: finalTags });
    }, 'Season tags');
    setSelectedSeason(null);
    setSeasonTagMode('add');
  };

  const handleVariationPriceSubmit = async () => {
    const propName = variationPropertyName.trim();
    const propValue = variationPropertyValue.trim();
    const amt = parseFloat(variationPriceAmount);
    if (!propName || !propValue) { toast.error(t('toastEnterVariationFields')); return; }
    if (isNaN(amt) || amt <= 0) { toast.error(t('toastEnterValidAmount')); return; }
    setVariationPriceDialogOpen(false);
    setVariationProcessing(true);
    setVariationProgress(0);
    let success = 0, failed = 0, skipped = 0;
    for (let i = 0; i < selectedListings.length; i++) {
      const listing = selectedListings[i];
      try {
        const invRes = await fetch(`/api/clawd/etsy?action=get_listing_inventory&listing_id=${listing.listing_id}&shop_id=${shopId}`);
        if (!invRes.ok) { failed++; setVariationProgress(((i + 1) / selectedListings.length) * 100); if (i < selectedListings.length - 1) await delay(100); continue; }
        const invData = await invRes.json();
        const products = invData.products || [];
        let hasMatch = false;
        const updatedProducts = products.map((product: any) => {
          const propertyValues = product.property_values || [];
          const matches = propertyValues.some((pv: any) =>
            pv.property_name?.toLowerCase() === propName.toLowerCase() &&
            (pv.values || []).some((v: string) => v.toLowerCase() === propValue.toLowerCase())
          );
          if (!matches) return product;
          hasMatch = true;
          const updatedOfferings = (product.offerings || []).map((offering: any) => {
            const currentPrice = offering.price?.amount / (offering.price?.divisor || 100);
            let newPrice: number;
            switch (variationPriceMode) {
              case 'percent_increase': newPrice = currentPrice * (1 + amt / 100); break;
              case 'percent_decrease': newPrice = currentPrice * (1 - amt / 100); break;
              case 'fixed_add': newPrice = currentPrice + amt; break;
              case 'fixed_subtract': newPrice = currentPrice - amt; break;
            }
            newPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);
            return { ...offering, price: { ...offering.price, amount: Math.round(newPrice * (offering.price?.divisor || 100)) } };
          });
          return { ...product, offerings: updatedOfferings };
        });
        if (!hasMatch) { skipped++; setVariationProgress(((i + 1) / selectedListings.length) * 100); if (i < selectedListings.length - 1) await delay(100); continue; }
        await stageEtsyDraft({ shopId, listingId: listing.listing_id, inventory: { products: updatedProducts } });
        success++;
      } catch { failed++; }
      setVariationProgress(((i + 1) / selectedListings.length) * 100);
      if (i < selectedListings.length - 1) await delay(100);
    }
    setVariationProcessing(false);
    setVariationProgress(0);
    const msg = t('toastVariationSuccess', { action: 'Variation price', succeeded: success, failed });
    if (failed === 0) toast.success(msg); else toast.error(msg);
    setVariationPropertyName('');
    setVariationPropertyValue('');
    setVariationPriceAmount('');
    setVariationPriceMode('percent_increase');
    onCompleted();
  };

  // --- Export as CSV ---
  const handleExportCSV = () => {
    if (selectedListings.length === 0) return;
    const headers = ['listing_id', 'title', 'price', 'currency', 'tags', 'state', 'section_id'];
    const rows = selectedListings.map(l => [
      l.listing_id,
      `"${l.title.replace(/"/g, '""')}"`,
      l.price ? (l.price.amount / l.price.divisor).toFixed(2) : '',
      l.price?.currency_code || '',
      `"${l.tags.join(', ')}"`,
      l.state,
      l.shop_section_id || '',
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etsy-listings-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t('toastExported', { count: selectedListings.length }));
  };

  const isProcessing = processing || aiProcessing || copyProcessing || altTextProcessing || renewProcessing || variationProcessing;
  const currentProgress = processing ? progress : aiProcessing ? aiProgress : copyProcessing ? copyProgress :
    altTextProcessing ? altTextProgress : renewProcessing ? renewProgress : variationProgress;
  const processingLabel = processing ? t('processing') : aiProcessing ? t('aiOptimizing') : copyProcessing ? t('copying') :
    altTextProcessing ? t('generatingAltText') : renewProcessing ? t('renewing') : t('updatingVariations');

  return (
    <>
      {/* Processing overlay */}
      {isProcessing && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1400, p: 2,
            bgcolor: 'white', borderTop: '2px solid', borderColor: 'primary.main',
          }}
        >
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
            {processingLabel}
          </Typography>
          <LinearProgress variant="determinate" value={currentProgress} sx={{ height: 6, borderRadius: 3 }} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {Math.round(currentProgress)}%
          </Typography>
        </Paper>
      )}

      {/* Vela-style toolbar buttons — rendered inline in the parent's selection bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        {/* Delete */}
        <Tooltip title={t("deleteSelected")}>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={!hasSelection || isProcessing}
            startIcon={!isMobile ? <DeleteOutline /> : undefined}
            onClick={() => setDeleteDialogOpen(true)}
            sx={{
              minHeight: 36, textTransform: 'none', fontWeight: 600, borderRadius: '8px',
              fontSize: '0.82rem', px: isMobile ? 1 : 2,
            }}
          >
            {isMobile ? <DeleteOutline /> : t('deleteBtn')}
          </Button>
        </Tooltip>

        {/* Export */}
        <Tooltip title={t("exportCsv")}>
          <Button
            size="small"
            variant="outlined"
            disabled={!hasSelection || isProcessing}
            startIcon={!isMobile ? <FileDownloadIcon /> : undefined}
            onClick={handleExportCSV}
            sx={{
              minHeight: 36, textTransform: 'none', fontWeight: 600, borderRadius: '8px',
              fontSize: '0.82rem', px: isMobile ? 1 : 2,
            }}
          >
            {isMobile ? <FileDownloadIcon /> : t('exportBtn')}
          </Button>
        </Tooltip>

        {/* Copy to shop */}
        {otherShops.length > 0 && (
          <Tooltip title={t("copyToShop")}>
            <Button
              size="small"
              variant="outlined"
              disabled={!hasSelection || isProcessing}
              startIcon={!isMobile ? <ContentCopyIcon /> : undefined}
              onClick={() => { setTargetShopId(''); setCopyDialogOpen(true); }}
              sx={{
                minHeight: 36, textTransform: 'none', fontWeight: 600, borderRadius: '8px',
                fontSize: '0.82rem', px: isMobile ? 1 : 2,
              }}
            >
              {isMobile ? <ContentCopyIcon /> : t('copyBtn')}
            </Button>
          </Tooltip>
        )}

        {/* More actions */}
        <Tooltip title={t("moreActions")}>
          <IconButton
            size="small"
            disabled={!hasSelection || isProcessing}
            onClick={isMobile ? () => setMobileDrawerOpen(true) : (e) => setMoreMenuAnchor(e.currentTarget)}
            sx={{
              border: '1px solid', borderColor: 'divider', borderRadius: '8px',
              width: 36, height: 36,
            }}
          >
            <MoreHorizIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* More menu (desktop) */}
        <Menu
          anchorEl={moreMenuAnchor}
          open={Boolean(moreMenuAnchor)}
          onClose={() => setMoreMenuAnchor(null)}
        >
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setAddTagDialogOpen(true); }}>
            <ListItemIcon><LocalOfferOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>{t("addTags")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setTagsToRemove(new Set()); setRemoveTagDialogOpen(true); }}>
            <ListItemIcon><RemoveCircleOutline fontSize="small" /></ListItemIcon>
            <ListItemText>{t("removeTags")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setSelectedSeason(null); setSeasonTagMode('add'); setSeasonDialogOpen(true); }}>
            <ListItemIcon><CelebrationIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t("seasonTags")}</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setPriceDialogOpen(true); }}>
            <ListItemIcon><AttachMoneyOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>{t("bulkPriceChange")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setVariationPriceDialogOpen(true); }}>
            <ListItemIcon><TuneOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>{t("variationPrice")}</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => { setMoreMenuAnchor(null); handleToggleState('active'); }}>
            <ListItemIcon><PublishOutlined fontSize="small" color="success" /></ListItemIcon>
            <ListItemText>{t("publish")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); handleToggleState('inactive'); }}>
            <ListItemIcon><RemoveCircleOutline fontSize="small" color="warning" /></ListItemIcon>
            <ListItemText>{t("deactivate")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setSectionDialogOpen(true); }}>
            <ListItemIcon><DriveFileMoveOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>{t("moveSection")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setRenewDialogOpen(true); }}>
            <ListItemIcon><RefreshOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>{t("renew")}</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setAiResult(null); setAiOptimizeDialogOpen(true); }}>
            <ListItemIcon><AutoFixHigh fontSize="small" color="secondary" /></ListItemIcon>
            <ListItemText>{t("aiOptimize")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setMoreMenuAnchor(null); setAltTextDialogOpen(true); }}>
            <ListItemIcon><ImageOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>{t("aiAltText")}</ListItemText>
          </MenuItem>
        </Menu>
      </Box>

      {/* Mobile overflow drawer */}
      <SwipeableDrawer
        anchor="bottom"
        open={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        onOpen={() => setMobileDrawerOpen(true)}
        sx={{ zIndex: 1400 }}
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, pb: 2, maxHeight: '70vh' } }}
      >
        <Box sx={{ width: 40, height: 4, bgcolor: 'grey.400', borderRadius: 2, mx: 'auto', mt: 1.5, mb: 1 }} />
        <Typography variant="subtitle2" sx={{ px: 2, pb: 1, fontWeight: 700 }}>{t("quickActions")}
        </Typography>
        <List>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setAddTagDialogOpen(true); }}>
              <ListItemIcon><LocalOfferOutlined /></ListItemIcon>
              <ListItemText primary={t("addTags")} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setTagsToRemove(new Set()); setRemoveTagDialogOpen(true); }}>
              <ListItemIcon><RemoveCircleOutline /></ListItemIcon>
              <ListItemText primary={t("removeTags")} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setSelectedSeason(null); setSeasonDialogOpen(true); }}>
              <ListItemIcon><CelebrationIcon /></ListItemIcon>
              <ListItemText primary={t("seasonTags")} />
            </ListItemButton>
          </ListItem>
          <Divider sx={{ my: 0.5 }} />
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setPriceDialogOpen(true); }}>
              <ListItemIcon><AttachMoneyOutlined /></ListItemIcon>
              <ListItemText primary={t("bulkPriceChange")} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setVariationPriceDialogOpen(true); }}>
              <ListItemIcon><TuneOutlined /></ListItemIcon>
              <ListItemText primary={t("variationPrice")} />
            </ListItemButton>
          </ListItem>
          <Divider sx={{ my: 0.5 }} />
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); handleToggleState('active'); }}>
              <ListItemIcon><PublishOutlined color="success" /></ListItemIcon>
              <ListItemText primary={t("publish")} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); handleToggleState('inactive'); }}>
              <ListItemIcon><RemoveCircleOutline color="warning" /></ListItemIcon>
              <ListItemText primary={t("deactivate")} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setSectionDialogOpen(true); }}>
              <ListItemIcon><DriveFileMoveOutlined /></ListItemIcon>
              <ListItemText primary={t("moveSection")} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setRenewDialogOpen(true); }}>
              <ListItemIcon><RefreshOutlined /></ListItemIcon>
              <ListItemText primary={t("renew")} />
            </ListItemButton>
          </ListItem>
          <Divider sx={{ my: 0.5 }} />
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setAiResult(null); setAiOptimizeDialogOpen(true); }}>
              <ListItemIcon><AutoFixHigh color="secondary" /></ListItemIcon>
              <ListItemText primary={t("aiOptimize")} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setAltTextDialogOpen(true); }}>
              <ListItemIcon><ImageOutlined /></ListItemIcon>
              <ListItemText primary={t("aiAltText")} />
            </ListItemButton>
          </ListItem>
        </List>
      </SwipeableDrawer>

      {/* ---- Dialogs ---- */}

      {/* Price Dialog */}
      <Dialog open={priceDialogOpen} onClose={() => setPriceDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("bulkPriceChange")}</DialogTitle>
        <DialogContent>
          <RadioGroup value={priceMode} onChange={(e) => setPriceMode(e.target.value as PriceMode)}>
            <FormControlLabel value="percent_increase" control={<Radio />} label={t("pricePercentIncrease")} />
            <FormControlLabel value="percent_decrease" control={<Radio />} label={t("pricePercentDecrease")} />
            <FormControlLabel value="fixed_add" control={<Radio />} label={t("priceFixedAdd")} />
            <FormControlLabel value="fixed_subtract" control={<Radio />} label={t("priceFixedSubtract")} />
          </RadioGroup>
          <TextField
            label={priceMode.startsWith('percent') ? t('pricePercentageLabel') : t('priceAmountLabel')}
            type="number" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)}
            fullWidth sx={{ mt: 2 }} inputProps={{ min: 0, step: 0.01 }}
          />
          {pricePreview.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t("bulkPriceChange")} ({pricePreview.length})</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("tableListing")}</TableCell>
                      <TableCell align="right">{t("tableCurrent")}</TableCell>
                      <TableCell align="right">{t("tableNew")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pricePreview.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{p.title}</TableCell>
                        <TableCell align="right">{p.current.toFixed(2)} {p.currency}</TableCell>
                        <TableCell align="right">{p.newPrice.toFixed(2)} {p.currency}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPriceDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" onClick={handlePriceSubmit} disabled={!priceAmount || parseFloat(priceAmount) <= 0}>{t("apply")}</Button>
        </DialogActions>
      </Dialog>

      {/* Add Tag Dialog */}
      <Dialog open={addTagDialogOpen} onClose={() => setAddTagDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("addTags")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("addTagsHelperText")}
          </Typography>
          <TextField
            label={t("tagsLabel")} placeholder={t("tagsPlaceholder")}
            value={newTags} onChange={(e) => setNewTags(e.target.value)} fullWidth
            helperText={`${newTags.split(',').map((x) => x.trim()).filter((x) => x).length} tags`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddTagDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" onClick={handleAddTagsSubmit}>{t("add")}</Button>
        </DialogActions>
      </Dialog>

      {/* Remove Tag Dialog */}
      <Dialog open={removeTagDialogOpen} onClose={() => setRemoveTagDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("removeTags")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("removeTagsHelperText")}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {allUniqueTags.length === 0 ? (
              <Typography variant="body2" color="text.secondary">{t("noTagsFound")}</Typography>
            ) : (
              allUniqueTags.map((tag) => (
                <Chip key={tag} label={tag}
                  onClick={() => toggleTagToRemove(tag)}
                  color={tagsToRemove.has(tag) ? 'error' : 'default'}
                  variant={tagsToRemove.has(tag) ? 'filled' : 'outlined'}
                />
              ))
            )}
          </Box>
          {tagsToRemove.size > 0 && (
            <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
              {tagsToRemove.size} tags
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTagDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" color="error" onClick={handleRemoveTagsSubmit} disabled={tagsToRemove.size === 0}>{t("remove")}</Button>
        </DialogActions>
      </Dialog>

      {/* Section Move Dialog */}
      <Dialog open={sectionDialogOpen} onClose={() => setSectionDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("moveSection")}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>{t("targetSection")}</InputLabel>
            <Select value={targetSectionId} label={t("targetSection")} onChange={(e) => setTargetSectionId(Number(e.target.value))}>
              {shopSections.map((section) => (
                <MenuItem key={section.shop_section_id} value={section.shop_section_id}>{section.title}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSectionDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" onClick={handleSectionSubmit} disabled={targetSectionId === ''}>{t("move")}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("confirmDelete")}</DialogTitle>
        <DialogContent>
          <Typography>
            {t("confirmDeleteText", { count: selectedCount })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteSubmit}>{t("deleteBtn")}</Button>
        </DialogActions>
      </Dialog>

      {/* AI Optimize Dialog */}
      <Dialog open={aiOptimizeDialogOpen} onClose={() => setAiOptimizeDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoFixHigh color="secondary" />
          {t("aiBulkOptimize")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t("aiBulkOptimize")}: {selectedCount} listings
          </Typography>
          <Box sx={{ pl: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">- Titles restructured for SEO</Typography>
            <Typography variant="body2" color="text.secondary">- Tags optimized by search volume</Typography>
            <Typography variant="body2" color="text.secondary">- Descriptions generated by AI</Typography>
          </Box>
          <Typography variant="caption" color="warning.main">
            {t("aiOptimizeWarning")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiOptimizeDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" color="secondary" startIcon={<AutoFixHigh />} onClick={handleAiOptimizeSubmit}>{t("optimize")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Copy to Shop Dialog */}
      <Dialog open={copyDialogOpen} onClose={() => setCopyDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ContentCopyIcon /> {t("copyToAnotherShop")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {selectedCount} listings → {t("targetShop")}
          </Typography>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>{t("targetShop")}</InputLabel>
            <Select value={targetShopId} label={t("targetShop")} onChange={(e) => setTargetShopId(e.target.value as string)}>
              {otherShops.map((s) => (
                <MenuItem key={s.shopId} value={s.shopId}>{s.shopName}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopyDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" onClick={handleCopySubmit} disabled={!targetShopId} startIcon={<ContentCopyIcon />}>{t("copyBtn")}</Button>
        </DialogActions>
      </Dialog>

      {/* Alt Text Dialog */}
      <Dialog open={altTextDialogOpen} onClose={() => setAltTextDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ImageOutlined color="info" /> {t("aiGenerateAltText")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t("aiGenerateAltText")}: {selectedCount} listings
          </Typography>
          <Box sx={{ pl: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">- Alt text from listing title</Typography>
            <Typography variant="body2" color="text.secondary">- Applied to all images</Typography>
          </Box>
          <Typography variant="caption" color="warning.main">{t("altTextWarning")}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAltTextDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" color="info" startIcon={<ImageOutlined />} onClick={handleAltTextSubmit}>{t("generate")}</Button>
        </DialogActions>
      </Dialog>

      {/* Renew Dialog */}
      <Dialog open={renewDialogOpen} onClose={() => setRenewDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <RefreshOutlined color="success" /> {t("bulkRenew")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            {t("renew")} {selectedCount} listings
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t("renewHelperText")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenewDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" color="success" startIcon={<RefreshOutlined />} onClick={handleRenewSubmit}>{t("renew")}</Button>
        </DialogActions>
      </Dialog>

      {/* Season Tags Dialog */}
      <Dialog open={seasonDialogOpen} onClose={() => setSeasonDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CelebrationIcon color="secondary" /> {t("seasonTags")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("seasonTags")}: {selectedCount} listings
          </Typography>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t("mode")}</Typography>
            <ToggleButtonGroup value={seasonTagMode} exclusive
              onChange={(_, val) => { if (val) setSeasonTagMode(val); }} size="small" fullWidth>
              <ToggleButton value="add">{t("addAppend")}</ToggleButton>
              <ToggleButton value="replace">{t("replaceOverwrite")}</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{t("selectSeason")}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {SEASON_PRESETS.map((preset) => (
              <Paper key={preset.label} variant="outlined"
                onClick={() => setSelectedSeason(preset)}
                sx={{
                  p: 1.5, cursor: 'pointer',
                  borderColor: selectedSeason?.label === preset.label ? 'primary.main' : 'divider',
                  borderWidth: selectedSeason?.label === preset.label ? 2 : 1,
                  bgcolor: selectedSeason?.label === preset.label ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: 'action.hover' },
                }}>
                <Typography variant="subtitle2">{t(preset.label)}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {preset.tags.map((tag) => <Chip key={tag} label={tag} size="small" variant="outlined" />)}
                </Box>
              </Paper>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSeasonDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" color="secondary" onClick={handleSeasonTagsSubmit} disabled={!selectedSeason}
            startIcon={<CelebrationIcon />}>
            {seasonTagMode === 'add' ? t('add') : t('replace')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Variation Price Dialog */}
      <Dialog open={variationPriceDialogOpen} onClose={() => setVariationPriceDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TuneOutlined /> {t("variationPriceChange")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("variationPriceChange")}
          </Typography>
          <TextField label={t("variationPropertyName")} placeholder="Size, Color, Material"
            value={variationPropertyName} onChange={(e) => setVariationPropertyName(e.target.value)} fullWidth sx={{ mb: 2 }} />
          <TextField label={t("variationValue")} placeholder="Small, Red, Cotton"
            value={variationPropertyValue} onChange={(e) => setVariationPropertyValue(e.target.value)} fullWidth sx={{ mb: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{t("priceAdjustment")}</Typography>
          <RadioGroup value={variationPriceMode} onChange={(e) => setVariationPriceMode(e.target.value as VariationPriceMode)}>
            <FormControlLabel value="percent_increase" control={<Radio />} label={t("pricePercentIncrease")} />
            <FormControlLabel value="percent_decrease" control={<Radio />} label={t("pricePercentDecrease")} />
            <FormControlLabel value="fixed_add" control={<Radio />} label={t("priceFixedAdd")} />
            <FormControlLabel value="fixed_subtract" control={<Radio />} label={t("priceFixedSubtract")} />
          </RadioGroup>
          <TextField label={variationPriceMode.startsWith('percent') ? t('pricePercentageLabel') : t('priceAmountLabel')}
            type="number" value={variationPriceAmount} onChange={(e) => setVariationPriceAmount(e.target.value)}
            fullWidth sx={{ mt: 1 }} inputProps={{ min: 0, step: 0.01 }} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>{t("nonMatchingSkipped")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVariationPriceDialogOpen(false)}>{t("cancel")}</Button>
          <Button variant="contained" onClick={handleVariationPriceSubmit}
            disabled={!variationPropertyName.trim() || !variationPropertyValue.trim() || !variationPriceAmount || parseFloat(variationPriceAmount) <= 0}
            startIcon={<TuneOutlined />}>
            Apply
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
