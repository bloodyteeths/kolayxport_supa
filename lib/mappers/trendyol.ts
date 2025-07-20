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
    // Also check merchantSku which might be the barcode
    const barcodesToCheck = [item.barcode, item.merchantSku, item.sku].filter(Boolean);
    
    if (!imageUrl) {
      for (const barcode of barcodesToCheck) {
        if (barcode && productImages[barcode]) {
          imageUrl = productImages[barcode];
          break;
        }
      }
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
      email: order.customerEmail || '',
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
    recipientEmail: order.customerEmail || '',
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
      email: order.customerEmail || '',
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
    recipientEmail: order.customerEmail || '',
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
  const addedBarcodes = new Set<string>(); // To avoid duplicates
  
  orders.forEach(order => {
    if (order.lines || order.lineItems) {
      (order.lines || order.lineItems).forEach((item: any) => {
        const hasImage = item.productImage || 
          (item.images && item.images[0] && item.images[0].url);
        
        if (!hasImage) {
          // Check all possible barcode fields
          const barcodesToCheck = [item.barcode, item.merchantSku, item.sku].filter(Boolean);
          barcodesToCheck.forEach(barcode => {
            const trimmedBarcode = barcode.trim();
            if (trimmedBarcode && !addedBarcodes.has(trimmedBarcode)) {
              barcodesNeedingImages.push(trimmedBarcode);
              addedBarcodes.add(trimmedBarcode);
            }
          });
        }
      });
    }
  });

  // Fetch product images from Trendyol Product API
  let productImages: Record<string, string> = {};
  if (barcodesNeedingImages.length > 0) {
    console.log('[Trendyol Mapper] Need to fetch images for', barcodesNeedingImages.length, 'barcodes:', barcodesNeedingImages);
    try {
      // Dynamic import to avoid circular dependency
      const { getProductImages } = await import('../integrations/trendyolClient');
      productImages = await getProductImages(barcodesNeedingImages, credentials);
      console.log('[Trendyol Mapper] Fetched images for', Object.keys(productImages).length, 'products');
    } catch (error) {
      console.warn('Failed to fetch product images from Trendyol:', error);
    }
  } else {
    console.log('[Trendyol Mapper] All items already have images or no items found');
  }

  // Map orders with the fetched images
  return Promise.all(orders.map(order => toOrderWithImages(order, productImages)));
} 