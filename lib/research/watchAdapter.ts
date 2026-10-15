// lib/research/watchAdapter.ts — Shop tracker data (research.md §8, §10 "watches", §12; RR §4.3, §6.3 guard 7). R3-A.
//
// One read model over every kind of research watch:
//   - `ResearchWatch` rows (BR-1c migration): Etsy shops, saved queries, Trendyol products (R4).
//   - Read-only adapter over the existing tables, no data move: `EbayTrackedSeller` (+ its `EbayTrackedProduct` /
//     `EbayPriceSnapshot` rows for measured sales) and `AmazonTrackedProduct` (ASIN watch).
//   - "Watch an eBay item" (type `ebayItem`): one `EbayTrackedProduct` row (lib/research/ebayItemTracker.ts writes the
//     row, its first reading and the daily `EbayPriceSnapshot`s; this adapter reads them).
//
// Data rules (honest numbers):
//   - Sales/day is **Measured** only from ≥ 2 readings of Etsy's `transaction_sold_count` (Δcount / Δdays). Before
//     the second reading the value is null with `research.shops.firstReading`.
//   - Guard 7: a reading-to-reading rate < 0 or > 50 × the 30-day median rate is dropped and flagged (a gap in the
//     chart, never a spike).
//   - Prices only through `summarizePrices` (median, p25–p75, n, quality). No mean anywhere.
//   - Lifetime counters are labelled "(all time)" by the UI (`soldItemsAllTime`), never shown as a rate.
//
// Storage:
//   - `ResearchSnapshot` (shared across users: one reading per refId per UTC day) holds small counters only
//     (`EtsyShopSnapshotMetrics` / `QuerySnapshotMetrics`).
//   - The per-listing arrays of a shop reading (≤ 500 newest active listings) go to the shared `ResearchCache`
//     (`userId = '__public__'`, key `public:etsy:shopListings:<shopId>:<YYYY-MM-DD>`, 10 days) so the snapshot table
//     stays small and the existing `research-cache-prune` job removes them.
//
// Guards until the backend reports the migrations/types deployed:
//   - BR-1c missing (no `prisma.researchWatch` / `prisma.researchSnapshot` delegate, or P2021/P2022): the list still
//     returns the legacy eBay/Amazon rows with `available: false`; writes to `ResearchWatch` answer 503
//     `{ error: 'unavailable', key: 'research.shops.unavailable' }`; the cron returns `{ skipped: 'unavailable' }`.
//   - BR-7 missing (notification types not in `lib/notificationCenter/registry.ts`): alert rules are stored but no
//     notification is raised (`alertsAvailable: false`).
//   - Plan limit `limits.researchWatches` is not in `lib/billing` yet: `RESEARCH_WATCH_LIMITS` holds the D-R1 numbers.
//
// Client code must import from this file with `import type` only (it imports Prisma).

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { etsyFetch, etsyPublicHeaders, ETSY_API_BASE } from '@/lib/etsy/http';
import { EtsyPriority, canSpend, withEtsyBudget } from '@/lib/etsy/rateBudget';
import { notify, type NotificationType } from '@/lib/notifications';
import { isKnownType } from '@/lib/notificationCenter/registry';
import { entitlementFromSettings } from '@/lib/billing/entitlementCore';
import { isNeutralBilling } from '@/lib/billing/billingState';
import { isFeatureLockedError, requireFeature } from '@/lib/billing/requireFeature';
import type { PlanKey } from '@/lib/billing/types';
import { detectQuery } from './detectQuery';
import { EbayItemNotFoundError, isEbayItemId, trackEbayItem } from './ebayItemTracker';
import { median, summarizePrices, type PriceSummary } from './stats';
import {
  EtsyUpstreamError,
  ResearchBudgetError,
  SHOP_TTL_MS,
  cachedLive,
  etsyBudgetLimited,
  getEtsyListingDetails,
  isBudgetError,
  mapEtsyListing,
  mapEtsyShop,
  normalizeQuery,
  priceSummaryFor,
  readShared,
  searchEtsy,
  writeShared,
  type EtsyShopInfo,
} from './etsySearch';
import type { Guarded, MetricKind, ResearchMkt, SourceNoteProps } from './types';

// ─── Types (API contract; shared with the R3-B UI through `import type`) ────────────────────────────

export type WatchType = 'etsyShop' | 'ebaySeller' | 'ebayItem' | 'query' | 'asin' | 'trendyolProduct';
export const WATCH_TYPES: readonly WatchType[] = ['etsyShop', 'ebaySeller', 'ebayItem', 'query', 'asin', 'trendyolProduct'];
export function isWatchType(v: unknown): v is WatchType {
  return typeof v === 'string' && (WATCH_TYPES as readonly string[]).includes(v);
}

/** Which table the row lives in. Only `researchWatch` rows can be renamed or have alert rules. */
export type WatchSource = 'researchWatch' | 'ebayTrackedSeller' | 'ebayTrackedProduct' | 'amazonTrackedProduct';

/**
 * Alert rules (research.md §8.1 "Alerts (Switch ×3)"). `null` = the switch is off.
 * Defaults on create: new listings on, price drop > 10 % on, sales spike off (switching it on sets 2).
 */
export interface AlertRules {
  newListing: boolean;
  /** Fires when the shop's median listing price fell by more than this percent in ~7 days (5–90). */
  priceDropPct: number | null;
  /** Fires when the latest measured sales/day is ≥ this multiple of the shop's 30-day median (1.5–20). */
  salesSpikeX: number | null;
  /** R4 Price gap (`trendyolProduct`): margin above this percent (1–500). Stored only (RR §4.3 `marginOver`). */
  marginOver?: number | null;
}

export const DEFAULT_ALERT_RULES: AlertRules = { newListing: true, priceDropPct: 10, salesSpikeX: null };

export interface WatchPrice {
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** Prices used after exclusions. */
  n: number;
  currency: string;
  quality: PriceSummary['quality'];
}

export interface WatchShopInfo {
  name: string;
  url: string | null;
  iconUrl: string | null;
  /** ISO date the shop opened ("since 2021"). */
  openedAt: string | null;
  reviewCount: number | null;
  /** 0–5. */
  reviewAverage: number | null;
}

/**
 * Table metrics. Every value is a `Guarded` number: `value: null` or `guard.ok: false` renders "—" with
 * `guard.reasonKey` as the tooltip. `kind` says Measured / Estimate.
 */
export interface WatchMetrics {
  /** Sales per day over the last 7 days (Measured, Δ transaction_sold_count / Δdays; eBay: Δ soldQuantity of tracked items). */
  salesPerDay: Guarded<number>;
  /** Fraction vs the previous 7 days (0.22 = ▲ 22 %). */
  salesVsPrev: Guarded<number>;
  /** Active listings (Etsy shop) or matching listings (query). */
  active: Guarded<number>;
  /** Listings first created in the last 7 days (`original_creation_timestamp`, never the renew date). */
  new7d: Guarded<number>;
  /** Fraction change of the median listing price vs the reading ~7 days earlier (-0.06 = ▼ 6 %). */
  priceChange: Guarded<number>;
  /** Robust summary of the latest reading's listing prices (shop currency). */
  price: WatchPrice | null;
  /** eBay: tracked items sold at least once — lifetime counter, render "(all time)", never a rate. null elsewhere. */
  soldItemsAllTime: number | null;
  /** Points dropped by guard 7 (negative or > 50× the 30-day median) in the last 30 days. */
  droppedPoints: number;
  /** Amazon: latest best-seller rank (Measured). */
  rank?: Guarded<number>;
}

export interface WatchSummary {
  /** `ResearchWatch.id`, or `ebaySeller.<id>` / `asin.<id>` for the legacy adapter rows. */
  id: string;
  type: WatchType;
  marketplace: ResearchMkt;
  /** Etsy shop id, eBay username, normalized query, ASIN, Trendyol product id. */
  refId: string;
  label: string;
  source: WatchSource;
  /** Shop / seller page (https). */
  url: string | null;
  iconUrl: string | null;
  /** `alerts` (+ label): `researchWatch` rows only. `remove`: every row (legacy rows are deactivated like the old untrack). */
  capabilities: { alerts: boolean; remove: boolean };
  /** Stored rules; defaults for legacy rows (their switches are disabled through `capabilities.alerts`). */
  alertRules: AlertRules;
  /** ISO. */
  createdAt: string;
  shop: WatchShopInfo | null;
  metrics: WatchMetrics;
  /** Readings in the last 31 days (ISO first/last; null = none yet). */
  snapshots: { count: number; first: string | null; last: string | null };
  /** Where the panel opens (`/app/research/shops?open=<id>`). */
  href: string;
  /** Set when the daily reading skips this watch (it is past the plan's watch limit, oldest watches first). */
  paused?: { reasonKey: string };
  /** `ebayItem` only: the item's latest reading (its own listed price, not a sample; sold = eBay's lifetime counter). */
  item?: WatchItemInfo;
}

export interface WatchItemInfo {
  /** Listed price at the latest reading (Measured). null = eBay showed no price. */
  price: number | null;
  currency: string;
  /** eBay's estimated sold quantity, all time. */
  soldAllTime: number | null;
  condition: string | null;
  seller: string | null;
}

export interface WatchQuota {
  /** Active `ResearchWatch` rows (legacy eBay/Amazon rows are not counted: they cost no Etsy budget). */
  used: number;
  /** null = unlimited (Enterprise). */
  limit: number | null;
  plan: PlanKey | null;
  /** false → never render "Compare plans" (shopify_free, Enterprise). */
  stripeUpsell: boolean;
}

/** `data` of `GET /api/research/watches`. */
export interface WatchesData {
  /** False until BR-1c is deployed: only legacy rows are listed and "Watch a shop" must be disabled. */
  available: boolean;
  /** False until BR-7 is deployed: the Alerts switches save but nothing is sent yet. */
  alertsAvailable: boolean;
  rows: WatchSummary[];
  quota: WatchQuota;
  /** UTC time the daily reading runs ("daily at 06:00"). */
  readingTimeUtc: string;
}

export interface SalesPoint {
  /** UTC date YYYY-MM-DD. */
  date: string;
  /** Sales per day measured for the reading that ended this day; null = no reading or dropped (gap). */
  value: number | null;
  /** True when guard 7 dropped the point. */
  dropped: boolean;
}

export interface WatchListingLite {
  id: string;
  title: string;
  url: string | null;
  /** Best effort (one shared-cached batch call); null when unknown. */
  thumbUrl: string | null;
  price: { amount: number; currency: string } | null;
  /** Lifetime (all time). */
  favorites: number;
  /** ISO of `original_creation_timestamp`. */
  createdAt: string | null;
  tags: string[];
}

export interface FastestListing extends WatchListingLite {
  /** Favorites gained between the latest reading and the one ~7 days earlier (Measured). */
  favoritesDelta7d: Guarded<number>;
  /** Share of the shop's favorites gain, used as the share of its sales: always an Estimate. */
  shareOfSales: Guarded<number>;
}

/** `data` of `GET /api/research/watches/[id]` (the SidePanel). */
export interface WatchDetail {
  watch: WatchSummary;
  /** Header: "since 2021 · ★ 4.9 (8.1k)". */
  shop: { since: string | null; rating: number | null; reviewCount: number | null };
  /** 30 days, oldest first; gaps are null (no reading, or dropped by guard 7 with `dropped: true`). */
  sales: SalesPoint[];
  /** Listings first created in the 7 days before the latest reading, newest first (≤ 24). */
  newListings: WatchListingLite[];
  /** ≤ 5, most favorites gained first. */
  fastest: FastestListing[];
  /** Tags this shop uses that none of the user's active Etsy listings use (≤ 20, most used first). */
  tagGap: Array<{ tag: string; count: number; share: number }>;
  /** False when the viewer has no connected Etsy shop to compare with. */
  tagGapAvailable: boolean;
  /** Listings in the latest reading (newest first, ≤ 500) and whether that was the whole shop. */
  listingsSampled: number;
  listingsComplete: boolean;
  /** `ebayItem` only: the item's listed price per UTC day (last 30 days, oldest first; null = no reading that day). */
  prices?: Array<{ date: string; value: number | null }>;
}

/** `data` of `POST /api/research/watches`. */
export interface WatchCreateData {
  watch: WatchSummary;
  quota: WatchQuota;
  /** false = it already existed and was active (200). */
  created: boolean;
}

export interface WatchCreateRequest {
  /** Pasted shop link / name / eBay seller / Etsy listing link / query text. Used when `refId` is absent. */
  input?: string;
  type?: WatchType;
  /** For `query` (etsy | ebay) and as a hint for bare names (`ebay` → eBay seller). */
  marketplace?: ResearchMkt;
  /** Direct reference with `type`: Etsy shop id **or shop name/link** (resolved), eBay username, ASIN, query text. */
  refId?: string;
  label?: string;
  alertRules?: Partial<AlertRules>;
}

export interface WatchPatchRequest {
  label?: string;
  alertRules?: Partial<AlertRules>;
  /** true re-activates (quota checked). Removing is DELETE. */
  isActive?: boolean;
}

