/**
 * GET /api/research/keywords — Keyword explorer (research.md §6, §10; R2-A). Read-only: never writes to a marketplace.
 *
 * Three modes (session or extension Bearer auth; every response `ResearchResponse<T>` from lib/research/types.ts,
 * data shapes in lib/research/keywordTypes.ts):
 *
 * 1. Views (default) → KeywordsData
 *    Query: `q` (seed phrase) | `listing` (own Etsy listing_id; seed = its title lead phrase, adds `current`) ·
 *           `shop?` (Etsy shop id; default all of the user's shops) · `mkt` = etsy | ebay | amazon (default etsy;
 *           trendyol → `data: null`, `errors[{ section: 'marketplace' }]`) · `country` (US) ·
 *           `view` = suggested | longtail | seasonal | mine | tracked · `f.notInTitle=1` · `f.maxLen=20` ·
 *           `f.competition=lt1k|1to10k|gt10k` · `f.demand=1..5` · `cursor` (the previous `next`).
 *    Progressive: each call resolves ≤ 4 new keywords (1 Etsy call each, shared cache 24 h) and returns ALL rows
 *    resolved so far + `progress { done, total }`; while `next` is present, call again with `cursor=next` and replace.
 *    `mine` and `tracked` need no seed. `tracked` is DB-only (RankTrackedKeyword/RankSnapshot, EtsyListingDailyStat,
 *    EtsyListingVersion `kolayxport_draft`, SeoExperiment) and returns `tracked[]` with `rows: []`.
 * 2. `detail=<keyword>` (+ `listing?`, `country`) → KeywordDetailData (row SidePanel; Etsy only).
 * 3. `history=<trackedId>` → RankHistoryData (Tracked rank chart with send/experiment markers).
 *
 * Budget breaker (85 % of the Etsy daily quota): cached rows only, `errors[{ section: 'all', key: 'research.error.budget' }]`,
 * no `next`; nothing cached at all → 200 with `data: null` and the same error (banner, not an error page).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { checkTags } from '@/lib/etsy/seoRules';
import {
  buyerWords, currencyForCountry, demandSignal, engagementPerMonth, etsyBudgetLimited, fetchAutocompleteSources, firstParam,
  getEtsyListingDetails, isBudgetError, priceSummaryFor, readShared, searchEtsy, toTopListings, userRateLimit, TOP_N,
} from '@/lib/research/etsySearch';
import { decodeEntities } from '@/lib/research/stats';
import {
  appendCandidates, applyFilters, applyView, buildRow, buildSeedPool, cleanCandidate, fetchTrendsProfile, keywordNotesAvailable,
  metricsCacheKey, minePool, parseKeywordFilters, readKeywordNotes, resolveBatch, seedFromTitle, shopTagIndex, MAX_ROUNDS,
  type KeywordMetrics, type PoolCandidate, type RowContext,
} from '@/lib/research/keywordPool';
import { rankMarkers, rankSummary, salesWindows, toRankPoints, SALES_WINDOW_DAYS } from '@/lib/research/rank';
import { isKeywordView, type KeywordCurrent, type KeywordDetailData, type KeywordMkt, type KeywordsData, type RankHistoryData, type TrackedKeywordRow } from '@/lib/research/keywordTypes';
import type { KeywordView, ResearchErrorBody, ResearchResponse, ResearchSectionError, SourceNoteProps } from '@/lib/research/types';

export const MAX_QUERY_LEN = 120;
const DAY_MS = 86_400_000;
/** How far back the Tracked view looks for the last KolayXport send. */
const SEND_LOOKBACK_DAYS = 90;
const TRACKED_MAX = 500;
const SNAPSHOTS_PER_KEYWORD = 120;

type Res = NextApiResponse;
const now = () => new Date().toISOString();

function source(key: string, fetchedAt: string, extra: Partial<SourceNoteProps> = {}): SourceNoteProps {
  return { source: key, fetchedAt, kind: 'measured', ...extra };
}

