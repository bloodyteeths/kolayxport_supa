import { logger } from '../logger';
import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmazonCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  sellerId?: string;
  marketplaceId?: string;
  region?: string;
}

export interface AmazonTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export type AmazonRegion = 'na' | 'eu' | 'fe';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AMAZON_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

const SP_API_ENDPOINTS: Record<AmazonRegion, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};

const AMAZON_AUTH_URL = 'https://sellercentral.amazon.com/apps/authorize/consent';

/** Amazon marketplace IDs for priority markets */
export const AMAZON_MARKETPLACES: Record<string, { id: string; domain: string; region: AmazonRegion; name: string }> = {
  US:  { id: 'ATVPDKIKX0DER',   domain: 'amazon.com',    region: 'na', name: 'United States' },
  TR:  { id: 'A33AVAJ2PDY3EV',  domain: 'amazon.com.tr', region: 'eu', name: 'Turkey' },
  DE:  { id: 'A1PA6795UKMFR9',  domain: 'amazon.de',     region: 'eu', name: 'Germany' },
  UK:  { id: 'A1F83G8C2ARO7P',  domain: 'amazon.co.uk',  region: 'eu', name: 'United Kingdom' },
  FR:  { id: 'A13V1IB3VIYZZH',  domain: 'amazon.fr',     region: 'eu', name: 'France' },
  IT:  { id: 'APJ6JRA9NG5V4',   domain: 'amazon.it',     region: 'eu', name: 'Italy' },
  ES:  { id: 'A1RKKUPIHCS9HS',  domain: 'amazon.es',     region: 'eu', name: 'Spain' },
  NL:  { id: 'A1805IZSGTT6HS',  domain: 'amazon.nl',     region: 'eu', name: 'Netherlands' },
  SE:  { id: 'A2NODRKZP88ZB9',  domain: 'amazon.se',     region: 'eu', name: 'Sweden' },
  PL:  { id: 'A1C3SOZRARQ6R3',  domain: 'amazon.pl',     region: 'eu', name: 'Poland' },
  BE:  { id: 'AMEN7PMS3EDWL',   domain: 'amazon.com.be', region: 'eu', name: 'Belgium' },
  SA:  { id: 'A17E79C6D8DWNP',  domain: 'amazon.sa',     region: 'eu', name: 'Saudi Arabia' },
  AE:  { id: 'A2VIGQ35RCS4UG',  domain: 'amazon.ae',     region: 'eu', name: 'UAE' },
  IN:  { id: 'A21TJRUUN4KGV',   domain: 'amazon.in',     region: 'eu', name: 'India' },
  AU:  { id: 'A39IBJ37TRP1C6',  domain: 'amazon.com.au', region: 'fe', name: 'Australia' },
  JP:  { id: 'A1VC38T7YXB528',  domain: 'amazon.co.jp',  region: 'fe', name: 'Japan' },
  CA:  { id: 'A2EUQ1WTGCTBG2',  domain: 'amazon.ca',     region: 'na', name: 'Canada' },
  MX:  { id: 'A1AM78C64UM0Y8',  domain: 'amazon.com.mx', region: 'na', name: 'Mexico' },
  BR:  { id: 'A2Q3Y263D00KWC',  domain: 'amazon.com.br', region: 'na', name: 'Brazil' },
};

// ---------------------------------------------------------------------------
// LWA OAuth2
// ---------------------------------------------------------------------------

/**
 * Build the Amazon OAuth consent URL for seller authorization.
 * Returns { url, csrfToken } so the connect handler can set the CSRF cookie.
 *
 * marketplaceIds is the list of Amazon marketplace IDs (e.g. ['ATVPDKIKX0DER','A33AVAJ2PDY3EV'])
 * the seller wants to connect. Encoded in `state` and persisted in the callback.
 */
