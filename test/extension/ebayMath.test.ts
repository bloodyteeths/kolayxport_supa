// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const M = require('../../chrome-extension/src/lib/ebayMath.js');

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const load = (name: string) => {
  document.body.innerHTML = fixture(name);
  return document;
};

describe('parseLocaleNumber', () => {
  it.each([
    ['25.99', 25.99],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['12,99', 12.99],
    ['9,500', 9500],
    ['9.500', 9500],
    ['1 234,56', 1234.56],
    ['1 234', 1234],
    ['1,000,000', 1000000],
    ['abc', NaN],
  ])('%s → %s', (input, expected) => {
    const v = M.parseLocaleNumber(input);
    if (Number.isNaN(expected)) expect(v).toBeNaN();
    else expect(v).toBeCloseTo(expected as number, 2);
  });
});

describe('parsePrice', () => {
  it('reads a plain USD price', () => {
    expect(M.parsePrice('$25.99', 'USD')).toEqual({ min: 25.99, max: 25.99, currency: 'USD' });
  });
  it('reads US $ prefix', () => {
    expect(M.parsePrice('US $25.99', 'USD')).toMatchObject({ min: 25.99, currency: 'USD' });
  });
  it('reads ranges with "to" / "bis"', () => {
    expect(M.parsePrice('$12.99 to $24.99', 'USD')).toEqual({ min: 12.99, max: 24.99, currency: 'USD' });
    expect(M.parsePrice('EUR 9,50 bis EUR 19,90', 'EUR')).toEqual({ min: 9.5, max: 19.9, currency: 'EUR' });
  });
  it('reads European formats', () => {
    expect(M.parsePrice('EUR 12,99', 'EUR')).toEqual({ min: 12.99, max: 12.99, currency: 'EUR' });
    expect(M.parsePrice('EUR 1.234,56', 'EUR')).toMatchObject({ min: 1234.56 });
    expect(M.parsePrice('12,99 €', 'EUR')).toMatchObject({ min: 12.99, currency: 'EUR' });
  });
  it('reads GBP and AUD', () => {
    expect(M.parsePrice('£8.50', 'GBP')).toMatchObject({ min: 8.5, currency: 'GBP' });
    expect(M.parsePrice('AU $19.95', 'AUD')).toMatchObject({ min: 19.95, currency: 'AUD' });
    expect(M.parsePrice('$19.95', 'AUD')).toMatchObject({ currency: 'AUD' });
  });
  it('never reads shipping text as a price', () => {
    expect(M.parsePrice('+$5.99 shipping', 'USD')).toBeNull();
    expect(M.parsePrice('+$5.99 delivery', 'USD')).toBeNull();
    expect(M.parsePrice('Free shipping', 'USD')).toBeNull();
    expect(M.parsePrice('+EUR 4,99 Versand', 'EUR')).toBeNull();
    expect(M.parsePrice('£2.99 postage', 'GBP')).toBeNull();
  });
  it('returns null for empty or non-numeric text', () => {
    expect(M.parsePrice('', 'USD')).toBeNull();
    expect(M.parsePrice('Price unavailable', 'USD')).toBeNull();
  });
});

describe('parseResultCount', () => {
  it.each([
    ['9,500+ results for turkish cotton towel', 9500, true],
    ['1,234 results for towel', 1234, false],
    ['9.500+ Ergebnisse für handtuch', 9500, true],
    ['Über 9.500 Ergebnisse', 9500, true],
    ['9 500+ résultats pour serviette', 9500, true],
    ['48 results', 48, false],
    ['1,000,000+ results', 1000000, true],
  ])('%s', (text, count, plus) => {
    expect(M.parseResultCount(text)).toEqual({ count, plus });
  });
  it('returns null without a number', () => {
    expect(M.parseResultCount('No exact matches found')).toBeNull();
  });
});

describe('parseSoldText', () => {
  it.each([
    ['65+ sold', 65, true],
    ['1,234 sold', 1234, false],
    ['1.2K sold', 1200, false],
    ['152 sold', 152, false],
    ['1.234 verkauft', 1234, false],
    ['10+ vendus', 10, true],
    ['+$5.99 delivery 65 sold', 65, false],
  ])('%s', (text, count, plus) => {
    expect(M.parseSoldText(text)).toEqual({ count, plus });
  });
  it('ignores watchers and unrelated text', () => {
    expect(M.parseSoldText('3 watchers')).toBeNull();
    expect(M.parseSoldText('Buy It Now')).toBeNull();
  });
});

