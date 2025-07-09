import useSWR from 'swr';
import { useMemo } from 'react';

// Define the shape of the order data we expect from the API
export interface UIOrder {
  id: string;
  marketplace: string;
  marketplaceKey: string;
  orderNumber?: string;
  labelOverrides?: Record<string, any>;
  customerName?: string;
  images?: string[];
  fedexServiceType?: string;
  fedexPackagingType?: string;
  fedexPickupType?: string;
  fedexDutiesPaymentType?: string;
  commodityDesc?: string;
  harmonizedCode?: string;
  sendCommercialInvoiceViaEtd?: boolean;
  trackingNumber?: string;
  shippingLabelUrl?: string;
  packingStatus?: string;
  productionNotes?: string;
  rawData?: Record<string, any>;
  rawFetchedAt?: string;
  packingEditedAt?: string;
  productionEditedAt?: string;
  syncedAt?: string;
  syncStatus?: string;
  shipmentStatus?: string;
  shippedAt?: string;
  termsOfSale?: string;
  shippingChargesPaymentType?: string;
  packageLength?: number;
  packageWidth?: number;
  packageHeight?: number;
  dimensionUnits?: string;
  status?: string;
  labelStatus?: string;
  shipByDate?: string;
  currency?: string;
  totalPrice?: number;
  shippingAddress?: any;
  billingAddress?: any;
  createdAt?: string;
  updatedAt?: string;
  items?: any[];
  marketplaceOrderDate?: string;
  source?: string;
  channel?: string;
  line_items?: any[];
}

interface OrdersApiResponse {
  orders?: UIOrder[];
  data?: UIOrder[];
  total: number;
  page: number;
  pageSize: number;
}

// Fetcher for SWR
const fetcher = (url: string) => {
  return fetch(url).then(res => {
    if (!res.ok) throw new Error('Network response was not ok');
    return res.json();
  });
};

export function useOrders(page: number = 1, pageSize: number = 20, filters: Record<string, any> = {}, context?: string) {
  const params = new URLSearchParams();
  if (typeof page !== 'undefined' && typeof pageSize !== 'undefined') {
    params.append('page', String(page));
    params.append('limit', String(pageSize));
  }

  // Add filters with proper handling for undefined/null values
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  
  // Add context parameter if provided
  if (context) {
    params.append('context', context);
  }
  
  const { data, error, isLoading, mutate } = useSWR<OrdersApiResponse>(
    `/api/orders?${params.toString()}`,
    fetcher
  );

  // Debug: Log the raw response from API
  if (typeof window !== 'undefined') {
    console.log('[useOrders] API response:', data);
  }

  // Process orders based on context
  const processedOrders = useMemo(() => {
    if (!data?.orders && !data?.data) return [];
    const orders = data.orders || data.data || [];

    if (typeof window !== 'undefined') {
      console.log('[useOrders] Orders before processing:', orders);
    }

    if (context === 'labelsPage') {
      const transformed = orders
        .filter(order => order && typeof order === 'object')
        .map(order => {
        // Get the first line item's title or product name for commodity description
        const lineItems = order.line_items || [];
        const commodityDesc = lineItems.length > 0 && lineItems[0]
          ? lineItems[0].title || lineItems[0].productName || '---'
          : '---';

        // Determine source and channel based on marketplace
        const marketplaceLower = order.marketplace?.toLowerCase() || '';
        const isEtsy = marketplaceLower.includes('etsy');
        const source = order.source || (isEtsy ? 'shippo' : 'veeqo');
        const channel = order.channel || (isEtsy ? 'etsy' : 'other');

        // Set labelStatus based on shippingLabelUrl
        const labelStatus = order.shippingLabelUrl ? 'created' : 'not_created';

        // Use marketplaceOrderDate or createdAt for order date
        const orderDate = order.marketplaceOrderDate || order.createdAt || '';

        return {
          ...order,
          commodityDesc,
          source,
          channel,
          labelStatus,
          marketplaceOrderDate: orderDate,
          createdAt: orderDate,
        };
      });
      if (typeof window !== 'undefined') {
        console.log('[useOrders] Processed orders for labelsPage:', transformed);
      }
      return transformed;
    }

    if (typeof window !== 'undefined') {
      console.log('[useOrders] Processed orders (no context):', orders);
    }
    return orders;
  }, [data, context]);

  return {
    orders: processedOrders,
    total: data?.total || 0,
    page: data?.page || page,
    pageSize: data?.pageSize || pageSize,
    isLoading,
    isError: !!error,
    mutate,
  };
}