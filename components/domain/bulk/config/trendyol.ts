// components/domain/bulk/config/trendyol.ts — BulkGrid Trendyol (bulk-grid §1.2: CatalogDraft v1 fields only).
import { trendyolConfig } from '@/components/domain/listings/config/trendyol';
import type { BulkConfig } from './types';

export const trendyolBulkConfig: BulkConfig = {
  marketplace: 'trendyol',
  listings: trendyolConfig,
  columns: ['thumb', 'title', 'price', 'qty', 'health', 'changes', 'status'],
  hiddenByDefault: ['status'],
  fields: ['title', 'price', 'qty'],
  titleMax: null,
  transport: 'catalog',
  photosHref: null,
  photosRoute: null,
  stateActions: [],
  deleteAction: false,
  columnStateKey: 'bulk.trendyol.columns',
};

export default trendyolBulkConfig;
