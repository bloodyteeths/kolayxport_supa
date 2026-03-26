import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Tooltip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  IconButton,
  Typography,
  Paper,
  Chip,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
} from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridPaginationModel,
  GridRenderCellParams,
  GridRowSelectionModel,
  GridRowId,
} from '@mui/x-data-grid';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  FavoriteBorder as FavoriteBorderIcon,
  UploadFile as UploadFileIcon,
  Warning as WarningIcon,
  ErrorOutline as ErrorOutlineIcon,
  RemoveCircleOutline as RemoveCircleOutlineIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';

import SEOIndicator from '@/components/etsy/SEOIndicator';
import ListingEditorDrawer from '@/components/etsy/ListingEditorDrawer';
import ListingCreatorDialog from '@/components/etsy/ListingCreatorDialog';
import FindReplaceDialog from '@/components/etsy/FindReplaceDialog';
import BulkOperationsBar from '@/components/etsy/BulkOperationsBar';
import SmartPricing from '@/components/etsy/SmartPricing';
import DuplicateDetector from '@/components/etsy/DuplicateDetector';
import BackupManager from '@/components/etsy/BackupManager';
import EtsyMarketResearch, { MarketResearchData } from '@/components/etsy/MarketResearch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EtsyListingRow {
  id: number;
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  price: { amount: number; divisor: number; currency_code: string } | null;
  views: number;
  num_favorers: number;
  quantity: number;
  state: string;
  url: string;
  taxonomy_id: number | null;
  shop_section_id: number | null;
  who_made: string;
  when_made: string;
  is_supply: boolean;
  created_timestamp: number;
  updated_timestamp: number;
  thumbnail: {
    listing_image_id: number;
    url_75x75: string;
    url_170x135: string;
    url_570xN: string;
  } | null;
  image_count: number;
  has_video: boolean;
}

interface ShopInfo {
  shopId: string;
  shopName: string;
  isActive: boolean;
}

interface ShopSection {
  shop_section_id: number;
  title: string;
}

interface ShippingProfile {
  shipping_profile_id: number;
  title: string;
}

