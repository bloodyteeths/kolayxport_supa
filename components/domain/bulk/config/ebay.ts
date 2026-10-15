// components/domain/bulk/config/ebay.ts — BulkGrid eBay (bulk-grid §1.2: title, price, qty; SKU and condition
// read-only). eBay titles are capped at 80 characters (Inventory API `product.title`).
import { ebayConfig } from '@/components/domain/listings/config/ebay';
import type { BulkConfig } from './types';

export const ebayBulkConfig: BulkConfig = {
  marketplace: 'ebay',
  listings: ebayConfig,
  columns: ['thumb', 'title', 'price', 'qty', 'health', 'changes', 'status'],
  hiddenByDefault: ['status'],
  fields: ['title', 'price', 'qty'],
  titleMax: 80,
  transport: 'ebay',
  photosHref: null,
  photosRoute: null,
  stateActions: ['deactivate', 'activate'],
  deleteAction: true,
  columnStateKey: 'bulk.ebay.columns',
};

export default ebayBulkConfig;
