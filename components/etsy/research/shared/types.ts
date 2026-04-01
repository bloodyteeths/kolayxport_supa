export interface MarketResearchData {
  query: string;
  topTags: Array<{ tag: string; count: number; pct: number }>;
  topKeywords: Array<{ keyword: string; count: number; pct: number }>;
  priceStats: { min: number; avg: number; median: number; max: number } | null;
}

export interface EtsyMarketItem {
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

export interface TagData { tag: string; count: number; pct: number; }
export interface KeywordData { keyword: string; count: number; pct: number; inMyTitle?: boolean; }

export interface ShopData {
  shop_id: number; shop_name: string; num_sales: number;
  review_count: number; review_average: number; listing_active_count: number;
  url: string; icon_url: string; avgPrice?: number; listingCount?: number;
}

export interface SavedSearch {
  query: string; minPrice: string; maxPrice: string; sortOn: string;
  myTitle: string; myTags: string; timestamp: number;
}

export interface AiAnalysis {
  opportunity_score: number; opportunity_level: string; market_summary: string;
  pricing_strategy: string; tag_recommendations: string[]; title_recommendations: string;
  niche_positioning: string; seasonal_advice: string; competition_analysis: string;
  action_items: string[];
}

export interface TrendData {
  timeline: { date: string; value: number }[];
  averageInterest: number; peakValue: number; peakDate: string;
  trendDirection: string;
  risingQueries: { query: string; value: string }[];
  topQueries: { query: string; value: number }[];
}

export interface AutocompleteSuggestion {
  keyword: string; sources: string[]; sourceCount: number; frequency: number; score: number;
  trendScore?: number; competition?: number;
}

export interface SeasonalData {
  monthlyTrends: { month: string; value: number }[];
  wikiPageviews: { month: string; views: number }[];
  peakMonth: string; lowMonth: string; hasData: boolean;
}

export interface EnrichedTag extends TagData {
  inMyTags: boolean;
}

export interface EnrichedKeyword extends KeywordData {
  inMyTitle: boolean;
}

export interface DemandScore {
  score: number; totalResults: number; uniqueShops: number;
  avgFavorites: number; avgViews: number;
  avgEngagement: number; priceSpread: number;
  breakdown: { supplyScore: number; compScore: number; demandPts: number; engScore: number; spreadScore: number };
}

export interface PriceStats {
  min: number; max: number; avg: number; median: number; count: number;
}

export interface PriceRangeItem {
  label: string; min: number; max: number; count: number; pct: number;
}

export interface HistogramBucket {
  label: string; count: number;
}

export interface SweetSpot {
  label: string; min: number; max: number; avgFav: number; count: number;
}

export interface TagCombo {
  pair: string; count: number; avgFav: number;
}

export interface ShopStats {
  shops: (ShopData & { avgPrice: number; listingCount: number })[];
  totalSales: number; avgRating: number; top5Sales: number; totalListings: number;
}

export interface DeepDiveStats {
  count: number;
  priceMin: number; priceMax: number; priceAvg: number; priceMedian: number;
  avgFav: number; avgViews: number;
  topTags: TagData[];
  bestListings: EtsyMarketItem[];
}

export interface SeoResult {
  score: number; kwScore: number; tagScore: number; lengthScore: number; hasTagsScore: number;
  recommendations: string[]; avgLen: number;
  coveredKw: number; totalKw: number;
  coveredTags: number; totalTags: number;
}

export interface ProfitCalc {
  cost: number; sell: number; ship: number;
  listingFee: number; transactionFee: number; paymentProcessing: number;
  regulatoryFee: number; offsiteAdsFee: number; etsyAdsCost: number; roas: number;
  totalFees: number; profit: number; margin: number;
  compare: { label: string; price: number; profit: number; margin: number }[];
  fees: FeeProfile;
}

export interface FeeProfile {
  label: string; currency: string; listingFee: number;
  transactionRate: number; paymentProcessingRate: number; paymentProcessingFixed: number;
  offsiteAdsRate: number; regulatoryFee: number; vatRate: number; notes: string;
}

export type SortDir = 'asc' | 'desc';

export interface DiscoveryNiche {
  query: string;
  totalResults: number;
  topItems: { listing_id: number; title: string; price: number; image_url: string; num_favorers: number; views: number }[];
  priceStats: { min: number; avg: number; median: number; max: number };
  avgFavorites: number;
}

export interface DiscoveryData {
  trendingNiches: DiscoveryNiche[];
  hotKeywords: { keyword: string; count: number }[];
  seasonalTips: string[];
  lastUpdated: string;
}
