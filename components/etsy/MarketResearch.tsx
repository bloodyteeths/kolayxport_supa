import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
  Eye, Heart, ShoppingBag, ArrowUpDown,
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

interface TagData {
  tag: string;
  count: number;
  pct: number;
}

interface KeywordData {
  keyword: string;
  count: number;
  pct: number;
  inMyTitle?: boolean;
}

interface ShopData {
  shop_id: number;
  shop_name: string;
  num_sales: number;
  review_count: number;
  review_average: number;
  listing_active_count: number;
  url: string;
  icon_url: string;
  avgPrice?: number;
  listingCount?: number;
}

interface SavedSearch {
  query: string;
  minPrice: string;
  maxPrice: string;
  sortOn: string;
  myTitle: string;
  myTags: string;
  timestamp: number;
}

interface AiAnalysis {
  opportunity_score: number;
  opportunity_level: string;
  market_summary: string;
  pricing_strategy: string;
  tag_recommendations: string[];
  title_recommendations: string;
  niche_positioning: string;
  seasonal_advice: string;
  competition_analysis: string;
  action_items: string[];
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
        action: 'search_market',
        keywords: query.trim(),
        limit: '200',
        sort_on: sortOn,
        sort_order: 'desc',
      });
      if (minPrice) params.set('min_price', minPrice);
      if (maxPrice) params.set('max_price', maxPrice);

      const res = await fetch(`/api/clawd/etsy?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Arama basarisiz');
      }
      const data = await res.json();
      setItems(data.items || []);
      setTotalResults(data.total || 0);
      setServerTagFreq(data.tagFrequency || []);
      setServerKeywords(data.titleKeywords || []);
      setServerShopIds(data.shopIds || []);
      toast.success(`${data.total?.toLocaleString()} sonuc bulundu`);

      // Auto-discover shops
      if (data.shopIds?.length > 0) {
        discoverShops(data.shopIds);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, sortOn, minPrice, maxPrice]);

  const discoverShops = useCallback(async (shopIds: number[]) => {
    setShopsLoading(true);
    try {
      const ids = shopIds.slice(0, 20).join(',');
      const res = await fetch(`/api/clawd/etsy?action=batch_shops&shop_ids=${ids}`);
      if (!res.ok) throw new Error('Magaza bilgileri alinamadi');
      const data = await res.json();
      setDiscoveredShops(data.shops || []);
    } catch (err: any) {
      console.error('Shop discovery error:', err);
    } finally {
      setShopsLoading(false);
    }
  }, []);

  const searchShopDeepDive = useCallback(async () => {
    if (!deepDiveShopId.trim()) return;
    setDeepDiveLoading(true);
    setDeepDiveShop(null);
    setDeepDiveListings([]);
    try {
      // Fetch shop info and listings in parallel
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
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeepDiveLoading(false);
    }
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
          action: 'market_analysis',
          query,
          totalResults,
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
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAiLoading(false);
    }
  }, [items, query, totalResults, serverTagFreq, serverKeywords, discoveredShops, serverShopIds]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') searchMarket();
  };

  // ---------------------------------------------------------------------------
  // Computed: Prices
  // ---------------------------------------------------------------------------

  const prices = useMemo(() =>
    items.map(i => i.price).filter(p => p > 0).sort((a, b) => a - b),
  [items]);

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

  // Sweet spot: price range with highest avg favorites
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
      return serverKeywords.map(k => ({
        ...k,
        inMyTitle: myTitleWords.has(k.keyword),
      }));
    }
    const wordFreq: Record<string, number> = {};
    allTitles.forEach(title => {
      extractWords(title).forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
    });
    return Object.entries(wordFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50)
      .map(([keyword, count]) => ({
        keyword, count,
        pct: Math.round((count / Math.max(allTitles.length, 1)) * 100),
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
    // Also include tags from user's listings
    if (userListings?.length) {
      userListings.forEach(l => {
        (l.tags || []).forEach((t: string) => tags.push(t.toLowerCase().trim()));
      });
    }
    return new Set(tags);
  }, [myTags, userListings]);

  const enrichedTags = useMemo(() => {
    return serverTagFreq.map(t => ({
      ...t,
      inMyTags: myTagsSet.has(t.tag),
    }));
  }, [serverTagFreq, myTagsSet]);

  const tagGaps = useMemo(() => {
    return enrichedTags.filter(t => !t.inMyTags && t.pct >= 5);
  }, [enrichedTags]);

  // Tag combinations (2-tag pairs from same listings)
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
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 30)
      .map(([pair, v]) => ({
        pair, count: v.count, avgFav: Math.round(v.totalFav / v.count),
      }));
  }, [items]);

  // ---------------------------------------------------------------------------
  // Computed: Engagement & Sorting
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
      // Compute avg price from items belonging to this shop
      const shopItems = items.filter(i => i.shop_id === s.shop_id);
      const avgPrice = shopItems.length > 0
        ? shopItems.reduce((sum, i) => sum + i.price, 0) / shopItems.length
        : 0;
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
    const prices = deepDiveListings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
    const sum = prices.reduce((a, b) => a + b, 0);
    const mid = Math.floor(prices.length / 2);
    const avgFav = deepDiveListings.reduce((s, l) => s + l.num_favorers, 0) / deepDiveListings.length;
    const avgViews = deepDiveListings.reduce((s, l) => s + l.views, 0) / deepDiveListings.length;

    // Top tags
    const tagMap: Record<string, number> = {};
    deepDiveListings.forEach(l => {
      (l.tags || []).forEach(t => { tagMap[t.toLowerCase()] = (tagMap[t.toLowerCase()] || 0) + 1; });
    });
    const topTags = Object.entries(tagMap).sort(([, a], [, b]) => b - a).slice(0, 20)
      .map(([tag, count]) => ({ tag, count, pct: Math.round((count / deepDiveListings.length) * 100) }));

    return {
      count: deepDiveListings.length,
      priceMin: prices[0] || 0,
      priceMax: prices[prices.length - 1] || 0,
      priceAvg: prices.length > 0 ? Math.round((sum / prices.length) * 100) / 100 : 0,
      priceMedian: prices.length > 0 ? (prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid]) : 0,
      avgFav: Math.round(avgFav),
      avgViews: Math.round(avgViews),
      topTags,
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

    // Supply: less = higher opportunity
    const supplyScore = totalResults < 1000 ? 25 : totalResults < 5000 ? 18 : totalResults < 20000 ? 12 : 5;
    // Competition: fewer unique shops
    const compScore = uniqueShops < 10 ? 25 : uniqueShops < 20 ? 18 : uniqueShops < 40 ? 12 : 5;
    // Demand: higher avg favorites = more demand
    const demandPts = avgFavorites > 100 ? 20 : avgFavorites > 30 ? 15 : avgFavorites > 10 ? 10 : 5;
    // Engagement: higher fav/view ratio
    const engScore = avgEngagement > 0.05 ? 15 : avgEngagement > 0.02 ? 10 : avgEngagement > 0.01 ? 7 : 3;
    // Price spread: more room for niche
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

    // Tag coverage
    const top20tags = enrichedTags.slice(0, 20);
    const coveredTags = top20tags.filter(t => myTagsSet.has(t.tag));
    const tagScore = Math.round((coveredTags.length / Math.max(top20tags.length, 1)) * 30);

    // Title length (Etsy: up to 140 chars, optimal 100-130)
    const lengthScore = myTitle.length >= 100 && myTitle.length <= 140 ? 20
      : myTitle.length >= 70 ? 15
      : myTitle.length >= 40 ? 10 : 5;

    // Has tags?
    const hasTagsScore = myTagsSet.size >= 10 ? 20 : myTagsSet.size >= 5 ? 15 : myTagsSet.size > 0 ? 10 : 0;

    const score = Math.min(100, kwScore + tagScore + lengthScore + hasTagsScore);

    const avgLen = allTitles.length
      ? Math.round(allTitles.reduce((s, t) => s + t.length, 0) / allTitles.length)
      : 0;

    const recommendations: string[] = [];
    const missingKw = top20kw.filter(k => !k.inMyTitle).slice(0, 5);
    if (missingKw.length > 0) {
      recommendations.push(`Su eksik anahtar kelimeleri eklemeyi deneyin: ${missingKw.map(k => k.keyword).join(', ')}`);
    }
    if (tagGaps.length > 0) {
      recommendations.push(`Rakiplerin kullandigi su tagleri ekleyin: ${tagGaps.slice(0, 5).map(t => t.tag).join(', ')}`);
    }
    if (myTitle.length < 80) {
      recommendations.push(`Basliginiz kisa (${myTitle.length} karakter). Etsy icin en az 100 karakter onerilir.`);
    }
    if (myTagsSet.size < 13) {
      recommendations.push(`${13 - myTagsSet.size} tag daha ekleyin — Etsy'de 13 tag kullanin.`);
    }

    return {
      score, kwScore, tagScore, lengthScore, hasTagsScore,
      recommendations, avgLen,
      coveredKw: coveredKw.length, totalKw: top20kw.length,
      coveredTags: coveredTags.length, totalTags: top20tags.length,
    };
  }, [myTitle, enrichedKeywords, myTitleWords, enrichedTags, myTagsSet, tagGaps, allTitles]);

  // ---------------------------------------------------------------------------
  // Computed: Profit Calculator (Etsy fees)
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
      const tf = p * 0.065;
      const pp = p * 0.03 + 0.25;
      const oa = includeOffsiteAds ? p * 0.15 : 0;
      const pr = p - cost - ship - 0.20 - tf - pp - oa;
      return {
        label: delta === 0 ? 'Ortalama' : delta < 0 ? `${delta}%` : `+${delta}%`,
        price: p, profit: pr, margin: p > 0 ? (pr / p) * 100 : 0,
      };
    });

    return { cost, sell, ship, listingFee, transactionFee, paymentProcessing, offsiteAdsFee, totalFees, profit, margin, compare };
  }, [purchaseCost, sellingPrice, shippingCost, priceStats, includeOffsiteAds]);

  // Pre-fill selling price
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
      `"${(i.title || '').replace(/"/g, '""')}"`,
      i.price.toFixed(2),
      i.views,
      i.num_favorers,
      i.views > 0 ? ((i.num_favorers / i.views) * 100).toFixed(2) + '%' : '0%',
      (i.tags || []).length,
      i.quantity,
      i.url || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `etsy_research_${query.replace(/\s+/g, '_')}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV indirildi');
  }, [items, query]);

  const saveSearch = useCallback(() => {
    const entry: SavedSearch = { query, minPrice, maxPrice, sortOn, myTitle, myTags, timestamp: Date.now() };
    const updated = [entry, ...savedSearches.filter(s => s.query !== query)].slice(0, 20);
    saveSavedSearches(updated);
    setSavedSearches(updated);
    toast.success('Arama kaydedildi');
  }, [query, minPrice, maxPrice, sortOn, myTitle, myTags, savedSearches]);

  const loadSearch = useCallback((s: SavedSearch) => {
    setQuery(s.query);
    setMinPrice(s.minPrice);
    setMaxPrice(s.maxPrice);
    setSortOn(s.sortOn);
    setMyTitle(s.myTitle);
    setMyTags(s.myTags);
  }, []);

  const deleteSaved = useCallback((idx: number) => {
    const updated = savedSearches.filter((_, i) => i !== idx);
    saveSavedSearches(updated);
    setSavedSearches(updated);
  }, [savedSearches]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const hasData = items.length > 0;

  const statCard = (label: string, value: string, color: string, icon?: React.ReactNode) => (
    <Paper sx={{ p: 1.5, flex: 1, minWidth: 90, textAlign: 'center' }}>
      {icon && <Box sx={{ mb: 0.5 }}>{icon}</Box>}
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
            label="Anahtar Kelime Ara"
            value={query}
            onChange={e => setQuery(e.target.value)}
            size="small"
            sx={{ flex: 2, minWidth: 200 }}
            placeholder="flower girl dress, personalized gift..."
            onKeyDown={handleKeyDown}
          />
          <TextField
            label="Min Fiyat"
            value={minPrice}
            onChange={e => setMinPrice(e.target.value)}
            size="small"
            type="number"
            sx={{ width: 90 }}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <TextField
            label="Max Fiyat"
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value)}
            size="small"
            type="number"
            sx={{ width: 90 }}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <TextField
            label="Siralama"
            value={sortOn}
            onChange={e => setSortOn(e.target.value)}
            size="small"
            select
            sx={{ width: 130 }}
            SelectProps={{ native: true }}
          >
            <option value="score">En Iyi Eslesme</option>
            <option value="price">Fiyat</option>
            <option value="created">Yeni Eklenen</option>
            <option value="updated">Son Guncellenen</option>
          </TextField>
          <Button
            variant="contained"
            onClick={searchMarket}
            disabled={loading || !query.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : <Search size={16} />}
          >
            Arastir
          </Button>
        </Box>

        {/* My Title + Tags for SEO comparison */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
          <TextField
            label="Benim Basligim (SEO karsilastirma)"
            value={myTitle}
            onChange={e => setMyTitle(e.target.value)}
            size="small"
            sx={{ flex: 2, minWidth: 200 }}
            placeholder="Listeleme basliginizi girin..."
            helperText={`${myTitle.length}/140 karakter`}
          />
          <TextField
            label="Benim Taglarim (virgul ile)"
            value={myTags}
            onChange={e => setMyTags(e.target.value)}
            size="small"
            sx={{ flex: 2, minWidth: 200 }}
            placeholder="personalized gift, baby shower, nursery decor..."
            helperText={`${myTags.split(',').filter(t => t.trim()).length}/13 tag`}
          />
        </Box>
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
        <Tab icon={<DollarSign size={14} />} iconPosition="start" label="Fiyat Analizi" />
        <Tab icon={<Tag size={14} />} iconPosition="start" label="Anahtar Kelimeler" />
        <Tab icon={<Hash size={14} />} iconPosition="start" label="Tag Istihbarati" />
        <Tab icon={<BarChart2 size={14} />} iconPosition="start" label="Rakip Listeleri" />
        <Tab icon={<Users size={14} />} iconPosition="start" label="Magaza Analizi" />
        <Tab icon={<Store size={14} />} iconPosition="start" label="Magaza Derinlemesine" />
        <Tab icon={<Gauge size={14} />} iconPosition="start" label="Talep Skoru" />
        <Tab icon={<Calculator size={14} />} iconPosition="start" label="Kar Hesaplama" />
        <Tab icon={<TrendingUp size={14} />} iconPosition="start" label="SEO Karsilastirma" />
        <Tab icon={<Sparkles size={14} />} iconPosition="start" label="AI Pazar Analizi" />
      </Tabs>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* ================================================================ */}
      {/* TAB 0: PRICE ANALYSIS                                            */}
      {/* ================================================================ */}
      {tab === 0 && (
        <Box>
          {priceStats ? (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                {statCard('Minimum', fmt(priceStats.min), '#4caf50')}
                {statCard('Ortalama', fmt(priceStats.avg), '#2196f3')}
                {statCard('Medyan', fmt(priceStats.median), '#ff9800')}
                {statCard('Maksimum', fmt(priceStats.max), '#f44336')}
                {statCard('Sonuc', `${priceStats.count}`, '#9c27b0')}
              </Box>

              {/* Sweet Spot */}
              {sweetSpot && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    Fiyat Tatli Noktasi: {sweetSpot.label}
                  </Typography>
                  <Typography variant="body2">
                    Bu fiyat araligindaki urunler ortalama <strong>{sweetSpot.avgFav}</strong> favori aliyor ({sweetSpot.count} urun).
                    En yuksek etkileşim bu aralikta.
                  </Typography>
                </Alert>
              )}

              {/* Histogram */}
              {histogram.length > 1 && (
                <Paper sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Fiyat Dagilimi</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 120 }}>
                    {histogram.map((b, i) => (
                      <Tooltip key={i} title={`${b.label}: ${b.count} urun`}>
                        <Box sx={{
                          flex: 1, minWidth: 0,
                          height: `${Math.max((b.count / maxBucketCount) * 100, 2)}%`,
                          bgcolor: '#1976d2', borderRadius: '3px 3px 0 0',
                          transition: 'height 0.3s', cursor: 'pointer',
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
                          <TableRow key={r.label}>
                            <TableCell>{r.label}</TableCell>
                            <TableCell align="center">{r.count}</TableCell>
                            <TableCell align="center">{pct(r.pct)}</TableCell>
                            <TableCell align="center">
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                <Heart size={12} color="#e91e63" />
                                {avgFav}
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Box sx={{ width: '100%', bgcolor: '#e0e0e0', borderRadius: 1, height: 8 }}>
                                <Box sx={{ width: `${r.pct}%`, bgcolor: '#1976d2', height: 8, borderRadius: 1 }} />
                              </Box>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </>
          ) : !loading && <EmptyState />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 1: KEYWORDS                                                  */}
      {/* ================================================================ */}
      {tab === 1 && (
        <Box>
          {hasData ? (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                Rakiplerin basliklarindan cikarilan en populer anahtar kelimeler. Tiklayin ve kopyalayin.
              </Alert>

              {myTitle && (
                <Box sx={{ mb: 1.5 }}>
                  <Button size="small" variant={kwShowMissing ? 'contained' : 'outlined'}
                    onClick={() => setKwShowMissing(!kwShowMissing)} sx={{ mr: 1 }}>
                    {kwShowMissing ? 'Tum Kelimeler' : 'Basligimda Olmayanlar'}
                  </Button>
                </Box>
              )}

              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Tek Kelimeler</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                {(kwShowMissing ? enrichedKeywords.filter(k => !k.inMyTitle) : enrichedKeywords).map(kw => (
                  <Chip key={kw.keyword}
                    label={`${kw.keyword} (${kw.pct}%)`} size="small"
                    color={kw.pct >= 40 ? 'error' : kw.pct >= 20 ? 'warning' : 'default'}
                    variant={kw.inMyTitle ? 'filled' : 'outlined'}
                    onClick={() => { navigator.clipboard.writeText(kw.keyword); toast.success(`"${kw.keyword}" kopyalandi`); }}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Box>

              {bigrams.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>2 Kelimelik Ifadeler</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                    {bigrams.slice(0, 25).map(b => (
                      <Chip key={b.phrase} label={`${b.phrase} (${b.count})`} size="small"
                        color={b.percentage >= 30 ? 'primary' : 'default'} variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(b.phrase); toast.success(`"${b.phrase}" kopyalandi`); }}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Box>
                </>
              )}

              {trigrams.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Uzun Kuyruk (3+ kelime)</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                    {trigrams.slice(0, 20).map(t => (
                      <Chip key={t.phrase} label={`${t.phrase} (${t.count})`} size="small"
                        color="secondary" variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(t.phrase); toast.success(`"${t.phrase}" kopyalandi`); }}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Box>
                </>
              )}

              {/* Keyword density */}
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Anahtar Kelime Yogunlugu</Typography>
                {enrichedKeywords.slice(0, 15).map(kw => (
                  <Box key={kw.keyword} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 100, fontWeight: kw.inMyTitle ? 600 : 400 }}>
                      {kw.keyword}
                    </Typography>
                    <Box sx={{ flex: 1, bgcolor: '#e0e0e0', borderRadius: 1, height: 12 }}>
                      <Box sx={{
                        width: `${Math.min(kw.pct, 100)}%`,
                        bgcolor: kw.inMyTitle ? '#4caf50' : '#ff9800',
                        height: 12, borderRadius: 1,
                      }} />
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 35 }}>{kw.pct}%</Typography>
                  </Box>
                ))}
              </Paper>
            </>
          ) : !loading && <EmptyState />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 2: TAG INTELLIGENCE                                          */}
      {/* ================================================================ */}
      {tab === 2 && (
        <Box>
          {enrichedTags.length > 0 ? (
            <>
              {/* Tag Gap Alert */}
              {tagGaps.length > 0 && myTagsSet.size > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {tagGaps.length} Eksik Tag Tespit Edildi!
                  </Typography>
                  <Typography variant="body2">
                    Rakiplerin kullandigi ama sizde olmayan tagler:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                    {tagGaps.slice(0, 10).map(t => (
                      <Chip key={t.tag} label={`${t.tag} (%${t.pct})`} size="small" color="warning"
                        onClick={() => { navigator.clipboard.writeText(t.tag); toast.success(`"${t.tag}" kopyalandi`); }}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Box>
                </Alert>
              )}

              {/* All Tags Frequency */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  En Cok Kullanilan Tagler ({enrichedTags.length} benzersiz)
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                  {enrichedTags.slice(0, 40).map(t => (
                    <Chip key={t.tag}
                      label={`${t.tag} (%${t.pct})`} size="small"
                      color={t.inMyTags ? 'success' : t.pct >= 30 ? 'error' : t.pct >= 15 ? 'warning' : 'default'}
                      variant={t.inMyTags ? 'filled' : 'outlined'}
                      onClick={() => { navigator.clipboard.writeText(t.tag); toast.success(`"${t.tag}" kopyalandi`); }}
                      sx={{ cursor: 'pointer' }}
                    />
                  ))}
                </Box>

                {/* Tag density bars */}
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Tag Yogunlugu</Typography>
                {enrichedTags.slice(0, 20).map(t => (
                  <Box key={t.tag} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.3 }}>
                    <Typography variant="body2" sx={{ minWidth: 140, fontWeight: t.inMyTags ? 600 : 400 }}>
                      {t.inMyTags ? '✓ ' : ''}{t.tag}
                    </Typography>
                    <Box sx={{ flex: 1, bgcolor: '#e0e0e0', borderRadius: 1, height: 10 }}>
                      <Box sx={{
                        width: `${Math.min(t.pct, 100)}%`,
                        bgcolor: t.inMyTags ? '#4caf50' : '#7b1fa2',
                        height: 10, borderRadius: 1,
                      }} />
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 35 }}>{t.pct}%</Typography>
                  </Box>
                ))}
              </Paper>

              {/* Tag Combinations */}
              {tagCombos.length > 0 && (
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                    Populer Tag Kombinasyonlari
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Birlikte en cok kullanilan tag ciftleri ve ortalama favori sayilari
                  </Typography>
                  <TableContainer sx={{ maxHeight: 400 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Tag Cifti</TableCell>
                          <TableCell align="center">Kullanim</TableCell>
                          <TableCell align="center">Ort. Favori</TableCell>
                          <TableCell align="center">Kopyala</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {tagCombos.map(c => (
                          <TableRow key={c.pair} hover>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.pair}</Typography>
                            </TableCell>
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
                              }}>
                                <Copy size={14} />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              )}
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
              <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">{items.length} urun listeleniyor</Typography>
                <Box sx={{ flex: 1 }} />
                {(['none', 'price_asc', 'price_desc', 'favorites', 'views', 'engagement'] as const).map(s => (
                  <Chip key={s}
                    label={{ none: 'Varsayilan', price_asc: 'Fiyat ↑', price_desc: 'Fiyat ↓', favorites: 'Favori', views: 'Goruntulenme', engagement: 'Etkilesim' }[s]}
                    size="small" variant={compSort === s ? 'filled' : 'outlined'}
                    color={compSort === s ? 'primary' : 'default'}
                    onClick={() => setCompSort(s)} sx={{ cursor: 'pointer' }}
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
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'center' }}>
                          <Eye size={12} /> Goruntulenme
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'center' }}>
                          <Heart size={12} /> Favori
                        </Box>
                      </TableCell>
                      <TableCell align="center">Etkl. %</TableCell>
                      <TableCell align="center">Tag</TableCell>
                      <TableCell sx={{ width: 40 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedItems.slice(0, visibleCount).map(item => {
                      const engagement = item.views > 0 ? (item.num_favorers / item.views) * 100 : 0;
                      return (
                        <TableRow key={item.listing_id} hover>
                          <TableCell>
                            {item.image_url && (
                              <img src={item.image_url} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4 }} />
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.title}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {fmt(item.price)}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">{item.views.toLocaleString()}</TableCell>
                          <TableCell align="center">
                            <Typography variant="body2" sx={{
                              fontWeight: 700,
                              color: item.num_favorers > 100 ? '#4caf50' : item.num_favorers > 20 ? '#ff9800' : 'text.secondary',
                            }}>
                              {item.num_favorers.toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Chip label={`${engagement.toFixed(1)}%`} size="small"
                              color={engagement > 5 ? 'success' : engagement > 2 ? 'warning' : 'default'}
                              variant="outlined"
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

              {visibleCount < items.length && (
                <Box sx={{ textAlign: 'center', mt: 2 }}>
                  <Button variant="outlined" onClick={() => setVisibleCount(c => c + 20)}>
                    Daha Fazla Goster ({items.length - visibleCount} kalan)
                  </Button>
                </Box>
              )}
            </>
          ) : !loading && <EmptyState />}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 4: SHOP ANALYSIS                                             */}
      {/* ================================================================ */}
      {tab === 4 && (
        <Box>
          {shopsLoading && <LinearProgress sx={{ mb: 2 }} />}
          {shopStats && shopStats.shops.length > 0 ? (
            <>
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Magaza Yogunlugu</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Toplam Magaza</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>{shopStats.shops.length}</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Ort. Magaza Puani</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#ff9800' }}>
                      {shopStats.avgRating}★
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Top 5 Magaza Payi</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {shopStats.totalListings > 0 ? pct((shopStats.top5Sales / shopStats.totalListings) * 100) : '0%'}
                    </Typography>
                  </Paper>
                </Box>

                {/* Concentration bar */}
                <Box sx={{ display: 'flex', height: 20, borderRadius: 2, overflow: 'hidden' }}>
                  <Box sx={{
                    width: `${shopStats.totalListings ? (shopStats.top5Sales / shopStats.totalListings) * 100 : 0}%`,
                    bgcolor: '#1976d2', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.65rem' }}>Top 5</Typography>
                  </Box>
                  <Box sx={{ flex: 1, bgcolor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Diger</Typography>
                  </Box>
                </Box>
              </Paper>

              <TableContainer component={Paper} sx={{ maxHeight: 500 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Magaza</TableCell>
                      <TableCell align="center">Toplam Satis</TableCell>
                      <TableCell align="center">Puan</TableCell>
                      <TableCell align="center">Yorum</TableCell>
                      <TableCell align="center">Aktif Urun</TableCell>
                      <TableCell align="center">Ort. Fiyat</TableCell>
                      <TableCell sx={{ width: 40 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {shopStats.shops.map((s, i) => (
                      <TableRow key={s.shop_id} hover>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontWeight: 600, color: i < 3 ? '#ff9800' : 'text.secondary' }}>
                            {i + 1}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{
                            fontWeight: 600, cursor: 'pointer',
                            '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                          }}
                            onClick={() => { setDeepDiveShopId(String(s.shop_id)); setTab(5); }}
                          >
                            {s.shop_name}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {s.num_sales.toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3 }}>
                            <Star size={12} color="#ff9800" fill="#ff9800" />
                            {s.review_average.toFixed(1)}
                          </Box>
                        </TableCell>
                        <TableCell align="center">{s.review_count.toLocaleString()}</TableCell>
                        <TableCell align="center">{s.listing_active_count}</TableCell>
                        <TableCell align="center">
                          {s.avgPrice ? fmt(s.avgPrice) : '-'}
                        </TableCell>
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
            </>
          ) : !shopsLoading && (
            hasData
              ? <Alert severity="info">Magaza bilgileri yukleniyor...</Alert>
              : <EmptyState />
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 5: SHOP DEEP DIVE                                            */}
      {/* ================================================================ */}
      {tab === 5 && (
        <Box>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Magaza Derinlemesine Analiz</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField
                label="Magaza ID"
                value={deepDiveShopId}
                onChange={e => setDeepDiveShopId(e.target.value)}
                size="small"
                sx={{ flex: 1, minWidth: 200 }}
                placeholder="Magaza ID girin..."
                onKeyDown={e => e.key === 'Enter' && searchShopDeepDive()}
              />
              <Button variant="contained" onClick={searchShopDeepDive}
                disabled={deepDiveLoading || !deepDiveShopId.trim()}
                startIcon={deepDiveLoading ? <CircularProgress size={16} /> : <Search size={16} />}
              >
                Analiz Et
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Magaza Analizi tabindan magaza adina tiklayarak da gelebilirsiniz.
            </Typography>
          </Paper>

          {deepDiveLoading && <LinearProgress sx={{ mb: 2 }} />}

          {deepDiveShop && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>{deepDiveShop.shop_name}</Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                {statCard('Toplam Satis', deepDiveShop.num_sales.toLocaleString(), '#4caf50')}
                {statCard('Puan', `${deepDiveShop.review_average.toFixed(1)}★`, '#ff9800')}
                {statCard('Yorum', deepDiveShop.review_count.toLocaleString(), '#2196f3')}
                {statCard('Aktif Urun', String(deepDiveShop.listing_active_count), '#9c27b0')}
              </Box>
            </Paper>
          )}

          {deepDiveStats && (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                {statCard('Min Fiyat', fmt(deepDiveStats.priceMin), '#4caf50')}
                {statCard('Ort. Fiyat', fmt(deepDiveStats.priceAvg), '#2196f3')}
                {statCard('Max Fiyat', fmt(deepDiveStats.priceMax), '#f44336')}
                {statCard('Ort. Favori', String(deepDiveStats.avgFav), '#e91e63')}
                {statCard('Ort. Goruntulenme', String(deepDiveStats.avgViews), '#ff9800')}
              </Box>

              {/* Top tags */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>En Cok Kullanilan Tagler</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {deepDiveStats.topTags.map(t => (
                    <Chip key={t.tag} label={`${t.tag} (%${t.pct})`} size="small" variant="outlined"
                      onClick={() => { navigator.clipboard.writeText(t.tag); toast.success('Kopyalandi'); }}
                      sx={{ cursor: 'pointer' }}
                    />
                  ))}
                </Box>
              </Paper>

              {/* Best listings */}
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>En Populer Urunler</Typography>
                <TableContainer sx={{ maxHeight: 400 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Baslik</TableCell>
                        <TableCell align="right">Fiyat</TableCell>
                        <TableCell align="center">Favori</TableCell>
                        <TableCell align="center">Goruntulenme</TableCell>
                        <TableCell sx={{ width: 40 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {deepDiveStats.bestListings.map((l, i) => (
                        <TableRow key={l.listing_id} hover>
                          <TableCell>
                            <Typography variant="caption" sx={{ fontWeight: 600, color: i < 3 ? '#ff9800' : 'text.secondary' }}>
                              {i + 1}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {l.title}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{fmt(l.price)}</TableCell>
                          <TableCell align="center">
                            <Typography sx={{ fontWeight: 700, color: l.num_favorers > 100 ? '#4caf50' : '#ff9800' }}>
                              {l.num_favorers.toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">{l.views.toLocaleString()}</TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => window.open(l.url, '_blank')}>
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
          )}

          {!deepDiveLoading && !deepDiveShop && (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Store size={48} color="#ccc" />
              <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                Magaza ID girin ve derinlemesine analiz edin
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Fiyat dagilimi, tag kullanimi, en populer urunler
              </Typography>
            </Paper>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 6: DEMAND SCORE                                              */}
      {/* ================================================================ */}
      {tab === 6 && (
        <Box>
          {demandScore ? (
            <>
              <Paper sx={{ p: 3, mb: 2, textAlign: 'center' }}>
                <Typography variant="h3" sx={{
                  fontWeight: 800,
                  color: demandScore.score >= 70 ? '#4caf50' : demandScore.score >= 40 ? '#ff9800' : '#f44336',
                }}>
                  {demandScore.score}/100
                </Typography>
                <Typography variant="body1" color="text.secondary">Firsat Skoru</Typography>
                <LinearProgress variant="determinate" value={demandScore.score}
                  sx={{
                    mt: 1.5, height: 12, borderRadius: 6,
                    '& .MuiLinearProgress-bar': {
                      bgcolor: demandScore.score >= 70 ? '#4caf50' : demandScore.score >= 40 ? '#ff9800' : '#f44336',
                    },
                  }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
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
                  { label: 'Ort. Goruntulenme', value: String(demandScore.avgViews), desc: 'Gorunurluk' },
                  { label: 'Etkilesim Orani', value: `${demandScore.avgEngagement}%`, desc: 'Fav/Goruntulenme' },
                  { label: 'Fiyat Yayilimi', value: `${demandScore.priceSpread}x`, desc: 'Cesitlilik' },
                ].map(m => (
                  <Paper key={m.label} sx={{ p: 1.5, flex: 1, minWidth: 130 }}>
                    <Typography variant="caption" color="text.secondary">{m.label}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>{m.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{m.desc}</Typography>
                  </Paper>
                ))}
              </Box>

              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Skor Detayi</Typography>
                {[
                  { label: 'Arz Skoru', score: demandScore.breakdown.supplyScore, max: 25, desc: 'Dusuk arz = yuksek firsat' },
                  { label: 'Rekabet Skoru', score: demandScore.breakdown.compScore, max: 25, desc: 'Az magaza = kolay giris' },
                  { label: 'Talep Skoru', score: demandScore.breakdown.demandPts, max: 20, desc: 'Yuksek favori = guclu talep' },
                  { label: 'Etkilesim Skoru', score: demandScore.breakdown.engScore, max: 15, desc: 'Yuksek oran = ilgi cekici nis' },
                  { label: 'Fiyat Cesitliligi', score: demandScore.breakdown.spreadScore, max: 15, desc: 'Genis aralik = nis firsat' },
                ].map(b => (
                  <Box key={b.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="body2" sx={{ minWidth: 140 }}>{b.label}</Typography>
                    <Box sx={{ flex: 1, bgcolor: '#e0e0e0', borderRadius: 1, height: 10 }}>
                      <Box sx={{
                        width: `${(b.score / b.max) * 100}%`,
                        bgcolor: b.score / b.max >= 0.7 ? '#4caf50' : b.score / b.max >= 0.4 ? '#ff9800' : '#f44336',
                        height: 10, borderRadius: 1,
                      }} />
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 40 }}>{b.score}/{b.max}</Typography>
                    <Tooltip title={b.desc}><Info size={14} color="#999" /></Tooltip>
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
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>Etsy Kar Hesaplayici</Typography>
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

          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Etsy Ucret Detaylari</Typography>
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
                        Listeleme Ucreti
                        <Tooltip title="Her listeleme icin $0.20"><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.listingFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        Islem Komisyonu (6.5%)
                        <Tooltip title="Her satis icin %6.5"><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.transactionFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        Odeme Isleme (3% + $0.25)
                        <Tooltip title="Etsy Payments ucreti"><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.paymentProcessing)}</TableCell>
                  </TableRow>
                  {includeOffsiteAds && (
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          Offsite Ads (15%)
                          <Tooltip title="Etsy dis site reklam ucreti"><Info size={14} color="#999" /></Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.offsiteAdsFee)}</TableCell>
                    </TableRow>
                  )}
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

          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Farkli Fiyat Noktalari</Typography>
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
                  {profitCalc.compare.map(c => (
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
      {/* TAB 8: SEO COMPARISON                                            */}
      {/* ================================================================ */}
      {tab === 8 && (
        <Box>
          {seoResult ? (
            <>
              <Paper sx={{ p: 2, mb: 2, textAlign: 'center' }}>
                <Typography variant="h4" sx={{
                  color: seoResult.score >= 70 ? 'success.main' : seoResult.score >= 40 ? 'warning.main' : 'error.main',
                  fontWeight: 700,
                }}>
                  {seoResult.score}/100
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  SEO Skoru — Kelime ({seoResult.coveredKw}/{seoResult.totalKw}) + Tag ({seoResult.coveredTags}/{seoResult.totalTags}) kapsami
                </Typography>
                <LinearProgress variant="determinate" value={seoResult.score}
                  color={seoResult.score >= 70 ? 'success' : seoResult.score >= 40 ? 'warning' : 'error'}
                  sx={{ mt: 1, height: 10, borderRadius: 5 }}
                />
              </Paper>

              {/* Score breakdown */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Skor Detayi</Typography>
                {[
                  { label: 'Kelime Kapsami', score: seoResult.kwScore, max: 30 },
                  { label: 'Tag Kapsami', score: seoResult.tagScore, max: 30 },
                  { label: 'Baslik Uzunlugu', score: seoResult.lengthScore, max: 20 },
                  { label: 'Tag Sayisi', score: seoResult.hasTagsScore, max: 20 },
                ].map(b => (
                  <Box key={b.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 120 }}>{b.label}</Typography>
                    <Box sx={{ flex: 1, bgcolor: '#e0e0e0', borderRadius: 1, height: 8 }}>
                      <Box sx={{
                        width: `${(b.score / b.max) * 100}%`,
                        bgcolor: b.score / b.max >= 0.7 ? '#4caf50' : b.score / b.max >= 0.4 ? '#ff9800' : '#f44336',
                        height: 8, borderRadius: 1,
                      }} />
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 40 }}>{b.score}/{b.max}</Typography>
                  </Box>
                ))}
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
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#4caf50' }}>100-140</Typography>
                  </Paper>
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
                <TableContainer component={Paper} sx={{ maxHeight: 400 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Kelime</TableCell>
                        <TableCell align="center">Kullanim %</TableCell>
                        <TableCell align="center">Basligimda</TableCell>
                        <TableCell align="center">Kopyala</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {enrichedKeywords.slice(0, 20).map(kw => (
                        <TableRow key={kw.keyword} sx={{ bgcolor: kw.inMyTitle ? 'action.selected' : 'transparent' }}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: kw.inMyTitle ? 600 : 400 }}>
                              {kw.keyword}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Chip label={`%${kw.pct}`} size="small"
                              color={kw.pct >= 50 ? 'error' : kw.pct >= 25 ? 'warning' : 'default'}
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
                              <IconButton size="small" onClick={() => {
                                navigator.clipboard.writeText(kw.keyword);
                                toast.success(`"${kw.keyword}" kopyalandi`);
                              }}>
                                <Copy size={14} />
                              </IconButton>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          ) : !loading && (
            <Alert severity="info">
              {myTitle
                ? 'Oncelikle bir arama yapin, ardindan SEO skorunuz otomatik hesaplanacak.'
                : 'SEO analizi icin yukaridaki "Benim Basligim" ve "Benim Taglarim" alanlarini doldurun ve arama yapin.'}
            </Alert>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 9: AI MARKET ANALYSIS                                        */}
      {/* ================================================================ */}
      {tab === 9 && (
        <Box>
          <Paper sx={{ p: 2, mb: 2, textAlign: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              AI Destekli Pazar Analizi
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Gemini AI kullanarak pazar verilerinizi analiz edin. Strateji onerileri, fiyatlandirma tavsiyeleri ve aksiyon maddeleri alin.
            </Typography>
            <Button variant="contained" color="secondary"
              onClick={generateAiInsights}
              disabled={aiLoading || items.length === 0}
              startIcon={aiLoading ? <CircularProgress size={16} /> : <Sparkles size={16} />}
              size="large"
            >
              {aiLoading ? 'Analiz ediliyor...' : 'AI Analizi Baslat'}
            </Button>
            {items.length === 0 && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                Oncelikle bir arama yapin
              </Typography>
            )}
          </Paper>

          {aiLoading && <LinearProgress sx={{ mb: 2 }} />}

          {aiAnalysis && (
            <>
              {/* Opportunity Score */}
              <Paper sx={{ p: 3, mb: 2, textAlign: 'center' }}>
                <Typography variant="h3" sx={{
                  fontWeight: 800,
                  color: aiAnalysis.opportunity_score >= 70 ? '#4caf50'
                    : aiAnalysis.opportunity_score >= 40 ? '#ff9800' : '#f44336',
                }}>
                  {aiAnalysis.opportunity_score}/100
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  Firsat Seviyesi: <strong>{aiAnalysis.opportunity_level}</strong>
                </Typography>
                <LinearProgress variant="determinate" value={aiAnalysis.opportunity_score}
                  sx={{
                    mt: 1, height: 10, borderRadius: 5,
                    '& .MuiLinearProgress-bar': {
                      bgcolor: aiAnalysis.opportunity_score >= 70 ? '#4caf50'
                        : aiAnalysis.opportunity_score >= 40 ? '#ff9800' : '#f44336',
                    },
                  }}
                />
              </Paper>

              {/* Market Summary */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Pazar Ozeti</Typography>
                <Typography variant="body2">{aiAnalysis.market_summary}</Typography>
              </Paper>

              {/* Grid of insights */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#2196f3' }}>
                    Fiyatlandirma Stratejisi
                  </Typography>
                  <Typography variant="body2">{aiAnalysis.pricing_strategy}</Typography>
                </Paper>

                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#9c27b0' }}>
                    Nis Pozisyonlama
                  </Typography>
                  <Typography variant="body2">{aiAnalysis.niche_positioning}</Typography>
                </Paper>

                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#f44336' }}>
                    Rekabet Analizi
                  </Typography>
                  <Typography variant="body2">{aiAnalysis.competition_analysis}</Typography>
                </Paper>

                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#ff9800' }}>
                    Mevsimsel Tavsiyeler
                  </Typography>
                  <Typography variant="body2">{aiAnalysis.seasonal_advice}</Typography>
                </Paper>
              </Box>

              {/* Title Recommendations */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Baslik Optimizasyonu</Typography>
                <Typography variant="body2">{aiAnalysis.title_recommendations}</Typography>
              </Paper>

              {/* Tag Recommendations */}
              {aiAnalysis.tag_recommendations?.length > 0 && (
                <Paper sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Onerilen Tagler</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {aiAnalysis.tag_recommendations.map((tag, i) => (
                      <Chip key={i} label={tag} size="small" color="secondary" variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(tag); toast.success('Kopyalandi'); }}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Box>
                </Paper>
              )}

              {/* Action Items */}
              {aiAnalysis.action_items?.length > 0 && (
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#4caf50' }}>
                    Yapilacaklar Listesi
                  </Typography>
                  {aiAnalysis.action_items.map((item, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.5, alignItems: 'flex-start' }}>
                      <Typography variant="body2" sx={{ color: '#4caf50', fontWeight: 700, minWidth: 20 }}>
                        {i + 1}.
                      </Typography>
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
      <Paper sx={{ p: 1.5, mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="outlined" size="small" startIcon={<Download size={14} />}
          onClick={exportCSV} disabled={items.length === 0}>
          CSV Indir
        </Button>
        <Button variant="outlined" size="small" startIcon={<Bookmark size={14} />}
          onClick={saveSearch} disabled={!query.trim()}>
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
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <Paper sx={{ p: 4, textAlign: 'center' }}>
      <Search size={48} color="#ccc" />
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
        Anahtar kelime girin ve arastirmaya baslayin
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Fiyat analizi, tag istihbarati, rakip analizi, magaza kesfet, talep skoru, kar hesaplama ve AI pazar analizi
      </Typography>
    </Paper>
  );
}
