export type OrderSource = 'veeqo' | 'shippo' | 'trendyol' | 'wix' | 'shopify' | 'amazon' | 'etsy-api' | 'ebay-api' | 'merged';
export type OrderChannel = 'etsy' | 'shopify' | 'amazon' | 'ebay' | 'trendyol' | 'wix' | 'other';

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
  email?: string;
}

export interface NormalizedLineItem {
  id: string;
  title: string;
  value: number;
  quantity: number;
  /** Weight in kg */
  weight: number;
  sku: string;
  hs_code?: string;
  country_of_origin?: string;
  image?: string;
  variantInfo?: string;
  variant_title?: string;
  product_variant?: { title?: string };
  notes?: string;
  shipBy?: string;
}

export interface UIOrder {
  shippingAddress?: string | null;
  uiOrderDate?: string;

  commodityDesc?: string;
  externalStatus?: string;
  id: string;
  source: OrderSource;
  channel: OrderChannel;
  marketplace: string;
  marketplaceKey: string;
  orderNumber: string;
  customerName: string;
  status: string;
  currency: string;
  totalPrice: number;
  to_address: {
    name: string;
    phone: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    postal: string;
    country: string;
    isResidential: boolean;
    email?: string;
  };
  line_items: Array<{
    id: string;
    title: string;
    value: number;
    quantity: number;
    /** Weight in kg */
    weight: number;
    sku: string;
    hs_code?: string;
    country_of_origin?: string;
    image?: string;
    variantInfo?: string;
    variant_title?: string;
    product_variant?: { title?: string };
    shipBy?: string;
    /** Amazon ASIN used to enrich images/weight via Catalog API. */
    asin?: string;
  }>;
  marketplaceOrderDate?: string;
  shipByDate?: string; // Ship-by deadline date for the order (comes from Veeqo due_date)
  /** Buyer-provided gift message (e.g. Etsy gift_message). */
  giftMessage?: string;
  /** Buyer-provided personalization / note to seller (e.g. Etsy message_from_buyer). */
  customerNote?: string;
  rawData: any;
  // Optional fields for label/fulfillment
  /** Weight in kg */
  weight?: number;
  hsCode?: string;
  countryOfOrigin?: string;
  serviceType?: string;
  packagingType?: string;
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientStreet1?: string;
  recipientStreet2?: string;
  recipientCity?: string;
  recipientState?: string;
  recipientPostal?: string;
  recipientCountry?: string;
  recipientPhone?: string;
  recipientEmail?: string;
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
  dimensionUnits?: 'IN' | 'CM';
  labelStockType?: string;
  signatureType?: string;
  trackingNumber?: string;
  shippingLabelUrl?: string;
  labelCreated?: boolean;
  createdAt?: string;
  customsValue?: number;
  /** Amazon FBA orders (fulfilled by Amazon) — seller does not ship these. */
  isFBA?: boolean;
  /** Marketplace ID for multi-region Amazon orders (e.g. ATVPDKIKX0DER). */
  marketplaceId?: string;
}

export interface VeeqoOrder {
  id: string | number;
  number?: string;
  status?: string;
  currency_code?: string;
  total_price?: number;
  deliver_to?: {
    first_name?: string;
    last_name?: string;
  };
  line_items?: Array<{
    id: string;
    product_title?: string;
    variation_sku?: string;
    price?: number;
    quantity: number;
    notes?: string;
    product_image?: string;
    variation_title?: string;
    image_url?: string;
    sellable?: any;
    product?: any;
    title?: string;
    name?: string;
    additional_options?: string;
    line_item_id?: string;
  }>;
  allocations?: Array<{
    id: number;
    line_items?: Array<{
      id: number;
      quantity: number;
      sellable?: any;
      [key: string]: any;
    }>;
    [key: string]: any;
  }>;
  [key: string]: any;
}

export interface VeeqoLineItem {
  id: string;
  product_title?: string;
  variation_sku?: string;
  price?: number;
  quantity: number;
  notes?: string;
  product_image?: string | {
    small_thumbnail_url?: string;
    medium_thumbnail_url?: string;
    large_thumbnail_url?: string;
  };
  variation_title?: string;
  image_url?: string;
  sellable?: {
    id?: string;
    image_url?: string;
    main_thumbnail_url?: string;
    small_thumbnail_url?: string;
    images?: Array<{ url: string }>;
    full_title?: string;
  };
  product?: {
    id?: string;
    image_url?: string;
    main_thumbnail_url?: string;
    small_thumbnail_url?: string;
    images?: Array<{ url: string }>;
  };
  full_title?: string;
  sellable_title?: string;
  title?: string;
  name?: string;
  additional_options?: string;
  line_item_id?: string;
  weight?: number;
  harmonized_code?: string;
  country_of_manufacture?: string;
  product_id?: string;
}

export enum SyncType {
  ORDERS = 'ORDERS',
  PRODUCTS = 'PRODUCTS',
  INVENTORY = 'INVENTORY'
}

export interface ShippoOrder {
  object_id: string;
  order_status: string;
  placed_at: string;
  total_price: string;
  currency: string;
  shipping_address: {
    name: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    phone: string | null;
    email: string | null;
  };
  line_items: Array<{
    object_id: string;
    title: string;
    quantity: number;
    total_price: string;
    currency: string;
    /** Weight - may be string from Shippo API */
    weight: number | string;
    sku: string | null;
  }>;
  metadata?: { notes?: string };
  order_number?: string;
  shop_app?: string; // Add shop_app for channel detection
  to_address?: any; // Add to_address for address extraction
}

export interface ShippoResponse {
  results: ShippoOrder[];
  count: number;
  has_more: boolean;
}

export interface ShippoAddress {
  name?: string;
  phone?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
  email?: string;
  isResidential?: boolean;
  company?: string;
} 