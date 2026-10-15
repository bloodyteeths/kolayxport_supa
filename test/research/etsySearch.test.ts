import { describe, it, expect, vi } from 'vitest';

// Pure helpers only: keep lib/prisma's eager $connect out of these tests (no DB).
vi.mock('@/lib/prisma', () => ({ default: {} }));
import {
  autocompletePresence, buildEvidence, buyerWords, confidenceFor, demandSignal, draftTagsFrom, engagementPerMonth,
  formattersFor, mapEtsyListing, mapListingDetail, modeTaxonomy, newcomerShare, priceSummaryFor, requestLocale,
  searchCacheKey, signalDots, toLegacySearchMarket, toTopListings, top5Share, userRateLimit,
} from '@/lib/research/etsySearch';
import { NOW, halloweenItems, item, rawListing } from './fixtures';

const fmt = formattersFor('en');

describe('price summary (research.md §16 halloween decor)', () => {
  it('mixed JPY/INR/USD with a $9,999 placeholder: median under $200, exclusions counted, no mean', async () => {
    const s = await priceSummaryFor(halloweenItems(), 'USD', { JPY: 1 / 150 });
    expect(s.median).not.toBeNull();
    expect(s.median!).toBeLessThan(200);
    expect(s.excludedNoFx).toBe(3); // INR has no FX rate
    expect(s.excludedImplausible).toBe(1); // $9,999 > $2,000 bound
    expect(s.p25!).toBeLessThanOrEqual(s.median!);
    expect(s.median!).toBeLessThanOrEqual(s.p75!);
    expect(Object.keys(s)).not.toContain('avg');
    expect(Object.keys(s)).not.toContain('mean');
  });

  it('n < 5 → insufficient, n < 20 → small', async () => {
    expect((await priceSummaryFor([item(), item()], 'USD', {})).quality).toBe('insufficient');
    expect((await priceSummaryFor(Array.from({ length: 8 }, () => item()), 'USD', {})).quality).toBe('small');
  });
});

describe('mapEtsyListing', () => {
  it('decodes entities, uses original_creation_timestamp for age and keeps renew separate', () => {
    const m = mapEtsyListing(rawListing());
    expect(m.title).toBe('Mom\'s "Best" Keepsake Box & Gift');
    expect(m.price).toBe(45);
    expect(m.currency).toBe('USD');
    expect(m.originalCreatedAt).toBeLessThan(m.renewedAt!);
    const [top] = toTopListings([m], new Map(), {}, NOW);
    expect(top.ageDays).toBe(800);
  });

  it('a missing price stays null (never 0 in a summary)', () => {
    expect(mapEtsyListing(rawListing({ price: null })).price).toBeNull();
  });
});

describe('aggregations', () => {
  it('top5Share collapses one shop with many listings', () => {
    const items = [
      ...Array.from({ length: 10 }, () => item({ shopId: 'big' })),
      ...Array.from({ length: 10 }, (_, i) => item({ shopId: `s${i}` })),
    ];
    const g = top5Share(items);
    expect(g.guard.ok).toBe(true);
    expect(g.value).toBeCloseTo(14 / 20, 3);
    expect(top5Share([item()]).guard.ok).toBe(false);
  });

  it('newcomerShare uses shop create_date and needs ≥ 5 known shops', () => {
    const items = Array.from({ length: 6 }, (_, i) => item({ shopId: `n${i}` }));
    const nowSec = NOW / 1000;
    const shops = new Map(items.map((it, i) => [it.shopId as string, { createdAt: i < 2 ? nowSec - 100 * 86400 : nowSec - 900 * 86400 }]));
    const g = newcomerShare(items, shops, NOW);
    expect(g.value).toBeCloseTo(2 / 6, 3);
    expect(newcomerShare(items, new Map(), NOW).guard).toEqual({ ok: false, reasonKey: 'research.guard.insufficient' });
  });

  it('engagement skips listings younger than 60 days', () => {
    const nowSec = NOW / 1000;
    const young = Array.from({ length: 10 }, () => item({ originalCreatedAt: nowSec - 10 * 86400, favorites: 999 }));
    expect(engagementPerMonth(young, NOW).value).toBeNull();
    const old = Array.from({ length: 6 }, () => item({ originalCreatedAt: nowSec - 304.4 * 86400, favorites: 100 }));
    expect(engagementPerMonth(old, NOW).value).toBeCloseTo(10, 0);
  });

  it('buyer words count each tag once per listing; draft tags ≤ 13 and ≤ 20 chars', () => {
    const items = [
      item({ tags: ['keepsake box', 'keepsake box', 'memory box'] }),
      item({ tags: ['keepsake box', 'a very long tag that exceeds twenty'] }),
    ];
    const w = buyerWords(items);
    expect(w[0]).toEqual({ tag: 'keepsake box', count: 2, share: 1 });
    const many = Array.from({ length: 20 }, (_, i) => ({ tag: `tag number ${i}`, count: 1, share: 0.1 }));
    const tags = draftTagsFrom([...w, ...many]);
    expect(tags.length).toBeLessThanOrEqual(13);
    expect(tags.every((t) => t.length <= 20)).toBe(true);
  });

  it('modeTaxonomy picks the most common id', () => {
    expect(modeTaxonomy([item({ taxonomyId: 1 }), item({ taxonomyId: 2 }), item({ taxonomyId: 2 })])).toBe('2');
  });
});

