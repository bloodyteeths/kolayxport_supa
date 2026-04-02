import { create } from 'zustand';
import { toast } from 'react-hot-toast';
import type {
  EtsyMarketItem, TagData, KeywordData, ShopData, AiAnalysis,
  TrendData, AutocompleteSuggestion, SeasonalData, SavedSearch,
  EnrichedTag, EnrichedKeyword, DemandScore, PriceStats, HistogramBucket,
  SweetSpot, TagCombo, ShopStats, DeepDiveStats, SeoResult, ProfitCalc,
  SortDir,
} from '@/components/etsy/research/shared/types';
import {
  extractWords, extractNgrams, PRICE_RANGES, fmt,
  loadSavedSearches, saveSavedSearches, sortArray,
} from '@/components/etsy/research/shared/utils';

interface EtsyResearchState {
  // --- Search controls ---
  query: string;
  myTitle: string;
  myTags: string;
  minPrice: string;
  maxPrice: string;
  sortOn: string;
  loading: boolean;

  // --- Search data ---
  items: EtsyMarketItem[];
  totalResults: number;
  serverTagFreq: TagData[];
  serverKeywords: KeywordData[];
  serverShopIds: number[];

  // --- Shops ---
  discoveredShops: ShopData[];
  shopsLoading: boolean;
  shopDiscoveryFailed: boolean;

  // --- Deep dive ---
  deepDiveShopId: string;
  deepDiveShop: ShopData | null;
  deepDiveListings: EtsyMarketItem[];
  deepDiveLoading: boolean;

  // --- AI ---
  aiAnalysis: AiAnalysis | null;
  aiLoading: boolean;

  // --- Niche analysis (backend) ---
  nicheAnalysis: any | null;
  nicheAnalysisLoading: boolean;
  nicheAiReport: any | null;
  nicheAiReportLoading: boolean;

  // --- Listing analyzer ---
  listingAnalysis: any | null;
  listingAnalysisLoading: boolean;
  listingAudit: any | null;
  listingAuditLoading: boolean;

  // --- Shop spy AI ---
  shopSpyReport: any | null;
  shopSpyReportLoading: boolean;
  shopReviews: any | null;
  shopReviewsLoading: boolean;
  reviewSentiment: any | null;
  reviewSentimentLoading: boolean;

  // --- Competitor sort ---
  compSort: 'none' | 'price_asc' | 'price_desc' | 'favorites' | 'views' | 'engagement';
  visibleCount: number;

  // --- Keyword Explorer ---
  kwExplorerQuery: string;
  kwSuggestions: AutocompleteSuggestion[];
  kwExplorerLoading: boolean;
  kwAlphabetSoup: boolean;

  // --- Trends ---
  trendData: TrendData | null;
  trendLoading: boolean;
  seasonalData: SeasonalData | null;
  seasonalLoading: boolean;

  // --- Rank Tracker ---
  trackedKeywords: any[];
  rankLoading: boolean;
  rankKeywordInput: string;
  rankListingId: number | null;
  rankAddLoading: boolean;
  expandedRankId: string | null;
  rankHistory: any[];

  // --- Saved ---
  savedSearches: SavedSearch[];

  // --- Keyword filter ---
  kwShowMissing: boolean;

  // --- Selected listing ---
  selectedListingId: number | null;

  // --- Comparison mode ---
  pinnedListing: EtsyMarketItem | null;
  comparisonVisible: boolean;

  // --- Discovery (pre-loaded) ---
  discoveryData: any | null;
  discoveryLoading: boolean;

  // --- Actions ---
  setQuery: (q: string) => void;
  setMyTitle: (t: string) => void;
  setMyTags: (t: string) => void;
  setMinPrice: (p: string) => void;
  setMaxPrice: (p: string) => void;
  setSortOn: (s: string) => void;
  setCompSort: (s: EtsyResearchState['compSort']) => void;
  setVisibleCount: (n: number) => void;
  setKwExplorerQuery: (q: string) => void;
  setKwAlphabetSoup: (b: boolean) => void;
  setKwShowMissing: (b: boolean) => void;
  setDeepDiveShopId: (id: string) => void;
  setSelectedListingId: (id: number | null) => void;
  setRankKeywordInput: (s: string) => void;
  setRankListingId: (id: number | null) => void;
  setExpandedRankId: (id: string | null) => void;
  pinListing: (listing: EtsyMarketItem | null) => void;
  toggleComparison: () => void;

