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
  Slide,
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
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';

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
}

type PriceMode = 'percent_increase' | 'percent_decrease' | 'fixed_add' | 'fixed_subtract';

type SeasonTagMode = 'add' | 'replace';

interface SeasonPreset {
  label: string;
  tags: string[];
}

const SEASON_PRESETS: SeasonPreset[] = [
  { label: 'Yilbasi', tags: ['christmas gift', 'holiday gift', 'stocking stuffer', 'xmas present', 'holiday decor'] },
  { label: 'Sevgililer Gunu', tags: ['valentines gift', 'valentine day', 'romantic gift', 'gift for her', 'love gift'] },
  { label: 'Anneler Gunu', tags: ['mothers day gift', 'gift for mom', 'mom birthday', 'mama gift'] },
  { label: 'Babalar Gunu', tags: ['fathers day gift', 'gift for dad', 'dad birthday', 'papa gift'] },
  { label: 'Cadilar Bayrami', tags: ['halloween decor', 'spooky gift', 'trick or treat', 'halloween costume'] },
  { label: 'Yaz', tags: ['summer decor', 'beach gift', 'outdoor', 'summer vibes'] },
  { label: 'Kis', tags: ['winter decor', 'cozy gift', 'holiday season', 'winter vibes'] },
];

type VariationPriceMode = 'percent_increase' | 'percent_decrease' | 'fixed_add' | 'fixed_subtract';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callUpdateListing(
  shopId: string,
  listingId: number,
  body: Record<string, any>
): Promise<Response> {
  return fetch(
    `/api/clawd/etsy?action=update_listing&listing_id=${listingId}&shop_id=${shopId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
}

async function callDeleteListing(
  shopId: string,
  listingId: number
): Promise<Response> {
  return fetch(
    `/api/clawd/etsy?action=delete_listing&listing_id=${listingId}&shop_id=${shopId}`,
    {
      method: 'DELETE',
    }
  );
}

export default function BulkOperationsBar({
  selectedCount,
  selectedListings,
  shopSections,
  shopId,
  allShops,
  onCompleted,
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

  const visible = selectedCount > 0 && !processing;

  // Menu anchor states for grouped dropdowns
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [tagsMenuAnchor, setTagsMenuAnchor] = useState<null | HTMLElement>(null);
  const [priceMenuAnchor, setPriceMenuAnchor] = useState<null | HTMLElement>(null);
  const [managementMenuAnchor, setManagementMenuAnchor] = useState<null | HTMLElement>(null);
  const [aiMenuAnchor, setAiMenuAnchor] = useState<null | HTMLElement>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

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
          case 'percent_increase':
            newPrice = current * (1 + amt / 100);
            break;
          case 'percent_decrease':
            newPrice = current * (1 - amt / 100);
            break;
          case 'fixed_add':
            newPrice = current + amt;
            break;
          case 'fixed_subtract':
            newPrice = current - amt;
            break;
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

    // Count successes — for delete, 403 "already removed" counts as success
    let succeeded = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const resp = r.value as Response;
        if (resp.ok) {
          succeeded++;
        } else if (actionLabel === 'Silme' && resp.status === 403) {
          // Etsy returns 403 for already-removed listings — treat as success
          succeeded++;
        }
      }
    }
    const failed = results.length - succeeded;

    // Log failed operations for debugging
    if (failed > 0) {
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error(`${actionLabel} failed (rejected):`, r.reason);
        } else if (r.status === 'fulfilled' && !(r.value as Response).ok) {
          const resp = r.value as Response;
          if (actionLabel === 'Silme' && resp.status === 403) continue; // already counted as success
          try {
            const errBody = await resp.clone().json();
            console.error(`${actionLabel} failed (${resp.status}):`, errBody);
          } catch { console.error(`${actionLabel} failed (${resp.status})`); }
        }
      }
    }

    if (failed === 0) {
      toast.success(`${actionLabel}: ${succeeded} listeleme basariyla guncellendi`);
    } else {
      toast.error(`${actionLabel}: ${succeeded} basarili, ${failed} basarisiz`);
    }

    setProcessing(false);
    setProgress(0);
    onCompleted();
  }

  // --- Price Change ---
  const handlePriceSubmit = async () => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Gecerli bir tutar giriniz');
      return;
    }

    const listingsWithPrice = selectedListings.filter((l) => l.price);
    setPriceDialogOpen(false);

    await executeBulk(
      listingsWithPrice,
      (listing) => {
        const current = listing.price!.amount / listing.price!.divisor;
        let newPrice: number;
        switch (priceMode) {
          case 'percent_increase':
            newPrice = current * (1 + amt / 100);
            break;
          case 'percent_decrease':
            newPrice = current * (1 - amt / 100);
            break;
          case 'fixed_add':
            newPrice = current + amt;
            break;
          case 'fixed_subtract':
            newPrice = current - amt;
            break;
        }
        newPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);
        return callUpdateListing(shopId, listing.listing_id, { price: newPrice });
      },
      'Fiyat guncelleme'
    );

    setPriceAmount('');
    setPriceMode('percent_increase');
  };

  // --- Add Tags ---
  const handleAddTagsSubmit = async () => {
    const tagsToAdd = newTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (tagsToAdd.length === 0) {
      toast.error('En az bir etiket giriniz');
      return;
    }

    // Validate max 13 tags
    const violations = selectedListings.filter(
      (l) => l.tags.length + tagsToAdd.length > 13
    );
    if (violations.length > 0) {
      toast.error(
        `${violations.length} listelemede etiket siniri (maks 13) asilacak. Daha az etiket ekleyin.`
      );
      return;
    }

    setAddTagDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        const mergedTags = Array.from(new Set([...listing.tags, ...tagsToAdd])).slice(0, 13);
        return callUpdateListing(shopId, listing.listing_id, { tags: mergedTags });
      },
      'Etiket ekleme'
    );

    setNewTags('');
  };

  // --- Remove Tags ---
  const handleRemoveTagsSubmit = async () => {
    if (tagsToRemove.size === 0) {
      toast.error('Kaldirilacak en az bir etiket seciniz');
      return;
    }

    setRemoveTagDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        const filtered = listing.tags.filter((t) => !tagsToRemove.has(t));
        return callUpdateListing(shopId, listing.listing_id, { tags: filtered });
      },
      'Etiket kaldirma'
    );

    setTagsToRemove(new Set());
  };

  // --- Move Section ---
  const handleSectionSubmit = async () => {
    if (targetSectionId === '') {
      toast.error('Hedef bolum seciniz');
      return;
    }

    setSectionDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) =>
        callUpdateListing(shopId, listing.listing_id, {
          shop_section_id: targetSectionId,
        }),
      'Bolum tasima'
    );

    setTargetSectionId('');
  };

  // --- Delete ---
  const handleDeleteSubmit = async () => {
    setDeleteDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => callDeleteListing(shopId, listing.listing_id),
      'Silme'
    );
  };

  // --- Publish / Deactivate ---
  const handleToggleState = async (targetState: 'active' | 'inactive') => {
    const label = targetState === 'active' ? 'Yayinlama' : 'Deaktif etme';

    await executeBulk(
      selectedListings,
      (listing) =>
        callUpdateListing(shopId, listing.listing_id, { state: targetState }),
      label
    );
  };

  // --- AI Optimize ---
  const handleAiOptimizeSubmit = async () => {
    setAiOptimizeDialogOpen(false);
    setAiProcessing(true);
    setAiProgress(0);
    setAiResult(null);

    try {
      // Step 1: Call AI bulk optimize endpoint
      const payload = selectedListings.map((l) => ({
        listing_id: l.listing_id,
        title: l.title,
        tags: l.tags,
      }));

      const aiRes = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_optimize', listings: payload }),
      });

      if (!aiRes.ok) {
        const errData = await aiRes.json().catch(() => ({}));
        toast.error(errData.error || 'AI optimizasyon basarisiz oldu');
        setAiProcessing(false);
        return;
      }

      const { optimized } = await aiRes.json() as {
        optimized: Array<{
          listing_id: number;
          title?: string;
          tags?: string[];
          description?: string;
        }>;
      };

      // Step 2: Apply each optimized listing via update_listing
      let success = 0;
      let failed = 0;

      for (let i = 0; i < optimized.length; i++) {
        const item = optimized[i];
        const updateBody: Record<string, any> = {};
        if (item.title) updateBody.title = item.title;
        if (item.tags) updateBody.tags = item.tags;
        if (item.description) updateBody.description = item.description;

        try {
          const res = await callUpdateListing(shopId, item.listing_id, updateBody);
          if (res.ok) {
            success++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }

        setAiProgress(((i + 1) / optimized.length) * 100);
        if (i < optimized.length - 1) await delay(100);
      }

      setAiResult({ success, failed });

      if (failed === 0) {
        toast.success(`AI Optimizasyon: ${success} listeleme basariyla guncellendi`);
      } else {
        toast.error(`AI Optimizasyon: ${success} basarili, ${failed} basarisiz`);
      }

      onCompleted();
    } catch (err) {
      toast.error('AI optimizasyon sirasinda bir hata olustu');
    } finally {
      setAiProcessing(false);
      setAiProgress(0);
    }
  };

  // --- Copy to another shop ---
  const otherShops = useMemo(
    () => (allShops || []).filter((s) => s.shopId !== shopId),
    [allShops, shopId]
  );

  const handleCopySubmit = async () => {
    if (!targetShopId) {
      toast.error('Hedef magaza seciniz');
      return;
    }

    setCopyDialogOpen(false);
    setCopyProcessing(true);
    setCopyProgress(0);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < selectedListings.length; i++) {
      const listing = selectedListings[i];
      try {
        const res = await fetch(
          `/api/clawd/etsy?action=copy_listing&listing_id=${listing.listing_id}&shop_id=${shopId}&target_shop_id=${targetShopId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }
        );
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }

      setCopyProgress(((i + 1) / selectedListings.length) * 100);
      if (i < selectedListings.length - 1) await delay(100);
    }

    setCopyProcessing(false);
    setCopyProgress(0);
    setTargetShopId('');

    if (failed === 0) {
      toast.success(`Kopyalama: ${success} listeleme basariyla kopyalandi`);
    } else {
      toast.error(`Kopyalama: ${success} basarili, ${failed} basarisiz`);
    }

    onCompleted();
  };

  // --- Bulk Alt Text ---
  const handleAltTextSubmit = async () => {
    setAltTextDialogOpen(false);
    setAltTextProcessing(true);
    setAltTextProgress(0);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < selectedListings.length; i++) {
      const listing = selectedListings[i];
      try {
        // Step 1: Generate alt text via AI
        const aiRes = await fetch('/api/ai/etsy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate_alt_text',
            title: listing.title,
          }),
        });

        if (!aiRes.ok) {
          failed++;
          setAltTextProgress(((i + 1) / selectedListings.length) * 100);
          if (i < selectedListings.length - 1) await delay(100);
          continue;
        }

        const aiData = await aiRes.json();
        const generatedAltText: string = aiData.alt_text || '';

        if (!generatedAltText) {
          failed++;
          setAltTextProgress(((i + 1) / selectedListings.length) * 100);
          if (i < selectedListings.length - 1) await delay(100);
          continue;
        }

        // Step 2: Fetch listing images from Etsy
        const imagesRes = await fetch(
          `/api/clawd/etsy?action=get_listing_images&listing_id=${listing.listing_id}&shop_id=${shopId}`
        );

        if (!imagesRes.ok) {
          failed++;
          setAltTextProgress(((i + 1) / selectedListings.length) * 100);
          if (i < selectedListings.length - 1) await delay(100);
          continue;
        }

        const imagesData = await imagesRes.json();
        const images: Array<{ listing_image_id: number }> = imagesData.images || imagesData.results || [];

        // Step 3: Update each image's alt text with the AI-generated text
        let listingSuccess = true;
        for (let j = 0; j < images.length; j++) {
          try {
            const updateRes = await fetch(
              `/api/clawd/etsy?action=update_listing_image&listing_id=${listing.listing_id}&image_id=${images[j].listing_image_id}&shop_id=${shopId}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alt_text: generatedAltText }),
              }
            );
            if (!updateRes.ok) listingSuccess = false;
          } catch {
            listingSuccess = false;
          }
          if (j < images.length - 1) await delay(50);
        }

        if (listingSuccess) success++;
        else failed++;
      } catch {
        failed++;
      }

      setAltTextProgress(((i + 1) / selectedListings.length) * 100);
      if (i < selectedListings.length - 1) await delay(100);
    }

    setAltTextProcessing(false);
    setAltTextProgress(0);

    if (failed === 0) {
      toast.success(`Alt Metin: ${success} listelemenin gorselleri basariyla guncellendi`);
    } else {
      toast.error(`Alt Metin: ${success} basarili, ${failed} basarisiz`);
    }

    onCompleted();
  };

  // --- Bulk Renew ---
  const handleRenewSubmit = async () => {
    setRenewDialogOpen(false);
    setRenewProcessing(true);
    setRenewProgress(0);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < selectedListings.length; i++) {
      const listing = selectedListings[i];
      try {
        const res = await fetch(
          `/api/clawd/etsy?action=renew_listing&listing_id=${listing.listing_id}&shop_id=${shopId}`,
          { method: 'POST' }
        );
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }

      setRenewProgress(((i + 1) / selectedListings.length) * 100);
      if (i < selectedListings.length - 1) await delay(100);
    }

    setRenewProcessing(false);
    setRenewProgress(0);

    if (failed === 0) {
      toast.success(`Yenileme: ${success} listeleme basariyla yenilendi`);
    } else {
      toast.error(`Yenileme: ${success} basarili, ${failed} basarisiz`);
    }

    onCompleted();
  };

  const toggleTagToRemove = (tag: string) => {
    setTagsToRemove((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  // --- Season Tags ---
  const handleSeasonTagsSubmit = async () => {
    if (!selectedSeason) {
      toast.error('Bir sezon secin');
      return;
    }

    const seasonTags = selectedSeason.tags;

    if (seasonTagMode === 'add') {
      // Check 13-tag limit
      const violations = selectedListings.filter(
        (l) => l.tags.length + seasonTags.length > 13
      );
      if (violations.length > 0) {
        toast.error(
          `${violations.length} listelemede etiket siniri (maks 13) asilacak. Daha az etiketli bir sezon secin veya "Degistir" modunu kullanin.`
        );
        return;
      }
    }

    setSeasonDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        let finalTags: string[];
        if (seasonTagMode === 'replace') {
          finalTags = [...seasonTags].slice(0, 13);
        } else {
          finalTags = Array.from(new Set([...listing.tags, ...seasonTags])).slice(0, 13);
        }
        return callUpdateListing(shopId, listing.listing_id, { tags: finalTags });
      },
      'Sezon etiketi'
    );

    setSelectedSeason(null);
    setSeasonTagMode('add');
  };

  // --- Variation Price ---
  const handleVariationPriceSubmit = async () => {
    const propName = variationPropertyName.trim();
    const propValue = variationPropertyValue.trim();
    const amt = parseFloat(variationPriceAmount);

    if (!propName || !propValue) {
      toast.error('Varyasyon ozellik adi ve degeri giriniz');
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      toast.error('Gecerli bir tutar giriniz');
      return;
    }

    setVariationPriceDialogOpen(false);
    setVariationProcessing(true);
    setVariationProgress(0);

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < selectedListings.length; i++) {
      const listing = selectedListings[i];
      try {
        // Step 1: Fetch listing inventory
        const invRes = await fetch(
          `/api/clawd/etsy?action=get_listing_inventory&listing_id=${listing.listing_id}&shop_id=${shopId}`
        );

        if (!invRes.ok) {
          failed++;
          setVariationProgress(((i + 1) / selectedListings.length) * 100);
          if (i < selectedListings.length - 1) await delay(100);
          continue;
        }

        const invData = await invRes.json();
        const products = invData.products || [];

        let hasMatch = false;
        const updatedProducts = products.map((product: any) => {
          const propertyValues = product.property_values || [];
          const matches = propertyValues.some(
            (pv: any) =>
              pv.property_name?.toLowerCase() === propName.toLowerCase() &&
              (pv.values || []).some(
                (v: string) => v.toLowerCase() === propValue.toLowerCase()
              )
          );

          if (!matches) return product;

          hasMatch = true;
          const updatedOfferings = (product.offerings || []).map((offering: any) => {
            const currentPrice = offering.price?.amount / (offering.price?.divisor || 100);
            let newPrice: number;

            switch (variationPriceMode) {
              case 'percent_increase':
                newPrice = currentPrice * (1 + amt / 100);
                break;
              case 'percent_decrease':
                newPrice = currentPrice * (1 - amt / 100);
                break;
              case 'fixed_add':
                newPrice = currentPrice + amt;
                break;
              case 'fixed_subtract':
                newPrice = currentPrice - amt;
                break;
            }
            newPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);

            return {
              ...offering,
              price: {
                ...offering.price,
                amount: Math.round(newPrice * (offering.price?.divisor || 100)),
              },
            };
          });

          return { ...product, offerings: updatedOfferings };
        });

        if (!hasMatch) {
          skipped++;
          setVariationProgress(((i + 1) / selectedListings.length) * 100);
          if (i < selectedListings.length - 1) await delay(100);
          continue;
        }

        // Step 2: Update inventory
        const updateRes = await fetch(
          `/api/clawd/etsy?action=update_listing_inventory&listing_id=${listing.listing_id}&shop_id=${shopId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ products: updatedProducts }),
          }
        );

        if (updateRes.ok) success++;
        else failed++;
      } catch {
        failed++;
      }

      setVariationProgress(((i + 1) / selectedListings.length) * 100);
      if (i < selectedListings.length - 1) await delay(100);
    }

    setVariationProcessing(false);
    setVariationProgress(0);

    const msg = `Varyasyon fiyat: ${success} basarili${failed > 0 ? `, ${failed} basarisiz` : ''}${skipped > 0 ? `, ${skipped} eslesme yok` : ''}`;
    if (failed === 0) {
      toast.success(msg);
    } else {
      toast.error(msg);
    }

    setVariationPropertyName('');
    setVariationPropertyValue('');
    setVariationPriceAmount('');
    setVariationPriceMode('percent_increase');
    onCompleted();
  };

  return (
    <>
      {/* Processing overlay */}
      {processing && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1400,
            p: 2,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            Islem devam ediyor...
          </Typography>
          <LinearProgress variant="determinate" value={progress} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            %{Math.round(progress)} tamamlandi
          </Typography>
        </Paper>
      )}

      {/* Main bar */}
      <Slide direction="up" in={visible} mountOnEnter unmountOnExit>
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1300,
            px: { xs: 1.5, md: 3 },
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            overflow: 'hidden',
            borderTop: '2px solid',
            borderColor: 'primary.main',
          }}
        >
          {/* Selected count */}
          <Chip
            label={isMobile ? `✓ ${selectedCount}` : `✓ ${selectedCount} seçildi`}
            color="primary"
            size="small"
            sx={{ fontWeight: 600, mr: 0.5, flexShrink: 0 }}
          />

          {/* Etiketler dropdown */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<LocalOfferOutlined />}
            endIcon={<KeyboardArrowDownIcon />}
            onClick={(e) => setTagsMenuAnchor(e.currentTarget)}
            sx={{ minHeight: 36, flexShrink: 0 }}
          >
            Etiketler
          </Button>
          <Menu
            anchorEl={tagsMenuAnchor}
            open={Boolean(tagsMenuAnchor)}
            onClose={() => setTagsMenuAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <MenuItem onClick={() => { setTagsMenuAnchor(null); setAddTagDialogOpen(true); }}>
              <ListItemIcon><LocalOfferOutlined fontSize="small" /></ListItemIcon>
              <ListItemText>Etiket Ekle</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setTagsMenuAnchor(null); setTagsToRemove(new Set()); setRemoveTagDialogOpen(true); }}>
              <ListItemIcon><RemoveCircleOutline fontSize="small" /></ListItemIcon>
              <ListItemText>Etiket Çıkar</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setTagsMenuAnchor(null); setSelectedSeason(null); setSeasonTagMode('add'); setSeasonDialogOpen(true); }}>
              <ListItemIcon><CelebrationIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Sezon Etiketi</ListItemText>
            </MenuItem>
          </Menu>

          {/* Fiyat dropdown */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<AttachMoneyOutlined />}
            endIcon={<KeyboardArrowDownIcon />}
            onClick={(e) => setPriceMenuAnchor(e.currentTarget)}
            sx={{ minHeight: 36, flexShrink: 0 }}
          >
            Fiyat
          </Button>
          <Menu
            anchorEl={priceMenuAnchor}
            open={Boolean(priceMenuAnchor)}
            onClose={() => setPriceMenuAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <MenuItem onClick={() => { setPriceMenuAnchor(null); setPriceDialogOpen(true); }}>
              <ListItemIcon><AttachMoneyOutlined fontSize="small" /></ListItemIcon>
              <ListItemText>Toplu Fiyat Değiştir</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setPriceMenuAnchor(null); setVariationPropertyName(''); setVariationPropertyValue(''); setVariationPriceAmount(''); setVariationPriceMode('percent_increase'); setVariationPriceDialogOpen(true); }}>
              <ListItemIcon><TuneOutlined fontSize="small" /></ListItemIcon>
              <ListItemText>Varyasyon Fiyat</ListItemText>
            </MenuItem>
          </Menu>

          {/* Yönetim dropdown - desktop only */}
          {!isMobile && (
            <>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DriveFileMoveOutlined />}
                endIcon={<KeyboardArrowDownIcon />}
                onClick={(e) => setManagementMenuAnchor(e.currentTarget)}
                sx={{ minHeight: 36, flexShrink: 0 }}
              >
                Yönetim
              </Button>
              <Menu
                anchorEl={managementMenuAnchor}
                open={Boolean(managementMenuAnchor)}
                onClose={() => setManagementMenuAnchor(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              >
                <MenuItem onClick={() => { setManagementMenuAnchor(null); handleToggleState('active'); }}>
                  <ListItemIcon><PublishOutlined fontSize="small" color="success" /></ListItemIcon>
                  <ListItemText>Yayınla</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setManagementMenuAnchor(null); handleToggleState('inactive'); }}>
                  <ListItemIcon><RemoveCircleOutline fontSize="small" color="warning" /></ListItemIcon>
                  <ListItemText>Deaktif Et</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setManagementMenuAnchor(null); setSectionDialogOpen(true); }}>
                  <ListItemIcon><DriveFileMoveOutlined fontSize="small" /></ListItemIcon>
                  <ListItemText>Bölüm Taşı</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setManagementMenuAnchor(null); setRenewDialogOpen(true); }}>
                  <ListItemIcon><RefreshOutlined fontSize="small" /></ListItemIcon>
                  <ListItemText>Toplu Yenile</ListItemText>
                </MenuItem>
                {otherShops.length > 0 && (
                  <MenuItem onClick={() => { setManagementMenuAnchor(null); setTargetShopId(''); setCopyDialogOpen(true); }}>
                    <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>Kopyala</ListItemText>
                  </MenuItem>
                )}
              </Menu>
            </>
          )}

          {/* AI dropdown - desktop only */}
          {!isMobile && (
            <>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AutoFixHigh />}
                endIcon={<KeyboardArrowDownIcon />}
                onClick={(e) => setAiMenuAnchor(e.currentTarget)}
                sx={{ minHeight: 36, flexShrink: 0 }}
              >
                AI
              </Button>
              <Menu
                anchorEl={aiMenuAnchor}
                open={Boolean(aiMenuAnchor)}
                onClose={() => setAiMenuAnchor(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              >
                <MenuItem onClick={() => { setAiMenuAnchor(null); setAiResult(null); setAiOptimizeDialogOpen(true); }}>
                  <ListItemIcon><AutoFixHigh fontSize="small" /></ListItemIcon>
                  <ListItemText>AI Optimize</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setAiMenuAnchor(null); setAltTextDialogOpen(true); }}>
                  <ListItemIcon><ImageOutlined fontSize="small" /></ListItemIcon>
                  <ListItemText>Toplu Alt Metin</ListItemText>
                </MenuItem>
              </Menu>
            </>
          )}

          {/* Mobile overflow button (⋯) - shows Yönetim + AI items */}
          {isMobile && (
            <IconButton
              size="small"
              onClick={() => setMobileDrawerOpen(true)}
              sx={{ minHeight: 36, minWidth: 36, flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
            >
              <MoreHorizIcon />
            </IconButton>
          )}

          {/* Sil button - always visible */}
          {isMobile ? (
            <IconButton
              size="small"
              color="error"
              onClick={() => setDeleteDialogOpen(true)}
              sx={{ minHeight: 36, minWidth: 36, flexShrink: 0, border: '1px solid', borderColor: 'error.main', borderRadius: 1, ml: 'auto' }}
            >
              <DeleteOutline />
            </IconButton>
          ) : (
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<DeleteOutline />}
              onClick={() => setDeleteDialogOpen(true)}
              sx={{ minHeight: 36, flexShrink: 0, ml: 'auto' }}
            >
              Sil
            </Button>
          )}
        </Paper>
      </Slide>

      {/* Mobile overflow drawer */}
      <SwipeableDrawer
        anchor="bottom"
        open={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        onOpen={() => setMobileDrawerOpen(true)}
        sx={{ zIndex: 1400 }}
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, pb: 2 } }}
      >
        <Box sx={{ width: 40, height: 4, bgcolor: 'grey.400', borderRadius: 2, mx: 'auto', mt: 1.5, mb: 1 }} />
        <List>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); handleToggleState('active'); }}>
              <ListItemIcon><PublishOutlined color="success" /></ListItemIcon>
              <ListItemText primary="Yayınla" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); handleToggleState('inactive'); }}>
              <ListItemIcon><RemoveCircleOutline color="warning" /></ListItemIcon>
              <ListItemText primary="Deaktif Et" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setSectionDialogOpen(true); }}>
              <ListItemIcon><DriveFileMoveOutlined /></ListItemIcon>
              <ListItemText primary="Bölüm Taşı" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setRenewDialogOpen(true); }}>
              <ListItemIcon><RefreshOutlined /></ListItemIcon>
              <ListItemText primary="Toplu Yenile" />
            </ListItemButton>
          </ListItem>
          {otherShops.length > 0 && (
            <ListItem disablePadding>
              <ListItemButton onClick={() => { setMobileDrawerOpen(false); setTargetShopId(''); setCopyDialogOpen(true); }}>
                <ListItemIcon><ContentCopyIcon /></ListItemIcon>
                <ListItemText primary="Kopyala" />
              </ListItemButton>
            </ListItem>
          )}
          <Divider sx={{ my: 1 }} />
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setAiResult(null); setAiOptimizeDialogOpen(true); }}>
              <ListItemIcon><AutoFixHigh /></ListItemIcon>
              <ListItemText primary="AI Optimize" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setAltTextDialogOpen(true); }}>
              <ListItemIcon><ImageOutlined /></ListItemIcon>
              <ListItemText primary="Toplu Alt Metin" />
            </ListItemButton>
          </ListItem>
        </List>
      </SwipeableDrawer>

      {/* ---- Price Dialog ---- */}
      <Dialog
        open={priceDialogOpen}
        onClose={() => setPriceDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Toplu Fiyat Degistir</DialogTitle>
        <DialogContent>
          <RadioGroup
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as PriceMode)}
          >
            <FormControlLabel
              value="percent_increase"
              control={<Radio />}
              label="% Artir"
            />
            <FormControlLabel
              value="percent_decrease"
              control={<Radio />}
              label="% Azalt"
            />
            <FormControlLabel
              value="fixed_add"
              control={<Radio />}
              label="Sabit tutar ekle"
            />
            <FormControlLabel
              value="fixed_subtract"
              control={<Radio />}
              label="Sabit tutar cikar"
            />
          </RadioGroup>

          <TextField
            label={
              priceMode.startsWith('percent') ? 'Yuzde (%)' : 'Tutar'
            }
            type="number"
            value={priceAmount}
            onChange={(e) => setPriceAmount(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
            inputProps={{ min: 0, step: 0.01 }}
          />

          {pricePreview.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Onizleme (ilk {pricePreview.length} listeleme)
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Listeleme</TableCell>
                      <TableCell align="right">Mevcut Fiyat</TableCell>
                      <TableCell align="right">Yeni Fiyat</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pricePreview.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{p.title}</TableCell>
                        <TableCell align="right">
                          {p.current.toFixed(2)} {p.currency}
                        </TableCell>
                        <TableCell align="right">
                          {p.newPrice.toFixed(2)} {p.currency}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPriceDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            onClick={handlePriceSubmit}
            disabled={!priceAmount || parseFloat(priceAmount) <= 0}
          >
            Uygula
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Add Tag Dialog ---- */}
      <Dialog
        open={addTagDialogOpen}
        onClose={() => setAddTagDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Toplu Etiket Ekle</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Virgul ile ayirarak birden fazla etiket ekleyebilirsiniz. Her
            listelemede en fazla 13 etiket olabilir.
          </Typography>
          <TextField
            label="Etiketler"
            placeholder="etiket1, etiket2, etiket3"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            fullWidth
            helperText={`${
              newTags
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t).length
            } etiket girildi`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddTagDialogOpen(false)}>Iptal</Button>
          <Button variant="contained" onClick={handleAddTagsSubmit}>
            Ekle
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Remove Tag Dialog ---- */}
      <Dialog
        open={removeTagDialogOpen}
        onClose={() => setRemoveTagDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Toplu Etiket Cikar</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Kaldirmak istediginiz etiketlere tiklayin.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {allUniqueTags.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Secilen listelemelerde etiket bulunamadi.
              </Typography>
            ) : (
              allUniqueTags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  onClick={() => toggleTagToRemove(tag)}
                  color={tagsToRemove.has(tag) ? 'error' : 'default'}
                  variant={tagsToRemove.has(tag) ? 'filled' : 'outlined'}
                />
              ))
            )}
          </Box>
          {tagsToRemove.size > 0 && (
            <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
              {tagsToRemove.size} etiket kaldirilacak
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTagDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleRemoveTagsSubmit}
            disabled={tagsToRemove.size === 0}
          >
            Kaldir
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Section Move Dialog ---- */}
      <Dialog
        open={sectionDialogOpen}
        onClose={() => setSectionDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Bolum Tasi</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Hedef Bolum</InputLabel>
            <Select
              value={targetSectionId}
              label="Hedef Bolum"
              onChange={(e) => setTargetSectionId(Number(e.target.value))}
            >
              {shopSections.map((section) => (
                <MenuItem key={section.shop_section_id} value={section.shop_section_id}>
                  {section.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSectionDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            onClick={handleSectionSubmit}
            disabled={targetSectionId === ''}
          >
            Tasi
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Delete Confirmation Dialog ---- */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Toplu Silme Onayi</DialogTitle>
        <DialogContent>
          <Typography>
            <strong>{selectedCount}</strong> listelemeyi silmek istediginize emin
            misiniz? Bu islem geri alinamaz.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Iptal</Button>
          <Button variant="contained" color="error" onClick={handleDeleteSubmit}>
            Sil
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- AI Optimize Dialog ---- */}
      <Dialog
        open={aiOptimizeDialogOpen}
        onClose={() => setAiOptimizeDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoFixHigh color="secondary" />
          AI ile Toplu Optimize Et
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            <strong>{selectedCount}</strong> listeleme secildi. AI tum baslik, etiket ve aciklamalari SEO icin optimize edecek.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Optimize edilecekler:
          </Typography>
          <Box sx={{ pl: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              - Basliklar (SEO uyumlu yeniden yapilandirilacak)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              - Etiketler (arama hacmine gore optimize edilecek)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              - Aciklamalar (AI tarafindan olusturulacak)
            </Typography>
          </Box>
          <Typography variant="caption" color="warning.main">
            Bu islem mevcut baslik, etiket ve aciklamalarin uzerine yazacaktir.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiOptimizeDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            color="secondary"
            startIcon={<AutoFixHigh />}
            onClick={handleAiOptimizeSubmit}
          >
            Optimize Et
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Copy to Shop Dialog ---- */}
      <Dialog
        open={copyDialogOpen}
        onClose={() => setCopyDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ContentCopyIcon />
          Baska Magazaya Kopyala
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            <strong>{selectedCount}</strong> listeleme secili. Kopyalanacak hedef magazayi secin.
          </Typography>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Hedef Magaza</InputLabel>
            <Select
              value={targetShopId}
              label="Hedef Magaza"
              onChange={(e) => setTargetShopId(e.target.value as string)}
            >
              {otherShops.map((s) => (
                <MenuItem key={s.shopId} value={s.shopId}>
                  {s.shopName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopyDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            onClick={handleCopySubmit}
            disabled={!targetShopId}
            startIcon={<ContentCopyIcon />}
          >
            Kopyala
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Alt Text Confirmation Dialog ---- */}
      <Dialog
        open={altTextDialogOpen}
        onClose={() => setAltTextDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ImageOutlined color="info" />
          Toplu Alt Metin Olustur
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Secili <strong>{selectedCount}</strong> listing icin tum gorsellere AI ile alt metin olusturulsun mu?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Her listeleme icin:
          </Typography>
          <Box sx={{ pl: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              - Baslik bilgisinden AI ile alt metin uretilecek
            </Typography>
            <Typography variant="body2" color="text.secondary">
              - Tum gorsel alt metinleri guncellenecek
            </Typography>
          </Box>
          <Typography variant="caption" color="warning.main">
            Bu islem mevcut alt metinlerin uzerine yazacaktir.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAltTextDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            color="info"
            startIcon={<ImageOutlined />}
            onClick={handleAltTextSubmit}
          >
            Alt Metin Olustur
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Renew Confirmation Dialog ---- */}
      <Dialog
        open={renewDialogOpen}
        onClose={() => setRenewDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <RefreshOutlined color="success" />
          Toplu Yenile
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            Secili <strong>{selectedCount}</strong> listelemeyi yenilemek istediginize emin misiniz?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Suresi dolmus listelemeleri yeniden aktif hale getirir.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenewDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<RefreshOutlined />}
            onClick={handleRenewSubmit}
          >
            Yenile
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Season Tags Dialog ---- */}
      <Dialog
        open={seasonDialogOpen}
        onClose={() => setSeasonDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CelebrationIcon color="secondary" />
          Sezon Etiketi
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Bir sezon secin ve etiketleri secili <strong>{selectedCount}</strong> listelemeye uygulayin.
          </Typography>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Mod
            </Typography>
            <ToggleButtonGroup
              value={seasonTagMode}
              exclusive
              onChange={(_, val) => { if (val) setSeasonTagMode(val); }}
              size="small"
              fullWidth
            >
              <ToggleButton value="add">Ekle (mevcut etiketlere ekler)</ToggleButton>
              <ToggleButton value="replace">Degistir (tum etiketleri degistirir)</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Sezon Secin
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {SEASON_PRESETS.map((preset) => (
              <Paper
                key={preset.label}
                variant="outlined"
                onClick={() => setSelectedSeason(preset)}
                sx={{
                  p: 1.5,
                  cursor: 'pointer',
                  borderColor: selectedSeason?.label === preset.label ? 'primary.main' : 'divider',
                  borderWidth: selectedSeason?.label === preset.label ? 2 : 1,
                  bgcolor: selectedSeason?.label === preset.label ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Typography variant="subtitle2">{preset.label}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {preset.tags.map((tag) => (
                    <Chip key={tag} label={tag} size="small" variant="outlined" />
                  ))}
                </Box>
              </Paper>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSeasonDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleSeasonTagsSubmit}
            disabled={!selectedSeason}
            startIcon={<CelebrationIcon />}
          >
            {seasonTagMode === 'add' ? 'Ekle' : 'Degistir'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Variation Price Dialog ---- */}
      <Dialog
        open={variationPriceDialogOpen}
        onClose={() => setVariationPriceDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TuneOutlined />
          Varyasyon Fiyat Degistir
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Belirli bir varyasyon degerine sahip urunlerin fiyatini toplu olarak degistirin. Ornegin sadece "Small" beden urunlerin fiyatini artirin.
          </Typography>

          <TextField
            label="Varyasyon Ozellik Adi"
            placeholder="Orn: Size, Color, Material"
            value={variationPropertyName}
            onChange={(e) => setVariationPropertyName(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
          />

          <TextField
            label="Varyasyon Degeri"
            placeholder="Orn: Small, Red, Cotton"
            value={variationPropertyValue}
            onChange={(e) => setVariationPropertyValue(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
          />

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Fiyat Ayarlamasi
          </Typography>
          <RadioGroup
            value={variationPriceMode}
            onChange={(e) => setVariationPriceMode(e.target.value as VariationPriceMode)}
          >
            <FormControlLabel value="percent_increase" control={<Radio />} label="% Artir" />
            <FormControlLabel value="percent_decrease" control={<Radio />} label="% Azalt" />
            <FormControlLabel value="fixed_add" control={<Radio />} label="Sabit tutar ekle" />
            <FormControlLabel value="fixed_subtract" control={<Radio />} label="Sabit tutar cikar" />
          </RadioGroup>

          <TextField
            label={variationPriceMode.startsWith('percent') ? 'Yuzde (%)' : 'Tutar'}
            type="number"
            value={variationPriceAmount}
            onChange={(e) => setVariationPriceAmount(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
            inputProps={{ min: 0, step: 0.01 }}
          />

          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Eslesmeyen listelemelerde degisiklik yapilmayacaktir.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVariationPriceDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            onClick={handleVariationPriceSubmit}
            disabled={
              !variationPropertyName.trim() ||
              !variationPropertyValue.trim() ||
              !variationPriceAmount ||
              parseFloat(variationPriceAmount) <= 0
            }
            startIcon={<TuneOutlined />}
          >
            Uygula
          </Button>
        </DialogActions>
      </Dialog>

      {/* Variation Price Processing overlay */}
      {variationProcessing && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1400,
            p: 2,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            Varyasyon fiyatlari guncelleniyor...
          </Typography>
          <LinearProgress variant="determinate" value={variationProgress} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            %{Math.round(variationProgress)} tamamlandi
          </Typography>
        </Paper>
      )}

      {/* Alt Text Processing overlay */}
      {altTextProcessing && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1400,
            p: 2,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            AI ile alt metinler olusturuluyor...
          </Typography>
          <LinearProgress variant="determinate" value={altTextProgress} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            %{Math.round(altTextProgress)} tamamlandi
          </Typography>
        </Paper>
      )}

      {/* Renew Processing overlay */}
      {renewProcessing && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1400,
            p: 2,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            Listeler yenileniyor...
          </Typography>
          <LinearProgress variant="determinate" value={renewProgress} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            %{Math.round(renewProgress)} tamamlandi
          </Typography>
        </Paper>
      )}

      {/* Copy Processing overlay */}
      {copyProcessing && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1400,
            p: 2,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            Listeler kopyalaniyor...
          </Typography>
          <LinearProgress variant="determinate" value={copyProgress} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            %{Math.round(copyProgress)} tamamlandi
          </Typography>
        </Paper>
      )}

      {/* AI Processing overlay */}
      {aiProcessing && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1400,
            p: 2,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            AI optimizasyonu uygulanıyor...
          </Typography>
          <LinearProgress variant="determinate" value={aiProgress} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            %{Math.round(aiProgress)} tamamlandi
          </Typography>
        </Paper>
      )}
    </>
  );
}
