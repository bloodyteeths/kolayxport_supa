/* eslint-disable */
/**
 * Sipariş Entegrasyonu (OMS) — generated from openapi/order.json. Do not edit.
 *
 * Source: siparis-olusturma-entegrasyonu v1.0, refreshed with `npm run specs:fetch`.
 * Corrections belong in openapi/overlays/, not here.
 */

export interface BarcodeData {
  /** Delivery nin servisinden dönen barkod verileri */
  data?: string[];
  /** Etiket format türü */
  format?: string;
  /** Delivery'nin servisinden dönen, satıcıya ait ortak barkod olup olmadığı bilgisi */
  hasMerchantMutualBarcode?: boolean;
}

export interface DeletedDeliveriesWithPagination {
  /** Satıcıya ait silinmiş paketlerin listesi */
  items?: UnpackedDelivery[];
  /** Limit değeri */
  limit?: number;
  /** Offset değeri */
  offset?: number;
  /** Sayfa sayısı */
  pageCount?: number;
  /** Toplam kalem sayısı */
  totalCount?: number;
}

export interface UnpackedDelivery {
  /** Paketin teslimat numarası */
  barcode?: string;
  /** Paket numarası */
  packageNumber?: string;
  /** Paketin silinme tarihi */
  unpackedDate?: string;
}

export interface VariantProperty {
  /** Ürünün hermes üzerindeki varyant ismi */
  name?: string;
  /** Ürünün hermes üzerindeki varyant değeri */
  value?: string;
}

export interface ChangeLineCargoCompanyRequest {
  CargoCompanyShortName?: string;
}

export interface ChangeableCargoCompanyRepresentation {
  /** Kargo firmasının unique değeri */
  Id?: number;
  /** Kargo firmasının aktif olup olmadığı bilgisi */
  IsActive?: boolean;
  /** Kargo firmasının Logo URL bilgisi */
  LogoUrl?: string;
  /** Kargo firmasının isim bilgisi */
  Name?: string;
  /** Kargo firmasının kısa isim bilgisi */
  ShortName?: string;
}

export interface CreateDeliveryResponse {
  /** Paketin teslimat kodu */
  barcode?: string;
  /** Paket numarısı */
  packageNumber?: string;
}

export interface OrderLine {
  /** Kalemin unique Id değeridir */
  orderLineId?: string;
  /** Kalem miktarı */
  quantity?: number;
}

export interface UpdateLaborCostRequest {
  unitLaborCost?: number;
}

export interface Warehouse {
  /** Depo kodu */
  shippingAddressLabel?: string;
  /** Teslimat modeli */
  shippingModel?: string;
}

export interface AddInvoiceOfPackageRequest {
  /** Fatura düzenlenme tarihi */
  arrangementDate?: string;
  /** Fatura Linki */
  invoiceLink?: string;
  /** Faturalar */
  invoices?: InvoiceItem[];
  /** Fatura sıra numarası */
  rowNumber?: string;
  /** Faturanın seri numarası */
  serialNumber?: string;
}

export interface AddressRepresentation {
  /** Adres bilgileri */
  address?: string;
  /** Adresin unique Id değeri */
  addressId?: string;
  /** Müşterinin Gsm numarası */
  alternatePhoneNumber?: string;
  /** Adresin şehir bilgisi */
  city?: string;
  /** Ülke kodu */
  countryCode?: string;
  /** Adrese ilişkin açıklayıcı bilgi */
  directions?: string;
  /** Adresin mahalle/semt bilgisi */
  district?: string;
  /** Müşterinin mail bilgisi */
  email?: string;
  /** Teslim edilecek kişinin ismi */
  name?: string;
  /** Müşterinin telefon numarası */
  phoneNumber?: string;
  /** Faturanın teslim edileceği adresin posta kodu bilgisi */
  postalCode?: string;
  /** Adresin ilçe bilgisi */
  town?: string;
}

export interface CancelByMerchantRequest {
  reasonId?: number;
}

export interface CancelledItem {
  /** İptal nedeni kodu */
  cancelReasonId?: number;
  /** Kalemin unique Id değeridir */
  orderLineId?: string;
  /** Kalem miktarı */
  quantity?: number;
}

export interface CancelledOrderLineItemsRepresentationWithPaging {
  /** Satıcıya ait İptal olmuş kalem listesi */
  items?: CancelledOrderLineRepresentation[];
  /** Limit değeri */
  limit?: number;
  /** Offset değeri */
  offset?: number;
  /** Sayfa sayısı */
  pageCount?: number;
  /** Toplam kalem sayısı */
  totalCount?: number;
}

export interface CancelledOrderLineRepresentation {
  /** Kalemin iptal edildiği tarih */
  cancelDate?: string;
  /** Kalemin iptal nedeni */
  cancelReasonCode?: string;
  /** Kalemin kim tarafından iptal edildiği bilgisi */
  cancelledBy?: string;
  /** Kalemin unique Id değeri */
  lineItemId?: string;
  /** Kalemin satıcısının unique Id değeri */
  merchantId?: string;
  /** Kalemin satıcıya ait SKU değeri */
  merchantSku?: string;
  /** Kalemin sipariş numarası */
  orderNumber?: string;
  /** Kalemin iptal edilen adedi */
  quantity?: number;
  /** Kalemin sku değeri */
  sku?: string;
}

export interface CargoCompanyRepresentation {
  /** Kargo firmasının unique değeri */
  id?: number;
  /** Kargo firmasının Logo URL bilgisi */
  logoUrl?: string;
  /** Kargo firmasının isim bilgisi */
  name?: string;
  /** Kargo firmasının kısa isim bilgisi */
  shortName?: string;
  /** Kargonun takibi için URL bilgisi */
  trackingUrl?: string;
}

export interface CreatePackageRequest {
  barcode?: string;
  cargoCompany?: string;
  carrier?: string;
  creationReason?: string;
  deci?: number;
  lineItemRequests?: LineItemCreatePackageRequest[];
  parcelQuantity?: number;
  warehouse?: Warehouse;
}

export interface CustomerRepresentation {
  /** Müşterinin unique Id bilgisi */
  customerId?: string;
  /** Müşterinin adı ve soyadı */
  name?: string;
}

