// /api/ext/research, /api/ext/listing-stats and /api/ext/amazon-enrich under the research quota.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextApiRequest } from 'next';

const USER = 'user_etsy';

vi.mock('@/lib/prisma', async () => {
  const { fakePrisma } = await import('./fakeResearchStore');
  return {
    default: {
      ...fakePrisma,
      credential: {
        findUnique: vi.fn(async () => ({
          amazonRefreshToken: 'enc:refresh', amazonMarketplaceId: 'ATVPDKIKX0DER', amazonMarketplaceIds: ['ATVPDKIKX0DER'], amazonRegion: 'na',
        })),
        update: vi.fn(async () => ({})),
      },
    },
  };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(async (req: any) => (req.headers?.authorization ? { id: req.headers.authorization.slice(7) } : null)),
}));
vi.mock('@/lib/etsy/http', () => ({
  etsyPublicHeaders: () => ({}),
  etsyFetch: vi.fn(async () => ({ ok: true, json: async () => ({ count: 1, results: [] }), text: async () => '' })),
}));
vi.mock('@/lib/etsy/searchSummary', () => ({ summarizeEtsySearch: vi.fn(() => ({ totalResults: 1, medianPrice: 10 })) }));
vi.mock('@/lib/etsy/listingStats', () => {
  class EtsyPublicApiError extends Error { status: number; constructor(s: number) { super('etsy ' + s); this.status = s; } }
  return {
    EtsyPublicApiError,
    getListingStats: vi.fn(async (id: string, page: any) => ({ listingId: id, pageSignals: page || {}, sales: { monthlySales: 3 } })),
    sanitizePageSignals: (p: any) => ({ pagePrice: p?.pagePrice ?? null, pageCurrency: p?.pageCurrency ?? null, inCarts: p?.inCarts ?? null }),
    getBatchListingStats: vi.fn(async (ids: string[]) => ({ listings: Object.fromEntries(ids.map((i) => [i, { sales: 1 }])), pendingIds: [] })),
    getShopStats: vi.fn(async (id: string) => ({ shop: { shop_name: id } })),
  };
});
vi.mock('@/lib/integrations/amazonClient', () => ({
  AMAZON_MARKETPLACES: { US: { id: 'ATVPDKIKX0DER', domain: 'amazon.com', region: 'na', name: 'United States' } },
  getValidToken: vi.fn(async () => 'access-token'),
}));
vi.mock('@/lib/amazon/spapiSignals', () => ({
  fetchProductSignals: vi.fn(async ({ asins }: { asins: string[] }) => ({
    items: Object.fromEntries(asins.map((a) => [a, { asin: a, bsr: 100 }])),
    errors: {},
  })),
}));

import { store, makeRes } from './fakeResearchStore';
import { quotaKey, istanbulDay, budgetKey, GLOBAL_USER_ID } from '@/lib/ext/researchQuota';
import researchHandler from '@/pages/api/ext/research';
import listingStatsHandler from '@/pages/api/ext/listing-stats';
import amazonHandler from '@/pages/api/ext/amazon-enrich';
import { etsyFetch } from '@/lib/etsy/http';
import { getListingStats } from '@/lib/etsy/listingStats';
import { fetchProductSignals } from '@/lib/amazon/spapiSignals';

const today = () => quotaKey(istanbulDay().day);

function post(body: any, user: string | null = USER, extra: Record<string, string> = {}): NextApiRequest {
  return {
    method: 'POST',
    headers: { ...(user ? { authorization: `Bearer ${user}` } : {}), 'x-kx-client': 'ext/9.7.1', ...extra },
    body,
    query: {},
    socket: { remoteAddress: '10.0.0.' + Math.floor(Math.random() * 250) },
  } as unknown as NextApiRequest;
}

beforeEach(() => {
  store.reset();
  store.setUser(USER, 'trial', 'trialing', new Date(Date.now() + 5 * 86400e3));
  vi.mocked(etsyFetch).mockClear();
  vi.mocked(getListingStats).mockClear();
  vi.mocked(fetchProductSignals).mockClear();
});