export function buildAuthUrl(
  userId: string,
  marketplaceIds: string[] = [],
): { url: string; csrfToken: string } {
  const { randomBytes } = require('crypto');

  const clientId = process.env.AMAZON_LWA_CLIENT_ID;
  if (!clientId) throw new Error('AMAZON_LWA_CLIENT_ID is required');

  const csrfToken = randomBytes(16).toString('hex');
  const state = Buffer.from(
    JSON.stringify({ userId, csrfToken, marketplaceIds }),
  ).toString('base64url');

  const redirectUri = `${process.env.NEXTAUTH_URL || 'https://kolayxport.com'}/api/integrations/amazon/callback`;

  const params = new URLSearchParams({
    application_id: clientId,
    state,
    redirect_uri: redirectUri,
  });

  if (process.env.AMAZON_SANDBOX === 'true') {
    params.set('version', 'beta');
  }

  return { url: `${AMAZON_AUTH_URL}?${params}`, csrfToken };
}

/**
 * Resolve a marketplace ID to its SP-API region.
 * Returns 'eu' if not found.
 */
export function regionForMarketplaceId(marketplaceId: string): AmazonRegion {
  for (const m of Object.values(AMAZON_MARKETPLACES)) {
    if (m.id === marketplaceId) return m.region;
  }
  return 'eu';
}

/**
 * Exchange an authorization code for LWA tokens.
 */
