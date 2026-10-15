// lib/research/keywordTypes.ts — Keyword explorer API contract (research.md §6, §10; R2-A server, R2-B UI).
//
// Types + tiny pure helpers only: no React, no Prisma, safe to import from the browser.
// `KeywordRow` / `KeywordView` are the R1-A contract in lib/research/types.ts; everything the R2 endpoints add on top
// lives here so the UI codes against one file:
//
//   GET    /api/research/keywords                 → ResearchResponse<KeywordsData>      (views, progressive)
//   GET    /api/research/keywords?detail=<kw>     → ResearchResponse<KeywordDetailData> (row SidePanel)
//   GET    /api/research/keywords?history=<id>    → ResearchResponse<RankHistoryData>   (Tracked rank chart)
//   POST   /api/research/keywords/track           → { data: TrackData }
//   DELETE /api/research/keywords/track           → { data: UntrackData }
//   POST   /api/research/keywords/note            → { data: KeywordNoteData }  (503 `unavailable` until BR-1b ships)

import type { BuyerWord, DemandSignal, Guarded, KeywordRow, KeywordView, PriceSummary, ResearchMkt, TopListing } from './types';

export type { KeywordRow, KeywordView };

export const KEYWORD_VIEWS: readonly KeywordView[] = ['suggested', 'longtail', 'seasonal', 'mine', 'tracked'];
export function isKeywordView(v: unknown): v is KeywordView {
  return typeof v === 'string' && (KEYWORD_VIEWS as readonly string[]).includes(v);
}

/** Marketplaces the Keyword explorer serves (research.md §3.2: Trendyol is hidden). */
export type KeywordMkt = Extract<ResearchMkt, 'etsy' | 'ebay' | 'amazon'>;

// ─── Filters (FiltersSheet, URL `f.<key>=`) ─────────────────────────────────

export type CompetitionBand = 'lt1k' | '1to10k' | 'gt10k';
export const COMPETITION_BANDS: readonly CompetitionBand[] = ['lt1k', '1to10k', 'gt10k'];

export interface KeywordFilters {
  /** `f.notInTitle=1` — only with `?listing`: drop keywords that share a content word with the listing title. */
  notInTitle?: boolean;
  /** `f.maxLen=20` — keywords that fit an Etsy tag (≤ 20 characters). */
  maxLen20?: boolean;
  /** `f.competition=lt1k|1to10k|gt10k`. */
  competition?: CompetitionBand;
  /** `f.demand=1..5` — Demand Signal tier at least this (spec "≥ ●●●" = 3). */
  demandMin?: 1 | 2 | 3 | 4 | 5;
}

/** Long-tail view rule (research.md §6.1). */
export const LONGTAIL_MIN_WORDS = 3;
export const LONGTAIL_MAX_COMPETITION = 5_000;
/** Seasonal view: Google Trends peak month starts within this many days. */
export const SEASONAL_WINDOW_DAYS = 90;
/** Seasonal view: peak-month interest ≥ this × the 12-month mean. */
export const SEASONAL_MIN_RATIO = 1.4;
/** Below this many top listings the row is a "small sample" (research.guard.small). */
export const KEYWORD_SMALL_SAMPLE = 20;

// ─── Rows ───────────────────────────────────────────────────────────────────

export type KeywordOrigin = 'seed' | 'tags' | 'autocomplete' | 'listing' | 'shop';

/**
 * A KeywordRow plus what the R2 views need. Structurally a `KeywordRow` (extra fields only), so R2-B can type its
 * table as `KeywordRow` and read the extras where it needs them.
 */
