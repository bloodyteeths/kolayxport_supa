/**
 * Legacy eBay listings: listings created on eBay itself (Trading API / Seller Hub), not through the Inventory API.
 * They are cached in EbayListing with `isLegacy = true` and the synthetic SKU `legacy-<itemId>` (pages/api/clawd/ebay.ts
 * writes both together, so the prefix alone identifies them on draft rows, which have no relation to EbayListing).
 *
 * The Inventory API cannot edit them, so KolayXport never stages or sends changes for them. ISOMORPHIC: no server imports.
 */

export const LEGACY_EBAY_SKU_PREFIX = 'legacy-';

/** Machine code and full next-intl key (root namespace) of the refusal. */
export const EBAY_LEGACY_LISTING_CODE = 'EBAY_LEGACY_LISTING';
export const EBAY_LEGACY_LISTING_KEY = 'ebay.draftSync.legacyListing';

/** True for the synthetic `legacy-<itemId>` SKU of a listing created on eBay. */
export function isLegacyEbaySku(sku: unknown): boolean {
  return typeof sku === 'string' && sku.startsWith(LEGACY_EBAY_SKU_PREFIX) && sku.length > LEGACY_EBAY_SKU_PREFIX.length;
}

/** From an EbayListing row: its `isLegacy` flag wins, the SKU prefix is the fallback. */
export function isLegacyEbayListing(row: { isLegacy?: boolean | null; sku?: string | null } | null | undefined): boolean {
  if (!row) return false;
  return row.isLegacy === true || isLegacyEbaySku(row.sku);
}

/** The eBay item id of a legacy SKU (`legacy-123` → `123`), or null. */
export function legacyEbayItemId(sku: unknown): string | null {
  return isLegacyEbaySku(sku) ? (sku as string).slice(LEGACY_EBAY_SKU_PREFIX.length) : null;
}
