// Reconnect state for failing marketplace auth (lib/integrations/authFailures.ts): classifier, counter,
// flag/skip/clear, connectionStatus exposure, and the Shopify / Trendyol sync loops honouring it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = {
  id: string;
  userId: string;
  provider: string;
  accountId: string;
  consecutiveFailures: number;
  lastFailureAt: Date | null;
  lastError: string | null;
  needsReconnect: boolean;
  needsReconnectAt: Date | null;
};

const h = vi.hoisted(() => {
  const rows: any[] = [];
  const matches = (r: any, where: any) =>
    Object.entries(where || {}).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('gt' in (v as any)) return r[k] > (v as any).gt;
        return true;
      }
      return r[k] === v;
    });
  const byKey = (w: any) => {
    const k = w.userId_provider_accountId;
    return rows.find((r) => r.userId === k.userId && r.provider === k.provider && r.accountId === k.accountId);
  };
  const pick = (r: any, select?: any) => {
    if (!r) return null;
    if (!select) return { ...r };
    return Object.fromEntries(Object.keys(select).map((k) => [k, r[k]]));
  };
  const connectionAuthState = {
    findUnique: vi.fn(async ({ where, select }: any) => pick(byKey(where), select)),
    findMany: vi.fn(async ({ where, select }: any) => rows.filter((r) => matches(r, where)).map((r) => pick(r, select))),
    upsert: vi.fn(async ({ where, create, update, select }: any) => {
      let r = byKey(where);
      if (!r) {
        r = { id: `cas${rows.length + 1}`, needsReconnect: false, needsReconnectAt: null, ...create };
        rows.push(r);
      } else {
        for (const [k, v] of Object.entries(update)) {
          r[k] = v && typeof v === 'object' && 'increment' in (v as any) ? r[k] + (v as any).increment : v;
        }
      }
      return pick(r, select);
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return { count: hit.length };
    }),
  };
  return {
    rows,
    connectionAuthState,
    notify: vi.fn(async () => undefined),
    resolveNotification: vi.fn(async () => undefined),
    publishLive: vi.fn(),
    shopifyShop: { findMany: vi.fn(), update: vi.fn(async () => ({})) },
    credential: { findUnique: vi.fn() },
    getValidAccessToken: vi.fn(),
    getOrders: vi.fn(),
    fetchTrendyolOrders: vi.fn(),
    fetchCreatedOrders: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({
  default: { connectionAuthState: h.connectionAuthState, shopifyShop: h.shopifyShop, credential: h.credential },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/live/publish', () => ({ publishLive: h.publishLive }));
vi.mock('@/lib/notifications', () => ({
  notify: h.notify,
  resolveNotification: h.resolveNotification,
  notificationKeys: { reauth: (p: string, a: string) => `reauth:${p}:${a}` },
  NOTIFICATION_LINKS: { connections: '/ayarlar?tab=connections' },
  getOpenReauthFlags: vi.fn(async () => []),
}));
vi.mock('@/lib/config', () => ({ isShopifyEnabled: () => true, isTrendyolEnabled: () => true }));
vi.mock('@/lib/sync-status', () => ({
  startSync: vi.fn(async () => 'sync1'),
  updateSyncProgress: vi.fn(async () => undefined),
  completeSync: vi.fn(async () => undefined),
  cleanupStaleSyncs: vi.fn(async () => undefined),
}));
vi.mock('@/lib/orders/marketplaceOrderWrite', () => ({
  upsertMarketplaceOrder: vi.fn(async () => ({})),
  publishOrderWrites: vi.fn(),
}));
vi.mock('@/lib/integrations/shopifyClient', () => ({
  getValidAccessToken: h.getValidAccessToken,
  ShopifyClient: class {
    getOrders = h.getOrders;
    getProduct = vi.fn();
  },
}));
vi.mock('@/lib/mappers/shopify', () => ({ toOrder: vi.fn() }));
vi.mock('@/lib/integrations/trendyolClient', () => ({
  fetchTrendyolOrders: h.fetchTrendyolOrders,
  fetchCreatedOrders: h.fetchCreatedOrders,
}));
vi.mock('@/lib/mappers/trendyol', () => ({ toOrder: vi.fn(), mapTrendyolOrdersWithImages: vi.fn(async () => []) }));
vi.mock('@/lib/crypto/credentials', () => ({ decryptIfNeeded: (v: any) => v, encryptIfNeeded: (v: any) => v }));
vi.mock('@/lib/etsy/etsyToken', () => ({ isShopReauthBlocked: () => false }));

import {
  AUTH_FAILURE_THRESHOLD,
  isAuthFailure,
  shouldFlag,
  recordAuthFailure,
  recordAuthSuccess,
  isConnectionBlocked,
  clearConnectionAuthState,
  getReconnectFlags,
} from '@/lib/integrations/authFailures';
import { applyReconnectFlags, type ConnectionsMap } from '@/lib/integrations/connectionStatus';
import { syncShopifyRecentOrdersForUser } from '@/lib/sync/shopify';
import { syncTrendyolRecentOrdersForUser } from '@/lib/sync/trendyol';

const U = 'user1';
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  h.rows.length = 0;
  vi.clearAllMocks();
});

describe('isAuthFailure', () => {
  it.each([
    ['Token refresh failed: 401'],
    ['Shopify paginated GET /orders.json page 1 failed: 401 - {"errors":"[API] Invalid API key or access token"}'],
    ['Trendyol API 401: {"message":"Unauthorized"}'],
    ['Trendyol API 403: {"errors":[{"key":"supplier.not.authorized"}]}'],
    ['Amazon token refresh failed: 400 - {"error":"invalid_grant"}'],
    ['eBay token refresh failed: 400 - invalid_grant'],
  ])('counts %s', (msg) => {
    expect(isAuthFailure(new Error(msg))).toBe(true);
  });

  it('counts a numeric 401/403 status on the error object', () => {
    expect(isAuthFailure(Object.assign(new Error('nope'), { status: 401 }))).toBe(true);
    expect(isAuthFailure(Object.assign(new Error('nope'), { statusCode: 403 }))).toBe(true);
  });

  it.each([
    ['fetch failed'],
    ['ECONNRESET'],
    ['Trendyol API 500: Internal Server Error'],
    ['Trendyol API 503: upstream'],
    ['Shopify paginated GET /orders.json page 1 failed: 429 - Too Many Requests'],
    ['Token refresh failed: 502'],
    ['Amazon token refresh failed: 400 - {"error":"invalid_client"}'],
    ['Trendyol API 403: <!DOCTYPE html><title>Attention Required! | Cloudflare</title>'],
    ['Order 4011234 could not be saved'],
  ])('ignores %s', (msg) => {
    expect(isAuthFailure(new Error(msg))).toBe(false);
  });

  it('ignores empty input', () => {
    expect(isAuthFailure(null)).toBe(false);
    expect(isAuthFailure(undefined)).toBe(false);
  });
});

describe('failure counter', () => {
  const authErr = new Error('Token refresh failed: 401');

  it('threshold is 3', () => {
    expect(AUTH_FAILURE_THRESHOLD).toBe(3);
    expect(shouldFlag(2)).toBe(false);
    expect(shouldFlag(3)).toBe(true);
  });

  it('flags after 3 consecutive auth failures and notifies once', async () => {
    const a = await recordAuthFailure(U, 'shopify', 'shop.myshopify.com', authErr);
    const b = await recordAuthFailure(U, 'shopify', 'shop.myshopify.com', authErr);
    expect([a.consecutiveFailures, b.consecutiveFailures]).toEqual([1, 2]);
    expect(a.flagged || b.flagged).toBe(false);
    expect(await isConnectionBlocked(U, 'shopify', 'shop.myshopify.com')).toBe(false);

    const c = await recordAuthFailure(U, 'shopify', 'shop.myshopify.com', authErr);
    expect(c).toEqual({ counted: true, consecutiveFailures: 3, flagged: true });
    expect(await isConnectionBlocked(U, 'shopify', 'shop.myshopify.com')).toBe(true);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(
      U,
      expect.objectContaining({
        type: 'reauthRequired',
        titleKey: 'types.reauthRejected',
        params: { provider: 'Shopify', account: 'shop.myshopify.com' },
        dedupeKey: 'reauth:shopify:shop.myshopify.com',
        onlyIfNew: true,
        link: '/ayarlar?tab=connections',
      }),
    );
    await flush();
    expect(h.publishLive).toHaveBeenCalledWith(U, expect.objectContaining({ type: 'connection', kind: 'reauth_required', provider: 'shopify' }));

    // A 4th failure does not raise again.
    const d = await recordAuthFailure(U, 'shopify', 'shop.myshopify.com', authErr);
    expect(d.flagged).toBe(false);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('non-auth errors neither count nor reset', async () => {
    await recordAuthFailure(U, 'trendyol', '123', new Error('Trendyol API 401: x'));
    await recordAuthFailure(U, 'trendyol', '123', new Error('Trendyol API 500: x'));
    await recordAuthFailure(U, 'trendyol', '123', new Error('fetch failed'));
    expect(h.rows[0].consecutiveFailures).toBe(1);
    expect(await isConnectionBlocked(U, 'trendyol', '123')).toBe(false);
  });

  it('a success in between resets the streak', async () => {
    const e = new Error('Trendyol API 401: x');
    await recordAuthFailure(U, 'trendyol', '123', e);
    await recordAuthFailure(U, 'trendyol', '123', e);
    await recordAuthSuccess(U, 'trendyol', '123');
    expect(h.rows).toHaveLength(0);
    expect(h.resolveNotification).not.toHaveBeenCalled(); // was never flagged
    await recordAuthFailure(U, 'trendyol', '123', e);
    expect(await isConnectionBlocked(U, 'trendyol', '123')).toBe(false);
  });

  it('counts per connection (two shops are independent)', async () => {
    for (let i = 0; i < 3; i++) await recordAuthFailure(U, 'shopify', 'a.myshopify.com', authErr);
    await recordAuthFailure(U, 'shopify', 'b.myshopify.com', authErr);
    expect(await isConnectionBlocked(U, 'shopify', 'a.myshopify.com')).toBe(true);
    expect(await isConnectionBlocked(U, 'shopify', 'b.myshopify.com')).toBe(false);
    const flags = await getReconnectFlags(U);
    expect(Array.from(flags.get('shopify') ?? [])).toEqual(['a.myshopify.com']);
  });

  it('a successful auth clears the flag and resolves the notification', async () => {
    for (let i = 0; i < 3; i++) await recordAuthFailure(U, 'shopify', 's.myshopify.com', authErr);
    await recordAuthSuccess(U, 'shopify', 's.myshopify.com');
    expect(await isConnectionBlocked(U, 'shopify', 's.myshopify.com')).toBe(false);
    expect(h.resolveNotification).toHaveBeenCalledWith(U, 'reauth:shopify:s.myshopify.com');
  });

  it('reconnect / credential re-save clears every account of the provider', async () => {
    for (let i = 0; i < 3; i++) await recordAuthFailure(U, 'trendyol', '123', new Error('Trendyol API 401: x'));
    await recordAuthFailure(U, 'shopify', 'x.myshopify.com', authErr);
    await clearConnectionAuthState(U, 'trendyol');
    expect(await isConnectionBlocked(U, 'trendyol', '123')).toBe(false);
    expect(h.resolveNotification).toHaveBeenCalledWith(U, 'reauth:trendyol:123');
    expect(h.rows.map((r: Row) => r.provider)).toEqual(['shopify']);
  });

  it('never throws when the DB fails', async () => {
    h.connectionAuthState.findUnique.mockRejectedValueOnce(new Error('db down'));
    expect(await isConnectionBlocked(U, 'shopify', 'x')).toBe(false);
    h.connectionAuthState.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(recordAuthFailure(U, 'shopify', 'x', authErr)).resolves.toMatchObject({ counted: true, flagged: false });
  });
});

describe('connectionStatus.applyReconnectFlags', () => {
  const base = (): ConnectionsMap =>
    ({
      shopify: {
        connected: true,
        needsReauth: false,
        accounts: [
          { id: '1', name: 'A', externalId: 'a.myshopify.com', needsReauth: false },
          { id: '2', name: 'B', externalId: 'b.myshopify.com', needsReauth: false },
        ],
      },
      trendyol: { connected: true, needsReauth: false, accounts: [{ id: 'credential', name: 'Trendyol 123', externalId: '123', needsReauth: false }] },
      amazon: { connected: false, needsReauth: false, accounts: [] },
    }) as unknown as ConnectionsMap;

  it('marks only the flagged account and the provider entry as needing reauth', () => {
    const c = base();
    applyReconnectFlags(c, new Map([['shopify', new Set(['b.myshopify.com'])], ['trendyol', new Set(['123'])]]));
    expect(c.shopify.needsReauth).toBe(true);
    expect(c.shopify.reason).toBe('reauth_required');
    expect(c.shopify.accounts.map((a) => a.needsReauth)).toEqual([false, true]);
    expect(c.trendyol.needsReauth).toBe(true);
  });

  it("'' flags every account; disconnected providers and unknown ids are ignored", () => {
    const c = base();
    applyReconnectFlags(c, new Map([['shopify', new Set([''])], ['amazon', new Set([''])], ['trendyol', new Set(['999'])]]));
    expect(c.shopify.accounts.every((a) => a.needsReauth)).toBe(true);
    expect(c.amazon.needsReauth).toBe(false);
    expect(c.trendyol.needsReauth).toBe(false);
  });
});

describe('sync loops honour the reconnect state', () => {
  it('Shopify: 3 refresh 401s park the shop, the 4th run skips it, the healthy shop keeps syncing', async () => {
    h.shopifyShop.findMany.mockResolvedValue([
      { id: 'bad', shopDomain: 'bad.myshopify.com', lastOrderSyncAt: null },
      { id: 'ok', shopDomain: 'ok.myshopify.com', lastOrderSyncAt: null },
    ]);
    h.getValidAccessToken.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('Token refresh failed: 401');
      return 'tok';
    });
    h.getOrders.mockResolvedValue([]);

    for (let i = 0; i < 3; i++) await syncShopifyRecentOrdersForUser(U);
    expect(await isConnectionBlocked(U, 'shopify', 'bad.myshopify.com')).toBe(true);
    expect(h.notify).toHaveBeenCalledTimes(1);

    h.getValidAccessToken.mockClear();
    await syncShopifyRecentOrdersForUser(U);
    expect(h.getValidAccessToken).toHaveBeenCalledTimes(1);
    expect(h.getValidAccessToken).toHaveBeenCalledWith('ok');
  });

  it('Shopify: a 5xx never parks the shop', async () => {
    h.shopifyShop.findMany.mockResolvedValue([{ id: 's', shopDomain: 's.myshopify.com', lastOrderSyncAt: null }]);
    h.getValidAccessToken.mockResolvedValue('tok');
    h.getOrders.mockRejectedValue(new Error('Shopify paginated GET /orders.json page 1 failed: 503 - unavailable'));
    for (let i = 0; i < 4; i++) await syncShopifyRecentOrdersForUser(U);
    expect(await isConnectionBlocked(U, 'shopify', 's.myshopify.com')).toBe(false);
  });

  it('Trendyol: 3 rejected runs park it (no silent empty success); re-saving credentials clears it', async () => {
    h.credential.findUnique.mockResolvedValue({ trendyolApiKey: 'k', trendyolApiSecret: 's', trendyolSupplierId: '123' });
    h.fetchTrendyolOrders.mockRejectedValue(new Error('Trendyol API 401: Unauthorized'));

    for (let i = 0; i < 3; i++) await expect(syncTrendyolRecentOrdersForUser(U)).rejects.toThrow(/rejected the credentials/);
    expect(h.fetchCreatedOrders).not.toHaveBeenCalled(); // same creds: no pointless fallback
    expect(await isConnectionBlocked(U, 'trendyol', '123')).toBe(true);

    h.fetchTrendyolOrders.mockClear();
    await expect(syncTrendyolRecentOrdersForUser(U)).resolves.toBeNull();
    expect(h.fetchTrendyolOrders).not.toHaveBeenCalled();

    await clearConnectionAuthState(U, 'trendyol');
    h.fetchTrendyolOrders.mockResolvedValue([]);
    await expect(syncTrendyolRecentOrdersForUser(U)).resolves.toMatchObject({ processedOrders: 0 });
    expect(h.fetchTrendyolOrders).toHaveBeenCalledTimes(1);
  });

  it('Trendyol: a successful fetch resets an earlier failure streak', async () => {
    h.credential.findUnique.mockResolvedValue({ trendyolApiKey: 'k', trendyolApiSecret: 's', trendyolSupplierId: '123' });
    h.fetchTrendyolOrders.mockRejectedValueOnce(new Error('Trendyol API 401: x')).mockRejectedValueOnce(new Error('Trendyol API 401: x'));
    await expect(syncTrendyolRecentOrdersForUser(U)).rejects.toThrow();
    await expect(syncTrendyolRecentOrdersForUser(U)).rejects.toThrow();
    h.fetchTrendyolOrders.mockResolvedValue([]);
    await syncTrendyolRecentOrdersForUser(U);
    expect(h.rows).toHaveLength(0);
  });
});
