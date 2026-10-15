// research R2-B fixtures: GET /api/research/keywords payloads (R2-A contract, lib/research/keywordTypes.ts).
import type { KeywordRowExt, KeywordsData, TrackedKeywordRow } from '@/lib/research/keywordTypes';

const g = (value: number | null, ok = value !== null, reasonKey?: string) => ({ value, kind: 'measured' as const, guard: { ok, ...(reasonKey ? { reasonKey } : {}) } });

export function keywordRow(o: { keyword: string; top48?: number | null; competition?: number | null; tier?: 1 | 2 | 3 | 4 | 5 | null; inMyShop?: number; extra?: Partial<KeywordRowExt> }): KeywordRowExt {
  const top48 = o.top48 === undefined ? 18 : o.top48;
  return {
    keyword: o.keyword,
    demand: {
      tier: o.tier === undefined ? 4 : o.tier,
      inputs: [
        { key: 'googleTrends', value: 54, normalized: 0.54, ok: true },
        { key: 'autocomplete', value: 2, normalized: 0.66, ok: true },
      ],
    },
    competition: g(o.competition === undefined ? 1820 : o.competition),
    top48: top48 === null ? g(null, false, 'research.guard.insufficient') : g(top48),
    priceBand: { p25: 38, p75: 72, currency: 'USD', n: 48 },
    inMyShop: o.inMyShop ?? 0,
    length: o.keyword.length,
    words: o.keyword.split(' ').length,
    origin: ['tags'],
    ...(o.extra ?? {}),
  };
}

export function keywordsData(o: Partial<KeywordsData> = {}): KeywordsData {
  return {
    view: 'suggested',
    mkt: 'etsy',
    country: 'US',
    query: 'wooden jewelry box',
    rows: [
      keywordRow({ keyword: 'engraved jewelry box', top48: 18, competition: 1820, tier: 4, inMyShop: 4 }),
      keywordRow({ keyword: 'personalized keepsake box', top48: 11, competition: 3410, tier: 3, extra: { rank: { now: 34, delta7: 41, best: 30 }, trackedId: 'tk1' } }),
      keywordRow({ keyword: 'halloween decor', top48: null, competition: 90, tier: null }),
    ],
    volumeAvailable: false,
    fetchedAt: '2026-10-15T10:00:00Z',
    ...o,
  };
}

export function trackedRow(o: Partial<TrackedKeywordRow> = {}): TrackedKeywordRow {
  return {
    id: 'tk9',
    keyword: 'walnut box',
    listing: { id: '111', shopId: '7', title: 'Engraved Walnut Box', thumbUrl: null },
    rank: { now: null, delta7: null, best: 52, checkedAt: '2026-10-15T06:00:00Z' },
    sales14d: { last14: g(3), lastSendAt: null },
    experiment: null,
    trackedSince: '2026-09-01T00:00:00Z',
    ...o,
  };
}

export const source = { source: 'research.sourceName.etsyKeywords', fetchedAt: '2026-10-15T10:00:00Z', sample: 3, sampleUnit: 'keywords', kind: 'measured' };

export function response(data: unknown, extra: Record<string, unknown> = {}) {
  return { data, source, ...extra };
}