describe('Demand Signal (RR §6.2)', () => {
  it('needs ≥ 2 inputs', () => {
    expect(demandSignal({ trendsMean: 80, autocompleteSources: null, engagement: null }).tier).toBeNull();
    const d = demandSignal({ trendsMean: 54, autocompleteSources: 2, engagement: null });
    expect(d.tier).toBe(3);
    expect(d.inputs.find((i) => i.key === 'engagement')?.ok).toBe(false);
    expect(d.kind).toBe('signal');
  });

  it('dots render the tier', () => {
    expect(signalDots(3)).toBe('●●●○○');
    expect(signalDots(null)).toBe('');
  });

  it('autocomplete presence counts sources', () => {
    expect(autocompletePresence('wooden box', [['wooden box gift'], ['nope'], ['wooden boxes for crafts']])).toBe(2);
  });
});

describe('Evidence', () => {
  it('omits guarded facts and caps Etsy confidence at medium', async () => {
    const price = await priceSummaryFor(Array.from({ length: 150 }, (_, i) => item({ price: 30 + (i % 30) })), 'USD', {});
    const ev = buildEvidence({
      price,
      total: { value: 18420, kind: 'measured', guard: { ok: true } },
      newcomers: { value: null, kind: 'measured', guard: { ok: false, reasonKey: 'research.guard.insufficient' } },
      demand: demandSignal({ trendsMean: null, autocompleteSources: 1, engagement: null }),
      money: fmt.money, percent: fmt.percent, count: fmt.count, noVolume: true,
    });
    const keys = ev.facts.map((f) => f.key);
    expect(keys).toEqual(['research.evidence.priceBand', 'research.evidence.competing']);
    expect(ev.facts[1].params.count).toBe('18,420');
    expect(ev.confidence).toBe('medium');
    expect(ev.basis.key).toBe('research.evidence.basisNoVolume');
    expect(confidenceFor(10)).toBe('low');
    expect(confidenceFor(500)).toBe('high');
  });
});

describe('listing details', () => {
  it('reads photos, video and free shipping defensively', () => {
    const d = mapListingDetail({
      listing_id: 9, images: [{ url_170x135: 'a' }, {}], videos: [],
      shipping_profile: { shipping_profile_destinations: [{ destination_country_iso: 'US', primary_cost: { amount: 0 } }] },
    });
    expect(d).toEqual({ listingId: '9', imageCount: 2, thumbUrl: 'a', hasVideo: false, freeShipping: true });
    expect(mapListingDetail({ listing_id: 9 })).toMatchObject({ imageCount: null, hasVideo: null, freeShipping: null });
  });
});

describe('legacy search_market shape (R1-B)', () => {
  it('keeps old field names; legacy avg is the median, never a mean', async () => {
    const items = halloweenItems();
    const price = await priceSummaryFor(items, 'USD', { JPY: 1 / 150 });
    const legacy = toLegacySearchMarket({ query: 'halloween decor', country: 'US', taxonomyId: null, total: 18000, items, fetchedAt: new Date(NOW).toISOString() }, price);
    expect(legacy.priceStats?.avg).toBe(price.median);
    expect(legacy.priceStats?.count).toBe(price.n);
    expect(legacy.items[0]).toHaveProperty('num_favorers');
    expect(legacy.items[0].original_creation_timestamp).toBeGreaterThan(0);
    expect(legacy.tagFrequency[0].pct).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('cache key is stable across case/space and differs by country', () => {
    expect(searchCacheKey('Wooden  Box', 'us')).toBe(searchCacheKey('wooden box', 'US'));
    expect(searchCacheKey('wooden box', 'US')).not.toBe(searchCacheKey('wooden box', 'GB'));
    expect(searchCacheKey('x')).toMatch(/^public:etsy:search:[0-9a-f]{40}$/);
  });

  it('request locale: query, then X-KX-Locale, then Accept-Language', () => {
    expect(requestLocale({ query: { locale: 'tr' }, headers: {} })).toBe('tr');
    expect(requestLocale({ query: {}, headers: { 'x-kx-locale': 'tr-TR' } })).toBe('tr');
    expect(requestLocale({ query: {}, headers: { 'accept-language': 'en-GB,en' } })).toBe('en');
    expect(requestLocale({})).toBe('en');
  });

  it('TR money uses Intl (no "$" concatenation)', () => {
    expect(formattersFor('tr').money(49, 'USD')).toMatch(/\$49/);
    expect(formattersFor('en').money(1234.5, 'USD')).toBe('$1,234.50');
  });

  it('rate limit', () => {
    const t = 1_000;
    expect(userRateLimit('u-rl', 'b', 2, 60_000, t)).toBe(true);
    expect(userRateLimit('u-rl', 'b', 2, 60_000, t)).toBe(true);
    expect(userRateLimit('u-rl', 'b', 2, 60_000, t)).toBe(false);
    expect(userRateLimit('u-rl', 'b', 2, 60_000, t + 61_000)).toBe(true);
  });
});
