// components/domain/listings/config/wix.ts — listings-grid §3 Wix column of the config table.
// Staging goes through CatalogDraft (G4). No full editor until M6b: `e` opens the quick view `xl` (CRITIQUE X3).
import type { ListingsConfig } from './types';
import { PHOTOS_FILTER, PRICE_FILTER, STOCK_FILTER, booleanFilter, healthFilter, statusFilter } from './shared';

export const wixConfig: ListingsConfig = {
  marketplace: 'wix',
  route: '/app/wix-urunler',
  storeParam: 'site',
  columns: ['select', 'thumb', 'listing', 'price', 'qty', 'status', 'changes', 'collection', 'health', 'updated', 'visible', 'ribbon', 'created', 'actions'],
  hiddenByDefault: ['visible', 'ribbon', 'created'],
  filters: [
    statusFilter(['active', 'sold_out', 'inactive']),
    { key: 'collection', labelKey: 'listings.filter.collection', type: 'select', pinned: true, searchable: true, optionsSource: 'collections' },
    healthFilter(['missing_photos', 'short_title']),
    booleanFilter('visible', 'listings.filter.visible'),
    PHOTOS_FILTER,
    STOCK_FILTER,
    PRICE_FILTER,
  ],
  views: ['all', 'active', 'not_sent', 'send_failed', 'needs_work', 'sold_out', 'inactive'],
  defaultView: 'all',
  rowInlineAction: 'edit',
  rowActions: ['quickView', 'viewExternal', 'sendChange', 'scheduleSend', 'discardChanges', 'sendDeletion', 'showInStore', 'hideInStore', 'delete'],
  bulkPrimary: 'changePrice',
  // Spec deviation (listings-grid §6.3): "Add to collection" needs a collection field on CatalogDraft (BR request).
  bulkActions: ['changeStock', 'showInStore', 'hideInStore'],
  bulkOverflow: ['sendSelected', 'discardSelected', 'scheduleSend', 'exportSelected', 'delete'],
  tools: ['findReplace', 'duplicates', 'import', 'export', 'scheduled'],
  inlineEdit: { price: true, qty: true },
  validation: {},
  drafts: 'catalog',
  editorHref: () => null,
  newListingHref: () => null,
  bulkEditHref: null,
  externalUrl: (row) => row.externalUrl,
  pull: () => ({ url: '/api/wix/products?action=sync', method: 'POST' }),
  columnStateKey: 'listings.wix.columns',
};

export default wixConfig;
