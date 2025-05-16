import fetch from 'node-fetch';
import { SHIPPO_TOKEN } from './config'; // Import from config

// Removed Prisma imports and model types to avoid linter errors; TS will infer return types

// Minimal type definitions for Shippo API response
interface ShippoAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string | null;
  email: string | null;
}

interface ShippoLineItem {
  object_id: string;
  title: string;
  quantity: number;
  total_price: string;
  currency: string;
  weight: string;
  sku: string | null;
}

interface ShippoOrder {
  object_id: string;
  order_status: string;
  placed_at: string;
  total_price: string;
  currency: string;
  shipping_address: ShippoAddress;
  billing_address: ShippoAddress;
  line_items: ShippoLineItem[];
  metadata?: { notes?: string };
}

interface ShippoResponse {
  results: ShippoOrder[];
  count: number;
  has_more: boolean;
}

/**
 * Fetch and map Shippo orders to our Prisma models
 */
export async function fetchShippoOrders(userId: string, token: string): Promise<{ order: any; items: any[] }[]> {
  const url = 'https://api.goshippo.com/v1/orders/';
  if (!token) {
    throw new Error('Shippo Token was not provided to fetchShippoOrders.');
  }

  const response = await fetch(url, {
    headers: { Authorization: `ShippoToken ${token}` },
  });
  if (!response.ok) throw new Error(`Shippo API error ${response.status}`);

  const data = (await response.json()) as ShippoResponse;
  console.debug('SYNC DEBUG Shippo API response:', JSON.stringify(data, null, 2));
  return data.results.map(o => {
    console.debug('SYNC DEBUG Shippo order:', JSON.stringify(o, null, 2));
    // Safely construct customer name
    const customerName = o.shipping_address?.name || 'Unknown Customer';
    
    const order = {
      userId,
      marketplace: 'Shippo',
      marketplaceKey: o.object_id,
      marketplaceCreatedAt: new Date(o.placed_at),
      customerName,
      status: o.order_status,
      currency: o.currency,
      totalPrice: parseFloat(o.total_price),
      shippingAddress: {
        name: customerName,
        street1: o.shipping_address?.street1 ?? '',
        street2: o.shipping_address?.street2 ?? null,
        city: o.shipping_address?.city ?? '',
        state: o.shipping_address?.state ?? '',
        country: o.shipping_address?.country ?? '',
        postalCode: o.shipping_address?.zip ?? '',
        phone: o.shipping_address?.phone ?? null,
      },
      notes: o.metadata?.notes ? [o.metadata.notes] : [],
      images: [],
      termsOfSale: 'Unknown',
    };
    
    const items = (o.line_items ?? []).map(li => ({
      remoteLineId: String(li.object_id),
      sku: li.sku ?? 'UNKNOWN',
      productName: li.title ?? 'Unknown Product',
      quantity: li.quantity,
      unitPrice: parseFloat(li.total_price) / li.quantity,
      totalPrice: parseFloat(li.total_price),
      image: null,
      variantInfo: null,
      notes: null,
    }));
    return { order, items };
  });
} 