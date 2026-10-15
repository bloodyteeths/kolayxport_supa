// lib/research/rank.ts — keyword rank tracking (research.md §6.1 Tracked view, §10 `keywords/track`; R2-A).
//
// One home for the rank logic that used to live inline in pages/api/clawd/etsy.ts (`check_keyword_rank`,
// `add_tracked_keyword`, `auto_track_listing_tags`, `remove_tracked_keyword`, `get_tracked_keywords`,
// `get_rank_history`). The clawd actions call these functions and keep their JSON; the hub endpoints
// (`pages/api/research/keywords/*`) call them too.
//
// Rank = position of the listing in Etsy's public API search (`/listings/active`, sort score desc), top 500, not
// personalized, ads excluded. `null` = not in the top 500, never 0.
//
// Every query is scoped by `userId` (the legacy remove/history actions were not: any id could be deactivated/read).
// Server-only (Prisma). The summaries at the bottom are pure and unit-tested.

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { etsyFetch, etsyPublicHeaders, ETSY_API_BASE } from '@/lib/etsy/http';
import { EtsyPriority } from '@/lib/etsy/rateBudget';
import { etsyBudgetLimited, EtsyUpstreamError, isBudgetError, ResearchBudgetError } from './etsySearch';
import type { Guarded } from './types';
import type { RankMarker, RankPoint, SalesWindows, TrackedKeywordRow } from './keywordTypes';

export const RANK_MAX_PAGES = 5;
export const RANK_PAGE_SIZE = 100;
export const RANK_PAGE_DELAY_MS = 120;
export const MAX_TRACK_PER_REQUEST = 13;
/** Immediate rank checks per track request (each costs up to 5 Etsy calls). */
export const MAX_IMMEDIATE_CHECKS = 3;
export const KEYWORD_MIN_LEN = 2;
export const KEYWORD_MAX_LEN = 60;
const DAY_MS = 86_400_000;

// ─── Rank check ─────────────────────────────────────────────────────────────

export interface RankResult {
  rank: number | null;
  page: number | null;
  totalResults: number;
}

/** Fetches one search page. `page` is 0-based (the clawd caller paces pages > 0). */
export type RankPageGetter = (path: string, page: number) => Promise<any>;

