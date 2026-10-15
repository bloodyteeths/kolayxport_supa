/**
 * `GET /api/overview/summary` response contract (overview.md §4). Owned by M8 overview-G3;
 * the client hook (G4) and the Overview UI (G6) import these types, nothing else redefines them.
 *
 * Pure types + constants: client- and server-safe (no Prisma, no I/O).
 *
 * Conventions:
 * - Every section is `null` when it failed; its key is then listed in `errors`.
 * - Dates are ISO 8601 strings (UTC). Day keys (`series.days[].date`) are `YYYY-MM-DD` in `tz`.
 * - `listingHealth` is OMITTED (key absent, not in `errors`) when the listing scorer module is
 *   unavailable (overview §4.1 "until M1 ships"); `null` + `errors:['listingHealth']` when it failed
 *   or the account has more than LISTING_HEALTH_CAP active Etsy listings.
 */

export type OverviewChannel = 'etsy' | 'ebay' | 'amazon' | 'shopify' | 'wix' | 'trendyol' | 'hepsiburada' | 'other';
/** Alias under the name the spec uses. */
export type Channel = OverviewChannel;

export const OVERVIEW_CHANNELS: readonly OverviewChannel[] = ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'other'];

export type SectionKey =
  | 'toShip'
  | 'labels'
  | 'tracking'
  | 'drafts'
  | 'listingHealth'
  | 'usage'
  | 'kpis'
  | 'series'
  | 'topSellers'
  | 'setup'
  | 'meta';

export const SECTION_KEYS: readonly SectionKey[] = [
  'toShip', 'labels', 'tracking', 'drafts', 'listingHealth', 'usage', 'kpis', 'series', 'topSellers', 'setup', 'meta',
];

/** Sections that feed the attention queue (overview §3.2 "Partial"). */
export const QUEUE_SECTION_KEYS: readonly SectionKey[] = ['usage', 'labels', 'toShip', 'drafts', 'tracking', 'listingHealth'];

export type OverviewCurrency = 'TRY' | 'USD';

export const OVERVIEW_CURRENCIES: readonly OverviewCurrency[] = ['TRY', 'USD'];

/** Above this many active Etsy listings the health section returns null + error instead of a partial count. */
export const LISTING_HEALTH_CAP = 5000;

/** Listing score below this = "needs work" (ScoreBand `needs_work`). */
export const LISTING_HEALTH_THRESHOLD = 50;

export interface OrderRef {
  id: string;
  orderNumber: string;
  /** NOT "marketplaceKey" (clashes with Order.marketplaceKey). From `canonicalStore()`. */
  channel: OverviewChannel;
  /** First OrderItem's productName (HTML entities decoded). */
  itemName: string | null;
  /** First OrderItem's image (entities decoded, placeholder dropped). */
  image: string | null;
  /** Effective ship-by (`EFFECTIVE_SHIP_BY_SQL`), ISO. */
  shipBy: string | null;
}

export interface DraftRef {
  draftId: string;
  /** Etsy listing id (BigInt as string); eBay `listingId ?? sku`. */
  listingId: string;
  title: string | null;
  thumb: string | null;
  /** `lastSyncError`, ≤140 chars, never raw JSON. */
  error: string | null;
}

export interface DraftBucket {
  draft: number;
  failed: number;
  conflict: number;
  syncing: number;
  firstConflict: DraftRef | null;
  firstFailed: DraftRef | null;
}

export type UsageBlockedReason = 'trial' | 'noSubscription' | 'planLimit' | 'invalidPlan';

export interface UsageMeterSnapshot {
  used: number;
  /** null = unlimited. */
  limit: number | null;
}

export interface UsageSnapshot {
  plan: string | null;
  status: string | null;
  /** shopify_free (billingProvider or an active ShopifyShop): never show Stripe/pricing copy. */
  hideBilling: boolean;
  trialEndsAt: string | null;
  resetsAt: string | null;
  orderSync: UsageMeterSnapshot;
  label: UsageMeterSnapshot;
  nearLimit: boolean;
  blocked: null | UsageBlockedReason;
}

export interface Revenue7d {
  /** Sum in `currency` of the converted currencies; null when no rates exist and other currencies were sold (see perCurrency). */
  value: number | null;
  previous: number | null;
  currency: OverviewCurrency;
  /** true when any currency other than `currency` was converted (show "≈" + FX tooltip). */
  approx: boolean;
  ratesAsOf: string | null;
  ratesStale: boolean;
  /** Currencies with no rate: excluded from BOTH periods. `orders` = their orders in the current 7 days. */
  unconverted: { currency: string; orders: number }[];
  /** Current-period totals per currency (unconverted); the display fallback when `value` is null. */
  perCurrency: { currency: string; value: number }[];
}

export interface OverviewSummary {
  generatedAt: string;
  requestId: string;
  tz: string;
  currency: OverviewCurrency;
  errors: SectionKey[];
  /** User.lastSyncedAt (section 'meta'). */
  ordersLastSyncedAt: string | null;
  toShip: null | {
    count: number;
    overdue: number;
    /** Ship-by later than now and before the end of today in `tz` (not double-counted with overdue). */
    dueToday: number;
    withoutShipBy: number;
    oldestOrderedAt: string | null;
    firstOverdue: OrderRef | null;
  };
  labels: null | { failed: number; first: (OrderRef & { error: string | null }) | null };
  /** Etsy orders only. */
  tracking: null | { notSent: number; failed: number; first: OrderRef | null };
  drafts: null | { etsy: DraftBucket; ebay: DraftBucket };
  listingHealth?: null | {
    etsy: {
      needsWork: number;
      scored: number;
      worst: { listingId: string; title: string; thumb: string | null; score: number } | null;
    };
  };
  usage: null | UsageSnapshot;
  kpis: null | {
    revenue7d: Revenue7d;
    orders7d: { value: number; previous: number };
  };
  series: null | { days: { date: string; orders: number }[]; previousTotal: number };
  topSellers: null | {
    items: { key: string; name: string; image: string | null; units: number; orders: number; channel: OverviewChannel }[];
  };
  setup: null | { hasOrders: boolean; senderComplete: boolean; hasLabel: boolean };
}

/** Error body for 401 / 405 / 500. */
export interface OverviewSummaryError {
  error: string;
  requestId?: string;
}
