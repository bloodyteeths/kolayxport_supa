import { logger } from '../logger';

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
  const redirectUri = 'https://kolayxport.com/api/integrations/ebay/callback';

  logger.info('Exchanging eBay authorization code for user token');

  const response = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': getBasicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
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
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/commerce.taxonomy.readonly',
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
