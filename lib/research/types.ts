// lib/research/types.ts — research hub API contract (research.md §10). Types only + tiny constants.
// Shared by the server (pages/api/research/*) and the hub UI (R1-C, R1-D, R2, R3). No React, no Prisma.
//
// Every research response is `ResearchResponse<T>`: `{ data, source, errors? }`. All user-visible text is
// an i18n key + params (`Fact`, `Guarded.guard.reasonKey`, `SourceNoteProps.source`), never a sentence.
// `components/ds/research/types.ts` mirrors `MetricKind` / `Fact` / `Guarded` on the props side; the shapes
// here are structurally assignable to it (DS `Fact.params` is optional, here it is always present).

import type { PriceSummary } from './stats';
import type { Check } from '@/lib/listingScore/types';
import type { ListingRow } from '@/lib/listings/types';

export type { PriceSummary, Check, ListingRow };

// ─── Primitives ─────────────────────────────────────────────────────────────

export type ResearchMkt = 'etsy' | 'ebay' | 'amazon' | 'trendyol';
export const RESEARCH_MKTS: readonly ResearchMkt[] = ['etsy', 'ebay', 'amazon', 'trendyol'];
export function isResearchMkt(v: unknown): v is ResearchMkt {
  return typeof v === 'string' && (RESEARCH_MKTS as readonly string[]).includes(v);
}

export type MetricKind = 'measured' | 'estimate' | 'signal' | 'user';

/**
 * Props for `components/ds/research/SourceNote`. `source` is an i18n key of the source name only
 * ("Etsy search"); SourceNote appends sample, excluded, "updated …" and the kind itself.
 */
export interface SourceNoteProps {
  source: string;
  sourceParams?: Record<string, string | number>;
  /** ISO. When served from cache this is the original fetch time, never "now". */
  fetchedAt: string;
  /** Items used (after exclusions). */
  sample?: number;
  /** Items fetched before exclusions (renders "287 of 300 listings used"). */
  sampleTotal?: number;
  sampleUnit?: 'listings' | 'keywords' | 'shops' | 'orders' | 'items';
  excluded?: { count: number; reasonKey: string; reasonParams?: Record<string, string | number> };
  kind: MetricKind;
}

export interface GuardResult {
  ok: boolean;
  reasonKey?: string;
  reasonParams?: Record<string, string | number>;
}

/** A number that may not be shown: `value: null` or `guard.ok: false` renders "—" with the reason. */
export interface Guarded<T> {
  value: T | null;
  kind: MetricKind;
  guard: GuardResult;
}

