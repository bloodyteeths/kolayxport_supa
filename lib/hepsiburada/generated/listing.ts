/* eslint-disable */
/**
 * Listeleme — generated from openapi/listing.json. Do not edit.
 *
 * Source: listeleme v1, refreshed with `npm run specs:fetch`.
 * Corrections belong in openapi/overlays/, not here.
 */

export interface AdditionalInfoUploadRepresentation {
  id?: string;
}

export interface AdditionalInfoUploadRequestModel {
  hepsiburadaSku?: string;
  merchantSku?: string;
  customizationTextType?: string;
  customizationTextLength?: number;
  hasInstallation?: boolean;
}

export interface AdditionalInfoUploadResultRepresentation {
  id?: string;
  status?: string;
  createdAt?: string;
  total?: number;
  errors?: Error[];
}

export interface BulkUnlockRequestModel {
  hbSkuList?: string[];
}

export interface CreateTokenRequestModel {
  appKey?: string;
  username?: string;
  hash?: string;
  additionalClaims?: string[];
}

export interface CustomizablePropertyRepresentation {
  displayName?: string;
  displayLength?: number;
  displayDescription?: string;
}

export interface DiscountDebtDistributionRepresentation {
  debtor?: string;
  amount?: number;
}

export interface Error {
  elementNo?: number;
  hepsiburadaSku?: string;
  merchantSku?: string;
  errors?: string[];
}

export interface ExternalListingsRepresentation {
  listings?: Listing[];
  totalCount?: number;
  limit?: number;
  offset?: number;
}

export interface InventoryUploadRequestModel {
  hepsiburadaSku?: string;
  merchantSku?: string;
  price?: number;
  fixedShippingPrice?: string;
  availableStock?: number;
  cargoCompany1?: string;
  cargoCompany2?: string;
  cargoCompany3?: string;
  shippingAddressLabel?: string;
  claimAddressLabel?: string;
  maximumPurchasableQuantity?: number;
  customizationTextType?: string;
  customizationTextLength?: number;
  btCargoCompany?: string;
  ytCargoCompany?: string;
  availableWarehouses?: string;
  shippingProfileName?: string;
  hasInstallation?: boolean;
}

export interface Listing {
  listingId?: string;
  uniqueIdentifier?: string;
  hepsiburadaSku?: string;
  merchantSku?: string;
  price?: number;
  availableStock?: number;
  dispatchTime?: number;
  cargoCompany1?: string;
  cargoCompany2?: string;
  cargoCompany3?: string;
  shippingAddressLabel?: string;
  shippingProfileName?: string;
  claimAddressLabel?: string;
  maximumPurchasableQuantity?: number;
  minimumPurchasableQuantity?: number;
  pricings?: ListingPricingRepresentation[];
  isSalable?: boolean;
  customizableProperties?: CustomizablePropertyRepresentation[];
  deactivationReasons?: string[];
  isSuspended?: boolean;
  isLocked?: boolean;
  lockReasons?: string[];
  isFrozen?: boolean;
  freezeReasons?: string[];
  availableWarehouses?: string[];
  isFulfilledByHB?: boolean;
  priceIncreaseDisabled?: boolean;
  priceDecreaseDisabled?: boolean;
  stockDecreaseDisabled?: boolean;
  skuAfterSuspension?: string;
  productId?: string;
  hasVariant?: boolean;
}

export interface ListingPricingRepresentation {
  finalPrice?: number;
  startDate?: string;
  endDate?: string;
  debtors?: DiscountDebtDistributionRepresentation[];
}

export interface MoneyRequestModel {
  currency?: string;
  amount?: number;
}

export interface PriceUploadRepresentation {
  id?: string;
}

export interface PriceUploadRequestModel {
  hepsiburadaSku?: string;
  merchantSku?: string;
  price?: number;
}

export interface PriceUploadResultRepresentation {
  id?: string;
  status?: string;
  createdAt?: string;
  total?: number;
  errors?: Error[];
  priceValidations?: PriceValidation[];
}

export interface PriceValidation {
  elementNo?: number;
  hepsiburadaSku?: string;
  merchantSku?: string;
  type?: string;
  minPrice?: number;
  maxPrice?: number;
  regulativePriceDetail?: RegulativePriceDetail;
  description?: string;
}

export interface RegulativePriceDetail {
  minAmount?: number;
  maxAmount?: number;
  categoryName?: string;
}

export interface ShippingInfoUploadRepresentation {
  id?: string;
}

