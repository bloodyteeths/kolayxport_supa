import { create } from 'zustand';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmazonProductItem {
  asin: string;
  title: string;
  imageUrl: string | null;
  price: number | null;
  currency: string;
  salesRank: number | null;
  reviewCount: number | null;
  rating: number | null;
  categoryId: string | null;
  categoryName: string | null;
  seller: string | null;
  isPrime: boolean;
  url: string | null;
  salesEstimate: {
    monthlySales: number;
    monthlyRevenue: number | null;
    confidence: string;
    categoryName: string;
    bsr: number;
  } | null;
}

export interface MarketStats {
  avgPrice: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  avgBsr: number;
  avgReviews: number;
  avgRating: number;
}

export interface OpportunityScore {
  score: number;
  label: string;
  demand: { score: number; label: string };
  competition: { score: number; label: string };
}

export interface NicheData {
  query: string;
  category: string;
  marketplace: string;
  totalResults: number;
  items: AmazonProductItem[];
  stats: MarketStats;
  demand: { score: number; label: string };
  competition: { score: number; label: string };
  opportunity: OpportunityScore;
  priceDistribution: { range: string; count: number }[];
  sellerAnalysis: { uniqueSellers: number; topSellers: { seller: string; listings: number }[] };
  feeEstimate: any;
}

export interface TrackedProduct {
  id: string;
  asin: string;
  title: string | null;
  imageUrl: string | null;
  currentPrice: number | null;
  currency: string;
  currentRank: number | null;
  reviewCount: number | null;
  rating: number | null;
  notes: string | null;
  tags: string[];
  lastCheckedAt: string | null;
  snapshots: any[];
}

