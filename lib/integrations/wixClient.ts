import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';

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

  constructor(credentials: WixCredentials, onTokenRefresh?: TokenRefreshCallback) {
    // Tokens arriving from DB may be encrypted (enc:v1 or legacy base64). The client
    // works with plaintext internally; `decryptIfNeeded` is the single chokepoint.
    this.accessToken = (decryptIfNeeded(credentials.accessToken) as string) || '';
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
    customTextFields?: Array<{ title: string; mandatory: boolean; maxLength: number }>;
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

  // ─── Product media (Stores Catalog V1) ────────────────────
  // VERIFY on a test product before `editor-wix` goes default-on
  // (marketplace-editors §6.2 / §11): the endpoint paths and body shapes below
  // follow the Wix Stores v1 "Add/Remove Product Media" reference.

  /**
   * Attach media to a product. Each item is either a public `url` (Wix fetches
   * and imports it) or the `mediaId` of a file already in the site's Media
   * Manager (used to re-attach existing product media, e.g. on reorder).
   * New items are appended after the existing media.
   */
  async addProductMedia(productId: string, media: WixProductMediaInput[]): Promise<void> {
    if (media.length === 0) return;
    await this.request<any>(`/stores/v1/products/${encodeURIComponent(productId)}/media`, {
      method: 'POST',
      body: JSON.stringify({ media: media.map((m) => ('mediaId' in m ? { mediaId: m.mediaId } : { url: m.url })) }),
    });
  }

  /** Detach media items (ids from `product.media.items[].id`) from a product. */
  async removeProductMedia(productId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    await this.request<any>(`/stores/v1/products/${encodeURIComponent(productId)}/media/delete`, {
      method: 'POST',
      body: JSON.stringify({ mediaIds }),
    });
  }

  /**
   * Put a product's media in the given order. Stores v1 has no reorder call, so
   * this detaches every current item and re-attaches them by `mediaId` in the
   * new order. Guards, all checked before any write:
   * - `orderedMediaIds` must be exactly the product's current media ids (same
   *   set, any order), else `WixClientInputError('MEDIA_SET_MISMATCH')`.
   * - If any option choice has linked media, the detach/re-attach would drop
   *   those links (the re-add carries no choice link), so it refuses with
   *   `WixClientInputError('MEDIA_CHOICE_LINKED')` and writes nothing.
   * If re-attaching fails, the original order is restored. If the restore also
   * fails, the product may have no media: a `WixClientInputError('MEDIA_RESTORE_FAILED')`
   * is thrown carrying the original ids (`params.mediaIds`, comma separated)
   * and the first error message, so the caller can log it and recover.
   * VERIFY on a test product before `editor-wix` goes default-on.
   */
  async reorderProductMedia(productId: string, orderedMediaIds: string[]): Promise<{ order: string[]; changed: boolean }> {
    const product = await this.getProduct(productId);
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

    await this.removeProductMedia(productId, current);
    try {
      await this.addProductMedia(productId, wanted.map((mediaId) => ({ mediaId })));
    } catch (err: any) {
      try {
        await this.addProductMedia(productId, current.map((mediaId) => ({ mediaId })));
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

  /**
   * Absolute per-variant quantities (Stores Catalog V1:
   * PATCH /stores/v2/inventoryItems/product/{productId}). Used by stock sync
   * only when STOCK_WIX_WRITE_VERIFIED=1 (see lib/stock/adapters/wix.ts);
   * verify the shape on a test product before enabling. Sites on Catalog V3
   * reject this endpoint.
   */
  async setInventoryVariantQuantities(productId: string, variants: { variantId: string; quantity: number }[]): Promise<any> {
    return this.request<any>(`/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        inventoryItem: {
          trackQuantity: true,
          variants: variants.map((v) => ({ variantId: v.variantId, quantity: Math.max(0, Math.trunc(v.quantity)) })),
        },
      }),
    });
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

  /**
   * Add products to a manual collection (Stores v1 "Add Products to
   * Collection"). The automatic "All products" collection cannot be changed.
   */
  async addProductsToCollection(collectionId: string, productIds: string[]): Promise<void> {
    if (collectionId === WIX_ALL_PRODUCTS_COLLECTION_ID) {
      throw new WixClientInputError('COLLECTION_PROTECTED', 'The "All products" collection cannot be changed');
    }
    if (productIds.length === 0) return;
    await this.request<any>(`/stores/v1/collections/${encodeURIComponent(collectionId)}/productIds`, {
      method: 'POST',
      body: JSON.stringify({ productIds }),
    });
  }

  /** Remove products from a manual collection (Stores v1 "Remove Products from Collection"). */
  async removeProductsFromCollection(collectionId: string, productIds: string[]): Promise<void> {
    if (collectionId === WIX_ALL_PRODUCTS_COLLECTION_ID) {
      throw new WixClientInputError('COLLECTION_PROTECTED', 'The "All products" collection cannot be changed');
    }
    if (productIds.length === 0) return;
    await this.request<any>(`/stores/v1/collections/${encodeURIComponent(collectionId)}/productIds/delete`, {
      method: 'POST',
      body: JSON.stringify({ productIds }),
    });
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
