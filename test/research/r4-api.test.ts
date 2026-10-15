// research R4 — GET /api/research/price-gap: auth, Pro gate (402 featureLocked, neutral for shopify_free), input
// validation, category/mine/link assembly from the indexes (no live marketplace calls), medians not means,
// low-confidence + unmatched handling, own international label costs (domestic excluded), FX failure guard.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authUser: vi.fn(),
  convert: vi.fn(),
  user: { subscriptionPlan: 'pro', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null } as Record<string, unknown> | null,
  shopify: 0,
  p: {
    trendyolProductIndex: { groupBy: vi.fn(), findMany: vi.fn() },
    trendyolProduct: { findMany: vi.fn() },
    arbitrageMatch: { findMany: vi.fn() },
    ebayProductIndex: { findMany: vi.fn() },
    arbitrageResultRecord: { findMany: vi.fn() },
    researchCache: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    order: { findMany: vi.fn() },
    shipperProfile: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => h.authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/finance/fx', () => ({ convertCurrency: (...a: unknown[]) => h.convert(...a) }));
vi.mock('@/lib/integrations/trendyolSearch', () => ({
  TRENDYOL_CATEGORIES: [{ slug: 'cezve-x-c1', label: 'Coffee pots', labelTr: 'Cezve', ebaySearch: 'turkish coffee pot', group: 'Mutfak' }],
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: async () => h.user },
    shopifyShop: { count: async () => h.shopify },
    ...h.p,
  },
}));

import handler, { imagesFromJson } from '@/pages/api/research/price-gap';

function run(query: Record<string, unknown> = {}, method = 'GET') {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(handler({ method, headers: {}, query } as any, res)).then(() => res);
}

const FETCHED = new Date('2026-10-14T08:00:00Z');
const ty = (id: number, o: Record<string, unknown> = {}) => ({
  productId: id, name: `Bak&#305;r cezve ${id}`, brand: 'Usta', priceTry: 640, imageUrl: 'https://cdn.dsmcdn.com/x.jpg', url: `https://www.trendyol.com/u/c-p-${id}`,
  categorySlug: 'cezve-x-c1', categoryName: 'Cezve', fetchedAt: FETCHED, ...o,
});
const eb = (id: string, price: number, currency = 'USD') => ({ itemId: id, title: `Copper pot &amp; ${id}`, price, currency, imageUrl: null, itemUrl: `https://www.ebay.com/itm/${id}`, soldQuantity: 3, categoryId: '20625' });

beforeEach(() => {
  vi.clearAllMocks();
  h.authUser.mockResolvedValue({ id: 'user-1' });
  h.user = { subscriptionPlan: 'pro', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null };
  h.shopify = 0;
  h.convert.mockImplementation(async (amount: number, from: string, to: string) => {
    if (from === to) return amount;
    if (from === 'TRY' && to === 'USD') return amount / 40;
    if (from === 'EUR' && to === 'USD') return amount * 1.1;
    return null;
  });
  h.p.trendyolProductIndex.groupBy.mockResolvedValue([{ categorySlug: 'cezve-x-c1', _count: { _all: 3 } }]);
  h.p.trendyolProductIndex.findMany.mockResolvedValue([ty(1), ty(2), ty(3)]);
  h.p.trendyolProduct.findMany.mockResolvedValue([]);
  h.p.arbitrageMatch.findMany.mockResolvedValue([
    ...['a', 'b', 'c', 'd', 'e', 'f'].map((x) => ({ trendyolId: 1, ebayItemId: `1${x}`, confidence: 0.9, matchType: 'exact' })),
    { trendyolId: 2, ebayItemId: '2a', confidence: 0.55, matchType: 'similar' },
    { trendyolId: 3, ebayItemId: '3a', confidence: 0.95, matchType: 'none' },
  ]);
  h.p.ebayProductIndex.findMany.mockResolvedValue([
    eb('1a', 40), eb('1b', 44), eb('1c', 48), eb('1d', 50), eb('1e', 52), eb('1f', 9999), eb('2a', 30, 'EUR'),
  ]);
  h.p.arbitrageResultRecord.findMany.mockResolvedValue([{ trendyolProductId: 1, translatedQuery: 'turkish copper coffee pot' }]);
  h.p.researchCache.findMany.mockResolvedValue([]);
  h.p.researchCache.findUnique.mockResolvedValue(null);
  h.p.researchCache.upsert.mockResolvedValue({});
  h.p.shipperProfile.findUnique.mockResolvedValue({ defaultWeightKg: 0.8 });
  h.p.order.findMany.mockResolvedValue([
    ...[400, 420, 440, 460, 480].map((c) => ({ manualShippingCost: c, manualShippingCostCurrency: 'TRY', weightKg: 0.7, shippingAddress: { countryCode: 'US' }, shipments: [{ carrier: 'FedEx', status: 'created' }] })),
    { manualShippingCost: 90, manualShippingCostCurrency: 'TRY', weightKg: 0.7, shippingAddress: { countryCode: 'TR' }, shipments: [{ carrier: 'MNG', status: 'created' }] },
    { manualShippingCost: 12, manualShippingCostCurrency: 'XYZ', weightKg: 0.7, shippingAddress: { countryCode: 'DE' }, shipments: [{ carrier: 'UPS', status: 'created' }] },
  ]);
});