export interface DeliveredDeliveriesRepresentation {
  /** Paketin teslimat numarası */
  Barcode?: string;
  /** Paketin teslim edilme tarihi */
  DeliveredDate?: string;
  /** Elektronik Ticaret Gümrük Beyannamesi numarası */
  EtgbNo?: string;
  /** Paketin unique Id değeri */
  Id?: string;
  /** Paketin satıcısının unique Id değeri */
  MerchantId?: string;
  /** Paket içindeki kalemlerin sipariş numarası */
  OrderNumber?: string;
  /** Paket içindeki kalemlerin sipariş numaraları */
  OrderNumbers?: string[];
  /** Paket numarası */
  PackageNumber?: string;
}

export interface DeliveredDeliveriesRepresentationWithPaging {
  /** Satıcıya ait teslim olmuş paketler */
  items?: DeliveredDeliveriesRepresentation[];
  /** Limit değeri */
  limit?: number;
  /** Offset değeri */
  offset?: number;
  /** Sayfa sayısı */
  pageCount?: number;
  /** Toplam paket sayısı */
  totalCount?: number;
}

export interface DiscountInfo {
  /** Kampanya indirim oranı */
  campaignDiscountRate?: number;
  /** Kalemin kampanya unique Id değeri */
  campaignId?: number;
  /** Kampanya ismi */
  campaignName?: string;
  /** Kampanya türü */
  campaignType?: number;
  /** Koşul sağlandığında kampanyanın tanımlanacağı bilgisi */
  conditionOrAward?: number;
  /** Log Id */
  correlationId?: string;
  /** Kampanya indirim tutarı */
  discountTotal?: number;
  isProtectedCampaign?: boolean;
  /** Kampanya uygulanacak kalemin miktarı */
  quantity?: number;
}

export interface ExternalDeliverRequest {
  /** Dijital ürün kodları */
  digitalCodes?: string[];
  /** Paketi teslim alacak kişi */
  receivedBy?: string;
  /** Paketin teslim edilme tarihi */
  receivedDate?: string;
}

export interface ExternalInfoRequest {
  /** Gönderim ücreti */
  cost?: number;
  /** Paketin hacimsel ağırlığı */
  deci?: number;
  /** Paketin tahmini varış tarihi */
  estimatedArrivalDate?: string;
  /** Paketin kargoya verilme tarihi */
  shippedDate?: string;
  /** Paketin KDV'si */
  tax?: number;
  /** Kargo takip numarası */
  trackingNumber?: string;
  /** Kargo takip telefon numarası */
  trackingPhoneNumber?: string;
  /** Kargonun takibi için URL bilgisi */
  trackingUrl?: string;
}

export interface ExternalLineItemsRepresentation {
  lineItems?: ExternalPackageableWithRepresentation[];
}

export interface ExternalPackageableWithRepresentation {
  /** Aynı pakete girebilecek kalemin unique Id bilgisi */
  lineItemId?: string;
  /** Aynı pakete girebilecek kalemlerin sipariş numarası */
  orderNumber?: string;
  /** Aynı pakete girebilecek kalemin miktarı */
  quantity?: number;
}

/**
 * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
 * Present on every package in the live feed.
 */
export interface ExternalRawPackageRepresentation {
  /** Paketin teslimat numarası */
  barcode?: string;
  /** Faturanın teslim edileceği adres bilgisi */
  billingAddress?: string;
  /** Faturanın teslim edileceği adresin şehir bilgisi */
  billingCity?: string;
  /** Faturanın teslim edileceği ülke kodu */
  billingCountryCode?: string;
  /** Faturanın teslim edileceği adresin mahalle/semt bilgisi */
  billingDistrict?: string;
  /** Faturanın teslim edileceği adresin posta kodu bilgisi */
  billingPostalCode?: string;
  /** Faturanın teslim edileceği adresin ilçe bilgisi */
  billingTown?: string;
  /** Kargo şirketi adı */
  cargoCompany?: string;
  /** Faturanın teslim edileceği kişinin ismi */
  companyName?: string;
  /** Müşterinin unique Id bilgisi */
  customerId?: string;
  /** Müşterinin adı ve soyadı */
  customerName?: string;
  /** Customs kalemler için toplam tutar bilgisi */
  customsTotalPrice?: Money;
  /** Paketin tahmini kargoya veriliş tarihi (esd) */
  dueDate?: string;
  /** Müşterinin mail bilgisi */
  email?: string;
  /** Paketin tahmini varış tarihi */
  estimatedArrivalDate?: string;
  /** Paketin unique Id değeri */
  id?: string;
  /** Müşterinin TCKN bilgisi */
  identityNo?: string;
  /** Kargo firması değiştirilebilir mi */
  isCargoChangable?: boolean;
  /** Paket içindeki kalemlerin bilgileri */
  items?: PackageLine[];
  /** Siparişin oluşturulma tarihi */
  orderDate?: string;
  /** Paket numarası */
  packageNumber?: string;
  /** Müşterinin telefon numarası */
  phoneNumber?: string;
  /** Paketin teslim edileceği kişinin ismi */
  recipientName?: string;
  /** Paketin teslimat adresi */
  shippingAddressDetail?: string;
  /** Paketin teslim edileceği adresin şehir bilgisi */
  shippingCity?: string;
  /** Paketin teslim edileceği ülke kodu */
  shippingCountryCode?: string;
  /** Paketin teslim edileceği adresin mahalle/semt bilgisi */
  shippingDistrict?: string;
  /** ShippingFee kalemler için toplam tutar bilgisi */
  shippingTotalPrice?: Money;
  /** Paketin teslim edileceği adresin ilçe bilgisi */
  shippingTown?: string;
  /** Paketin durumu */
  status?: string;
  /** Kurumsal müşterinin vergi numarası */
  taxNumber?: string;
  /** Faturanın teslim edileceği vergi dairesi adı */
  taxOffice?: string;
  /** Paketteki kalemlerin vade farkı eklenmemiş tutarlarının toplamı */
  totalPrice?: Money;
  /** Paketin silinme tarihi */
  unpackedDate?: string;
  /**
   * Volumetric weight of the whole package, in deci -- what the cargo company bills on. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  totalDeci?: number;
}

export interface ExternalTrackingInfoRepresentation {
  /** Paketin teslimat numarası */
  barcode?: string;
  /** Kargo firmasının isim bilgisi */
  cargoCompany?: string;
  /** Paketin hacimsel ağırlığı */
  deci?: number;
  /** Paketin tahmini varış tarihi */
  estimatedArrivalDate?: string;
  /** Paket numarası */
  packageNumber?: string;
  /** Paketin durumu */
  status?: string;
  /** Kargo takip numarası */
  trackingInfoCode?: string;
  /** Kargo gönderisinin takibi için URL bilgisi */
  trackingInfoUrl?: string;
}

