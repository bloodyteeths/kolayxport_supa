// components/domain/bulk/config/etsy.ts — BulkGrid Etsy column of bulk-grid §1.2 / §3.1 (M7-C).
import { etsyConfig } from '@/components/domain/listings/config/etsy';
import type { BulkConfig } from './types';

const enc = encodeURIComponent;

export const PHOTO_STUDIO_ROUTE = '/app/etsy-listings/photos';

export const etsyBulkConfig: BulkConfig = {
  marketplace: 'etsy',
  listings: etsyConfig,
  columns: ['thumb', 'title', 'price', 'qty', 'section', 'health', 'changes', 'photos', 'status'],
  hiddenByDefault: ['photos', 'status'],
  fields: ['title', 'price', 'qty', 'section', 'tags'],
  titleMax: 140,
  transport: 'etsy',
  photosHref: (ids, storeId) => `${PHOTO_STUDIO_ROUTE}?ids=${enc(ids.join(','))}${storeId ? `&shop=${enc(storeId)}` : ''}`,
  photosRoute: PHOTO_STUDIO_ROUTE,
  stateActions: ['deactivate', 'activate', 'renew'],
  deleteAction: true,
  columnStateKey: 'bulk.etsy.columns',
};

export default etsyBulkConfig;
