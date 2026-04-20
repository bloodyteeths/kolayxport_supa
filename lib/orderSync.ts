import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from './logger';
import { startSync, updateSyncProgress as updateSyncStatus, completeSync } from './sync-status';
import { SyncType } from './types';
import fetch from 'node-fetch';
import { UIOrder, OrderSource, OrderChannel, NormalizedAddress, NormalizedLineItem } from './types';
import { getIntegrationCreds } from './config';
import { fetchVeeqoOrders, processOrdersInBatches } from './integrations/veeqo';
import { fetchShippoOrders } from './integrations/shippo';
import { fetchEtsyOrders } from './integrations/etsyOrderSync';
import { fetchEbayOrders } from './integrations/ebayOrderSync';
import type { VeeqoOrder } from './types';
import { batchExecuteStatusUpdateHook } from './hooks/statusUpdateHook';

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

// Normalize Etsy address from extension data
function normalizeEtsyAddress(etsyAddressData: any): NormalizedAddress | undefined {
  if (!etsyAddressData?.shippingAddress) {
    return undefined;
  }

  const addr = etsyAddressData.shippingAddress;
  
  return {
    name: addr.name || '',
    phone: addr.phone || '',
    street1: addr.line1 || '',
    street2: addr.line2 || '',
    city: addr.city || '',
    state: addr.state || '',
    postal: addr.postalCode || addr.postal || '',
    country: addr.country || 'US',
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
  let syncId: string | undefined;
  let processed = 0;
  let successful = 0;
  let failed = 0;
  let ordersCreated = 0;
  let ordersUpdated = 0;
  const errors: Array<{ orderId: string; error: string }> = [];

  try {
    const { veeqoApiKey, shippoToken, startDate, endDate, source, channel } = options;
    
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

    // CRITICAL FIX: Use separate if statements instead of else-if to fetch from BOTH sources
    if ((typeof source === 'undefined' || source === 'veeqo') && veeqoApiKey) {
      if (options.syncType === 'fast') {
        logger.info(`[FastSync] Triggering Veeqo fetch (first page only). Options:`, { userId, source, veeqoApiKey: !!veeqoApiKey, lastSyncTime });
        const veeqoClient = createVeeqoClient(veeqoApiKey);
        fetchPromises.push(
          (async () => {
            const orders = await fetchVeeqoOrders({ apiKey: veeqoApiKey, page: 1, perPage: 100, lastSync: lastSyncTime });
            logger.info(`[FastSync] Veeqo fetch returned ${orders.length} orders.`, { userId });
            const processedOrders = await Promise.all(orders.map(async order => {
              return await validateAndMapOrder(order, veeqoClient);
            }));
            logger.info(`[FastSync] Veeqo processedOrders after mapping: ${processedOrders.length}`);
            return processedOrders.filter((order): order is UIOrder => order !== null);
          })()
        );
      } else {
        logger.info(`[FullSync] Triggering Veeqo fetch with API key present. Options:`, { userId, source, veeqoApiKey: !!veeqoApiKey, lastSyncTime });
        const veeqoClient = createVeeqoClient(veeqoApiKey);
        fetchPromises.push(
          (async () => {
            const orders = await fetchVeeqoOrders({ apiKey: veeqoApiKey, lastSync: lastSyncTime });
            logger.info(`[FullSync] Veeqo fetch returned ${orders.length} orders.`, { userId });
            const processedOrders = await Promise.all(orders.map(async order => {
              return await validateAndMapOrder(order, veeqoClient);
            }));
            logger.info(`[FullSync] Veeqo processedOrders after mapping: ${processedOrders.length}`);
            return processedOrders.filter((order): order is UIOrder => order !== null);
          })()
        );
      }
    }

    // CRITICAL FIX: Changed from 'else if' to 'if' to fetch from BOTH sources
    if ((typeof source === 'undefined' || source === 'shippo') && shippoToken) {
      if (options.syncType === 'fast') {
        logger.info(`[FastSync] Triggering Shippo fetch (first page only). Options:`, { userId, source, shippoToken: !!shippoToken });
        const etdDefaults = await getEtdDefaults(userId);
        
        // Use same 6-hour window as other integrations for consistency
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
        const shippoDateFilter = sixHoursAgo.toISOString();
        logger.info(`[FastSync] Shippo date filter: ${shippoDateFilter}`);
        
        fetchPromises.push(
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
          
          fetchPromises.push(
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
    if (typeof source === 'undefined' || source === 'amazon') {
      try {
        const cred = await prisma.credential.findUnique({ where: { userId } }) as any;
        if (cred?.amazonAccessToken && cred?.amazonRefreshToken) {
          const { getValidToken } = await import('./integrations/amazonClient');
          const { fetchOrderReport } = await import('./integrations/amazonReports');
          const { toNormalizedOrderFromReport, parseOrderReport } = await import('./mappers/amazon');

          const token = await getValidToken(cred, async (newToken: string, expiresAt: Date) => {
            await prisma.credential.update({
              where: { userId },
              data: { amazonAccessToken: newToken, amazonTokenExpiresAt: expiresAt } as any,
            });
          });

          if (token) {
            const region = (cred.amazonRegion || 'eu') as 'na' | 'eu' | 'fe';
            const marketplaceIds = [cred.amazonMarketplaceId || 'ATVPDKIKX0DER'];

            // Use 30-day window for orders
            const syncStart = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const syncEnd = endDate || new Date();

            fetchPromises.push(
              (async () => {
                try {
                  logger.info('[AmazonSync] Requesting order report', { userId, region });
                  const tsv = await fetchOrderReport(token, region, marketplaceIds, syncStart, syncEnd);
                  const rows = parseOrderReport(tsv);
                  const orders = rows.map(toNormalizedOrderFromReport);
                  logger.info(`[AmazonSync] Parsed ${orders.length} orders from report`, { userId });
                  return orders;
                } catch (err: any) {
                  logger.error('[AmazonSync] Order sync failed', err, { userId });
                  return [];
                }
              })()
            );
          }
        }
      } catch (err: any) {
        logger.error('[AmazonSync] Failed to initialize', err, { userId });
      }
    }

    // Direct Etsy API sync (has real per-item prices, unlike Shippo)
    if (typeof source === 'undefined' || source === 'etsy-api') {
      try {
        const etsyShops = await prisma.etsyShop.findMany({ where: { userId, isActive: true } });
        console.log(`[OrderSync] Etsy shops found: ${etsyShops.length}`);
        if (etsyShops.length > 0) {
          fetchPromises.push(
            fetchEtsyOrders(userId, { lastSync: lastSyncTime }).catch(err => {
              logger.error('[EtsyOrderSync] Failed', err instanceof Error ? err : new Error(String(err)));
              return [] as UIOrder[];
            })
          );
        }
      } catch (err) {
        logger.error('[EtsyOrderSync] Init failed', err instanceof Error ? err : new Error(String(err)));
      }
    }

    // Direct eBay API sync (has real per-item prices)
    if (typeof source === 'undefined' || source === 'ebay-api') {
      try {
        const cred = await prisma.credential.findUnique({ where: { userId } });
        if ((cred as any)?.ebayAccessToken) {
          fetchPromises.push(
            fetchEbayOrders(userId, { lastSync: lastSyncTime }).catch(err => {
              logger.error('[EbayOrderSync] Failed', err instanceof Error ? err : new Error(String(err)));
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

    // Bulk prefetch all relevant existing orders
    const existingOrders = await prisma.order.findMany({
      where: {
        userId,
        marketplace: { in: filteredOrders.map(o => o.marketplace) },
        marketplaceKey: { in: filteredOrders.map(o => o.marketplaceKey) },
      },
    });
    const existingOrderMap = new Map(existingOrders.map(o => [o.marketplaceKey, o]));

    // Filter to only orders that are new or changed
    const ordersToProcess: UIOrder[] = [];
    const skippedOrderIds: string[] = [];
    const skippedOrderMarketplaceKeys: string[] = [];

    // Helper: Retry async function with exponential backoff
    async function retry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 300): Promise<T> {
      let attempt = 0;
      while (true) {
        try {
          return await fn();
        } catch (err: any) {
          attempt++;
          // Only retry for Prisma transaction timeout (P2028)
          if (attempt > retries || err?.code !== 'P2028') throw err;
          const delay = baseDelay * Math.pow(2, attempt - 1);
          logger.warn(`[Order Sync] Transaction failed with P2028. Retrying attempt ${attempt}/${retries} after ${delay}ms...`, { error: err.message });
        }
      }
    }

    for (const order of filteredOrders) {
      // For Veeqo orders, ensure commodityDesc is mapped from first line item title
      if (order.source === 'veeqo' && (!order.commodityDesc || order.commodityDesc === '')) {
        if (order.line_items && order.line_items.length > 0) {
          order.commodityDesc = order.line_items[0].title || '';
        }
      }
      // For Shippo orders, ensure commodityDesc is mapped from first line item title
      if (order.source === 'shippo' && (!order.commodityDesc || order.commodityDesc === '')) {
        if (order.line_items && order.line_items.length > 0) {
          order.commodityDesc = order.line_items[0].title || '';
        }
      }
      const existing = existingOrderMap.get(order.marketplaceKey) as UIOrder | undefined;
      const prismaOrderData: { [key: string]: any } = {
        userId,
        marketplace: order.marketplace,
        marketplaceKey: order.marketplaceKey,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        status: order.status,
        externalStatus: order.externalStatus,
        currency: order.currency,
        totalPrice: order.totalPrice,
        shippingAddress: order.to_address ? JSON.stringify(order.to_address) : Prisma.JsonNull,
        rawData: order.rawData ? (typeof order.rawData === 'string' ? JSON.parse(order.rawData) : order.rawData) : Prisma.JsonNull,
        createdAt: order.createdAt ? new Date(order.createdAt) : new Date(),
        updatedAt: new Date(),
        uiOrderDate: getUiOrderDate(order),
        commodityDesc: order.commodityDesc || '',
      };  
      if (!existing) {
        ordersToProcess.push(order);
      } else {
        const hasChanged = (
          ((existing?.externalStatus ?? undefined) !== (prismaOrderData.externalStatus ?? undefined)) ||
          (existing?.totalPrice !== prismaOrderData.totalPrice) ||
          (existing?.customerName !== prismaOrderData.customerName) ||
          ((existing?.shippingAddress ?? '') !== (prismaOrderData.shippingAddress ?? ''))
        );
        const missingStatus = ((existing?.externalStatus ?? null) === null && prismaOrderData.externalStatus);

        const missingUiOrderDate = !(existing?.uiOrderDate);
        if (hasChanged || missingStatus || missingUiOrderDate) {
          ordersToProcess.push(order);
        } else {
          if (existing) {
          skippedOrderIds.push(existing.id);
          skippedOrderMarketplaceKeys.push(existing.marketplaceKey);
        }
        }
      }
    }

    // Batch summary logs for skipped orders and line items
    if (skippedOrderIds.length > 0) {
      logger.info(`[Order Sync] Skipped ${skippedOrderIds.length} unchanged orders. Sample IDs: ${skippedOrderIds.slice(0, 10).join(', ')}${skippedOrderIds.length > 10 ? ', ...' : ''}`);
      logger.info(`[Order Sync] Skipped line items for ${skippedOrderIds.length} unchanged orders. Sample marketplaceKeys: ${skippedOrderMarketplaceKeys.slice(0, 10).join(', ')}${skippedOrderMarketplaceKeys.length > 10 ? ', ...' : ''}`);
    }

    // Process all new orders, and only update existing orders if status is cancelled/canceled or tracked fields have changed
    const BATCH_SIZE = 25; // Reduced batch size to prevent statement timeouts
    const batches: UIOrder[][] = [];
    for (let i = 0; i < ordersToProcess.length; i += BATCH_SIZE) {
      batches.push(ordersToProcess.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      // Process each order in the batch
      try {
        const orderMarketplaceKeys = batch.map(o => o.marketplaceKey);
        
        // Bulk fetch existing orders for the current batch (smaller query)
        const existingOrdersInDb = await prisma.order.findMany({
          where: { 
            userId, 
            marketplaceKey: { in: orderMarketplaceKeys }
          }
        });
        const existingOrdersMap = new Map(existingOrdersInDb.map(o => [o.marketplaceKey, o]));
        
        const ordersToCreate: Prisma.OrderCreateManyInput[] = [];
        const ordersToUpdate: { where: Prisma.OrderWhereUniqueInput; data: Prisma.OrderUpdateInput }[] = [];

        for (const order of batch) {
          const existingOrder = existingOrdersMap.get(order.marketplaceKey);
          
          // Create the base order data (without userId for updates)
          const baseOrderData = {
            marketplace: order.marketplace,
            marketplaceKey: order.marketplaceKey,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            status: order.status,
            externalStatus: order.externalStatus,
            currency: order.currency,
            totalPrice: order.totalPrice,
            shippingAddress: order.to_address ? JSON.stringify(order.to_address) : (order.shippingAddress ? order.shippingAddress : Prisma.JsonNull),
            rawData: order.rawData ? (typeof order.rawData === 'string' ? JSON.parse(order.rawData) : order.rawData) : Prisma.JsonNull,
            uiOrderDate: order.uiOrderDate,
            commodityDesc: order.commodityDesc,
            // shipByDate, channel, and source are UI-only fields, not stored in database
          };

          if (existingOrder) {
            // Add to update list
            ordersToUpdate.push({
              where: { id: existingOrder.id },
              data: baseOrderData,
            });
          } else {
            // Add to create list (include userId for new orders)
            ordersToCreate.push({
              ...baseOrderData,
              userId, // Only include userId for new orders
            });
          }
        }

        // Bulk create new orders and their items in a transaction
        if (ordersToCreate.length > 0) {
          logger.info(`[Order Sync] Creating ${ordersToCreate.length} new orders in the database.`);
          await prisma.$transaction(async (tx) => {
            await tx.order.createMany({
              data: ordersToCreate,
              skipDuplicates: true,
            });
            await createOrderItemsForBatch(batch, existingOrdersMap, userId, tx as typeof prisma);
          });
          ordersCreated += ordersToCreate.length;
        } else {
          // No new orders to create, but still need to create items for updated orders
          await createOrderItemsForBatch(batch, existingOrdersMap, userId);
        }

        // Process orders to update in smaller chunks to avoid overwhelming the connection pool
        if (ordersToUpdate.length > 0) {
          logger.info(`[Order Sync] Updating ${ordersToUpdate.length} orders in the database.`);

          const updateChunkSize = 5; // Even smaller chunks for updates
          for (let i = 0; i < ordersToUpdate.length; i += updateChunkSize) {
            const chunk = ordersToUpdate.slice(i, i + updateChunkSize);
            await prisma.$transaction(
              chunk.map(({ where, data }) => prisma.order.update({ where, data }))
            );
          }
          ordersUpdated += ordersToUpdate.length;
        }

        // Execute status update hook for all orders in this batch
        // This will check if any orders have "SHIPPED" status and update custom status to "shipped"
        const batchOrderIds = batch.map(order => {
          const existingOrder = existingOrdersMap.get(order.marketplaceKey);
          return existingOrder?.id || '';
        }).filter(Boolean);
        
        if (batchOrderIds.length > 0) {
          try {
            await batchExecuteStatusUpdateHook(batchOrderIds, userId);
          } catch (hookError) {
            logger.warn(`[Status Update Hook] Failed for batch:`, hookError);
            // Don't fail the entire sync if hook fails
          }
        }

        processed += batch.length;
        successful += batch.length;
        logger.info(`[Order Sync] Processed batch: ${batch.length} orders (${processed}/${ordersToProcess.length} total)`);

      } catch (error) {
        logger.error(`[Order Sync] Batch failed:`, error);
        failed += batch.length;
        processed += batch.length;
        errors.push({ 
          orderId: `batch_${batches.indexOf(batch)}`, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }

      // Update sync progress after each batch
      await updateSyncStatus(syncId!, {
        processedOrders: processed,
        successfulOrders: successful,
        failedOrders: failed,
        totalOrders: ordersToProcess.length,
      });

      // Small delay between batches to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

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
      skippedOrders: filteredOrders.length - ordersToProcess.length,
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

// Helper function to create OrderItems for a batch of orders
async function createOrderItemsForBatch(
  orders: UIOrder[],
  existingOrdersMap: Map<string, any>,
  userId: string,
  db: typeof prisma = prisma
): Promise<void> {
  try {
    const orderItemsToCreate: any[] = [];

    // Get the order IDs after they've been created/updated
    const orderMarketplaceKeys = orders.map(o => o.marketplaceKey);
    const currentOrdersInDb = await db.order.findMany({
      where: {
        userId,
        marketplaceKey: { in: orderMarketplaceKeys }
      },
      select: { id: true, marketplaceKey: true }
    });
    const orderIdMap = new Map(currentOrdersInDb.map(o => [o.marketplaceKey, o.id]));

    for (const order of orders) {
      const orderId = orderIdMap.get(order.marketplaceKey);
      if (!orderId) {
        logger.warn(`[OrderItems] Could not find order ID for marketplaceKey: ${order.marketplaceKey}`);
        continue;
      }

      // For existing orders, only recreate OrderItems if they don't exist or line items have changed
      const existingOrder = existingOrdersMap.get(order.marketplaceKey);
      if (existingOrder) {
        const existingItemCount = await db.orderItem.count({
          where: { orderId: existingOrder.id }
        });

        // Always update OrderItems to reflect latest marketplace data (title, weight, hs_code, etc.)
        if (existingItemCount > 0) {
          await db.$transaction(async (tx) => {
            await tx.orderItem.deleteMany({ where: { orderId } });
            const lineItems = order.line_items || [];
            const freshItems = lineItems.map((item, i) => ({
              orderId,
              productName: item.title || 'Unknown Product',
              quantity: item.quantity || 1,
              unitPrice: item.value || 0,
              totalPrice: (item.value || 0) * (item.quantity || 1),
              weightKg: item.weight || 0.5,
              harmonizedCode: item.hs_code || '',
              countryOfMfg: item.country_of_origin || '',
              sku: item.sku || '',
              image: item.image || '',
              variantInfo: item.variantInfo || '',
              notes: (item as any).notes || (item as any).description || (order as any).notes || '',
              marketplaceKey: String(item.id || `${order.marketplaceKey}-${i}`),
              orderNumber: order.orderNumber || '',
              uniqueLineKey: String(item.id || `${order.marketplaceKey}-${i}`),
              productId: null,
              remoteLineId: String(item.id || ''),
              shipBy: item.shipBy || order.shipByDate || null,
            }));
            if (freshItems.length > 0) {
              await tx.orderItem.createMany({ data: freshItems, skipDuplicates: true });
            }
          });
          continue; // Items already refreshed via transaction above
        }
      }

      // Create OrderItems from line_items
      const lineItems = order.line_items || [];
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        orderItemsToCreate.push({
          orderId,
          productName: item.title || 'Unknown Product',
          quantity: item.quantity || 1,
          unitPrice: item.value || 0,
          totalPrice: (item.value || 0) * (item.quantity || 1),
          weightKg: item.weight || 0.5,
          harmonizedCode: item.hs_code || '',
          countryOfMfg: item.country_of_origin || '',
          sku: item.sku || '',
          image: item.image || '',
          variantInfo: item.variantInfo || '',
          notes: (item as any).notes || (item as any).description || (order as any).notes || '', // Extract notes from item or order level
          marketplaceKey: String(item.id || `${order.marketplaceKey}-${i}`),
          orderNumber: order.orderNumber || '',
          uniqueLineKey: String(item.id || `${order.marketplaceKey}-${i}`),
          productId: null, // line_items don't have productId
          remoteLineId: String(item.id || ''),
          shipBy: item.shipBy || order.shipByDate || null,
        });
      }
    }

    // Bulk create OrderItems
    if (orderItemsToCreate.length > 0) {
      logger.info(`[OrderItems] Creating ${orderItemsToCreate.length} OrderItems for ${orders.length} orders`);
      await db.orderItem.createMany({
        data: orderItemsToCreate,
        skipDuplicates: true,
      });
    }

  } catch (error) {
    logger.error(`[OrderItems] Error creating OrderItems:`, error);
    // Don't throw - this shouldn't fail the entire sync
  }
}

// Alias for API compatibility
export { syncAllOrders as fullSyncAllOrders };