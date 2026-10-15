import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { halloweenItems, NOW } from './fixtures';

const { authUser, cacheFind, cacheUpsert, budget, p } = vi.hoisted(() => ({
  authUser: vi.fn(),
  cacheFind: vi.fn(),
  cacheUpsert: vi.fn(),
  budget: { usedFraction: 0 },
  p: {
    etsyShop: { findMany: vi.fn(), count: vi.fn() },
    etsyListing: { findMany: vi.fn(), findFirst: vi.fn() },
    etsyListingDailyStat: { groupBy: vi.fn(), aggregate: vi.fn() },
    rankTrackedKeyword: { findMany: vi.fn() },
    etsyListingDraft: { findMany: vi.fn() },
    ebayListingDraft: { findMany: vi.fn() },
    credential: { findUnique: vi.fn() },
    ebayListing: { findMany: vi.fn() },
    orderItem: { groupBy: vi.fn(), count: vi.fn() },
    order: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
  default: {
    researchCache: { findUnique: (...a: unknown[]) => cacheFind(...a), upsert: (...a: unknown[]) => cacheUpsert(...a) },
    ...p,
  },
}));
vi.mock('@/lib/etsy/rateBudget', async (orig) => {
  const real = await orig<typeof import('@/lib/etsy/rateBudget')>();
  return { ...real, getBudgetSnapshot: () => ({ ...real.getBudgetSnapshot(), usedFraction: budget.usedFraction }) };
});

import productsHandler from '@/pages/api/research/products';
import listingsHandler, { parseDoctorQuery, inHealthBand } from '@/pages/api/research/listings';
import peersHandler from '@/pages/api/research/listings/[id]/peers';
import seasonsHandler from '@/pages/api/research/seasons';
import { trackedKeywordHref } from '@/pages/api/research/home';
import { numbersCheck, extractNumbers, hasNumberWord, validateExplainRequest, capText } from '@/pages/api/research/explain';
import { cleanSeeds } from '@/pages/api/research/seeds';
import { fetchAutocompleteSources, searchCacheKey } from '@/lib/research/etsySearch';

function run(handler: (req: any, res: any) => unknown, query: Record<string, unknown> = {}, method = 'GET', body?: unknown) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(handler({ method, headers: {}, query, body } as any, res)).then(() => res);
}

const fetchSpy = vi.fn();
const env = (data: unknown, fetchedAt: string, fresh: boolean) => ({
  data: { v: 1, fetchedAt, data }, expiresAt: new Date(Date.now() + (fresh ? 3_600_000 : -3_600_000)),
});

