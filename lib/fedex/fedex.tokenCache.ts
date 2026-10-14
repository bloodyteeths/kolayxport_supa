// @ts-ignore
import axios from 'axios';
import { createHash } from 'crypto';
import { logger } from '../logger';

/**
 * Per-tenant FedEx OAuth token cache.
 *
 * FedEx client_credentials tokens are bound to the API key/secret that issued them,
 * so a token obtained for one user's credentials must never be reused for another
 * user's shipment. Entries are keyed by sha256(baseUrl + clientId + clientSecret) —
 * raw secrets are never stored as map keys. Including the secret means a tenant who
 * enters someone else's API key with a wrong secret cannot hit that tenant's token.
 */

export const FEDEX_API_BASE_URL = 'https://apis.fedex.com';

/** Hard cap on cached tokens; expired entries are evicted first, then the oldest. */
export const FEDEX_TOKEN_CACHE_MAX_ENTRIES = 500;
/** Refresh this long before FedEx's reported expiry. */
const EXPIRY_SKEW_SECONDS = 300;

interface FedExAuthToken {
  accessToken: string;
  expiresAt: number;
}

export interface FedExOAuthCredentials {
  fedexApiKey: string;
  fedexApiSecret: string;
}

const tokenCache = new Map<string, FedExAuthToken>();
const inFlight = new Map<string, Promise<string>>();

export function fedExTokenCacheKey(baseUrl: string, apiKey: string, apiSecret: string): string {
  return createHash('sha256')
    .update(`${baseUrl}\u0000${apiKey}\u0000${apiSecret}`)
    .digest('hex');
}

function evictIfNeeded(now: number) {
  for (const [key, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(key);
  }
  // Map iterates in insertion order, so the first keys are the oldest.
  while (tokenCache.size >= FEDEX_TOKEN_CACHE_MAX_ENTRIES) {
    const oldest = tokenCache.keys().next().value;
    if (oldest === undefined) break;
    tokenCache.delete(oldest);
  }
}

async function requestToken(
  baseUrl: string,
  creds: FedExOAuthCredentials,
  cacheKey: string,
): Promise<string> {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', creds.fedexApiKey);
  params.append('client_secret', creds.fedexApiSecret);

  try {
    const response = await axios.post(`${baseUrl}/oauth/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (response.status === 200 && response.data?.access_token) {
      const expiresIn = Number(response.data.expires_in) || 3600;
      const now = Date.now();
      const entry: FedExAuthToken = {
        accessToken: response.data.access_token,
        expiresAt: now + Math.max(expiresIn - EXPIRY_SKEW_SECONDS, 0) * 1000,
      };
      evictIfNeeded(now);
      tokenCache.delete(cacheKey);
      tokenCache.set(cacheKey, entry);
      logger.info('[FedEx Service] OAuth token obtained/refreshed.');
      return entry.accessToken;
    }
    logger.error('[FedEx Service] FedEx OAuth Error Response:', new Error(JSON.stringify(response.data)));
    throw new Error(`FedEx OAuth failed: ${response.data?.errors?.[0]?.message || 'Unknown OAuth error'}`);
  } catch (error: any) {
    if (typeof error?.message === 'string' && error.message.startsWith('FedEx OAuth failed:')) throw error;
    const errorData = error?.response?.data;
    logger.error('[FedEx Service] FedEx OAuth Exception:', new Error(JSON.stringify({ errorData, message: error?.message })));
    throw new Error(`FedEx OAuth exception: ${errorData?.errors?.[0]?.message || error?.message}`);
  }
}

/**
 * Returns a FedEx OAuth access token for exactly these credentials, reusing a cached
 * one only when it was issued for the same base URL + key + secret.
 * Concurrent calls for the same credentials share one token request.
 */
export async function getFedExOAuthToken(
  creds: FedExOAuthCredentials,
  baseUrl: string = FEDEX_API_BASE_URL,
): Promise<string> {
  if (!creds?.fedexApiKey || !creds?.fedexApiSecret) {
    throw new Error('FedEx OAuth failed: missing API key or secret');
  }
  const cacheKey = fedExTokenCacheKey(baseUrl, creds.fedexApiKey, creds.fedexApiSecret);

  const cached = tokenCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.accessToken;
    tokenCache.delete(cacheKey);
  }

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const p = requestToken(baseUrl, creds, cacheKey).finally(() => {
    inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, p);
  return p;
}

/** Drops a cached token (e.g. after FedEx rejects it with 401). */
export function invalidateFedExToken(creds: FedExOAuthCredentials, baseUrl: string = FEDEX_API_BASE_URL) {
  if (!creds?.fedexApiKey || !creds?.fedexApiSecret) return;
  tokenCache.delete(fedExTokenCacheKey(baseUrl, creds.fedexApiKey, creds.fedexApiSecret));
}

/** Test helpers. */
export function __resetFedExTokenCache() {
  tokenCache.clear();
  inFlight.clear();
}
export function __fedExTokenCacheSize() {
  return tokenCache.size;
}
export function __fedExTokenCacheKeys(): string[] {
  return Array.from(tokenCache.keys());
}
