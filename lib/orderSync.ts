import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from './logger';
import { startSync, updateSyncProgress, completeSync } from './sync-status';
import { SyncType } from './types';
import fetch from 'node-fetch';
import { UIOrder, OrderSource, OrderChannel, NormalizedAddress, NormalizedLineItem } from './types';
import { getIntegrationCreds } from './config';
import { fetchAllVeeqoOrders, fetchVeeqoOrders, processOrdersInBatches } from './integrations/veeqo';
import { fetchShippoOrders } from './integrations/shippo';
import type { VeeqoOrder } from './types';

const TRANSACTION_TIMEOUT = 10000; // 10 second timeout for transactions

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

  // Fallback to marketplace field (from DB model)
  const marketplace = order.marketplace?.toLowerCase() || '';
  if (marketplace.includes('etsy')) return 'etsy';
  if (marketplace.includes('shopify')) return 'shopify';
  if (marketplace.includes('amazon')) return 'amazon';
  if (marketplace.includes('ebay')) return 'ebay';
  
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

function extractAddress(order: any): NormalizedAddress | undefined {
  let toAddress: NormalizedAddress | undefined = undefined;

  // Try to get address based on source
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
// console.warn('Failed to parse order.notes:', order.notes);
      }
    }
    
    // If no address from notes, try rawData
    if (!toAddress && order.rawData) {
      toAddress = normalizeVeeqoAddress(order.rawData.deliver_to || order.rawData.shipping_address);
      }
    }

  // Log if address is still undefined
  if (!toAddress) {
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

async function resolveVeeqoImageUrl(item: VeeqoLineItem, veeqoClient: any): Promise<string> {
  // Try all possible image sources in order of preference
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

  // Find first non-empty image URL
  let imageUrl = imageSources.find(url => url && typeof url === 'string') || '';

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

  // Map line items with image URLs
  const lineItems = await Promise.all(getVeeqoLineItems(order).map(async (item: any) => {
    const imageUrl = await resolveVeeqoImageUrl(item, veeqoClient);
    
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
                       item.sellable?.sellable_title || 
                       item.variant_options_string || 
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
      shipBy: order.due_date // Add the due_date from the order
    };
  }));

  const address = {
    name: `${recipientFirstName} ${recipientLastName}`.trim(),
    phone: '',
    street1: recipientStreet1,
    street2: '',
    city: recipientCity,
    state: '',
    postal: '',
    country: recipientCountry,
    isResidential: false
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
    commodityDesc: lineItems.length > 0 ? lineItems[0].title || '' : ''
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

function splitName(fullName: string) {
  const parts = (fullName || '').split(' ');
  return {
    first: parts[0] || '',
    last: parts.slice(1).join(' ') || '',
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
  let errors: Array<{ orderId: string; error: string }> = [];

  try {
    const { veeqoApiKey, shippoToken, startDate, endDate, source, channel } = options;
    
    const lastSyncEntry = await prisma.syncOperation.findFirst({
      where: { userId, status: 'completed' },
      orderBy: { updatedAt: 'desc' },
    });
    
    // For full sync of Etsy orders, we don't want to use lastSyncTime because we need to merge all orders
    // For fast/recent syncs, use incremental fetching
    const useIncrementalSync = options.syncType === 'fast' || options.syncType === 'recent';
    const lastSyncTime = useIncrementalSync ? lastSyncEntry?.updatedAt : undefined;

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
            const orders = await fetchAllVeeqoOrders({ apiKey: veeqoApiKey, lastSync: lastSyncTime });
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
        fetchPromises.push(
          fetchShippoOrders(shippoToken, { page: '1', results: '100' }).then(orders => {
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
                weight: parseFloat(item.weight) || etdDefaults.weightKg,
                sku: item.sku || '',
                hs_code: etdDefaults.harmonizedCode,
                country_of_origin: etdDefaults.countryOfMfg,
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
              };
            });
          })
        );
      } else {
        logger.info(`[FullSync] Triggering Shippo fetch with token present. Options:`, { userId, source, shippoToken: !!shippoToken });
        const etdDefaults = await getEtdDefaults(userId);
        fetchPromises.push(
          fetchShippoOrders(shippoToken).then(orders => {
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
                weight: parseFloat(item.weight) || etdDefaults.weightKg,
                sku: item.sku || '',
                hs_code: etdDefaults.harmonizedCode,
                country_of_origin: etdDefaults.countryOfMfg,
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
              };
            });
          })
        );
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
        // Core merging logic
        const merged: UIOrder = {
          ...existing,
          ...order,
          // Prioritize Shippo for address, as it's more reliable
          to_address: order.source === 'shippo' && order.to_address ? order.to_address : existing.to_address,
          // Prioritize Veeqo for richer line item data (like images)
          line_items: existing.source === 'veeqo' && existing.line_items.length > 0 ? existing.line_items : order.line_items,
          // Combine rawData from both sources
          rawData: { ...(existing.rawData || {}), ...(order.rawData || {}) },
          // Mark as merged and use the most definitive source
          source: 'merged' as OrderSource,
          id: existing.id || order.id, // Ensure we keep a consistent ID
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
        shippingAddress: order.to_address ? JSON.stringify(order.to_address) : null,
        rawData: order.rawData ? JSON.stringify(order.rawData) : null,
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
    const BATCH_SIZE = 5; // Reduced batch size
    const batches: UIOrder[][] = [];
    for (let i = 0; i < ordersToProcess.length; i += BATCH_SIZE) {
      batches.push(ordersToProcess.slice(i, i + BATCH_SIZE));
    }

    // Summary counters
    let ordersCreated = 0, ordersUpdated = 0, ordersSkipped = filteredOrders.length - ordersToProcess.length, itemsTotalUpserted = 0;

    logger.info(`[Order Sync] Starting sync: ${ordersToProcess.length} orders to process in ${batches.length} batches (batch size ${BATCH_SIZE})`);

    for (const batch of batches) {
      // Process each order in the batch sequentially
      for (const order of batch) {
        let orderAction: 'created' | 'updated' | 'skipped' = 'skipped';
        try {
          const { line_items, ...orderData } = order;
          // Prepare prismaOrderData for this order
          const prismaOrderData = {
            userId,
            marketplace: orderData.marketplace,
            marketplaceKey: orderData.marketplaceKey,
            orderNumber: orderData.orderNumber,
            customerName: orderData.customerName,
            status: orderData.status,
            externalStatus: orderData.externalStatus,
            currency: orderData.currency,
            totalPrice: orderData.totalPrice,
            shippingAddress: orderData.to_address ?? undefined,
            rawData: orderData.rawData ?? undefined,
            createdAt: orderData.createdAt ? new Date(orderData.createdAt) : new Date(),
            updatedAt: new Date(),
            uiOrderDate: getUiOrderDate(order),
            commodityDesc: order.commodityDesc || '',
          };

          // Wrap the transaction in retry logic
          const savedOrder = await retry(() => prisma.$transaction(async tx => {
            const existingOrder = await tx.order.findFirst({
              where: {
                userId,
                marketplace: prismaOrderData.marketplace,
                marketplaceKey: prismaOrderData.marketplaceKey,
              },
            });

            let savedOrder;
            let orderAction: 'created' | 'updated' | 'skipped' = 'skipped';
            if (existingOrder) {
              // Only update if status is cancelled/canceled or tracked fields have changed
              const status = (prismaOrderData.status || '').toLowerCase();
              const isCancelled = status === 'cancelled' || status === 'canceled';
              const hasChanged = (
                ((existingOrder as any).externalStatus ?? undefined) !== (prismaOrderData.externalStatus ?? undefined) ||
                existingOrder.totalPrice !== prismaOrderData.totalPrice ||
                existingOrder.customerName !== prismaOrderData.customerName ||
                (existingOrder.shippingAddress ?? '') !== (prismaOrderData.shippingAddress ?? '')
              );
              const missingStatus = ((existingOrder as any).externalStatus ?? null) === null && prismaOrderData.externalStatus;

              const missingUiOrderDate = !(existingOrder as any).uiOrderDate;

              const existingOrderItems = await tx.orderItem.findMany({
                where: { orderId: existingOrder.id },
                select: { remoteLineId: true, shipBy: true, image: true, variantInfo: true }
              });
              const missingShipBy = existingOrderItems.some(dbItem => {
                const newItem = line_items.find(li => String(li.id) === String(dbItem.remoteLineId));
                return dbItem.shipBy == null && newItem && newItem.shipBy;
              });
              // Check for missing image or variantInfo in any order item
              const missingImage = existingOrderItems.some(dbItem => {
                const newItem = line_items.find(li => String(li.id) === String(dbItem.remoteLineId));
                return (dbItem.image == null || dbItem.image === '') && newItem && newItem.image && newItem.image !== '';
              });
              const missingVariantInfo = existingOrderItems.some(dbItem => {
                const newItem = line_items.find(li => String(li.id) === String(dbItem.remoteLineId));
                return (dbItem.variantInfo == null || dbItem.variantInfo === '') && newItem && newItem.variantInfo && newItem.variantInfo !== '';
              });
              // Check for missing commodityDesc in Order
              const missingCommodityDesc = !(existingOrder as any).commodityDesc && (prismaOrderData as any).commodityDesc;

              if (isCancelled || hasChanged || missingStatus || missingUiOrderDate || missingShipBy || missingImage || missingVariantInfo || missingCommodityDesc) {
                savedOrder = await tx.order.update({
                  where: { id: existingOrder.id },
                  data: {
                    ...prismaOrderData,
                    status: "Synced",
                    labelStatus: null,
                    updatedAt: new Date()
                  },
                });
                orderAction = 'updated';
                logger.info(`[Order Sync] Updated order: ${savedOrder.id} (${savedOrder.marketplaceKey})`);
              } else {
                // No change, skip update
                savedOrder = existingOrder;
                orderAction = 'skipped';
                logger.info(`[Order Sync] Skipped order (no changes): ${savedOrder.id} (${savedOrder.marketplaceKey})`);
              }
            } else {
              savedOrder = await tx.order.create({
                data: {
                  ...prismaOrderData,
                  status: "Synced",
                  labelStatus: null,
                  createdAt: new Date(),
                  updatedAt: new Date()
                },
              });
              orderAction = 'created';
              logger.info(`[Order Sync] Created new order: ${savedOrder.id} (${savedOrder.marketplaceKey})`);
            }

            // Only update/create shipment if order was created or updated
            if (orderAction === 'created' || orderAction === 'updated') {
              const existingShipment = await tx.shipment.findFirst({
                where: { orderId: savedOrder.id }
              });

              if (existingShipment) {
                await tx.shipment.update({
                  where: { id: existingShipment.id },
                  data: {
                    status: "pending",
                    updatedAt: new Date()
                  }
                });
              } else {
                await tx.shipment.create({
                  data: {
                    orderId: savedOrder.id,
                    status: "pending",
                    serviceType: "FEDEX_GROUND",
                    carrier: "FEDEX",
                    createdAt: new Date(),
                    updatedAt: new Date()
                  }
                });
              }
            }

            // Only upsert line items if order was created or updated
            let itemsUpserted = 0;
            if ((orderAction === 'created' || orderAction === 'updated') && line_items?.length > 0) {
              for (const item of line_items) {
                await tx.orderItem.upsert({
                  where: {
                    remoteLineId_orderId: {
                      remoteLineId: String(item.id),
                      orderId: savedOrder.id,
                    }
                  },
                  create: {
                    orderId: savedOrder.id,
                    productName: String(item.title || ''),
                    quantity: Number(item.quantity),
                    unitPrice: Number(((item["total_price"] ?? (item["price"] * item["quantity"])) ?? 0) / (item.quantity || 1)),
                    totalPrice: Number((item["total_price"] ?? (item["price"] * item["quantity"])) ?? 0),
                    weightKg: Number(typeof item["weight"] === 'number' ? item["weight"] : 0.5),
                    sku: String(item["sku"] || ''),
                    remoteLineId: String(item.id),
                    marketplaceKey: String(prismaOrderData.marketplaceKey),
                    orderNumber: String(prismaOrderData.orderNumber),
                    image: item.image || '',
                    shipBy: item.shipBy ? new Date(item.shipBy) : undefined,
                    variantInfo: item.variantInfo || (item as any).variant_title || ((item as any).product_variant ? (item as any).product_variant.title : undefined) || '',
                  },
                  update: {
                    productName: String(item.title || ''),
                    quantity: Number(item.quantity),
                    unitPrice: Number(((item["total_price"] ?? (item["price"] * item["quantity"])) ?? 0) / (item.quantity || 1)),
                    totalPrice: Number((item["total_price"] ?? (item["price"] * item["quantity"])) ?? 0),
                    weightKg: Number(typeof item["weight"] === 'number' ? item["weight"] : 0.5),
                    sku: String(item["sku"] || ''),
                    marketplaceKey: String(prismaOrderData.marketplaceKey),
                    orderNumber: String(prismaOrderData.orderNumber),
                    image: item.image || '',
                    variantInfo: item.variantInfo || (item as any).variant_title || ((item as any).product_variant ? (item as any).product_variant.title : undefined) || '',
                    // If the existing OrderItem has no shipBy, but the new item does, update it
                    ...(item.shipBy ? { shipBy: new Date(item.shipBy) } : {}),
                  },
                });
                itemsUpserted++;
              }
              logger.info(`[Order Sync] Upserted ${itemsUpserted} item(s) for order ${savedOrder.id}`);
            } else if (orderAction === 'skipped') {
              logger.info(`[Order Sync] Skipped line items for order ${savedOrder.id} (order unchanged)`);
            }

          }, {
            timeout: 30000 // Increased timeout to 30 seconds
          }));
          processed++;
          if (orderAction === ('created' as typeof orderAction)) {
            successful++;
            ordersCreated++;
          } else if (orderAction === ('updated' as typeof orderAction)) {
            successful++;
            ordersUpdated++;
          } else {
            // Only possible remaining value is 'skipped'
            ordersSkipped++;
          }
        } catch (error: any) {
          processed++;
          failed++;
          const errorMsg = error.message || 'Unknown error';
          errors.push({ orderId: String(order.id), error: errorMsg });
          logger.error('Failed to store order', error, { orderId: order.id, marketplaceKey: order.marketplaceKey, orderAction });
        }

        // Add a small delay between processing each order
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Update sync progress after each batch
      await updateSyncProgress(syncId!, {
        processedOrders: processed,
        successfulOrders: successful,
        failedOrders: failed,
        totalOrders: filteredOrders.length,
        errors,
      });

      // Add a delay between batches
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Complete the sync
    if (syncId) {
      await completeSync(syncId, failed === 0, {
        processedOrders: processed ?? 0,
        successfulOrders: successful ?? 0,
        failedOrders: failed ?? 0,
        totalOrders: filteredOrders.length,
        errors,
      });
    }

    return {
      newOrders: ordersCreated,
      updatedOrders: ordersUpdated,
      skippedOrders: ordersSkipped,
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

// Alias for API compatibility
export { syncAllOrders as fullSyncAllOrders };