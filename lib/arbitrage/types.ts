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
  brandId?: number;
  priceTry: number;
  originalPriceTry: number;
  imageUrl: string;
  images?: string[];
  url: string;
  categoryName: string;
  categoryId?: number;
  ratingScore: number;
  ratingCount: number;
  merchantName: string;
  merchantId?: number;
  freeShipping: boolean;
  barcode?: string;
  stockCode?: string;
  quantity?: number;
  // Social proof (from HTML PROPS socialProof array)
  favoriteCount?: string;   // e.g. "31K"
  orderCount?: string;      // e.g. "200+"
  basketCount?: string;     // e.g. "4K"
  pageViewCount?: string;   // e.g. "1K"
  // Badges & delivery
  rushDelivery?: boolean;
  sameDayShipping?: boolean;
  hasOfficialSellerBadge?: boolean;
  sellerBadgeType?: string; // e.g. "FAST_SELLER", "AUTHORIZED_SELLER"
  // Variant info
  groupId?: number;
  variantValue?: string;
  // Attributes from productCardAttributes
  productAttributes?: Array<{
    attributeName: string;
    attributeValueName: string;
  }>;
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
