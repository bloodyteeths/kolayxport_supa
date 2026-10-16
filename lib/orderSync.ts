import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from './logger';
import { startSync, updateSyncProgress as updateSyncStatus, completeSync } from './sync-status';
import { SyncType } from './types';
import fetch from 'node-fetch';
import { UIOrder, OrderSource, OrderChannel, NormalizedAddress, NormalizedLineItem } from './types';
import { getIntegrationCreds } from './config';
import { decryptIfNeeded } from './crypto/credentials';
import { fetchVeeqoOrders, processOrdersInBatches } from './integrations/veeqo';
import { fetchShippoOrders } from './integrations/shippo';
import { fetchEbayOrders } from './integrations/ebayOrderSync';
import type { VeeqoOrder } from './types';
import { notify, resolveNotification, notificationKeys, NOTIFICATION_LINKS } from './notifications';
import { publishOrderWrites } from './orders/marketplaceOrderWrite';
import type { LiveOrderKind } from './live/types';
import { computeItemsHash, computeOrderHash, itemsHashFromDbRows } from './orders/orderHash';
import { earliestLineShipBy, linesFromUIOrder, upsertOrderItems, type UpsertLine } from './orders/itemUpsert';
import { hasStreet, mergeAddressPreferNonEmpty, mergeNamePreferNonEmpty, parseStoredAddress, sameAddress } from './orders/addressMerge';
import { classifyOrderStatus, isRecentOrderDate, liveKindForOrderWrite } from './orders/orderStatus';
import { deriveOrderEffects, hasOrderEffects, insertOrderEffects, kickOrderEffects, quietForExistingWrite } from './orders/orderEffects';

const ORDER_SYNC_PROVIDER_LABELS: Record<string, string> = {
  veeqo: 'Veeqo',
  shippo: 'Shippo',
  amazon: 'Amazon',
  etsy: 'Etsy',
  ebay: 'eBay',
};

/** Fire-and-forget orderSyncFailed notification (one row per provider). */
function notifyOrderSyncFailed(userId: string, provider: string) {
  void notify(userId, {
    type: 'orderSyncFailed',
    severity: 'warning',
    titleKey: 'types.orderSyncFailed',
    params: { provider: ORDER_SYNC_PROVIDER_LABELS[provider] || provider },
    link: NOTIFICATION_LINKS.labels,
    dedupeKey: notificationKeys.orderSync(provider),
    // Fires on every failed fetch (cron every 15 min); resolve() on success re-arms it.
    onlyIfNew: true,
  });
}

/**
 * Wraps one provider's fetch: success resolves its orderSyncFailed
 * notification, failure raises it. The promise outcome is passed through
 * unchanged (rejections are re-thrown).
 *
 * Caveat: fetchVeeqoOrders / fetchShippoOrders currently swallow HTTP errors
 * and resolve with [] / partial results, so only mapping errors reject here.
 * Etsy/eBay fetchers swallow everything and are therefore NOT wrapped.
 */
function trackOrderSource<T>(userId: string, provider: string, promise: Promise<T>): Promise<T> {
  return promise.then(
    (value) => {
      void resolveNotification(userId, notificationKeys.orderSync(provider));
      return value;
    },
    (err) => {
      notifyOrderSyncFailed(userId, provider);
      throw err;
    },
  );
}

function splitName(fullName: string) {
  const parts = (fullName || '').trim().split(/\\s+/);
  const firstName = parts.shift() || '';
  const lastName = parts.join(' ');
  return { first: firstName, last: lastName };
}

const TRANSACTION_TIMEOUT = 10000; // 10 second timeout for transactions
const VEEQO_MAX_RETRIES = 5; // Total attempts
const VEEQO_INITIAL_DELAY = 2000; // ms
const VEEQO_MAX_DELAY = 60000; // ms (max wait on repeated rate limits)

interface SyncResult {
  success: boolean;
  syncId: string;
  totalOrders: number;
  processedOrders: number;
  successfulOrders: number;
  failedOrders: number;
  errors: Array<{ orderId: string; error: string }>;
}

interface VeeqoSellable {
  product_title: string;
  sku_code: string;
  variant_options_string?: string;
  images?: Array<{ url: string }>;
  image_url?: string;
  main_thumbnail_url?: string;
  name?: string;
  title?: string;
  sku?: string;
  full_title?: string;
}

interface VeeqoProduct {
  title?: string;
  image_url?: string;
  main_thumbnail_url?: string;
  images?: Array<{ url: string }>;
  name?: string;
  sku?: string;
}

interface VeeqoLineItem {
  id: string;
  product_title?: string;
  variation_sku?: string;
  price?: number;
  quantity: number;
  notes?: string;
  product_image?: string | {
    small_thumbnail_url?: string;
    medium_thumbnail_url?: string;
    large_thumbnail_url?: string;
    original_url?: string;
  };
  variation_title?: string;
  image_url?: string;
  sellable?: {
    id?: string;
    image_url?: string;
    main_thumbnail_url?: string;
    small_thumbnail_url?: string;
    medium_thumbnail_url?: string;
    large_thumbnail_url?: string;
    original_url?: string;
    images?: Array<{ url: string }>;
    full_title?: string;
    product_title?: string;
    sellable_title?: string;
    sku_code?: string;
  };
  product?: {
    id?: string;
    image_url?: string;
    main_thumbnail_url?: string;
    small_thumbnail_url?: string;
    medium_thumbnail_url?: string;
    large_thumbnail_url?: string;
    original_url?: string;
    images?: Array<{ url: string }>;
  };
  title?: string;
  name?: string;
  additional_options?: string;
  line_item_id?: string;
  weight?: number;
  harmonized_code?: string;
  country_of_manufacture?: string;
  product_id?: string;
  variant_options_string?: string;
  sku?: string;
  full_title?: string;
}

// Add Shippo types
interface ShippoOrder {
  object_id: string;
  order_status: string;
  placed_at: string;
  total_price: string;
  currency: string;
  shipping_address: {
    name: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    phone: string | null;
    email: string | null;
  };
  line_items: Array<{
    object_id: string;
    title: string;
    quantity: number;
    total_price: string;
    currency: string;
    weight: string;
    sku: string | null;
  }>;
  metadata?: { notes?: string };
  order_number?: string;
}

interface ShippoResponse {
  results: ShippoOrder[];
  count: number;
  has_more: boolean;
}