export type WatchErrorCode =
  | 'unauthorized' | 'bad_request' | 'not_found' | 'method_not_allowed' | 'rate_limited' | 'server_error'
  | 'unavailable' | 'quota_exceeded' | 'read_only' | 'unsupported' | 'budget';

export interface WatchErrorBody {
  error: WatchErrorCode;
  /** i18n key (namespace `research`). */
  key?: string;
  used?: number;
  limit?: number | null;
}

/** Snapshot metrics stored in `ResearchSnapshot.metrics` for an Etsy shop (small: counters only). */
export interface EtsyShopSnapshotMetrics {
  v: 1;
  kind: 'etsyShop';
  shopId: string;
  name: string;
  url: string | null;
  iconUrl: string | null;
  /** Seconds. */
  createdAt: number | null;
  transactionSoldCount: number | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  activeCount: number | null;
  currency: string | null;
  /** Listings fetched (newest first, ≤ MAX_SNAPSHOT_LISTINGS). */
  listingsN: number;
  listingsComplete: boolean;
  /** Fetched listings first created in the 7 days before this reading. */
  new7d: number;
  /** Seconds; the oldest fetched listing (new7d is a lower bound when it is inside the 7 days). */
  oldestFetchedCreatedAt: number | null;
  price: WatchPrice | null;
}

export interface QuerySnapshotMetrics {
  v: 1;
  kind: 'query';
  query: string;
  total: number;
  price: WatchPrice | null;
}

export type SnapshotMetrics = EtsyShopSnapshotMetrics | QuerySnapshotMetrics;

/** Compact listing stored in the shared listings cache of a shop reading. */
export interface SnapListing {
  id: string;
  t: string;
  p: number | null;
  c: string;
  f: number;
  /** `original_creation_timestamp`, seconds. */
  cr: number | null;
  tags: string[];
  url: string | null;
}

export class WatchError extends Error {
  constructor(readonly status: number, readonly body: WatchErrorBody) {
    super(body.key || body.error);
    this.name = 'WatchError';
  }
}

/** Maps a thrown error to the JSON error response (WatchError → its status/body; anything else → 500). */
export function sendWatchError(res: { status: (c: number) => { json: (b: unknown) => unknown } }, err: unknown, scope: string) {
  if (err instanceof WatchError) return res.status(err.status).json(err.body);
  if (isFeatureLockedError(err)) return res.status(402).json(err.body());
  logger.error(`[research/watches] ${scope} failed`, err as Error);
  return res.status(500).json({ error: 'server_error' } satisfies WatchErrorBody);
}

export function parseJsonBody(raw: unknown): unknown {
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return null; } }
  return raw;
}

// ─── Constants ──────────────────────────────────────────────────────────────────────────────────────

export const DAY_MS = 86_400_000;
/** D-R1 (BUILD_PLAN §8): Trial 3 · Starter 10 · Growth 25 · Pro 50 · Enterprise ∞ · shopify_free 10. */
export const RESEARCH_WATCH_LIMITS: Readonly<Record<PlanKey, number | null>> = {
  trial: 3, starter: 10, growth: 25, pro: 50, enterprise: null, shopify_free: 10,
};
export const MAX_SNAPSHOT_LISTINGS = 500;
export const LISTINGS_CACHE_TTL_MS = 10 * DAY_MS;
export const SERIES_DAYS = 30;
export const READ_WINDOW_DAYS = 31;
/** Guard 7 multiple of the 30-day median rate. */
export const SPIKE_GUARD_X = 50;
export const SNAPSHOT_RETENTION_DAYS = 400;
export const READING_TIME_UTC = '06:00';
export const MAX_LABEL = 80;
export const MAX_QUERY = 120;
export const RESEARCH_ALERT_TYPES = ['researchShopNewListings', 'researchShopPriceDrop', 'researchShopSalesSpike'] as const;
export type ResearchAlertType = (typeof RESEARCH_ALERT_TYPES)[number];

const MKT_OF: Record<WatchType, ResearchMkt> = {
  etsyShop: 'etsy', ebaySeller: 'ebay', ebayItem: 'ebay', asin: 'amazon', trendyolProduct: 'trendyol', query: 'etsy',
};

// ─── Guarded helpers ────────────────────────────────────────────────────────────────────────────────

export function ok(value: number, kind: MetricKind = 'measured', reasonKey?: string, reasonParams?: Record<string, string | number>): Guarded<number> {
  return { value, kind, guard: { ok: true, ...(reasonKey ? { reasonKey } : {}), ...(reasonParams ? { reasonParams } : {}) } };
}
export function na(reasonKey: string, kind: MetricKind = 'measured', reasonParams?: Record<string, string | number>): Guarded<number> {
  return { value: null, kind, guard: { ok: false, reasonKey, ...(reasonParams ? { reasonParams } : {}) } };
}

const NA_METRICS = (reasonKey: string): WatchMetrics => ({
  salesPerDay: na(reasonKey), salesVsPrev: na(reasonKey), active: na(reasonKey), new7d: na(reasonKey), priceChange: na(reasonKey), price: null,
  soldItemsAllTime: null, droppedPoints: 0,
});

const toMs = (d: Date | string | number): number => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d));
export const utcDay = (d: Date | string | number): string => new Date(toMs(d)).toISOString().slice(0, 10);
const startOfUtcDay = (ms: number): Date => new Date(Date.parse(`${utcDay(ms)}T00:00:00.000Z`));
const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ─── Delegates (BR-1c guard) ────────────────────────────────────────────────────────────────────────

export interface ResearchWatchRow {
  id: string;
  userId: string;
  type: string;
  marketplace: string;
  refId: string;
  label: string;
  alertRules: unknown;
  isActive: boolean;
  createdAt: Date;
}
export interface ResearchSnapshotRow {
  id: string;
  type: string;
  marketplace: string;
  refId: string;
  takenAt: Date;
  metrics: unknown;
}

type Delegate = {
  findMany: (args: any) => Promise<any[]>;
  findFirst: (args: any) => Promise<any | null>;
  findUnique?: (args: any) => Promise<any | null>;
  create: (args: any) => Promise<any>;
  update?: (args: any) => Promise<any>;
  count?: (args: any) => Promise<number>;
  deleteMany?: (args: any) => Promise<{ count: number }>;
};

function delegate(name: 'researchWatch' | 'researchSnapshot'): Delegate | null {
  const d = (prisma as unknown as Record<string, unknown>)[name] as Delegate | undefined;
  return d && typeof d.findMany === 'function' && typeof d.create === 'function' ? d : null;
}
export const watchDelegate = () => delegate('researchWatch');
export const snapshotDelegate = () => delegate('researchSnapshot');
export function watchesAvailable(): boolean {
  return watchDelegate() !== null && snapshotDelegate() !== null;
}

/** Missing table/column (client generated before the migration ran on this DB). */
export function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'P2021' || code === 'P2022';
}
const isUniqueError = (err: unknown) => (err as { code?: string } | null)?.code === 'P2002';

export const UNAVAILABLE = (): WatchError => new WatchError(503, { error: 'unavailable', key: 'research.shops.unavailable' });

/** BR-7: true once every research alert type is in the notification registry. */
export function alertsAvailable(): boolean {
  return RESEARCH_ALERT_TYPES.every((t) => isKnownType(t));
}

// ─── Pure: input detection and validation ──────────────────────────────────────────────────────────

export type WatchTarget =
  | { type: 'etsyShop'; shopId?: string; shopName?: string; fromListingId?: string }
  | { type: 'ebaySeller'; seller: string }
  | { type: 'ebayItem'; itemId: string; label: string | null }
  | { type: 'query'; text: string; marketplace: 'etsy' | 'ebay' }
  | { type: 'trendyolProduct'; productId: string; label: string | null }
  | { type: 'asin'; asin: string };

const ETSY_SHOP_NAME = /^[A-Za-z0-9]{2,40}$/;
const ETSY_ID = /^\d{1,20}$/;
const EBAY_SELLER = /^[A-Za-z0-9._*-]{1,64}$/;

/**
 * "Watch a shop" input → target (marketplace auto-detected). Returns null when the input cannot be a watch.
 * An explicit `type` wins; a bare name is an Etsy shop unless `marketplace: 'ebay'` (eBay seller).
 */
export function detectWatchTarget(input: string, hint: { type?: WatchType; marketplace?: ResearchMkt } = {}): WatchTarget | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (hint.type === 'query') {
    const text = raw.replace(/\s+/g, ' ').slice(0, MAX_QUERY);
    return { type: 'query', text, marketplace: hint.marketplace === 'ebay' ? 'ebay' : 'etsy' };
  }
  const d = detectQuery(raw);
  switch (d.kind) {
    case 'etsyShop':
      return hint.type && hint.type !== 'etsyShop' ? null : ETSY_SHOP_NAME.test(d.shopName) ? { type: 'etsyShop', shopName: d.shopName } : null;
    case 'etsyListing':
      return hint.type && hint.type !== 'etsyShop' ? null : { type: 'etsyShop', fromListingId: d.listingId };
    case 'ebaySeller':
      return hint.type && hint.type !== 'ebaySeller' ? null : EBAY_SELLER.test(d.seller) ? { type: 'ebaySeller', seller: d.seller } : null;
    case 'trendyolProduct':
      return hint.type && hint.type !== 'trendyolProduct' ? null : { type: 'trendyolProduct', productId: d.productId, label: d.slugTitle };
    case 'amazonAsin':
      return hint.type && hint.type !== 'asin' ? null : { type: 'asin', asin: d.asin };
    case 'ebayItem':
      return hint.type && hint.type !== 'ebayItem' ? null : { type: 'ebayItem', itemId: d.itemId, label: d.slugTitle };
    case 'text': {
      const t = d.text;
      const wantEbay = hint.type === 'ebaySeller' || (!hint.type && hint.marketplace === 'ebay');
      if (wantEbay) return EBAY_SELLER.test(t) ? { type: 'ebaySeller', seller: t } : null;
      if (hint.type === 'ebayItem') return isEbayItemId(t) ? { type: 'ebayItem', itemId: t, label: null } : null;
      if (hint.type === 'asin') return /^[A-Z0-9]{10}$/i.test(t) ? { type: 'asin', asin: t.toUpperCase() } : null;
      if (hint.type === 'trendyolProduct') return /^\d{3,20}$/.test(t) ? { type: 'trendyolProduct', productId: t, label: null } : null;
      if (hint.type && hint.type !== 'etsyShop') return null;
      if (/^\d{5,20}$/.test(t)) return { type: 'etsyShop', shopId: t };
      return ETSY_SHOP_NAME.test(t) ? { type: 'etsyShop', shopName: t } : null;
    }
  }
  return null;
}

/** Merges a partial patch over `base` with bounds. Returns null when any given value is invalid. */
export function parseAlertRules(raw: unknown, base: AlertRules = DEFAULT_ALERT_RULES): AlertRules | null {
  if (raw === undefined || raw === null) return { ...base };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: AlertRules = { ...base };
  // `newListings` is accepted as an alias of RR §4.3's `newListing`.
  const nl = 'newListing' in r ? r.newListing : 'newListings' in r ? r.newListings : undefined;
  if (nl !== undefined) {
    if (typeof nl !== 'boolean') return null;
    out.newListing = nl;
  }
  const bounded = (k: 'priceDropPct' | 'salesSpikeX' | 'marginOver', min: number, max: number): boolean => {
    if (!(k in r)) return true;
    const v = r[k];
    if (v === null || v === false) { out[k] = null; return true; }
    const n = typeof v === 'number' ? v : NaN;
    if (!Number.isFinite(n) || n < min || n > max) return false;
    out[k] = round(n, 1);
    return true;
  };
  if (!bounded('priceDropPct', 5, 90) || !bounded('salesSpikeX', 1.5, 20) || !bounded('marginOver', 1, 500)) return null;
  return out;
}

/** Stored JSON → rules (never throws; unknown shapes fall back to defaults). */
export function readAlertRules(stored: unknown): AlertRules {
  return parseAlertRules(stored, DEFAULT_ALERT_RULES) ?? { ...DEFAULT_ALERT_RULES };
}

export function cleanLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
  return s || null;
}

// ─── Pure: measured sales from readings (RR §6.3 guard 7) ──────────────────────────────────────────

export interface SoldReading {
  takenAt: Date | string | number;
  sold: number | null;
}

export interface RatePair {
  /** End reading time (ms). */
  end: number;
  /** Elapsed days between the two readings (≥ 0.5). */
  days: number;
  delta: number;
  rate: number;
  flagged: boolean;
}

/**
 * Reading-to-reading rates. Readings closer than 12 h to the previous kept reading are skipped (a reading taken
 * on add and the 06:00 cron the same morning would otherwise explode the rate). Guard 7: a rate < 0 or
 * > 50 × max(median of the non-negative rates, 1) is flagged.
 */