export interface ExternalUnDeliverRequest {
  /** Paketin teslim edilememe tarihi */
  undeliveredDate?: string;
  /** Paketin teslim edilememe nedeni */
  undeliveredReason?: string;
}

export interface HbDiscount {
  /** Kalemin toplam indirim tutarı */
  totalPrice?: Money;
  /** Kalemin birim indirim tutarı */
  unitPrice?: Money;
}

export interface InvoiceRepresentation {
  /** Faturanın teslim edileceği adres bilgisi */
  address?: AddressRepresentation;
  /** Kurumsal müşterinin vergi numarası */
  taxNumber?: string;
  /** Faturanın teslim edileceği vergi dairesi adı */
  taxOffice?: string;
  /** Müşterinin TCKN bilgisi */
  turkishIdentityNumber?: string;
}

export interface LineItemCreatePackageRequest {
  id?: string;
  quantity?: number;
  serialNumbers?: string[];
}

export interface LineRepresentation {
  /** Paketin teslimat numarası */
  barcode?: string;
  /** Satıcıdan alınan BNPL işlem ücreti tutarı */
  bnplCommissionAmount?: Money;
  /** Ödemenin alınıp alınmadığı bilgisi */
  canCreatePackage?: boolean;
  /** Kargo firmasının isim bilgisi */
  cargoCompany?: string;
  /** Kargo bilgisi */
  cargoCompanyModel?: CargoCompanyRepresentation;
  /** Kalemin komisyon bedeli */
  commission?: Money;
  /** Kalemin komisyon oranı */
  commissionRate?: number;
  /** Satıcı komisyon servisinden alınan komisyon türü */
  commissionType?: number;
  /** Kalemin oluşma sebebi */
  creationReason?: string;
  /** Boş bir değer atar */
  creditCardHolderName?: string;
  /** Müşterinin unique Id bilgisi */
  customerId?: string;
  /** Müşterinin adı ve soyadı */
  customerName?: string;
  /** Özelleştirilebilir kalemin içerik bilgisi */
  customizedText01?: string;
  /** Özelleştirilebilir kalemin içerik bilgisi */
  customizedText02?: string;
  /** Özelleştirilebilir kalemin içerik bilgisi */
  customizedText03?: string;
  /** Özelleştirilebilir kalemin içerik bilgisi */
  customizedText04?: string;
  /** Özelleştirilebilir kalem ise "X" değilse varsayılan değer "" */
  customizedTextX?: string;
  /** Teslimatla ilgili müşteriden gelen açıklama */
  deliveryNote?: Note;
  /** Paketin teslimat seçeneği */
  deliveryOptionId?: number;
  /** Paketin teslimat türü */
  deliveryType?: string;
  /** Satıcı tarafından uygulanan indirim tutarı */
  deptorDifferenceAmount?: number;
  /** İndirim bilgisi */
  discountInfo?: DiscountInfo[];
  /** HB’ye faturalandırılacak indirim (KDV dahil) tutarı */
  discountToBeBilledToHB?: number;
  /** Kargoya Teslim İçin Kalan Süre (Gün) */
  dispatchTime?: number;
  /** Tahmini kargoya veriliş tarihi (esd) */
  dueDate?: string;
  /** Kalemin birim indirim tutarı */
  hbDiscount?: HbDiscount;
  /** Kalemin unique Id değeri */
  id?: string;
  /** Fatura bilgileri */
  invoice?: InvoiceRepresentation;
  /** Kalem, oluşturuldu durumundaysa true, değilse false */
  isCancellable?: boolean;
  /** Kalem, oluşturuldu veya kargoya verildi durumundaysa true, değilse false */
  isCancellableByHbAdmin?: boolean;
  /** Sipariş HepsiMat ise kargo değişimine izin verilmediği bilgisi */
  isCargoChangable?: boolean;
  /** Kalemin Özelleştirilebilir olup olmadığı bilgisi */
  isCustomized?: boolean;
  /** Yarın kapında mı? */
  isJetDelivery?: boolean;
  /** Kalemin mikro ihracat olup olmadığı bilgisi */
  isMicroExport?: boolean;
  /** Pazar günü teslimatı mı? */
  isSundayDelivery?: boolean;
  /** Kalemin son statüsünün güncellendiği tarih */
  lastStatusUpdateDate?: string;
  /** Kalemin satıcısı tarafından uygulanan indirim tutarı bilgileri */
  merchantDiscount?: MerchantDiscount;
  /** Kalemin satıcısının unique Id değeri */
  merchantId?: string;
  /** Kalemin satıcıya ait SKU değeri */
  merchantSKU?: string;
  /** Ürün ismi */
  name?: string;
  /** Siparişin oluşturulma tarihi */
  orderDate?: string;
  /** Siparişin unique Id değeri */
  orderId?: string;
  /** Kalemin sipariş numarası */
  orderNumber?: string;
  /** Paket numarası */
  packageNumber?: string;
  /** Bundle bilgisi */
  parentItemIndex?: number;
  /** Satıcıya ödeme yapılacak günü belirten veri */
  paymentTermInDays?: number;
  /** Satıcının kargo firmasına teslim etmesi gereken saat aralığı */
  pickUpTime?: string;
  /** SKU'nun EAN barcode bilgisi */
  productBarcode?: string;
  /** Ürün görseli */
  productImageUrlFormat?: string;
  /** Ürünün Hermes'teki bilgileri */
  properties?: Property[];
  /** Tedarikçiden alınan ürünün fiyatı */
  purchasePrice?: Money;
  /** Kalem adedi */
  quantity?: number;
  /** Kampanya ilişkili kalemlerin index değerlerik */
  releatedLineIndexesWithCampaign?: string[];
  /** SAP sisteminde takibi için kullanılan değer */
  sapNumber?: string;
  /** Paketin teslimat adresi */
  shippingAddress?: AddressRepresentation;
  /** Kalemin sku değeri */
  sku?: string;
  /** Müşterinin paketi teslim almak için seçtiği saat aralığı */
  slot?: Slot;
  /** Kalemin durumu */
  status?: string;
  /** Kalemin toplam tutarı */
  totalPrice?: Money;
  /** Birim işçilik maliyeti tutarı ( altın işçiliği ) */
  unitLaborCost?: Money;
  /** Kalemin birim tutarı */
  unitPrice?: Money;
  /** Kalemin kdv tutarı */
  vat?: number;
  /** Kalemin kdv oranı */
  vatRate?: number;
  /** Depo */
  warehouse?: WarehouseRepresentation;
}