interface ShippoAddress {
  name?: string;
  phone?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

function determineChannel(order: any): OrderChannel {
  // Check Veeqo structure
  const veeqoChannelType = order.channel?.type_code?.toLowerCase();
  if (veeqoChannelType) {
    if (veeqoChannelType.includes('etsy')) return 'etsy';
    if (veeqoChannelType.includes('shopify')) return 'shopify';
    if (veeqoChannelType.includes('amazon')) return 'amazon';
    if (veeqoChannelType.includes('ebay')) return 'ebay';
  }

  // Check Shippo structure
  const shippoShopApp = order.shop_app?.toLowerCase();
  if (shippoShopApp) {
    if (shippoShopApp.includes('etsy')) return 'etsy';
    if (shippoShopApp.includes('shopify')) return 'shopify';
    if (shippoShopApp.includes('amazon')) return 'amazon';
    if (shippoShopApp.includes('ebay')) return 'ebay';
  }

  // Fallback to marketplace field (from DB model) with robust Etsy detection
  const { isEtsyOrderSync } = require('./utils/etsyDetection');
  if (isEtsyOrderSync(order.marketplace)) return 'etsy';
  
  const marketplace = order.marketplace?.toLowerCase() || '';
  if (marketplace.includes('shopify')) return 'shopify';
  if (marketplace.includes('amazon')) return 'amazon';
  if (marketplace.includes('ebay')) return 'ebay';
  if (marketplace.includes('wix')) return 'wix';

  return 'other';
}

function normalizeShippoAddress(raw: any): NormalizedAddress {
  if (!raw) return {
    name: '',
    phone: '',
    street1: '',
    street2: '',
    city: '',
    state: '',
    postal: '',
    country: '',
    isResidential: false
  };

  return {
    name: raw.name || '',
    phone: raw.phone || '',
    street1: raw.street1 || '',
    street2: raw.street2 || '',
    city: raw.city || '',
    state: raw.state || '',
    postal: raw.postal || raw.zip || '',
    country: raw.country || '',
    isResidential: raw.is_residential || false,
    company: raw.company || ''
  };
}

function normalizeVeeqoAddress(raw: any): NormalizedAddress {
  if (!raw) return {
    name: '',
    phone: '',
    street1: '',
    street2: '',
    city: '',
    state: '',
    postal: '',
    country: '',
    isResidential: false
  };

  const firstName = raw.first_name || '';
  const lastName = raw.last_name || '';
  
  return {
    name: `${firstName} ${lastName}`.trim(),
    phone: raw.phone || '',
    street1: raw.address1 || raw.street1 || '',
    street2: raw.address2 || raw.street2 || '',
    city: raw.city || '',
    state: raw.state || '',
    postal: raw.zip || raw.postal || '',
    country: raw.country || '',
    isResidential: raw.is_residential || false,
    company: raw.company || ''
  };
}

// Function to fetch Etsy address from EtsyAddress table
async function getEtsyAddress(userId: string, orderNumber: string, marketplace?: string): Promise<any | null> {
  // Import Etsy detection utility
  const { isEtsyOrderSync } = await import('./utils/etsyDetection');
  
  // Use robust Etsy detection instead of simple string comparison
  if (!isEtsyOrderSync(marketplace)) {
    return null;
  }
  
  try {
    // Try to find address data from Etsy extension
    const etsyAddress = await prisma.etsyAddress.findFirst({
      where: {
        userId,
        orderNumber
      },
      select: {
        shippingAddress: true,
        notes: true,
        etsyStoreId: true,
        etsyStoreName: true
      }
    });
    
    return etsyAddress;
  } catch (error) {
    logger.error(`Failed to fetch Etsy address for user ${userId}, order ${orderNumber}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// Full country name → ISO-2 map covering every destination the Etsy seller
// dashboard renders. The extension scrapes rendered text, so we can receive
// either the ISO code ("TR", "US") or the display name ("Turkey", "United
// States") depending on the buyer's browser locale.
const ETSY_COUNTRY_NAME_TO_ISO: Record<string, string> = {
  'united states': 'US', 'usa': 'US', 'u.s.': 'US', 'u.s.a.': 'US',
  'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB', 'england': 'GB',
  'canada': 'CA', 'australia': 'AU', 'new zealand': 'NZ',
  'germany': 'DE', 'deutschland': 'DE',
  'france': 'FR', 'italy': 'IT', 'italia': 'IT',
  'spain': 'ES', 'españa': 'ES', 'espana': 'ES',
  'netherlands': 'NL', 'holland': 'NL',
  'belgium': 'BE', 'switzerland': 'CH', 'austria': 'AT',
  'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK', 'finland': 'FI', 'iceland': 'IS',
  'ireland': 'IE', 'portugal': 'PT',
  'poland': 'PL', 'czech republic': 'CZ', 'czechia': 'CZ',
  'hungary': 'HU', 'romania': 'RO', 'bulgaria': 'BG',
  'greece': 'GR', 'turkey': 'TR', 'türkiye': 'TR', 'turkiye': 'TR',
  'russia': 'RU', 'ukraine': 'UA',
  'japan': 'JP', 'south korea': 'KR', 'korea': 'KR', 'china': 'CN',
  'india': 'IN', 'singapore': 'SG', 'hong kong': 'HK', 'taiwan': 'TW',
  'thailand': 'TH', 'vietnam': 'VN', 'indonesia': 'ID', 'malaysia': 'MY', 'philippines': 'PH',
  'mexico': 'MX', 'brazil': 'BR', 'argentina': 'AR', 'chile': 'CL', 'colombia': 'CO', 'peru': 'PE',
  'south africa': 'ZA', 'egypt': 'EG', 'israel': 'IL',
  'saudi arabia': 'SA', 'united arab emirates': 'AE', 'uae': 'AE',
};

function normalizeCountryCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Already an ISO code
  if (trimmed.length === 2 && /^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  if (ETSY_COUNTRY_NAME_TO_ISO[lower]) return ETSY_COUNTRY_NAME_TO_ISO[lower];
  // 3-letter ISO — take first 2 (rough) or return as-is
  if (trimmed.length === 3 && /^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  return trimmed.toUpperCase();
}

// Normalize Etsy address from extension data
function normalizeEtsyAddress(etsyAddressData: any): NormalizedAddress | undefined {
  if (!etsyAddressData?.shippingAddress) {
    return undefined;
  }

  const addr = etsyAddressData.shippingAddress;
  // Extension may send any of these depending on which DOM node it grabbed:
  // `country` (usually the display name), `countryCode` / `country_iso`
  // (ISO-2), or `countryName` (full name). Try them in that order, then
  // normalize to an ISO-2 code so downstream (label generation, filters)
  // treats "United States", "US", and "USA" as the same country.
  const rawCountry =
    addr.country_iso ??
    addr.countryCode ??
    addr.country_code ??
    addr.country ??
    addr.countryName ??
    '';
  const country = normalizeCountryCode(rawCountry);

  return {
    name: addr.name || '',
    phone: addr.phone || '',
    street1: addr.line1 || addr.street1 || '',
    street2: addr.line2 || addr.street2 || '',
    city: addr.city || '',
    state: addr.state || '',
    postal: addr.postalCode || addr.postal || addr.zip || '',
    country,
    isResidential: true // Etsy orders are typically residential
  };
}

export async function extractAddressEnriched(order: any, userId?: string): Promise<NormalizedAddress | undefined> {
  let toAddress: NormalizedAddress | undefined = undefined;

  // PRIORITY 1: For Etsy orders, try to get Etsy extension address first (highest priority)
  const { isEtsyOrderSync } = await import('./utils/etsyDetection');
  if (userId && isEtsyOrderSync(order.marketplace)) {
    const etsyAddressData = await getEtsyAddress(userId, order.orderNumber, order.marketplace);
    if (etsyAddressData) {
      toAddress = normalizeEtsyAddress(etsyAddressData);
      if (toAddress) {
        logger.info(`Using Etsy extension address for order ${order.orderNumber}`, { 
          hasAddress: true,
          storeName: etsyAddressData.etsyStoreName,
          marketplace: order.marketplace
        });
        return toAddress;
      }
    }
  }

  // PRIORITY 2: Try to get address based on source (existing logic)
  if (order.source === 'shippo') {
    toAddress = normalizeShippoAddress(order.rawData?.to_address);
  } else if (order.source === 'veeqo') {
    // Try to parse from notes first
    if (typeof order.notes === 'string' && order.notes.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(order.notes);
        if (parsed?.to_address) {
          toAddress = normalizeVeeqoAddress(parsed.to_address);
        }
      } catch (e) {
        // Removed verbose order.notes parse log as requested
      }
    }
    
    // If no address from notes, try rawData
    if (!toAddress && order.rawData) {
      toAddress = normalizeVeeqoAddress(order.rawData.deliver_to || order.rawData.shipping_address);
    }
  }

  // Log if address is still undefined
  if (!toAddress) {
    logger.warn(`No address found for order ${order.orderNumber}`, { 
      source: order.source, 
      marketplace: order.marketplace 
    });
  }

  return toAddress;
}

// Create a Veeqo client
function createVeeqoClient(apiKey: string) {
  return {
    get: async (path: string) => {
      const url = `https://api.veeqo.com${path}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
      });
      
      if (!res.ok) {
        throw new Error(`Veeqo API ${res.status}: ${await res.text()}`);
      }
      
      return res.json();
    }
  };
}

// Batch fetch images for multiple items to avoid N+1 API calls
async function batchFetchVeeqoImages(
  items: VeeqoLineItem[], 
  veeqoClient: any
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  
  // Collect unique product_ids and sellable_ids that need fetching
  const productIdsToFetch = new Set<string>();
  const sellableIdsToFetch = new Set<string>();
  
  // First pass: collect items that need API calls
  for (const item of items) {
    const existingImage = extractExistingImageUrl(item);
    if (existingImage) {
      // Use item ID as key for the map
      imageMap.set(String(item.id), existingImage);
      continue;
    }
    
    // Collect IDs that need fetching
    if (item?.product_id) {
      productIdsToFetch.add(String(item.product_id));
    }
    if (item?.sellable?.id) {
      sellableIdsToFetch.add(String(item.sellable.id));
    }
  }
  
  // Batch fetch products
  const productImages = new Map<string, string>();
  if (productIdsToFetch.size > 0) {
    const productPromises = Array.from(productIdsToFetch).map(async (productId) => {
      try {
        const product = await veeqoClient.get(`/products/${productId}`);
        const imageUrl = product?.images?.[0]?.url || 
                        product?.image_url || 
                        product?.main_thumbnail_url || 
                        product?.original_url ||
                        product?.large_thumbnail_url ||
                        product?.medium_thumbnail_url ||
                        product?.small_thumbnail_url || 
                        '';
        if (imageUrl) {
          productImages.set(productId, imageUrl);
        }
      } catch (error) {
        // Silently continue on API errors
      }
    });
    
    await Promise.all(productPromises);
  }
  
  // Batch fetch sellables
  const sellableImages = new Map<string, string>();
  if (sellableIdsToFetch.size > 0) {
    const sellablePromises = Array.from(sellableIdsToFetch).map(async (sellableId) => {
      try {
        const sellable = await veeqoClient.get(`/sellables/${sellableId}`);
        const imageUrl = sellable?.images?.[0]?.url || 
                        sellable?.image_url || 
                        sellable?.main_thumbnail_url || 
                        sellable?.original_url ||
                        sellable?.large_thumbnail_url ||
                        sellable?.medium_thumbnail_url ||
                        sellable?.small_thumbnail_url || 
                        '';
        if (imageUrl) {
          sellableImages.set(sellableId, imageUrl);
        }
      } catch (error) {
        // Silently continue on API errors
      }
    });
    
    await Promise.all(sellablePromises);
  }
  
  // Second pass: assign fetched images to items
  for (const item of items) {
    const itemId = String(item.id);
    if (imageMap.has(itemId)) {
      continue; // Already has image
    }
    
    // Try to get image from fetched data
    let imageUrl = '';
    if (item?.product_id && productImages.has(String(item.product_id))) {
      imageUrl = productImages.get(String(item.product_id))!;
    } else if (item?.sellable?.id && sellableImages.has(String(item.sellable.id))) {
      imageUrl = sellableImages.get(String(item.sellable.id))!;
    }
    
    imageMap.set(itemId, imageUrl);
  }
  
  return imageMap;
}