export function ratePairs(readings: SoldReading[]): RatePair[] {
  const rs = readings
    .map((r) => ({ t: toMs(r.takenAt), sold: numOrNull(r.sold) }))
    .filter((r): r is { t: number; sold: number } => Number.isFinite(r.t) && r.sold !== null)
    .sort((a, b) => a.t - b.t);
  const raw: Array<Omit<RatePair, 'flagged'>> = [];
  let a = rs[0];
  for (let i = 1; i < rs.length; i++) {
    const b = rs[i];
    const days = (b.t - a.t) / DAY_MS;
    if (days < 0.5) continue;
    const delta = b.sold - a.sold;
    raw.push({ end: b.t, days, delta, rate: delta / days });
    a = b;
  }
  const med = median(raw.filter((p) => p.rate >= 0).map((p) => p.rate)) ?? 0;
  const cap = SPIKE_GUARD_X * Math.max(med, 1);
  return raw.map((p) => ({ ...p, flagged: p.rate < 0 || p.rate > cap }));
}

/** 30 daily points ending at the latest reading's day; null = no reading ended that day or the point was dropped. */
export function salesSeries(pairs: RatePair[], latestMs: number | null, days = SERIES_DAYS): SalesPoint[] {
  if (latestMs === null) return [];
  const byDay = new Map<string, RatePair>();
  for (const p of pairs) byDay.set(utcDay(p.end), p);
  const out: SalesPoint[] = [];
  const endDay = Date.parse(`${utcDay(latestMs)}T00:00:00.000Z`);
  for (let i = days - 1; i >= 0; i--) {
    const date = utcDay(endDay - i * DAY_MS);
    const p = byDay.get(date);
    out.push({ date, value: p && !p.flagged ? round(p.rate, 2) : null, dropped: !!p?.flagged });
  }
  return out;
}

/** Σdelta / Σdays over unflagged pairs ending in (from, to]. */
function windowRate(pairs: RatePair[], from: number, to: number): { rate: number | null; days: number; dropped: number } {
  let delta = 0;
  let days = 0;
  let dropped = 0;
  for (const p of pairs) {
    if (p.end <= from || p.end > to) continue;
    if (p.flagged) { dropped++; continue; }
    delta += p.delta;
    days += p.days;
  }
  return { rate: days > 0 ? delta / days : null, days, dropped };
}

/** Sales/day for the last 7 days and the change vs the 7 days before (both Measured). */
export function salesMetrics(readings: SoldReading[]): { salesPerDay7d: Guarded<number>; salesChange: Guarded<number>; pairs: RatePair[]; latestMs: number | null } {
  const valid = readings.filter((r) => numOrNull(r.sold) !== null);
  const latestMs = valid.length ? Math.max(...valid.map((r) => toMs(r.takenAt))) : null;
  if (valid.length === 0 || latestMs === null) {
    return { salesPerDay7d: na('research.shops.noReading'), salesChange: na('research.shops.noReading'), pairs: [], latestMs: null };
  }
  const pairs = ratePairs(valid);
  if (pairs.length === 0) {
    return { salesPerDay7d: na('research.shops.firstReading'), salesChange: na('research.shops.firstReading'), pairs, latestMs };
  }
  const cur = windowRate(pairs, latestMs - 7 * DAY_MS, latestMs);
  if (cur.rate === null) {
    const reason = cur.dropped > 0 ? 'research.shops.anomaly' : 'research.shops.noRecentReading';
    return { salesPerDay7d: na(reason), salesChange: na(reason), pairs, latestMs };
  }
  const salesPerDay7d = ok(round(cur.rate, 1), 'measured', cur.dropped > 0 ? 'research.shops.pointsDropped' : undefined, cur.dropped > 0 ? { count: cur.dropped } : undefined);
  const prev = windowRate(pairs, latestMs - 14 * DAY_MS, latestMs - 7 * DAY_MS);
  let salesChange: Guarded<number>;
  if (prev.rate === null || prev.days < 3) salesChange = na('research.shops.needTwoWeeks');
  else if (prev.rate <= 0) salesChange = na('research.shops.prevZero');
  else salesChange = ok(round(cur.rate / prev.rate - 1, 3));
  return { salesPerDay7d, salesChange, pairs, latestMs };
}

export interface PriceReading {
  takenAt: Date | string | number;
  price: WatchPrice | null;
}

/** Median price change vs the newest reading at least 6.5 days older, i.e. ~7 days (Measured). */
export function priceChange(readings: PriceReading[]): Guarded<number> {
  const rs = readings.map((r) => ({ t: toMs(r.takenAt), price: r.price })).filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  const latest = rs[rs.length - 1];
  if (!latest?.price) return na('research.shops.noReading');
  const base = [...rs].reverse().find((r) => r.t <= latest.t - 6.5 * DAY_MS && r.price);
  if (!base?.price) return na('research.shops.needWeek');
  if (base.price.currency !== latest.price.currency) return na('research.shops.currencyChanged');
  const usable = (p: WatchPrice) => p.median !== null && p.median > 0 && p.quality !== 'insufficient' && p.quality !== 'implausible';
  if (!usable(latest.price) || !usable(base.price)) return na('research.shops.priceSample');
  return ok(round((latest.price.median as number) / (base.price.median as number) - 1, 3));
}

export function toWatchPrice(s: PriceSummary | null | undefined): WatchPrice | null {
  if (!s) return null;
  return { median: s.median, p25: s.p25, p75: s.p75, n: s.n, currency: s.currency, quality: s.quality };
}

// ─── Pure: Etsy shop reading → metrics ──────────────────────────────────────────────────────────────

export function compactListing(raw: unknown): SnapListing | null {
  const m = mapEtsyListing(raw);
  if (!m.listingId) return null;
  return {
    id: m.listingId,
    t: m.title,
    p: m.price,
    c: m.currency,
    f: m.favorites,
    cr: m.originalCreatedAt,
    tags: m.tags.slice(0, 13),
    url: m.url || null,
  };
}

export function buildShopSnapshot(info: EtsyShopInfo, listings: SnapListing[], complete: boolean, takenAtMs: number): EtsyShopSnapshotMetrics {
  const cutoff = (takenAtMs - 7 * DAY_MS) / 1000;
  const currency = (info.currency || listings[0]?.c || 'USD').toUpperCase();
  const created = listings.map((l) => l.cr).filter((c): c is number => c !== null);
  const summary = listings.length
    ? summarizePrices(listings.map((l) => ({ amount: l.p, currency: l.c })), { currency })
    : null;
  return {
    v: 1,
    kind: 'etsyShop',
    shopId: info.shopId,
    name: info.name,
    url: info.url,
    iconUrl: info.iconUrl,
    createdAt: info.createdAt,
    transactionSoldCount: info.soldCount,
    reviewCount: info.reviewCount,
    reviewAverage: info.reviewAverage,
    activeCount: info.activeCount,
    currency: info.currency,
    listingsN: listings.length,
    listingsComplete: complete,
    new7d: listings.filter((l) => l.cr !== null && l.cr >= cutoff).length,
    oldestFetchedCreatedAt: created.length ? Math.min(...created) : null,
    price: toWatchPrice(summary),
  };
}

export function isShopMetrics(m: unknown): m is EtsyShopSnapshotMetrics {
  return !!m && typeof m === 'object' && (m as { kind?: unknown }).kind === 'etsyShop' && (m as { v?: unknown }).v === 1;
}
export function isQueryMetrics(m: unknown): m is QuerySnapshotMetrics {
  return !!m && typeof m === 'object' && (m as { kind?: unknown }).kind === 'query' && (m as { v?: unknown }).v === 1;
}

export function shopInfoFrom(m: EtsyShopSnapshotMetrics | null, cached?: EtsyShopInfo | null): WatchShopInfo | null {
  const src = m ?? null;
  if (src) {
    return {
      name: src.name, url: src.url, iconUrl: src.iconUrl,
      openedAt: src.createdAt ? new Date(src.createdAt * 1000).toISOString() : null,
      reviewCount: src.reviewCount, reviewAverage: src.reviewAverage,
    };
  }
  if (cached) {
    return {
      name: cached.name, url: cached.url, iconUrl: cached.iconUrl,
      openedAt: cached.createdAt ? new Date(cached.createdAt * 1000).toISOString() : null,
      reviewCount: cached.reviewCount, reviewAverage: cached.reviewAverage,
    };
  }
  return null;
}

/** Table metrics for an Etsy shop from its readings (oldest → newest or any order). */
export function shopMetrics(snaps: Array<{ takenAt: Date | string; metrics: unknown }>): { metrics: WatchMetrics; pairs: RatePair[]; latestMs: number | null; latest: EtsyShopSnapshotMetrics | null } {
  const rs = snaps
    .filter((s) => isShopMetrics(s.metrics))
    .map((s) => ({ takenAt: s.takenAt, m: s.metrics as EtsyShopSnapshotMetrics }))
    .sort((a, b) => toMs(a.takenAt) - toMs(b.takenAt));
  if (rs.length === 0) return { metrics: NA_METRICS('research.shops.noReading'), pairs: [], latestMs: null, latest: null };
  const latest = rs[rs.length - 1].m;
  const sales = salesMetrics(rs.map((r) => ({ takenAt: r.takenAt, sold: r.m.transactionSoldCount })));
  const latestMs = toMs(rs[rs.length - 1].takenAt);
  const lowerBound = !latest.listingsComplete && latest.oldestFetchedCreatedAt !== null
    && latest.oldestFetchedCreatedAt >= (latestMs - 7 * DAY_MS) / 1000;
  return {
    metrics: {
      salesPerDay: sales.salesPerDay7d,
      salesVsPrev: sales.salesChange,
      active: latest.activeCount !== null ? ok(latest.activeCount) : na('research.shops.noReading'),
      new7d: latest.listingsN > 0 || latest.listingsComplete
        ? ok(latest.new7d, 'measured', lowerBound ? 'research.shops.atLeast' : undefined)
        : na('research.shops.noListings'),
      priceChange: priceChange(rs.map((r) => ({ takenAt: r.takenAt, price: r.m.price }))),
      price: latest.price,
      soldItemsAllTime: null,
      droppedPoints: sales.pairs.filter((p) => p.flagged && p.end > latestMs - SERIES_DAYS * DAY_MS).length,
    },
    pairs: sales.pairs,
    latestMs,
    latest,
  };
}

/** Table metrics for a saved query: supply and the median price move. */
export function queryMetrics(snaps: Array<{ takenAt: Date | string; metrics: unknown }>): WatchMetrics {
  const rs = snaps
    .filter((s) => isQueryMetrics(s.metrics))
    .map((s) => ({ takenAt: s.takenAt, m: s.metrics as QuerySnapshotMetrics }))
    .sort((a, b) => toMs(a.takenAt) - toMs(b.takenAt));
  const latest = rs[rs.length - 1]?.m;
  return {
    salesPerDay: na('research.watch.notApplicable'),
    salesVsPrev: na('research.watch.notApplicable'),
    active: latest ? ok(latest.total) : na('research.shops.noReading'),
    new7d: na('research.watch.notApplicable'),
    priceChange: priceChange(rs.map((r) => ({ takenAt: r.takenAt, price: r.m.price }))),
    price: latest?.price ?? null,
    soldItemsAllTime: null,
    droppedPoints: 0,
  };
}

/** Favorites gained per listing between two listing readings; share of the positive total is an Estimate. */
export function fastestGaining(now: SnapListing[], before: SnapListing[], days: number, limit = 5): Array<{ listing: SnapListing; favoritesDelta: number; share: Guarded<number> }> {
  const prev = new Map(before.map((l) => [l.id, l.f]));
  const gains = now
    .filter((l) => prev.has(l.id))
    .map((l) => ({ listing: l, favoritesDelta: l.f - (prev.get(l.id) as number) }))
    .filter((g) => g.favoritesDelta > 0)
    .sort((a, b) => b.favoritesDelta - a.favoritesDelta);
  const total = gains.reduce((s, g) => s + g.favoritesDelta, 0);
  return gains.slice(0, limit).map((g) => ({
    ...g,
    share: total > 0 && days > 0 ? ok(round(g.favoritesDelta / total, 3), 'estimate', 'research.shops.shareFromFavorites') : na('research.shops.needWeek', 'estimate'),
  }));
}

