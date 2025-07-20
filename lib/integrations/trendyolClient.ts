/**
 * Trendyol API client for fetching orders for a specific user.
 * All functions require user-supplied credentials (no process.env fallback).
 * Exports fetchCreatedOrders and fetchShipmentUpdates.
 */
import fetch from 'node-fetch';

const BASE_URL = 'https://apigw.trendyol.com/integration/order/sellers';

interface TrendyolOrder {
  [key: string]: any;
}

interface FetchTrendyolOrdersParams {
  supplierId: string;
  apiKey: string;
  apiSecret: string;
  status?: string;
  startDateMs: number;
  endDateMs: number;
  pageSize?: number;
}

async function fetchTrendyolOrders({ supplierId, apiKey, apiSecret, status, startDateMs, endDateMs, pageSize = 200 }: FetchTrendyolOrdersParams): Promise<TrendyolOrder[]> {
  if (!supplierId || !apiKey || !apiSecret) {
    throw new Error('Missing Trendyol credentials');
  }
  const auth = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  let url = `${BASE_URL}/${supplierId}/orders?`;
  if (status) url += `status=${encodeURIComponent(status)}&`;
  // Convert milliseconds to seconds for Trendyol API
  const startDateSeconds = Math.floor(startDateMs / 1000);
  const endDateSeconds = Math.floor(endDateMs / 1000);
  url += `startDate=${startDateSeconds}&endDate=${endDateSeconds}`;
  url += `&orderByField=${status === 'Created' ? 'createdDate' : 'PackageLastModifiedDate'}`;
  url += `&orderByDirection=DESC&size=${pageSize}`;

  // Debug log the URL being called
  console.log(`[TRENDYOL DEBUG] Fetching URL: ${url}`);
  console.log(`[TRENDYOL DEBUG] Date range (ms): ${startDateMs} to ${endDateMs}`);
  console.log(`[TRENDYOL DEBUG] Date range (seconds): ${startDateSeconds} to ${endDateSeconds}`);
  console.log(`[TRENDYOL DEBUG] Date range (ISO): ${new Date(startDateMs).toISOString()} to ${new Date(endDateMs).toISOString()}`);

  const res = await fetch(url, { headers: { Authorization: auth }, method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    console.log(`[TRENDYOL DEBUG] API Error ${res.status}: ${text}`);
    throw new Error(`Trendyol API ${res.status}: ${text}`);
  }
  const json = await res.json();
  console.log(`[TRENDYOL DEBUG] API Response:`, JSON.stringify(json, null, 2));
  return Array.isArray(json.content) ? json.content : [];
}

export function fetchCreatedOrders(params: FetchTrendyolOrdersParams) {
  return fetchTrendyolOrders({ ...params, status: 'Created' });
}

export function fetchShipmentUpdates(params: FetchTrendyolOrdersParams) {
  return fetchTrendyolOrders({ ...params, status: undefined });
}

// Image caching for product images
export const imageCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface TrendyolProduct {
  barcode: string;
  images: Array<{ url: string }>;
}

interface TrendyolProductResponse {
  content: TrendyolProduct[];
}

/**
 * Fetch product images from Trendyol Product API
 * @param barcodes Array of barcodes to fetch images for
 * @param credentials Trendyol API credentials
 * @returns Promise that resolves to a mapping of barcode -> image URL
 */
export async function getProductImages(
  barcodes: string[],
  credentials: {
    supplierId: string;
    apiKey: string;
    apiSecret: string;
  }
): Promise<Record<string, string>> {
  if (!barcodes.length || !credentials.supplierId || !credentials.apiKey || !credentials.apiSecret) {
    return {};
  }

  const imageMap: Record<string, string> = {};
  const barcodesToFetch: string[] = [];

  // Check cache first
  const now = Date.now();
  for (const barcode of barcodes) {
    const cached = imageCache.get(barcode);
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      imageMap[barcode] = cached.url;
    } else {
      barcodesToFetch.push(barcode);
    }
  }

  if (barcodesToFetch.length === 0) {
    return imageMap;
  }

  const auth = 'Basic ' + Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');

  // Fetch images for remaining barcodes (batch processing)
  for (const barcode of barcodesToFetch) {
    try {
      const url = `https://apigw.trendyol.com/integration/product/sellers/${credentials.supplierId}/products?barcode=${encodeURIComponent(barcode)}`;
      
      console.log(`[Trendyol Product API] Fetching image for barcode: ${barcode}`);
      
      const response = await fetch(url, {
        headers: { 
          Authorization: auth,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'KolayXport-TrendyolIntegration/1.0'
        },
        method: 'GET'
      });

      if (!response.ok) {
        console.warn(`Failed to fetch product image for barcode ${barcode}: ${response.status}`);
        continue;
      }

      const data: TrendyolProductResponse = await response.json();
      
      if (data.content && data.content.length > 0 && data.content[0].images && data.content[0].images.length > 0) {
        const imageUrl = data.content[0].images[0].url;
        imageMap[barcode] = imageUrl;
        console.log(`[Trendyol Product API] Found image for barcode ${barcode}: ${imageUrl}`);
        
        // Cache the result
        imageCache.set(barcode, {
          url: imageUrl,
          timestamp: now
        });
      } else {
        console.log(`[Trendyol Product API] No image found for barcode ${barcode} in response`);
      }

      // Rate limiting - small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.warn(`Error fetching product image for barcode ${barcode}:`, error);
    }
  }

  return imageMap;
}

// Export the main function for direct use
export { fetchTrendyolOrders }; 