export interface MerchantDiscount {
  /** Kalemin satıcısı tarafından uygulanan toplam indirim tutarı */
  totalPrice?: Money;
  /** Kalemin satıcısı tarafından uygulanan birim indirim tutarı */
  unitPrice?: Money;
}

export interface MissingInvoicePackageRepresentation {
  /** Paket içindeki kalemlerin sipariş numaraları */
  orderNumbers?: string[];
  /** Paket numarası */
  packageNumber?: string;
  /** Paketin güncel statüsü */
  status?: string;
}

export interface MissingInvoicePackagesRepresentationWithPaging {
  /** Faturası eksik paketler */
  items?: MissingInvoicePackageRepresentation[];
  /** Limit değeri */
  limit?: number;
  /** Offset değeri */
  offset?: number;
  /** Sayfa sayısı */
  pageCount?: number;
  /** Toplam paket sayısı */
  totalCount?: number;
}

export interface Money {
  amount?: number;
  currency?: string;
}

export interface Note {
  /** Notun etiketi */
  tags?: string[];
  /** Teslimatla ilgili müşteriden gelen açıklama */
  value?: string;
}

export interface OpenLineItemsRepresentationWithPaging {
  /** Ödemesi tamamlanmış kalem listesi */
  items?: LineRepresentation[];
  /** Limit değeri */
  limit?: number;
  /** Offset değeri */
  offset?: number;
  /** Sayfa sayısı */
  pageCount?: number;
  /** Toplam kalem sayısı */
  totalCount?: number;
}

export interface OrderRepresentation {
  /** Siparişin eklenme tarihi */
  createdDate?: string;
  /** Müşteri bilgileri */
  customer?: CustomerRepresentation;
  /** Paketin teslim edileceği adres bilgisi */
  deliveryAddress?: AddressRepresentation;
  /** Fatura bilgileri */
  invoice?: InvoiceRepresentation;
  /** Siparişteki kalem listesi */
  items?: LineRepresentation[];
  /** Siparişin oluşturulma tarihi */
  orderDate?: string;
  /** Siparişin unique Id değeri */
  orderId?: string;
  /** Teslimatla ilgili müşteriden gelen açıklama */
  orderNote?: Note;
  /** Sipariş numarası */
  orderNumber?: string;
  /** Siparişin ödeme durumu */
  paymentStatus?: string;
}

export interface PackageDetail {
  /** Paketin teslimat kodu */
  barcode?: string;
  /** Kargo firması */
  cargoCompany?: string;
  /** Kargo firması kısa isim bilgisi */
  carrier?: string;
  /** Paketin hacimsel ağırlığı */
  deci?: number;
  /** Paketteki kalemlerin bilgileri */
  lines?: OrderLine[];
  /** Koli sayısı */
  parcelQuantity?: number;
  /** Depo bilgileri */
  warehouse?: Warehouse;
}

/**
 * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
 * Present on every line of every package in the live feed.
 */
export interface PackageLine {
  /** Satıcıdan alınan BNPL işlem ücreti tutarı */
  bnplCommissionAmount?: Money;
  /** Kargo ödeme bilgisi" */
  cargoPaymentInfo?: string;
  /** Kalemin komisyon bedeli */
  commission?: Money;
  /** Kalemin komisyon oranı */
  commissionRate?: number;
  /** Kalemin oluşma sebebi */
  creationReason?: string;
  /** Müşterinin paketi teslim almak için seçtiği saat aralığı */
  customerDelivery?: string;
  /** Özelleştirilebilir kalemin içerik bilgisi */
  customizedText01?: string;
  /** Özelleştirilebilir kalemin içerik bilgisi */
  customizedText02?: string;
  /** Özelleştirilebilir kalemin içerik bilgisi */
  customizedText03?: string;
  /** Özelleştirilebilir kalemin içerik bilgisi */
  customizedText04?: string;
  /** Paketin teslimat seçeneği */
  deliveryType?: string;
  /** Satıcı tarafından uygulanan indirim tutarı */
  deptorDifferenceAmount?: number;
  /** HB’ye faturalandırılacak indirim (KDV dahil) tutarı */
  discountToBeBilledToHB?: number;
  /** Ürünün gümrük vergisi kodu */
  gtip?: string;
  /** Kalemin sku değeri */
  hbSku?: string;
  /** Kalemin mikro ihracat olup olmadığı bilgisi */
  isMicroExport?: boolean;
  /** Kalemin unique Id değeri */
  lineItemId?: string;
  /** Kalemin unique Listing Id değeri */
  listingId?: string;
  /** Kalemin satıcısının unique Id değeri */
  merchantId?: string;
  /** Kalemin satıcıya ait SKU değeri */
  merchantSku?: string;
  /** Satıcının toplam satış fiyatı */
  merchantTotalPrice?: Money;
  /** Satıcının birim satış fiyatı */
  merchantUnitPrice?: Money;
  /** Siparişin oluşturulma tarihi */
  orderDate?: string;
  /** Kalemin sipariş numarası */
  orderNumber?: string;
  /** Bundle bilgisi */
  parentItemIndex?: number;
  /** Satıcının kargo firmasına teslim etmesi gereken saat aralığı */
  pickupTime?: string;
  /** Kalemin birim tutarı */
  price?: Money;
  /** SKU'nun EAN barcode bilgisi */
  productBarcode?: string;
  /** Ürün görseli */
  productImageUrlFormat?: string;
  /** Ürünün ismi */
  productName?: string;
  /** Ürünün Hermes'teki bilgileri */
  properties?: Property[];
  /** Tedarikçiden alınan ürünün fiyatı */
  purchasePrice?: Money;
  /** Kalem adedi */
  quantity?: number;
  /** Kampanya ilişkili kalemlerin index değerleri */
  releatedLineIndexesWithCampaign?: string[];
  /** Kalemin toplam indirim tutarı */
  totalHBDiscount?: Money;
  /** Kalemin satıcısı tarafından uygulanan toplam indirim tutarı */
  totalMerchantDiscount?: Money;
  /** Kalemin toplam tutarı */
  totalPrice?: Money;
  /** Kalemin birim indirim tutarı */
  unitHBDiscount?: Money;
  /** Kalemin birim işçilik maliyeti */
  unitLaborCost?: Money;
  /** Kalemin satıcısı tarafından uygulanan birim indirim tutarı */
  unitMerchantDiscount?: Money;
  /** Kalemin kdv tutarı */
  vat?: number;
  /** Kalemin kdv oranı */
  vatRate?: number;
  /** Depo bilgileri */
  warehouse?: Warehouse;
  /** Paketin ağırlık bilgisi */
  weight?: number;
  /**
   * Volumetric weight of this line, in deci. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  deci?: number;
}

export interface PaymentAwaitingOrderLineRepresentation {
  /** Kalemin unique Id değeri */
  Id?: string;
  /** Kalemin satıcısının unique Id değeri */
  MerchantId?: string;
  /** Kalemin satıcıya ait SKU değeri */
  MerchantSku?: string;
  /** Ürün ismi */
  Name?: string;
  /** Siparişin oluşturulma tarihi */
  OrderDate?: string;
  /** Kalemin sipariş numarası */
  OrderNumber?: string;
  /** Ürünün Hermes'teki bilgileri */
  Properties?: VariantProperty[];
  /** Kalem adedi */
  Quantity?: number;
  /** Kalemin sku değeri */
  Sku?: string;
}