/** Tags the shop uses that the user's own listings do not (case-insensitive). */
export function tagGap(theirs: SnapListing[], mine: Iterable<string>, limit = 20): Array<{ tag: string; count: number; share: number }> {
  const own = new Set<string>();
  for (const t of mine) own.add(String(t).trim().toLowerCase());
  const counts = new Map<string, number>();
  for (const l of theirs) {
    for (const tag of new Set(l.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const n = theirs.length || 1;
  return Array.from(counts.entries())
    .filter(([tag]) => !own.has(tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count, share: round(count / n, 3) }));
}

// ─── Pure: alerts ───────────────────────────────────────────────────────────────────────────────────

export interface AlertInput {
  /** Listings first created after the previous reading (null when there is no previous reading). */
  newSincePrev: number | null;
  priceChange: Guarded<number>;
  /** The price change as of the previous reading: a drop already past the threshold there is not raised again. */
  prevPriceChange?: Guarded<number> | null;
  pairs: RatePair[];
}

export interface AlertFire {
  type: ResearchAlertType;
  params: Record<string, string | number>;
  severity: 'info' | 'warning';
}

/** Which alerts a reading raises for one watcher. Pure. */
export function evaluateShopAlerts(rules: AlertRules, input: AlertInput): AlertFire[] {
  const out: AlertFire[] = [];
  if (rules.newListing && input.newSincePrev !== null && input.newSincePrev > 0) {
    out.push({ type: 'researchShopNewListings', params: { count: input.newSincePrev }, severity: 'info' });
  }
  const pc = input.priceChange;
  const threshold = rules.priceDropPct !== null ? -rules.priceDropPct / 100 : null;
  const prev = input.prevPriceChange;
  const alreadyCrossed = threshold !== null && !!prev && prev.guard.ok && prev.value !== null && prev.value <= threshold;
  if (threshold !== null && !alreadyCrossed && pc.guard.ok && pc.value !== null && pc.value <= threshold) {
    out.push({ type: 'researchShopPriceDrop', params: { pct: Math.round(-pc.value * 100) }, severity: 'info' });
  }
  if (rules.salesSpikeX !== null) {
    const valid = input.pairs.filter((p) => !p.flagged);
    const last = valid[valid.length - 1];
    const before = valid.slice(0, -1).filter((p) => last && p.end >= last.end - SERIES_DAYS * DAY_MS).map((p) => p.rate);
    const med = before.length >= 7 ? median(before) : null;
    if (last && med !== null && med > 0 && last.rate >= rules.salesSpikeX * med) {
      out.push({ type: 'researchShopSalesSpike', params: { sales: round(last.rate, 1), ratio: round(last.rate / med, 1) }, severity: 'info' });
    }
  }
  return out;
}

// ─── Quota ──────────────────────────────────────────────────────────────────────────────────────────

export function watchLimitFor(plan: PlanKey | null, state: string | null): number | null {
  if (state === 'expired' || plan === null) return 0;
  return Object.prototype.hasOwnProperty.call(RESEARCH_WATCH_LIMITS, plan) ? RESEARCH_WATCH_LIMITS[plan] : 0;
}

/** Plan and limit, resolved like `lib/billing/requireFeature.ts` (an active Shopify shop = shopify_free). */
export async function resolveWatchPlan(userId: string, now: Date = new Date()): Promise<{ plan: PlanKey | null; limit: number | null; stripeUpsell: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionPlan: true, subscriptionStatus: true, billingInterval: true, billingProvider: true, trialExpiresAt: true },
  });
  if (!user) return { plan: null, limit: 0, stripeUpsell: false };
  const activeShopify = await prisma.shopifyShop.count({ where: { userId, isActive: true } });
  const shopify = user.billingProvider === 'shopify_free' || activeShopify > 0;
  const ent = entitlementFromSettings({
    subscriptionPlan: shopify ? 'shopify_free' : user.subscriptionPlan,
    subscriptionStatus: shopify ? 'active' : user.subscriptionStatus,
    billingInterval: user.billingInterval,
    billingProvider: shopify ? 'shopify_free' : user.billingProvider,
    trialExpiresAt: user.trialExpiresAt ? new Date(user.trialExpiresAt).toISOString() : null,
  }, now);
  if (!ent) return { plan: null, limit: 0, stripeUpsell: false };
  return { plan: ent.plan, limit: watchLimitFor(ent.plan, ent.state), stripeUpsell: !isNeutralBilling(ent) };
}

async function countActiveWatches(userId: string): Promise<number> {
  const d = watchDelegate();
  if (!d) return 0;
  try {
    if (typeof d.count === 'function') return await d.count({ where: { userId, isActive: true } });
    return (await d.findMany({ where: { userId, isActive: true }, select: { id: true } })).length;
  } catch (err) {
    if (isMissingTableError(err)) return 0;
    throw err;
  }
}

