// lib/research/hooks/useKeywords.ts (research R2-B) — client data for the Keyword explorer (research.md §6, §10).
//
// Reads (R2-A contract, lib/research/keywordTypes.ts):
//   GET /api/research/keywords?q|listing&shop&mkt&country&view&f.*&cursor → useKeywords (progressive: while the
//       response carries `next`, call again with `cursor=next` and REPLACE the rows; each response has every row
//       resolved so far, so rows appear as they resolve and the table is never blank for 20 s)
//   GET /api/research/keywords?detail=<kw>&listing&country&mkt            → useKeywordDetail (row SidePanel)
//   GET /api/research/keywords?history=<trackedId>                        → useRankHistory   (Tracked chart)
// Writes (KolayXport rows only, never a marketplace):
//   POST/DELETE /api/research/keywords/track → trackKeywords / untrackKeywords
//   POST /api/research/keywords/note         → saveKeywordNote (503 `unavailable` until BR-1b ships → `unavailable`)
// Payloads are normalised defensively: a missing or malformed field renders "—", never a crash.
import * as React from 'react';
import useSWR from 'swr';
import { useAsyncRegion, type AsyncRegion } from '@/lib/ds/useAsyncState';
import { decodeEntities } from '@/lib/research/stats';
import type { Guarded, KeywordView, ResearchResponse, ResearchSectionError, SourceNoteProps } from '@/lib/research/types';
import {
  KEYWORD_VIEWS,
  type CompetitionBand,
  type KeywordCurrent,
  type KeywordDetailData,
  type KeywordFilters,
  type KeywordMkt,
  type KeywordNoteData,
  type KeywordRowExt,
  type KeywordsData,
  type RankHistoryData,
  type TrackData,
  type TrackedKeywordRow,
  type TrackRequest,
} from '@/lib/research/keywordTypes';
import { EMPTY_PRICE, ResearchFetchError, errorsOf, fetchResearch, infoNotice, normalizeTopListing } from './useResearchProducts';

export type { KeywordRowExt, KeywordsData, TrackedKeywordRow, KeywordCurrent, KeywordDetailData, RankHistoryData };
export { ResearchFetchError };

export const KEYWORDS_PATH = '/api/research/keywords';
/** Delay between progressive polls (server resolves ≤ 4 keywords per call; 90 calls/min per user). */
export const KEYWORDS_POLL_MS = 700;

export type KeywordsParams = {
  mkt: KeywordMkt;
  view: KeywordView;
  q?: string;
  listing?: string;
  shop?: string;
  country?: string;
  filters?: KeywordFilters;
};

// ─── Keys (pure) ────────────────────────────────────────────────────────────

/** Does this request have what the server needs (`mine` / `tracked` need no seed)? */
export function keywordsRequestable(p: KeywordsParams | null): boolean {
  if (!p) return false;
  if (p.view === 'tracked' || p.view === 'mine') return p.mkt === 'etsy';
  return Boolean(p.q?.trim() || (p.listing && p.mkt === 'etsy'));
}

/** Stable URL (fixed param order, defaults omitted), or null when there is nothing to ask. */
export function keywordsUrl(p: KeywordsParams | null): string | null {
  if (!p || !keywordsRequestable(p)) return null;
  const sp = new URLSearchParams();
  const q = p.q?.trim();
  if (p.listing && p.mkt === 'etsy') sp.set('listing', p.listing);
  else if (q) sp.set('q', q);
  if (p.shop && p.mkt === 'etsy') sp.set('shop', p.shop);
  sp.set('mkt', p.mkt);
  if (p.country && p.country !== 'US') sp.set('country', p.country);
  sp.set('view', p.view);
  const f = p.filters ?? {};
  if (f.notInTitle && p.listing) sp.set('f.notInTitle', '1');
  if (f.maxLen20) sp.set('f.maxLen', '20');
  if (f.competition) sp.set('f.competition', f.competition);
  if (f.demandMin) sp.set('f.demand', String(f.demandMin));
  return `${KEYWORDS_PATH}?${sp.toString()}`;
}

export function withCursor(base: string, cursor: string | undefined): string {
  return cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
}

export function detailUrl(keyword: string, p: { mkt: KeywordMkt; country?: string; listing?: string }): string {
  const sp = new URLSearchParams({ detail: keyword, mkt: p.mkt });
  if (p.country && p.country !== 'US') sp.set('country', p.country);
  if (p.listing) sp.set('listing', p.listing);
  return `${KEYWORDS_PATH}?${sp.toString()}`;
}

export function historyUrl(trackedId: string): string {
  return `${KEYWORDS_PATH}?history=${encodeURIComponent(trackedId)}`;
}

