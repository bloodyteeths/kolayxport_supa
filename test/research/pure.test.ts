import { describe, it, expect, vi } from 'vitest';

// Pure helpers only: keep lib/prisma's eager $connect out of these tests (no DB).
vi.mock('@/lib/prisma', () => ({ default: {} }));
import { broaderPhrase, chipHref, detectQuery, isLikelyTurkish, routeForQuery } from '@/lib/research/detectQuery';
import {
  biggestIssue, classifyOpportunity, etsyDoctorMetrics, shopP50Views, sortDoctor, sumDailyStats, type OpportunityInput,
} from '@/lib/research/opportunity';
import {
  countryFromAddress, easterSunday, nthWeekday, transitFor, transitMedians, upcomingSeasons,
} from '@/lib/research/seasons';
import { computePeers, mainKeywordFromTitle, peerChecks, pickMainKeyword, selectPeers, PEER_MIN } from '@/lib/research/peers';
import { formattersFor } from '@/lib/research/etsySearch';
import type { Check } from '@/lib/listingScore/types';
import { item } from './fixtures';

describe('detectQuery (research.md §4.3)', () => {
  it('Etsy listing links with or without slug, subdomain or query', () => {
    expect(detectQuery('https://www.etsy.com/listing/1490012234/baby-name-puzzle?ref=x')).toEqual({ kind: 'etsyListing', listingId: '1490012234', slugTitle: 'baby name puzzle' });
    expect(detectQuery('etsy.com/listing/1490012234')).toMatchObject({ kind: 'etsyListing', listingId: '1490012234', slugTitle: null });
    expect(detectQuery('https://www.etsy.com/de/listing/1490012234/x')).toMatchObject({ kind: 'etsyListing' });
  });
  it('shops, eBay, Trendyol, Amazon, text', () => {
    expect(detectQuery('https://www.etsy.com/shop/WoodAndWords?ref=1')).toEqual({ kind: 'etsyShop', shopName: 'WoodAndWords' });
    expect(detectQuery('https://www.ebay.com/itm/123456789012')).toMatchObject({ kind: 'ebayItem', itemId: '123456789012' });
    expect(detectQuery('https://www.ebay.com/itm/wooden-box/123456789012')).toMatchObject({ kind: 'ebayItem', slugTitle: 'wooden box' });
    expect(detectQuery('https://www.ebay.com/str/engraveus')).toEqual({ kind: 'ebaySeller', seller: 'engraveus' });
    expect(detectQuery('https://www.ebay.co.uk/usr/someone')).toEqual({ kind: 'ebaySeller', seller: 'someone' });
    expect(detectQuery('https://www.trendyol.com/marka/ahsap-kutu-p-123456')).toMatchObject({ kind: 'trendyolProduct', productId: '123456', slugTitle: 'ahsap kutu' });
    expect(detectQuery('https://www.amazon.com/Some-Thing/dp/B0ABCDEF12?th=1')).toEqual({ kind: 'amazonAsin', asin: 'B0ABCDEF12' });
    expect(detectQuery('wooden keepsake box')).toEqual({ kind: 'text', text: 'wooden keepsake box' });
  });
  it('routes', () => {
    expect(routeForQuery('https://www.etsy.com/listing/111111/x', { isOwnListing: () => true })).toBe('/app/research/listings?mkt=etsy&open=111111');
    expect(routeForQuery('https://www.etsy.com/listing/111111/wood-box')).toBe('/app/research/products?mkt=etsy&q=wood+box&compareListing=111111');
    expect(routeForQuery('etsy.com/shop/WoodAndWords')).toBe('/app/research/shops?mkt=etsy&add=WoodAndWords');
    expect(routeForQuery('wooden box', { chip: 'tags', mkt: 'etsy' })).toBe('/app/research/keywords?mkt=etsy&q=wooden+box');
    expect(routeForQuery('wooden box')).toBe('/app/research/products?q=wooden+box');
    expect(chipHref('price', 'box')).toBe('/app/research/products?q=box#price');
    expect(routeForQuery('https://www.trendyol.com/x/y-p-1', { priceGapEnabled: true })).toMatch(/^\/app\/research\/products\?source=trendyol&url=/);
  });
  it('broaderPhrase', () => {
    expect(broaderPhrase('halloween decor outdoor')).toBe('halloween decor');
    expect(broaderPhrase('halloween')).toBeNull();
  });
  it('Turkish detection (§3.3)', () => {
    expect(isLikelyTurkish('ahşap anı kutusu')).toBe(true);
    expect(isLikelyTurkish('ahsap hediye kutusu')).toBe(true);
    expect(isLikelyTurkish('wooden keepsake box')).toBe(false);
    expect(isLikelyTurkish('wooden keepsake box', 'tr')).toBe(false);
    expect(isLikelyTurkish('lavanta sabunu', 'tr')).toBe(true);
    expect(isLikelyTurkish('lavanta sabunu', 'en')).toBe(false);
  });
});

