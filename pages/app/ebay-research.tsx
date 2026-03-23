import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Tabs, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, IconButton, Tooltip, LinearProgress, Alert, Select,
  MenuItem, FormControl, InputLabel, CircularProgress, Divider,
  InputAdornment, Dialog, DialogTitle, DialogContent, DialogActions,
  Slider, Card, CardContent, Collapse, useMediaQuery, useTheme,
  Grid, Badge, Skeleton, TableSortLabel,
} from '@mui/material';
import {
  Search, TrendingUp, TrendingDown, Star, ExternalLink,
  Plus, Trash2, RefreshCw, Eye, Bookmark, BarChart2,
  DollarSign, Users, FolderTree, Gauge, Package, Target,
  ChevronDown, ChevronUp, Edit3, Tag, Clock, AlertTriangle,
  Save, X, Copy, ShoppingBag, Globe, Filter, ArrowUpDown,
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import KeywordIntelligence from '@/components/ebay/research/KeywordIntelligence';
import CompetitiveIntelligence from '@/components/ebay/research/CompetitiveIntelligence';
import ListingOptimizer from '@/components/ebay/research/ListingOptimizer';
import FinancialIntelligence from '@/components/ebay/research/FinancialIntelligence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchFilters {
  keyword: string;
  categoryId: string;
  priceMin: number;
  priceMax: number;
  condition: string;
  sortBy: string;
  marketplace: string;
}

interface ProductResult {
  itemId: string;
  legacyItemId?: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string;
  condition: string;
  seller: string;
  sellerFeedback: number;
  shippingCost: number | null;
  freeShipping: boolean;
  topRated: boolean;
  estimatedSold: number;
  listingDate: string;
  itemUrl: string;
  location: string;
}

interface PriceStats {
  min: number;
  max: number;
  avg: number;
  median: number;
  totalResults: number;
}

interface TrackedProduct {
  id: string;
  legacyItemId: string;
  itemId?: string;
  title: string;
  imageUrl: string;
  currentPrice: number;
  currency: string;
  totalSold: number;
  itemWebUrl?: string;
  notes: string;
  tags: string[];
  lastCheckedAt: string;
  createdAt: string;
  snapshots: { price: number; currency: string; quantity?: number; soldQuantity?: number; timestamp: string }[];
}

interface NicheReport {
  keyword: string;
  demandScore: number;
  competitionScore: number;
  totalListings: number;
  uniqueSellers: number;
  avgPrice: number;
  medianPrice: number;
  priceMin: number;
  priceMax: number;
  freeShippingPct: number;
  sellerConcentration: number;
  topProducts: ProductResult[];
  aspects: { name: string; count: number; percentage: number }[];
  priceDistribution: { range: string; count: number }[];
  savedAt?: string;
  id?: string;
}

