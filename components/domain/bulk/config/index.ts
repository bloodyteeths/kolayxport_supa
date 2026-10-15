// components/domain/bulk/config/index.ts — marketplace → BulkConfig (bulk-grid §5.2).
import type { ListingMarketplace } from '@/lib/listings/types';
import type { BulkConfig } from './types';
import { etsyBulkConfig } from './etsy';
import { ebayBulkConfig } from './ebay';
import { trendyolBulkConfig } from './trendyol';
import { wixBulkConfig } from './wix';
import { shopifyBulkConfig } from './shopify';

export type { BulkConfig, BulkField, BulkColumnKey, BulkTransportKind } from './types';
export { BULK_FIELDS, isBulkField } from './types';
export { etsyBulkConfig, ebayBulkConfig, trendyolBulkConfig, wixBulkConfig, shopifyBulkConfig };

export const BULK_CONFIGS: Record<ListingMarketplace, BulkConfig> = {
  etsy: etsyBulkConfig,
  ebay: ebayBulkConfig,
  trendyol: trendyolBulkConfig,
  wix: wixBulkConfig,
  shopify: shopifyBulkConfig,
};

export function bulkConfig(marketplace: ListingMarketplace): BulkConfig {
  return BULK_CONFIGS[marketplace];
}

/** Rows per grid page (bulk-grid §1.2: 250 max, server-paged). */
export const BULK_PAGE_SIZE = 250;

/** Staging debounce for the whole queue (bulk-grid §6.1). */
export const BULK_DEBOUNCE_MS = 800;
/** `batch-stage` requests in flight (bulk-grid §6.1). Items per request = `BATCH_STAGE_MAX_ITEMS` (50, M7-B). */
export const BULK_MAX_IN_FLIGHT = 2;