export interface SavedNiche {
  id: string;
  query: string;
  categoryName: string | null;
  marketplace: string;
  demandScore: number | null;
  competitionScore: number | null;
  avgPrice: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AmazonResearchState {
  // Search
  query: string;
  marketplace: string;
  loading: boolean;
  items: AmazonProductItem[];
  totalResults: number;
  stats: MarketStats | null;
  opportunity: OpportunityScore | null;
  topKeywords: { keyword: string; count: number; pct: number }[];

  // Niche analysis
  nicheData: NicheData | null;
  nicheLoading: boolean;

  // AI
  aiInsights: any | null;
  aiLoading: boolean;
  nicheReport: any | null;
  nicheReportLoading: boolean;

  // Keyword explorer
  kwQuery: string;
  kwSuggestions: string[];
  kwLoading: boolean;
  kwAlphabetSoup: boolean;
  kwRelated: { keywords: string[]; topWords: { word: string; count: number }[] } | null;
  kwRelatedLoading: boolean;
  kwClusters: any | null;
  kwClustersLoading: boolean;

  // Product details
  selectedProduct: any | null;
  productLoading: boolean;

  // Tracking
  trackedProducts: TrackedProduct[];
  trackedLoading: boolean;
  savedNiches: SavedNiche[];

  // Active view
  activeView: 'research' | 'keywords' | 'competitors';

  // Actions
  setQuery: (q: string) => void;
  setMarketplace: (m: string) => void;
  setActiveView: (v: 'research' | 'keywords' | 'competitors') => void;
  setKwQuery: (q: string) => void;
  setKwAlphabetSoup: (v: boolean) => void;

  searchProducts: () => Promise<void>;
  analyzeNiche: () => Promise<void>;
  getProduct: (asin: string) => Promise<void>;
  generateAiInsights: () => Promise<void>;
  fetchNicheReport: () => Promise<void>;

  searchKeywords: () => Promise<void>;
  fetchRelatedKeywords: () => Promise<void>;
  fetchKeywordClusters: () => Promise<void>;

  trackProduct: (product: AmazonProductItem) => Promise<void>;
  untrackProduct: (productId: string) => Promise<void>;
  fetchTrackedProducts: () => Promise<void>;
  refreshTracked: () => Promise<void>;

  saveNiche: (notes?: string) => Promise<void>;
  fetchSavedNiches: () => Promise<void>;
  deleteNiche: (nicheId: string) => Promise<void>;

  // Fee calculator
  calculateFees: (price: number, category: string, cogs?: number) => Promise<any>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAmazonResearchStore = create<AmazonResearchState>((set, get) => ({
  // Initial state
  query: '',
  marketplace: 'US',
  loading: false,
  items: [],
  totalResults: 0,
  stats: null,
  opportunity: null,
  topKeywords: [],

  nicheData: null,
  nicheLoading: false,

  aiInsights: null,
  aiLoading: false,
  nicheReport: null,
  nicheReportLoading: false,

  kwQuery: '',
  kwSuggestions: [],
  kwLoading: false,
  kwAlphabetSoup: false,
  kwRelated: null,
  kwRelatedLoading: false,
  kwClusters: null,
  kwClustersLoading: false,

  selectedProduct: null,
  productLoading: false,

  trackedProducts: [],
  trackedLoading: false,
  savedNiches: [],

  activeView: 'research',

  // Setters
  setQuery: (q) => set({ query: q }),
  setMarketplace: (m) => set({ marketplace: m }),
  setActiveView: (v) => set({ activeView: v }),
  setKwQuery: (q) => set({ kwQuery: q }),
  setKwAlphabetSoup: (v) => set({ kwAlphabetSoup: v }),

  // -------------------------------------------------------------------
  // Product search
  // -------------------------------------------------------------------
  searchProducts: async () => {
    const { query, marketplace } = get();
    if (!query.trim()) return;

    set({ loading: true, items: [], stats: null, opportunity: null, topKeywords: [] });

    try {
      const params = new URLSearchParams({
        action: 'search_products',
        q: query,
        marketplace,
      });
      const res = await fetch(`/api/clawd/amazon-research?${params}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Search failed');

      set({
        items: data.items || [],
        totalResults: data.totalResults || 0,
        stats: data.stats || null,
        opportunity: data.opportunity || null,
        topKeywords: data.topKeywords || [],
      });
    } catch (err: any) {
      toast.error(err.message || 'Search failed');
    } finally {
      set({ loading: false });
    }
  },

  // -------------------------------------------------------------------
  // Niche analysis
  // -------------------------------------------------------------------
  analyzeNiche: async () => {
    const { query, marketplace } = get();
    if (!query.trim()) return;

    set({ nicheLoading: true, nicheData: null });

    try {
      const params = new URLSearchParams({
        action: 'niche_analyze',
        q: query,
        marketplace,
      });
      const res = await fetch(`/api/clawd/amazon-research?${params}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Niche analysis failed');

      set({ nicheData: data });
    } catch (err: any) {
      toast.error(err.message || 'Niche analysis failed');
    } finally {
      set({ nicheLoading: false });
    }
  },

  // -------------------------------------------------------------------
  // Product details
  // -------------------------------------------------------------------
  getProduct: async (asin: string) => {
    set({ productLoading: true, selectedProduct: null });

    try {
      const { marketplace } = get();
      const params = new URLSearchParams({
        action: 'get_product',
        asin,
        marketplace,
      });
      const res = await fetch(`/api/clawd/amazon-research?${params}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Product lookup failed');

      set({ selectedProduct: data });
    } catch (err: any) {
      toast.error(err.message || 'Product lookup failed');
    } finally {
      set({ productLoading: false });
    }
  },

  // -------------------------------------------------------------------
  // AI insights
  // -------------------------------------------------------------------
  generateAiInsights: async () => {
    const { query, stats, opportunity, topKeywords, totalResults } = get();
    if (!query) return;

    set({ aiLoading: true, aiInsights: null });

    try {
      const res = await fetch('/api/ai/amazon?action=market_analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          marketData: { query, stats, opportunity, topKeywords, totalResults },
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'AI analysis failed');

      set({ aiInsights: data });
    } catch (err: any) {
      toast.error(err.message || 'AI analysis failed');
    } finally {
      set({ aiLoading: false });
    }
  },

  fetchNicheReport: async () => {
    const { query, nicheData } = get();
    if (!query) return;

    set({ nicheReportLoading: true, nicheReport: null });

    try {
      const res = await fetch('/api/ai/amazon?action=niche_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          marketData: nicheData || { query },
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Niche report failed');

      set({ nicheReport: data });
    } catch (err: any) {
      toast.error(err.message || 'Niche report failed');
    } finally {
      set({ nicheReportLoading: false });
    }
  },

  // -------------------------------------------------------------------
  // Keyword explorer
  // -------------------------------------------------------------------
  searchKeywords: async () => {
    const { kwQuery, marketplace, kwAlphabetSoup } = get();
    if (!kwQuery.trim()) return;

    set({ kwLoading: true, kwSuggestions: [] });

    try {
      const action = kwAlphabetSoup ? 'alphabet_soup' : 'autocomplete';
      const params = new URLSearchParams({
        action,
        q: kwQuery,
        marketplace,
      });
      const res = await fetch(`/api/trends/amazon?${params}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Keyword search failed');

      set({ kwSuggestions: data.suggestions || [] });
    } catch (err: any) {
      toast.error(err.message || 'Keyword search failed');
    } finally {
      set({ kwLoading: false });
    }
  },

  fetchRelatedKeywords: async () => {
    const { kwQuery, marketplace } = get();
    if (!kwQuery.trim()) return;

    set({ kwRelatedLoading: true, kwRelated: null });

    try {
      const params = new URLSearchParams({
        action: 'related_keywords',
        q: kwQuery,
        marketplace,
      });
      const res = await fetch(`/api/trends/amazon?${params}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Related keywords failed');

      set({ kwRelated: { keywords: data.keywords || [], topWords: data.topWords || [] } });
    } catch (err: any) {
      toast.error(err.message || 'Related keywords failed');
    } finally {
      set({ kwRelatedLoading: false });
    }
  },

  fetchKeywordClusters: async () => {
    const { kwQuery, kwSuggestions } = get();
    if (!kwSuggestions.length) return;

    set({ kwClustersLoading: true, kwClusters: null });

    try {
      const res = await fetch('/api/ai/amazon?action=keyword_clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: kwQuery,
          keywords: kwSuggestions.slice(0, 100),
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Clustering failed');

      set({ kwClusters: data });
    } catch (err: any) {
      toast.error(err.message || 'Clustering failed');
    } finally {
      set({ kwClustersLoading: false });
    }
  },

  // -------------------------------------------------------------------
  // Product tracking
  // -------------------------------------------------------------------
  trackProduct: async (product: AmazonProductItem) => {
    try {
      const res = await fetch('/api/clawd/amazon-research?action=track_product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: product.asin,
          title: product.title,
          imageUrl: product.imageUrl,
          categoryId: product.categoryId,
          categoryName: product.categoryName,
          seller: product.seller,
          price: product.price,
          currency: product.currency,
          salesRank: product.salesRank,
          reviewCount: product.reviewCount,
          rating: product.rating,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Product tracked');
      get().fetchTrackedProducts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to track product');
    }
  },

  untrackProduct: async (productId: string) => {
    try {
      const res = await fetch('/api/clawd/amazon-research?action=untrack_product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Product untracked');
      set((s) => ({
        trackedProducts: s.trackedProducts.filter((p) => p.id !== productId),
      }));
    } catch (err: any) {
      toast.error(err.message || 'Failed to untrack');
    }
  },

  fetchTrackedProducts: async () => {
    set({ trackedLoading: true });
    try {
      const res = await fetch('/api/clawd/amazon-research?action=tracked_products');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      set({ trackedProducts: data.products || [] });
    } catch {
      // Silent fail
    } finally {
      set({ trackedLoading: false });
    }
  },

  refreshTracked: async () => {
    set({ trackedLoading: true });
    try {
      const res = await fetch('/api/clawd/amazon-research?action=refresh_tracked', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Refreshed ${data.refreshed}/${data.total} products`);
      get().fetchTrackedProducts();
    } catch (err: any) {
      toast.error(err.message || 'Refresh failed');
    } finally {
      set({ trackedLoading: false });
    }
  },

  // -------------------------------------------------------------------
  // Niche saving
  // -------------------------------------------------------------------
  saveNiche: async (notes?: string) => {
    const { query, nicheData, marketplace } = get();
    if (!query || !nicheData) return;

    try {
      const res = await fetch('/api/clawd/amazon-research?action=save_niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          categoryId: nicheData.items[0]?.categoryId,
          categoryName: nicheData.items[0]?.categoryName,
          marketplace,
          totalResults: nicheData.totalResults,
          avgPrice: nicheData.stats.avgPrice,
          medianPrice: nicheData.stats.medianPrice,
          avgReviews: nicheData.stats.avgReviews,
          avgRating: nicheData.stats.avgRating,
          demandScore: nicheData.demand.score,
          competitionScore: nicheData.competition.score,
          notes,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Niche saved');
      get().fetchSavedNiches();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save niche');
    }
  },

  fetchSavedNiches: async () => {
    try {
      const res = await fetch('/api/clawd/amazon-research?action=saved_niches');
      const data = await res.json();
      set({ savedNiches: data.niches || [] });
    } catch {
      // Silent fail
    }
  },

  deleteNiche: async (nicheId: string) => {
    try {
      const res = await fetch('/api/clawd/amazon-research?action=delete_niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nicheId }),
      });
      if (!res.ok) throw new Error('Failed');
      set((s) => ({ savedNiches: s.savedNiches.filter((n) => n.id !== nicheId) }));
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    }
  },

  // -------------------------------------------------------------------
  // Fee calculator
  // -------------------------------------------------------------------
  calculateFees: async (price: number, category: string, cogs?: number) => {
    const params = new URLSearchParams({
      action: 'calculate_fees',
      price: String(price),
      category,
    });
    if (cogs != null) params.set('cogs', String(cogs));

    const res = await fetch(`/api/clawd/amazon-research?${params}`);
    return res.json();
  },
}));