export interface PaymentAwaitingOrderLinesItemsRepresentationWithPaging {
  /** Satıcıya ait ödeme bekleniyor statüsünde bekleyen kalemler */
  items?: PaymentAwaitingOrderLineRepresentation[];
  /** Limit değeri */
  limit?: number;
  /** Offset değeri */
  offset?: number;
  /** Sayfa sayısı */
  pageCount?: number;
  /** Toplam kalem sayısı */
  totalCount?: number;
}

export interface Property {
  /** Ürünün hermes üzerindeki ismi */
  displayName?: string;
  /** Ürünün hermes üzerindeki varyant ismi */
  name?: string;
  /** Ürünün hermes üzerindeki varyant değeri */
  value?: string;
}

export interface ShippedDeliveriesRepresentation {
  /** Paketin teslimat numarası */
  Barcode?: string;
  /** Paketin hacimsel ağırlığı (desi), kargo fiyatlandırmasında kullanılan değer */
  Deci?: number;
  /** Elektronik Ticaret Gümrük Beyannamesi numarası */
  EtgbNo?: string;
  /** Paketin unique Id değeri */
  Id?: string;
  /** Paketin satıcısının unique Id değeri */
  MerchantId?: string;
  /** Paket içindeki kalemlerin sipariş numarası */
  OrderNumber?: string;
  /** Paket içindeki kalemlerin sipariş numaraları */
  OrderNumbers?: string[];
  /** Paket numarası */
  PackageNumber?: string;
  /** Paketin kargoya teslim edilme tarihi */
  ShippedDate?: string;
}

export interface ShippedDeliveriesRepresentationWithPaging {
  /** Satıcıya ait kargoya teslim edilmiş paketler */
  items?: ShippedDeliveriesRepresentation[];
  /** Limit değeri */
  limit?: number;
  /** Offset değeri */
  offset?: number;
  /** Sayfa sayısı */
  pageCount?: number;
  /** Toplam paket sayısı */
  totalCount?: number;
}

export interface Slot {
  id?: string;
  timeslot?: string;
}

export interface SplitPackageRequest {
  /** İptal edilmek istenen kalem bilgileri */
  cancelledItems?: CancelledItem[];
  /** Paket bilgileri */
  packageDetails?: PackageDetail[];
}

export interface UndeliveredDeliveriesRepresentation {
  /** Paketin teslimat numarası */
  Barcode?: string;
  /** Paketin unique Id değeri */
  Id?: string;
  /** Paketin satıcısının unique Id değeri */
  MerchantId?: string;
  /** Paket içindeki kalemlerin sipariş numarası */
  OrderNumber?: string;
  /** Paket içindeki kalemlerin sipariş numaraları */
  OrderNumbers?: string[];
  /** Paket numarası */
  PackageNumber?: string;
  /** Paketin teslim edilememe tarihi */
  UndeliveredDate?: string;
  /** Paketin teslim edilememe nedeni */
  UndeliveredReason?: string;
}

export interface UndeliveredDeliveriesRepresentationWithPaging {
  /** Satıcıya ait teslim edilememiş paketler */
  items?: UndeliveredDeliveriesRepresentation[];
  /** Limit değeri */
  limit?: number;
  /** Offset değeri */
  offset?: number;
  /** Sayfa sayısı */
  pageCount?: number;
  /** Toplam paket sayısı */
  totalCount?: number;
}

export interface UpdateDeliveryParcelInfoRequest {
  totalDesi?: number;
  totalParcel?: number;
}

export interface UpdateDeliveryWarehouseRequest {
  /** Depo adresini tanımlayan kısa bir etiket bilgisi */
  shippingAddressLabel?: string;
}

export interface WarehouseRepresentation {
  /** Depo kodu */
  shippingAddressLabel?: string;
  /** Kalemin teslimat modeli */
  shippingModel?: string;
}

export interface InvoiceItem {
  /** Fatura düzenlenme tarihi */
  arrangementDate?: string;
  /** Fatura içerik tipi (pdf/html); dolu ise tekrar sorgulanmaz */
  contentType?: string;
  /** Fatura linki */
  invoiceLink?: string;
  /** Sipariş numarası */
  orderNumber?: string;
  /** Fatura sıra numarası */
  rowNumber?: string;
  /** Faturanın seri numarası */
  serialNumber?: string;
}

/**
 * Paketlenecek Siparisin Hangi Kargo Firmasi Ile Degistirilebilecegini Listeleme
 *
 * `GET /delivery/changeablecargocompanies/merchantid/{merchantId}/orderlineid/{orderLineId}`
 */
export interface GetDeliveryChangeablecargocompaniesParams {
  /** Paketlenecek kalemin hangi satıcıya ait olduğunu belirten bilgidir */
  merchantId: string;
  /** Paketlenecek kalemin unique Id değeridir */
  orderLineId: string;
}

export type GetDeliveryChangeablecargocompaniesResponse = ChangeableCargoCompanyRepresentation[];