  // --- Async actions ---
  searchMarket: () => Promise<void>;
  discoverShops: (shopIds: number[]) => Promise<void>;
  searchShopDeepDive: () => Promise<void>;
  generateAiInsights: () => Promise<void>;
  fetchNicheAnalysis: () => Promise<void>;
  fetchNicheAiReport: () => Promise<void>;
  fetchListingAnalysis: (listingId: string) => Promise<void>;
  fetchListingAudit: () => Promise<void>;
  analyzeShop: (shopId: string) => Promise<void>;
  fetchShopSpyReport: () => Promise<void>;
  fetchShopReviews: () => Promise<void>;
  fetchReviewSentiment: () => Promise<void>;
  searchKeywords: () => Promise<void>;
  fetchTrends: () => Promise<void>;
  fetchTrackedKeywords: (shopId: string) => Promise<void>;
  addTrackedKeyword: (shopId: string, userListings?: any[]) => Promise<void>;
  removeTrackedKeyword: (keywordId: string, shopId: string) => Promise<void>;
  fetchRankHistory: (keywordId: string, shopId: string) => Promise<void>;
  fetchDiscoveryData: () => Promise<void>;
  exportCSV: () => void;
  saveSearch: () => void;
  loadSearch: (s: SavedSearch) => void;
  deleteSaved: (idx: number) => void;
  initSavedSearches: () => void;
}

