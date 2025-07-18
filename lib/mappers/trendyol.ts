// Trendyol order and order item mappers
// See: https://developers.trendyol.com/en/docs/category/order-integration?utm_source=chatgpt.com
// See: https://developers.trendyol.com/int/docs/international-marketplace/int-product-api-endpoints?utm_source=chatgpt.com

import { NormalizedLineItem, UIOrder } from '../types';

export function toOrderItem(line: any): NormalizedLineItem {
  return {
    id: line.id || line.orderLineId || String(Math.random()),
    title: line.productName || line.title || line.name || 'Unknown Product',
    value: line.price || 0,
    quantity: line.quantity || 1,
    weight: line.weight || 0.5,
    sku: line.sku || line.merchantSku || line.barcode || line.productCode || '',
    image:
      line.productImage ??
      (line.images && line.images[0] && line.images[0].url) ??
      '',
  };
}

export async function toOrderWithImages(order: any, productImages: Record<string, string> = {}): Promise<UIOrder> {

  
  const line_items = (order.lines || order.lineItems || []).map((item: any) => {
    // Try to get image from product API if not already present
    let imageUrl = item.productImage ??
      (item.images && item.images[0] && item.images[0].url) ??
      '';
    
    // If no image and we have a barcode, try to get from product images
    if (!imageUrl && item.barcode && productImages[item.barcode]) {
      imageUrl = productImages[item.barcode];

    }
    

    
    return {
      id: item.id || item.orderLineId || String(Math.random()),
      title: item.productName || item.title || item.name || 'Unknown Product',
      value: item.price || 0,
      quantity: item.quantity || 1,
      weight: item.weight || 0.5,
      sku: item.sku || item.merchantSku || item.barcode || item.productCode || '',
      image: imageUrl,
    };
  });
  
  // Properly map Trendyol addresses using correct field names from the API response
  const shipmentAddr = order.shipmentAddress;
  const customerName = `${order.customerFirstName || ''} ${order.customerLastName || ''}`.trim() || 
                      shipmentAddr?.fullName || 
                      order.customerName || 
                      order.buyerName || '';

  return {
    id: order.id?.toString() || order.orderNumber || String(Math.random()),
    marketplaceKey: order.id?.toString() || '',
    orderNumber: order.orderNumber || '',
    customerName,
    uiOrderDate: order.orderDate
      ? new Date(Number(order.orderDate)).toISOString()
      : undefined,
    line_items,
    // Additional fields with fallbacks
    status: order.status || 'pending',
    currency: order.currencyCode || 'TRY',
    totalPrice: order.totalPrice || order.grossAmount || 0,
    source: 'trendyol' as const,
    channel: 'trendyol' as const,
    marketplace: 'Trendyol',
    // Map shipping address as string (UIOrder expects string | null)
    shippingAddress: shipmentAddr ? 
      `${shipmentAddr.fullName || ''}, ${shipmentAddr.address1 || ''}, ${shipmentAddr.city || ''}, ${shipmentAddr.countryCode || 'TR'}` : 
      null,
    // Required to_address field - use shipmentAddress from Trendyol API
    to_address: {
      name: shipmentAddr?.fullName || customerName,
      phone: shipmentAddr?.phone || '',
      street1: shipmentAddr?.address1 || '',
      street2: shipmentAddr?.address2 || '',
      city: shipmentAddr?.city || '',
      state: shipmentAddr?.stateName || '',
      postal: shipmentAddr?.postalCode || '',
      country: shipmentAddr?.countryCode || 'TR',
      isResidential: true,
    },
    // Additional required fields
    marketplaceOrderDate: order.orderDate
      ? new Date(Number(order.orderDate)).toISOString()
      : undefined,
    shipByDate: order.lastShippingDate || order.agreedDeliveryDate
      ? new Date(Number(order.lastShippingDate || order.agreedDeliveryDate)).toISOString()
      : undefined,
    rawData: order,
    commodityDesc: line_items.length > 0 ? line_items[0].title : '',
    externalStatus: order.status || '',
  };
}

