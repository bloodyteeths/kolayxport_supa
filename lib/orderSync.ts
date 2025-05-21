import { PrismaClient } from '@prisma/client';
import { logger } from './logger';
import { startSync, updateSyncProgress, completeSync, SyncType } from './sync-status';
import fetch from 'node-fetch';
import { UIOrder, OrderSource, OrderChannel, NormalizedAddress, NormalizedLineItem } from './types';
import { fetchVeeqoOrders } from './integrations/veeqo';
import { fetchShippoOrders } from './integrations/shippo';
import type { VeeqoOrder } from './integrations/veeqo';

const prisma = new PrismaClient();

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
  quantity: number;
  price_per_unit: number;
  total_price: number;
  title: string;
  notes: string | null;
  image_url: string | null;
  line_item_id?: string;
  product_title?: string;
  sku?: string;
  sellable: VeeqoSellable;
  product?: VeeqoProduct;
  name?: string;
  additional_options?: string;
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
        console.warn('Failed to parse order.notes:', order.notes);
      }
    }
    
    // If no address from notes, try rawData
    if (!toAddress && order.rawData) {
      toAddress = normalizeVeeqoAddress(order.rawData.deliver_to || order.rawData.shipping_address);
      }
    }

  // Log if address is still undefined
  if (!toAddress) {
    console.warn('Failed to extract address:', {
      source: order.source,
      marketplace: order.marketplace,
      notes: order.notes,
      rawData: order.rawData
    });
    }

  return toAddress;
}

function normalizeVeeqoLineItems(order: any): NormalizedLineItem[] {
  return (order.line_items || []).map((item: any) => ({
    id: String(item.id),
    title: item.product_title || '',
    value: item.price || 0,
    quantity: item.quantity || 1,
    weight: item.weight,
    hs_code: item.harmonized_code,
    country_of_origin: item.country_of_manufacture,
    sku: item.variation_sku,
    image: item.product_image,
    variantInfo: item.variation_title
  }));
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
    variantInfo: item.product_variant
  }));
}

