/**
 * Store identity: one place that turns the free-text `Order.marketplace` into a canonical
 * marketplace + shop name (CRITIQUE C5, BUILD_PLAN §3).
 *
 * Owner: created by M3 orders-G1 (Store column, store filter logos). Overview (M8) and
 * Reports (M9, finance-analytics §6.1) import it; nobody re-implements it.
 *
 * `Order.marketplace` holds a marketplace name ("Etsy", "Trendyol", "Amazon"), an Etsy shop
 * name for direct Etsy sync ("BelleCoutureGifts"), "Manual" for manual orders, or a legacy
 * aggregator name ("Shippo", "Veeqo"). Etsy shop names come from the user's `EtsyShop.shopName`
 * list, which replaces the hard-coded shop lists in analytics/finance.
 *
 * Pure, client- and server-safe.
 */
import type { MarketplaceKey } from '@/components/ds/data/types';
import { isEtsyOrderSync } from '@/lib/utils/etsyDetection';

export type CanonicalMarketplace = MarketplaceKey | 'manual' | 'other';

export interface CanonicalStore {
  /** Stable grouping key: `etsy`, `etsy:bellecouturegifts`, `trendyol`, `manual`, `other:veeqo`, `other`. */
  key: string;
  marketplace: CanonicalMarketplace;
  /** The shop's own name when `Order.marketplace` is a shop name or a legacy aggregator, else null. */
  shopName: string | null;
}

const MARKETPLACES: readonly MarketplaceKey[] = ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'n11'];

/** Substring → marketplace, checked in order after the exact match ("Amazon Channel", "eBay US"). */
const CONTAINS: ReadonlyArray<[string, MarketplaceKey]> = [
  ['hepsiburada', 'hepsiburada'],
  ['trendyol', 'trendyol'],
  ['amazon', 'amazon'],
  ['ebay', 'ebay'],
  ['shopify', 'shopify'],
  ['wix', 'wix'],
];

const lower = (s: string) => s.trim().toLocaleLowerCase('en');

function hasShop(names: ReadonlySet<string> | readonly string[], raw: string): boolean {
  const target = lower(raw);
  for (const n of names as Iterable<string>) {
    if (typeof n === 'string' && n.trim() && lower(n) === target) return true;
  }
  return false;
}

/**
 * Canonical store for an order's `marketplace` value.
 * `etsyShopNames`: the user's `EtsyShop.shopName` values (case-insensitive match).
 */
export function canonicalStore(
  orderMarketplace: string | null | undefined,
  etsyShopNames: ReadonlySet<string> | readonly string[] = [],
): CanonicalStore {
  const raw = String(orderMarketplace ?? '').trim();
  if (!raw) return { key: 'other', marketplace: 'other', shopName: null };
  const l = lower(raw);

  if (l === 'manual') return { key: 'manual', marketplace: 'manual', shopName: null };
  if ((MARKETPLACES as readonly string[]).includes(l)) return { key: l, marketplace: l as MarketplaceKey, shopName: null };

  if (hasShop(etsyShopNames, raw)) return { key: `etsy:${l}`, marketplace: 'etsy', shopName: raw };
  if (isEtsyOrderSync(raw)) return { key: `etsy:${l}`, marketplace: 'etsy', shopName: raw };

  for (const [needle, mp] of CONTAINS) {
    if (l.includes(needle)) return { key: mp, marketplace: mp, shopName: null };
  }
  // Legacy aggregators and unknown names keep their own name as the label.
  return { key: `other:${l}`, marketplace: 'other', shopName: raw };
}

/** true when the store is a marketplace with a logo in `lib/ds/logos.ts` (manual/other render text only). */
export function isMarketplaceStore(store: CanonicalStore): store is CanonicalStore & { marketplace: MarketplaceKey } {
  return store.marketplace !== 'manual' && store.marketplace !== 'other';
}