// ─── Normalisation ──────────────────────────────────────────────────────────

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
const tier = (v: unknown): 1 | 2 | 3 | 4 | 5 | null => {
  const n = num(v);
  return n !== null && n >= 1 && n <= 5 ? (Math.round(n) as 1 | 2 | 3 | 4 | 5) : null;
};

export function guardedNum(v: unknown): Guarded<number> {
  if (isObj(v)) {
    const g = isObj(v.guard) ? v.guard : {};
    const value = num(v.value);
    return {
      value,
      kind: (str(v.kind) as Guarded<number>['kind']) ?? 'measured',
      guard: {
        ok: g.ok === undefined ? value !== null : g.ok !== false,
        reasonKey: str(g.reasonKey) ?? undefined,
        reasonParams: isObj(g.reasonParams) ? (g.reasonParams as Record<string, string | number>) : undefined,
      },
    };
  }
  const n = num(v);
  return { value: n, kind: 'measured', guard: { ok: n !== null } };
}

function demandOf(v: unknown): KeywordRowExt['demand'] {
  const d = isObj(v) ? v : {};
  const inputs = Array.isArray(d.inputs)
    ? d.inputs.filter(isObj).map((i) => ({
        key: i.key as 'googleTrends' | 'autocomplete' | 'engagement',
        value: num(i.value),
        normalized: num(i.normalized),
        ok: i.ok !== false && num(i.value) !== null,
        reasonKey: str(i.reasonKey) ?? undefined,
      })).filter((i) => i.key === 'googleTrends' || i.key === 'autocomplete' || i.key === 'engagement')
    : [];
  return { tier: tier(d.tier), inputs };
}

function rankOf(v: unknown): { now: number | null; delta7: number | null; best: number | null } | undefined {
  if (!isObj(v)) return undefined;
  return { now: num(v.now), delta7: num(v.delta7), best: num(v.best) };
}

export function normalizeKeywordRow(raw: unknown): KeywordRowExt | null {
  if (!isObj(raw)) return null;
  const keyword = str(raw.keyword);
  if (!keyword) return null;
  const k = decodeEntities(keyword);
  const pb = isObj(raw.priceBand) ? raw.priceBand : {};
  const row: KeywordRowExt = {
    keyword: k,
    demand: demandOf(raw.demand),
    competition: guardedNum(raw.competition),
    top48: guardedNum(raw.top48),
    priceBand: { p25: num(pb.p25), p75: num(pb.p75), currency: str(pb.currency) ?? 'USD', n: num(pb.n) ?? 0 },
    inMyShop: num(raw.inMyShop) ?? 0,
    length: num(raw.length) ?? k.length,
    words: num(raw.words) ?? k.split(' ').filter(Boolean).length,
    origin: Array.isArray(raw.origin) ? (raw.origin.filter((o) => typeof o === 'string') as KeywordRowExt['origin']) : [],
  };
  if (isObj(raw.etsyVolume) && num(raw.etsyVolume.value) !== null) {
    row.etsyVolume = { value: num(raw.etsyVolume.value)!, enteredAt: str(raw.etsyVolume.enteredAt) ?? '' };
  }
  const rank = rankOf(raw.rank);
  if (rank) row.rank = rank;
  if (typeof raw.inCurrent === 'boolean') row.inCurrent = raw.inCurrent;
  if (Array.isArray(raw.titleOverlap)) row.titleOverlap = raw.titleOverlap.filter((w): w is string => typeof w === 'string');
  if (isObj(raw.seasonal) && num(raw.seasonal.peakMonth) !== null) {
    row.seasonal = { peakMonth: num(raw.seasonal.peakMonth)!, inDays: num(raw.seasonal.inDays) ?? 0, ratio: num(raw.seasonal.ratio) ?? 1 };
  }
  if (Array.isArray(raw.listings)) {
    row.listings = raw.listings.filter(isObj).map((l) => ({ id: str(l.id) ?? '', shopId: str(l.shopId) ?? '', title: decodeEntities(str(l.title) ?? '') })).filter((l) => l.id);
  }
  if (str(raw.trackedId)) row.trackedId = str(raw.trackedId)!;
  const vt = tier(raw.volumeTier);
  if (vt) row.volumeTier = vt;
  if (raw.volumeDisagrees === true) row.volumeDisagrees = true;
  return row;
}

