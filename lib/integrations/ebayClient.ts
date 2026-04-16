import { logger } from '../logger';
import prisma from '@/lib/prisma';

/**
 * Thrown when the user has not connected their eBay account (no OAuth credential on file).
 * Callers that want a tenant-scoped token but can tolerate shared-app-token fallback should
 * use `getEbayTokenFor(userId)` instead of catching this.
 */
export class EbayNotConnectedError extends Error {
  code = 'NO_EBAY_CONNECTION' as const;
  constructor(message = 'eBay not connected. Please connect your eBay account in settings.') {
    super(message);
    this.name = 'EbayNotConnectedError';
  }
}

export interface EbayCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

export interface EbayTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_API_BASE = 'https://api.ebay.com';

/**
 * Get Base64-encoded Basic auth string for eBay token requests.
 * Uses EBAY_CLIENT_ID:EBAY_CERT_ID
 */
function getBasicAuthHeader(): string {
  const clientId = (process.env.EBAY_CLIENT_ID || '').trim();
  const certId = (process.env.EBAY_CERT_ID || '').trim();
  if (!clientId || !certId) {
    throw new Error('EBAY_CLIENT_ID and EBAY_CERT_ID environment variables are required');
  }
  return `Basic ${Buffer.from(`${clientId}:${certId}`).toString('base64')}`;
}

/**
 * Get an Application Token (Client Credentials grant).
 * Used for public APIs like taxonomy and browse that don't need user consent.
 */
export async function getApplicationToken(): Promise<string> {
  logger.info('Requesting eBay application token (Client Credentials)');

  const response = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': getBasicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('eBay application token request failed', undefined, {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`eBay application token failed: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as EbayTokenResponse;
  logger.info('eBay application token obtained', {
    expiresIn: data.expires_in,
  });
  return data.access_token;
}

/**
 * Exchange an authorization code for user tokens (Authorization Code grant).
 */