/**
 * Iptal Bilgisi Gonderme
 *
 * `POST /lineitems/merchantid/{merchantId}/id/{lineId}/cancelbymerchant`
 */
export interface PostLineitemsCancelbymerchantParams {
  /** Siparişin hangi satıcıya ait olduğunu belirten bilgidir */
  merchantId: string;
  /** İptal edilmek istenen, henüz paketlenmemiş kalemin unique Id değeridir */
  lineId: string;
}

export type PostLineitemsCancelbymerchantBody = CancelByMerchantRequest;

export type PostLineitemsCancelbymerchantResponse = string;

/**
 * Paketlenecek Siparisin Kargo Firmasini Degistirme
 *
 * `PUT /lineitems/merchantid/{merchantId}/orderlineid/{id}/cargocompany`
 */
export interface PutLineitemsCargocompanyParams {
  /** Paketlenecek kalemin hangi satıcıya ait olduğunu belirten bilgidir */
  merchantId: string;
  /** Paketlenecek kalemin unique Id değeridir */
  id: string;
}

export type PutLineitemsCargocompanyBody = ChangeLineCargoCompanyRequest;

export type PutLineitemsCargocompanyResponse = string;

/**
 * Siparis Kalemi Iscilik Maliyeti Guncelleme
 *
 * `PUT /lineitems/merchantid/{merchantId}/orderlineid/{id}/laborcost`
 */
export interface PutLineitemsLaborcostParams {
  /** Paketlenecek kalemin hangi satıcıya ait olduğunu belirten bilgidir */
  merchantId: string;
  /** İşçilik maliyeti güncelenecek kalemin unique Id değeridir */
  id: string;
}

export type PutLineitemsLaborcostBody = UpdateLaborCostRequest;

export type PutLineitemsLaborcostResponse = string;

/**
 * Ayni Pakete Konulabilecek Kalemleri Listeleme
 *
 * `GET /lineitems/merchantid/{merchantId}/packageablewith/lineitemid/{lineItemId}`
 */
export interface GetLineitemsPackageablewithParams {
  /** Kalemin hangi satıcıya ait olduğunu belirten bilgidir */
  merchantId: string;
  /** Kalemin unique Id değeridir */
  lineItemId: string;
}

export type GetLineitemsPackageablewithResponse = ExternalLineItemsRepresentation;

/**
 * Odemesi Tamamlanmis Siparisleri Listeleme
 *
 * `GET /orders/merchantid/{merchantId}`
 */
export interface GetOrdersQuery {
  /** Girilen tarihten itibaren eklenen kalemler esas alınır */
  begindate?: string;
  /** Girilen tarihten önce eklenmiş kalemler esas alınır */
  enddate?: string;
  /**
   * Başlangıçtan belirtilen değer kadar kaydı atlar. Offset: 20, limit: 10 girildiğinde, ilk 20 kaydı atlar ve 21. kayıttan başlayarak 10 kayıt listeler
   */
  offset?: string;
  /**
   * Girilen değer kadar kalem listelenir, ancak en fazla ve varsayılan olarak 100 adet gösterilir. Limit değeri girilmediğinde hata oluşacaktır.
   */
  limit?: string;
}

export interface GetOrdersParams {
  /** Satıcının unique Id değeridir */
  merchantId: string;
}

export type GetOrdersResponse = OpenLineItemsRepresentationWithPaging;

/**
 * Iptal Siparis Bilgileri Listeleme
 *
 * `GET /orders/merchantid/{merchantId}/cancelled`
 */
export interface GetOrdersCancelledQuery {
  /** Girilen tarihten itibaren iptal olmuş kalemler esas alınır */
  begindate?: string;
  /** Girilen tarihten önce iptal olmuş kalemler esas alınır */
  enddate?: string;
  /**
   * Başlangıçtan belirtilen değer kadar kaydı atlar. Offset: 20, limit: 10 girildiğinde, ilk 20 kaydı atlar ve 21. kayıttan başlayarak 10 kayıt listeler
   */
  offset?: string;
  /** Girilen değer kadar kalem listelenir, ancak en fazla ve varsayılan olarak 50 adet gösterilir */
  limit?: string;
}

export interface GetOrdersCancelledParams {
  /** Listelenmek istenen kalemlerin satıcısının unique Id değeridir */
  merchantId: string;
}

export type GetOrdersCancelledResponse = CancelledOrderLineItemsRepresentationWithPaging;

/**
 * Siparise Ait Detay Listeleme
 *
 * `GET /orders/merchantid/{merchantId}/ordernumber/{orderNumber}`
 */
export interface GetOrdersByOrdernumberParams {
  /** Satıcının unique Id değeridir */
  merchantId: string;
  /** Sipariş numarası */
  orderNumber: string;
}

export type GetOrdersByOrdernumberResponse = OrderRepresentation;

/**
 * Odemesi Beklenen Siparisleri Listeleme
 *
 * `GET /orders/merchantid/{merchantId}/paymentawaiting`
 */
export interface GetOrdersPaymentawaitingQuery {
  /** Girilen tarihten itibaren siparişin oluşturulma tarihi esas alınır */
  begindate?: string;
  /** Girilen tarihten önce oluşturulmuş sipariş esas alınır */
  enddate?: string;
  /**
   * Başlangıçtan belirtilen değer kadar kaydı atlar. Offset: 20, limit: 10 girildiğinde, ilk 20 kaydı atlar ve 21. kayıttan başlayarak 10 kayıt listeler
   */
  offset?: string;
  /**
   * Girilen değer kadar kalem listelenir, ancak en fazla ve varsayılan olarak 50 adet gösterilir. Limit değeri 1' den küçük olduğunda hata oluşacaktır
   */
  limit?: string;
}

export interface GetOrdersPaymentawaitingParams {
  /** Listelenmek istenen kalemlerin satıcısının unique Id değeridir */
  merchantId: string;
}

export type GetOrdersPaymentawaitingResponse = PaymentAwaitingOrderLinesItemsRepresentationWithPaging;

/**
 * Saticiya Ait Paket Bilgilerini Listeleme
 *
 * `GET /packages/merchantid/{merchantId}`
 */