export const useEtsyResearchStore = create<EtsyResearchState>((set, get) => ({
  // --- Initial state ---
  query: '',
  myTitle: '',
  myTags: '',
  minPrice: '',
  maxPrice: '',
  sortOn: 'score',
  loading: false,
  items: [],
  totalResults: 0,
  serverTagFreq: [],
  serverKeywords: [],
  serverShopIds: [],
  discoveredShops: [],
  shopsLoading: false,
  shopDiscoveryFailed: false,
  deepDiveShopId: '',
  deepDiveShop: null,
  deepDiveListings: [],
  deepDiveLoading: false,
  aiAnalysis: null,
  aiLoading: false,
  nicheAnalysis: null,
  nicheAnalysisLoading: false,
  nicheAiReport: null,
  nicheAiReportLoading: false,
  listingAnalysis: null,
  listingAnalysisLoading: false,
  listingAudit: null,
  listingAuditLoading: false,
  shopSpyReport: null,
  shopSpyReportLoading: false,
  shopReviews: null,
  shopReviewsLoading: false,
  reviewSentiment: null,
  reviewSentimentLoading: false,
  compSort: 'none',
  visibleCount: 20,
  kwExplorerQuery: '',
  kwSuggestions: [],
  kwExplorerLoading: false,
  kwAlphabetSoup: false,
  trendData: null,
  trendLoading: false,
  seasonalData: null,
  seasonalLoading: false,
  trackedKeywords: [],
  rankLoading: false,
  rankKeywordInput: '',
  rankListingId: null,
  rankAddLoading: false,
  expandedRankId: null,
  rankHistory: [],
  savedSearches: [],
  kwShowMissing: false,
  selectedListingId: null,
  pinnedListing: null,
  comparisonVisible: false,
  discoveryData: null,
  discoveryLoading: false,

  // --- Setters ---
  setQuery: (q) => set({ query: q }),
  setMyTitle: (t) => set({ myTitle: t }),
  setMyTags: (t) => set({ myTags: t }),
  setMinPrice: (p) => set({ minPrice: p }),
  setMaxPrice: (p) => set({ maxPrice: p }),
  setSortOn: (s) => set({ sortOn: s }),
  setCompSort: (s) => set({ compSort: s }),
  setVisibleCount: (n) => set({ visibleCount: n }),
  setKwExplorerQuery: (q) => set({ kwExplorerQuery: q }),
  setKwAlphabetSoup: (b) => set({ kwAlphabetSoup: b }),
  setKwShowMissing: (b) => set({ kwShowMissing: b }),
  setDeepDiveShopId: (id) => set({ deepDiveShopId: id }),
  pinListing: (listing) => set({ pinnedListing: listing, comparisonVisible: listing !== null }),
  toggleComparison: () => set((s) => ({ comparisonVisible: !s.comparisonVisible })),
  setSelectedListingId: (id) => set({ selectedListingId: id }),
  setRankKeywordInput: (s) => set({ rankKeywordInput: s }),
  setRankListingId: (id) => set({ rankListingId: id }),
  setExpandedRankId: (id) => set({ expandedRankId: id }),

  // --- Async actions ---
  searchMarket: async () => {
    const { query, sortOn, minPrice, maxPrice } = get();
    if (!query.trim()) return;
    set({ loading: true, visibleCount: 20, compSort: 'none', aiAnalysis: null });
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
      set({
        items: data.items || [],
        totalResults: data.total || 0,
        serverTagFreq: data.tagFrequency || [],
        serverKeywords: data.titleKeywords || [],
        serverShopIds: data.shopIds || [],
      });
      toast.success(`${data.total?.toLocaleString()} sonuc bulundu`);
      if (data.shopIds?.length > 0) get().discoverShops(data.shopIds);
      // Auto-fetch backend niche analysis
      setTimeout(() => get().fetchNicheAnalysis(), 200);
    } catch (err: any) { toast.error(err.message); }
    finally { set({ loading: false }); }
  },

  discoverShops: async (shopIds) => {
    set({ shopsLoading: true });
    try {
      const ids = shopIds.slice(0, 20).join(',');
      const res = await fetch(`/api/clawd/etsy?action=batch_shops&shop_ids=${ids}`);
      if (!res.ok) throw new Error('Magaza bilgileri alinamadi');
      const data = await res.json();
      set({ discoveredShops: data.shops || [], shopDiscoveryFailed: false });
    } catch (err: any) {
      console.error('Shop discovery error:', err);
      toast.error('Mağaza bilgileri alınamadı — tekrar deneyin');
      set({ shopDiscoveryFailed: true });
    } finally { set({ shopsLoading: false }); }
  },

  searchShopDeepDive: async () => {
    const { deepDiveShopId } = get();
    if (!deepDiveShopId.trim()) return;
    set({ deepDiveLoading: true, deepDiveShop: null, deepDiveListings: [], shopSpyReport: null, shopReviews: null, reviewSentiment: null });
    try {
      const [shopRes, listingsRes] = await Promise.all([
        fetch(`/api/clawd/etsy?action=get_public_shop&target_shop_id=${deepDiveShopId.trim()}`),
        fetch(`/api/clawd/etsy?action=get_public_shop_listings&target_shop_id=${deepDiveShopId.trim()}&limit=200`),
      ]);
      if (!shopRes.ok) throw new Error('Magaza bulunamadi');
      const shopData = await shopRes.json();
      set({ deepDiveShop: shopData });
      if (listingsRes.ok) {
        const listData = await listingsRes.json();
        set({ deepDiveListings: listData.listings || [] });
      }
      toast.success(`${shopData.shop_name} - ${shopData.num_sales} satis`);
    } catch (err: any) { toast.error(err.message); }
    finally { set({ deepDiveLoading: false }); }
  },

  generateAiInsights: async () => {
    const { items, query, totalResults, serverTagFreq, serverKeywords, discoveredShops, serverShopIds } = get();
    if (items.length === 0) { toast.error('Oncelikle bir arama yapin'); return; }
    set({ aiLoading: true });
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
      set({ aiAnalysis: data.analysis });
      toast.success('AI analizi tamamlandi');
    } catch (err: any) { toast.error(err.message); }
    finally { set({ aiLoading: false }); }
  },

  fetchNicheAnalysis: async () => {
    const { query, minPrice, maxPrice } = get();
    if (!query.trim()) return;
    set({ nicheAnalysisLoading: true });
    try {
      const params = new URLSearchParams({
        action: 'analyze_niche', keywords: query.trim(), limit: '200',
      });
      if (minPrice) params.set('min_price', minPrice);
      if (maxPrice) params.set('max_price', maxPrice);
      const res = await fetch(`/api/clawd/etsy?${params}`);
      if (!res.ok) throw new Error('Niş analizi başarısız');
      const data = await res.json();
      set({ nicheAnalysis: data });
    } catch (err: any) { toast.error(err.message); }
    finally { set({ nicheAnalysisLoading: false }); }
  },

  fetchNicheAiReport: async () => {
    const { query, nicheAnalysis, serverTagFreq, serverKeywords } = get();
    if (!nicheAnalysis) { toast.error('Önce niş analizi yapın'); return; }
    set({ nicheAiReportLoading: true });
    try {
      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'niche_report',
          query,
          demandScore: nicheAnalysis.demandScore,
          priceStats: nicheAnalysis.priceStats,
          competition: nicheAnalysis.competition,
          velocity: nicheAnalysis.velocity,
          engagement: nicheAnalysis.engagement,
          topTags: serverTagFreq.slice(0, 20),
          topKeywords: serverKeywords.slice(0, 15),
        }),
      });
      if (!res.ok) throw new Error('AI raporu oluşturulamadı');
      const data = await res.json();
      set({ nicheAiReport: data.report });
      toast.success('AI niş raporu hazır');
    } catch (err: any) { toast.error(err.message); }
    finally { set({ nicheAiReportLoading: false }); }
  },

  analyzeShop: async (shopId: string) => {
    set({ deepDiveShopId: shopId });
    // Run deep dive, then auto-chain reviews + AI report
    await get().searchShopDeepDive();
    const { deepDiveShop, deepDiveListings } = get();
    if (deepDiveShop) {
      // Parallel: fetch reviews + AI report
      const reviewsPromise = get().fetchShopReviews();
      const spyPromise = deepDiveListings.length > 0 ? get().fetchShopSpyReport() : Promise.resolve();
      await Promise.all([reviewsPromise, spyPromise]);
      // After reviews load, auto-run sentiment
      if (get().shopReviews?.reviews?.length > 0) {
        get().fetchReviewSentiment();
      }
    }
  },

  fetchShopSpyReport: async () => {
    const { deepDiveShop, deepDiveListings } = get();
    if (!deepDiveShop) { toast.error('Önce bir mağaza analiz edin'); return; }
    set({ shopSpyReportLoading: true });
    try {
      const topListings = [...deepDiveListings]
        .sort((a, b) => b.num_favorers - a.num_favorers)
        .slice(0, 10)
        .map(l => ({ title: l.title, price: l.price, favorites: l.num_favorers }));
      const tagMap: Record<string, number> = {};
      deepDiveListings.forEach(l => {
        (l.tags || []).forEach((t: string) => { tagMap[t.toLowerCase()] = (tagMap[t.toLowerCase()] || 0) + 1; });
      });
      const topTags = Object.entries(tagMap).sort(([, a], [, b]) => b - a).slice(0, 15).map(([tag]) => tag);
      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'shop_spy_report',
          shopName: deepDiveShop.shop_name,
          shopData: {
            sales: deepDiveShop.num_sales, rating: deepDiveShop.review_average,
            reviewCount: deepDiveShop.review_count, listingsCount: deepDiveShop.listing_active_count,
          },
          topListings, topTags,
        }),
      });
      if (!res.ok) throw new Error('AI mağaza raporu oluşturulamadı');
      const data = await res.json();
      set({ shopSpyReport: data.report });
      toast.success('AI mağaza raporu hazır');
    } catch (err: any) { toast.error(err.message); }
    finally { set({ shopSpyReportLoading: false }); }
  },

  fetchShopReviews: async () => {
    const { deepDiveShopId } = get();
    if (!deepDiveShopId.trim()) return;
    set({ shopReviewsLoading: true, shopReviews: null, reviewSentiment: null });
    try {
      const res = await fetch(`/api/clawd/etsy?action=get_shop_reviews&shop_id=${deepDiveShopId.trim()}&limit=50`);
      if (!res.ok) throw new Error('Yorumlar alınamadı');
      const data = await res.json();
      set({ shopReviews: data });
      toast.success(`${data.reviews?.length || 0} yorum yüklendi`);
    } catch (err: any) { toast.error(err.message); }
    finally { set({ shopReviewsLoading: false }); }
  },

  fetchReviewSentiment: async () => {
    const { deepDiveShop, shopReviews } = get();
    if (!shopReviews?.reviews?.length) { toast.error('Önce yorumları yükleyin'); return; }
    set({ reviewSentimentLoading: true });
    try {
      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'review_sentiment',
          shopName: deepDiveShop?.shop_name || 'Unknown',
          reviews: shopReviews.reviews.slice(0, 30).map((r: any) => ({
            rating: r.rating, review: r.review, created_timestamp: r.created_timestamp,
          })),
        }),
      });
      if (!res.ok) throw new Error('Duygu analizi başarısız');
      const data = await res.json();
      set({ reviewSentiment: data.report });
      toast.success('Yorum duygu analizi hazır');
    } catch (err: any) { toast.error(err.message); }
    finally { set({ reviewSentimentLoading: false }); }
  },

  fetchListingAnalysis: async (listingId: string) => {
    if (!listingId.trim()) return;
    set({ listingAnalysisLoading: true, listingAnalysis: null, listingAudit: null });
    try {
      const res = await fetch(`/api/clawd/etsy?action=analyze_listing_url&listing_id=${listingId.trim()}`);
      if (!res.ok) throw new Error('Listing analizi başarısız');
      const data = await res.json();
      set({ listingAnalysis: data });
      toast.success('Listing analizi tamamlandı');
    } catch (err: any) { toast.error(err.message); }
    finally { set({ listingAnalysisLoading: false }); }
  },

  fetchListingAudit: async () => {
    const { listingAnalysis } = get();
    if (!listingAnalysis?.listing) { toast.error('Önce bir listing analiz edin'); return; }
    set({ listingAuditLoading: true });
    try {
      const l = listingAnalysis.listing;
      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'listing_audit',
          title: l.title,
          description: (l.description || '').slice(0, 500),
          tags: l.tags,
          price: l.price?.amount ? (l.price.amount / l.price.divisor) : 0,
          favorites: l.num_favorers,
          views: l.views,
          imageCount: l.images?.length || 0,
          seoScore: listingAnalysis.seoScore?.total,
          marketAvgPrice: null,
          marketAvgFavorites: null,
        }),
      });
      if (!res.ok) throw new Error('AI listing denetimi başarısız');
      const data = await res.json();
      set({ listingAudit: data.report });
      toast.success('AI listing denetimi hazır');
    } catch (err: any) { toast.error(err.message); }
    finally { set({ listingAuditLoading: false }); }
  },

  searchKeywords: async () => {
    const { kwExplorerQuery, query, kwAlphabetSoup } = get();
    const kw = kwExplorerQuery.trim() || query.trim();
    if (!kw) { toast.error('Anahtar kelime girin'); return; }
    set({ kwExplorerLoading: true });
    try {
      const params = new URLSearchParams({
        action: 'autocomplete', keyword: kw,
        ...(kwAlphabetSoup ? { alphabet: 'true' } : {}),
      });
      const res = await fetch(`/api/trends/etsy?${params}`);
      if (!res.ok) throw new Error('Anahtar kelime onerisi basarisiz');
      const data = await res.json();
      set({ kwSuggestions: data.suggestions || [] });
      toast.success(`${data.totalFound} oneri bulundu`);
    } catch (err: any) { toast.error(err.message); }
    finally { set({ kwExplorerLoading: false }); }
  },

  fetchTrends: async () => {
    const { query, kwExplorerQuery } = get();
    const kw = query.trim() || kwExplorerQuery.trim();
    if (!kw) { toast.error('Önce bir anahtar kelime girin'); return; }
    set({ trendLoading: true, seasonalLoading: true });
    try {
      const [trendRes, seasonalRes] = await Promise.all([
        fetch(`/api/trends/etsy?action=google_trends&keyword=${encodeURIComponent(kw)}`),
        fetch(`/api/trends/etsy?action=seasonal_trends&keyword=${encodeURIComponent(kw)}`),
      ]);
      if (trendRes.ok) {
        const data = await trendRes.json();
        set({ trendData: data });
      }
      if (seasonalRes.ok) {
        const data = await seasonalRes.json();
        set({ seasonalData: data });
      }
      toast.success('Trend verileri yuklendi');
    } catch (err: any) { toast.error(err.message); }
    finally { set({ trendLoading: false, seasonalLoading: false }); }
  },

  fetchTrackedKeywords: async (shopId) => {
    if (!shopId) return;
    set({ rankLoading: true });
    try {
      const res = await fetch(`/api/clawd/etsy?action=get_tracked_keywords&shop_id=${shopId}`);
      if (!res.ok) throw new Error('Takip edilen kelimeler alinamadi');
      const data = await res.json();
      set({ trackedKeywords: data.keywords || [] });
    } catch (err: any) { toast.error(err.message); }
    finally { set({ rankLoading: false }); }
  },

  addTrackedKeyword: async (shopId, userListings) => {
    const { rankKeywordInput, rankListingId } = get();
    if (!rankKeywordInput.trim() || !rankListingId || !shopId) return;
    set({ rankAddLoading: true });
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
        throw new Error(err.error || 'Eklenemedi');
      }
      const data = await res.json();
      toast.success(
        data.rank != null
          ? `"${rankKeywordInput}" icin #${data.rank} sirada (Sayfa ${data.page})`
          : `"${rankKeywordInput}" icin ilk 500'de bulunamadi`
      );
      set({ rankKeywordInput: '' });
      get().fetchTrackedKeywords(shopId);
    } catch (err: any) { toast.error(err.message); }
    finally { set({ rankAddLoading: false }); }
  },

  removeTrackedKeyword: async (keywordId, shopId) => {
    try {
      await fetch(`/api/clawd/etsy?action=remove_tracked_keyword&keyword_id=${keywordId}&shop_id=${shopId}`, {
        method: 'DELETE',
      });
      set(state => ({ trackedKeywords: state.trackedKeywords.filter(k => k.id !== keywordId) }));
      toast.success('Takipten kaldirildi');
    } catch { toast.error('Silinemedi'); }
  },

  fetchRankHistory: async (keywordId, shopId) => {
    const { expandedRankId } = get();
    if (expandedRankId === keywordId) { set({ expandedRankId: null }); return; }
    set({ expandedRankId: keywordId });
    try {
      const res = await fetch(`/api/clawd/etsy?action=get_rank_history&keyword_id=${keywordId}&shop_id=${shopId}`);
      if (!res.ok) throw new Error('Gecmis alinamadi');
      const data = await res.json();
      set({ rankHistory: data.snapshots || [] });
    } catch { set({ rankHistory: [] }); }
  },

  exportCSV: () => {
    const { items, query } = get();
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
  },

  saveSearch: () => {
    const { query, minPrice, maxPrice, sortOn, myTitle, myTags, savedSearches } = get();
    const entry: SavedSearch = { query, minPrice, maxPrice, sortOn, myTitle, myTags, timestamp: Date.now() };
    const updated = [entry, ...savedSearches.filter(s => s.query !== query)].slice(0, 20);
    saveSavedSearches(updated);
    set({ savedSearches: updated });
    toast.success('Arama kaydedildi');
  },

  loadSearch: (s) => {
    set({
      query: s.query, minPrice: s.minPrice, maxPrice: s.maxPrice,
      sortOn: s.sortOn, myTitle: s.myTitle, myTags: s.myTags,
    });
  },

  deleteSaved: (idx) => {
    const { savedSearches } = get();
    const updated = savedSearches.filter((_, i) => i !== idx);
    saveSavedSearches(updated);
    set({ savedSearches: updated });
  },

  initSavedSearches: () => {
    set({ savedSearches: loadSavedSearches() });
  },

  fetchDiscoveryData: async () => {
    if (get().discoveryData || get().discoveryLoading) return;
    set({ discoveryLoading: true });
    try {
      const res = await fetch('/api/clawd/etsy?action=get_discovery_data');
      if (!res.ok) throw new Error('Discovery fetch failed');
      const data = await res.json();
      set({ discoveryData: data });
    } catch (err) {
      console.error('[Discovery]', err);
    } finally {
      set({ discoveryLoading: false });
    }
  },
}));

