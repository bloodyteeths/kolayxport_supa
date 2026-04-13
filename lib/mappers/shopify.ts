// lib/mappers/shopify.ts
import type { UIOrder, NormalizedLineItem, OrderSource, OrderChannel } from '../types';

/**
 * Map a Shopify line_item to NormalizedLineItem.
 */
export function toLineItem(item: any): NormalizedLineItem {
  const weight = item.grams ? item.grams / 1000 : 0.5; // Convert grams to kg
  return {
    id: String(item.id),
    title: item.title || 'Unknown Item',
    value: parseFloat(item.price) || 0,
    quantity: item.quantity || 1,
    weight,
    sku: item.sku || '',
    variantInfo: item.variant_title || undefined,
    variant_title: item.variant_title || undefined,
    image: item.image?.src || undefined,
    product_variant: item.variant_title ? { title: item.variant_title } : undefined,
  };
}

/**
 * Map Shopify financial_status to a normalized order status.
 */
function mapStatus(order: any): string {
  const fulfillment = order.fulfillment_status;
  const financial = order.financial_status;
  const cancelled = order.cancelled_at;

  if (cancelled) return 'cancelled';
  if (fulfillment === 'fulfilled') return 'shipped';
  if (fulfillment === 'partial') return 'partially_shipped';
  if (financial === 'refunded') return 'refunded';
  if (financial === 'paid' || financial === 'partially_paid') return 'awaiting_shipment';
  if (financial === 'pending') return 'pending_payment';
  return financial || 'unknown';
}

/**
 * Map a raw Shopify order to UIOrder format.
 */
export function toOrder(shopifyOrder: any, shopDomain?: string): UIOrder {
  const shipping = shopifyOrder.shipping_address || {};
  const customer = shopifyOrder.customer || {};
  const customerName = shipping.name
    || `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
    || 'Unknown Customer';

  const lineItems = (shopifyOrder.line_items || []).map(toLineItem);

  const shippingAddressStr = [
    shipping.address1,
    shipping.address2,
    shipping.city,
    shipping.province,
    shipping.zip,
    shipping.country,
  ].filter(Boolean).join(', ');

  return {
    id: String(shopifyOrder.id),
    source: 'shopify' as OrderSource,
    channel: 'shopify' as OrderChannel,
    marketplace: 'shopify',
    marketplaceKey: String(shopifyOrder.id),
    orderNumber: shopifyOrder.name || `#${shopifyOrder.order_number}`,
    customerName,
    status: mapStatus(shopifyOrder),
    externalStatus: `${shopifyOrder.financial_status || ''}/${shopifyOrder.fulfillment_status || 'unfulfilled'}`,
    currency: shopifyOrder.currency || 'USD',
    totalPrice: parseFloat(shopifyOrder.total_price) || 0,
    shippingAddress: shippingAddressStr || null,
    to_address: {
      name: shipping.name || customerName,
      phone: shipping.phone || customer.phone || '',
      street1: shipping.address1 || '',
      street2: shipping.address2 || '',
      city: shipping.city || '',
      state: shipping.province_code || shipping.province || '',
      postal: shipping.zip || '',
      country: shipping.country_code || shipping.country || '',
      isResidential: true,
      email: shopifyOrder.email || customer.email || '',
    },
    line_items: lineItems,
    marketplaceOrderDate: shopifyOrder.created_at,
    shipByDate: undefined, // Shopify doesn't have a ship-by concept by default
    rawData: shopifyOrder,
    commodityDesc: lineItems.map((i: NormalizedLineItem) => i.title).join(', ').slice(0, 200),
  };
}