interface TrackedSeller {
  id: string;
  sellerUsername: string;
  feedbackScore: number;
  feedbackPct: string;
  lastCheckedAt: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type SortDir = 'asc' | 'desc';

function useTableSort<T>(items: T[], defaultKey: string = '', defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    return [...items].sort((a: any, b: any) => {
      let va = a[sortKey] ?? 0;
      let vb = b[sortKey] ?? 0;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [items, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, handleSort };
}

const CONDITIONS = [
  { value: '', label: 'Tümü' },
  { value: 'New', label: 'Yeni' },
  { value: 'Used', label: 'Kullanılmış' },
  { value: 'OpenBox', label: 'Açık Kutu' },
  { value: 'Refurbished', label: 'Yenilenmiş' },
];

const SORT_OPTIONS = [
  { value: 'BestMatch', label: 'En İyi Eşleşme' },
  { value: 'PricePlusShippingLowest', label: 'Fiyat: Düşükten Yükseğe' },
  { value: 'PricePlusShippingHighest', label: 'Fiyat: Yüksekten Düşüğe' },
  { value: 'StartTimeNewest', label: 'En Yeni Listelenen' },
];

const MARKETPLACES = [
  { value: 'EBAY_US', label: 'ABD', flag: '🇺🇸' },
  { value: 'EBAY_GB', label: 'İngiltere', flag: '🇬🇧' },
  { value: 'EBAY_DE', label: 'Almanya', flag: '🇩🇪' },
  { value: 'EBAY_FR', label: 'Fransa', flag: '🇫🇷' },
  { value: 'EBAY_IT', label: 'İtalya', flag: '🇮🇹' },
  { value: 'EBAY_ES', label: 'İspanya', flag: '🇪🇸' },
  { value: 'EBAY_AU', label: 'Avustralya', flag: '🇦🇺' },
];

const POPULAR_CATEGORIES = [
  { id: '11450', name: 'Giyim & Aksesuar', emoji: '👗' },
  { id: '58058', name: 'Cep Telefonu & Aksesuar', emoji: '📱' },
  { id: '11700', name: 'Ev & Bahce', emoji: '🏠' },
  { id: '220', name: 'Oyuncak & Hobi', emoji: '🧸' },
  { id: '26395', name: 'Saglik & Guzellik', emoji: '💄' },
  { id: '6000', name: 'Motorlar & Parca', emoji: '🚗' },
  { id: '64482', name: 'Spor Malzemesi', emoji: '⚽' },
  { id: '293', name: 'Elektronik', emoji: '🔌' },
  { id: '12576', name: 'Bebek Urunleri', emoji: '👶' },
  { id: '625', name: 'Kamera & Foto', emoji: '📷' },
  { id: '175672', name: 'Mucevher & Saat', emoji: '💎' },
  { id: '15032', name: 'Evcil Hayvan', emoji: '🐾' },
];

const SCORE_COLOR = (score: number, invert = false) => {
  const s = invert ? 100 - score : score;
  if (s >= 70) return '#2e7d32';
  if (s >= 40) return '#ed6c02';
  return '#d32f2f';
};

// ---------------------------------------------------------------------------
// Utility Components
// ---------------------------------------------------------------------------

function MiniPriceChart({ snapshots }: { snapshots: { price: number; timestamp: string }[] }) {
  if (!snapshots || snapshots.length < 2) return <Typography variant="caption" color="text.secondary">Veri yok</Typography>;
  const prices = snapshots.map(s => s.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '1px', height: 30, minWidth: 60 }}>
      {snapshots.slice(-30).map((s, i, arr) => (
        <Tooltip key={i} title={`$${s.price.toFixed(2)} - ${new Date(s.timestamp).toLocaleDateString('tr-TR')}`}>
          <Box sx={{
            flex: 1, minWidth: 2, maxWidth: 6,
            height: `${Math.max(((s.price - min) / range) * 100, 5)}%`,
            bgcolor: i === arr.length - 1 ? '#1976d2' : '#90caf9',
            borderRadius: '1px 1px 0 0',
            cursor: 'pointer',
            '&:hover': { bgcolor: '#1565c0' },
          }} />
        </Tooltip>
      ))}
    </Box>
  );
}

function ScoreDisplay({ label, score, invert = false }: { label: string; score: number; invert?: boolean }) {
  const color = SCORE_COLOR(score, invert);
  return (
    <Box sx={{ textAlign: 'center', p: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h3" sx={{ fontWeight: 800, color, lineHeight: 1 }}>
        {score}
      </Typography>
      <Typography variant="caption" color="text.secondary">/100</Typography>
    </Box>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <Paper sx={{ p: 1.5, textAlign: 'center', flex: '1 1 140px', minWidth: 120 }} variant="outlined">
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 0.5, color: 'primary.main' }}>{icon}</Box>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="subtitle1" fontWeight={700}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

function PriceStatsBar({ stats }: { stats: PriceStats | null }) {
  if (!stats) return null;
  return (
    <Paper sx={{ p: 1.5, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center', alignItems: 'center' }} variant="outlined">
      <Chip icon={<DollarSign size={14} />} label={`Min: $${stats.min.toFixed(2)}`} size="small" variant="outlined" />
      <Chip icon={<BarChart2 size={14} />} label={`Ort: $${stats.avg.toFixed(2)}`} size="small" color="primary" variant="outlined" />
      <Chip icon={<Target size={14} />} label={`Medyan: $${stats.median.toFixed(2)}`} size="small" variant="outlined" />
      <Chip icon={<DollarSign size={14} />} label={`Max: $${stats.max.toFixed(2)}`} size="small" variant="outlined" />
      <Chip icon={<Package size={14} />} label={`${stats.totalResults.toLocaleString('tr-TR')} sonuç`} size="small" color="secondary" />
    </Paper>
  );
}

function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
      <Package size={48} strokeWidth={1} />
      <Typography variant="h6" sx={{ mt: 2, fontWeight: 600 }}>{message}</Typography>
      {sub && <Typography variant="body2" sx={{ mt: 1 }}>{sub}</Typography>}
    </Box>
  );
}

function PriceChangeChip({ change }: { change: number }) {
  if (change === 0) return <Chip label="0%" size="small" variant="outlined" />;
  const up = change > 0;
  return (
    <Chip
      icon={up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      label={`${up ? '+' : ''}${change.toFixed(1)}%`}
      size="small"
      sx={{
        bgcolor: up ? '#e8f5e9' : '#ffebee',
        color: up ? '#2e7d32' : '#c62828',
        fontWeight: 600,
      }}
    />
  );
}

function SoldBadge({ count }: { count: number }) {
  const color = count > 10 ? '#2e7d32' : count > 0 ? '#ed6c02' : '#9e9e9e';
  const bg = count > 10 ? '#e8f5e9' : count > 0 ? '#fff3e0' : '#f5f5f5';
  return (
    <Chip
      label={`${count} satış`}
      size="small"
      sx={{ bgcolor: bg, color, fontWeight: 600, fontSize: '0.75rem' }}
    />
  );
}

function SimpleHistogram({ data }: { data: { range: string; count: number }[] }) {
  if (!data || data.length === 0) return null;
  const maxCount = Math.max(...data.map(d => d.count), 1);
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 100, mt: 1 }}>
      {data.map((d, i) => (
        <Tooltip key={i} title={`${d.range}: ${d.count} ürün`}>
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box sx={{
              width: '100%', maxWidth: 40,
              height: `${Math.max((d.count / maxCount) * 80, 4)}px`,
              bgcolor: '#1976d2',
              borderRadius: '2px 2px 0 0',
              '&:hover': { bgcolor: '#1565c0' },
            }} />
            <Typography variant="caption" sx={{ fontSize: '0.6rem', mt: 0.5, writingMode: 'vertical-lr', transform: 'rotate(180deg)', maxHeight: 50, overflow: 'hidden' }}>
              {d.range}
            </Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// API Helper
// ---------------------------------------------------------------------------

function mapEbayItem(item: any): ProductResult {
  return {
    itemId: item.itemId || item.legacyItemId || '',
    legacyItemId: item.legacyItemId,
    title: item.title || '',
    price: typeof item.price === 'number' ? item.price : parseFloat(item.price?.value || '0'),
    currency: item.price?.currency || item.currency || 'USD',
    imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || item.imageUrl || '',
    condition: item.condition || '',
    seller: item.seller?.username || item.seller || '',
    sellerFeedback: item.seller?.feedbackScore || item.sellerFeedback || 0,
    shippingCost: item.shippingOptions?.[0]?.shippingCost?.value ? parseFloat(item.shippingOptions[0].shippingCost.value) : null,
    freeShipping: item.shippingOptions?.[0]?.shippingCost?.value === '0.00' || item.freeShipping || false,
    topRated: item.topRatedBuyingExperience || item.topRated || false,
    estimatedSold: item.estimatedSoldQuantity || item.estimatedSold || 0,
    listingDate: item.itemCreationDate || item.listingDate || '',
    itemUrl: item.itemWebUrl || item.itemUrl || '',
    location: item.itemLocation?.postalCode || item.location || '',
  };
}

function mapNicheProduct(p: any): ProductResult {
  return {
    itemId: p.legacyItemId || p.itemId || '',
    legacyItemId: p.legacyItemId,
    title: p.title || '',
    price: typeof p.price === 'number' ? p.price : parseFloat(p.price?.value || '0'),
    currency: p.currency || 'USD',
    imageUrl: p.imageUrl || p.image?.imageUrl || '',
    condition: p.condition || '',
    seller: typeof p.seller === 'string' ? p.seller : p.seller?.username || '',
    sellerFeedback: p.sellerFeedback || 0,
    shippingCost: null,
    freeShipping: false,
    topRated: false,
    estimatedSold: p.soldQuantity ?? p.estimatedSoldQuantity ?? p.estimatedSold ?? 0,
    listingDate: '',
    itemUrl: p.itemUrl || p.itemWebUrl || (p.legacyItemId ? `https://www.ebay.com/itm/${p.legacyItemId}` : ''),
    location: '',
  };
}

async function apiCall(action: string, userId: string, params: Record<string, any> = {}) {
  const query = new URLSearchParams({ action, user_id: userId, ...Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
  ) });
  const res = await fetch(`/api/clawd/ebay-research?${query.toString()}`);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API hatası: ${res.status}`);
  }
  return res.json();
}

async function apiPost(action: string, userId: string, body: Record<string, any> = {}) {
  const res = await fetch(`/api/clawd/ebay-research?action=${action}&user_id=${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API hatası: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Tab Panel Wrapper
// ---------------------------------------------------------------------------

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

// ---------------------------------------------------------------------------
// TAB 1: Product Database
// ---------------------------------------------------------------------------

function ProductDatabase({ userId, userListings = [], userListingsLoading = false }: { userId: string; userListings?: any[]; userListingsLoading?: boolean }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [filters, setFilters] = useState<SearchFilters>({
    keyword: '',
    categoryId: '',
    priceMin: 0,
    priceMax: 10000,
    condition: '',
    sortBy: 'BestMatch',
    marketplace: 'EBAY_US',
  });
  const [results, setResults] = useState<ProductResult[]>([]);
  const [priceStats, setPriceStats] = useState<PriceStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showFilters, setShowFilters] = useState(!isMobile);
  const [trackingIds, setTrackingIds] = useState<Set<string>>(new Set());
  const productSort = useTableSort<ProductResult>(results, '', 'desc');

  const handleSearch = useCallback(async (append = false) => {
    if (!filters.keyword.trim() && !filters.categoryId.trim()) {
      toast.error('Anahtar kelime veya kategori ID girin');
      return;
    }
    setLoading(true);
    setSearched(true);
    const newOffset = append ? offset : 0;
    try {
      const data = await apiCall('product_database', userId, {
        q: filters.keyword,
        category_id: filters.categoryId,
        min_price: filters.priceMin > 0 ? filters.priceMin : '',
        max_price: filters.priceMax < 10000 ? filters.priceMax : '',
        condition: filters.condition,
        sort: filters.sortBy,
        marketplace_id: filters.marketplace,
        offset: newOffset,
        limit: 50,
      });
      const items: ProductResult[] = (data.items || []).map(mapEbayItem);
      if (append) {
        setResults(prev => [...prev, ...items]);
      } else {
        setResults(items);
      }
      setPriceStats(data.priceStats || null);
      setOffset(newOffset + items.length);
      setHasMore((data.total || 0) > newOffset + items.length);
    } catch (err: any) {
      toast.error(err.message || 'Arama başarısız');
    } finally {
      setLoading(false);
    }
  }, [filters, offset, userId]);

  const handleTrack = useCallback(async (product: ProductResult) => {
    try {
      await apiPost('track_product', userId, {
        legacyItemId: product.legacyItemId || product.itemId,
        title: product.title,
      });
      setTrackingIds(prev => new Set(prev).add(product.itemId));
      toast.success('Ürün takibe alındı');
    } catch (err: any) {
      toast.error(err.message || 'Takip başarısız');
    }
  }, [userId]);

  const handleSellerSearch = useCallback((seller: string) => {
    setFilters(prev => ({ ...prev, keyword: `seller:${seller}` }));
  }, []);

  const [categoryChipClicked, setCategoryChipClicked] = useState(0);

  // Trigger search when a category chip is clicked
  useEffect(() => {
    if (categoryChipClicked > 0) {
      handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryChipClicked]);

  const userCategories = useMemo(() => {
    const cats = new Map<string, { id: string; name: string; count: number }>();
    for (const l of userListings || []) {
      const id = l.categoryId;
      const name = l.categoryPath?.split('|').pop()?.trim() || l.categoryId || '';
      if (id && name) {
        const existing = cats.get(id);
        if (existing) existing.count++;
        else cats.set(id, { id, name, count: 1 });
      }
    }
    return Array.from(cats.values()).sort((a, b) => b.count - a.count);
  }, [userListings]);

  const updateFilter = (key: keyof SearchFilters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Box>
      {/* Search Form */}
      <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: isMobile ? 1 : 0 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            <Search size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Ürün Arama
          </Typography>
          {isMobile && (
            <Button size="small" startIcon={<Filter size={14} />} onClick={() => setShowFilters(!showFilters)}>
              Filtreler
            </Button>
          )}
        </Box>

        {/* User category quick-filter chips */}
        {userCategories.length > 0 && (
          <Box sx={{ mb: 2, mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Senin Kategorilerin:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {userCategories.slice(0, 8).map(cat => (
                <Chip
                  key={cat.id}
                  label={`${cat.name} (${cat.count})`}
                  size="small"
                  variant={filters.categoryId === cat.id ? 'filled' : 'outlined'}
                  color={filters.categoryId === cat.id ? 'primary' : 'default'}
                  onClick={() => {
                    setFilters(prev => ({ ...prev, categoryId: cat.id }));
                    setCategoryChipClicked(c => c + 1);
                  }}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Keyword + Category row - always visible */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Anahtar Kelime"
            value={filters.keyword}
            onChange={e => updateFilter('keyword', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            sx={{ flex: '2 1 250px' }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
            }}
          />
          <TextField
            size="small"
            label="Kategori ID"
            value={filters.categoryId}
            onChange={e => updateFilter('categoryId', e.target.value)}
            sx={{ flex: '1 1 120px', maxWidth: 160 }}
          />
          <Button variant="contained" onClick={() => handleSearch()} disabled={loading} sx={{ minWidth: 100 }}>
            {loading ? <CircularProgress size={20} /> : 'Ara'}
          </Button>
        </Box>

        {/* Extended Filters */}
        <Collapse in={showFilters || !isMobile}>
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Marketplace */}
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>Pazar Yeri</InputLabel>
              <Select value={filters.marketplace} label="Pazar Yeri" onChange={e => updateFilter('marketplace', e.target.value)}>
                {MARKETPLACES.map(m => (
                  <MenuItem key={m.value} value={m.value}>{m.flag} {m.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Condition */}
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Durum</InputLabel>
              <Select value={filters.condition} label="Durum" onChange={e => updateFilter('condition', e.target.value)}>
                {CONDITIONS.map(c => (
                  <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Sort */}
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>Sıralama</InputLabel>
              <Select value={filters.sortBy} label="Sıralama" onChange={e => updateFilter('sortBy', e.target.value)}>
                {SORT_OPTIONS.map(s => (
                  <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Price Range */}
            <TextField
              size="small"
              label="Min Fiyat"
              type="number"
              value={filters.priceMin || ''}
              onChange={e => updateFilter('priceMin', Number(e.target.value))}
              sx={{ width: 100 }}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
            <TextField
              size="small"
              label="Max Fiyat"
              type="number"
              value={filters.priceMax >= 10000 ? '' : filters.priceMax}
              onChange={e => updateFilter('priceMax', Number(e.target.value) || 10000)}
              sx={{ width: 100 }}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
          </Box>
        </Collapse>
      </Paper>

      {/* Price Stats */}
      <PriceStatsBar stats={priceStats} />

      {/* Loading */}
      {loading && <LinearProgress sx={{ mb: 1 }} />}

      {/* Results */}
      {!searched && userListings.length > 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center', bgcolor: '#f0f7ff' }}>
          <Typography variant="body1" fontWeight={600} sx={{ mb: 1 }}>
            Aramaya başla veya kategorilerinden birini seç
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {userListings.length} aktif listen var. Yukarıdaki kategorilerine tıklayarak pazarı keşfet.
          </Typography>
        </Paper>
      ) : !searched ? (
        <EmptyState message="Aramaya başlayın" sub="Yukarıdaki alanları kullanarak eBay'de ürün arayın" />
      ) : results.length === 0 && !loading ? (
        <EmptyState message="Sonuç bulunamadı" sub="Filtrelerinizi değiştirerek tekrar deneyin" />
      ) : isMobile ? (
        /* Mobile Card View */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {results.map(product => (
            <MobileProductCard key={product.itemId} product={product} onTrack={handleTrack} onSellerSearch={handleSellerSearch} tracked={trackingIds.has(product.itemId)} />
          ))}
        </Box>
      ) : (
        /* Desktop Table View */
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                <TableCell sx={{ width: 60 }}>Resim</TableCell>
                <TableCell>Başlık</TableCell>
                <TableCell align="right" sortDirection={productSort.sortKey === 'price' ? productSort.sortDir : false}>
                  <TableSortLabel active={productSort.sortKey === 'price'} direction={productSort.sortKey === 'price' ? productSort.sortDir : 'desc'} onClick={() => productSort.handleSort('price')}>
                    Fiyat
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center" sortDirection={productSort.sortKey === 'estimatedSold' ? productSort.sortDir : false}>
                  <TableSortLabel active={productSort.sortKey === 'estimatedSold'} direction={productSort.sortKey === 'estimatedSold' ? productSort.sortDir : 'desc'} onClick={() => productSort.handleSort('estimatedSold')}>
                    Satış
                  </TableSortLabel>
                </TableCell>
                <TableCell>Durum</TableCell>
                <TableCell>Satıcı</TableCell>
                <TableCell>Kargo</TableCell>
                <TableCell align="center">Aksiyon</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {productSort.sorted.map(product => (
                <TableRow key={product.itemId} hover sx={{ '&:hover': { bgcolor: '#fafafa' } }}>
                  <TableCell>
                    <Box
                      component="img"
                      src={product.imageUrl || '/placeholder-product.png'}
                      alt=""
                      sx={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 1, bgcolor: '#f5f5f5' }}
                      onError={(e: any) => { e.target.src = '/placeholder-product.png'; }}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 300 }}>
                    <Typography
                      variant="body2"
                      component="a"
                      href={product.itemUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        color: 'primary.main', textDecoration: 'none', fontWeight: 500,
                        '&:hover': { textDecoration: 'underline' },
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}
                    >
                      {product.title}
                    </Typography>
                    {product.topRated && (
                      <Chip icon={<Star size={12} />} label="Top Rated" size="small" color="warning" sx={{ mt: 0.5, height: 20, fontSize: '0.65rem' }} />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700}>${product.price.toFixed(2)}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <SoldBadge count={product.estimatedSold} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{product.condition}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="caption"
                      sx={{ cursor: 'pointer', color: 'primary.main', '&:hover': { textDecoration: 'underline' } }}
                      onClick={() => handleSellerSearch(product.seller)}
                    >
                      {product.seller}
                    </Typography>
                    {product.sellerFeedback > 0 && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        ({product.sellerFeedback.toLocaleString('tr-TR')})
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {product.freeShipping ? (
                      <Chip label="Ücretsiz" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                    ) : product.shippingCost != null ? (
                      <Typography variant="caption">${product.shippingCost.toFixed(2)}</Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">-</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title={trackingIds.has(product.itemId) ? 'Takipte' : 'Takip Et'}>
                      <IconButton
                        size="small"
                        color={trackingIds.has(product.itemId) ? 'primary' : 'default'}
                        onClick={() => handleTrack(product)}
                        disabled={trackingIds.has(product.itemId)}
                      >
                        <Bookmark size={16} fill={trackingIds.has(product.itemId) ? 'currentColor' : 'none'} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="eBay'de Aç">
                      <IconButton size="small" component="a" href={product.itemUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={16} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Load More */}
      {hasMore && results.length > 0 && !loading && (
        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Button variant="outlined" onClick={() => handleSearch(true)} startIcon={<ChevronDown size={16} />}>
            Daha Fazla Yükle
          </Button>
        </Box>
      )}
    </Box>
  );
}

// Mobile product card for search results
function MobileProductCard({ product, onTrack, onSellerSearch, tracked }: {
  product: ProductResult; onTrack: (p: ProductResult) => void;
  onSellerSearch: (s: string) => void; tracked: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', gap: 1.5, p: 1.5, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <Box
          component="img"
          src={product.imageUrl || '/placeholder-product.png'}
          alt=""
          sx={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          onError={(e: any) => { e.target.src = '/placeholder-product.png'; }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={500} sx={{
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {product.title}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Typography variant="subtitle2" fontWeight={700} color="primary.main">${product.price.toFixed(2)}</Typography>
            <SoldBadge count={product.estimatedSold} />
            {product.topRated && <Star size={14} color="#ed6c02" fill="#ed6c02" />}
          </Box>
        </Box>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </Box>
      <Collapse in={expanded}>
        <Divider />
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">Durum:</Typography>
            <Typography variant="caption">{product.condition}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">Satıcı:</Typography>
            <Typography
              variant="caption"
              sx={{ cursor: 'pointer', color: 'primary.main' }}
              onClick={(e) => { e.stopPropagation(); onSellerSearch(product.seller); }}
            >
              {product.seller} ({product.sellerFeedback.toLocaleString('tr-TR')})
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">Kargo:</Typography>
            <Typography variant="caption">
              {product.freeShipping ? 'Ucretsiz' : product.shippingCost != null ? `$${product.shippingCost.toFixed(2)}` : '-'}
            </Typography>
          </Box>
          <Divider />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small" variant="outlined" fullWidth
              startIcon={<Bookmark size={14} fill={tracked ? 'currentColor' : 'none'} />}
              onClick={() => onTrack(product)}
              disabled={tracked}
            >
              {tracked ? 'Takipte' : 'Takip Et'}
            </Button>
            <Button
              size="small" variant="outlined" fullWidth
              startIcon={<ExternalLink size={14} />}
              component="a" href={product.itemUrl} target="_blank" rel="noopener noreferrer"
            >
              eBay
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// TAB 2: Product Tracker
// ---------------------------------------------------------------------------

function ProductTracker({ userId, userListings }: { userId: string; userListings?: any[] }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [tracked, setTracked] = useState<TrackedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addItemId, setAddItemId] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const [tagDialog, setTagDialog] = useState<{ id: string; tags: string[] } | null>(null);
  const [newTag, setNewTag] = useState('');
  const trackedSort = useTableSort<TrackedProduct>(tracked, 'currentPrice', 'desc');

  const fetchTracked = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall('tracked_products', userId);
      setTracked(data.products || []);
    } catch (err: any) {
      toast.error(err.message || 'Takip edilen ürünler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchTracked(); }, [fetchTracked]);

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await apiPost('refresh_tracked', userId);
      toast.success('Tüm ürünler güncellendi');
      await fetchTracked();
    } catch (err: any) {
      toast.error(err.message || 'Güncelleme başarısız');
    } finally {
      setRefreshing(false);
    }
  }, [userId, fetchTracked]);

  const handleAddByUrl = useCallback(async () => {
    if (!addItemId.trim()) return;
    setAddLoading(true);
    try {
      // Extract item ID from URL or use as-is
      let itemId = addItemId.trim();
      const urlMatch = itemId.match(/\/itm\/(\d+)/);
      if (urlMatch) itemId = urlMatch[1];
      const idMatch = itemId.match(/(\d{10,14})/);
      if (idMatch) itemId = idMatch[1];

      await apiPost('track_product', userId, { legacyItemId: itemId });
      toast.success('Ürün takibe alındı');
      setAddDialogOpen(false);
      setAddItemId('');
      await fetchTracked();
    } catch (err: any) {
      toast.error(err.message || 'Ürün eklenemedi');
    } finally {
      setAddLoading(false);
    }
  }, [addItemId, userId, fetchTracked]);

  const handleRemove = useCallback(async (id: string) => {
    try {
      await apiPost('untrack_product', userId, { id });
      setTracked(prev => prev.filter(p => p.id !== id));
      toast.success('Ürün takipten çıkarıldı');
    } catch (err: any) {
      toast.error(err.message || 'Silme başarısız');
    }
  }, [userId]);

  const handleSaveNotes = useCallback(async (id: string) => {
    try {
      await apiPost('update_product', userId, { id, notes: notesText });
      setTracked(prev => prev.map(p => p.id === id ? { ...p, notes: notesText } : p));
      setEditingNotes(null);
      toast.success('Not kaydedildi');
    } catch (err: any) {
      toast.error(err.message || 'Not kaydedilemedi');
    }
  }, [userId, notesText]);

  const handleAddTag = useCallback(async (id: string) => {
    if (!newTag.trim() || !tagDialog) return;
    const updated = [...tagDialog.tags, newTag.trim()];
    try {
      await apiPost('update_product', userId, { id, tags: updated });
      setTracked(prev => prev.map(p => p.id === id ? { ...p, tags: updated } : p));
      setTagDialog({ id, tags: updated });
      setNewTag('');
    } catch (err: any) {
      toast.error(err.message || 'Etiket eklenemedi');
    }
  }, [userId, newTag, tagDialog]);

  const handleRemoveTag = useCallback(async (id: string, tag: string) => {
    if (!tagDialog) return;
    const updated = tagDialog.tags.filter(t => t !== tag);
    try {
      await apiPost('update_product', userId, { id, tags: updated });
      setTracked(prev => prev.map(p => p.id === id ? { ...p, tags: updated } : p));
      setTagDialog({ id, tags: updated });
    } catch (err: any) {
      toast.error(err.message || 'Etiket silinemedi');
    }
  }, [userId, tagDialog]);

  if (loading) {
    return (
      <Box sx={{ py: 4 }}>
        {[1, 2, 3].map(i => <Skeleton key={i} variant="rectangular" height={100} sx={{ mb: 1, borderRadius: 1 }} />)}
      </Box>
    );
  }

  return (
    <Box>
      {/* Actions Bar */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="contained"
          startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshCw size={16} />}
          onClick={handleRefreshAll}
          disabled={refreshing || tracked.length === 0}
        >
          Takip Edilen Ürünleri Yenile
        </Button>
        <Button variant="outlined" startIcon={<Plus size={16} />} onClick={() => setAddDialogOpen(true)}>
          URL/ID ile Ekle
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {tracked.length} ürün takipte
        </Typography>
      </Box>

      {/* Product List */}
      {tracked.length === 0 ? (
        <EmptyState
          message="Henüz takip edilen ürün yok"
          sub="Ürün Veritabanı'ndan ürün ekleyin veya URL/ID ile ekleyin."
        />
      ) : isMobile ? (
        /* Mobile Card View */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {tracked.map(product => (
            <TrackedProductMobileCard
              key={product.id}
              product={product}
              onRemove={handleRemove}
              onEditNotes={(id, notes) => { setEditingNotes(id); setNotesText(notes); }}
              onOpenTags={(id, tags) => setTagDialog({ id, tags })}
            />
          ))}
        </Box>
      ) : (
        /* Desktop Table View */
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                <TableCell sx={{ width: 60 }}>Resim</TableCell>
                <TableCell>Başlık</TableCell>
                <TableCell align="right" sortDirection={trackedSort.sortKey === 'currentPrice' ? trackedSort.sortDir : false}>
                  <TableSortLabel active={trackedSort.sortKey === 'currentPrice'} direction={trackedSort.sortKey === 'currentPrice' ? trackedSort.sortDir : 'desc'} onClick={() => trackedSort.handleSort('currentPrice')}>
                    Fiyat
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center">Değişim</TableCell>
                <TableCell align="center" sortDirection={trackedSort.sortKey === 'totalSold' ? trackedSort.sortDir : false}>
                  <TableSortLabel active={trackedSort.sortKey === 'totalSold'} direction={trackedSort.sortKey === 'totalSold' ? trackedSort.sortDir : 'desc'} onClick={() => trackedSort.handleSort('totalSold')}>
                    Satış
                  </TableSortLabel>
                </TableCell>
                <TableCell>Fiyat Geçmişi</TableCell>
                <TableCell>Notlar</TableCell>
                <TableCell>Etiketler</TableCell>
                <TableCell align="center">Son Kontrol</TableCell>
                <TableCell align="center">Sil</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {trackedSort.sorted.map(product => (
                <TableRow key={product.id} hover>
                  <TableCell>
                    <Box
                      component="img"
                      src={product.imageUrl || '/placeholder-product.png'}
                      alt=""
                      sx={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 1 }}
                      onError={(e: any) => { e.target.src = '/placeholder-product.png'; }}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 250 }}>
                    <Typography variant="body2" fontWeight={500} sx={{
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {product.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      ID: {product.legacyItemId}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700}>${(product.currentPrice || 0).toFixed(2)}</Typography>
                    {product.snapshots?.length > 1 && (() => {
                      const oldest = product.snapshots[product.snapshots.length - 1];
                      return oldest.price !== product.currentPrice ? (
                        <Typography variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
                          ${oldest.price.toFixed(2)}
                        </Typography>
                      ) : null;
                    })()}
                  </TableCell>
                  <TableCell align="center">
                    {product.snapshots?.length > 1 ? (() => {
                      const oldest = product.snapshots[product.snapshots.length - 1];
                      const change = oldest.price > 0 ? ((product.currentPrice - oldest.price) / oldest.price) * 100 : 0;
                      return <PriceChangeChip change={change} />;
                    })() : <Typography variant="caption" color="text.secondary">-</Typography>}
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="body2">{product.totalSold ?? 0}</Typography>
                  </TableCell>
                  <TableCell>
                    <MiniPriceChart snapshots={product.snapshots} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 150 }}>
                    {editingNotes === product.id ? (
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <TextField
                          size="small"
                          value={notesText}
                          onChange={e => setNotesText(e.target.value)}
                          multiline
                          maxRows={3}
                          sx={{ flex: 1 }}
                        />
                        <IconButton size="small" color="primary" onClick={() => handleSaveNotes(product.id)}>
                          <Save size={14} />
                        </IconButton>
                        <IconButton size="small" onClick={() => setEditingNotes(null)}>
                          <X size={14} />
                        </IconButton>
                      </Box>
                    ) : (
                      <Typography
                        variant="caption"
                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                        onClick={() => { setEditingNotes(product.id); setNotesText(product.notes || ''); }}
                      >
                        {product.notes || 'Not ekle...'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                      {(product.tags || []).slice(0, 3).map(tag => (
                        <Chip key={tag} label={tag} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                      ))}
                      <IconButton size="small" onClick={() => setTagDialog({ id: product.id, tags: product.tags || [] })}>
                        <Tag size={12} />
                      </IconButton>
                    </Box>
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="caption" color="text.secondary">
                      {product.lastCheckedAt ? new Date(product.lastCheckedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {product.itemWebUrl || product.legacyItemId ? (
                        <IconButton size="small" component="a" href={product.itemWebUrl || `https://www.ebay.com/itm/${product.legacyItemId}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={16} />
                        </IconButton>
                      ) : null}
                      <IconButton size="small" color="error" onClick={() => handleRemove(product.id)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add by URL/ID Dialog */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>URL veya ID ile Ürün Ekle</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            eBay ürün URL&apos;sini veya Legacy Item ID&apos;sini girin.
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="eBay URL veya Item ID"
            value={addItemId}
            onChange={e => setAddItemId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddByUrl()}
            placeholder="https://www.ebay.com/itm/123456789 veya 123456789"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialogOpen(false)}>Iptal</Button>
          <Button variant="contained" onClick={handleAddByUrl} disabled={addLoading || !addItemId.trim()}>
            {addLoading ? <CircularProgress size={18} /> : 'Ekle'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tags Dialog */}
      <Dialog open={!!tagDialog} onClose={() => setTagDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Etiketleri Düzenle</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2, mt: 1 }}>
            {tagDialog?.tags.map(tag => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                onDelete={() => tagDialog && handleRemoveTag(tagDialog.id, tag)}
                color="primary"
                variant="outlined"
              />
            ))}
            {(!tagDialog?.tags || tagDialog.tags.length === 0) && (
              <Typography variant="caption" color="text.secondary">Henüz etiket yok</Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              label="Yeni Etiket"
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && tagDialog && handleAddTag(tagDialog.id)}
            />
            <Button variant="outlined" onClick={() => tagDialog && handleAddTag(tagDialog.id)} disabled={!newTag.trim()}>
              Ekle
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTagDialog(null)}>Kapat</Button>
        </DialogActions>
      </Dialog>

      {/* Notes inline edit dialog for mobile */}
      {isMobile && editingNotes && (
        <Dialog open={!!editingNotes} onClose={() => setEditingNotes(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Not Düzenle</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              multiline
              rows={4}
              value={notesText}
              onChange={e => setNotesText(e.target.value)}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditingNotes(null)}>Iptal</Button>
            <Button variant="contained" onClick={() => editingNotes && handleSaveNotes(editingNotes)}>Kaydet</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

function TrackedProductMobileCard({ product, onRemove, onEditNotes, onOpenTags }: {
  product: TrackedProduct;
  onRemove: (id: string) => void;
  onEditNotes: (id: string, notes: string) => void;
  onOpenTags: (id: string, tags: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', gap: 1.5, p: 1.5, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <Box
          component="img"
          src={product.imageUrl || '/placeholder-product.png'}
          alt=""
          sx={{ width: 55, height: 55, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          onError={(e: any) => { e.target.src = '/placeholder-product.png'; }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={500} noWrap>{product.title}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Typography variant="subtitle2" fontWeight={700}>${(product.currentPrice || 0).toFixed(2)}</Typography>
            {product.snapshots?.length > 1 ? (() => {
              const oldest = product.snapshots[product.snapshots.length - 1];
              const change = oldest.price > 0 ? ((product.currentPrice - oldest.price) / oldest.price) * 100 : 0;
              return <PriceChangeChip change={change} />;
            })() : null}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
            {(product.tags || []).slice(0, 2).map(tag => (
              <Chip key={tag} label={tag} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
            ))}
          </Box>
        </Box>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </Box>
      <Collapse in={expanded}>
        <Divider />
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {product.snapshots?.length > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">İlk Fiyat:</Typography>
              <Typography variant="caption">${product.snapshots[product.snapshots.length - 1].price.toFixed(2)}</Typography>
            </Box>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">Satış:</Typography>
            <Typography variant="caption">{product.totalSold ?? 0}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">Son Kontrol:</Typography>
            <Typography variant="caption">
              {product.lastCheckedAt ? new Date(product.lastCheckedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
            </Typography>
          </Box>
          {(product.itemWebUrl || product.legacyItemId) && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="small" variant="text" component="a" href={product.itemWebUrl || `https://www.ebay.com/itm/${product.legacyItemId}`} target="_blank" rel="noopener noreferrer" startIcon={<ExternalLink size={12} />}>
                eBay'de Gör
              </Button>
            </Box>
          )}
          {/* Price Chart */}
          <Box>
            <Typography variant="caption" color="text.secondary">Fiyat Geçmişi:</Typography>
            <MiniPriceChart snapshots={product.snapshots} />
          </Box>
          {/* Notes */}
          {product.notes && (
            <Box>
              <Typography variant="caption" color="text.secondary">Not:</Typography>
              <Typography variant="caption" display="block">{product.notes}</Typography>
            </Box>
          )}
          <Divider />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="outlined" onClick={() => onEditNotes(product.id, product.notes || '')} startIcon={<Edit3 size={12} />}>
              Not
            </Button>
            <Button size="small" variant="outlined" onClick={() => onOpenTags(product.id, product.tags || [])} startIcon={<Tag size={12} />}>
              Etiket
            </Button>
            <Button size="small" variant="outlined" color="error" onClick={() => onRemove(product.id)} startIcon={<Trash2 size={12} />} sx={{ ml: 'auto' }}>
              Sil
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// TAB 3: Niche Finder
// ---------------------------------------------------------------------------

function NicheFinder({ userId, userListings }: { userId: string; userListings?: any[] }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [keyword, setKeyword] = useState('');
  const [marketplace, setMarketplace] = useState('EBAY_US');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<NicheReport | null>(null);
  const [savedNiches, setSavedNiches] = useState<NicheReport[]>([]);
  const [loadingNiches, setLoadingNiches] = useState(true);
  const [savingNiche, setSavingNiche] = useState(false);
  const [categoryAnalyzing, setCategoryAnalyzing] = useState<string | null>(null);
  const nicheProductSort = useTableSort<ProductResult>(report?.topProducts || [], 'estimatedSold', 'desc');

  const fetchSavedNiches = useCallback(async () => {
    setLoadingNiches(true);
    try {
      const data = await apiCall('saved_niches', userId);
      setSavedNiches(data.niches || []);
    } catch {
      // silent
    } finally {
      setLoadingNiches(false);
    }
  }, [userId]);

  useEffect(() => { fetchSavedNiches(); }, [fetchSavedNiches]);

  const handleAnalyze = useCallback(async () => {
    if (!keyword.trim()) {
      toast.error('Anahtar kelime girin');
      return;
    }
    setLoading(true);
    setReport(null);
    try {
      const data = await apiCall('niche_analyze', userId, { q: keyword, marketplace_id: marketplace });
      const mapped: NicheReport = {
        keyword: data.query || keyword,
        demandScore: data.demandScore || 0,
        competitionScore: data.competitionScore || 0,
        totalListings: data.totalResults || 0,
        uniqueSellers: data.uniqueSellers || 0,
        avgPrice: data.avgPrice || 0,
        medianPrice: data.medianPrice || 0,
        priceMin: data.priceSpread?.min || 0,
        priceMax: data.priceSpread?.max || 0,
        freeShippingPct: data.freeShippingPct || 0,
        sellerConcentration: data.sellerConcentration || 0,
        topProducts: (data.topProducts || []).filter(Boolean).map(mapNicheProduct),
        aspects: [],
        priceDistribution: [],
      };
      setReport(mapped);
    } catch (err: any) {
      toast.error(err.message || 'Analiz başarısız');
    } finally {
      setLoading(false);
    }
  }, [keyword, marketplace, userId]);

  const handleCategoryAnalyze = useCallback(async (categoryId: string, categoryName: string) => {
    setCategoryAnalyzing(categoryId);
    setLoading(true);
    setReport(null);
    setKeyword(categoryName);
    try {
      const data = await apiCall('niche_analyze', userId, { category_id: categoryId, marketplace_id: marketplace });
      const mapped: NicheReport = {
        keyword: categoryName,
        demandScore: data.demandScore || 0,
        competitionScore: data.competitionScore || 0,
        totalListings: data.totalResults || 0,
        uniqueSellers: data.uniqueSellers || 0,
        avgPrice: data.avgPrice || 0,
        medianPrice: data.medianPrice || 0,
        priceMin: data.priceSpread?.min || 0,
        priceMax: data.priceSpread?.max || 0,
        freeShippingPct: data.freeShippingPct || 0,
        sellerConcentration: data.sellerConcentration || 0,
        topProducts: (data.topProducts || []).filter(Boolean).map(mapNicheProduct),
        aspects: [],
        priceDistribution: [],
      };
      setReport(mapped);
    } catch (err: any) {
      toast.error(err.message || 'Kategori analizi basarisiz');
    } finally {
      setLoading(false);
      setCategoryAnalyzing(null);
    }
  }, [marketplace, userId]);

  const handleSaveNiche = useCallback(async () => {
    if (!report) return;
    setSavingNiche(true);
    try {
      await apiPost('save_niche', userId, {
        query: report.keyword,
        marketplace: marketplace || 'EBAY_US',
        totalResults: report.totalListings,
        avgPrice: report.avgPrice,
        medianPrice: report.medianPrice,
        uniqueSellers: report.uniqueSellers,
        demandScore: report.demandScore,
        competitionScore: report.competitionScore,
      });
      toast.success('Niş kaydedildi');
      await fetchSavedNiches();
    } catch (err: any) {
      toast.error(err.message || 'Kaydetme başarısız');
    } finally {
      setSavingNiche(false);
    }
  }, [report, userId, fetchSavedNiches]);

  const handleDeleteNiche = useCallback(async (id: string) => {
    try {
      await apiPost('delete_niche', userId, { id });
      setSavedNiches(prev => prev.filter(n => n.id !== id));
      toast.success('Niş silindi');
    } catch (err: any) {
      toast.error(err.message || 'Silme başarısız');
    }
  }, [userId]);

  const handleLoadNiche = (niche: any) => {
    // Saved niches from DB have `query` field, mapped niches have `keyword`
    const mapped: NicheReport = {
      id: niche.id,
      keyword: niche.keyword || niche.query || '',
      demandScore: niche.demandScore || 0,
      competitionScore: niche.competitionScore || 0,
      totalListings: niche.totalListings || niche.totalResults || 0,
      uniqueSellers: niche.uniqueSellers || 0,
      avgPrice: niche.avgPrice || 0,
      medianPrice: niche.medianPrice || 0,
      priceMin: niche.priceMin || niche.priceSpread?.min || 0,
      priceMax: niche.priceMax || niche.priceSpread?.max || 0,
      freeShippingPct: niche.freeShippingPct || 0,
      sellerConcentration: niche.sellerConcentration || 0,
      topProducts: (niche.topProducts || []).map(mapNicheProduct),
      aspects: niche.aspects || [],
      priceDistribution: niche.priceDistribution || [],
      savedAt: niche.savedAt || niche.createdAt,
    };
    setReport(mapped);
    setKeyword(mapped.keyword);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Box>
      {/* Search */}
      <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
          <Gauge size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Niş Analizi
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Anahtar Kelime veya Kategori"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            sx={{ flex: '2 1 250px' }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
            }}
          />
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Pazar Yeri</InputLabel>
            <Select value={marketplace} label="Pazar Yeri" onChange={e => setMarketplace(e.target.value)}>
              {MARKETPLACES.map(m => (
                <MenuItem key={m.value} value={m.value}>{m.flag} {m.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" onClick={handleAnalyze} disabled={loading} sx={{ minWidth: 110 }}>
            {loading ? <CircularProgress size={20} /> : 'Analiz Et'}
          </Button>
        </Box>
      </Paper>

      {/* Trending Categories — shown when no report */}
      {!report && !loading && (
        <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
            <TrendingUp size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Populer Kategoriler — Tikla, Analiz Otomatik Baslasin
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Anahtar kelime bilmene gerek yok! Bir kategori sec, o niste neler satiliyor gorelim.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {POPULAR_CATEGORIES.map(cat => (
              <Paper
                key={cat.id}
                variant="outlined"
                onClick={() => handleCategoryAnalyze(cat.id, cat.name)}
                sx={{
                  p: 2, cursor: 'pointer', textAlign: 'center',
                  minWidth: isMobile ? '43%' : 130, flex: '1 1 130px', maxWidth: 170,
                  transition: 'all 0.2s',
                  '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover', transform: 'translateY(-2px)', boxShadow: 1 },
                  opacity: categoryAnalyzing === cat.id ? 0.6 : 1,
                }}
              >
                <Typography sx={{ fontSize: '1.5rem', mb: 0.5 }}>{cat.emoji}</Typography>
                <Typography variant="caption" fontWeight={600} sx={{ lineHeight: 1.2 }}>{cat.name}</Typography>
                {categoryAnalyzing === cat.id && <CircularProgress size={14} sx={{ mt: 0.5, display: 'block', mx: 'auto' }} />}
              </Paper>
            ))}
          </Box>
        </Paper>
      )}

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Niche Report Card */}
      {report && (
        <Box>
          {/* Score Cards */}
          <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6" fontWeight={700}>
                &ldquo;{report.keyword}&rdquo; Niş Raporu
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="text"
                  size="small"
                  onClick={() => { setReport(null); setKeyword(''); }}
                >
                  Kesfetmeye Don
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={savingNiche ? <CircularProgress size={14} /> : <Save size={14} />}
                  onClick={handleSaveNiche}
                  disabled={savingNiche}
                >
                  Kaydet
                </Button>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap', mb: 2 }}>
              <Paper variant="outlined" sx={{ minWidth: 140 }}>
                <ScoreDisplay label="Talep Skoru" score={report.demandScore} />
              </Paper>
              <Paper variant="outlined" sx={{ minWidth: 140 }}>
                <ScoreDisplay label="Rekabet Skoru" score={report.competitionScore} invert />
              </Paper>
            </Box>

            {/* Stats Grid */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
              <StatCard icon={<Package size={16} />} label="Toplam Listeleme" value={report.totalListings.toLocaleString('tr-TR')} />
              <StatCard icon={<Users size={16} />} label="Benzersiz Satıcı" value={report.uniqueSellers.toLocaleString('tr-TR')} />
              <StatCard icon={<DollarSign size={16} />} label="Ort. Fiyat" value={`$${report.avgPrice.toFixed(2)}`} />
              <StatCard icon={<Target size={16} />} label="Medyan Fiyat" value={`$${report.medianPrice.toFixed(2)}`} />
              <StatCard icon={<ArrowUpDown size={16} />} label="Fiyat Aralığı" value={`$${report.priceMin.toFixed(0)} - $${report.priceMax.toFixed(0)}`} />
              <StatCard icon={<ShoppingBag size={16} />} label="Ücretsiz Kargo" value={`%${report.freeShippingPct.toFixed(0)}`} />
              <StatCard icon={<Users size={16} />} label="Satıcı Yoğunluğu" value={`%${report.sellerConcentration.toFixed(0)}`} sub="Top 10 satıcı payı" />
            </Box>
          </Paper>

          {/* Price Distribution */}
          {report.priceDistribution && report.priceDistribution.length > 0 && (
            <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                <BarChart2 size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Fiyat Dağılımı
              </Typography>
              <SimpleHistogram data={report.priceDistribution} />
            </Paper>
          )}

          {/* Aspect Analysis */}
          {report.aspects && report.aspects.length > 0 && (
            <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                <FolderTree size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Özellik Analizi
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {report.aspects.slice(0, 30).map(a => (
                  <Chip
                    key={a.name}
                    label={`${a.name} (${a.count})`}
                    size="small"
                    variant="outlined"
                    sx={{
                      bgcolor: `rgba(25, 118, 210, ${Math.min(a.percentage / 100, 0.3)})`,
                      fontWeight: a.percentage > 30 ? 600 : 400,
                    }}
                  />
                ))}
              </Box>
            </Paper>
          )}

          {/* Top Products */}
          {report.topProducts && report.topProducts.length > 0 && (
            <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                <Star size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                En Çok Satan Ürünler
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                      <TableCell>Başlık</TableCell>
                      <TableCell align="right" sortDirection={nicheProductSort.sortKey === 'price' ? nicheProductSort.sortDir : false}>
                        <TableSortLabel active={nicheProductSort.sortKey === 'price'} direction={nicheProductSort.sortKey === 'price' ? nicheProductSort.sortDir : 'desc'} onClick={() => nicheProductSort.handleSort('price')}>
                          Fiyat
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="center" sortDirection={nicheProductSort.sortKey === 'estimatedSold' ? nicheProductSort.sortDir : false}>
                        <TableSortLabel active={nicheProductSort.sortKey === 'estimatedSold'} direction={nicheProductSort.sortKey === 'estimatedSold' ? nicheProductSort.sortDir : 'desc'} onClick={() => nicheProductSort.handleSort('estimatedSold')}>
                          Satış
                        </TableSortLabel>
                      </TableCell>
                      <TableCell>Satıcı</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {nicheProductSort.sorted.slice(0, isMobile ? 10 : 20).map(p => (
                      <TableRow key={p.itemId} hover>
                        <TableCell sx={{ maxWidth: isMobile ? 180 : 350 }}>
                          <Typography
                            variant="body2"
                            component="a"
                            href={p.itemUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: 'primary.main', textDecoration: 'none',
                              '&:hover': { textDecoration: 'underline' },
                              display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                            }}
                          >
                            {p.title}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={600}>${p.price.toFixed(2)}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <SoldBadge count={p.estimatedSold} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">{p.seller}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </Box>
      )}

      {!report && !loading && (
        <EmptyState message="Niş Analizi Başlatın" sub="Anahtar kelime girerek pazar fırsatlarını keşfedin" />
      )}

      {/* Saved Niches */}
      <Divider sx={{ my: 3 }} />
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        <Bookmark size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        Kaydedilen Nişler
      </Typography>

      {loadingNiches ? (
        <Box sx={{ py: 2 }}>
          {[1, 2].map(i => <Skeleton key={i} variant="rectangular" height={60} sx={{ mb: 1, borderRadius: 1 }} />)}
        </Box>
      ) : savedNiches.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          Henüz kaydedilen niş yok.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {savedNiches.map(niche => (
            <Paper key={niche.id} variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1, minWidth: 150 }}>
                <Typography variant="body2" fontWeight={600}>{(niche as any).keyword || (niche as any).query || '—'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {(niche.savedAt || (niche as any).createdAt) ? new Date(niche.savedAt || (niche as any).createdAt).toLocaleDateString('tr-TR') : ''}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip
                  label={`Talep: ${niche.demandScore}`}
                  size="small"
                  sx={{ bgcolor: `${SCORE_COLOR(niche.demandScore)}22`, color: SCORE_COLOR(niche.demandScore), fontWeight: 600 }}
                />
                <Chip
                  label={`Rekabet: ${niche.competitionScore}`}
                  size="small"
                  sx={{ bgcolor: `${SCORE_COLOR(niche.competitionScore, true)}22`, color: SCORE_COLOR(niche.competitionScore, true), fontWeight: 600 }}
                />
                <Chip label={`${niche.totalListings.toLocaleString('tr-TR')} ürün`} size="small" variant="outlined" />
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Tooltip title="Raporu Yükle">
                  <IconButton size="small" onClick={() => handleLoadNiche(niche)}>
                    <Eye size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Sil">
                  <IconButton size="small" color="error" onClick={() => niche.id && handleDeleteNiche(niche.id)}>
                    <Trash2 size={16} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// TAB 4: Seller Tracker
// ---------------------------------------------------------------------------

function SellerTracker({ userId, userListings }: { userId: string; userListings?: any[] }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [sellers, setSellers] = useState<TrackedSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const sellerSort = useTableSort<TrackedSeller>(sellers, 'feedbackScore', 'desc');

  const fetchSellers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall('tracked_sellers', userId);
      setSellers(data.sellers || []);
    } catch (err: any) {
      toast.error(err.message || 'Satıcılar yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchSellers(); }, [fetchSellers]);

  const handleAddSeller = useCallback(async () => {
    if (!username.trim()) return;
    setAdding(true);
    try {
      await apiPost('track_seller', userId, { username: username.trim() });
      toast.success('Satıcı takibe alındı');
      setUsername('');
      await fetchSellers();
    } catch (err: any) {
      toast.error(err.message || 'Satıcı eklenemedi');
    } finally {
      setAdding(false);
    }
  }, [username, userId, fetchSellers]);

  const handleRemoveSeller = useCallback(async (id: string) => {
    try {
      await apiPost('untrack_seller', userId, { id });
      setSellers(prev => prev.filter(s => s.id !== id));
      toast.success('Satıcı takipten çıkarıldı');
    } catch (err: any) {
      toast.error(err.message || 'Silme başarısız');
    }
  }, [userId]);

  const handleSaveNotes = useCallback(async (id: string) => {
    try {
      await apiPost('update_seller', userId, { id, notes: notesText });
      setSellers(prev => prev.map(s => s.id === id ? { ...s, notes: notesText } : s));
      setEditingNotes(null);
      toast.success('Not kaydedildi');
    } catch (err: any) {
      toast.error(err.message || 'Not kaydedilemedi');
    }
  }, [userId, notesText]);

  const handleViewProducts = useCallback((sellerUsername: string) => {
    // Open in new tab or navigate to product database with seller filter
    const url = `https://www.ebay.com/sch/${encodeURIComponent(sellerUsername)}/m.html`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  if (loading) {
    return (
      <Box sx={{ py: 4 }}>
        {[1, 2, 3].map(i => <Skeleton key={i} variant="rectangular" height={70} sx={{ mb: 1, borderRadius: 1 }} />)}
      </Box>
    );
  }

  return (
    <Box>
      {/* Add Seller Form */}
      <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
          <Users size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Satıcı Takip Et
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="eBay Kullanıcı Adı"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddSeller()}
            sx={{ flex: 1 }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Users size={16} /></InputAdornment>,
            }}
          />
          <Button
            variant="contained"
            onClick={handleAddSeller}
            disabled={adding || !username.trim()}
            sx={{ minWidth: 100 }}
          >
            {adding ? <CircularProgress size={18} /> : 'Takip Et'}
          </Button>
        </Box>
      </Paper>

      {/* Seller List */}
      {sellers.length === 0 ? (
        <EmptyState
          message="Henüz takip edilen satıcı yok"
          sub="Yukarıdaki alana eBay kullanıcı adı girerek satıcı takip edin."
        />
      ) : isMobile ? (
        /* Mobile Card View */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {sellers.map(seller => (
            <Paper key={seller.id} variant="outlined" sx={{ p: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                <Box>
                  <Typography variant="subtitle2" fontWeight={700}>{seller.sellerUsername}</Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                    <Chip
                      icon={<Star size={12} />}
                      label={(seller.feedbackScore || 0).toLocaleString('tr-TR')}
                      size="small"
                      variant="outlined"
                      sx={{ height: 22 }}
                    />
                    <Chip
                      label={`%${seller.feedbackPct || '0'} olumlu`}
                      size="small"
                      sx={{
                        height: 22,
                        bgcolor: parseFloat(seller.feedbackPct || '0') >= 98 ? '#e8f5e9' : parseFloat(seller.feedbackPct || '0') >= 95 ? '#fff3e0' : '#ffebee',
                        color: parseFloat(seller.feedbackPct || '0') >= 98 ? '#2e7d32' : parseFloat(seller.feedbackPct || '0') >= 95 ? '#ed6c02' : '#c62828',
                      }}
                    />
                  </Box>
                </Box>
                <IconButton size="small" color="error" onClick={() => handleRemoveSeller(seller.id)}>
                  <Trash2 size={16} />
                </IconButton>
              </Box>

              {/* Notes */}
              <Box sx={{ mb: 1 }}>
                {editingNotes === seller.id ? (
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    <TextField
                      size="small"
                      fullWidth
                      value={notesText}
                      onChange={e => setNotesText(e.target.value)}
                      multiline
                      maxRows={3}
                    />
                    <IconButton size="small" color="primary" onClick={() => handleSaveNotes(seller.id)}>
                      <Save size={14} />
                    </IconButton>
                    <IconButton size="small" onClick={() => setEditingNotes(null)}>
                      <X size={14} />
                    </IconButton>
                  </Box>
                ) : (
                  <Typography
                    variant="caption"
                    sx={{ cursor: 'pointer', color: seller.notes ? 'text.primary' : 'text.secondary', '&:hover': { color: 'primary.main' } }}
                    onClick={() => { setEditingNotes(seller.id); setNotesText(seller.notes || ''); }}
                  >
                    {seller.notes || 'Not ekle...'}
                  </Typography>
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  fullWidth
                  startIcon={<Eye size={14} />}
                  onClick={() => handleViewProducts(seller.sellerUsername)}
                >
                  Ürünleri Gör
                </Button>
              </Box>

              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, textAlign: 'right' }}>
                Son kontrol: {seller.lastCheckedAt ? new Date(seller.lastCheckedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
              </Typography>
            </Paper>
          ))}
        </Box>
      ) : (
        /* Desktop Table View */
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                <TableCell>Kullanıcı Adı</TableCell>
                <TableCell align="center" sortDirection={sellerSort.sortKey === 'feedbackScore' ? sellerSort.sortDir : false}>
                  <TableSortLabel active={sellerSort.sortKey === 'feedbackScore'} direction={sellerSort.sortKey === 'feedbackScore' ? sellerSort.sortDir : 'desc'} onClick={() => sellerSort.handleSort('feedbackScore')}>
                    Puan
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center">Olumlu %</TableCell>
                <TableCell>Notlar</TableCell>
                <TableCell align="center">Son Kontrol</TableCell>
                <TableCell align="center">Aksiyonlar</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sellerSort.sorted.map(seller => (
                <TableRow key={seller.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{seller.sellerUsername}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      icon={<Star size={12} />}
                      label={(seller.feedbackScore || 0).toLocaleString('tr-TR')}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        color: parseFloat(seller.feedbackPct || '0') >= 98 ? '#2e7d32' : parseFloat(seller.feedbackPct || '0') >= 95 ? '#ed6c02' : '#c62828',
                      }}
                    >
                      %{seller.feedbackPct || '0'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>
                    {editingNotes === seller.id ? (
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <TextField
                          size="small"
                          value={notesText}
                          onChange={e => setNotesText(e.target.value)}
                          multiline
                          maxRows={2}
                          sx={{ flex: 1 }}
                        />
                        <IconButton size="small" color="primary" onClick={() => handleSaveNotes(seller.id)}>
                          <Save size={14} />
                        </IconButton>
                        <IconButton size="small" onClick={() => setEditingNotes(null)}>
                          <X size={14} />
                        </IconButton>
                      </Box>
                    ) : (
                      <Typography
                        variant="caption"
                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                        onClick={() => { setEditingNotes(seller.id); setNotesText(seller.notes || ''); }}
                      >
                        {seller.notes || 'Not ekle...'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="caption" color="text.secondary">
                      {seller.lastCheckedAt ? new Date(seller.lastCheckedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                      <Tooltip title="Ürünleri Gör">
                        <IconButton size="small" onClick={() => handleViewProducts(seller.sellerUsername)}>
                          <Eye size={16} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Kaldır">
                        <IconButton size="small" color="error" onClick={() => handleRemoveSeller(seller.id)}>
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

const SECTIONS = [
  {
    label: 'Arastirma',
    icon: <Search size={18} />,
    description: 'Pazar analizi ve urun kesfetme araclari',
    welcome: 'eBay pazarini analiz edin, trendleri kesfet ve karli nisler bulun',
    subTabs: [
      { label: 'Urun Veritabani', icon: <Package size={14} /> },
      { label: 'Kategori & Nis Bulucu', icon: <Gauge size={14} /> },
      { label: 'Anahtar Kelime Analizi', icon: <Tag size={14} /> },
    ],
  },
  {
    label: 'Takip',
    icon: <Bookmark size={18} />,
    description: 'Urun ve satici takip merkezi',
    welcome: 'Rakiplerinizi ve ilgilendiginiz urunleri yakindan takip edin',
    subTabs: [
      { label: 'Urun Takipcisi', icon: <Bookmark size={14} /> },
      { label: 'Satici Takipcisi', icon: <Users size={14} /> },
      { label: 'Rakip Analizi', icon: <Eye size={14} /> },
    ],
  },
  {
    label: 'Optimizasyon',
    icon: <TrendingUp size={18} />,
    description: 'Liste ve finansal iyilestirme',
    welcome: 'Listelerinizi iyilestirin ve karliligimizi artirin',
    subTabs: [
      { label: 'Liste Iyilestirme', icon: <Target size={14} /> },
      { label: 'Finansal Hesaplamalar', icon: <DollarSign size={14} /> },
    ],
  },
];

function SectionWelcome({ section, userListings = [], sectionIndex }: { section: typeof SECTIONS[number]; userListings?: any[]; sectionIndex?: number }) {
  const hasListings = userListings.length > 0;

  const personalizedMessage = hasListings
    ? sectionIndex === 0
      ? `${userListings.length} aktif listelemeniz var. Araclarimiz senin kategorilerin ve urunlerin uzerinden otomatik analiz yapacak.`
      : sectionIndex === 1
        ? 'Rakiplerini otomatik tespit ettik. Takip etmeye basla.'
        : sectionIndex === 2
          ? 'Listelerinizi analiz ettik. Iyilestirme onerilerimizi gorun.'
          : null
    : null;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 4,
        textAlign: 'center',
        borderStyle: 'dashed',
        borderColor: 'primary.light',
        bgcolor: 'action.hover',
        borderRadius: 3,
      }}
    >
      <Box sx={{ color: 'primary.main', mb: 2 }}>{React.cloneElement(section.icon as React.ReactElement, { size: 40, strokeWidth: 1.5 })}</Box>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
        {section.label}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 480, mx: 'auto' }}>
        {section.welcome}
      </Typography>
      {personalizedMessage && (
        <Typography variant="body2" color="primary.main" fontWeight={600} sx={{ mb: 2, maxWidth: 480, mx: 'auto' }}>
          {personalizedMessage}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        Baslamak icin yukaridaki araclardan birini secin.
      </Typography>
    </Paper>
  );
}

function EbayResearchPage() {
  const { user } = useAuth() as any;
  const userId = user?.id as string | undefined;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mainTab, setMainTab] = useState(0);
  const [subTab, setSubTab] = useState(-1); // -1 = welcome state
  const [userListings, setUserListings] = useState<any[]>([]);
  const [userListingsLoading, setUserListingsLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    setUserListingsLoading(true);
    console.log('[eBay Research] Fetching user listings for userId:', userId);
    fetch(`/api/clawd/ebay?action=my_legacy_listings&user_id=${userId}&marketplace_id=EBAY_US`, {
      credentials: 'same-origin',
    })
      .then(async (r) => {
        console.log('[eBay Research] Listings response status:', r.status);
        if (!r.ok) {
          const errText = await r.text().catch(() => '');
          console.error('[eBay Research] Listings fetch failed:', r.status, errText);
          return { listings: [] };
        }
        return r.json();
      })
      .then(data => {
        console.log('[eBay Research] Got listings:', data.listings?.length || 0);
        setUserListings(data.listings || []);
      })
      .catch((err) => {
        console.error('[eBay Research] Listings fetch error:', err);
        setUserListings([]);
      })
      .finally(() => setUserListingsLoading(false));
  }, [userId]);

  const handleMainTabChange = (_: any, v: number) => {
    setMainTab(v);
    setSubTab(-1); // reset to welcome when switching sections
  };

  if (!userId) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <CircularProgress />
      </Box>
    );
  }

  const currentSection = SECTIONS[mainTab];

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto', px: isMobile ? 1 : 3, py: 2 }}>
      <Toaster position="top-right" />

      {/* Header */}
      <Box sx={{ mb: 2 }}>
        <Typography variant={isMobile ? 'h6' : 'h5'} fontWeight={800}>
          eBay Urun Istihbarati
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Pazar arastirmasi, urun takibi, nis analizi ve rakip izleme
        </Typography>
      </Box>

      {/* Main Section Tabs */}
      <Paper sx={{ mb: 2 }} variant="outlined">
        <Tabs
          value={mainTab}
          onChange={handleMainTabChange}
          variant="fullWidth"
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              minHeight: 64,
              py: 1.5,
            },
          }}
        >
          {SECTIONS.map((section, i) => (
            <Tab
              key={i}
              label={
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {section.icon}
                    <span style={{ fontWeight: 700, fontSize: isMobile ? '0.85rem' : '0.95rem' }}>{section.label}</span>
                  </Box>
                  {!isMobile && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}>
                      {section.description}
                    </Typography>
                  )}
                </Box>
              }
            />
          ))}
        </Tabs>
      </Paper>

      {/* Sub-tab pills */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {currentSection.subTabs.map((st, i) => (
          <Chip
            key={i}
            icon={st.icon as React.ReactElement}
            label={st.label}
            clickable
            onClick={() => setSubTab(i)}
            variant={subTab === i ? 'filled' : 'outlined'}
            color={subTab === i ? 'primary' : 'default'}
            sx={{
              fontWeight: subTab === i ? 700 : 500,
              fontSize: '0.8rem',
              height: 36,
              px: 0.5,
              '& .MuiChip-icon': { fontSize: 14 },
              transition: 'all 0.15s ease',
              ...(subTab === i
                ? {}
                : {
                    '&:hover': {
                      bgcolor: 'action.hover',
                      borderColor: 'primary.main',
                    },
                  }),
            }}
          />
        ))}
      </Box>

      {/* User listings status bar */}
      {userListingsLoading && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', gap: 1, bgcolor: '#f0f7ff' }}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">
            eBay listeleriniz yukleniyor...
          </Typography>
        </Paper>
      )}
      {!userListingsLoading && userListings.length > 0 && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', gap: 1, bgcolor: '#f0fff4' }}>
          <Typography variant="body2" color="success.main" fontWeight={600}>
            {userListings.length} aktif listelemeniz yuklendi — araclar otomatik olarak verilerinizi kullanacak.
          </Typography>
        </Paper>
      )}
      {!userListingsLoading && userListings.length === 0 && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fff8f0' }}>
          <Typography variant="body2" color="warning.main">
            eBay listeleriniz yuklenemedi. Araclar manual arama ile calisir.
          </Typography>
          <Button size="small" variant="outlined" onClick={() => {
            setUserListingsLoading(true);
            fetch(`/api/clawd/ebay?action=my_legacy_listings&user_id=${userId}&marketplace_id=EBAY_US`, {
              credentials: 'same-origin',
            })
              .then(async (r) => r.ok ? r.json() : { listings: [] })
              .then(data => setUserListings(data.listings || []))
              .catch(() => setUserListings([]))
              .finally(() => setUserListingsLoading(false));
          }}>
            Tekrar Dene
          </Button>
        </Paper>
      )}

      {/* Welcome state or active tool */}
      {subTab === -1 && <SectionWelcome section={currentSection} userListings={userListings} sectionIndex={mainTab} />}

      {/* Section 0: Arastirma */}
      {mainTab === 0 && subTab === 0 && <ProductDatabase userId={userId} userListings={userListings} userListingsLoading={userListingsLoading} />}
      {mainTab === 0 && subTab === 1 && <NicheFinder userId={userId} userListings={userListings} />}
      {mainTab === 0 && subTab === 2 && <KeywordIntelligence userId={userId} marketplace="EBAY_US" userListings={userListings} />}

      {/* Section 1: Takip */}
      {mainTab === 1 && subTab === 0 && <ProductTracker userId={userId} userListings={userListings} />}
      {mainTab === 1 && subTab === 1 && <SellerTracker userId={userId} userListings={userListings} />}
      {mainTab === 1 && subTab === 2 && <CompetitiveIntelligence userId={userId} marketplace="EBAY_US" userListings={userListings} />}

      {/* Section 2: Optimizasyon */}
      {mainTab === 2 && subTab === 0 && <ListingOptimizer userId={userId} marketplace="EBAY_US" userListings={userListings} />}
      {mainTab === 2 && subTab === 1 && <FinancialIntelligence userId={userId} marketplace="EBAY_US" userListings={userListings} />}
    </Box>
  );
}

// --- Layout wrapper ---
function EbayResearchPageWithLayout(props: any): JSX.Element {
  return (
    <AppLayout title="eBay Ürün İstihbaratı — KolayXport">
      <EbayResearchPage {...props} />
    </AppLayout>
  );
}

export default withAuth(EbayResearchPageWithLayout);
