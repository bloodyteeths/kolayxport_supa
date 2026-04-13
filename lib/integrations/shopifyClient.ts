// lib/integrations/shopifyClient.ts
import { logger } from '../logger';

const API_VERSION = '2024-10';
const MIN_GAP_MS = 500; // 2 req/s for Shopify REST API

let lastRequestTime = 0;

async function rateLimitedDelay() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_GAP_MS) {
    await new Promise(r => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export interface ShopifyCredentials {
  accessToken: string;
  shopDomain: string; // e.g. "mystore.myshopify.com"
}

export interface ShopifyPaginatedResponse<T> {
  data: T[];
  nextPageInfo?: string;
}

export class ShopifyClient {
  private accessToken: string;
  private shopDomain: string;
  private baseUrl: string;

  constructor(credentials: ShopifyCredentials) {
    this.accessToken = credentials.accessToken;
    this.shopDomain = credentials.shopDomain;
    this.baseUrl = `https://${this.shopDomain}/admin/api/${API_VERSION}`;
  }

  // ─── Core Request ─────────────────────────────────────────────

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    queryParams?: Record<string, string | number | undefined>
  ): Promise<T> {
    await rateLimitedDelay();

    let url = `${this.baseUrl}${endpoint}`;
    if (queryParams) {
      const qs = Object.entries(queryParams)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      'X-Shopify-Access-Token': this.accessToken,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = { method, headers };
    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    logger.debug('Shopify API request', { method, url });

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      logger.error(
        `Shopify API error: ${method} ${url} ${response.status}`,
        undefined,
        { method, url, status: response.status, body: errorBody }
      );
      throw new Error(
        `Shopify API ${method} ${endpoint} failed: ${response.status} - ${errorBody}`
      );
    }

    // DELETE returns 200 with empty body sometimes
    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text);
  }

  /**
   * Parse Link header for cursor-based pagination.
   * Shopify returns: <url?page_info=xxx>; rel="next"
   */
  private parseLinkHeader(response: Response): string | undefined {
    const link = response.headers.get('Link');
    if (!link) return undefined;
    const match = link.match(/<[^>]*page_info=([^>&]*)>;\s*rel="next"/);
    return match?.[1] || undefined;
  }

  /**
   * Paginated GET that fetches from Shopify with Link-header cursor pagination.
   */
  private async paginatedGet<T>(
    endpoint: string,
    resourceKey: string,
    params?: Record<string, string | number | undefined>,
    limit = 250
  ): Promise<T[]> {
    const all: T[] = [];
    let pageInfo: string | undefined;
    let page = 0;

    do {
      await rateLimitedDelay();
      page++;

      const queryParams: Record<string, string | number | undefined> = pageInfo
        ? { page_info: pageInfo, limit }
        : { ...params, limit };

      let url = `${this.baseUrl}${endpoint}`;
      const qs = Object.entries(queryParams)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Shopify paginated GET ${endpoint} page ${page} failed: ${response.status} - ${errorBody}`);
      }

      const data = await response.json();
      const items = data[resourceKey] || [];
      all.push(...items);

      pageInfo = this.parseLinkHeader(response);
      logger.debug('Shopify paginated fetch', { endpoint, page, fetched: items.length, total: all.length });
    } while (pageInfo);

    return all;
  }

  // ─── Shop ─────────────────────────────────────────────────────

  async getShopInfo(): Promise<any> {
    const res = await this.request<any>('GET', '/shop.json');
    return res.shop;
  }

  // ─── Orders ───────────────────────────────────────────────────

  async getOrders(params?: {
    status?: string; // any, open, closed, cancelled
    created_at_min?: string;
    created_at_max?: string;
    updated_at_min?: string;
    limit?: number;
    fields?: string;
  }): Promise<any[]> {
    return this.paginatedGet('/orders.json', 'orders', {
      status: params?.status || 'any',
      created_at_min: params?.created_at_min,
      created_at_max: params?.created_at_max,
      updated_at_min: params?.updated_at_min,
      fields: params?.fields,
    }, params?.limit || 250);
  }

  async getOrder(orderId: string): Promise<any> {
    const res = await this.request<any>('GET', `/orders/${orderId}.json`);
    return res.order;
  }

  async getOrderCount(params?: {
    status?: string;
    created_at_min?: string;
  }): Promise<number> {
    const res = await this.request<any>('GET', '/orders/count.json', undefined, {
      status: params?.status || 'any',
      created_at_min: params?.created_at_min,
    });
    return res.count;
  }

  // ─── Products ─────────────────────────────────────────────────

  async getProducts(params?: {
    status?: string;
    product_type?: string;
    vendor?: string;
    collection_id?: string;
    title?: string;
    limit?: number;
  }): Promise<any[]> {
    return this.paginatedGet('/products.json', 'products', {
      status: params?.status,
      product_type: params?.product_type,
      vendor: params?.vendor,
      collection_id: params?.collection_id,
      title: params?.title,
    }, params?.limit || 250);
  }

  async getProduct(productId: string): Promise<any> {
    const res = await this.request<any>('GET', `/products/${productId}.json`);
    return res.product;
  }

  async createProduct(product: {
    title: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    tags?: string;
    status?: string;
    variants?: any[];
    images?: any[];
    options?: any[];
  }): Promise<any> {
    const res = await this.request<any>('POST', '/products.json', { product });
    return res.product;
  }

  async updateProduct(
    productId: string,
    updates: Record<string, unknown>
  ): Promise<any> {
    const res = await this.request<any>('PUT', `/products/${productId}.json`, {
      product: { id: Number(productId), ...updates },
    });
    return res.product;
  }

  async deleteProduct(productId: string): Promise<void> {
    await this.request<any>('DELETE', `/products/${productId}.json`);
  }

  async getProductCount(params?: {
    status?: string;
    product_type?: string;
  }): Promise<number> {
    const res = await this.request<any>('GET', '/products/count.json', undefined, {
      status: params?.status,
      product_type: params?.product_type,
    });
    return res.count;
  }

  // ─── Product Images ───────────────────────────────────────────

  async getProductImages(productId: string): Promise<any[]> {
    const res = await this.request<any>('GET', `/products/${productId}/images.json`);
    return res.images || [];
  }

  async createProductImage(
    productId: string,
    image: { src?: string; attachment?: string; filename?: string; alt?: string; position?: number }
  ): Promise<any> {
    const res = await this.request<any>('POST', `/products/${productId}/images.json`, { image });
    return res.image;
  }

  async updateProductImage(
    productId: string,
    imageId: string,
    updates: { alt?: string; position?: number }
  ): Promise<any> {
    const res = await this.request<any>('PUT', `/products/${productId}/images/${imageId}.json`, {
      image: { id: Number(imageId), ...updates },
    });
    return res.image;
  }

  async deleteProductImage(productId: string, imageId: string): Promise<void> {
    await this.request<any>('DELETE', `/products/${productId}/images/${imageId}.json`);
  }

  // ─── Product Variants ─────────────────────────────────────────

  async getProductVariants(productId: string): Promise<any[]> {
    const res = await this.request<any>('GET', `/products/${productId}/variants.json`);
    return res.variants || [];
  }

  async createProductVariant(
    productId: string,
    variant: {
      option1?: string;
      option2?: string;
      option3?: string;
      price?: string;
      compare_at_price?: string;
      sku?: string;
      inventory_quantity?: number;
      weight?: number;
      weight_unit?: string;
    }
  ): Promise<any> {
    const res = await this.request<any>('POST', `/products/${productId}/variants.json`, { variant });
    return res.variant;
  }

  async updateProductVariant(
    variantId: string,
    updates: Record<string, unknown>
  ): Promise<any> {
    const res = await this.request<any>('PUT', `/variants/${variantId}.json`, {
      variant: { id: Number(variantId), ...updates },
    });
    return res.variant;
  }

  async deleteProductVariant(productId: string, variantId: string): Promise<void> {
    await this.request<any>('DELETE', `/products/${productId}/variants/${variantId}.json`);
  }

  // ─── Inventory ────────────────────────────────────────────────

  async getLocations(): Promise<any[]> {
    const res = await this.request<any>('GET', '/locations.json');
    return res.locations || [];
  }

  async getInventoryLevels(locationId: string, limit = 250): Promise<any[]> {
    return this.paginatedGet('/inventory_levels.json', 'inventory_levels', {
      location_ids: locationId,
    }, limit);
  }

  async setInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    available: number
  ): Promise<any> {
    const res = await this.request<any>('POST', '/inventory_levels/set.json', {
      location_id: Number(locationId),
      inventory_item_id: Number(inventoryItemId),
      available,
    });
    return res.inventory_level;
  }

  async adjustInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    adjustment: number
  ): Promise<any> {
    const res = await this.request<any>('POST', '/inventory_levels/adjust.json', {
      location_id: Number(locationId),
      inventory_item_id: Number(inventoryItemId),
      available_adjustment: adjustment,
    });
    return res.inventory_level;
  }

  // ─── Collections ──────────────────────────────────────────────

  async getCollections(): Promise<any[]> {
    const custom = await this.paginatedGet('/custom_collections.json', 'custom_collections');
    const smart = await this.paginatedGet('/smart_collections.json', 'smart_collections');
    return [...custom, ...smart];
  }

  // ─── Fulfillment ──────────────────────────────────────────────

  async createFulfillment(
    orderId: string,
    fulfillment: {
      line_items?: { id: number; quantity?: number }[];
      tracking_number?: string;
      tracking_company?: string;
      tracking_url?: string;
      notify_customer?: boolean;
    }
  ): Promise<any> {
    const res = await this.request<any>(
      'POST',
      `/orders/${orderId}/fulfillments.json`,
      { fulfillment }
    );
    return res.fulfillment;
  }

  // ─── Webhooks ─────────────────────────────────────────────────

  async createWebhook(topic: string, address: string): Promise<any> {
    const res = await this.request<any>('POST', '/webhooks.json', {
      webhook: { topic, address, format: 'json' },
    });
    return res.webhook;
  }

  async listWebhooks(): Promise<any[]> {
    const res = await this.request<any>('GET', '/webhooks.json');
    return res.webhooks || [];
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request<any>('DELETE', `/webhooks/${webhookId}.json`);
  }

  // ─── Validation ───────────────────────────────────────────────

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getShopInfo();
      return true;
    } catch {
      return false;
    }
  }
}
