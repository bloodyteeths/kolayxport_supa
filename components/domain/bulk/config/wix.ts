// components/domain/bulk/config/wix.ts — BulkGrid Wix (bulk-grid §1.2: CatalogDraft v1 fields only).
import { wixConfig } from '@/components/domain/listings/config/wix';
import type { BulkConfig } from './types';

export const wixBulkConfig: BulkConfig = {
  marketplace: 'wix',
  listings: wixConfig,
  columns: ['thumb', 'title', 'price', 'qty', 'health', 'changes', 'status'],
  hiddenByDefault: ['status'],
  fields: ['title', 'price', 'qty'],
  titleMax: null,
  transport: 'catalog',
  photosHref: null,
  photosRoute: null,
  stateActions: [],
  deleteAction: false,
  columnStateKey: 'bulk.wix.columns',
};

export default wixBulkConfig;
