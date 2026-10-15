// components/domain/listings/config/wix.ts — listings-grid §3 Wix column of the config table.
// Staging goes through CatalogDraft (G4). Full editor (M6b) at `/app/wix-urunler/[id]` and `/new`.
import type { ListingsConfig } from './types';
import { editorHref as catalogEditorHref, newListingHref as catalogNewListingHref } from '@/lib/listingEditor/editorNav';
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
  bulkOverflow: ['editInGrid', 'sendSelected', 'discardSelected', 'scheduleSend', 'exportSelected', 'delete'],
  tools: ['findReplace', 'duplicates', 'import', 'export', 'scheduled'],
  inlineEdit: { price: true, qty: true },
  validation: {},
  drafts: 'catalog',
  editorHref: (id, storeId) => catalogEditorHref('wix', id, storeId),
  newListingHref: (storeId) => catalogNewListingHref('wix', storeId),
  bulkEditHref: () => '/app/wix-urunler/bulk', // M7 BulkGrid (bulk-grid §1.2 v1: title/price/qty via CatalogDraft)
  externalUrl: (row) => row.externalUrl,
  pull: () => ({ url: '/api/wix/products?action=sync', method: 'POST' }),
  columnStateKey: 'listings.wix.columns',
};

export default wixConfig;
