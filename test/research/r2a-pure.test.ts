// R2-A pure helpers: keyword pool, rows, views, filters, seasonality, rank summaries, sales windows (research.md §6, §10).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ default: {} }));
import {
  appendCandidates, applyFilters, applyView, buildRow, cleanCandidate, exactTagUse, mergeCandidates, minePool, monthlyProfile,
  parseKeywordFilters, seasonalPeak, seedFromTitle, shopTagIndex, type KeywordMetrics, type RowContext,
} from '@/lib/research/keywordPool';
import {
  checkKeywordRank, normalizeTrackKeywords, rankMarkers, rankSearchPath, rankSummary, salesWindows, toRankPoints,
} from '@/lib/research/rank';
import { competitionBandOf, etsyVolumeTier, isKeywordView, volumeDisagrees, type KeywordRowExt } from '@/lib/research/keywordTypes';
import { parseNoteBody } from '@/pages/api/research/keywords/note';
import { NOW, item } from './fixtures';

const DAY = 86_400_000;

function metrics(over: Partial<KeywordMetrics> = {}): KeywordMetrics {
  return {
    keyword: 'engraved jewelry box', mkt: 'etsy', country: 'US', total: 1820, n: 48, top48: 18,
    priceBand: { p25: 38, p75: 72, currency: 'USD', n: 48 },
    demand: { tier: 4, inputs: [] }, monthly: null, fetchedAt: '2026-10-15T10:00:00.000Z', ...over,
  };
}
const ctx = (over: Partial<RowContext> = {}): RowContext => ({ shopTags: new Map(), notes: new Map(), tracked: new Map(), nowMs: NOW, ...over });

describe('candidate pool', () => {
  it('cleans, dedupes near-duplicates into the first origin, caps the pool', () => {
    const pool = mergeCandidates([
      { origin: 'seed', keywords: ['Wooden Jewelry Box'] },
      { origin: 'tags', keywords: ['wooden jewelry box', 'jewelry box wooden', 'gift for mom', '', '12', 'x'] },
      { origin: 'autocomplete', keywords: ['gift for mom', 'keepsake box'] },
    ], 3);
    expect(pool.map((c) => c.keyword)).toEqual(['wooden jewelry box', 'gift for mom', 'keepsake box']);
    expect(pool[0].origin).toEqual(['seed', 'tags']);
    expect(pool[1].origin).toEqual(['tags', 'autocomplete']);
  });

  it('appendCandidates adds the listing tags and merges origins without dropping the pool', () => {
    const pool = appendCandidates([{ keyword: 'keepsake box', origin: ['seed'] }], 'listing', ['Keepsake Box', 'walnut box']);
    expect(pool).toEqual([{ keyword: 'keepsake box', origin: ['seed', 'listing'] }, { keyword: 'walnut box', origin: ['listing'] }]);
  });

  it('listing tags keep their own rows (exact merge only) and stay matched by inCurrent / shop use', () => {
    const pool = appendCandidates(
      [{ keyword: 'personalized necklace', origin: ['seed'] }, { keyword: 'mom gifts', origin: ['tags'] }],
      'listing', ['Necklace Personalized', 'mom gift', 'Mom &amp; Dad', 'personalized necklace'], Infinity, { exact: true },
    );
    expect(pool.map((c) => c.keyword)).toEqual(['personalized necklace', 'mom gifts', 'necklace personalized', 'mom gift', 'mom & dad']);
    expect(pool[0].origin).toEqual(['seed', 'listing']);
    const shopTags = shopTagIndex([{ id: '1', shopId: 's', title: 'T', tags: ['Mom & Dad', 'necklace  personalized'] }]);
    const c = ctx({ shopTags, listing: { title: 'Necklace', tags: ['Necklace Personalized', 'mom gift', 'Mom &amp; Dad'] } });
    for (const k of ['necklace personalized', 'mom gift', 'mom & dad']) {
      expect(buildRow({ keyword: k, origin: ['listing'] }, metrics({ keyword: k }), c).inCurrent).toBe(true);
    }
    expect(buildRow({ keyword: 'mom & dad', origin: ['listing'] }, metrics({ keyword: 'mom & dad' }), c).inMyShop).toBe(1);
    expect(buildRow({ keyword: 'necklace personalized', origin: ['listing'] }, metrics(), c).inMyShop).toBe(1);
    expect(buildRow({ keyword: 'mom gifts', origin: ['tags'] }, metrics(), c).inCurrent).toBe(false);
  });

  it('cleanCandidate rejects numbers-only, too short and too long; decodes entities', () => {
    expect(cleanCandidate('12345')).toBeNull();
    expect(cleanCandidate('a')).toBeNull();
    expect(cleanCandidate('x'.repeat(61))).toBeNull();
    expect(cleanCandidate('mom &amp; dad gift')).toBe('mom dad gift');
  });

  it('mine pool sorts own tags by listing count', () => {
    const idx = shopTagIndex([
      { id: '1', shopId: 's', title: 'A &amp; B', tags: ['Walnut Box', 'gift'] },
      { id: '2', shopId: 's', title: 'C', tags: ['walnut box'] },
    ]);
    expect(minePool(idx).map((c) => c.keyword)).toEqual(['walnut box', 'gift']);
    expect(idx.get('walnut box')?.[0].title).toBe('A & B');
  });

  it('seedFromTitle takes the lead phrase; exactTagUse counts exact tags only', () => {
    expect(seedFromTitle('Engraved Walnut Jewelry Box, Personalized Gift for Her')).toBe('engraved walnut jewelry box');
    expect(exactTagUse([item({ tags: ['Halloween Decor'] }), item({ tags: ['halloween decorations'] })], 'halloween decor')).toBe(1);
  });
});

