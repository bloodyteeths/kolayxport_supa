import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- etsyToken (lease) mocks -------------------------------------------------
const shopFindFirst = vi.fn(async (_a?: any) => null as any);
const shopUpdateMany = vi.fn(async (_a?: any) => ({ count: 1 }));
const credUpdateMany = vi.fn(async (_a?: any) => ({ count: 1 }));
const credFindFirst = vi.fn(async (_a?: any) => null as any);
const queryRaw = vi.fn(async (..._a: any[]) => [] as any[]);
const notify = vi.fn(async (..._a: any[]) => undefined);

vi.mock('@/lib/prisma', () => ({
  default: {
    etsyShop: { findFirst: (a: any) => shopFindFirst(a), updateMany: (a: any) => shopUpdateMany(a) },
    credential: { findFirst: (a: any) => credFindFirst(a), updateMany: (a: any) => credUpdateMany(a) },
    $queryRaw: (...a: any[]) => queryRaw(...a),
  },
}));
vi.mock('@/lib/crypto/credentials', () => ({
  decryptIfNeeded: (v: any) => v,
  encryptIfNeeded: (v: any) => v,
}));
vi.mock('@/lib/notifications', () => ({
  notify: (...a: any[]) => notify(...a),
  resolveNotification: async () => undefined,
  notificationKeys: { reauth: (p: string, id: string) => `reauth:${p}:${id}` },
  NOTIFICATION_LINKS: { connections: '/ayarlar' },
}));
vi.mock('@/lib/logger', () => ({ logger: { info() {}, warn() {}, error() {}, debug() {} } }));
vi.mock('@/lib/live/publish', () => ({ publishLive: () => undefined }));
vi.mock('@/lib/etsy/webhooks/queueOps', () => ({ requeueBlockedEtsyEvents: async () => 0 }));

import { getEtsyAccessToken, isShopReauthBlocked } from '@/lib/etsy/etsyToken';
import { EtsyClient } from '@/lib/integrations/etsyClient';
import { __resetEtsyBudget } from '@/lib/etsy/rateBudget';

const HOUR = 60 * 60_000;
const shopRow = (over: Partial<any> = {}) => ({
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  tokenExpiresAt: new Date(Date.now() - 1_000),
  userId: 'u1',
  needsReauth: false,
  needsReauthAt: null,
  ...over,
});

function tokenPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/oauth/token'));
}