export interface KeywordRowExt extends KeywordRow {
  /** Character count (Etsy tag limit 20). */
  length: number;
  /** Word count (Long-tail ≥ 3). */
  words: number;
  /** Why the keyword is in the pool. */
  origin: KeywordOrigin[];
  /** With `?listing`: already one of the listing's tags. */
  inCurrent?: boolean;
  /** With `?listing`: content words shared with the listing title (empty = "Not in title"). */
  titleOverlap?: string[];
  /** Seasonal view: Google Trends peak month (1–12), days until it starts (0 = now), peak ÷ 12-month mean. */
  seasonal?: { peakMonth: number; inDays: number; ratio: number };
  /** Used in my shop: the user's listings that use this exact tag (≤ 20, most recent first) for the row expand. */
  listings?: Array<{ id: string; shopId: string; title: string }>;
  /** With `?listing`: the RankTrackedKeyword id when this keyword is tracked for that listing (Stop tracking). */
  trackedId?: string;
  /** "You entered" Etsy volume mapped onto the 1–5 scale (`etsyVolumeTier`). */
  volumeTier?: 1 | 2 | 3 | 4 | 5;
  /** True when the Demand Signal and the entered Etsy volume differ by ≥ 3 tiers ("trust Etsy's"). */
  volumeDisagrees?: boolean;
}

/** `?listing` header line: "Current tags 11 / 13 · 2 repeat title words · 1 over 20 characters". */
export interface KeywordCurrent {
  listingId: string;
  shopId: string;
  /** Entity-decoded. */
  title: string;
  thumbUrl: string | null;
  tags: string[];
  issues: {
    count: number;
    max: 13;
    /** Tags sharing a content word with the title. */
    overlap: number;
    overlapTags: string[];
    /** Tags over 20 characters. */
    long: number;
    longTags: string[];
  };
}

export interface TrackedKeywordRow {
  /** RankTrackedKeyword id (Stop tracking, `?history=`). */
  id: string;
  keyword: string;
  listing: { id: string; shopId: string; title: string; thumbUrl: string | null };
  /** `now: null` = "Not in top 500" (never 0). `delta7` > 0 = moved up (better). */
  rank: { now: number | null; delta7: number | null; best: number | null; checkedAt: string | null };
  /** Measured, `EtsyListingDailyStat.unitsSold` for the listing. */
  sales14d: SalesWindows;
  /** Latest SEO experiment that includes this listing (link to `/app/etsy-aktivite?tab=seo`; we never rebuild it). */
  experiment: { id: string; status: string; changedAt: string } | null;
  /** ISO, when tracking started. */
  trackedSince: string;
}

export interface SalesWindows {
  /** Units sold in the last 14 days. Guard `research.kw.salesCollecting {days}` under 7 days of daily stats. */
  last14: Guarded<number>;
  /** ISO of the last KolayXport send for this listing (EtsyListingVersion attribution `kolayxport_draft`), null when none in 90 days. */
  lastSendAt: string | null;
  /** 14 days before the last send (only with `lastSendAt`). */
  beforeSend?: Guarded<number>;
  /** Up to 14 days after the last send (only with `lastSendAt`); `afterDays` = days elapsed (≤ 14). */
  afterSend?: Guarded<number>;
  afterDays?: number;
}

export interface KeywordsData {
  view: KeywordView;
  mkt: KeywordMkt;
  country: string;
  /** The seed phrase used (the `q`, or the listing's main keyword). Null for `mine` / `tracked`. */
  query: string | null;
  /** Resolved rows for the view, sorted and filtered server-side. Empty for `tracked`. */
  rows: KeywordRowExt[];
  /** `tracked` view only. */
  tracked?: TrackedKeywordRow[];
  /** With `?listing` (Etsy). */
  current?: KeywordCurrent;
  /**
   * Present while candidates are still resolving: call again with `cursor=<next>` and REPLACE `rows` with the new
   * response (every response carries all rows resolved so far). Absent = done (or stopped by the budget breaker).
   */
  next?: string;
  /** "Checking {done} of {total} keywords…" while `next` is present. */
  progress?: { done: number; total: number };
  /** False until the backend ships `ResearchKeywordNote` (BR-1b): hide "Etsy volume · add ↗". */
  volumeAvailable: boolean;
  /** ISO of the oldest metric in `rows` (SourceNote "updated …"). */
  fetchedAt: string;
}

export interface RankPoint {
  /** ISO. */
  at: string;
  /** null = not in top 500. */
  rank: number | null;
}

