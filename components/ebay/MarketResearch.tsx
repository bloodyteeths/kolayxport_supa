import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Alert, Tabs, Tab, Select, MenuItem, FormControl,
  InputLabel, Tooltip, IconButton, CircularProgress, InputAdornment,
} from '@mui/material';
import {
  Search, TrendingUp, DollarSign, Tag, BarChart2, ExternalLink,
  CheckCircle, XCircle, Users, FolderTree, Gauge, Calculator,
  Download, Bookmark, Copy, Star, ArrowUpDown, Trash2, Info,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketResearchProps {
  userId: string;
  initialQuery?: string;
  initialTitle?: string;
}

interface PriceStats {
  min: number;
  max: number;
  avg: number;
  median: number;
  count: number;
}

interface KeywordData {
  keyword: string;
  count: number;
  percentage: number;
  inMyTitle?: boolean;
}

interface MarketItem {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  condition: string;
  conditionId?: string;
  image?: { imageUrl: string };
  itemWebUrl: string;
  seller?: { username: string; feedbackScore: number; feedbackPercentage: string };
  categories?: { categoryId: string; categoryName: string }[];
  leafCategoryIds?: string[];
  shippingOptions?: { shippingCostType: string; shippingCost?: { value: string; currency: string } }[];
  buyingOptions?: string[];
  itemLocation?: { postalCode: string; country: string };
  marketingPrice?: { originalPrice: { value: string; currency: string }; discountPercentage: string };
  topRatedBuyingExperience?: boolean;
  itemCreationDate?: string;
  legacyItemId?: string;
}

interface AspectDistribution {
  localizedAspectName: string;
  aspectValueDistributions: { localizedAspectValue: string; matchCount: number; refinementHref?: string }[];
}

interface SavedSearch {
  query: string;
  marketplace: string;
  category: string;
  condition: string;
  sort: string;
  myTitle: string;
  timestamp: number;
}

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
  return title.toLowerCase().split(/[\s,;:!?()[\]{}""'']+/).filter(
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

const SAVED_KEY = 'kolayxport_ebay_saved_searches';

function loadSavedSearches(): SavedSearch[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveSavedSearches(list: SavedSearch[]) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 20)));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MarketResearch({ userId, initialQuery, initialTitle }: MarketResearchProps) {
  // --- state: controls ---
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState(initialQuery || '');
  const [myTitle, setMyTitle] = useState(initialTitle || '');
  const [marketplace, setMarketplace] = useState('EBAY_US');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('BEST_MATCH');
  const [loading, setLoading] = useState(false);

  // --- state: data ---
  const [items, setItems] = useState<MarketItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [topKeywords, setTopKeywords] = useState<KeywordData[]>([]);
  const [aspectDistributions, setAspectDistributions] = useState<AspectDistribution[]>([]);

  // --- state: competitor pagination ---
  const [visibleCount, setVisibleCount] = useState(20);

  // --- state: competitor sort ---
  const [compSort, setCompSort] = useState<'price_asc' | 'price_desc' | 'feedback' | 'none'>('none');

  // --- state: keyword tab filter ---
  const [kwShowMissing, setKwShowMissing] = useState(false);

  // --- state: profit calculator ---
  const [purchaseCost, setPurchaseCost] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [shippingCost, setShippingCost] = useState('');

  // --- state: saved searches ---
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);

  // --- state: seller deep dive ---
  const [sellerUsername, setSellerUsername] = useState('');
  const [sellerItems, setSellerItems] = useState<any[]>([]);
  const [sellerLoading, setSellerLoading] = useState(false);
  const [sellerTotal, setSellerTotal] = useState(0);

  // --- state: category research ---
  const [topCategories, setTopCategories] = useState<any[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catBestsellers, setCatBestsellers] = useState<any[]>([]);
  const [catBestsellerName, setCatBestsellerName] = useState('');
  const [catBestsellerLoading, setCatBestsellerLoading] = useState(false);
  const [catPriceStats, setCatPriceStats] = useState<any>(null);

  useEffect(() => {
    setSavedSearches(loadSavedSearches());
  }, []);

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  const searchMarket = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setVisibleCount(20);
    setCompSort('none');
    try {
      const params = new URLSearchParams({
        action: 'search_market',
        q: query.trim(),
        user_id: userId,
        marketplace_id: marketplace,
        limit: '200',
        sort: sortOrder,
      });
      if (categoryFilter) params.set('category_id', categoryFilter);
      if (conditionFilter) params.set('filter', `conditionIds:{${conditionFilter}}`);

      const res = await fetch(`/api/clawd/ebay?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Arama basarisiz');
      }
      const data = await res.json();
      setItems(data.items || []);
      setTotalResults(data.total || 0);
      setTopKeywords(data.topKeywords || []);
      setAspectDistributions(data.aspectDistributions || []);
      toast.success(`${data.total} sonuc bulundu`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, userId, marketplace, sortOrder, categoryFilter, conditionFilter]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') searchMarket();
  };

  const searchSeller = useCallback(async () => {
    if (!sellerUsername.trim()) return;
    setSellerLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'search_seller',
        seller: sellerUsername.trim(),
        user_id: userId,
        marketplace_id: marketplace,
        limit: '50',
      });
      if (query.trim()) params.set('q', query.trim());

      const res = await fetch(`/api/clawd/ebay?${params}`);
      if (!res.ok) throw new Error((await res.json()).error || 'Satici aranamadi');
      const data = await res.json();
      setSellerItems(data.items || []);
      setSellerTotal(data.total || 0);
      toast.success(`${data.total} urun bulundu (${sellerUsername})`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSellerLoading(false);
    }
  }, [sellerUsername, userId, marketplace, query]);

  const loadTopCategories = useCallback(async () => {
    setCatLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'top_categories',
        user_id: userId,
      });
      const res = await fetch(`/api/clawd/ebay?${params}`);
      if (!res.ok) throw new Error((await res.json()).error || 'Kategoriler yuklenemedi');
      const data = await res.json();
      setTopCategories(data.categories || []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCatLoading(false);
    }
  }, [userId]);

  const searchCategoryBestsellers = useCallback(async (categoryId: string, categoryName: string) => {
    setCatBestsellerLoading(true);
    setCatBestsellerName(categoryName);
    setCatBestsellers([]);
    try {
      const params = new URLSearchParams({
        action: 'category_bestsellers',
        category_id: categoryId,
        user_id: userId,
        marketplace_id: marketplace,
        limit: '50',
      });
      const res = await fetch(`/api/clawd/ebay?${params}`);
      if (!res.ok) throw new Error((await res.json()).error || 'Bestseller yuklenemedi');
      const data = await res.json();
      setCatBestsellers(data.items || []);
      setCatPriceStats(data.priceStats);
      toast.success(`${data.total} urun bulundu (${categoryName})`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCatBestsellerLoading(false);
    }
  }, [userId, marketplace]);

  // ---------------------------------------------------------------------------
  // Computed: Prices
  // ---------------------------------------------------------------------------

  const prices = useMemo(() =>
    items.map((i) => parseFloat(i.price?.value || '0')).filter((p) => p > 0).sort((a, b) => a - b),
  [items]);

  const priceStats: PriceStats | null = useMemo(() => {
    if (prices.length === 0) return null;
    const sum = prices.reduce((a, b) => a + b, 0);
    const mid = Math.floor(prices.length / 2);
    return {
      min: prices[0],
      max: prices[prices.length - 1],
      avg: Math.round((sum / prices.length) * 100) / 100,
      median: prices.length % 2 === 0 ? Math.round(((prices[mid - 1] + prices[mid]) / 2) * 100) / 100 : prices[mid],
      count: prices.length,
    };
  }, [prices]);

  // price histogram buckets
  const histogram = useMemo(() => {
    if (prices.length === 0) return [];
    const bucketCount = 12;
    const lo = prices[0];
    const hi = prices[prices.length - 1];
    if (hi === lo) return [{ label: fmt(lo), count: prices.length }];
    const step = (hi - lo) / bucketCount;
    const buckets: { label: string; count: number }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const bMin = lo + i * step;
      const bMax = lo + (i + 1) * step;
      const count = prices.filter((p) => (i === bucketCount - 1 ? p >= bMin && p <= bMax : p >= bMin && p < bMax)).length;
      buckets.push({ label: `${fmt(bMin)}`, count });
    }
    return buckets;
  }, [prices]);

  const maxBucketCount = useMemo(() => Math.max(...histogram.map((b) => b.count), 1), [histogram]);

  // price range breakdown
  const priceRangeBreakdown = useMemo(() =>
    PRICE_RANGES.map((r) => {
      const count = prices.filter((p) => p >= r.min && p < r.max).length;
      return { ...r, count, pct: prices.length ? (count / prices.length) * 100 : 0 };
    }),
  [prices]);

  // NEW vs USED comparison
  const conditionComparison = useMemo(() => {
    const newItems = items.filter((i) => (i.conditionId === '1000' || (i.condition || '').toLowerCase().includes('new')));
    const usedItems = items.filter((i) => !newItems.includes(i));
    const avg = (arr: MarketItem[]) => {
      const p = arr.map((i) => parseFloat(i.price?.value || '0')).filter((v) => v > 0);
      return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0;
    };
    return {
      newCount: newItems.length, usedCount: usedItems.length,
      newAvg: avg(newItems), usedAvg: avg(usedItems),
    };
  }, [items]);

  // discount analysis
  const discountAnalysis = useMemo(() => {
    const discounted = items.filter((i) => i.marketingPrice);
    const avgDiscount = discounted.length
      ? discounted.reduce((s, i) => s + parseFloat(i.marketingPrice?.discountPercentage || '0'), 0) / discounted.length
      : 0;
    return { discountedCount: discounted.length, total: items.length, avgDiscount };
  }, [items]);

  // ---------------------------------------------------------------------------
  // Computed: Keywords (enhanced with bigrams/trigrams)
  // ---------------------------------------------------------------------------

  const allTitles = useMemo(() => items.map((i) => i.title), [items]);
  const myTitleWords = useMemo(() => new Set(extractWords(myTitle)), [myTitle]);

  const enrichedKeywords = useMemo(() => {
    const wordFreq: Record<string, number> = {};
    allTitles.forEach((title) => {
      extractWords(title).forEach((w) => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
    });
    return Object.entries(wordFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50)
      .map(([keyword, count]) => ({
        keyword,
        count,
        percentage: Math.round((count / Math.max(allTitles.length, 1)) * 100),
        inMyTitle: myTitleWords.has(keyword),
      }));
  }, [allTitles, myTitleWords]);

  const bigrams = useMemo(() => extractNgrams(allTitles, 2), [allTitles]);
  const trigrams = useMemo(() => extractNgrams(allTitles, 3), [allTitles]);

  // ---------------------------------------------------------------------------
  // Computed: SEO Score
  // ---------------------------------------------------------------------------

  const seoResult = useMemo(() => {
    if (!myTitle || enrichedKeywords.length === 0) return null;
    const top20 = enrichedKeywords.slice(0, 20);
    const covered = top20.filter((k) => myTitleWords.has(k.keyword));
    const coverageScore = Math.round((covered.length / Math.max(top20.length, 1)) * 60);
    const lengthScore = myTitle.length >= 60 && myTitle.length <= 80 ? 20 : myTitle.length >= 40 ? 15 : 5;
    const avgLen = allTitles.length
      ? Math.round(allTitles.reduce((s, t) => s + t.length, 0) / allTitles.length)
      : 0;
    const lengthDiffScore = Math.abs(myTitle.length - avgLen) < 10 ? 20 : Math.abs(myTitle.length - avgLen) < 20 ? 10 : 5;
    const score = Math.min(100, coverageScore + lengthScore + lengthDiffScore);

    const recommendations: string[] = [];
    const missing = top20.filter((k) => !k.inMyTitle).slice(0, 5);
    if (missing.length > 0) {
      recommendations.push(`Su eksik anahtar kelimeleri eklemeyi deneyin: ${missing.map((k) => k.keyword).join(', ')}`);
    }
    if (myTitle.length < 60) {
      recommendations.push(`Basliginiz kisa (${myTitle.length} karakter). En az 60 karakter kullanin.`);
    }
    if (myTitle.length > 80) {
      recommendations.push(`Basliginiz uzun (${myTitle.length} karakter). 80 karakter altinda tutun.`);
    }
    if (covered.length < 5) {
      recommendations.push('Rakiplerin en cok kullandigi kelimeleri basliginiza dahil edin.');
    }

    return { score, recommendations, avgLen, covered: covered.length, total: top20.length };
  }, [myTitle, enrichedKeywords, myTitleWords, allTitles]);

  const seoColor = seoResult
    ? seoResult.score >= 70 ? 'success' : seoResult.score >= 40 ? 'warning' : 'error'
    : 'info';

  // ---------------------------------------------------------------------------
  // Computed: Seller Analysis
  // ---------------------------------------------------------------------------

  const sellerStats = useMemo(() => {
    const map: Record<string, {
      username: string; feedbackScore: number; feedbackPct: string;
      count: number; totalPrice: number; topRated: boolean;
    }> = {};

    items.forEach((item) => {
      if (!item.seller?.username) return;
      const u = item.seller.username;
      if (!map[u]) {
        map[u] = {
          username: u,
          feedbackScore: item.seller.feedbackScore || 0,
          feedbackPct: item.seller.feedbackPercentage || '0',
          count: 0,
          totalPrice: 0,
          topRated: false,
        };
      }
      map[u].count++;
      map[u].totalPrice += parseFloat(item.price?.value || '0');
      if (item.topRatedBuyingExperience) map[u].topRated = true;
    });

    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [items]);

  const sellerConcentration = useMemo(() => {
    const top5 = sellerStats.slice(0, 5).reduce((s, v) => s + v.count, 0);
    const rest = items.length - top5;
    return { top5, rest, total: items.length };
  }, [sellerStats, items]);

  // ---------------------------------------------------------------------------
  // Computed: Category Explorer
  // ---------------------------------------------------------------------------

  const categoryStats = useMemo(() => {
    const map: Record<string, { id: string; name: string; count: number }> = {};
    items.forEach((item) => {
      (item.categories || []).forEach((cat) => {
        if (!map[cat.categoryId]) {
          map[cat.categoryId] = { id: cat.categoryId, name: cat.categoryName, count: 0 };
        }
        map[cat.categoryId].count++;
      });
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [items]);

  // ---------------------------------------------------------------------------
  // Computed: Demand / Opportunity Score
  // ---------------------------------------------------------------------------

  const demandScore = useMemo(() => {
    if (items.length === 0) return null;
    const uniqueSellers = new Set(items.map((i) => i.seller?.username).filter(Boolean)).size;
    const itemsPerSeller = items.length / Math.max(uniqueSellers, 1);
    const priceSpread = priceStats ? (priceStats.max - priceStats.min) / Math.max(priceStats.avg, 1) : 0;
    const freeShippingPct = items.filter((i) =>
      i.shippingOptions?.some((s) => s.shippingCostType === 'FREE' || parseFloat(s.shippingCost?.value || '999') === 0),
    ).length / items.length;
    const avgFeedback = sellerStats.length
      ? sellerStats.reduce((s, v) => s + v.feedbackScore, 0) / sellerStats.length
      : 0;

    // Supply score: less total = higher opportunity (inverse)
    const supplyScore = totalResults < 500 ? 25 : totalResults < 2000 ? 18 : totalResults < 10000 ? 10 : 5;
    // Competition: fewer unique sellers = easier market
    const compScore = uniqueSellers < 10 ? 25 : uniqueSellers < 30 ? 18 : uniqueSellers < 60 ? 10 : 5;
    // Price spread: higher spread = more diverse, can find niche
    const spreadScore = priceSpread > 2 ? 20 : priceSpread > 1 ? 15 : priceSpread > 0.5 ? 10 : 5;
    // Free shipping: more free shipping = higher customer expectation
    const shippingScore = freeShippingPct > 0.7 ? 5 : freeShippingPct > 0.3 ? 10 : 15;
    // Established market: lower avg feedback = newer market, easier entry
    const estScore = avgFeedback < 500 ? 15 : avgFeedback < 5000 ? 10 : 5;

    const total = Math.min(100, supplyScore + compScore + spreadScore + shippingScore + estScore);

    return {
      score: total,
      totalResults,
      uniqueSellers,
      itemsPerSeller: Math.round(itemsPerSeller * 10) / 10,
      priceSpread: Math.round(priceSpread * 100) / 100,
      freeShippingPct: Math.round(freeShippingPct * 100),
      avgFeedback: Math.round(avgFeedback),
      breakdown: { supplyScore, compScore, spreadScore, shippingScore, estScore },
    };
  }, [items, totalResults, priceStats, sellerStats]);

  // ---------------------------------------------------------------------------
  // Computed: Competitor sort
  // ---------------------------------------------------------------------------

  const sortedItems = useMemo(() => {
    const sorted = [...items];
    if (compSort === 'price_asc') sorted.sort((a, b) => parseFloat(a.price?.value || '0') - parseFloat(b.price?.value || '0'));
    if (compSort === 'price_desc') sorted.sort((a, b) => parseFloat(b.price?.value || '0') - parseFloat(a.price?.value || '0'));
    if (compSort === 'feedback') sorted.sort((a, b) => (b.seller?.feedbackScore || 0) - (a.seller?.feedbackScore || 0));
    return sorted;
  }, [items, compSort]);

  // ---------------------------------------------------------------------------
  // Profit Calculator
  // ---------------------------------------------------------------------------

  const profitCalc = useMemo(() => {
    const cost = parseFloat(purchaseCost) || 0;
    const sell = parseFloat(sellingPrice) || (priceStats?.avg || 0);
    const ship = parseFloat(shippingCost) || 0;

    const ebayFee = sell * 0.1325;
    const paymentFee = sell * 0.029 + 0.30;
    const totalFees = ebayFee + paymentFee;
    const profit = sell - cost - ship - totalFees;
    const margin = sell > 0 ? (profit / sell) * 100 : 0;

    const compare = [-20, 0, 20].map((delta) => {
      const p = sell * (1 + delta / 100);
      const ef = p * 0.1325;
      const pf = p * 0.029 + 0.30;
      const pr = p - cost - ship - ef - pf;
      return { label: delta === 0 ? 'Ortalama' : delta < 0 ? `${delta}%` : `+${delta}%`, price: p, profit: pr, margin: p > 0 ? (pr / p) * 100 : 0 };
    });

    return { cost, sell, ship, ebayFee, paymentFee, totalFees, profit, margin, compare };
  }, [purchaseCost, sellingPrice, shippingCost, priceStats]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const exportCSV = useCallback(() => {
    if (items.length === 0) { toast.error('Disa aktarilacak veri yok'); return; }
    const headers = ['Baslik', 'Fiyat', 'Para Birimi', 'Durum', 'Satici', 'Geri Bildirim Skoru', 'Geri Bildirim %', 'Top Rated', 'Kargo', 'URL'];
    const rows = items.map((i) => [
      `"${(i.title || '').replace(/"/g, '""')}"`,
      i.price?.value || '',
      i.price?.currency || '',
      i.condition || '',
      i.seller?.username || '',
      i.seller?.feedbackScore ?? '',
      i.seller?.feedbackPercentage || '',
      i.topRatedBuyingExperience ? 'Evet' : 'Hayir',
      i.shippingOptions?.[0]?.shippingCostType === 'FREE' ? 'Ucretsiz' : (i.shippingOptions?.[0]?.shippingCost?.value || 'N/A'),
      i.itemWebUrl || '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ebay_research_${query.replace(/\s+/g, '_')}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV indirildi');
  }, [items, query]);

  const saveSearch = useCallback(() => {
    const entry: SavedSearch = { query, marketplace, category: categoryFilter, condition: conditionFilter, sort: sortOrder, myTitle, timestamp: Date.now() };
    const updated = [entry, ...savedSearches.filter((s) => s.query !== query || s.marketplace !== marketplace)].slice(0, 20);
    saveSavedSearches(updated);
    setSavedSearches(updated);
    toast.success('Arama kaydedildi');
  }, [query, marketplace, categoryFilter, conditionFilter, sortOrder, myTitle, savedSearches]);

  const loadSearch = useCallback((s: SavedSearch) => {
    setQuery(s.query);
    setMarketplace(s.marketplace);
    setCategoryFilter(s.category);
    setConditionFilter(s.condition);
    setSortOrder(s.sort);
    setMyTitle(s.myTitle);
  }, []);

  const deleteSaved = useCallback((idx: number) => {
    const updated = savedSearches.filter((_, i) => i !== idx);
    saveSavedSearches(updated);
    setSavedSearches(updated);
  }, [savedSearches]);

  // pre-fill selling price from avg when data loads
  useEffect(() => {
    if (priceStats && !sellingPrice) {
      setSellingPrice(priceStats.avg.toFixed(2));
    }
  }, [priceStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const hasData = items.length > 0;

  const statCard = (label: string, value: string, color: string) => (
    <Paper sx={{ p: 1.5, flex: 1, minWidth: 90, textAlign: 'center' }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" sx={{ color, fontWeight: 700 }}>{value}</Typography>
    </Paper>
  );

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  return (
    <Box>
      {/* ================================================================ */}
      {/* SEARCH BAR                                                       */}
      {/* ================================================================ */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <TextField
            label="Urun Arama"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            size="small"
            sx={{ flex: 2, minWidth: 200 }}
            placeholder="or: baby monitor, vintage lamp..."
            onKeyDown={handleKeyDown}
          />
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel>Pazar</InputLabel>
            <Select value={marketplace} onChange={(e) => setMarketplace(e.target.value)} label="Pazar">
              <MenuItem value="EBAY_US">ABD</MenuItem>
              <MenuItem value="EBAY_GB">Ingiltere</MenuItem>
              <MenuItem value="EBAY_DE">Almanya</MenuItem>
              <MenuItem value="EBAY_FR">Fransa</MenuItem>
              <MenuItem value="EBAY_IT">Italya</MenuItem>
              <MenuItem value="EBAY_ES">Ispanya</MenuItem>
              <MenuItem value="EBAY_AU">Avustralya</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Kategori ID"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            size="small"
            sx={{ width: 110 }}
            placeholder="opsiyonel"
          />
          <FormControl size="small" sx={{ minWidth: 90 }}>
            <InputLabel>Durum</InputLabel>
            <Select value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)} label="Durum">
              <MenuItem value="">Hepsi</MenuItem>
              <MenuItem value="1000">Yeni</MenuItem>
              <MenuItem value="3000">Kullanilmis</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Siralama</InputLabel>
            <Select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} label="Siralama">
              <MenuItem value="BEST_MATCH">En Iyi Eslesme</MenuItem>
              <MenuItem value="price">Fiyat: Dusuk→Yuksek</MenuItem>
              <MenuItem value="-price">Fiyat: Yuksek→Dusuk</MenuItem>
              <MenuItem value="newlyListed">Yeni Eklenen</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={searchMarket}
            disabled={loading || !query.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : <Search size={16} />}
          >
            Arastir
          </Button>
        </Box>

        {/* My Title input - always visible */}
        <TextField
          label="Benim Basligim (SEO karsilastirma)"
          value={myTitle}
          onChange={(e) => setMyTitle(e.target.value)}
          size="small"
          fullWidth
          sx={{ mt: 1.5 }}
          placeholder="Listeleme basliginizi girin..."
          helperText={`${myTitle.length}/80 karakter`}
        />
      </Paper>

      {/* ================================================================ */}
      {/* TABS                                                             */}
      {/* ================================================================ */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, '& .MuiTab-root': { minWidth: 'auto', fontSize: '0.8rem', px: 1.5 } }}
      >
        <Tab icon={<DollarSign size={14} />} iconPosition="start" label="Fiyat Arastirmasi" />
        <Tab icon={<TrendingUp size={14} />} iconPosition="start" label="SEO Analizi" />
        <Tab icon={<Tag size={14} />} iconPosition="start" label="Anahtar Kelimeler" />
        <Tab icon={<BarChart2 size={14} />} iconPosition="start" label="Rakip Listeleri" />
        <Tab icon={<Users size={14} />} iconPosition="start" label="Satici Analizi" />
        <Tab icon={<FolderTree size={14} />} iconPosition="start" label="Kategori Kesfet" />
        <Tab icon={<Gauge size={14} />} iconPosition="start" label="Talep Skoru" />
        <Tab icon={<Calculator size={14} />} iconPosition="start" label="Kar Hesaplama" />
        <Tab icon={<Users size={14} />} iconPosition="start" label="Satici Derinlemesine" />
        <Tab icon={<TrendingUp size={14} />} iconPosition="start" label="Kategori Arastirmasi" />
      </Tabs>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* ================================================================ */}
      {/* TAB 0: PRICE RESEARCH                                            */}
      {/* ================================================================ */}
      {tab === 0 && (
        <Box>
          {priceStats ? (
            <>
              {/* Stat cards */}
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                {statCard('Minimum', fmt(priceStats.min), '#4caf50')}
                {statCard('Ortalama', fmt(priceStats.avg), '#2196f3')}
                {statCard('Medyan', fmt(priceStats.median), '#ff9800')}
                {statCard('Maksimum', fmt(priceStats.max), '#f44336')}
                {statCard('Sonuc', `${priceStats.count}`, '#9c27b0')}
              </Box>

              {/* Histogram */}
              {histogram.length > 1 && (
                <Paper sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Fiyat Dagilimi</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 120 }}>
                    {histogram.map((b, i) => (
                      <Tooltip key={i} title={`${b.label}: ${b.count} urun`}>
                        <Box sx={{
                          flex: 1,
                          minWidth: 0,
                          height: `${Math.max((b.count / maxBucketCount) * 100, 2)}%`,
                          bgcolor: '#1976d2',
                          borderRadius: '3px 3px 0 0',
                          transition: 'height 0.3s',
                          cursor: 'pointer',
                          '&:hover': { bgcolor: '#1565c0' },
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
              <Paper sx={{ mb: 2 }}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Fiyat Araligi</TableCell>
                        <TableCell align="center">Urun Sayisi</TableCell>
                        <TableCell align="center">Oran</TableCell>
                        <TableCell sx={{ width: '30%' }}>Dagilim</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {priceRangeBreakdown.map((r) => (
                        <TableRow key={r.label}>
                          <TableCell>{r.label}</TableCell>
                          <TableCell align="center">{r.count}</TableCell>
                          <TableCell align="center">{pct(r.pct)}</TableCell>
                          <TableCell>
                            <Box sx={{ width: '100%', bgcolor: '#e0e0e0', borderRadius: 1, height: 8 }}>
                              <Box sx={{ width: `${r.pct}%`, bgcolor: '#1976d2', height: 8, borderRadius: 1, transition: 'width 0.3s' }} />
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>

              {/* NEW vs USED comparison */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Yeni vs Kullanilmis Karsilastirma</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 140 }}>
                    <Typography variant="caption" color="text.secondary">Yeni Urunler</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#4caf50' }}>{conditionComparison.newCount}</Typography>
                    <Typography variant="body2">Ort. {fmt(conditionComparison.newAvg)}</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 140 }}>
                    <Typography variant="caption" color="text.secondary">Kullanilmis Urunler</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#ff9800' }}>{conditionComparison.usedCount}</Typography>
                    <Typography variant="body2">Ort. {fmt(conditionComparison.usedAvg)}</Typography>
                  </Paper>
                  {conditionComparison.newAvg > 0 && conditionComparison.usedAvg > 0 && (
                    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 140 }}>
                      <Typography variant="caption" color="text.secondary">Fiyat Farki</Typography>
                      <Typography variant="h6" sx={{ fontWeight: 700, color: '#2196f3' }}>
                        {pct(((conditionComparison.newAvg - conditionComparison.usedAvg) / conditionComparison.usedAvg) * 100)}
                      </Typography>
                      <Typography variant="body2">Yeni daha pahali</Typography>
                    </Paper>
                  )}
                </Box>
              </Paper>

              {/* Discount analysis */}
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Indirim Analizi</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Indirimli Urunler</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {discountAnalysis.discountedCount}/{discountAnalysis.total}
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Indirimli Oran</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {discountAnalysis.total ? pct((discountAnalysis.discountedCount / discountAnalysis.total) * 100) : '0%'}
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Ort. Indirim</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#f44336' }}>
                      {pct(discountAnalysis.avgDiscount)}
                    </Typography>
                  </Paper>
                </Box>
              </Paper>
            </>
          ) : !loading && (
            <EmptyState />
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 1: SEO ANALYSIS                                              */}
      {/* ================================================================ */}
      {tab === 1 && (
        <Box>
          {seoResult ? (
            <>
              {/* Score */}
              <Paper sx={{ p: 2, mb: 2, textAlign: 'center' }}>
                <Typography variant="h4" sx={{
                  color: seoResult.score >= 70 ? 'success.main' : seoResult.score >= 40 ? 'warning.main' : 'error.main',
                  fontWeight: 700,
                }}>
                  {seoResult.score}/100
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  SEO Skoru — Rakiplerin populer kelimelerine gore ({seoResult.covered}/{seoResult.total} anahtar kelime eslesti)
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={seoResult.score}
                  color={seoColor as any}
                  sx={{ mt: 1, height: 10, borderRadius: 5 }}
                />
              </Paper>

              {/* Title length comparison */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Baslik Uzunlugu</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Benim Basligim</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>{myTitle.length} karakter</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Rakip Ortalamasi</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>{seoResult.avgLen} karakter</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Optimal Aralik</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#4caf50' }}>60-80</Typography>
                  </Paper>
                </Box>
                {/* length bar */}
                <Box sx={{ mt: 1.5, position: 'relative', height: 24, bgcolor: '#e0e0e0', borderRadius: 2 }}>
                  <Box sx={{
                    position: 'absolute', left: `${(60 / 80) * 100}%`, width: `${(20 / 80) * 100}%`,
                    height: '100%', bgcolor: '#c8e6c9', borderRadius: 2, zIndex: 0,
                  }} />
                  <Box sx={{
                    position: 'absolute', left: `${Math.min((myTitle.length / 80) * 100, 100)}%`,
                    top: 0, bottom: 0, width: 3, bgcolor: '#1976d2', borderRadius: 1, zIndex: 1,
                  }} />
                  <Typography variant="caption" sx={{ position: 'absolute', right: 4, top: 3 }}>
                    {myTitle.length}/80
                  </Typography>
                </Box>
              </Paper>

              {/* Recommendations */}
              {seoResult.recommendations.length > 0 && (
                <Alert severity={seoResult.score >= 70 ? 'success' : 'warning'} sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Oneriler</Typography>
                  {seoResult.recommendations.map((rec, i) => (
                    <Typography key={i} variant="body2">• {rec}</Typography>
                  ))}
                </Alert>
              )}

              {/* Keyword coverage table */}
              {enrichedKeywords.length > 0 && (
                <TableContainer component={Paper} sx={{ mb: 2, maxHeight: 400 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Anahtar Kelime</TableCell>
                        <TableCell align="center">Kullanim %</TableCell>
                        <TableCell align="center">Basligimda</TableCell>
                        <TableCell align="center">Islem</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {enrichedKeywords.slice(0, 20).map((kw) => (
                        <TableRow key={kw.keyword} sx={{ bgcolor: kw.inMyTitle ? 'action.selected' : 'transparent' }}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: kw.inMyTitle ? 600 : 400 }}>
                              {kw.keyword}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Chip label={`%${kw.percentage}`} size="small"
                              color={kw.percentage >= 50 ? 'error' : kw.percentage >= 25 ? 'warning' : 'default'}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell align="center">
                            {kw.inMyTitle
                              ? <CheckCircle size={18} color="#4caf50" />
                              : <XCircle size={18} color="#ccc" />}
                          </TableCell>
                          <TableCell align="center">
                            {!kw.inMyTitle && (
                              <Tooltip title="Kelimeyi kopyala">
                                <IconButton size="small" onClick={() => {
                                  navigator.clipboard.writeText(kw.keyword);
                                  toast.success(`"${kw.keyword}" panoya kopyalandi`);
                                }}>
                                  <Copy size={14} />
                                </IconButton>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {/* Aspect analysis */}
              {aspectDistributions.length > 0 && (
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Populer Urun Ozellikleri
                  </Typography>
                  {aspectDistributions.slice(0, 8).map((aspect) => (
                    <Box key={aspect.localizedAspectName} sx={{ mb: 1.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{aspect.localizedAspectName}</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {aspect.aspectValueDistributions.slice(0, 6).map((v) => (
                          <Chip
                            key={v.localizedAspectValue}
                            label={`${v.localizedAspectValue} (${v.matchCount})`}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                      </Box>
                    </Box>
                  ))}
                </Paper>
              )}
            </>
          ) : !loading && (
            <Alert severity="info">
              {myTitle
                ? 'Oncelikle bir arama yapin, ardindan SEO skorunuz otomatik hesaplanacak.'
                : 'SEO analizi icin yukaridaki "Benim Basligim" alanini doldurun ve arama yapin.'}
            </Alert>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 2: KEYWORDS                                                  */}
      {/* ================================================================ */}
      {tab === 2 && (
        <Box>
          {hasData ? (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                Rakiplerin basliklarindan cikarilan en populer anahtar kelimeler. Tiklayin ve kopyalayin.
              </Alert>

              {/* Filter toggle */}
              {myTitle && (
                <Box sx={{ mb: 1.5 }}>
                  <Button
                    size="small"
                    variant={kwShowMissing ? 'contained' : 'outlined'}
                    onClick={() => setKwShowMissing(!kwShowMissing)}
                    sx={{ mr: 1 }}
                  >
                    {kwShowMissing ? 'Tum Kelimeler' : 'Basligimda Olmayanlar'}
                  </Button>
                </Box>
              )}

              {/* Single keywords */}
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Tek Kelimeler</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                {(kwShowMissing ? enrichedKeywords.filter((k) => !k.inMyTitle) : enrichedKeywords).map((kw) => (
                  <Chip
                    key={kw.keyword}
                    label={`${kw.keyword} (${kw.percentage}%)`}
                    size="small"
                    color={kw.percentage >= 40 ? 'error' : kw.percentage >= 20 ? 'warning' : 'default'}
                    variant={kw.inMyTitle ? 'filled' : 'outlined'}
                    onClick={() => {
                      navigator.clipboard.writeText(kw.keyword);
                      toast.success(`"${kw.keyword}" kopyalandi`);
                    }}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Box>

              {/* Bigrams */}
              {bigrams.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>2 Kelimelik Ifadeler (Bigrams)</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                    {bigrams.slice(0, 25).map((b) => (
                      <Chip
                        key={b.phrase}
                        label={`${b.phrase} (${b.count})`}
                        size="small"
                        color={b.percentage >= 30 ? 'primary' : 'default'}
                        variant="outlined"
                        onClick={() => {
                          navigator.clipboard.writeText(b.phrase);
                          toast.success(`"${b.phrase}" kopyalandi`);
                        }}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Box>
                </>
              )}

              {/* Trigrams / Long-tail */}
              {trigrams.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Uzun Kuyruk Anahtar Kelimeler (3+ kelime)</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                    {trigrams.slice(0, 20).map((t) => (
                      <Chip
                        key={t.phrase}
                        label={`${t.phrase} (${t.count})`}
                        size="small"
                        color="secondary"
                        variant="outlined"
                        onClick={() => {
                          navigator.clipboard.writeText(t.phrase);
                          toast.success(`"${t.phrase}" kopyalandi`);
                        }}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Box>
                </>
              )}

              {/* Keyword density visualization */}
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Anahtar Kelime Yogunlugu</Typography>
                {enrichedKeywords.slice(0, 15).map((kw) => (
                  <Box key={kw.keyword} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 100, fontWeight: kw.inMyTitle ? 600 : 400 }}>
                      {kw.keyword}
                    </Typography>
                    <Box sx={{ flex: 1, bgcolor: '#e0e0e0', borderRadius: 1, height: 12 }}>
                      <Box sx={{
                        width: `${Math.min(kw.percentage, 100)}%`,
                        bgcolor: kw.inMyTitle ? '#4caf50' : '#ff9800',
                        height: 12, borderRadius: 1,
                      }} />
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 35 }}>{kw.percentage}%</Typography>
                  </Box>
                ))}
              </Paper>
            </>
          ) : !loading && <EmptyState />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 3: COMPETITOR LISTINGS                                       */}
      {/* ================================================================ */}
      {tab === 3 && (
        <Box>
          {hasData ? (
            <>
              {/* Sort controls */}
              <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">{items.length} urun listeleniyor</Typography>
                <Box sx={{ flex: 1 }} />
                {(['none', 'price_asc', 'price_desc', 'feedback'] as const).map((s) => (
                  <Chip
                    key={s}
                    label={{ none: 'Varsayilan', price_asc: 'Fiyat ↑', price_desc: 'Fiyat ↓', feedback: 'Puan' }[s]}
                    size="small"
                    variant={compSort === s ? 'filled' : 'outlined'}
                    color={compSort === s ? 'primary' : 'default'}
                    onClick={() => setCompSort(s)}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Box>

              <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 50 }} />
                      <TableCell>Baslik</TableCell>
                      <TableCell align="right">Fiyat</TableCell>
                      <TableCell>Durum</TableCell>
                      <TableCell>Satici</TableCell>
                      <TableCell align="center">Puan</TableCell>
                      <TableCell>Kargo</TableCell>
                      <TableCell sx={{ width: 40 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedItems.slice(0, visibleCount).map((item) => {
                      const isFreeShipping = item.shippingOptions?.some(
                        (s) => s.shippingCostType === 'FREE' || parseFloat(s.shippingCost?.value || '999') === 0,
                      );
                      return (
                        <TableRow key={item.itemId} hover>
                          <TableCell>
                            {item.image?.imageUrl && (
                              <img src={item.image.imageUrl} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4 }} />
                            )}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              {item.topRatedBuyingExperience && (
                                <Tooltip title="Top Rated">
                                  <Star size={14} color="#ff9800" fill="#ff9800" />
                                </Tooltip>
                              )}
                              <Typography variant="body2" sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.title}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              ${parseFloat(item.price?.value || '0').toFixed(2)}
                            </Typography>
                            {item.marketingPrice && (
                              <Typography variant="caption" sx={{ textDecoration: 'line-through', color: 'text.secondary' }}>
                                ${parseFloat(item.marketingPrice.originalPrice.value).toFixed(2)}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Chip label={item.condition || 'N/A'} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption">{item.seller?.username || '-'}</Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Tooltip title={`${item.seller?.feedbackPercentage || '0'}% olumlu`}>
                              <Typography variant="caption">{item.seller?.feedbackScore ?? '-'}</Typography>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={isFreeShipping ? 'Ucretsiz' : (item.shippingOptions?.[0]?.shippingCost ? `$${parseFloat(item.shippingOptions[0].shippingCost.value).toFixed(2)}` : '-')}
                              size="small"
                              color={isFreeShipping ? 'success' : 'default'}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => window.open(item.itemWebUrl, '_blank')}>
                              <ExternalLink size={14} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              {visibleCount < items.length && (
                <Box sx={{ textAlign: 'center', mt: 2 }}>
                  <Button variant="outlined" onClick={() => setVisibleCount((c) => c + 20)}>
                    Daha Fazla Goster ({items.length - visibleCount} kalan)
                  </Button>
                </Box>
              )}
            </>
          ) : !loading && <EmptyState />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 4: SELLER ANALYSIS                                           */}
      {/* ================================================================ */}
      {tab === 4 && (
        <Box>
          {sellerStats.length > 0 ? (
            <>
              {/* Seller concentration */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Satici Yogunlugu</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Toplam Satici</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>{sellerStats.length}</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Urun / Satici</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {(items.length / Math.max(sellerStats.length, 1)).toFixed(1)}
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Top Rated Satici</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#ff9800' }}>
                      {sellerStats.filter((s) => s.topRated).length}
                    </Typography>
                  </Paper>
                </Box>
                {/* Concentration bar */}
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  Ilk 5 satici: {sellerConcentration.top5} urun ({sellerConcentration.total > 0 ? pct((sellerConcentration.top5 / sellerConcentration.total) * 100) : '0%'})
                </Typography>
                <Box sx={{ display: 'flex', height: 20, borderRadius: 2, overflow: 'hidden' }}>
                  <Box sx={{
                    width: `${sellerConcentration.total ? (sellerConcentration.top5 / sellerConcentration.total) * 100 : 0}%`,
                    bgcolor: '#1976d2', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.65rem' }}>Top 5</Typography>
                  </Box>
                  <Box sx={{
                    flex: 1, bgcolor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Diger</Typography>
                  </Box>
                </Box>
              </Paper>

              {/* Seller table */}
              <TableContainer component={Paper} sx={{ maxHeight: 500 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Satici</TableCell>
                      <TableCell align="center">Geri Bildirim</TableCell>
                      <TableCell align="center">Olumlu %</TableCell>
                      <TableCell align="center">Listeleme</TableCell>
                      <TableCell align="right">Ort. Fiyat</TableCell>
                      <TableCell align="center">Top Rated</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sellerStats.slice(0, 30).map((s, i) => (
                      <TableRow key={s.username} hover>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline', color: 'primary.main' } }}
                            onClick={() => { setSellerUsername(s.username); setTab(8); }}
                          >
                            {s.username}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">{s.feedbackScore.toLocaleString()}</TableCell>
                        <TableCell align="center">{s.feedbackPct}%</TableCell>
                        <TableCell align="center">{s.count}</TableCell>
                        <TableCell align="right">{fmt(s.count > 0 ? s.totalPrice / s.count : 0)}</TableCell>
                        <TableCell align="center">
                          {s.topRated ? <Star size={16} color="#ff9800" fill="#ff9800" /> : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : !loading && <EmptyState />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 5: CATEGORY EXPLORER                                         */}
      {/* ================================================================ */}
      {tab === 5 && (
        <Box>
          {categoryStats.length > 0 ? (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                Arama sonuclarindaki kategori dagilimi. Bir kategoriye tikladiginizda filtre uygulanir.
              </Alert>

              <TableContainer component={Paper} sx={{ maxHeight: 500 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Kategori</TableCell>
                      <TableCell align="center">ID</TableCell>
                      <TableCell align="center">Urun Sayisi</TableCell>
                      <TableCell sx={{ width: '30%' }}>Dagilim</TableCell>
                      <TableCell align="center">Filtrele</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {categoryStats.map((cat) => (
                      <TableRow key={cat.id} hover>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{cat.name}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="caption" color="text.secondary">{cat.id}</Typography>
                        </TableCell>
                        <TableCell align="center">{cat.count}</TableCell>
                        <TableCell>
                          <Box sx={{ width: '100%', bgcolor: '#e0e0e0', borderRadius: 1, height: 10 }}>
                            <Box sx={{
                              width: `${(cat.count / Math.max(categoryStats[0]?.count || 1, 1)) * 100}%`,
                              bgcolor: '#7b1fa2', height: 10, borderRadius: 1,
                            }} />
                          </Box>
                        </TableCell>
                        <TableCell align="center">
                          <Button size="small" variant="outlined" onClick={() => {
                            setCategoryFilter(cat.id);
                            toast.success(`Kategori filtresi: ${cat.name}`);
                          }}>
                            Sec
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Aspect-based subcategory breakdown */}
              {aspectDistributions.length > 0 && (
                <Paper sx={{ p: 2, mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Alt Kategori / Ozellik Dagilimi</Typography>
                  {aspectDistributions.slice(0, 6).map((aspect) => (
                    <Box key={aspect.localizedAspectName} sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{aspect.localizedAspectName}</Typography>
                      {aspect.aspectValueDistributions.slice(0, 8).map((v) => (
                        <Box key={v.localizedAspectValue} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.3 }}>
                          <Typography variant="caption" sx={{ minWidth: 120 }}>{v.localizedAspectValue}</Typography>
                          <Box sx={{ flex: 1, bgcolor: '#e0e0e0', borderRadius: 1, height: 8 }}>
                            <Box sx={{
                              width: `${(v.matchCount / Math.max(aspect.aspectValueDistributions[0]?.matchCount || 1, 1)) * 100}%`,
                              bgcolor: '#7b1fa2', height: 8, borderRadius: 1,
                            }} />
                          </Box>
                          <Typography variant="caption" sx={{ minWidth: 30 }}>{v.matchCount}</Typography>
                        </Box>
                      ))}
                    </Box>
                  ))}
                </Paper>
              )}
            </>
          ) : !loading && <EmptyState />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 6: DEMAND SCORE                                              */}
      {/* ================================================================ */}
      {tab === 6 && (
        <Box>
          {demandScore ? (
            <>
              {/* Main score */}
              <Paper sx={{ p: 3, mb: 2, textAlign: 'center' }}>
                <Typography variant="h3" sx={{
                  fontWeight: 800,
                  color: demandScore.score >= 70 ? '#4caf50' : demandScore.score >= 40 ? '#ff9800' : '#f44336',
                }}>
                  {demandScore.score}/100
                </Typography>
                <Typography variant="body1" color="text.secondary">Firsat Skoru</Typography>
                <LinearProgress
                  variant="determinate"
                  value={demandScore.score}
                  sx={{
                    mt: 1.5, height: 12, borderRadius: 6,
                    '& .MuiLinearProgress-bar': {
                      bgcolor: demandScore.score >= 70 ? '#4caf50' : demandScore.score >= 40 ? '#ff9800' : '#f44336',
                    },
                  }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {demandScore.score >= 70 ? 'Bu nis iyi bir firsat! Rekabet makul ve pazar buyuklugu uygun.' :
                    demandScore.score >= 40 ? 'Orta seviye firsat. Rekabet analizi yaparak stratejinizi belirleyin.' :
                      'Bu pazar cok rekabetci veya doygun olabilir. Nis bir alt kategori bulmaya calisin.'}
                </Typography>
              </Paper>

              {/* Breakdown */}
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                {[
                  { label: 'Toplam Sonuc', value: demandScore.totalResults.toLocaleString(), desc: 'Arz miktari' },
                  { label: 'Benzersiz Satici', value: demandScore.uniqueSellers.toString(), desc: 'Rekabet' },
                  { label: 'Urun/Satici', value: demandScore.itemsPerSeller.toString(), desc: 'Yogunluk' },
                  { label: 'Fiyat Yayilimi', value: `${demandScore.priceSpread}x`, desc: 'Cesitlilik' },
                  { label: 'Ucretsiz Kargo', value: `${demandScore.freeShippingPct}%`, desc: 'Musteri beklentisi' },
                  { label: 'Ort. Geri Bildirim', value: demandScore.avgFeedback.toLocaleString(), desc: 'Pazar olgunlugu' },
                ].map((m) => (
                  <Paper key={m.label} sx={{ p: 1.5, flex: 1, minWidth: 130 }}>
                    <Typography variant="caption" color="text.secondary">{m.label}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>{m.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{m.desc}</Typography>
                  </Paper>
                ))}
              </Box>

              {/* Score breakdown */}
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Skor Aciklamasi</Typography>
                {[
                  { label: 'Arz Skoru', score: demandScore.breakdown.supplyScore, max: 25, desc: 'Dusuk arz = yuksek firsat' },
                  { label: 'Rekabet Skoru', score: demandScore.breakdown.compScore, max: 25, desc: 'Az satici = daha kolay giris' },
                  { label: 'Fiyat Yayilim Skoru', score: demandScore.breakdown.spreadScore, max: 20, desc: 'Genis aralik = nis firsat' },
                  { label: 'Kargo Skoru', score: demandScore.breakdown.shippingScore, max: 15, desc: 'Daha az ucretsiz = daha az baski' },
                  { label: 'Pazar Olgunluk Skoru', score: demandScore.breakdown.estScore, max: 15, desc: 'Yeni pazar = kolay giris' },
                ].map((b) => (
                  <Box key={b.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="body2" sx={{ minWidth: 150 }}>{b.label}</Typography>
                    <Box sx={{ flex: 1, bgcolor: '#e0e0e0', borderRadius: 1, height: 10 }}>
                      <Box sx={{
                        width: `${(b.score / b.max) * 100}%`,
                        bgcolor: b.score / b.max >= 0.7 ? '#4caf50' : b.score / b.max >= 0.4 ? '#ff9800' : '#f44336',
                        height: 10, borderRadius: 1,
                      }} />
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 40 }}>{b.score}/{b.max}</Typography>
                    <Tooltip title={b.desc}>
                      <Info size={14} color="#999" />
                    </Tooltip>
                  </Box>
                ))}
              </Paper>
            </>
          ) : !loading && <EmptyState />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 7: PROFIT CALCULATOR                                         */}
      {/* ================================================================ */}
      {tab === 7 && (
        <Box>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>Kar Hesaplayici</Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <TextField
                label="Alis Maliyeti ($)"
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(e.target.value)}
                size="small"
                type="number"
                sx={{ flex: 1, minWidth: 140 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
              <TextField
                label="Satis Fiyati ($)"
                value={sellingPrice || (priceStats?.avg.toFixed(2) || '')}
                onChange={(e) => setSellingPrice(e.target.value)}
                size="small"
                type="number"
                sx={{ flex: 1, minWidth: 140 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                helperText={priceStats ? `Pazar ortalamasi: ${fmt(priceStats.avg)}` : ''}
              />
              <TextField
                label="Kargo Maliyeti ($)"
                value={shippingCost}
                onChange={(e) => setShippingCost(e.target.value)}
                size="small"
                type="number"
                sx={{ flex: 1, minWidth: 140 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
            </Box>
          </Paper>

          {/* Fee breakdown */}
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Ucret Detaylari</Typography>
            <TableContainer>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell>Satis Fiyati</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(profitCalc.sell)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        eBay Komisyonu (13.25%)
                        <Tooltip title="Cogu kategori icin son deger ucreti"><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.ebayFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        Odeme Isleme (2.9% + $0.30)
                        <Tooltip title="Managed Payments / PayPal ucreti"><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.paymentFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Alis Maliyeti</TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.cost)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Kargo Maliyeti</TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.ship)}</TableCell>
                  </TableRow>
                  <Divider component="tr" />
                  <TableRow sx={{ bgcolor: profitCalc.profit >= 0 ? '#e8f5e9' : '#ffebee' }}>
                    <TableCell sx={{ fontWeight: 700 }}>Net Kar</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: profitCalc.profit >= 0 ? 'success.main' : 'error.main' }}>
                      {fmt(profitCalc.profit)}
                    </TableCell>
                  </TableRow>
                  <TableRow sx={{ bgcolor: profitCalc.profit >= 0 ? '#e8f5e9' : '#ffebee' }}>
                    <TableCell sx={{ fontWeight: 700 }}>Kar Marji</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: profitCalc.profit >= 0 ? 'success.main' : 'error.main' }}>
                      {pct(profitCalc.margin)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Price comparison table */}
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Farkli Fiyat Noktalari Karsilastirmasi</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Senaryo</TableCell>
                    <TableCell align="right">Fiyat</TableCell>
                    <TableCell align="right">Kar</TableCell>
                    <TableCell align="right">Marj</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profitCalc.compare.map((c) => (
                    <TableRow key={c.label} hover>
                      <TableCell>{c.label}</TableCell>
                      <TableCell align="right">{fmt(c.price)}</TableCell>
                      <TableCell align="right" sx={{ color: c.profit >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                        {fmt(c.profit)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: c.margin >= 0 ? 'success.main' : 'error.main' }}>
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
      {/* TAB 8: SELLER DEEP DIVE                                         */}
      {/* ================================================================ */}
      {tab === 8 && (
        <Box>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Satici Arastirmasi</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField
                label="Satici Kullanici Adi"
                value={sellerUsername}
                onChange={(e) => setSellerUsername(e.target.value)}
                size="small"
                sx={{ flex: 1, minWidth: 200 }}
                placeholder="ornek: bestdeals2024"
                onKeyDown={(e) => e.key === 'Enter' && searchSeller()}
              />
              <TextField
                label="Urun Filtresi (opsiyonel)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                size="small"
                sx={{ flex: 1, minWidth: 150 }}
                placeholder="baby monitor, stethoscope..."
              />
              <Button
                variant="contained"
                onClick={searchSeller}
                disabled={sellerLoading || !sellerUsername.trim()}
                startIcon={sellerLoading ? <CircularProgress size={16} /> : <Search size={16} />}
              >
                Arastir
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Rakip listeleri gosterilir — tahmini satislari dahil. Rakip analizi tabindan satici adina tiklayarak da gelebilirsiniz.
            </Typography>
          </Paper>

          {sellerLoading && <LinearProgress sx={{ mb: 2 }} />}

          {sellerItems.length > 0 && (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                <strong>{sellerUsername}</strong> saticisinin {sellerTotal} urunundan {sellerItems.length} tanesi gosteriliyor.
                {sellerItems.filter((i: any) => i.estimatedSoldQuantity > 0).length > 0 && (
                  <> Tahmini toplam satis: <strong>{sellerItems.reduce((s: number, i: any) => s + (i.estimatedSoldQuantity || 0), 0)}</strong> adet</>
                )}
              </Alert>

              <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 50 }} />
                      <TableCell>Baslik</TableCell>
                      <TableCell align="right">Fiyat</TableCell>
                      <TableCell align="center">Durum</TableCell>
                      <TableCell align="center">Tahmini Satis</TableCell>
                      <TableCell>Kargo</TableCell>
                      <TableCell sx={{ width: 40 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sellerItems.map((item: any) => {
                      const isFreeShipping = item.shippingOptions?.some(
                        (s: any) => s.shippingCostType === 'FREE' || parseFloat(s.shippingCost?.value || '999') === 0,
                      );
                      return (
                        <TableRow key={item.itemId} hover>
                          <TableCell>
                            {item.image?.imageUrl && (
                              <img src={item.image.imageUrl} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4 }} />
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.title}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              ${parseFloat(item.price?.value || '0').toFixed(2)}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Chip label={item.condition || 'N/A'} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell align="center">
                            <Typography variant="body2" sx={{
                              fontWeight: 700,
                              color: (item.estimatedSoldQuantity || 0) > 10 ? '#4caf50' : (item.estimatedSoldQuantity || 0) > 0 ? '#ff9800' : 'text.secondary',
                            }}>
                              {item.estimatedSoldQuantity || 0}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={isFreeShipping ? 'Ucretsiz' : (item.shippingOptions?.[0]?.shippingCost ? `$${parseFloat(item.shippingOptions[0].shippingCost.value).toFixed(2)}` : '-')}
                              size="small"
                              color={isFreeShipping ? 'success' : 'default'}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => window.open(item.itemWebUrl, '_blank')}>
                              <ExternalLink size={14} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}

          {!sellerLoading && sellerItems.length === 0 && (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Users size={48} color="#ccc" />
              <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                Rakip satici adi girin ve analiz edin
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Bir saticinin urunlerini, fiyatlarini ve tahmini satislarini gorun
              </Typography>
            </Paper>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 9: CATEGORY RESEARCH                                        */}
      {/* ================================================================ */}
      {tab === 9 && (
        <Box>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Kategori Arastirmasi</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              eBay ana kategorilerini kesfet, herhangi bir kategoriye tiklayarak en cok satan urunleri gor.
            </Typography>
            <Button
              variant="contained"
              onClick={loadTopCategories}
              disabled={catLoading}
              startIcon={catLoading ? <CircularProgress size={16} /> : <FolderTree size={16} />}
            >
              {topCategories.length > 0 ? 'Yenile' : 'Kategorileri Yukle'}
            </Button>
          </Paper>

          {catLoading && <LinearProgress sx={{ mb: 2 }} />}

          {/* Category bestsellers results */}
          {catBestsellerName && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  En Cok Satanlar: {catBestsellerName}
                </Typography>
                <Button size="small" onClick={() => { setCatBestsellerName(''); setCatBestsellers([]); }}>
                  Kapat
                </Button>
              </Box>

              {catBestsellerLoading && <LinearProgress sx={{ mb: 1 }} />}

              {catPriceStats && (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                  {[
                    { label: 'Min', value: `$${catPriceStats.min?.toFixed(2)}`, color: '#4caf50' },
                    { label: 'Ort', value: `$${catPriceStats.avg?.toFixed(2)}`, color: '#2196f3' },
                    { label: 'Medyan', value: `$${catPriceStats.median?.toFixed(2)}`, color: '#ff9800' },
                    { label: 'Max', value: `$${catPriceStats.max?.toFixed(2)}`, color: '#f44336' },
                  ].map((s) => (
                    <Paper key={s.label} variant="outlined" sx={{ p: 1, flex: 1, minWidth: 80, textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">{s.label}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: s.color }}>{s.value}</Typography>
                    </Paper>
                  ))}
                </Box>
              )}

              {catBestsellers.length > 0 && (
                <TableContainer sx={{ maxHeight: 500 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 30 }}>#</TableCell>
                        <TableCell sx={{ width: 50 }} />
                        <TableCell>Baslik</TableCell>
                        <TableCell align="right">Fiyat</TableCell>
                        <TableCell align="center">Tahmini Satis</TableCell>
                        <TableCell>Satici</TableCell>
                        <TableCell sx={{ width: 40 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {catBestsellers.map((item: any, idx: number) => (
                        <TableRow key={item.itemId} hover>
                          <TableCell>
                            <Typography variant="caption" sx={{ fontWeight: 600, color: idx < 3 ? '#ff9800' : 'text.secondary' }}>
                              {idx + 1}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {item.image?.imageUrl && (
                              <img src={item.image.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.title}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              ${parseFloat(item.price?.value || '0').toFixed(2)}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Typography variant="body2" sx={{
                              fontWeight: 700,
                              color: (item.estimatedSoldQuantity || 0) > 10 ? '#4caf50' : (item.estimatedSoldQuantity || 0) > 0 ? '#ff9800' : 'text.secondary',
                            }}>
                              {item.estimatedSoldQuantity || 0}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="caption"
                              sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                              onClick={() => {
                                setSellerUsername(item.seller?.username || '');
                                setTab(8);
                              }}
                            >
                              {item.seller?.username || '-'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => window.open(item.itemWebUrl, '_blank')}>
                              <ExternalLink size={14} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>
          )}

          {/* Category tree */}
          {topCategories.length > 0 && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 1.5 }}>
              {topCategories.map((cat: any) => (
                <Paper key={cat.categoryId} sx={{ p: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                      {cat.categoryName}
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => searchCategoryBestsellers(cat.categoryId, cat.categoryName)}
                      sx={{ fontSize: '0.7rem', py: 0.3, minWidth: 0 }}
                    >
                      Bestseller
                    </Button>
                  </Box>
                  {cat.children?.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {cat.children.slice(0, 8).map((child: any) => (
                        <Chip
                          key={child.categoryId}
                          label={child.categoryName}
                          size="small"
                          variant="outlined"
                          onClick={() => searchCategoryBestsellers(child.categoryId, child.categoryName)}
                          sx={{ cursor: 'pointer', fontSize: '0.7rem' }}
                        />
                      ))}
                      {cat.children.length > 8 && (
                        <Chip label={`+${cat.children.length - 8} daha`} size="small" color="default" sx={{ fontSize: '0.7rem' }} />
                      )}
                    </Box>
                  )}
                </Paper>
              ))}
            </Box>
          )}

          {!catLoading && topCategories.length === 0 && !catBestsellerName && (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <FolderTree size={48} color="#ccc" />
              <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                Kategorileri yukleyerek baslayln
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Her kategorinin en cok satan urunlerini kesfet, tahmini satislari gor
              </Typography>
            </Paper>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* BOTTOM TOOLBAR                                                   */}
      {/* ================================================================ */}
      <Paper sx={{ p: 1.5, mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Download size={14} />}
          onClick={exportCSV}
          disabled={items.length === 0}
        >
          CSV Indir
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Bookmark size={14} />}
          onClick={saveSearch}
          disabled={!query.trim()}
        >
          Aramayi Kaydet
        </Button>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {savedSearches.map((s, i) => (
          <Chip
            key={`${s.query}-${s.timestamp}`}
            label={`${s.query} (${new Date(s.timestamp).toLocaleDateString('tr-TR')})`}
            size="small"
            variant="outlined"
            onClick={() => loadSearch(s)}
            onDelete={() => deleteSaved(i)}
            deleteIcon={<Trash2 size={12} />}
            sx={{ cursor: 'pointer' }}
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
// Empty state sub-component
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <Paper sx={{ p: 4, textAlign: 'center' }}>
      <Search size={48} color="#ccc" />
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
        Urun adi girin ve arastirmaya baslayin
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Fiyat analizi, SEO anahtar kelime arastirmasi, rakip ve satici analizi, talep skoru ve kar hesaplama yapabilirsiniz
      </Typography>
    </Paper>
  );
}