beforeEach(() => {
  vi.clearAllMocks();
  authUser.mockResolvedValue({ id: 'user-1' });
  budget.usedFraction = 0;
  cacheFind.mockResolvedValue(null);
  cacheUpsert.mockResolvedValue({});
  fetchSpy.mockImplementation(async (url: string) => {
    if (String(url).includes('exchangerate-api')) return new Response(JSON.stringify({ rates: { USD: 1, JPY: 150 } }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('GET /api/research/products — budget breaker (research.md §16)', () => {
  const seedCache = (search: unknown | null) => {
    cacheFind.mockImplementation(async ({ where }: any) => {
      const key: string = where.userId_cacheKey.cacheKey;
      if (key === searchCacheKey('halloween decor', 'US') && search) return env(search, '2026-10-14T10:42:00.000Z', false);
      if (key.startsWith('public:trends:') ) return env(54, '2026-10-14T10:00:00.000Z', true);
      if (key.startsWith('public:autocomplete:')) return env(2, '2026-10-14T10:00:00.000Z', true);
      return null;
    });
  };

  it('forced breach serves the stale shared cache with the budget error and its original fetchedAt', async () => {
    budget.usedFraction = 0.9;
    seedCache({ query: 'halloween decor', country: 'US', taxonomyId: null, total: 18420, items: halloweenItems(), fetchedAt: '2026-10-14T10:42:00.000Z' });
    const res = await run(productsHandler, { q: 'halloween decor', mkt: 'etsy' });
    expect(res.statusCode).toBe(200);
    expect(res.body.errors).toContainEqual({ section: 'all', key: 'research.error.budget' });
    expect(res.body.data.fetchedAt).toBe('2026-10-14T10:42:00.000Z');
    expect(res.body.data.cached).toBe(true);
    expect(res.body.data.price.median).toBeLessThan(200);
    expect(res.body.source).toMatchObject({ source: 'research.sourceName.etsySearch', kind: 'measured', sampleTotal: halloweenItems().length });
    expect(res.body.source.excluded.count).toBeGreaterThan(0);
    expect(res.body.data.demand.tier).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/"avg"|"mean"/);
    // nothing was sent to Etsy, nothing written to a marketplace
    expect(fetchSpy.mock.calls.every(([u, init]) => !String(u).includes('etsy.com') && (!init || !init.method || init.method === 'GET'))).toBe(true);
  });

  it('forced breach with nothing cached → 200, data null, budget error (not an error page)', async () => {
    budget.usedFraction = 0.95;
    seedCache(null);
    const res = await run(productsHandler, { q: 'halloween decor' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBeNull();
    expect(res.body.errors).toEqual([{ section: 'all', key: 'research.error.budget' }]);
  });

  it('Amazon without eligibility → marketplace error; empty q → 400; unauthenticated → 401', async () => {
    expect((await run(productsHandler, { q: 'x', mkt: 'amazon' })).body.errors[0]).toEqual({ section: 'marketplace', key: 'research.mkt.amazonIneligible' });
    expect((await run(productsHandler, {})).statusCode).toBe(400);
    authUser.mockResolvedValueOnce(null);
    expect((await run(productsHandler, { q: 'x' })).statusCode).toBe(401);
  });
});

describe('GET /api/research/listings — Listing doctor', () => {
  const listing = (id: number, over: Record<string, unknown> = {}) => ({
    etsyListingId: BigInt(id), title: `Listing ${id} &amp; more`, description: 'desc '.repeat(200), tags: ['a tag', 'b tag'], materials: [],
    priceAmount: 4500, priceDivisor: 100, priceCurrencyCode: 'USD', imageCount: 5, hasVideo: false, shippingProfileId: BigInt(1),
    processingMin: 1, itemWeight: 1, quantity: 3, state: 'active', url: null, views: 1000, numFavorers: 10, hasVariations: false,
    thumbnailUrl170x135: null, thumbnailUrl570xN: null, thumbnailUrl75x75: null, etsyCreatedTimestamp: 1_700_000_000, etsyUpdatedTimestamp: 1_760_000_000,
    ...over,
  });

  it('not connected → connected:false', async () => {
    p.etsyShop.findMany.mockResolvedValue([]);
    const res = await run(listingsHandler, { mkt: 'etsy' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ connected: false, rows: [], total: 0 });
  });

  it('opportunity order, collecting guard, decoded titles, draft overlay with queued delete', async () => {
    p.etsyShop.findMany.mockResolvedValue([{ shopId: 'shop1', shopName: 'Belle', isDefault: true, lastListingSyncAt: new Date(NOW) }]);
    p.etsyListing.findMany.mockResolvedValue([listing(1), listing(2), listing(3, { imageCount: 0, tags: [] })]);
    const d = (v: Date) => ({ date: v });
    p.etsyListingDailyStat.groupBy.mockResolvedValue([
      { etsyListingId: BigInt(1), _sum: { views: 412, unitsSold: 0 }, _count: { _all: 30 }, _min: d(new Date('2026-09-15')) },
      { etsyListingId: BigInt(2), _sum: { views: 30, unitsSold: 2 }, _count: { _all: 30 }, _min: d(new Date('2026-09-15')) },
      { etsyListingId: BigInt(3), _sum: { views: 5, unitsSold: 0 }, _count: { _all: 3 }, _min: d(new Date('2026-10-12')) },
    ]);
    p.etsyListingDailyStat.aggregate.mockResolvedValue({ _min: { date: new Date('2026-09-15') }, _max: { date: new Date('2026-10-15T06:00:00Z') } });
    p.rankTrackedKeyword.findMany.mockResolvedValue([]);
    p.etsyListingDraft.findMany.mockResolvedValue([{ id: 'dr1', etsyListingId: BigInt(3), status: 'draft', fieldPatch: { title: 'New &amp; better', price: 39 }, taxonomyPatch: null, inventoryPatch: null, queuedActions: [{ type: 'delete' }], syncedAt: null, updatedAt: new Date() },
      { id: 'dr2', etsyListingId: BigInt(2), status: 'failed', fieldPatch: {}, taxonomyPatch: null, inventoryPatch: null, personalizationPatch: { isPersonalizable: true }, queuedActions: [], lastSyncError: 'boom', syncedAt: null, updatedAt: new Date() }]);

    const res = await run(listingsHandler, { mkt: 'etsy', sort: 'opportunity' });
    const data = res.body.data;
    expect(data.connected).toBe(true);
    expect(data.rows[0].listing.id).toBe('1'); // traffic without sales
    expect(data.rows[0].opportunity.rule).toBe('traffic_no_sales');
    expect(data.rows[0].listing.title).toBe('Listing 1 & more');
    const r3 = data.rows.find((r: any) => r.listing.id === '3');
    expect(r3.views30d.guard).toEqual({ ok: false, reasonKey: 'research.doc.collecting', reasonParams: { date: '2026-10-12' } });
    expect(r3.listing.sync).toMatchObject({ draftId: 'dr1', status: 'pending', queuedDelete: true, draft: { title: 'New & better', price: 39 } });
    expect(r3.biggestIssue.checkId).toBeTruthy();
    expect(data.statsSince).toBe('2026-09-15');
    // M5 overlay engine: same changed fields as the grid (personalization-only draft), failed → error key
    const r2 = data.rows.find((r: any) => r.listing.id === '2');
    expect(r2.listing.sync).toMatchObject({ draftId: 'dr2', status: 'sync_failed', changedFields: ['personalization'], errorKey: 'listings.sendError.generic', queuedDelete: false });
    expect(res.body.source.source).toBe('research.sourceName.doctorEtsy');
  });

  it('eBay: sales guarded while no eBay order item stores an item id; eBay drafts overlaid', async () => {
    p.credential.findUnique.mockResolvedValue({ ebayRefreshToken: 'rt' });
    p.ebayListing.findMany.mockResolvedValue([{
      sku: 'SKU-1', listingId: '1234', title: 'Box', description: 'd', imageCount: 3, imageUrls: [], imageUrl: null, aspects: {}, condition: 'NEW',
      conditionDescription: null, categoryId: '1', fulfillmentPolicyId: 'f', paymentPolicyId: 'p', returnPolicyId: 'r', weightValue: 1, lengthValue: 1,
      widthValue: 1, heightValue: 1, priceValue: 20, priceCurrency: 'USD', isLegacy: false, quantity: 2, status: 'PUBLISHED', listingUrl: null, syncedAt: null,
    }]);
    p.orderItem.count.mockResolvedValue(0);
    p.ebayListingDraft.findMany.mockResolvedValue([{ id: 'eb1', sku: 'SKU-1', status: 'draft', inventoryPatch: null, offerPatch: { pricingSummary: { price: { value: '18' } } }, queuedActions: [{ type: 'delete' }], syncedAt: null, updatedAt: new Date() }]);
    const res = await run(listingsHandler, { mkt: 'ebay' });
    const row = res.body.data.rows[0];
    expect(p.orderItem.groupBy).not.toHaveBeenCalled();
    expect(row.sales30d.guard).toEqual({ ok: false, reasonKey: 'research.doc.noSalesEbay' });
    expect(row.listing.sync).toMatchObject({ draftId: 'eb1', status: 'pending', changedFields: ['price'], draft: { price: 18 }, queuedDelete: true });

    p.orderItem.count.mockResolvedValue(5);
    p.orderItem.groupBy.mockResolvedValue([]);
    const measured = await run(listingsHandler, { mkt: 'ebay' });
    expect(measured.body.data.rows[0].sales30d).toMatchObject({ value: 0, guard: { ok: true } });
  });

  it('query parsing', () => {
    expect(parseDoctorQuery({ mkt: 'amazon' })).toBeNull();
    expect(parseDoctorQuery({ size: '999', sort: 'nope', issue: 'DROP TABLE' })).toMatchObject({ size: 50, sort: 'opportunity', issue: undefined });
    expect(parseDoctorQuery({ 'f.issue': 'photos_count', size: '3' })).toMatchObject({ issue: 'photos_count', size: 3 });
    expect(parseDoctorQuery({ health: 'lt50' })?.health).toBe('lt50');
    expect(parseDoctorQuery({ 'f.health': 'bogus' })?.health).toBeUndefined();
    expect([inHealthBand(49, 'lt50'), inHealthBand(50, 'lt50'), inHealthBand(74, '50-74'), inHealthBand(90, 'gte90'), inHealthBand(null, 'lt50')]).toEqual([true, false, true, true, false]);
  });
});

describe('GET /api/research/listings/[id]/peers', () => {
  it('budget breach: peer checks na with the budget error, listing checks still scored', async () => {
    budget.usedFraction = 0.9;
    p.etsyShop.findMany.mockResolvedValue([{ shopId: 'shop1' }]);
    p.etsyListing.findFirst.mockResolvedValue({
      etsyShopId: 'shop1', title: 'Baby Name Puzzle, Personalized Wooden Toy', description: 'x', tags: ['name puzzle'], materials: [],
      priceAmount: 5800, priceDivisor: 100, priceCurrencyCode: 'USD', imageCount: 5, hasVideo: false, shippingProfileId: null, processingMin: null, itemWeight: null,
    });
    p.rankTrackedKeyword.findMany.mockResolvedValue([]);
    const res = await run(peersHandler, { id: '1490012234' });
    expect(res.statusCode).toBe(200);
    expect(res.body.errors).toContainEqual({ section: 'peers', key: 'research.error.budget' });
    expect(res.body.data.keyword).toEqual({ keyword: 'baby name puzzle', source: 'title', rank: null });
    expect(res.body.data.checks.every((c: any) => c.status === 'na' && c.group === 'peers')).toBe(true);
    expect(res.body.data.listingChecks.length).toBeGreaterThan(5);
    expect(res.body.data.listingChecks.find((c: any) => c.id === 'price_market').status).toBe('na');
  });

  it('eBay → marketplace error; not own → 404', async () => {
    expect((await run(peersHandler, { id: '1', mkt: 'ebay' })).body.errors[0].key).toBe('research.doc.peersEtsyOnly');
    p.etsyShop.findMany.mockResolvedValue([{ shopId: 'shop1' }]);
    p.etsyListing.findFirst.mockResolvedValue(null);
    expect((await run(peersHandler, { id: '42' })).statusCode).toBe(404);
  });
});

describe('GET /api/research/seasons', () => {
  it('measured transit from own delivered labels', async () => {
    const shipped = new Date('2026-09-01T00:00:00Z');
    p.order.findMany.mockResolvedValue(Array.from({ length: 4 }, (_, i) => ({
      shippedAt: shipped, deliveredAt: new Date(shipped.getTime() + (4 + i) * 86_400_000), shippingAddress: { countryCode: 'US' },
      shipments: [{ carrier: 'fedex', status: 'created' }],
    })));
    const res = await run(seasonsHandler, { country: 'US', productionDays: '5' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.productionDays).toBe(5);
    expect(res.body.data.events.length).toBeGreaterThan(0);
    expect(res.body.data.events[0].lastShip.transitDays.kind).toBe('measured');
    expect(res.body.source).toMatchObject({ source: 'research.sourceName.ownLabels', kind: 'measured', sample: 4 });
  });
});

describe('explain + seeds guards (RR §6.5)', () => {
  it('extracts numbers in EN and TR formats', () => {
    expect(extractNumbers('Most sell between $38 and $62 (median $49.50), 18,420 listings, 30%')).toEqual([38, 62, 49.5, 18420, 30]);
    expect(extractNumbers('18.420 ilan, medyan 49,5 $')).toEqual([18420, 49.5]);
  });

  it('strips sentences with invented numbers, keeps rounded ones and shares as percents', () => {
    const metrics = { median: 49.2, p25: 38, p75: 62, total: 18420, newcomers: 0.3 };
    const r = numbersCheck('The median is about $49. About 30% of top shops are new. Buyers search 5,000 times a month!', metrics);
    expect(r.text).toBe('The median is about $49. About 30% of top shops are new.');
    expect(r.stripped).toBe(1);
  });

  it('strips spelled-out quantities and multipliers (EN/TR), keeps ordinary sentences', () => {
    const metrics = { median: 49, p75: 62 };
    const en = numbersCheck('The median is $49. Prices are three times the median. Top shops charge twice as much. One of the shops is new.', metrics);
    expect(en.text).toBe('The median is $49. One of the shops is new.');
    expect(en.stripped).toBe(2);
    const tr = numbersCheck('Medyan 49 $. Fiyatlar medyanın iki katı. Satışların yarısı tek mağazada. Bir storage bin ilanı öne çıkıyor.', metrics);
    expect(tr.text).toBe('Medyan 49 $. Bir storage bin ilanı öne çıkıyor.');
    expect(hasNumberWord('Beşik ilanları güçlü.')).toBe(false); // "beş" inside a word is not a number
  });

  it('shares under 1 match only their own value (relative tolerance), not 0–0.8', () => {
    const metrics = { newcomers: 0.3 };
    expect(numbersCheck('Newcomer share is 0.3.', metrics).stripped).toBe(0);
    expect(numbersCheck('About 30% are new.', metrics).stripped).toBe(0);
    expect(numbersCheck('Share is 0.7.', metrics).stripped).toBe(1);
    expect(numbersCheck('Share is 0.', metrics).stripped).toBe(1);
  });

  it('validates the request shape and caps the text', () => {
    expect(validateExplainRequest({ tool: 'products', metrics: { a: 1, b: { c: 'x' } } }).ok).toBe(true);
    expect(validateExplainRequest({ tool: 'nope', metrics: { a: 1 } }).ok).toBe(false);
    expect(validateExplainRequest({ tool: 'products', metrics: { a: { b: { c: 1 } } } }).ok).toBe(false);
    expect(validateExplainRequest({ tool: 'products', metrics: [] }).ok).toBe(false);
    const long = 'Sentence one is here. '.repeat(40);
    expect(capText(long).length).toBeLessThanOrEqual(600);
  });

  it('seeds stay English, deduped, ≤ 5', () => {
    expect(cleanSeeds(['Wooden Keepsake Box', 'ahşap kutu', 'wooden keepsake box', 'memory box', 'a', 'x y z w v u t s'])).toEqual(['wooden keepsake box', 'memory box']);
    expect(cleanSeeds('engraved box, baby gift box')).toEqual(['engraved box', 'baby gift box']);
    expect(cleanSeeds(null)).toEqual([]);
  });
});

describe('demand inputs: a failed lookup is never cached as null', () => {
  it('all autocomplete lookups fail → null, nothing written; stale value served when one exists', async () => {
    expect(await fetchAutocompleteSources('wooden keepsake box')).toBeNull();
    expect(cacheUpsert).not.toHaveBeenCalled();
    cacheFind.mockResolvedValue(env(2, '2026-10-14T10:00:00.000Z', false));
    expect(await fetchAutocompleteSources('wooden keepsake box')).toBe(2);
    expect(cacheUpsert).not.toHaveBeenCalled();
  });
});

describe('Research Home tracked keyword links', () => {
  it('Listing doctor deep link until keywords:etsy ships, then the Keywords page with shop + mkt', () => {
    expect(trackedKeywordHref('123', 'shop1')).toBe('/app/research/listings?mkt=etsy&shop=shop1&open=123');
    expect(trackedKeywordHref('123', 'shop1', new Set(['keywords:etsy']))).toBe('/app/research/keywords?view=tracked&listing=123&shop=shop1&mkt=etsy');
  });
});
