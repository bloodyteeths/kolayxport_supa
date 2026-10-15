// research R1-C pure logic: URL/compare helpers, prefill payloads (never a title, price only in the shop currency),
// tag merge rules (13 × 20, no title overlap, replace weakest), payload normalisation, marketplace eligibility,
// season re-basing, recent searches, routing to unshipped tools.
import { describe, expect, it } from 'vitest';
import { draftPrefill, parseCompare, prefillRoute, serializeCompare, startFromPrefill } from '@/components/domain/research/products/ProductFinder';
import { stageBlockReason } from '@/components/domain/research/products/StageToListingModal';
import { applyReplace, planTagAdd, weakestFirst } from '@/components/domain/research/products/tagMerge';
import { topBuyerTags } from '@/components/domain/research/products/BuyerWordsCard';
import { ageParts } from '@/components/domain/research/products/TopListingsTable';
import { explainMetrics } from '@/components/domain/research/products/EvidenceCard';
import { needsWorkLine } from '@/components/domain/research/home/NeedsWorkCard';
import { seasonSeed } from '@/components/domain/research/home/SeasonsCard';
import { mergeRecent } from '@/components/domain/research/home/RecentCard';
import { isSafeRecentHref, toolOfHref, withRecent } from '@/components/domain/research/home/recentSearches';
import { routeResearchSearch, toShippedHref } from '@/components/domain/research/home/routeSearch';
import { legacyResearchHref, mktAvailability, researchToolHref, resolveMkt } from '@/components/domain/research/ResearchLayout';
import { compareKey, infoNotice, isEmptyResult, matchCompareResults, normalizeProducts, productsKey } from '@/lib/research/hooks/useResearchProducts';
import type { ListingRow } from '@/lib/listings/types';
import { rebaseSeason, seasonViews, seasonsKey } from '@/lib/research/hooks/useSeasons';
import { doctorRow, productsData, seasonsResponse } from './r1c-fixtures';

describe('compare param', () => {
  it('parses q1|q2|q3, trims, dedupes, caps at 3', () => {
    expect(parseCompare(' a | b |a| c | d ')).toEqual(['a', 'b', 'c']);
    expect(parseCompare(undefined)).toEqual([]);
  });
  it('serialises only from 2 queries', () => {
    expect(serializeCompare(['a'])).toBeUndefined();
    expect(serializeCompare(['a', 'b', 'b', 'c', 'd'])).toBe('a|b|c');
  });
  it('keys: single q, repeated q for compare (≥ 2), relevance omitted', () => {
    expect(productsKey({ q: ' x ', mkt: 'etsy', country: 'US', sort: 'relevance' })).toBe('/api/research/products?q=x&mkt=etsy&country=US');
    expect(productsKey({ q: '  ', mkt: 'etsy' })).toBeNull();
    expect(compareKey(['a', 'b'], { mkt: 'ebay', sort: 'newest' })).toBe('/api/research/products?q=a&q=b&mkt=ebay&sort=newest');
    expect(compareKey(['a'], { mkt: 'etsy' })).toBeNull();
  });
});

describe('prefill payloads (research.md §5.1)', () => {
  it('Draft a listing: no title, server draft tags, median only in the shop currency', () => {
    const r = normalizeProducts(productsData(), { query: 'x', mkt: 'etsy' });
    const p = draftPrefill(r, 'USD');
    expect(p.title).toBeUndefined();
    expect(p.target).toBe('etsy');
    expect(p.source).toBe('etsy-research');
    expect(p.tags).toEqual(['halloween decor', 'spooky decor', 'fall decor']);
    expect(p.price).toBe(38);
    expect(p.categoryHint).toBe('1234');
    expect(draftPrefill(r, 'EUR').price).toBeUndefined();
    expect(draftPrefill(r, null).price).toBeUndefined();
  });
  it('a small sample never pre-fills a price; eBay targets the eBay creator without tags', () => {
    const small = normalizeProducts(productsData({ mkt: 'ebay', price: { ...productsData().price, quality: 'small', n: 9 } }), { query: 'x', mkt: 'ebay' });
    const p = draftPrefill(small, 'USD');
    expect(p.price).toBeUndefined();
    expect(p.target).toBe('ebay');
    expect(p.tags).toEqual([]);
  });
  it('starting point: tags + title words, never the competitor title', () => {
    const r = normalizeProducts(productsData(), { query: 'halloween decor', mkt: 'etsy' });
    const p = startFromPrefill(r.top[0], r);
    expect(p.title).toBeUndefined();
    expect(p.tags).toEqual(['halloween decor', 'spooky sign']);
    expect(p.keywords[0]).toBe('halloween decor');
  });
});