/** EvidenceSummary fact: i18n key + params, rendered on the client. Never AI text. */
export interface Fact {
  key: string;
  params: Record<string, string | number>;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Evidence {
  /** 2–4 computed facts. */
  facts: Fact[];
  confidence: Confidence;
  /** What the confidence is based on ("287 listings, Etsy shares no search volume"). */
  basis: Fact;
}

/** A section that failed or degraded; the UI renders it inline (never a toast). */
export interface ResearchSectionError {
  /** `all` | `price` | `competition` | `demand` | `newcomers` | `shops` | `peers` | `marketplace` | `stats` | … */
  section: string;
  /** i18n key, e.g. `research.error.budget`, `research.error.etsy`. */
  key: string;
  params?: Record<string, string | number>;
}

export interface ResearchResponse<T> {
  /** `null` only when the whole tool is unavailable for this request (see `errors`). */
  data: T | null;
  source: SourceNoteProps;
  errors?: ResearchSectionError[];
}

/** Error body for 4xx/5xx (never raw upstream text). */
export interface ResearchErrorBody {
  error: 'unauthorized' | 'bad_request' | 'not_found' | 'method_not_allowed' | 'rate_limited' | 'ai_failed' | 'server_error';
  key?: string;
}

// ─── Demand Signal (RR §6.2) ───────────────────────────────────────────────

export type DemandInputKey = 'googleTrends' | 'autocomplete' | 'engagement' | 'trendyolFavorites';

export interface DemandInput {
  key: DemandInputKey;
  /** Raw value for the tooltip: trends 0–100 mean, autocomplete 0–3 sources, engagement favorites/month median. Null = input dropped. */
  value: number | null;
  /** Normalized 0–1 contribution (null when dropped). */
  normalized: number | null;
  ok: boolean;
  /** Why the input dropped out (i18n key). */
  reasonKey?: string;
}

export interface DemandSignal {
  /** 1–5 dots; null = "Not enough signal" (fewer than 2 inputs). */
  tier: 1 | 2 | 3 | 4 | 5 | null;
  inputs: DemandInput[];
  kind: 'signal';
}

// ─── Product finder (`GET /api/research/products`) ─────────────────────────

export interface TopListing {
  id: string;
  /** Entity-decoded. */
  title: string;
  url: string | null;
  thumbUrl: string | null;
  price: { amount: number; currency: string } | null;
  /**
   * `price` in the search's summary currency (same FX table as the price summary), so a list mixing MAD/£/€/$ reads in
   * one currency. Null/absent when no rate exists or the price is already in that currency (then `price` is it).
   */
  priceConverted?: { amount: number; currency: string } | null;
  /** Lifetime counter, render "(all time)". Etsy: favorites; eBay: null. */
  favorites: number | null;
  /** From `original_creation_timestamp` (never the renew date). Null when unknown. */
  ageDays: number | null;
  shop: { id: string | null; name: string | null; url: string | null };
  tags: string[];
  /** Trendyol: the marketplace's own order badge as shown ("100+"). */
  orderBadge?: string | null;
  /** Trendyol: number of ratings (a sales trace: buyers who rated). */
  ratingCount?: number | null;
  /** Trendyol/Hepsiburada: crowd sales (lib/market/sales): per day/30 days with a calibration, lifetime, rating growth. */
  crowd?: {
    salesPerDay: number | null;
    revenuePerDay: number | null;
    salesPer30d: number | null;
    revenuePer30d: number | null;
    lifetimeSales: number | null;
    ratingsPer30d: number | null;
  } | null;
}

export interface BuyerWord {
  tag: string;
  /** 0–1 share of the top-48 listings that use the tag. */
  share: number;
  count: number;
}

export interface ProductsResult {
  query: string;
  mkt: ResearchMkt;
  country: string;
  evidence: Evidence;
  /** Robust summary (median, p25–p75, n, exclusions, quality). No mean anywhere. */
  price: PriceSummary;
  competition: {
    /** Supply: listings matching the query (Measured). */
    total: Guarded<number>;
    /** 0–1 share of the top 48 held by the 5 biggest shops (Measured; duplicates collapsed per shop). */
    top5Share: Guarded<number>;
  };
  demand: DemandSignal;
  /** 0–1 share of the top-48 shops opened less than 1 year ago. */
  newcomers: Guarded<number>;
  /** Etsy only (eBay has no tags): tags used by the top 48. */
  buyerWords: BuyerWord[];
  top: TopListing[];
  /** For "Draft a listing": mode taxonomy id of the top 48 (Etsy) or category id (eBay). */
  categoryHint: string | null;
  /** For "Draft a listing": ≤ 13 tags, ≤ 20 chars, deduped (normalizeTags). */
  draftTags: string[];
  fetchedAt: string;
  /** True when served from the shared cache. */
  cached: boolean;
}

/** `data` of `GET /api/research/products`. With `q` repeated (compare), `compare` holds every query in order. */
export type ProductsData = ProductsResult & { compare?: ProductsResult[] };

// ─── Seeds (`POST /api/research/seeds`) ────────────────────────────────────

export interface SeedsRequest {
  text: string;
  mkt?: ResearchMkt;
}

export interface SeedsData {
  /** English marketplace phrases, ≤ 5. Keywords stay English (P5). */
  seeds: string[];
  /** The input that was translated. */
  from: string;
}

// ─── Keyword explorer (R2; types fixed here so R2 codes against them) ─────

export type KeywordView = 'suggested' | 'longtail' | 'seasonal' | 'mine' | 'tracked';

export interface KeywordRow {
  keyword: string;
  demand: Pick<DemandSignal, 'tier' | 'inputs'>;
  competition: Guarded<number>;
  top48: Guarded<number>;
  priceBand: Pick<PriceSummary, 'p25' | 'p75' | 'currency' | 'n'>;
  inMyShop: number;
  etsyVolume?: { value: number; enteredAt: string };
  rank?: { now: number | null; delta7: number | null; best: number | null };
}

// ─── Listing doctor (`GET /api/research/listings`) ─────────────────────────

export type DoctorSort = 'opportunity' | 'health' | 'views' | 'sales';

/** Health filter bands (same tokens as listings-grid `health`). */
export type DoctorHealthBand = 'lt50' | '50-74' | '75-89' | 'gte90';
export const DOCTOR_HEALTH_BANDS: readonly DoctorHealthBand[] = ['lt50', '50-74', '75-89', 'gte90'];
export const DOCTOR_SORTS: readonly DoctorSort[] = ['opportunity', 'health', 'views', 'sales'];

/** Which opportunity rule placed the row (research.md §7.3). */
export type OpportunityRule = 'traffic_no_sales' | 'cant_be_found' | 'health_gaps' | 'other';

export interface MainKeyword {
  keyword: string;
  /** `tracked` = a RankTrackedKeyword; `user` = passed as `?keyword=`; `title` = the title lead phrase (no AI in R1-A); `ai` = AI pick (later). */
  source: 'tracked' | 'user' | 'title' | 'ai';
  /** Latest API position; null = not in top 500 (only meaningful for `tracked`). */
  rank: number | null;
}

export interface DoctorRow {
  listing: ListingRow;
  /** Sum of `EtsyListingDailyStat.views` over 30 days (Measured); guard fails with `research.doc.collecting` under 7 daily rows. eBay: not available. */
  views30d: Guarded<number>;
  /** Etsy: `EtsyListingDailyStat.unitsSold`; eBay: `OrderItem.listingRef` quantities in the window (Measured). */
  sales30d: Guarded<number>;
  /** 0–1, sales30d / views30d (Measured when both are). */
  conversion: Guarded<number>;
  mainKeyword?: MainKeyword;
  /** The failing listing check with the biggest gain. */
  biggestIssue?: { checkId: string; label: string; params: Record<string, string | number>; gain: number };
  /** Count of failing + warning listing checks. */
  issues: number;
  opportunity: { rule: OpportunityRule; rank: number };
}

export interface DoctorStore {
  id: string;
  name: string;
  currency: string | null;
  /** ISO of the last listing pull; null = connected, never pulled. */
  lastPulledAt: string | null;
}

export interface DoctorData {
  /** False → render `ConnectState` for `mkt`. */
  connected: boolean;
  store: DoctorStore | null;
  stores: { id: string; name: string }[];
  rows: DoctorRow[];
  total: number;
  /** Rows with health < 50 (whole shop, before `q`/`issue` filters). */
  needsWorkTotal: number;
  /** ISO date of the shop's first daily-stat row; null when none ("Collecting daily stats since …"). */
  statsSince: string | null;
  /** ISO of the latest daily-stat row ("updated 06:00"). */
  statsUpdatedAt: string | null;
  page: number;
  size: number;
}

// ─── Peers (`GET /api/research/listings/[id]/peers`) ──────────────────────

export interface PeersBlock {
  /** Peer listings compared (own listing excluded). */
  n: number;
  /** In the listing's currency (FX-normalized). */
  price: PriceSummary;
  titleLen: Guarded<number>;
  photos: Guarded<number>;
  /** 0–1. */
  videoShare: Guarded<number>;
  /** 0–1. */
  freeShippingShare: Guarded<number>;
  /** Most used peer tags (for the tags check and "Get tag ideas"). */
  topTags: BuyerWord[];
}

export interface PeersData {
  keyword: MainKeyword;
  peers: PeersBlock;
  /** Research-only checks, `group: 'peers'`; never part of the stored health score. */
  checks: Check[];
  /**
   * The listing's full `lib/listingScore` checks (same scorer as the grid and the editor), scored with the peer
   * price band as the market input when the band is usable (`price_market` otherwise stays `na`). Gains filled.
   */
  listingChecks: Check[];
  fetchedAt: string;
}

// ─── Explain (`POST /api/research/explain`) ───────────────────────────────

export type ExplainTool = 'products' | 'listing' | 'keywords' | 'shop';
export const EXPLAIN_TOOLS: readonly ExplainTool[] = ['products', 'listing', 'keywords', 'shop'];

export interface ExplainRequest {
  tool: ExplainTool;
  /** The computed numbers the UI already shows (flat or 1-level nested object of numbers/strings/booleans). */
  metrics: Record<string, unknown>;
  /** UI locale for the commentary ('en' | 'tr'); defaults to the request locale. */
  locale?: 'en' | 'tr';
}

export interface ExplainData {
  /** ≤ 600 chars; every number in it appears in `metrics` (numbers check). */
  text: string;
  locale: 'en' | 'tr';
  /** Sentences removed by the numbers check. */
  stripped: number;
}

// ─── Seasons (`GET /api/research/seasons`) ────────────────────────────────

export interface SeasonRow {
  /** Event key (`research.season.<key>`). */
  key: string;
  country: string;
  /** ISO date (YYYY-MM-DD) of the event. */
  date: string;
  /** ISO date to have the listing live by. */
  listBy: string;
  /** Days from today to `listBy` (≥ 0: events already too late to list are left out). */
  daysToListBy: number;
  lastShip: { carrier: string; date: string; transitDays: Guarded<number>; sample: number };
  productionDays: number;
  /** English seed for Product finder (`?q=`). */
  seed: string;
}

export interface SeasonsData {
  events: SeasonRow[];
  productionDays: number;
}

// ─── Home (`GET /api/research/home`) ──────────────────────────────────────

export interface RecentWatchedItem {
  kind: 'keyword' | 'shop' | 'query';
  label: string;
  href: string;
  change?: Fact;
  /** ISO. */
  at: string;
}

export interface HomeData {
  connected: { etsy: boolean; ebay: boolean };
  /** Marketplace the needs-work card was computed for (null when none is connected). */
  needsWorkMkt: 'etsy' | 'ebay' | null;
  needsWork: DoctorRow[];
  needsWorkTotal: number;
  recentWatched: RecentWatchedItem[];
}
