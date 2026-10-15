// components/domain/listings/config/shopify.ts — listings-grid §3 Shopify column of the config table.
// Staging goes through CatalogDraft (G4). Full editor (M6b) at `/app/shopify-urunler/[id]` and `/new`.
import type { ListingsConfig } from './types';
import { editorHref as catalogEditorHref, newListingHref as catalogNewListingHref } from '@/lib/listingEditor/editorNav';
import { PHOTOS_FILTER, PRICE_FILTER, STOCK_FILTER, healthFilter, statusFilter } from './shared';

export const shopifyConfig: ListingsConfig = {
  marketplace: 'shopify',
  route: '/app/shopify-urunler',
  storeParam: 'shop',
  columns: ['select', 'thumb', 'listing', 'price', 'qty', 'status', 'changes', 'variants', 'health', 'updated', 'vendor', 'productType', 'compareAt', 'created', 'actions'],
  hiddenByDefault: ['vendor', 'productType', 'compareAt', 'created'],
  filters: [
    statusFilter(['active', 'draft', 'sold_out', 'inactive']),
    { key: 'productType', labelKey: 'listings.filter.productType', type: 'select', pinned: true, searchable: true, optionsSource: 'productTypes' },
    healthFilter(['missing_photos', 'missing_tags', 'short_title']),
    { key: 'vendor', labelKey: 'listings.filter.vendor', type: 'select', searchable: true, optionsSource: 'vendors' },
    PHOTOS_FILTER,
    STOCK_FILTER,
    PRICE_FILTER,
  ],
  views: ['all', 'active', 'not_sent', 'send_failed', 'needs_work', 'sold_out', 'inactive'],
  defaultView: 'all',
  rowInlineAction: 'edit',
  rowActions: ['quickView', 'viewExternal', 'sendChange', 'scheduleSend', 'discardChanges', 'sendDeletion', 'delete'],
  bulkPrimary: 'changePrice',
  // Spec deviation (listings-grid §6.3): "Set status" needs a status picker modal over CatalogDraft `status`;
  // tracked as a follow-up rather than shipped half-done.
  bulkActions: ['addTags', 'changeStock'],
  bulkOverflow: ['editInGrid', 'sendSelected', 'discardSelected', 'scheduleSend', 'exportSelected', 'delete'],
  tools: ['findReplace', 'duplicates', 'import', 'export', 'scheduled'],
  inlineEdit: { price: true, qty: true },
  validation: {},
  tags: { max: null, maxLength: 255 },
  drafts: 'catalog',
  editorHref: (id, storeId) => catalogEditorHref('shopify', id, storeId),
  newListingHref: (storeId) => catalogNewListingHref('shopify', storeId),
  bulkEditHref: () => '/app/shopify-urunler/bulk', // M7 BulkGrid (bulk-grid §1.2 v1: title/price/qty via CatalogDraft)
  externalUrl: (row) => row.externalUrl,
  pull: () => ({ url: '/api/shopify/products?action=sync', method: 'POST' }),
  columnStateKey: 'listings.shopify.columns',
};

export default shopifyConfig;
