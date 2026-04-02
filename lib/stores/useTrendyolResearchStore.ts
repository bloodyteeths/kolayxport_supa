import { create } from 'zustand';
import { toast } from 'react-hot-toast';
import type { TrendyolProduct } from '../arbitrage/types';

// ================================================================
// TYPES
// ================================================================

export interface FlatCategory {
  id: number;
  name: string;
  slug: string;
  parentId?: number;
  parentPath: string;
  depth: number;
}

interface PriceStats {
  min: number;
  max: number;
  avg: number;
  median: number;
  p25: number;
  p75: number;
}

interface HistogramBucket {
  range: string;
  min: number;
  max: number;
  count: number;
}

interface BrandData {
  name: string;
  count: number;
  avgPrice: number;
}

interface MerchantData {
  id: number;
  count: number;
  avgPrice: number;
  avgRating: number;
}

interface SocialProofSummary {
  withFavorites: number;
  withOrders: number;
  withViews: number;
}

interface ProductAnalysis {
  priceStats: PriceStats;
  priceHistogram: HistogramBucket[];
  uniqueMerchants: number;
  uniqueBrands: number;
  freeShippingPct: number;
  avgRating: number;
  avgDiscount: number;
  topBrands: BrandData[];
  topMerchants: MerchantData[];
  socialProofSummary: SocialProofSummary;
  badgeDistribution: Record<string, number>;
}

interface SavedCategorySearch {
  slug: string;
  label: string;
  group: string;
  timestamp: number;
  productCount: number;
}

// ================================================================
// STATE
// ================================================================

interface TrendyolResearchState {
  // Category browsing
  selectedSlug: string;
  selectedLabel: string;
  products: TrendyolProduct[];
  totalCount: number;
  loading: boolean;
  currentPage: number;

  // Category tree
  categoryTree: FlatCategory[];
  categoryTreeLoading: boolean;
  categorySearchQuery: string;
  selectedTopLevel: string;

  // Analysis
  analysis: ProductAnalysis | null;

  // AI Report
  aiReport: string | null;
  aiReportLoading: boolean;

  // Saved searches
  savedSearches: SavedCategorySearch[];

  // Sort/filter
  sortBy: 'price_asc' | 'price_desc' | 'rating' | 'favorites' | 'orders' | 'default';
  brandFilter: string;

  // Actions
  browseCategory: (slug: string, label: string, page?: number) => Promise<void>;
  loadMorePages: (maxPages?: number) => Promise<void>;
  generateAiReport: (categoryName: string) => Promise<void>;
  saveCategorySearch: () => void;
  removeSavedSearch: (slug: string) => void;
  loadSavedSearches: () => void;
  setSortBy: (sort: TrendyolResearchState['sortBy']) => void;
  setBrandFilter: (brand: string) => void;
  fetchCategoryTree: () => Promise<void>;
  searchCategories: (query: string) => Promise<void>;
  setSelectedTopLevel: (topLevel: string) => void;
  setCategorySearchQuery: (query: string) => void;
  reset: () => void;
}

// ================================================================
// STORE
// ================================================================

const SAVED_SEARCHES_KEY = 'trendyol-research-saved';