export interface RankMarker {
  /** ISO. */
  at: string;
  /** `send` = an EtsyListingVersion with attribution `kolayxport_draft`; `experiment` = a SeoExperiment cohort date. */
  kind: 'send' | 'experiment';
  id: string;
}

export interface RankHistoryData {
  trackedId: string;
  keyword: string;
  listingId: string;
  shopId: string;
  /** Oldest first, ≤ 120 points. */
  points: RankPoint[];
  markers: RankMarker[];
  summary: TrackedKeywordRow['rank'];
}

/** Row SidePanel: the top listings for the keyword, tag co-occurrence, price band, and rank history when tracked. */
export interface KeywordDetailData {
  keyword: string;
  mkt: KeywordMkt;
  country: string;
  total: Guarded<number>;
  /** In the country currency, FX-normalized, robust (no mean). */
  price: PriceSummary;
  /** ≤ 48. */
  top: TopListing[];
  /** Tags used together with this keyword by the top listings (the keyword itself excluded). Etsy only. */
  cooccurring: BuyerWord[];
  demand: Pick<DemandSignal, 'tier' | 'inputs'>;
  /** With `?listing=` and the keyword tracked for it. */
  history?: RankHistoryData;
  fetchedAt: string;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export interface TrackRequest {
  /** Etsy listing_id. */
  listingId: string;
  /** Etsy shop id (must belong to the user). */
  shopId: string;
  /** 1–13 keywords, 2–60 characters each (lower-cased, trimmed, deduped). */
  keywords: string[];
  listingTitle?: string;
  /**
   * Check the rank right away for up to 3 newly tracked keywords (default true). Pass false for auto-tracking of
   * tags just added from the explorer (the daily cron checks them).
   */
  checkNow?: boolean;
}

export interface TrackData {
  /** Keywords now active for the listing from this request. */
  tracked: number;
  ids: Array<{ keyword: string; id: string }>;
  /** Immediate rank checks (rank null = not in top 500). */
  checked: Array<{ keyword: string; id: string; rank: number | null; totalResults: number }>;
}

/** DELETE body (or query): `ids[]`, or `listingId` + `keywords[]`. */
export interface UntrackRequest {
  ids?: string[];
  listingId?: string;
  keywords?: string[];
}

export interface UntrackData {
  /** Rows deactivated. */
  tracked: number;
}

export interface KeywordNoteRequest {
  keyword: string;
  /** "Searches in the last 30 days (from Etsy)". `null` removes the note. Integer 0 – 10,000,000. */
  etsySearches30d: number | null;
}

export interface KeywordNoteData {
  keyword: string;
  value: number | null;
  enteredAt: string | null;
}

/** Error body of the R2 write endpoints. `unavailable` = BR-1b not deployed (note) — render the info, not an error. */
export interface KeywordErrorBody {
  error: 'unauthorized' | 'bad_request' | 'forbidden' | 'not_found' | 'method_not_allowed' | 'rate_limited' | 'unavailable' | 'server_error';
  key?: string;
}

// ─── Pure helpers (shared by server and UI) ─────────────────────────────────

/** Entered Etsy 30-day searches → the Demand Signal's 1–5 scale (log bands: <100, <500, <2k, <10k, ≥10k). */
export function etsyVolumeTier(searches30d: number): 1 | 2 | 3 | 4 | 5 {
  const v = Math.max(0, Number(searches30d) || 0);
  if (v < 100) return 1;
  if (v < 500) return 2;
  if (v < 2_000) return 3;
  if (v < 10_000) return 4;
  return 5;
}

/** RR §6.4: our Signal and Etsy's own number differ by ≥ 3 tiers → "Our signal differs from Etsy's number: trust Etsy's". */
export function volumeDisagrees(signalTier: number | null | undefined, searches30d: number | null | undefined): boolean {
  if (!signalTier || searches30d == null) return false;
  return Math.abs(signalTier - etsyVolumeTier(searches30d)) >= 3;
}

export function competitionBandOf(total: number | null | undefined): CompetitionBand | null {
  if (total == null || !Number.isFinite(total)) return null;
  if (total < 1_000) return 'lt1k';
  if (total <= 10_000) return '1to10k';
  return 'gt10k';
}