function guardedSales(v: unknown): TrackedKeywordRow['sales14d'] {
  const s = isObj(v) ? v : {};
  const out: TrackedKeywordRow['sales14d'] = { last14: guardedNum(s.last14), lastSendAt: str(s.lastSendAt) };
  if (s.beforeSend !== undefined) out.beforeSend = guardedNum(s.beforeSend);
  if (s.afterSend !== undefined) out.afterSend = guardedNum(s.afterSend);
  if (num(s.afterDays) !== null) out.afterDays = num(s.afterDays)!;
  return out;
}

export function normalizeTrackedRow(raw: unknown): TrackedKeywordRow | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const keyword = str(raw.keyword);
  if (!id || !keyword) return null;
  const l = isObj(raw.listing) ? raw.listing : {};
  const r = isObj(raw.rank) ? raw.rank : {};
  const e = isObj(raw.experiment) ? raw.experiment : null;
  return {
    id,
    keyword: decodeEntities(keyword),
    listing: { id: str(l.id) ?? '', shopId: str(l.shopId) ?? '', title: decodeEntities(str(l.title) ?? ''), thumbUrl: str(l.thumbUrl) },
    rank: { now: num(r.now), delta7: num(r.delta7), best: num(r.best), checkedAt: str(r.checkedAt) },
    sales14d: guardedSales(raw.sales14d),
    experiment: e && str(e.id) ? { id: str(e.id)!, status: str(e.status) ?? '', changedAt: str(e.changedAt) ?? '' } : null,
    trackedSince: str(raw.trackedSince) ?? '',
  };
}

function normalizeCurrent(raw: unknown): KeywordCurrent | undefined {
  if (!isObj(raw)) return undefined;
  const listingId = str(raw.listingId);
  if (!listingId) return undefined;
  const iss = isObj(raw.issues) ? raw.issues : {};
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((x): x is string => typeof x === 'string').map((x) => decodeEntities(x)) : [];
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    listingId,
    shopId: str(raw.shopId) ?? '',
    title: decodeEntities(str(raw.title) ?? ''),
    thumbUrl: str(raw.thumbUrl),
    tags,
    issues: {
      count: num(iss.count) ?? tags.length,
      max: 13,
      overlap: num(iss.overlap) ?? 0,
      overlapTags: strs(iss.overlapTags),
      long: num(iss.long) ?? 0,
      longTags: strs(iss.longTags),
    },
  };
}

export function normalizeKeywords(raw: unknown, fallback: { view: KeywordView; mkt: KeywordMkt; country?: string }): KeywordsData {
  const d = isObj(raw) ? raw : {};
  const view = (KEYWORD_VIEWS as readonly unknown[]).includes(d.view) ? (d.view as KeywordView) : fallback.view;
  const prog = isObj(d.progress) ? d.progress : null;
  const out: KeywordsData = {
    view,
    mkt: d.mkt === 'etsy' || d.mkt === 'ebay' || d.mkt === 'amazon' ? d.mkt : fallback.mkt,
    country: str(d.country) ?? fallback.country ?? 'US',
    query: str(d.query),
    rows: Array.isArray(d.rows) ? d.rows.map(normalizeKeywordRow).filter((r): r is KeywordRowExt => r !== null) : [],
    volumeAvailable: d.volumeAvailable === true,
    fetchedAt: str(d.fetchedAt) ?? new Date(0).toISOString(),
  };
  if (Array.isArray(d.tracked)) out.tracked = d.tracked.map(normalizeTrackedRow).filter((r): r is TrackedKeywordRow => r !== null);
  const current = normalizeCurrent(d.current);
  if (current) out.current = current;
  if (str(d.next)) out.next = str(d.next)!;
  if (prog && num(prog.done) !== null && num(prog.total) !== null) out.progress = { done: num(prog.done)!, total: num(prog.total)! };
  return out;
}

export function normalizeHistory(raw: unknown): RankHistoryData | null {
  if (!isObj(raw)) return null;
  const trackedId = str(raw.trackedId);
  if (!trackedId) return null;
  const s = isObj(raw.summary) ? raw.summary : {};
  return {
    trackedId,
    keyword: decodeEntities(str(raw.keyword) ?? ''),
    listingId: str(raw.listingId) ?? '',
    shopId: str(raw.shopId) ?? '',
    points: Array.isArray(raw.points)
      ? raw.points.filter(isObj).map((p) => ({ at: str(p.at) ?? '', rank: num(p.rank) })).filter((p) => p.at)
      : [],
    markers: Array.isArray(raw.markers)
      ? raw.markers.filter(isObj).map((m) => ({ at: str(m.at) ?? '', kind: m.kind === 'experiment' ? ('experiment' as const) : ('send' as const), id: str(m.id) ?? '' })).filter((m) => m.at)
      : [],
    summary: { now: num(s.now), delta7: num(s.delta7), best: num(s.best), checkedAt: str(s.checkedAt) },
  };
}

