/**
 * Stock sync shared types (contract, owner W2).
 */

export type StockChannel = 'etsy' | 'ebay' | 'trendyol' | 'shopify' | 'wix' | 'amazon' | 'hepsiburada';

export const STOCK_CHANNELS: readonly StockChannel[] = ['etsy', 'ebay', 'trendyol', 'shopify', 'wix', 'amazon', 'hepsiburada'];

/** One Etsy inventory product as observed after a listing refresh. */
export type EtsyOfferingObservation = {
  variantKey: string;
  variantValueKey: string;
  /** Informational only: Etsy regenerates product ids on every inventory PUT. */
  productId: string | null;
  sku: string | null;
  quantity: number;
  isEnabled: boolean;
};

export type StockOrderSource = 'etsy_webhook' | 'etsy_poll' | 'order_scan' | 'manual';

export type ApplyOrderToStockResult = {
  applied: number;
  deduped: number;
  unmatched: number;
  restocked: number;
  /** Stock items whose apply threw (lock timeout, DB blip): the order must be retried. */
  failed?: number;
  skipped?: 'disabled' | 'before_enable' | 'aggregator_unresolved';
};
