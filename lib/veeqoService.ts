import fetch from 'node-fetch';
import { VEEQO_ORDERS_URL } from './config'; // Import from config

// Removed Prisma imports and model types to avoid linter errors; TS will infer the return types

/**
 * Veeqo API line item structure
 */
interface VeeqoLineItem {
  id: string;
  quantity: number;
  price_per_unit: number;
  total_price: number;
  title: string;
  notes: string | null;
  image_url: string | null;
  sellable: {
    product_title: string;
    sku_code: string;
  };
}

/**
 * Veeqo API order structure
 */
interface VeeqoOrder {
  id: string;
  created_at: string;
  status: string;
  currency_code: string;
  total_price: number;
  notes: string | null;
  deliver_to: {
    first_name: string;
    last_name: string;
    address1: string;
    address2: string | null;
    city: string;
    state: string;
    country: string;
    zip: string;
    phone: string | null;
  };
  line_items: VeeqoLineItem[];
}

/**
 * Fetch and map Veeqo orders to our Prisma models
 * Requires the API key to be passed in, typically resolved by the calling API route.
 */
export async function fetchVeeqoOrders(
  userId: string, // Kept for mapping Order.userId
  apiKey: string   // Explicitly passed Veeqo API key
): Promise<{ order: any; items: any[] }[]> {
  if (!apiKey) {
    throw new Error('Veeqo API Key was not provided to fetchVeeqoOrders.');
  }
  if (!VEEQO_ORDERS_URL) { // Global URL still from config; config.ts would have thrown if missing at startup
    throw new Error('VEEQO_ORDERS_URL is not set. This should have been caught at startup.');
  }

  const response = await fetch(VEEQO_ORDERS_URL, {
    headers: { 'x-api-key': apiKey, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Veeqo API error ${response.status}`);

  const data = (await response.json()) as VeeqoOrder[];
  return data.map(o => {
    const order = {
      userId,
      marketplace: 'Veeqo',
      marketplaceKey: o.id,
      marketplaceCreatedAt: new Date(o.created_at),
      customerName: `${o.deliver_to.first_name} ${o.deliver_to.last_name}`,
      status: o.status,
      currency: o.currency_code,
      totalPrice: o.total_price,
      shippingAddress: {
        street1: o.deliver_to.address1,
        street2: o.deliver_to.address2,
        city: o.deliver_to.city,
        state: o.deliver_to.state,
        country: o.deliver_to.country,
        postalCode: o.deliver_to.zip,
        phone: o.deliver_to.phone,
      },
      notes: o.notes ? [o.notes] : [],
      images: o.line_items.map(li => li.image_url).filter(Boolean),
    };
    const items = o.line_items.map(li => ({
      remoteLineId: li.id,
      sku: li.sellable.sku_code,
      productName: li.sellable.product_title,
      quantity: li.quantity,
      unitPrice: li.price_per_unit,
      totalPrice: li.total_price,
      image: li.image_url,
      notes: li.notes,
    }));
    return { order, items };
  });
} 