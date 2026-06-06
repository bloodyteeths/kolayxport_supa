import type { UIOrder, NormalizedAddress } from '../types';

/**
 * Amazon order status mapping to normalized statuses.
 */
const STATUS_MAP: Record<string, string> = {
  Pending: 'pending',
  Unshipped: 'awaiting_shipment',
  PartiallyShipped: 'partially_shipped',
  Shipped: 'shipped',
  InvoiceUnconfirmed: 'pending',
  Canceled: 'cancelled',
  Unfulfillable: 'cancelled',
};

/**
 * Normalize an Amazon SP-API order to UIOrder format.
 */
export function toNormalizedOrder(order: any): UIOrder {
  const shippingAddress = order.ShippingAddress || {};
  const items = order.OrderItems || [];

  const address: NormalizedAddress = {
    name: shippingAddress.Name || '',
    phone: shippingAddress.Phone || '',
    street1: shippingAddress.AddressLine1 || '',
    street2: shippingAddress.AddressLine2 || '',
    city: shippingAddress.City || '',
    state: shippingAddress.StateOrRegion || '',
    postal: shippingAddress.PostalCode || '',
    country: shippingAddress.CountryCode || '',
    isResidential: true,
  };

  const lineItems = items.map((item: any) => ({
    id: item.OrderItemId || item.ASIN || '',
    title: item.Title || '',
    value: parseFloat(item.ItemPrice?.Amount || '0') / Math.max(item.QuantityOrdered || 1, 1),
    quantity: item.QuantityOrdered || 1,
    weight: item.Weight?.Value
      ? convertWeightToKg(parseFloat(item.Weight.Value), item.Weight.Unit)
      : 0.5,
    sku: item.SellerSKU || item.ASIN || '',
    image: item.ImageUrl || null,
    variantInfo: item.ConditionId || null,
  }));

  const totalPrice = parseFloat(order.OrderTotal?.Amount || '0');
  const currency = order.OrderTotal?.CurrencyCode || 'USD';
  const status = STATUS_MAP[order.OrderStatus] || order.OrderStatus || 'unknown';

  const isFba = order.FulfillmentChannel === 'AFN';

  return {
    id: order.AmazonOrderId,
    source: 'amazon',
    channel: 'amazon',
    marketplace: 'amazon',
    marketplaceKey: order.AmazonOrderId,
    orderNumber: order.AmazonOrderId,
    customerName: shippingAddress.Name || order.BuyerInfo?.BuyerEmail || 'Amazon Customer',
    status,
    currency,
    totalPrice,
    to_address: {
      ...address,
      isResidential: true,
    },
    line_items: lineItems,
    marketplaceOrderDate: order.PurchaseDate || order.CreatedBefore,
    shipByDate: order.LatestShipDate || order.EarliestShipDate || undefined,
    rawData: {
      ...order,
      fulfillmentChannel: order.FulfillmentChannel,
      isFba,
    },
    recipientEmail: order.BuyerInfo?.BuyerEmail || undefined,
    externalStatus: order.OrderStatus,
    isFBA: isFba,
    marketplaceId: order.MarketplaceId || undefined,
  };
}

/**
 * Map a flat-file order report row to UIOrder.
 * Amazon's GET_FLAT_FILE_ALL_ORDERS_DATA report uses tab-separated values.
 */
export function toNormalizedOrderFromReport(row: Record<string, string>): UIOrder {
  const address: NormalizedAddress = {
    name: row['recipient-name'] || '',
    phone: row['ship-phone-number'] || '',
    street1: row['ship-address-1'] || '',
    street2: row['ship-address-2'] || '',
    city: row['ship-city'] || '',
    state: row['ship-state'] || '',
    postal: row['ship-postal-code'] || '',
    country: row['ship-country'] || '',
    isResidential: true,
  };

  const quantity = parseInt(row['quantity-purchased'] || '1', 10);
  const itemPrice = parseFloat(row['item-price'] || '0');
  const isFBA = (row['fulfillment-channel'] || '').toUpperCase() === 'AFN';
  const marketplaceId = row['sales-channel-marketplace-id'] || row['marketplace-id'] || undefined;

  return {
    id: row['order-id'],
    source: 'amazon',
    channel: 'amazon',
    marketplace: 'amazon',
    marketplaceKey: row['order-id'],
    orderNumber: row['order-id'],
    customerName: row['recipient-name'] || row['buyer-email'] || 'Amazon Customer',
    status: STATUS_MAP[row['order-status']] || row['order-status'] || 'unknown',
    currency: row['currency'] || 'USD',
    totalPrice: itemPrice,
    to_address: { ...address, isResidential: true },
    line_items: [{
      id: row['order-item-id'] || row['order-id'],
      title: row['product-name'] || row['sku'] || '',
      value: quantity > 0 ? itemPrice / quantity : itemPrice,
      quantity,
      weight: 0.5,
      sku: row['sku'] || '',
      image: undefined,
    }],
    marketplaceOrderDate: row['purchase-date'] || row['last-updated-date'],
    shipByDate: row['ship-by-date'] || undefined,
    rawData: row,
    externalStatus: row['order-status'],
    isFBA,
    marketplaceId,
  };
}

/**
 * Convert weight to kg from Amazon's weight units.
 */
function convertWeightToKg(value: number, unit: string): number {
  switch (unit?.toLowerCase()) {
    case 'pounds':
    case 'lb':
      return value * 0.453592;
    case 'ounces':
    case 'oz':
      return value * 0.0283495;
    case 'grams':
    case 'g':
      return value / 1000;
    case 'kilograms':
    case 'kg':
      return value;
    default:
      return value;
  }
}

/**
 * Parse a tab-separated report file into row objects.
 */
export function parseOrderReport(tsv: string): Record<string, string>[] {
  const lines = tsv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t').map(h => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = (values[idx] || '').trim();
    });
    if (row['order-id']) rows.push(row);
  }

  return rows;
}
