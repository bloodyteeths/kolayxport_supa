import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Alert, Tabs, Tab, Select, MenuItem, FormControl,
  InputLabel, Tooltip, IconButton, CircularProgress, InputAdornment,
  Collapse, Card, CardContent, CardMedia, Grid, Stack, Badge,
} from '@mui/material';
import {
  Search, TrendingUp, BarChart2, ExternalLink, CheckCircle, XCircle,
  ChevronDown, ChevronUp, Copy, Star, Info, Heart, ShieldCheck,
  Image as ImageIcon, FileText, Tag, Zap, Target, Award, ArrowRight,
  RefreshCw, AlertTriangle, ThumbsUp, ThumbsDown, Minus, Eye,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListingOptimizerProps {
  userId: string;
  marketplace: string;
  userListings?: any[];
  onNavigate?: (tool: string, data?: any) => void;
}

interface ListingImage {
  imageUrl: string;
}

interface ListingAspect {
  name: string;
  value: string;
}

interface MyListing {
  itemId: string;
  legacyItemId?: string;
  title: string;
  price: { value: string; currency: string };
  image?: { imageUrl: string };
  additionalImages?: ListingImage[];
  description?: string;
  condition?: string;
  categoryId?: string;
  categoryName?: string;
  seller?: { username: string; feedbackScore: number; feedbackPercentage: string };
  itemWebUrl?: string;
  quantitySold?: number;
  quantityAvailable?: number;
  aspects?: Record<string, string[]>;
  listingPolicies?: Record<string, unknown>;
}

interface HealthScore {
  total: number;
  title: number;
  description: number;
  images: number;
  aspects: number;
}

interface ScoredListing extends MyListing {
  health: HealthScore;
  imageCount: number;
  aspectCount: number;
  titleLength: number;
  descriptionLength: number;
}

interface MarketItem {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  condition?: string;
  image?: { imageUrl: string };
  itemWebUrl?: string;
  seller?: { username: string; feedbackScore: number; feedbackPercentage: string };
  categories?: { categoryId: string; categoryName: string }[];
  shippingOptions?: { shippingCostType: string; shippingCost?: { value: string; currency: string } }[];
  additionalImages?: ListingImage[];
  aspects?: Record<string, string[]>;
}

interface AspectConstraint {
  localizedAspectName: string;
  aspectUsage?: string;
  aspectRequired?: boolean;
  aspectValues?: { localizedValue: string }[];
}

interface CompetitorMetrics {
  avgTitleLength: number;
  avgPrice: number;
  avgImageCount: number;
  avgAspectCount: number;
  avgFeedbackScore: number;
  items: MarketItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) => `$${n.toFixed(2)}`;

function calcTitleScore(len: number): number {
  if (len >= 80) return 25;
  if (len >= 60) return 15;
  return 5;
}

function calcDescriptionScore(len: number): number {
  if (len >= 500) return 25;
  if (len >= 200) return 15;
  return 5;
}

function calcImagesScore(count: number): number {
  if (count >= 8) return 25;
  if (count >= 4) return 15;
  return 5;
}

function calcAspectsScore(count: number): number {
  if (count >= 8) return 25;
  if (count >= 4) return 15;
  return 5;
}

function calcHealth(listing: MyListing): HealthScore {
  const titleLen = (listing.title || '').length;
  const descLen = (listing.description || '').length;
  const imgCount = 1 + (listing.additionalImages?.length || 0);
  const aspectCount = listing.aspects ? Object.keys(listing.aspects).length : 0;

  const title = calcTitleScore(titleLen);
  const description = calcDescriptionScore(descLen);
  const images = calcImagesScore(imgCount);
  const aspects = calcAspectsScore(aspectCount);

  return { total: title + description + images + aspects, title, description, images, aspects };
}

function scoreListing(listing: MyListing): ScoredListing {
  const health = calcHealth(listing);
  return {
    ...listing,
    health,
    imageCount: 1 + (listing.additionalImages?.length || 0),
    aspectCount: listing.aspects ? Object.keys(listing.aspects).length : 0,
    titleLength: (listing.title || '').length,
    descriptionLength: (listing.description || '').length,
  };
}

function getHealthColor(score: number): string {
  if (score >= 75) return '#4caf50';
  if (score >= 50) return '#ff9800';
  return '#f44336';
}

function getHealthLabel(score: number, t?: any): string {
  if (score >= 75) return t ? t('good') : 'Good';
  if (score >= 50) return t ? t('medium') : 'Medium';
  return t ? t('critical') : 'Critical';
}

function getScoreBarColor(score: number, max: number): string {
  const pct = score / max;
  if (pct >= 0.8) return '#4caf50';
  if (pct >= 0.5) return '#ff9800';
  return '#f44336';
}

function extractKeywords(title: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'it', 'as', 'was', 'are', 'be',
    'new', 'used', '-', '&', '/', '|', '+',
  ]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

// ---------------------------------------------------------------------------
// Sub-tab panel wrapper
// ---------------------------------------------------------------------------

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return (
    <Box role="tabpanel" hidden={value !== index} sx={{ pt: 2 }}>
      {value === index && children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Circular Score Badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score, size = 56 }: { score: number; size?: number }) {
  const color = getHealthColor(score);
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <Box sx={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', filter: `drop-shadow(0 0 ${size * 0.15}px ${color}40)` }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(99,102,241,0.08)" strokeWidth={4} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={4}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <Typography
        sx={{ position: 'absolute', fontWeight: 700, fontSize: size * 0.28, color }}
      >
        {score}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Score Breakdown Bar
// ---------------------------------------------------------------------------

function ScoreBar({ label, score, max, icon }: { label: string; score: number; max: number; icon: React.ReactNode }) {
  const color = getScoreBarColor(score, max);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
      <Box sx={{ color: '#666', display: 'flex', alignItems: 'center' }}>{icon}</Box>
      <Typography variant="body2" sx={{ width: 100, fontWeight: 500, fontSize: 13 }}>{label}</Typography>
      <Box sx={{ flex: 1, bgcolor: 'rgba(99,102,241,0.06)', borderRadius: 1, height: 8, overflow: 'hidden' }}>
        <Box sx={{ width: `${(score / max) * 100}%`, height: '100%', bgcolor: color, borderRadius: 1, transition: 'width 0.4s' }} />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, color, minWidth: 40, textAlign: 'right' }}>
        {score}/{max}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Distribution Bar
// ---------------------------------------------------------------------------

function DistributionBar({ good, warning, critical, total }: { good: number; warning: number; critical: number; total: number }) {
  const t = useTranslations('ebay.listingOptimizer');
  if (total === 0) return null;
  const gPct = (good / total) * 100;
  const wPct = (warning / total) * 100;
  const cPct = (critical / total) * 100;

  return (
    <Box sx={{ display: 'flex', height: 12, borderRadius: 1, overflow: 'hidden', width: '100%' }}>
      {gPct > 0 && (
        <Tooltip title={`${t('good')}: ${good}`}>
          <Box sx={{ width: `${gPct}%`, bgcolor: '#4caf50', transition: 'width 0.4s' }} />
        </Tooltip>
      )}
      {wPct > 0 && (
        <Tooltip title={`${t('medium')}: ${warning}`}>
          <Box sx={{ width: `${wPct}%`, bgcolor: '#ff9800', transition: 'width 0.4s' }} />
        </Tooltip>
      )}
      {cPct > 0 && (
        <Tooltip title={`${t('critical')}: ${critical}`}>
          <Box sx={{ width: `${cPct}%`, bgcolor: '#f44336', transition: 'width 0.4s' }} />
        </Tooltip>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Comparison Bar (for competitor benchmark)
// ---------------------------------------------------------------------------

function ComparisonBar({ label, myValue, avgValue, unit, higherIsBetter = true }: {
  label: string; myValue: number; avgValue: number; unit?: string; higherIsBetter?: boolean;
}) {
  const t = useTranslations('ebay.listingOptimizer');
  const max = Math.max(myValue, avgValue, 1);
  const myPct = (myValue / max) * 100;
  const avgPct = (avgValue / max) * 100;
  const isWinning = higherIsBetter ? myValue >= avgValue : myValue <= avgValue;
  const formatVal = (v: number) => unit === '$' ? fmt(v) : `${Math.round(v)}${unit || ''}`;

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, alignItems: 'center' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>{label}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {isWinning ? (
            <ThumbsUp size={14} color="#4caf50" />
          ) : (
            <ThumbsDown size={14} color="#f44336" />
          )}
          <Typography variant="body2" sx={{ fontSize: 12, color: isWinning ? '#4caf50' : '#f44336', fontWeight: 600 }}>
            {isWinning ? t('winning') : t('behind')}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography variant="caption" sx={{ width: 50, fontSize: 11, color: '#666' }}>{t('yours')}</Typography>
        <Box sx={{ flex: 1, bgcolor: 'rgba(99,102,241,0.06)', borderRadius: 1, height: 10, overflow: 'hidden' }}>
          <Box sx={{ width: `${myPct}%`, height: '100%', bgcolor: isWinning ? '#4caf50' : '#ff9800', borderRadius: 1, transition: 'width 0.4s' }} />
        </Box>
        <Typography variant="caption" sx={{ minWidth: 50, textAlign: 'right', fontWeight: 600, fontSize: 12 }}>
          {formatVal(myValue)}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.3 }}>
        <Typography variant="caption" sx={{ width: 50, fontSize: 11, color: '#666' }}>{t('avg')}</Typography>
        <Box sx={{ flex: 1, bgcolor: 'rgba(99,102,241,0.06)', borderRadius: 1, height: 10, overflow: 'hidden' }}>
          <Box sx={{ width: `${avgPct}%`, height: '100%', bgcolor: 'rgba(99,102,241,0.25)', borderRadius: 1, transition: 'width 0.4s' }} />
        </Box>
        <Typography variant="caption" sx={{ minWidth: 50, textAlign: 'right', fontWeight: 600, fontSize: 12 }}>
          {formatVal(avgValue)}
        </Typography>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ListingOptimizer({ userId, marketplace, userListings, onNavigate }: ListingOptimizerProps) {
  const t = useTranslations('ebay.listingOptimizer');
  // ── State ──
  const [subTab, setSubTab] = useState(0);
  const [listings, setListings] = useState<ScoredListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Standalone analysis (works without userListings)
  const [manualUrl, setManualUrl] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualListing, setManualListing] = useState<ScoredListing | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auto-Optimizer state
  const [selectedListingId, setSelectedListingId] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [marketKeywords, setMarketKeywords] = useState<{ keyword: string; count: number }[]>([]);
  const [suggestedTitle, setSuggestedTitle] = useState('');
  const [missingAspects, setMissingAspects] = useState<AspectConstraint[]>([]);
  const [marketAvgImages, setMarketAvgImages] = useState(0);
  const [marketAvgPrice, setMarketAvgPrice] = useState(0);
  const [optimizedScore, setOptimizedScore] = useState<HealthScore | null>(null);
  const [aspectsLoading, setAspectsLoading] = useState(false);

  // Competitor Benchmark state
  const [benchmarkListingId, setBenchmarkListingId] = useState('');
  const [benchmarking, setBenchmarking] = useState(false);
  const [competitorMetrics, setCompetitorMetrics] = useState<CompetitorMetrics | null>(null);
  const [competitorItems, setCompetitorItems] = useState<MarketItem[]>([]);
  const [percentileRank, setPercentileRank] = useState<number | null>(null);

  // ── Fetch listings ──
  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=my_legacy_listings&marketplace_id=${marketplace}&userId=${userId}`
      );
      if (!res.ok) throw new Error(t('listingsLoadFailed'));
      const data = await res.json();
      const items: MyListing[] = data.listings || data.items || data.data || [];
      const scored = items.map(scoreListing).sort((a, b) => a.health.total - b.health.total);
      setListings(scored);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [userId, marketplace]);

  useEffect(() => {
    if (userListings?.length) {
      // Use pre-loaded data instead of fetching again
      const scored = userListings.map(l => scoreListing(l)).sort((a, b) => a.health.total - b.health.total);
      setListings(scored);
      setLoading(false);
    } else {
      fetchListings();
    }
  }, [userListings, fetchListings]);

  // ── Derived stats ──
  const stats = useMemo(() => {
    if (listings.length === 0) return { avg: 0, good: 0, warning: 0, critical: 0, total: 0 };
    const total = listings.length;
    const avg = Math.round(listings.reduce((s, l) => s + l.health.total, 0) / total);
    const good = listings.filter(l => l.health.total >= 75).length;
    const warning = listings.filter(l => l.health.total >= 50 && l.health.total < 75).length;
    const critical = listings.filter(l => l.health.total < 50).length;
    return { avg, good, warning, critical, total };
  }, [listings]);

  // ── Market search helper ──
  const searchMarket = useCallback(async (query: string, limit = 10): Promise<MarketItem[]> => {
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=search_market&q=${encodeURIComponent(query)}&marketplace_id=${marketplace}&limit=${limit}&userId=${userId}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || data.itemSummaries || [];
    } catch {
      return [];
    }
  }, [marketplace, userId]);

  // ── Fetch item aspects for a category (no backend action available — return empty) ──
  const fetchItemAspects = useCallback(async (_categoryId: string): Promise<AspectConstraint[]> => {
    return [];
  }, []);

  // ── Auto-Optimizer logic ──
  const selectedListing = useMemo(
    () => listings.find(l => l.itemId === selectedListingId) || null,
    [listings, selectedListingId]
  );

  const runOptimization = useCallback(async () => {
    if (!selectedListing) return;
    setOptimizing(true);
    setMarketKeywords([]);
    setSuggestedTitle('');
    setMissingAspects([]);
    setMarketAvgImages(0);
    setMarketAvgPrice(0);
    setOptimizedScore(null);

    try {
      // Search market for similar items
      const titleWords = extractKeywords(selectedListing.title).slice(0, 5).join(' ');
      const marketItems = await searchMarket(titleWords, 20);

      // Keyword frequency analysis
      const kwMap = new Map<string, number>();
      marketItems.forEach(item => {
        extractKeywords(item.title).forEach(kw => {
          kwMap.set(kw, (kwMap.get(kw) || 0) + 1);
        });
      });

      const myKws = new Set(extractKeywords(selectedListing.title));
      const sortedKws = Array.from(kwMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([keyword, count]) => ({ keyword, count }));
      setMarketKeywords(sortedKws);

      // Generate suggested title
      const missingTopKws = sortedKws
        .filter(k => !myKws.has(k.keyword) && k.count >= 3)
        .slice(0, 5)
        .map(k => k.keyword);

      let newTitle = selectedListing.title;
      if (missingTopKws.length > 0) {
        const remaining = 80 - newTitle.length;
        let additions = '';
        for (const kw of missingTopKws) {
          const toAdd = ` ${kw.charAt(0).toUpperCase() + kw.slice(1)}`;
          if (additions.length + toAdd.length <= remaining) {
            additions += toAdd;
          }
        }
        newTitle = newTitle + additions;
      }
      setSuggestedTitle(newTitle.slice(0, 80));

      // Fetch category aspects
      if (selectedListing.categoryId) {
        setAspectsLoading(true);
        const categoryAspects = await fetchItemAspects(selectedListing.categoryId);
        const currentAspectNames = new Set(
          selectedListing.aspects ? Object.keys(selectedListing.aspects).map(n => n.toLowerCase()) : []
        );
        const missing = categoryAspects.filter(
          a => !currentAspectNames.has(a.localizedAspectName.toLowerCase())
        );
        setMissingAspects(missing);
        setAspectsLoading(false);
      }

      // Image & price averages
      if (marketItems.length > 0) {
        const avgImgs = marketItems.reduce((s, item) => {
          return s + 1 + (item.additionalImages?.length || 0);
        }, 0) / marketItems.length;
        setMarketAvgImages(Math.round(avgImgs));

        const prices = marketItems
          .map(item => parseFloat(item.price?.value || '0'))
          .filter(p => p > 0);
        if (prices.length > 0) {
          setMarketAvgPrice(prices.reduce((a, b) => a + b, 0) / prices.length);
        }
      }

      // Compute optimized score estimate
      const newTitleScore = calcTitleScore(newTitle.length);
      const newAspectScore = calcAspectsScore(
        (selectedListing.aspectCount || 0) + Math.min(missingTopKws.length, 4)
      );
      setOptimizedScore({
        total: newTitleScore + selectedListing.health.description + selectedListing.health.images + newAspectScore,
        title: newTitleScore,
        description: selectedListing.health.description,
        images: selectedListing.health.images,
        aspects: newAspectScore,
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('optimizationFailed');
      toast.error(msg);
    } finally {
      setOptimizing(false);
    }
  }, [selectedListing, searchMarket, fetchItemAspects]);

  // ── Competitor Benchmark logic ──
  const benchmarkListing = useMemo(
    () => listings.find(l => l.itemId === benchmarkListingId) || null,
    [listings, benchmarkListingId]
  );

  const runBenchmark = useCallback(async () => {
    if (!benchmarkListing) return;
    setBenchmarking(true);
    setCompetitorMetrics(null);
    setCompetitorItems([]);
    setPercentileRank(null);

    try {
      const titleWords = extractKeywords(benchmarkListing.title).slice(0, 5).join(' ');
      const items = await searchMarket(titleWords, 20);
      // Filter out own listing
      const competitors = items.filter(i => i.itemId !== benchmarkListing.itemId).slice(0, 10);
      setCompetitorItems(competitors);

      if (competitors.length > 0) {
        const avgTitleLength = Math.round(
          competitors.reduce((s, i) => s + (i.title?.length || 0), 0) / competitors.length
        );
        const avgPrice =
          competitors.reduce((s, i) => s + parseFloat(i.price?.value || '0'), 0) / competitors.length;
        const avgImageCount = Math.round(
          competitors.reduce((s, i) => s + 1 + (i.additionalImages?.length || 0), 0) / competitors.length
        );
        const avgAspectCount = Math.round(
          competitors.reduce((s, i) => s + (i.aspects ? Object.keys(i.aspects).length : 0), 0) / competitors.length
        );
        const avgFeedbackScore = Math.round(
          competitors.reduce((s, i) => s + (i.seller?.feedbackScore || 0), 0) / competitors.length
        );

        setCompetitorMetrics({ avgTitleLength, avgPrice, avgImageCount, avgAspectCount, avgFeedbackScore, items: competitors });

        // Calculate percentile
        const myPrice = parseFloat(benchmarkListing.price?.value || '0');
        const allPrices = competitors.map(c => parseFloat(c.price?.value || '0')).concat(myPrice).sort((a, b) => a - b);
        const rank = allPrices.indexOf(myPrice);
        // Score-based percentile: consider multiple factors
        let wins = 0;
        let metrics = 0;
        if (benchmarkListing.titleLength >= avgTitleLength) { wins++; } metrics++;
        if (benchmarkListing.imageCount >= avgImageCount) { wins++; } metrics++;
        if (benchmarkListing.aspectCount >= avgAspectCount) { wins++; } metrics++;
        if ((benchmarkListing.seller?.feedbackScore || 0) >= avgFeedbackScore) { wins++; } metrics++;
        const pctile = Math.round((wins / metrics) * 100);
        setPercentileRank(pctile);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('benchmarkFailed');
      toast.error(msg);
    } finally {
      setBenchmarking(false);
    }
  }, [benchmarkListing, searchMarket]);

  // ── Standalone: Analyze any eBay listing by URL ──
  const analyzeByUrl = useCallback(async () => {
    const input = manualUrl.trim();
    if (!input) return;
    setManualLoading(true);
    setManualListing(null);
    try {
      let itemId = input;
      // Match ebay.com/itm/Title-Here/123456789 or ebay.com/itm/123456789
      const urlMatch = input.match(/\/itm\/(?:[^/]*\/)?(\d+)/);
      if (urlMatch) itemId = urlMatch[1];
      const idMatch = itemId.match(/(\d{10,14})/);
      if (idMatch) itemId = idMatch[1];

      const res = await fetch(
        `/api/clawd/ebay?action=get_item_details&legacy_item_id=${itemId}&marketplace_id=${marketplace}&userId=${userId}`
      );
      if (!res.ok) throw new Error('Listeleme bulunamadi');
      const data = await res.json();

      const listing: MyListing = {
        itemId: data.legacyItemId || data.itemId || itemId,
        legacyItemId: data.legacyItemId || itemId,
        title: data.product?.title || data.title || '',
        price: data.price || { value: '0', currency: 'USD' },
        image: data.product?.imageUrls?.[0] ? { imageUrl: data.product.imageUrls[0] } : undefined,
        additionalImages: (data.product?.imageUrls || []).slice(1).map((u: string) => ({ imageUrl: u })),
        description: data.product?.description || data.description || '',
        condition: data.condition || '',
        aspects: data.product?.aspects || data.aspects || {},
        itemWebUrl: data.itemWebUrl || `https://www.ebay.com/itm/${itemId}`,
      };

      const scored = scoreListing(listing);
      setManualListing(scored);
      toast.success('Listeleme analiz edildi');
    } catch (err: any) {
      toast.error(err.message || 'Analiz basarisiz');
    } finally {
      setManualLoading(false);
    }
  }, [manualUrl, marketplace, userId]);

  // ── Copy to clipboard ──
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('copiedToClipboard'));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <Box>
      {/* Standalone URL Analysis — always available */}
      <Paper sx={{ p: 2, mb: 2, bgcolor: '#f8faff', border: '1px solid rgba(99,102,241,0.08)', borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          <Search size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Herhangi Bir Listelemeyi Analiz Et
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t('listingUrlPlaceholder')}
            helperText={t('listingUrlHelper')}
            value={manualUrl}
            onChange={e => setManualUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyzeByUrl()}
            sx={{ flex: '2 1 250px' }}
            InputProps={{ startAdornment: <InputAdornment position="start"><ExternalLink size={16} /></InputAdornment> }}
          />
          <Button variant="contained" onClick={analyzeByUrl} disabled={manualLoading || !manualUrl.trim()} sx={{ minWidth: 120, background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' } }}>
            {manualLoading ? <CircularProgress size={20} /> : 'Analiz Et'}
          </Button>
        </Box>
        {!manualListing && !manualLoading && (
          <Paper sx={{ p: 2, mt: 2, bgcolor: '#f8faff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>Listing Optimizer</Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li>eBay URL yapistirarak herhangi bir listelemeyi analiz edin</li>
                <li>Baslik uzunlugu, aciklama kalitesi, gorsel sayisi ve ozellikler puanlanir</li>
                <li>Her sorun icin &quot;AI ile Duzelt&quot; butonu ile otomatik iyilestirme yapin</li>
                <li>Kendi listeleriniz yuklendiyse, hepsini tek tikla tarayin</li>
              </ul>
            </Typography>
          </Paper>
        )}
        {manualListing && (
          <Paper sx={{ mt: 2, p: 2, bgcolor: '#f8faff', border: '1px solid rgba(99,102,241,0.08)', borderRadius: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <ScoreBadge score={manualListing.health.total} size={64} />
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{manualListing.title}</Typography>
                <ScoreBar label={t('titleLabel')} score={manualListing.health.title} max={25} icon={<FileText size={14} />} />
                <ScoreBar label={t('descriptionLabel')} score={manualListing.health.description} max={25} icon={<FileText size={14} />} />
                <ScoreBar label="Resimler" score={manualListing.health.images} max={25} icon={<ImageIcon size={14} />} />
                <ScoreBar label={t('aspectsLabel')} score={manualListing.health.aspects} max={25} icon={<Tag size={14} />} />
              </Box>
            </Box>
            <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip label={t('titleChars', { count: manualListing.titleLength })} size="small" variant="outlined" />
              <Chip label={t('descChars', { count: manualListing.descriptionLength })} size="small" variant="outlined" />
              <Chip label={`${manualListing.imageCount} resim`} size="small" variant="outlined" />
              <Chip label={t('aspectCount', { count: manualListing.aspectCount })} size="small" variant="outlined" />
            </Box>
          </Paper>
        )}
      </Paper>

      {/* Sub-tabs */}
      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 1, '& .Mui-selected': { color: '#6366f1' }, '& .MuiTabs-indicator': { bgcolor: '#6366f1' } }}
      >
        <Tab
          label={t('healthDashboard')}
          icon={<Heart size={16} />}
          iconPosition="start"
          sx={{ textTransform: 'none', fontWeight: 600, fontSize: 13 }}
        />
        <Tab
          label={t('autoOptimizer')}
          icon={<Zap size={16} />}
          iconPosition="start"
          sx={{ textTransform: 'none', fontWeight: 600, fontSize: 13 }}
        />
        <Tab
          label={t('competitorBenchmark')}
          icon={<Target size={16} />}
          iconPosition="start"
          sx={{ textTransform: 'none', fontWeight: 600, fontSize: 13 }}
        />
      </Tabs>

      {/* ─────────────────────────────────────────────────────────────────────
          SUB-TAB 1: Listing Health Dashboard
      ───────────────────────────────────────────────────────────────────── */}
      <TabPanel value={subTab} index={0}>
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!loading && listings.length > 0 && (
          <>
            {/* Summary Cards */}
            <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={6} sm={3}>
                  <Box sx={{ textAlign: 'center' }}>
                    <ScoreBadge score={stats.avg} size={64} />
                    <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600, fontSize: 13 }}>
                      Ortalama Skor
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Stack spacing={0.5} alignItems="center">
                    <Chip
                      icon={<CheckCircle size={14} />}
                      label={t('goodCount', { count: stats.good })}
                      size="small"
                      sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 600 }}
                    />
                    <Chip
                      icon={<AlertTriangle size={14} />}
                      label={`${stats.warning} Orta`}
                      size="small"
                      sx={{ bgcolor: '#fff3e0', color: '#e65100', fontWeight: 600 }}
                    />
                    <Chip
                      icon={<XCircle size={14} />}
                      label={`${stats.critical} Kritik`}
                      size="small"
                      sx={{ bgcolor: '#ffebee', color: '#c62828', fontWeight: 600 }}
                    />
                  </Stack>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 600, fontSize: 13 }}>
                    {t('healthDistribution')} ({stats.total})
                  </Typography>
                  <DistributionBar
                    good={stats.good}
                    warning={stats.warning}
                    critical={stats.critical}
                    total={stats.total}
                  />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                    <Typography variant="caption" sx={{ color: '#4caf50' }}>{t('good')} (%{stats.total ? Math.round((stats.good / stats.total) * 100) : 0})</Typography>
                    <Typography variant="caption" sx={{ color: '#ff9800' }}>Orta (%{stats.total ? Math.round((stats.warning / stats.total) * 100) : 0})</Typography>
                    <Typography variant="caption" sx={{ color: '#f44336' }}>Kritik (%{stats.total ? Math.round((stats.critical / stats.total) * 100) : 0})</Typography>
                  </Box>
                </Grid>
              </Grid>
            </Paper>

            {/* Refresh button */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
              <Button
                size="small"
                startIcon={<RefreshCw size={14} />}
                onClick={fetchListings}
                disabled={loading}
                sx={{ textTransform: 'none', fontSize: 12 }}
              >
                Yenile
              </Button>
            </Box>

            {/* Listings Table */}
            <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ '& th': { background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', borderBottom: '2px solid rgba(99,102,241,0.12)' } }}>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 40 }}></TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>{t('image')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>{t('titleLabel')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, textAlign: 'center' }}>Skor</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, textAlign: 'right' }}>Fiyat</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, textAlign: 'right' }}>{t('sold')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {listings.map(listing => {
                    const isExpanded = expandedId === listing.itemId;
                    return (
                      <React.Fragment key={listing.itemId}>
                        <TableRow
                          hover
                          sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(99,102,241,0.03)' } }}
                          onClick={() => setExpandedId(isExpanded ? null : listing.itemId)}
                        >
                          <TableCell sx={{ p: 0.5 }}>
                            <IconButton size="small">
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </IconButton>
                          </TableCell>
                          <TableCell sx={{ p: 0.5 }}>
                            {listing.image?.imageUrl ? (
                              <Box
                                component="img"
                                src={listing.image.imageUrl}
                                alt=""
                                sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1 }}
                              />
                            ) : (
                              <Box sx={{ width: 40, height: 40, bgcolor: '#f5f5f5', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ImageIcon size={16} color="#ccc" />
                              </Box>
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {listing.title}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#999', fontSize: 10 }}>
                              {listing.titleLength} karakter
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ textAlign: 'center' }}>
                            <ScoreBadge score={listing.health.total} size={40} />
                          </TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                              {listing.price?.currency === 'USD' ? '$' : listing.price?.currency}{listing.price?.value}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>
                            <Typography variant="body2" sx={{ fontSize: 13 }}>
                              {listing.quantitySold ?? '-'}
                            </Typography>
                          </TableCell>
                        </TableRow>

                        {/* Expanded detail row */}
                        <TableRow>
                          <TableCell colSpan={6} sx={{ p: 0, border: isExpanded ? undefined : 'none' }}>
                            <Collapse in={isExpanded} unmountOnExit>
                              <Box sx={{ p: 2, bgcolor: '#f8faff' }}>
                                <Typography variant="body2" sx={{ fontWeight: 700, mb: 1, fontSize: 13 }}>
                                  {t('healthDetails')}
                                </Typography>
                                <ScoreBar label={t('titleLabel')} score={listing.health.title} max={25} icon={<FileText size={14} />} />
                                <ScoreBar label={t('descriptionLabel')} score={listing.health.description} max={25} icon={<FileText size={14} />} />
                                <ScoreBar label={t('imagesLabel')} score={listing.health.images} max={25} icon={<ImageIcon size={14} />} />
                                <ScoreBar label={t('aspectsLabel')} score={listing.health.aspects} max={25} icon={<Tag size={14} />} />

                                <Divider sx={{ my: 1 }} />
                                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                  <Chip size="small" label={t('titleChars', { count: listing.titleLength })} variant="outlined" />
                                  <Chip size="small" label={t('descChars', { count: listing.descriptionLength })} variant="outlined" />
                                  <Chip size="small" label={t('imageCountChip', { count: listing.imageCount })} variant="outlined" />
                                  <Chip size="small" label={t('aspectCount', { count: listing.aspectCount })} variant="outlined" />
                                </Box>

                                <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                                  <Button
                                    size="small"
                                    variant="contained"
                                    startIcon={<Zap size={14} />}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedListingId(listing.itemId);
                                      setSubTab(1);
                                    }}
                                    sx={{ textTransform: 'none', fontSize: 12 }}
                                  >
                                    Optimize Et
                                  </Button>
                                  {listing.itemWebUrl && (
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      startIcon={<ExternalLink size={14} />}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(listing.itemWebUrl, '_blank');
                                      }}
                                      sx={{ textTransform: 'none', fontSize: 12 }}
                                    >
                                      {t('viewOnEbay')}
                                    </Button>
                                  )}
                                </Box>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}

        {!loading && listings.length === 0 && !error && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('noListings')}
          </Alert>
        )}
      </TabPanel>

      {/* ─────────────────────────────────────────────────────────────────────
          SUB-TAB 2: Auto-Optimizer
      ───────────────────────────────────────────────────────────────────── */}
      <TabPanel value={subTab} index={1}>
        {/* Listing selector */}
        <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <FormControl fullWidth size="small">
            <InputLabel sx={{ fontSize: 13 }}>{t('selectListing')}</InputLabel>
            <Select
              value={selectedListingId}
              label={t('selectListing')}
              onChange={e => {
                setSelectedListingId(e.target.value);
                setSuggestedTitle('');
                setMarketKeywords([]);
                setMissingAspects([]);
                setOptimizedScore(null);
              }}
              sx={{ fontSize: 13 }}
            >
              {listings.map(l => (
                <MenuItem key={l.itemId} value={l.itemId} sx={{ fontSize: 13 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <ScoreBadge score={l.health.total} size={28} />
                    <Typography variant="body2" sx={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {l.title}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {selectedListing && (
            <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
              {selectedListing.image?.imageUrl && (
                <Box
                  component="img"
                  src={selectedListing.image.imageUrl}
                  alt=""
                  sx={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 1 }}
                />
              )}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                  {selectedListing.title}
                </Typography>
                <Typography variant="caption" sx={{ color: '#666' }}>
                  Mevcut Skor: {selectedListing.health.total}/100 ({getHealthLabel(selectedListing.health.total)})
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={optimizing ? <CircularProgress size={14} color="inherit" /> : <Zap size={14} />}
                onClick={runOptimization}
                disabled={optimizing}
                sx={{ textTransform: 'none', fontSize: 12, whiteSpace: 'nowrap' }}
              >
                {optimizing ? 'Analiz Ediliyor...' : 'Analiz Et'}
              </Button>
            </Box>
          )}
        </Paper>

        {/* Current Issues Summary */}
        {selectedListing && !optimizing && !suggestedTitle && (
          <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 1, fontSize: 13 }}>
              Mevcut Durum
            </Typography>
            <ScoreBar label={t('titleLabel')} score={selectedListing.health.title} max={25} icon={<FileText size={14} />} />
            <ScoreBar label={t('descriptionLabel')} score={selectedListing.health.description} max={25} icon={<FileText size={14} />} />
            <ScoreBar label={t('imagesLabel')} score={selectedListing.health.images} max={25} icon={<ImageIcon size={14} />} />
            <ScoreBar label={t('aspectsLabel')} score={selectedListing.health.aspects} max={25} icon={<Tag size={14} />} />
            <Alert severity="info" sx={{ mt: 1, fontSize: 12 }}>
              &quot;Analiz Et&quot; 
            </Alert>
          </Paper>
        )}

        {optimizing && (
          <Paper sx={{ p: 3, textAlign: 'center', borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <CircularProgress size={40} />
            <Typography variant="body2" sx={{ mt: 1, color: '#666' }}>
              {t('analyzingMarket')}
            </Typography>
          </Paper>
        )}

        {/* Optimization Results */}
        {selectedListing && suggestedTitle && !optimizing && (
          <>
            {/* Before/After Score */}
            {optimizedScore && (
              <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 1.5, fontSize: 14 }}>
                  {t('estimatedScoreComparison')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, color: '#999' }}>{t('before')}</Typography>
                    <ScoreBadge score={selectedListing.health.total} size={72} />
                  </Box>
                  <ArrowRight size={24} color="#666" />
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, color: '#999' }}>SONRA</Typography>
                    <ScoreBadge score={optimizedScore.total} size={72} />
                  </Box>
                  <Chip
                    label={`+${optimizedScore.total - selectedListing.health.total} puan`}
                    size="small"
                    sx={{
                      bgcolor: optimizedScore.total > selectedListing.health.total ? '#e8f5e9' : '#f5f5f5',
                      color: optimizedScore.total > selectedListing.health.total ? '#2e7d32' : '#666',
                      fontWeight: 700,
                    }}
                  />
                </Box>
              </Paper>
            )}

            {/* Title Optimization */}
            <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <FileText size={16} color="#1976d2" />
                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 14 }}>
                  {t('titleOptimization')}
                </Typography>
              </Box>

              {/* Current title */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: '#999', fontSize: 11 }}>
                  {t('currentTitleLabel')} ({selectedListing.titleLength})
                </Typography>
                <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5, bgcolor: '#fef3c7', borderColor: '#f59e0b40', borderRadius: 2, boxShadow: '0 1px 4px rgba(245,158,11,0.08)' }}>
                  <Typography variant="body2" sx={{ fontSize: 13 }}>
                    {selectedListing.title}
                  </Typography>
                </Paper>
              </Box>

              {/* Missing keywords */}
              {marketKeywords.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#999', fontSize: 11, mb: 0.5 }}>
                    {t('popularKeywords')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {marketKeywords.slice(0, 20).map(kw => {
                      const inTitle = extractKeywords(selectedListing.title).includes(kw.keyword);
                      return (
                        <Chip
                          key={kw.keyword}
                          label={`${kw.keyword} (${kw.count})`}
                          size="small"
                          icon={inTitle ? <CheckCircle size={12} /> : <Minus size={12} />}
                          sx={{
                            fontSize: 11,
                            bgcolor: inTitle ? '#e8f5e9' : '#fff3e0',
                            color: inTitle ? '#2e7d32' : '#e65100',
                            fontWeight: inTitle ? 400 : 600,
                          }}
                        />
                      );
                    })}
                  </Box>
                </Box>
              )}

              {/* Suggested title */}
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: '#999', fontSize: 11 }}>
                  {t('suggestedTitleLabel')} ({suggestedTitle.length})
                </Typography>
                <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5, bgcolor: '#d1fae5', borderColor: '#10b98140', borderRadius: 2, boxShadow: '0 1px 4px rgba(16,185,129,0.08)' }}>
                  <Typography variant="body2" sx={{ fontSize: 13 }}>
                    {suggestedTitle}
                  </Typography>
                </Paper>
              </Box>

              {/* Side by side */}
              {suggestedTitle !== selectedListing.title && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Copy size={14} />}
                    onClick={() => copyToClipboard(suggestedTitle)}
                    sx={{ textTransform: 'none', fontSize: 12 }}
                  >
                    {t('copyTitle')}
                  </Button>
                </Box>
              )}
            </Paper>

            {/* Item Specifics Recommendations */}
            <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Tag size={16} color="#1976d2" />
                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 14 }}>
                  {t('aspectRecommendations')}
                </Typography>
              </Box>

              {/* Current aspects */}
              {selectedListing.aspects && Object.keys(selectedListing.aspects).length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#999', fontSize: 11 }}>
                    {t('currentAspects')} ({selectedListing.aspectCount})
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {Object.entries(selectedListing.aspects).map(([name, values]) => (
                      <Chip
                        key={name}
                        label={`${name}: ${values.join(', ')}`}
                        size="small"
                        icon={<CheckCircle size={12} />}
                        sx={{ fontSize: 11, bgcolor: '#e8f5e9', color: '#2e7d32' }}
                      />
                    ))}
                  </Box>
                </Box>
              )}

              {/* Missing aspects */}
              {aspectsLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" sx={{ fontSize: 12, color: '#666' }}>
                    {t('loadingCategoryAspects')}
                  </Typography>
                </Box>
              ) : missingAspects.length > 0 ? (
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#999', fontSize: 11 }}>
                    {t('missingAspects')} ({missingAspects.length})
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {missingAspects.slice(0, 15).map(aspect => (
                      <Tooltip
                        key={aspect.localizedAspectName}
                        title={
                          aspect.aspectValues
                            ? `${t('possibleValues')}: ${aspect.aspectValues.slice(0, 5).map(v => v.localizedValue).join(', ')}${aspect.aspectValues.length > 5 ? '...' : ''}`
                            : t('valueRequired')
                        }
                      >
                        <Chip
                          label={aspect.localizedAspectName}
                          size="small"
                          icon={aspect.aspectRequired ? <AlertTriangle size={12} /> : <Info size={12} />}
                          sx={{
                            fontSize: 11,
                            bgcolor: aspect.aspectRequired ? '#ffebee' : '#fff3e0',
                            color: aspect.aspectRequired ? '#c62828' : '#e65100',
                            fontWeight: aspect.aspectRequired ? 700 : 400,
                          }}
                        />
                      </Tooltip>
                    ))}
                  </Box>
                  {missingAspects.length > 15 && (
                    <Typography variant="caption" sx={{ color: '#999', mt: 0.5, display: 'block' }}>
                      ve {missingAspects.length - 15} tane daha...
                    </Typography>
                  )}
                  <Alert severity="warning" sx={{ mt: 1, fontSize: 12 }}>
                    {t('aspectsHelpRanking')}
                  </Alert>
                </Box>
              ) : (
                <Alert severity="success" sx={{ fontSize: 12 }}>
                  {t('allAspectsPresent')}
                </Alert>
              )}
            </Paper>

            {/* Image Analysis */}
            <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <ImageIcon size={16} color="#1976d2" />
                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 14 }}>
                  {t('imageAnalysis')}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ textAlign: 'center', p: 1, bgcolor: '#f8faff', borderRadius: 2, border: '1px solid rgba(99,102,241,0.08)', minWidth: 80 }}>
                  <Typography variant="h5" sx={{ fontWeight: 700, color: selectedListing.imageCount >= 8 ? '#4caf50' : '#ff9800' }}>
                    {selectedListing.imageCount}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 10, color: '#666' }}>Mevcut</Typography>
                </Box>
                <ArrowRight size={20} color="#999" />
                <Box sx={{ textAlign: 'center', p: 1, bgcolor: '#f8faff', borderRadius: 2, border: '1px solid rgba(99,102,241,0.08)', minWidth: 80 }}>
                  <Typography variant="h5" sx={{ fontWeight: 700, color: '#6366f1' }}>
                    {marketAvgImages || '-'}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 10, color: '#666' }}>Rakip Ort.</Typography>
                </Box>
              </Box>

              {marketAvgImages > selectedListing.imageCount ? (
                <Alert severity="warning" sx={{ mt: 1, fontSize: 12 }}>
                  {t('addMoreImages', { avg: marketAvgImages, needed: marketAvgImages - selectedListing.imageCount })}
                </Alert>
              ) : (
                <Alert severity="success" sx={{ mt: 1, fontSize: 12 }}>
                  {t('imagesAboveAverage')}
                </Alert>
              )}
            </Paper>

            {/* Pricing Analysis */}
            <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <TrendingUp size={16} color="#1976d2" />
                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 14 }}>
                  Fiyat Analizi
                </Typography>
              </Box>

              {marketAvgPrice > 0 ? (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ textAlign: 'center', p: 1, bgcolor: '#f8faff', borderRadius: 2, border: '1px solid rgba(99,102,241,0.08)', minWidth: 100 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {selectedListing.price?.currency === 'USD' ? '$' : selectedListing.price?.currency}
                        {selectedListing.price?.value}
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: 10, color: '#666' }}>{t('yourPrice')}</Typography>
                    </Box>
                    <ArrowRight size={20} color="#999" />
                    <Box sx={{ textAlign: 'center', p: 1, bgcolor: '#f8faff', borderRadius: 2, border: '1px solid rgba(99,102,241,0.08)', minWidth: 100 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, color: '#6366f1' }}>
                        {fmt(marketAvgPrice)}
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: 10, color: '#666' }}>{t('marketAverage')}</Typography>
                    </Box>
                  </Box>

                  {(() => {
                    const myPrice = parseFloat(selectedListing.price?.value || '0');
                    const diff = ((myPrice - marketAvgPrice) / marketAvgPrice) * 100;
                    const rangeLow = marketAvgPrice * 0.85;
                    const rangeHigh = marketAvgPrice * 1.15;
                    return (
                      <>
                        <Box sx={{ mt: 1.5 }}>
                          <Typography variant="caption" sx={{ fontWeight: 600, color: '#666', fontSize: 11 }}>
                            {t('suggestedPriceRange')}: {fmt(rangeLow)} - {fmt(rangeHigh)}
                          </Typography>
                          <Box sx={{ position: 'relative', mt: 1, height: 20 }}>
                            <Box sx={{ position: 'absolute', left: 0, right: 0, top: 8, height: 4, bgcolor: '#e0e0e0', borderRadius: 2 }} />
                            <Box
                              sx={{
                                position: 'absolute',
                                left: `${Math.max(0, Math.min(85, (rangeLow / (rangeHigh * 1.3)) * 100))}%`,
                                width: `${Math.max(5, ((rangeHigh - rangeLow) / (rangeHigh * 1.3)) * 100)}%`,
                                top: 6, height: 8, bgcolor: '#c8e6c9', borderRadius: 2,
                              }}
                            />
                            <Box
                              sx={{
                                position: 'absolute',
                                left: `${Math.max(0, Math.min(95, (myPrice / (rangeHigh * 1.3)) * 100))}%`,
                                top: 2, width: 12, height: 16, bgcolor: diff > 15 ? '#f44336' : diff < -15 ? '#ff9800' : '#4caf50',
                                borderRadius: '50%', transform: 'translateX(-50%)',
                              }}
                            />
                          </Box>
                        </Box>
                        <Box sx={{ mt: 1 }}>
                          {diff > 15 ? (
                            <Alert severity="warning" sx={{ fontSize: 12 }}>
                              {t('priceAboveAvg')}
                            </Alert>
                          ) : diff < -15 ? (
                            <Alert severity="info" sx={{ fontSize: 12 }}>
                              {t('priceBelowAvg')}
                            </Alert>
                          ) : (
                            <Alert severity="success" sx={{ fontSize: 12 }}>
                              {t('priceCompetitive')}
                            </Alert>
                          )}
                        </Box>
                      </>
                    );
                  })()}
                </>
              ) : (
                <Typography variant="body2" sx={{ color: '#666', fontSize: 12 }}>
                  {t('noMarketPriceData')}
                </Typography>
              )}
            </Paper>
          </>
        )}

        {!selectedListingId && (
          <Alert severity="info" sx={{ mt: 1, fontSize: 12 }}>
            {t('selectListingForOptimization')}
          </Alert>
        )}
      </TabPanel>

      {/* ─────────────────────────────────────────────────────────────────────
          SUB-TAB 3: Competitor Benchmark
      ───────────────────────────────────────────────────────────────────── */}
      <TabPanel value={subTab} index={2}>
        {/* Listing selector */}
        <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <FormControl fullWidth size="small">
            <InputLabel sx={{ fontSize: 13 }}>{t('selectListing')}</InputLabel>
            <Select
              value={benchmarkListingId}
              label={t('selectListing')}
              onChange={e => {
                setBenchmarkListingId(e.target.value);
                setCompetitorMetrics(null);
                setCompetitorItems([]);
                setPercentileRank(null);
              }}
              sx={{ fontSize: 13 }}
            >
              {listings.map(l => (
                <MenuItem key={l.itemId} value={l.itemId} sx={{ fontSize: 13 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <ScoreBadge score={l.health.total} size={28} />
                    <Typography variant="body2" sx={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {l.title}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {benchmarkListing && (
            <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
              {benchmarkListing.image?.imageUrl && (
                <Box
                  component="img"
                  src={benchmarkListing.image.imageUrl}
                  alt=""
                  sx={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 1 }}
                />
              )}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                  {benchmarkListing.title}
                </Typography>
                <Typography variant="caption" sx={{ color: '#666' }}>
                  {benchmarkListing.price?.currency === 'USD' ? '$' : benchmarkListing.price?.currency}
                  {benchmarkListing.price?.value} | {benchmarkListing.imageCount} {t('imagesLabel')} | {benchmarkListing.aspectCount} {t('aspectsLabel')}
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={benchmarking ? <CircularProgress size={14} color="inherit" /> : <BarChart2 size={14} />}
                onClick={runBenchmark}
                disabled={benchmarking}
                sx={{ textTransform: 'none', fontSize: 12, whiteSpace: 'nowrap' }}
              >
                {benchmarking ? t('analyzing') : t('benchmark')}
              </Button>
            </Box>
          )}
        </Paper>

        {benchmarking && (
          <Paper sx={{ p: 3, textAlign: 'center', borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <CircularProgress size={40} />
            <Typography variant="body2" sx={{ mt: 1, color: '#666' }}>
              Rakipler analiz ediliyor...
            </Typography>
          </Paper>
        )}

        {/* Benchmark Results */}
        {benchmarkListing && competitorMetrics && !benchmarking && (
          <>
            {/* Overall Position */}
            <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Award size={18} color="#1976d2" />
                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 14 }}>
                  Genel Rekabet Pozisyonu
                </Typography>
              </Box>

              {percentileRank !== null && (
                <Box sx={{ textAlign: 'center', py: 2 }}>
                  <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <ScoreBadge score={percentileRank} size={96} />
                  </Box>
                  <Typography variant="body2" sx={{ mt: 1, fontWeight: 600, fontSize: 15 }}>
                    {percentileRank >= 75
                      ? t('aheadOfCompetitors')
                      : percentileRank >= 50
                        ? t('averageLevel')
                        : t('behindCompetitors')}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>
                    {t('comparedWith', { count: competitorMetrics.items.length })}
                  </Typography>
                </Box>
              )}
            </Paper>

            {/* Metric Comparisons */}
            <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 2, fontSize: 14 }}>
                {t('metricComparison')}
              </Typography>

              <ComparisonBar
                label={t('titleLength')}
                myValue={benchmarkListing.titleLength}
                avgValue={competitorMetrics.avgTitleLength}
                unit=" kr"
                higherIsBetter={true}
              />

              <ComparisonBar
                label="Fiyat"
                myValue={parseFloat(benchmarkListing.price?.value || '0')}
                avgValue={competitorMetrics.avgPrice}
                unit="$"
                higherIsBetter={false}
              />

              <ComparisonBar
                label={t('imageCountLabel')}
                myValue={benchmarkListing.imageCount}
                avgValue={competitorMetrics.avgImageCount}
                higherIsBetter={true}
              />

              <ComparisonBar
                label={t('aspectCountLabel')}
                myValue={benchmarkListing.aspectCount}
                avgValue={competitorMetrics.avgAspectCount}
                higherIsBetter={true}
              />

              <ComparisonBar
                label={t('sellerScore')}
                myValue={benchmarkListing.seller?.feedbackScore || 0}
                avgValue={competitorMetrics.avgFeedbackScore}
                higherIsBetter={true}
              />
            </Paper>

            {/* Comparison Table */}
            <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 1.5, fontSize: 14 }}>
                Sizin Listeleme vs {t('marketAverage')}
              </Typography>

              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ '& th': { background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', borderBottom: '2px solid rgba(99,102,241,0.12)' } }}>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Metrik</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12, textAlign: 'center' }}>Sizin</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12, textAlign: 'center' }}>Pazar Ort.</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12, textAlign: 'center' }}>Durum</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[
                      {
                        label: t('titleLength'),
                        my: `${benchmarkListing.titleLength} kr`,
                        avg: `${competitorMetrics.avgTitleLength} kr`,
                        win: benchmarkListing.titleLength >= competitorMetrics.avgTitleLength,
                      },
                      {
                        label: 'Fiyat',
                        my: `${benchmarkListing.price?.currency === 'USD' ? '$' : ''}${benchmarkListing.price?.value}`,
                        avg: fmt(competitorMetrics.avgPrice),
                        win: parseFloat(benchmarkListing.price?.value || '0') <= competitorMetrics.avgPrice,
                      },
                      {
                        label: t('imageCountLabel'),
                        my: `${benchmarkListing.imageCount}`,
                        avg: `${competitorMetrics.avgImageCount}`,
                        win: benchmarkListing.imageCount >= competitorMetrics.avgImageCount,
                      },
                      {
                        label: t('aspectCountLabel'),
                        my: `${benchmarkListing.aspectCount}`,
                        avg: `${competitorMetrics.avgAspectCount}`,
                        win: benchmarkListing.aspectCount >= competitorMetrics.avgAspectCount,
                      },
                      {
                        label: t('sellerScore'),
                        my: `${benchmarkListing.seller?.feedbackScore || 0}`,
                        avg: `${competitorMetrics.avgFeedbackScore}`,
                        win: (benchmarkListing.seller?.feedbackScore || 0) >= competitorMetrics.avgFeedbackScore,
                      },
                    ].map(row => (
                      <TableRow key={row.label}>
                        <TableCell sx={{ fontSize: 12, fontWeight: 500 }}>{row.label}</TableCell>
                        <TableCell sx={{ fontSize: 12, textAlign: 'center', fontWeight: 600 }}>{row.my}</TableCell>
                        <TableCell sx={{ fontSize: 12, textAlign: 'center', color: '#666' }}>{row.avg}</TableCell>
                        <TableCell sx={{ textAlign: 'center' }}>
                          {row.win ? (
                            <Chip label={t('winning')} size="small" sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontSize: 10, fontWeight: 600, height: 22 }} />
                          ) : (
                            <Chip label="Geride" size="small" sx={{ bgcolor: '#ffebee', color: '#c62828', fontSize: 10, fontWeight: 600, height: 22 }} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            {/* Actionable Recommendations */}
            <Paper sx={{ p: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <ShieldCheck size={16} color="#1976d2" />
                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 14 }}>
                  {t('actionItems')}
                </Typography>
              </Box>

              <Stack spacing={1}>
                {benchmarkListing.titleLength < competitorMetrics.avgTitleLength && (
                  <Alert severity="warning" sx={{ fontSize: 12 }} icon={<FileText size={16} />}>
                    <strong>{t('titleLabel')}:</strong> {t('titleTooShort', { avg: competitorMetrics.avgTitleLength })}
                    {t('extendTitle', { target: Math.min(80, competitorMetrics.avgTitleLength + 10) })}
                  </Alert>
                )}

                {benchmarkListing.imageCount < competitorMetrics.avgImageCount && (
                  <Alert severity="warning" sx={{ fontSize: 12 }} icon={<ImageIcon size={16} />}>
                    <strong>{t('imagesLabel')}:</strong> {t('imagesTooFew', { avg: competitorMetrics.avgImageCount, yours: benchmarkListing.imageCount })}
                    {t('addImages', { count: competitorMetrics.avgImageCount - benchmarkListing.imageCount })}
                  </Alert>
                )}

                {benchmarkListing.aspectCount < competitorMetrics.avgAspectCount && (
                  <Alert severity="warning" sx={{ fontSize: 12 }} icon={<Tag size={16} />}>
                    <strong>{t('aspectsLabel')}:</strong> {t('aspectsTooFew', { avg: competitorMetrics.avgAspectCount, yours: benchmarkListing.aspectCount })}
                    {t('fillMissingAspects')}
                  </Alert>
                )}

                {parseFloat(benchmarkListing.price?.value || '0') > competitorMetrics.avgPrice * 1.15 && (
                  <Alert severity="info" sx={{ fontSize: 12 }} icon={<TrendingUp size={16} />}>
                    <strong>{t('price')}:</strong> {t('priceTooHigh', { avg: fmt(competitorMetrics.avgPrice) })}
                    {t('reviewPricing')}
                  </Alert>
                )}

                {/* Positive feedback */}
                {benchmarkListing.titleLength >= competitorMetrics.avgTitleLength &&
                 benchmarkListing.imageCount >= competitorMetrics.avgImageCount &&
                 benchmarkListing.aspectCount >= competitorMetrics.avgAspectCount && (
                  <Alert severity="success" sx={{ fontSize: 12 }}>
                    {t('congratulations')}
                  </Alert>
                )}
              </Stack>
            </Paper>

            {/* Top Competitors List */}
            <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 1.5, fontSize: 14 }}>
                {t('competitorListings')} ({competitorItems.length})
              </Typography>

              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={{ '& th': { background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', borderBottom: '2px solid rgba(99,102,241,0.12)' } }}>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('image')}</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('titleLabel')}</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11, textAlign: 'right' }}>Fiyat</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11, textAlign: 'center' }}>{t('sellerScore')}</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11, textAlign: 'center' }}></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {competitorItems.map((item, idx) => (
                      <TableRow key={item.itemId || idx} hover>
                        <TableCell sx={{ p: 0.5 }}>
                          {item.image?.imageUrl ? (
                            <Box
                              component="img"
                              src={item.image.imageUrl}
                              alt=""
                              sx={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 1 }}
                            />
                          ) : (
                            <Box sx={{ width: 36, height: 36, bgcolor: '#f5f5f5', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <ImageIcon size={14} color="#ccc" />
                            </Box>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontSize: 11, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.title}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>
                          <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 600 }}>
                            {item.price?.currency === 'USD' ? '$' : item.price?.currency}
                            {item.price?.value}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ textAlign: 'center' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                            <Star size={12} color="#ff9800" fill="#ff9800" />
                            <Typography variant="body2" sx={{ fontSize: 11 }}>
                              {item.seller?.feedbackScore || '-'}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          {item.itemWebUrl && (
                            <IconButton size="small" onClick={() => window.open(item.itemWebUrl, '_blank')}>
                              <ExternalLink size={14} />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </>
        )}

        {!benchmarkListingId && (
          <Alert severity="info" sx={{ mt: 1, fontSize: 12 }}>
            {t('selectListingForBenchmark')}
          </Alert>
        )}
      </TabPanel>
    </Box>
  );
}