export function toOrder(order: any): UIOrder {
  const line_items = (order.lines || order.lineItems || []).map(toOrderItem);
  
  // Properly map Trendyol addresses using correct field names from the API response
  const shipmentAddr = order.shipmentAddress;
  const customerName = `${order.customerFirstName || ''} ${order.customerLastName || ''}`.trim() || 
                      shipmentAddr?.fullName || 
                      order.customerName || 
                      order.buyerName || '';

  return {
    id: order.id?.toString() || order.orderNumber || String(Math.random()),
    marketplaceKey: order.id?.toString() || '',
    orderNumber: order.orderNumber || '',
    customerName,
    uiOrderDate: order.orderDate
      ? new Date(Number(order.orderDate)).toISOString()
      : undefined,
    line_items,
    // Additional fields with fallbacks
    status: order.status || 'pending',
    currency: order.currencyCode || 'TRY',
    totalPrice: order.totalPrice || order.grossAmount || 0,
    source: 'trendyol' as const,
    channel: 'trendyol' as const,
    marketplace: 'Trendyol',
    // Map shipping address as string (UIOrder expects string | null)
    shippingAddress: shipmentAddr ? 
      `${shipmentAddr.fullName || ''}, ${shipmentAddr.address1 || ''}, ${shipmentAddr.city || ''}, ${shipmentAddr.countryCode || 'TR'}` : 
      null,
    // Required to_address field - use shipmentAddress from Trendyol API
    to_address: {
      name: shipmentAddr?.fullName || customerName,
      phone: shipmentAddr?.phone || '',
      street1: shipmentAddr?.address1 || '',
      street2: shipmentAddr?.address2 || '',
      city: shipmentAddr?.city || '',
      state: shipmentAddr?.stateName || '',
      postal: shipmentAddr?.postalCode || '',
      country: shipmentAddr?.countryCode || 'TR',
      isResidential: true,
    },
    // Additional required fields
    marketplaceOrderDate: order.orderDate
      ? new Date(Number(order.orderDate)).toISOString()
      : undefined,
    shipByDate: order.lastShippingDate || order.agreedDeliveryDate
      ? new Date(Number(order.lastShippingDate || order.agreedDeliveryDate)).toISOString()
      : undefined,
    rawData: order,
    commodityDesc: line_items.length > 0 ? line_items[0].title : '',
    externalStatus: order.status || '',
  };
}

/**
 * Map multiple Trendyol orders to UIOrder format with product images
 * @param orders Array of Trendyol orders
 * @param credentials Trendyol API credentials for fetching product images
 * @returns Promise that resolves to an array of UIOrder objects with images
 */
export async function mapTrendyolOrdersWithImages(
  orders: any[], 
  credentials?: { 
    supplierId: string; 
    apiKey: string; 
    apiSecret: string; 
  }
): Promise<UIOrder[]> {
  if (!credentials || !orders.length) {
    // Fallback to regular mapping if no credentials or no orders
    return orders.map(toOrder);
  }

  // Collect all barcodes from orders that don't have images
  const barcodesNeedingImages: string[] = [];
  orders.forEach(order => {
    if (order.lines || order.lineItems) {
      (order.lines || order.lineItems).forEach((item: any) => {
        const hasImage = item.productImage || 
          (item.images && item.images[0] && item.images[0].url);
        if (!hasImage && item.barcode && item.barcode.trim()) {
          barcodesNeedingImages.push(item.barcode.trim());
        }
      });
    }
  });

  // Product image fetching is currently disabled - would need implementation
  // of getProductImages function in trendyolClient
  let productImages: Record<string, string> = {};

  // Map orders with the fetched images
  return Promise.all(orders.map(order => toOrderWithImages(order, productImages)));
} 