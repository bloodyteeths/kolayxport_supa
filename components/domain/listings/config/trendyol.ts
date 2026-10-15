// components/domain/listings/config/trendyol.ts — listings-grid §3 Trendyol column of the config table.
// Staging goes through CatalogDraft (G4). No full editor until M6b: `e` opens the quick view `xl` (CRITIQUE X3).
import type { ListingsConfig } from './types';
import { PHOTOS_FILTER, PRICE_FILTER, STOCK_FILTER, healthFilter, statusFilter } from './shared';

export const trendyolConfig: ListingsConfig = {
  marketplace: 'trendyol',
  route: '/app/trendyol-urunler',
  storeParam: null,
  columns: ['select', 'thumb', 'listing', 'price', 'qty', 'status', 'changes', 'brand', 'health', 'updated', 'category', 'listPrice', 'barcode', 'created', 'actions'],
  hiddenByDefault: ['category', 'listPrice', 'barcode', 'created'],
  filters: [
    statusFilter(['active', 'sold_out', 'inactive', 'in_review', 'rejected']),
    { key: 'category', labelKey: 'listings.filter.category', type: 'select', pinned: true, searchable: true, optionsSource: 'categories' },
    healthFilter(['missing_photos', 'short_title']),
    { key: 'brand', labelKey: 'listings.filter.brand', type: 'select', searchable: true, optionsSource: 'brands' },
    PHOTOS_FILTER,
    STOCK_FILTER,
    PRICE_FILTER,
    {
      key: 'approval',
      labelKey: 'listings.filter.approval',
      type: 'select',
      options: [
        { value: 'approved', labelKey: 'listings.approval.approved' },
        { value: 'in_review', labelKey: 'status.listing.in_review' },
        { value: 'rejected', labelKey: 'status.listing.rejected' },
      ],
    },
  ],
  views: ['all', 'active', 'not_sent', 'send_failed', 'needs_work', 'sold_out', 'inactive', 'review'],
  defaultView: 'all',
  rowInlineAction: 'edit',
  // A staged Archive is a queued removal (CatalogDraft `hasQueuedDelete`): it is excluded from every bulk send and
  // goes out only through "Send archive…" with type-to-confirm (`sendDeletion`, labelled by the page's removal kind).
  rowActions: ['quickView', 'viewExternal', 'sendChange', 'scheduleSend', 'discardChanges', 'sendDeletion', 'archive'],
  bulkPrimary: 'changePrice',
  bulkActions: ['changeStock', 'archive'],
  bulkOverflow: ['editInGrid', 'sendSelected', 'discardSelected', 'scheduleSend', 'exportSelected'],
  tools: ['findReplace', 'duplicates', 'import', 'export', 'scheduled'],
  inlineEdit: { price: true, qty: true },
  validation: {},
  drafts: 'catalog',
  editorHref: () => null,
  newListingHref: () => null,
  bulkEditHref: () => '/app/trendyol-urunler/bulk', // M7 BulkGrid (bulk-grid §1.2 v1: title/price/qty via CatalogDraft); flag `bulk`
  externalUrl: (row) => row.externalUrl,
  pull: () => ({ url: '/api/trendyol/products?action=sync', method: 'POST' }),
  columnStateKey: 'listings.trendyol.columns',
};

export default trendyolConfig;