export async function exchangeAuthCode(authCode: string): Promise<AmazonTokenResponse> {
  const clientId = process.env.AMAZON_LWA_CLIENT_ID;
  const clientSecret = process.env.AMAZON_LWA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('AMAZON_LWA_CLIENT_ID and AMAZON_LWA_CLIENT_SECRET are required');
  }

  logger.info('Exchanging Amazon authorization code for tokens');

  const response = await fetch(AMAZON_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('Amazon token exchange failed', undefined, {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`Amazon token exchange failed: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as AmazonTokenResponse;
  logger.info('Amazon tokens obtained', {
    expiresIn: data.expires_in,
    hasRefreshToken: !!data.refresh_token,
  });
  return data;
}

/**
 * Refresh an LWA access token using a refresh token.
 * Amazon access tokens expire after 1 hour.
 */
export async function refreshAccessToken(refreshToken: string): Promise<AmazonTokenResponse> {
  const clientId = process.env.AMAZON_LWA_CLIENT_ID;
  const clientSecret = process.env.AMAZON_LWA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('AMAZON_LWA_CLIENT_ID and AMAZON_LWA_CLIENT_SECRET are required');
  }

  logger.info('Refreshing Amazon access token');

  const response = await fetch(AMAZON_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('Amazon token refresh failed', undefined, {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`Amazon token refresh failed: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as AmazonTokenResponse;
  logger.info('Amazon access token refreshed', { expiresIn: data.expires_in });
  return data;
}

// ---------------------------------------------------------------------------
// SP-API caller
// ---------------------------------------------------------------------------

/**
 * Call the Amazon SP-API with automatic rate-limit handling.
 *
 * @param endpoint - Path like `/orders/v0/orders` or full URL
 * @param token - LWA access token
 * @param region - SP-API region (default 'eu')
 * @param options - Fetch options
 * @param marketplaceId - Optional marketplace ID header
 */
export async function callSpApi(
  endpoint: string,
  token: string,
  region: AmazonRegion = 'eu',
  options: RequestInit = {},
  marketplaceId?: string,
): Promise<any> {
  const baseUrl = SP_API_ENDPOINTS[region];
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    'x-amz-access-token': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (marketplaceId) {
    headers['x-amz-marketplace-id'] = marketplaceId;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const rateLimitHeader = response.headers.get('x-amzn-RateLimit-Limit');
    logger.warn('Amazon SP-API rate limited', {
      endpoint,
      retryAfter,
      rateLimit: rateLimitHeader,
    });
    throw new RateLimitError(
      `Amazon SP-API rate limited on ${endpoint}`,
      retryAfter ? parseInt(retryAfter, 10) : 2,
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Amazon SP-API error: ${response.status} - ${errorText}`);
    logger.error('Amazon SP-API call failed', error, {
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

/**
 * Call SP-API with automatic retry on rate limit (429).
 * Uses exponential backoff with a maximum of 3 retries.
 */
export async function callSpApiWithRetry(
  endpoint: string,
  token: string,
  region: AmazonRegion = 'eu',
  options: RequestInit = {},
  marketplaceId?: string,
  maxRetries: number = 3,
): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callSpApi(endpoint, token, region, options, marketplaceId);
    } catch (err) {
      if (err instanceof RateLimitError && attempt < maxRetries) {
        const delay = err.retryAfterSeconds * 1000 * Math.pow(2, attempt);
        logger.info(`SP-API retry ${attempt + 1}/${maxRetries} after ${delay}ms`, { endpoint });
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Restricted Data Token (for PII: addresses, buyer info)
// ---------------------------------------------------------------------------

/**
 * Request a Restricted Data Token for accessing PII data.
 */
export async function getRestrictedDataToken(
  accessToken: string,
  region: AmazonRegion,
  restrictedResources: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    dataElements?: string[];
  }>,
): Promise<string> {
  const response = await callSpApi(
    '/tokens/2021-03-01/restrictedDataToken',
    accessToken,
    region,
    {
      method: 'POST',
      body: JSON.stringify({ restrictedResources }),
    },
  );

  return response.restrictedDataToken;
}

// ---------------------------------------------------------------------------
// Credential helper
// ---------------------------------------------------------------------------

/**
 * Get a valid Amazon access token for a user, refreshing if needed.
 * Returns null if user has no Amazon credentials.
 */
export async function getValidToken(
  credential: {
    amazonAccessToken?: string | null;
    amazonRefreshToken?: string | null;
    amazonTokenExpiresAt?: Date | null;
  },
  onTokenRefreshed?: (newToken: string, expiresAt: Date) => Promise<void>,
): Promise<string | null> {
  if (!credential.amazonAccessToken || !credential.amazonRefreshToken) {
    return null;
  }

  const plainAccess = decryptIfNeeded(credential.amazonAccessToken) as string;
  const plainRefresh = decryptIfNeeded(credential.amazonRefreshToken) as string;

  // Check if token expires within 5 minutes
  const expiresAt = credential.amazonTokenExpiresAt
    ? new Date(credential.amazonTokenExpiresAt)
    : new Date(0);
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);

  if (expiresAt > fiveMinFromNow) {
    return plainAccess;
  }

  // Refresh the token
  logger.info('Amazon token expired or expiring soon, refreshing');
  const newTokens = await refreshAccessToken(plainRefresh);
  const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

  if (onTokenRefreshed) {
    // Callers persist via Prisma — pass the already-encrypted shape so the row
    // lands as `enc:v1:` regardless of the calling code's awareness.
    await onTokenRefreshed(encryptIfNeeded(newTokens.access_token) as string, newExpiresAt);
  }

  return newTokens.access_token;
}

// ---------------------------------------------------------------------------
// Creators API (PA-API replacement — for product research without seller auth)
// ---------------------------------------------------------------------------

const CREATORS_API_HOSTS: Record<string, string> = {
  US: 'webservices.amazon.com',
  UK: 'webservices.amazon.co.uk',
  DE: 'webservices.amazon.de',
  FR: 'webservices.amazon.fr',
  IT: 'webservices.amazon.it',
  ES: 'webservices.amazon.es',
  TR: 'webservices.amazon.com.tr',
  JP: 'webservices.amazon.co.jp',
  AU: 'webservices.amazon.com.au',
  CA: 'webservices.amazon.ca',
};

/**
 * Call the Amazon Creators/PA-API v5 for product research.
 * Requires Amazon Associates credentials (not seller auth).
 *
 * Note: PA-API v5 is being deprecated May 2026.
 * Creators API uses the same HMAC-signed request format.
 */
export async function callCreatorsApi(
  operation: 'SearchItems' | 'GetItems' | 'GetBrowseNodes',
  payload: Record<string, any>,
  marketplace: string = 'US',
): Promise<any> {
  const accessKey = process.env.AMAZON_PA_API_ACCESS_KEY;
  const secretKey = process.env.AMAZON_PA_API_SECRET_KEY;
  const partnerTag = process.env.AMAZON_ASSOCIATES_TAG;

  if (!accessKey || !secretKey || !partnerTag) {
    throw new Error('AMAZON_PA_API_ACCESS_KEY, AMAZON_PA_API_SECRET_KEY, and AMAZON_ASSOCIATES_TAG are required');
  }

  const host = CREATORS_API_HOSTS[marketplace] || CREATORS_API_HOSTS.US;
  const path = '/paapi5/' + operation.toLowerCase();
  const url = `https://${host}${path}`;

  const body = JSON.stringify({
    PartnerTag: partnerTag,
    PartnerType: 'Associates',
    Marketplace: `www.${AMAZON_MARKETPLACES[marketplace]?.domain || 'amazon.com'}`,
    ...payload,
  });

  // PA-API requires AWS Signature V4 signing
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = timestamp.slice(0, 8);
  const region = marketplace === 'US' || marketplace === 'CA' || marketplace === 'MX' || marketplace === 'BR'
    ? 'us-east-1'
    : marketplace === 'AU' || marketplace === 'JP' || marketplace === 'SG'
      ? 'us-west-2'
      : 'eu-west-1';

  // Compute AWS Signature V4
  const { createHmac, createHash } = await import('crypto');

  const canonicalHeaders = [
    `content-encoding:amz-1.0`,
    `content-type:application/json; charset=utf-8`,
    `host:${host}`,
    `x-amz-date:${timestamp}`,
    `x-amz-target:com.amazon.paapi5.v1.ProductAdvertisingAPIv1.${operation}`,
  ].join('\n') + '\n';

  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';

  const payloadHash = createHash('sha256').update(body).digest('hex');

  const canonicalRequest = [
    'POST',
    path,
    '', // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${date}/${region}/ProductAdvertisingAPI/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = (key: string, data: string) =>
    createHmac('sha256', key).update(data).digest();

  const kDate = signingKey(`AWS4${secretKey}`, date);
  const kRegion = signingKey(kDate as unknown as string, region);
  const kService = signingKey(kRegion as unknown as string, 'ProductAdvertisingAPI');
  const kSigning = signingKey(kService as unknown as string, 'aws4_request');

  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-encoding': 'amz-1.0',
      'content-type': 'application/json; charset=utf-8',
      'host': host,
      'x-amz-date': timestamp,
      'x-amz-target': `com.amazon.paapi5.v1.ProductAdvertisingAPIv1.${operation}`,
      'Authorization': authorization,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Creators API call failed', undefined, {
      operation,
      status: response.status,
      body: errorText,
    });
    throw new Error(`Creators API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Amazon Autocomplete (unofficial — for keyword research)
// ---------------------------------------------------------------------------

/**
 * Fetch Amazon search autocomplete suggestions.
 * Uses Amazon's internal completion endpoint.
 */
export async function getAutocomplete(
  prefix: string,
  marketplace: string = 'US',
): Promise<string[]> {
  const marketplaceIds: Record<string, string> = {
    US: 'ATVPDKIKX0DER',
    UK: 'A1F83G8C2ARO7P',
    DE: 'A1PA6795UKMFR9',
    TR: 'A33AVAJ2PDY3EV',
  };

  const mid = marketplaceIds[marketplace] || marketplaceIds.US;
  const domain = AMAZON_MARKETPLACES[marketplace]?.domain || 'amazon.com';
  const url = `https://completion.${domain}/api/2017/suggestions?mid=${mid}&alias=aps&prefix=${encodeURIComponent(prefix)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KolayXport/1.0)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data.suggestions || []).map((s: any) => s.value).filter(Boolean);
  } catch {
    logger.warn('Amazon autocomplete failed', { prefix, marketplace });
    return [];
  }
}

/**
 * Alphabet soup expansion: get suggestions for "keyword a" through "keyword z".
 */
export async function alphabetSoupExpansion(
  keyword: string,
  marketplace: string = 'US',
): Promise<string[]> {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const allSuggestions = new Set<string>();

  // Get base suggestions first
  const base = await getAutocomplete(keyword, marketplace);
  base.forEach(s => allSuggestions.add(s));

  // Expand with each letter
  const batchSize = 5;
  for (let i = 0; i < alphabet.length; i += batchSize) {
    const batch = alphabet.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(letter => getAutocomplete(`${keyword} ${letter}`, marketplace)),
    );
    results.flat().forEach(s => allSuggestions.add(s));

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < alphabet.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return Array.from(allSuggestions).sort();
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class RateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ---------------------------------------------------------------------------
// Feeds API — submit order fulfillment (tracking) directly to Amazon
// ---------------------------------------------------------------------------

/**
 * Map our internal carrier names to Amazon's accepted CarrierCode values.
 * Amazon expects specific strings — anything else can be sent under CarrierName instead.
 */
const AMAZON_CARRIER_CODES: Record<string, string> = {
  'FedEx': 'FedEx',
  'UPS': 'UPS',
  'USPS': 'USPS',
  'DHL': 'DHL',
  'DHL Express': 'DHL Express',
  'Royal Mail': 'Royal Mail',
  'DPD': 'DPD',
};

function escapeXml(s: string): string {
  return String(s).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Build a POST_ORDER_FULFILLMENT_DATA XML feed for a single shipment.
 * Schema: https://m.media-amazon.com/images/G/01/rainier/help/xsd/release_1_9/OrderFulfillment.xsd
 */
export function buildOrderFulfillmentFeed(params: {
  sellerId: string;
  amazonOrderId: string;
  trackingNumber: string;
  carrierName: string;
  shipDate?: Date;
}): string {
  const code = AMAZON_CARRIER_CODES[params.carrierName];
  const carrierEl = code
    ? `<CarrierCode>${escapeXml(code)}</CarrierCode>`
    : `<CarrierName>${escapeXml(params.carrierName)}</CarrierName>`;
  const shipDate = (params.shipDate || new Date()).toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<AmazonEnvelope>
  <Header>
    <DocumentVersion>1.01</DocumentVersion>
    <MerchantIdentifier>${escapeXml(params.sellerId)}</MerchantIdentifier>
  </Header>
  <MessageType>OrderFulfillment</MessageType>
  <Message>
    <MessageID>1</MessageID>
    <OrderFulfillment>
      <AmazonOrderID>${escapeXml(params.amazonOrderId)}</AmazonOrderID>
      <FulfillmentDate>${shipDate}</FulfillmentDate>
      <FulfillmentData>
        ${carrierEl}
        <ShipperTrackingNumber>${escapeXml(params.trackingNumber)}</ShipperTrackingNumber>
      </FulfillmentData>
    </OrderFulfillment>
  </Message>
</AmazonEnvelope>`;
}

/**
 * Submit an order-fulfillment (tracking) update to Amazon via the Feeds 2021-06-30 API.
 *
 * Flow:
 *   1. createFeedDocument → returns signed S3 URL + feedDocumentId
 *   2. PUT XML payload to the signed URL
 *   3. createFeed referencing the feedDocumentId
 * Returns the feedId. Polling status is the caller's responsibility (optional).
 */
export async function submitAmazonTracking(params: {
  token: string;
  region: AmazonRegion;
  marketplaceId: string;
  sellerId: string;
  amazonOrderId: string;
  trackingNumber: string;
  carrierName: string;
  shipDate?: Date;
}): Promise<{ feedId: string; feedDocumentId: string }> {
  const { token, region, marketplaceId, sellerId } = params;

  // 1) Create a feed document — Amazon returns a signed S3 URL we can PUT to.
  const createDoc = await callSpApi(
    '/feeds/2021-06-30/documents',
    token,
    region,
    {
      method: 'POST',
      body: JSON.stringify({ contentType: 'text/xml; charset=UTF-8' }),
    },
  );
  const { feedDocumentId, url: uploadUrl } = createDoc as { feedDocumentId: string; url: string };

  // 2) Upload the XML to the signed URL (no auth header).
  const xml = buildOrderFulfillmentFeed({
    sellerId,
    amazonOrderId: params.amazonOrderId,
    trackingNumber: params.trackingNumber,
    carrierName: params.carrierName,
    shipDate: params.shipDate,
  });
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
    body: xml,
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`Amazon feed upload failed: ${uploadRes.status} ${body.slice(0, 200)}`);
  }

  // 3) Create the feed referencing the uploaded document.
  const created = await callSpApi(
    '/feeds/2021-06-30/feeds',
    token,
    region,
    {
      method: 'POST',
      body: JSON.stringify({
        feedType: 'POST_ORDER_FULFILLMENT_DATA',
        marketplaceIds: [marketplaceId],
        inputFeedDocumentId: feedDocumentId,
      }),
    },
  );

  logger.info('Amazon tracking feed submitted', {
    feedId: (created as any).feedId,
    amazonOrderId: params.amazonOrderId,
  });

  return { feedId: (created as any).feedId, feedDocumentId };
}