// --- Selector hooks (computed values) ---

export function useComputedPrices() {
  const items = useEtsyResearchStore(s => s.items);
  const prices = items.map(i => i.price).filter(p => p > 0).sort((a, b) => a - b);

  const priceStats: PriceStats | null = prices.length === 0 ? null : (() => {
    const sum = prices.reduce((a, b) => a + b, 0);
    const mid = Math.floor(prices.length / 2);
    return {
      min: prices[0], max: prices[prices.length - 1],
      avg: Math.round((sum / prices.length) * 100) / 100,
      median: prices.length % 2 === 0 ? Math.round(((prices[mid - 1] + prices[mid]) / 2) * 100) / 100 : prices[mid],
      count: prices.length,
    };
  })();

  const histogram: HistogramBucket[] = prices.length === 0 ? [] : (() => {
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
  })();

  const maxBucketCount = Math.max(...histogram.map(b => b.count), 1);

  const priceRangeBreakdown = PRICE_RANGES.map(r => {
    const count = prices.filter(p => p >= r.min && p < r.max).length;
    return { ...r, count, pct: prices.length ? (count / prices.length) * 100 : 0 };
  });

  const sweetSpot: SweetSpot | null = items.length < 5 ? null : (() => {
    const ranges = PRICE_RANGES.map(r => {
      const inRange = items.filter(i => i.price >= r.min && i.price < r.max);
      if (inRange.length === 0) return { ...r, avgFav: 0, count: 0 };
      const avgFav = inRange.reduce((s, i) => s + i.num_favorers, 0) / inRange.length;
      return { ...r, avgFav: Math.round(avgFav), count: inRange.length };
    }).filter(r => r.count >= 2);
    if (ranges.length === 0) return null;
    return ranges.sort((a, b) => b.avgFav - a.avgFav)[0];
  })();

  return { prices, priceStats, histogram, maxBucketCount, priceRangeBreakdown, sweetSpot };
}

