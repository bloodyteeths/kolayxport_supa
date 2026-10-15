// research R2-B: pure parts of the Keyword explorer (model, URL builders, normalisers, panel helpers) and the i18n
// contract (every key the R2-B files use exists in messages/*.json or in the R2-B newI18nKeys mirror, EN/TR parity,
// no ASCII-Turkish).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import {
  activeFilterCount,
  effectiveView,
  explorerHref,
  filtersFromUrl,
  monthName,
  parseSel,
  planTitleAdd,
  rankCell,
  serializeSel,
  sharesOf,
  viewsFor,
} from '@/components/domain/research/keywords/keywordModel';
import { keywordBlockReason } from '@/components/domain/research/keywords/AddTagsAction';
import { historySeries } from '@/components/domain/research/keywords/KeywordPanel';
import { salesTip } from '@/components/domain/research/keywords/TrackedView';
import {
  detailUrl,
  historyUrl,
  keywordsRequestable,
  keywordsUrl,
  normalizeKeywordRow,
  normalizeKeywords,
  normalizeTrackedRow,
  withCursor,
} from '@/lib/research/hooks/useKeywords';
import { R2B_EN, R2B_TR } from './r2b-messages';
import { keywordRow, keywordsData, trackedRow } from './r2b-fixtures';

describe('keywordModel', () => {
  it('views per marketplace (eBay has no tags or tracking; Amazon has no competition; panel = 2 views)', () => {
    expect(viewsFor('etsy')).toEqual(['suggested', 'longtail', 'seasonal', 'mine', 'tracked']);
    expect(viewsFor('ebay')).toEqual(['suggested', 'longtail', 'seasonal']);
    expect(viewsFor('amazon')).toEqual(['suggested', 'seasonal']);
    expect(viewsFor('etsy', 'panel')).toEqual(['suggested', 'mine']);
    expect(effectiveView('tracked', 'ebay')).toBe('suggested');
    expect(effectiveView('seasonal', 'etsy', 'panel')).toBe('suggested');
  });

  it('filters ↔ URL: notInTitle only with a listing', () => {
    const u = { 'f.notInTitle': true, 'f.maxLen': '20' as const, 'f.competition': 'lt1k' as const, 'f.demand': '3' as const };
    expect(filtersFromUrl(u, false)).toEqual({ maxLen20: true, competition: 'lt1k', demandMin: 3 });
    expect(filtersFromUrl(u, true)).toEqual({ notInTitle: true, maxLen20: true, competition: 'lt1k', demandMin: 3 });
    expect(activeFilterCount(filtersFromUrl(u, true))).toBe(4);
    expect(activeFilterCount({})).toBe(0);
  });

  it('selection: lower-cased, deduped, capped at 13', () => {
    expect(parseSel('Engraved Box|engraved box| gift box ')).toEqual(['engraved box', 'gift box']);
    expect(parseSel(undefined)).toEqual([]);
    expect(serializeSel([])).toBeUndefined();
    const many = Array.from({ length: 20 }, (_, i) => `k${i}`);
    expect(parseSel(serializeSel(many))).toHaveLength(13);
  });

  it('planTitleAdd appends whole phrases, skips words already in the title and never truncates', () => {
    const p = planTitleAdd('Engraved Walnut Jewelry Box', ['walnut box', 'personalized gift', 'anniversary keepsake'], 80);
    expect(p.added).toEqual(['Personalized Gift', 'Anniversary Keepsake']);
    expect(p.skipped).toEqual([{ keyword: 'walnut box', reason: 'inTitle' }]);
    expect(p.title).toBe('Engraved Walnut Jewelry Box, Personalized Gift, Anniversary Keepsake');
    const tight = planTitleAdd('A'.repeat(70), ['wooden keepsake box'], 80);
    expect(tight.added).toEqual([]);
    expect(tight.skipped[0].reason).toBe('tooLong');
    expect(tight.title).toBe('A'.repeat(70));
  });

  it('rank: null = "Not in top 500", never 0; undefined = not tracked', () => {
    expect(rankCell(undefined)).toEqual({ kind: 'none' });
    expect(rankCell({ now: null, delta7: null })).toEqual({ kind: 'notInTop', delta: null });
    expect(rankCell({ now: 34, delta7: 41 })).toEqual({ kind: 'rank', rank: 34, delta: 41 });
  });

  it('hrefs: full explorer for a listing', () => {
    expect(explorerHref('123', 's1', 'mine')).toBe('/app/research/keywords?listing=123&shop=s1&mkt=etsy&view=mine');
    expect(explorerHref('123')).toBe('/app/research/keywords?listing=123&mkt=etsy');
  });

  it('shares from top-48 use (guarded rows ignored)', () => {
    const rows = [keywordRow({ keyword: 'a', top48: 24 }), keywordRow({ keyword: 'b', top48: null })];
    expect(sharesOf(rows)).toEqual({ a: 0.5 });
  });

  it('month names follow the UI locale', () => {
    expect(monthName(12, 'en')).toBe('Dec');
    expect(monthName(12, 'tr')).toMatch(/Ara/);
  });
});

