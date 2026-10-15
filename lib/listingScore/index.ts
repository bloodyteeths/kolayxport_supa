// lib/listingScore/index.ts: one entry point for listing health (DESIGN_SYSTEM §3.10, §4.1).
// `scoreListing(listing, marketplace)` for a listing view (editor draft view, research),
// `scoreCacheRow(row, marketplace)` for a DB cache row (grid, refreshHealth),
// `toHealthColumns(result)` for the stored columns (BR-1a) and the `healthFails` filter tokens.
// Pure: no React, no Prisma. Safe on the server and the client.
import type { ScoreResult } from './types';
import { etsyInputFromCache, scoreEtsyListing, type EtsyCacheRow, type EtsyScoreInput } from './etsy';
import { ebayInputFromCache, scoreEbayListing, type EbayCacheRow, type EbayScoreInput } from './ebay';
import { scoreTrendyolProduct, trendyolInputFromCache, type TrendyolCacheRow, type TrendyolScoreInput } from './trendyol';
import { scoreWixProduct, wixInputFromCache, type WixCacheRow, type WixScoreInput } from './wix';
import { scoreShopifyProduct, shopifyInputFromCache, type ShopifyCacheRow, type ShopifyScoreInput } from './shopify';

export * from './types';
export type { EtsyScoreInput, EtsyCacheRow } from './etsy';
export type { EbayScoreInput, EbayCacheRow } from './ebay';
export type { TrendyolScoreInput, TrendyolCacheRow } from './trendyol';
export type { WixScoreInput, WixCacheRow } from './wix';
export type { ShopifyScoreInput, ShopifyCacheRow } from './shopify';
export { scoreEtsyListing, scoreEbayListing, scoreTrendyolProduct, scoreWixProduct, scoreShopifyProduct };

/** The five marketplaces of the listings grid (Amazon has no scorer yet). */
export type ListingScoreMarketplace = 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify';
export const LISTING_SCORE_MARKETPLACES: readonly ListingScoreMarketplace[] = ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'];

export interface ScoreInputFor {
  etsy: EtsyScoreInput;
  ebay: EbayScoreInput;
  trendyol: TrendyolScoreInput;
  wix: WixScoreInput;
  shopify: ShopifyScoreInput;
}

export interface CacheRowFor {
  etsy: EtsyCacheRow;
  ebay: EbayCacheRow;
  trendyol: TrendyolCacheRow;
  wix: WixCacheRow;
  shopify: ShopifyCacheRow;
}

/** DS §4.1 `scoreListing(listing, marketplace): ScoreResult`. */
export function scoreListing<M extends ListingScoreMarketplace>(listing: ScoreInputFor[M], marketplace: M): ScoreResult {
  switch (marketplace) {
    case 'etsy': return scoreEtsyListing(listing as EtsyScoreInput);
    case 'ebay': return scoreEbayListing(listing as EbayScoreInput);
    case 'trendyol': return scoreTrendyolProduct(listing as TrendyolScoreInput);
    case 'wix': return scoreWixProduct(listing as WixScoreInput);
    case 'shopify': return scoreShopifyProduct(listing as ShopifyScoreInput);
    default: throw new Error(`listingScore: unknown marketplace ${String(marketplace)}`);
  }
}

/** Cache row → scorer input (what the DB knows; everything else is `na`). */
export function inputFromCacheRow<M extends ListingScoreMarketplace>(row: CacheRowFor[M], marketplace: M): ScoreInputFor[M] {
  switch (marketplace) {
    case 'etsy': return etsyInputFromCache(row as EtsyCacheRow) as ScoreInputFor[M];
    case 'ebay': return ebayInputFromCache(row as EbayCacheRow) as ScoreInputFor[M];
    case 'trendyol': return trendyolInputFromCache(row as TrendyolCacheRow) as ScoreInputFor[M];
    case 'wix': return wixInputFromCache(row as WixCacheRow) as ScoreInputFor[M];
    case 'shopify': return shopifyInputFromCache(row as ShopifyCacheRow) as ScoreInputFor[M];
    default: throw new Error(`listingScore: unknown marketplace ${String(marketplace)}`);
  }
}

/** Score of a DB cache row: the "sent state" health shown in the grid. */
export function scoreCacheRow<M extends ListingScoreMarketplace>(row: CacheRowFor[M], marketplace: M): ScoreResult {
  return scoreListing(inputFromCacheRow(row, marketplace), marketplace);
}

// ---------------------------------------------------------------------------
// Stored columns + filter tokens (listings-grid §5, §9.3)
// ---------------------------------------------------------------------------

/**
 * Tokens stored in `healthFails`: the id of every listing check that is not passing (`warn` or `fail`),
 * plus derived tokens for filters that need a direction:
 * - `title_short`: `title_length` is not passing because the title is under the minimum.
 */
export function healthFailTokens(result: ScoreResult): string[] {
  const out = new Set<string>();
  for (const c of result.checks) {
    if ((c.group ?? 'listing') !== 'listing') continue;
    if (c.status !== 'warn' && c.status !== 'fail') continue;
    out.add(c.id);
    if (c.id === 'title_length') {
      const len = Number(c.params?.length);
      const min = Number(c.params?.min);
      if (Number.isFinite(len) && Number.isFinite(min) && len < min) out.add('title_short');
    }
  }
  return Array.from(out).sort();
}

/** Check-based Health filter options (listings-grid §5) → the `healthFails` token they match (`has`). */
export const HEALTH_FILTER_TOKEN = {
  missing_photos: 'photos_count',
  missing_tags: 'tags_count',
  no_video: 'video',
  short_title: 'title_short',
} as const;
export type HealthCheckFilter = keyof typeof HEALTH_FILTER_TOKEN;

/** Values written to the BR-1a columns. `healthScore` is null when no check could run (unscored). */
export interface HealthColumns {
  healthScore: number | null;
  healthChecksUsed: number;
  healthChecksTotal: number;
  healthFails: string[];
}

export function toHealthColumns(result: ScoreResult): HealthColumns {
  return {
    healthScore: result.checksUsed > 0 ? result.score : null,
    healthChecksUsed: result.checksUsed,
    healthChecksTotal: result.checksTotal,
    healthFails: result.checksUsed > 0 ? healthFailTokens(result) : [],
  };
}
