// import fetch from 'node-fetch';

export interface TrendyolOrder {
  id: string;
  orderNumber: string;
  status: string;
  customerName?: string;
  totalPrice?: number;
  currency?: string;
  lineItems?: Array<{
    id: string;
    title: string;
    quantity: number;
    price: number;
    sku?: string;
  }>;
}

/**
 * Fetch orders from Trendyol for a user.
 * @param apiKey Trendyol API key
 * @param apiSecret Trendyol API secret
 * @param supplierId Trendyol supplier ID
 */
export async function fetchCreatedOrders({ apiKey, apiSecret, supplierId }: { apiKey: string; apiSecret: string; supplierId: string }): Promise<TrendyolOrder[]> {
  if (!apiKey || !apiSecret || !supplierId) {
    throw new Error('Missing Trendyol credentials');
  }

  // TODO: Implement actual Trendyol API integration
  // For now, return an empty array to prevent build errors
  return [];
} 