describe('parseSellerText', () => {
  it('new markup', () => {
    expect(M.parseSellerText('towelhaus 99.6% positive (5.2K)')).toEqual({ username: 'towelhaus', positivePct: 99.6, feedbackCount: 5200 });
    expect(M.parseSellerText('handtuchladen 99,8% positive Bewertungen (2,1K)')).toEqual({ username: 'handtuchladen', positivePct: 99.8, feedbackCount: 2100 });
  });
  it('old markup', () => {
    expect(M.parseSellerText('peshtemalworld (3,456) 99.1%')).toEqual({ username: 'peshtemalworld', positivePct: 99.1, feedbackCount: 3456 });
  });
  it('does not treat discounts as sellers', () => {
    expect(M.parseSellerText('$39.99 35% off')).toBeNull();
    expect(M.parseSellerText('Save 25%')).toBeNull();
  });
});

describe('parseSearchPage — new s-card markup (ebay.com)', () => {
  let page: ReturnType<typeof M.parseSearchPage>;
  beforeEach(() => { page = M.parseSearchPage(load('ebay-search-new.html'), { currency: 'USD' }); });

  it('reads "9,500+ results"', () => {
    expect(page.resultCount).toEqual({ count: 9500, plus: true });
  });
  it('skips the ghost "Shop on eBay" card', () => {
    expect(page.items.map((i: { id: string }) => i.id)).toEqual(['256789012345', '256789012346', '256789012347', '256789012348', '256789012349']);
  });
  it('reads price, ignoring strikethrough and shipping', () => {
    const first = page.items[0];
    expect(first.price).toBe(25.99);
    expect(first.priceMax).toBe(25.99);
    expect(first.currency).toBe('USD');
    expect(first.title).toBe('Turkish Cotton Bath Towel Set of 4 Peshtemal Quick Dry');
  });
  it('reads price ranges', () => {
    expect(page.items[1]).toMatchObject({ price: 12.99, priceMax: 24.99, title: 'Turkish Towel 100% Cotton Beach Blanket' });
  });
  it('reads sold counts', () => {
    expect(page.items.map((i: { soldCount: number | null }) => i.soldCount)).toEqual([65, 1234, null, 1200, null]);
    expect(page.items[0].soldPlus).toBe(true);
  });
  it('reads sellers from adjacent spans', () => {
    expect(page.items.map((i: { seller: string | null }) => i.seller)).toEqual(['towelhaus', 'anatolia_home', 'towelhaus', 'bosphorus-linen', null]);
    expect(page.items[0].sellerPositivePct).toBe(99.6);
  });
  it('flags Sponsored', () => {
    expect(page.items[0].sponsored).toBe(true);
    expect(page.items[1].sponsored).toBe(false);
  });
});

describe('parseSearchPage — old s-item markup', () => {
  it('parses cards, ranges, sellers and sold counts', () => {
    const page = M.parseSearchPage(load('ebay-search-old.html'), { currency: 'USD' });
    expect(page.resultCount).toEqual({ count: 1234, plus: false });
    expect(page.items).toHaveLength(3);
    expect(page.items[0]).toMatchObject({ id: '155512345678', title: 'Turkish Towel Set Peshtemal 100% Cotton', price: 22.5, soldCount: 152, seller: 'peshtemalworld', sponsored: true });
    expect(page.items[1]).toMatchObject({ id: '155512345679', price: 14.99, priceMax: 29.99, seller: 'linenco', soldCount: null });
    expect(page.items[2]).toMatchObject({ id: '155512345680', price: 9.75, soldCount: 2, seller: null });
  });
});

describe('parseSearchPage — ebay.de', () => {
  it('parses German numbers and ignores Versand', () => {
    const page = M.parseSearchPage(load('ebay-search-de.html'), { currency: 'EUR' });
    expect(page.resultCount).toEqual({ count: 9500, plus: true });
    expect(page.items.map((i: { price: number }) => i.price)).toEqual([12.99, 1234.56, 9.5]);
    expect(page.items[0]).toMatchObject({ currency: 'EUR', soldCount: 1234, seller: 'handtuchladen', sellerPositivePct: 99.8 });
    expect(page.items[2].priceMax).toBe(19.9);
  });
});

describe('normalizeApiItem (Browse API item_summary)', () => {
  const api = JSON.parse(fixture('ebay-product-database.json'));
  it('parses price.value strings and seller usernames', () => {
    const it0 = M.normalizeApiItem(api.items[0]);
    expect(it0).toMatchObject({ id: '256789012345', price: 25.99, currency: 'USD', seller: 'towelhaus', sellerPositivePct: 99.6, soldCount: 120, remainingCount: 30 });
  });
  it('leaves sold unknown (null, not 0) for items the server did not enrich', () => {
    expect(M.normalizeApiItem(api.items[2]).soldCount).toBeNull();
    expect(M.normalizeApiItem(api.items[3]).soldCount).toBeNull();
    expect(M.normalizeApiItem(api.items[4]).soldCount).toBe(0);
  });
});