// Extract existing image URL from item without API calls
function extractExistingImageUrl(item: VeeqoLineItem): string {
  const imageSources = [
    item.image_url,
    typeof item.product_image === 'string' ? item.product_image : undefined,
    item.sellable?.image_url,
    item.sellable?.images?.[0]?.url,
    item.sellable?.main_thumbnail_url,
    item.sellable?.original_url,
    item.sellable?.large_thumbnail_url,
    item.sellable?.medium_thumbnail_url,
    item.sellable?.small_thumbnail_url,
    item.product?.image_url,
    item.product?.images?.[0]?.url,
    item.product?.main_thumbnail_url,
    item.product?.original_url,
    item.product?.large_thumbnail_url,
    item.product?.medium_thumbnail_url,
    item.product?.small_thumbnail_url,
    typeof item.product_image === 'object' ? item.product_image.original_url : undefined,
    typeof item.product_image === 'object' ? item.product_image.large_thumbnail_url : undefined,
    typeof item.product_image === 'object' ? item.product_image.medium_thumbnail_url : undefined,
    typeof item.product_image === 'object' ? item.product_image.small_thumbnail_url : undefined
  ];

  return imageSources.find(url => url && typeof url === 'string') || '';
}

// Legacy function for backwards compatibility - now just calls extractExistingImageUrl
async function resolveVeeqoImageUrl(item: VeeqoLineItem, veeqoClient: any): Promise<string> {
  // Try existing image sources first
  let imageUrl = extractExistingImageUrl(item);
  if (imageUrl) {
    return imageUrl;
  }

  // Fallback to individual API calls (for backwards compatibility)
  // If no image found and we have a product_id, try to fetch the product
  if (!imageUrl && item?.product_id) {
    try {
      const product = await veeqoClient.get(`/products/${item.product_id}`);
      imageUrl = product?.images?.[0]?.url || 
                product?.image_url || 
                product?.main_thumbnail_url || 
                product?.original_url ||
                product?.large_thumbnail_url ||
                product?.medium_thumbnail_url ||
                product?.small_thumbnail_url || 
                '';
    } catch (error) {
      // Removed verbose product image fetch log as requested
// console.warn(`Failed to fetch product image for product_id ${item.product_id}:`, error);
    }
  }

  // If still no image and we have a sellable_id, try to fetch the sellable
  if (!imageUrl && item?.sellable?.id) {
    try {
      const sellable = await veeqoClient.get(`/sellables/${item.sellable.id}`);
      imageUrl = sellable?.images?.[0]?.url || 
                sellable?.image_url || 
                sellable?.main_thumbnail_url || 
                sellable?.original_url ||
                sellable?.large_thumbnail_url ||
                sellable?.medium_thumbnail_url ||
                sellable?.small_thumbnail_url || 
                '';
    } catch (error) {
      // Removed verbose sellable image fetch log as requested
// console.warn(`Failed to fetch sellable image for sellable_id ${item.sellable.id}:`, error);
    }
  }
  
  return imageUrl;
}

function normalizeVeeqoLineItems(order: any): NormalizedLineItem[] {
  return (order.line_items || []).map((item: VeeqoLineItem) => {
    const title = item.product_title || item.title || item.name || '';
    const image = item.product_image || item.image_url || '';
    const variantInfo = item.variation_title || item.variant_options_string || item.additional_options || '';

    return {
      id: item.id || item.line_item_id || '',
      title,
      value: item.price || 0,
      quantity: item.quantity || 1,
      weight: item.weight || 0.5,
      hs_code: item.harmonized_code || '',
      country_of_origin: item.country_of_manufacture || '',
      sku: item.variation_sku || item.sku || '',
      image,
      variantInfo,
      sellable: {
        full_title:
          item.sellable?.full_title ||
          item.full_title ||
          title
      }
    };
  });
}
function normalizeShippoLineItems(order: any): NormalizedLineItem[] {
  return (order.line_items || []).map((item: any) => ({
    id: item.object_id || String(Math.random()),
    title: item.title || '',
    value: item.price || 0,
    quantity: item.quantity || 1,
    weight: item.weight,
    hs_code: item.hs_code,
    country_of_origin: item.country_of_origin,
    sku: item.sku,
    image: item.product_image,
    variantInfo: item.product_variant,
    notes: item.description || order.notes || '', // Shippo stores notes at order level
    sellable: {
      full_title: item.full_title || undefined
    }
  }));
}

async function validateAndMapOrder(order: VeeqoOrder, veeqoClient: any): Promise<UIOrder | null> {
  const channel = determineChannel(order);
  const status = (order.status || 'pending').toLowerCase();

  // Get address from any available source
  const addr = order.deliver_to || order.shipping_address || order.billing_address;
  
  // Extract address fields with fallbacks, checking both addr object and direct order properties
  const recipientFirstName = (
    addr?.first_name ?? 
    order.customer?.first_name ?? 
    ''
  ).trim() || '—';
  
  const recipientLastName = (
    addr?.last_name ?? 
    order.customer?.last_name ?? 
    ''
  ).trim() || '—';
  
  const recipientStreet1 = (
    addr?.address1 ?? 
    order.address1 ?? 
    ''
  ).trim() || '—';
  
  const recipientCity = (
    addr?.city ?? 
    order.city ?? 
    ''
  ).trim() || '—';
  
  const recipientCountry = (
    addr?.country ?? 
    order.country ?? 
    ''
  ).trim() || '—';
  // No filtering for missing fields here; UI will handle it.

  // Helper to get line items from various possible locations in Veeqo order
  const getVeeqoLineItems = (order: any): any[] => {
    // First check if line_items exist at the top level
    if (order.line_items && Array.isArray(order.line_items) && order.line_items.length > 0) {
      return order.line_items;
    }
    // Then check if they're nested inside allocations
    if (order.allocations && Array.isArray(order.allocations) && order.allocations.length > 0) {
      const firstAllocation = order.allocations[0];
      if (firstAllocation.line_items && Array.isArray(firstAllocation.line_items)) {
        return firstAllocation.line_items;
      }
    }
    return [];
  };

  // Get line items first
  const rawLineItems = getVeeqoLineItems(order);
  
  // Batch fetch images for all line items at once
  const imageMap = await batchFetchVeeqoImages(rawLineItems, veeqoClient);
  
  // Map line items with the batch-fetched images
  const lineItems = rawLineItems.map((item: any) => {
    const imageUrl = imageMap.get(String(item.id)) || '';
    
    // Robustly extract product title from various possible fields
    const productTitle = item.title || 
                        item.product_title || 
                        item.sellable?.product_title || 
                        item.sellable?.full_title || 
                        '';
    
    // Robustly extract SKU
    const sku = item.variation_sku || 
                item.sellable?.sku_code || 
                item.sku || 
                '';
    
    // Robustly extract variant info
    const variantInfo = item.variation_title || 
                       item.variant_title ||
                       item.sellable?.title || 
                       item.sellable?.sellable_title || 
                       item.variant_options_string || 
                       '';
    
    // Extract notes - Veeqo stores Etsy buyer messages at order level in customer_note_attributes
    const notes = item.notes || 
                  item.description || 
                  order.customer_note_attributes?.text || // Veeqo customer notes
                  order.employee_note_attributes?.text || // Veeqo internal notes
                  '';
    
    return {
      id: String(item.id),
      title: productTitle,
      value: item.price || 0,
      quantity: item.quantity || 1,
      weight: item.weight || 0.5,
      hs_code: item.harmonized_code,
      country_of_origin: item.country_of_manufacture,
      sku: sku,
      image: imageUrl,
      variantInfo: variantInfo,
      notes: notes,
      shipBy: order.due_date // Add the due_date from the order
    };
  });

  const address = {
    name: `${recipientFirstName} ${recipientLastName}`.trim(),
    phone: (addr?.phone ?? order.phone ?? '').trim(),
    street1: recipientStreet1,
    street2: (addr?.address2 ?? order.address2 ?? '').trim(),
    city: recipientCity,
    state: (addr?.state ?? order.state ?? '').trim(),
    postal: (addr?.zip ?? addr?.postal_code ?? order.zip ?? order.postal_code ?? '').trim(),
    country: recipientCountry,
    isResidential: addr?.residential ?? false
  };

  return {
    id: String(order.id),
    source: 'veeqo' as OrderSource,
    channel: channel,
    marketplace: order.channel?.name || 'Veeqo',
    marketplaceKey: String(order.id),
    orderNumber: order.number || String(order.id),
    customerName: `${recipientFirstName} ${recipientLastName}`.trim(),
    status: order.status || 'pending',
    currency: order.currency_code || 'USD',
    totalPrice: order.total_price || 0,
    to_address: address,
    line_items: lineItems,
    marketplaceOrderDate: order.created_at || order.order_date || order.ordered_at,
    rawData: order,
    commodityDesc: lineItems.length > 0 ? lineItems[0].title || '' : '',
    shipByDate: order.due_date // Add the missing order-level shipByDate from Veeqo's due_date
  };
}

