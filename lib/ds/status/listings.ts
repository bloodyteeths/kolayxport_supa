// lib/ds/status/listings.ts — listings-grid §3 status mapping (pure, unit-tested).
// Field names follow the Prisma models (EtsyListing.state, EbayListing.status/quantity,
// TrendyolProduct.approved/rejected/blacklisted/archived/onSale/quantity, WixProduct.visible/inStock/
// trackInventory/quantity, ShopifyProduct.status/trackInventory/totalInventory).
// TODO(M5 G0): confirm the eBay and Shopify raw `status` sets on Hetzner (`SELECT status, count(*) …`).

import { normalizeRaw, type ListingStatusKey } from './vocabulary';

export type ListingMarketplace = 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify';

export interface ListingStatusInput {
  /** Etsy `state`. */
  state?: string | null;
  /** eBay / Shopify `status`. */
  status?: string | null;
  quantity?: number | null;
  // Trendyol
  approved?: boolean | null;
  rejected?: boolean | null;
  blacklisted?: boolean | null;
  archived?: boolean | null;
  onSale?: boolean | null;
  // Wix
  visible?: boolean | null;
  inStock?: boolean | null;
  // Wix + Shopify
  trackInventory?: boolean | null;
  // Shopify
  totalInventory?: number | null;
}

const ETSY: Record<string, ListingStatusKey> = {
  active: 'active',
  draft: 'draft',
  inactive: 'inactive',
  expired: 'expired',
  sold_out: 'sold_out',
  soldout: 'sold_out',
  edit: 'inactive',
  removed: 'inactive',
};

export function listingStatus(row: ListingStatusInput, marketplace: ListingMarketplace): ListingStatusKey {
  switch (marketplace) {
    case 'etsy':
      return ETSY[normalizeRaw(row.state)] ?? 'inactive';
    case 'ebay': {
      const s = normalizeRaw(row.status);
      if (s === 'published') return (row.quantity ?? 0) > 0 ? 'active' : 'sold_out';
      if (s === 'ended') return 'inactive';
      return 'draft';
    }
    case 'trendyol':
      if (row.rejected || row.blacklisted) return 'rejected';
      if (!row.approved) return 'in_review';
      if (row.archived) return 'inactive';
      if (row.onSale) return (row.quantity ?? 0) === 0 ? 'sold_out' : 'active';
      return 'inactive';
    case 'wix':
      if (row.visible === false) return 'inactive';
      if (row.inStock === false || (row.trackInventory && (row.quantity ?? 0) === 0)) return 'sold_out';
      return 'active';
    case 'shopify': {
      const s = normalizeRaw(row.status);
      if (s === 'archived') return 'inactive';
      if (s === 'draft') return 'draft';
      if (row.trackInventory && (row.totalInventory ?? 0) === 0) return 'sold_out';
      return s === 'active' ? 'active' : 'inactive';
    }
    default:
      return 'inactive';
  }
}