export interface ShippingInfoUploadRequestModel {
  hepsiburadaSku?: string;
  merchantSku?: string;
  dispatchTime?: number;
  fixedShippingPrice?: number;
  claimAddressLabel?: string;
  shippingAddressLabel?: string;
  cargoCompany1?: string;
  cargoCompany2?: string;
  cargoCompany3?: string;
  btCargoCompany?: string;
  ytCargoCompany?: string;
  availableWarehouses?: string;
  shippingProfileName?: string;
}

export interface ShippingInfoUploadResultRepresentation {
  id?: string;
  status?: string;
  createdAt?: string;
  total?: number;
  errors?: Error[];
}

export interface StockUploadRepresentation {
  id?: string;
}

export interface StockUploadRequestModel {
  hepsiburadaSku?: string;
  merchantSku?: string;
  availableStock?: number;
  maximumPurchasableQuantity?: number;
}

export interface StockUploadResultRepresentation {
  id?: string;
  status?: string;
  createdAt?: string;
  total?: number;
  errors?: Error[];
}

export interface UpdateListingRequestBodyModel {
  newAvailableStock?: number;
  newPrice?: MoneyRequestModel;
  newDispatchTime?: number;
}

/**
 * Buybox Sıralama Sorgulama
 *
 * `GET /buybox-orders/merchantid/{merchantId}`
 * Published as "Buybox Sıralama Sorgulama".
 */
export interface GetBuyboxOrdersQuery {
  /** Buybox sıralaması sorgulanacak sku listesi */
  skuList?: string;
}

export interface GetBuyboxOrdersParams {
  /** Satıcının benzersiz kimliği */
  merchantId: string;
}

export type GetBuyboxOrdersResponse = void;

/**
 * Komisyon Bilgisi Sorgulama
 *
 * `GET /commissions/merchantid/{merchantId}`
 * Published as "Komisyon Bilgisi Sorgulama".
 */
export interface GetCommissionsQuery {
  /** Komisyon bilgisi sorgulanacak sku listesi */
  skuList?: string;
}

export interface GetCommissionsParams {
  /** Satıcının benzersiz kimliği */
  merchantId: string;
}

export type GetCommissionsResponse = void;

/**
 * Listing Bilgilerini Sorgulama
 *
 * `GET /listings/merchantid/{merchantId}`
 * Published as "Listing Bilgilerini Sorgulama".
 */
export interface GetListingsQuery {
  offset: number;
  limit: number;
  hbSkuList?: string;
  merchantSkuList?: string;
  "salable-listings"?: boolean;
  "notsalable-listings"?: boolean;
  updateStartDate?: string;
  updateEndDate?: string;
  productId?: string;
}

export interface GetListingsParams {
  merchantId: string;
}

export type GetListingsResponse = ExternalListingsRepresentation;

/**
 * Listing Envanter Güncelleme
 *
 * `POST /listings/merchantid/{merchantId}/inventory-uploads`
 * Published as "Listing Envanter Güncelleme".
 */
export interface PostListingsInventoryUploadsParams {
  merchantId: string;
}

export type PostListingsInventoryUploadsBody = InventoryUploadRequestModel[];

export type PostListingsInventoryUploadsResponse = void;

/**
 * Listing Envanter Güncelleme Sorgulama
 *
 * `GET /listings/merchantid/{merchantId}/inventory-uploads/id/{inventoryUploadId}`
 * Published as "Listing Envanter Güncelleme Sorgulama".
 */
export interface GetListingsInventoryUploadsParams {
  inventoryUploadId: string;
  merchantId: string;
}

export type GetListingsInventoryUploadsResponse = void;

/**
 * Listing Stok Güncelleme
 *
 * `POST /listings/merchantid/{merchantId}/stock-uploads`
 * Published as "Listing Stok Güncelleme".
 */
export interface PostListingsStockUploadsParams {
  merchantId: string;
}

export type PostListingsStockUploadsBody = StockUploadRequestModel[];

export type PostListingsStockUploadsResponse = StockUploadRepresentation;

/**
 * Listing Stok Güncelleme Sorgulama
 *
 * `GET /listings/merchantid/{merchantId}/stock-uploads/id/{id}`
 * Published as "Listing Stok Güncelleme Sorgulama".
 */
export interface GetListingsStockUploadsParams {
  merchantId: string;
  id: string;
}

export type GetListingsStockUploadsResponse = StockUploadResultRepresentation;

