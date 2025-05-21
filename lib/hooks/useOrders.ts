import useSWR from 'swr';

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
  shipByDate?: string;
  currency?: string;
  totalPrice?: number;
  shippingAddress?: any;
  billingAddress?: any;
  createdAt?: string;
  updatedAt?: string;
  items?: any[];
  marketplaceOrderDate?: string;
}

interface OrdersApiResponse {
  orders?: UIOrder[];
  data?: UIOrder[];
  total: number;
  page: number;
  pageSize: number;
}

// Fetcher for SWR
const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Network response was not ok');
  return res.json();
});

export function useOrders(page: number = 1, pageSize: number = 20, filters: Record<string, any> = {}, context?: string) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(pageSize),
    ...filters,
  });
  
  // Add context parameter if provided
  if (context) {
    params.append('context', context);
  }
  
  const { data, error, isLoading, mutate } = useSWR<OrdersApiResponse>(
    `/api/orders?${params.toString()}`,
    fetcher
  );
  return {
    orders: data?.orders || data?.data || [],
    total: data?.total || 0,
    page: data?.page || page,
    pageSize: data?.pageSize || pageSize,
    isLoading,
    isError: !!error,
    mutate,
  };
} 