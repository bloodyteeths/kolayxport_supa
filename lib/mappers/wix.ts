/**
 * Wix order mapper — normalizes Wix Stores API orders to UIOrder format.
 * Wix Orders API: https://dev.wix.com/docs/rest/api-reference/wix-e-commerce/orders/query-orders
 */

import { NormalizedLineItem, UIOrder } from '../types';

/** Map a single Wix line item to normalized format */
export function toOrderItem(item: any): NormalizedLineItem {
  const variant = item.physicalProperties || {};
  const variantParts = (item.descriptionLines || [])
    .map((d: any) => d.name?.translated ? `${d.name.translated}: ${d.colorInfo?.translated || d.plainText?.translated || ''}` : '')
    .filter(Boolean);

  return {
    id: item.id || String(Math.random()),
    title: item.productName?.translated || item.productName?.original || item.name || 'Unknown Product',
    value: parseFloat(item.price?.amount || item.priceBeforeDiscounts?.amount || '0'),
    quantity: item.quantity || 1,
    weight: variant.weight || 0.5,
    sku: variant.sku || item.catalogReference?.catalogItemId || '',
    image: item.image?.url || item.mediaItem?.url || '',
    variantInfo: variantParts.join(', ') || '',
  };
}

/** Map a single Wix order to UIOrder format */
export function toOrder(order: any): UIOrder {
  const billing = order.billingInfo?.contactDetails || {};
  const shippingDest = order.shippingInfo?.logistics?.shippingDestination || {};
  const addr = shippingDest.address || {};
  const contact = shippingDest.contactDetails || billing;

  const customerName = `${contact.firstName || billing.firstName || ''} ${contact.lastName || billing.lastName || ''}`.trim()
    || order.buyerInfo?.contactName || '';

  const lineItems = (order.lineItems || []).map((item: any) => toOrderItem(item));

  const orderDate = order.createdDate || order.dateCreated;
  const street1 = addr.addressLine || addr.addressLine1 || '';

  return {
    id: order.id || String(Math.random()),
    marketplaceKey: order.id || '',
    orderNumber: order.number?.toString() || order.id || '',
    customerName,
    uiOrderDate: orderDate ? new Date(orderDate).toISOString() : undefined,
    line_items: lineItems,
    status: mapWixStatus(order.status || order.paymentStatus || 'UNKNOWN'),
    currency: order.currency || 'USD',
    totalPrice: parseFloat(order.priceSummary?.total?.amount || '0'),
    source: 'wix' as const,
    channel: 'wix' as const,
    marketplace: 'Wix',
    shippingAddress: street1
      ? `${contact.firstName || ''} ${contact.lastName || ''}, ${street1}, ${addr.city || ''}, ${addr.subdivisionFullname || addr.subdivision || ''}, ${addr.postalCode || ''}, ${addr.countryFullname || addr.country || ''}`.trim()
      : null,
    to_address: {
      name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || customerName,
      phone: contact.phone || billing.phone || '',
      street1,
      street2: addr.addressLine2 || '',
      city: addr.city || '',
      state: addr.subdivisionFullname || addr.subdivision || '',
      postal: addr.postalCode || '',
      country: addr.country || '',
      isResidential: true,
      email: order.buyerInfo?.email || billing.email || '',
    },
    marketplaceOrderDate: orderDate ? new Date(orderDate).toISOString() : undefined,
    rawData: order,
    commodityDesc: lineItems.length > 0 ? lineItems[0].title : '',
    externalStatus: order.status || order.fulfillmentStatus || '',
    recipientEmail: order.buyerInfo?.email || billing.email || '',
  };
}

/** Map Wix order status to our normalized status */
function mapWixStatus(wixStatus: string): string {
  const map: Record<string, string> = {
    'APPROVED': 'PAID',
    'NOT_PAID': 'AWAITING_PAYMENT',
    'PAID': 'PAID',
    'PARTIALLY_REFUNDED': 'PAID',
    'FULLY_REFUNDED': 'REFUNDED',
    'PENDING': 'AWAITING_PAYMENT',
    'FULFILLED': 'SHIPPED',
    'NOT_FULFILLED': 'PAID',
    'PARTIALLY_FULFILLED': 'PAID',
    'CANCELED': 'CANCELLED',
    'CANCELLED': 'CANCELLED',
  };
  return map[wixStatus.toUpperCase()] || wixStatus.toUpperCase();
}

/** Map multiple Wix orders to UIOrder format */
export function mapWixOrders(orders: any[]): UIOrder[] {
  return orders.map(toOrder);
}
