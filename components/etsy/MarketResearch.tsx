import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Alert, Tabs, Tab, Tooltip, IconButton,
  CircularProgress, InputAdornment, Switch, FormControlLabel,
} from '@mui/material';
import {
  Search, TrendingUp, DollarSign, Tag, BarChart2, ExternalLink,
  CheckCircle, XCircle, Users, Store, Gauge, Calculator,
  Download, Bookmark, Copy, Star, Trash2, Info, Sparkles, Hash,
  Eye, Heart, ShoppingBag, ArrowUpDown, Compass, Activity,
  Zap, Globe, ShoppingCart, Target, Calendar, ArrowRight,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EtsyMarketResearchProps {
  userId: string;
  shopId?: string;
  userListings?: any[];
}

interface EtsyMarketItem {
  listing_id: number;
  title: string;
  description: string;
  price: number;
  currency_code: string;
  views: number;
  num_favorers: number;
  tags: string[];
  shop_id: number;
  taxonomy_id: number;
  url: string;
  quantity: number;
  image_url: string;
  created_timestamp: number;
  state: string;
}

interface TagData { tag: string; count: number; pct: number; }
interface KeywordData { keyword: string; count: number; pct: number; inMyTitle?: boolean; }

interface ShopData {
  shop_id: number; shop_name: string; num_sales: number;
  review_count: number; review_average: number; listing_active_count: number;
  url: string; icon_url: string; avgPrice?: number; listingCount?: number;
}

interface SavedSearch {
  query: string; minPrice: string; maxPrice: string; sortOn: string;
  myTitle: string; myTags: string; timestamp: number;
}

interface AiAnalysis {
  opportunity_score: number; opportunity_level: string; market_summary: string;
  pricing_strategy: string; tag_recommendations: string[]; title_recommendations: string;
  niche_positioning: string; seasonal_advice: string; competition_analysis: string;
  action_items: string[];
}

interface TrendData {
  timeline: { date: string; value: number }[];
  averageInterest: number; peakValue: number; peakDate: string;
  trendDirection: string;
  risingQueries: { query: string; value: string }[];
  topQueries: { query: string; value: number }[];
}

interface AutocompleteSuggestion {
  keyword: string; sources: string[]; sourceCount: number; frequency: number; score: number;
  trendScore?: number; competition?: number;
}

interface SeasonalData {
  monthlyTrends: { month: string; value: number }[];
  wikiPageviews: { month: string; views: number }[];
  peakMonth: string; lowMonth: string; hasData: boolean;
}

// ---------------------------------------------------------------------------
// Premium Design System
// ---------------------------------------------------------------------------

const GRADIENTS = {
  primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  success: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
  warning: 'linear-gradient(135deg, #F2994A 0%, #F2C94C 100%)',
  danger: 'linear-gradient(135deg, #eb3349 0%, #f45c43 100%)',
  info: 'linear-gradient(135deg, #2196F3 0%, #21CBF3 100%)',
  purple: 'linear-gradient(135deg, #7B1FA2 0%, #E040FB 100%)',
  dark: 'linear-gradient(135deg, #434343 0%, #000000 100%)',
};

const glassCard = {
  background: 'rgba(255,255,255,0.85)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: '16px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
  transition: 'transform 0.2s, box-shadow 0.2s',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
  },
};

const pillTabsSx = {
  mb: 2,
  '& .MuiTabs-indicator': { display: 'none' },
  '& .MuiTabs-flexContainer': { gap: '6px' },
  '& .MuiTab-root': {
    minHeight: 36, borderRadius: '20px', textTransform: 'none',
    fontSize: '0.78rem', fontWeight: 500, px: 1.5, py: 0.5,
    border: '1px solid #e0e0e0', color: '#666',
    transition: 'all 0.2s',
    '&.Mui-selected': {
      background: GRADIENTS.primary, color: '#fff',
      border: '1px solid transparent', fontWeight: 600,
      boxShadow: '0 2px 8px rgba(102,126,234,0.3)',
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'are', 'was', 'were',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'not', 'no', 'set', '&', '-', '/', '|', '+', 'x',
]);

function extractWords(title: string): string[] {
  return title.toLowerCase().split(/[\s,;:!?()[\]{}""''|\/\-]+/).filter(
    (w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w),
  );
}

function extractNgrams(titles: string[], n: number): { phrase: string; count: number; percentage: number }[] {
  const freq: Record<string, number> = {};
  titles.forEach((title) => {
    const words = extractWords(title);
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      freq[phrase] = (freq[phrase] || 0) + 1;
    }
  });
  return Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([phrase, count]) => ({ phrase, count, percentage: Math.round((count / titles.length) * 100) }));
}

const PRICE_RANGES = [
  { label: '$0 - $10', min: 0, max: 10 },
  { label: '$10 - $25', min: 10, max: 25 },
  { label: '$25 - $50', min: 25, max: 50 },
  { label: '$50 - $100', min: 50, max: 100 },
  { label: '$100 - $250', min: 100, max: 250 },
  { label: '$250+', min: 250, max: Infinity },
];

const SAVED_KEY = 'kolayxport_etsy_saved_searches';
function loadSavedSearches(): SavedSearch[] {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
}
function saveSavedSearches(list: SavedSearch[]) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 20)));
}

// SVG Score Ring
function ScoreRing({ score, size = 120, label, color }: { score: number; size?: number; label: string; color?: string }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const ringColor = color || (score >= 70 ? '#11998e' : score >= 40 ? '#F2994A' : '#eb3349');

  return (
    <Box sx={{ position: 'relative', width: size, height: size, mx: 'auto' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f0f0f0" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor}
          strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <Box sx={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        textAlign: 'center',
      }}>
        <Typography sx={{ fontSize: size * 0.25, fontWeight: 800, color: ringColor, lineHeight: 1 }}>
          {score}
        </Typography>
        <Typography sx={{ fontSize: size * 0.1, color: 'text.secondary', mt: 0.3 }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );
}

// Stat Card (glass morphism)
function StatCard({ label, value, color, icon, gradient }: {
  label: string; value: string; color: string; icon?: React.ReactNode; gradient?: string;
}) {
  return (
    <Paper sx={{
      ...glassCard, p: 2, flex: 1, minWidth: 110, textAlign: 'center',
      ...(gradient ? { background: gradient, color: '#fff', border: 'none',
        '& .MuiTypography-root': { color: '#fff' },
      } : {}),
    }}>
      {icon && <Box sx={{ mb: 0.5, opacity: 0.8 }}>{icon}</Box>}
      <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 500 }}>{label}</Typography>
      <Typography variant="h5" sx={{ color: gradient ? '#fff' : color, fontWeight: 800 }}>{value}</Typography>
    </Paper>
  );
}

// Gradient bar
function GradientBar({ value, max, height = 10 }: { value: number; max: number; height?: number }) {
  const pctVal = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <Box sx={{ width: '100%', bgcolor: '#f0f0f0', borderRadius: height / 2, height, overflow: 'hidden' }}>
      <Box sx={{
        width: `${pctVal}%`, height, borderRadius: height / 2,
        background: GRADIENTS.primary,
        transition: 'width 0.5s ease-out',
      }} />
    </Box>
  );
}

// Source badge
function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    google: '#4285F4', amazon: '#FF9900', etsy: '#F1641E',
  };
  return (
    <Box component="span" sx={{
      display: 'inline-block', px: 0.8, py: 0.1, borderRadius: 1,
      fontSize: '0.65rem', fontWeight: 600, color: '#fff', mr: 0.3,
      bgcolor: colors[source] || '#999',
    }}>
      {source === 'google' ? 'G' : source === 'amazon' ? 'A' : 'E'}
    </Box>
  );
}