export interface GetPackagesQuery {
  /** Girilen tarihten itibaren eklenen kalemler esas alınır */
  begindate?: string;
  /** Girilen tarihten önce eklenmiş paketler esas alınır */
  enddate?: string;
  /**
   * Bugünün tarihinden girilen değer kadar saat geri gidilerek, o zaman aralığındaki paketler listelenir. Örneğin, 12 değeri girildiğinde son 12 saat içindeki paketler getirilir
   */
  timespan?: string;
  /**
   * Girilen değer kadar paket listelenir, ancak en fazla ve varsayılan olarak 10 paket gösterilir. 1'den küçük bir değer girilirse hata alınır
   */
  limit?: string;
  /**
   * Başlangıçtan belirtilen değer kadar kaydı atlar. Offset: 20, limit: 10 girildiğinde, ilk 20 kaydı atlar ve 21. kayıttan başlayarak 10 kayıt listeler
   */
  Offset?: string;
}

export interface GetPackagesParams {
  /** Listelenmek istenen paketlerin satıcısının unique Id değeridir */
  merchantId: string;
}

export type GetPackagesResponse = ExternalRawPackageRepresentation[];

/**
 * Kalem veya Kalemleri Paketleme
 *
 * `POST /packages/merchantid/{merchantId}`
 */
export interface PostPackagesParams {
  /** Paketin satıcısının unique Id değeridir */
  merchantId: string;
}

export type PostPackagesBody = CreatePackageRequest;

export type PostPackagesResponse = CreateDeliveryResponse;

/**
 * Teslim Edilen Siparislerin Listelenmesi
 *
 * `GET /packages/merchantid/{merchantId}/delivered`
 */
export interface GetPackagesDeliveredQuery {
  /** Girilen tarihten itibaren teslim olmuş paketler esas alınır */
  begindate?: string;
  /** Girilen tarihten önce teslim olmuş paketler esas alınır */
  enddate?: string;
  /**
   * Başlangıçtan belirtilen değer kadar kaydı atlar. Offset: 20, limit: 10 girildiğinde, ilk 20 kaydı atlar ve 21. kayıttan başlayarak 10 kayıt listeler
   */
  offset?: string;
  /** Girilen değer kadar paket listelenir, ancak en fazla ve varsayılan olarak 50 adet gösterilir */
  limit?: string;
}

export interface GetPackagesDeliveredParams {
  /** Listelenmek istenen paketlerin satıcısının unique Id değeridir */
  merchantId: string;
}

export type GetPackagesDeliveredResponse = DeliveredDeliveriesRepresentationWithPaging;

/**
 * Faturası Yüklenmemiş Siparişlerin Listelenmesi
 *
 * `GET /packages/merchantid/{merchantId}/missing-invoice`
 */
export interface GetPackagesMissingInvoiceQuery {
  /** Başlangıçtan belirtilen değer kadar kaydı atlar */
  offset?: string;
  /** Girilen değer kadar paket listelenir, ancak en fazla ve varsayılan olarak 50 adet gösterilir */
  limit?: string;
}

export interface GetPackagesMissingInvoiceParams {
  /** Listelenmek istenen paketlerin satıcısının unique Id değeridir */
  merchantId: string;
}

export type GetPackagesMissingInvoiceResponse = MissingInvoicePackagesRepresentationWithPaging;

/**
 * Paketli Siparisin Hangi Kargo Firmasi Ile Degistirilebilecegini Listeleme
 *
 * `GET /packages/merchantid/{merchantId}/packagenumber/{packageNumber}/changablecargocompanies`
 */
export interface GetPackagesChangablecargocompaniesParams {
  /** Paket numarasıdır */
  packageNumber: string;
  /** Paketin hangi satıcıya ait olduğunu belirten bilgidir */
  merchantId: string;
}

export type GetPackagesChangablecargocompaniesResponse = ChangeableCargoCompanyRepresentation;

/**
 * Paketli Siparisin Kargo Firmasini Degistirme
 *
 * `PUT /packages/merchantid/{merchantId}/packagenumber/{packageNumber}/changecargocompany`
 */
export interface PutPackagesChangecargocompanyParams {
  /** Paketin hangi satıcıya ait olduğunu belirten bilgidir */
  merchantId: string;
  /** Paket numarasıdır */
  packageNumber: string;
}

export type PutPackagesChangecargocompanyBody = ChangeLineCargoCompanyRequest;

export type PutPackagesChangecargocompanyResponse = string;

/**
 * Fatura Linki Gonderme
 *
 * `PUT /packages/merchantid/{merchantId}/packagenumber/{packageNumber}/invoice`
 */
export interface PutPackagesInvoiceParams {
  /** Fatura eklenmek istenen paketin satıcısının unique Id değeridir */
  merchantId: string;
  /** Pakete ait fatura bilgileridir */
  packageNumber: string;
}

export type PutPackagesInvoiceBody = AddInvoiceOfPackageRequest;

export type PutPackagesInvoiceResponse = string;

/**
 * Paket Icin Kargo Bilgilerini Listeleme
 *
 * `GET /packages/merchantid/{merchantId}/packagenumber/{packagenumber}`
 */
export interface GetPackagesByPackagenumberParams {
  /** Listelenmek istenen paketin satıcısının unique Id değeridir */
  merchantId: string;
  /** Paket numarasıdır */
  packagenumber: string;
}

export type GetPackagesByPackagenumberResponse = ExternalTrackingInfoRepresentation;

/**
 * Teslimat Statusu Iletme (Teslim Edildi)
 *
 * `POST /packages/merchantid/{merchantId}/packagenumber/{packagenumber}/deliver`
 */
export interface PostPackagesDeliverParams {
  /** Satıcının unique Id değeridir */
  merchantId: string;
  /** Paket numarasıdır */
  packagenumber: string;
}

export type PostPackagesDeliverBody = ExternalDeliverRequest;

export type PostPackagesDeliverResponse = string;

/**
 * Teslimat Statusu Iletme(Kargoda)
 *
 * `POST /packages/merchantid/{merchantId}/packagenumber/{packagenumber}/intransit`
 */
export interface PostPackagesIntransitParams {
  /** Paketin satıcısının unique Id değeridir */
  merchantId: string;
  /** Paket numarasıdır */
  packagenumber: string;
}

export type PostPackagesIntransitBody = ExternalInfoRequest;

export type PostPackagesIntransitResponse = string;

/**
 * Ortak Barkod Olusturma
 *
 * `GET /packages/merchantid/{merchantId}/packagenumber/{packagenumber}/labels`
 */