function sourceKeyFor(mkt: KeywordMkt): string {
  return mkt === 'etsy' ? 'research.sourceName.etsyKeywords' : mkt === 'ebay' ? 'research.sourceName.ebayBrowse' : 'research.sourceName.autocomplete';
}

function parseMkt(raw: string | undefined): KeywordMkt | 'trendyol' | null {
  const m = raw ?? 'etsy';
  return m === 'etsy' || m === 'ebay' || m === 'amazon' || m === 'trendyol' ? m : null;
}

function parseCountry(raw: string | undefined): string {
  const c = (raw ?? 'US').toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : 'US';
}

const isListingId = (s: string | undefined): s is string => !!s && /^\d{1,20}$/.test(s);

async function userShops(userId: string, shop?: string): Promise<string[]> {
  const shops = await prisma.etsyShop.findMany({ where: { userId, isActive: true }, select: { shopId: true } });
  return shops.map((s) => s.shopId).filter((s) => !shop || s === shop);
}

// ─── Tracked view ───────────────────────────────────────────────────────────

export async function trackedRows(userId: string, opts: { shopIds?: string[]; listingId?: string; nowMs?: number } = {}): Promise<TrackedKeywordRow[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const where: Record<string, unknown> = { userId, isActive: true };
  if (opts.listingId) where.etsyListingId = opts.listingId;
  if (opts.shopIds) where.etsyShopId = { in: opts.shopIds };
  const kws = await prisma.rankTrackedKeyword.findMany({
    where,
    select: {
      id: true, keyword: true, etsyShopId: true, etsyListingId: true, listingTitle: true, createdAt: true,
      snapshots: { orderBy: { checkedAt: 'desc' }, take: SNAPSHOTS_PER_KEYWORD, select: { rank: true, checkedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: TRACKED_MAX,
  });
  if (kws.length === 0) return [];
  const listingIds = Array.from(new Set(kws.map((k) => k.etsyListingId).filter((s) => isListingId(s))));
  const big = listingIds.map((s) => BigInt(s));
  const shopIds = Array.from(new Set(kws.map((k) => k.etsyShopId)));
  // Sends are looked up 90 days back; the "14 d before send" window then reaches SALES_WINDOW_DAYS further, so the
  // daily stats must start there too (or an old send reads as "collecting data").
  const since90 = new Date(nowMs - SEND_LOOKBACK_DAYS * DAY_MS);
  const statsSince = new Date(nowMs - (SEND_LOOKBACK_DAYS + SALES_WINDOW_DAYS) * DAY_MS);
  const [listings, stats, versions, experiments] = await Promise.all([
    prisma.etsyListing.findMany({
      where: { etsyShopId: { in: shopIds }, etsyListingId: { in: big } },
      select: { etsyShopId: true, etsyListingId: true, title: true, thumbnailUrl170x135: true, thumbnailUrl75x75: true },
    }),
    prisma.etsyListingDailyStat.findMany({
      where: { etsyShopId: { in: shopIds }, etsyListingId: { in: big }, date: { gte: statsSince } },
      select: { etsyListingId: true, date: true, unitsSold: true },
    }),
    prisma.etsyListingVersion.findMany({
      where: { etsyShopId: { in: shopIds }, etsyListingId: { in: big }, attribution: 'kolayxport_draft', capturedAt: { gte: since90 } },
      select: { etsyListingId: true, capturedAt: true },
      orderBy: { capturedAt: 'desc' },
    }),
    prisma.seoExperiment.findMany({
      where: { userId, listingIds: { hasSome: big } },
      select: { id: true, status: true, changedAt: true, listingIds: true },
      orderBy: { changedAt: 'desc' },
      take: 200,
    }),
  ]);
  const meta = new Map(listings.map((l) => [String(l.etsyListingId), l]));
  const statsBy = new Map<string, Array<{ date: Date; unitsSold: number }>>();
  for (const s of stats) {
    const k = String(s.etsyListingId);
    const arr = statsBy.get(k) ?? [];
    arr.push({ date: s.date, unitsSold: s.unitsSold });
    statsBy.set(k, arr);
  }
  const lastSend = new Map<string, Date>();
  for (const v of versions) { const k = String(v.etsyListingId); if (!lastSend.has(k)) lastSend.set(k, v.capturedAt); }
  const expBy = new Map<string, { id: string; status: string; changedAt: string }>();
  for (const e of experiments) {
    for (const id of e.listingIds) {
      const k = String(id);
      if (!expBy.has(k)) expBy.set(k, { id: e.id, status: e.status, changedAt: e.changedAt.toISOString() });
    }
  }
  const salesCache = new Map<string, TrackedKeywordRow['sales14d']>();
  const rows = kws.map((k): TrackedKeywordRow => {
    const m = meta.get(k.etsyListingId);
    let sales = salesCache.get(k.etsyListingId);
    if (!sales) {
      sales = salesWindows(statsBy.get(k.etsyListingId) ?? [], lastSend.get(k.etsyListingId) ?? null, nowMs);
      salesCache.set(k.etsyListingId, sales);
    }
    return {
      id: k.id,
      keyword: k.keyword,
      listing: {
        id: k.etsyListingId,
        shopId: k.etsyShopId,
        title: decodeEntities(m?.title || k.listingTitle || ''),
        thumbUrl: m?.thumbnailUrl170x135 || m?.thumbnailUrl75x75 || null,
      },
      rank: rankSummary(k.snapshots),
      sales14d: sales,
      experiment: expBy.get(k.etsyListingId) ?? null,
      trackedSince: k.createdAt.toISOString(),
    };
  });
  const r = (x: TrackedKeywordRow) => x.rank.now ?? Number.MAX_SAFE_INTEGER;
  return rows.sort((a, b) => r(a) - r(b) || (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0));
}

// ─── Rank history ───────────────────────────────────────────────────────────

export async function rankHistory(userId: string, trackedId: string): Promise<RankHistoryData | null> {
  const kw = await prisma.rankTrackedKeyword.findFirst({
    where: { id: trackedId, userId },
    select: {
      id: true, keyword: true, etsyShopId: true, etsyListingId: true,
      snapshots: { orderBy: { checkedAt: 'desc' }, take: SNAPSHOTS_PER_KEYWORD, select: { rank: true, checkedAt: true } },
    },
  });
  if (!kw) return null;
  const points = toRankPoints(kw.snapshots);
  let versions: Array<{ id: string; capturedAt: Date }> = [];
  let experiments: Array<{ id: string; changedAt: Date }> = [];
  if (isListingId(kw.etsyListingId) && points.length) {
    const from = new Date(points[0].at);
    const lid = BigInt(kw.etsyListingId);
    [versions, experiments] = await Promise.all([
      prisma.etsyListingVersion.findMany({
        where: { etsyShopId: kw.etsyShopId, etsyListingId: lid, attribution: 'kolayxport_draft', capturedAt: { gte: from } },
        select: { id: true, capturedAt: true },
        orderBy: { capturedAt: 'asc' },
        take: 100,
      }),
      prisma.seoExperiment.findMany({
        where: { userId, listingIds: { has: lid }, changedAt: { gte: from } },
        select: { id: true, changedAt: true },
        orderBy: { changedAt: 'asc' },
        take: 50,
      }),
    ]);
  }
  return {
    trackedId: kw.id,
    keyword: kw.keyword,
    listingId: kw.etsyListingId,
    shopId: kw.etsyShopId,
    points,
    markers: rankMarkers(versions, experiments),
    summary: rankSummary(kw.snapshots),
  };
}

// ─── Current listing ────────────────────────────────────────────────────────

export function currentFor(l: { etsyShopId: string; etsyListingId: bigint | string; title: string; tags: string[]; thumbUrl: string | null }): KeywordCurrent {
  const title = decodeEntities(l.title);
  const tags = l.tags.map((t) => decodeEntities(t));
  const check = checkTags(tags, title);
  return {
    listingId: String(l.etsyListingId),
    shopId: l.etsyShopId,
    title,
    thumbUrl: l.thumbUrl,
    tags,
    issues: {
      count: tags.length,
      max: 13,
      overlap: check.overlapping.length,
      overlapTags: check.overlapping.map((o) => o.tag),
      long: check.tooLong.length,
      longTags: check.tooLong,
    },
  };
}

// ─── Handler ────────────────────────────────────────────────────────────────

function sendData<T>(res: Res, data: T | null, src: SourceNoteProps, errors: ResearchSectionError[] = []) {
  const dedup = Array.from(new Map(errors.map((e) => [`${e.section}|${e.key}`, e])).values());
  const body: ResearchResponse<T> = { data, source: src, ...(dedup.length ? { errors: dedup } : {}) };
  return res.status(200).json(body);
}

async function handleHistory(res: Res, userId: string, id: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
  const data = await rankHistory(userId, id);
  if (!data) return res.status(404).json({ error: 'not_found' } satisfies ResearchErrorBody);
  return sendData<RankHistoryData>(res, data, source('research.sourceName.rankTracker', data.summary.checkedAt ?? now(), { sample: data.points.length, sampleUnit: 'items' }));
}

async function handleDetail(req: NextApiRequest, res: Res, userId: string, rawKeyword: string, mkt: KeywordMkt, country: string) {
  const keyword = cleanCandidate(rawKeyword);
  if (!keyword) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
  if (mkt !== 'etsy') {
    return sendData<KeywordDetailData>(res, null, source(sourceKeyFor(mkt), now()), [{ section: 'marketplace', key: 'research.kw.detailEtsyOnly' }]);
  }
  const errors: ResearchSectionError[] = [];
  const listing = firstParam(req.query.listing);
  const currency = currencyForCountry(country);
  let served;
  try {
    served = await searchEtsy({ q: keyword, country, limit: TOP_N });
  } catch (err) {
    if (!isBudgetError(err)) throw err;
    return sendData<KeywordDetailData>(res, null, source('research.sourceName.etsySearch', now()), [{ section: 'all', key: 'research.error.budget' }]);
  }
  if (served.budgetLimited) errors.push({ section: 'all', key: 'research.error.budget' });
  else if (served.stale) errors.push({ section: 'all', key: 'research.error.stale' });
  const items = served.data.items.slice(0, TOP_N);
  const cachedMetrics = await readShared<KeywordMetrics>(metricsCacheKey('etsy', keyword, country));
  const [price, details, demand] = await Promise.all([
    priceSummaryFor(items, currency),
    getEtsyListingDetails(items.map((i) => i.listingId), country).then((d) => d.data).catch(() => ({})),
    cachedMetrics && !('failed' in (cachedMetrics.data as object)) && cachedMetrics.data.demand
      ? Promise.resolve(cachedMetrics.data.demand)
      : Promise.all([fetchTrendsProfile(keyword), fetchAutocompleteSources(keyword)]).then(([t, a]) => {
        const d = demandSignal({ trendsMean: t.mean, autocompleteSources: a, engagement: engagementPerMonth(items).value });
        return { tier: d.tier, inputs: d.inputs };
      }),
  ]);
  let history: RankHistoryData | undefined;
  if (isListingId(listing)) {
    const tracked = await prisma.rankTrackedKeyword.findFirst({ where: { userId, etsyListingId: listing, keyword, isActive: true }, select: { id: true } });
    if (tracked) history = (await rankHistory(userId, tracked.id)) ?? undefined;
  }
  const data: KeywordDetailData = {
    keyword,
    mkt,
    country,
    total: { value: served.data.total, kind: 'measured', guard: { ok: true } },
    price,
    top: toTopListings(items, new Map(), details),
    cooccurring: buyerWords(items, 31).filter((w) => w.tag !== keyword).slice(0, 30),
    demand,
    ...(history ? { history } : {}),
    fetchedAt: served.fetchedAt,
  };
  return sendData(res, data, source('research.sourceName.etsySearch', served.fetchedAt, { sample: price.n, sampleTotal: items.length, sampleUnit: 'listings' }), errors);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies ResearchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies ResearchErrorBody);
  // Progressive loading polls ~10 times per view; 90/min leaves room for view switches.
  if (!userRateLimit(user.id, 'research:keywords', 90)) return res.status(429).json({ error: 'rate_limited' } satisfies ResearchErrorBody);

  const mktParsed = parseMkt(firstParam(req.query.mkt));
  if (!mktParsed) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
  if (mktParsed === 'trendyol') {
    return sendData<KeywordsData>(res, null, source('research.sourceName.trendyol', now()), [{ section: 'marketplace', key: 'research.kw.mktUnavailable' }]);
  }
  const mkt: KeywordMkt = mktParsed;
  const country = parseCountry(firstParam(req.query.country));

  try {
    const historyId = firstParam(req.query.history);
    if (historyId) return await handleHistory(res, user.id, historyId);
    const detail = firstParam(req.query.detail);
    if (detail) return await handleDetail(req, res, user.id, detail.slice(0, MAX_QUERY_LEN), mkt, country);

    const viewRaw = firstParam(req.query.view) ?? 'suggested';
    if (!isKeywordView(viewRaw)) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
    const view: KeywordView = viewRaw;
    const q = firstParam(req.query.q)?.slice(0, MAX_QUERY_LEN);
    const listingParam = firstParam(req.query.listing);
    if (listingParam && !isListingId(listingParam)) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
    const shopParam = firstParam(req.query.shop);
    const filters = parseKeywordFilters(req.query as Record<string, unknown>);
    const roundRaw = Number(firstParam(req.query.cursor) ?? 0);
    const round = Number.isInteger(roundRaw) && roundRaw >= 0 ? roundRaw : 0;
    const volumeAvailable = keywordNotesAvailable();

    // Etsy-only context: the user's shops, the `?listing`, the shop's tags.
    const shopIds = mkt === 'etsy' || view === 'tracked' ? await userShops(user.id, shopParam) : [];

    if (view === 'tracked') {
      const tracked = await trackedRows(user.id, { shopIds: shopParam ? shopIds : undefined, listingId: listingParam });
      const latest = tracked.map((t) => t.rank.checkedAt).filter((s): s is string => !!s).sort().pop() ?? now();
      const data: KeywordsData = { view, mkt: 'etsy', country, query: null, rows: [], tracked, volumeAvailable, fetchedAt: latest };
      return sendData(res, data, source('research.sourceName.rankTracker', latest, { sample: tracked.length, sampleUnit: 'keywords' }));
    }

    let current: KeywordCurrent | undefined;
    let listingCtx: RowContext['listing'];
    if (listingParam && mkt === 'etsy') {
      if (shopIds.length === 0) return res.status(404).json({ error: 'not_found' } satisfies ResearchErrorBody);
      const l = await prisma.etsyListing.findFirst({
        where: { etsyShopId: { in: shopIds }, etsyListingId: BigInt(listingParam) },
        select: { etsyShopId: true, etsyListingId: true, title: true, tags: true, thumbnailUrl170x135: true, thumbnailUrl75x75: true },
      });
      if (!l) return res.status(404).json({ error: 'not_found' } satisfies ResearchErrorBody);
      current = currentFor({ ...l, thumbUrl: l.thumbnailUrl170x135 || l.thumbnailUrl75x75 || null });
      listingCtx = { title: current.title, tags: current.tags };
    }

    const own = mkt === 'etsy' && shopIds.length
      ? await prisma.etsyListing.findMany({
        where: { etsyShopId: { in: shopIds }, state: 'active' },
        select: { etsyListingId: true, etsyShopId: true, title: true, tags: true },
        orderBy: { etsyCreatedTimestamp: 'desc' },
        take: 5_000,
      })
      : [];
    const shopTags = shopTagIndex(own.map((l) => ({ id: String(l.etsyListingId), shopId: l.etsyShopId, title: l.title, tags: l.tags })));

    const errors: ResearchSectionError[] = [];
    let pool: PoolCandidate[];
    let seed: string | null = null;
    if (view === 'mine') {
      if (mkt !== 'etsy') {
        return sendData<KeywordsData>(res, null, source(sourceKeyFor(mkt), now()), [{ section: 'marketplace', key: 'research.kw.mineEtsyOnly' }]);
      }
      pool = minePool(shopTags);
    } else {
      seed = q ? cleanCandidate(q) : current ? seedFromTitle(current.title) || null : null;
      if (!seed) return res.status(400).json({ error: 'bad_request', key: 'research.empty.keywords' } satisfies ResearchErrorBody);
      try {
        const built = await buildSeedPool(mkt, seed, country);
        if (built.budgetLimited) errors.push({ section: 'all', key: 'research.error.budget' });
        else if (built.stale) errors.push({ section: 'all', key: 'research.error.stale' });
        pool = built.pool;
      } catch (err) {
        if (!isBudgetError(err)) throw err;
        return sendData<KeywordsData>(res, null, source(sourceKeyFor(mkt), now()), [{ section: 'all', key: 'research.error.budget' }]);
      }
      if (current) {
        // The listing's own tags join the pool so the table shows how each current tag performs.
        pool = appendCandidates(pool, 'listing', current.tags, Infinity, { exact: true });
      }
    }

    const currency = currencyForCountry(country);
    const resolved = await resolveBatch(mkt, pool, country, currency, { budgetLimited: mkt === 'etsy' ? etsyBudgetLimited : () => false });
    if (resolved.budgetLimited) errors.push({ section: 'all', key: 'research.error.budget' });

    const keywords = pool.map((c) => c.keyword);
    const [notes, trackedForListing] = await Promise.all([
      mkt === 'etsy' ? readKeywordNotes(user.id, keywords) : Promise.resolve(new Map()),
      listingParam && mkt === 'etsy'
        ? prisma.rankTrackedKeyword.findMany({
          where: { userId: user.id, etsyListingId: listingParam, isActive: true, keyword: { in: keywords } },
          select: { id: true, keyword: true, snapshots: { orderBy: { checkedAt: 'desc' }, take: SNAPSHOTS_PER_KEYWORD, select: { rank: true, checkedAt: true } } },
        })
        : Promise.resolve([]),
    ]);
    const tracked: RowContext['tracked'] = new Map();
    for (const t of trackedForListing) {
      const s = rankSummary(t.snapshots);
      tracked.set(t.keyword, { id: t.id, rank: { now: s.now, delta7: s.delta7, best: s.best } });
    }
    const ctx: RowContext = { shopTags, listing: listingCtx, notes, tracked };
    const all = pool.filter((c) => resolved.metrics.has(c.keyword)).map((c) => buildRow(c, resolved.metrics.get(c.keyword) as KeywordMetrics, ctx));
    const rows = applyFilters(applyView(all, view), filters);

    const total = pool.length;
    const done = total - resolved.pending.length;
    const more = resolved.pending.length > 0 && !resolved.budgetLimited && round + 1 < MAX_ROUNDS;
    const fetchedAt = Array.from(resolved.metrics.values()).map((m) => m.fetchedAt).sort()[0] ?? now();
    const data: KeywordsData = {
      view,
      mkt,
      country,
      query: seed,
      rows,
      ...(current ? { current } : {}),
      ...(more ? { next: String(round + 1) } : {}),
      progress: { done, total },
      volumeAvailable: mkt === 'etsy' && volumeAvailable,
      fetchedAt,
    };
    const src = source(view === 'mine' ? 'research.sourceName.myShopTags' : sourceKeyFor(mkt), fetchedAt, {
      sample: all.length,
      sampleTotal: total,
      sampleUnit: 'keywords',
      kind: mkt === 'amazon' ? 'signal' : 'measured',
    });
    return sendData(res, data, src, errors);
  } catch (err) {
    logger.error('[research/keywords] failed', err as Error, { mkt });
    const key = mkt === 'ebay' ? 'research.error.ebay' : 'research.error.etsy';
    return res.status(502).json({ error: 'server_error', key } satisfies ResearchErrorBody);
  }
}