interface ReturnPolicy {
  return_policy_id: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return '—';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear().toString().slice(-2)}`;
  } catch {
    return '—';
  }
}

function formatPrice(price: EtsyListingRow['price']): string {
  if (!price) return '—';
  const value = price.amount / price.divisor;
  const symbol =
    price.currency_code === 'USD'
      ? '$'
      : price.currency_code === 'EUR'
        ? '€'
        : price.currency_code === 'GBP'
          ? '£'
          : price.currency_code === 'TRY'
            ? '₺'
            : price.currency_code + ' ';
  return `${symbol}${value.toFixed(2)}`;
}

const STATE_COLORS: Record<string, 'success' | 'default' | 'error' | 'warning'> = {
  active: 'success',
  draft: 'default',
  inactive: 'error',
  expired: 'warning',
};

const STATE_LABELS: Record<string, string> = {
  active: 'Aktif',
  draft: 'Taslak',
  inactive: 'Deaktif',
  expired: 'Sür. Dolmuş',
};

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

interface HealthBreakdown {
  tags: { score: number; color: string; label: string };
  images: { score: number; color: string; label: string };
  title: { score: number; color: string; label: string };
  description: { score: number; color: string; label: string };
  overall: number;
  color: string;
}

function calculateHealth(listing: EtsyListingRow): HealthBreakdown {
  // Tags: 13/13 = green(25), 10-12 = yellow(15), <10 = red(5)
  const tagCount = listing.tags?.length || 0;
  const tagsScore = tagCount >= 13 ? 25 : tagCount >= 10 ? 15 : 5;
  const tagsColor = tagCount >= 13 ? '#4caf50' : tagCount >= 10 ? '#ff9800' : '#f44336';
  const tagsLabel = `${tagCount}/13 etiket`;

  // Images: 10+ = green(25), 5-9 = yellow(15), <5 = red(5)
  const imgCount = listing.image_count || 0;
  const imagesScore = imgCount >= 10 ? 25 : imgCount >= 5 ? 15 : 5;
  const imagesColor = imgCount >= 10 ? '#4caf50' : imgCount >= 5 ? '#ff9800' : '#f44336';
  const imagesLabel = `${imgCount} resim`;

  // Title: 100+ = green(25), 60-99 = yellow(15), <60 = red(5)
  const titleLen = listing.title?.length || 0;
  const titleScore = titleLen >= 100 ? 25 : titleLen >= 60 ? 15 : 5;
  const titleColor = titleLen >= 100 ? '#4caf50' : titleLen >= 60 ? '#ff9800' : '#f44336';
  const titleLabel = `${titleLen} karakter başlık`;

  // Description: 500+ = green(25), 200-499 = yellow(15), <200 = red(5)
  const descLen = listing.description?.length || 0;
  const descScore = descLen >= 500 ? 25 : descLen >= 200 ? 15 : 5;
  const descColor = descLen >= 500 ? '#4caf50' : descLen >= 200 ? '#ff9800' : '#f44336';
  const descLabel = `${descLen} karakter açıklama`;

  const overall = tagsScore + imagesScore + titleScore + descScore;
  const color = overall >= 80 ? '#4caf50' : overall >= 60 ? '#ff9800' : '#f44336';

  return {
    tags: { score: tagsScore, color: tagsColor, label: tagsLabel },
    images: { score: imagesScore, color: imagesColor, label: imagesLabel },
    title: { score: titleScore, color: titleColor, label: titleLabel },
    description: { score: descScore, color: descColor, label: descLabel },
    overall,
    color,
  };
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

function EtsyListingsPage() {
  const { user } = useAuth();

  // --- State ---
  const [listings, setListings] = useState<EtsyListingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // In-memory cache: avoid re-fetching when switching back to same shop+status
  const listingsCacheRef = useRef<Record<string, { listings: EtsyListingRow[]; total: number; ts: number }>>({});

  const [selectedIds, setSelectedIds] = useState<GridRowSelectionModel>({ type: 'include' as const, ids: new Set<GridRowId>() });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'draft' | 'inactive' | 'expired'>('active');
  const [sectionFilter, setSectionFilter] = useState<string>('');
  const [healthFilter, setHealthFilter] = useState<string>('');
  const [excludeTerm, setExcludeTerm] = useState('');

  const [drawerListingId, setDrawerListingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [smartPricingOpen, setSmartPricingOpen] = useState(false);
  const [duplicateDetectorOpen, setDuplicateDetectorOpen] = useState(false);
  const [backupManagerOpen, setBackupManagerOpen] = useState(false);
  const [pageTab, setPageTab] = useState(0);
  const [marketResearchData, setMarketResearchData] = useState<MarketResearchData | null>(null);

  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string>('');
  const selectedShopIdRef = useRef<string>('');
  selectedShopIdRef.current = selectedShopId;
  const [shopSections, setShopSections] = useState<ShopSection[]>([]);
  const [shippingProfiles, setShippingProfiles] = useState<ShippingProfile[]>([]);
  const [returnPolicies, setReturnPolicies] = useState<ReturnPolicy[]>([]);

  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // CSV Import state
  const [csvImportDialogOpen, setCsvImportDialogOpen] = useState(false);
  const [csvImportRows, setCsvImportRows] = useState<Record<string, string>[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportProgress, setCsvImportProgress] = useState(0);

  // --- Fetch shops via API ---
  useEffect(() => {
    if (!(user as any)?.id) return;
    (async () => {
      try {
        const res = await fetch('/api/integrations/etsy/shops');
        if (!res.ok) {
          console.error('Failed to fetch Etsy shops:', res.status);
          return;
        }
        const data = await res.json();
        const shopList: ShopInfo[] = (data.shops || []).map((s: any) => ({
          shopId: s.shopId,
          shopName: s.shopName || s.shopId,
          isActive: s.isActive,
        }));
        setShops(shopList);
        if (shopList.length > 0 && !selectedShopId) {
          setSelectedShopId(shopList[0].shopId);
        }
      } catch (err) {
        console.error('Failed to fetch Etsy shops:', err);
      }
    })();
  }, [(user as any)?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Fetch listings ---
  const mapListing = (l: any): EtsyListingRow => {
    // Backend already extracts thumbnail; also handle raw images array as fallback
    const thumb = l.thumbnail || (l.images?.[0] ? {
      listing_image_id: l.images[0].listing_image_id,
      url_75x75: l.images[0].url_75x75,
      url_170x135: l.images[0].url_170x135,
      url_570xN: l.images[0].url_570xN,
    } : null);
    return {
      id: l.listing_id,
      listing_id: l.listing_id,
      title: l.title || '',
      description: l.description || '',
      tags: l.tags || [],
      materials: l.materials || [],
      price: l.price || null,
      views: l.views || 0,
      num_favorers: l.num_favorers || 0,
      quantity: l.quantity || 0,
      state: l.state || 'draft',
      url: l.url || '',
      taxonomy_id: l.taxonomy_id || null,
      shop_section_id: l.shop_section_id || null,
      who_made: l.who_made || '',
      when_made: l.when_made || '',
      is_supply: l.is_supply || false,
      created_timestamp: l.created_timestamp || 0,
      updated_timestamp: l.updated_timestamp || 0,
      thumbnail: thumb,
      image_count: l.image_count || (l.images ? l.images.length : 0),
      has_video: l.has_video || false,
    };
  };

  const fetchListings = useCallback(async () => {
    if (!selectedShopId) return;

    // Check in-memory cache (5 min TTL)
    const cacheKey = `${selectedShopId}:${statusFilter}`;
    const cached = listingsCacheRef.current[cacheKey];
    if (cached && Date.now() - cached.ts < 300_000) {
      setListings(cached.listings);
      setTotalCount(cached.total);
      return;
    }

    setLoading(true);
    try {
      const limit = 100;
      const cacheBust = Date.now();
      const buildUrl = (offset: number) =>
        `/api/clawd/etsy?action=listings_with_images&shop_id=${selectedShopId}&limit=${limit}&offset=${offset}&state=${statusFilter}&_t=${cacheBust}`;

      // First page — show immediately
      const firstRes = await fetch(buildUrl(0));
      if (!firstRes.ok) {
        const errData = await firstRes.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${firstRes.status}`);
      }
      const firstData = await firstRes.json();
      const total = firstData.count || 0;
      const firstResults: any[] = firstData.listings || firstData.results || [];
      const firstRows: EtsyListingRow[] = firstResults.map(mapListing);

      // Show first page immediately so user sees data fast
      setListings(firstRows);
      setTotalCount(total || firstRows.length);
      setLoading(false);

      // Fetch remaining pages in background
      if (total > limit) {
        setLoadingMore(true);
        const remainingPages = Math.ceil((total - limit) / limit);
        // Batch in groups of 5 to avoid overwhelming Etsy rate limits
        const allRows = [...firstRows];
        for (let batch = 0; batch < remainingPages; batch += 5) {
          const batchSize = Math.min(5, remainingPages - batch);
          const fetches = Array.from({ length: batchSize }, (_, i) =>
            fetch(buildUrl((batch + i + 1) * limit)).then(async (res) => {
              if (!res.ok) return [];
              const data = await res.json();
              return (data.listings || data.results || []).map(mapListing);
            })
          );
          const pages = await Promise.all(fetches);
          pages.forEach((rows) => allRows.push(...rows));
          // Update UI progressively after each batch
          setListings([...allRows]);
        }
        setLoadingMore(false);

        // Cache the full result
        listingsCacheRef.current[cacheKey] = { listings: allRows, total, ts: Date.now() };
      } else {
        // Cache single-page result
        listingsCacheRef.current[cacheKey] = { listings: firstRows, total, ts: Date.now() };
      }
    } catch (err: any) {
      console.error('Failed to fetch listings:', err);
      toast.error(`Listing'lar yüklenemedi: ${err.message}`);
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedShopId, statusFilter]);

  // --- Fetch shop metadata (sections, shipping profiles, return policies) ---
  const fetchShopMeta = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const [sectionsRes, shippingRes, returnRes] = await Promise.all([
        fetch(`/api/clawd/etsy?action=get_shop_sections&shop_id=${selectedShopId}`),
        fetch(`/api/clawd/etsy?action=get_shipping_profiles&shop_id=${selectedShopId}`),
        fetch(`/api/clawd/etsy?action=get_return_policies&shop_id=${selectedShopId}`),
      ]);

      if (sectionsRes.ok) {
        const d = await sectionsRes.json();
        setShopSections(d.shop_sections || d.results || []);
      }
      if (shippingRes.ok) {
        const d = await shippingRes.json();
        setShippingProfiles(d.shipping_profiles || d.results || []);
      }
      if (returnRes.ok) {
        const d = await returnRes.json();
        setReturnPolicies(d.return_policies || d.results || []);
      }
    } catch (err) {
      console.error('Failed to fetch shop metadata:', err);
    }
  }, [selectedShopId]);

  useEffect(() => {
    if (selectedShopId) {
      fetchListings();
      fetchShopMeta();
    }
  }, [selectedShopId, statusFilter, fetchListings, fetchShopMeta]);

  // Reset pagination to page 0 when filters change
  useEffect(() => {
    setPaginationModel((prev) => (prev.page !== 0 ? { ...prev, page: 0 } : prev));
  }, [searchTerm, sectionFilter, excludeTerm, healthFilter]);

  // Pre-compute health scores to avoid recalculating per filter toggle
  const healthMap = useMemo(() => {
    const map = new Map<number, ReturnType<typeof calculateHealth>>();
    listings.forEach((l) => map.set(l.listing_id, calculateHealth(l)));
    return map;
  }, [listings]);

  // --- Client-side filtering ---
  const filteredListings = useMemo(() => {
    let result = listings;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter((l) => l.title.toLowerCase().includes(term));
    }
    if (sectionFilter) {
      const secId = Number(sectionFilter);
      result = result.filter((l) => l.shop_section_id === secId);
    }
    if (excludeTerm.trim()) {
      const exc = excludeTerm.toLowerCase();
      result = result.filter((l) => {
        const title = (l.title || '').toLowerCase();
        const desc = (l.description || '').toLowerCase();
        const tags = (l.tags || []).join(' ').toLowerCase();
        return !title.includes(exc) && !desc.includes(exc) && !tags.includes(exc);
      });
    }
    if (healthFilter) {
      result = result.filter((l) => {
        const h = healthMap.get(l.listing_id) || calculateHealth(l);
        switch (healthFilter) {
          case 'issues': return h.overall < 70;
          case 'missing_images': return l.image_count < 10;
          case 'missing_tags': return (l.tags?.length || 0) < 13;
          case 'short_title': return (l.title?.length || 0) < 100;
          case 'no_description': return (l.description?.length || 0) < 200;
          case 'no_video': return !l.has_video;
          case 'no_stock': return l.quantity === 0;
          default: return true;
        }
      });
    }
    return result;
  }, [listings, searchTerm, sectionFilter, excludeTerm, healthFilter, healthMap]);

  // --- Delete listing ---
  const handleDeleteListing = useCallback(
    async (listingId: number) => {
      try {
        const res = await fetch(
          `/api/clawd/etsy?action=delete_listing&listing_id=${listingId}&shop_id=${selectedShopId}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error || `HTTP ${res.status}`;
          // If Etsy says listing is already removed, treat as success
          if (res.status === 403 && errMsg.includes('removed')) {
            // Already deleted on Etsy — just remove from our UI
          } else {
            throw new Error(errMsg);
          }
        }
        toast.success('Listing silindi');
        setDeleteConfirmId(null);
        // Remove from local state immediately
        setListings((prev) => prev.filter((l) => l.listing_id !== listingId));
        setTotalCount((prev) => Math.max(0, prev - 1));
        // Invalidate cache so it doesn't reappear on next fetch
        const cacheKey = `${selectedShopId}:${statusFilter}`;
        delete listingsCacheRef.current[cacheKey];
      } catch (err: any) {
        toast.error(`Silinemedi: ${err.message}`);
      }
    },
    [selectedShopId, statusFilter]
  );

  // --- CSV Export ---
  const handleExportCSV = () => {
    if (filteredListings.length === 0) {
      toast.error('Disa aktarilacak listing yok');
      return;
    }
    const rows = filteredListings.map((l) => ({
      listing_id: l.listing_id,
      title: l.title,
      description: l.description.substring(0, 200),
      tags: l.tags.join('|'),
      price: l.price ? (l.price.amount / l.price.divisor).toFixed(2) : '',
      quantity: l.quantity,
      views: l.views,
      favorites: l.num_favorers,
      state: l.state,
      url: l.url,
    }));
    const headers = Object.keys(rows[0] || {}).join(',');
    const csv = [
      headers,
      ...rows.map((r) =>
        Object.values(r)
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etsy-listings-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- CSV Import ---
  const parseCSV = (text: string): Record<string, string>[] => {
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length < 2) return [];

    // Parse header
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') {
            current += '"';
            i++;
          } else if (ch === '"') {
            inQuotes = false;
          } else {
            current += ch;
          }
        } else {
          if (ch === '"') {
            inQuotes = true;
          } else if (ch === ',') {
            result.push(current);
            current = '';
          } else {
            current += ch;
          }
        }
      }
      result.push(current);
      return result;
    };

    const headers = parseCSVLine(lines[0]);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h.trim()] = (values[idx] || '').trim();
      });
      rows.push(row);
    }
    return rows;
  };

  const handleCSVFileSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const rows = parseCSV(text);
        if (rows.length === 0) {
          toast.error('CSV dosyasi bos veya gecersiz format');
          return;
        }
        // Only keep rows that have a listing_id
        const validRows = rows.filter((r) => r.listing_id && r.listing_id.trim() !== '');
        if (validRows.length === 0) {
          toast.error('CSV dosyasinda listing_id sutunu bulunamadi');
          return;
        }
        setCsvImportRows(validRows);
        setCsvImportDialogOpen(true);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleCSVImportConfirm = async () => {
    setCsvImporting(true);
    setCsvImportProgress(0);

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < csvImportRows.length; i++) {
      const row = csvImportRows[i];
      const listingId = parseInt(row.listing_id, 10);
      if (isNaN(listingId)) {
        failed++;
        continue;
      }

      const body: Record<string, any> = {};
      if (row.title !== undefined && row.title !== '') body.title = row.title;
      if (row.description !== undefined && row.description !== '') body.description = row.description;
      if (row.tags !== undefined && row.tags !== '') body.tags = row.tags.split('|').map((t: string) => t.trim()).filter(Boolean);
      if (row.materials !== undefined && row.materials !== '') body.materials = row.materials.split('|').map((m: string) => m.trim()).filter(Boolean);
      if (row.price !== undefined && row.price !== '') body.price = parseFloat(row.price);
      if (row.quantity !== undefined && row.quantity !== '') body.quantity = parseInt(row.quantity, 10);
      if (row.state !== undefined && row.state !== '') body.state = row.state;

      if (Object.keys(body).length === 0) {
        failed++;
        setCsvImportProgress(((i + 1) / csvImportRows.length) * 100);
        continue;
      }

      try {
        const res = await fetch(
          `/api/clawd/etsy?action=update_listing&listing_id=${listingId}&shop_id=${selectedShopId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );
        if (res.ok) succeeded++;
        else failed++;
      } catch {
        failed++;
      }

      setCsvImportProgress(((i + 1) / csvImportRows.length) * 100);

      // Rate limit: 1 update per 100ms
      if (i < csvImportRows.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    setCsvImporting(false);
    setCsvImportProgress(0);
    setCsvImportDialogOpen(false);
    setCsvImportRows([]);

    if (failed === 0) {
      toast.success(`CSV import tamamlandi: ${succeeded} listing guncellendi`);
    } else {
      toast.error(`CSV import: ${succeeded} basarili, ${failed} basarisiz`);
    }

    fetchListings();
  };

  // --- Open editor drawer ---
  const handleOpenEditor = (listingId: number) => {
    setDrawerListingId(String(listingId));
    setDrawerOpen(true);
  };

  // --- Copy listing → create draft on Etsy, then open Editor Drawer ---
  const handleCopyListing = async (listingId: number) => {
    const shopId = selectedShopIdRef.current;
    if (!shopId) return;
    const toastId = toast.loading('Kopya oluşturuluyor...');
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=copy_listing&shop_id=${shopId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_listing_id: listingId }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Invalidate cache so draft view shows the new listing
      const draftCacheKey = `${shopId}:draft`;
      delete listingsCacheRef.current[draftCacheKey];

      // Open drawer immediately so user sees the listing
      setDrawerListingId(String(data.new_listing_id));
      setDrawerOpen(true);

      // Copy images in background, then refresh drawer
      const sourceImages: Array<{ url_fullxfull: string; rank: number }> = data.source_images || [];
      if (sourceImages.length > 0) {
        toast.loading(`Görseller kopyalanıyor (0/${sourceImages.length})...`, { id: toastId });
        let copied = 0;
        for (const img of sourceImages.sort((a, b) => (a.rank || 1) - (b.rank || 1))) {
          if (!img.url_fullxfull) continue;
          try {
            const uploadRes = await fetch(
              `/api/clawd/etsy?action=upload_image&listing_id=${data.new_listing_id}&shop_id=${shopId}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_url: img.url_fullxfull, rank: img.rank || 1, overwrite: false }),
              }
            );
            if (!uploadRes.ok) {
              const errData = await uploadRes.json().catch(() => ({}));
              console.warn(`Image copy rank ${img.rank} failed:`, errData);
              continue;
            }
            copied++;
            toast.loading(`Görseller kopyalanıyor (${copied}/${sourceImages.length})...`, { id: toastId });
          } catch { /* skip failed image */ }
        }
        // Refresh drawer to show newly uploaded images
        setDrawerRefreshKey((k) => k + 1);
        toast.success(`Kopya tamamlandı — ${copied} görsel kopyalandı`, { id: toastId });
      } else {
        toast.success('Kopya oluşturuldu', { id: toastId });
      }
    } catch (err: any) {
      toast.error(err.message || 'Kopyalama başarısız', { id: toastId });
    }
  };

  // --- Selected listing objects for bulk operations ---
  const selectedListings = useMemo(() => {
    const idSet = 'ids' in selectedIds ? selectedIds.ids : new Set<GridRowId>();
    return filteredListings
      .filter((l) => idSet.has(l.id))
      .map((l) => ({
        listing_id: l.listing_id,
        title: l.title,
        price: l.price,
        tags: l.tags,
        state: l.state,
        shop_section_id: l.shop_section_id,
      }));
  }, [selectedIds, filteredListings]);

  // --- DataGrid Columns ---
  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'thumbnail',
        headerName: '',
        width: 90,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const thumb = params.row.thumbnail;
          return thumb ? (
            <Box
              component="img"
              src={thumb.url_170x135}
              alt=""
              loading="lazy"
              sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1 }}
            />
          ) : (
            <Box
              sx={{
                width: 72,
                height: 72,
                borderRadius: 1,
                backgroundColor: '#f5f5f5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography variant="caption" color="text.disabled">
                N/A
              </Typography>
            </Box>
          );
        },
      },
      {
        field: 'title',
        headerName: 'Başlık',
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Tooltip title={params.row.title} arrow>
            <Typography
              variant="body2"
              sx={{
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { color: 'primary.main', textDecoration: 'underline' },
              }}
              onClick={() => handleOpenEditor(params.row.listing_id)}
            >
              {params.row.title}
            </Typography>
          </Tooltip>
        ),
      },
      {
        field: 'price',
        headerName: 'Fiyat',
        width: 100,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Typography variant="body2">{formatPrice(params.row.price)}</Typography>
        ),
        sortComparator: (v1: any, v2: any, p1: any, p2: any) => {
          const a = p1.api.getRow(p1.id)?.price;
          const b = p2.api.getRow(p2.id)?.price;
          const av = a ? a.amount / a.divisor : 0;
          const bv = b ? b.amount / b.divisor : 0;
          return av - bv;
        },
      },
      {
        field: 'quantity',
        headerName: 'Stok',
        width: 80,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const qty = params.row.quantity;
          const color = qty === 0 ? 'error' : qty < 5 ? 'warning' : 'success';
          return <Chip label={qty} size="small" color={color} variant="outlined" />;
        },
      },
      {
        field: 'tags',
        headerName: 'Etiketler',
        width: 90,
        sortable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const count = params.row.tags?.length || 0;
          const color = count >= 10 ? 'success' : count >= 5 ? 'warning' : 'error';
          return (
            <Tooltip title={params.row.tags?.join(', ') || 'Etiket yok'} arrow>
              <Chip label={`${count}/13`} size="small" color={color} variant="outlined" />
            </Tooltip>
          );
        },
      },
      {
        field: 'seo',
        headerName: 'SEO',
        width: 60,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <SEOIndicator
            tags={params.row.tags || []}
            title={params.row.title || ''}
            description={params.row.description || ''}
            compact
          />
        ),
      },
      {
        field: 'health',
        headerName: 'Sağlık',
        width: 70,
        sortable: true,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => {
          const h = calculateHealth(params.row);
          return (
            <Tooltip
              arrow
              title={
                <Box sx={{ fontSize: 12 }}>
                  <Box sx={{ fontWeight: 700, mb: 0.5 }}>Sağlık Skoru: {h.overall}/100</Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.tags.color }} />
                    {h.tags.label}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.images.color }} />
                    {h.images.label}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.title.color }} />
                    {h.title.label}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: h.description.color }} />
                    {h.description.label}
                  </Box>
                </Box>
              }
            >
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: `3px solid ${h.color}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11, color: h.color }}>
                  {h.overall}
                </Typography>
              </Box>
            </Tooltip>
          );
        },
        sortComparator: (v1: any, v2: any, p1: any, p2: any) => {
          const a = calculateHealth(p1.api.getRow(p1.id) as EtsyListingRow);
          const b = calculateHealth(p2.api.getRow(p2.id) as EtsyListingRow);
          return a.overall - b.overall;
        },
      },
      {
        field: 'views',
        headerName: 'Görüntü',
        width: 80,
        type: 'number',
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Typography variant="body2">{params.row.views.toLocaleString()}</Typography>
        ),
      },
      {
        field: 'num_favorers',
        headerName: 'Favori',
        width: 80,
        type: 'number',
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FavoriteBorderIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography variant="body2">{params.row.num_favorers.toLocaleString()}</Typography>
          </Box>
        ),
      },
      {
        field: 'state',
        headerName: 'Durum',
        width: 100,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Chip
            label={STATE_LABELS[params.row.state] || params.row.state}
            size="small"
            color={STATE_COLORS[params.row.state] || 'default'}
          />
        ),
      },
      {
        field: 'updated_timestamp',
        headerName: 'Güncelleme',
        width: 100,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Typography variant="body2" color="text.secondary">
            {formatTimestamp(params.row.updated_timestamp)}
          </Typography>
        ),
      },
      {
        field: 'actions',
        headerName: '',
        width: 120,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<EtsyListingRow>) => (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Düzenle" arrow>
              <IconButton size="small" onClick={() => handleOpenEditor(params.row.listing_id)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Kopyala (taslak)" arrow>
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => handleCopyListing(params.row.listing_id)}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Sil" arrow>
              <IconButton
                size="small"
                color="error"
                onClick={() => setDeleteConfirmId(params.row.listing_id)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
    ],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // --- Column visibility for mobile ---
  const [columnVisibilityModel, setColumnVisibilityModel] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handleResize = () => {
      const isSmall = window.innerWidth < 768;
      setColumnVisibilityModel(
        isSmall
          ? {
              tags: false,
              seo: false,
              health: false,
              views: false,
              num_favorers: false,
              updated_timestamp: false,
              state: false,
            }
          : {}
      );
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Statistics ---
  const totalViews = useMemo(() => listings.reduce((s, l) => s + l.views, 0), [listings]);
  const totalFavorites = useMemo(() => listings.reduce((s, l) => s + l.num_favorers, 0), [listings]);
  const outOfStock = useMemo(() => listings.filter((l) => l.quantity === 0).length, [listings]);
  const needsAttention = useMemo(() => listings.filter((l) => calculateHealth(l).overall < 70).length, [listings]);

  return (
    <Box sx={{ p: { xs: 1, sm: 2, md: 3 }, maxWidth: 1600, mx: 'auto' }}>
      <Toaster position="top-right" />

      {/* Page Tabs */}
      <Tabs value={pageTab} onChange={(_, v) => setPageTab(v)} sx={{ mb: 2 }}>
        <Tab label="Listelemeler" />
        <Tab label="Pazar Arastirmasi" />
      </Tabs>

      {pageTab === 1 && (
        <EtsyMarketResearch
          userId={(user as any)?.id || ''}
          shopId={selectedShopId}
          userListings={listings}
          onMarketDataChange={setMarketResearchData}
        />
      )}

      {pageTab === 0 && (<>
      {/* Statistics Bar */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1, mb: 2 }}>
        <Paper sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">Toplam Listing</Typography>
          <Typography variant="h6" fontWeight={700}>{totalCount}</Typography>
        </Paper>
        <Paper sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">Görüntülenme</Typography>
          <Typography variant="h6" fontWeight={700}>{totalViews.toLocaleString()}</Typography>
        </Paper>
        <Paper sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">Favori</Typography>
          <Typography variant="h6" fontWeight={700}>{totalFavorites.toLocaleString()}</Typography>
        </Paper>
        <Paper sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">Stoksuz</Typography>
          <Typography variant="h6" fontWeight={700} color="error">{outOfStock}</Typography>
        </Paper>
        <Paper sx={{ p: 1.5, borderLeft: '3px solid #ff9800' }}>
          <Typography variant="caption" color="text.secondary">Sorunlu</Typography>
          <Typography variant="h6" fontWeight={700} sx={{ color: '#ff9800' }}>{needsAttention}</Typography>
        </Paper>
      </Box>

      {/* Toolbar Row 1: Search & Filters */}
      <Paper sx={{ p: 1.5, mb: 1 }}>
        {/* Search row — full width on mobile */}
        <Box sx={{ display: 'flex', gap: 1, mb: { xs: 1, md: 0 }, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 150 } }}>
            <Select
              value={selectedShopId}
              onChange={(e) => setSelectedShopId(e.target.value)}
              displayEmpty
            >
              {shops.length === 0 && (
                <MenuItem value="" disabled>
                  Bağlı mağaza yok
                </MenuItem>
              )}
              {shops.map((s) => (
                <MenuItem key={s.shopId} value={s.shopId}>
                  {s.shopName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            size="small"
            placeholder="Listing ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ flex: 1, minWidth: { xs: '100%', sm: 200 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          <TextField
            size="small"
            placeholder="İçermez..."
            value={excludeTerm}
            onChange={(e) => setExcludeTerm(e.target.value)}
            sx={{ minWidth: { xs: '48%', sm: 140 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <RemoveCircleOutlineIcon sx={{ fontSize: 18, color: 'error.main' }} />
                </InputAdornment>
              ),
            }}
          />

          {/* Filters — on mobile these wrap to a second line */}
          <FormControl size="small" sx={{ minWidth: { xs: '48%', sm: 100 } }}>
            <Select
              value={statusFilter}
              onChange={(e) => {
                const val = e.target.value as 'active' | 'draft' | 'inactive' | 'expired';
                setStatusFilter(val);
                // Clear old listings immediately so loading state is visible
                setListings([]);
                setTotalCount(0);
              }}
            >
              <MenuItem value="active">Aktif</MenuItem>
              <MenuItem value="draft">Taslak</MenuItem>
              <MenuItem value="inactive">Deaktif</MenuItem>
              <MenuItem value="expired">Süresi Dolmuş</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: { xs: '48%', sm: 110 }, display: { xs: 'none', sm: 'flex' } }}>
            <Select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              displayEmpty
            >
              <MenuItem value="">Tüm Bölümler</MenuItem>
              {shopSections.map((s) => (
                <MenuItem key={s.shop_section_id} value={String(s.shop_section_id)}>
                  {s.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: { xs: '48%', sm: 120 } }}>
            <Select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              displayEmpty
            >
              <MenuItem value="">Tüm Sağlık</MenuItem>
              <MenuItem value="issues">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ErrorOutlineIcon sx={{ fontSize: 16, color: '#ff9800' }} />
                  Sorunlu
                </Box>
              </MenuItem>
              <MenuItem value="missing_images">Resim Eksik (&lt;10)</MenuItem>
              <MenuItem value="missing_tags">Etiket Eksik (&lt;13)</MenuItem>
              <MenuItem value="short_title">Kısa Başlık (&lt;100)</MenuItem>
              <MenuItem value="no_description">Açıklama Yok</MenuItem>
              <MenuItem value="no_video">Video Yok</MenuItem>
              <MenuItem value="no_stock">Stok Yok</MenuItem>
            </Select>
          </FormControl>

          <IconButton size="small" onClick={() => {
            // Invalidate cache on manual refresh
            const cacheKey = `${selectedShopId}:${statusFilter}`;
            delete listingsCacheRef.current[cacheKey];
            fetchListings();
          }} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Box>
      </Paper>

      {/* Toolbar Row 2: Actions — horizontally scrollable on mobile */}
      <Box sx={{
        display: 'flex',
        gap: 1,
        mb: 2,
        alignItems: 'center',
        overflowX: 'auto',
        pb: 0.5,
        '&::-webkit-scrollbar': { height: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
      }}>
        <Button variant="contained" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => setCreateDialogOpen(true)}>
          + Yeni Listing
        </Button>
        <Tooltip title="Başlık, açıklama, etiketlerde ara ve değiştir" arrow>
          <Button variant="outlined" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => setFindReplaceOpen(true)}>
            Bul &amp; Değiştir
          </Button>
        </Tooltip>
        <Tooltip title="Benzer/tekrarlanan listingleri bul" arrow>
          <Button variant="outlined" size="small" color="warning" sx={{ whiteSpace: 'nowrap' }} onClick={() => setDuplicateDetectorOpen(true)}>
            Tekrar Tespit
          </Button>
        </Tooltip>
        <Tooltip title="Satışa göre otomatik fiyat ayarla, stok yenile" arrow>
          <Button variant="outlined" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => setSmartPricingOpen(true)}>
            Akıllı Fiyat
          </Button>
        </Tooltip>
        <Tooltip title="Listing verilerini CSV olarak dışa aktar" arrow>
          <Button variant="outlined" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={handleExportCSV}>
            CSV İndir
          </Button>
        </Tooltip>
        <Tooltip title="CSV dosyasından toplu güncelleme yap" arrow>
          <Button variant="outlined" size="small" sx={{ whiteSpace: 'nowrap' }} startIcon={<UploadFileIcon />} onClick={handleCSVFileSelect}>
            CSV Yükle
          </Button>
        </Tooltip>
        <Tooltip title="Toplu işlem yedeklerini görüntüle ve geri yükle" arrow>
          <Button variant="outlined" size="small" color="info" sx={{ whiteSpace: 'nowrap' }} onClick={() => setBackupManagerOpen(true)}>
            Yedekler
          </Button>
        </Tooltip>
      </Box>

      {/* No shops message */}
      {shops.length === 0 && !(loading) && (
        <Paper sx={{ p: 3, mb: 2, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            Henüz bağlı bir Etsy mağazanız yok.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Etsy mağazanızı bağlamak için Ayarlar sayfasına gidin.
          </Typography>
          <Button
            variant="contained"
            size="small"
            href="/ayarlar"
          >
            Ayarlar Sayfasına Git
          </Button>
        </Paper>
      )}

      {/* Bulk operations bar */}
      {('ids' in selectedIds ? selectedIds.ids.size : 0) > 0 && (
        <BulkOperationsBar
          selectedCount={'ids' in selectedIds ? selectedIds.ids.size : 0}
          selectedListings={selectedListings}
          shopSections={shopSections}
          shopId={selectedShopId}
          allShops={shops}
          onCompleted={() => {
            setSelectedIds({ type: 'include' as const, ids: new Set<GridRowId>() });
            // Invalidate cache so we re-fetch from Etsy
            const cacheKey = `${selectedShopId}:${statusFilter}`;
            delete listingsCacheRef.current[cacheKey];
            fetchListings();
          }}
        />
      )}

      {/* Loading more indicator */}
      {loadingMore && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, px: 1 }}>
          <LinearProgress sx={{ flex: 1, height: 4, borderRadius: 2 }} />
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {listings.length}/{totalCount} yükleniyor...
          </Typography>
        </Box>
      )}

      {/* DataGrid */}
      <Paper sx={{ width: '100%' }}>
        <DataGrid
          rows={filteredListings}
          columns={columns}
          loading={loading}
          checkboxSelection
          disableRowSelectionOnClick
          rowHeight={82}
          rowSelectionModel={selectedIds}
          onRowSelectionModelChange={(newSelection) => setSelectedIds(newSelection)}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[25, 50, 100]}
          columnVisibilityModel={columnVisibilityModel}
          onColumnVisibilityModelChange={(model) => setColumnVisibilityModel(model)}
          autoHeight
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': {
              display: 'flex',
              alignItems: 'center',
            },
            '& .MuiDataGrid-row:hover': {
              backgroundColor: 'action.hover',
            },
          }}
          slots={{
            noRowsOverlay: () => (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  py: 4,
                }}
              >
                <Typography color="text.secondary">
                  {selectedShopId ? 'Listing bulunamadı' : 'Lütfen bir mağaza seçin'}
                </Typography>
              </Box>
            ),
            loadingOverlay: () => (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                }}
              >
                <CircularProgress />
              </Box>
            ),
          }}
        />
      </Paper>

      {/* Delete confirmation dialog */}
      {deleteConfirmId !== null && (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.5)',
          }}
          onClick={() => setDeleteConfirmId(null)}
        >
          <Paper
            sx={{ p: 3, maxWidth: 400, mx: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Typography variant="h6" gutterBottom>
              Listing Sil
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Bu listing&apos;i silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setDeleteConfirmId(null)}>
                İptal
              </Button>
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={() => handleDeleteListing(deleteConfirmId)}
              >
                Sil
              </Button>
            </Box>
          </Paper>
        </Box>
      )}

      </>)}

      {/* Editor Drawer */}
      <ListingEditorDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerListingId(null);
        }}
        listingId={drawerListingId}
        shopId={selectedShopId}
        refreshKey={drawerRefreshKey}
        shopSections={shopSections}
        shippingProfiles={shippingProfiles}
        returnPolicies={returnPolicies}
        onSaved={() => {
          fetchListings();
        }}
        onOpenListing={(newId) => {
          setStatusFilter('draft');
          setDrawerListingId(newId);
          // drawer stays open, just switches to new listing
        }}
        marketResearchData={marketResearchData}
      />

      {/* Creator Dialog */}
      <ListingCreatorDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        shopId={selectedShopId}
        shopSections={shopSections}
        shippingProfiles={shippingProfiles}
        returnPolicies={returnPolicies}
        marketResearchData={marketResearchData}
        onCreated={(listingId) => {
          setCreateDialogOpen(false);
          toast.success(`Listing #${listingId} olusturuldu`);
          fetchListings();
        }}
      />

      {/* Find & Replace Dialog */}
      <FindReplaceDialog
        open={findReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
        listings={filteredListings.map((l) => ({
          listing_id: l.listing_id,
          title: l.title,
          description: l.description,
          tags: l.tags,
          materials: l.materials,
        }))}
        shopId={selectedShopId}
        onCompleted={() => {
          setFindReplaceOpen(false);
          fetchListings();
        }}
      />

      {/* Smart Pricing Dialog */}
      <SmartPricing
        open={smartPricingOpen}
        onClose={() => setSmartPricingOpen(false)}
        listings={filteredListings.map((l) => ({
          listing_id: l.listing_id,
          title: l.title,
          price: l.price,
          views: l.views,
          quantity: l.quantity,
        }))}
      />

      {/* Duplicate Detector Dialog */}
      <DuplicateDetector
        open={duplicateDetectorOpen}
        onClose={() => setDuplicateDetectorOpen(false)}
        listings={filteredListings.map((l) => ({
          listing_id: l.listing_id,
          title: l.title,
          description: l.description,
          tags: l.tags,
          price: l.price,
          quantity: l.quantity,
          views: l.views,
          num_favorers: l.num_favorers,
          state: l.state,
        }))}
        shopId={selectedShopId}
        onEdit={(listingId) => handleOpenEditor(listingId)}
        onCompleted={() => {
          setDuplicateDetectorOpen(false);
          fetchListings();
        }}
      />

      {/* Backup Manager Dialog */}
      <BackupManager
        open={backupManagerOpen}
        onClose={() => setBackupManagerOpen(false)}
        shopId={selectedShopId}
        onRestored={() => {
          setBackupManagerOpen(false);
          fetchListings();
        }}
      />

      {/* CSV Import Preview Dialog */}
      <Dialog
        open={csvImportDialogOpen}
        onClose={() => {
          if (!csvImporting) {
            setCsvImportDialogOpen(false);
            setCsvImportRows([]);
          }
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>CSV Import Onizleme</DialogTitle>
        <DialogContent>
          {csvImporting ? (
            <Box sx={{ py: 3 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Import devam ediyor...
              </Typography>
              <LinearProgress variant="determinate" value={csvImportProgress} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                %{Math.round(csvImportProgress)} tamamlandi
              </Typography>
            </Box>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {csvImportRows.length} listing guncellenecek. Asagida degisiklikler listelenmistir.
              </Typography>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Listing ID</TableCell>
                      <TableCell>Baslik</TableCell>
                      <TableCell>Fiyat</TableCell>
                      <TableCell>Stok</TableCell>
                      <TableCell>Etiketler</TableCell>
                      <TableCell>Durum</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {csvImportRows.slice(0, 50).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.listing_id}</TableCell>
                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.title || '—'}
                        </TableCell>
                        <TableCell>{row.price || '—'}</TableCell>
                        <TableCell>{row.quantity || '—'}</TableCell>
                        <TableCell sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.tags || '—'}
                        </TableCell>
                        <TableCell>{row.state || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {csvImportRows.length > 50 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  ... ve {csvImportRows.length - 50} satir daha
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCsvImportDialogOpen(false); setCsvImportRows([]); }} disabled={csvImporting}>
            Iptal
          </Button>
          <Button variant="contained" onClick={handleCSVImportConfirm} disabled={csvImporting || csvImportRows.length === 0}>
            {csvImporting ? 'Import ediliyor...' : `${csvImportRows.length} Listing Guncelle`}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// --- Layout wrapper (follows labels.tsx pattern) ---
function EtsyListingsPageWithLayout(props: any): JSX.Element {
  return (
    <AppLayout title="Etsy Listings — KolayXport">
      <EtsyListingsPage {...props} />
    </AppLayout>
  );
}

export default withAuth(EtsyListingsPageWithLayout);
