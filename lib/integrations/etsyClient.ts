import { logger } from '../logger';
import { etsyFetch, etsyAuthHeaders } from '../etsy/http';
import { EtsyPriority } from '../etsy/rateBudget';
import { getEtsyAccessToken, isInvalidTokenResponseBody, type GetEtsyAccessTokenOptions } from '../etsy/etsyToken';

export { EtsyPriority };

export interface EtsyTrackingData {
  shopId: string;
  receiptId: string;
  trackingNumber: string;
  carrier: string;
}

export interface EtsyTrackingResponse {
  receipt_shipping_id: number;
  receipt_id: number;
  tracking_code: string;
  carrier_name: string;
  mail_class?: string;
}

export interface EtsyCredentials {
  accessToken: string;
  refreshToken?: string;
  shopId: string;
  tokenExpiresAt?: Date;
  /** Owner of the shop: scopes the token lookup to that user's EtsyShop/Credential row. */
  userId?: string;
  /** Etsy rate-budget priority for every call this client makes. Default Reconcile. */
  priority?: EtsyPriority;
}

export interface EtsyTokenRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

/**
 * Etsy API client (receipts, tracking, finance) using OAuth v3.
 *
 * Tokens: every request asks lib/etsy/etsyToken.getEtsyAccessToken for the
 * current token (DB-leased refresh, the only Etsy token POST in the app) and
 * retries once with a forced refresh on a 401 invalid_token. The constructor's
 * accessToken is only used for shops with neither an EtsyShop nor a
 * Credential row (scripts). onTokenRefresh is kept for signature
 * compatibility and is never called: tokens are persisted by etsyToken.
 *
 * HTTP: every request goes through lib/etsy/http.etsyFetch (rate budget,
 * quota headers) at creds.priority (default Reconcile).
 */
export class EtsyClient {
  private accessToken: string;
  private shopId: string;
  private userId?: string;
  private priority: EtsyPriority;
  private baseUrl = 'https://openapi.etsy.com/v3';

  constructor(credentials: EtsyCredentials, onTokenRefresh?: (newCredentials: EtsyCredentials) => Promise<void>) {
    void onTokenRefresh;
    this.accessToken = credentials.accessToken;
    this.shopId = credentials.shopId;
    this.userId = credentials.userId;
    this.priority = credentials.priority ?? EtsyPriority.Reconcile;
  }

  private async currentToken(opts?: GetEtsyAccessTokenOptions): Promise<string> {
    try {
      this.accessToken = await getEtsyAccessToken(this.shopId, this.userId, opts);
    } catch (err: any) {
      // No stored shop/credential (e.g. scripts with a pasted token): use the constructor token.
      if (err?.code !== 'SHOP_NOT_FOUND') throw err;
    }
    return this.accessToken;
  }

  private send(url: string, options: any, token: string): Promise<Response> {
    return etsyFetch(url, {
      ...options,
      headers: { ...(options?.headers || {}), ...etsyAuthHeaders(token) },
    }, { priority: this.priority, shopId: this.shopId });
  }

  /**
   * Make an authenticated request; on a 401 invalid_token/expired, force one
   * token refresh and retry once.
   */
  private async makeAuthenticatedRequest(url: string, options: any): Promise<Response> {
    const token = await this.currentToken();
    const response = await this.send(url, options, token);
    if (response.status !== 401) return response;

    const body = await response.clone().text().catch(() => '');
    if (!isInvalidTokenResponseBody(body)) return response;
    logger.info('Received 401 invalid_token from Etsy, forcing a token refresh', { shopId: this.shopId });
    const fresh = await this.currentToken({ forceRefresh: true, rejectedToken: token });
    if (fresh === token) return response;
    return this.send(url, options, fresh);
  }