/** Stable "oldest first" order used by the quota everywhere (list, cron). */
export function byWatchAge(a: Pick<ResearchWatchRow, 'createdAt' | 'id'>, b: Pick<ResearchWatchRow, 'createdAt' | 'id'>): number {
  return toMs(a.createdAt) - toMs(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Ids of the watches inside each owner's plan limit: the owner's oldest `limit` active watches (every type counts,
 * like the quota). A plan change (expired trial, downgrade) pauses the newest watches past the limit.
 */
export async function watchesInQuota(
  watches: ResearchWatchRow[],
  limitOf: (userId: string) => Promise<number | null>,
): Promise<Set<string>> {
  const byUser = new Map<string, ResearchWatchRow[]>();
  for (const w of watches) if (w.isActive) byUser.set(w.userId, [...(byUser.get(w.userId) ?? []), w]);
  const out = new Set<string>();
  for (const [userId, rows] of byUser) {
    const limit = await limitOf(userId);
    const sorted = [...rows].sort(byWatchAge);
    for (const w of limit === null ? sorted : sorted.slice(0, Math.max(0, limit))) out.add(w.id);
  }
  return out;
}

export async function watchQuota(userId: string): Promise<WatchQuota> {
  const [plan, used] = await Promise.all([resolveWatchPlan(userId), countActiveWatches(userId)]);
  return { used, limit: plan.limit, plan: plan.plan, stripeUpsell: plan.stripeUpsell };
}

// ─── Etsy live reads ────────────────────────────────────────────────────────────────────────────────

async function etsyGet(path: string, priority: EtsyPriority, deferOn429: boolean): Promise<any> {
  const res = await etsyFetch(`${ETSY_API_BASE}${path}`, { headers: etsyPublicHeaders() }, { priority, deferOn429, retries: deferOn429 ? 0 : 1 });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new EtsyUpstreamError(res.status, `Etsy public API ${res.status}: ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

const notFound = () => new WatchError(404, { error: 'not_found', key: 'research.watch.shopNotFound' });
const budget = () => new WatchError(503, { error: 'budget', key: 'research.error.budget' });

function mapResolveError(err: unknown): never {
  if (err instanceof WatchError) throw err;
  if (isBudgetError(err) || err instanceof ResearchBudgetError) throw budget();
  if (err instanceof EtsyUpstreamError && (err.status === 404 || err.status === 400)) throw notFound();
  throw err;
}

/** Etsy shop by id / exact name / one of its listings. Shared cache 24 h; budget-aware. */
export async function resolveEtsyShop(t: Extract<WatchTarget, { type: 'etsyShop' }>): Promise<EtsyShopInfo> {
  try {
    let shopId = t.shopId ?? null;
    if (!shopId && t.fromListingId) {
      const served = await cachedLive(`public:etsy:listingShop:${t.fromListingId}`, SHOP_TTL_MS, async () => {
        const l = await etsyGet(`/listings/${t.fromListingId}`, EtsyPriority.Interactive, false);
        return l?.shop_id != null ? String(l.shop_id) : null;
      });
      shopId = served.data;
      if (!shopId) throw notFound();
    }
    if (!shopId && t.shopName) {
      const name = t.shopName.toLowerCase();
      const served = await cachedLive<EtsyShopInfo | null>(`public:etsy:shopByName:${name}`, SHOP_TTL_MS, async () => {
        const data = await etsyGet(`/shops?shop_name=${encodeURIComponent(t.shopName as string)}&limit=25`, EtsyPriority.Interactive, false);
        const results: unknown[] = Array.isArray(data?.results) ? data.results : [];
        const exact = results.map(mapEtsyShop).find((s) => s.shopId && s.name.toLowerCase() === name);
        return exact ?? null;
      });
      if (!served.data) throw notFound();
      await writeShared(`public:etsy:shop:${served.data.shopId}`, served.data, SHOP_TTL_MS, served.fetchedAt);
      return served.data;
    }
    if (!shopId || !ETSY_ID.test(shopId)) throw notFound();
    const id = shopId;
    const served = await cachedLive<EtsyShopInfo>(`public:etsy:shop:${id}`, SHOP_TTL_MS, async () => mapEtsyShop(await etsyGet(`/shops/${id}`, EtsyPriority.Interactive, false)));
    if (!served.data?.shopId) throw notFound();
    return served.data;
  } catch (err) {
    return mapResolveError(err);
  }
}

export const listingsCacheKey = (shopId: string, day: string) => `public:etsy:shopListings:${shopId}:${day}`;

/**
 * One live reading of a shop: `/shops/{id}` + ≤ 5 pages of `/shops/{id}/listings/active` (newest first).
 * Cron: Reconcile priority with `deferOn429` (stops at the daily budget gate). On add: Interactive.
 */
export async function fetchShopReading(shopId: string, opts: { priority: EtsyPriority; deferOn429: boolean; nowMs?: number }): Promise<{ metrics: EtsyShopSnapshotMetrics; listings: SnapListing[] }> {
  const info = mapEtsyShop(await etsyGet(`/shops/${shopId}`, opts.priority, opts.deferOn429));
  if (!info.shopId) throw new EtsyUpstreamError(404, 'shop not found');
  const want = Math.min(info.activeCount ?? MAX_SNAPSHOT_LISTINGS, MAX_SNAPSHOT_LISTINGS);
  const listings: SnapListing[] = [];
  let complete = true;
  for (let page = 0; page * 100 < Math.max(want, 1); page++) {
    const params = new URLSearchParams({ limit: '100', offset: String(page * 100), sort_on: 'created', sort_order: 'desc' });
    const data = await etsyGet(`/shops/${shopId}/listings/active?${params}`, opts.priority, opts.deferOn429);
    const results: unknown[] = Array.isArray(data?.results) ? data.results : [];
    for (const r of results) {
      const c = compactListing(r);
      if (c) listings.push(c);
    }
    if (results.length < 100) break;
  }
  if (info.activeCount !== null && info.activeCount > listings.length) complete = false;
  await writeShared(`public:etsy:shop:${shopId}`, info, SHOP_TTL_MS);
  return { metrics: buildShopSnapshot(info, listings, complete, opts.nowMs ?? Date.now()), listings };
}

/** `ResearchSnapshot.day` (DATE column, unique with type/marketplace/refId): the UTC day of `takenAt` at 00:00Z. */
export const snapshotDay = (takenAt: Date | string | number): Date => startOfUtcDay(toMs(takenAt));

/**
 * Inserts one shared reading. The (type, marketplace, refId, day) unique key makes a second reading of the same
 * subject on the same UTC day a no-op (two users adding the same shop at once, cron racing the first reading).
 * Returns false when a reading for that day already existed.
 */
export async function insertSnapshot(row: { type: WatchType; marketplace: string; refId: string; takenAt: Date; metrics: SnapshotMetrics }): Promise<boolean> {
  const s = snapshotDelegate();
  if (!s) throw UNAVAILABLE();
  try {
    await s.create({ data: { ...row, day: snapshotDay(row.takenAt) } });
    return true;
  } catch (err) {
    if (isUniqueError(err)) return false;
    throw err;
  }
}

async function storeShopReading(shopId: string, reading: { metrics: EtsyShopSnapshotMetrics; listings: SnapListing[] }, takenAt: Date): Promise<boolean> {
  const inserted = await insertSnapshot({ type: 'etsyShop', marketplace: 'etsy', refId: shopId, takenAt, metrics: reading.metrics });
  if (inserted) await writeShared(listingsCacheKey(shopId, utcDay(takenAt)), reading.listings, LISTINGS_CACHE_TTL_MS, takenAt.toISOString());
  return inserted;
}

/**
 * BR-8 budget gate for one daily shop reading: `/shops/{id}` + ⌈active/100⌉ listing pages (≤ 5), checked up front
 * against the shared Etsy daily budget at Reconcile priority so a reading is never left half-fetched. Only a
 * 'budget' refusal stops the run (a per-second wait is handled by the token bucket).
 */
export function snapshotCallsFor(lastActiveCount: number | null | undefined): number {
  const n = typeof lastActiveCount === 'number' && Number.isFinite(lastActiveCount) ? lastActiveCount : MAX_SNAPSHOT_LISTINGS;
  return 1 + Math.max(1, Math.ceil(Math.min(Math.max(n, 0), MAX_SNAPSHOT_LISTINGS) / 100));
}
export function snapshotBudgetOk(calls: number): boolean {
  if (etsyBudgetLimited()) return false;
  try {
    const gate = canSpend('', EtsyPriority.Reconcile, calls);
    return gate.ok || gate.reason !== 'budget';
  } catch {
    return true;
  }
}

async function hasReadingToday(type: WatchType, marketplace: string, refId: string, nowMs: number): Promise<boolean> {
  const s = snapshotDelegate();
  if (!s) return false;
  const row = await s.findFirst({ where: { type, marketplace, refId, takenAt: { gte: startOfUtcDay(nowMs) } }, select: { id: true } });
  return !!row;
}

/**
 * Today's reading of a saved query. The shared search cache lives 24 h, so a cached result is used only when it was
 * fetched today (UTC); otherwise the search is forced live. A stale fallback (breaker on, live call failed) is never
 * stored as a reading: `{ deferred }` says why. `takenAt` = when the data was fetched, not when the cron ran.
 */
async function queryReading(text: string, nowMs: number): Promise<{ metrics: QuerySnapshotMetrics; takenAt: Date } | { deferred: 'budget' | 'stale' }> {
  const today = startOfUtcDay(nowMs).getTime();
  let served = await searchEtsy({ q: text, limit: 100 });
  if (served.cached && !served.stale && Date.parse(served.fetchedAt) < today) served = await searchEtsy({ q: text, limit: 100 }, { force: true });
  if (served.budgetLimited) return { deferred: 'budget' };
  if (served.stale || Date.parse(served.fetchedAt) < today) return { deferred: 'stale' };
  const price = await priceSummaryFor(served.data.items, 'USD');
  return {
    metrics: { v: 1, kind: 'query', query: text, total: served.data.total, price: toWatchPrice(price) },
    takenAt: new Date(served.fetchedAt),
  };
}

// ─── Read model ─────────────────────────────────────────────────────────────────────────────────────

export const watchHref = (id: string) => `/app/research/shops?open=${encodeURIComponent(id)}`;

const LEGACY_PREFIX = { ebaySeller: 'ebaySeller.', ebayItem: 'ebayItem.', asin: 'asin.' } as const;

export function parseWatchId(id: string): { source: WatchSource; id: string } | null {
  const s = String(id || '');
  if (s.startsWith(LEGACY_PREFIX.ebaySeller)) return { source: 'ebayTrackedSeller', id: s.slice(LEGACY_PREFIX.ebaySeller.length) };
  if (s.startsWith(LEGACY_PREFIX.ebayItem)) return { source: 'ebayTrackedProduct', id: s.slice(LEGACY_PREFIX.ebayItem.length) };
  if (s.startsWith(LEGACY_PREFIX.asin)) return { source: 'amazonTrackedProduct', id: s.slice(LEGACY_PREFIX.asin.length) };
  if (/^[A-Za-z0-9_-]{8,64}$/.test(s)) return { source: 'researchWatch', id: s };
  return null;
}

async function snapshotsFor(type: WatchType, marketplace: string, refIds: string[], sinceMs: number): Promise<Map<string, ResearchSnapshotRow[]>> {
  const out = new Map<string, ResearchSnapshotRow[]>();
  const s = snapshotDelegate();
  if (!s || refIds.length === 0) return out;
  const rows: ResearchSnapshotRow[] = await s.findMany({
    where: { type, marketplace, refId: { in: refIds }, takenAt: { gte: new Date(sinceMs) } },
    orderBy: { takenAt: 'asc' },
    select: { id: true, refId: true, takenAt: true, metrics: true, type: true, marketplace: true },
  });
  for (const r of rows) {
    const list = out.get(r.refId) ?? [];
    list.push(r);
    out.set(r.refId, list);
  }
  return out;
}

const isoOrNull = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

function snapshotsInfo(snaps: Array<{ takenAt: Date | string }>): WatchSummary['snapshots'] {
  return { count: snaps.length, first: isoOrNull(snaps[0]?.takenAt), last: isoOrNull(snaps[snaps.length - 1]?.takenAt) };
}

function summaryFromResearchWatch(w: ResearchWatchRow, snaps: ResearchSnapshotRow[], cachedShop: EtsyShopInfo | null): WatchSummary {
  const type = (isWatchType(w.type) ? w.type : 'query') as WatchType;
  const base = {
    id: w.id,
    type,
    marketplace: (w.marketplace as ResearchMkt) || MKT_OF[type],
    refId: w.refId,
    label: w.label,
    source: 'researchWatch' as const,
    capabilities: { alerts: type === 'etsyShop', remove: true },
    alertRules: readAlertRules(w.alertRules),
    createdAt: new Date(w.createdAt).toISOString(),
    snapshots: snapshotsInfo(snaps),
    href: watchHref(w.id),
  };
  if (type === 'etsyShop') {
    const sm = shopMetrics(snaps);
    const shop = shopInfoFrom(sm.latest, cachedShop);
    return {
      ...base,
      url: shop?.url ?? `https://www.etsy.com/shop/${encodeURIComponent(w.label)}`,
      iconUrl: shop?.iconUrl ?? null,
      shop,
      metrics: sm.metrics,
    };
  }
  if (type === 'query' && base.marketplace !== 'etsy') {
    // Saved eBay queries are not read in v1 (POST refuses new ones); older rows say so instead of "no reading".
    return { ...base, url: null, iconUrl: null, shop: null, metrics: NA_METRICS('research.watch.ebayQueryUnsupported') };
  }
  if (type === 'query') return { ...base, url: null, iconUrl: null, shop: null, metrics: queryMetrics(snaps) };
  return { ...base, url: null, iconUrl: null, shop: null, metrics: NA_METRICS('research.watch.noReadingsYet') };
}

interface EbayProductRow {
  id: string;
  seller: string | null;
  totalSold: number | null;
  currentPrice: number | null;
  currency: string;
  snapshots: Array<{ timestamp: Date; soldQuantity: number | null }>;
}

/** eBay seller metrics from the user's tracked items of that seller (Δ soldQuantity between snapshots = Measured). */
export function ebaySellerMetrics(products: EbayProductRow[]): { metrics: WatchMetrics; readings: Array<{ takenAt: Date }> } {
  let sum7 = 0;
  let measured = 0;
  let dropped = 0;
  // One "reading" per UTC day with any snapshot of this seller's tracked items (not items × snapshots).
  const byDay = new Map<string, number>();
  for (const p of products) {
    for (const s of p.snapshots) {
      const t = toMs(s.timestamp);
      const k = utcDay(t);
      byDay.set(k, Math.max(byDay.get(k) ?? 0, t));
    }
  }
  const readings: Array<{ takenAt: Date }> = Array.from(byDay.values()).map((t) => ({ takenAt: new Date(t) }));
  const latestAll = readings.reduce((mx, r) => Math.max(mx, r.takenAt.getTime()), 0);
  for (const p of products) {
    const m = salesMetrics(p.snapshots.map((s) => ({ takenAt: s.timestamp, sold: s.soldQuantity })));
    dropped += m.pairs.filter((x) => x.flagged && x.end > latestAll - SERIES_DAYS * DAY_MS).length;
    if (m.salesPerDay7d.guard.ok && m.salesPerDay7d.value !== null) {
      sum7 += m.salesPerDay7d.value;
      measured++;
    }
  }
  readings.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const soldOnce = products.filter((p) => (p.totalSold ?? 0) >= 1 || p.snapshots.some((s) => (s.soldQuantity ?? 0) >= 1)).length;
  return {
    metrics: {
      salesPerDay: measured > 0 ? ok(round(sum7, 1), 'measured', 'research.shops.ebayTrackedItems', { items: measured }) : na('research.shops.ebayCollecting', 'measured', { items: soldOnce }),
      salesVsPrev: na('research.shops.needTwoWeeks'),
      active: na('research.shops.ebayActiveUnknown'),
      new7d: na('research.watch.notApplicable'),
      priceChange: na('research.watch.notApplicable'),
      price: null,
      soldItemsAllTime: soldOnce,
      droppedPoints: dropped,
    },
    readings,
  };
}

async function legacyEbayRows(userId: string, sinceMs: number, onlyId?: string): Promise<WatchSummary[]> {
  const sellers = await prisma.ebayTrackedSeller.findMany({
    where: { userId, isActive: true, ...(onlyId ? { id: onlyId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  if (sellers.length === 0) return [];
  const products = await prisma.ebayTrackedProduct.findMany({
    where: { userId, isActive: true, seller: { in: sellers.map((s) => s.sellerUsername), mode: 'insensitive' } },
    select: {
      id: true, seller: true, totalSold: true, currentPrice: true, currency: true,
      snapshots: { where: { timestamp: { gte: new Date(sinceMs) } }, orderBy: { timestamp: 'asc' }, select: { timestamp: true, soldQuantity: true } },
    },
  });
  return sellers.map((s) => {
    const mine = (products as EbayProductRow[]).filter((p) => (p.seller ?? '').toLowerCase() === s.sellerUsername.toLowerCase());
    const m = ebaySellerMetrics(mine);
    const id = `${LEGACY_PREFIX.ebaySeller}${s.id}`;
    const url = `https://www.ebay.com/usr/${encodeURIComponent(s.sellerUsername)}`;
    return {
      id,
      type: 'ebaySeller' as const,
      marketplace: 'ebay' as const,
      refId: s.sellerUsername,
      label: s.sellerUsername,
      source: 'ebayTrackedSeller' as const,
      url,
      iconUrl: null,
      capabilities: { alerts: false, remove: true },
      alertRules: { ...DEFAULT_ALERT_RULES },
      createdAt: s.createdAt.toISOString(),
      shop: { name: s.sellerUsername, url, iconUrl: null, openedAt: null, reviewCount: s.feedbackScore ?? null, reviewAverage: null },
      metrics: m.metrics,
      snapshots: snapshotsInfo(m.readings),
      href: watchHref(id),
    };
  });
}

// ─── eBay items ("Watch an eBay item": EbayTrackedProduct + EbayPriceSnapshot) ──────────────────────────────

export interface ItemReading {
  timestamp: Date | string;
  price: number | null;
  currency: string;
  soldQuantity: number | null;
}

/** Pure: the item's listed price change vs the newest reading ≥ 6.5 days older (Measured; same currency only). */
export function itemPriceChange(readings: ItemReading[]): Guarded<number> {
  const rs = readings
    .map((r) => ({ t: toMs(r.timestamp), price: numOrNull(r.price), currency: r.currency }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  const latest = rs[rs.length - 1];
  if (!latest || latest.price === null || latest.price <= 0) return na('research.shops.noReading');
  const base = [...rs].reverse().find((r) => r.t <= latest.t - 6.5 * DAY_MS && r.price !== null && r.price > 0);
  if (!base || base.price === null) return na('research.shops.needWeek');
  if (base.currency !== latest.currency) return na('research.shops.currencyChanged');
  return ok(round(latest.price / base.price - 1, 3));
}

/** Pure: Shop tracker metrics of one tracked eBay item (sales/day = Δ estimatedSoldQuantity between readings). */
export function ebayItemMetrics(readings: ItemReading[]): WatchMetrics {
  const m = salesMetrics(readings.map((r) => ({ takenAt: r.timestamp, sold: r.soldQuantity })));
  const latestMs = m.latestMs ?? 0;
  return {
    salesPerDay: m.salesPerDay7d,
    salesVsPrev: m.salesChange,
    active: na('research.watch.notApplicable'),
    new7d: na('research.watch.notApplicable'),
    priceChange: itemPriceChange(readings),
    price: null,
    soldItemsAllTime: null,
    droppedPoints: m.pairs.filter((p) => p.flagged && p.end > latestMs - SERIES_DAYS * DAY_MS).length,
  };
}

/** Pure: one value per UTC day (the day's last reading), 30 days ending at the latest reading; gaps are null. */
export function itemPriceSeries(readings: ItemReading[], days = SERIES_DAYS): Array<{ date: string; value: number | null }> {
  const byDay = new Map<string, { t: number; v: number | null }>();
  let latest: number | null = null;
  for (const r of readings) {
    const t = toMs(r.timestamp);
    if (!Number.isFinite(t)) continue;
    const k = utcDay(t);
    const prev = byDay.get(k);
    if (!prev || t >= prev.t) byDay.set(k, { t, v: numOrNull(r.price) });
    latest = Math.max(latest ?? 0, t);
  }
  if (latest === null) return [];
  const endDay = Date.parse(`${utcDay(latest)}T00:00:00.000Z`);
  const out: Array<{ date: string; value: number | null }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = utcDay(endDay - i * DAY_MS);
    out.push({ date, value: byDay.get(date)?.v ?? null });
  }
  return out;
}

interface EbayItemRow {
  id: string;
  legacyItemId: string;
  title: string;
  imageUrl: string | null;
  itemWebUrl: string | null;
  seller: string | null;
  condition: string | null;
  currentPrice: number | null;
  currency: string;
  totalSold: number | null;
  createdAt: Date;
  snapshots: ItemReading[];
}

/** Pure: an EbayTrackedProduct row (with its readings in the window) → a Shop tracker row. */
export function ebayItemSummary(p: EbayItemRow): WatchSummary {
  const id = `${LEGACY_PREFIX.ebayItem}${p.id}`;
  const url = p.itemWebUrl ?? `https://www.ebay.com/itm/${encodeURIComponent(p.legacyItemId)}`;
  return {
    id,
    type: 'ebayItem',
    marketplace: 'ebay',
    refId: p.legacyItemId,
    label: cleanLabel(p.title) ?? p.legacyItemId,
    source: 'ebayTrackedProduct',
    url,
    iconUrl: p.imageUrl,
    capabilities: { alerts: false, remove: true },
    alertRules: { ...DEFAULT_ALERT_RULES },
    createdAt: isoOrNull(p.createdAt) ?? '',
    shop: null,
    metrics: ebayItemMetrics(p.snapshots ?? []),
    snapshots: snapshotsInfo((p.snapshots ?? []).map((x) => ({ takenAt: x.timestamp }))),
    href: watchHref(id),
    item: { price: numOrNull(p.currentPrice), currency: p.currency || 'USD', soldAllTime: numOrNull(p.totalSold), condition: p.condition, seller: p.seller },
  };
}

async function ebayItemRows(userId: string, sinceMs: number, onlyId?: string): Promise<EbayItemRow[]> {
  return prisma.ebayTrackedProduct.findMany({
    where: { userId, isActive: true, ...(onlyId ? { id: onlyId } : {}) },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, legacyItemId: true, title: true, imageUrl: true, itemWebUrl: true, seller: true, condition: true,
      currentPrice: true, currency: true, totalSold: true, createdAt: true,
      snapshots: { where: { timestamp: { gte: new Date(sinceMs) } }, orderBy: { timestamp: 'asc' }, select: { timestamp: true, price: true, currency: true, soldQuantity: true } },
    },
  }) as Promise<EbayItemRow[]>;
}

async function legacyEbayItemRows(userId: string, sinceMs: number, onlyId?: string): Promise<WatchSummary[]> {
  return (await ebayItemRows(userId, sinceMs, onlyId)).map(ebayItemSummary);
}

async function legacyAmazonRows(userId: string, onlyId?: string): Promise<WatchSummary[]> {
  const rows = await prisma.amazonTrackedProduct.findMany({
    where: { userId, isActive: true, ...(onlyId ? { id: onlyId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => {
    const id = `${LEGACY_PREFIX.asin}${r.id}`;
    return {
      id,
      type: 'asin' as const,
      marketplace: 'amazon' as const,
      refId: r.asin,
      label: r.title || r.asin,
      source: 'amazonTrackedProduct' as const,
      url: `https://www.amazon.com/dp/${encodeURIComponent(r.asin)}`,
      iconUrl: null,
      capabilities: { alerts: false, remove: true },
      alertRules: { ...DEFAULT_ALERT_RULES },
      createdAt: r.createdAt.toISOString(),
      shop: null,
      metrics: {
        ...NA_METRICS('research.watch.notApplicable'),
        rank: r.currentRank !== null && r.currentRank !== undefined ? ok(r.currentRank) : na('research.shops.noReading'),
      },
      snapshots: { count: 0, first: null, last: isoOrNull(r.lastCheckedAt) },
      href: watchHref(id),
    };
  });
}

export interface ListWatchesFilter {
  mkt?: ResearchMkt | null;
  type?: WatchType | null;
}

/** `GET /api/research/watches` data. Never throws for a missing BR-1c table (legacy rows still listed). */
export async function listWatches(userId: string, filter: ListWatchesFilter = {}, nowMs = Date.now()): Promise<WatchesData> {
  const since = nowMs - READ_WINDOW_DAYS * DAY_MS;
  let available = watchesAvailable();
  let rwRows: WatchSummary[] = [];
  if (available) {
    try {
      const watches: ResearchWatchRow[] = (await (watchDelegate() as Delegate).findMany({ where: { userId, isActive: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).sort(byWatchAge);
      const byType = new Map<WatchType, string[]>();
      for (const w of watches) if (isWatchType(w.type)) byType.set(w.type, [...(byType.get(w.type) ?? []), w.refId]);
      const snapMaps = new Map<string, Map<string, ResearchSnapshotRow[]>>();
      for (const [type, refs] of byType) {
        const mkts = Array.from(new Set(watches.filter((w) => w.type === type).map((w) => w.marketplace)));
        for (const m of mkts) snapMaps.set(`${type}|${m}`, await snapshotsFor(type, m, Array.from(new Set(refs)), since));
      }
      const noReading = watches.filter((w) => w.type === 'etsyShop' && !(snapMaps.get(`etsyShop|${w.marketplace}`)?.get(w.refId)?.length));
      const cachedShops = new Map<string, EtsyShopInfo>();
      await Promise.all(noReading.map(async (w) => {
        const hit = await readShared<EtsyShopInfo>(`public:etsy:shop:${w.refId}`);
        if (hit) cachedShops.set(w.refId, hit.data);
      }));
      rwRows = watches.map((w) => summaryFromResearchWatch(w, snapMaps.get(`${w.type}|${w.marketplace}`)?.get(w.refId) ?? [], cachedShops.get(w.refId) ?? null));
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
      available = false;
      rwRows = [];
    }
  }
  const [ebay, ebayItems, amazon, quota] = await Promise.all([
    legacyEbayRows(userId, since),
    legacyEbayItemRows(userId, since),
    legacyAmazonRows(userId),
    watchQuota(userId),
  ]);
  if (available && quota.limit !== null) {
    // Same rule as the cron: watches past the plan limit (oldest first) get no daily reading.
    rwRows = rwRows.map((r, i) => (i < quota.limit! ? r : {
      ...r,
      paused: { reasonKey: 'research.shops.overQuota' },
      metrics: { ...r.metrics, salesPerDay: na('research.shops.overQuota') },
    }));
  }
  let rows = [...rwRows, ...ebay, ...ebayItems, ...amazon];
  if (filter.mkt) rows = rows.filter((r) => r.marketplace === filter.mkt);
  if (filter.type) rows = rows.filter((r) => r.type === filter.type);
  return { available, alertsAvailable: alertsAvailable(), rows, quota: available ? quota : { ...quota, used: 0 }, readingTimeUtc: READING_TIME_UTC };
}

function liteFrom(l: SnapListing, thumbs: Record<string, { thumbUrl: string | null }>): WatchListingLite {
  return {
    id: l.id,
    title: l.t,
    url: l.url,
    thumbUrl: thumbs[l.id]?.thumbUrl ?? null,
    price: l.p !== null ? { amount: l.p, currency: l.c } : null,
    favorites: l.f,
    createdAt: l.cr !== null ? new Date(l.cr * 1000).toISOString() : null,
    tags: l.tags,
  };
}

/** Tags of the user's active Etsy listings; null when no Etsy shop is connected (no tag gap possible). */
async function ownEtsyTags(userId: string): Promise<string[] | null> {
  const shops = await prisma.etsyShop.findMany({ where: { userId, isActive: true }, select: { shopId: true } });
  if (shops.length === 0) return null;
  const listings = await prisma.etsyListing.findMany({
    where: { etsyShopId: { in: shops.map((s) => s.shopId) }, state: 'active' },
    select: { tags: true },
    take: 5000,
  });
  return listings.flatMap((l) => l.tags ?? []);
}

function detailShell(row: WatchSummary): WatchDetail {
  return {
    watch: row,
    shop: { since: row.shop?.openedAt ?? null, rating: row.shop?.reviewAverage ?? null, reviewCount: row.shop?.reviewCount ?? null },
    sales: [],
    newListings: [],
    fastest: [],
    tagGap: [],
    tagGapAvailable: false,
    listingsSampled: 0,
    listingsComplete: false,
  };
}

/** `GET /api/research/watches/[id]` data (the SidePanel). Throws WatchError 404 / 503. */
export async function getWatchDetail(userId: string, rawId: string, nowMs = Date.now()): Promise<WatchDetail> {
  const parsed = parseWatchId(rawId);
  if (!parsed) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
  const since = nowMs - READ_WINDOW_DAYS * DAY_MS;

  if (parsed.source === 'ebayTrackedSeller') {
    const [row] = await legacyEbayRows(userId, since, parsed.id);
    if (!row) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
    const products = await prisma.ebayTrackedProduct.findMany({
      where: { userId, isActive: true, seller: { equals: row.refId, mode: 'insensitive' } },
      select: { snapshots: { where: { timestamp: { gte: new Date(since) } }, orderBy: { timestamp: 'asc' }, select: { timestamp: true, soldQuantity: true } } },
    });
    // Seller series: Σ of per-item measured rates per day (gaps where no item had a reading).
    const byDay = new Map<string, { sum: number; valid: number; dropped: number }>();
    let latest: number | null = null;
    for (const p of products) {
      for (const pair of ratePairs(p.snapshots.map((s) => ({ takenAt: s.timestamp, sold: s.soldQuantity })))) {
        const d = utcDay(pair.end);
        const e = byDay.get(d) ?? { sum: 0, valid: 0, dropped: 0 };
        if (pair.flagged) e.dropped++; else { e.sum += pair.rate; e.valid++; }
        byDay.set(d, e);
        latest = Math.max(latest ?? 0, pair.end);
      }
    }
    const sales: SalesPoint[] = [];
    if (latest !== null) {
      const endDay = Date.parse(`${utcDay(latest)}T00:00:00.000Z`);
      for (let i = SERIES_DAYS - 1; i >= 0; i--) {
        const date = utcDay(endDay - i * DAY_MS);
        const e = byDay.get(date);
        sales.push({ date, value: e && e.valid > 0 ? round(e.sum, 2) : null, dropped: !!e && e.valid === 0 && e.dropped > 0 });
      }
    }
    return { ...detailShell(row), sales };
  }

  if (parsed.source === 'ebayTrackedProduct') {
    const [p] = await ebayItemRows(userId, since, parsed.id);
    if (!p) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
    const row = ebayItemSummary(p);
    const pairs = ratePairs(p.snapshots.map((x) => ({ takenAt: x.timestamp, sold: x.soldQuantity })));
    const latest = p.snapshots.length ? Math.max(...p.snapshots.map((x) => toMs(x.timestamp))) : null;
    return { ...detailShell(row), sales: salesSeries(pairs, latest), prices: itemPriceSeries(p.snapshots) };
  }

  if (parsed.source === 'amazonTrackedProduct') {
    const [row] = await legacyAmazonRows(userId, parsed.id);
    if (!row) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
    return detailShell(row);
  }

  const d = watchDelegate();
  if (!d || !snapshotDelegate()) throw UNAVAILABLE();
  let w: ResearchWatchRow | null;
  try {
    w = await d.findFirst({ where: { id: parsed.id, userId, isActive: true } });
  } catch (err) {
    if (isMissingTableError(err)) throw UNAVAILABLE();
    throw err;
  }
  if (!w) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
  const type = isWatchType(w.type) ? w.type : 'query';
  const snaps = (await snapshotsFor(type, w.marketplace, [w.refId], since)).get(w.refId) ?? [];
  const cached = type === 'etsyShop' && snaps.length === 0 ? (await readShared<EtsyShopInfo>(`public:etsy:shop:${w.refId}`))?.data ?? null : null;
  const summary = summaryFromResearchWatch(w, snaps, cached);
  const shell = detailShell(summary);
  if (type !== 'etsyShop') return shell;

  const sm = shopMetrics(snaps);
  const sales = salesSeries(sm.pairs, sm.latestMs);
  const shopSnaps = snaps.filter((s) => isShopMetrics(s.metrics));
  const latestSnap = shopSnaps[shopSnaps.length - 1];
  if (!latestSnap) return { ...shell, sales };
  const latestMs = toMs(latestSnap.takenAt);
  const nowList = (await readShared<SnapListing[]>(listingsCacheKey(w.refId, utcDay(latestMs))))?.data ?? [];
  const baseSnap = [...shopSnaps].reverse().find((s) => toMs(s.takenAt) <= latestMs - 6.5 * DAY_MS);
  const baseList = baseSnap ? (await readShared<SnapListing[]>(listingsCacheKey(w.refId, utcDay(baseSnap.takenAt))))?.data ?? [] : [];
  const days = baseSnap ? (latestMs - toMs(baseSnap.takenAt)) / DAY_MS : 0;

  const cutoff = (latestMs - 7 * DAY_MS) / 1000;
  const fresh = nowList.filter((l) => l.cr !== null && l.cr >= cutoff).sort((a, b) => (b.cr ?? 0) - (a.cr ?? 0)).slice(0, 24);
  const gains = fastestGaining(nowList, baseList, days);
  let thumbs: Record<string, { thumbUrl: string | null }> = {};
  const thumbIds = Array.from(new Set([...fresh.map((l) => l.id), ...gains.map((g) => g.listing.id)]));
  if (thumbIds.length) {
    try {
      thumbs = (await getEtsyListingDetails(thumbIds)).data;
    } catch (err) {
      if (!isBudgetError(err)) logger.warn('[research/watches] thumbnails failed', { error: (err as Error)?.message });
    }
  }
  const mine = await ownEtsyTags(userId).catch(() => null);
  const latestM = latestSnap.metrics as EtsyShopSnapshotMetrics;
  return {
    ...shell,
    sales,
    newListings: fresh.map((l) => liteFrom(l, thumbs)),
    fastest: gains.map((g) => ({
      ...liteFrom(g.listing, thumbs),
      favoritesDelta7d: ok(g.favoritesDelta, 'measured', 'research.shops.favoritesOverDays', { days: round(days, 1) }),
      shareOfSales: g.share,
    })),
    tagGap: mine ? tagGap(nowList, mine) : [],
    tagGapAvailable: mine !== null && nowList.length > 0,
    listingsSampled: latestM.listingsN,
    listingsComplete: latestM.listingsComplete,
  };
}

export function watchesSource(rows: WatchSummary[], nowIso = new Date().toISOString()): SourceNoteProps {
  const last = rows.map((r) => r.snapshots.last).filter((x): x is string => !!x).sort().pop();
  // Only shops/sellers with at least one reading carry measured counters (queries, ASINs, products are not shops).
  const measuredShops = rows.filter((r) => (r.type === 'etsyShop' || r.type === 'ebaySeller') && r.snapshots.count > 0).length;
  return {
    source: 'research.sourceName.shopCounters',
    fetchedAt: last ?? nowIso,
    sample: measuredShops,
    sampleUnit: 'shops',
    kind: 'measured',
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────────────────────────────

export interface CreateResult {
  summary: WatchSummary;
  quota: WatchQuota;
  created: boolean;
  errors: Array<{ section: string; key: string }>;
}

/** Validates a POST body into a target + label + rules. Throws WatchError 400. */
export function parseCreateBody(raw: unknown): { target: WatchTarget; label: string | null; rules: AlertRules } {
  const bad = (key = 'research.watch.inputInvalid') => new WatchError(400, { error: 'bad_request', key });
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!b) throw bad();
  const type = b.type === undefined ? undefined : isWatchType(b.type) ? b.type : null;
  if (type === null) throw bad();
  const marketplace = typeof b.marketplace === 'string' && ['etsy', 'ebay', 'amazon', 'trendyol'].includes(b.marketplace) ? (b.marketplace as ResearchMkt) : undefined;
  const rules = parseAlertRules(b.alertRules);
  if (!rules) throw bad('research.watch.rulesInvalid');
  const label = cleanLabel(b.label);
  let target: WatchTarget | null = null;
  const refId = typeof b.refId === 'string' ? b.refId.trim() : typeof b.refId === 'number' ? String(b.refId) : '';
  if (refId && type) {
    // A shop name or link in `refId` is resolved like a pasted input.
    if (type === 'etsyShop') target = ETSY_ID.test(refId) ? { type, shopId: refId } : detectWatchTarget(refId.slice(0, 500), { type });
    else if (type === 'ebaySeller') target = detectWatchTarget(refId.slice(0, 500), { type });
    else if (type === 'ebayItem') target = isEbayItemId(refId) ? { type, itemId: refId, label } : detectWatchTarget(refId.slice(0, 500), { type });
    else if (type === 'asin') target = /^[A-Z0-9]{10}$/i.test(refId) ? { type, asin: refId.toUpperCase() } : null;
    else if (type === 'trendyolProduct') target = /^\d{3,20}$/.test(refId) ? { type, productId: refId, label } : null;
    else target = { type: 'query', text: refId.slice(0, MAX_QUERY), marketplace: marketplace === 'ebay' ? 'ebay' : 'etsy' };
  } else if (typeof b.input === 'string') {
    target = detectWatchTarget(b.input.slice(0, 500), { type, marketplace });
  }
  if (!target) throw bad();
  return { target, label, rules };
}

async function findWatch(userId: string, type: WatchType, marketplace: string, refId: string): Promise<ResearchWatchRow | null> {
  const d = watchDelegate() as Delegate;
  return d.findFirst({ where: { userId, type, marketplace, refId } });
}

const quotaFull = (q: WatchQuota) => new WatchError(409, { error: 'quota_exceeded', key: 'research.shops.quotaFull', used: q.used, limit: q.limit });

async function assertQuota(userId: string): Promise<void> {
  const q = await watchQuota(userId);
  if (q.limit !== null && q.used >= q.limit) throw quotaFull(q);
}

/**
 * Re-count after a create / re-activate (no lock around count + write): when two requests raced past the limit,
 * the row just activated is switched off again and the caller gets the 409.
 */
async function recheckQuotaAfterWrite(userId: string, rowId: string): Promise<void> {
  const q = await watchQuota(userId);
  if (q.limit === null || q.used <= q.limit) return;
  const d = watchDelegate() as Delegate;
  if (typeof d.update === 'function') await d.update({ where: { id: rowId }, data: { isActive: false } });
  throw quotaFull({ ...q, used: q.limit });
}

/** POST: creates (or re-activates) a watch. eBay sellers go to the existing `EbayTrackedSeller` table. */
export async function createWatch(userId: string, body: unknown, nowMs = Date.now()): Promise<CreateResult> {
  const { target, label, rules } = parseCreateBody(body);
  const errors: CreateResult['errors'] = [];

  if (target.type === 'asin') {
    throw new WatchError(422, { error: 'unsupported', key: 'research.watch.asinUnsupported' });
  }
  if (target.type === 'query' && target.marketplace !== 'etsy') {
    // No daily reading for eBay queries in v1: refuse instead of holding a quota slot that never fills.
    throw new WatchError(422, { error: 'unsupported', key: 'research.watch.ebayQueryUnsupported' });
  }
  if (target.type === 'trendyolProduct') {
    // Price gap watches are part of the Pro arbitrage feature (pro-gating §2: server first). 402 via sendWatchError.
    await requireFeature(userId, 'arbitrage');
  }

  if (target.type === 'ebayItem') {
    // Legacy eBay tracker table (no quota, no BR-1c): the row + its first reading through the Browse API.
    let tracked: { id: string; created: boolean };
    try {
      tracked = await trackEbayItem(userId, target.itemId, new Date(nowMs));
    } catch (err) {
      if (err instanceof EbayItemNotFoundError) throw new WatchError(404, { error: 'not_found', key: 'research.shops.error.itemNotFound' });
      throw err;
    }
    const [summary] = await legacyEbayItemRows(userId, nowMs - READ_WINDOW_DAYS * DAY_MS, tracked.id);
    if (!summary) throw new WatchError(500, { error: 'server_error' });
    return { summary, quota: await watchQuota(userId), created: tracked.created, errors };
  }

  if (target.type === 'ebaySeller') {
    const existing = await prisma.ebayTrackedSeller.findUnique({ where: { userId_sellerUsername: { userId, sellerUsername: target.seller } } });
    let created = false;
    let row = existing;
    if (!existing) {
      row = await prisma.ebayTrackedSeller.create({ data: { userId, sellerUsername: target.seller } });
      created = true;
    } else if (!existing.isActive) {
      row = await prisma.ebayTrackedSeller.update({ where: { id: existing.id }, data: { isActive: true } });
      created = true;
    }
    const [summary] = await legacyEbayRows(userId, nowMs - READ_WINDOW_DAYS * DAY_MS, row!.id);
    return { summary, quota: await watchQuota(userId), created, errors };
  }

  if (!watchesAvailable()) throw UNAVAILABLE();

  let refId: string;
  let finalLabel: string;
  let marketplace: ResearchMkt;
  let shop: EtsyShopInfo | null = null;
  if (target.type === 'etsyShop') {
    // At the limit: answer before spending Etsy calls on resolving the shop (an already active watch still returns).
    const q = await watchQuota(userId);
    if (q.limit !== null && q.used >= q.limit) {
      const d0 = watchDelegate() as Delegate;
      const or = [
        ...(target.shopId ? [{ refId: target.shopId }] : []),
        ...(target.shopName ? [{ label: { equals: target.shopName, mode: 'insensitive' } }] : []),
      ];
      const active: ResearchWatchRow | null = or.length
        ? await d0.findFirst({ where: { userId, type: 'etsyShop', marketplace: 'etsy', isActive: true, ...(or.length === 1 ? or[0] : { OR: or }) } }).catch((err: unknown) => {
          if (isMissingTableError(err)) throw UNAVAILABLE();
          throw err;
        })
        : null;
      if (!active) throw quotaFull(q);
    }
    shop = await resolveEtsyShop(target);
    refId = shop.shopId;
    finalLabel = shop.name || label || refId; // the shop's own name, never a pasted link
    marketplace = 'etsy';
  } else if (target.type === 'query') {
    refId = normalizeQuery(target.text).slice(0, MAX_QUERY);
    if (!refId) throw new WatchError(400, { error: 'bad_request', key: 'research.watch.inputInvalid' });
    finalLabel = label ?? target.text.trim();
    marketplace = target.marketplace;
  } else {
    refId = target.productId;
    finalLabel = label ?? target.label ?? refId;
    marketplace = 'trendyol';
  }

  const d = watchDelegate() as Delegate;
  let row: ResearchWatchRow | null;
  let created = false;
  try {
    row = await findWatch(userId, target.type, marketplace, refId);
    if (row && !row.isActive) {
      await assertQuota(userId);
      if (typeof d.update !== 'function') throw UNAVAILABLE();
      row = await d.update({ where: { id: row.id }, data: { isActive: true, label: finalLabel, alertRules: rules } });
      created = true;
      await recheckQuotaAfterWrite(userId, row!.id);
    } else if (!row) {
      await assertQuota(userId);
      try {
        row = await d.create({ data: { userId, type: target.type, marketplace, refId, label: finalLabel, alertRules: rules, isActive: true } });
        created = true;
      } catch (err) {
        if (!isUniqueError(err)) throw err;
        row = await findWatch(userId, target.type, marketplace, refId);
      }
      if (created && row) await recheckQuotaAfterWrite(userId, row.id);
    }
  } catch (err) {
    if (isMissingTableError(err)) throw UNAVAILABLE();
    throw err;
  }
  if (!row) throw new WatchError(500, { error: 'server_error' });

  // First reading on add ("First reading taken today. Daily sales appear tomorrow."). Best effort.
  if (created && target.type === 'etsyShop') {
    try {
      if (!(await hasReadingToday('etsyShop', 'etsy', refId, nowMs))) {
        if (etsyBudgetLimited()) errors.push({ section: 'reading', key: 'research.error.budget' });
        else {
          const reading = await fetchShopReading(refId, { priority: EtsyPriority.Interactive, deferOn429: false, nowMs });
          await storeShopReading(refId, reading, new Date(nowMs));
        }
      }
    } catch (err) {
      errors.push({ section: 'reading', key: isBudgetError(err) ? 'research.error.budget' : 'research.shops.readingFailed' });
      if (!isBudgetError(err)) logger.warn('[research/watches] first reading failed', { shopId: refId, error: (err as Error)?.message });
    }
  }

  const snaps = (await snapshotsFor(target.type, marketplace, [refId], nowMs - READ_WINDOW_DAYS * DAY_MS)).get(refId) ?? [];
  return { summary: summaryFromResearchWatch(row, snaps, shop), quota: await watchQuota(userId), created, errors };
}

/** PATCH (ResearchWatch rows only). */
export async function patchWatch(userId: string, rawId: string, body: unknown, nowMs = Date.now()): Promise<WatchSummary> {
  const parsed = parseWatchId(rawId);
  if (!parsed) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
  if (parsed.source !== 'researchWatch') throw new WatchError(409, { error: 'read_only', key: 'research.watch.legacyReadOnly' });
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) throw new WatchError(400, { error: 'bad_request' });
  const d = watchDelegate();
  if (!d || typeof d.update !== 'function') throw UNAVAILABLE();
  try {
    const w: ResearchWatchRow | null = await d.findFirst({ where: { id: parsed.id, userId } });
    if (!w) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
    if (w.type === 'trendyolProduct') await requireFeature(userId, 'arbitrage');
    const data: Record<string, unknown> = {};
    if ('label' in b) {
      const l = cleanLabel(b.label);
      if (!l) throw new WatchError(400, { error: 'bad_request', key: 'research.watch.labelInvalid' });
      data.label = l;
    }
    if ('alertRules' in b) {
      const rules = parseAlertRules(b.alertRules, readAlertRules(w.alertRules));
      if (!rules) throw new WatchError(400, { error: 'bad_request', key: 'research.watch.rulesInvalid' });
      data.alertRules = rules;
    }
    if ('isActive' in b) {
      if (b.isActive !== true) throw new WatchError(400, { error: 'bad_request', key: 'research.watch.useDelete' });
      if (!w.isActive) {
        await assertQuota(userId);
        data.isActive = true;
      }
    }
    if (Object.keys(data).length === 0) throw new WatchError(400, { error: 'bad_request' });
    if (!w.isActive && data.isActive !== true) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
    const updated: ResearchWatchRow = await d.update({ where: { id: w.id }, data });
    if (data.isActive === true) await recheckQuotaAfterWrite(userId, w.id);
    const type = isWatchType(updated.type) ? updated.type : 'query';
    const snaps = (await snapshotsFor(type, updated.marketplace, [updated.refId], nowMs - READ_WINDOW_DAYS * DAY_MS)).get(updated.refId) ?? [];
    return summaryFromResearchWatch(updated, snaps, null);
  } catch (err) {
    if (isMissingTableError(err)) throw UNAVAILABLE();
    throw err;
  }
}

/** DELETE: soft (isActive=false) for every source; readings stay (shared). Legacy rows: same as the old untrack. */
export async function removeWatch(userId: string, rawId: string): Promise<{ id: string; removed: true }> {
  const parsed = parseWatchId(rawId);
  if (!parsed) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
  if (parsed.source === 'ebayTrackedSeller') {
    const r = await prisma.ebayTrackedSeller.updateMany({ where: { id: parsed.id, userId, isActive: true }, data: { isActive: false } });
    if (r.count === 0) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
    return { id: rawId, removed: true };
  }
  if (parsed.source === 'ebayTrackedProduct') {
    const r = await prisma.ebayTrackedProduct.updateMany({ where: { id: parsed.id, userId, isActive: true }, data: { isActive: false } });
    if (r.count === 0) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
    return { id: rawId, removed: true };
  }
  if (parsed.source === 'amazonTrackedProduct') {
    const r = await prisma.amazonTrackedProduct.updateMany({ where: { id: parsed.id, userId, isActive: true }, data: { isActive: false } });
    if (r.count === 0) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
    return { id: rawId, removed: true };
  }
  const d = watchDelegate();
  if (!d || typeof d.update !== 'function') throw UNAVAILABLE();
  try {
    const w: ResearchWatchRow | null = await d.findFirst({ where: { id: parsed.id, userId, isActive: true } });
    if (!w) throw new WatchError(404, { error: 'not_found', key: 'research.watch.notFound' });
    await d.update({ where: { id: w.id }, data: { isActive: false } });
    return { id: rawId, removed: true };
  } catch (err) {
    if (isMissingTableError(err)) throw UNAVAILABLE();
    throw err;
  }
}

// ─── Home helper (R1-A `home.ts` can merge these into `recentWatched`) ─────────────────────────────

export async function recentWatchedShops(userId: string, limit = 5): Promise<Array<{ kind: 'shop' | 'query'; label: string; href: string; at: string; change?: { key: string; params: Record<string, string | number> } }>> {
  if (!watchesAvailable()) return [];
  try {
    const data = await listWatches(userId);
    return data.rows
      .filter((r) => r.source === 'researchWatch' && (r.type === 'etsyShop' || r.type === 'query'))
      .map((r) => {
        const sc = r.metrics.salesVsPrev;
        const change = r.type === 'etsyShop' && sc.guard.ok && sc.value !== null && Math.abs(sc.value) >= 0.1
          ? { key: sc.value > 0 ? 'research.home.shopSalesUp' : 'research.home.shopSalesDown', params: { pct: Math.round(Math.abs(sc.value) * 100) } }
          : undefined;
        return { kind: r.type === 'etsyShop' ? 'shop' as const : 'query' as const, label: r.label, href: r.href, at: r.snapshots.last ?? r.createdAt, ...(change ? { change } : {}) };
      })
      .sort((a, b) => (b.change ? 1 : 0) - (a.change ? 1 : 0) || (a.at < b.at ? 1 : -1))
      .slice(0, limit);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

// ─── Cron: daily readings + alerts ──────────────────────────────────────────────────────────────────

export interface SnapshotRunSummary {
  skipped?: 'unavailable';
  shops: { due: number; taken: number; failed: number; alreadyToday: number };
  queries: { due: number; taken: number; failed: number; alreadyToday: number };
  /**
   * Stopped early on the Etsy daily budget gate. Targets are read oldest-reading-first, so the ones left out today
   * are the first ones tomorrow.
   */
  budgetStopped: boolean;
  /** Etsy 429s (counted per target; a burst of them ends the run like the budget gate). */
  rateLimited: number;
  /** Active watches skipped because they are past their owner's plan limit. */
  overQuota: number;
  alerts: { sent: number; suppressed: number };
  pruned: number;
}

const MAX_SHOPS_PER_RUN = 3000;
const MAX_QUERIES_PER_RUN = 500;
/** Consecutive 429s after which the run stops (a short burst only skips those targets). */
const MAX_CONSECUTIVE_RATE_LIMITS = 5;
const RATE_LIMIT_BACKOFF_MAX_MS = 30_000;

/** Only the daily budget (our breaker or the rate budget's 'budget' gate) ends the run; a 429 does not. */
function isDailyBudgetStop(err: unknown): boolean {
  if (err instanceof ResearchBudgetError) return true;
  return isBudgetError(err) && (err as { reason?: string }).reason === 'budget';
}

function backoff(err: unknown, signal?: AbortSignal): Promise<void> {
  const ms = Math.min(Math.max(Number((err as { retryAfterMs?: number })?.retryAfterMs) || 2_000, 500), RATE_LIMIT_BACKOFF_MAX_MS);
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

async function sendAlerts(watchers: ResearchWatchRow[], fires: (w: ResearchWatchRow) => AlertFire[], day: string, summary: SnapshotRunSummary): Promise<void> {
  const enabled = alertsAvailable();
  for (const w of watchers) {
    for (const f of fires(w)) {
      if (!enabled) { summary.alerts.suppressed++; continue; }
      try {
        await notify(w.userId, {
          type: f.type satisfies NotificationType,
          severity: f.severity,
          titleKey: `types.${f.type}`,
          params: { shop: w.label, ...f.params },
          link: watchHref(w.id),
          dedupeKey: `research:${f.type}:${w.id}:${day}`,
          entity: { type: 'researchWatch', id: w.id },
        });
        summary.alerts.sent++;
      } catch (err) {
        logger.warn('[research-snapshots] notify failed', { watchId: w.id, type: f.type, error: (err as Error)?.message });
      }
    }
  }
}

/**
 * Daily: one reading per distinct watched Etsy shop (`/shops/{id}` + ≤ 5 listing pages, Reconcile priority,
 * deferring at the daily budget gate) and per watched Etsy query (shared search cache, only if fetched today);
 * alerts for each watcher; prunes readings older than 400 days. Idempotent per UTC day (a target with a reading
 * today is skipped). Only watches inside their owner's current plan limit are read; targets with the oldest last
 * reading go first so a budget stop does not starve the same targets every day.
 */
export async function runResearchSnapshots(opts: { signal?: AbortSignal; nowMs?: number } = {}): Promise<SnapshotRunSummary> {
  const nowMs = opts.nowMs ?? Date.now();
  const summary: SnapshotRunSummary = {
    shops: { due: 0, taken: 0, failed: 0, alreadyToday: 0 },
    queries: { due: 0, taken: 0, failed: 0, alreadyToday: 0 },
    budgetStopped: false,
    rateLimited: 0,
    overQuota: 0,
    alerts: { sent: 0, suppressed: 0 },
    pruned: 0,
  };
  const wd = watchDelegate();
  const sd = snapshotDelegate();
  if (!wd || !sd) return { ...summary, skipped: 'unavailable' };

  let all: ResearchWatchRow[];
  try {
    // Every active type: all of them count toward the owner's limit.
    all = (await wd.findMany({ where: { isActive: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).sort(byWatchAge);
  } catch (err) {
    if (isMissingTableError(err)) return { ...summary, skipped: 'unavailable' };
    throw err;
  }
  const limits = new Map<string, number | null>();
  const inQuota = await watchesInQuota(all, async (userId) => {
    if (!limits.has(userId)) limits.set(userId, (await resolveWatchPlan(userId, new Date(nowMs))).limit);
    return limits.get(userId) ?? 0;
  });

  const groups = new Map<string, ResearchWatchRow[]>();
  for (const w of all) {
    if (w.type !== 'etsyShop' && w.type !== 'query') continue;
    if (w.type === 'query' && w.marketplace !== 'etsy') continue; // eBay query readings: not in v1 (POST refuses them)
    if (!inQuota.has(w.id)) { summary.overQuota++; continue; }
    const k = `${w.type}|${w.marketplace}|${w.refId}`;
    groups.set(k, [...(groups.get(k) ?? []), w]);
  }

  // Oldest last reading first (none in the read window = first).
  const keys = Array.from(groups.keys());
  const lastReading = new Map<string, number>();
  if (keys.length > 0) {
    const recent: Array<{ refId: string; type: string; takenAt: Date | string }> = await sd.findMany({
      where: {
        type: { in: ['etsyShop', 'query'] },
        marketplace: 'etsy',
        refId: { in: Array.from(new Set(keys.map((k) => k.split('|')[2]))) },
        takenAt: { gte: new Date(nowMs - READ_WINDOW_DAYS * DAY_MS) },
      },
      select: { refId: true, type: true, takenAt: true },
    });
    for (const r of recent) {
      const k = `${r.type}|etsy|${r.refId}`;
      lastReading.set(k, Math.max(lastReading.get(k) ?? 0, toMs(r.takenAt)));
    }
  }
  const byOldestReading = (a: string, b: string) => (lastReading.get(a) ?? 0) - (lastReading.get(b) ?? 0);
  const day = utcDay(nowMs);
  const takenAt = new Date(nowMs);
  const shopKeys = keys.filter((k) => k.startsWith('etsyShop|')).sort(byOldestReading).slice(0, MAX_SHOPS_PER_RUN);
  const queryKeys = keys.filter((k) => k.startsWith('query|')).sort(byOldestReading).slice(0, MAX_QUERIES_PER_RUN);
  summary.shops.due = shopKeys.length;
  summary.queries.due = queryKeys.length;

  let consecutive429 = 0;
  /** true = stop the run. */
  const onRateLimit = async (err: unknown): Promise<boolean> => {
    summary.rateLimited++;
    consecutive429++;
    if (consecutive429 >= MAX_CONSECUTIVE_RATE_LIMITS) return true;
    await backoff(err, opts.signal);
    return false;
  };

  for (const key of shopKeys) {
    if (opts.signal?.aborted) break;
    const refId = key.split('|')[2];
    try {
      if (await hasReadingToday('etsyShop', 'etsy', refId, nowMs)) { summary.shops.alreadyToday++; continue; }
      const lastMetrics = (await sd.findFirst({
        where: { type: 'etsyShop', marketplace: 'etsy', refId },
        orderBy: { takenAt: 'desc' },
        select: { metrics: true },
      }))?.metrics;
      if (!snapshotBudgetOk(snapshotCallsFor(isShopMetrics(lastMetrics) ? lastMetrics.activeCount : null))) { summary.budgetStopped = true; break; }
      const prevRows: ResearchSnapshotRow[] = await sd.findMany({
        where: { type: 'etsyShop', marketplace: 'etsy', refId, takenAt: { gte: new Date(nowMs - READ_WINDOW_DAYS * DAY_MS) } },
        orderBy: { takenAt: 'asc' },
        select: { id: true, refId: true, takenAt: true, metrics: true, type: true, marketplace: true },
      });
      const reading = await fetchShopReading(refId, { priority: EtsyPriority.Reconcile, deferOn429: true, nowMs });
      consecutive429 = 0;
      // Another run / a first reading on add stored today's reading meanwhile: no second row, no second alert.
      if (!(await storeShopReading(refId, reading, takenAt))) { summary.shops.alreadyToday++; continue; }
      summary.shops.taken++;

      const prevShop = prevRows.filter((r) => isShopMetrics(r.metrics));
      const prev = prevShop[prevShop.length - 1];
      const sm = shopMetrics([...prevShop, { takenAt, metrics: reading.metrics }]);
      const newSincePrev = prev ? reading.listings.filter((l) => l.cr !== null && l.cr * 1000 > toMs(prev.takenAt)).length : null;
      const prevPriceChange = prevShop.length > 0 ? shopMetrics(prevShop).metrics.priceChange : null;
      const input: AlertInput = { newSincePrev, priceChange: sm.metrics.priceChange, prevPriceChange, pairs: sm.pairs };
      await sendAlerts(groups.get(key) ?? [], (w) => evaluateShopAlerts(readAlertRules(w.alertRules), input), day, summary);
    } catch (err) {
      if (isDailyBudgetStop(err)) { summary.budgetStopped = true; break; }
      summary.shops.failed++;
      if (isBudgetError(err)) {
        if (await onRateLimit(err)) break;
        continue;
      }
      logger.warn('[research-snapshots] shop reading failed', { shopId: refId, error: (err as Error)?.message });
    }
  }

  for (const key of queryKeys) {
    if (opts.signal?.aborted || summary.budgetStopped || consecutive429 >= MAX_CONSECUTIVE_RATE_LIMITS) break;
    const refId = key.split('|')[2];
    try {
      if (await hasReadingToday('query', 'etsy', refId, nowMs)) { summary.queries.alreadyToday++; continue; }
      if (!snapshotBudgetOk(1)) { summary.budgetStopped = true; break; }
      const r = await queryReading(refId, nowMs);
      if ('deferred' in r) {
        if (r.deferred === 'budget') { summary.budgetStopped = true; break; }
        summary.queries.failed++;
        continue;
      }
      if (!(await insertSnapshot({ type: 'query', marketplace: 'etsy', refId, takenAt: r.takenAt, metrics: r.metrics }))) { summary.queries.alreadyToday++; continue; }
      summary.queries.taken++;
      consecutive429 = 0;
    } catch (err) {
      if (isDailyBudgetStop(err)) { summary.budgetStopped = true; break; }
      summary.queries.failed++;
      if (isBudgetError(err)) {
        if (await onRateLimit(err)) break;
        continue;
      }
      logger.warn('[research-snapshots] query reading failed', { query: refId, error: (err as Error)?.message });
    }
  }

  try {
    if (typeof sd.deleteMany === 'function') {
      const r = await sd.deleteMany({ where: { takenAt: { lt: new Date(nowMs - SNAPSHOT_RETENTION_DAYS * DAY_MS) } } });
      summary.pruned = r.count;
    }
  } catch (err) {
    logger.warn('[research-snapshots] prune failed', { error: (err as Error)?.message });
  }
  return summary;
}

/**
 * BR-8: the scheduler entry (`lib/scheduler/jobs.ts`), daily at 06:00 UTC. Runs inside a Reconcile-priority,
 * defer-on-429 Etsy budget context (background work: never competes with interactive calls, stops at the
 * Reconcile daily gate).
 */
export const researchSnapshotsJob = {
  name: 'research-snapshots',
  dailyAtUtc: READING_TIME_UTC,
  timeoutMs: 50 * 60_000,
  maxAttemptsPerBucket: 1,
  run: async (ctx: { bucket: string; signal: AbortSignal }) => {
    const s = await withEtsyBudget({ priority: EtsyPriority.Reconcile, deferOn429: true }, () => runResearchSnapshots({ signal: ctx.signal }));
    return s as unknown as Record<string, unknown>;
  },
};