describe('rows, views, filters', () => {
  it('small sample → top48 guard with n; eBay → no tags; Amazon → no competition', () => {
    const small = buildRow({ keyword: 'halloween decor', origin: ['seed'] }, metrics({ keyword: 'halloween decor', n: 7, top48: 3, total: 7 }), ctx());
    expect(small.top48).toMatchObject({ value: 3, guard: { ok: false, reasonKey: 'research.guard.small', reasonParams: { n: 7 } } });
    expect(small.competition).toMatchObject({ value: 7, guard: { ok: true } });
    const ebay = buildRow({ keyword: 'walnut box', origin: ['seed'] }, metrics({ mkt: 'ebay', top48: null }), ctx());
    expect(ebay.top48.guard).toMatchObject({ ok: false, reasonKey: 'research.guard.notAvailableEbay' });
    const amazon = buildRow({ keyword: 'walnut box', origin: ['seed'] }, metrics({ mkt: 'amazon', total: null, n: 0, top48: null }), ctx());
    expect(amazon.competition.value).toBeNull();
  });

  it('adds note, volume disagreement, tracked rank, current-listing fields, own listings', () => {
    const row = buildRow({ keyword: 'engraved jewelry box', origin: ['tags'] }, metrics({ demand: { tier: 1, inputs: [] } }), ctx({
      notes: new Map([['engraved jewelry box', { value: 24_100, enteredAt: '2026-10-14T00:00:00.000Z' }]]),
      tracked: new Map([['engraved jewelry box', { id: 'trk1', rank: { now: 34, delta7: 41, best: 30 } }]]),
      listing: { title: 'Engraved Walnut Box', tags: ['engraved jewelry box'] },
      shopTags: new Map([['engraved jewelry box', [{ id: '9', shopId: 's', title: 'Walnut' }]]]),
    }));
    expect(row.etsyVolume?.value).toBe(24_100);
    expect(row.volumeTier).toBe(5);
    expect(row.volumeDisagrees).toBe(true);
    expect(row.rank).toEqual({ now: 34, delta7: 41, best: 30 });
    expect(row.trackedId).toBe('trk1');
    expect(row.inCurrent).toBe(true);
    expect(row.titleOverlap).toEqual(['engraved', 'box']);
    expect(row.inMyShop).toBe(1);
    expect(row.listings).toHaveLength(1);
  });

  const r = (keyword: string, over: Partial<KeywordMetrics> = {}, c: Partial<RowContext> = {}) => buildRow({ keyword, origin: ['tags'] }, metrics({ keyword, ...over }), ctx(c));

  it('suggested sorts by Top-48 use then demand; longtail keeps ≥ 3 words under 5,000', () => {
    const rows = [r('a box', { top48: 5 }), r('b box', { top48: 20, demand: { tier: 2, inputs: [] } }), r('c box', { top48: 20, demand: { tier: 5, inputs: [] } })];
    expect(applyView(rows, 'suggested').map((x) => x.keyword)).toEqual(['c box', 'b box', 'a box']);
    const lt = [r('walnut ring box', { total: 900 }), r('walnut box', { total: 100 }), r('big walnut ring box', { total: 9000 }), r('tiny walnut ring box', { total: 300 })];
    expect(applyView(lt, 'longtail').map((x) => x.keyword)).toEqual(['tiny walnut ring box', 'walnut ring box']);
  });

  it('seasonal keeps only upcoming peaks; mine sorts by shop use', () => {
    const monthly = [10, 10, 10, 10, 10, 10, 10, 10, 10, 90, 20, 10]; // October peak
    const rows = [r('halloween decor', { monthly }), r('walnut box', { monthly: new Array(12).fill(10) })];
    const s = applyView(rows, 'seasonal');
    expect(s.map((x) => x.keyword)).toEqual(['halloween decor']);
    expect(s[0].seasonal).toMatchObject({ peakMonth: 10, inDays: 0 });
    const mine = [r('a', {}, { shopTags: new Map([['a', [{ id: '1', shopId: 's', title: 't' }]]]) }), r('b', {}, { shopTags: new Map([['b', [{ id: '1', shopId: 's', title: 't' }, { id: '2', shopId: 's', title: 't' }]]]) })];
    expect(applyView(mine, 'mine').map((x) => x.keyword)).toEqual(['b', 'a']);
  });

  it('filters: not in title, ≤ 20 chars, competition band, demand ≥', () => {
    const rows: KeywordRowExt[] = [
      r('engraved box', { total: 500 }, { listing: { title: 'Engraved Walnut Box', tags: [] } }),
      r('keepsake gift for grandma', { total: 500 }, { listing: { title: 'Engraved Walnut Box', tags: [] } }),
      r('ring dish', { total: 50_000, demand: { tier: 2, inputs: [] } }, { listing: { title: 'Engraved Walnut Box', tags: [] } }),
    ];
    expect(applyFilters(rows, { notInTitle: true }).map((x) => x.keyword)).toEqual(['keepsake gift for grandma', 'ring dish']);
    expect(applyFilters(rows, { maxLen20: true }).map((x) => x.keyword)).toEqual(['engraved box', 'ring dish']);
    expect(applyFilters(rows, { competition: 'gt10k' }).map((x) => x.keyword)).toEqual(['ring dish']);
    expect(applyFilters(rows, { demandMin: 3 }).map((x) => x.keyword)).toEqual(['engraved box', 'keepsake gift for grandma']);
  });

  it('parses f.* query params and ignores junk', () => {
    expect(parseKeywordFilters({ 'f.notInTitle': '1', 'f.maxLen': '20', 'f.competition': 'lt1k', 'f.demand': '3' }))
      .toEqual({ notInTitle: true, maxLen20: true, competition: 'lt1k', demandMin: 3 });
    expect(parseKeywordFilters({ f: { competition: 'nope', demand: '9' } })).toEqual({});
  });
});