// Mini trend sparkline
function Sparkline({ data, width = 80, height = 24, color = '#667eea' }: {
  data: number[]; width?: number; height?: number; color?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Trend line chart (SVG)
function TrendChart({ data, height = 200, color = '#667eea' }: {
  data: { date: string; value: number }[]; height?: number; color?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const width = '100%';
  const svgW = 600;
  const padding = { top: 10, right: 10, bottom: 30, left: 40 };
  const chartW = svgW - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartW,
    y: padding.top + chartH - (d.value / max) * chartH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${padding.top + chartH} L${points[0].x},${padding.top + chartH} Z`;

  return (
    <svg viewBox={`0 0 ${svgW} ${height}`} style={{ width, height: 'auto' }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {[0, 25, 50, 75, 100].map(pv => {
        const y = padding.top + chartH - (pv / 100) * chartH;
        return (
          <g key={pv}>
            <line x1={padding.left} y1={y} x2={svgW - padding.right} y2={y} stroke="#f0f0f0" strokeWidth="1" />
            <text x={padding.left - 5} y={y + 4} textAnchor="end" fill="#999" fontSize="10">{Math.round(pv / 100 * max)}</text>
          </g>
        );
      })}
      {/* Area fill */}
      <path d={areaPath} fill="url(#areaGrad)" />
      {/* Line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dots on peak/low */}
      {points.map((p, i) => {
        const isPeak = data[i].value === max;
        return isPeak ? (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill={color} stroke="#fff" strokeWidth="2" />
        ) : null;
      })}
      {/* X axis labels (every 4th) */}
      {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((d, i) => {
        const idx = data.indexOf(d);
        return (
          <text key={i} x={points[idx].x} y={height - 5} textAnchor="middle" fill="#999" fontSize="9">
            {d.date}
          </text>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EtsyMarketResearch({ userId, shopId, userListings }: EtsyMarketResearchProps) {
  // --- controls ---
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState('');
  const [myTitle, setMyTitle] = useState('');
  const [myTags, setMyTags] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortOn, setSortOn] = useState('score');
  const [loading, setLoading] = useState(false);

  // --- data ---
  const [items, setItems] = useState<EtsyMarketItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [serverTagFreq, setServerTagFreq] = useState<TagData[]>([]);
  const [serverKeywords, setServerKeywords] = useState<KeywordData[]>([]);
  const [serverShopIds, setServerShopIds] = useState<number[]>([]);

  // --- shops ---
  const [discoveredShops, setDiscoveredShops] = useState<ShopData[]>([]);
  const [shopsLoading, setShopsLoading] = useState(false);

  // --- shop deep dive ---
  const [deepDiveShopId, setDeepDiveShopId] = useState('');
  const [deepDiveShop, setDeepDiveShop] = useState<ShopData | null>(null);
  const [deepDiveListings, setDeepDiveListings] = useState<EtsyMarketItem[]>([]);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);

  // --- AI ---
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // --- competitor listing sort ---
  const [compSort, setCompSort] = useState<'none' | 'price_asc' | 'price_desc' | 'favorites' | 'views' | 'engagement'>('none');
  const [visibleCount, setVisibleCount] = useState(20);

  // --- profit calc ---
  const [purchaseCost, setPurchaseCost] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [includeOffsiteAds, setIncludeOffsiteAds] = useState(false);

  // --- keyword filter ---
  const [kwShowMissing, setKwShowMissing] = useState(false);

  // --- saved ---
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);

  // --- NEW: Keyword Explorer ---
  const [kwExplorerQuery, setKwExplorerQuery] = useState('');
  const [kwSuggestions, setKwSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [kwExplorerLoading, setKwExplorerLoading] = useState(false);
  const [kwAlphabetSoup, setKwAlphabetSoup] = useState(false);

  // --- NEW: Trend Analysis ---
  const [trendData, setTrendData] = useState<TrendData | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [seasonalData, setSeasonalData] = useState<SeasonalData | null>(null);
  const [seasonalLoading, setSeasonalLoading] = useState(false);

  useEffect(() => { setSavedSearches(loadSavedSearches()); }, []);

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  const searchMarket = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setVisibleCount(20);
    setCompSort('none');
    setAiAnalysis(null);
    try {
      const params = new URLSearchParams({
        action: 'search_market', keywords: query.trim(),
        limit: '200', sort_on: sortOn, sort_order: 'desc',
      });
      if (minPrice) params.set('min_price', minPrice);
      if (maxPrice) params.set('max_price', maxPrice);

      const res = await fetch(`/api/clawd/etsy?${params}`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Arama basarisiz'); }
      const data = await res.json();
      setItems(data.items || []);
      setTotalResults(data.total || 0);
      setServerTagFreq(data.tagFrequency || []);
      setServerKeywords(data.titleKeywords || []);
      setServerShopIds(data.shopIds || []);
      toast.success(`${data.total?.toLocaleString()} sonuc bulundu`);
      if (data.shopIds?.length > 0) discoverShops(data.shopIds);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [query, sortOn, minPrice, maxPrice]);

  const discoverShops = useCallback(async (shopIds: number[]) => {
    setShopsLoading(true);
    try {
      const ids = shopIds.slice(0, 20).join(',');
      const res = await fetch(`/api/clawd/etsy?action=batch_shops&shop_ids=${ids}`);
      if (!res.ok) throw new Error('Magaza bilgileri alinamadi');
      const data = await res.json();
      setDiscoveredShops(data.shops || []);
    } catch (err: any) { console.error('Shop discovery error:', err); }
    finally { setShopsLoading(false); }
  }, []);

  const searchShopDeepDive = useCallback(async () => {
    if (!deepDiveShopId.trim()) return;
    setDeepDiveLoading(true);
    setDeepDiveShop(null);
    setDeepDiveListings([]);
    try {
      const [shopRes, listingsRes] = await Promise.all([
        fetch(`/api/clawd/etsy?action=get_public_shop&target_shop_id=${deepDiveShopId.trim()}`),
        fetch(`/api/clawd/etsy?action=get_public_shop_listings&target_shop_id=${deepDiveShopId.trim()}&limit=200`),
      ]);
      if (!shopRes.ok) throw new Error('Magaza bulunamadi');
      const shopData = await shopRes.json();
      setDeepDiveShop(shopData);
      if (listingsRes.ok) {
        const listData = await listingsRes.json();
        setDeepDiveListings(listData.listings || []);
      }
      toast.success(`${shopData.shop_name} - ${shopData.num_sales} satis`);
    } catch (err: any) { toast.error(err.message); }
    finally { setDeepDiveLoading(false); }
  }, [deepDiveShopId]);

  const generateAiInsights = useCallback(async () => {
    if (items.length === 0) { toast.error('Oncelikle bir arama yapin'); return; }
    setAiLoading(true);
    try {
      const avgFavorites = items.reduce((s, i) => s + i.num_favorers, 0) / items.length;
      const avgViews = items.reduce((s, i) => s + i.views, 0) / items.length;
      const prices = items.map(i => i.price).filter(p => p > 0).sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);

      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'market_analysis', query, totalResults,
          priceStats: prices.length > 0 ? {
            min: prices[0], max: prices[prices.length - 1],
            avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
            median: prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid],
          } : null,
          topTags: serverTagFreq.slice(0, 20),
          topKeywords: serverKeywords.slice(0, 15),
          shopCount: discoveredShops.length || serverShopIds.length,
          avgFavorites: Math.round(avgFavorites),
          avgViews: Math.round(avgViews),
          topShops: discoveredShops.slice(0, 5),
        }),
      });
      if (!res.ok) throw new Error('AI analizi basarisiz');
      const data = await res.json();
      setAiAnalysis(data.analysis);
      toast.success('AI analizi tamamlandi');
    } catch (err: any) { toast.error(err.message); }
    finally { setAiLoading(false); }
  }, [items, query, totalResults, serverTagFreq, serverKeywords, discoveredShops, serverShopIds]);

  // --- NEW: Keyword Explorer ---
  const searchKeywords = useCallback(async () => {
    const kw = kwExplorerQuery.trim() || query.trim();
    if (!kw) { toast.error('Anahtar kelime girin'); return; }
    setKwExplorerLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'autocomplete', keyword: kw,
        ...(kwAlphabetSoup ? { alphabet: 'true' } : {}),
      });
      const res = await fetch(`/api/trends/etsy?${params}`);
      if (!res.ok) throw new Error('Anahtar kelime onerisi basarisiz');
      const data = await res.json();
      setKwSuggestions(data.suggestions || []);
      toast.success(`${data.totalFound} oneri bulundu`);
    } catch (err: any) { toast.error(err.message); }
    finally { setKwExplorerLoading(false); }
  }, [kwExplorerQuery, query, kwAlphabetSoup]);

  // --- NEW: Trend Analysis ---
  const fetchTrends = useCallback(async () => {
    const kw = query.trim();
    if (!kw) { toast.error('Oncelikle ana aramada bir kelime girin'); return; }
    setTrendLoading(true);
    setSeasonalLoading(true);
    try {
      const [trendRes, seasonalRes] = await Promise.all([
        fetch(`/api/trends/etsy?action=google_trends&keyword=${encodeURIComponent(kw)}`),
        fetch(`/api/trends/etsy?action=seasonal_trends&keyword=${encodeURIComponent(kw)}`),
      ]);

      if (trendRes.ok) {
        const data = await trendRes.json();
        setTrendData(data);
      }
      if (seasonalRes.ok) {
        const data = await seasonalRes.json();
        setSeasonalData(data);
      }
      toast.success('Trend verileri yuklendi');
    } catch (err: any) { toast.error(err.message); }
    finally { setTrendLoading(false); setSeasonalLoading(false); }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') searchMarket();
  };

  // ---------------------------------------------------------------------------
  // Computed: Prices
  // ---------------------------------------------------------------------------

  const prices = useMemo(() => items.map(i => i.price).filter(p => p > 0).sort((a, b) => a - b), [items]);

  const priceStats = useMemo(() => {
    if (prices.length === 0) return null;
    const sum = prices.reduce((a, b) => a + b, 0);
    const mid = Math.floor(prices.length / 2);
    return {
      min: prices[0], max: prices[prices.length - 1],
      avg: Math.round((sum / prices.length) * 100) / 100,
      median: prices.length % 2 === 0 ? Math.round(((prices[mid - 1] + prices[mid]) / 2) * 100) / 100 : prices[mid],
      count: prices.length,
    };
  }, [prices]);

  const histogram = useMemo(() => {
    if (prices.length === 0) return [];
    const bucketCount = 12;
    const lo = prices[0];
    const hi = prices[prices.length - 1];
    if (hi === lo) return [{ label: fmt(lo), count: prices.length }];
    const step = (hi - lo) / bucketCount;
    return Array.from({ length: bucketCount }, (_, i) => {
      const bMin = lo + i * step;
      const bMax = lo + (i + 1) * step;
      const count = prices.filter(p => i === bucketCount - 1 ? p >= bMin && p <= bMax : p >= bMin && p < bMax).length;
      return { label: fmt(bMin), count };
    });
  }, [prices]);

  const maxBucketCount = useMemo(() => Math.max(...histogram.map(b => b.count), 1), [histogram]);

  const priceRangeBreakdown = useMemo(() =>
    PRICE_RANGES.map(r => {
      const count = prices.filter(p => p >= r.min && p < r.max).length;
      return { ...r, count, pct: prices.length ? (count / prices.length) * 100 : 0 };
    }),
  [prices]);

  const sweetSpot = useMemo(() => {
    if (items.length < 5) return null;
    const ranges = PRICE_RANGES.map(r => {
      const inRange = items.filter(i => i.price >= r.min && i.price < r.max);
      if (inRange.length === 0) return { ...r, avgFav: 0, count: 0 };
      const avgFav = inRange.reduce((s, i) => s + i.num_favorers, 0) / inRange.length;
      return { ...r, avgFav: Math.round(avgFav), count: inRange.length };
    }).filter(r => r.count >= 2);
    if (ranges.length === 0) return null;
    return ranges.sort((a, b) => b.avgFav - a.avgFav)[0];
  }, [items]);

  // ---------------------------------------------------------------------------
  // Computed: Keywords
  // ---------------------------------------------------------------------------

  const allTitles = useMemo(() => items.map(i => i.title), [items]);
  const myTitleWords = useMemo(() => new Set(extractWords(myTitle)), [myTitle]);

  const enrichedKeywords = useMemo(() => {
    if (serverKeywords.length > 0) {
      return serverKeywords.map(k => ({ ...k, inMyTitle: myTitleWords.has(k.keyword) }));
    }
    const wordFreq: Record<string, number> = {};
    allTitles.forEach(title => { extractWords(title).forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; }); });
    return Object.entries(wordFreq)
      .sort(([, a], [, b]) => b - a).slice(0, 50)
      .map(([keyword, count]) => ({
        keyword, count, pct: Math.round((count / Math.max(allTitles.length, 1)) * 100),
        inMyTitle: myTitleWords.has(keyword),
      }));
  }, [serverKeywords, allTitles, myTitleWords]);

  const bigrams = useMemo(() => extractNgrams(allTitles, 2), [allTitles]);
  const trigrams = useMemo(() => extractNgrams(allTitles, 3), [allTitles]);

  // ---------------------------------------------------------------------------
  // Computed: Tags
  // ---------------------------------------------------------------------------

  const myTagsSet = useMemo(() => {
    const tags = myTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (userListings?.length) {
      userListings.forEach(l => { (l.tags || []).forEach((t: string) => tags.push(t.toLowerCase().trim())); });
    }
    return new Set(tags);
  }, [myTags, userListings]);

  const enrichedTags = useMemo(() => serverTagFreq.map(t => ({ ...t, inMyTags: myTagsSet.has(t.tag) })), [serverTagFreq, myTagsSet]);
  const tagGaps = useMemo(() => enrichedTags.filter(t => !t.inMyTags && t.pct >= 5), [enrichedTags]);

  const tagCombos = useMemo(() => {
    if (items.length === 0) return [];
    const pairFreq: Record<string, { count: number; totalFav: number }> = {};
    items.forEach(item => {
      const tags = (item.tags || []).map(t => t.toLowerCase().trim()).filter(Boolean);
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < Math.min(tags.length, i + 5); j++) {
          const pair = [tags[i], tags[j]].sort().join(' + ');
          if (!pairFreq[pair]) pairFreq[pair] = { count: 0, totalFav: 0 };
          pairFreq[pair].count++;
          pairFreq[pair].totalFav += item.num_favorers;
        }
      }
    });
    return Object.entries(pairFreq)
      .filter(([, v]) => v.count >= 3)
      .sort(([, a], [, b]) => b.count - a.count).slice(0, 30)
      .map(([pair, v]) => ({ pair, count: v.count, avgFav: Math.round(v.totalFav / v.count) }));
  }, [items]);

  // ---------------------------------------------------------------------------
  // Computed: Sorting & Engagement
  // ---------------------------------------------------------------------------

  const sortedItems = useMemo(() => {
    const sorted = [...items];
    switch (compSort) {
      case 'price_asc': sorted.sort((a, b) => a.price - b.price); break;
      case 'price_desc': sorted.sort((a, b) => b.price - a.price); break;
      case 'favorites': sorted.sort((a, b) => b.num_favorers - a.num_favorers); break;
      case 'views': sorted.sort((a, b) => b.views - a.views); break;
      case 'engagement': sorted.sort((a, b) => {
        const rA = a.views > 0 ? a.num_favorers / a.views : 0;
        const rB = b.views > 0 ? b.num_favorers / b.views : 0;
        return rB - rA;
      }); break;
    }
    return sorted;
  }, [items, compSort]);

  // ---------------------------------------------------------------------------
  // Computed: Shop Analysis
  // ---------------------------------------------------------------------------

  const shopStats = useMemo(() => {
    if (discoveredShops.length === 0) return null;
    const shops = discoveredShops.map(s => {
      const shopItems = items.filter(i => i.shop_id === s.shop_id);
      const avgPrice = shopItems.length > 0 ? shopItems.reduce((sum, i) => sum + i.price, 0) / shopItems.length : 0;
      return { ...s, avgPrice: Math.round(avgPrice * 100) / 100, listingCount: shopItems.length };
    }).sort((a, b) => b.num_sales - a.num_sales);

    const totalSales = shops.reduce((s, sh) => s + sh.num_sales, 0);
    const avgRating = shops.reduce((s, sh) => s + sh.review_average, 0) / shops.length;
    const top5Sales = shops.slice(0, 5).reduce((s, sh) => s + sh.listingCount, 0);

    return { shops, totalSales, avgRating: Math.round(avgRating * 100) / 100, top5Sales, totalListings: items.length };
  }, [discoveredShops, items]);

  // ---------------------------------------------------------------------------
  // Computed: Deep Dive
  // ---------------------------------------------------------------------------

  const deepDiveStats = useMemo(() => {
    if (deepDiveListings.length === 0) return null;
    const ddPrices = deepDiveListings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
    const sum = ddPrices.reduce((a, b) => a + b, 0);
    const mid = Math.floor(ddPrices.length / 2);
    const avgFav = deepDiveListings.reduce((s, l) => s + l.num_favorers, 0) / deepDiveListings.length;
    const avgViews = deepDiveListings.reduce((s, l) => s + l.views, 0) / deepDiveListings.length;

    const tagMap: Record<string, number> = {};
    deepDiveListings.forEach(l => {
      (l.tags || []).forEach(t => { tagMap[t.toLowerCase()] = (tagMap[t.toLowerCase()] || 0) + 1; });
    });
    const topTags = Object.entries(tagMap).sort(([, a], [, b]) => b - a).slice(0, 20)
      .map(([tag, count]) => ({ tag, count, pct: Math.round((count / deepDiveListings.length) * 100) }));

    return {
      count: deepDiveListings.length,
      priceMin: ddPrices[0] || 0, priceMax: ddPrices[ddPrices.length - 1] || 0,
      priceAvg: ddPrices.length > 0 ? Math.round((sum / ddPrices.length) * 100) / 100 : 0,
      priceMedian: ddPrices.length > 0 ? (ddPrices.length % 2 === 0 ? (ddPrices[mid - 1] + ddPrices[mid]) / 2 : ddPrices[mid]) : 0,
      avgFav: Math.round(avgFav), avgViews: Math.round(avgViews), topTags,
      bestListings: [...deepDiveListings].sort((a, b) => b.num_favorers - a.num_favorers).slice(0, 10),
    };
  }, [deepDiveListings]);

  // ---------------------------------------------------------------------------
  // Computed: Demand Score
  // ---------------------------------------------------------------------------

  const demandScore = useMemo(() => {
    if (items.length === 0) return null;
    const uniqueShops = new Set(items.map(i => i.shop_id).filter(Boolean)).size;
    const avgFavorites = items.reduce((s, i) => s + i.num_favorers, 0) / items.length;
    const avgViews = items.reduce((s, i) => s + i.views, 0) / items.length;
    const priceSpread = priceStats ? (priceStats.max - priceStats.min) / Math.max(priceStats.avg, 1) : 0;
    const avgEngagement = avgViews > 0 ? avgFavorites / avgViews : 0;

    const supplyScore = totalResults < 1000 ? 25 : totalResults < 5000 ? 18 : totalResults < 20000 ? 12 : 5;
    const compScore = uniqueShops < 10 ? 25 : uniqueShops < 20 ? 18 : uniqueShops < 40 ? 12 : 5;
    const demandPts = avgFavorites > 100 ? 20 : avgFavorites > 30 ? 15 : avgFavorites > 10 ? 10 : 5;
    const engScore = avgEngagement > 0.05 ? 15 : avgEngagement > 0.02 ? 10 : avgEngagement > 0.01 ? 7 : 3;
    const spreadScore = priceSpread > 3 ? 15 : priceSpread > 1.5 ? 10 : priceSpread > 0.5 ? 7 : 3;
    const total = Math.min(100, supplyScore + compScore + demandPts + engScore + spreadScore);

    return {
      score: total, totalResults, uniqueShops,
      avgFavorites: Math.round(avgFavorites), avgViews: Math.round(avgViews),
      avgEngagement: Math.round(avgEngagement * 10000) / 100,
      priceSpread: Math.round(priceSpread * 100) / 100,
      breakdown: { supplyScore, compScore, demandPts, engScore, spreadScore },
    };
  }, [items, totalResults, priceStats]);

  // ---------------------------------------------------------------------------
  // Computed: SEO
  // ---------------------------------------------------------------------------

  const seoResult = useMemo(() => {
    if (!myTitle || enrichedKeywords.length === 0) return null;
    const top20kw = enrichedKeywords.slice(0, 20);
    const coveredKw = top20kw.filter(k => myTitleWords.has(k.keyword));
    const kwScore = Math.round((coveredKw.length / Math.max(top20kw.length, 1)) * 30);
    const top20tags = enrichedTags.slice(0, 20);
    const coveredTags = top20tags.filter(t => myTagsSet.has(t.tag));
    const tagScore = Math.round((coveredTags.length / Math.max(top20tags.length, 1)) * 30);
    const lengthScore = myTitle.length >= 100 && myTitle.length <= 140 ? 20 : myTitle.length >= 70 ? 15 : myTitle.length >= 40 ? 10 : 5;
    const hasTagsScore = myTagsSet.size >= 10 ? 20 : myTagsSet.size >= 5 ? 15 : myTagsSet.size > 0 ? 10 : 0;
    const score = Math.min(100, kwScore + tagScore + lengthScore + hasTagsScore);
    const avgLen = allTitles.length ? Math.round(allTitles.reduce((s, t) => s + t.length, 0) / allTitles.length) : 0;

    const recommendations: string[] = [];
    const missingKw = top20kw.filter(k => !k.inMyTitle).slice(0, 5);
    if (missingKw.length > 0) recommendations.push(`Su eksik anahtar kelimeleri eklemeyi deneyin: ${missingKw.map(k => k.keyword).join(', ')}`);
    if (tagGaps.length > 0) recommendations.push(`Rakiplerin kullandigi su tagleri ekleyin: ${tagGaps.slice(0, 5).map(t => t.tag).join(', ')}`);
    if (myTitle.length < 80) recommendations.push(`Basliginiz kisa (${myTitle.length} karakter). Etsy icin en az 100 karakter onerilir.`);
    if (myTagsSet.size < 13) recommendations.push(`${13 - myTagsSet.size} tag daha ekleyin — Etsy'de 13 tag kullanin.`);

    return {
      score, kwScore, tagScore, lengthScore, hasTagsScore,
      recommendations, avgLen,
      coveredKw: coveredKw.length, totalKw: top20kw.length,
      coveredTags: coveredTags.length, totalTags: top20tags.length,
    };
  }, [myTitle, enrichedKeywords, myTitleWords, enrichedTags, myTagsSet, tagGaps, allTitles]);

  // ---------------------------------------------------------------------------
  // Computed: Profit Calculator
  // ---------------------------------------------------------------------------

  const profitCalc = useMemo(() => {
    const cost = parseFloat(purchaseCost) || 0;
    const sell = parseFloat(sellingPrice) || (priceStats?.avg || 0);
    const ship = parseFloat(shippingCost) || 0;
    const listingFee = 0.20;
    const transactionFee = sell * 0.065;
    const paymentProcessing = sell * 0.03 + 0.25;
    const offsiteAdsFee = includeOffsiteAds ? sell * 0.15 : 0;
    const totalFees = listingFee + transactionFee + paymentProcessing + offsiteAdsFee;
    const profit = sell - cost - ship - totalFees;
    const margin = sell > 0 ? (profit / sell) * 100 : 0;
    const compare = [-20, 0, 20].map(delta => {
      const p = sell * (1 + delta / 100);
      const tf = p * 0.065; const pp = p * 0.03 + 0.25;
      const oa = includeOffsiteAds ? p * 0.15 : 0;
      const pr = p - cost - ship - 0.20 - tf - pp - oa;
      return {
        label: delta === 0 ? 'Ortalama' : delta < 0 ? `${delta}%` : `+${delta}%`,
        price: p, profit: pr, margin: p > 0 ? (pr / p) * 100 : 0,
      };
    });
    return { cost, sell, ship, listingFee, transactionFee, paymentProcessing, offsiteAdsFee, totalFees, profit, margin, compare };
  }, [purchaseCost, sellingPrice, shippingCost, priceStats, includeOffsiteAds]);

  useEffect(() => {
    if (priceStats && !sellingPrice) setSellingPrice(priceStats.avg.toFixed(2));
  }, [priceStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const exportCSV = useCallback(() => {
    if (items.length === 0) { toast.error('Disa aktarilacak veri yok'); return; }
    const headers = ['Baslik', 'Fiyat', 'Goruntulenme', 'Favori', 'Etkl.Oran', 'Tag Sayisi', 'Stok', 'URL'];
    const rows = items.map(i => [
      `"${(i.title || '').replace(/"/g, '""')}"`, i.price.toFixed(2), i.views,
      i.num_favorers, i.views > 0 ? ((i.num_favorers / i.views) * 100).toFixed(2) + '%' : '0%',
      (i.tags || []).length, i.quantity, i.url || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `etsy_research_${query.replace(/\s+/g, '_')}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV indirildi');
  }, [items, query]);

  const saveSearch = useCallback(() => {
    const entry: SavedSearch = { query, minPrice, maxPrice, sortOn, myTitle, myTags, timestamp: Date.now() };
    const updated = [entry, ...savedSearches.filter(s => s.query !== query)].slice(0, 20);
    saveSavedSearches(updated); setSavedSearches(updated);
    toast.success('Arama kaydedildi');
  }, [query, minPrice, maxPrice, sortOn, myTitle, myTags, savedSearches]);

  const loadSearch = useCallback((s: SavedSearch) => {
    setQuery(s.query); setMinPrice(s.minPrice); setMaxPrice(s.maxPrice);
    setSortOn(s.sortOn); setMyTitle(s.myTitle); setMyTags(s.myTags);
  }, []);

  const deleteSaved = useCallback((idx: number) => {
    const updated = savedSearches.filter((_, i) => i !== idx);
    saveSavedSearches(updated); setSavedSearches(updated);
  }, [savedSearches]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasData = items.length > 0;

  return (
    <Box>
      {/* ================================================================ */}
      {/* HERO SEARCH BAR                                                  */}
      {/* ================================================================ */}
      <Box sx={{
        background: GRADIENTS.primary, borderRadius: '20px', p: { xs: 2, md: 3 }, mb: 3,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Decorative circles */}
        <Box sx={{ position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.1)' }} />
        <Box sx={{ position: 'absolute', bottom: -20, left: -20, width: 80, height: 80, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.08)' }} />

        <Paper sx={{ p: { xs: 2, md: 2.5 }, borderRadius: '14px', position: 'relative', zIndex: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <TextField
              label="Anahtar Kelime Ara"
              value={query} onChange={e => setQuery(e.target.value)}
              size="small" sx={{ flex: 2, minWidth: 200 }}
              placeholder="flower girl dress, personalized gift..."
              onKeyDown={handleKeyDown}
              InputProps={{
                startAdornment: <InputAdornment position="start"><Search size={16} color="#667eea" /></InputAdornment>,
              }}
            />
            <TextField label="Min $" value={minPrice} onChange={e => setMinPrice(e.target.value)}
              size="small" type="number" sx={{ width: 80 }}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
            <TextField label="Max $" value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
              size="small" type="number" sx={{ width: 80 }}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
            <TextField label="Siralama" value={sortOn} onChange={e => setSortOn(e.target.value)}
              size="small" select sx={{ width: 130 }} SelectProps={{ native: true }}>
              <option value="score">En Iyi Eslesme</option>
              <option value="price">Fiyat</option>
              <option value="created">Yeni Eklenen</option>
              <option value="updated">Son Guncellenen</option>
            </TextField>
            <Button variant="contained" onClick={searchMarket}
              disabled={loading || !query.trim()}
              startIcon={loading ? <CircularProgress size={16} /> : <Search size={16} />}
              sx={{
                background: GRADIENTS.primary, borderRadius: '10px', px: 3,
                boxShadow: '0 4px 12px rgba(102,126,234,0.4)',
                '&:hover': { boxShadow: '0 6px 16px rgba(102,126,234,0.5)' },
              }}
            >
              Arastir
            </Button>
          </Box>

          {/* My Title + Tags */}
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
            <TextField label="Benim Basligim (SEO karsilastirma)" value={myTitle}
              onChange={e => setMyTitle(e.target.value)} size="small"
              sx={{ flex: 2, minWidth: 200 }} placeholder="Listeleme basliginizi girin..."
              helperText={`${myTitle.length}/140 karakter`}
            />
            <TextField label="Benim Taglarim (virgul ile)" value={myTags}
              onChange={e => setMyTags(e.target.value)} size="small"
              sx={{ flex: 2, minWidth: 200 }} placeholder="personalized gift, baby shower..."
              helperText={`${myTags.split(',').filter(t => t.trim()).length}/13 tag`}
            />
          </Box>
        </Paper>
      </Box>

      {/* ================================================================ */}
      {/* PILL TABS                                                        */}
      {/* ================================================================ */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={pillTabsSx}>
        <Tab icon={<Compass size={14} />} iconPosition="start" label="Kelime Kesif" />
        <Tab icon={<Activity size={14} />} iconPosition="start" label="Trend Analizi" />
        <Tab icon={<DollarSign size={14} />} iconPosition="start" label="Fiyat Analizi" />
        <Tab icon={<Hash size={14} />} iconPosition="start" label="Tag Istihbarati" />
        <Tab icon={<Tag size={14} />} iconPosition="start" label="Anahtar Kelimeler" />
        <Tab icon={<BarChart2 size={14} />} iconPosition="start" label="Rakip Listeleri" />
        <Tab icon={<Users size={14} />} iconPosition="start" label="Magaza Analizi" />
        <Tab icon={<Store size={14} />} iconPosition="start" label="Magaza Derinlemesine" />
        <Tab icon={<Gauge size={14} />} iconPosition="start" label="Talep Skoru" />
        <Tab icon={<Calculator size={14} />} iconPosition="start" label="Kar Hesaplama" />
        <Tab icon={<TrendingUp size={14} />} iconPosition="start" label="SEO Karsilastirma" />
        <Tab icon={<Sparkles size={14} />} iconPosition="start" label="AI Pazar Analizi" />
      </Tabs>

      {loading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

      {/* ================================================================ */}
      {/* TAB 0: KEYWORD EXPLORER (NEW)                                    */}
      {/* ================================================================ */}
      {tab === 0 && (
        <Box>
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Box sx={{
                width: 36, height: 36, borderRadius: '10px', display: 'flex',
                alignItems: 'center', justifyContent: 'center', background: GRADIENTS.info,
              }}>
                <Compass size={18} color="#fff" />
              </Box>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Anahtar Kelime Kesif</Typography>
                <Typography variant="caption" color="text.secondary">
                  Google + Amazon + Etsy verileriyle anahtar kelime onerisi
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <TextField
                value={kwExplorerQuery} onChange={e => setKwExplorerQuery(e.target.value)}
                size="small" sx={{ flex: 2, minWidth: 200 }}
                placeholder={query || 'personalized gift, baby blanket...'}
                onKeyDown={e => e.key === 'Enter' && searchKeywords()}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
                }}
              />
              <FormControlLabel
                control={<Switch checked={kwAlphabetSoup} onChange={e => setKwAlphabetSoup(e.target.checked)} size="small" />}
                label={<Typography variant="caption">A-Z Genislet</Typography>}
              />
              <Button variant="contained" onClick={searchKeywords}
                disabled={kwExplorerLoading}
                startIcon={kwExplorerLoading ? <CircularProgress size={16} /> : <Zap size={16} />}
                sx={{ background: GRADIENTS.info, borderRadius: '10px' }}
              >
                Kesfet
              </Button>
            </Box>
          </Paper>

          {kwExplorerLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

          {kwSuggestions.length > 0 && (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                <StatCard label="Toplam Oneri" value={String(kwSuggestions.length)} color="#2196F3"
                  icon={<Compass size={18} />} />
                <StatCard label="Coklu Kaynak" value={String(kwSuggestions.filter(s => s.sourceCount > 1).length)}
                  color="#4caf50" icon={<Globe size={18} />} />
                <StatCard label="En Yuksek Skor" value={String(kwSuggestions[0]?.score || 0)}
                  color="#ff9800" icon={<Target size={18} />} />
              </Box>

              <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                <TableContainer sx={{ maxHeight: 500 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                        <TableCell>#</TableCell>
                        <TableCell>Anahtar Kelime</TableCell>
                        <TableCell align="center">Kaynaklar</TableCell>
                        <TableCell align="center">Skor</TableCell>
                        <TableCell align="center">Aksiyon</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {kwSuggestions.slice(0, 50).map((s, i) => (
                        <TableRow key={s.keyword} hover sx={{
                          '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                          borderLeft: i < 3 ? '3px solid #667eea' : 'none',
                        }}>
                          <TableCell>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: i < 3 ? '#667eea' : '#999' }}>
                              {i + 1}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.keyword}</Typography>
                          </TableCell>
                          <TableCell align="center">
                            {s.sources.map(src => <SourceBadge key={src} source={src} />)}
                          </TableCell>
                          <TableCell align="center">
                            <Chip label={s.score} size="small" sx={{
                              fontWeight: 700,
                              bgcolor: s.score >= 60 ? '#e8f5e9' : s.score >= 30 ? '#fff3e0' : '#fafafa',
                              color: s.score >= 60 ? '#2e7d32' : s.score >= 30 ? '#e65100' : '#999',
                            }} />
                          </TableCell>
                          <TableCell align="center">
                            <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                              <Tooltip title="Ana aramaya gonder">
                                <IconButton size="small" onClick={() => {
                                  setQuery(s.keyword); setTab(2);
                                  setTimeout(() => searchMarket(), 100);
                                }}>
                                  <ArrowRight size={14} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Kopyala">
                                <IconButton size="small" onClick={() => {
                                  navigator.clipboard.writeText(s.keyword);
                                  toast.success(`"${s.keyword}" kopyalandi`);
                                }}>
                                  <Copy size={14} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </>
          )}

          {!kwExplorerLoading && kwSuggestions.length === 0 && (
            <PremiumEmptyState
              icon={<Compass size={48} />}
              title="Anahtar Kelime Kesfet"
              desc="Google, Amazon ve Etsy'den anahtar kelime onerileri alin. A-Z genisleme ile uzun kuyruk kelimeleri bulun."
            />
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 1: TREND ANALYSIS (NEW)                                      */}
      {/* ================================================================ */}
      {tab === 1 && (
        <Box>
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2, textAlign: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, justifyContent: 'center' }}>
              <Box sx={{
                width: 36, height: 36, borderRadius: '10px', display: 'flex',
                alignItems: 'center', justifyContent: 'center', background: GRADIENTS.success,
              }}>
                <Activity size={18} color="#fff" />
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Trend Analizi</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Google Trends + Wikipedia verileri ile arama trendleri ve mevsimsel analiz
            </Typography>
            <Button variant="contained" onClick={fetchTrends}
              disabled={trendLoading || !query.trim()} size="large"
              startIcon={trendLoading ? <CircularProgress size={16} /> : <TrendingUp size={16} />}
              sx={{ background: GRADIENTS.success, borderRadius: '12px', px: 4, boxShadow: '0 4px 12px rgba(17,153,142,0.3)' }}
            >
              {trendLoading ? 'Analiz ediliyor...' : 'Trend Analizi Baslat'}
            </Button>
            {!query.trim() && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                Oncelikle ana arama alanina bir kelime girin
              </Typography>
            )}
          </Paper>

          {(trendLoading || seasonalLoading) && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

          {trendData && (
            <>
              {/* Trend summary cards */}
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                <StatCard label="Ort. Ilgi" value={String(trendData.averageInterest)} color="#2196F3"
                  icon={<BarChart2 size={18} />} />
                <StatCard label="Zirve Degeri" value={String(trendData.peakValue)} color="#4caf50"
                  icon={<TrendingUp size={18} />} />
                <StatCard label="Zirve Tarihi" value={trendData.peakDate || '-'} color="#ff9800"
                  icon={<Calendar size={18} />} />
                <StatCard label="Yon" value={
                  trendData.trendDirection === 'rising' ? 'Yukselis' :
                  trendData.trendDirection === 'declining' ? 'Dusus' : 'Stabil'
                } color={
                  trendData.trendDirection === 'rising' ? '#4caf50' :
                  trendData.trendDirection === 'declining' ? '#f44336' : '#ff9800'
                } icon={<Activity size={18} />}
                  gradient={trendData.trendDirection === 'rising' ? GRADIENTS.success : undefined}
                />
              </Box>

              {/* Trend chart */}
              {trendData.timeline.length > 0 && (
                <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                    12 Aylik Google Trends (Alisveris Kategorisi)
                  </Typography>
                  <TrendChart data={trendData.timeline} />
                </Paper>
              )}

              {/* Rising & top queries */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
                {trendData.risingQueries.length > 0 && (
                  <Paper sx={{ ...glassCard, p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#4caf50' }}>
                      Yukselen Aramalar
                    </Typography>
                    {trendData.risingQueries.map(q => (
                      <Box key={q.query} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{
                          cursor: 'pointer', '&:hover': { color: 'primary.main' },
                        }} onClick={() => { setQuery(q.query); toast.success(`"${q.query}" arama alanina eklendi`); }}>
                          {q.query}
                        </Typography>
                        <Chip label={q.value} size="small" sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 600 }} />
                      </Box>
                    ))}
                  </Paper>
                )}

                {trendData.topQueries.length > 0 && (
                  <Paper sx={{ ...glassCard, p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#2196F3' }}>
                      En Populer Iliskili Aramalar
                    </Typography>
                    {trendData.topQueries.map(q => (
                      <Box key={q.query} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{
                          cursor: 'pointer', '&:hover': { color: 'primary.main' },
                        }} onClick={() => { setQuery(q.query); toast.success(`"${q.query}" arama alanina eklendi`); }}>
                          {q.query}
                        </Typography>
                        <GradientBar value={q.value} max={100} height={6} />
                      </Box>
                    ))}
                  </Paper>
                )}
              </Box>
            </>
          )}

          {/* Seasonal calendar */}
          {seasonalData && seasonalData.hasData && (
            <Paper sx={{ ...glassCard, p: 2.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                Mevsimsel Takvim
              </Typography>
              {seasonalData.peakMonth && (
                <Alert severity="success" sx={{ mb: 2, borderRadius: '12px' }}>
                  Zirve ay: <strong>{seasonalData.peakMonth}</strong> | Dusuk ay: <strong>{seasonalData.lowMonth}</strong>
                </Alert>
              )}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 1 }}>
                {(seasonalData.monthlyTrends.length > 0 ? seasonalData.monthlyTrends : seasonalData.wikiPageviews.map(w => ({ month: w.month, value: w.views }))).map(m => {
                  const maxVal = Math.max(...(seasonalData.monthlyTrends.length > 0 ? seasonalData.monthlyTrends : seasonalData.wikiPageviews.map(w => ({ month: w.month, value: w.views }))).map(x => x.value), 1);
                  const intensity = m.value / maxVal;
                  const isPeak = m.month === seasonalData.peakMonth;
                  const isLow = m.month === seasonalData.lowMonth;
                  return (
                    <Paper key={m.month} sx={{
                      p: 1, textAlign: 'center', borderRadius: '12px',
                      border: isPeak ? '2px solid #4caf50' : isLow ? '2px solid #f44336' : '1px solid #eee',
                      bgcolor: `rgba(102,126,234,${intensity * 0.15})`,
                    }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.7rem' }}>
                        {m.month}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: isPeak ? '#4caf50' : isLow ? '#f44336' : '#333' }}>
                        {m.value}
                      </Typography>
                    </Paper>
                  );
                })}
              </Box>
            </Paper>
          )}

          {!trendLoading && !trendData && (
            <PremiumEmptyState
              icon={<Activity size={48} />}
              title="Trend Analizi"
              desc="Google Trends ve Wikipedia verileriyle arama trendlerini, mevsimsellik ve yukselen kelimeleri analiz edin."
            />
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 2: PRICE ANALYSIS                                            */}
      {/* ================================================================ */}
      {tab === 2 && (
        <Box>
          {priceStats ? (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                <StatCard label="Minimum" value={fmt(priceStats.min)} color="#11998e" icon={<DollarSign size={18} />} />
                <StatCard label="Ortalama" value={fmt(priceStats.avg)} color="#2196F3" icon={<BarChart2 size={18} />} />
                <StatCard label="Medyan" value={fmt(priceStats.median)} color="#ff9800" icon={<Target size={18} />} />
                <StatCard label="Maksimum" value={fmt(priceStats.max)} color="#f44336" icon={<TrendingUp size={18} />} />
                <StatCard label="Sonuc" value={`${priceStats.count}`} color="#9c27b0" icon={<ShoppingBag size={18} />} />
              </Box>

              {sweetSpot && (
                <Alert severity="success" sx={{ mb: 2, borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)',
                  border: '1px solid rgba(17,153,142,0.2)',
                }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Fiyat Tatli Noktasi: {sweetSpot.label}
                  </Typography>
                  <Typography variant="body2">
                    Bu fiyat araligindaki urunler ortalama <strong>{sweetSpot.avgFav}</strong> favori aliyor ({sweetSpot.count} urun).
                  </Typography>
                </Alert>
              )}

              {/* Gradient Histogram */}
              {histogram.length > 1 && (
                <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Fiyat Dagilimi</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: 140 }}>
                    {histogram.map((b, i) => (
                      <Tooltip key={i} title={`${b.label}: ${b.count} urun`}>
                        <Box sx={{
                          flex: 1, minWidth: 0,
                          height: `${Math.max((b.count / maxBucketCount) * 100, 3)}%`,
                          background: GRADIENTS.primary,
                          borderRadius: '6px 6px 0 0',
                          transition: 'height 0.3s, transform 0.2s', cursor: 'pointer',
                          '&:hover': { transform: 'scaleY(1.05)', opacity: 0.85 },
                        }} />
                      </Tooltip>
                    ))}
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{fmt(priceStats.min)}</Typography>
                    <Typography variant="caption" color="text.secondary">{fmt(priceStats.max)}</Typography>
                  </Box>
                </Paper>
              )}

              {/* Price range table */}
              <Paper sx={{ ...glassCard, overflow: 'hidden', mb: 2 }}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                        <TableCell>Fiyat Araligi</TableCell>
                        <TableCell align="center">Urun</TableCell>
                        <TableCell align="center">Oran</TableCell>
                        <TableCell align="center">Ort. Favori</TableCell>
                        <TableCell sx={{ width: '25%' }}>Dagilim</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {priceRangeBreakdown.map(r => {
                        const inRange = items.filter(i => i.price >= r.min && i.price < r.max);
                        const avgFav = inRange.length > 0 ? Math.round(inRange.reduce((s, i) => s + i.num_favorers, 0) / inRange.length) : 0;
                        return (
                          <TableRow key={r.label} hover sx={{ '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' } }}>
                            <TableCell sx={{ fontWeight: 600 }}>{r.label}</TableCell>
                            <TableCell align="center">{r.count}</TableCell>
                            <TableCell align="center">{pct(r.pct)}</TableCell>
                            <TableCell align="center">
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                <Heart size={12} color="#e91e63" /> {avgFav}
                              </Box>
                            </TableCell>
                            <TableCell><GradientBar value={r.pct} max={100} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </>
          ) : !loading && <PremiumEmptyState icon={<DollarSign size={48} />} title="Fiyat Analizi" desc="Anahtar kelime arayarak fiyat dagilimi, tatli nokta ve rekabet analizi yapin." />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 3: TAG INTELLIGENCE                                          */}
      {/* ================================================================ */}
      {tab === 3 && (
        <Box>
          {enrichedTags.length > 0 ? (
            <>
              {tagGaps.length > 0 && myTagsSet.size > 0 && (
                <Alert severity="warning" sx={{ mb: 2, borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(242,153,74,0.08) 0%, rgba(242,201,76,0.08) 100%)',
                  border: '1px solid rgba(242,153,74,0.2)',
                }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {tagGaps.length} Eksik Tag Tespit Edildi!
                  </Typography>
                  <Typography variant="body2">
                    Rakiplerin kullandigi ama sizde olmayan tagler:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                    {tagGaps.slice(0, 10).map(t => (
                      <Chip key={t.tag} label={`${t.tag} (%${t.pct})`} size="small" color="warning"
                        onClick={() => { navigator.clipboard.writeText(t.tag); toast.success(`"${t.tag}" kopyalandi`); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px' }}
                      />
                    ))}
                  </Box>
                </Alert>
              )}

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                  En Cok Kullanilan Tagler ({enrichedTags.length} benzersiz)
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2.5 }}>
                  {enrichedTags.slice(0, 40).map(t => (
                    <Chip key={t.tag}
                      label={`${t.tag} (%${t.pct})`} size="small"
                      color={t.inMyTags ? 'success' : t.pct >= 30 ? 'error' : t.pct >= 15 ? 'warning' : 'default'}
                      variant={t.inMyTags ? 'filled' : 'outlined'}
                      onClick={() => { navigator.clipboard.writeText(t.tag); toast.success(`"${t.tag}" kopyalandi`); }}
                      sx={{ cursor: 'pointer', borderRadius: '8px' }}
                    />
                  ))}
                </Box>

                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Tag Yogunlugu</Typography>
                {enrichedTags.slice(0, 20).map(t => (
                  <Box key={t.tag} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 140, fontWeight: t.inMyTags ? 700 : 400 }}>
                      {t.inMyTags && <CheckCircle size={12} color="#4caf50" style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                      {t.tag}
                    </Typography>
                    <Box sx={{ flex: 1 }}><GradientBar value={t.pct} max={100} /></Box>
                    <Typography variant="caption" sx={{ minWidth: 35, fontWeight: 600 }}>{t.pct}%</Typography>
                  </Box>
                ))}
              </Paper>

              {tagCombos.length > 0 && (
                <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                  <Box sx={{ p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Populer Tag Kombinasyonlari
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Birlikte en cok kullanilan tag ciftleri ve ortalama favori sayilari
                    </Typography>
                  </Box>
                  <TableContainer sx={{ maxHeight: 400 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                          <TableCell>Tag Cifti</TableCell>
                          <TableCell align="center">Kullanim</TableCell>
                          <TableCell align="center">Ort. Favori</TableCell>
                          <TableCell align="center">Kopyala</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {tagCombos.map(c => (
                          <TableRow key={c.pair} hover sx={{ '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' } }}>
                            <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{c.pair}</Typography></TableCell>
                            <TableCell align="center">{c.count}</TableCell>
                            <TableCell align="center">
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                <Heart size={12} color="#e91e63" /> {c.avgFav}
                              </Box>
                            </TableCell>
                            <TableCell align="center">
                              <IconButton size="small" onClick={() => {
                                navigator.clipboard.writeText(c.pair.replace(' + ', ', '));
                                toast.success('Kopyalandi');
                              }}><Copy size={14} /></IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              )}
            </>
          ) : !loading && <PremiumEmptyState icon={<Hash size={48} />} title="Tag Istihbarati" desc="Arama yapin ve rakiplerin tag stratejilerini analiz edin." />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 4: KEYWORDS                                                  */}
      {/* ================================================================ */}
      {tab === 4 && (
        <Box>
          {hasData ? (
            <>
              <Alert severity="info" sx={{ mb: 2, borderRadius: '12px' }}>
                Rakiplerin basliklarindan cikarilan en populer anahtar kelimeler. Tiklayin ve kopyalayin.
              </Alert>

              {myTitle && (
                <Box sx={{ mb: 1.5 }}>
                  <Button size="small" variant={kwShowMissing ? 'contained' : 'outlined'}
                    onClick={() => setKwShowMissing(!kwShowMissing)} sx={{ mr: 1, borderRadius: '8px' }}>
                    {kwShowMissing ? 'Tum Kelimeler' : 'Basligimda Olmayanlar'}
                  </Button>
                </Box>
              )}

              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Tek Kelimeler</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                {(kwShowMissing ? enrichedKeywords.filter(k => !k.inMyTitle) : enrichedKeywords).map(kw => (
                  <Chip key={kw.keyword}
                    label={`${kw.keyword} (${kw.pct}%)`} size="small"
                    color={kw.pct >= 40 ? 'error' : kw.pct >= 20 ? 'warning' : 'default'}
                    variant={kw.inMyTitle ? 'filled' : 'outlined'}
                    onClick={() => { navigator.clipboard.writeText(kw.keyword); toast.success(`"${kw.keyword}" kopyalandi`); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>

              {bigrams.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>2 Kelimelik Ifadeler</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                    {bigrams.slice(0, 25).map(b => (
                      <Chip key={b.phrase} label={`${b.phrase} (${b.count})`} size="small"
                        color={b.percentage >= 30 ? 'primary' : 'default'} variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(b.phrase); toast.success(`"${b.phrase}" kopyalandi`); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px' }}
                      />
                    ))}
                  </Box>
                </>
              )}

              {trigrams.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Uzun Kuyruk (3+ kelime)</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                    {trigrams.slice(0, 20).map(t => (
                      <Chip key={t.phrase} label={`${t.phrase} (${t.count})`} size="small"
                        color="secondary" variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(t.phrase); toast.success(`"${t.phrase}" kopyalandi`); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px' }}
                      />
                    ))}
                  </Box>
                </>
              )}

              {/* Keyword density */}
              <Paper sx={{ ...glassCard, p: 2.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Anahtar Kelime Yogunlugu</Typography>
                {enrichedKeywords.slice(0, 15).map(kw => (
                  <Box key={kw.keyword} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 100, fontWeight: kw.inMyTitle ? 700 : 400 }}>
                      {kw.keyword}
                    </Typography>
                    <Box sx={{ flex: 1 }}>
                      <GradientBar value={kw.pct} max={100} />
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 35, fontWeight: 600 }}>{kw.pct}%</Typography>
                  </Box>
                ))}
              </Paper>
            </>
          ) : !loading && <PremiumEmptyState icon={<Tag size={48} />} title="Anahtar Kelimeler" desc="Arama yapin ve rakiplerin en cok kullandigi kelimeleri kesfet." />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 5: COMPETITOR LISTINGS                                       */}
      {/* ================================================================ */}
      {tab === 5 && (
        <Box>
          {hasData ? (
            <>
              <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">{items.length} urun listeleniyor</Typography>
                <Box sx={{ flex: 1 }} />
                {(['none', 'price_asc', 'price_desc', 'favorites', 'views', 'engagement'] as const).map(s => (
                  <Chip key={s}
                    label={{ none: 'Varsayilan', price_asc: 'Fiyat ↑', price_desc: 'Fiyat ↓', favorites: 'Favori', views: 'Goruntulenme', engagement: 'Etkilesim' }[s]}
                    size="small" variant={compSort === s ? 'filled' : 'outlined'}
                    color={compSort === s ? 'primary' : 'default'}
                    onClick={() => setCompSort(s)} sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>

              <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                <TableContainer sx={{ maxHeight: 600 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                        <TableCell sx={{ width: 50 }} />
                        <TableCell>Baslik</TableCell>
                        <TableCell align="right">Fiyat</TableCell>
                        <TableCell align="center"><Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'center' }}><Eye size={12} /> Grnm</Box></TableCell>
                        <TableCell align="center"><Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'center' }}><Heart size={12} /> Fav</Box></TableCell>
                        <TableCell align="center">Etkl.</TableCell>
                        <TableCell align="center">Tag</TableCell>
                        <TableCell sx={{ width: 40 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedItems.slice(0, visibleCount).map((item, idx) => {
                        const engagement = item.views > 0 ? (item.num_favorers / item.views) * 100 : 0;
                        return (
                          <TableRow key={item.listing_id} hover sx={{
                            '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                            borderLeft: idx < 3 ? '3px solid #667eea' : 'none',
                          }}>
                            <TableCell>
                              {item.image_url && (
                                <img src={item.image_url} alt="" style={{
                                  width: 44, height: 44, objectFit: 'cover', borderRadius: 8,
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                }} />
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.title}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>{fmt(item.price)}</Typography>
                            </TableCell>
                            <TableCell align="center">{item.views.toLocaleString()}</TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" sx={{
                                fontWeight: 700,
                                color: item.num_favorers > 100 ? '#11998e' : item.num_favorers > 20 ? '#ff9800' : 'text.secondary',
                              }}>
                                {item.num_favorers.toLocaleString()}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Chip label={`${engagement.toFixed(1)}%`} size="small"
                                sx={{
                                  fontWeight: 600, borderRadius: '6px',
                                  bgcolor: engagement > 5 ? '#e8f5e9' : engagement > 2 ? '#fff3e0' : '#fafafa',
                                  color: engagement > 5 ? '#2e7d32' : engagement > 2 ? '#e65100' : '#999',
                                }}
                              />
                            </TableCell>
                            <TableCell align="center">{(item.tags || []).length}</TableCell>
                            <TableCell>
                              <IconButton size="small" onClick={() => window.open(item.url, '_blank')}>
                                <ExternalLink size={14} />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>

              {visibleCount < items.length && (
                <Box sx={{ textAlign: 'center', mt: 2 }}>
                  <Button variant="outlined" onClick={() => setVisibleCount(c => c + 20)}
                    sx={{ borderRadius: '10px' }}>
                    Daha Fazla Goster ({items.length - visibleCount} kalan)
                  </Button>
                </Box>
              )}
            </>
          ) : !loading && <PremiumEmptyState icon={<BarChart2 size={48} />} title="Rakip Listeleri" desc="Arama yapin ve rakip urunleri karsilastirin." />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 6: SHOP ANALYSIS                                             */}
      {/* ================================================================ */}
      {tab === 6 && (
        <Box>
          {shopsLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}
          {shopStats && shopStats.shops.length > 0 ? (
            <>
              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Magaza Yogunlugu</Typography>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                  <StatCard label="Toplam Magaza" value={String(shopStats.shops.length)} color="#667eea" icon={<Store size={18} />} />
                  <StatCard label="Ort. Puan" value={`${shopStats.avgRating}`} color="#ff9800" icon={<Star size={18} />} />
                  <StatCard label="Top 5 Payi" value={shopStats.totalListings > 0 ? pct((shopStats.top5Sales / shopStats.totalListings) * 100) : '0%'} color="#9c27b0" icon={<Users size={18} />} />
                </Box>

                {/* Concentration bar */}
                <Box sx={{ display: 'flex', height: 24, borderRadius: '12px', overflow: 'hidden' }}>
                  <Box sx={{
                    width: `${shopStats.totalListings ? (shopStats.top5Sales / shopStats.totalListings) * 100 : 0}%`,
                    background: GRADIENTS.primary, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.65rem', fontWeight: 600 }}>Top 5</Typography>
                  </Box>
                  <Box sx={{ flex: 1, bgcolor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Diger</Typography>
                  </Box>
                </Box>
              </Paper>

              <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                <TableContainer sx={{ maxHeight: 500 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                        <TableCell>#</TableCell>
                        <TableCell>Magaza</TableCell>
                        <TableCell align="center">Satis</TableCell>
                        <TableCell align="center">Puan</TableCell>
                        <TableCell align="center">Yorum</TableCell>
                        <TableCell align="center">Urun</TableCell>
                        <TableCell align="center">Ort. Fiyat</TableCell>
                        <TableCell sx={{ width: 40 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {shopStats.shops.map((s, i) => (
                        <TableRow key={s.shop_id} hover sx={{
                          '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                          borderLeft: i < 3 ? '3px solid #667eea' : 'none',
                        }}>
                          <TableCell>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: i < 3 ? '#667eea' : '#999' }}>
                              {i + 1}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{
                              fontWeight: 600, cursor: 'pointer',
                              '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                            }} onClick={() => { setDeepDiveShopId(String(s.shop_id)); setTab(7); }}>
                              {s.shop_name}
                            </Typography>
                          </TableCell>
                          <TableCell align="center"><Typography variant="body2" sx={{ fontWeight: 700 }}>{s.num_sales.toLocaleString()}</Typography></TableCell>
                          <TableCell align="center">
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3 }}>
                              <Star size={12} color="#ff9800" fill="#ff9800" /> {s.review_average.toFixed(1)}
                            </Box>
                          </TableCell>
                          <TableCell align="center">{s.review_count.toLocaleString()}</TableCell>
                          <TableCell align="center">{s.listing_active_count}</TableCell>
                          <TableCell align="center">{s.avgPrice ? fmt(s.avgPrice) : '-'}</TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => window.open(s.url, '_blank')}>
                              <ExternalLink size={14} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </>
          ) : !shopsLoading && (
            hasData
              ? <Alert severity="info" sx={{ borderRadius: '12px' }}>Magaza bilgileri yukleniyor...</Alert>
              : <PremiumEmptyState icon={<Users size={48} />} title="Magaza Analizi" desc="Arama yapin ve rakip magazalari analiz edin." />
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 7: SHOP DEEP DIVE                                            */}
      {/* ================================================================ */}
      {tab === 7 && (
        <Box>
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Magaza Derinlemesine Analiz</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField label="Magaza ID" value={deepDiveShopId}
                onChange={e => setDeepDiveShopId(e.target.value)} size="small"
                sx={{ flex: 1, minWidth: 200 }} placeholder="Magaza ID girin..."
                onKeyDown={e => e.key === 'Enter' && searchShopDeepDive()}
              />
              <Button variant="contained" onClick={searchShopDeepDive}
                disabled={deepDiveLoading || !deepDiveShopId.trim()}
                startIcon={deepDiveLoading ? <CircularProgress size={16} /> : <Search size={16} />}
                sx={{ background: GRADIENTS.primary, borderRadius: '10px' }}
              >
                Analiz Et
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Magaza Analizi tabindan magaza adina tiklayarak da gelebilirsiniz.
            </Typography>
          </Paper>

          {deepDiveLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

          {deepDiveShop && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>{deepDiveShop.shop_name}</Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <StatCard label="Toplam Satis" value={deepDiveShop.num_sales.toLocaleString()} color="#11998e" icon={<ShoppingCart size={18} />} />
                <StatCard label="Puan" value={`${deepDiveShop.review_average.toFixed(1)}`} color="#ff9800" icon={<Star size={18} />} />
                <StatCard label="Yorum" value={deepDiveShop.review_count.toLocaleString()} color="#2196F3" icon={<Eye size={18} />} />
                <StatCard label="Aktif Urun" value={String(deepDiveShop.listing_active_count)} color="#9c27b0" icon={<ShoppingBag size={18} />} />
              </Box>
            </Paper>
          )}

          {deepDiveStats && (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                <StatCard label="Min Fiyat" value={fmt(deepDiveStats.priceMin)} color="#11998e" />
                <StatCard label="Ort. Fiyat" value={fmt(deepDiveStats.priceAvg)} color="#2196F3" />
                <StatCard label="Max Fiyat" value={fmt(deepDiveStats.priceMax)} color="#f44336" />
                <StatCard label="Ort. Favori" value={String(deepDiveStats.avgFav)} color="#e91e63" icon={<Heart size={18} />} />
                <StatCard label="Ort. Grnm" value={String(deepDiveStats.avgViews)} color="#ff9800" icon={<Eye size={18} />} />
              </Box>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>En Cok Kullanilan Tagler</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {deepDiveStats.topTags.map(t => (
                    <Chip key={t.tag} label={`${t.tag} (%${t.pct})`} size="small" variant="outlined"
                      onClick={() => { navigator.clipboard.writeText(t.tag); toast.success('Kopyalandi'); }}
                      sx={{ cursor: 'pointer', borderRadius: '8px' }}
                    />
                  ))}
                </Box>
              </Paper>

              <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                <Box sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>En Populer Urunler</Typography>
                </Box>
                <TableContainer sx={{ maxHeight: 400 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                        <TableCell>#</TableCell>
                        <TableCell>Baslik</TableCell>
                        <TableCell align="right">Fiyat</TableCell>
                        <TableCell align="center">Favori</TableCell>
                        <TableCell align="center">Grnm</TableCell>
                        <TableCell sx={{ width: 40 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {deepDiveStats.bestListings.map((l, i) => (
                        <TableRow key={l.listing_id} hover sx={{
                          '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                          borderLeft: i < 3 ? '3px solid #667eea' : 'none',
                        }}>
                          <TableCell>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: i < 3 ? '#667eea' : '#999' }}>{i + 1}</Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {l.title}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{fmt(l.price)}</TableCell>
                          <TableCell align="center">
                            <Typography sx={{ fontWeight: 700, color: l.num_favorers > 100 ? '#11998e' : '#ff9800' }}>
                              {l.num_favorers.toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">{l.views.toLocaleString()}</TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => window.open(l.url, '_blank')}><ExternalLink size={14} /></IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </>
          )}

          {!deepDiveLoading && !deepDiveShop && (
            <PremiumEmptyState icon={<Store size={48} />} title="Magaza Derinlemesine"
              desc="Magaza ID girin veya Magaza Analizi tabindan magaza secin." />
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 8: DEMAND SCORE                                              */}
      {/* ================================================================ */}
      {tab === 8 && (
        <Box>
          {demandScore ? (
            <>
              <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
                <ScoreRing score={demandScore.score} size={140} label="Firsat" />
                <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                  {demandScore.score >= 70 ? 'Bu nis iyi bir firsat! Rekabet makul ve talep yuksek.' :
                    demandScore.score >= 40 ? 'Orta seviye firsat. Rekabet analizi yaparak stratejinizi belirleyin.' :
                      'Bu pazar cok rekabetci veya doygun olabilir. Nis bir alt kategori bulmaya calisin.'}
                </Typography>
              </Paper>

              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                {[
                  { label: 'Toplam Sonuc', value: demandScore.totalResults.toLocaleString(), desc: 'Arz miktari' },
                  { label: 'Benzersiz Magaza', value: String(demandScore.uniqueShops), desc: 'Rekabet' },
                  { label: 'Ort. Favori', value: String(demandScore.avgFavorites), desc: 'Talep sinyali' },
                  { label: 'Ort. Grnm', value: String(demandScore.avgViews), desc: 'Gorunurluk' },
                  { label: 'Etkilesim', value: `${demandScore.avgEngagement}%`, desc: 'Fav/Grnm' },
                  { label: 'Fiyat Yayilimi', value: `${demandScore.priceSpread}x`, desc: 'Cesitlilik' },
                ].map(m => (
                  <Paper key={m.label} sx={{ ...glassCard, p: 2, flex: 1, minWidth: 130 }}>
                    <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 500 }}>{m.label}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{m.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{m.desc}</Typography>
                  </Paper>
                ))}
              </Box>

              <Paper sx={{ ...glassCard, p: 2.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Skor Detayi</Typography>
                {[
                  { label: 'Arz Skoru', score: demandScore.breakdown.supplyScore, max: 25, desc: 'Dusuk arz = yuksek firsat' },
                  { label: 'Rekabet Skoru', score: demandScore.breakdown.compScore, max: 25, desc: 'Az magaza = kolay giris' },
                  { label: 'Talep Skoru', score: demandScore.breakdown.demandPts, max: 20, desc: 'Yuksek favori = guclu talep' },
                  { label: 'Etkilesim Skoru', score: demandScore.breakdown.engScore, max: 15, desc: 'Yuksek oran = ilgi cekici nis' },
                  { label: 'Fiyat Cesitliligi', score: demandScore.breakdown.spreadScore, max: 15, desc: 'Genis aralik = nis firsat' },
                ].map(b => (
                  <Box key={b.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="body2" sx={{ minWidth: 140, fontWeight: 500 }}>{b.label}</Typography>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ width: '100%', bgcolor: '#f0f0f0', borderRadius: 5, height: 10, overflow: 'hidden' }}>
                        <Box sx={{
                          width: `${(b.score / b.max) * 100}%`, height: 10, borderRadius: 5,
                          background: b.score / b.max >= 0.7 ? GRADIENTS.success : b.score / b.max >= 0.4 ? GRADIENTS.warning : GRADIENTS.danger,
                          transition: 'width 0.5s ease-out',
                        }} />
                      </Box>
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 40, fontWeight: 600 }}>{b.score}/{b.max}</Typography>
                    <Tooltip title={b.desc}><Info size={14} color="#999" /></Tooltip>
                  </Box>
                ))}
              </Paper>
            </>
          ) : !loading && <PremiumEmptyState icon={<Gauge size={48} />} title="Talep Skoru" desc="Arama yapin ve pazar firsatini puanlayin." />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 9: PROFIT CALCULATOR                                         */}
      {/* ================================================================ */}
      {tab === 9 && (
        <Box>
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Etsy Kar Hesaplayici</Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <TextField label="Alis Maliyeti ($)" value={purchaseCost}
                onChange={e => setPurchaseCost(e.target.value)}
                size="small" type="number" sx={{ flex: 1, minWidth: 140 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
              <TextField label="Satis Fiyati ($)" value={sellingPrice || (priceStats?.avg.toFixed(2) || '')}
                onChange={e => setSellingPrice(e.target.value)}
                size="small" type="number" sx={{ flex: 1, minWidth: 140 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                helperText={priceStats ? `Pazar ortalamasi: ${fmt(priceStats.avg)}` : ''}
              />
              <TextField label="Kargo Maliyeti ($)" value={shippingCost}
                onChange={e => setShippingCost(e.target.value)}
                size="small" type="number" sx={{ flex: 1, minWidth: 140 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
            </Box>
            <FormControlLabel
              control={<Switch checked={includeOffsiteAds} onChange={e => setIncludeOffsiteAds(e.target.checked)} size="small" />}
              label="Offsite Ads dahil et (15%)"
            />
          </Paper>

          <Paper sx={{ ...glassCard, overflow: 'hidden', mb: 2 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Etsy Ucret Detaylari</Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell>Satis Fiyati</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(profitCalc.sell)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        Listeleme Ucreti <Tooltip title="Her listeleme icin $0.20"><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.listingFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        Islem Komisyonu (6.5%) <Tooltip title="Her satis icin %6.5"><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.transactionFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        Odeme Isleme (3% + $0.25) <Tooltip title="Etsy Payments ucreti"><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.paymentProcessing)}</TableCell>
                  </TableRow>
                  {includeOffsiteAds && (
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          Offsite Ads (15%) <Tooltip title="Etsy dis site reklam ucreti"><Info size={14} color="#999" /></Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.offsiteAdsFee)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow><TableCell>Alis Maliyeti</TableCell><TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.cost)}</TableCell></TableRow>
                  <TableRow><TableCell>Kargo Maliyeti</TableCell><TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.ship)}</TableCell></TableRow>
                  <TableRow sx={{
                    background: profitCalc.profit >= 0
                      ? 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)'
                      : 'linear-gradient(135deg, rgba(235,51,73,0.08) 0%, rgba(244,92,67,0.08) 100%)',
                  }}>
                    <TableCell sx={{ fontWeight: 800 }}>Net Kar</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, color: profitCalc.profit >= 0 ? '#11998e' : '#eb3349' }}>
                      {fmt(profitCalc.profit)}
                    </TableCell>
                  </TableRow>
                  <TableRow sx={{
                    background: profitCalc.profit >= 0
                      ? 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)'
                      : 'linear-gradient(135deg, rgba(235,51,73,0.08) 0%, rgba(244,92,67,0.08) 100%)',
                  }}>
                    <TableCell sx={{ fontWeight: 800 }}>Kar Marji</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, color: profitCalc.profit >= 0 ? '#11998e' : '#eb3349' }}>
                      {pct(profitCalc.margin)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Farkli Fiyat Noktalari</Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                    <TableCell>Senaryo</TableCell>
                    <TableCell align="right">Fiyat</TableCell>
                    <TableCell align="right">Kar</TableCell>
                    <TableCell align="right">Marj</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profitCalc.compare.map(c => (
                    <TableRow key={c.label} hover sx={{ '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' } }}>
                      <TableCell sx={{ fontWeight: 600 }}>{c.label}</TableCell>
                      <TableCell align="right">{fmt(c.price)}</TableCell>
                      <TableCell align="right" sx={{ color: c.profit >= 0 ? '#11998e' : '#eb3349', fontWeight: 700 }}>
                        {fmt(c.profit)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: c.margin >= 0 ? '#11998e' : '#eb3349' }}>
                        {pct(c.margin)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 10: SEO COMPARISON                                           */}
      {/* ================================================================ */}
      {tab === 10 && (
        <Box>
          {seoResult ? (
            <>
              <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
                <ScoreRing score={seoResult.score} size={140} label="SEO" />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Kelime ({seoResult.coveredKw}/{seoResult.totalKw}) + Tag ({seoResult.coveredTags}/{seoResult.totalTags}) kapsami
                </Typography>
              </Paper>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Skor Detayi</Typography>
                {[
                  { label: 'Kelime Kapsami', score: seoResult.kwScore, max: 30 },
                  { label: 'Tag Kapsami', score: seoResult.tagScore, max: 30 },
                  { label: 'Baslik Uzunlugu', score: seoResult.lengthScore, max: 20 },
                  { label: 'Tag Sayisi', score: seoResult.hasTagsScore, max: 20 },
                ].map(b => (
                  <Box key={b.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 120, fontWeight: 500 }}>{b.label}</Typography>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ width: '100%', bgcolor: '#f0f0f0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <Box sx={{
                          width: `${(b.score / b.max) * 100}%`, height: 8, borderRadius: 4,
                          background: b.score / b.max >= 0.7 ? GRADIENTS.success : b.score / b.max >= 0.4 ? GRADIENTS.warning : GRADIENTS.danger,
                        }} />
                      </Box>
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 40, fontWeight: 600 }}>{b.score}/{b.max}</Typography>
                  </Box>
                ))}
              </Paper>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Baslik Uzunlugu</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120, borderRadius: '12px' }}>
                    <Typography variant="caption" color="text.secondary">Benim</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{myTitle.length} kr</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120, borderRadius: '12px' }}>
                    <Typography variant="caption" color="text.secondary">Rakip Ort.</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{seoResult.avgLen} kr</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120, borderRadius: '12px' }}>
                    <Typography variant="caption" color="text.secondary">Optimal</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#11998e' }}>100-140</Typography>
                  </Paper>
                </Box>
              </Paper>

              {seoResult.recommendations.length > 0 && (
                <Alert severity={seoResult.score >= 70 ? 'success' : 'warning'} sx={{ mb: 2, borderRadius: '12px' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Oneriler</Typography>
                  {seoResult.recommendations.map((rec, i) => (
                    <Typography key={i} variant="body2">• {rec}</Typography>
                  ))}
                </Alert>
              )}

              {enrichedKeywords.length > 0 && (
                <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                  <TableContainer sx={{ maxHeight: 400 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                          <TableCell>Kelime</TableCell>
                          <TableCell align="center">Kullanim %</TableCell>
                          <TableCell align="center">Basligimda</TableCell>
                          <TableCell align="center">Kopyala</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {enrichedKeywords.slice(0, 20).map(kw => (
                          <TableRow key={kw.keyword} sx={{
                            bgcolor: kw.inMyTitle ? 'rgba(17,153,142,0.06)' : 'transparent',
                            '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                          }}>
                            <TableCell><Typography variant="body2" sx={{ fontWeight: kw.inMyTitle ? 700 : 400 }}>{kw.keyword}</Typography></TableCell>
                            <TableCell align="center">
                              <Chip label={`%${kw.pct}`} size="small" sx={{
                                fontWeight: 600, borderRadius: '6px',
                                bgcolor: kw.pct >= 50 ? '#ffebee' : kw.pct >= 25 ? '#fff3e0' : '#fafafa',
                                color: kw.pct >= 50 ? '#c62828' : kw.pct >= 25 ? '#e65100' : '#999',
                              }} />
                            </TableCell>
                            <TableCell align="center">
                              {kw.inMyTitle ? <CheckCircle size={18} color="#11998e" /> : <XCircle size={18} color="#ddd" />}
                            </TableCell>
                            <TableCell align="center">
                              {!kw.inMyTitle && (
                                <IconButton size="small" onClick={() => {
                                  navigator.clipboard.writeText(kw.keyword); toast.success(`"${kw.keyword}" kopyalandi`);
                                }}><Copy size={14} /></IconButton>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              )}
            </>
          ) : !loading && (
            <Alert severity="info" sx={{ borderRadius: '12px' }}>
              {myTitle
                ? 'Oncelikle bir arama yapin, ardindan SEO skorunuz otomatik hesaplanacak.'
                : 'SEO analizi icin yukaridaki "Benim Basligim" ve "Benim Taglarim" alanlarini doldurun ve arama yapin.'}
            </Alert>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 11: AI MARKET ANALYSIS                                       */}
      {/* ================================================================ */}
      {tab === 11 && (
        <Box>
          <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
            <Box sx={{
              width: 56, height: 56, borderRadius: '16px', display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', background: GRADIENTS.purple, mb: 1.5,
            }}>
              <Sparkles size={28} color="#fff" />
            </Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>AI Destekli Pazar Analizi</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Gemini AI ile pazar verilerinizi analiz edin
            </Typography>
            <Button variant="contained" onClick={generateAiInsights}
              disabled={aiLoading || items.length === 0} size="large"
              startIcon={aiLoading ? <CircularProgress size={16} /> : <Sparkles size={16} />}
              sx={{
                background: GRADIENTS.purple, borderRadius: '12px', px: 4,
                boxShadow: '0 4px 12px rgba(123,31,162,0.3)',
              }}
            >
              {aiLoading ? 'Analiz ediliyor...' : 'AI Analizi Baslat'}
            </Button>
            {items.length === 0 && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                Oncelikle bir arama yapin
              </Typography>
            )}
          </Paper>

          {aiLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

          {aiAnalysis && (
            <>
              <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
                <ScoreRing score={aiAnalysis.opportunity_score} size={140} label="Firsat" />
                <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                  Seviye: <strong>{aiAnalysis.opportunity_level}</strong>
                </Typography>
              </Paper>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Pazar Ozeti</Typography>
                <Typography variant="body2">{aiAnalysis.market_summary}</Typography>
              </Paper>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
                {[
                  { title: 'Fiyatlandirma Stratejisi', text: aiAnalysis.pricing_strategy, color: '#2196F3', icon: <DollarSign size={16} /> },
                  { title: 'Nis Pozisyonlama', text: aiAnalysis.niche_positioning, color: '#9c27b0', icon: <Target size={16} /> },
                  { title: 'Rekabet Analizi', text: aiAnalysis.competition_analysis, color: '#eb3349', icon: <Users size={16} /> },
                  { title: 'Mevsimsel Tavsiyeler', text: aiAnalysis.seasonal_advice, color: '#ff9800', icon: <Calendar size={16} /> },
                ].map(card => (
                  <Paper key={card.title} sx={{ ...glassCard, p: 2.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Box sx={{
                        width: 28, height: 28, borderRadius: '8px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', bgcolor: `${card.color}15`,
                      }}>{card.icon}</Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: card.color }}>{card.title}</Typography>
                    </Box>
                    <Typography variant="body2">{card.text}</Typography>
                  </Paper>
                ))}
              </Box>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Baslik Optimizasyonu</Typography>
                <Typography variant="body2">{aiAnalysis.title_recommendations}</Typography>
              </Paper>

              {aiAnalysis.tag_recommendations?.length > 0 && (
                <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Onerilen Tagler</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {aiAnalysis.tag_recommendations.map((tag, i) => (
                      <Chip key={i} label={tag} size="small" variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(tag); toast.success('Kopyalandi'); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px', borderColor: '#9c27b0', color: '#9c27b0' }}
                      />
                    ))}
                  </Box>
                </Paper>
              )}

              {aiAnalysis.action_items?.length > 0 && (
                <Paper sx={{ ...glassCard, p: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#11998e' }}>
                    Yapilacaklar Listesi
                  </Typography>
                  {aiAnalysis.action_items.map((item, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.5, alignItems: 'flex-start' }}>
                      <Box sx={{
                        width: 22, height: 22, borderRadius: '6px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', background: GRADIENTS.success,
                        flexShrink: 0, mt: 0.2,
                      }}>
                        <Typography variant="caption" sx={{ color: '#fff', fontWeight: 700, fontSize: '0.65rem' }}>{i + 1}</Typography>
                      </Box>
                      <Typography variant="body2">{item}</Typography>
                    </Box>
                  ))}
                </Paper>
              )}
            </>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* BOTTOM TOOLBAR                                                   */}
      {/* ================================================================ */}
      <Paper sx={{
        ...glassCard, p: 2, mt: 3,
        display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <Button variant="outlined" size="small" startIcon={<Download size={14} />}
          onClick={exportCSV} disabled={items.length === 0}
          sx={{ borderRadius: '8px' }}>
          CSV Indir
        </Button>
        <Button variant="outlined" size="small" startIcon={<Bookmark size={14} />}
          onClick={saveSearch} disabled={!query.trim()}
          sx={{ borderRadius: '8px' }}>
          Aramayi Kaydet
        </Button>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {savedSearches.map((s, i) => (
          <Chip key={`${s.query}-${s.timestamp}`}
            label={`${s.query} (${new Date(s.timestamp).toLocaleDateString('tr-TR')})`}
            size="small" variant="outlined"
            onClick={() => loadSearch(s)}
            onDelete={() => deleteSaved(i)}
            deleteIcon={<Trash2 size={12} />}
            sx={{ cursor: 'pointer', borderRadius: '8px' }}
          />
        ))}
        {savedSearches.length === 0 && (
          <Typography variant="caption" color="text.secondary">Kayitli arama yok</Typography>
        )}
      </Paper>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Premium Empty State
// ---------------------------------------------------------------------------

function PremiumEmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Paper sx={{
      ...glassCard, p: 5, textAlign: 'center',
    }}>
      <Box sx={{ opacity: 0.2, mb: 2 }}>{icon}</Box>
      <Typography variant="h6" sx={{
        fontWeight: 800, mb: 1,
        background: GRADIENTS.primary,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {desc}
      </Typography>
    </Paper>
  );
}
