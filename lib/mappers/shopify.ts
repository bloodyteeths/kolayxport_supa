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
    // Product / variant ids: link the order line to the synced ShopifyProduct (EU customs barcode, lib/shipping/productIds).
    listingRef: item.product_id ? String(item.product_id) : undefined,
    variantRef: item.variant_id ? String(item.variant_id) : undefined,
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
  // Order shape from ShopifyClient.getOrders (REST-shaped, built from Admin GraphQL). `customer`
  // is null there (Order.customer needs read_customers), so names fall back to the billing address.
  const shipping = shopifyOrder.shipping_address || {};
  const billing = shopifyOrder.billing_address || {};
  const customer = shopifyOrder.customer || {};
  const customerName = shipping.name
    || billing.name
    || `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
    || 'Unknown Customer';

  const lineItems = (shopifyOrder.line_items || []).map(toLineItem);

  // Structured like every other channel (labels JSON.parse it; the ship-to panel reads street1/state/…).
  // A comma-joined string made the panel fall back to unrelated fields and a label once went out with state "DE".
  const hasShipping = Boolean(shipping.address1 || shipping.city || shipping.zip);
  const shippingAddress = hasShipping
    ? {
        name: shipping.name || customerName,
        company: shipping.company || undefined,
        street1: shipping.address1 || '',
        street2: shipping.address2 || '',
        city: shipping.city || '',
        state: shipping.province_code || shipping.province || '',
        postal: shipping.zip || '',
        country: shipping.country_code || shipping.country || '',
        phone: shipping.phone || shopifyOrder.phone || billing.phone || '',
        email: shopifyOrder.email || '',
      }
    : null;

  return {
    id: String(shopifyOrder.id),
    source: 'shopify' as OrderSource,
    channel: 'shopify' as OrderChannel,
    marketplace: 'shopify',
    marketplaceKey: String(shopifyOrder.id),
    // Bare number: the orders UI adds its own '#' (was rendering '##1048').
    orderNumber: String(shopifyOrder.name || shopifyOrder.order_number || '').replace(/^#/, ''),
    customerName,
    status: mapStatus(shopifyOrder),
    externalStatus: `${shopifyOrder.financial_status || ''}/${shopifyOrder.fulfillment_status || 'unfulfilled'}`,
    currency: shopifyOrder.currency || 'USD',
    totalPrice: parseFloat(shopifyOrder.total_price) || 0,
    shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
    to_address: {
      name: shipping.name || customerName,
      phone: shipping.phone || shopifyOrder.phone || billing.phone || customer.phone || '',
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
    // shop_domain lets shop/redact find this shop's orders (lib/integrations/shopify/redact.ts).
    rawData: shopDomain ? { ...shopifyOrder, shop_domain: shopDomain } : shopifyOrder,
    commodityDesc: lineItems.map((i: NormalizedLineItem) => i.title).join(', ').slice(0, 200),
  };
}