describe('opportunity sort (research.md §7.3)', () => {
  const base = (over: Partial<OpportunityInput>): OpportunityInput => ({ id: 'x', views30d: 10, sales30d: 1, tracked: false, rank: null, health: 80, failingGain: 0, ...over });
  it('rules in order', () => {
    expect(classifyOpportunity(base({ views30d: 412, sales30d: 0 }), 40)).toBe('traffic_no_sales');
    expect(classifyOpportunity(base({ views30d: 40, sales30d: 0 }), 40)).not.toBe('traffic_no_sales'); // under 50
    expect(classifyOpportunity(base({ views30d: 60, sales30d: 0 }), 100)).not.toBe('traffic_no_sales'); // under shop p50
    expect(classifyOpportunity(base({ tracked: true, rank: null }), null)).toBe('cant_be_found');
    expect(classifyOpportunity(base({ tracked: true, rank: 212 }), null)).toBe('cant_be_found');
    expect(classifyOpportunity(base({ tracked: false, rank: null, health: 45 }), null)).toBe('health_gaps');
    expect(classifyOpportunity(base({ health: 61 }), null)).toBe('other');
    // collecting (< 7 daily rows) falls back to rule 3 (spec §7.3): rule 2 is skipped too
    expect(classifyOpportunity(base({ collecting: true, tracked: true, rank: null, health: 45 }), null)).toBe('health_gaps');
    expect(classifyOpportunity(base({ collecting: true, tracked: true, rank: 300, health: 80 }), null)).toBe('other');
  });
  it('collecting listings skip rule 1 and sort deterministically', () => {
    const rows: OpportunityInput[] = [
      base({ id: 'a', health: 90 }),
      base({ id: 'b', views30d: null, sales30d: null, health: 30, failingGain: 20 }),
      base({ id: 'c', views30d: 400, sales30d: 0 }),
      base({ id: 'd', health: 40, failingGain: 50 }),
      base({ id: 'e', health: 60 }),
    ];
    expect(sortDoctor(rows, (r) => r, 'opportunity').map((r) => r.item.id)).toEqual(['c', 'd', 'b', 'e', 'a']);
    expect(sortDoctor(rows, (r) => r, 'health').map((r) => r.item.id)).toEqual(['b', 'd', 'e', 'a', 'c'].sort((x, y) => {
      const h: Record<string, number> = { a: 90, b: 30, c: 80, d: 40, e: 60 }; return h[x] - h[y];
    }));
    const byViews = sortDoctor(rows, (r) => r, 'views');
    expect(byViews[0].item.id).toBe('c');
    expect(byViews[byViews.length - 1].item.id).toBe('b'); // unknown last
    expect(byViews[0].rank).toBe(1);
  });
  it('p50 and daily sums', () => {
    expect(shopP50Views([{ views30d: 10 }, { views30d: null }, { views30d: 30 }])).toBe(20);
    expect(sumDailyStats([{ views: 5, unitsSold: 1 }, { views: null, unitsSold: 0 }])).toEqual({ views: 5, sales: 1, days: 2 });
  });
  it('fewer than 7 daily rows → collecting guard', () => {
    const m = etsyDoctorMetrics({ views: 50, sales: 0, days: 3 }, '2026-10-10');
    expect(m.views30d).toEqual({ value: null, kind: 'measured', guard: { ok: false, reasonKey: 'research.doc.collecting', reasonParams: { date: '2026-10-10' } } });
    expect(m.measured).toBe(false);
    const ok = etsyDoctorMetrics({ views: 412, sales: 3, days: 30 }, null);
    expect(ok.conversion.value).toBeCloseTo(3 / 412, 4);
  });
  it('biggest issue = largest gain, fails first', () => {
    const checks: Check[] = [
      { id: 'a', label: 'x', status: 'warn', impact: 10, gain: 8 },
      { id: 'b', label: 'x', status: 'fail', impact: 10, gain: 8 },
      { id: 'c', label: 'x', status: 'pass', impact: 50, gain: 0 },
      { id: 'p', label: 'x', status: 'fail', impact: 50, gain: 30, group: 'peers' },
    ];
    expect(biggestIssue(checks)?.id).toBe('b');
  });
});

