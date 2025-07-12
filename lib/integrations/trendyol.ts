import fetch from 'node-fetch';
import { logger } from '../logger';
import { isTrendyolEnabled } from '../config';

export interface TrendyolOrder {
  id: string;
  orderNumber: string;
  status: string;
  customerName?: string;
  totalPrice?: number;
  currency?: string;
  orderDate?: string;
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    address1?: string;
    address2?: string;
    city?: string;
    district?: string;
    postalCode?: string;
    phone?: string;
  };
  lineItems?: Array<{
    id: string;
    title: string;
    quantity: number;
    price: number;
    sku?: string;
    barcode?: string;
    productCode?: string;
  }>;
}

export interface TrendyolOrdersResponse {
  content: TrendyolOrder[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

interface FetchTrendyolOrdersOptions {
  apiKey: string;
  apiSecret: string;
  supplierId: string;
  page?: number;
  size?: number;
  status?: string;
  updatedAfter?: Date;
}

const TRENDYOL_API_BASE_URL = 'https://api.trendyol.com';
const TRENDYOL_ORDERS_ENDPOINT = '/sapigw/suppliers/{supplierId}/orders';

/**
 * Creates Basic Auth header for Trendyol API
 */
function createAuthHeader(apiKey: string, apiSecret: string): string {
  const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  return `Basic ${credentials}`;
}

/**
 * Fetch orders from Trendyol API with pagination support
 * @param options Trendyol API credentials and options
 * @returns Promise that resolves to an array of Trendyol orders
 */
export async function fetchTrendyolOrders(options: FetchTrendyolOrdersOptions): Promise<TrendyolOrder[]> {
  const { apiKey, apiSecret, supplierId, page = 0, size = 100, status, updatedAfter } = options;

  // Check if Trendyol is enabled via feature flag
  if (!isTrendyolEnabled()) {
    logger.info('Trendyol integration is disabled via feature flag');
    return [];
  }

  if (!apiKey || !apiSecret || !supplierId) {
    throw new Error('Missing Trendyol credentials: apiKey, apiSecret, and supplierId are required');
  }

  let allOrders: TrendyolOrder[] = [];
  let currentPage = page;
  let hasMore = true;

  while (hasMore) {
    try {
      const url = new URL(`${TRENDYOL_API_BASE_URL}${TRENDYOL_ORDERS_ENDPOINT.replace('{supplierId}', supplierId)}`);
      
      // Add query parameters
      url.searchParams.append('page', String(currentPage));
      url.searchParams.append('size', String(size));
      
      if (status) {
        url.searchParams.append('status', status);
      }
      
      if (updatedAfter) {
        url.searchParams.append('updatedAfter', updatedAfter.toISOString());
      }

      logger.info(`Fetching Trendyol orders page ${currentPage}...`, { 
        url: url.toString(),
        supplierId,
        page: currentPage,
        size 
      });

      const authHeader = createAuthHeader(apiKey, apiSecret);
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'User-Agent': 'KolayXport-TrendyolIntegration/1.0'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Trendyol API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data: TrendyolOrdersResponse = await response.json();
      
      if (data.content && data.content.length > 0) {
        allOrders = allOrders.concat(data.content);
        currentPage++;
        
        // Check if we have more pages
        hasMore = currentPage < data.totalPages;
      } else {
        hasMore = false;
      }

      // If a specific page was requested, stop after fetching it
      if (page !== undefined && page >= 0) {
        hasMore = false;
      }

      // Add a small delay to avoid rate limiting
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error) {
      logger.error('Failed to fetch Trendyol orders', error, {
        supplierId,
        page: currentPage,
        operation: 'fetchTrendyolOrders'
      });
      
      // If it's the first page and we get an error, throw it
      // If it's a subsequent page, just stop fetching
      if (currentPage === page) {
        throw error;
      } else {
        logger.warn('Stopping Trendyol order fetch due to error on subsequent page', {
          currentPage,
          totalFetched: allOrders.length
        });
        hasMore = false;
      }
    }
  }

  logger.info(`Successfully fetched ${allOrders.length} Trendyol orders`, {
    supplierId,
    totalOrders: allOrders.length
  });

  return allOrders;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use fetchTrendyolOrders instead
 */
export async function fetchCreatedOrders({ 
  apiKey, 
  apiSecret, 
  supplierId 
}: { 
  apiKey: string; 
  apiSecret: string; 
  supplierId: string; 
}): Promise<TrendyolOrder[]> {
  return fetchTrendyolOrders({ apiKey, apiSecret, supplierId });
} 