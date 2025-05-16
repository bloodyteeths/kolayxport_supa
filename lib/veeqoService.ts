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
    variant_options_string?: string;
    images?: Array<{ url: string }>;
    image_url?: string;
    main_thumbnail_url?: string;
  };
  product?: {
    title?: string;
    image_url?: string;
    main_thumbnail_url?: string;
    images?: Array<{ url: string }>;
  };
  name?: string;
  additional_options?: string;
}

/**
 * Veeqo API order structure
 */
interface VeeqoOrder {
  id: string;
  number?: string; // Human-readable order number
  order_number?: string; // Deprecated/alternate
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
  customer?: {
    first_name: string;
    last_name: string;
  };
  line_items: VeeqoLineItem[];
  channel?: {
    name?: string;
    type_code?: string;
  };
}

/**
 * Fetch and map Veeqo orders to our Prisma models
 * Requires the API key to be passed in, typically resolved by the calling API route.
 */
export async function fetchVeeqoOrders(userId: string, apiKey: string) {
  let baseUrl = process.env.VEEQO_ORDERS_URL!;
  // Remove existing page/per_page if present
  baseUrl = baseUrl.replace(/([&?])page=\d+&?/, '$1').replace(/([&?])per_page=\d+&?/, '$1');
  // Remove trailing & or ? if left
  baseUrl = baseUrl.replace(/[&?]$/, '');

  const perPage = 10; // Veeqo hard limit regardless of param
  let page = 1;
  let allOrders: any[] = [];
  let totalPages = 1;
  let firstPass = true;
  while (page <= totalPages) {
    const url = baseUrl.includes('?')
      ? `${baseUrl}&page=${page}&per_page=${perPage}`
      : `${baseUrl}?page=${page}&per_page=${perPage}`;

    let attempts = 0;
    let success = false;
    let resp, data;
    while (!success && attempts < 5) {
      try {
        resp = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            'Accept': 'application/json',
            'User-Agent': 'curl/7.64.1',
          },
        });
        if (resp.status === 429) {
          attempts++;
          const retryAfter = parseInt(resp.headers.get('retry-after') || '1', 10);
          console.warn(`[VEEQO FETCH] Rate limited on page ${page}, attempt ${attempts}. Retrying after ${retryAfter}s...`);
          await new Promise(res => setTimeout(res, retryAfter * 1000));
          continue;
        }
        if (!resp.ok) throw new Error(`Veeqo fetch failed: ${resp.statusText}`);
        data = await resp.json();
        success = true;
      } catch (err) {
        attempts++;
        console.error(`[VEEQO FETCH] Error on page ${page}, attempt ${attempts}:`, err);
        await new Promise(res => setTimeout(res, 1000)); // Wait 1s before retry
      }
    }
    if (!success) {
      console.error(`[VEEQO FETCH] Failed to fetch page ${page} after 5 attempts, skipping.`);
      page++;
      continue;
    }
    if (firstPass) {
      const totalPagesHeader = resp.headers.get('x-total-pages-count');
      if (totalPagesHeader) {
        totalPages = parseInt(totalPagesHeader, 10) || 1;
        console.log(`[VEEQO FETCH] Total pages to fetch: ${totalPages}`);
      }
      firstPass = false;
    }
    console.log(`[VEEQO FETCH] Page ${page}: fetched ${Array.isArray(data) ? data.length : 0} orders`);
    if (!Array.isArray(data) || data.length === 0) break;
    allOrders = allOrders.concat(data);
    page++;
    await new Promise(res => setTimeout(res, 200)); // 200ms delay to respect rate limit
  }
  console.log(`[VEEQO FETCH] Total orders fetched: ${allOrders.length}`);

  return allOrders.map(o => {
    // Marketplace (friendly presentation)
    const rawMarketplace = o.channel?.name?.toLowerCase() || '';
    const marketplace = rawMarketplace
      ? rawMarketplace.charAt(0).toUpperCase() + rawMarketplace.slice(1)
      : 'Veeqo';

    // Order number logic (Apps Script style)
    const orderNumber = o.order_number ?? o.number ?? null;
    const marketplaceKey = String(o.id);

    // Ship-by logic (cascade, normalize to YYYY-MM-DD or null)
    let rawShipBy = o.ship_by_date || o.estimated_ship_by || o.required_by_date || o.dispatch_date || o.due_date || '';
    let shipByDate = rawShipBy ? new Date(rawShipBy).toISOString().split('T')[0] : null;

    // Customer name
    const addr = o.deliver_to || {};
    const customerName = [addr.first_name, addr.last_name].filter(Boolean).join(' ') || o.customer?.full_name || 'Unknown';
    // Order notes
    const orderNote = Array.isArray(o.notes) ? o.notes.join(' | ') : (o.notes||'');

    return {
      order: {
        marketplace,
        marketplaceKey,
        orderNumber: String(orderNumber),
        customerName,
        status: o.status || '',
        totalPrice: o.total_price,
        currency: o.currency_code,
        shipByDate,
        marketplaceCreatedAt: o.created_at ? new Date(o.created_at) : null,
        notes: orderNote,
      },
      items: o.line_items.map((item: any, liIdx: number) => {
        // Image fallback
        const sell = item.image_url 
          ? { image_url: item.image_url } 
          : item.sellable || item.product || {};
        const imgUrl = sell.image_url || (sell.images?.[0]?.url) || '';
        // Variant
        const variantInfo = item.title 
          || sell.name 
          || sell.title 
          || item.name 
          || sell.sku 
          || '';
        // Notes
        const lineOpt = typeof item.additional_options==='string'?item.additional_options:'';
        const notes = [lineOpt, orderNote].filter(Boolean).join(' | ');
        // Ship-by (cascade, normalize)
        let rawShipBy = o.ship_by_date || o.estimated_ship_by || o.required_by_date || o.dispatch_date || o.due_date || '';
        let shipBy = rawShipBy ? new Date(rawShipBy).toISOString().split('T')[0] : null;
        // Unique line key as in Apps Script
        const oid = o.id || o.number || o.order_number;
        const lid = item.id || item.line_item_id || `li_${liIdx}`;
        const uniqueLineKey = `${oid}-${lid}`;
        return {
          remoteLineId: String(item.id),
          image: imgUrl,
          sku: item.sku || item.sellable?.sku_code || null,
          productName: item.product_title || item.title || 'Unknown Product',
          unitPrice: item.price_per_unit ?? null,
          totalPrice: item.total_price ?? null,
          variantInfo,
          notes,
          quantity: item.quantity ?? 1,
          shipBy,
          marketplaceKey,
          orderNumber: orderNumber ? String(orderNumber) : null,
          uniqueLineKey,
        };
      }),
    };
  });
}

function generateImageUrl(originalUrl: string): string {
  return `https://thumbnails.veeqo.com/rs:fit:1000:1000/${Buffer.from(originalUrl).toString('base64')}?x-api-key=${process.env.VEEQO_API_KEY}`;
} 