describe('buildSearchSummary', () => {
  const api = JSON.parse(fixture('ebay-product-database.json'));

  it('regression: product_database response has no avgPrice/uniqueSellers — summary still gets real numbers', () => {
    // The old overlay read summary.avgPrice / uniqueSellers / competition, none of
    // which product_database returns → "$0.00 · Sellers 0 · Medium".
    expect(api.avgPrice).toBeUndefined();
    expect(api.uniqueSellers).toBeUndefined();
    const page = M.parseSearchPage(load('ebay-search-new.html'), { currency: 'USD' });
    const s = M.buildSearchSummary({ api, page, refinements: [] });
    expect(s.source).toBe('api');
    expect(s.resultCount).toEqual({ count: 9500, plus: true }); // page count, not API total 9012 ("9.0K")
    expect(s.resultCountSource).toBe('page');
    expect(s.apiTotal).toBe(9012);
    expect(s.price).toMatchObject({ median: 25.99, p25: 18, p75: 31.5, currency: 'USD', quality: 'small' });
    expect(s.sellers).toMatchObject({ known: 5, distinct: 4 });
    // sold: 120, 3, 0 from API; 1200 backfilled from the page card ("1.2K sold"); one unknown
    expect(s.sold.known).toBe(4);
    expect(s.items.find((i: { id: string }) => i.id === '256789012348')).toMatchObject({ soldCount: 1200, soldSource: 'page' });
    expect(s.competition.level).not.toBe('unknown');
    expect(s.competition.used).toEqual(['results', 'price']);
  });

  it('uses page numbers when the page is filtered (e.g. sold listings)', () => {
    const page = M.parseSearchPage(load('ebay-search-new.html'), { currency: 'USD' });
    const s = M.buildSearchSummary({ api, page, refinements: ['LH_Sold'] });
    expect(s.source).toBe('page');
    expect(s.price.n).toBe(5);
    expect(s.price.median).toBe(25.99);
    expect(s.sellers).toMatchObject({ known: 4, distinct: 3 });
  });

  it('falls back to the page when the API failed', () => {
    const page = M.parseSearchPage(load('ebay-search-old.html'), { currency: 'USD' });
    const s = M.buildSearchSummary({ api: null, page, refinements: [] });
    expect(s.source).toBe('page');
    expect(s.price.quality).toBe('insufficient'); // 3 cards < 5
    expect(s.competition.level).toBe('unknown');
  });

  it('falls back to the API total when the page has no count heading', () => {
    const s = M.buildSearchSummary({ api, page: { resultCount: null, items: [] }, refinements: [] });
    expect(s.resultCount).toEqual({ count: 9012, plus: false });
    expect(s.resultCountSource).toBe('api');
  });
});

describe('priceSummary', () => {
  it('uses the majority currency, trims outliers, no mean', () => {
    const items = [10, 11, 12, 13, 14, 15, 16, 900].map((price) => ({ price, currency: 'USD' }))
      .concat([{ price: 5, currency: 'EUR' }]);
    const s = M.priceSummary(items);
    expect(s.currency).toBe('USD');
    expect(s.excludedOtherCurrency).toBe(1);
    expect(s.max).toBe(16); // 900 trimmed by Tukey fence
    expect(s.median).toBe(13);
    expect(s).not.toHaveProperty('avg');
  });
});