describe('tag merge (13 × 20, no title overlap)', () => {
  it('drops duplicates, too-long tags and title overlaps; reports overflow', () => {
    const current = ['a1 b', 'c2 d', 'e3 f', 'g4 h', 'i5 j', 'k6 l', 'm7 n', 'o8 p', 'q9 r', 's10 t', 'u11 v', 'w12 x'];
    const plan = planTagAdd(current, ['C2 D', 'this tag is far too long', 'walnut box', 'fresh one', 'second new'], 'Engraved Walnut Box');
    expect(plan.add).toEqual(['fresh one', 'second new']);
    expect(plan.rejected.map((r) => r.reason).sort()).toEqual(['duplicate', 'title_overlap', 'too_long']);
    expect(plan.overflow).toBe(1);
  });
  it('replaces the weakest current tags first', () => {
    const shares: Record<string, number> = { a: 0.5, b: 0.1, c: 0 };
    expect(weakestFirst(['a', 'b', 'c', 'd'], (t) => shares[t] ?? 0)).toEqual(['c', 'd', 'b', 'a']);
    expect(applyReplace(['a', 'b', 'c'], ['x'], ['B'])).toEqual(['a', 'c', 'x']);
  });
  it('Add 5 tags proposes the top 5 by share, ≤ 20 characters', () => {
    expect(topBuyerTags(productsData().buyerWords)).toEqual(['halloween decor', 'spooky decor', 'fall decor', 'witch decor', 'pumpkin sign']);
  });
});

describe('normalizeProducts', () => {
  it('survives garbage and decodes entities', () => {
    const r = normalizeProducts({ top: [{ id: 5, title: 'A &amp; B', price: '12.5' }, { nope: true }], demand: { tier: 9, inputs: 'x' }, evidence: 'AI verdict' }, { query: 'q', mkt: 'etsy' });
    expect(r.top).toHaveLength(1);
    expect(r.top[0]).toMatchObject({ id: '5', title: 'A & B', price: { amount: 12.5, currency: 'USD' } });
    expect(r.demand.tier).toBeNull();
    expect(r.evidence.facts).toEqual([]);
    expect(r.price.quality).toBe('insufficient');
    expect(isEmptyResult(r)).toBe(false);
    expect(isEmptyResult(normalizeProducts({}, { query: 'q', mkt: 'etsy' }))).toBe(true);
  });
  it('the halloween fixture keeps the robust median, never a mean field', () => {
    const r = normalizeProducts(productsData(), { query: 'q', mkt: 'etsy' });
    expect(r.price.median).toBeLessThan(200);
    expect(r.price.excludedNoFx).toBe(13);
    expect(Object.keys(r.price)).not.toContain('avg');
    expect(Object.keys(explainMetrics(r)).some((k) => /avg|mean/i.test(k))).toBe(false);
  });
});

describe('marketplace eligibility (§3.2) and defaults', () => {
  it('hidden / disabled per tool', () => {
    expect(mktAvailability('listings', 'amazon')).toBe('hidden');
    expect(mktAvailability('products', 'amazon')).toBe('disabled');
    expect(mktAvailability('products', 'amazon', { amazonEligible: true })).toBe('enabled');
    expect(mktAvailability('keywords', 'trendyol')).toBe('hidden');
    expect(mktAvailability('home', 'trendyol')).toBe('enabled');
  });
  it('URL → stored → first connected (Etsy → eBay → Trendyol → Amazon) → Etsy', () => {
    expect(resolveMkt('products', { url: 'ebay', stored: 'etsy' })).toBe('ebay');
    expect(resolveMkt('listings', { url: 'trendyol', stored: 'ebay' })).toBe('ebay');
    // Product finder can't serve Trendyol yet: a Trendyol-only seller defaults to Etsy, other tools still pick it.
    expect(resolveMkt('products', { connected: { etsy: false, ebay: false, trendyol: true } })).toBe('etsy');
    expect(resolveMkt('home', { connected: { etsy: false, ebay: false, trendyol: true } })).toBe('trendyol');
    expect(resolveMkt('products', { connected: { amazon: true } })).toBe('etsy');
    expect(resolveMkt('home', {})).toBe('etsy');
  });
  it('hrefs: shipped tools on the hub, unshipped tools on their legacy page', () => {
    expect(researchToolHref('products', 'ebay', { q: 'a b' })).toBe('/app/research/products?mkt=ebay&q=a+b');
    expect(researchToolHref('keywords', 'etsy')).toBe('/app/etsy-research?tab=research');
    expect(researchToolHref('shops', 'ebay')).toBe('/app/ebay-research?sub=seller_tracker');
    expect(legacyResearchHref('trendyol')).toBe('/app/trendyol-arastirma');
    expect(toShippedHref('/app/research/shops?mkt=etsy&add=WoodAndWords', 'ebay')).toBe('/app/etsy-research?tab=shopIntel');
    expect(toShippedHref('/app/research/products?mkt=etsy&q=x#price', 'etsy')).toBe('/app/research/products?mkt=etsy&q=x#price');
  });
});