describe('/api/ext/research', () => {
  it('search_enrich: miss charges one lookup, the same query from anyone is then free', async () => {
    const r1 = makeRes();
    await researchHandler(post({ action: 'search_enrich', query: 'Linen Dress' }), r1);
    expect(r1.state.status).toBe(200);
    expect(r1.state.body).toMatchObject({ summary: { totalResults: 1 }, plan: 'starter', quota: { used: 1, limit: 50 } });
    expect(store.count(GLOBAL_USER_ID, budgetKey('etsy', istanbulDay().day))).toBe(1);

    store.setUser('u2', 'pro');
    const r2 = makeRes();
    await researchHandler(post({ action: 'search_enrich', query: 'linen dress' }, 'u2'), r2);
    expect(r2.state.body).toMatchObject({ summary: { totalResults: 1 }, quota: { used: 0, limit: 1500 } });
    expect(etsyFetch).toHaveBeenCalledTimes(1);
  });

  it('trial user over 50/day gets the 429 research_limit payload', async () => {
    store.setCount(USER, today(), 50);
    const r = makeRes();
    await researchHandler(post({ action: 'shop_enrich', shopId: 'SomeShop' }), r);
    expect(r.state.status).toBe(429);
    expect(r.state.body).toMatchObject({ error: 'research_limit', reason: 'user_daily', limit: 50, used: 50 });
  });

  it('signed-out: small anonymous allowance, then signed_out with the sign-up URL', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 3; i++) {
      const r = makeRes();
      await researchHandler(post({ action: 'search_enrich', query: 'anon q ' + i }, null, ip), r);
      expect(r.state.status).toBe(200);
    }
    const r = makeRes();
    await researchHandler(post({ action: 'search_enrich', query: 'anon q 9' }, null, ip), r);
    expect(r.state.status).toBe(429);
    expect(r.state.body).toMatchObject({ reason: 'signed_out', upgradeUrl: 'https://kolayxport.com/login?mode=signup&utm_source=extension&utm_medium=limit' });

    const r2 = makeRes();
    await researchHandler(post({ action: 'listings_batch', listingIds: ['1'] }, null), r2);
    expect(r2.state.status).toBe(429);
    expect(r2.state.body.reason).toBe('signed_out');
  });

  it('listings_batch + search_enrich of one page view count as one lookup', async () => {
    const pv = { 'x-kx-page-view': 'pvpage0000001' };
    await researchHandler(post({ action: 'search_enrich', query: 'q1' }, USER, pv), makeRes());
    await researchHandler(post({ action: 'listings_batch', listingIds: ['1', '2'] }, USER, pv), makeRes());
    await researchHandler(post({ action: 'listings_batch', listingIds: ['3'] }, USER, pv), makeRes());
    expect(store.count(USER, today())).toBe(1);
  });
});

describe('/api/ext/listing-stats', () => {
  it('shares by listing + page price, echoing the viewer\'s own page signals', async () => {
    const r1 = makeRes();
    await listingStatsHandler(post({ listingId: '123456', page: { pagePrice: 20, pageCurrency: 'USD', inCarts: 3 } }), r1);
    expect(r1.state.status).toBe(200);
    expect(r1.state.body.quota).toMatchObject({ used: 1, limit: 50 });

    store.setUser('u3', 'starter');
    const r2 = makeRes();
    await listingStatsHandler(post({ listingId: '123456', page: { pagePrice: 20, pageCurrency: 'USD', inCarts: 9 } }, 'u3'), r2);
    expect(getListingStats).toHaveBeenCalledTimes(1);
    expect(r2.state.body.pageSignals).toMatchObject({ inCarts: 9 });
    expect(store.count('u3', today())).toBe(0);

    // A different page price is a different result (revenue uses it).
    await listingStatsHandler(post({ listingId: '123456', page: { pagePrice: 15, pageCurrency: 'USD' } }, 'u3'), makeRes());
    expect(getListingStats).toHaveBeenCalledTimes(2);
  });

  it('over the limit: 429 research_limit', async () => {
    store.setCount(USER, today(), 50);
    const r = makeRes();
    await listingStatsHandler(post({ listingId: '999999' }), r);
    expect(r.state.status).toBe(429);
    expect(r.state.body.reason).toBe('user_daily');
  });
});

describe('/api/ext/amazon-enrich', () => {
  it('shares catalog/pricing facts per ASIN + marketplace and only fetches the missing ASINs', async () => {
    const r1 = makeRes();
    await amazonHandler(post({ asins: ['B000000001', 'B000000002'], marketplace: 'US' }), r1);
    expect(r1.state.body).toMatchObject({ available: true, items: { B000000001: { bsr: 100 } }, quota: { used: 1 } });

    store.setUser('u4', 'growth');
    const r2 = makeRes();
    await amazonHandler(post({ asins: ['B000000001', 'B000000002', 'B000000003'], marketplace: 'US' }, 'u4'), r2);
    expect(vi.mocked(fetchProductSignals).mock.calls[1][0].asins).toEqual(['B000000003']);
    expect(Object.keys(r2.state.body.items).sort()).toEqual(['B000000001', 'B000000002', 'B000000003']);

    const r3 = makeRes();
    await amazonHandler(post({ asins: ['B000000001', 'B000000003'], marketplace: 'US' }, 'u4'), r3);
    expect(fetchProductSignals).toHaveBeenCalledTimes(2);
    expect(r3.state.body).toMatchObject({ available: true, quota: { used: 1, limit: 500 } });
  });

  it('over the limit: 429; under the global brake cached ASINs are still served', async () => {
    store.setCount(USER, today(), 50);
    const r = makeRes();
    await amazonHandler(post({ asins: ['B000000009'], marketplace: 'US' }), r);
    expect(r.state.status).toBe(429);
    expect(r.state.body.reason).toBe('user_daily');

    store.reset();
    store.setUser(USER, 'starter');
    await amazonHandler(post({ asins: ['B000000001'], marketplace: 'US' }), makeRes());
    store.setCount(GLOBAL_USER_ID, budgetKey('amazon', istanbulDay().day), 16000);
    const r2 = makeRes();
    await amazonHandler(post({ asins: ['B000000001', 'B000000005'], marketplace: 'US' }), r2);
    expect(r2.state.status).toBe(200);
    expect(r2.state.body).toMatchObject({ available: true, partial: true, items: { B000000001: { bsr: 100 } } });
    const r3 = makeRes();
    await amazonHandler(post({ asins: ['B000000005'], marketplace: 'US' }), r3);
    expect(r3.state.status).toBe(429);
    expect(r3.state.body.reason).toBe('global_brake');
  });
});
