import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  LinearProgress, Alert, Tabs, Tab, Tooltip, IconButton,
  CircularProgress, InputAdornment, Switch, FormControlLabel,
  Autocomplete, Avatar,
} from '@mui/material';
import {
  Search, TrendingUp, DollarSign, Tag, BarChart2, ExternalLink,
  CheckCircle, XCircle, Users, Store, Gauge, Calculator,
  Download, Bookmark, Copy, Star, Trash2, Info, Sparkles, Hash,
  Eye, Heart, ShoppingBag, ArrowUpDown, Compass, Activity,
  Zap, Globe, ShoppingCart, Target, Calendar, ArrowRight,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketResearchData {
  query: string;
  topTags: Array<{ tag: string; count: number; pct: number }>;
  topKeywords: Array<{ keyword: string; count: number; pct: number }>;
  priceStats: { min: number; avg: number; median: number; max: number } | null;
}

interface EtsyMarketResearchProps {
  userId: string;
  shopId?: string;
  userListings?: any[];
  onMarketDataChange?: (data: MarketResearchData | null) => void;
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
// Reusable table sort hook
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

export default function EtsyMarketResearch({ userId, shopId, userListings, onMarketDataChange }: EtsyMarketResearchProps) {
  const t = useTranslations('etsy.marketResearch');
  const tr = useTranslations('etsy.research');
  const { locale, config, formatCurrency, formatDate, formatNumber } = useLocale();

  // --- controls ---
  const [tab, setTab] = useState(9); // Default to Profit Calculator (My Shop)
  const [section, setSection] = useState(0); // 0=My Shop, 1=Market Research, 2=Discovery
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
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
  const [shopRegion, setShopRegion] = useState<'us' | 'tr'>(config.defaultEtsyFeeRegion as 'us' | 'tr'); // US vs Turkey fee structure
  const [etsyAdsRoas, setEtsyAdsRoas] = useState(''); // Etsy Ads ROAS (e.g. 3 = $3 revenue per $1 spent)
  const [shopDiscoveryFailed, setShopDiscoveryFailed] = useState(false);

  // --- selected listing from user's shop ---
  const [selectedListingId, setSelectedListingId] = useState<number | null>(null);

  const selectedListing = useMemo(() => {
    if (!selectedListingId || !userListings?.length) return null;
    return userListings.find((l: any) => (l.listing_id || l.id) === selectedListingId) || null;
  }, [selectedListingId, userListings]);

  // Auto-fill fields when a listing is selected
  useEffect(() => {
    if (!selectedListing) return;
    const price = selectedListing.price;
    const priceVal = price ? (typeof price === 'object' ? (price.amount / (price.divisor || 100)) : price) : '';
    if (priceVal) setSellingPrice(String(priceVal.toFixed ? priceVal.toFixed(2) : priceVal));
    setMyTitle(selectedListing.title || '');
    setMyTags((selectedListing.tags || []).join(', '));

    // Build smart search query: tags ARE buyer search terms, use the best one
    const tags: string[] = selectedListing.tags || [];
    const title: string = selectedListing.title || '';
    const genericWords = new Set(['handmade', 'custom', 'personalized', 'gift', 'gifts', 'unique', 'cute', 'vintage', 'boho', 'rustic', 'modern', 'luxury', 'premium', 'sale', 'new', 'best', 'top']);

    // Strategy: find the most specific multi-word tag (these are actual buyer searches)
    const scoredTags = tags.map(tag => {
      const words = tag.toLowerCase().split(/\s+/);
      const meaningfulWords = words.filter(w => !genericWords.has(w) && w.length > 2);
      // Prefer: multi-word, non-generic, product-descriptive tags
      let score = meaningfulWords.length * 10; // more meaningful words = better
      if (words.length >= 2 && words.length <= 4) score += 20; // 2-4 word tags are ideal search queries
      if (words.length === 1) score -= 10; // single words too broad
      if (words.length > 5) score -= 5; // too long = too specific
      if (genericWords.has(words[0])) score -= 15; // starts with generic word
      return { tag, score };
    }).sort((a, b) => b.score - a.score);

    let smartQuery = '';
    if (scoredTags.length > 0 && scoredTags[0].score > 10) {
      smartQuery = scoredTags[0].tag;
    }

    // Fallback: extract core product words from title
    if (!smartQuery && title) {
      const titleWords = title.toLowerCase()
        .replace(/[|,\-–—]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !genericWords.has(w) && !/^\d+$/.test(w));
      smartQuery = titleWords.slice(0, 4).join(' ');
    }

    if (smartQuery) setQuery(smartQuery.substring(0, 60));
  }, [selectedListing]);

  // --- keyword filter ---
  const [kwShowMissing, setKwShowMissing] = useState(false);

  // --- saved ---
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);

  // --- Table sort states ---
  const [kwSortKey, setKwSortKey] = useState('score');
  const [kwSortDir, setKwSortDir] = useState<SortDir>('desc');
  const [shopSortKey, setShopSortKey] = useState('num_sales');
  const [shopSortDir, setShopSortDir] = useState<SortDir>('desc');
  const [tagComboSortKey, setTagComboSortKey] = useState('count');
  const [tagComboSortDir, setTagComboSortDir] = useState<SortDir>('desc');
  const [bestListingSortKey, setBestListingSortKey] = useState('num_favorers');
  const [bestListingSortDir, setBestListingSortDir] = useState<SortDir>('desc');

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

  // --- NEW: Rank Tracker ---
  const [trackedKeywords, setTrackedKeywords] = useState<any[]>([]);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankKeywordInput, setRankKeywordInput] = useState('');
  const [rankListingId, setRankListingId] = useState<number | null>(null);
  const [rankAddLoading, setRankAddLoading] = useState(false);
  const [expandedRankId, setExpandedRankId] = useState<string | null>(null);
  const [rankHistory, setRankHistory] = useState<any[]>([]);

  useEffect(() => { setSavedSearches(loadSavedSearches()); }, []);

  // --- Section/Tab navigation ---
  const SECTIONS = useMemo(() => [
    {
      label: t('myShop'),
      icon: <Store size={16} />,
      desc: t('optimizeYourListings'),
      tabs: [
        { idx: 9, label: t('profitCalculation'), icon: <Calculator size={14} />, tip: t('profitCalcTip') },
        { idx: 10, label: t('seoComparisonLabel'), icon: <TrendingUp size={14} />, tip: t('seoComparisonTip') },
        { idx: 11, label: t('rankTrackingLabel'), icon: <Target size={14} />, tip: t('rankTrackingTip') },
      ],
    },
    {
      label: t('marketResearch'),
      icon: <BarChart2 size={16} />,
      desc: t('analyzeCompetitors'),
      tabs: [
        { idx: 100, label: t('results'), icon: <BarChart2 size={14} />, tip: t('resultsTip') },
        { idx: 101, label: t('keywordTag'), icon: <Hash size={14} />, tip: t('keywordTagTip') },
        { idx: 102, label: t('shopAI'), icon: <Store size={14} />, tip: t('shopAITip') },
      ],
    },
    {
      label: t('discoveryAndTrends'),
      icon: <Compass size={16} />,
      desc: t('discoverOpportunities'),
      tabs: [
        { idx: 0, label: t('keywordDiscovery'), icon: <Compass size={14} />, tip: t('keywordDiscoveryTip') },
        { idx: 1, label: t('trendAnalysis'), icon: <Activity size={14} />, tip: t('trendAnalysisTip') },
      ],
    },
  ], [t]);

  const handleSectionChange = useCallback((newSection: number) => {
    setSection(newSection);
    setTab(SECTIONS[newSection].tabs[0].idx);
  }, [SECTIONS]);

  // --- Suggested keywords from existing listings ---
  const suggestedKeywords = useMemo(() => {
    if (!userListings?.length) return [];
    const tagFreq: Record<string, number> = {};
    userListings.forEach((l: any) => {
      (l.tags || []).forEach((t: string) => {
        const tag = t.toLowerCase().trim();
        if (tag.length > 2) tagFreq[tag] = (tagFreq[tag] || 0) + 1;
      });
    });
    return Object.entries(tagFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [userListings]);

  // ---------------------------------------------------------------------------
  // Rank Tracker functions
  // ---------------------------------------------------------------------------

  const fetchTrackedKeywords = useCallback(async () => {
    if (!shopId) return;
    setRankLoading(true);
    try {
      const res = await fetch(`/api/clawd/etsy?action=get_tracked_keywords&shop_id=${shopId}`);
      if (!res.ok) throw new Error(t('trackedKeywordsFetchFailed'));
      const data = await res.json();
      setTrackedKeywords(data.keywords || []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRankLoading(false);
    }
  }, [shopId]);

  const addTrackedKeyword = useCallback(async () => {
    if (!rankKeywordInput.trim() || !rankListingId || !shopId) return;
    setRankAddLoading(true);
    try {
      const listing = userListings?.find((l: any) => (l.listing_id || l.id) === rankListingId);
      const res = await fetch(`/api/clawd/etsy?action=add_tracked_keyword&shop_id=${shopId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: rankKeywordInput.trim(),
          listing_id: rankListingId,
          listing_title: listing?.title || '',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t('addFailed'));
      }
      const data = await res.json();
      toast.success(
        data.rank != null
          ? t('rankFoundAt', { keyword: rankKeywordInput, rank: data.rank, page: data.page })
          : t('rankNotFound', { keyword: rankKeywordInput })
      );
      setRankKeywordInput('');
      fetchTrackedKeywords();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRankAddLoading(false);
    }
  }, [rankKeywordInput, rankListingId, shopId, userListings, fetchTrackedKeywords]);

  const removeTrackedKeyword = useCallback(async (keywordId: string) => {
    try {
      await fetch(`/api/clawd/etsy?action=remove_tracked_keyword&keyword_id=${keywordId}&shop_id=${shopId}`, {
        method: 'DELETE',
      });
      setTrackedKeywords((prev) => prev.filter((k) => k.id !== keywordId));
      toast.success(t('removedFromTracking'));
    } catch {
      toast.error(t('deleteFailed'));
    }
  }, [shopId]);

  const fetchRankHistory = useCallback(async (keywordId: string) => {
    if (expandedRankId === keywordId) {
      setExpandedRankId(null);
      return;
    }
    setExpandedRankId(keywordId);
    try {
      const res = await fetch(`/api/clawd/etsy?action=get_rank_history&keyword_id=${keywordId}&shop_id=${shopId}`);
      if (!res.ok) throw new Error(t('historyFetchFailed'));
      const data = await res.json();
      setRankHistory(data.snapshots || []);
    } catch {
      setRankHistory([]);
    }
  }, [expandedRankId, shopId]);

  // Load tracked keywords when rank tab is selected
  useEffect(() => {
    if (tab === 11 && shopId) fetchTrackedKeywords();
  }, [tab, shopId, fetchTrackedKeywords]);

  // ---------------------------------------------------------------------------
  // Emit market research data to parent
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!onMarketDataChange) return;
    if (serverTagFreq.length === 0 && serverKeywords.length === 0) {
      onMarketDataChange(null);
      return;
    }
    const prices = items.map(i => i.price).filter(p => p > 0).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    onMarketDataChange({
      query,
      topTags: serverTagFreq.slice(0, 30),
      topKeywords: serverKeywords.slice(0, 20),
      priceStats: prices.length > 0 ? {
        min: prices[0],
        max: prices[prices.length - 1],
        avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
        median: prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid],
      } : null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTagFreq, serverKeywords, items.length]);

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
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || t('searchFailed')); }
      const data = await res.json();
      setItems(data.items || []);
      setTotalResults(data.total || 0);
      setServerTagFreq(data.tagFrequency || []);
      setServerKeywords(data.titleKeywords || []);
      setServerShopIds(data.shopIds || []);
      toast.success(t('resultsFound', { count: formatNumber(data.total || 0) }));
      if (data.shopIds?.length > 0) discoverShops(data.shopIds);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [query, sortOn, minPrice, maxPrice]);

  // Auto-trigger search when pendingSearchRef is set (used by keyword explorer send-to-search)
  useEffect(() => {
    if (pendingSearchRef.current && query.trim()) {
      pendingSearchRef.current = false;
      searchMarket();
    }
  }, [query, searchMarket]);

  const discoverShops = useCallback(async (shopIds: number[]) => {
    setShopsLoading(true);
    try {
      const ids = shopIds.slice(0, 20).join(',');
      const res = await fetch(`/api/clawd/etsy?action=batch_shops&shop_ids=${ids}`);
      if (!res.ok) throw new Error(t('shopInfoFailed'));
      const data = await res.json();
      setDiscoveredShops(data.shops || []);
      setShopDiscoveryFailed(false);
    } catch (err: any) { console.error('Shop discovery error:', err); toast.error(t('shopDiscoveryError')); setShopDiscoveryFailed(true); }
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
      if (!shopRes.ok) throw new Error(t('shopNotFound'));
      const shopData = await shopRes.json();
      setDeepDiveShop(shopData);
      if (listingsRes.ok) {
        const listData = await listingsRes.json();
        setDeepDiveListings(listData.listings || []);
      }
      toast.success(t('shopSalesInfo', { name: shopData.shop_name, sales: formatNumber(shopData.num_sales) }));
    } catch (err: any) { toast.error(err.message); }
    finally { setDeepDiveLoading(false); }
  }, [deepDiveShopId]);

  // Auto-trigger deep dive when shop ID is set from shop table click
  const prevDeepDiveRef = useRef(deepDiveShopId);
  const pendingSearchRef = useRef(false);
  useEffect(() => {
    if (deepDiveShopId && deepDiveShopId !== prevDeepDiveRef.current && tab === 102) {
      searchShopDeepDive();
    }
    prevDeepDiveRef.current = deepDiveShopId;
  }, [deepDiveShopId, tab, searchShopDeepDive]);

  const generateAiInsights = useCallback(async () => {
    if (items.length === 0) { toast.error(t('doSearchFirst')); return; }
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
      if (!res.ok) throw new Error(t('aiAnalysisFailed'));
      const data = await res.json();
      setAiAnalysis(data.analysis);
      toast.success(t('aiAnalysisComplete'));
    } catch (err: any) { toast.error(err.message); }
    finally { setAiLoading(false); }
  }, [items, query, totalResults, serverTagFreq, serverKeywords, discoveredShops, serverShopIds]);

  // --- NEW: Keyword Explorer ---
  const searchKeywords = useCallback(async () => {
    const kw = kwExplorerQuery.trim() || query.trim();
    if (!kw) { toast.error(t('enterKeyword')); return; }
    setKwExplorerLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'autocomplete', keyword: kw,
        ...(kwAlphabetSoup ? { alphabet: 'true' } : {}),
      });
      const res = await fetch(`/api/trends/etsy?${params}`);
      if (!res.ok) throw new Error(t('keywordSuggestionFailed'));
      const data = await res.json();
      setKwSuggestions(data.suggestions || []);
      toast.success(t('suggestionsFound', { count: data.totalFound }));
    } catch (err: any) { toast.error(err.message); }
    finally { setKwExplorerLoading(false); }
  }, [kwExplorerQuery, query, kwAlphabetSoup]);

  // --- NEW: Trend Analysis ---
  const fetchTrends = useCallback(async () => {
    const kw = query.trim() || kwExplorerQuery.trim();
    if (!kw) { toast.error(t('enterKeyword')); return; }
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
      toast.success(t('trendDataLoaded'));
    } catch (err: any) { toast.error(err.message); }
    finally { setTrendLoading(false); setSeasonalLoading(false); }
  }, [query, kwExplorerQuery]);

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
    const tags = myTags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (userListings?.length) {
      userListings.forEach(l => { (l.tags || []).forEach((t: string) => tags.push(t.toLowerCase().trim())); });
    }
    return new Set(tags);
  }, [myTags, userListings]);

  const enrichedTags = useMemo(() => serverTagFreq.map(tg => ({ ...tg, inMyTags: myTagsSet.has(tg.tag) })), [serverTagFreq, myTagsSet]);
  const tagGaps = useMemo(() => enrichedTags.filter(t => !t.inMyTags && t.pct >= 5), [enrichedTags]);

  const tagCombos = useMemo(() => {
    if (items.length === 0) return [];
    const pairFreq: Record<string, { count: number; totalFav: number }> = {};
    items.forEach(item => {
      const tags = (item.tags || []).map(s => s.toLowerCase().trim()).filter(Boolean);
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
    const totalActiveListings = shops.reduce((s, sh) => s + (sh.listing_active_count || 0), 0);
    const top5ActiveListings = shops.slice(0, 5).reduce((s, sh) => s + (sh.listing_active_count || 0), 0);

    return { shops, totalSales, avgRating: Math.round(avgRating * 100) / 100, top5Sales: top5ActiveListings, totalListings: totalActiveListings };
  }, [discoveredShops, items]);

  // ---------------------------------------------------------------------------
  // Computed: Deep Dive
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Table sort helpers
  // ---------------------------------------------------------------------------

  const toggleSort = useCallback((key: string, currentKey: string, currentDir: SortDir, setKey: (k: string) => void, setDir: (d: SortDir) => void) => {
    if (currentKey === key) setDir(currentDir === 'asc' ? 'desc' : 'asc');
    else { setKey(key); setDir('desc'); }
  }, []);

  const sortArray = useCallback(<T,>(arr: T[], key: string, dir: SortDir): T[] => {
    if (!key) return arr;
    return [...arr].sort((a: any, b: any) => {
      let va = a[key] ?? 0, vb = b[key] ?? 0;
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb as string).toLowerCase(); }
      return dir === 'asc' ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
    });
  }, []);

  const sortedKwSuggestions = useMemo(() => sortArray(kwSuggestions, kwSortKey, kwSortDir), [kwSuggestions, kwSortKey, kwSortDir, sortArray]);
  const sortedShops = useMemo(() => shopStats ? sortArray(shopStats.shops, shopSortKey, shopSortDir) : [], [shopStats, shopSortKey, shopSortDir, sortArray]);
  const sortedTagCombos = useMemo(() => sortArray(tagCombos, tagComboSortKey, tagComboSortDir), [tagCombos, tagComboSortKey, tagComboSortDir, sortArray]);

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

  const sortedBestListings = useMemo(() => deepDiveStats ? sortArray(deepDiveStats.bestListings, bestListingSortKey, bestListingSortDir) : [], [deepDiveStats, bestListingSortKey, bestListingSortDir, sortArray]);

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
    if (missingKw.length > 0) recommendations.push(t('recAddMissingKeywords', { keywords: missingKw.map(k => k.keyword).join(', ') }));
    if (tagGaps.length > 0) recommendations.push(t('recAddMissingTags', { tags: tagGaps.slice(0, 5).map(tg => tg.tag).join(', ') }));
    if (myTitle.length < 80) recommendations.push(t('recTitleTooShort', { length: myTitle.length }));
    if (myTagsSet.size < 13) recommendations.push(t('recAddMoreTags', { count: 13 - myTagsSet.size }));

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

  // Fee structures by region
  const FEE_PROFILES = useMemo(() => ({
    us: {
      label: t('usShop'),
      currency: '$',
      listingFee: 0.20,
      transactionRate: 0.065,     // 6.5%
      paymentProcessingRate: 0.03, // 3% + fixed
      paymentProcessingFixed: 0.25,
      offsiteAdsRate: 0.15,       // 15% (under $10k annual)
      regulatoryFee: 0,
      vatRate: 0,
      notes: t('usShopNotes'),
    },
    tr: {
      label: t('trShop'),
      currency: '$',
      listingFee: 0.20,
      transactionRate: 0.065,     // 6.5%
      paymentProcessingRate: 0.065, // 6.5% + 3 TL fixed (Turkey-specific)
      paymentProcessingFixed: 0.17, // ~3 TL ≈ $0.17
      offsiteAdsRate: 0.15,       // 15%
      regulatoryFee: 0.0227,      // 2.27% regulatory operating fee (Turkey-specific)
      vatRate: 0,                 // VAT handled separately by seller
      notes: t('trShopNotes'),
    },
  }), [t]);

  const profitCalc = useMemo(() => {
    const fees = FEE_PROFILES[shopRegion];
    const cost = parseFloat(purchaseCost) || 0;
    const sell = parseFloat(sellingPrice) || (priceStats?.avg || 0);
    const ship = parseFloat(shippingCost) || 0;
    const roas = parseFloat(etsyAdsRoas) || 0;
    const listingFee = fees.listingFee;
    const transactionFee = sell * fees.transactionRate;
    const paymentProcessing = sell * fees.paymentProcessingRate + fees.paymentProcessingFixed;
    const regulatoryFee = sell * fees.regulatoryFee;
    const offsiteAdsFee = includeOffsiteAds ? sell * fees.offsiteAdsRate : 0;
    // Etsy Ads: ROAS = revenue / ad spend → ad spend per sale = sell / ROAS
    const etsyAdsCost = roas > 0 ? sell / roas : 0;
    const totalFees = listingFee + transactionFee + paymentProcessing + regulatoryFee + offsiteAdsFee;
    const profit = sell - cost - ship - totalFees - etsyAdsCost;
    const margin = sell > 0 ? (profit / sell) * 100 : 0;
    const compare = [-20, 0, 20].map(delta => {
      const p = sell * (1 + delta / 100);
      const tf = p * fees.transactionRate;
      const pp = p * fees.paymentProcessingRate + fees.paymentProcessingFixed;
      const rf = p * fees.regulatoryFee;
      const oa = includeOffsiteAds ? p * fees.offsiteAdsRate : 0;
      const adCost = roas > 0 ? p / roas : 0;
      const pr = p - cost - ship - fees.listingFee - tf - pp - rf - oa - adCost;
      return {
        label: delta === 0 ? '__avg__' : delta < 0 ? `${delta}%` : `+${delta}%`,
        price: p, profit: pr, margin: p > 0 ? (pr / p) * 100 : 0,
      };
    });
    return { cost, sell, ship, listingFee, transactionFee, paymentProcessing, regulatoryFee, offsiteAdsFee, etsyAdsCost, roas, totalFees, profit, margin, compare, fees };
  }, [purchaseCost, sellingPrice, shippingCost, priceStats, includeOffsiteAds, shopRegion, FEE_PROFILES, etsyAdsRoas]);

  useEffect(() => {
    if (priceStats && !sellingPrice) setSellingPrice(priceStats.avg.toFixed(2));
  }, [priceStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const exportCSV = useCallback(() => {
    if (items.length === 0) { toast.error(t('noDataToExport')); return; }
    const headers = [t('csvHeaders.title'), t('csvHeaders.price'), t('csvHeaders.views'), t('csvHeaders.favorites'), t('csvHeaders.engagementRate'), t('csvHeaders.tagCount'), t('csvHeaders.stock'), t('csvHeaders.url')];
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
    toast.success(t('csvDownloaded'));
  }, [items, query]);

  const saveSearch = useCallback(() => {
    const entry: SavedSearch = { query, minPrice, maxPrice, sortOn, myTitle, myTags, timestamp: Date.now() };
    const updated = [entry, ...savedSearches.filter(s => s.query !== query)].slice(0, 20);
    saveSavedSearches(updated); setSavedSearches(updated);
    toast.success(t('searchSaved'));
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
      {/* SECTION NAVIGATION (3 groups)                                    */}
      {/* ================================================================ */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {SECTIONS.map((s, i) => (
          <Button
            key={i}
            onClick={() => handleSectionChange(i)}
            variant={section === i ? 'contained' : 'outlined'}
            startIcon={s.icon}
            sx={{
              flex: { xs: 1, md: 'none' },
              minWidth: { xs: 0, md: 160 },
              borderRadius: '14px',
              textTransform: 'none',
              fontWeight: section === i ? 700 : 500,
              py: 1.2,
              px: 2,
              fontSize: '0.85rem',
              ...(section === i ? {
                background: GRADIENTS.primary,
                boxShadow: '0 4px 16px rgba(102,126,234,0.35)',
                '&:hover': { boxShadow: '0 6px 20px rgba(102,126,234,0.45)' },
              } : {
                borderColor: '#e0e0e0',
                color: '#666',
                '&:hover': { borderColor: '#667eea', color: '#667eea', bgcolor: 'rgba(102,126,234,0.04)' },
              }),
            }}
          >
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{s.label}</Box>
            <Box sx={{ display: { xs: 'block', sm: 'none' }, fontSize: '0.75rem' }}>{s.label.split(' ')[0]}</Box>
          </Button>
        ))}
      </Box>

      {/* Section description */}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, pl: 0.5 }}>
        {SECTIONS[section].desc}
      </Typography>

      {/* Listing picker for My Shop section */}
      {section === 0 && userListings && userListings.length > 0 && (
        <Paper sx={{ ...glassCard, p: 2, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShoppingBag size={16} color="#667eea" />
            {t('selectListing')}
          </Typography>
          <Autocomplete
            options={userListings}
            getOptionLabel={(opt: any) => opt.title || `Listing #${opt.listing_id || opt.id}`}
            filterOptions={(options, { inputValue }) => {
              if (!inputValue) return options;
              const q = inputValue.toLowerCase();
              return options.filter((opt: any) => {
                const title = (opt.title || '').toLowerCase();
                const tags = (opt.tags || []).join(' ').toLowerCase();
                const id = String(opt.listing_id || opt.id || '');
                return title.includes(q) || tags.includes(q) || id.includes(q);
              });
            }}
            value={selectedListing}
            onChange={(_, val: any) => setSelectedListingId(val ? (val.listing_id || val.id) : null)}
            renderOption={(props, opt: any) => {
              const thumb = opt.thumbnail?.url_75x75 || opt.thumbnail?.url_170x135 || '';
              const priceObj = opt.price;
              const priceStr = priceObj
                ? (typeof priceObj === 'object' ? `$${(priceObj.amount / (priceObj.divisor || 100)).toFixed(2)}` : `$${priceObj}`)
                : '';
              return (
                <li {...props} key={opt.listing_id || opt.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', py: 0.5 }}>
                    <Avatar
                      src={thumb}
                      variant="rounded"
                      sx={{ width: 40, height: 40, bgcolor: '#f5f5f5' }}
                    >
                      <ShoppingBag size={18} />
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {opt.title || `Listing #${opt.listing_id || opt.id}`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {priceStr} · {opt.views || 0} {t('views')} · {opt.num_favorers || 0} {t('favorites')}
                      </Typography>
                    </Box>
                  </Box>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                placeholder={t('searchPlaceholder')}
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <InputAdornment position="start"><Search size={16} color="#999" /></InputAdornment>
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
              />
            )}
            isOptionEqualToValue={(opt: any, val: any) => (opt.listing_id || opt.id) === (val.listing_id || val.id)}
            noOptionsText={t('listingNotFound')}
            sx={{ mb: 1 }}
          />
          {selectedListing && (
            <Box sx={{ mt: 1.5 }}>
              <Alert severity="success" sx={{ borderRadius: '10px', py: 0.5, mb: 1.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {t('listingFieldsFilled', { price: fmt(profitCalc.sell), tagCount: (selectedListing.tags || []).length })}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  {t('searchQueryEditable', { query })}
                </Typography>
              </Alert>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<Search size={14} />}
                  onClick={() => {
                    handleSectionChange(1);
                    pendingSearchRef.current = true;
                    // Trigger via useEffect so searchMarket has latest query
                    setQuery(q => q); // force re-render
                    setTimeout(() => searchMarket(), 100);
                  }}
                  sx={{ background: GRADIENTS.primary, borderRadius: '10px', textTransform: 'none', fontWeight: 600 }}
                >
                  {t('competitorAnalysis')}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<TrendingUp size={14} />}
                  onClick={() => {
                    handleSectionChange(1);
                    setTab(101);
                    pendingSearchRef.current = true;
                    setQuery(q => q);
                    setTimeout(() => searchMarket(), 100);
                  }}
                  sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 600 }}
                >
                  {t('tagGapAnalysis')}
                </Button>
              </Box>
            </Box>
          )}
          {!selectedListing && (
            <Typography variant="caption" color="text.secondary">
              {t('selectListingHint')}
            </Typography>
          )}
        </Paper>
      )}

      {/* Sub-tabs for current section */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={pillTabsSx}
      >
        {SECTIONS[section].tabs.map(tg => (
          <Tab
            key={tg.idx}
            value={tg.idx}
            icon={tg.icon}
            iconPosition="start"
            label={
              <Tooltip title={tg.tip} arrow placement="top">
                <span>{tg.label}</span>
              </Tooltip>
            }
          />
        ))}
      </Tabs>

      {/* ================================================================ */}
      {/* SEARCH BAR (shown for Market Research & Discovery sections)    */}
      {/* ================================================================ */}
      {(section === 1 || section === 2) && (
        <Box sx={{
          background: GRADIENTS.primary, borderRadius: '16px', p: { xs: 1.5, md: 2 }, mb: 2,
          position: 'relative', overflow: 'hidden',
        }}>
          <Box sx={{ position: 'absolute', top: -30, right: -30, width: 80, height: 80, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.1)' }} />

          <Paper sx={{ p: { xs: 1.5, md: 2 }, borderRadius: '12px', position: 'relative', zIndex: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <TextField
                label={t('whatAreYouSelling')}
                value={query} onChange={e => setQuery(e.target.value)}
                size="small" sx={{ flex: 2, minWidth: 200 }}
                placeholder={t('searchExamplePlaceholder')}
                onKeyDown={handleKeyDown}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><Search size={16} color="#667eea" /></InputAdornment>,
                }}
              />
              <TextField label={t('minPrice')} value={minPrice} onChange={e => setMinPrice(e.target.value)}
                size="small" type="number" sx={{ width: 80 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
              <TextField label={t('maxPrice')} value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
                size="small" type="number" sx={{ width: 80 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
              <TextField label={t('sorting')} value={sortOn} onChange={e => setSortOn(e.target.value)}
                size="small" select sx={{ width: 130 }} SelectProps={{ native: true }}>
                <option value="score">{t('bestMatch')}</option>
                <option value="price">{t('price')}</option>
                <option value="created">{t('newlyAdded')}</option>
                <option value="updated">{t('lastUpdated')}</option>
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
                {t('research')}
              </Button>
            </Box>

            {/* Suggested keywords from existing listings */}
            {suggestedKeywords.length > 0 && !query && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                  {t('shopSuggestions')}:
                </Typography>
                {suggestedKeywords.map(kw => (
                  <Chip
                    key={kw}
                    label={kw}
                    size="small"
                    variant="outlined"
                    onClick={() => setQuery(kw)}
                    sx={{
                      mr: 0.5, mb: 0.5, cursor: 'pointer', borderRadius: '8px',
                      fontSize: '0.72rem', borderColor: '#667eea', color: '#667eea',
                      '&:hover': { bgcolor: 'rgba(102,126,234,0.08)' },
                    }}
                  />
                ))}
              </Box>
            )}

            {/* My Title + Tags — collapsible advanced section */}
            <Box sx={{ mt: 1 }}>
              <Button
                size="small"
                onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
                sx={{ textTransform: 'none', fontSize: '0.75rem', color: selectedListing ? '#667eea' : '#999', px: 0, fontWeight: selectedListing ? 600 : 400 }}
                endIcon={<ArrowUpDown size={12} />}
              >
                {selectedListing
                  ? t('listingTitleTagsLoaded', { title: selectedListing.title?.slice(0, 30) })
                  : showAdvancedSearch ? t('hideAdvancedSettings') : t('enterTitleTagForSeo')
                }
              </Button>
              {showAdvancedSearch && (
                <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                  <TextField label={t('myTitle')} value={myTitle}
                    onChange={e => setMyTitle(e.target.value)} size="small"
                    sx={{ flex: 2, minWidth: 200 }} placeholder={t('enterListingTitle')}
                    helperText={t('charCount', { count: myTitle.length, max: 140 })}
                  />
                  <TextField label={t('myTagsComma')} value={myTags}
                    onChange={e => setMyTags(e.target.value)} size="small"
                    sx={{ flex: 2, minWidth: 200 }} placeholder={t('tagsExamplePlaceholder')}
                    helperText={t('tagCount', { count: myTags.split(',').filter(t => t.trim()).length, max: 13 })}
                  />
                </Box>
              )}
            </Box>
          </Paper>
        </Box>
      )}

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
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('keywordDiscoveryTitle')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('keywordDiscoveryDesc')}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <TextField
                value={kwExplorerQuery} onChange={e => setKwExplorerQuery(e.target.value)}
                size="small" sx={{ flex: 2, minWidth: 200 }}
                placeholder={query || t('kwExplorerPlaceholder')}
                onKeyDown={e => e.key === 'Enter' && searchKeywords()}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
                }}
              />
              <FormControlLabel
                control={<Switch checked={kwAlphabetSoup} onChange={e => setKwAlphabetSoup(e.target.checked)} size="small" />}
                label={<Typography variant="caption">{t('azExpand')}</Typography>}
              />
              <Button variant="contained" onClick={searchKeywords}
                disabled={kwExplorerLoading}
                startIcon={kwExplorerLoading ? <CircularProgress size={16} /> : <Zap size={16} />}
                sx={{ background: GRADIENTS.info, borderRadius: '10px' }}
              >
                {t('discover')}
              </Button>
            </Box>
          </Paper>

          {kwExplorerLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

          {kwSuggestions.length > 0 && (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                <StatCard label={t('totalSuggestions')} value={String(kwSuggestions.length)} color="#2196F3"
                  icon={<Compass size={18} />} />
                <StatCard label={t('multiSource')} value={String(kwSuggestions.filter(s => s.sourceCount > 1).length)}
                  color="#4caf50" icon={<Globe size={18} />} />
                <StatCard label={t('highestScore')} value={String(kwSuggestions[0]?.score || 0)}
                  color="#ff9800" icon={<Target size={18} />} />
              </Box>

              <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                <TableContainer sx={{ maxHeight: 500 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                        <TableCell>#</TableCell>
                        <TableCell>{t('keywordHeader')}</TableCell>
                        <TableCell align="center">
                          <TableSortLabel active={kwSortKey === 'sourceCount'} direction={kwSortKey === 'sourceCount' ? kwSortDir : 'desc'} onClick={() => toggleSort('sourceCount', kwSortKey, kwSortDir, setKwSortKey, setKwSortDir)}>
                            {t('sources')}
                          </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">
                          <TableSortLabel active={kwSortKey === 'score'} direction={kwSortKey === 'score' ? kwSortDir : 'desc'} onClick={() => toggleSort('score', kwSortKey, kwSortDir, setKwSortKey, setKwSortDir)}>
                            {t('score')}
                          </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">{t('action')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedKwSuggestions.slice(0, 50).map((s, i) => (
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
                              <Tooltip title={t('sendToMainSearch')}>
                                <IconButton size="small" onClick={() => {
                                  pendingSearchRef.current = true;
                                  setQuery(s.keyword);
                                  setSection(1); setTab(100);
                                }}>
                                  <ArrowRight size={14} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={t('copyTooltip')}>
                                <IconButton size="small" onClick={() => {
                                  navigator.clipboard.writeText(s.keyword);
                                  toast.success(t('copied'));
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
              title={t('kwExploreTitle')}
              desc={t('kwExploreDesc')}
              steps={[t('kwExploreStep1'), t('kwExploreStep2'), t('kwExploreStep3')]}
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
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('trendAnalysis')}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('trendAnalysisDesc')}
            </Typography>
            <Button variant="contained" onClick={fetchTrends}
              disabled={trendLoading || (!query.trim() && !kwExplorerQuery.trim())} size="large"
              startIcon={trendLoading ? <CircularProgress size={16} /> : <TrendingUp size={16} />}
              sx={{ background: GRADIENTS.success, borderRadius: '12px', px: 4, boxShadow: '0 4px 12px rgba(17,153,142,0.3)' }}
            >
              {trendLoading ? t('analyzing') : t('startTrendAnalysis')}
            </Button>
            {!query.trim() && !kwExplorerQuery.trim() && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                {t('searchKeywordFirst')}
              </Typography>
            )}
          </Paper>

          {(trendLoading || seasonalLoading) && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

          {trendData && (
            <>
              {/* Trend summary cards */}
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                <StatCard label={t('avgInterest')} value={String(trendData.averageInterest)} color="#2196F3"
                  icon={<BarChart2 size={18} />} />
                <StatCard label={t('peakValue')} value={String(trendData.peakValue)} color="#4caf50"
                  icon={<TrendingUp size={18} />} />
                <StatCard label={t('peakDate')} value={trendData.peakDate || '-'} color="#ff9800"
                  icon={<Calendar size={18} />} />
                <StatCard label={t('direction')} value={
                  trendData.trendDirection === 'rising' ? t('rising') :
                  trendData.trendDirection === 'declining' ? t('declining') : t('stable')
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
                    {t('googleTrends12m')}
                  </Typography>
                  <TrendChart data={trendData.timeline} />
                </Paper>
              )}

              {/* Rising & top queries */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
                {trendData.risingQueries.length > 0 && (
                  <Paper sx={{ ...glassCard, p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#4caf50' }}>
                      {t('risingSearches')}
                    </Typography>
                    {trendData.risingQueries.map(q => (
                      <Box key={q.query} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{
                          cursor: 'pointer', '&:hover': { color: 'primary.main' },
                        }} onClick={() => { setQuery(q.query); toast.success(t('queryAdded')); }}>
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
                      {t('topRelatedSearches')}
                    </Typography>
                    {trendData.topQueries.map(q => (
                      <Box key={q.query} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{
                          cursor: 'pointer', '&:hover': { color: 'primary.main' },
                        }} onClick={() => { setQuery(q.query); toast.success(t('queryAdded')); }}>
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
                {t('seasonalCalendar')}
              </Typography>
              {seasonalData.peakMonth && (
                <Alert severity="success" sx={{ mb: 2, borderRadius: '12px' }}>
                  {t('peakMonth')}: <strong>{seasonalData.peakMonth}</strong> | {t('lowMonth')}: <strong>{seasonalData.lowMonth}</strong>
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
              title={t('trendAnalysis')}
              desc={t('trendEmptyDesc')}
              steps={[t('trendStep1'), t('trendStep2'), t('trendStep3')]}
            />
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 100: RESULTS (Price + Demand + Competitors combined)       */}
      {/* ================================================================ */}
      {tab === 100 && (
        <Box>
          {priceStats ? (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                <StatCard label={t('minimum')} value={fmt(priceStats.min)} color="#11998e" icon={<DollarSign size={18} />} />
                <StatCard label={t('average')} value={fmt(priceStats.avg)} color="#2196F3" icon={<BarChart2 size={18} />} />
                <StatCard label={t('median')} value={fmt(priceStats.median)} color="#ff9800" icon={<Target size={18} />} />
                <StatCard label={t('maximum')} value={fmt(priceStats.max)} color="#f44336" icon={<TrendingUp size={18} />} />
                <StatCard label={t('resultCount')} value={`${priceStats.count}`} color="#9c27b0" icon={<ShoppingBag size={18} />} />
              </Box>

              {sweetSpot && (
                <Alert severity="success" sx={{ mb: 2, borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)',
                  border: '1px solid rgba(17,153,142,0.2)',
                }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t('sweetSpotTitle')}: {sweetSpot.label}
                  </Typography>
                  <Typography variant="body2">
                    {t('sweetSpotDesc', { avgFav: sweetSpot.avgFav, count: sweetSpot.count })}
                  </Typography>
                </Alert>
              )}

              {/* Gradient Histogram */}
              {histogram.length > 1 && (
                <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('priceDistribution')}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: 140 }}>
                    {histogram.map((b, i) => (
                      <Tooltip key={i} title={`${b.label}: ${b.count} ${t('products')}`}>
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
                        <TableCell>{t('priceRange')}</TableCell>
                        <TableCell align="center">{t('products')}</TableCell>
                        <TableCell align="center">{t('ratio')}</TableCell>
                        <TableCell align="center">{t('avgFavorites')}</TableCell>
                        <TableCell sx={{ width: '25%' }}>{t('distribution')}</TableCell>
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
          ) : !loading && <PremiumEmptyState icon={<BarChart2 size={48} />} title={t('marketResults')}
              desc={t('marketResultsDesc')}
              steps={[t('marketResultsStep1'), t('marketResultsStep2'), t('marketResultsStep3')]}
            />}

          {/* --- Demand Score (merged from tab 8) --- */}
          {demandScore && (
            <Box sx={{ mt: 3 }}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Gauge size={18} color="#667eea" /> {t('demandOpportunityScore')}
              </Typography>
              <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
                <ScoreRing score={demandScore.score} size={120} label={t('opportunity')} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                  {demandScore.score >= 70 ? t('scoreHigh') : demandScore.score >= 40 ? t('scoreMedium') : t('scoreLow')}
                </Typography>

                {/* Score Breakdown Bars */}
                {(() => {
                  const bd = demandScore.breakdown;
                  const components = [
                    { key: 'supply', label: t('supplyScore'), value: bd.supplyScore, max: 25, weakness: t('supplyWeakness') },
                    { key: 'competition', label: t('competitionScore'), value: bd.compScore, max: 25, weakness: t('competitionWeakness') },
                    { key: 'demand', label: t('demandScore'), value: bd.demandPts, max: 20, weakness: t('demandWeakness') },
                    { key: 'engagement', label: t('engagementScore'), value: bd.engScore, max: 15, weakness: t('engagementWeakness') },
                    { key: 'variety', label: t('priceVariety'), value: bd.spreadScore, max: 15, weakness: t('priceVarietyWeakness') },
                  ];
                  const weakest = components.reduce((min, c) => (c.value / c.max) < (min.value / min.max) ? c : min, components[0]);

                  return (
                    <Box sx={{ textAlign: 'left', mt: 1 }}>
                      {components.map(c => {
                        const pctVal = (c.value / c.max) * 100;
                        const barColor = pctVal > 70 ? '#11998e' : pctVal >= 40 ? '#F2994A' : '#eb3349';
                        return (
                          <Box key={c.key} sx={{ mb: 1 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.3 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>{c.label}</Typography>
                              <Typography variant="caption" sx={{ fontWeight: 700, color: barColor }}>{c.value}/{c.max}</Typography>
                            </Box>
                            <Box sx={{ width: '100%', bgcolor: '#f0f0f0', borderRadius: 3, height: 8, overflow: 'hidden' }}>
                              <Box sx={{
                                width: `${pctVal}%`, height: 8, borderRadius: 3,
                                bgcolor: barColor,
                                transition: 'width 0.5s ease-out',
                              }} />
                            </Box>
                          </Box>
                        );
                      })}
                      <Alert severity="info" icon={<Info size={16} />} sx={{ mt: 1.5, borderRadius: '10px', py: 0.3, '& .MuiAlert-message': { fontSize: '0.78rem' } }}>
                        <strong>{t('weakestArea')}:</strong> {weakest.label} — {weakest.weakness}
                      </Alert>
                    </Box>
                  );
                })()}
              </Paper>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                {[
                  { label: t('totalResults'), value: formatNumber(demandScore.totalResults), desc: t('supplyAmount') },
                  { label: t('uniqueShops'), value: String(demandScore.uniqueShops), desc: t('competition') },
                  { label: t('avgFavoritesLabel'), value: String(demandScore.avgFavorites), desc: t('demandSignal') },
                  { label: t('avgViewsLabel'), value: String(demandScore.avgViews), desc: t('visibility') },
                  { label: t('engagement'), value: `${demandScore.avgEngagement}%`, desc: t('favPerViews') },
                  { label: t('priceSpread'), value: `${demandScore.priceSpread}x`, desc: t('variety') },
                ].map(m => (
                  <Paper key={m.label} sx={{ ...glassCard, p: 1.5, flex: 1, minWidth: 100 }}>
                    <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 500 }}>{m.label}</Typography>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{m.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{m.desc}</Typography>
                  </Paper>
                ))}
              </Box>
            </Box>
          )}

          {/* --- Competitor Products (merged from tab 5) --- */}
          {hasData && (
            <Box sx={{ mt: 3 }}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ShoppingBag size={18} color="#667eea" /> {t('competitorProducts', { count: items.length })}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                {(['none', 'price_asc', 'price_desc', 'favorites', 'views', 'engagement'] as const).map(s => (
                  <Chip key={s}
                    label={{ none: t('sortDefault'), price_asc: t('sortPriceAsc'), price_desc: t('sortPriceDesc'), favorites: t('sortFavorites'), views: t('sortViews'), engagement: t('sortEngagement') }[s]}
                    size="small" variant={compSort === s ? 'filled' : 'outlined'}
                    color={compSort === s ? 'primary' : 'default'}
                    onClick={() => setCompSort(s)} sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>
              <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                <TableContainer sx={{ maxHeight: 400 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                        <TableCell sx={{ width: 50 }} />
                        <TableCell>{t('titleHeader')}</TableCell>
                        <TableCell align="right">
                          <TableSortLabel active={compSort === 'price_asc' || compSort === 'price_desc'} direction={compSort === 'price_asc' ? 'asc' : 'desc'} onClick={() => setCompSort(compSort === 'price_desc' ? 'price_asc' : 'price_desc')}>
                            {t('priceHeader')}
                          </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">
                          <TableSortLabel active={compSort === 'favorites'} direction="desc" onClick={() => setCompSort('favorites')}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Heart size={12} /> Fav</Box>
                          </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">
                          <TableSortLabel active={compSort === 'engagement'} direction="desc" onClick={() => setCompSort('engagement')}>
                            {t('engagementShort')}
                          </TableSortLabel>
                        </TableCell>
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
                                  width: 40, height: 40, objectFit: 'cover', borderRadius: 8,
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                }} />
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.title}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>{fmt(item.price)}</Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" sx={{ fontWeight: 700, color: item.num_favorers > 100 ? '#11998e' : 'text.secondary' }}>
                                {formatNumber(item.num_favorers)}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Chip label={`${engagement.toFixed(1)}%`} size="small" sx={{
                                fontWeight: 600, borderRadius: '6px',
                                bgcolor: engagement > 5 ? '#e8f5e9' : '#fafafa',
                                color: engagement > 5 ? '#2e7d32' : '#999',
                              }} />
                            </TableCell>
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
                <Box sx={{ textAlign: 'center', mt: 1.5 }}>
                  <Button variant="outlined" size="small" onClick={() => setVisibleCount(c => c + 20)}
                    sx={{ borderRadius: '10px' }}>
                    {t('showMore', { remaining: items.length - visibleCount })}
                  </Button>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 101: KEYWORD & TAG (Tags + Keywords combined)             */}
      {/* ================================================================ */}
      {tab === 101 && (
        <Box>
          {enrichedTags.length > 0 ? (
            <>
              {tagGaps.length > 0 && myTagsSet.size > 0 && (
                <Alert severity="warning" sx={{ mb: 2, borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(242,153,74,0.08) 0%, rgba(242,201,76,0.08) 100%)',
                  border: '1px solid rgba(242,153,74,0.2)',
                }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t('missingTagsDetected', { count: tagGaps.length })}
                  </Typography>
                  <Typography variant="body2">
                    {t('missingTagsDesc')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                    {tagGaps.slice(0, 10).map(tg => (
                      <Chip key={tg.tag} label={`${tg.tag} (%${tg.pct})`} size="small" color="warning"
                        onClick={() => { navigator.clipboard.writeText(tg.tag); toast.success(t('copied')); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px' }}
                      />
                    ))}
                  </Box>
                </Alert>
              )}

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                  {t('topUsedTags', { count: enrichedTags.length })}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2.5 }}>
                  {enrichedTags.slice(0, 40).map(tg => (
                    <Chip key={tg.tag}
                      label={`${tg.tag} (%${tg.pct})`} size="small"
                      color={tg.inMyTags ? 'success' : tg.pct >= 30 ? 'error' : tg.pct >= 15 ? 'warning' : 'default'}
                      variant={tg.inMyTags ? 'filled' : 'outlined'}
                      onClick={() => { navigator.clipboard.writeText(tg.tag); toast.success(t('copied')); }}
                      sx={{ cursor: 'pointer', borderRadius: '8px' }}
                    />
                  ))}
                </Box>

                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('tagDensity')}</Typography>
                {enrichedTags.slice(0, 20).map(tg => (
                  <Box key={tg.tag} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 140, fontWeight: tg.inMyTags ? 700 : 400 }}>
                      {tg.inMyTags && <CheckCircle size={12} color="#4caf50" style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                      {tg.tag}
                    </Typography>
                    <Box sx={{ flex: 1 }}><GradientBar value={tg.pct} max={100} /></Box>
                    <Typography variant="caption" sx={{ minWidth: 35, fontWeight: 600 }}>{tg.pct}%</Typography>
                  </Box>
                ))}
              </Paper>

              {tagCombos.length > 0 && (
                <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                  <Box sx={{ p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {t('popularTagCombos')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('tagCombosDesc')}
                    </Typography>
                  </Box>
                  <TableContainer sx={{ maxHeight: 400 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                          <TableCell>{t('tagPair')}</TableCell>
                          <TableCell align="center"><TableSortLabel active={tagComboSortKey==='count'} direction={tagComboSortKey==='count'?tagComboSortDir:'desc'} onClick={()=>toggleSort('count',tagComboSortKey,tagComboSortDir,setTagComboSortKey,setTagComboSortDir)}>{t('usage')}</TableSortLabel></TableCell>
                          <TableCell align="center"><TableSortLabel active={tagComboSortKey==='avgFav'} direction={tagComboSortKey==='avgFav'?tagComboSortDir:'desc'} onClick={()=>toggleSort('avgFav',tagComboSortKey,tagComboSortDir,setTagComboSortKey,setTagComboSortDir)}>{t('avgFavorites')}</TableSortLabel></TableCell>
                          <TableCell align="center">{t('copy')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {sortedTagCombos.map(c => (
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
                                toast.success(t('copied'));
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
          ) : !loading && (
            hasData
              ? <Alert severity="info" sx={{ borderRadius: '12px' }}>{t('noTagData')}</Alert>
              : <PremiumEmptyState icon={<Hash size={48} />} title={t('keywordTagAnalysis')}
                  desc={t('keywordTagAnalysisDesc')}
                  steps={[t('tagStep1'), t('tagStep2'), t('tagStep3')]}
                />
          )}

          {/* --- Keywords (merged from tab 4) --- */}
          {hasData && (
            <Box sx={{ mt: 3 }}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tag size={18} color="#667eea" /> {t('keywords')}
              </Typography>
              <Alert severity="info" sx={{ mb: 2, borderRadius: '12px' }}>
                {t('keywordsDesc')}
              </Alert>

              {myTitle && (
                <Box sx={{ mb: 1.5 }}>
                  <Button size="small" variant={kwShowMissing ? 'contained' : 'outlined'}
                    onClick={() => setKwShowMissing(!kwShowMissing)} sx={{ mr: 1, borderRadius: '8px' }}>
                    {kwShowMissing ? t('allKeywords') : t('missingFromTitle')}
                  </Button>
                </Box>
              )}

              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('singleWords')}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                {(kwShowMissing ? enrichedKeywords.filter(k => !k.inMyTitle) : enrichedKeywords).map(kw => (
                  <Chip key={kw.keyword}
                    label={`${kw.keyword} (${kw.pct}%)`} size="small"
                    color={kw.pct >= 40 ? 'error' : kw.pct >= 20 ? 'warning' : 'default'}
                    variant={kw.inMyTitle ? 'filled' : 'outlined'}
                    onClick={() => { navigator.clipboard.writeText(kw.keyword); toast.success(t('copied')); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>

              {bigrams.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('bigramPhrases')}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                    {bigrams.slice(0, 25).map(b => (
                      <Chip key={b.phrase} label={`${b.phrase} (${b.count})`} size="small"
                        color={b.percentage >= 30 ? 'primary' : 'default'} variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(b.phrase); toast.success(t('copied')); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px' }}
                      />
                    ))}
                  </Box>
                </>
              )}

              {trigrams.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('longTailPhrases')}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                    {trigrams.slice(0, 20).map(tg => (
                      <Chip key={tg.phrase} label={`${tg.phrase} (${tg.count})`} size="small"
                        color="secondary" variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(tg.phrase); toast.success(t('copied')); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px' }}
                      />
                    ))}
                  </Box>
                </>
              )}

              {/* Keyword density */}
              <Paper sx={{ ...glassCard, p: 2.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('keywordDensity')}</Typography>
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
            </Box>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 102: SHOP & AI (Shops + Deep Dive + AI combined)          */}
      {/* ================================================================ */}
      {tab === 102 && (
        <Box>
          {shopsLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}
          {shopStats && shopStats.shops.length > 0 ? (
            <>
              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('shopConcentration')}</Typography>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                  <StatCard label={t('totalShops')} value={String(shopStats.shops.length)} color="#667eea" icon={<Store size={18} />} />
                  <StatCard label={t('avgRating')} value={`${shopStats.avgRating}`} color="#ff9800" icon={<Star size={18} />} />
                  <StatCard label={t('top5Share')} value={shopStats.totalListings > 0 ? pct((shopStats.top5Sales / shopStats.totalListings) * 100) : '0%'} color="#9c27b0" icon={<Users size={18} />} />
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
                    <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>{t('other')}</Typography>
                  </Box>
                </Box>
              </Paper>

              <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                <TableContainer sx={{ maxHeight: 500 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                        <TableCell>#</TableCell>
                        <TableCell>{t('shopHeader')}</TableCell>
                        <TableCell align="center"><TableSortLabel active={shopSortKey==='num_sales'} direction={shopSortKey==='num_sales'?shopSortDir:'desc'} onClick={()=>toggleSort('num_sales',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('salesHeader')}</TableSortLabel></TableCell>
                        <TableCell align="center"><TableSortLabel active={shopSortKey==='review_average'} direction={shopSortKey==='review_average'?shopSortDir:'desc'} onClick={()=>toggleSort('review_average',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('ratingHeader')}</TableSortLabel></TableCell>
                        <TableCell align="center"><TableSortLabel active={shopSortKey==='review_count'} direction={shopSortKey==='review_count'?shopSortDir:'desc'} onClick={()=>toggleSort('review_count',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('reviewsHeader')}</TableSortLabel></TableCell>
                        <TableCell align="center"><TableSortLabel active={shopSortKey==='listingCount'} direction={shopSortKey==='listingCount'?shopSortDir:'desc'} onClick={()=>toggleSort('listingCount',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('productsHeader')}</TableSortLabel></TableCell>
                        <TableCell align="center"><TableSortLabel active={shopSortKey==='avgPrice'} direction={shopSortKey==='avgPrice'?shopSortDir:'desc'} onClick={()=>toggleSort('avgPrice',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('avgPriceHeader')}</TableSortLabel></TableCell>
                        <TableCell sx={{ width: 40 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedShops.map((s, i) => (
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
                            }} onClick={() => { setDeepDiveShopId(String(s.shop_id)); }}>
                              {s.shop_name}
                            </Typography>
                          </TableCell>
                          <TableCell align="center"><Typography variant="body2" sx={{ fontWeight: 700 }}>{formatNumber(s.num_sales)}</Typography></TableCell>
                          <TableCell align="center">
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3 }}>
                              <Star size={12} color="#ff9800" fill="#ff9800" /> {s.review_average.toFixed(1)}
                            </Box>
                          </TableCell>
                          <TableCell align="center">{formatNumber(s.review_count)}</TableCell>
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
            shopDiscoveryFailed && serverShopIds.length > 0
              ? <Alert severity="error" sx={{ borderRadius: '12px', mb: 2 }}
                  action={<Button color="inherit" size="small" onClick={() => discoverShops(serverShopIds)}>{t('retry')}</Button>}
                >
                  {t('shopInfoFailed')}
                </Alert>
              : hasData
                ? <Alert severity="info" sx={{ borderRadius: '12px' }}>{t('shopInfoLoading')}</Alert>
                : <PremiumEmptyState icon={<Users size={48} />} title={t('shopAnalysis')}
                    desc={t('shopAnalysisDesc')}
                    steps={[t('shopStep1'), t('shopStep2'), t('shopStep3')]}
                  />
          )}
          {/* --- Shop Deep Dive (merged from tab 7) --- */}
          <Divider sx={{ my: 3 }} />
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('shopDeepAnalysis')}</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField label={t('shopId')} value={deepDiveShopId}
                onChange={e => setDeepDiveShopId(e.target.value)} size="small"
                sx={{ flex: 1, minWidth: 200 }} placeholder={t('enterShopId')}
                onKeyDown={e => e.key === 'Enter' && searchShopDeepDive()}
              />
              <Button variant="contained" onClick={searchShopDeepDive}
                disabled={deepDiveLoading || !deepDiveShopId.trim()}
                startIcon={deepDiveLoading ? <CircularProgress size={16} /> : <Search size={16} />}
                sx={{ background: GRADIENTS.primary, borderRadius: '10px' }}
              >
                {t('analyze')}
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {t('shopAnalysisHint')}
            </Typography>
          </Paper>

          {deepDiveLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

          {deepDiveShop && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>{deepDiveShop.shop_name}</Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <StatCard label={t('totalSales')} value={formatNumber(deepDiveShop.num_sales)} color="#11998e" icon={<ShoppingCart size={18} />} />
                <StatCard label={t('rating')} value={`${deepDiveShop.review_average.toFixed(1)}`} color="#ff9800" icon={<Star size={18} />} />
                <StatCard label={t('reviews')} value={formatNumber(deepDiveShop.review_count)} color="#2196F3" icon={<Eye size={18} />} />
                <StatCard label={t('activeProducts')} value={String(deepDiveShop.listing_active_count)} color="#9c27b0" icon={<ShoppingBag size={18} />} />
              </Box>
            </Paper>
          )}

          {deepDiveStats && (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                <StatCard label={t('minPrice')} value={fmt(deepDiveStats.priceMin)} color="#11998e" />
                <StatCard label={t('avgPrice')} value={fmt(deepDiveStats.priceAvg)} color="#2196F3" />
                <StatCard label={t('maxPrice')} value={fmt(deepDiveStats.priceMax)} color="#f44336" />
                <StatCard label={t('avgFavLabel')} value={String(deepDiveStats.avgFav)} color="#e91e63" icon={<Heart size={18} />} />
                <StatCard label={t('avgViewsShort')} value={String(deepDiveStats.avgViews)} color="#ff9800" icon={<Eye size={18} />} />
              </Box>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('topUsedTagsShort')}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {deepDiveStats.topTags.map(tg => (
                    <Chip key={tg.tag} label={`${tg.tag} (%${tg.pct})`} size="small" variant="outlined"
                      onClick={() => { navigator.clipboard.writeText(tg.tag); toast.success(t('copied')); }}
                      sx={{ cursor: 'pointer', borderRadius: '8px' }}
                    />
                  ))}
                </Box>
              </Paper>

              <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                <Box sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('topProducts')}</Typography>
                </Box>
                <TableContainer sx={{ maxHeight: 400 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                        <TableCell>#</TableCell>
                        <TableCell>{t('titleHeader')}</TableCell>
                        <TableCell align="right"><TableSortLabel active={bestListingSortKey==='price'} direction={bestListingSortKey==='price'?bestListingSortDir:'desc'} onClick={()=>toggleSort('price',bestListingSortKey,bestListingSortDir,setBestListingSortKey,setBestListingSortDir)}>{t('priceHeader')}</TableSortLabel></TableCell>
                        <TableCell align="center"><TableSortLabel active={bestListingSortKey==='num_favorers'} direction={bestListingSortKey==='num_favorers'?bestListingSortDir:'desc'} onClick={()=>toggleSort('num_favorers',bestListingSortKey,bestListingSortDir,setBestListingSortKey,setBestListingSortDir)}>{t('favoriteHeader')}</TableSortLabel></TableCell>
                        <TableCell align="center"><TableSortLabel active={bestListingSortKey==='views'} direction={bestListingSortKey==='views'?bestListingSortDir:'desc'} onClick={()=>toggleSort('views',bestListingSortKey,bestListingSortDir,setBestListingSortKey,setBestListingSortDir)}>{t('viewsHeader')}</TableSortLabel></TableCell>
                        <TableCell sx={{ width: 40 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedBestListings.map((l, i) => (
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
                              {formatNumber(l.num_favorers)}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">{formatNumber(l.views)}</TableCell>
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

          {!deepDiveLoading && !deepDiveShop && !discoveredShops.length && !shopsLoading && (
            <PremiumEmptyState icon={<Store size={48} />} title={t('shopAIAnalysis')}
              desc={t('shopAIAnalysisDesc')}
              steps={[t('shopAIStep1'), t('shopAIStep2'), t('shopAIStep3')]} />
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 9: PROFIT CALCULATOR                                         */}
      {/* ================================================================ */}
      {tab === 9 && (
        <Box>
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {tr('etsyProfitCalculator')}
                {selectedListing && (
                  <Typography component="span" variant="caption" color="primary" sx={{ ml: 1, fontWeight: 500 }}>
                    — {selectedListing.title?.slice(0, 40)}...
                  </Typography>
                )}
              </Typography>
              {/* Region selector */}
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button
                  size="small"
                  variant={shopRegion === 'tr' ? 'contained' : 'outlined'}
                  onClick={() => setShopRegion('tr')}
                  sx={{
                    borderRadius: '10px', textTransform: 'none', fontSize: '0.75rem', px: 2,
                    ...(shopRegion === 'tr' ? { background: GRADIENTS.primary } : {}),
                  }}
                >
                  {tr('turkeyShop')}
                </Button>
                <Button
                  size="small"
                  variant={shopRegion === 'us' ? 'contained' : 'outlined'}
                  onClick={() => setShopRegion('us')}
                  sx={{
                    borderRadius: '10px', textTransform: 'none', fontSize: '0.75rem', px: 2,
                    ...(shopRegion === 'us' ? { background: GRADIENTS.primary } : {}),
                  }}
                >
                  {tr('usShop')}
                </Button>
              </Box>
            </Box>
            <Alert severity="info" sx={{ mb: 2, borderRadius: '10px', py: 0.5 }}>
              <Typography variant="caption">{profitCalc.fees.notes}</Typography>
            </Alert>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <TextField label={tr('purchaseCost')} value={purchaseCost}
                onChange={e => setPurchaseCost(e.target.value)}
                size="small" type="number" sx={{ flex: 1, minWidth: 140 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
              <TextField label={tr('sellingPrice')} value={sellingPrice || (priceStats?.avg.toFixed(2) || '')}
                onChange={e => setSellingPrice(e.target.value)}
                size="small" type="number" sx={{ flex: 1, minWidth: 140 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                helperText={selectedListing ? t('listingPrice') : priceStats ? `${tr('marketAverage')}: ${fmt(priceStats.avg)}` : tr('enterPrice')}
              />
              <TextField label={tr('shippingCost')} value={shippingCost}
                onChange={e => setShippingCost(e.target.value)}
                size="small" type="number" sx={{ flex: 1, minWidth: 140 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
              <TextField label={tr('etsyAdsRoas')} value={etsyAdsRoas}
                onChange={e => setEtsyAdsRoas(e.target.value)}
                size="small" type="number" sx={{ flex: 1, minWidth: 140 }}
                placeholder={tr('roasExample')}
                helperText={etsyAdsRoas && parseFloat(etsyAdsRoas) > 0
                  ? tr('roasHintWithValue', { roas: etsyAdsRoas, cost: fmt(profitCalc.etsyAdsCost) })
                  : tr('roasHint')
                }
              />
            </Box>
            <FormControlLabel
              control={<Switch checked={includeOffsiteAds} onChange={e => setIncludeOffsiteAds(e.target.checked)} size="small" />}
              label={<Typography variant="body2">{tr('offsiteAdsSwitch')}</Typography>}
            />
          </Paper>

          <Paper sx={{ ...glassCard, overflow: 'hidden', mb: 2 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {tr('feeDetails')} ({shopRegion === 'tr' ? tr('turkeyLabel') : tr('usLabel')} {tr('feeDetailsSuffix')})
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell>{tr('salePrice')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(profitCalc.sell)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {tr('listingFee')} <Tooltip title={tr('listingFeeTooltip')}><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.listingFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {tr('transactionCommission')} <Tooltip title={tr('transactionCommissionTooltip')}><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.transactionFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {tr('paymentProcessing')} ({shopRegion === 'tr' ? '%6.5 + 3₺' : '%3 + $0.25'})
                        <Tooltip title={shopRegion === 'tr'
                          ? tr('paymentProcessingTooltipTR')
                          : tr('paymentProcessingTooltipUS')
                        }><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.paymentProcessing)}</TableCell>
                  </TableRow>
                  {shopRegion === 'tr' && profitCalc.regulatoryFee > 0 && (
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {tr('regulatoryFee')}
                          <Tooltip title={tr('regulatoryFeeTooltip')}><Info size={14} color="#999" /></Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.regulatoryFee)}</TableCell>
                    </TableRow>
                  )}
                  {includeOffsiteAds && (
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {tr('offsiteAds')}
                          <Tooltip title={tr('offsiteAdsTooltip')}><Info size={14} color="#999" /></Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.offsiteAdsFee)}</TableCell>
                    </TableRow>
                  )}
                  {profitCalc.roas > 0 && (
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {tr('etsyAdsCost')} (ROAS: {profitCalc.roas}x)
                          <Tooltip title={tr('etsyAdsCostTooltip', { roas: String(profitCalc.roas), sell: fmt(profitCalc.sell), cost: fmt(profitCalc.etsyAdsCost) })}><Info size={14} color="#999" /></Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.etsyAdsCost)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow><TableCell>{tr('purchaseCostLabel')}</TableCell><TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.cost)}</TableCell></TableRow>
                  <TableRow><TableCell>{tr('shippingCostLabel')}</TableCell><TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.ship)}</TableCell></TableRow>
                  <TableRow sx={{
                    background: profitCalc.profit >= 0
                      ? 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)'
                      : 'linear-gradient(135deg, rgba(235,51,73,0.08) 0%, rgba(244,92,67,0.08) 100%)',
                  }}>
                    <TableCell sx={{ fontWeight: 800 }}>{tr('netProfit')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, color: profitCalc.profit >= 0 ? '#11998e' : '#eb3349' }}>
                      {fmt(profitCalc.profit)}
                    </TableCell>
                  </TableRow>
                  <TableRow sx={{
                    background: profitCalc.profit >= 0
                      ? 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)'
                      : 'linear-gradient(135deg, rgba(235,51,73,0.08) 0%, rgba(244,92,67,0.08) 100%)',
                  }}>
                    <TableCell sx={{ fontWeight: 800 }}>{tr('profitMargin')}</TableCell>
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
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{tr('differentPricePoints')}</Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                    <TableCell>{tr('scenario')}</TableCell>
                    <TableCell align="right">{tr('priceLabel')}</TableCell>
                    <TableCell align="right">{tr('profitLabel')}</TableCell>
                    <TableCell align="right">{tr('marginLabel')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profitCalc.compare.map(c => (
                    <TableRow key={c.label} hover sx={{ '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' } }}>
                      <TableCell sx={{ fontWeight: 600 }}>{c.label === '__avg__' ? tr('averageLabel') : c.label}</TableCell>
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
                  {t('seoCoverage', { coveredKw: seoResult.coveredKw, totalKw: seoResult.totalKw, coveredTags: seoResult.coveredTags, totalTags: seoResult.totalTags })}
                </Typography>
              </Paper>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('scoreDetail')}</Typography>
                {[
                  { label: t('kwCoverage'), score: seoResult.kwScore, max: 30 },
                  { label: t('tagCoverage'), score: seoResult.tagScore, max: 30 },
                  { label: t('titleLength'), score: seoResult.lengthScore, max: 20 },
                  { label: t('tagCount'), score: seoResult.hasTagsScore, max: 20 },
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
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('titleLength')}</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120, borderRadius: '12px' }}>
                    <Typography variant="caption" color="text.secondary">{t('mine')}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{myTitle.length} {t('chars')}</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120, borderRadius: '12px' }}>
                    <Typography variant="caption" color="text.secondary">{t('competitorAvg')}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{seoResult.avgLen} {t('chars')}</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120, borderRadius: '12px' }}>
                    <Typography variant="caption" color="text.secondary">{t('optimal')}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#11998e' }}>100-140</Typography>
                  </Paper>
                </Box>
              </Paper>

              {seoResult.recommendations.length > 0 && (
                <Alert severity={seoResult.score >= 70 ? 'success' : 'warning'} sx={{ mb: 2, borderRadius: '12px' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{t('recommendations')}</Typography>
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
                          <TableCell>{t('keywordHeader')}</TableCell>
                          <TableCell align="center">{t('usagePct')}</TableCell>
                          <TableCell align="center">{t('inMyTitle')}</TableCell>
                          <TableCell align="center">{t('copy')}</TableCell>
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
                                  navigator.clipboard.writeText(kw.keyword); toast.success(t('copied'));
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
            <PremiumEmptyState
              icon={<TrendingUp size={48} />}
              title={t('seoComparison')}
              desc={userListings?.length
                ? t('seoCompDescWithListings')
                : t('seoCompDescNoListings')
              }
              steps={userListings?.length
                ? [t('seoStepWithListing1'), t('seoStepWithListing2'), t('seoStepWithListing3')]
                : [t('seoStepNoListing1'), t('seoStepNoListing2'), t('seoStepNoListing3'), t('seoStepNoListing4')]
              }
            />
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 11: RANK TRACKER                                              */}
      {/* ================================================================ */}
      {tab === 11 && (
        <Box>
          {/* Add keyword form */}
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Target size={16} color="#667eea" /> {t('addKeywordToTrack')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Autocomplete
                options={userListings || []}
                getOptionLabel={(opt: any) => opt.title || `Listing #${opt.listing_id || opt.id}`}
                value={userListings?.find((l: any) => (l.listing_id || l.id) === rankListingId) || null}
                onChange={(_, val: any) => setRankListingId(val ? (val.listing_id || val.id) : null)}
                renderOption={(props, opt: any) => (
                  <li {...props} key={opt.listing_id || opt.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar
                        src={opt.thumbnail?.url_75x75 || ''}
                        variant="rounded"
                        sx={{ width: 32, height: 32, bgcolor: '#f5f5f5' }}
                      >
                        <ShoppingBag size={14} />
                      </Avatar>
                      <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                        {opt.title || `#${opt.listing_id || opt.id}`}
                      </Typography>
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField {...params} size="small" label={t('selectListing')} placeholder={t('searchListing')} />
                )}
                isOptionEqualToValue={(opt: any, val: any) => (opt.listing_id || opt.id) === (val.listing_id || val.id)}
                sx={{ flex: 2, minWidth: 200 }}
              />
              <TextField
                size="small"
                label={t('keyword')}
                placeholder={t('rankKeywordPlaceholder')}
                value={rankKeywordInput}
                onChange={(e) => setRankKeywordInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTrackedKeyword(); }}
                sx={{ flex: 1, minWidth: 150 }}
              />
              <Button
                variant="contained"
                onClick={addTrackedKeyword}
                disabled={rankAddLoading || !rankKeywordInput.trim() || !rankListingId}
                startIcon={rankAddLoading ? <CircularProgress size={14} /> : <Target size={14} />}
                sx={{
                  background: GRADIENTS.primary, borderRadius: '10px', textTransform: 'none',
                  fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >{t('track')}</Button>
            </Box>
          </Paper>

          {/* Tracked keywords table */}
          {rankLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={32} /></Box>
          ) : trackedKeywords.length === 0 ? (
            <PremiumEmptyState
              icon={<Target size={64} />}
              title={t('rankTracking')}
              desc={t('rankTrackingDesc')}
              steps={[t('rankStep1'), t('rankStep2'), t('rankStep3'), t('rankStep4')]}
            />
          ) : (
            <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'rgba(102,126,234,0.06)' }}>
                      <TableCell sx={{ fontWeight: 700 }}>{t('keyword')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('listing')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">{t('rank')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">{t('page')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">{t('change')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">{t('lastCheck')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {trackedKeywords.map((kw) => {
                      const rankColor = kw.rank == null ? '#eb3349'
                        : kw.rank <= 10 ? '#11998e'
                        : kw.rank <= 48 ? '#F2994A'
                        : kw.rank <= 96 ? '#e67e22'
                        : '#eb3349';
                      const changeIcon = kw.change == null ? ''
                        : kw.change > 0 ? `↑${kw.change}`
                        : kw.change < 0 ? `↓${Math.abs(kw.change)}`
                        : '—';
                      const changeColor = kw.change > 0 ? '#11998e' : kw.change < 0 ? '#eb3349' : '#999';

                      return (
                        <React.Fragment key={kw.id}>
                          <TableRow
                            hover
                            onClick={() => fetchRankHistory(kw.id)}
                            sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' } }}
                          >
                            <TableCell>
                              <Chip label={kw.keyword} size="small" sx={{ fontWeight: 600 }} />
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                {kw.listingTitle || `#${kw.etsyListingId}`}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Chip
                                label={kw.rank != null ? `#${kw.rank}` : t('notFound')}
                                size="small"
                                sx={{
                                  bgcolor: rankColor, color: '#fff', fontWeight: 700,
                                  fontSize: '0.75rem', minWidth: 48,
                                }}
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" fontWeight={600}>
                                {kw.page != null ? kw.page : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" sx={{ color: changeColor, fontWeight: 700 }}>
                                {changeIcon || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="caption" color="text.secondary">
                                {kw.checkedAt ? formatDate(new Date(kw.checkedAt)) : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeTrackedKeyword(kw.id); }}>
                                <Trash2 size={14} color="#e53935" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                          {/* Expanded rank history */}
                          {expandedRankId === kw.id && (
                            <TableRow>
                              <TableCell colSpan={7} sx={{ bgcolor: 'rgba(102,126,234,0.03)', py: 2 }}>
                                {rankHistory.length > 1 ? (
                                  <Box>
                                    <Typography variant="caption" fontWeight={700} sx={{ mb: 1, display: 'block' }}>
                                      {t('rankHistoryTitle')}
                                    </Typography>
                                    <Box sx={{ height: 120 }}>
                                      <TrendChart
                                        data={rankHistory.map((s: any) => ({
                                          date: formatDate(new Date(s.checkedAt)),
                                          value: s.rank != null ? Math.max(1, 500 - s.rank) : 0,
                                        }))}
                                        height={120}
                                        color={rankColor}
                                      />
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                                      {rankHistory.slice(-5).reverse().map((s: any, i: number) => (
                                        <Chip
                                          key={i}
                                          size="small"
                                          variant="outlined"
                                          label={`${formatDate(new Date(s.checkedAt))}: ${s.rank != null ? `#${s.rank}` : t('notFound')}`}
                                          sx={{ fontSize: '0.7rem' }}
                                        />
                                      ))}
                                    </Box>
                                  </Box>
                                ) : (
                                  <Typography variant="caption" color="text.secondary">
                                    {t('notEnoughData')}
                                  </Typography>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* Rank legend */}
          <Box sx={{ display: 'flex', gap: 1.5, mt: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              { label: t('page1Legend'), color: '#11998e' },
              { label: t('page2Legend'), color: '#e67e22' },
              { label: '96+', color: '#eb3349' },
            ].map((item) => (
              <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.color }} />
                <Typography variant="caption" color="text.secondary">{item.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* ================================================================ */}
      {/* AI MARKET ANALYSIS (part of tab 102)                              */}
      {/* ================================================================ */}
      {tab === 102 && (
        <Box sx={{ mt: 3 }}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Sparkles size={18} color="#9c27b0" /> {t('aiMarketAnalysis')}
          </Typography>
          <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('aiAnalysisDesc')}
            </Typography>
            <Button variant="contained" onClick={generateAiInsights}
              disabled={aiLoading || items.length === 0} size="large"
              startIcon={aiLoading ? <CircularProgress size={16} /> : <Sparkles size={16} />}
              sx={{
                background: GRADIENTS.purple, borderRadius: '12px', px: 4,
                boxShadow: '0 4px 12px rgba(123,31,162,0.3)',
              }}
            >
              {aiLoading ? t('analyzing') : t('startAIAnalysis')}
            </Button>
            {items.length === 0 && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                {t('searchFirst')}
              </Typography>
            )}
          </Paper>

          {aiLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

          {aiAnalysis && (
            <>
              <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
                <ScoreRing score={aiAnalysis.opportunity_score} size={140} label={t('opportunity')} />
                <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                  {t('level')}: <strong>{aiAnalysis.opportunity_level}</strong>
                </Typography>
              </Paper>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('marketSummary')}</Typography>
                <Typography variant="body2">{aiAnalysis.market_summary}</Typography>
              </Paper>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
                {[
                  { title: t('pricingStrategy'), text: aiAnalysis.pricing_strategy, color: '#2196F3', icon: <DollarSign size={16} /> },
                  { title: t('nichePositioning'), text: aiAnalysis.niche_positioning, color: '#9c27b0', icon: <Target size={16} /> },
                  { title: t('competitionAnalysis'), text: aiAnalysis.competition_analysis, color: '#eb3349', icon: <Users size={16} /> },
                  { title: t('seasonalAdvice'), text: aiAnalysis.seasonal_advice, color: '#ff9800', icon: <Calendar size={16} /> },
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
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('titleOptimization')}</Typography>
                <Typography variant="body2">{aiAnalysis.title_recommendations}</Typography>
              </Paper>

              {aiAnalysis.tag_recommendations?.length > 0 && (
                <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('suggestedTags')}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {aiAnalysis.tag_recommendations.map((tag, i) => (
                      <Chip key={i} label={tag} size="small" variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(tag); toast.success(t('copied')); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px', borderColor: '#9c27b0', color: '#9c27b0' }}
                      />
                    ))}
                  </Box>
                </Paper>
              )}

              {aiAnalysis.action_items?.length > 0 && (
                <Paper sx={{ ...glassCard, p: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#11998e' }}>
                    {t('actionItems')}
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
          {t('downloadCSV')}
        </Button>
        <Button variant="outlined" size="small" startIcon={<Bookmark size={14} />}
          onClick={saveSearch} disabled={!query.trim()}
          sx={{ borderRadius: '8px' }}>
          {t('saveSearch')}
        </Button>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {savedSearches.map((s, i) => (
          <Chip key={`${s.query}-${s.timestamp}`}
            label={`${s.query} (${formatDate(new Date(s.timestamp))})`}
            size="small" variant="outlined"
            onClick={() => loadSearch(s)}
            onDelete={() => deleteSaved(i)}
            deleteIcon={<Trash2 size={12} />}
            sx={{ cursor: 'pointer', borderRadius: '8px' }}
          />
        ))}
        {savedSearches.length === 0 && (
          <Typography variant="caption" color="text.secondary">{t('noSavedSearches')}</Typography>
        )}
      </Paper>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Premium Empty State
// ---------------------------------------------------------------------------

function PremiumEmptyState({ icon, title, desc, steps }: {
  icon: React.ReactNode; title: string; desc: string; steps?: string[];
}) {
  return (
    <Paper sx={{
      ...glassCard, p: 4, textAlign: 'center',
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
      <Typography variant="body2" color="text.secondary" sx={{ mb: steps ? 2 : 0 }}>
        {desc}
      </Typography>
      {steps && steps.length > 0 && (
        <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 1, textAlign: 'left', mt: 1 }}>
          {steps.map((step, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{
                width: 24, height: 24, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: GRADIENTS.primary, color: '#fff', fontSize: '0.7rem', fontWeight: 700,
              }}>
                {i + 1}
              </Box>
              <Typography variant="body2" color="text.secondary">{step}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}
