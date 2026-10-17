// /api/clawd/ebay-research and /api/clawd/ebay: the research quota applies ONLY to calls
// from the extension (X-KX-Client: ext/<version>). The web app's research hub is unchanged.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextApiRequest } from 'next';

const USER = 'user_ebay';

vi.mock('@/lib/prisma', async () => ({ default: (await import('./fakeResearchStore')).fakePrisma }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth', () => ({ getAuthUser: vi.fn(async () => ({ id: USER })) }));
vi.mock('@/lib/security/internalApiKey', () => ({ hasValidInternalApiKeyHeader: vi.fn(() => false) }));
vi.mock('@/lib/integrations/ebayClient', () => ({
  getEbayTokenFor: vi.fn(async () => ({ token: 'app-token' })),
  getApplicationToken: vi.fn(async () => 'app-token'),
  getUserAccessToken: vi.fn(async () => 'user-token'),
}));
vi.mock('@/lib/integrations/ebayRateLimiter', () => ({
  callEbayRateLimited: vi.fn(async (url: string) => {
    if (url.includes('/item_summary/search')) {
      return {
        total: 2,
        itemSummaries: [
          { title: 'Turkish towel a', price: { value: '20.00', currency: 'USD' }, legacyItemId: '111', seller: { username: 's1' } },
          { title: 'Turkish towel b', price: { value: '30.00', currency: 'USD' }, legacyItemId: '222', seller: { username: 's2' } },
        ],
      };
    }
    return { title: 'Item', price: { value: '25.00', currency: 'USD' }, estimatedAvailabilities: [{ estimatedSoldQuantity: 4 }] };
  }),
}));

import { store, makeRes } from './fakeResearchStore';
import { quotaKey, istanbulDay } from '@/lib/ext/researchQuota';
import researchHandler from '@/pages/api/clawd/ebay-research';
import ebayHandler from '@/pages/api/clawd/ebay';
import { callEbayRateLimited } from '@/lib/integrations/ebayRateLimiter';

const EXT = { 'x-kx-client': 'ext/9.7.1', 'x-kx-page-view': 'pvtest0000001' };

function req(query: Record<string, string>, headers: Record<string, string> = {}): NextApiRequest {
  return { method: 'GET', headers, query, body: {} } as unknown as NextApiRequest;
}

const today = () => quotaKey(istanbulDay().day);

beforeEach(() => {
  store.reset();
  store.setUser(USER, 'starter');
  vi.mocked(callEbayRateLimited).mockClear();
});

describe('/api/clawd/ebay-research product_database', () => {
  const q = { action: 'product_database', q: 'Turkish Towel', limit: '50', sort: 'bestMatch', marketplace_id: 'EBAY_US' };

  it('extension call: charged once, then served from the shared cache (no eBay calls)', async () => {
    const r1 = makeRes();
    await researchHandler(req(q, EXT), r1);
    expect(r1.state.status).toBe(200);
    expect(r1.state.body.items).toHaveLength(2);
    expect(r1.state.body.quota).toMatchObject({ used: 1, limit: 150 });
    const calls = vi.mocked(callEbayRateLimited).mock.calls.length;
    expect(calls).toBe(3); // 1 search + 2 item details

    store.setUser('other', 'growth');
    const { getAuthUser } = await import('@/lib/auth');
    vi.mocked(getAuthUser).mockResolvedValueOnce({ id: 'other' } as any);
    const r2 = makeRes();
    await researchHandler(req({ ...q, q: '  turkish   towel ' }, { 'x-kx-client': 'ext/9.7.1' }), r2);
    expect(r2.state.status).toBe(200);
    expect(r2.state.body.items).toHaveLength(2);
    expect(vi.mocked(callEbayRateLimited).mock.calls.length).toBe(calls);
    expect(store.count('other', today())).toBe(0);
  });

  it('extension call over the daily limit: 429 research_limit and no eBay call', async () => {
    store.setCount(USER, today(), 150);
    const r = makeRes();
    await researchHandler(req(q, EXT), r);
    expect(r.state.status).toBe(429);
    expect(r.state.body).toMatchObject({ error: 'research_limit', reason: 'user_daily', limit: 150, used: 150, upgradeUrl: 'https://kolayxport.com/plan' });
    expect(callEbayRateLimited).not.toHaveBeenCalled();
  });

  it('web-app call (no X-KX-Client): unchanged, never limited, never counted', async () => {
    store.setCount(USER, today(), 150);
    const before = store.snapshot();
    const r = makeRes();
    await researchHandler(req(q), r);
    expect(r.state.status).toBe(200);
    expect(r.state.body.quota).toBeUndefined();
    expect(callEbayRateLimited).toHaveBeenCalled();
    expect(store.snapshot()).toBe(before);
  });
});

describe('/api/clawd/ebay get_item_details', () => {
  const q = { action: 'get_item_details', legacy_item_id: '1234567890', marketplace_id: 'EBAY_US' };

  it('extension call is quota-wrapped and shared for 24 h', async () => {
    const r1 = makeRes();
    await ebayHandler(req(q, EXT), r1);
    expect(r1.state.status).toBe(200);
    expect(r1.state.body).toMatchObject({ title: 'Item', quota: { used: 1 } });
    const r2 = makeRes();
    await ebayHandler(req(q, EXT), r2);
    expect(r2.state.body.title).toBe('Item');
    expect(callEbayRateLimited).toHaveBeenCalledTimes(1);
  });

  it('extension call over the limit: 429; web call: unchanged', async () => {
    store.setCount(USER, today(), 150);
    const r1 = makeRes();
    await ebayHandler(req(q, EXT), r1);
    expect(r1.state.status).toBe(429);
    const r2 = makeRes();
    await ebayHandler(req(q), r2);
    expect(r2.state.status).toBe(200);
    expect(r2.state.body.quota).toBeUndefined();
  });

  it('a missing parameter is a 400 and refunds the lookup', async () => {
    const r = makeRes();
    await ebayHandler(req({ action: 'get_item_details' }, EXT), r);
    expect(r.state.status).toBe(400);
    expect(store.count(USER, today())).toBe(0);
  });
});
