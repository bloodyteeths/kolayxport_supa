import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const nodeFetchMock = vi.fn();
vi.mock('node-fetch', () => ({ default: (...args: any[]) => nodeFetchMock(...args) }));

import { mngTokenCacheKey, getMngToken, clearMngTokenCache } from '../../lib/mng/mng.service';
import { getProductImages, imageCache, imageCacheKey } from '../../lib/integrations/trendyolClient';
import {
  fetchCatalogItems,
  isCatalogAccessDenied,
  catalogCooldownKey,
  resetCatalogAccessDenied,
} from '../../lib/integrations/amazonClient';

describe('MNG token cache key', () => {
  const base = { appId: 'app', appSecret: 's3cret', customerNumber: '42', customerPassword: 'pw', environment: 'test' as const };

  it('differs by environment and by secret, and never contains raw secrets', () => {
    const k = mngTokenCacheKey(base);
    expect(k).not.toContain('s3cret');
    expect(k).not.toContain('pw:');
    expect(mngTokenCacheKey({ ...base, environment: 'production' })).not.toBe(k);
    expect(mngTokenCacheKey({ ...base, customerPassword: 'pw2' })).not.toBe(k);
    expect(mngTokenCacheKey({ ...base, appSecret: 'other' })).not.toBe(k);
    expect(mngTokenCacheKey({ ...base })).toBe(k);
  });

  it('does not reuse a test token for production', async () => {
    clearMngTokenCache();
    let n = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ token: `tok${++n}` }), { status: 200 }) as any);
    try {
      expect(await getMngToken(base)).toBe('tok1');
      expect(await getMngToken(base)).toBe('tok1');
      expect(await getMngToken({ ...base, environment: 'production' })).toBe('tok2');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
      clearMngTokenCache();
    }
  });
});

describe('Trendyol image cache', () => {
  beforeEach(() => { imageCache.clear(); nodeFetchMock.mockReset(); });

  it('does not serve one seller\'s cached image to another seller with the same barcode', async () => {
    nodeFetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({ content: [{ barcode: 'B1', images: [{ url: url.includes('/sellers/111/') ? 'img-a' : 'img-b' }] }] }),
    }));
    const a = await getProductImages(['B1'], { supplierId: '111', apiKey: 'k', apiSecret: 's' });
    const b = await getProductImages(['B1'], { supplierId: '222', apiKey: 'k', apiSecret: 's' });
    expect(a.B1).toBe('img-a');
    expect(b.B1).toBe('img-b');
    expect(nodeFetchMock).toHaveBeenCalledTimes(2);
    expect(imageCache.has(imageCacheKey('111', 'B1'))).toBe(true);
    expect(imageCache.has('B1')).toBe(false);

    // Cached hit for the same seller makes no new request.
    await getProductImages(['B1'], { supplierId: '111', apiKey: 'k', apiSecret: 's' });
    expect(nodeFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Amazon catalog access-denied cooldown', () => {
  beforeEach(() => resetCatalogAccessDenied());
  afterEach(() => vi.restoreAllMocks());

  it('is per seller: one seller\'s 403 does not block another', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      const tok = init?.headers?.['x-amz-access-token'];
      if (tok === 'tok-a') return new Response('Unauthorized', { status: 403 }) as any;
      return new Response(JSON.stringify({ items: [{ asin: 'A1', summaries: [{ itemName: 'T' }] }] }), { status: 200 }) as any;
    });

    const a = await fetchCatalogItems(['A1'], 'M', 'tok-a', 'eu', 'user-a');
    expect(a.size).toBe(0);
    expect(isCatalogAccessDenied(catalogCooldownKey('tok-a', 'user-a'))).toBe(true);
    expect(isCatalogAccessDenied(catalogCooldownKey('tok-b', 'user-b'))).toBe(false);

    const b = await fetchCatalogItems(['A1'], 'M', 'tok-b', 'eu', 'user-b');
    expect(b.get('A1')?.title).toBe('T');

    // Seller A stays in cooldown: no further request.
    const callsBefore = fetchSpy.mock.calls.length;
    await fetchCatalogItems(['A1'], 'M', 'tok-a', 'eu', 'user-a');
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('falls back to a hashed token key, never the raw token', () => {
    const k = catalogCooldownKey('super-secret-token');
    expect(k).not.toContain('super-secret-token');
    expect(k.startsWith('token:')).toBe(true);
  });
});
