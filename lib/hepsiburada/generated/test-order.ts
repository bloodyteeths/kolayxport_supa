/* eslint-disable */
/**
 * Test Siparişi Oluşturma — generated from openapi/test-order.json. Do not edit.
 *
 * Source: test-siparisi-olusturma v1.0, refreshed with `npm run specs:fetch`.
 * Corrections belong in openapi/overlays/, not here.
 */

export interface Money {
  Amount?: number;
  Currency?: string;
}

export interface Order {
  /** Müşteri bilgileri */
  Customer?: Customer;
  /** Teslimat adresi */
  DeliveryAddress?: DeliveryAddress;
  /** Siparişteki kalem listesi */
  LineItems?: LineItem[];
  /** Siparişin oluşturulma tarihi */
  OrderDate?: string;
  /** Sipariş numarası */
  OrderNumber?: string;
  /** Siparişin ödeme durumu */
  PaymentStatus?: string;
}

export interface Customer {
  /** Müşterinin unique Id bilgisi */
  CustomerId?: string;
  /** Müşterinin adı ve soyadı */
  Name?: string;
}

export interface DeliveryAddress {
  /** Adres bilgileri */
  AddressDetail?: string;
  /** Adresin unique Id değeri */
  AddressId?: string;
  /** Müşterinin Gsm numarası */
  AlternatePhoneNumber?: string;
  /** Adresin şehir bilgisi */
  City?: string;
  /** Ülke kodu */
  CountryCode?: string;
  /** Adresin mahalle/semt bilgisi */
  District?: string;
  /** Müşterinin mail bilgisi */
  Email?: string;
  /** Teslim edilecek kişinin ismi */
  Name?: string;
  /** Müşterinin telefon numarası */
  PhoneNumber?: string;
}

export interface LineItem {
  /** Kargo firması unique Id değeri */
  CargoCompanyId?: number;
  /** Özelleştirilebilir kalemin içerik bilgisi */
  CustomizedProductValue?: string;
  /** Paketin teslimat seçeneği */
  DeliveryOptionId?: number;
  /** Kalemin unique Listing Id değeri */
  ListingId?: string;
  /** Kalemin satıcısının unique Id değeri */
  MerchantId?: string;
  /** Kalemin satıcıya ait SKU değeri */
  MerchantSku?: string;
  /** Kalemin birim tutarı */
  Price?: Money;
  /** Kalem adedi */
  Quantity?: number;
  /** Kalemin sku değeri */
  Sku?: string;
  /** Kalemin etiket listesi */
  TagList?: string[];
  /** Kalemin toplam tutarı */
  TotalPrice?: Money;
  /** Kalemin kdv tutarı */
  Vat?: number;
  /** BnplMP kalem olup olmadığı bilgisi */
  isBnplMP?: boolean;
}

/**
 * Test siparisi olusturma
 *
 * `POST /orders/merchantId/{merchantId}`
 */
export interface PostOrdersParams {
  /** Satıcının unique Id değeridir */
  merchantId: string;
}

export type PostOrdersBody = Order;

export type PostOrdersResponse = string;
