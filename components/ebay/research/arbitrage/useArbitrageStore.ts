import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ArbitrageResult, ArbitrageScanResponse, ArbitrageScanJobStatus } from '../../../../lib/arbitrage/types';

interface SavedScan {
  id: string;
  label: string;
  date: string;
  categories: string[];
  resultsCount: number;
  profitableCount: number;
  bestProfit: number;
  bestRoi: number;
}

interface ArbitrageStore {
  // Scan params
  selectedCategories: string[];
  shippingCost: number;
  minProfit: number;
  minRoi: number;
  maxResults: number;
  includeInternational: boolean;
  highDefectRate: boolean;
  feeOverride: string;
  exchangeRateOverride: string;

  // Results
  scanResponse: ArbitrageScanResponse | null;
  loading: boolean;
  scanProgress: { current: number; total: number; phase: string } | null;
  jobId: string | null;

  // UI state
  filterVerdict: string;
  sortField: 'score' | 'profitUsd' | 'roiPercent' | 'costUsd' | 'suggestedPriceUsd';
  sortDirection: 'asc' | 'desc';
  selectedProductIdx: number | null;
  activeTab: number;
  searchText: string;

  // Saved scans
  savedScans: SavedScan[];

  // Actions
  setSelectedCategories: (cats: string[]) => void;
  toggleCategory: (slug: string) => void;
  setShippingCost: (val: number) => void;
  setMinProfit: (val: number) => void;
  setMinRoi: (val: number) => void;
  setMaxResults: (val: number) => void;
  setIncludeInternational: (val: boolean) => void;
  setHighDefectRate: (val: boolean) => void;
  setFeeOverride: (val: string) => void;
  setExchangeRateOverride: (val: string) => void;
  setFilterVerdict: (val: string) => void;
  setSortField: (val: ArbitrageStore['sortField']) => void;
  toggleSortDirection: () => void;
  setSelectedProductIdx: (idx: number | null) => void;
  setActiveTab: (tab: number) => void;
  setSearchText: (text: string) => void;
  setScanResponse: (response: ArbitrageScanResponse | null) => void;
  setLoading: (val: boolean) => void;
  setScanProgress: (progress: { current: number; total: number; phase: string } | null) => void;
  setJobId: (id: string | null) => void;
  saveScan: (label: string) => void;
  deleteScan: (id: string) => void;
  getFilteredResults: () => ArbitrageResult[];
}

export const useArbitrageStore = create<ArbitrageStore>()(
  persist(
    (set, get) => ({
      // Defaults
      selectedCategories: [],
      shippingCost: 15,
      minProfit: 5,
      minRoi: 20,
      maxResults: 30,
      includeInternational: true,
      highDefectRate: false,
      feeOverride: '',
      exchangeRateOverride: '',
      scanResponse: null,
      loading: false,
      scanProgress: null,
      jobId: null,
      filterVerdict: 'all',
      sortField: 'score',
      sortDirection: 'desc',
      selectedProductIdx: null,
      activeTab: 0,
      searchText: '',
      savedScans: [],

      // Setters
      setSelectedCategories: (cats) => set({ selectedCategories: cats }),
      toggleCategory: (slug) => set(s => ({
        selectedCategories: s.selectedCategories.includes(slug)
          ? s.selectedCategories.filter(c => c !== slug)
          : [...s.selectedCategories, slug],
      })),
      setShippingCost: (val) => set({ shippingCost: val }),
      setMinProfit: (val) => set({ minProfit: val }),
      setMinRoi: (val) => set({ minRoi: val }),
      setMaxResults: (val) => set({ maxResults: val }),
      setIncludeInternational: (val) => set({ includeInternational: val }),
      setHighDefectRate: (val) => set({ highDefectRate: val }),
      setFeeOverride: (val) => set({ feeOverride: val }),
      setExchangeRateOverride: (val) => set({ exchangeRateOverride: val }),
      setFilterVerdict: (val) => set({ filterVerdict: val }),
      setSortField: (val) => set({ sortField: val }),
      toggleSortDirection: () => set(s => ({ sortDirection: s.sortDirection === 'asc' ? 'desc' : 'asc' })),
      setSelectedProductIdx: (idx) => set({ selectedProductIdx: idx }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setSearchText: (text) => set({ searchText: text }),
      setScanResponse: (response) => set({ scanResponse: response }),
      setLoading: (val) => set({ loading: val }),
      setScanProgress: (progress) => set({ scanProgress: progress }),
      setJobId: (id) => set({ jobId: id }),

      saveScan: (label) => {
        const state = get();
        if (!state.scanResponse) return;
        const scan: SavedScan = {
          id: Date.now().toString(),
          label,
          date: new Date().toISOString(),
          categories: state.selectedCategories,
          resultsCount: state.scanResponse.results.length,
          profitableCount: state.scanResponse.profitable,
          bestProfit: Math.max(...state.scanResponse.results.map(r => r.financials.profitUsd), 0),
          bestRoi: Math.max(...state.scanResponse.results.map(r => r.financials.roiPercent), 0),
        };
        set({ savedScans: [scan, ...state.savedScans].slice(0, 50) });
      },

      deleteScan: (id) => set(s => ({ savedScans: s.savedScans.filter(scan => scan.id !== id) })),

      getFilteredResults: () => {
        const state = get();
        if (!state.scanResponse) return [];

        let results = [...state.scanResponse.results];

        // Filter by verdict
        if (state.filterVerdict !== 'all') {
          results = results.filter(r => r.verdict === state.filterVerdict);
        }

        // Filter by search text
        if (state.searchText) {
          const q = state.searchText.toLowerCase();
          results = results.filter(r =>
            r.trendyol.name.toLowerCase().includes(q) ||
            r.trendyol.brand.toLowerCase().includes(q) ||
            (r.translatedQuery && r.translatedQuery.toLowerCase().includes(q))
          );
        }

        // Sort
        const dir = state.sortDirection === 'asc' ? 1 : -1;
        results.sort((a, b) => {
          switch (state.sortField) {
            case 'profitUsd': return (a.financials.profitUsd - b.financials.profitUsd) * dir;
            case 'roiPercent': return (a.financials.roiPercent - b.financials.roiPercent) * dir;
            case 'costUsd': return (a.financials.costUsd - b.financials.costUsd) * dir;
            case 'suggestedPriceUsd': return (a.financials.suggestedPriceUsd - b.financials.suggestedPriceUsd) * dir;
            default: return (a.score - b.score) * dir;
          }
        });

        return results;
      },
    }),
    {
      name: 'arbitrage-scanner-v2',
      partialize: (state) => ({
        selectedCategories: state.selectedCategories,
        shippingCost: state.shippingCost,
        minProfit: state.minProfit,
        minRoi: state.minRoi,
        maxResults: state.maxResults,
        includeInternational: state.includeInternational,
        highDefectRate: state.highDefectRate,
        feeOverride: state.feeOverride,
        exchangeRateOverride: state.exchangeRateOverride,
        savedScans: state.savedScans,
        filterVerdict: state.filterVerdict,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
      }),
    }
  )
);