function validateAndMapOrder(order: VeeqoOrder) {
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

  // Validate critical address fields
  if (!recipientStreet1 || !recipientCity || !recipientCountry) {
    logger.warn('Missing shipping address', { 
      orderId: order.id,
      hasAddress: !!addr,
      hasStreet: !!recipientStreet1,
      hasCity: !!recipientCity,
      hasCountry: !!recipientCountry,
      addressFields: {
        street: recipientStreet1,
        city: recipientCity,
        country: recipientCountry
      }
    });
    return null;
  }

  // Map order items
  const items = (order.line_items || []).map((item, liIdx) => {
    const sell = item.image_url 
      ? { image_url: item.image_url } 
      : item.sellable || item.product || { product_title: '', sku_code: '' } as VeeqoSellable;
    
    const imgUrl = sell.image_url || (sell.images?.[0]?.url) || '';
    const variantInfo = item.title 
      || sell.name 
      || sell.title 
      || item.name 
      || sell.sku 
      || '';
    
    const lineOpt = typeof item.additional_options === 'string' ? item.additional_options : '';
    const notes = [lineOpt, order.notes].filter(Boolean).join(' | ');
    
    const oid = order.id || order.number || order.order_number;
    const lid = item.id || item.line_item_id || `li_${liIdx}`;
    const uniqueLineKey = `${oid}-${lid}`;
    
    const productName = item.product_title || item.title || item.name || '—';
    
    if (!productName) {
      logger.warn('[ORDER VALIDATION] Missing product name', {
        orderId: order.id,
        itemId: item.id
      });
      return null;
    }

    return {
      remoteLineId: String(item.id),
      image: imgUrl,
      sku: item.sku || item.sellable?.sku_code || '',
      productName,
      unitPrice: item.price_per_unit ?? 0,
      totalPrice: item.total_price ?? 0,
      variantInfo,
      notes,
      quantity: item.quantity ?? 1,
      shipBy: order.ship_by_date ? new Date(order.ship_by_date).toISOString().split('T')[0] : null,
      marketplaceKey: String(order.id),
      orderNumber: order.order_number || order.number || '',
      uniqueLineKey,
    };
  }).filter(Boolean);

  if (!items.length) {
    logger.warn('[ORDER VALIDATION] No valid items in order', { orderId: order.id });
    return null;
  }

  // Extract marketplace order date
  const marketplaceOrderDate = order.created_at || order.order_date || order.ordered_at;

  // Map order data
  return {
    order: {
      marketplace: order.channel?.name?.toLowerCase() || 'Veeqo',
      marketplaceKey: String(order.id),
      orderNumber: String(order.order_number || order.number || ''),
      customerName: [recipientFirstName, recipientLastName].filter(Boolean).join(' ') || order.customer?.full_name || '—',
      status: order.status || '',
      totalPrice: order.total_price,
      currency: order.currency_code,
      shipByDate: order.ship_by_date ? new Date(order.ship_by_date).toISOString().split('T')[0] : null,
      marketplaceCreatedAt: marketplaceOrderDate ? new Date(marketplaceOrderDate) : null,
      notes: Array.isArray(order.notes) ? order.notes.join(' | ') : (order.notes || ''),
      shippingAddress: {
        recipientFirstName,
        recipientLastName,
        recipientStreet1,
        recipientStreet2: (addr?.address2 || '').trim(),
        recipientCity,
        recipientState: (addr?.state || '').trim(),
        recipientCountry,
        recipientPostal: (addr?.zip || '').trim(),
        recipientPhone: (addr?.phone || '').trim(),
      },
      rawData: order
    },
    items
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

// Update syncAllOrders to handle Veeqo order mapping correctly
export async function syncAllOrders(userId: string, options: {
  veeqoApiKey?: string;
  shippoToken?: string;
  startDate?: Date;
  endDate?: Date;
  source?: OrderSource;
  channel?: OrderChannel;
} = {}): Promise<any> {
  const { veeqoApiKey, shippoToken, startDate, endDate, source, channel } = options;

  // Fetch orders from all sources in parallel
  const fetchPromises: Promise<UIOrder[]>[] = [];

  // Fetch Veeqo orders if source is not specified or is 'veeqo'
  if ((!source || source === 'veeqo') && veeqoApiKey) {
    fetchPromises.push(
      fetchVeeqoOrders({ apiKey: veeqoApiKey })
        .then(orders => orders.map(order => {
          const normalized = validateAndMapOrder(order);
          if (!normalized) return null;
          
          const address = {
            name: `${normalized.order.shippingAddress.recipientFirstName} ${normalized.order.shippingAddress.recipientLastName}`.trim(),
            phone: normalized.order.shippingAddress.recipientPhone || '',
            street1: normalized.order.shippingAddress.recipientStreet1,
            street2: normalized.order.shippingAddress.recipientStreet2 || '',
            city: normalized.order.shippingAddress.recipientCity,
            state: normalized.order.shippingAddress.recipientState || '',
            postal: normalized.order.shippingAddress.recipientPostal || '',
            country: normalized.order.shippingAddress.recipientCountry,
            isResidential: false
          };
          
          const mappedOrder: UIOrder = {
            id: String(order.id),
            source: 'veeqo' as OrderSource,
            channel: determineChannel(order),
            marketplace: normalized.order.marketplace,
            marketplaceKey: String(order.id),
            orderNumber: normalized.order.orderNumber,
            customerName: normalized.order.customerName,
            status: normalized.order.status,
            currency: normalized.order.currency,
            totalPrice: normalized.order.totalPrice,
            to_address: address,
            line_items: normalized.items.map(item => ({
              id: item.remoteLineId,
              title: item.productName,
              value: item.totalPrice,
              quantity: item.quantity,
              weight: 0.5, // Default weight if not provided
              sku: item.sku,
            })),
            marketplaceOrderDate: normalized.order.marketplaceCreatedAt?.toISOString(),
            rawData: order
          };
          
          return mappedOrder;
        }).filter((order): order is UIOrder => order !== null))
    );
  }
  
  // Fetch Shippo orders if source is not specified or is 'shippo'
  if ((!source || source === 'shippo') && shippoToken) {
    const etdDefaults = await getEtdDefaults(userId);
    fetchPromises.push(
      fetchShippoOrders(shippoToken).then(orders => orders.map(order => {
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
        return {
          id: order.object_id,
          source: 'shippo',
          channel: 'etsy',
          marketplace: 'Etsy',
          marketplaceKey: order.object_id,
          orderNumber: order.order_number || order.object_id,
          customerName: addr.name || 'Unknown Customer',
          status: order.order_status,
          currency: order.currency,
          totalPrice: parseFloat(order.total_price) || 0,
          to_address: shippingAddress,
          line_items: lineItems,
          marketplaceOrderDate: order.placed_at,
          rawData: order,
          weightKg: etdDefaults.weightKg,
          harmonizedCode: etdDefaults.harmonizedCode,
          countryOfMfg: etdDefaults.countryOfMfg,
          commodityDesc: lineItems[0]?.title || '',
          termsOfSale: 'DDP',
          sendCommercialInvoiceViaEtd: true
        };
      }))
    );
  }
  
  // Wait for all fetches to complete
  const results = await Promise.all(fetchPromises);
  
  // Flatten and deduplicate orders
  const allOrders = results.flat();
  const uniqueOrders = new Map<string, UIOrder>();
  
  allOrders.forEach(order => {
    const key = `${order.source}-${order.marketplaceKey}`;
    if (!uniqueOrders.has(key)) {
      uniqueOrders.set(key, order);
              }
            });

  // Apply filters
  let filteredOrders = Array.from(uniqueOrders.values());
  
  if (startDate) {
    filteredOrders = filteredOrders.filter(order => 
      new Date(order.marketplaceOrderDate || '') >= startDate
    );
  }
  
  if (endDate) {
    filteredOrders = filteredOrders.filter(order => 
      new Date(order.marketplaceOrderDate || '') <= endDate
    );
  }
  
  if (channel) {
    filteredOrders = filteredOrders.filter(order => order.channel === channel);
        }

  // Store orders in database using Promise.allSettled
  const upsertResults = await Promise.allSettled(filteredOrders.map(async (order) => {
    try {
      const { id, to_address, line_items, ...orderData } = order;
      const dbOrder = {
        id: order.id,
        userId,
        marketplace: order.marketplace,
        marketplaceKey: order.marketplaceKey,
        orderNumber: order.orderNumber,
        customerName: order.customerName || '',
        status: order.status || '',
        currency: order.currency || '',
        totalPrice: order.totalPrice || 0,
        shippingAddress: to_address ? JSON.stringify(to_address) : null,
        rawData: order.rawData ? JSON.stringify(order.rawData) : null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      // Validate critical fields
      if (!order.orderNumber || !order.marketplaceKey) {
        logger.warn('Order missing critical unique fields', { orderId: order.id, orderNumber: order.orderNumber, marketplaceKey: order.marketplaceKey });
      }
      if (!to_address?.postal) {
        logger.warn('Order missing recipientPostal', { orderId: order.id, orderNumber: order.orderNumber });
      }
      // Upsert order
      const savedOrder = await prisma.order.upsert({
        where: {
          userId_marketplace_marketplaceKey: {
            userId,
            marketplace: order.marketplace,
            marketplaceKey: order.marketplaceKey
          }
        },
        create: dbOrder,
        update: {
          ...dbOrder,
          id: undefined // Remove id from update
        }
      });
      // Handle line items
      if (line_items?.length > 0) {
        await prisma.orderItem.deleteMany({ where: { orderId: savedOrder.id } });
        await prisma.orderItem.createMany({
          data: line_items.map(item => ({
            orderId: savedOrder.id,
            productName: item.title,
            quantity: item.quantity,
            unitPrice: item.value / (item.quantity || 1),
            totalPrice: item.value,
            weightKg: item.weight,
            harmonizedCode: item.hs_code,
            countryOfMfg: item.country_of_origin,
            sku: item.sku,
            remoteLineId: item.id,
            marketplaceKey: order.marketplaceKey,
            orderNumber: order.orderNumber
          }))
        });
      }
      return { orderId: savedOrder.id, marketplaceKey: order.marketplaceKey, status: 'success' };
    } catch (error: any) {
      logger.error('Failed to store order', error, { orderId: order.id, marketplaceKey: order.marketplaceKey });
      return { orderId: order.id, marketplaceKey: order.marketplaceKey, status: 'failed', errorMsg: error.message };
    }
  }));
  // Summarize results
  const newOrders = upsertResults.filter(r => r.status === 'fulfilled' && (r as PromiseFulfilledResult<any>).value?.status === 'success').length;
  const failedOrders = upsertResults.filter(r => r.status === 'fulfilled' && (r as PromiseFulfilledResult<any>).value?.status === 'failed').length;
  const errors = upsertResults.filter(r => r.status === 'fulfilled' && (r as PromiseFulfilledResult<any>).value?.status === 'failed').map(r => (r as PromiseFulfilledResult<any>).value);
  // Optionally update SyncOperation metrics here
  return { newOrders, failedOrders, errors };
} 