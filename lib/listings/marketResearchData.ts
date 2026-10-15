// lib/listings/marketResearchData.ts — the research summary a listing creator receives with a prefill
// (`ListingPrefillV1.research` → `toMarketResearchData`). Moved out of components/etsy/research/shared/types.ts so the
// creators and the Research hub do not depend on the legacy research screens.
export interface MarketResearchData {
  query: string;
  topTags: Array<{ tag: string; count: number; pct: number }>;
  topKeywords: Array<{ keyword: string; count: number; pct: number }>;
  priceStats: { min: number; avg: number; median: number; max: number } | null;
}
