// components/domain/bulk/config/shopify.ts — BulkGrid Shopify (bulk-grid §1.2: CatalogDraft v1 fields only).
import { shopifyConfig } from '@/components/domain/listings/config/shopify';
import type { BulkConfig } from './types';

export const shopifyBulkConfig: BulkConfig = {
  marketplace: 'shopify',
  listings: shopifyConfig,
  columns: ['thumb', 'title', 'price', 'qty', 'health', 'changes', 'status'],
  hiddenByDefault: ['status'],
  fields: ['title', 'price', 'qty', 'tags'],
  titleMax: null,
  transport: 'catalog',
  photosHref: null,
  photosRoute: null,
  stateActions: [],
  deleteAction: false,
  columnStateKey: 'bulk.shopify.columns',
};

export default shopifyBulkConfig;