export async function getUserToken(authCode: string): Promise<EbayTokenResponse> {
  const redirectUri = process.env.EBAY_RU_NAME || 'Tamsar__Inc.-TamsarIn-kolayx-fejubx';

  logger.info('Exchanging eBay authorization code for user token');

  const response = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': getBasicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: decodeURIComponent(authCode),
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('eBay user token exchange failed', undefined, {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`eBay token exchange failed: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as EbayTokenResponse;
  logger.info('eBay user token obtained', {
    expiresIn: data.expires_in,
    hasRefreshToken: !!data.refresh_token,
  });
  return data;
}

/**
 * Refresh a user token using a refresh token.
 */
export async function refreshUserToken(refreshToken: string): Promise<EbayTokenResponse> {
  logger.info('Refreshing eBay user token');

  const scopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.marketing',
    'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.finances',
  ].join(' ');

  const response = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': getBasicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: scopes,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('eBay token refresh failed', undefined, {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`eBay token refresh failed: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as EbayTokenResponse;
  logger.info('eBay user token refreshed', {
    expiresIn: data.expires_in,
  });
  return data;
}

/**
 * Generic eBay REST API caller with error handling.
 */
export async function callEbayAPI(
  endpoint: string,
  token: string,
  options: RequestInit = {}
): Promise<any> {
  const url = endpoint.startsWith('http') ? endpoint : `${EBAY_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Language': 'en-US',
      'Content-Language': 'en-US',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`eBay API error: ${response.status} - ${errorText}`);
    logger.error('eBay API call failed', error, {
      endpoint,
      status: response.status,
    });
    throw error;
  }

  // Handle 204 No Content
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return { success: true };
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Tenant-aware token helpers
// ---------------------------------------------------------------------------

/**
 * Get a per-user OAuth access token, auto-refreshing if it's expired or within 5 min of expiry.
 * Throws `EbayNotConnectedError` if the user has no stored eBay credential.
 *
 * This is the canonical tenant-scoped token getter — use it directly when you require a
 * user-scoped token (e.g. seller inventory), or use `getEbayTokenFor` when app-token
 * fallback is acceptable.
 */
export async function getUserAccessToken(userId: string): Promise<string> {
  const credential = await prisma.credential.findUnique({
    where: { userId },
    select: {
      ebayAccessToken: true,
      ebayRefreshToken: true,
      ebayTokenExpiresAt: true,
    },
  });

  if (!credential || !credential.ebayAccessToken) {
    throw new EbayNotConnectedError();
  }

  const now = new Date();
  const expiresAt = credential.ebayTokenExpiresAt;

  if (!expiresAt || expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    if (!credential.ebayRefreshToken) {
      throw new EbayNotConnectedError(
        'eBay refresh token not available. Please reconnect your eBay account.'
      );
    }
    const data = await refreshUserToken(credential.ebayRefreshToken);
    await prisma.credential.update({
      where: { userId },
      data: {
        ebayAccessToken: data.access_token,
        ebayRefreshToken: data.refresh_token || credential.ebayRefreshToken,
        ebayTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
    });
    return data.access_token;
  }

  return credential.ebayAccessToken;
}

/**
 * Tenant-aware token resolver for Browse-style APIs.
 *
 * Returns the user's OAuth token when they have connected eBay (giving the tenant their own
 * 5k/day Browse quota). Falls back to the shared application token when the user has not
 * connected — marked with `kind: 'app'` so callers can log/surface the distinction.
 *
 * This is the function that most public-data eBay callers (arbitrage, research, browse
 * search) should use. The returned token string is opaque — pass it straight through to
 * `callEbayRateLimited`.
 */
export async function getEbayTokenFor(
  userId: string
): Promise<{ token: string; kind: 'user' | 'app' }> {
  try {
    const token = await getUserAccessToken(userId);
    return { token, kind: 'user' };
  } catch (err) {
    if (err instanceof EbayNotConnectedError) {
      const token = await getApplicationToken();
      return { token, kind: 'app' };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Browse API rate-limit (daily quota) pre-flight
// ---------------------------------------------------------------------------

export interface BrowseRateLimit {
  /** Remaining calls in the current window. */
  remaining: number;
  /** Total calls allowed in the current window. */
  limit: number;
  /** ISO timestamp at which the window resets. */
  resetAt: string;
  /** The token kind the quota belongs to — mirrors what was queried. */
  kind: 'user' | 'app';
}

// In-memory cache so pre-flight doesn't become its own meta-load.
const _rateLimitCache = new Map<string, { value: BrowseRateLimit; expiresAt: number }>();
const RATE_LIMIT_CACHE_TTL_MS = 60 * 1000; // 60s

/**
 * Fetch Browse API quota state (count / limit / reset) from eBay's developer analytics.
 * Cached in-memory for 60s per token so repeated pre-flight checks are free.
 *
 * Returns `null` if the endpoint errors or doesn't report a Browse bucket — callers should
 * fail-open (let the real call through) rather than blocking on a transient analytics error.
 */
export async function getBrowseApiRateLimits(
  token: string,
  kind: 'user' | 'app' = 'app'
): Promise<BrowseRateLimit | null> {
  const cacheKey = `${kind}:${token.slice(-16)}`;
  const cached = _rateLimitCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const response = await fetch(
      'https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_context=buy&api_name=Browse',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      logger.warn('[ebay] getBrowseApiRateLimits non-2xx', {
        status: response.status,
        kind,
      });
      return null;
    }

    const data = (await response.json()) as {
      rateLimits?: Array<{
        apiName?: string;
        apiContext?: string;
        resources?: Array<{
          name?: string;
          rates?: Array<{
            remaining?: number;
            limit?: number;
            reset?: string;
            timeWindow?: number;
          }>;
        }>;
      }>;
    };

    const browseBucket = data.rateLimits?.find(
      (r) => r.apiContext === 'buy' && r.apiName === 'Browse'
    );
    const resource = browseBucket?.resources?.find((r) => r.name === 'buy.browse');
    // Pick the daily rate (largest timeWindow, typically 86400s).
    const rate =
      resource?.rates?.slice().sort((a, b) => (b.timeWindow || 0) - (a.timeWindow || 0))[0] ||
      resource?.rates?.[0];

    if (!rate || typeof rate.remaining !== 'number' || typeof rate.limit !== 'number') {
      return null;
    }

    const value: BrowseRateLimit = {
      remaining: rate.remaining,
      limit: rate.limit,
      resetAt: rate.reset || new Date(Date.now() + (rate.timeWindow || 86400) * 1000).toISOString(),
      kind,
    };
    _rateLimitCache.set(cacheKey, { value, expiresAt: Date.now() + RATE_LIMIT_CACHE_TTL_MS });
    return value;
  } catch (err) {
    logger.warn('[ebay] getBrowseApiRateLimits failed', { error: String(err), kind });
    return null;
  }
}
