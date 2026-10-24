// components/domain/listings/config/etsy.ts — listings-grid §3 Etsy column of the config table.
import type { ListingsConfig } from './types';
import { ETSY_ACTIVITY_ROUTE, PHOTOS_FILTER, PRICE_FILTER, STOCK_FILTER, booleanFilter, healthFilter, statusFilter } from './shared';

const enc = encodeURIComponent;
const withShop = (path: string, storeId: string | null) => (storeId ? `${path}${path.includes('?') ? '&' : '?'}shop=${enc(storeId)}` : path);

export const etsyConfig: ListingsConfig = {
  marketplace: 'etsy',
  route: '/app/etsy-listings',
  storeParam: 'shop',
  columns: ['select', 'thumb', 'listing', 'price', 'qty', 'status', 'changes', 'health', 'updated', 'section', 'views', 'favorites', 'created', 'actions'],
  hiddenByDefault: ['section', 'views', 'favorites', 'created'],
  filters: [
    statusFilter(['active', 'draft', 'inactive', 'expired', 'sold_out']),
    { key: 'section', labelKey: 'listings.filter.section', type: 'select', pinned: true, searchable: true, optionsSource: 'sections' },
    healthFilter(['missing_photos', 'missing_tags', 'no_video', 'short_title']),
    booleanFilter('hasVideo', 'listings.filter.hasVideo'),
    booleanFilter('personalizable', 'listings.filter.personalizable'),
    PHOTOS_FILTER,
    STOCK_FILTER,
    PRICE_FILTER,
  ],
  views: ['all', 'active', 'not_sent', 'send_failed', 'needs_work', 'sold_out', 'inactive'],
  defaultView: 'active',
  rowInlineAction: 'edit',
  // "Copy to eBay" opens the eBay creator prefilled from this listing (crosslistCreateHref, lib/listings/legacyHandoff.ts).
  rowActions: [
    'quickView',
    'viewExternal',
    'copyListing',
    'copyToEbay',
    'reviewDifferences',
    'sendChange',
    'scheduleSend',
    'discardChanges',
    'sendDeletion',
    'deactivate',
    'activate',
    'renew',
    'delete',
  ],
  bulkPrimary: 'editInGrid',
  bulkActions: ['changePrice', 'addTags', 'setField', 'improveWithAi'],
  bulkOverflow: ['categoryAttrs', 'aiText', 'applyTemplate', 'editVariations', 'sendSelected', 'discardSelected', 'scheduleSend', 'exportSelected', 'copyToShop', 'deactivate', 'activate', 'renew', 'delete'],
  tools: ['findReplace', 'duplicates', 'import', 'export', 'scheduled'],
  inlineEdit: { price: true, qty: true },
  validation: { priceMin: 0.2, qtyMax: 999 },
  tags: { max: 13, maxLength: 20 },
  drafts: 'etsy',
  // listing-editor §1 routes (M6).
  editorHref: (id, storeId) => withShop(`/app/etsy-listings/${enc(id)}`, storeId),
  newListingHref: (storeId) => withShop('/app/etsy-listings/new', storeId),
  // bulk-grid.md (M7): "Bulk edit" / "Edit in grid".
  bulkEditHref: (storeId) => withShop('/app/etsy-listings/bulk', storeId),
  externalUrl: (row) => row.externalUrl ?? `https://www.etsy.com/listing/${enc(row.id)}`,
  pull: ({ storeId }) => ({ url: `/api/clawd/etsy?action=sync_listings&shop_id=${enc(storeId ?? '')}`, method: 'POST' }),
  headerLinks: [
    {
      key: 'activity',
      labelKey: 'listings.tools.activity',
      icon: 'etsyActivity',
      href: (storeId) => withShop(ETSY_ACTIVITY_ROUTE, storeId),
    },
  ],
  columnStateKey: 'listings.etsy.columns',
};

export default etsyConfig;