  /**
   * Submit tracking information to Etsy for a receipt
   * Uses createReceiptShipment endpoint with automatic token refresh
   */
  async submitTracking(data: EtsyTrackingData): Promise<EtsyTrackingResponse> {
    const url = `${this.baseUrl}/application/shops/${data.shopId}/receipts/${data.receiptId}/tracking`;
    
    const payload = {
      tracking_code: data.trackingNumber,
      carrier_name: data.carrier,
      send_bcc: true // Send tracking notification to buyer
    };

    logger.info('Submitting tracking to Etsy', {
      shopId: data.shopId,
      receiptId: data.receiptId,
      carrier: data.carrier
    });

    try {
      const response = await this.makeAuthenticatedRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorMessage = `Etsy API error: ${response.status} - ${response.statusText}: ${errorBody}`;
        
        logger.error('Etsy tracking submission failed', undefined, {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          shopId: data.shopId,
          receiptId: data.receiptId
        });
        
        throw new Error(errorMessage);
      }

      const result = await response.json() as EtsyTrackingResponse;
      
      logger.info('Etsy tracking submitted successfully', {
        receiptShippingId: result.receipt_shipping_id,
        receiptId: result.receipt_id,
        trackingCode: result.tracking_code
      });

      return result;
    } catch (error) {
      logger.error('Failed to submit tracking to Etsy', 
        error instanceof Error ? error : new Error(String(error)), {
          shopId: data.shopId,
          receiptId: data.receiptId
        });
      throw error;
    }
  }

  /**
   * Validate that the access token and shop ID are valid
   */
  async validateCredentials(): Promise<boolean> {
    const url = `${this.baseUrl}/application/shops/${this.shopId}`;

    try {
      const response = await this.makeAuthenticatedRequest(url, {
        method: 'GET',
        headers: {}
      });

      return response.ok;
    } catch (error) {
      logger.error('Etsy credentials validation failed',
        error instanceof Error ? error : new Error(String(error)), {
          shopId: this.shopId
        });
      return false;
    }
  }

  // ─── Finance API Methods ───────────────────────────────────────────

  /**
   * Convert Etsy money object ({ amount, divisor }) to a plain number.
   * Returns 0 if the input is null/undefined.
   */
  static etsyMoney(money: { amount: number; divisor: number }): number {
    return money ? money.amount / money.divisor : 0;
  }

  /**
   * Fetch shop receipts (orders) with pagination.
   * Endpoint: GET /v3/application/shops/{shopId}/receipts
   */
  async getReceipts(params: {
    min_created?: number;
    max_created?: number;
    limit?: number;
    offset?: number;
    includes?: string[];
  } = {}): Promise<any> {
    const query = new URLSearchParams();
    if (params.min_created != null) query.set('min_created', String(params.min_created));
    if (params.max_created != null) query.set('max_created', String(params.max_created));
    if (params.limit != null) query.set('limit', String(Math.min(params.limit, 100)));
    if (params.offset != null) query.set('offset', String(params.offset));
    if (params.includes?.length) query.set('includes', params.includes.join(','));

    const url = `${this.baseUrl}/application/shops/${this.shopId}/receipts?${query.toString()}`;

    logger.info('Fetching Etsy receipts', {
      shopId: this.shopId,
      ...params
    });

    try {
      const response = await this.makeAuthenticatedRequest(url, {
        method: 'GET',
        headers: {}
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorMessage = `Etsy API error: ${response.status} - ${response.statusText}: ${errorBody}`;

        logger.error('Etsy getReceipts failed', undefined, {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          shopId: this.shopId
        });

        throw new Error(errorMessage);
      }

      const result = await response.json();

      logger.info('Etsy receipts fetched successfully', {
        shopId: this.shopId,
        count: result.count
      });

      return result;
    } catch (error) {
      logger.error('Failed to fetch Etsy receipts',
        error instanceof Error ? error : new Error(String(error)), {
          shopId: this.shopId
        });
      throw error;
    }
  }

  /**
   * Fetch payment records for the shop.
   * Endpoint: GET /v3/application/shops/{shopId}/payments
   */
  async getShopPayments(params: {
    min_created?: number;
    max_created?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<any> {
    const query = new URLSearchParams();
    if (params.min_created != null) query.set('min_created', String(params.min_created));
    if (params.max_created != null) query.set('max_created', String(params.max_created));
    if (params.limit != null) query.set('limit', String(Math.min(params.limit, 100)));
    if (params.offset != null) query.set('offset', String(params.offset));

    const url = `${this.baseUrl}/application/shops/${this.shopId}/payments?${query.toString()}`;

    logger.info('Fetching Etsy shop payments', {
      shopId: this.shopId,
      ...params
    });

    try {
      const response = await this.makeAuthenticatedRequest(url, {
        method: 'GET',
        headers: {}
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorMessage = `Etsy API error: ${response.status} - ${response.statusText}: ${errorBody}`;

        logger.error('Etsy getShopPayments failed', undefined, {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          shopId: this.shopId
        });

        throw new Error(errorMessage);
      }

      const result = await response.json();

      logger.info('Etsy shop payments fetched successfully', {
        shopId: this.shopId,
        count: result.count
      });

      return result;
    } catch (error) {
      logger.error('Failed to fetch Etsy shop payments',
        error instanceof Error ? error : new Error(String(error)), {
          shopId: this.shopId
        });
      throw error;
    }
  }

  /**
   * Fetch images for a listing. Returns the first image URL or empty string.
   */
  async getListingFirstImage(listingId: string): Promise<string> {
    const url = `${this.baseUrl}/application/listings/${listingId}/images`;
    try {
      const response = await this.makeAuthenticatedRequest(url, { method: 'GET', headers: {} });
      if (!response.ok) return '';
      const data = await response.json();
      const img = (data.results || [])[0];
      return img?.url_570xN || img?.url_170x135 || '';
    } catch {
      return '';
    }
  }

  /**
   * Fetch ledger entries for the shop.
   * Endpoint: GET /v3/application/shops/{shopId}/ledger/entries
   */
  async getLedgerEntries(params: {
    min_created?: number;
    max_created?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<any> {
    const query = new URLSearchParams();
    if (params.min_created != null) query.set('min_created', String(params.min_created));
    if (params.max_created != null) query.set('max_created', String(params.max_created));
    if (params.limit != null) query.set('limit', String(Math.min(params.limit, 100)));
    if (params.offset != null) query.set('offset', String(params.offset));

    const url = `${this.baseUrl}/application/shops/${this.shopId}/payment-account/ledger-entries?${query.toString()}`;

    logger.info('Fetching Etsy ledger entries', {
      shopId: this.shopId,
      ...params
    });

    try {
      const response = await this.makeAuthenticatedRequest(url, {
        method: 'GET',
        headers: {}
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorMessage = `Etsy API error: ${response.status} - ${response.statusText}: ${errorBody}`;

        logger.error('Etsy getLedgerEntries failed', undefined, {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          shopId: this.shopId
        });

        throw new Error(errorMessage);
      }

      const result = await response.json();

      logger.info('Etsy ledger entries fetched successfully', {
        shopId: this.shopId,
        count: result.count
      });

      return result;
    } catch (error) {
      logger.error('Failed to fetch Etsy ledger entries',
        error instanceof Error ? error : new Error(String(error)), {
          shopId: this.shopId
        });
      throw error;
    }
  }
}