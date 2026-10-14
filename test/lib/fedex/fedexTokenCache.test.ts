import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => {
  const post = vi.fn();
  return { default: { post }, post };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import axios from 'axios';
import {
  getFedExOAuthToken,
  invalidateFedExToken,
  fedExTokenCacheKey,
  FEDEX_API_BASE_URL,
  FEDEX_TOKEN_CACHE_MAX_ENTRIES,
  __resetFedExTokenCache,
  __fedExTokenCacheSize,
  __fedExTokenCacheKeys,
} from '@/lib/fedex/fedex.tokenCache';

const post = (axios as any).post as ReturnType<typeof vi.fn>;

function tokenFor(clientId: string) {
  return `tok-${clientId}`;
}

beforeEach(() => {
  __resetFedExTokenCache();
  post.mockReset();
  post.mockImplementation(async (_url: string, params: URLSearchParams) => ({
    status: 200,
    data: { access_token: tokenFor(params.get('client_id')!), expires_in: 3600 },
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

const tenantA = { fedexApiKey: 'key-A', fedexApiSecret: 'secret-A' };
const tenantB = { fedexApiKey: 'key-B', fedexApiSecret: 'secret-B' };

describe('FedEx OAuth token cache', () => {
  it('never reuses one tenant\'s token for another tenant', async () => {
    expect(await getFedExOAuthToken(tenantA)).toBe('tok-key-A');
    expect(await getFedExOAuthToken(tenantB)).toBe('tok-key-B');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('reuses the token for the same credentials until expiry', async () => {
    await getFedExOAuthToken(tenantA);
    await getFedExOAuthToken(tenantA);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not serve a cached token when the key matches but the secret differs', async () => {
    await getFedExOAuthToken(tenantA);
    await getFedExOAuthToken({ fedexApiKey: 'key-A', fedexApiSecret: 'wrong-secret' });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('separates tokens by base URL (environment)', async () => {
    await getFedExOAuthToken(tenantA, FEDEX_API_BASE_URL);
    await getFedExOAuthToken(tenantA, 'https://apis-sandbox.fedex.com');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0]).toBe('https://apis-sandbox.fedex.com/oauth/token');
  });

  it('keys the cache by a sha256 hash, never by raw secrets', async () => {
    await getFedExOAuthToken(tenantA);
    const keys = __fedExTokenCacheKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(keys[0]).not.toContain('key-A');
    expect(keys[0]).not.toContain('secret-A');
    expect(keys[0]).toBe(fedExTokenCacheKey(FEDEX_API_BASE_URL, 'key-A', 'secret-A'));
  });

  it('refetches after the token expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await getFedExOAuthToken(tenantA);
    vi.setSystemTime(new Date('2026-01-01T00:56:00Z')); // past 3600s - 300s skew
    await getFedExOAuthToken(tenantA);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent requests for the same credentials', async () => {
    const [a, b] = await Promise.all([getFedExOAuthToken(tenantA), getFedExOAuthToken(tenantA)]);
    expect(a).toBe(b);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('invalidates a token on demand', async () => {
    await getFedExOAuthToken(tenantA);
    invalidateFedExToken(tenantA);
    await getFedExOAuthToken(tenantA);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('bounds the cache size', async () => {
    for (let i = 0; i < FEDEX_TOKEN_CACHE_MAX_ENTRIES + 25; i++) {
      await getFedExOAuthToken({ fedexApiKey: `k${i}`, fedexApiSecret: `s${i}` });
    }
    expect(__fedExTokenCacheSize()).toBeLessThanOrEqual(FEDEX_TOKEN_CACHE_MAX_ENTRIES);
  });

  it('does not cache a failed token request', async () => {
    post.mockRejectedValueOnce({ message: 'boom', response: { data: { errors: [{ message: 'bad creds' }] } } });
    await expect(getFedExOAuthToken(tenantA)).rejects.toThrow('bad creds');
    expect(await getFedExOAuthToken(tenantA)).toBe('tok-key-A');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('rejects missing credentials without calling FedEx', async () => {
    await expect(getFedExOAuthToken({ fedexApiKey: '', fedexApiSecret: '' })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});
