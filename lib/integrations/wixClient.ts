/**
 * Wix API client for orders and product management.
 * Uses OAuth tokens stored per-user. Supports token refresh with deduplication lock.
 */

export interface WixCredentials {
  siteId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

export type TokenRefreshCallback = (creds: WixCredentials) => Promise<void>;

const BASE_URL = 'https://www.wixapis.com';
const MIN_GAP_MS = 200; // Conservative rate limiting
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

export class WixApiClient {
  private accessToken: string;
  private refreshToken?: string;
  private siteId: string;
  private tokenExpiresAt?: Date;
  private onTokenRefresh?: TokenRefreshCallback;
  private refreshPromise: Promise<void> | null = null;
  private lastRequestTime = 0;

  constructor(credentials: WixCredentials, onTokenRefresh?: TokenRefreshCallback) {
    this.accessToken = credentials.accessToken;
    this.refreshToken = credentials.refreshToken;
    this.siteId = credentials.siteId;
    this.tokenExpiresAt = credentials.tokenExpiresAt;
    this.onTokenRefresh = onTokenRefresh;
  }

  private needsTokenRefresh(): boolean {
    if (!this.tokenExpiresAt) return false;
    return Date.now() >= this.tokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS;
  }

  /**
   * Refresh access token. Uses lock to prevent concurrent refresh attempts.
   */
  private async refreshAccessToken(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        if (!this.refreshToken) throw new Error('No Wix refresh token available');

        const appId = process.env.WIX_APP_ID;
        const appSecret = process.env.WIX_APP_SECRET;
        if (!appId || !appSecret) throw new Error('WIX_APP_ID or WIX_APP_SECRET not configured');

        const res = await fetch(`${BASE_URL}/oauth/access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            client_id: appId,
            client_secret: appSecret,
            refresh_token: this.refreshToken,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Wix token refresh failed (${res.status}): ${text}`);
        }

        const data = await res.json();
        this.accessToken = data.access_token;
        if (data.refresh_token) this.refreshToken = data.refresh_token;
        // Wix tokens typically expire in 10 minutes
        this.tokenExpiresAt = new Date(Date.now() + (data.expires_in || 600) * 1000);

        if (this.onTokenRefresh) {
          await this.onTokenRefresh({
            accessToken: this.accessToken,
            refreshToken: this.refreshToken || '',
            siteId: this.siteId,
            tokenExpiresAt: this.tokenExpiresAt,
          });
        }
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Rate-limited authenticated request with auto token refresh.
   */
  private async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    // Rate limiting
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < MIN_GAP_MS) {
      await new Promise(resolve => setTimeout(resolve, MIN_GAP_MS - elapsed));
    }
    this.lastRequestTime = Date.now();

    // Token refresh if needed
    if (this.needsTokenRefresh()) {
      await this.refreshAccessToken();
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': this.accessToken,
      'wix-site-id': this.siteId,
      ...(options.headers as Record<string, string> || {}),
    };

    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

