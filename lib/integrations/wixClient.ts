import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';
import {
  V3_PRODUCT_FIELDS,
  WIX_STORES_APP_ID,
  WIX_STORES_TREE,
  buildV3ProductCreate,
  buildV3ProductUpdate,
  findAllProductsCategoryId,
  groupInventoryByProduct,
  groupVariantsByProduct,
  isCatalogV1UnsupportedError,
  parseCatalogVersion,
  v3InventoryToV2Item,
  v3MediaIds,
  v3MediaItems,
  wixV3CategoryToCollection,
  wixV3ProductToV1,
  type WixCatalogVersion,
  type WixV3InventoryItem,
} from './wixCatalogV3';

export type { WixCatalogVersion } from './wixCatalogV3';

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

/**
 * Stores catalog version of the site. Unknown (null) = V1 calls are tried and a
 * 501 "Catalog V1 operation is not supported" switches the client to V3 (and
 * `onCatalogVersion` persists it). `resolveCatalogVersion()` asks Wix directly.
 */
export type WixCatalogOptions = {
  catalogVersion?: WixCatalogVersion | null;
  onCatalogVersion?: (version: WixCatalogVersion) => Promise<void> | void;
};

/** Media to attach: a public https URL, or an existing Wix Media Manager id. */
export type WixProductMediaInput = { url: string } | { mediaId: string };

/** Wix's automatic "All products" collection; membership is managed by Wix. */
export const WIX_ALL_PRODUCTS_COLLECTION_ID = '00000000-000000-000000-000000000001';

/** Refused before any request is sent (bad input for a Wix write). */
export class WixClientInputError extends Error {
  code: 'MEDIA_SET_MISMATCH' | 'COLLECTION_PROTECTED' | 'MEDIA_CHOICE_LINKED' | 'MEDIA_RESTORE_FAILED';
  /** Extra detail for recovery (e.g. the original media ids when a reorder restore failed). */
  params?: Record<string, string | number>;
  constructor(code: WixClientInputError['code'], message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'WixClientInputError';
    this.code = code;
    if (params) this.params = params;
  }
}

/**
 * True when any product option choice has its own media (Wix "media linked to
 * choices", e.g. a colour swatch showing its own photo). Detaching and
 * re-attaching product media would drop those links, so reorder refuses.
 */
export function wixHasChoiceLinkedMedia(product: any): boolean {
  const options: any[] = Array.isArray(product?.productOptions) ? product.productOptions : [];
  for (const opt of options) {
    const choices: any[] = Array.isArray(opt?.choices) ? opt.choices : [];
    for (const c of choices) {
      const m = c?.media;
      if (!m) continue;
      if (Array.isArray(m.items) && m.items.length > 0) return true;
      if (m.mainMedia && typeof m.mainMedia === 'object' && Object.keys(m.mainMedia).length > 0) return true;
    }
  }
  return false;
}