export const useTrendyolResearchStore = create<TrendyolResearchState>((set, get) => ({
  selectedSlug: '',
  selectedLabel: '',
  products: [],
  totalCount: 0,
  loading: false,
  currentPage: 1,
  categoryTree: [],
  categoryTreeLoading: false,
  categorySearchQuery: '',
  selectedTopLevel: '',
  analysis: null,
  aiReport: null,
  aiReportLoading: false,
  savedSearches: [],
  sortBy: 'default',
  brandFilter: '',

  fetchCategoryTree: async () => {
    const state = get();
    if (state.categoryTree.length > 0) return; // already loaded
    set({ categoryTreeLoading: true });
    try {
      const res = await fetch('/api/trendyol/research?action=category_tree');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ categoryTree: data.categories || [], categoryTreeLoading: false });
    } catch (err: any) {
      toast.error('Kategori ağacı yüklenemedi');
      set({ categoryTreeLoading: false });
    }
  },

  searchCategories: async (query: string) => {
    set({ categorySearchQuery: query });
    if (!query.trim()) return;
    try {
      const res = await fetch(`/api/trendyol/research?action=category_tree&q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ categoryTree: data.categories || [] });
    } catch {}
  },

  setSelectedTopLevel: (topLevel: string) => set({ selectedTopLevel: topLevel }),
  setCategorySearchQuery: (query: string) => set({ categorySearchQuery: query }),

  browseCategory: async (slug, label, page = 1) => {
    set({ loading: true, selectedSlug: slug, selectedLabel: label, currentPage: page });

    try {
      const res = await fetch(`/api/trendyol/research?action=category_products&slug=${encodeURIComponent(slug)}&page=${page}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (page === 1) {
        set({
          products: data.products,
          totalCount: data.totalCount,
          analysis: data.analysis,
          loading: false,
        });
      } else {
        // Append for pagination
        const existing = get().products;
        const existingIds = new Set(existing.map((p: TrendyolProduct) => p.id));
        const newProducts = data.products.filter((p: TrendyolProduct) => !existingIds.has(p.id));
        const allProducts = [...existing, ...newProducts];

        set({
          products: allProducts,
          totalCount: allProducts.length,
          loading: false,
        });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to fetch category products');
      set({ loading: false });
    }
  },

  loadMorePages: async (maxPages = 5) => {
    const { selectedSlug, selectedLabel, currentPage } = get();
    if (!selectedSlug) return;

    for (let p = currentPage + 1; p <= currentPage + maxPages; p++) {
      await get().browseCategory(selectedSlug, selectedLabel, p);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }
    set({ currentPage: currentPage + maxPages });
  },

  generateAiReport: async (categoryName) => {
    const { products } = get();
    if (products.length === 0) return;

    set({ aiReportLoading: true });

    try {
      const res = await fetch('/api/trendyol/research?action=ai_market_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products, categoryName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ aiReport: data.report, aiReportLoading: false });
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate AI report');
      set({ aiReportLoading: false });
    }
  },

  saveCategorySearch: () => {
    const { selectedSlug, selectedLabel, totalCount, savedSearches } = get();
    if (!selectedSlug) return;

    // Find group from slug
    const group = selectedSlug.split('-x-c')[0].replace(/-/g, ' ');
    const search: SavedCategorySearch = {
      slug: selectedSlug,
      label: selectedLabel || group,
      group,
      timestamp: Date.now(),
      productCount: totalCount,
    };

    const updated = [search, ...savedSearches.filter(s => s.slug !== selectedSlug)].slice(0, 20);
    set({ savedSearches: updated });
    try { localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(updated)); } catch {}
    toast.success('Kategori kaydedildi');
  },

  removeSavedSearch: (slug) => {
    const updated = get().savedSearches.filter(s => s.slug !== slug);
    set({ savedSearches: updated });
    try { localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(updated)); } catch {}
  },

  loadSavedSearches: () => {
    try {
      const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
      if (raw) set({ savedSearches: JSON.parse(raw) });
    } catch {}
  },

  setSortBy: (sortBy) => set({ sortBy }),
  setBrandFilter: (brandFilter) => set({ brandFilter }),

  reset: () => set({
    selectedSlug: '',
    selectedLabel: '',
    products: [],
    totalCount: 0,
    analysis: null,
    aiReport: null,
    currentPage: 1,
    sortBy: 'default',
    brandFilter: '',
  }),
}));

// ================================================================
// SELECTORS (computed from products)
// ================================================================

export function useSortedProducts(): TrendyolProduct[] {
  const { products, sortBy, brandFilter } = useTrendyolResearchStore();

  let filtered = brandFilter
    ? products.filter(p => p.brand === brandFilter)
    : products;

  switch (sortBy) {
    case 'price_asc':
      return [...filtered].sort((a, b) => a.priceTry - b.priceTry);
    case 'price_desc':
      return [...filtered].sort((a, b) => b.priceTry - a.priceTry);
    case 'rating':
      return [...filtered].sort((a, b) => b.ratingScore - a.ratingScore);
    case 'favorites':
      return [...filtered].sort((a, b) =>
        parseSocialProof(b.favoriteCount) - parseSocialProof(a.favoriteCount)
      );
    case 'orders':
      return [...filtered].sort((a, b) =>
        parseSocialProof(b.orderCount) - parseSocialProof(a.orderCount)
      );
    default:
      return filtered;
  }
}

/**
 * Parse social proof strings like "31K", "200+", "1K" into approximate numbers.
 */
function parseSocialProof(value?: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/[+,]/g, '').trim();
  if (cleaned.endsWith('K')) return parseFloat(cleaned) * 1000;
  if (cleaned.endsWith('M')) return parseFloat(cleaned) * 1000000;
  return parseInt(cleaned) || 0;
}
