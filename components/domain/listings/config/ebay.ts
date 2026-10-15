// components/domain/listings/config/ebay.ts — listings-grid §3 eBay column of the config table.
import type { ListingsConfig } from './types';
import { PHOTOS_FILTER, PRICE_FILTER, STOCK_FILTER, healthFilter, statusFilter } from './shared';

const enc = encodeURIComponent;

/** eBay Inventory API `ConditionEnum` values the cache stores (labels: `listings.condition.<VALUE>`). */
export const EBAY_CONDITIONS = [
  'NEW',
  'LIKE_NEW',
  'NEW_OTHER',
  'NEW_WITH_DEFECTS',
  'CERTIFIED_REFURBISHED',
  'SELLER_REFURBISHED',
  'USED_EXCELLENT',
  'USED_VERY_GOOD',
  'USED_GOOD',
  'USED_ACCEPTABLE',
  'FOR_PARTS_OR_NOT_WORKING',
] as const;

export const ebayConfig: ListingsConfig = {
  marketplace: 'ebay',
  route: '/app/ebay-listings',
  storeParam: null,
  columns: ['select', 'thumb', 'listing', 'price', 'qty', 'status', 'changes', 'condition', 'health', 'updated', 'category', 'format', 'created', 'actions'],
  hiddenByDefault: ['category', 'format', 'created'],
  filters: [
    statusFilter(['active', 'sold_out', 'inactive', 'draft']),
    {
      key: 'condition',
      labelKey: 'listings.filter.condition',
      type: 'select',
      pinned: true,
      options: EBAY_CONDITIONS.map((c) => ({ value: c, labelKey: `listings.condition.${c}` })),
    },
    healthFilter(['missing_photos', 'short_title']),
    { key: 'category', labelKey: 'listings.filter.category', type: 'select', searchable: true, optionsSource: 'categories' },
    {
      key: 'format',
      labelKey: 'listings.filter.format',
      type: 'select',
      options: [
        { value: 'FIXED_PRICE', labelKey: 'listings.format.FIXED_PRICE' },
        { value: 'AUCTION', labelKey: 'listings.format.AUCTION' },
      ],
    },
    PHOTOS_FILTER,
    STOCK_FILTER,
    PRICE_FILTER,
  ],
  views: ['all', 'active', 'not_sent', 'send_failed', 'needs_work', 'sold_out', 'inactive'],
  defaultView: 'all',
  rowInlineAction: 'edit',
  // "Copy to Etsy" opens /app/etsy-listings/new?crosslist=ebay:<sku> (crosslistEbayToEtsy.ts).
  rowActions: [
    'quickView',
    'viewExternal',
    'copyListing',
    'copyToEtsy',
    'reviewDifferences',
    'sendChange',
    'scheduleSend',
    'discardChanges',
    'sendDeletion',
    'deactivate',
    'activate',
    'delete',
  ],
  bulkPrimary: 'editInGrid',
  bulkActions: ['changePrice', 'changeStock', 'improveWithAi'],
  bulkOverflow: ['sendSelected', 'discardSelected', 'scheduleSend', 'exportSelected', 'deactivate', 'activate', 'delete'],
  tools: ['findReplace', 'duplicates', 'import', 'export', 'scheduled'],
  inlineEdit: { price: true, qty: true },
  validation: {},
  drafts: 'ebay',
  editorHref: (id) => `/app/ebay-listings/${enc(id)}`,
  newListingHref: () => '/app/ebay-listings/new',
  bulkEditHref: () => '/app/ebay-listings/bulk',
  externalUrl: (row) => row.externalUrl,
  pull: ({ userId }) => ({
    url: `/api/clawd/ebay?action=sync_listings&user_id=${enc(userId ?? '')}&marketplace_id=EBAY_US`,
    method: 'POST',
  }),
  columnStateKey: 'listings.ebay.columns',
};

export default ebayConfig;