export interface GetPackagesLabelsQuery {
  /** Etiket basmak için kullanılan format türüdür */
  format?: string;
}

export interface GetPackagesLabelsParams {
  /** Paketin hangi satıcıya ait olduğunu belirten bilgidir */
  merchantId: string;
  /** Paket numarasıdır */
  packagenumber: string;
}

export type GetPackagesLabelsResponse = BarcodeData;

/**
 * Gonderi Koli ve Desi Bilgisi Guncelleme
 *
 * `PUT /packages/merchantid/{merchantId}/packagenumber/{packagenumber}/parcel-info`
 */
export interface PutPackagesParcelInfoParams {
  /** Guncellenecek paket numarasi */
  packagenumber: string;
  /** Paketin hangi saticiya ait oldugunu belirten bilgidir */
  merchantId: string;
}

export type PutPackagesParcelInfoBody = UpdateDeliveryParcelInfoRequest;

export type PutPackagesParcelInfoResponse = string;

/**
 * Paket Bolme
 *
 * `POST /packages/merchantid/{merchantId}/packagenumber/{packagenumber}/split`
 */
export interface PostPackagesSplitParams {
  /** Paketin satıcısının unique Id değeridir */
  merchantId: string;
  /** Paket numarasıdır */
  packagenumber: string;
}

export type PostPackagesSplitBody = SplitPackageRequest;

export type PostPackagesSplitResponse = string;

/**
 * Teslimat Statusu Iletme(Teslim Edilemedi)
 *
 * `POST /packages/merchantid/{merchantId}/packagenumber/{packagenumber}/undeliver`
 */
export interface PostPackagesUndeliverParams {
  /** Paketin satıcısının unique Id değeridir */
  merchantId: string;
  /** Paket numarasıdır */
  packagenumber: string;
}

export type PostPackagesUndeliverBody = ExternalUnDeliverRequest;

export type PostPackagesUndeliverResponse = string;

/**
 * Paket Bozma
 *
 * `POST /packages/merchantid/{merchantId}/packagenumber/{packagenumber}/unpack`
 */
export interface PostPackagesUnpackParams {
  /** Satıcının unique Id değeridir */
  merchantId: string;
  /** Paket numarasıdır */
  packagenumber: string;
}

export type PostPackagesUnpackResponse = string;

/**
 * Paket Bilgilerinde Depo Bilgisi Güncelleme
 *
 * `PUT /packages/merchantid/{merchantId}/packagenumber/{packagenumber}/warehouse`
 */
export interface PutPackagesWarehouseParams {
  /** Paket numarasıdır */
  packagenumber: string;
  /** Paketin hangi satıcıya ait olduğunu belirten bilgidir */
  merchantId: string;
}

export type PutPackagesWarehouseBody = UpdateDeliveryWarehouseRequest;

export type PutPackagesWarehouseResponse = string;

/**
 * Kargoya Verilen Siparislerin Listelenmesi
 *
 * `GET /packages/merchantid/{merchantId}/shipped`
 */
export interface GetPackagesShippedQuery {
  /** Girilen tarihten itibaren kargoya teslim edilmiş paketler esas alınır */
  begindate?: string;
  /** Girilen tarihten önce kargoya teslim edilmiş paketler esas alınır */
  enddate?: string;
  /**
   * Başlangıçtan belirtilen değer kadar kaydı atlar. Offset: 20, limit: 10 girildiğinde, ilk 20 kaydı atlar ve 21. kayıttan başlayarak 10 kayıt listeler
   */
  offset?: string;
  /** Girilen değer kadar paket listelenir, ancak en fazla ve varsayılan olarak 50 adet gösterilir */
  limit?: string;
}

export interface GetPackagesShippedParams {
  /** Listelenmek istenen paketlerin satıcısının unique Id değeridir */
  merchantId: string;
}

export type GetPackagesShippedResponse = ShippedDeliveriesRepresentationWithPaging;

/**
 * Bozulan (Unpack) Paket Bilgilerini Listeleme
 *
 * `GET /packages/merchantid/{merchantId}/status/unpacked`
 */
export interface GetPackagesStatusUnpackedQuery {
  /**
   * Girilen değer kadar paket listelenir, ancak en fazla ve varsayılan olarak 10 paket gösterilir. 1'den küçük bir değer girilirse hata alınır
   */
  limit?: string;
  /**
   * Başlangıçtan belirtilen değer kadar kaydı atlar. Offset: 20, limit: 10 girildiğinde, ilk 20 kaydı atlar ve 21. kayıttan başlayarak 10 kayıt listeler
   */
  Offset?: string;
  /** Girilen tarihten itibaren Unpack olmuş paketler esas alınır */
  begindate?: string;
  /** Girilen tarihten önce Unpack olmuş paketler esas alınır */
  enddate?: string;
  /**
   * Bugünün tarihinden girilen değer kadar saat geri gidilerek, o zaman aralığındaki Unpack olmuş paketler listelenir. Örneğin, 12 değeri girildiğinde son 12 saat içindeki paketler getirilir
   */
  timespan?: string;
}

export interface GetPackagesStatusUnpackedParams {
  /** Listelenmek istenen paketlerin satıcısının unique Id değeridir */
  merchantId: string;
}

export type GetPackagesStatusUnpackedResponse = DeletedDeliveriesWithPagination[];

/**
 * Teslim Edilemedi Siparislerin Listelenmesi
 *
 * `GET /packages/merchantid/{merchantId}/undelivered`
 */
export interface GetPackagesUndeliveredQuery {
  /** Girilen tarihten itibaren teslim edilememiş paketler esas alınır */
  begindate?: string;
  /** Girilen tarihten önce teslim edilememiş paketler esas alınır */
  enddate?: string;
  /**
   * Başlangıçtan belirtilen değer kadar kaydı atlar. Offset: 20, limit: 10 girildiğinde, ilk 20 kaydı atlar ve 21. kayıttan başlayarak 10 kayıt listeler
   */
  offset?: string;
  /** Girilen değer kadar paket listelenir, ancak en fazla ve varsayılan olarak 50 adet gösterilir */
  limit?: string;
}

export interface GetPackagesUndeliveredParams {
  /** Listelenmek istenen paketlerin satıcısının unique Id değeridir */
  merchantId: string;
}

export type GetPackagesUndeliveredResponse = UndeliveredDeliveriesRepresentationWithPaging;