describe('seasonality', () => {
  it('monthly profile needs ≥ 10 months; peak must be ≥ 1.4× mean and within 90 days', () => {
    const pts = Array.from({ length: 52 }, (_, i) => ({ time: Math.floor((NOW - (52 - i) * 7 * DAY) / 1000), value: i % 13 === 0 ? 80 : 20 }));
    expect(monthlyProfile(pts)?.length).toBe(12);
    expect(monthlyProfile(pts.slice(0, 10))).toBeNull();
    const dec = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 30, 80];
    expect(seasonalPeak(dec, NOW)).toMatchObject({ peakMonth: 12, inDays: 47 });
    const march = [10, 10, 80, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    expect(seasonalPeak(march, NOW)).toBeNull(); // > 90 days away
    expect(seasonalPeak(new Array(12).fill(10), NOW)).toBeNull();
  });
});

describe('volume + competition helpers', () => {
  it('maps Etsy volume to tiers and flags ≥ 3-tier disagreement', () => {
    expect([50, 200, 1000, 5000, 20_000].map(etsyVolumeTier)).toEqual([1, 2, 3, 4, 5]);
    expect(volumeDisagrees(5, 50)).toBe(true);
    expect(volumeDisagrees(3, 50)).toBe(false);
    expect(volumeDisagrees(null, 50)).toBe(false);
    expect(competitionBandOf(999)).toBe('lt1k');
    expect(competitionBandOf(10_000)).toBe('1to10k');
    expect(competitionBandOf(10_001)).toBe('gt10k');
    expect(isKeywordView('tracked')).toBe(true);
    expect(isKeywordView('rankings')).toBe(false);
  });

  it('note body: integer 0–10M, separators stripped, null deletes', () => {
    expect(parseNoteBody({ keyword: 'Walnut Box', etsySearches30d: '2,410' })).toEqual({ keyword: 'walnut box', value: 2410 });
    expect(parseNoteBody({ keyword: 'walnut box', etsySearches30d: null })).toEqual({ keyword: 'walnut box', value: null });
    expect(parseNoteBody({ keyword: 'walnut box', etsySearches30d: -1 })).toBeNull();
    expect(parseNoteBody({ keyword: 'walnut box', etsySearches30d: 2.5 })).toBeNull();
    expect(parseNoteBody({ keyword: '', etsySearches30d: 1 })).toBeNull();
  });
});

