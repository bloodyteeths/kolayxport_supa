import { create } from 'zustand';

export interface DashboardSummary {
  grossRevenue: number;
  commissions: number;
  shipping: number;
  returns: number;
  discounts: number;
  cogs: number;
  netProfit: number;
  margin: number;
}

export interface TimeSeriesPoint {
  period: string;
  revenue: number;
  commissions: number;
  shipping: number;
  returns: number;
  cogs: number;
  netProfit: number;
}

export interface ProductBreakdown {
  barcode: string | null;
  productName: string | null;
  revenue: number;
  quantity: number;
  commissions: number;
  shipping: number;
  cogs: number;
  netProfit: number;
}

export interface TransactionTypeSummary {
  type: string;
  total: number;
  count: number;
}

export interface DashboardData {
  summary: DashboardSummary;
  timeSeries: TimeSeriesPoint[];
  productBreakdown: ProductBreakdown[];
  transactionTypeSummary: TransactionTypeSummary[];
}

export interface ProductCostEntry {
  id: string;
  marketplace: string;
  barcode: string | null;
  sku: string | null;
  marketplaceId: string | null;
  productName: string;
  costAmount: number;
  costCurrency: string;
  shippingCost: number | null;
  notes: string | null;
}

export interface FinancialTransactionRow {
  id: string;
  marketplace: string;
  externalId: string;
  transactionType: string;
  orderNumber: string | null;
  barcode: string | null;
  productName: string | null;
  quantity: number;
  amount: number;
  currency: string;
  commission: number | null;
  shippingAmount: number | null;
  transactionDate: string;
}

type Marketplace = 'trendyol' | 'etsy' | 'ebay';

interface FinanceState {
  // UI state
  marketplace: Marketplace;
  dateRange: { start: string; end: string };
  groupBy: 'day' | 'week' | 'month';

  // Sync
  syncStatus: 'idle' | 'syncing' | 'done' | 'error';
  syncMessage: string;

  // Dashboard data
  dashboardData: DashboardData | null;
  dashboardLoading: boolean;

  // Product costs
  productCosts: ProductCostEntry[];
  costsLoading: boolean;

  // Transactions
  transactions: FinancialTransactionRow[];
  transactionsLoading: boolean;
  transactionsTotal: number;

  // Actions
  setMarketplace: (m: Marketplace) => void;
  setDateRange: (range: { start: string; end: string }) => void;
  setGroupBy: (g: 'day' | 'week' | 'month') => void;
  syncSettlements: (startDate?: string, endDate?: string) => Promise<void>;
  fetchDashboard: () => Promise<void>;
  fetchProductCosts: (search?: string) => Promise<void>;
  updateProductCost: (id: string, costAmount: number, shippingCost?: number) => Promise<void>;
  createProductCost: (data: Partial<ProductCostEntry>) => Promise<void>;
  bulkCreateCosts: (items: Partial<ProductCostEntry>[]) => Promise<void>;
  fetchTransactions: (page?: number, typeFilter?: string) => Promise<void>;
}

function getDefaultDateRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: start.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0],
  };
}