describe('smart search routing (§4.3)', () => {
  it('own Etsy listing → Listing doctor; someone else’s → Product finder with the slug phrase', async () => {
    const own = await routeResearchSearch('https://www.etsy.com/listing/1490012234/baby-name-puzzle', { mkt: 'etsy', isOwnEtsyListing: async () => true });
    expect(own).toBe('/app/research/listings?mkt=etsy&open=1490012234');
    const other = await routeResearchSearch('etsy.com/listing/1490012234/baby-name-puzzle', { mkt: 'etsy', isOwnEtsyListing: async () => false });
    expect(other.startsWith('/app/research/products?mkt=etsy&q=baby+name+puzzle')).toBe(true);
  });
  it('a check that throws counts as "not own"; chips route plain text', async () => {
    const r = await routeResearchSearch('etsy.com/listing/1490012234/x', { mkt: 'etsy', isOwnEtsyListing: async () => { throw new Error('x'); } });
    expect(r.startsWith('/app/research/products')).toBe(true);
    expect(await routeResearchSearch('wooden box', { mkt: 'etsy', question: 'price' })).toBe('/app/research/products?mkt=etsy&q=wooden+box#price');
    expect(await routeResearchSearch('wooden box', { mkt: 'etsy', question: 'tags' })).toBe('/app/etsy-research?tab=research');
  });
});

describe('seasons', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  it('re-bases list-by on the viewer production days', () => {
    const row = seasonsResponse().data!.events[0];
    expect(rebaseSeason(row, 3, now).daysLeft).toBe(10);
    expect(rebaseSeason(row, 8, now).daysLeft).toBe(5);
    expect(rebaseSeason(row, 0, now).daysLeft).toBe(13);
  });
  it('keeps future events, soonest list-by first; key carries production days', () => {
    const rows = seasonViews(seasonsResponse().data!.events, 3, now);
    expect(rows.map((r) => r.key)).toEqual(['christmas', 'valentines']);
    expect(seasonViews(seasonsResponse().data!.events, 3, new Date('2027-01-01T00:00:00Z')).map((r) => r.key)).toEqual(['valentines']);
    expect(seasonsKey('US', 5)).toBe('/api/research/seasons?country=US&productionDays=5');
    expect(seasonSeed({ key: 'mothersDayUs', seed: '' })).toBe('mothers day us');
  });
});

describe('home helpers', () => {
  it('needs-work line: traffic without sales, else issue count', () => {
    expect(needsWorkLine(doctorRow('1', 'a', 40, 412, 0, 4))).toEqual({ key: 'viewsNoSales', params: { views: 412 } });
    expect(needsWorkLine(doctorRow('1', 'a', 40, null, null, 4))).toEqual({ key: 'issues', params: { count: 4 } });
  });
  it('recent searches: newest first, deduped, capped at 10', () => {
    let list = [] as ReturnType<typeof withRecent>;
    for (let i = 0; i < 12; i++) list = withRecent(list, { q: `q${i}`, tool: 'products', mkt: 'etsy', at: new Date(2026, 9, i + 1).toISOString() });
    list = withRecent(list, { q: 'Q11', tool: 'products', mkt: 'etsy', at: new Date(2026, 9, 20).toISOString() });
    expect(list).toHaveLength(10);
    expect(list[0].q).toBe('Q11');
    expect(list.filter((r) => r.q.toLowerCase() === 'q11')).toHaveLength(1);
    expect(mergeRecent([{ at: '2026-10-01T00:00:00Z' }], [{ at: '2026-10-02T00:00:00Z' }])[0].at).toBe('2026-10-02T00:00:00Z');
  });
  it('age is compact and never from a renew date (days given by the API)', () => {
    expect(ageParts(12)).toEqual({ unit: 'days', count: 12 });
    expect(ageParts(150)).toEqual({ unit: 'months', count: 5 });
    expect(ageParts(800)).toEqual({ unit: 'years', count: 2 });
    expect(ageParts(null)).toBeNull();
  });
});