export function normalizeDetail(raw: unknown, fallback: { keyword: string; mkt: KeywordMkt; country?: string }): KeywordDetailData | null {
  if (!isObj(raw)) return null;
  const price = isObj(raw.price) ? { ...EMPTY_PRICE, ...(raw.price as Partial<typeof EMPTY_PRICE>) } : EMPTY_PRICE;
  const out: KeywordDetailData = {
    keyword: decodeEntities(str(raw.keyword) ?? fallback.keyword),
    mkt: raw.mkt === 'etsy' || raw.mkt === 'ebay' || raw.mkt === 'amazon' ? raw.mkt : fallback.mkt,
    country: str(raw.country) ?? fallback.country ?? 'US',
    total: guardedNum(raw.total),
    price,
    top: Array.isArray(raw.top) ? raw.top.map((x) => normalizeTopListing(x, price.currency)).filter((x): x is NonNullable<typeof x> => x !== null) : [],
    cooccurring: Array.isArray(raw.cooccurring)
      ? raw.cooccurring.filter(isObj).map((w) => ({ tag: decodeEntities(str(w.tag) ?? ''), share: num(w.share) ?? 0, count: num(w.count) ?? 0 })).filter((w) => w.tag)
      : [],
    demand: demandOf(raw.demand),
    fetchedAt: str(raw.fetchedAt) ?? new Date(0).toISOString(),
  };
  const h = normalizeHistory(raw.history);
  if (h) out.history = h;
  return out;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

const SWR_OPTS = { revalidateOnFocus: false, dedupingInterval: 30_000, shouldRetryOnError: false } as const;

export type KeywordsHookResult = {
  data: KeywordsData | undefined;
  source: SourceNoteProps | undefined;
  errors: ResearchSectionError[];
  /** Etsy budget breaker fired: cached rows only (info Banner, not an error page). */
  budget: boolean;
  /** Pool served from an older snapshot (`research.error.stale`, non-fatal): show the stale note above the rows. */
  stale: boolean;
  /** `data: null` that is informational (marketplace not served, budget with nothing cached). */
  notice: ResearchSectionError | undefined;
  error: ResearchFetchError | undefined;
  region: AsyncRegion;
  /** Still resolving candidates (`next` present): "Checking {done} of {total} keywords…". */
  building: boolean;
  isValidating: boolean;
  mutate: () => void;
};

type Tagged = { base: string; res: ResearchResponse<KeywordsData> };

/**
 * One Keyword explorer view. Progressive: keeps calling with `cursor=next` (replacing rows) until the server stops
 * offering `next`. A response that belongs to an older request (another query / view) is never shown.
 */
export function useKeywords(p: KeywordsParams | null): KeywordsHookResult {
  const base = keywordsUrl(p);
  const [cursor, setCursor] = React.useState<{ base: string; cursor: string } | null>(null);
  const activeCursor = cursor && cursor.base === base ? cursor.cursor : undefined;
  const key = base ? withCursor(base, activeCursor) : null;
  const swr = useSWR<Tagged>(
    key ? [key, base] : null,
    async ([u, b]: [string, string]) => ({ base: b, res: await fetchResearch<KeywordsData>(u) }),
    { ...SWR_OPTS, keepPreviousData: true },
  );
  const current = swr.data && swr.data.base === base ? swr.data.res : undefined;
  const view = p?.view ?? 'suggested';
  const mkt = p?.mkt ?? 'etsy';
  const country = p?.country;
  const data = React.useMemo(
    () => (current && current.data ? normalizeKeywords(current.data, { view, mkt, country }) : undefined),
    [current, view, mkt, country],
  );
  const next = data?.next;

  React.useEffect(() => {
    if (!base || !next || swr.isValidating || next === activeCursor) return undefined;
    const id = setTimeout(() => setCursor({ base, cursor: next }), KEYWORDS_POLL_MS);
    return () => clearTimeout(id);
  }, [base, next, activeCursor, swr.isValidating]);

  const notice = infoNotice(current);
  const unavailable = current && current.data === null && !notice ? new ResearchFetchError(200, errorsOf(current)[0]?.key) : undefined;
  const error = (swr.error as ResearchFetchError | undefined) ?? unavailable;
  const region = useAsyncRegion(
    { data, error, isLoading: Boolean(key) && !current && !swr.error, isValidating: swr.isValidating, mutate: swr.mutate },
    { isEmpty: (d: KeywordsData) => (d.view === 'tracked' ? (d.tracked ?? []).length === 0 : d.rows.length === 0 && !d.next) },
  );
  const errors = errorsOf(current);
  return {
    data,
    source: current?.source,
    errors,
    budget: errors.some((e) => e.key === 'research.error.budget'),
    stale: errors.some((e) => e.key === 'research.error.stale'),
    notice,
    error,
    region,
    building: Boolean(next),
    isValidating: swr.isValidating,
    // Revalidate the CURRENT key in place (the server returns every resolved row on each call, whatever the round).
    // Resetting the cursor would jump back to the cached round-0 response and replay the whole progressive chain.
    mutate: () => void swr.mutate(),
  };
}

/** Row SidePanel detail (Etsy only). */
export function useKeywordDetail(keyword: string | null, p: { mkt: KeywordMkt; country?: string; listing?: string }) {
  const key = keyword && p.mkt === 'etsy' ? detailUrl(keyword, p) : null;
  const swr = useSWR<ResearchResponse<KeywordDetailData>>(key, (u: string) => fetchResearch<KeywordDetailData>(u), SWR_OPTS);
  const data = React.useMemo(
    () => (swr.data?.data ? normalizeDetail(swr.data.data, { keyword: keyword ?? '', mkt: p.mkt, country: p.country }) ?? undefined : undefined),
    [swr.data, keyword, p.mkt, p.country],
  );
  const region = useAsyncRegion({ data, error: swr.error, isLoading: swr.isLoading, isValidating: swr.isValidating, mutate: swr.mutate });
  return { data, source: swr.data?.source, errors: errorsOf(swr.data), region };
}

/** Rank history of one tracked keyword (Tracked view panel). */
export function useRankHistory(trackedId: string | null) {
  const key = trackedId ? historyUrl(trackedId) : null;
  const swr = useSWR<ResearchResponse<RankHistoryData>>(key, (u: string) => fetchResearch<RankHistoryData>(u), SWR_OPTS);
  const data = React.useMemo(() => (swr.data?.data ? normalizeHistory(swr.data.data) ?? undefined : undefined), [swr.data]);
  const region = useAsyncRegion({ data, error: swr.error, isLoading: swr.isLoading, isValidating: swr.isValidating, mutate: swr.mutate });
  return { data, region };
}

// ─── Writes (KolayXport rows only) ─────────────────────────────────────────

async function readError(res: Response): Promise<ResearchFetchError> {
  let key: string | undefined;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: unknown; key?: unknown };
    if (typeof body?.key === 'string') key = body.key;
    if (typeof body?.error === 'string') code = body.error;
  } catch {
    /* non-JSON */
  }
  return new ResearchFetchError(res.status, key, code);
}

