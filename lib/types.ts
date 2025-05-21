export type OrderSource = 'veeqo' | 'shippo';
export type OrderChannel = 'etsy' | 'shopify' | 'amazon' | 'ebay' | 'other';

export interface NormalizedAddress {
  name: string;
  phone: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  isResidential?: boolean;
  company?: string;
}

export interface NormalizedLineItem {
  id: string;
  title: string;
  value: number;
  quantity: number;
  weight?: number;
  hs_code?: string;
  country_of_origin?: string;
  sku?: string;
  image?: string;
  variantInfo?: string;
}

export interface UIOrder {
  id: string;
  source: OrderSource;
  channel: OrderChannel;
  marketplace: string;
  marketplaceKey: string;
  orderNumber: string;
  customerName?: string;
  status?: string;
  currency?: string;
  totalPrice?: number;
  
  // Normalized address fields
  to_address: NormalizedAddress;
  
  // Normalized line items
  line_items: NormalizedLineItem[];
  
  // Label generation fields
  labelOverrides?: {
    serviceType?: string;
    packagingType?: string;
    weight?: number;
    customsValue?: number;
    commodityDesc?: string;
    hsCode?: string;
    countryOfOrigin?: string;
  };
  
  // Tracking and status
  trackingNumber?: string;
  shippingLabelUrl?: string;
  shipmentStatus?: string;
  shippedAt?: string;
  
  // Timestamps
  createdAt?: string;
  updatedAt?: string;
  marketplaceOrderDate?: string;
  
  // Raw data for debugging
  rawData?: Record<string, any>;

  // Legacy fields for backward compatibility
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientStreet1?: string;
  recipientStreet2?: string;
  recipientCity?: string;
  recipientState?: string;
  recipientPostal?: string;
  recipientCountry?: string;
  recipientPhone?: string;
  weight?: number;
  serviceType?: string;
  packagingType?: string;
  customsValue?: number;
  hsCode?: string;
  countryOfOrigin?: string;
  commodityDesc?: string;
  labelCreated?: boolean;

  // ETD-specific fields
  weightKg?: number;
  harmonizedCode?: string;
  countryOfMfg?: string;
  termsOfSale?: string;
  sendCommercialInvoiceViaEtd?: boolean;
  fedexServiceType?: string;
  fedexPackagingType?: string;
  fedexPickupType?: string;
  fedexDutiesPaymentType?: string;
  packageLength?: number;
  packageWidth?: number;
  packageHeight?: number;
  dimensionUnits?: string;
  labelStockType?: string;
  signatureType?: string;
} 