describe('GET /api/research/price-gap — gate and validation', () => {
  it('401 without a session, 405 for POST', async () => {
    h.authUser.mockResolvedValueOnce(null);
    expect((await run()).statusCode).toBe(401);
    expect((await run({}, 'POST')).statusCode).toBe(405);
  });

  it('402 featureLocked for Growth (not neutral) and never touches the indexes', async () => {
    h.user = { ...h.user!, subscriptionPlan: 'growth' };
    const res = await run();
    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'Payment Required', limitType: 'feature', reason: 'featureLocked', feature: 'arbitrage', neutral: false });
    expect(h.p.trendyolProductIndex.findMany).not.toHaveBeenCalled();
  });

  it('402 neutral for shopify_free', async () => {
    h.shopify = 1;
    const res = await run();
    expect(res.statusCode).toBe(402);
    expect(res.body.neutral).toBe(true);
  });

  it('400 for a bad source or a non-Trendyol link', async () => {
    expect((await run({ from: 'amazon' })).body).toEqual({ error: 'bad_request', key: 'research.gap.error.badSource' });
    const bad = await run({ from: 'link', url: 'https://example.com/x-p-123456' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.key).toBe('research.gap.error.badLink');
  });
});

describe('GET /api/research/price-gap — category', () => {
  it('builds rows from the indexes: medians (no mean), confidence tiers, unmatched dropped, entities decoded', async () => {
    const res = await run({ from: 'category' });
    expect(res.statusCode).toBe(200);
    const d = res.body.data;
    expect(d.category).toBe('cezve-x-c1');
    expect(d.categories).toEqual([{ slug: 'cezve-x-c1', label: 'Coffee pots', labelTr: 'Cezve', products: 3 }]);
    expect(d.rows.map((r: any) => r.id)).toEqual(['1', '2']);
    expect(d.unmatched).toBe(1); // product 3: matchType none
    const r1 = d.rows[0];
    expect(r1.title).toBe('Bakır cezve 1');
    expect(r1.confidence).toBe('high');
    expect(r1.ebay.median).toBe(48); // $9,999 outlier excluded as implausible
    expect(r1.ebay.excludedImplausible).toBe(1);
    expect(r1.matches[0].title).toBe('Copper pot & 1a');
    expect(r1.englishQuery).toBe('turkish copper coffee pot');
    expect(r1.etsy).toBeNull(); // nothing cached: no live Etsy call
    const r2 = d.rows[1];
    expect(r2.confidence).toBe('low');
    expect(r2.ebay.median).toBe(33); // EUR → USD via FX
    expect(JSON.stringify(res.body)).not.toMatch(/"avg|"mean/i);
    expect(res.body.source).toMatchObject({ source: 'research.sourceName.priceGap', kind: 'measured', sample: 2, fetchedAt: FETCHED.toISOString() });
  });

  it('own label costs: international only, per carrier × band, TRY converted; unpriceable labels counted', async () => {
    const d = (await run()).body.data;
    expect(d.fx.usdPerTry).toBe(1 / 40);
    expect(d.shipping).toEqual([{ carrier: 'fedex', band: '1', n: 5, medianUsd: 11, p25Usd: 10.5, p75Usd: 11.5, quality: 'small' }]);
    expect(d.shippingExcluded).toBe(1); // XYZ currency (the TR domestic label is skipped, not counted)
    expect(d.defaultWeightKg).toBe(0.8);
  });

  it('own label costs: default-weight orders (0.5 kg, never edited) excluded separately; latest live shipment only; no cache pin on a missing rate', async () => {
    h.p.order.findMany.mockResolvedValue([
      ...[400, 420, 440, 460, 480].map((c) => ({ manualShippingCost: c, manualShippingCostCurrency: 'TRY', weightKg: 0.5, weightEditedAt: null, shippingAddress: { countryCode: 'US' }, shipments: [{ carrier: 'FedEx' }] })),
      ...[400, 420, 440, 460, 480].map((c) => ({ manualShippingCost: c, manualShippingCostCurrency: 'TRY', weightKg: 0.5, weightEditedAt: FETCHED, shippingAddress: { countryCode: 'US' }, shipments: [{ carrier: 'UPS' }] })),
      { manualShippingCost: 12, manualShippingCostCurrency: 'XYZ', weightKg: 0.7, weightEditedAt: null, shippingAddress: { countryCode: 'DE' }, shipments: [{ carrier: 'UPS' }] },
    ]);
    const d = (await run()).body.data;
    expect(d.shipping.map((o: any) => [o.carrier, o.band, o.n])).toEqual([['ups', '0.5', 5]]);
    expect(d.shippingExcludedDefaultWeight).toBe(5);
    expect(d.shippingExcluded).toBe(1);
    const sel = h.p.order.findMany.mock.calls[0][0].select.shipments;
    expect(sel).toMatchObject({ where: { status: { notIn: ['voided', 'void_requested', 'failed'] } }, orderBy: { createdAt: 'desc' }, take: 1 });
    const shippingWrites = h.p.researchCache.upsert.mock.calls.filter((c: any[]) => JSON.stringify(c[0]).includes('research:gap:shipping'));
    expect(shippingWrites).toHaveLength(0);
  });

  it('own label costs are cached when every currency had a rate', async () => {
    h.p.order.findMany.mockResolvedValue(
      [400, 420, 440, 460, 480].map((c) => ({ manualShippingCost: c, manualShippingCostCurrency: 'TRY', weightKg: 0.7, weightEditedAt: null, shippingAddress: { countryCode: 'US' }, shipments: [{ carrier: 'FedEx' }] })),
    );
    await run();
    const shippingWrites = h.p.researchCache.upsert.mock.calls.filter((c: any[]) => JSON.stringify(c[0]).includes('research:gap:shipping'));
    expect(shippingWrites).toHaveLength(1);
  });

  it('Etsy column comes from the shared cache only', async () => {
    h.p.researchCache.findMany.mockResolvedValue([
      { cacheKey: (await import('@/lib/research/etsySearch')).searchCacheKey('turkish copper coffee pot', 'US'), data: { v: 1, fetchedAt: '2026-10-13T10:00:00.000Z', data: { items: [20, 30, 40, 50, 60].map((p) => ({ price: p, currency: 'USD' })) } } },
    ]);
    const r1 = (await run()).body.data.rows[0];
    expect(r1.etsy).toMatchObject({ median: 40, n: 5, fetchedAt: '2026-10-13T10:00:00.000Z' });
  });

  it('no FX rate → an fx error and usdPerTry null (the client hides landed cost and margin)', async () => {
    h.convert.mockResolvedValue(null);
    const res = await run();
    expect(res.body.data.fx.usdPerTry).toBeNull();
    expect(res.body.errors).toContainEqual({ section: 'fx', key: 'research.gap.guard.noFx' });
  });

  it('an unknown category falls back to the largest indexed one with a note', async () => {
    const res = await run({ cat: 'nope' });
    expect(res.body.data.category).toBe('cezve-x-c1');
    expect(res.body.errors).toContainEqual({ section: 'source', key: 'research.gap.error.categoryNotIndexed' });
  });
});

