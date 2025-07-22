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
  startDateMs: number | null;
  endDateMs: number | null;
  pageSize?: number;
}

async function fetchTrendyolOrders({ supplierId, apiKey, apiSecret, status, startDateMs, endDateMs, pageSize = 200 }: FetchTrendyolOrdersParams): Promise<TrendyolOrder[]> {
  if (!supplierId || !apiKey || !apiSecret) {
    throw new Error('Missing Trendyol credentials');
  }
  const auth = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  let url = `${BASE_URL}/${supplierId}/orders?`;
  if (status) url += `status=${encodeURIComponent(status)}&`;
  
  // Only add date filters if they are provided (Trendyol API date filtering is buggy)
  if (startDateMs !== null && endDateMs !== null) {
    // Convert milliseconds to seconds for Trendyol API
    const startDateSeconds = Math.floor(startDateMs / 1000);
    const endDateSeconds = Math.floor(endDateMs / 1000);
    url += `startDate=${startDateSeconds}&endDate=${endDateSeconds}&`;
  }
  
  url += `orderByField=${status === 'Created' ? 'createdDate' : 'PackageLastModifiedDate'}`;
  url += `&orderByDirection=DESC&size=${pageSize}`;

  const res = await fetch(url, { headers: { Authorization: auth }, method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trendyol API ${res.status}: ${text}`);
  }
  const json = await res.json();
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

  // Batch fetch images for remaining barcodes in parallel
  const fetchPromises = barcodesToFetch.map(async (barcode) => {
    try {
      const url = `https://apigw.trendyol.com/integration/product/sellers/${credentials.supplierId}/products?barcode=${encodeURIComponent(barcode)}`;
      
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
        return { barcode, imageUrl: null };
      }

      const data: TrendyolProductResponse = await response.json();
      
      if (data.content && data.content.length > 0 && data.content[0].images && data.content[0].images.length > 0) {
        const imageUrl = data.content[0].images[0].url;
        return { barcode, imageUrl };
      } else {
        return { barcode, imageUrl: null };
      }
      
    } catch (error) {
      console.warn(`Error fetching product image for barcode ${barcode}:`, error);
      return { barcode, imageUrl: null };
    }
  });

  // Wait for all parallel requests to complete
  const results = await Promise.all(fetchPromises);
  
  // Process results and update cache
  let foundImages = 0;
  for (const { barcode, imageUrl } of results) {
    if (imageUrl) {
      imageMap[barcode] = imageUrl;
      foundImages++;
      
      // Cache the result
      imageCache.set(barcode, {
        url: imageUrl,
        timestamp: now
      });
    }
  }
  
  // Only log if there were API calls made
  if (barcodesToFetch.length > 0) {
    console.log(`[Trendyol] Fetched ${foundImages}/${barcodesToFetch.length} images via API`);
  }

  return imageMap;
}

// Export the main function for direct use
export { fetchTrendyolOrders }; 