describe('review fixes (R1-C)', () => {
  const row = (over: Partial<Pick<ListingRow, 'price' | 'editable' | 'sync'>> = {}): Pick<ListingRow, 'price' | 'editable' | 'sync'> => ({
    price: { amount: 30, currency: 'USD' },
    editable: { price: true, qty: true },
    sync: null,
    ...over,
  });
  const sync = (over: Partial<NonNullable<ListingRow['sync']>> = {}): NonNullable<ListingRow['sync']> => ({
    draftId: 'd1', status: 'pending', changedFields: [], draft: {}, queuedDelete: false, scheduledSendAt: null, syncedAt: null, ...over,
  });
  const price = { kind: 'price' as const, amount: 49, currency: 'USD' };
  const tags = { kind: 'tags' as const, tags: ['a'], shares: {} };

  it('stage picker: never a cross-currency price; variations / locked price / syncing / conflict / queued delete blocked', () => {
    expect(stageBlockReason(row(), price)).toBeNull();
    expect(stageBlockReason(row({ price: { amount: 30, currency: 'usd' } }), price)).toBeNull();
    expect(stageBlockReason(row({ price: { amount: 900, currency: 'TRY' } }), price)).toEqual({ key: 'currencyMismatch', params: { listed: 'TRY', research: 'USD' } });
    expect(stageBlockReason(row({ price: null as unknown as ListingRow['price'] }), price)?.key).toBe('currencyMismatch');
    expect(stageBlockReason(row({ editable: { price: false, qty: true, reason: 'variations' } }), price)?.key).toBe('variations');
    expect(stageBlockReason(row({ editable: { price: false, qty: true } }), price)?.key).toBe('priceLocked');
    expect(stageBlockReason(row({ sync: sync({ status: 'syncing' }) }), tags)?.key).toBe('syncing');
    expect(stageBlockReason(row({ sync: sync({ status: 'conflict' }) }), price)?.key).toBe('conflict');
    expect(stageBlockReason(row({ sync: sync({ queuedDelete: true }) }), tags)?.key).toBe('queuedDelete');
  });
  it('stage picker: unsent staged tags are never overwritten with live tags; other staged fields are fine', () => {
    expect(stageBlockReason(row({ sync: sync({ changedFields: ['tags'] }) }), tags)?.key).toBe('stagedTags');
    expect(stageBlockReason(row({ sync: sync({ changedFields: ['price'] }) }), tags)).toBeNull();
    expect(stageBlockReason(row({ sync: sync({ changedFields: ['tags'] }) }), price)).toBeNull();
  });
  it('compare: results pair with their query, not their index (budget-dropped query → null)', () => {
    const a = { query: 'Halloween Decor' };
    const c = { query: 'fall decor' };
    expect(matchCompareResults(['halloween decor', 'xmas', 'fall decor'], [a, c])).toEqual([a, null, c]);
    expect(matchCompareResults(['a', 'b'], [{}, { x: 1 }])).toEqual([{}, { x: 1 }]);
  });
  it('explain: the median only for quality ok, the band for ok/small, nothing the Price card hides', () => {
    const base = productsData();
    const m = (quality: string) => explainMetrics({ ...base, price: { ...base.price, quality } } as typeof base);
    expect(m('ok')).toMatchObject({ priceMedian: base.price.median, priceP25: base.price.p25 });
    expect(m('small')).toMatchObject({ priceMedian: null, priceP25: base.price.p25, priceP75: base.price.p75, priceQuality: 'small' });
    expect(m('insufficient')).toMatchObject({ priceMedian: null, priceP25: null, priceP75: null });
    expect(m('implausible')).toMatchObject({ priceMedian: null, priceP25: null, priceP75: null });
  });
  it('prefill goes only to a page that reads it', () => {
    expect(prefillRoute('etsy', { listingsOn: false, editorOn: false })).toBe('/app/etsy-listings?prefill=session');
    expect(prefillRoute('ebay', { listingsOn: true, editorOn: false })).toBe('/app/ebay-listings?prefill=session');
    expect(prefillRoute('ebay', { listingsOn: true, editorOn: true })).toBe('/app/ebay-listings/new?prefill=session');
  });
  it('unavailable marketplace / budget with nothing cached is a notice, not an error', () => {
    expect(infoNotice({ data: null, errors: [{ section: 'marketplace', key: 'research.products.trendyolLater' }] } as never)?.key).toBe('research.products.trendyolLater');
    expect(infoNotice({ data: null, errors: [{ section: 'all', key: 'research.error.budget' }] } as never)?.key).toBe('research.error.budget');
    expect(infoNotice({ data: null, errors: [{ section: 'all', key: 'research.error.ebay' }] } as never)).toBeUndefined();
  });
  it('recent searches replay the resolved href (same-origin only)', () => {
    expect(toolOfHref('/app/research/listings?open=123')).toBe('listings');
    expect(toolOfHref('/app/research/shops?add=X')).toBe('shops');
    expect(toolOfHref('/app/etsy-research?tab=shopIntel')).toBe('products');
    expect(isSafeRecentHref('/app/research/listings?open=1')).toBe(true);
    expect(isSafeRecentHref('//evil.com')).toBe(false);
    expect(isSafeRecentHref('https://evil.com')).toBe(false);
  });
});