    // Retry on 401
    if (res.status === 401 && this.refreshToken) {
      await this.refreshAccessToken();
      headers['Authorization'] = this.accessToken;
      const retryRes = await fetch(`${BASE_URL}${path}`, { ...options, headers });
      if (!retryRes.ok) {
        const text = await retryRes.text();
        throw new Error(`Wix API ${retryRes.status}: ${text}`);
      }
      return retryRes.json() as Promise<T>;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Wix API ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ─── Orders ───────────────────────────────────────────────

  async queryOrders(params: {
    limit?: number;
    offset?: number;
    dateCreatedFrom?: string; // ISO date
    dateCreatedTo?: string;
  } = {}): Promise<{ orders: any[]; totalResults: number }> {
    const filter: any = {};
    if (params.dateCreatedFrom) {
      filter['dateCreated'] = filter['dateCreated'] || {};
      filter['dateCreated']['$gte'] = params.dateCreatedFrom;
    }
    if (params.dateCreatedTo) {
      filter['dateCreated'] = filter['dateCreated'] || {};
      filter['dateCreated']['$lte'] = params.dateCreatedTo;
    }

    const body: any = {
      query: {
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        sort: [{ fieldName: 'dateCreated', order: 'DESC' }],
        paging: {
          limit: params.limit || 50,
          offset: params.offset || 0,
        },
      },
    };

    const data = await this.request<any>('/stores/v2/orders/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      orders: data.orders || [],
      totalResults: data.totalResults || 0,
    };
  }

  async getOrder(orderId: string): Promise<any> {
    const data = await this.request<any>(`/stores/v2/orders/${orderId}`);
    return data.order || data;
  }

  // ─── Products ─────────────────────────────────────────────

  async queryProducts(params: {
    limit?: number;
    offset?: number;
    includeVariants?: boolean;
  } = {}): Promise<{ products: any[]; totalResults: number }> {
    const body = {
      query: {
        paging: {
          limit: params.limit || 100,
          offset: params.offset || 0,
        },
      },
      includeVariants: params.includeVariants ?? true,
    };

    const data = await this.request<any>('/stores/v1/products/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      products: data.products || [],
      totalResults: data.totalResults || 0,
    };
  }

  async getProduct(productId: string): Promise<any> {
    const data = await this.request<any>(`/stores/v1/products/${productId}`);
    return data.product || data;
  }

  async createProduct(productData: {
    name: string;
    description?: string;
    priceData?: { price: number; currency?: string };
    sku?: string;
    visible?: boolean;
    weight?: number;
    productType?: string;
    ribbon?: string;
    brand?: string;
    manageVariants?: boolean;
  }): Promise<any> {
    const data = await this.request<any>('/stores/v1/products', {
      method: 'POST',
      body: JSON.stringify({ product: productData }),
    });
    return data.product || data;
  }

  async updateProduct(productId: string, productData: Record<string, any>): Promise<any> {
    const data = await this.request<any>(`/stores/v1/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ product: productData }),
    });
    return data.product || data;
  }

  async deleteProduct(productId: string): Promise<void> {
    await this.request(`/stores/v1/products/${productId}`, { method: 'DELETE' });
  }

  // ─── Inventory ────────────────────────────────────────────

  async getInventoryItem(productId: string): Promise<any> {
    const data = await this.request<any>(`/stores/v2/inventoryItems/product/${productId}`);
    return data.inventoryItem || data;
  }

  async updateInventoryVariants(inventoryItemId: string, variants: { variantId: string; quantity: number }[]): Promise<any> {
    const data = await this.request<any>(`/stores/v2/inventoryItems/${inventoryItemId}/incrementInventory`, {
      method: 'POST',
      body: JSON.stringify({
        incrementData: variants.map(v => ({
          variantId: v.variantId,
          incrementBy: v.quantity,
        })),
      }),
    });
    return data;
  }

  // ─── Collections ──────────────────────────────────────────

  async queryCollections(params: { limit?: number; offset?: number } = {}): Promise<{ collections: any[]; totalResults: number }> {
    const body = {
      query: {
        paging: {
          limit: params.limit || 100,
          offset: params.offset || 0,
        },
      },
    };

    const data = await this.request<any>('/stores/v1/collections/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      collections: data.collections || [],
      totalResults: data.totalResults || 0,
    };
  }

  // ─── Site Info ────────────────────────────────────────────

  async getSiteProperties(): Promise<any> {
    return this.request<any>('/site-properties/v4/properties');
  }
}

/**
 * Factory function to create a WixApiClient from database credentials.
 */
export function createWixClient(
  credential: {
    wixAccessToken?: string | null;
    wixRefreshToken?: string | null;
    wixSiteId?: string | null;
    wixTokenExpiresAt?: Date | null;
  },
  onTokenRefresh?: TokenRefreshCallback
): WixApiClient {
  if (!credential.wixAccessToken || !credential.wixSiteId) {
    throw new Error('Missing Wix credentials (accessToken or siteId)');
  }

  return new WixApiClient(
    {
      siteId: credential.wixSiteId,
      accessToken: credential.wixAccessToken,
      refreshToken: credential.wixRefreshToken || undefined,
      tokenExpiresAt: credential.wixTokenExpiresAt || undefined,
    },
    onTokenRefresh
  );
}
