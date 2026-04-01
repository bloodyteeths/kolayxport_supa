export interface ArbitrageScanParams {
  categories: string[];
  minProfitUsd: number;
  minRoiPercent: number;
  shippingCostUsd: number;
  exchangeRate?: number; // TRY→USD override
  feeOverridePercent?: number; // eBay final value fee override
  includeInternationalFee: boolean;
  maxTrendyolResults: number;
}

export interface TrendyolProduct {
  id: number;
  name: string;
  brand: string;
  priceTry: number;
  originalPriceTry: number;
  imageUrl: string;
  url: string;
  categoryName: string;
  ratingScore: number;
  ratingCount: number;
  merchantName: string;
  freeShipping: boolean;
  barcode?: string;
  stockCode?: string;
  quantity?: number;
}

export interface EbayComparable {
  title: string;
  price: number;
  currency: string;
  itemId: string;
  soldQuantity: number;
  condition: string;
  imageUrl: string;
  categoryId: string;
  categoryName: string;
}

export interface ArbitrageResult {
  trendyol: TrendyolProduct;
  ebay: {
    avgPrice: number;
    medianPrice: number;
    minPrice: number;
    maxPrice: number;
    totalListings: number;
    avgSold: number;
    topItems: EbayComparable[];
    categoryId: string;
    categoryName: string;
  };
  financials: {
    costTry: number;
    costUsd: number;
    shippingUsd: number;
    suggestedPriceUsd: number;
    ebayFeePercent: number;
    ebayFeeName: string;
    ebayFeeUsd: number;
    paymentFeeUsd: number;
    internationalFeeUsd: number;
    totalCostUsd: number;
    profitUsd: number;
    roiPercent: number;
    marginPercent: number;
  };
  exchangeRate: number;
  score: number; // 0-100 opportunity score
  verdict: 'excellent' | 'good' | 'marginal' | 'skip';
  matchTier?: 'gtin' | 'gemini' | 'fallback';
  translatedQuery?: string;
}

export interface ArbitrageScanResponse {
  results: ArbitrageResult[];
  exchangeRate: number;
  totalScanned: number;
  profitable: number;
  scanDurationMs: number;
}

// Background scan job
export interface ArbitrageScanJobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  totalProducts: number;
  resultsCount: number;
  results?: ArbitrageResult[];
  exchangeRate?: number;
  error?: string;
  scanDurationMs?: number;
}

// Trendyol category tree node
export interface TrendyolCategoryNode {
  id: number;
  name: string;
  slug: string;
  parentId?: number;
  parentPath?: string;
  subCategories?: TrendyolCategoryNode[];
  productCount?: number;
  ebayCategoryId?: string;
  ebayCategoryName?: string;
  ebayFeeRate?: number;
  isMapped: boolean;
}
