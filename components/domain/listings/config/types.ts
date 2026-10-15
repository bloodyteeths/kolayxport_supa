// components/domain/listings/config/types.ts — listings-grid §3 (M5 G0).
// One `ListingsConfig` per marketplace is the ONLY place marketplaces differ; `ListingsPage` has no
// marketplace-specific JSX (DS P4). Values live in `./{etsy,ebay,trendyol,wix,shopify}.ts` (G5).
// Static and serialisable except the href builders: labels are i18n keys, translated by the page.

import type { FilterDef } from '@/components/ds/toolbar/types';
import type {
  BuiltInViewKey,
  ListingColumnKey,
  ListingMarketplace,
  ListingRow,
  ListingsMarketplaceFilterKey,
} from '@/lib/listings/types';

export type { BuiltInViewKey, ListingColumnKey, ListingMarketplace };

/** Row `⋯` items (§6.1, §6.2). Draft-only items are shown only when the row has `sync`. */
export type RowActionKey =
  | 'quickView'
  | 'viewExternal'
  | 'copyListing'
  | 'copyToEbay'
  | 'copyToEtsy'
  | 'deactivate'
  | 'activate'
  | 'renew'
  | 'archive'
  /** Trendyol: restore an archived product (staged queued `unarchive`, sent with "Send N"). */
  | 'unarchive'
  | 'showInStore'
  | 'hideInStore'
  | 'delete'
  // draft rows
  | 'reviewDifferences'
  | 'sendChange'
  | 'sendDeletion'
  | 'scheduleSend'
  | 'discardChanges';

/** BulkActionBar items (§6.3). Every item stages; none writes live. */
export type BulkActionKey =
  | 'editInGrid'
  | 'changePrice'
  | 'changeStock'
  | 'addTags'
  | 'improveWithAi'
  | 'copyToEbay'
  | 'copyToEtsy'
  /** Etsy: queued `copy` into another of the seller's shops (only with 2+ shops; sent explicitly). */
  | 'copyToShop'
  /** Etsy: "Set field…" (shipping / return policy / processing / category / item details / materials / description / personalization / weight / size). */
  | 'setField'
  | 'sendSelected'
  | 'discardSelected'
  | 'scheduleSend'
  | 'exportSelected'
  | 'deactivate'
  | 'activate'
  | 'renew'
  | 'archive'
  | 'unarchive'
  | 'showInStore'
  | 'hideInStore'
  | 'addToCollection'
  | 'setStatus'
  | 'delete';

/** PageHeader `⋯` tools (§10). All but `export` are `?tool=` panels; `export` is a Modal. */
export type ToolKey = 'findReplace' | 'duplicates' | 'import' | 'export' | 'scheduled';
export const TOOL_URL_KEYS = ['findReplace', 'duplicates', 'import', 'scheduled'] as const satisfies readonly ToolKey[];

/** Filter keys a config can declare: the API filters, with `price` standing for `priceMin`+`priceMax`. */
export type ListingFilterKey =
  | 'status'
  | 'health'
  | Exclude<ListingsMarketplaceFilterKey, 'priceMin' | 'priceMax'>
  | 'price';

/**
 * Where a filter's options come from when they are not static. Resolved by the page (G5).
 * The health filter is static: each config passes its supported checks to `healthFilter(checks)` (shared.ts, §5).
 */
export type ListingFilterOptionsSource =
  | 'statuses' // the marketplace's reachable ListingStatusKeys (status.* labels)
  | 'sections' // Etsy: GET /api/clawd/etsy?action=get_shop_sections&shop_id=
  | 'collections' // Wix: GET /api/wix/collections
  | 'categories'
  | 'brands'
  | 'productTypes'
  | 'vendors'
  | 'conditions'
  | 'formats';

export type ListingFilterConfig = {
  key: ListingFilterKey;
  /** i18n key (full path, e.g. `listings.filter.section`). */
  labelKey: string;
  type: FilterDef['type'];
  /** First 3 pinned filters render as FilterButtons; the rest live in the FiltersSheet. */
  pinned?: boolean;
  searchable?: boolean;
  /** Static options (value + i18n key) … */
  options?: { value: string; labelKey: string }[];
  /** … or a dynamic source. */
  optionsSource?: ListingFilterOptionsSource;
  /** Range unit hint, e.g. currency of the store (resolved by the page when `'currency'`). */
  unit?: 'currency';
};

/** Header `⋯` links that leave the grid (e.g. Etsy "Activity" → /app/etsy-aktivite, BUILD_PLAN §7 item 6). */
export type ListingsHeaderLink = {
  key: 'activity';
  /** i18n key. */
  labelKey: string;
  /** Meaning key from `lib/ds/icons.ts` (e.g. `etsyActivity`). */
  icon?: string;
  href(storeId: string | null): string;
};

/** Pull ("Refresh from …", §9.2). Existing endpoints, unchanged. */
export type ListingsPullRequest = { url: string; method: 'POST' };
export type ListingsPullContext = { storeId: string | null; userId: string | null };

export type ListingsConfig = {
  marketplace: ListingMarketplace;
  /** Existing route, unchanged (e.g. `/app/etsy-listings`, `/app/trendyol-urunler`). */
  route: string;
  /** `?shop=` / `?site=` in the URL; null when the marketplace has one store. */
  storeParam: 'shop' | 'site' | null;
  /** Order = default order. */
  columns: ListingColumnKey[];
  hiddenByDefault: ListingColumnKey[];
  /** First 3 pinned. */
  filters: ListingFilterConfig[];
  views: BuiltInViewKey[];
  defaultView: BuiltInViewKey;
  rowInlineAction: 'edit';
  rowActions: RowActionKey[];
  bulkPrimary: BulkActionKey;
  /** Visible, max 4. */
  bulkActions: BulkActionKey[];
  bulkOverflow: BulkActionKey[];
  tools: ToolKey[];
  /** Whether the marketplace allows inline edit at all; per row, `ListingRow.editable` still decides. */
  inlineEdit: { price: boolean; qty: boolean };
  /** Inline/bulk validation (§8): Etsy price ≥ 0.20, qty 0–999. */
  validation: { priceMin?: number; qtyMax?: number };
  /** Add tags modal limits (§6.3): Etsy 13 × 20 chars; null = no limit. Omitted = marketplace has no tags. */
  tags?: { max: number | null; maxLength: number | null };
  /** Which staging adapter (§9.4). */
  drafts: 'etsy' | 'ebay' | 'catalog';
  /**
   * Full editor route. `null` = no full editor: `e`/✎ open the quick view.
   */
  editorHref(id: string, storeId: string | null): string | null;
  /** `null` = no create route on this marketplace yet. */
  newListingHref(storeId: string | null): string | null;
  /** "Edit in grid" (BulkGrid, M7); `null` hides "Bulk edit" / "Edit in grid". */
  bulkEditHref: ((storeId: string | null) => string) | null;
  /** "View on Etsy ↗"; adapters usually fill `row.externalUrl`, this is the fallback. */
  externalUrl(row: ListingRow): string | null;
  pull(ctx: ListingsPullContext): ListingsPullRequest;
  headerLinks?: ListingsHeaderLink[];
  /** localStorage key for the Columns menu (§8): `listings.<marketplace>.columns`. */
  columnStateKey: string;
};
