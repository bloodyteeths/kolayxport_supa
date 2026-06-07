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

/**
 * Group the flat-file order report rows by amazon-order-id.
 * Amazon's GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL emits ONE ROW
 * PER LINE ITEM, so a 3-item order arrives as 3 rows that must be merged
 * into a single UIOrder. Treating each row as its own order silently drops
 * 2/3 of the items at dedup time — this grouper prevents that.
 */
/** _GENERAL reports key the order by `amazon-order-id`; older reports use `order-id`. */
function readOrderId(row: Record<string, string>): string | undefined {
  return row['amazon-order-id'] || row['order-id'] || undefined;
}

export function groupReportRows(tsv: string): Map<string, Record<string, string>[]> {
  const rows = parseOrderReport(tsv);
  const groups = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const id = readOrderId(row);
    if (!id) continue;
    const arr = groups.get(id);
    if (arr) arr.push(row); else groups.set(id, [row]);
  }
  return groups;
}

/** Combine per-row Amazon order statuses into one order-level normalized status. */
function aggregateStatus(rows: Record<string, string>[]): { normalized: string; external: string } {
  const externals = rows.map((r) => r['order-status'] || '').filter(Boolean);
  const priority = ['Pending', 'Unshipped', 'PartiallyShipped', 'Shipped', 'Canceled', 'Unfulfillable'];
  let pick = externals[0] || 'unknown';
  for (const p of priority) {
    if (externals.includes(p)) { pick = p; break; }
  }
  return { normalized: STATUS_MAP[pick] || pick || 'unknown', external: pick };
}

/**
 * Build a single UIOrder from all report rows belonging to one Amazon order.
 * Sums financials, merges line items, derives status. ASIN is stashed on each
 * line item so the Catalog API enricher can add images / weight afterwards.
 */
export function toNormalizedOrderFromGroup(orderId: string, rows: Record<string, string>[]): UIOrder {
  const first = rows[0];

  // _GENERAL report drops PII columns. We fall back to '' when absent so
  // the UI gracefully shows city/state/postal/country only. To unlock full
  // address fields the seller's SP-API app needs the Restricted PII role
  // (Direct-to-Consumer Shipping) — without it Amazon strips name/street/phone.
  const address: NormalizedAddress = {
    name: first['recipient-name'] || '',
    phone: first['ship-phone-number'] || '',
    street1: first['ship-address-1'] || '',
    street2: first['ship-address-2'] || '',
    city: first['ship-city'] || '',
    state: first['ship-state'] || '',
    postal: first['ship-postal-code'] || '',
    country: first['ship-country'] || '',
    isResidential: true,
  };

  const lineItems = rows.map((row, idx) => {
    const qty = parseInt(row['quantity-purchased'] || row['quantity'] || '1', 10);
    const itemPrice = parseFloat(row['item-price'] || '0');
    return {
      id: row['order-item-id'] || `${orderId}-${idx}`,
      title: row['product-name'] || row['sku'] || '',
      value: qty > 0 ? itemPrice / qty : itemPrice,
      quantity: qty,
      weight: 0.5,
      sku: row['sku'] || '',
      image: undefined,
      asin: row['asin'] || undefined,
    };
  });

  let total = 0;
  for (const row of rows) {
    total += parseFloat(row['item-price'] || '0');
    total += parseFloat(row['shipping-price'] || '0');
    total += parseFloat(row['gift-wrap-price'] || '0');
    total -= parseFloat(row['item-promotion-discount'] || '0');
    total -= parseFloat(row['ship-promotion-discount'] || '0');
  }

  const status = aggregateStatus(rows);
  // _GENERAL reports use "Merchant" / "Amazon" instead of MFN/AFN. Old reports
  // used MFN/AFN. Treat anything Amazon-fulfilled as FBA.
  const fc = (first['fulfillment-channel'] || '').toUpperCase();
  const isFBA = fc === 'AFN' || fc === 'AMAZON';
  // _GENERAL has sales-channel (e.g. "Amazon.com.mx"). Older reports have a
  // direct marketplace id. Take either; the orderSync will fall back to
  // cred.amazonMarketplaceIds[0] when this is empty.
  const marketplaceId =
    first['sales-channel-marketplace-id'] ||
    first['marketplace-id'] ||
    undefined;

  return {
    id: orderId,
    source: 'amazon',
    channel: 'amazon',
    marketplace: 'amazon',
    marketplaceKey: orderId,
    orderNumber: orderId,
    customerName: first['recipient-name'] || first['buyer-email'] || 'Amazon Customer',
    status: status.normalized,
    currency: first['currency'] || 'USD',
    totalPrice: total,
    to_address: { ...address, isResidential: true },
    line_items: lineItems,
    marketplaceOrderDate: first['purchase-date'] || first['last-updated-date'],
    shipByDate: first['ship-by-date'] || undefined,
    rawData: { orderId, rows, salesChannel: first['sales-channel'] || null },
    externalStatus: status.external,
    recipientEmail: first['buyer-email'] || undefined,
    isFBA,
    marketplaceId,
  };
}