describe('rank', () => {
  it('rank summary: null is "not in top 500", never 0; delta7 against the snapshot ≥ 7 days older', () => {
    const at = (d: number) => new Date(NOW - d * DAY);
    const s = rankSummary([
      { rank: 75, checkedAt: at(8) }, { rank: 60, checkedAt: at(7) }, { rank: 40, checkedAt: at(3) }, { rank: 34, checkedAt: at(0) },
    ]);
    expect(s).toMatchObject({ now: 34, delta7: 26, best: 34 });
    const lost = rankSummary([{ rank: 20, checkedAt: at(10) }, { rank: null, checkedAt: at(0) }]);
    expect(lost).toMatchObject({ now: null, delta7: null, best: 20 });
    expect(rankSummary([])).toEqual({ now: null, delta7: null, best: null, checkedAt: null });
    expect(toRankPoints([{ rank: 2, checkedAt: at(0) }, { rank: 5, checkedAt: at(1) }]).map((p) => p.rank)).toEqual([5, 2]);
  });

  it('sales windows: last 14 days, before/after the last send, collecting guard under 7 days', () => {
    const stats = Array.from({ length: 40 }, (_, i) => ({ date: new Date(NOW - i * DAY), unitsSold: 1 }));
    const w = salesWindows(stats, new Date(NOW - 20 * DAY), NOW);
    expect(w.last14).toMatchObject({ value: 14, guard: { ok: true } });
    expect(w.beforeSend).toMatchObject({ value: 14 });
    expect(w.afterSend).toMatchObject({ value: 14 });
    expect(w.afterDays).toBe(14);
    const fresh = salesWindows(stats.slice(0, 3), new Date(NOW - 2 * DAY), NOW);
    expect(fresh.last14.guard).toEqual({ ok: false, reasonKey: 'research.kw.salesCollecting', reasonParams: { days: 3 } });
    expect(fresh.afterSend?.guard.ok).toBe(false);
    expect(salesWindows([], null, NOW).lastSendAt).toBeNull();
  });

  it('markers: sends and experiments, deduped, oldest first', () => {
    const m = rankMarkers([{ id: 'v2', capturedAt: new Date(NOW) }, { id: 'v1', capturedAt: new Date(NOW - DAY) }, { id: 'v1', capturedAt: new Date(NOW - DAY) }], [{ id: 'e1', changedAt: new Date(NOW - 2 * DAY) }]);
    expect(m.map((x) => `${x.kind}:${x.id}`)).toEqual(['experiment:e1', 'send:v1', 'send:v2']);
  });

  it('checkKeywordRank walks ≤ 5 pages and stops at the hit or a short page', async () => {
    const pages: number[] = [];
    const get = async (path: string, page: number) => {
      pages.push(page);
      expect(path).toBe(rankSearchPath('walnut box', page));
      return { count: 9000, results: Array.from({ length: 100 }, (_, i) => ({ listing_id: page === 2 && i === 4 ? 777 : page * 1000 + i })) };
    };
    expect(await checkKeywordRank('walnut box', '777', { get })).toEqual({ rank: 205, page: 3, totalResults: 9000 });
    expect(pages).toEqual([0, 1, 2]);
    const miss = await checkKeywordRank('walnut box', '1', { get: async () => ({ count: 3, results: [{ listing_id: 9 }] }) });
    expect(miss).toEqual({ rank: null, page: null, totalResults: 3 });
  });

  it('normalizes track keywords: lower-case, deduped, 2–60 chars, ≤ 13', () => {
    expect(normalizeTrackKeywords([' Walnut  Box ', 'walnut box', 'a', 5, 'x'.repeat(61), 'gift'])).toEqual(['walnut box', 'gift']);
    expect(normalizeTrackKeywords(Array.from({ length: 20 }, (_, i) => `kw ${i}`))).toHaveLength(13);
  });
});
