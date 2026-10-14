import type { CopyableAddress } from '@/lib/format/address';

export type PrintAddress = CopyableAddress;

export interface PrintItem {
  id: string;
  sku: string;
  title: string;
  variation: string;
  quantity: number;
  /** Per-line buyer note / personalization, when the marketplace sent one. */
  note: string;
  image: string;
}

export interface PrintOrder {
  id: string;
  orderNumber: string;
  marketplace: string;
  customerName: string;
  /** ISO timestamp. */
  orderDate: string;
  address: PrintAddress;
  giftMessage: string;
  customerNote: string;
  items: PrintItem[];
}

export interface PrintSender {
  name: string;
  personName: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  phone: string;
}

export interface PrintDataResponse {
  orders: PrintOrder[];
  /** Requested ids that were not found or belong to another user. */
  missingCount: number;
  sender: PrintSender | null;
}

/** Max orders per print request; mirrors PRINT_MAX_IDS in the API route. */
export const PRINT_MAX_IDS = 200;