describe('useKeywords URL builders', () => {
  it('needs a seed except for Used in my shop / Tracked (Etsy only)', () => {
    expect(keywordsRequestable({ mkt: 'etsy', view: 'suggested' })).toBe(false);
    expect(keywordsRequestable({ mkt: 'etsy', view: 'mine' })).toBe(true);
    expect(keywordsRequestable({ mkt: 'ebay', view: 'tracked' })).toBe(false);
    expect(keywordsRequestable({ mkt: 'ebay', view: 'suggested', listing: '1' })).toBe(false);
    expect(keywordsUrl({ mkt: 'etsy', view: 'suggested' })).toBeNull();
  });

  it('fixed order, defaults omitted; listing wins over q; filters use the server names', () => {
    expect(keywordsUrl({ mkt: 'etsy', view: 'suggested', q: ' wooden box ' })).toBe('/api/research/keywords?q=wooden+box&mkt=etsy&view=suggested');
    expect(
      keywordsUrl({ mkt: 'etsy', view: 'longtail', q: 'x', listing: '42', shop: '7', country: 'GB', filters: { notInTitle: true, maxLen20: true, competition: '1to10k', demandMin: 3 } }),
    ).toBe('/api/research/keywords?listing=42&shop=7&mkt=etsy&country=GB&view=longtail&f.notInTitle=1&f.maxLen=20&f.competition=1to10k&f.demand=3');
    // notInTitle without a listing is dropped
    expect(keywordsUrl({ mkt: 'ebay', view: 'suggested', q: 'x', filters: { notInTitle: true } })).toBe('/api/research/keywords?q=x&mkt=ebay&view=suggested');
    expect(withCursor('/api/research/keywords?q=x', 'c 1')).toBe('/api/research/keywords?q=x&cursor=c%201');
    expect(detailUrl('gift box', { mkt: 'etsy', listing: '9' })).toBe('/api/research/keywords?detail=gift+box&mkt=etsy&listing=9');
    expect(historyUrl('abc')).toBe('/api/research/keywords?history=abc');
  });
});

describe('normalisers (tolerant of partial payloads)', () => {
  it('keyword rows: malformed fields render "—", entities decoded', () => {
    expect(normalizeKeywordRow(null)).toBeNull();
    expect(normalizeKeywordRow({})).toBeNull();
    const r = normalizeKeywordRow({ keyword: 'mom &amp; dad gift', competition: 'nope', top48: { value: 12, kind: 'measured', guard: { ok: true } } })!;
    expect(r.keyword).toBe('mom & dad gift');
    expect(r.competition.value).toBeNull();
    expect(r.competition.guard.ok).toBe(false);
    expect(r.top48.value).toBe(12);
    expect(r.demand.tier).toBeNull();
    expect(r.words).toBe(4);
  });

  it('views payload: next + progress kept, tracked rows parsed, view fallback', () => {
    const d = normalizeKeywords(keywordsData({ next: 'c2', progress: { done: 12, total: 40 } }), { view: 'suggested', mkt: 'etsy' });
    expect(d.next).toBe('c2');
    expect(d.progress).toEqual({ done: 12, total: 40 });
    expect(d.rows.length).toBeGreaterThan(0);
    const bad = normalizeKeywords({ view: 'nope', rows: 'x' }, { view: 'mine', mkt: 'etsy' });
    expect(bad.view).toBe('mine');
    expect(bad.rows).toEqual([]);
    expect(bad.volumeAvailable).toBe(false);
    expect(normalizeTrackedRow(trackedRow())!.rank.now).toBeNull();
  });
});