/** Ordered media ids of a Stores v1 product (`media.items[].id`). */
export function wixProductMediaIds(product: any): string[] {
  const items: any[] = Array.isArray(product?.media?.items) ? product.media.items : [];
  const ids: string[] = [];
  for (const it of items) {
    const id = typeof it?.id === 'string' ? it.id : '';
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

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
  private catalogVersion: WixCatalogVersion | null;
  private onCatalogVersion?: WixCatalogOptions['onCatalogVersion'];
  private allProductsCategoryId: Promise<string | null> | null = null;

  constructor(credentials: WixCredentials, onTokenRefresh?: TokenRefreshCallback, catalog: WixCatalogOptions = {}) {
    // Tokens arriving from DB may be encrypted (enc:v1 or legacy base64). The client
    // works with plaintext internally; `decryptIfNeeded` is the single chokepoint.
    this.accessToken = (decryptIfNeeded(credentials.accessToken) as string) || '';
    this.instanceId = credentials.instanceId;
    this.siteId = credentials.siteId;
    this.tokenExpiresAt = credentials.tokenExpiresAt;
    this.onTokenRefresh = onTokenRefresh;
    this.catalogVersion = catalog.catalogVersion ?? null;
    this.onCatalogVersion = catalog.onCatalogVersion;
  }

  // ─── Catalog version (V1 / V3) ────────────────────────────

  /** The version this client uses (null = not known yet: V1 is tried first). */
  getKnownCatalogVersion(): WixCatalogVersion | null {
    return this.catalogVersion;
  }

  private async setCatalogVersion(version: WixCatalogVersion): Promise<void> {
    if (this.catalogVersion === version) return;
    this.catalogVersion = version;
    if (this.onCatalogVersion) {
      try {
        await this.onCatalogVersion(version);
      } catch {
        /* persistence is best effort */
      }
    }
  }

  /**
   * Ask Wix which catalog the site uses (GET /stores/v3/provision/version) when
   * not known yet. A failed or unclear answer leaves it unknown (V1 is tried and
   * a 501 switches to V3).
   */
  async resolveCatalogVersion(): Promise<WixCatalogVersion | null> {
    if (this.catalogVersion) return this.catalogVersion;
    try {
      const v = parseCatalogVersion(await this.request<any>('/stores/v3/provision/version'));
      if (v) await this.setCatalogVersion(v);
    } catch {
      /* unknown: fall back to 501 detection */
    }
    return this.catalogVersion;
  }

  /** Run the V3 path on a V3 site, else V1; a V1 call refused as "not supported for Catalog V3" switches to V3. */
  private async catalog<T>(v1: () => Promise<T>, v3: () => Promise<T>): Promise<T> {
    if (this.catalogVersion === 'V3') return v3();
    try {
      return await v1();
    } catch (err) {
      if (!isCatalogV1UnsupportedError(err)) throw err;
      await this.setCatalogVersion('V3');
      return v3();
    }
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
          // Hand the freshly minted token to the persistence callback already encrypted,
          // so callers that pipe it straight into Prisma store it as `enc:v1:`.
          await this.onTokenRefresh({
            accessToken: encryptIfNeeded(this.accessToken) as string,
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

  async searchOrders(params: {
    limit?: number;
    cursor?: string;
    dateCreatedFrom?: string;
    dateCreatedTo?: string;
    contactId?: string;
  } = {}): Promise<{ orders: any[]; cursor?: string; hasNext: boolean }> {
    const filter: any = {};
    if (params.contactId) {
      filter['buyerInfo.contactId'] = { '$eq': params.contactId };
    }
    if (params.dateCreatedFrom || params.dateCreatedTo) {
      filter['createdDate'] = {};
      if (params.dateCreatedFrom) {
        filter['createdDate']['$gte'] = params.dateCreatedFrom;
      }
      if (params.dateCreatedTo) {
        filter['createdDate']['$lte'] = params.dateCreatedTo;
      }
    }

    const body: any = {
      search: {
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        cursorPaging: {
          limit: params.limit || 100,
          ...(params.cursor ? { cursor: params.cursor } : {}),
        },
      },
    };

    const data = await this.request<any>('/ecom/v1/orders/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      orders: data.orders || [],
      cursor: data.metadata?.cursors?.next,
      hasNext: !!data.metadata?.cursors?.next,
    };
  }

  async getOrder(orderId: string): Promise<any> {
    const data = await this.request<any>(`/ecom/v1/orders/${orderId}`);
    return data.order || data;
  }

  // ─── Fulfillments ─────────────────────────────────────────

  /**
   * Create a fulfillment for an order (marks as shipped, sends buyer notification).
   * Wix predefined providers: "fedex", "ups", "usps", "dhl", "canada-post"
   * For custom providers (MNG Kargo, etc.), provide trackingLink manually.
   */
  async createFulfillment(orderId: string, fulfillment: {
    lineItems?: { index: number; quantity: number }[];
    trackingInfo: {
      shippingProvider: string;
      trackingNumber: string;
      trackingLink?: string;
    };
  }): Promise<any> {
    return this.request<any>(`/stores/v2/orders/${orderId}/fulfillments`, {
      method: 'POST',
      body: JSON.stringify({ fulfillment }),
    });
  }

  // ─── Products ─────────────────────────────────────────────
  // Every catalog method keeps its Catalog V1 shape. On a V3 site it calls the
  // V3 endpoints and maps the result to the V1 shape (lib/integrations/wixCatalogV3.ts).

  async queryProducts(params: {
    limit?: number;
    offset?: number;
    includeVariants?: boolean;
  } = {}): Promise<{ products: any[]; totalResults: number }> {
    return this.catalog(
      () => this.v1QueryProducts(params),
      () => this.v3QueryProducts(params.limit || 100, params.offset || 0),
    );
  }

  /**
   * Every product, one page at a time (V1: offset paging; V3: cursor paging,
   * each page enriched with its variants and inventory). Returns the count.
   */
  async forEachProductPage(onPage: (products: any[]) => Promise<void>, pageSize = 100): Promise<number> {
    let seen = 0;
    let firstDone = false;
    const v3 = async () => {
      let cursor: string | undefined;
      do {
        const page = await this.v3ProductPage(pageSize, cursor);
        seen += page.products.length;
        await onPage(page.products);
        cursor = page.next;
      } while (cursor);
      return seen;
    };
    return this.catalog(async () => {
      let offset = 0;
      while (true) {
        const { products, totalResults } = await this.v1QueryProducts({ limit: pageSize, offset });
        firstDone = true;
        seen += products.length;
        await onPage(products);
        offset += pageSize;
        if (offset >= totalResults || products.length === 0) break;
      }
      return seen;
    }, async () => {
      // A V1 page already handed out can't have been from a V3 site (it would have failed first).
      if (firstDone) throw new Error('Wix catalog changed version during the sync');
      return v3();
    });
  }

  async getProduct(productId: string): Promise<any> {
    return this.catalog(
      async () => {
        const data = await this.request<any>(`/stores/v1/products/${productId}`);
        return data.product || data;
      },
      () => this.v3GetMappedProduct(productId),
    );
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
    customTextFields?: Array<{ title: string; mandatory: boolean; maxLength: number }>;
  }): Promise<any> {
    return this.catalog(
      async () => {
        const data = await this.request<any>('/stores/v1/products', {
          method: 'POST',
          body: JSON.stringify({ product: productData }),
        });
        return data.product || data;
      },
      async () => {
        const data = await this.request<any>('/stores/v3/products-with-inventory', {
          method: 'POST',
          body: JSON.stringify(buildV3ProductCreate(productData as Record<string, any>)),
        });
        const id = data?.product?.id;
        return id ? this.v3GetMappedProduct(id) : data?.product || data;
      },
    );
  }

  async updateProduct(productId: string, productData: Record<string, any>): Promise<any> {
    return this.catalog(
      async () => {
        const data = await this.request<any>(`/stores/v1/products/${productId}`, {
          method: 'PATCH',
          body: JSON.stringify({ product: productData }),
        });
        return data.product || data;
      },
      async () => {
        const current = await this.v3GetRawProduct(productId);
        const product = buildV3ProductUpdate(productData, current);
        await this.request<any>(`/stores/v3/products/${encodeURIComponent(productId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ product }),
        });
        return this.v3GetMappedProduct(productId);
      },
    );
  }

  async deleteProduct(productId: string): Promise<void> {
    await this.catalog(
      () => this.request(`/stores/v1/products/${productId}`, { method: 'DELETE' }),
      () => this.request(`/stores/v3/products/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
    );
  }

  // ─── Product media ────────────────────────────────────────
  // V1: the Stores v1 "Add/Remove Product Media" endpoints. VERIFY on a test
  // product before `editor-wix` goes default-on (marketplace-editors §6.2 / §11).
  // V3: media is a product field: the whole `media.itemsInfo.items` list is sent
  // in one Update Product (existing items by id, new ones by url or Media Manager id).

  /**
   * Attach media to a product. Each item is either a public `url` (Wix fetches
   * and imports it) or the `mediaId` of a file already in the site's Media
   * Manager (used to re-attach existing product media, e.g. on reorder).
   * New items are appended after the existing media.
   */
  async addProductMedia(productId: string, media: WixProductMediaInput[]): Promise<void> {
    if (media.length === 0) return;
    await this.catalog(
      () => this.v1AddProductMedia(productId, media),
      () => this.v3SetMedia(productId, { add: media }),
    );
  }

  /** Detach media items (ids from `product.media.items[].id`) from a product. */
  async removeProductMedia(productId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    await this.catalog(
      () => this.v1RemoveProductMedia(productId, mediaIds),
      () => this.v3SetMedia(productId, { remove: mediaIds }),
    );
  }

  /**
   * Put a product's media in the given order.
   * - `orderedMediaIds` must be exactly the product's current media ids (same
   *   set, any order), else `WixClientInputError('MEDIA_SET_MISMATCH')`.
   * V1 has no reorder call, so it detaches every current item and re-attaches
   * them by `mediaId` in the new order:
   * - If any option choice has linked media, the detach/re-attach would drop
   *   those links (the re-add carries no choice link), so it refuses with
   *   `WixClientInputError('MEDIA_CHOICE_LINKED')` and writes nothing.
   * - If re-attaching fails, the original order is restored. If the restore also
   *   fails, the product may have no media: a `WixClientInputError('MEDIA_RESTORE_FAILED')`
   *   is thrown carrying the original ids (`params.mediaIds`, comma separated)
   *   and the first error message, so the caller can log it and recover.
   * V3 sends the reordered list in one Update Product (choice links are kept).
   */
  async reorderProductMedia(productId: string, orderedMediaIds: string[]): Promise<{ order: string[]; changed: boolean }> {
    return this.catalog(
      () => this.v1ReorderProductMedia(productId, orderedMediaIds),
      async () => {
        const raw = await this.v3GetRawProduct(productId);
        const current = v3MediaIds(raw);
        const wanted = Array.from(new Set(orderedMediaIds));
        const sameSet = wanted.length === current.length && wanted.every((id) => current.includes(id));
        if (!sameSet) throw new WixClientInputError('MEDIA_SET_MISMATCH', 'Reorder ids must match the product media exactly');
        if (wanted.every((id, i) => id === current[i])) return { order: current, changed: false };
        await this.v3SetMedia(productId, { order: wanted }, raw);
        return { order: wanted, changed: true };
      },
    );
  }

  private async v1AddProductMedia(productId: string, media: WixProductMediaInput[]): Promise<void> {
    if (media.length === 0) return;
    await this.request<any>(`/stores/v1/products/${encodeURIComponent(productId)}/media`, {
      method: 'POST',
      body: JSON.stringify({ media: media.map((m) => ('mediaId' in m ? { mediaId: m.mediaId } : { url: m.url })) }),
    });
  }

  private async v1RemoveProductMedia(productId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    await this.request<any>(`/stores/v1/products/${encodeURIComponent(productId)}/media/delete`, {
      method: 'POST',
      body: JSON.stringify({ mediaIds }),
    });
  }

  private async v1ReorderProductMedia(productId: string, orderedMediaIds: string[]): Promise<{ order: string[]; changed: boolean }> {
    const data = await this.request<any>(`/stores/v1/products/${productId}`);
    const product = data.product || data;
    const current = wixProductMediaIds(product);
    const wanted = Array.from(new Set(orderedMediaIds));
    const sameSet = wanted.length === current.length && wanted.every((id) => current.includes(id));
    if (!sameSet) {
      throw new WixClientInputError('MEDIA_SET_MISMATCH', 'Reorder ids must match the product media exactly');
    }
    if (wanted.every((id, i) => id === current[i])) return { order: current, changed: false };
    if (wixHasChoiceLinkedMedia(product)) {
      throw new WixClientInputError('MEDIA_CHOICE_LINKED', 'Product has media linked to option choices; reorder would drop those links');
    }

    await this.v1RemoveProductMedia(productId, current);
    try {
      await this.v1AddProductMedia(productId, wanted.map((mediaId) => ({ mediaId })));
    } catch (err: any) {
      try {
        await this.v1AddProductMedia(productId, current.map((mediaId) => ({ mediaId })));
      } catch (restoreErr: any) {
        throw new WixClientInputError(
          'MEDIA_RESTORE_FAILED',
          `Wix media reorder failed and the original media could not be re-attached (product ${productId}): ${err?.message || err}; restore: ${restoreErr?.message || restoreErr}`,
          { productId, mediaIds: current.join(',') },
        );
      }
      throw err;
    }
    return { order: wanted, changed: true };
  }

  // ─── Inventory ────────────────────────────────────────────
  // V1: Stores V2 inventory items (one per product, `variants[]`).
  // V3: Inventory Items V3 (one per variant); returned in the V2 shape with
  // `id` = the product id, which `updateInventoryVariants` takes back.

  async getInventoryItem(productId: string): Promise<any> {
    return this.catalog(
      async () => {
        const data = await this.request<any>(`/stores/v2/inventoryItems/product/${productId}`);
        return data.inventoryItem || data;
      },
      async () => {
        const items = (await this.v3InventoryFor([productId])).get(productId) || [];
        return items.length ? v3InventoryToV2Item(productId, items) : null;
      },
    );
  }

  /** Change variant quantities by a difference (`quantity` = increment). V3: `inventoryItemId` is the product id. */
  async updateInventoryVariants(inventoryItemId: string, variants: { variantId: string; quantity: number }[]): Promise<any> {
    return this.catalog(
      () =>
        this.request<any>(`/stores/v2/inventoryItems/${inventoryItemId}/incrementInventory`, {
          method: 'POST',
          body: JSON.stringify({
            incrementData: variants.map(v => ({
              variantId: v.variantId,
              incrementBy: v.quantity,
            })),
          }),
        }),
      async () => {
        const items = (await this.v3InventoryFor([inventoryItemId])).get(inventoryItemId) || [];
        return this.v3UpdateQuantities(items, variants.map((v) => {
          const it = items.find((i) => i.variantId === v.variantId);
          return { variantId: v.variantId, quantity: (Number(it?.quantity) || 0) + v.quantity };
        }));
      },
    );
  }

  /**
   * Absolute per-variant quantities. V1: PATCH /stores/v2/inventoryItems/product/{productId}.
   * V3: Bulk Update Inventory Items (with each item's revision). Used by stock
   * sync only when STOCK_WIX_WRITE_VERIFIED=1 (see lib/stock/adapters/wix.ts);
   * verify on a test product before enabling.
   */
  async setInventoryVariantQuantities(productId: string, variants: { variantId: string; quantity: number }[]): Promise<any> {
    return this.catalog(
      () =>
        this.request<any>(`/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            inventoryItem: {
              trackQuantity: true,
              variants: variants.map((v) => ({ variantId: v.variantId, quantity: Math.max(0, Math.trunc(v.quantity)) })),
            },
          }),
        }),
      async () => {
        const items = (await this.v3InventoryFor([productId])).get(productId) || [];
        return this.v3UpdateQuantities(items, variants);
      },
    );
  }

  // ─── Collections (V1) / Categories (V3) ───────────────────

  async queryCollections(params: { limit?: number; offset?: number } = {}): Promise<{ collections: any[]; totalResults: number }> {
    return this.catalog(
      async () => {
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
      },
      async () => {
        const all = (await this.v3Categories()).map(wixV3CategoryToCollection);
        const offset = params.offset || 0;
        return { collections: all.slice(offset, offset + (params.limit || 100)), totalResults: all.length };
      },
    );
  }

  /**
   * Add products to a manual collection (V1 "Add Products to Collection"; V3
   * "Bulk Add Items To Category"). The automatic "All products" collection cannot be changed.
   */
  async addProductsToCollection(collectionId: string, productIds: string[]): Promise<void> {
    if (collectionId === WIX_ALL_PRODUCTS_COLLECTION_ID) {
      throw new WixClientInputError('COLLECTION_PROTECTED', 'The "All products" collection cannot be changed');
    }
    if (productIds.length === 0) return;
    await this.catalog(
      () =>
        this.request<any>(`/stores/v1/collections/${encodeURIComponent(collectionId)}/productIds`, {
          method: 'POST',
          body: JSON.stringify({ productIds }),
        }),
      () => this.v3CategoryItems(collectionId, productIds, 'add-items'),
    );
  }

  /** Remove products from a manual collection (V1 "Remove Products from Collection"; V3 "Bulk Remove Items From Category"). */
  async removeProductsFromCollection(collectionId: string, productIds: string[]): Promise<void> {
    if (collectionId === WIX_ALL_PRODUCTS_COLLECTION_ID) {
      throw new WixClientInputError('COLLECTION_PROTECTED', 'The "All products" collection cannot be changed');
    }
    if (productIds.length === 0) return;
    await this.catalog(
      () =>
        this.request<any>(`/stores/v1/collections/${encodeURIComponent(collectionId)}/productIds/delete`, {
          method: 'POST',
          body: JSON.stringify({ productIds }),
        }),
      () => this.v3CategoryItems(collectionId, productIds, 'remove-items'),
    );
  }

  // ─── Catalog V1 / V3 internals ────────────────────────────

  private async v1QueryProducts(params: { limit?: number; offset?: number; includeVariants?: boolean }): Promise<{ products: any[]; totalResults: number }> {
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

  /** One page of V3 products (Query Products, cursor paging) mapped to the V1 shape with variants + inventory. */
  private async v3ProductPage(limit: number, cursor?: string): Promise<{ products: any[]; next?: string }> {
    const data = await this.request<any>('/stores/v3/products/query', {
      method: 'POST',
      body: JSON.stringify({
        query: { cursorPaging: { limit: Math.min(100, Math.max(1, limit)), ...(cursor ? { cursor } : {}) } },
        fields: V3_PRODUCT_FIELDS,
      }),
    });
    const raw: any[] = Array.isArray(data?.products) ? data.products : [];
    const ids = raw.map((p) => p?.id).filter((id): id is string => typeof id === 'string');
    const [variants, inventory, allId] = ids.length
      ? await Promise.all([this.v3VariantsFor(ids), this.v3InventoryFor(ids), this.v3AllProductsCategoryId()])
      : [new Map<string, any[]>(), new Map<string, WixV3InventoryItem[]>(), null];
    const products = raw.map((p) =>
      wixV3ProductToV1(p, { variants: variants.get(p.id) || [], inventory: inventory.get(p.id) || [], allProductsCategoryId: allId }),
    );
    const next = data?.pagingMetadata?.hasNext ? data?.pagingMetadata?.cursors?.next : undefined;
    return { products, next: next || undefined };
  }

  /** Offset paging on V3 (walks the cursor pages; the list action only). */
  private async v3QueryProducts(limit: number, offset: number): Promise<{ products: any[]; totalResults: number }> {
    const out: any[] = [];
    let skipped = 0;
    let cursor: string | undefined;
    do {
      const page = await this.v3ProductPage(100, cursor);
      for (const p of page.products) {
        if (skipped < offset) skipped++;
        else if (out.length < limit) out.push(p);
      }
      cursor = out.length < limit ? page.next : undefined;
    } while (cursor);
    let totalResults = offset + out.length;
    try {
      const c = await this.request<any>('/stores/v3/products/count', { method: 'POST', body: JSON.stringify({}) });
      if (typeof c?.count === 'number') totalResults = c.count;
    } catch {
      /* count is best effort */
    }
    return { products: out, totalResults };
  }

  private async v3GetRawProduct(productId: string): Promise<any> {
    const qs = V3_PRODUCT_FIELDS.map((f) => `fields=${f}`).join('&');
    const data = await this.request<any>(`/stores/v3/products/${encodeURIComponent(productId)}?${qs}`);
    return data?.product || data;
  }

  private async v3GetMappedProduct(productId: string): Promise<any> {
    const [raw, inventory, allId] = await Promise.all([
      this.v3GetRawProduct(productId),
      this.v3InventoryFor([productId]),
      this.v3AllProductsCategoryId(),
    ]);
    return wixV3ProductToV1(raw, { inventory: inventory.get(productId) || [], allProductsCategoryId: allId });
  }

  /** Read-Only Variants API for up to 100 products. */
  private async v3VariantsFor(productIds: string[]): Promise<Map<string, any[]>> {
    const rows: any[] = [];
    let cursor: string | undefined;
    do {
      const data = await this.request<any>('/stores/v3/products/query-variants', {
        method: 'POST',
        body: JSON.stringify({
          fields: ['CURRENCY'],
          query: cursor ? { cursorPaging: { limit: 1000, cursor } } : { filter: { 'productData.productId': { $in: productIds } }, cursorPaging: { limit: 1000 } },
        }),
      });
      rows.push(...(Array.isArray(data?.variants) ? data.variants : []));
      cursor = data?.pagingMetadata?.hasNext ? data?.pagingMetadata?.cursors?.next : undefined;
    } while (cursor);
    return groupVariantsByProduct(rows);
  }

  /** Inventory Items V3 of the given products. */
  private async v3InventoryFor(productIds: string[]): Promise<Map<string, WixV3InventoryItem[]>> {
    const rows: any[] = [];
    let cursor: string | undefined;
    do {
      const data = await this.request<any>('/stores/v3/inventory-items/query', {
        method: 'POST',
        body: JSON.stringify({
          query: cursor ? { cursorPaging: { limit: 1000, cursor } } : { filter: { productId: { $in: productIds } }, cursorPaging: { limit: 1000 } },
        }),
      });
      const page = Array.isArray(data?.inventoryItems) ? data.inventoryItems : [];
      rows.push(...page);
      cursor = page.length ? data?.pagingMetadata?.cursors?.next : undefined;
    } while (cursor);
    return groupInventoryByProduct(rows);
  }

  /** Absolute quantities on V3 inventory items (each with its revision). */
  private async v3UpdateQuantities(items: WixV3InventoryItem[], variants: { variantId: string; quantity: number }[]): Promise<any> {
    const updates = variants.map((v) => {
      const it = items.find((i) => i.variantId === v.variantId);
      if (!it) throw new Error(`Wix API 404: inventory item not found for variant ${v.variantId}`);
      return { inventoryItem: { id: it.id, revision: it.revision, quantity: Math.max(0, Math.trunc(v.quantity)) } };
    });
    if (!updates.length) return { results: [] };
    const data = await this.request<any>('/stores/v3/bulk/inventory-items/update', {
      method: 'POST',
      body: JSON.stringify({ inventoryItems: updates, reason: 'MANUAL', returnEntity: false }),
    });
    const failed = (Array.isArray(data?.results) ? data.results : []).filter((r: any) => r?.itemMetadata?.success === false);
    if (failed.length) {
      throw new Error(`Wix API 409: inventory update failed for ${failed.length} item(s): ${failed.map((r: any) => r?.itemMetadata?.error?.description || r?.itemMetadata?.error?.code).join('; ')}`);
    }
    return data;
  }

  /** Update Product with a new `media.itemsInfo.items` list. */
  private async v3SetMedia(productId: string, change: Parameters<typeof v3MediaItems>[1], raw?: any): Promise<void> {
    const current = raw ?? (await this.v3GetRawProduct(productId));
    const items = v3MediaItems(v3MediaIds(current), change);
    await this.request<any>(`/stores/v3/products/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ product: { id: productId, revision: current?.revision, media: { itemsInfo: { items } } } }),
    });
  }

  /** All Wix Stores categories (visible and hidden). */
  private async v3Categories(): Promise<any[]> {
    const out: any[] = [];
    let cursor: string | undefined;
    do {
      const data = await this.request<any>('/categories/v1/categories/query', {
        method: 'POST',
        body: JSON.stringify({
          query: { cursorPaging: { limit: 1000, ...(cursor ? { cursor } : {}) } },
          treeReference: WIX_STORES_TREE,
          returnNonVisibleCategories: true,
        }),
      });
      out.push(...(Array.isArray(data?.categories) ? data.categories : []));
      cursor = data?.pagingMetadata?.hasNext ? data?.pagingMetadata?.cursors?.next : undefined;
    } while (cursor);
    this.allProductsCategoryId = Promise.resolve(findAllProductsCategoryId(out));
    return out;
  }

  /** Real id of the automatic "All Products" category (cached per client; null when unreadable). */
  private v3AllProductsCategoryId(): Promise<string | null> {
    if (!this.allProductsCategoryId) {
      this.allProductsCategoryId = this.v3Categories()
        .then((cats) => findAllProductsCategoryId(cats))
        .catch(() => {
          this.allProductsCategoryId = null;
          return null;
        });
    }
    return this.allProductsCategoryId;
  }

  private async v3CategoryItems(categoryId: string, productIds: string[], op: 'add-items' | 'remove-items'): Promise<void> {
    const data = await this.request<any>(`/categories/v1/bulk/categories/${encodeURIComponent(categoryId)}/${op}`, {
      method: 'POST',
      body: JSON.stringify({
        items: productIds.map((catalogItemId) => ({ catalogItemId, appId: WIX_STORES_APP_ID })),
        treeReference: WIX_STORES_TREE,
      }),
    });
    const failed = (Array.isArray(data?.results) ? data.results : []).filter((r: any) => r?.itemMetadata?.success === false);
    if (failed.length) {
      throw new Error(`Wix API 409: category ${op === 'add-items' ? 'add' : 'remove'} failed for ${failed.length} product(s): ${failed.map((r: any) => r?.itemMetadata?.error?.description || r?.itemMetadata?.error?.code).join('; ')}`);
    }
  }

  // ─── Inbox / Conversations ────────────────────────────────
  // Wix Inbox REST API has NO "list conversations" endpoint.
  // Workaround: query CRM contacts → get-or-create conversation per contact → list messages.

  /**
   * Query CRM contacts to find people who may have conversations.
   */
  async queryContacts(params: { limit?: number; cursor?: string } = {}): Promise<any> {
    return this.request<any>('/contacts/v4/contacts/query', {
      method: 'POST',
      body: JSON.stringify({
        query: {
          paging: { limit: params.limit || 50, ...(params.cursor ? { cursor: params.cursor } : {}) },
          sort: [{ fieldName: 'lastActivity.activityDate', order: 'DESC' }],
        },
      }),
    });
  }

  /**
   * Get or create a conversation for a contact/member/visitor.
   * Returns { conversation: { id, ... } }
   */
  async getOrCreateConversation(participantId: { contactId?: string; memberId?: string; visitorId?: string }): Promise<any> {
    return this.request<any>('/inbox/v2/conversations', {
      method: 'POST',
      body: JSON.stringify({ participantId }),
    });
  }

  /**
   * Get a single conversation by ID.
   */
  async getConversation(conversationId: string): Promise<any> {
    return this.request<any>(`/inbox/v2/conversations/${conversationId}`);
  }

  /**
   * List messages in a conversation (up to 30 per page).
   */
  async getConversationMessages(conversationId: string, params: { limit?: number; cursor?: string } = {}): Promise<any> {
    const qs = new URLSearchParams();
    qs.set('conversationId', conversationId);
    qs.set('visibility', 'BUSINESS_AND_PARTICIPANT');
    if (params.cursor) qs.set('paging.cursor', params.cursor);
    return this.request<any>(`/inbox/v2/messages?${qs.toString()}`);
  }

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId: string, message: { text: string }): Promise<any> {
    return this.request<any>('/inbox/v2/messages', {
      method: 'POST',
      body: JSON.stringify({
        conversationId,
        message: {
          direction: 'BUSINESS_TO_PARTICIPANT',
          visibility: 'BUSINESS_AND_PARTICIPANT',
          content: {
            basic: {
              items: [{ text: message.text }],
            },
          },
        },
      }),
    });
  }

  /**
   * List conversations using CRM Contacts API (single query) + batch get-or-create.
   * Much faster than the old order-based approach (~3 API calls vs ~40).
   */
  async listConversations(params: { limit?: number } = {}): Promise<{ conversations: any[] }> {
    const limit = params.limit || 20;

    // Step 1: Get recent contacts (single API call, sorted by last activity)
    const contactsData = await this.queryContacts({ limit });
    const contacts = contactsData.contacts || [];
    if (contacts.length === 0) return { conversations: [] };

    // Step 2: Get-or-create conversations (parallel, no message fetching for speed)
    const conversations: any[] = [];
    const batchSize = 10;
    for (let i = 0; i < contacts.length; i += batchSize) {
      const batch = contacts.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (contact: any) => {
          try {
            const contactId = contact.id;
            if (!contactId) return null;
            const convData = await this.getOrCreateConversation({ contactId });
            const conv = convData.conversation;
            if (conv) {
              const name = [contact.info?.name?.first, contact.info?.name?.last]
                .filter(Boolean).join(' ') || contact.primaryInfo?.email || 'Customer';
              conv._contactId = contactId;
              conv._contactName = name;
              conv._contactEmail = contact.primaryInfo?.email;
              conv.lastActivityDate = contact.lastActivity?.activityDate;
              return conv;
            }
          } catch {
            // Contact may not have a conversation — skip
          }
          return null;
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) conversations.push(r.value);
      }
    }

    return { conversations };
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
  onTokenRefresh?: TokenRefreshCallback,
  catalog?: WixCatalogOptions,
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
    onTokenRefresh,
    catalog,
  );
}