// Helper to get ETD defaults from shipper profile
async function getEtdDefaults(userId: string) {
  const shipper = await prisma.shipperProfile.findUnique({ where: { userId } });
  return {
    weightKg: shipper?.defaultWeightKg || 0.5,
    harmonizedCode: shipper?.defaultHarmonizedCode || '610910',
    countryOfMfg: shipper?.defaultCountryOfMfg || 'TR',
  };
}

// Compute uiOrderDate using same logic as frontend
function getUiOrderDate(order: any): string {
  let safeRaw = order.rawData;
  if (typeof safeRaw === 'string') {
    try { safeRaw = JSON.parse(safeRaw); } catch { safeRaw = {}; }
  }
  // Etsy receipts use created_timestamp (unix seconds)
  if (safeRaw?.created_timestamp && typeof safeRaw.created_timestamp === 'number') {
    return new Date(safeRaw.created_timestamp * 1000).toISOString();
  }
  // eBay orders use creationDate (ISO string)
  if (safeRaw?.creationDate) {
    return safeRaw.creationDate;
  }
  return (
    safeRaw?.created_at ||
    safeRaw?.to_address?.object_created ||
    safeRaw?.placed_at ||
    safeRaw?.to_address?.object_updated ||
    order.created_at ||
    order.order_date ||
    order.ordered_at ||
    order.marketplaceOrderDate ||
    order.syncTimestamp ||
    new Date(0).toISOString()
  );
}

