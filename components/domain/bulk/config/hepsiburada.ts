// components/domain/bulk/config/hepsiburada.ts — BulkGrid Hepsiburada (CatalogDraft: price and stock).
import { hepsiburadaConfig } from '@/components/domain/listings/config/hepsiburada';
import type { BulkConfig } from './types';

export const hepsiburadaBulkConfig: BulkConfig = {
  marketplace: 'hepsiburada',
  listings: hepsiburadaConfig,
  columns: ['thumb', 'title', 'price', 'qty', 'changes', 'status'],
  hiddenByDefault: ['status'],
  fields: ['price', 'qty'],
  titleMax: null,
  transport: 'catalog',
  photosHref: null,
  photosRoute: null,
  stateActions: [],
  deleteAction: false,
  columnStateKey: 'bulk.hepsiburada.columns',
};

export default hepsiburadaBulkConfig;