describe('GET /api/research/price-gap — mine / link', () => {
  it('mine: own catalog joined to the storefront id by barcode; unresolved products counted, never linked by supplier id', async () => {
    h.p.trendyolProduct.findMany.mockResolvedValue([
      { barcode: 'B1', title: 'Cezve', brandName: null, salePrice: '599.90', listPrice: null, images: [{ url: 'https://cdn.dsmcdn.com/m.jpg' }], thumbnailUrl: null, categoryName: 'Mutfak', syncedAt: FETCHED },
      { barcode: 'B99', title: 'Peştemal', brandName: null, salePrice: null, listPrice: '290', images: null, thumbnailUrl: null, categoryName: null, syncedAt: FETCHED },
      { barcode: 'NOPE', title: 'Havlu', brandName: null, salePrice: '100', listPrice: null, images: null, thumbnailUrl: null, categoryName: null, syncedAt: FETCHED },
    ]);
    h.p.trendyolProductIndex.findMany.mockResolvedValueOnce([
      { productId: 1, barcode: 'B1', url: 'https://www.trendyol.com/usta/cezve-p-1', categorySlug: 'cezve-x-c1' },
      { productId: 99, barcode: 'B99', url: null, categorySlug: 'havlu-x-c2' },
    ]);
    const d = (await run({ from: 'mine' })).body.data;
    const q = h.p.trendyolProductIndex.findMany.mock.calls[0][0];
    expect(q.where.barcode).toEqual({ in: ['B1', 'B99', 'NOPE'] });
    expect(h.p.trendyolProduct.findMany.mock.calls[0][0].select.trendyolId).toBeUndefined();
    expect(d.rows.map((r: any) => [r.id, r.trPriceTry, r.confidence])).toEqual([['1', 599.9, 'high'], ['99', 290, null]]);
    expect(d.rows[0].url).toBe('https://www.trendyol.com/usta/cezve-p-1');
    expect(d.rows[1].url).toBeNull(); // no synthesized -p- URL
    expect(d.rows[0].images).toEqual(['https://cdn.dsmcdn.com/m.jpg']);
    expect(d.unmatched).toBe(1);
    expect(d.unresolved).toBe(1);
  });

  it('link: one product by id; not indexed → note', async () => {
    h.p.trendyolProductIndex.findMany.mockResolvedValueOnce([]);
    const res = await run({ from: 'link', url: 'https://www.trendyol.com/u/c-p-555555' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.rows).toEqual([]);
    expect(res.body.errors).toContainEqual({ section: 'source', key: 'research.gap.error.notIndexed' });
    expect(h.p.trendyolProductIndex.findMany.mock.calls[0][0].where.productId).toBe(555555);
  });
});

describe('imagesFromJson', () => {
  it('https only, thumbnail first, deduped', () => {
    expect(imagesFromJson([{ url: 'https://a/1.jpg' }, 'http://b/2.jpg', 'https://a/1.jpg'], 'https://a/t.jpg')).toEqual(['https://a/t.jpg', 'https://a/1.jpg']);
    expect(imagesFromJson(null)).toEqual([]);
  });
});
