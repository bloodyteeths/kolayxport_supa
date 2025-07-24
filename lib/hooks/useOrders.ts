import useSWR from 'swr';
import { useMemo } from 'react';
import { isEtsyOrderSync } from '../utils/etsyDetection';

// Define the shape of the order data we expect from the API
export interface Shipment {
  id: string;
  status: string;
  trackingNumber?: string;
  pdfUrl?: string;
  createdAt?: string;
  [key: string]: any; // For any additional properties
}

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
  shipments?: Shipment[];
  variantInfo?: string;
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
    if (!res.ok) {
      throw new Error(`Network response was not ok: ${res.status} ${res.statusText}`);
    }
    return res.json();
  });
};

export function useOrders(page: number = 1, pageSize: number = 15, filters: Record<string, any> = {}, context?: string) {
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
    fetcher,
    {
      refreshInterval: context === 'labelsPage' ? 120000 : 0, // Refresh every 2 minutes (reduced frequency)
      dedupingInterval: context === 'labelsPage' ? 1000 : 5000, // Reduced to 1 second for faster pagination
      revalidateOnFocus: false, // Disable aggressive revalidation for better performance
      revalidateOnReconnect: false, // Don't refetch on reconnect
      shouldRetryOnError: false, // Don't retry on error to prevent hanging
      keepPreviousData: true, // Keep previous data while loading new page
    }
  );


  // Process orders based on context
  const processedOrders = useMemo(() => {
    if (!data?.orders && !data?.data) return [];
    const orders = data.orders || data.data || [];

    if (context === 'labelsPage') {
      const transformed = orders
        .filter(order => order && typeof order === 'object')
        .map(order => {
        // Get the first line item's title or product name for commodity description
        const lineItems = order.line_items || [];
        const commodityDesc = lineItems.length > 0 && lineItems[0]
          ? lineItems[0].title || lineItems[0].productName || '---'
          : '---';

        // Determine source and channel based on marketplace using robust Etsy detection
        const isEtsy = isEtsyOrderSync(order.marketplace);
        const source = order.source || (isEtsy ? 'shippo' : 'veeqo');
        const channel = order.channel || (isEtsy ? 'etsy' : 'other');

        // Set labelStatus based on shippingLabelUrl, trackingNumber, shipments, or existing labelStatus
        const hasShipments = order.shipments && Array.isArray(order.shipments) && order.shipments.length > 0;
        const hasValidShipment = hasShipments && 
          order.shipments?.some(s => s?.status === 'created' && (s?.trackingNumber || s?.pdfUrl));
          
        const hasLabel = order.shippingLabelUrl || 
                        order.trackingNumber || 
                        order.labelStatus === 'created' ||
                        hasValidShipment;
        
        const labelStatus = hasLabel ? 'created' : 'not_created';

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
          // Preserve variantInfo from line_items if available
          variantInfo: order.line_items?.[0]?.variantInfo || order.variantInfo,
        };
      });
      return transformed;
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