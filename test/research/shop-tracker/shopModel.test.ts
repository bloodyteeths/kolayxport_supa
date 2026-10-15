// research R3-B pure tests: "Watch a shop" input parsing, the two-readings rule (honest data), guard 7 on the client,
// alert rules, quota, prefill (never their title), hrefs, error mapping.
import { describe, expect, it } from 'vitest';
import {
  alertOn,
  compareHref,
  findExisting,
  ideaQuery,
  keywordHref,
  parseShopInput,
  quotaFull,
  researchIdeaHref,
  cardMeta,
  cardSubtitle,
  newCountText,
  notYetKey,
  salesSeries,
  similarPrefill,
  trackedItems,
  sinceYear,
  withAlert,
} from '@/components/domain/research/shops/shopModel';
import {
  DEFAULT_ALERT_RULES,
  FIRST_READING_KEY,
  NO_READING_KEY,
  ResearchFetchError,
  UNKNOWN_REASON_KEY,
  isShopWatch,
  normalizeDetail,
  normalizeWatchRow,
  normalizeWatches,
  watchErrorKind,
} from '@/lib/research/hooks/useWatches';
import { rawRow } from './fixtures';

describe('parseShopInput', () => {
  it('detects the marketplace from a link', () => {
    expect(parseShopInput('https://www.etsy.com/shop/WoodAndWords?ref=x', 'ebay')).toEqual({
      ok: true,
      name: 'WoodAndWords',
      request: { input: 'WoodAndWords', type: 'etsyShop', marketplace: 'etsy', refId: 'WoodAndWords', label: 'WoodAndWords' },
    });
    expect(parseShopInput('ebay.com/usr/engrave_us', 'etsy')).toEqual({
      ok: true,
      name: 'engrave_us',
      request: { input: 'engrave_us', type: 'ebaySeller', marketplace: 'ebay', refId: 'engrave_us', label: 'engrave_us' },
    });
    expect(parseShopInput('https://www.ebay.co.uk/str/memorycrafts', 'etsy')).toMatchObject({ ok: true, request: { marketplace: 'ebay', refId: 'memorycrafts' } });
  });

  it('a plain name uses the hub marketplace', () => {
    expect(parseShopInput('MemoryCrafts', 'etsy')).toMatchObject({ ok: true, request: { type: 'etsyShop', refId: 'MemoryCrafts' } });
    expect(parseShopInput('engrave_us', 'ebay')).toMatchObject({ ok: true, request: { type: 'ebaySeller', refId: 'engrave_us' } });
    // Etsy shop names have no underscores
    expect(parseShopInput('engrave_us', 'etsy')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects empty, spaced and non-shop links', () => {
    expect(parseShopInput('   ', 'etsy')).toEqual({ ok: false, reason: 'empty' });
    expect(parseShopInput('wood and words', 'etsy')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseShopInput('https://www.etsy.com/listing/1234567890/box', 'etsy')).toEqual({ ok: false, reason: 'unsupported' });
    expect(parseShopInput('https://www.trendyol.com/x/y-p-12345', 'etsy')).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('finds an existing watch case-insensitively', () => {
    const row = normalizeWatchRow(rawRow())!;
    expect(findExisting([row], 'etsy', 'woodandwords')?.id).toBe('w1');
    expect(findExisting([row], 'etsy', '12345')?.id).toBe('w1');
    expect(findExisting([row], 'ebay', 'woodandwords')).toBeNull();
  });
});

describe('normalizeWatchRow (honest data)', () => {
  it('keeps measured metrics with ≥ 2 snapshots', () => {
    const r = normalizeWatchRow(rawRow())!;
    expect(r.metrics.salesPerDay).toEqual({ value: 14.3, kind: 'measured', guard: { ok: true, reasonKey: undefined, reasonParams: undefined } });
    expect(r.metrics.priceChange.guard).toMatchObject({ ok: false, reasonKey: 'research.guard.insufficient' });
  });

  it('a single snapshot never shows a rate, even if the payload has one', () => {
    const r = normalizeWatchRow(rawRow({ snapshots: { count: 1, first: '2026-10-15', last: '2026-10-15' } }))!;
    expect(r.metrics.salesPerDay).toEqual({ value: null, kind: 'measured', guard: { ok: false, reasonKey: FIRST_READING_KEY } });
    // older adapter field names still read
    const alias = normalizeWatchRow({ ...rawRow(), snapshots: undefined, readings: 5, metrics: { salesPerDay7d: { value: 3, kind: 'measured', guard: { ok: true } } } })!;
    expect(alias.metrics.salesPerDay.value).toBe(3);
    expect(r.metrics.salesVsPrev.guard.ok).toBe(false);
    expect(r.metrics.new7d.guard.ok).toBe(false);
    // the active count is a single reading: fine
    expect(r.metrics.active.value).toBe(412);
  });

  it('drops rows of other watch types and malformed rows; decodes entities', () => {
    const data = normalizeWatches({
      rows: [rawRow(), rawRow({ id: 'q1', type: 'query' }), { nope: true }, rawRow({ id: 'w2', label: 'Mom &amp; Me' })],
      quota: { used: 3, limit: 10 },
    });
    expect(data.rows.map((r) => r.id)).toEqual(['w1', 'q1', 'w2']);
    expect(data.rows.filter(isShopWatch).map((r) => r.id)).toEqual(['w1', 'w2']);
    expect(data.rows[2].label).toBe('Mom & Me');
    expect(data.quota).toEqual({ used: 3, limit: 10, plan: null, stripeUpsell: false });
    expect(data.available).toBe(true);
    // the quota counts ResearchWatch rows only when the server sends no count
    expect(normalizeWatches({ rows: [rawRow(), rawRow({ id: 'ebaySeller.1', type: 'ebaySeller', marketplace: 'ebay', source: 'ebayTrackedSeller' })] }).quota.used).toBe(1);
    expect(normalizeWatches({ rows: [], available: false }).available).toBe(false);
  });

  it('defaults capabilities on and rejects non-https icon urls', () => {
    const r = normalizeWatchRow(rawRow({ iconUrl: 'javascript:alert(1)', capabilities: { alerts: false } }))!;
    expect(r.iconUrl).toBeNull();
    expect(r.capabilities).toEqual({ alerts: false, remove: true });
  });
});

describe('normalizeDetail', () => {
  it('turns negative daily counts (counter reset) into flagged gaps; share of sales is always an Estimate', () => {
    const row = normalizeWatchRow(rawRow())!;
    const d = normalizeDetail(
      {
        watch: rawRow(),
        shop: { since: '2021-03-04T00:00:00Z', rating: 4.9, reviewCount: 8100 },
        sales: [
          { date: '2026-10-13', value: 12 },
          { date: '2026-10-14', value: -400 },
          { date: '2026-10-15', value: 3000, dropped: true },
        ],
        fastest: [{ id: 'l1', title: 'Recipe Box', favoritesDelta7d: { value: 142, kind: 'measured', guard: { ok: true } }, shareOfSales: { value: 0.31, kind: 'measured', guard: { ok: true } } }],
        newListings: [{ id: 'n1', title: 'Engraved &amp; Boxed', tags: ['gift box'], price: { amount: 42, currency: 'usd' } }],
        tagGap: [{ tag: 'recipe card box', count: 7 }],
      },
      row,
    )!;
    expect(d.watch.id).toBe('w1');
    expect(d.sales.map((p) => [p.value, p.dropped])).toEqual([[12, false], [null, true], [null, true]]);
    expect(d.fastest[0].shareOfSales.kind).toBe('estimate');
    expect(d.newListings[0].title).toBe('Engraved & Boxed');
    expect(d.newListings[0].price).toEqual({ amount: 42, currency: 'USD' });
    expect(d.tagGapAvailable).toBe(true);
    const s = salesSeries(d.sales);
    expect(s.data).toEqual([12, null, null]);
    expect(s.dropped).toBe(2);
    expect(s.measured).toBe(1);
    expect(sinceYear(d.shop.since)).toBe(2021);
  });
});

describe('R3-B review fixes', () => {
  const fmt = { num: (v: number) => String(v), delta: (v: number) => ({ text: `${Math.round(v * 100)}%` }) } as never;
  const t = Object.assign((k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k), { has: () => true });

  it('an unknown server reason key falls back to a catalog key (never a raw key path)', () => {
    const r = normalizeWatchRow(rawRow({ metrics: { ...rawRow().metrics, active: { value: null, guard: { ok: false, reasonKey: 'research.shops.somethingNew' } } } }))!;
    expect(r.metrics.active.guard.reasonKey).toBe(UNKNOWN_REASON_KEY);
    const k = normalizeWatchRow(rawRow({ metrics: { ...rawRow().metrics, active: { value: null, guard: { ok: false, reasonKey: 'research.shops.ebayActiveUnknown' } } } }))!;
    expect(k.metrics.active.guard.reasonKey).toBe('research.shops.ebayActiveUnknown');
  });

  it('zero readings keep the server reason; one reading says "first reading"', () => {
    const none = normalizeWatchRow(rawRow({ snapshots: { count: 0, first: null, last: null }, metrics: { ...rawRow().metrics, salesPerDay: { value: null, guard: { ok: false, reasonKey: 'research.shops.overQuota' } } } }))!;
    expect(none.metrics.salesPerDay.guard.reasonKey).toBe('research.shops.overQuota');
    expect(none.metrics.salesVsPrev.guard).toMatchObject({ ok: false, reasonKey: NO_READING_KEY });
    expect(notYetKey(none)).toBe(NO_READING_KEY);
    expect(cardSubtitle(none, t, fmt)).toBe(NO_READING_KEY);
    const one = normalizeWatchRow(rawRow({ snapshots: { count: 1, first: 'x', last: 'x' } }))!;
    expect(notYetKey(one)).toBe(FIRST_READING_KEY);
  });

  it('a lower-bound new count reads "≥ +N"; eBay sales say they cover only tracked items', () => {
    const r = normalizeWatchRow(rawRow({ metrics: { ...rawRow().metrics, new7d: { value: 9, kind: 'measured', guard: { ok: true, reasonKey: 'research.shops.atLeast' } } } }))!;
    expect(newCountText(r.metrics.new7d, fmt)).toBe('≥ +9');
    expect(cardMeta(r, t, fmt)).toContain('research.shops.card.newAtLeast');
    const plain = normalizeWatchRow(rawRow())!;
    expect(newCountText(plain.metrics.new7d, fmt)).toBe('+9');
    const e = normalizeWatchRow(rawRow({ marketplace: 'ebay', type: 'ebaySeller', metrics: { ...rawRow().metrics, salesPerDay: { value: 2.1, kind: 'measured', guard: { ok: true, reasonKey: 'research.shops.ebayTrackedItems', reasonParams: { items: 4 } } } } }))!;
    expect(trackedItems(e.metrics.salesPerDay)).toBe(4);
    expect(cardSubtitle(e, t, fmt)).toContain('research.shops.fromTrackedItems {"count":4}');
    expect(trackedItems(plain.metrics.salesPerDay)).toBeNull();
  });

  it('the 30-day chart fills a missing day with a gap and uses Date categories', () => {
    const s = salesSeries([
      { date: '2026-10-10', value: 3, dropped: false },
      { date: '2026-10-12', value: 5, dropped: false },
    ]);
    expect(s.data).toEqual([3, null, 5]);
    expect(s.categories.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(s.measured).toBe(2);
    expect(salesSeries([]).data).toEqual([]);
  });
});

describe('alerts, quota', () => {
  it('toggles map to RR §4.3 alertRules', () => {
    let r = DEFAULT_ALERT_RULES;
    expect(alertOn(r, 'newListings')).toBe(true);
    expect(alertOn(r, 'salesSpike')).toBe(false);
    r = withAlert(r, 'salesSpike', true);
    expect(r.salesSpikeX).toBe(2);
    r = withAlert(r, 'priceDrop', false);
    expect(r.priceDropPct).toBeNull();
    expect(withAlert(r, 'priceDrop', true).priceDropPct).toBe(10);
  });

  it('quota is full only at a finite limit', () => {
    expect(quotaFull({ used: 10, limit: 10 })).toBe(true);
    expect(quotaFull({ used: 9, limit: 10 })).toBe(false);
    expect(quotaFull({ used: 99, limit: null })).toBe(false);
    expect(quotaFull(null)).toBe(false);
  });
});

describe('actions', () => {
  const listing = { id: 'n1', title: 'Personalized Recipe Box, Wooden Kitchen Gift', url: 'https://www.etsy.com/listing/1', thumbUrl: null, price: null, tags: ['recipe box', 'a tag that is way too long to use'], createdAt: null };

  it('"Draft a similar listing" never copies their title', () => {
    const p = similarPrefill(listing, 'etsy', 'WoodAndWords');
    expect(p.title).toBeUndefined();
    expect(p.tags).toEqual(['recipe box']);
    expect(p.keywords[0]).toBe('personalized recipe box');
    expect(JSON.stringify(p)).not.toContain('Personalized Recipe Box, Wooden Kitchen Gift');
    expect(similarPrefill(listing, 'ebay', 'x').tags).toEqual([]);
  });

  it('hrefs', () => {
    expect(ideaQuery('Personalized Recipe Box, Wooden Kitchen Gift')).toBe('personalized recipe box');
    expect(researchIdeaHref(listing, 'etsy')).toBe('/app/research/products?mkt=etsy&q=personalized+recipe+box');
    expect(keywordHref('recipe card box', 'etsy')).toBe('/app/research/keywords?mkt=etsy&q=recipe+card+box');
    expect(compareHref({ id: '42', title: 'Walnut Jewelry Box | Gift' }, 'etsy')).toBe('/app/research/products?mkt=etsy&q=walnut+jewelry+box&compareListing=42');
    expect(compareHref({ id: '42', title: 'Walnut Jewelry Box' }, 'ebay')).toContain('compareItem=42');
  });

  it('maps write errors', () => {
    expect(watchErrorKind(new ResearchFetchError(403, 'research.shops.quotaFull'))).toBe('quota');
    expect(watchErrorKind(new ResearchFetchError(402))).toBe('quota');
    expect(watchErrorKind(new ResearchFetchError(409))).toBe('duplicate');
    expect(watchErrorKind(new ResearchFetchError(404))).toBe('notFound');
    expect(watchErrorKind(new ResearchFetchError(400))).toBe('invalid');
    expect(watchErrorKind(new ResearchFetchError(503))).toBe('unavailable');
    expect(watchErrorKind(new Error('x'))).toBe('failed');
  });
});