/**
 * Listing Fiyat Güncelleme
 *
 * `POST /listings/merchantid/{merchantId}/price-uploads`
 * Published as "Listing Fiyat Güncelleme".
 */
export interface PostListingsPriceUploadsParams {
  merchantId: string;
}

export type PostListingsPriceUploadsBody = PriceUploadRequestModel[];

export type PostListingsPriceUploadsResponse = PriceUploadRepresentation;

/**
 * Listing Fiyat Güncelleme Sorgulama
 *
 * `GET /listings/merchantid/{merchantId}/price-uploads/id/{id}`
 * Published as "Listing Fiyat Güncelleme Sorgulama".
 */
export interface GetListingsPriceUploadsParams {
  merchantId: string;
  id: string;
}

export type GetListingsPriceUploadsResponse = PriceUploadResultRepresentation;

/**
 * Listing Teslimat Güncelleme
 *
 * `POST /listings/merchantid/{merchantId}/shipping-info-uploads`
 * Published as "Listing Teslimat Güncelleme".
 */
export interface PostListingsShippingInfoUploadsParams {
  merchantId: string;
}

export type PostListingsShippingInfoUploadsBody = ShippingInfoUploadRequestModel[];

export type PostListingsShippingInfoUploadsResponse = ShippingInfoUploadRepresentation;

/**
 * Listing Teslimat Güncelleme Sorgulama
 *
 * `GET /listings/merchantid/{merchantId}/shipping-info-uploads/id/{id}`
 * Published as "Listing Teslimat Güncelleme Sorgulama".
 */
export interface GetListingsShippingInfoUploadsParams {
  merchantId: string;
  id: string;
}

export type GetListingsShippingInfoUploadsResponse = ShippingInfoUploadResultRepresentation;

/**
 * Listing Ek Bilgiler Güncelleme
 *
 * `POST /listings/merchantid/{merchantId}/additional-info-uploads`
 * Published as "Listing Ek Bilgiler Güncelleme".
 */
export interface PostListingsAdditionalInfoUploadsParams {
  merchantId: string;
}

export type PostListingsAdditionalInfoUploadsBody = AdditionalInfoUploadRequestModel[];

export type PostListingsAdditionalInfoUploadsResponse = AdditionalInfoUploadRepresentation;

/**
 * Listing Ek Bilgiler Güncelleme Sorgulama
 *
 * `GET /listings/merchantid/{merchantId}/additional-info-uploads/id/{id}`
 * Published as "Listing Ek Bilgiler Güncelleme Sorgulama".
 */
export interface GetListingsAdditionalInfoUploadsParams {
  merchantId: string;
  id: string;
}

export type GetListingsAdditionalInfoUploadsResponse = AdditionalInfoUploadResultRepresentation;

/**
 * Listing Activate
 *
 * `POST /listings/merchantid/{merchantId}/sku/{sku}/activate`
 * Published as "Listing Activate".
 */
export interface PostListingsActivateParams {
  merchantId: string;
  sku: string;
}

export type PostListingsActivateResponse = void;

/**
 * Listing Deactivate
 *
 * `POST /listings/merchantid/{merchantId}/sku/{sku}/deactivate`
 * Published as "Listing Deactivate".
 */
export interface PostListingsDeactivateParams {
  merchantId: string;
  sku: string;
}

export type PostListingsDeactivateResponse = void;

/**
 * Listing Tekil Fiyat/Stok Güncelleme
 *
 * `POST /listings/merchantid/{merchantId}/sku/{sku}/merchantsku/{merchantSku}`
 * Published as "Listing Tekil Fiyat/Stok Güncelleme".
 */
export interface PostListingsParams {
  merchantId: string;
  sku: string;
  merchantSku: string;
}

export type PostListingsBody = UpdateListingRequestBodyModel;

export type PostListingsResponse = void;

/**
 * Listing Silme
 *
 * `DELETE /listings/merchantid/{merchantId}/sku/{sku}/merchantsku/{merchantSku}`
 * Published as "Listing Silme".
 */
export interface DeleteListingsParams {
  merchantId: string;
  sku: string;
  merchantSku: string;
}

export type DeleteListingsResponse = void;

/**
 * Toplu Kilit Kaldırma
 *
 * `POST /listings/merchantid/{merchantId}/bulk-unlock`
 * Published as "Toplu Kilit Kaldırma".
 */
export interface PostListingsBulkUnlockParams {
  merchantId: string;
}

export type PostListingsBulkUnlockBody = BulkUnlockRequestModel;

export type PostListingsBulkUnlockResponse = void;