async function send<T>(url: string, method: 'POST' | 'DELETE', body: unknown): Promise<{ data: T; errors: ResearchSectionError[] }> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  return { data: json.data as T, errors: errorsOf(json as { errors?: unknown }) };
}

/** POST /api/research/keywords/track. Throws `ResearchFetchError` (403 = not your shop). */
export async function trackKeywords(req: TrackRequest): Promise<{ data: TrackData; errors: ResearchSectionError[] }> {
  const out = await send<TrackData>(`${KEYWORDS_PATH}/track`, 'POST', req);
  const d = isObj(out.data) ? (out.data as unknown as Loose) : {};
  return {
    data: {
      tracked: num(d.tracked) ?? 0,
      ids: Array.isArray(d.ids) ? (d.ids.filter(isObj) as TrackData['ids']) : [],
      checked: Array.isArray(d.checked) ? (d.checked.filter(isObj) as TrackData['checked']) : [],
    },
    errors: out.errors,
  };
}

/** DELETE /api/research/keywords/track → rows deactivated. */
export async function untrackKeywords(ids: string[]): Promise<number> {
  const out = await send<{ tracked?: unknown }>(`${KEYWORDS_PATH}/track`, 'DELETE', { ids });
  return num(out.data?.tracked) ?? 0;
}

export type NoteResult = { ok: true; data: KeywordNoteData } | { ok: false; unavailable: boolean };

/** POST /api/research/keywords/note. `unavailable` = BR-1b not deployed (render info, not an error). */
export async function saveKeywordNote(keyword: string, etsySearches30d: number | null): Promise<NoteResult> {
  try {
    const out = await send<KeywordNoteData>(`${KEYWORDS_PATH}/note`, 'POST', { keyword, etsySearches30d });
    return { ok: true, data: out.data };
  } catch (e) {
    return { ok: false, unavailable: e instanceof ResearchFetchError && (e.status === 503 || e.code === 'unavailable') };
  }
}

export type { CompetitionBand };
