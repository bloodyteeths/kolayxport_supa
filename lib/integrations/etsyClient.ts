// Using built-in fetch in Node.js 18+
import { logger } from '../logger';

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
}

export interface EtsyTokenRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

/**
 * Etsy API client for tracking submissions using OAuth v3 API
 * Requires transactions_r and transactions_w scopes
 */
export class EtsyClient {
  private accessToken: string;
  private refreshToken?: string;
  private shopId: string;
  private tokenExpiresAt?: Date;
  private baseUrl = 'https://openapi.etsy.com/v3';
  private onTokenRefresh?: (newCredentials: EtsyCredentials) => Promise<void>;
  private refreshPromise: Promise<void> | null = null;

  constructor(credentials: EtsyCredentials, onTokenRefresh?: (newCredentials: EtsyCredentials) => Promise<void>) {
    this.accessToken = credentials.accessToken;
    this.refreshToken = credentials.refreshToken;
    this.shopId = credentials.shopId;
    this.tokenExpiresAt = credentials.tokenExpiresAt;
    this.onTokenRefresh = onTokenRefresh;
  }

  /**
   * Check if the access token needs refreshing (expires within 5 minutes)
   */
  private needsTokenRefresh(): boolean {
    if (!this.tokenExpiresAt) return false;
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return this.tokenExpiresAt <= fiveMinutesFromNow;
  }

  /**
   * Refresh the access token using the refresh token.
   * Uses a lock to prevent concurrent refresh attempts (race condition fix).
   */
  private async refreshAccessToken(): Promise<void> {
    // If a refresh is already in progress, wait for it instead of starting another
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefreshAccessToken().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  /**
   * Performs the actual token refresh against the Etsy OAuth endpoint.
   */
  private async doRefreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available for token refresh');
    }

    const url = 'https://api.etsy.com/v3/public/oauth/token';

    if (!process.env.ETSY_API_KEY) {
      throw new Error('ETSY_API_KEY environment variable is not set');
    }

    const payload = {
      grant_type: 'refresh_token',
      client_id: process.env.ETSY_API_KEY,
      refresh_token: this.refreshToken
    };

    logger.info('Refreshing Etsy access token', {
      shopId: this.shopId
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(payload).toString()
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('Etsy token refresh failed', undefined, {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });
        throw new Error(`Token refresh failed: ${response.status} - ${errorBody}`);
      }

      const tokenData = await response.json() as EtsyTokenRefreshResponse;

      // Update internal state
      this.accessToken = tokenData.access_token;
      this.refreshToken = tokenData.refresh_token;
      this.tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      logger.info('Etsy access token refreshed successfully', {
        shopId: this.shopId,
        expiresAt: this.tokenExpiresAt
      });

      // Notify the callback to update credentials in database
      if (this.onTokenRefresh) {
        await this.onTokenRefresh({
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          shopId: this.shopId,
          tokenExpiresAt: this.tokenExpiresAt
        });
      }

    } catch (error) {
      logger.error('Failed to refresh Etsy access token',
        error instanceof Error ? error : new Error(String(error)), {
          shopId: this.shopId
        });
      throw error;
    }
  }

  /**
   * Make an authenticated request with automatic token refresh
   */
  private async makeAuthenticatedRequest(url: string, options: any): Promise<Response> {
    // Check if token needs refresh before making the request
    if (this.needsTokenRefresh()) {
      await this.refreshAccessToken();
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${this.accessToken}`,
        'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`
      }
    });

    // If we get a 401, try refreshing the token once
    if (response.status === 401 && this.refreshToken) {
      logger.info('Received 401, attempting token refresh', {
        shopId: this.shopId
      });
      
      await this.refreshAccessToken();
      
      // Retry the request with the new token
      return await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${this.accessToken}`,
          'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`
        }
      });
    }

    return response;
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
}