// Update syncAllOrders to handle Veeqo order mapping correctly
export async function syncAllOrders(userId: string, options: {
  syncType?: 'fast' | 'full' | 'recent';
  veeqoApiKey?: string;
  shippoToken?: string;
  startDate?: Date;
  endDate?: Date;
  source?: OrderSource;
  channel?: OrderChannel;
  /** Only sync these sources (e.g. ['trendyol'] is a no-op here; ['etsy-api'], ['veeqo', 'shippo']). */
  onlySources?: string[];
  /** Skip these sources (cron passes ['etsy-api'] while the etsy-orders-incremental job is healthy). */
  excludeSources?: string[];
} = {}): Promise<{
  newOrders: number;
  updatedOrders: number;
  skippedOrders: number;
  failedOrders: number;
  errors: { orderId: string; error: string }[];
}> {
  // Always fetch from DB if not provided
  if (!options.veeqoApiKey || !options.shippoToken) {
    const creds = await getIntegrationCreds(userId);
    if (!options.veeqoApiKey) options.veeqoApiKey = creds.veeqoApiKey ?? undefined;
    if (!options.shippoToken) options.shippoToken = creds.shippoToken ?? undefined;
  }
  // Callers may pass raw Credential columns (stored encrypted). Decrypt here, at the
  // single choke point; plaintext passes through unchanged.
  options.veeqoApiKey = decryptIfNeeded(options.veeqoApiKey) ?? undefined;
  options.shippoToken = decryptIfNeeded(options.shippoToken) ?? undefined;
  let syncId: string | undefined;
  let processed = 0;
  let successful = 0;
  let failed = 0;
  let ordersCreated = 0;
  let ordersUpdated = 0;
  const errors: Array<{ orderId: string; error: string }> = [];

  try {
    const { veeqoApiKey, shippoToken, startDate, endDate, source, channel } = options;
    const wants = (src: string) =>
      (typeof source === 'undefined' || source === src) &&
      (!options.onlySources || options.onlySources.includes(src)) &&
      !(options.excludeSources || []).includes(src);
    
    const lastSyncEntry = await prisma.syncOperation.findFirst({
      where: { 
        userId, 
        status: 'completed',
        type: 'full' // Only use 'full' sync operations to avoid Trendyol interference
      },
      orderBy: { updatedAt: 'desc' },
    });
    
    // For full sync of Etsy orders, we don't want to use lastSyncTime because we need to merge all orders
    // For fast/recent syncs, use incremental fetching with a safety margin
    const useIncrementalSync = options.syncType === 'fast' || options.syncType === 'recent';
    let lastSyncTime = useIncrementalSync ? lastSyncEntry?.updatedAt : undefined;
    
    // For fast sync, add 6-hour safety margin to catch orders that might have been missed
    if (options.syncType === 'fast' && lastSyncTime) {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      lastSyncTime = lastSyncTime < sixHoursAgo ? lastSyncTime : sixHoursAgo;
      logger.info(`[FastSync] Using safety margin for Veeqo fetch. Original lastSync: ${lastSyncEntry?.updatedAt?.toISOString()}, Using: ${lastSyncTime.toISOString()}`);
    }

    syncId = await startSync(userId, 'full');
    
    // Fetch orders from all sources in parallel
    const fetchPromises: Promise<UIOrder[]>[] = [];
    const pushTracked = (provider: string, p: Promise<UIOrder[]>) =>
      fetchPromises.push(trackOrderSource(userId, provider, p));

    // CRITICAL FIX: Use separate if statements instead of else-if to fetch from BOTH sources
    if (wants('veeqo') && veeqoApiKey) {
      if (options.syncType === 'fast') {
        logger.info(`[FastSync] Triggering Veeqo fetch (first page only). Options:`, { userId, source, veeqoApiKey: !!veeqoApiKey, lastSyncTime });
        const veeqoClient = createVeeqoClient(veeqoApiKey);
        pushTracked('veeqo',
          (async () => {
            const orders = await fetchVeeqoOrders({ apiKey: veeqoApiKey, page: 1, perPage: 100, lastSync: lastSyncTime });
            logger.info(`[FastSync] Veeqo fetch returned ${orders.length} orders.`, { userId });
            const processedOrders = await Promise.all(orders.map(async order => {
              return await validateAndMapOrder(order, veeqoClient);
            }));
            logger.info(`[FastSync] Veeqo processedOrders after mapping: ${processedOrders.length}`);
            // Direct Amazon SP-API sync owns Amazon orders now — skip them from Veeqo
            // to prevent duplicate rows (Veeqo keys by its own internal ID, direct keys
            // by Amazon Order ID, so unique constraint can't dedupe them automatically).
            return processedOrders.filter(
              (order): order is UIOrder =>
                order !== null && !/amazon/i.test(order.marketplace || ''),
            );
          })()
        );
      } else {
        logger.info(`[FullSync] Triggering Veeqo fetch with API key present. Options:`, { userId, source, veeqoApiKey: !!veeqoApiKey, lastSyncTime });
        const veeqoClient = createVeeqoClient(veeqoApiKey);
        pushTracked('veeqo',
          (async () => {
            const orders = await fetchVeeqoOrders({ apiKey: veeqoApiKey, lastSync: lastSyncTime });
            logger.info(`[FullSync] Veeqo fetch returned ${orders.length} orders.`, { userId });
            const processedOrders = await Promise.all(orders.map(async order => {
              return await validateAndMapOrder(order, veeqoClient);
            }));
            logger.info(`[FullSync] Veeqo processedOrders after mapping: ${processedOrders.length}`);
            // Amazon orders are owned by the direct SP-API path now (see AmazonSync).
            // Filtering here also prevents the (Veeqo internal id vs Amazon Order ID)
            // duplicate-row bug since dedup keys are different shapes.
            return processedOrders.filter(
              (order): order is UIOrder =>
                order !== null && !/amazon/i.test(order.marketplace || ''),
            );
          })()
        );
      }
    }

    // CRITICAL FIX: Changed from 'else if' to 'if' to fetch from BOTH sources
    if (wants('shippo') && shippoToken) {
      if (options.syncType === 'fast') {
        logger.info(`[FastSync] Triggering Shippo fetch (first page only). Options:`, { userId, source, shippoToken: !!shippoToken });
        const etdDefaults = await getEtdDefaults(userId);
        
        // Use same 6-hour window as other integrations for consistency
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
        const shippoDateFilter = sixHoursAgo.toISOString();
        logger.info(`[FastSync] Shippo date filter: ${shippoDateFilter}`);
        
        pushTracked('shippo',
          fetchShippoOrders(shippoToken, { 
            page: '1', 
            results: '100',
            object_created_gte: shippoDateFilter 
          }).then(orders => {
            logger.info(`[FastSync] Shippo fetch returned ${orders.length} orders.`, { userId });
            return orders.map(order => {
              const addr = order.to_address || order.shipping_address || {};
              const nameParts = splitName(addr.name || '');
              // Build full shipping address JSON
              const shippingAddress = {
                recipientFirstName: nameParts.first,
                recipientLastName: nameParts.last,
                recipientStreet1: addr.street1 || '',
                recipientStreet2: addr.street2 || '',
                recipientCity: addr.city || '',
                recipientState: addr.state || '',
                recipientPostal: addr.zip || '',
                recipientCountry: addr.country || '',
                recipientPhone: addr.phone || '',
                name: addr.name || '',
                phone: addr.phone || '',
                street1: addr.street1 || '',
                street2: addr.street2 || '',
                city: addr.city || '',
                state: addr.state || '',
                postal: addr.zip || '',
                country: addr.country || '',
                isResidential: false
              };
              // Map line items with ETD fields
              const lineItems = (order.line_items || []).map(item => ({
                id: item.object_id,
                title: item.title || 'Unknown Product',
                value: parseFloat(item.total_price) || 0,
                quantity: item.quantity || 1,
                weight: parseFloat(String(item.weight)) || etdDefaults.weightKg,
                sku: item.sku || '',
                hs_code: etdDefaults.harmonizedCode,
                country_of_origin: etdDefaults.countryOfMfg,
                // shipBy: undefined // Shippo orders don't have shipping deadlines - this comes from merged Veeqo data
              }));
              // Ensure all UIOrder fields are present
              return {
                id: order.object_id,
                source: 'shippo',
                channel: 'etsy',
                marketplace: order.shop_app || 'Etsy',
                marketplaceKey: order.object_id,
                orderNumber: order.order_number || order.object_id,
                customerName: addr.name || 'Unknown Customer',
                status: order.order_status,
                externalStatus: order.order_status, // Shippo order status
                currency: order.currency || 'USD',
                totalPrice: parseFloat(order.total_price) || 0,
                to_address: shippingAddress,
                line_items: lineItems,
                marketplaceOrderDate: order.placed_at,
                rawData: order,
                commodityDesc: lineItems.length > 0 ? lineItems[0].title || '' : ''
                // shipByDate: undefined // Shippo orders don't have shipping deadlines - this comes from merged Veeqo data
              };
            });
          })
        );
      } else {
        // TEMPORARY: Disable Shippo sync for testing
        const DISABLE_SHIPPO_SYNC = false; // Set to false to re-enable
        
        if (DISABLE_SHIPPO_SYNC) {
          logger.warn(`[FullSync] SHIPPO SYNC IS TEMPORARILY DISABLED FOR TESTING`, { userId });
        } else {
          logger.info(`[FullSync] Triggering Shippo fetch with token present. Options:`, { userId, source, shippoToken: !!shippoToken, lastSyncTime });
          const etdDefaults = await getEtdDefaults(userId);
          
          // Use date filter for incremental sync, or no filter for full historical sync
          const shippoOptions = lastSyncTime ? { object_created_gte: lastSyncTime.toISOString() } : {};
          logger.info(`[FullSync] Shippo options:`, shippoOptions);
          
          pushTracked('shippo',
          fetchShippoOrders(shippoToken, shippoOptions).then(orders => {
            logger.info(`[FullSync] Shippo fetch returned ${orders.length} orders.`, { userId });
            return orders.map(order => {
              const addr = order.to_address || order.shipping_address || {};
              const nameParts = splitName(addr.name || '');
              // Build full shipping address JSON
              const shippingAddress = {
                recipientFirstName: nameParts.first,
                recipientLastName: nameParts.last,
                recipientStreet1: addr.street1 || '',
                recipientStreet2: addr.street2 || '',
                recipientCity: addr.city || '',
                recipientState: addr.state || '',
                recipientPostal: addr.zip || '',
                recipientCountry: addr.country || '',
                recipientPhone: addr.phone || '',
                name: addr.name || '',
                phone: addr.phone || '',
                street1: addr.street1 || '',
                street2: addr.street2 || '',
                city: addr.city || '',
                state: addr.state || '',
                postal: addr.zip || '',
                country: addr.country || '',
                isResidential: false
              };
              // Map line items with ETD fields
              const lineItems = (order.line_items || []).map(item => ({
                id: item.object_id,
                title: item.title || 'Unknown Product',
                value: parseFloat(item.total_price) || 0,
                quantity: item.quantity || 1,
                weight: parseFloat(String(item.weight)) || etdDefaults.weightKg,
                sku: item.sku || '',
                hs_code: etdDefaults.harmonizedCode,
                country_of_origin: etdDefaults.countryOfMfg,
                // shipBy: undefined // Shippo orders don't have shipping deadlines - this comes from merged Veeqo data
              }));
              // Ensure all UIOrder fields are present
              return {
                id: order.object_id,
                source: 'shippo',
                channel: 'etsy',
                marketplace: order.shop_app || 'Etsy',
                marketplaceKey: order.object_id,
                orderNumber: order.order_number || order.object_id,
                customerName: addr.name || 'Unknown Customer',
                status: order.order_status,
                externalStatus: order.order_status, // Shippo order status
                currency: order.currency || 'USD',
                totalPrice: parseFloat(order.total_price) || 0,
                to_address: shippingAddress,
                line_items: lineItems,
                marketplaceOrderDate: order.placed_at,
                rawData: order,
                commodityDesc: lineItems.length > 0 ? lineItems[0].title || '' : ''
                // shipByDate: undefined // Shippo orders don't have shipping deadlines - this comes from merged Veeqo data
              };
            });
          })
        );
        }
      }
    }

    // Amazon SP-API order sync (uses Reports API for bulk, Orders API for incremental)
    if (wants('amazon')) {
      let amazonAccount = '';
      try {
        const cred = await prisma.credential.findUnique({ where: { userId } }) as any;
        // Parked after repeated LWA invalid_grant (lib/integrations/authFailures.ts) until the user reconnects.
        const { isConnectionBlocked: amazonBlocked } = await import('./integrations/authFailures');
        amazonAccount = String(cred?.amazonSellerId || '');
        if (cred?.amazonAccessToken && cred?.amazonRefreshToken && (await amazonBlocked(userId, 'amazon', amazonAccount))) {
          logger.info('[AmazonSync] Skipping: reconnect required', { userId });
        } else if (cred?.amazonAccessToken && cred?.amazonRefreshToken) {
          const { getValidToken, fetchCatalogItems } = await import('./integrations/amazonClient');
          const { fetchOrderReport } = await import('./integrations/amazonReports');
          const { toNormalizedOrderFromGroup, groupReportRows } = await import('./mappers/amazon');

          const token = await getValidToken(cred, async (newToken: string, expiresAt: Date) => {
            await prisma.credential.update({
              where: { userId },
              data: { amazonAccessToken: newToken, amazonTokenExpiresAt: expiresAt } as any,
            });
          });

          if (token) {
            const { recordAuthSuccess } = await import('./integrations/authFailures');
            await recordAuthSuccess(userId, 'amazon', amazonAccount);
            const region = (cred.amazonRegion || 'eu') as 'na' | 'eu' | 'fe';
            const marketplaceIds: string[] = Array.isArray(cred.amazonMarketplaceIds) && cred.amazonMarketplaceIds.length > 0
              ? cred.amazonMarketplaceIds
              : [cred.amazonMarketplaceId || 'ATVPDKIKX0DER'];

            // Use 30-day window for orders
            const syncStart = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const syncEnd = endDate || new Date();

            fetchPromises.push(
              (async () => {
                try {
                  logger.info('[AmazonSync] Requesting order report', { userId, region });
                  const tsv = await fetchOrderReport(token, region, marketplaceIds, syncStart, syncEnd);
                  const groups = groupReportRows(tsv);
                  const orders = Array.from(groups.entries()).map(([orderId, rows]) =>
                    toNormalizedOrderFromGroup(orderId, rows),
                  );
                  logger.info(`[AmazonSync] Parsed ${orders.length} orders from ${groups.size} groups`, { userId });

                  // Enrich with product images / weights via the Catalog API.
                  // Cache aggressively in AmazonProductCache to stay well under rate limits.
                  const STALE_AFTER_DAYS = 7;
                  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
                  const wantedAsins = new Set<string>();
                  for (const o of orders) {
                    for (const li of o.line_items) if (li.asin) wantedAsins.add(li.asin);
                  }
                  if (wantedAsins.size > 0) {
                    const cached = await prisma.amazonProductCache.findMany({
                      where: {
                        asin: { in: Array.from(wantedAsins) },
                        marketplaceId: marketplaceIds[0],
                      },
                    });
                    const cacheMap = new Map(cached.map((c: any) => [c.asin, c]));
                    const fresh = (c: any) => c && c.fetchedAt && new Date(c.fetchedAt) > staleCutoff;
                    const missing = Array.from(wantedAsins).filter((a) => !fresh(cacheMap.get(a)));

                    if (missing.length > 0) {
                      logger.info(`[AmazonSync] Catalog enrichment: ${missing.length} ASIN(s) need fetch (${wantedAsins.size - missing.length} fresh in cache)`);
                      const enrichments = await fetchCatalogItems(missing, marketplaceIds[0], token, region, userId);
                      for (const [asin, e] of enrichments.entries()) {
                        await prisma.amazonProductCache.upsert({
                          where: { asin_marketplaceId: { asin, marketplaceId: marketplaceIds[0] } },
                          update: {
                            imageUrl: e.imageUrl ?? null,
                            weightKg: e.weightKg ?? null,
                            countryOfOrigin: e.countryOfOrigin ?? null,
                            brand: e.brand ?? null,
                            title: e.title ?? null,
                            fetchedAt: new Date(),
                          },
                          create: {
                            asin,
                            marketplaceId: marketplaceIds[0],
                            imageUrl: e.imageUrl ?? null,
                            weightKg: e.weightKg ?? null,
                            countryOfOrigin: e.countryOfOrigin ?? null,
                            brand: e.brand ?? null,
                            title: e.title ?? null,
                          },
                        });
                        cacheMap.set(asin, {
                          asin,
                          marketplaceId: marketplaceIds[0],
                          ...e,
                          fetchedAt: new Date(),
                        });
                      }
                    }

                    // Patch line_items with whatever we have.
                    for (const o of orders) {
                      for (const li of o.line_items) {
                        if (!li.asin) continue;
                        const c: any = cacheMap.get(li.asin);
                        if (!c) continue;
                        if (c.imageUrl) li.image = c.imageUrl;
                        if (c.weightKg && c.weightKg > 0) li.weight = c.weightKg;
                        if (c.countryOfOrigin) li.country_of_origin = c.countryOfOrigin;
                      }
                    }
                  }

                  void resolveNotification(userId, notificationKeys.orderSync('amazon'));
                  return orders;
                } catch (err: any) {
                  logger.error('[AmazonSync] Order sync failed', err, { userId });
                  notifyOrderSyncFailed(userId, 'amazon');
                  return [];
                }
              })()
            );
          }
        }
      } catch (err: any) {
        logger.error('[AmazonSync] Failed to initialize', err, { userId });
        notifyOrderSyncFailed(userId, 'amazon');
        // LWA invalid_grant counts toward the reconnect flag; config / network errors do not.
        try {
          const { recordAuthFailure } = await import('./integrations/authFailures');
          await recordAuthFailure(userId, 'amazon', amazonAccount, err);
        } catch { /* best effort */ }
      }
    }

    // Direct Etsy receipts are written ONLY by upsertEtsyReceipt
    // (lib/orders/etsyLifecycle): keyset incremental poll per shop for normal
    // syncs, a 30-day hash-gated pass for the manual full sync. They never go
    // through the batch writer below. Per-shop failures are returned in errors.
    let etsyRun: Promise<{ created: number; updated: number }> | null = null;
    if (wants('etsy-api')) {
      etsyRun = (async () => {
        const totals = { created: 0, updated: 0 };
        const etsyShops = await prisma.etsyShop.findMany({ where: { userId, isActive: true }, select: { shopId: true } });
        if (etsyShops.length === 0) return totals;
        const { runEtsyOrderIncremental } = await import('./orders/etsyLifecycle');
        const { EtsyPriority } = await import('./etsy/rateBudget');
        for (const shop of etsyShops) {
          try {
            const r = options.syncType === 'full'
              ? await runEtsyOrderIncremental(shop.shopId, {
                  reason: 'manual_full',
                  maxPages: 50,
                  priority: EtsyPriority.Interactive,
                  sinceSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
                  source: 'manual',
                  persistCursor: false,
                })
              : await runEtsyOrderIncremental(shop.shopId, { reason: 'sync', maxPages: 10 });
            totals.created += r.created;
            totals.updated += r.updated;
            // Receipts that failed individually (the rest of the shop was still synced).
            for (const receiptId of (r.failedReceiptIds || []).slice(0, 20)) {
              errors.push({ orderId: `etsy:${shop.shopId}:${receiptId}`, error: 'Etsy receipt could not be saved (will be retried)' });
            }
          } catch (err: any) {
            logger.error('[EtsyOrderSync] Shop sync failed', err instanceof Error ? err : new Error(String(err)), { shopId: shop.shopId });
            errors.push({ orderId: `etsy:${shop.shopId}`, error: String(err?.message || err).slice(0, 300) });
          }
        }
        return totals;
      })();
    }

    // Direct eBay API sync (has real per-item prices)
    if (wants('ebay-api')) {
      try {
        const cred = await prisma.credential.findUnique({ where: { userId } });
        console.log(`[OrderSync] eBay credentials found: ${!!(cred as any)?.ebayAccessToken}`);
        if ((cred as any)?.ebayAccessToken) {
          fetchPromises.push(
            // Not wrapped in trackOrderSource (see Etsy above): fetchEbayOrders
            // swallows token/API errors and resolves with [].
            fetchEbayOrders(userId, { lastSync: lastSyncTime }).catch(err => {
              console.error('[EbayOrderSync] Failed:', err);
              return [] as UIOrder[];
            })
          );
        }
      } catch (err) {
        logger.error('[EbayOrderSync] Init failed', err instanceof Error ? err : new Error(String(err)));
      }
    }

    // Wait for all fetch promises to resolve
    const allOrders = await Promise.all(fetchPromises);
    const etsyTotals = etsyRun ? await etsyRun : { created: 0, updated: 0 };
    logger.info(`[FullSync] All sources fetched. Arrays: ${allOrders.map(arr => arr.length).join(', ')}`);

    const ordersByNumber = new Map<string, UIOrder>();

    // Pass 1: Group all orders by order number and merge data.
    for (const order of allOrders.flat()) {
      if (!order.orderNumber) continue;

      const existing = ordersByNumber.get(order.orderNumber);
      if (!existing) {
        ordersByNumber.set(order.orderNumber, order);
      } else {
        // Core merging logic — direct API sources (etsy-api, ebay-api) have real per-item prices
        const directApiSources = ['etsy-api', 'ebay-api'];
        const existingIsDirect = directApiSources.includes(existing.source);
        const orderIsDirect = directApiSources.includes(order.source);

        const merged: UIOrder = {
          ...existing,
          ...order,
          // Prioritize direct API for address (most complete), then Shippo, then existing
          to_address: orderIsDirect && order.to_address?.street1 ? order.to_address
            : existingIsDirect && existing.to_address?.street1 ? existing.to_address
            : order.source === 'shippo' && order.to_address ? order.to_address
            : existing.to_address,
          // Direct API sources have real per-item prices — always prefer them
          line_items: orderIsDirect && order.line_items.length > 0 ? order.line_items
            : existingIsDirect && existing.line_items.length > 0 ? existing.line_items
            : existing.source === 'veeqo' && existing.line_items.length > 0 ? existing.line_items
            : order.line_items,
          // Prioritize direct API or Veeqo for shipByDate
          shipByDate: orderIsDirect && order.shipByDate ? order.shipByDate
            : existingIsDirect && existing.shipByDate ? existing.shipByDate
            : existing.source === 'veeqo' && existing.shipByDate ? existing.shipByDate
            : order.shipByDate,
          // Combine rawData from both sources
          rawData: { ...(existing.rawData || {}), ...(order.rawData || {}) },
          // Mark as merged and use the most definitive source
          source: 'merged' as OrderSource,
          id: existing.id || order.id,
        };
        ordersByNumber.set(order.orderNumber, merged);
      }
    }

    const uniqueOrders = Array.from(ordersByNumber.values());
    logger.info(`[FullSync] Unique orders after merging: ${uniqueOrders.length}`);

    // Apply filters
    let filteredOrders = uniqueOrders;
    logger.info(`[FullSync] Orders before filters: ${filteredOrders.length}`);
    
    if (startDate) {
      filteredOrders = filteredOrders.filter(order => 
        new Date(order.marketplaceOrderDate || '') >= startDate
      );
      logger.info(`[FullSync] Orders after startDate filter: ${filteredOrders.length}`);
    }
    
    if (endDate) {
      filteredOrders = filteredOrders.filter(order => 
        new Date(order.marketplaceOrderDate || '') <= endDate
      );
      logger.info(`[FullSync] Orders after endDate filter: ${filteredOrders.length}`);
    }
    
    if (channel) {
      filteredOrders = filteredOrders.filter(order => order.channel === channel);
      logger.info(`[FullSync] Orders after channel filter: ${filteredOrders.length}`);
    }
    if (filteredOrders.length === 0) {
      logger.info(`[FullSync] No orders to process after filtering.`, { userId });
    }

    // ---------------------------------------------------------------------
    // Batch writer (non-Etsy-direct sources). Etsy receipts are rejected here:
    // upsertEtsyReceipt owns them.
    // ---------------------------------------------------------------------
    const batchOrders = filteredOrders.filter((o) => {
      if (o.source === 'etsy-api') {
        logger.warn('[Order Sync] Batch writer rejected an etsy-api order (owned by upsertEtsyReceipt)', { marketplaceKey: o.marketplaceKey });
        return false;
      }
      return Boolean(o.marketplace && o.marketplaceKey);
    });
    const keyOf = (marketplace: string, marketplaceKey: string) => `${marketplace}|${marketplaceKey}`;
    const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));

    const existingOrders = batchOrders.length
      ? await prisma.order.findMany({
          where: {
            userId,
            marketplace: { in: uniq(batchOrders.map((o) => o.marketplace)) },
            marketplaceKey: { in: uniq(batchOrders.map((o) => String(o.marketplaceKey))) },
          },
        })
      : [];
    const existingOrderMap = new Map(existingOrders.map((o) => [keyOf(o.marketplace, o.marketplaceKey), o]));

    // Aggregator (Veeqo/Shippo) copies of a receipt we already hold from the
    // direct Etsy API: fill-if-empty onto the direct row, never a duplicate row
    // and never overwrite its status/items.
    const aggregatorNumbers = uniq(
      batchOrders
        .filter((o) => AGGREGATOR_SOURCES.has(String(o.source)) && !existingOrderMap.has(keyOf(o.marketplace, String(o.marketplaceKey))))
        .map((o) => String(o.orderNumber || '')),
    ).filter((n) => /^\d+$/.test(n));
    const directEtsyByNumber = new Map<string, (typeof existingOrders)[number]>();
    if (aggregatorNumbers.length > 0) {
      const directRows = await prisma.order.findMany({ where: { userId, marketplaceKey: { in: aggregatorNumbers } } });
      for (const r of directRows) {
        const raw = r.rawData && typeof r.rawData === 'object' ? (r.rawData as any) : null;
        if (raw?.receipt_id && String(raw.receipt_id) === r.marketplaceKey) directEtsyByNumber.set(r.marketplaceKey, r);
      }
    }

    // Rows written before W4 have no stored itemsHash: hash their stored items
    // once so unchanged orders are not rewritten on the first sync after deploy.
    const nullHashIds = existingOrders.filter((o) => !o.itemsHash).map((o) => o.id);
    const storedItemsByOrder = new Map<string, any[]>();
    if (nullHashIds.length > 0) {
      for (let i = 0; i < nullHashIds.length; i += 500) {
        const rows = await prisma.orderItem.findMany({
          where: { orderId: { in: nullHashIds.slice(i, i + 500) } },
          select: { id: true, orderId: true, uniqueLineKey: true, remoteLineId: true, marketplaceKey: true, quantity: true, unitPrice: true, sku: true, image: true },
        });
        for (const r of rows) {
          if (!storedItemsByOrder.has(r.orderId)) storedItemsByOrder.set(r.orderId, []);
          storedItemsByOrder.get(r.orderId)!.push(r);
        }
      }
    }

    type PlannedWrite = {
      order: UIOrder;
      existing: (typeof existingOrders)[number] | null;
      direct: (typeof existingOrders)[number] | null;
      lines: UpsertLine[];
      orderHash: string;
      itemsHash: string;
      itemsChanged: boolean;
      shipByAt: Date | null;
    };
    const ordersToProcess: PlannedWrite[] = [];
    const skippedOrderIds: string[] = [];

    for (const order of batchOrders) {
      if ((order.source === 'veeqo' || order.source === 'shippo') && !order.commodityDesc && order.line_items?.length) {
        order.commodityDesc = order.line_items[0].title || '';
      }
      const key = keyOf(order.marketplace, String(order.marketplaceKey));
      const existing = existingOrderMap.get(key) || null;
      const direct = !existing && AGGREGATOR_SOURCES.has(String(order.source)) ? directEtsyByNumber.get(String(order.orderNumber)) || null : null;
      const lines = linesFromUIOrder(order as any);
      const itemsHash = computeItemsHash(lines.map((l) => ({ lineKey: l.lineKey, quantity: l.quantity, unitPrice: l.unitPrice, sku: l.sku, image: l.image })));
      const shipByAt = earliestLineShipBy(lines) ?? toDateOrNull(order.shipByDate);
      const target = existing || direct;
      const orderHash = computeOrderHash({
        status: order.status,
        externalStatus: order.externalStatus,
        totalPrice: order.totalPrice,
        trackingNumber: target?.trackingNumber || order.trackingNumber || null,
        shipByAt,
      });

      if (!existing) {
        ordersToProcess.push({ order, existing: null, direct, lines, orderHash, itemsHash, itemsChanged: true, shipByAt });
        continue;
      }
      const storedOrderHash =
        existing.orderHash ??
        computeOrderHash({ status: existing.status, externalStatus: existing.externalStatus, totalPrice: existing.totalPrice, trackingNumber: existing.trackingNumber, shipByAt: existing.shipByAt });
      const storedItemsHash = existing.itemsHash ?? itemsHashFromDbRows(storedItemsByOrder.get(existing.id) || []);
      const itemsChanged = storedItemsHash !== itemsHash;
      // Address/name are not in orderHash: compare the merged result with the stored row
      // (same rule as writeBatchOrder / marketplaceOrderWrite), so a corrected address
      // is never skipped as "unchanged".
      const incomingAddress = parseStoredAddress(order.to_address) || parseStoredAddress(order.shippingAddress);
      const mergedAddress = mergeAddressPreferNonEmpty(existing.shippingAddress, incomingAddress);
      const addressChanged = !!mergedAddress && !sameAddress(existing.shippingAddress, mergedAddress);
      const mergedName = mergeNamePreferNonEmpty(existing.customerName, order.customerName);
      const nameChanged = mergedName !== null && mergedName !== existing.customerName;
      const unchanged =
        storedOrderHash === orderHash && !itemsChanged && !!existing.uiOrderDate && !addressChanged && !nameChanged;
      if (unchanged && existing.orderHash && existing.itemsHash) {
        skippedOrderIds.push(existing.id);
        continue;
      }
      ordersToProcess.push({ order, existing, direct: null, lines, orderHash, itemsHash, itemsChanged, shipByAt });
    }

    if (skippedOrderIds.length > 0) {
      logger.info(`[Order Sync] Skipped ${skippedOrderIds.length} unchanged orders (hash match).`);
    }

    const liveWrites: Array<{ row: any; kind: LiveOrderKind; itemCount: number }> = [];
    const statusChangedIds: string[] = [];
    const effectOrderIds: string[] = [];

    for (let i = 0; i < ordersToProcess.length; i += BATCH_SIZE) {
      const batch = ordersToProcess.slice(i, i + BATCH_SIZE);
      for (const plan of batch) {
        try {
          const outcome = await writeBatchOrder(userId, plan);
          if (outcome.created) ordersCreated++;
          else if (outcome.wrote) ordersUpdated++;
          if (outcome.statusChanged && !outcome.created) statusChangedIds.push(outcome.orderId);
          if (outcome.effectsQueued > 0) effectOrderIds.push(outcome.orderId);
          if (outcome.liveKind) liveWrites.push({ row: outcome.row, kind: outcome.liveKind, itemCount: plan.lines.reduce((n, l) => n + l.quantity, 0) });
          successful++;
        } catch (error: any) {
          failed++;
          logger.error('[Order Sync] Order write failed', error instanceof Error ? error : new Error(String(error)), { marketplaceKey: plan.order.marketplaceKey });
          errors.push({ orderId: String(plan.order.marketplaceKey), error: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
          processed++;
        }
      }

      await updateSyncStatus(syncId!, {
        processedOrders: processed,
        successfulOrders: successful,
        failedOrders: failed,
        totalOrders: ordersToProcess.length,
      });
      // Small delay between batches to keep the pool free for requests.
      if (i + BATCH_SIZE < ordersToProcess.length) await new Promise((resolve) => setTimeout(resolve, 50));
    }

    for (const id of effectOrderIds.slice(0, 20)) kickOrderEffects(id);
    if (effectOrderIds.length > 20) kickOrderEffects();
    publishOrderWrites(userId, liveWrites);

    ordersCreated += etsyTotals.created;
    ordersUpdated += etsyTotals.updated;

    logger.info(`[Order Sync] Completed processing ${ordersToProcess.length} orders`);
    logger.info(`[Order Sync] Summary: ${ordersCreated} created, ${ordersUpdated} updated, ${failed} failed`);

    // Complete the sync
    if (syncId) {
      await completeSync(syncId, failed === 0, {
        processedOrders: processed,
        successfulOrders: successful,
        failedOrders: failed,
        totalOrders: ordersToProcess.length,
        errors,
      });
    }

    // Update user's lastSyncedAt timestamp on successful sync
    if (successful > 0 && failed === 0) {
      await prisma.user.update({
        where: { id: userId },
        data: { lastSyncedAt: new Date() },
      });
      logger.info(`[Order Sync] Updated user lastSyncedAt timestamp`);
    }

    return {
      newOrders: ordersCreated,
      updatedOrders: ordersUpdated,
      skippedOrders: skippedOrderIds.length,
      failedOrders: failed,
      errors
    };
  } catch (error: any) {
    logger.error('Sync failed', error instanceof Error ? error : new Error(String(error)));
    if (syncId) {
      await completeSync(syncId, false, {
        processedOrders: typeof processed === 'number' ? processed : 0,
        successfulOrders: typeof successful === 'number' ? successful : 0,
        failedOrders: typeof failed === 'number' ? failed : 0,
        totalOrders: 0,
        errors: [...errors, { orderId: 'sync_process', error: error && typeof error.message === 'string' ? error.message : String(error) }],
      });
    }
    throw error;
  } finally {
    // Clean up any resources if needed
    if (syncId) {
      try {
        await completeSync(syncId, failed === 0, {
          processedOrders: typeof processed === 'number' ? processed : 0,
          successfulOrders: typeof successful === 'number' ? successful : 0,
          failedOrders: typeof failed === 'number' ? failed : 0,
          totalOrders: 0,
          errors,
        });
      } catch (cleanupError) {
        logger.error('Error during sync cleanup', cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)));
      }
    }
  }
}

