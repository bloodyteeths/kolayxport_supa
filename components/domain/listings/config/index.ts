// components/domain/listings/config/index.ts — the one lookup from marketplace to ListingsConfig (listings-grid §3).
// `ListingsPage` reads everything marketplace-specific from here; it never branches on the marketplace itself.
import type { ListingMarketplace } from '@/lib/listings/types';
import type { ListingsConfig } from './types';
import { etsyConfig } from './etsy';
import { ebayConfig } from './ebay';
import { trendyolConfig } from './trendyol';
import { wixConfig } from './wix';
import { shopifyConfig } from './shopify';

export type { ListingsConfig } from './types';
export { etsyConfig, ebayConfig, trendyolConfig, wixConfig, shopifyConfig };
export { SCHEDULED_SENDS_ENABLED } from './shared';

export const LISTINGS_CONFIGS: Record<ListingMarketplace, ListingsConfig> = {
  etsy: etsyConfig,
  ebay: ebayConfig,
  trendyol: trendyolConfig,
  wix: wixConfig,
  shopify: shopifyConfig,
};

export function listingsConfig(marketplace: ListingMarketplace): ListingsConfig {
  return LISTINGS_CONFIGS[marketplace];
}

/** `ConnectState` target (settings › connections). */
export const CONNECT_HREF = '/ayarlar?tab=connections';

/** Brand names for `{marketplace}` ICU placeholders that take a proper noun (never translated). */
export const MARKETPLACE_NAME: Record<ListingMarketplace, string> = {
  etsy: 'Etsy',
  ebay: 'eBay',
  trendyol: 'Trendyol',
  wix: 'Wix',
  shopify: 'Shopify',
};

/** Marketplaces whose cache has the backend freshness chip (`components/etsy-history/CacheFreshnessChip`, W3 §2a). */
export const FRESHNESS_CHIP: Partial<Record<ListingMarketplace, true>> = { etsy: true };
