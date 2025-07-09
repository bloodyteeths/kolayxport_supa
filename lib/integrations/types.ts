export interface VeeqoOrder {
  id: string;
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
  }>;
} 