beforeEach(() => {
  __resetEtsyBudget();
  [shopFindFirst, shopUpdateMany, credUpdateMany, credFindFirst, queryRaw, notify].forEach((m) => m.mockReset());
  shopUpdateMany.mockResolvedValue({ count: 1 });
  credUpdateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getEtsyAccessToken (lease)', () => {
  it('returns the stored token without any POST when it is fresh', async () => {
    shopFindFirst.mockResolvedValue(shopRow({ tokenExpiresAt: new Date(Date.now() + HOUR) }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getEtsyAccessToken('s1', 'u1')).toBe('old-access');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with the lease: one 15 s POST, tokens persisted immediately, needsReauth cleared', async () => {
    shopFindFirst.mockResolvedValue(shopRow());
    queryRaw.mockResolvedValueOnce([{ shopId: 's1' }]); // lease acquired
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getEtsyAccessToken('s1', 'u1')).toBe('new-access');
    expect(tokenPosts(fetchMock)).toHaveLength(1);
    const upd = shopUpdateMany.mock.calls.find(([a]) => a.data?.accessToken === 'new-access')?.[0];
    expect(upd.data).toMatchObject({ refreshToken: 'new-refresh', needsReauth: false });
    expect(credUpdateMany.mock.calls[0][0]).toMatchObject({ where: { etsyShopId: 's1', userId: 'u1' } });
  });

  it('without the lease: waits for the other refresher and makes no POST', async () => {
    shopFindFirst
      .mockResolvedValueOnce(shopRow()) // initial read: expired
      .mockResolvedValueOnce(shopRow({ accessToken: 'their-access', tokenExpiresAt: new Date(Date.now() + HOUR) }));
    queryRaw.mockResolvedValueOnce([]); // lease held elsewhere
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getEtsyAccessToken('s1', 'u1')).toBe('their-access');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalid_grant with an unchanged refresh token flags needsReauth and notifies', async () => {
    shopFindFirst.mockResolvedValue(shopRow());
    queryRaw.mockResolvedValueOnce([{ shopId: 's1' }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })));
    await expect(getEtsyAccessToken('s1', 'u1')).rejects.toMatchObject({ code: 'ETSY_REAUTH_REQUIRED' });
    const flag = shopUpdateMany.mock.calls.find(([a]) => a.data?.needsReauth === true)?.[0];
    expect(flag.where).toMatchObject({ shopId: 's1', refreshToken: 'old-refresh' });
    expect(notify).toHaveBeenCalled();
  });

  it('invalid_grant after a concurrent reconnect does NOT set needsReauth', async () => {
    shopFindFirst
      .mockResolvedValueOnce(shopRow()) // initial
      .mockResolvedValueOnce(shopRow()) // under lease
      .mockResolvedValueOnce(shopRow({ refreshToken: 'reconnected-refresh', accessToken: 'reconnected-access', tokenExpiresAt: new Date(Date.now() + HOUR) })) // re-read after invalid_grant
      .mockResolvedValue(shopRow({ refreshToken: 'reconnected-refresh', accessToken: 'reconnected-access', tokenExpiresAt: new Date(Date.now() + HOUR) }));
    queryRaw.mockResolvedValueOnce([{ shopId: 's1' }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })));
    expect(await getEtsyAccessToken('s1', 'u1')).toBe('reconnected-access');
    expect(shopUpdateMany.mock.calls.some(([a]) => a.data?.needsReauth === true)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('a parked shop (needsReauth) fails fast without a POST', async () => {
    shopFindFirst.mockResolvedValue(shopRow({ needsReauth: true, needsReauthAt: new Date() }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getEtsyAccessToken('s1', 'u1')).rejects.toMatchObject({ code: 'ETSY_REAUTH_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forceRefresh is skipped when the stored token is not the rejected one', async () => {
    shopFindFirst.mockResolvedValue(shopRow({ accessToken: 'newer', tokenExpiresAt: new Date(Date.now() + 50 * 60_000) }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getEtsyAccessToken('s1', 'u1', { forceRefresh: true, rejectedToken: 'older' })).toBe('newer');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isShopReauthBlocked clears itself only once a token ISSUED after the flag exists (reconnect)', () => {
    const flaggedAt = new Date('2026-10-15T10:00:00Z');
    expect(isShopReauthBlocked({ needsReauth: true, needsReauthAt: flaggedAt, tokenExpiresAt: new Date('2026-10-15T09:59:00Z') })).toBe(true);
    // Forced refresh on a 401 while the dead token still had 40 min of nominal life: still blocked.
    expect(isShopReauthBlocked({ needsReauth: true, needsReauthAt: flaggedAt, tokenExpiresAt: new Date('2026-10-15T10:40:00Z') })).toBe(true);
    expect(isShopReauthBlocked({ needsReauth: true, needsReauthAt: flaggedAt, tokenExpiresAt: new Date('2026-10-15T11:30:00Z') })).toBe(false);
    expect(isShopReauthBlocked({ needsReauth: false })).toBe(false);
  });

  it('forced refresh -> invalid_grant expires the dead token; the next call stays blocked (no flap, no POST, no clear)', async () => {
    const live = shopRow({ accessToken: 'dead', tokenExpiresAt: new Date(Date.now() + 40 * 60_000) }); // issued 20 min ago
    shopFindFirst.mockImplementation(async () => ({ ...live }));
    shopUpdateMany.mockImplementation(async (a: any) => {
      if (a.data?.needsReauth === true) Object.assign(live, a.data);
      return { count: 1 };
    });
    queryRaw.mockResolvedValueOnce([{ shopId: 's1' }]);
    const fetchMock = vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getEtsyAccessToken('s1', 'u1', { forceRefresh: true, rejectedToken: 'dead' })).rejects.toMatchObject({ code: 'ETSY_REAUTH_REQUIRED' });
    const flag = shopUpdateMany.mock.calls.find(([a]) => a.data?.needsReauth === true)?.[0];
    expect(flag.data.tokenExpiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(tokenPosts(fetchMock)).toHaveLength(1);

    // Next ordinary call: refuses the dead token, does not clear the flag or POST again.
    await expect(getEtsyAccessToken('s1', 'u1')).rejects.toMatchObject({ code: 'ETSY_REAUTH_REQUIRED' });
    expect(shopUpdateMany.mock.calls.some(([a]) => a.data?.needsReauth === false)).toBe(false);
    expect(tokenPosts(fetchMock)).toHaveLength(1);
  });

  it('a flagged shop never hands out its old (unexpired) access token', async () => {
    shopFindFirst.mockResolvedValue(shopRow({
      needsReauth: true,
      needsReauthAt: new Date(),
      tokenExpiresAt: new Date(Date.now() + 40 * 60_000),
    }));
    vi.stubGlobal('fetch', vi.fn());
    await expect(getEtsyAccessToken('s1', 'u1')).rejects.toMatchObject({ code: 'ETSY_REAUTH_REQUIRED' });
    expect(shopUpdateMany).not.toHaveBeenCalled();
  });
});

describe('EtsyClient', () => {
  it('never POSTs to the token endpoint itself; uses the shared token helper', async () => {
    shopFindFirst.mockResolvedValue(shopRow({ accessToken: 'db-token', tokenExpiresAt: new Date(Date.now() + HOUR) }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ count: 0, results: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new EtsyClient({ accessToken: 'ctor-token', refreshToken: 'r', shopId: 's1', userId: 'u1', tokenExpiresAt: new Date(0) });
    await client.getReceipts({ limit: 10 });
    expect(tokenPosts(fetchMock)).toHaveLength(0);
    const [, init] = fetchMock.mock.calls[0] as any[];
    expect(init.headers.Authorization).toBe('Bearer db-token');
  });

  it('on 401 invalid_token forces one refresh (with the rejected token) and retries once', async () => {
    shopFindFirst
      .mockResolvedValueOnce(shopRow({ accessToken: 'stale', tokenExpiresAt: new Date(Date.now() + 50 * 60_000) })) // first currentToken
      .mockResolvedValueOnce(shopRow({ accessToken: 'stale', tokenExpiresAt: new Date(Date.now() - 10 * 60_000 + HOUR - HOUR) })) // force path: initial read
      .mockResolvedValueOnce(shopRow({ accessToken: 'stale', tokenExpiresAt: new Date(Date.now() - 10 * 60_000) })); // under lease
    queryRaw.mockResolvedValueOnce([{ shopId: 's1' }]);
    const fetchMock = vi.fn(async (url: any) => {
      if (String(url).includes('/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }), { status: 200 });
      }
      const calls = fetchMock.mock.calls.filter(([u]) => !String(u).includes('/oauth/token')).length;
      return calls === 1
        ? new Response('{"error":"invalid_token"}', { status: 401 })
        : new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new EtsyClient({ accessToken: 'ctor', shopId: 's1', userId: 'u1' });
    const out = await client.getReceipts({});
    expect(out).toEqual({ results: [] });
    expect(tokenPosts(fetchMock)).toHaveLength(1);
    const apiCalls = fetchMock.mock.calls.filter(([u]) => !String(u).includes('/oauth/token')) as any[];
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls[1][1].headers.Authorization).toBe('Bearer fresh');
  });

  it('a 401 that is not invalid_token is returned without refreshing', async () => {
    shopFindFirst.mockResolvedValue(shopRow({ accessToken: 'tok', tokenExpiresAt: new Date(Date.now() + HOUR) }));
    const fetchMock = vi.fn(async () => new Response('{"error":"insufficient_scope"}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new EtsyClient({ accessToken: 'ctor', shopId: 's1' });
    await expect(client.getReceipts({})).rejects.toThrow(/401/);
    expect(tokenPosts(fetchMock)).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the constructor token when no shop/credential row exists', async () => {
    shopFindFirst.mockResolvedValue(null);
    credFindFirst.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new EtsyClient({ accessToken: 'ctor', shopId: 's1' });
    expect(await client.validateCredentials()).toBe(true);
    expect((fetchMock.mock.calls[0] as any[])[1].headers.Authorization).toBe('Bearer ctor');
  });
});