const AGGREGATOR_SOURCES = new Set(['veeqo', 'shippo', 'merged']);
const BATCH_SIZE = 25;

function toDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

type BatchWriteOutcome = {
  orderId: string;
  created: boolean;
  wrote: boolean;
  statusChanged: boolean;
  effectsQueued: number;
  liveKind: LiveOrderKind | null;
  row: any;
};

/**
 * Write one planned order (create / hash-gated update / aggregator fill-if-empty).
 * Order row, items and effect outbox rows commit in one transaction.
 */
async function writeBatchOrder(
  userId: string,
  plan: {
    order: UIOrder;
    existing: any | null;
    direct: any | null;
    lines: UpsertLine[];
    orderHash: string;
    itemsHash: string;
    itemsChanged: boolean;
    shipByAt: Date | null;
  },
): Promise<BatchWriteOutcome> {
  const { order, existing, direct, lines, orderHash, itemsHash, itemsChanged, shipByAt } = plan;
  const now = new Date();
  const anyOrder = order as any;
  const nextClass = classifyOrderStatus(order.status, order.externalStatus);
  const incomingAddress = parseStoredAddress(order.to_address) || parseStoredAddress(order.shippingAddress);

  // Aggregator copy of a direct Etsy receipt: fill-if-empty only.
  if (direct) {
    const data: Prisma.OrderUpdateInput = {};
    if (!hasStreet(parseStoredAddress(direct.shippingAddress)) && hasStreet(incomingAddress)) {
      data.shippingAddress = JSON.stringify(mergeAddressPreferNonEmpty(direct.shippingAddress, incomingAddress));
    }
    if (!direct.customerName && order.customerName) data.customerName = order.customerName;
    if (!direct.trackingNumber && order.trackingNumber) data.trackingNumber = order.trackingNumber;
    if (!direct.giftMessage && typeof anyOrder.giftMessage === 'string' && anyOrder.giftMessage) data.giftMessage = anyOrder.giftMessage;
    if (!direct.customerNote && typeof anyOrder.customerNote === 'string' && anyOrder.customerNote) data.customerNote = anyOrder.customerNote;
    if (Object.keys(data).length === 0) {
      return { orderId: direct.id, created: false, wrote: false, statusChanged: false, effectsQueued: 0, liveKind: null, row: direct };
    }
    const row = await prisma.order.update({ where: { id: direct.id }, data });
    return { orderId: direct.id, created: false, wrote: true, statusChanged: false, effectsQueued: 0, liveKind: 'updated', row };
  }

  const rawData = order.rawData ? (typeof order.rawData === 'string' ? JSON.parse(order.rawData) : order.rawData) : Prisma.JsonNull;
  const base: Record<string, any> = {
    marketplace: order.marketplace,
    marketplaceKey: String(order.marketplaceKey),
    orderNumber: order.orderNumber,
    status: order.status,
    externalStatus: order.externalStatus,
    currency: order.currency,
    totalPrice: order.totalPrice,
    rawData,
    uiOrderDate: order.uiOrderDate || getUiOrderDate(order),
    commodityDesc: order.commodityDesc || '',
    source: order.source || null,
    orderHash,
    itemsHash,
    lastRemoteCheckAt: now,
  };
  // Only overwrite buyer notes when the mapper actually supplied content.
  if (typeof anyOrder.giftMessage === 'string' && anyOrder.giftMessage.length > 0) base.giftMessage = anyOrder.giftMessage;
  if (typeof anyOrder.customerNote === 'string' && anyOrder.customerNote.length > 0) base.customerNote = anyOrder.customerNote;
  if (shipByAt) base.shipByAt = shipByAt;

  if (!existing) {
    const recent = isRecentOrderDate(order.marketplaceOrderDate || base.uiOrderDate, now.getTime());
    try {
      const out = await prisma.$transaction(
        async (tx) => {
          const row = await tx.order.create({
            data: {
              ...base,
              userId,
              customerName: order.customerName || '',
              shippingAddress: incomingAddress ? JSON.stringify(incomingAddress) : Prisma.JsonNull,
              trackingNumber: order.trackingNumber || null,
              cancelledAt: nextClass === 'cancelled' ? now : null,
              lastEventAt: nextClass === 'open' ? null : now,
            } as Prisma.OrderUncheckedCreateInput,
          });
          await upsertOrderItems(tx, row.id, lines);
          const queued = await insertOrderEffects(
            tx,
            row.id,
            deriveOrderEffects({ statusClass: nextClass, itemsHash, quiet: !recent, includeStock: false, includeShipped: false }),
            { source: 'sync' },
          );
          return { row, queued };
        },
        { timeout: 15_000, maxWait: 10_000 },
      );
      return {
        orderId: out.row.id,
        created: true,
        wrote: true,
        statusChanged: true,
        effectsQueued: out.queued.length,
        liveKind: liveKindForOrderWrite({ created: true, next: nextClass, changed: true, recent }),
        row: out.row,
      };
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      // Created concurrently by another writer: nothing more to do in this pass.
      const row = await prisma.order.findFirst({ where: { userId, marketplace: order.marketplace, marketplaceKey: String(order.marketplaceKey) } });
      return { orderId: row?.id || '', created: false, wrote: false, statusChanged: false, effectsQueued: 0, liveKind: null, row };
    }
  }

  const prevClass = classifyOrderStatus(existing.status, existing.externalStatus, existing.deliveredAt);
  const statusChanged = (existing.status || '') !== (order.status || '');
  const data: Record<string, any> = { ...base };
  const mergedAddress = mergeAddressPreferNonEmpty(existing.shippingAddress, incomingAddress);
  if (mergedAddress && !sameAddress(existing.shippingAddress, mergedAddress)) data.shippingAddress = JSON.stringify(mergedAddress);
  const name = mergeNamePreferNonEmpty(existing.customerName, order.customerName);
  if (name !== null && name !== existing.customerName) data.customerName = name;
  // Marketplace tracking is fill-if-empty: never clobber a number entered locally.
  if (order.trackingNumber && !existing.trackingNumber) data.trackingNumber = order.trackingNumber;
  if (nextClass === 'cancelled' && !existing.cancelledAt) data.cancelledAt = now;
  if (statusChanged) data.lastEventAt = now;
  if (existing.weightEditedAt) {
    // Manual weight/dimension edits on the order are never overwritten by sync.
    for (const k of ['weightKg', 'packageLength', 'packageWidth', 'packageHeight', 'dimensionUnits']) delete data[k];
  }

  const out = await prisma.$transaction(
    async (tx) => {
      const row = await tx.order.update({ where: { id: existing.id }, data });
      if (itemsChanged) await upsertOrderItems(tx, existing.id, lines);
      // Pre-W4 rows (no OrderEffect yet) are quiet only when the stored state already matches;
      // a real open -> cancelled transition still raises cancel_label_alert.
      const quiet = quietForExistingWrite({ seeded: await hasOrderEffects(tx, existing.id), prevClass, nextClass });
      const queued = await insertOrderEffects(
        tx,
        existing.id,
        deriveOrderEffects({ statusClass: nextClass, itemsHash, quiet, includeStock: false, includeShipped: false }),
        { source: 'sync' },
      );
      return { row, queued };
    },
    { timeout: 15_000, maxWait: 10_000 },
  );
  const changed = existing.orderHash !== orderHash || itemsChanged || data.shippingAddress !== undefined || data.customerName !== undefined;
  return {
    orderId: existing.id,
    created: false,
    wrote: true,
    statusChanged,
    effectsQueued: out.queued.length,
    liveKind: liveKindForOrderWrite({ created: false, prev: prevClass, next: nextClass, changed, recent: false }),
    row: out.row,
  };
}

/**
 * Extension-scraped Etsy address (EtsyAddress) for one receipt, normalised to
 * the Order.shippingAddress shape. Unlike extractAddressEnriched this does not
 * depend on the marketplace string (direct Etsy orders use the shop name).
 */
export async function getEtsyExtensionAddress(userId: string, orderNumber: string, etsyStoreId?: string | null): Promise<NormalizedAddress | undefined> {
  try {
    const row =
      (etsyStoreId
        ? await prisma.etsyAddress.findFirst({ where: { userId, orderNumber, etsyStoreId }, select: { shippingAddress: true } })
        : null) || (await prisma.etsyAddress.findFirst({ where: { userId, orderNumber }, orderBy: { updatedAt: 'desc' }, select: { shippingAddress: true } }));
    if (!row) return undefined;
    return normalizeEtsyAddress(row);
  } catch (error) {
    logger.warn('[OrderSync] EtsyAddress lookup failed', { error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

// Alias for API compatibility
export { syncAllOrders as fullSyncAllOrders };