/** Default getter: public API through the shared Etsy budget, with the 85 % research breaker. */
export const publicRankGetter = (priority: EtsyPriority = EtsyPriority.Interactive): RankPageGetter => async (path, page) => {
  if (etsyBudgetLimited()) throw new ResearchBudgetError();
  if (page > 0) await new Promise((r) => setTimeout(r, RANK_PAGE_DELAY_MS));
  const res = await etsyFetch(`${ETSY_API_BASE}${path}`, { headers: etsyPublicHeaders() }, { priority });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new EtsyUpstreamError(res.status, `Etsy public API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? {} : res.json();
};

export function rankSearchPath(keyword: string, page: number): string {
  const params = new URLSearchParams({
    keywords: keyword,
    limit: String(RANK_PAGE_SIZE),
    offset: String(page * RANK_PAGE_SIZE),
    sort_on: 'score',
    sort_order: 'desc',
  });
  return `/listings/active?${params}`;
}

/** Position of `listingId` in the top 500 for `keyword`. Stops at the first page that has it or a short page. */
export async function checkKeywordRank(
  keyword: string,
  listingId: string,
  opts: { get?: RankPageGetter; maxPages?: number } = {},
): Promise<RankResult> {
  const get = opts.get ?? publicRankGetter();
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? RANK_MAX_PAGES, RANK_MAX_PAGES));
  let totalResults = 0;
  for (let p = 0; p < maxPages; p++) {
    const data = await get(rankSearchPath(keyword, p), p);
    if (p === 0) totalResults = Number(data?.count) || 0;
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const idx = results.findIndex((r) => String(r?.listing_id) === String(listingId));
    if (idx !== -1) return { rank: p * RANK_PAGE_SIZE + idx + 1, page: p + 1, totalResults };
    if (results.length < RANK_PAGE_SIZE) break;
  }
  return { rank: null, page: null, totalResults };
}

// ─── Track / untrack ────────────────────────────────────────────────────────

/** Lower-case, trimmed, single-spaced; null when outside 2–60 characters. */
export function normalizeTrackKeyword(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const k = input.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (k.length < KEYWORD_MIN_LEN || k.length > KEYWORD_MAX_LEN) return null;
  return k;
}

/** Normalized, deduped, capped list (order kept). */
export function normalizeTrackKeywords(input: unknown, max = MAX_TRACK_PER_REQUEST): string[] {
  const arr = Array.isArray(input) ? input : [];
  const out: string[] = [];
  for (const raw of arr) {
    const k = normalizeTrackKeyword(raw);
    if (k && !out.includes(k)) out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

/** True when the Etsy shop belongs to the user (EtsyShop, or a legacy single-shop Credential row). */
export async function userOwnsEtsyShop(userId: string, shopId: string): Promise<boolean> {
  const shop = await prisma.etsyShop.findFirst({ where: { shopId, userId, isActive: true }, select: { id: true } });
  if (shop) return true;
  const cred = await prisma.credential.findFirst({ where: { etsyShopId: shopId, userId }, select: { id: true } });
  return !!cred;
}

export interface TrackInput {
  userId: string;
  shopId: string;
  listingId: string;
  listingTitle?: string;
  /** Already normalized (normalizeTrackKeywords). */
  keywords: string[];
  /** How many of the keywords to rank-check now (0 = cron only). Budget errors stop the checks, never the tracking. */
  checkNow?: number;
  get?: RankPageGetter;
}

export interface TrackOutput {
  ids: Array<{ keyword: string; id: string }>;
  checked: Array<{ keyword: string; id: string } & RankResult>;
  /** Stopped by the budget breaker before all requested checks ran. */
  budgetLimited: boolean;
}

/** Upserts (re-activates) each keyword for the listing; optional immediate rank check writes a RankSnapshot. */
export async function trackKeywords(input: TrackInput): Promise<TrackOutput> {
  const ids: TrackOutput['ids'] = [];
  for (const keyword of input.keywords) {
    try {
      const row = await prisma.rankTrackedKeyword.upsert({
        where: { userId_etsyListingId_keyword: { userId: input.userId, etsyListingId: String(input.listingId), keyword } },
        update: { isActive: true, ...(input.listingTitle ? { listingTitle: input.listingTitle } : {}) },
        create: {
          userId: input.userId,
          etsyShopId: input.shopId,
          etsyListingId: String(input.listingId),
          listingTitle: input.listingTitle || '',
          keyword,
        },
        select: { id: true },
      });
      ids.push({ keyword, id: row.id });
    } catch (err) {
      logger.warn('[research/rank] track upsert failed', { keyword, error: (err as Error)?.message });
    }
  }

  const checked: TrackOutput['checked'] = [];
  let budgetLimited = false;
  for (const { keyword, id } of ids.slice(0, Math.max(0, input.checkNow ?? 0))) {
    try {
      const r = await checkKeywordRank(keyword, input.listingId, { get: input.get });
      await prisma.rankSnapshot.create({ data: { keywordId: id, rank: r.rank, page: r.page, totalResults: r.totalResults } });
      checked.push({ keyword, id, ...r });
    } catch (err) {
      if (isBudgetError(err)) { budgetLimited = true; break; }
      logger.error('Rank check failed on add:', err as Error);
    }
  }
  return { ids, checked, budgetLimited };
}

/** Deactivates the user's rows by id, or by listing + keywords. Returns the count (0 = nothing of the user's matched). */
export async function untrackKeywords(input: { userId: string; ids?: string[]; listingId?: string; keywords?: string[] }): Promise<number> {
  const ids = (input.ids ?? []).filter((s) => typeof s === 'string' && s.length > 0 && s.length <= 64).slice(0, 200);
  const keywords = normalizeTrackKeywords(input.keywords ?? [], 200);
  const or: Array<Record<string, unknown>> = [];
  if (ids.length) or.push({ id: { in: ids } });
  if (input.listingId && keywords.length) or.push({ etsyListingId: String(input.listingId), keyword: { in: keywords } });
  if (or.length === 0) return 0;
  const r = await prisma.rankTrackedKeyword.updateMany({ where: { userId: input.userId, isActive: true, OR: or }, data: { isActive: false } });
  return r.count;
}

// ─── Legacy read shapes (clawd `get_tracked_keywords`, `get_rank_history`) ──

export interface LegacyTrackedKeyword {
  id: string;
  keyword: string;
  etsyListingId: string;
  listingTitle: string;
  rank: number | null;
  page: number | null;
  totalResults: number;
  /** First → latest, positive = improved. */
  change: number | null;
  checkedAt: Date | null;
  firstCheckedAt: Date | null;
  snapshotCount: number;
}

export async function listTrackedKeywordsLegacy(userId: string, listingId?: string): Promise<LegacyTrackedKeyword[]> {
  const where: Record<string, unknown> = { userId, isActive: true };
  if (listingId) where.etsyListingId = String(listingId);
  const keywords = await prisma.rankTrackedKeyword.findMany({
    where,
    include: { snapshots: { orderBy: { checkedAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  return keywords.map((kw) => {
    const first = kw.snapshots[0] || null;
    const latest = kw.snapshots[kw.snapshots.length - 1] || null;
    const change = latest?.rank != null && first?.rank != null && kw.snapshots.length > 1 ? first.rank - latest.rank : null;
    return {
      id: kw.id,
      keyword: kw.keyword,
      etsyListingId: kw.etsyListingId,
      listingTitle: kw.listingTitle,
      rank: latest?.rank ?? null,
      page: latest?.page ?? null,
      totalResults: latest?.totalResults ?? 0,
      change,
      checkedAt: latest?.checkedAt ?? null,
      firstCheckedAt: first?.checkedAt ?? null,
      snapshotCount: kw.snapshots.length,
    };
  });
}

/** Raw snapshots (oldest first) of one of the user's tracked keywords; null when it is not the user's. */
export async function rankSnapshotsFor(userId: string, keywordId: string, take = 60) {
  const owned = await prisma.rankTrackedKeyword.findFirst({ where: { id: keywordId, userId }, select: { id: true } });
  if (!owned) return null;
  const latest = await prisma.rankSnapshot.findMany({ where: { keywordId }, orderBy: { checkedAt: 'desc' }, take });
  return latest.reverse();
}

// ─── Hub reads (Tracked view, rank history) ────────────────────────────────

export interface SnapshotLike { rank: number | null; checkedAt: Date | string }

const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));
const iso = (d: Date | string) => new Date(ms(d)).toISOString();

/**
 * Position today · 7-day change · best. `delta7` compares the latest snapshot with the latest one at least 7 days
 * older (12 h tolerance for cron drift); positive = moved up. Null when either side is "not in top 500" or missing.
 */
export function rankSummary(snapshots: SnapshotLike[]): TrackedKeywordRow['rank'] {
  const s = [...snapshots].filter((x) => Number.isFinite(ms(x.checkedAt))).sort((a, b) => ms(a.checkedAt) - ms(b.checkedAt));
  if (s.length === 0) return { now: null, delta7: null, best: null, checkedAt: null };
  const latest = s[s.length - 1];
  const cutoff = ms(latest.checkedAt) - 7 * DAY_MS + 12 * 3_600_000;
  let prev: SnapshotLike | null = null;
  for (const x of s) if (ms(x.checkedAt) <= cutoff) prev = x;
  const ranks = s.map((x) => x.rank).filter((r): r is number => r != null && r > 0);
  return {
    now: latest.rank ?? null,
    delta7: prev && prev.rank != null && latest.rank != null ? prev.rank - latest.rank : null,
    best: ranks.length ? Math.min(...ranks) : null,
    checkedAt: iso(latest.checkedAt),
  };
}

export interface DailySalesLike { date: Date | string; unitsSold: number }

export const SALES_WINDOW_DAYS = 14;
export const SALES_MIN_DAYS = 7;

const utcDay = (t: number) => Math.floor(t / DAY_MS);

function windowSum(stats: DailySalesLike[], fromDay: number, toDayExcl: number, needDays: number): Guarded<number> {
  const rows = stats.filter((r) => { const d = utcDay(ms(r.date)); return d >= fromDay && d < toDayExcl; });
  const days = new Set(rows.map((r) => utcDay(ms(r.date)))).size;
  if (days < needDays) return { value: null, kind: 'measured', guard: { ok: false, reasonKey: 'research.kw.salesCollecting', reasonParams: { days } } };
  return { value: rows.reduce((s, r) => s + (Number(r.unitsSold) || 0), 0), kind: 'measured', guard: { ok: true } };
}

/** Units sold in the last 14 days, and 14 days before / after the last KolayXport send (Measured; ≥ 7 daily rows). */
export function salesWindows(stats: DailySalesLike[], lastSendAt: Date | string | null, nowMs = Date.now()): SalesWindows {
  const today = utcDay(nowMs);
  const out: SalesWindows = {
    last14: windowSum(stats, today - SALES_WINDOW_DAYS + 1, today + 1, SALES_MIN_DAYS),
    lastSendAt: lastSendAt ? iso(lastSendAt) : null,
  };
  if (lastSendAt) {
    const sendDay = utcDay(ms(lastSendAt));
    const afterDays = Math.max(0, Math.min(SALES_WINDOW_DAYS, today - sendDay + 1));
    out.beforeSend = windowSum(stats, sendDay - SALES_WINDOW_DAYS, sendDay, SALES_MIN_DAYS);
    // Under 7 days since the send there is not enough "after" yet: the guard says how many days are in.
    out.afterSend = windowSum(stats, sendDay, sendDay + afterDays, SALES_MIN_DAYS);
    out.afterDays = afterDays;
  }
  return out;
}

export function toRankPoints(snapshots: SnapshotLike[]): RankPoint[] {
  return [...snapshots]
    .sort((a, b) => ms(a.checkedAt) - ms(b.checkedAt))
    .map((s) => ({ at: iso(s.checkedAt), rank: s.rank ?? null }));
}

/** Send markers (kolayxport_draft versions) + SEO experiment cohort dates, oldest first, deduped per kind+id. */
export function rankMarkers(
  versions: Array<{ id: string; capturedAt: Date | string }>,
  experiments: Array<{ id: string; changedAt: Date | string }>,
): RankMarker[] {
  const seen = new Set<string>();
  const out: RankMarker[] = [];
  for (const v of versions) if (!seen.has(`s:${v.id}`)) { seen.add(`s:${v.id}`); out.push({ at: iso(v.capturedAt), kind: 'send', id: v.id }); }
  for (const e of experiments) if (!seen.has(`e:${e.id}`)) { seen.add(`e:${e.id}`); out.push({ at: iso(e.changedAt), kind: 'experiment', id: e.id }); }
  return out.sort((a, b) => ms(a.at) - ms(b.at));
}