describe('computeCompetition (documented thresholds)', () => {
  const sellers = (distinct: number, known = 40) => ({ known, distinct });
  const sold = (p75: number) => ({ known: 40, p75 });
  const price = (p25: number, median: number, p75: number) => ({ n: 40, p25, median, p75 });

  it('factor anchors', () => {
    expect(M.computeCompetition({ resultCount: 100, price: price(10, 20, 30) }).factors.results).toBe(0);
    expect(M.computeCompetition({ resultCount: 100000, price: price(10, 20, 30) }).factors.results).toBe(1);
    expect(M.computeCompetition({ resultCount: 1000, sold: sold(9) }).factors.sold).toBeCloseTo(0.5, 5);
    expect(M.computeCompetition({ resultCount: 1000, sold: sold(99) }).factors.sold).toBeCloseTo(1, 5);
    expect(M.computeCompetition({ resultCount: 1000, sellers: sellers(12) }).factors.sellers).toBeCloseTo(0, 5);
    expect(M.computeCompetition({ resultCount: 1000, sellers: sellers(36) }).factors.sellers).toBeCloseTo(1, 5);
    expect(M.computeCompetition({ resultCount: 1000, price: price(19, 20, 21) }).factors.price).toBe(1); // d = .1
    expect(M.computeCompetition({ resultCount: 1000, price: price(10, 20, 40) }).factors.price).toBe(0); // d = 1.5
  });

  it('crowded commodity niche → high', () => {
    const c = M.computeCompetition({ resultCount: 250000, sold: sold(150), sellers: sellers(38), price: price(18, 20, 22) });
    expect(c.level).toBe('high');
    expect(c.score).toBeGreaterThanOrEqual(65);
  });

  it('small differentiated niche → low', () => {
    const c = M.computeCompetition({ resultCount: 300, sold: sold(0), sellers: sellers(10), price: price(15, 40, 80) });
    expect(c.level).toBe('low');
    expect(c.score).toBeLessThan(40);
  });

  it('the reported "turkish cotton towel" shape lands in medium/high, not a default', () => {
    const c = M.computeCompetition({ resultCount: 9500, sold: sold(20), sellers: sellers(34), price: price(18, 25.99, 31.5) });
    expect(['medium', 'high']).toContain(c.level);
    expect(c.used).toEqual(['results', 'sold', 'sellers', 'price']);
  });

  it('unknown without a result count or with only one factor', () => {
    expect(M.computeCompetition({ sold: sold(10), sellers: sellers(30) }).level).toBe('unknown');
    expect(M.computeCompetition({ resultCount: 9500 }).level).toBe('unknown');
  });

  it('drops factors with too small samples', () => {
    const c = M.computeCompetition({ resultCount: 9500, sold: { known: 3, p75: 50 }, sellers: { known: 4, distinct: 4 }, price: { n: 3, p25: 1, median: 2, p75: 3 } });
    expect(c.level).toBe('unknown');
  });
});

describe('per-item math', () => {
  const now = Date.parse('2026-10-18T00:00:00Z');
  it('estMonthlySales needs a known count and a listing at least 14 days old', () => {
    expect(M.estMonthlySales(120, '2026-04-18T00:00:00Z', now)).toBe(20) // 183 days = 6.01 months;
    expect(M.estMonthlySales(3, '2026-10-10T00:00:00Z', now)).toBeNull();
    expect(M.estMonthlySales(null, '2026-04-18T00:00:00Z', now)).toBeNull();
    expect(M.estMonthlySales(10, null, now)).toBeNull();
  });
  it('sellThrough', () => {
    expect(M.sellThrough(120, 30)).toBeCloseTo(0.8, 5);
    expect(M.sellThrough(0, 0)).toBeNull();
    expect(M.sellThrough(5, null)).toBeNull();
  });
  it('pctVsMedian', () => {
    expect(M.pctVsMedian(31.5, 25.99)).toBe(21);
    expect(M.pctVsMedian(18, 25.99)).toBe(-31);
    expect(M.pctVsMedian(0, 25.99)).toBeNull();
  });
  it('bestSellerRanks ignores unknown and zero sold, needs ≥5 ranked for "best seller"', () => {
    const items = [
      { id: 'a', soldCount: 500 }, { id: 'b', soldCount: 50 }, { id: 'c', soldCount: null }, { id: 'd', soldCount: 0 },
    ];
    const r = M.bestSellerRanks(items);
    expect(Object.keys(r)).toEqual(['a', 'b']);
    expect(r.a.isBestSeller).toBe(false);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: 'x' + i, soldCount: 100 - i }));
    const r2 = M.bestSellerRanks(many);
    expect(r2.x0).toMatchObject({ rank: 1, percentile: 5, isBestSeller: true });
    expect(r2.x5.isBestSeller).toBe(false);
  });
});

describe('marketplace + refinements', () => {
  it('maps hosts', () => {
    expect(M.marketplaceForHost('www.ebay.de')).toMatchObject({ id: 'EBAY_DE', currency: 'EUR' });
    expect(M.marketplaceForHost('ebay.co.uk')).toMatchObject({ id: 'EBAY_GB', currency: 'GBP' });
    expect(M.marketplaceForHost('www.ebay.com')).toMatchObject({ id: 'EBAY_US' });
  });
  it('detects page filters the API call does not apply', () => {
    expect(M.pageRefinements('?_nkw=towel')).toEqual([]);
    expect(M.pageRefinements('?_nkw=towel&_sacat=0&_sop=12')).toEqual([]);
    expect(M.pageRefinements('?_nkw=towel&LH_Sold=1&LH_Complete=1')).toEqual(['LH_Sold', 'LH_Complete']);
    expect(M.pageRefinements('?_nkw=towel&_udlo=10&_sop=15')).toEqual(['_udlo', '_sop']);
  });
});