describe('seasons', () => {
  it('date rules', () => {
    expect(nthWeekday(2026, 5, 0, 2).toISOString().slice(0, 10)).toBe('2026-05-10'); // US Mother's Day
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(nthWeekday(2026, 11, 4, 4).toISOString().slice(0, 10)).toBe('2026-11-26'); // Thanksgiving
  });
  it('Christmas US list-by with defaults (3 production days, FedEx rate card)', () => {
    const rows = upcomingSeasons({ country: 'US', now: new Date('2026-10-15T09:00:00Z'), limit: 12 });
    const xmas = rows.find((r) => r.key === 'christmas')!;
    expect(xmas.date).toBe('2026-12-25');
    expect(xmas.lastShip.date).toBe('2026-12-18'); // 4 transit + 3 safety
    expect(xmas.listBy).toBe('2026-10-24'); // − (3 production + 45 window + 7 indexing)
    expect(xmas.lastShip.transitDays.kind).toBe('estimate');
    expect(rows.find((r) => r.key === 'halloween')).toBeUndefined(); // too late to list for 31 Oct
    expect(rows.every((r) => r.daysToListBy >= 0)).toBe(true);
  });
  it('measured transit from own labels', () => {
    const samples = Array.from({ length: 5 }, (_, i) => ({ carrier: 'FedEx International', country: 'US', shippedAt: '2026-09-01T00:00:00Z', deliveredAt: new Date(Date.parse('2026-09-01T00:00:00Z') + (3 + i) * 86_400_000).toISOString() }));
    const stats = transitMedians([...samples, { carrier: 'ups', country: 'US', shippedAt: '2026-09-02', deliveredAt: '2026-09-01' }]);
    expect(stats).toEqual([{ carrier: 'fedex', country: 'US', median: 5, n: 5 }]);
    const t = transitFor('US', stats);
    expect(t).toMatchObject({ carrier: 'fedex', sample: 5, days: { value: 5, kind: 'measured' } });
    expect(transitFor('GB', stats).days.kind).toBe('estimate');
  });
  it('country from address JSON', () => {
    expect(countryFromAddress({ countryCode: 'us' })).toBe('US');
    expect(countryFromAddress({ country: 'United States' })).toBeNull();
    expect(countryFromAddress(null)).toBeNull();
  });
});

describe('peers (research.md §7.1)', () => {
  const fmt = formattersFor('en');
  const own = { id: '1', title: 'Baby Name Puzzle, Personalized Wooden Toy', tags: ['name puzzle', 'baby gift', 'wooden toy'], price: 58, currency: 'USD', imageCount: 5, hasVideo: false };

  it('every peer check is na under 20 peers', () => {
    const peers = Array.from({ length: PEER_MIN - 1 }, () => item({ price: 40 }));
    const block = computePeers(peers, {}, { currency: 'USD' });
    const checks = peerChecks(own, block, fmt.money, fmt.percent);
    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.status === 'na' && c.group === 'peers')).toBe(true);
  });

  it('price above p75 by > 25 % fails; photos below median fail; title short fails', () => {
    const peers = Array.from({ length: 30 }, (_, i) => item({ price: 36 + (i % 10), title: 'x'.repeat(118), tags: ['name puzzle', 'baby gift', 'wooden toy', 'toddler toy'] }));
    const details = Object.fromEntries(peers.map((p) => [p.listingId, { imageCount: 9, hasVideo: true, freeShipping: false }]));
    const block = computePeers(peers, details, { currency: 'USD' });
    expect(block.photos.value).toBe(9);
    expect(block.videoShare.value).toBe(1);
    const by = Object.fromEntries(peerChecks(own, block, fmt.money, fmt.percent).map((c) => [c.id, c]));
    expect(by.price_vs_peers.status).toBe('fail');
    expect(by.price_vs_peers.params?.price).toBe('$58');
    expect(by.photos_vs_peers.status).toBe('fail');
    expect(by.title_vs_peers.status).toBe('fail');
    expect(by.tags_vs_peers.status).toBe('warn'); // 3 of the user's tags are peer tags
  });

  it('currency mismatch → price check na', () => {
    const peers = Array.from({ length: 25 }, () => item({ price: 40 }));
    const block = computePeers(peers, {}, { currency: 'USD' });
    const c = peerChecks({ ...own, currency: 'EUR' }, block, fmt.money, fmt.percent).find((x) => x.id === 'price_vs_peers')!;
    expect(c).toMatchObject({ status: 'na', naReason: 'research.doc.currencyMismatch' });
  });

  it('main keyword: tracked best rank, else the title lead phrase', () => {
    expect(pickMainKeyword('X', [{ keyword: 'b', rank: 40 }, { keyword: 'a', rank: 12 }, { keyword: 'c', rank: null }])).toEqual({ keyword: 'a', source: 'tracked', rank: 12 });
    expect(mainKeywordFromTitle('Baby Name Puzzle, Personalized Wooden Toy')).toBe('baby name puzzle');
    expect(selectPeers([item({ listingId: '1' }), item()], '1')).toHaveLength(1);
  });
});
