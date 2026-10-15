// components/domain/listings/config/shopify.ts — listings-grid §3 Shopify column of the config table.
// Staging goes through CatalogDraft (G4). No full editor until M6b: `e` opens the quick view `xl` (CRITIQUE X3).
import type { ListingsConfig } from './types';
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
  bulkOverflow: ['sendSelected', 'discardSelected', 'scheduleSend', 'exportSelected', 'delete'],
  tools: ['findReplace', 'duplicates', 'import', 'export', 'scheduled'],
  inlineEdit: { price: true, qty: true },
  validation: {},
  tags: { max: null, maxLength: 255 },
  drafts: 'catalog',
  editorHref: () => null,
  newListingHref: () => null,
  bulkEditHref: null,
  externalUrl: (row) => row.externalUrl,
  pull: () => ({ url: '/api/shopify/products?action=sync', method: 'POST' }),
  columnStateKey: 'listings.shopify.columns',
};

export default shopifyConfig;
