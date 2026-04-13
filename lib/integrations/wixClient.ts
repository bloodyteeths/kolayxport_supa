/**
 * Wix API client for orders and product management.
 * Uses Client Credentials OAuth (appId + appSecret + instanceId → access token).
 * Tokens are valid for ~4 hours and re-requested when expired.
 */

export interface WixCredentials {
  siteId: string;
  instanceId: string;
  accessToken?: string;
  tokenExpiresAt?: Date;
}

export type TokenRefreshCallback = (creds: { accessToken: string; tokenExpiresAt: Date; instanceId: string; siteId: string }) => Promise<void>;

const BASE_URL = 'https://www.wixapis.com';
const MIN_GAP_MS = 200;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

export class WixApiClient {
  private accessToken: string;
  private instanceId: string;
  private siteId: string;
  private tokenExpiresAt?: Date;
  private onTokenRefresh?: TokenRefreshCallback;
  private refreshPromise: Promise<void> | null = null;
  private lastRequestTime = 0;

  constructor(credentials: WixCredentials, onTokenRefresh?: TokenRefreshCallback) {
    this.accessToken = credentials.accessToken || '';
    this.instanceId = credentials.instanceId;
    this.siteId = credentials.siteId;
    this.tokenExpiresAt = credentials.tokenExpiresAt;
    this.onTokenRefresh = onTokenRefresh;
  }

  private needsTokenRefresh(): boolean {
    if (!this.accessToken || !this.tokenExpiresAt) return true;
    return Date.now() >= this.tokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS;
  }

  /**
   * Get a new access token using client_credentials grant.
   * Wix tokens are valid for ~4 hours. No refresh tokens needed.
   */
  private async refreshAccessToken(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const appId = process.env.WIX_APP_ID;
        const appSecret = process.env.WIX_APP_SECRET;
        if (!appId || !appSecret) throw new Error('WIX_APP_ID or WIX_APP_SECRET not configured');

        const res = await fetch(`${BASE_URL}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: appId,
            client_secret: appSecret,
            instance_id: this.instanceId,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Wix token request failed (${res.status}): ${text}`);
        }

        const data = await res.json();
        this.accessToken = data.access_token;
        this.tokenExpiresAt = new Date(Date.now() + (data.expires_in || 14400) * 1000);

        if (this.onTokenRefresh) {
          await this.onTokenRefresh({
            accessToken: this.accessToken,
            instanceId: this.instanceId,
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
      ...(options.headers as Record<string, string> || {}),
    };

    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

    // Retry on 401
    if (res.status === 401) {
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
    dateCreatedFrom?: string;
    dateCreatedTo?: string;
  } = {}): Promise<{ orders: any[]; totalResults: number }> {
    const filter: any = {};
    if (params.dateCreatedFrom || params.dateCreatedTo) {
      filter['dateCreated'] = {};
      if (params.dateCreatedFrom) {
        filter['dateCreated']['$gte'] = params.dateCreatedFrom;
      }
      if (params.dateCreatedTo) {
        filter['dateCreated']['$lte'] = params.dateCreatedTo;
      }
    }

    // Use ecom/v1/orders API (stores/v2 is deprecated)
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

    const data = await this.request<any>('/ecom/v1/orders/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      orders: data.orders || [],
      totalResults: data.totalResults || data.metadata?.count || 0,
    };
  }

  async getOrder(orderId: string): Promise<any> {
    const data = await this.request<any>(`/ecom/v1/orders/${orderId}`);
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

  async getAppInstance(): Promise<any> {
    return this.request<any>('/apps/v1/instance');
  }
}

/**
 * Factory: create WixApiClient from DB credentials.
 */
export function createWixClient(
  credential: {
    wixAccessToken?: string | null;
    wixSiteId?: string | null;
    wixInstanceId?: string | null;
    wixTokenExpiresAt?: Date | null;
  },
  onTokenRefresh?: TokenRefreshCallback
): WixApiClient {
  if (!credential.wixInstanceId || !credential.wixSiteId) {
    throw new Error('Missing Wix credentials (instanceId or siteId)');
  }

  return new WixApiClient(
    {
      siteId: credential.wixSiteId,
      instanceId: credential.wixInstanceId,
      accessToken: credential.wixAccessToken || undefined,
      tokenExpiresAt: credential.wixTokenExpiresAt || undefined,
    },
    onTokenRefresh
  );
}