export function useComputedKeywords() {
  const items = useEtsyResearchStore(s => s.items);
  const serverKeywords = useEtsyResearchStore(s => s.serverKeywords);
  const myTitle = useEtsyResearchStore(s => s.myTitle);

  const allTitles = items.map(i => i.title);
  const myTitleWords = new Set(extractWords(myTitle));

  const enrichedKeywords: EnrichedKeyword[] = serverKeywords.length > 0
    ? serverKeywords.map(k => ({ ...k, inMyTitle: myTitleWords.has(k.keyword) }))
    : (() => {
        const wordFreq: Record<string, number> = {};
        allTitles.forEach(title => { extractWords(title).forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; }); });
        return Object.entries(wordFreq)
          .sort(([, a], [, b]) => b - a).slice(0, 50)
          .map(([keyword, count]) => ({
            keyword, count, pct: Math.round((count / Math.max(allTitles.length, 1)) * 100),
            inMyTitle: myTitleWords.has(keyword),
          }));
      })();

  const bigrams = extractNgrams(allTitles, 2);
  const trigrams = extractNgrams(allTitles, 3);

  return { allTitles, myTitleWords, enrichedKeywords, bigrams, trigrams };
}

export function useComputedTags(userListings?: any[]) {
  const serverTagFreq = useEtsyResearchStore(s => s.serverTagFreq);
  const myTags = useEtsyResearchStore(s => s.myTags);
  const items = useEtsyResearchStore(s => s.items);

  const myTagsSet = (() => {
    const tags = myTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (userListings?.length) {
      userListings.forEach(l => { (l.tags || []).forEach((t: string) => tags.push(t.toLowerCase().trim())); });
    }
    return new Set(tags);
  })();

  const enrichedTags: EnrichedTag[] = serverTagFreq.map(t => ({ ...t, inMyTags: myTagsSet.has(t.tag) }));
  const tagGaps = enrichedTags.filter(t => !t.inMyTags && t.pct >= 5);

  const tagCombos: TagCombo[] = items.length === 0 ? [] : (() => {
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
  })();

  return { myTagsSet, enrichedTags, tagGaps, tagCombos };
}

export function useComputedDemandScore() {
  const items = useEtsyResearchStore(s => s.items);
  const totalResults = useEtsyResearchStore(s => s.totalResults);
  const { priceStats } = useComputedPrices();

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
  } as DemandScore;
}

export function useComputedShopStats() {
  const discoveredShops = useEtsyResearchStore(s => s.discoveredShops);
  const items = useEtsyResearchStore(s => s.items);

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

  return { shops, totalSales, avgRating: Math.round(avgRating * 100) / 100, top5Sales: top5ActiveListings, totalListings: totalActiveListings } as ShopStats;
}

export function useComputedDeepDive() {
  const deepDiveListings = useEtsyResearchStore(s => s.deepDiveListings);

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
  } as DeepDiveStats;
}

export function useComputedSeo(userListings?: any[]) {
  const myTitle = useEtsyResearchStore(s => s.myTitle);
  const items = useEtsyResearchStore(s => s.items);
  const { enrichedKeywords, myTitleWords, allTitles } = useComputedKeywords();
  const { myTagsSet, enrichedTags, tagGaps } = useComputedTags(userListings);

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
  } as SeoResult;
}