const useFinanceStore = create<FinanceState>((set, get) => ({
  marketplace: 'trendyol',
  dateRange: getDefaultDateRange(),
  groupBy: 'day',

  syncStatus: 'idle',
  syncMessage: '',

  dashboardData: null,
  dashboardLoading: false,

  productCosts: [],
  costsLoading: false,

  transactions: [],
  transactionsLoading: false,
  transactionsTotal: 0,

  setMarketplace: (m) => {
    set({ marketplace: m, dashboardData: null, productCosts: [], transactions: [] });
  },
  setDateRange: (range) => set({ dateRange: range }),
  setGroupBy: (g) => set({ groupBy: g }),

  syncSettlements: async (startDate, endDate) => {
    const { marketplace, dateRange } = get();
    set({ syncStatus: 'syncing', syncMessage: '' });
    try {
      const res = await fetch('/api/finance/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync',
          marketplace,
          startDate: new Date(startDate || dateRange.start).getTime(),
          endDate: new Date(endDate || dateRange.end).getTime(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Sync failed');
      }
      const data = await res.json();
      set({ syncStatus: 'done', syncMessage: String(data.totalUpserted || 0) });
      // Auto-refresh dashboard after sync
      get().fetchDashboard();
    } catch (err: any) {
      set({ syncStatus: 'error', syncMessage: err.message || 'Sync error' });
    }
  },

  fetchDashboard: async () => {
    const { marketplace, dateRange, groupBy } = get();
    set({ dashboardLoading: true });
    try {
      const params = new URLSearchParams({
        marketplace,
        startDate: dateRange.start,
        endDate: dateRange.end,
        groupBy,
      });
      const res = await fetch(`/api/finance/dashboard?${params}`);
      if (!res.ok) throw new Error('Dashboard fetch failed');
      const data = await res.json();
      // Normalize transactionTypeSummary from object to array
      let txSummary: TransactionTypeSummary[] = [];
      if (data.transactionTypeSummary) {
        if (Array.isArray(data.transactionTypeSummary)) {
          txSummary = data.transactionTypeSummary;
        } else {
          txSummary = Object.entries(data.transactionTypeSummary).map(
            ([type, val]: [string, any]) => ({ type, total: val.total ?? 0, count: val.count ?? 0 })
          );
        }
      }
      set({
        dashboardData: {
          summary: data.summary || { grossRevenue: 0, commissions: 0, shipping: 0, returns: 0, discounts: 0, cogs: 0, netProfit: 0, margin: 0 },
          timeSeries: Array.isArray(data.timeSeries) ? data.timeSeries : [],
          productBreakdown: Array.isArray(data.productBreakdown) ? data.productBreakdown : [],
          transactionTypeSummary: txSummary,
        },
      });
    } catch (err) {
      console.error('[Finance Dashboard]', err);
    } finally {
      set({ dashboardLoading: false });
    }
  },

  fetchProductCosts: async (search) => {
    const { marketplace } = get();
    set({ costsLoading: true });
    try {
      const params = new URLSearchParams({ marketplace });
      if (search) params.set('search', search);
      const res = await fetch(`/api/finance/product-costs?${params}`);
      if (!res.ok) throw new Error('Costs fetch failed');
      const data = await res.json();
      set({ productCosts: data.items || [] });
    } catch (err) {
      console.error('[Finance Costs]', err);
    } finally {
      set({ costsLoading: false });
    }
  },

  updateProductCost: async (id, costAmount, shippingCost) => {
    try {
      const res = await fetch('/api/finance/product-costs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, costAmount, shippingCost }),
      });
      if (!res.ok) throw new Error('Update failed');
      // Refresh costs and dashboard
      get().fetchProductCosts();
      get().fetchDashboard();
    } catch (err) {
      console.error('[Finance Update Cost]', err);
      throw err;
    }
  },

  createProductCost: async (data) => {
    const { marketplace } = get();
    try {
      const res = await fetch('/api/finance/product-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, marketplace }),
      });
      if (!res.ok) throw new Error('Create failed');
      get().fetchProductCosts();
    } catch (err) {
      console.error('[Finance Create Cost]', err);
      throw err;
    }
  },

  bulkCreateCosts: async (items) => {
    const { marketplace } = get();
    try {
      const res = await fetch('/api/finance/product-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk', marketplace, items }),
      });
      if (!res.ok) throw new Error('Bulk create failed');
      get().fetchProductCosts();
      get().fetchDashboard();
    } catch (err) {
      console.error('[Finance Bulk Cost]', err);
      throw err;
    }
  },

  fetchTransactions: async (page = 0, typeFilter) => {
    const { marketplace, dateRange } = get();
    set({ transactionsLoading: true });
    try {
      const params = new URLSearchParams({
        marketplace,
        startDate: dateRange.start,
        endDate: dateRange.end,
        page: String(page),
        size: '50',
      });
      if (typeFilter) params.set('transactionType', typeFilter);
      const res = await fetch(`/api/finance/settlements?${params}`);
      if (!res.ok) throw new Error('Transactions fetch failed');
      const data = await res.json();
      set({
        transactions: data.transactions || data.items || [],
        transactionsTotal: data.total || 0,
      });
    } catch (err) {
      console.error('[Finance Transactions]', err);
    } finally {
      set({ transactionsLoading: false });
    }
  },
}));

export default useFinanceStore;
