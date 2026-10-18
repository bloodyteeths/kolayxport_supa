// components/domain/listings/config/hepsiburada.ts — listings-grid Hepsiburada column of the config table.
// Rows = HB listings (id = hbSku). Staging goes through CatalogDraft (price, stock, dispatch time); content lives in
// HB's catalog. Listing page at `/app/hepsiburada-urunler/[id]`, create (catalog import) at `/new`.
import type { ListingsConfig } from './types';
import { PRICE_FILTER, STOCK_FILTER, statusFilter } from './shared';

export const hepsiburadaConfig: ListingsConfig = {
  marketplace: 'hepsiburada',
  route: '/app/hepsiburada-urunler',
  storeParam: null,
  columns: ['select', 'thumb', 'listing', 'price', 'qty', 'status', 'changes', 'brand', 'health', 'updated', 'category', 'barcode', 'actions'],
  // No health score for HB listings yet (content is HB's catalog): the column shows "Not scored yet".
  hiddenByDefault: ['category', 'barcode', 'health'],
  filters: [
    statusFilter(['active', 'sold_out', 'inactive']),
    { key: 'category', labelKey: 'listings.filter.category', type: 'select', pinned: true, searchable: true, optionsSource: 'categories' },
    STOCK_FILTER,
    { key: 'brand', labelKey: 'listings.filter.brand', type: 'select', searchable: true, optionsSource: 'brands' },
    PRICE_FILTER,
  ],
  views: ['all', 'active', 'not_sent', 'send_failed', 'sold_out', 'inactive'],
  defaultView: 'all',
  rowInlineAction: 'edit',
  rowActions: ['quickView', 'viewExternal', 'sendChange', 'scheduleSend', 'discardChanges'],
  bulkPrimary: 'changePrice',
  bulkActions: ['changeStock'],
  bulkOverflow: ['editInGrid', 'sendSelected', 'discardSelected', 'scheduleSend', 'exportSelected'],
  tools: ['findReplace', 'import', 'export', 'scheduled'],
  inlineEdit: { price: true, qty: true },
  validation: {},
  drafts: 'catalog',
  editorHref: (id) => `/app/hepsiburada-urunler/${encodeURIComponent(id)}`,
  newListingHref: () => '/app/hepsiburada-urunler/new',
  bulkEditHref: () => '/app/hepsiburada-urunler/bulk',
  externalUrl: (row) => row.externalUrl,
  pull: () => ({ url: '/api/hepsiburada/products?action=sync', method: 'POST' }),
  columnStateKey: 'listings.hepsiburada.columns',
};

export default hepsiburadaConfig;