describe('panel helpers', () => {
  it('rank history: markers snap to the day categories, others dropped', () => {
    const s = historySeries(
      {
        trackedId: 't',
        keyword: 'k',
        listingId: 'l',
        shopId: 's',
        points: [
          { at: '2026-10-10T06:00:00Z', rank: 40 },
          { at: '2026-10-11T06:00:00Z', rank: null },
          { at: '2026-10-12T06:00:00Z', rank: 31 },
        ],
        markers: [
          { at: '2026-10-11T14:00:00Z', kind: 'send', id: 'v1' },
          { at: '2026-09-01T00:00:00Z', kind: 'experiment', id: 'e1' },
        ],
        summary: { now: 31, delta7: 9, best: 31, checkedAt: null },
      },
      { send: 'Sent', experiment: 'SEO experiment' },
    );
    expect(s.data).toEqual([40, null, 31]);
    expect(s.markers).toEqual([{ at: new Date('2026-10-11T00:00:00Z'), label: 'Sent' }]);
  });

  it('sales tooltip only after a send', () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}:${JSON.stringify(v)}`;
    expect(salesTip(t, { last14: { value: 3, kind: 'measured', guard: { ok: true } }, lastSendAt: null })).toBeUndefined();
    expect(
      salesTip(t, {
        last14: { value: 3, kind: 'measured', guard: { ok: true } },
        lastSendAt: '2026-10-05',
        beforeSend: { value: 1, kind: 'measured', guard: { ok: true } },
        afterSend: { value: null, kind: 'measured', guard: { ok: false } },
        afterDays: 9,
      }),
    ).toBe('kw.salesTip:{"before":"1","after":"—","days":9}');
  });

  it('block reasons: title has its own staged rule; track is never blocked', () => {
    const row = { price: null, editable: { price: true, qty: true }, sync: { draftId: 'd', status: 'pending', changedFields: ['title'], draft: {}, queuedDelete: false, scheduledSendAt: null, syncedAt: null } } as never;
    expect(keywordBlockReason(row, 'title')).toEqual({ key: 'stagedTitle' });
    expect(keywordBlockReason(row, 'tags')).toBeNull();
    expect(keywordBlockReason(row, 'track')).toBeNull();
  });
});

// ─── i18n contract ──────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const get = (o: unknown, key: string) => key.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Obj)[k] : undefined), o);
function leaves(o: Obj, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v as Obj, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

const ROOT = path.resolve(__dirname, '../..');
const FILES = [
  ...readdirSync(path.join(ROOT, 'components/domain/research/keywords')).map((f) => path.join(ROOT, 'components/domain/research/keywords', f)),
  path.join(ROOT, 'pages/app/research/keywords.tsx'),
].filter((f) => /\.tsx?$/.test(f));
const DYNAMIC = ['kw.view.suggested', 'kw.view.longtail', 'kw.view.seasonal', 'kw.view.mine', 'kw.view.tracked', 'kw.filter.band.lt1k', 'kw.filter.band.1to10k', 'kw.filter.band.gt10k', 'picker.stagedTitle', 'picker.syncing', 'picker.conflict', 'picker.queuedDelete', 'picker.stagedTags'];

describe('R2-B i18n', () => {
  const used = new Set<string>(DYNAMIC);
  for (const f of FILES) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  }

  it('every key used resolves in EN and TR (messages ∪ R2-B keys)', () => {
    const missing = [...used].filter((k) => {
      const key = `research.${k}`;
      return (get(en, key) === undefined && get(R2B_EN, key) === undefined) || (get(tr, key) === undefined && get(R2B_TR, key) === undefined);
    });
    expect(missing).toEqual([]);
  });

  it('R2-B keys: EN/TR parity, nothing already in messages with another meaning, real Turkish characters', () => {
    expect(leaves(R2B_EN as unknown as Obj).sort()).toEqual(leaves(R2B_TR as unknown as Obj).sort());
    const trText = leaves(R2B_TR as unknown as Obj).map((k) => String(get(R2B_TR, k))).join('\n');
    expect(trText).not.toMatch(/\b(Olustur|Gonder|Siparis|Iptal|Odeme)/);
    for (const k of leaves(R2B_EN as unknown as Obj)) {
      const existing = get(en, k);
      if (existing !== undefined) expect(existing).toBe(get(R2B_EN, k));
    }
  });

  it('every R2-B key is used (no dead keys)', () => {
    const dead = leaves(R2B_EN as unknown as Obj).map((k) => k.replace(/^research\./, '')).filter((k) => !used.has(k));
    expect(dead).toEqual([]);
  });
});
