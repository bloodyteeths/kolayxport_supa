/* eslint-disable */
/**
 * Katalog Ürün Entegrasyonu — generated from openapi/catalog.json. Do not edit.
 *
 * Source: katalog-urun-entegrasyonu v1.0, refreshed with `npm run specs:fetch`.
 * Corrections belong in openapi/overlays/, not here.
 */

import type { FileInput } from './fileInput';

export interface MerchantAndMerchantSkuListDTO {
  merchant: string;
  merchantSkuList: string[];
}

export interface ResponseObject {
  success?: boolean;
  code?: number;
  version?: number;
  message?: string;
  data?: Record<string, unknown>;
}

export interface FastListingRequestDTO {
  merchant: string;
  merchantSku: string;
  productName: string;
  barcode?: string;
  hbSku?: string;
  stock?: string;
  price?: string;
  itemOrderID?: number;
}

export interface MerchantAndMerchantSkuDTO {
  merchant: string;
  merchantSku: string;
}

export interface MerchantSkuStatusDTO {
  merchantSku?: string;
  status?: string;
}

export interface ProductStatusResponseDTO {
  merchant?: string;
  skuStatusList?: MerchantSkuStatusDTO[];
}

export interface ResponseListProductStatusResponseDTO {
  success?: boolean;
  code?: number;
  version?: number;
  message?: string;
  data?: ProductStatusResponseDTO[];
}

export interface AttributeDTO {
  name?: string;
  id?: string;
  mandatory?: boolean;
  type?: string;
  multiValue?: boolean;
}

export interface AttributeResponse {
  baseAttributes?: AttributeDTO[];
  attributes?: AttributeDTO[];
  variantAttributes?: AttributeDTO[];
}

export interface ResponseAttributeResponse {
  success?: boolean;
  code?: number;
  version?: number;
  message?: string;
  data?: AttributeResponse;
}

export interface Response {
  success?: boolean;
  code?: number;
  version?: number;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ImportMessageDTO {
  severity?: "INFORMATION" | "ERROR" | "WARNING";
  message?: string;
}

export interface ImportStatusDTO {
  itemOrderID?: number;
  merchant?: string;
  merchantSku?: string;
  hbSku?: string;
  barcode?: string;
  productStatus?: string;
  productName?: string;
  variantGroupId?: string;
  categoryId?: number;
  taskDetails?: TaskDetailDTO[];
  validationResults?: ProductValidationResultDTO[];
  rejectReasonsMessages?: string[];
  importStatus?: "SUCCESS" | "FAILED" | "PROCESSING";
  importMessages?: ImportMessageDTO[];
  matchedHbProductInfo?: MatchedProductInfoDTO[];
  videoStatus?: string;
  qualityScore?: number;
  qualityStatus?: string;
  ccValidationResults?: Record<string, Record<string, string[]>>;
}

export interface MatchedProductInfoDTO {
  hbSku?: string;
  productName?: string;
  brand?: string;
  images?: string[];
  variantTypeAttributes?: VariantClassificationDTO[];
}

export interface PageResponseImportStatusDTO {
  success?: boolean;
  code?: number;
  version?: number;
  message?: string;
  totalElements?: number;
  totalPages?: number;
  number?: number;
  numberOfElements?: number;
  first?: boolean;
  last?: boolean;
  data?: ImportStatusDTO[];
}

export interface ProductValidationResultDTO {
  attributeName?: string;
  message?: string;
}

export interface TaskCommentDTO {
  message?: string;
  user?: string;
}

export interface TaskDetailDTO {
  reason?: string;
  url?: string;
  commentList?: TaskCommentDTO[];
}

export interface VariantClassificationDTO {
  name?: string;
  value?: string;
}

export interface ImportProductInformationDTO {
  merchantSku?: string;
  barcode?: string;
  hbSku?: string;
  variantGroupId?: string;
  productName?: string;
  productStatus?: string;
  taskDetails?: TaskDetailDTO[];
  validationResults?: ProductValidationResultDTO[];
  matchedHbProductInfo?: MatchedProductInfoDTO[];
  rejectReasonsMessages?: string[];
  videoStatus?: string;
  qualityScore?: number;
  qualityStatus?: string;
  ccValidationResults?: Record<string, Record<string, string[]>>;
}

export interface PageResponseImportProductInformationDTO {
  success?: boolean;
  code?: number;
  version?: number;
  message?: string;
  totalElements?: number;
  totalPages?: number;
  number?: number;
  numberOfElements?: number;
  first?: boolean;
  last?: boolean;
  data?: ImportProductInformationDTO[];
}

export interface DeleteProcess {
  id?: string;
  createdBy?: string;
  modifiedBy?: string;
  trackingId?: string;
  deletedProductList?: DeletedProductReference[];
  completed?: boolean;
}

export interface DeletedProductReference {
  merchant?: string;
  merchantSku?: string;
  deleted?: boolean;
  errorMessage?: string;
}

export interface IntegratorProductInformation {
  merchantSku?: string;
  barcode?: string;
  hbSku?: string;
  variantGroupId?: string;
  productName?: string;
  brand?: string;
  images?: string[];
  categoryId?: number;
  categoryName?: string;
  tax?: string;
  price?: string;
  description?: string;
  status?: "WAITING" | "IN_EXTERNAL_PROGRESS" | "PRE_MATCHED" | "MATCHED" | "REJECTED" | "MATCHED_WITH_STAGED" | "MISSING_INFO" | "CREATED" | "BLOCKED";
  baseAttributes?: VariantAttributesDTO[];
  variantTypeAttributes?: VariantAttributesDTO[];
  productAttributes?: VariantAttributesDTO[];
  validationResults?: ProductValidationResultDTO[];
  rejectReasons?: string[];
  qualityScore?: number;
  qualityStatus?: string;
  ccValidationResults?: Record<string, Record<string, string[]>>;
}

export interface PageResponseIntegratorProductInformation {
  success?: boolean;
  code?: number;
  version?: number;
  message?: string;
  totalElements?: number;
  totalPages?: number;
  number?: number;
  numberOfElements?: number;
  first?: boolean;
  last?: boolean;
  data?: IntegratorProductInformation[];
}

export interface VariantAttributesDTO {
  name?: string;
  value?: string;
  mandatory?: boolean;
}

/**
 * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
 * Both fields present on every category returned by GET /api/categories/get-all-categories.
 */
export interface BaseCategoryDTO {
  categoryId?: number;
  name?: string;
  displayName?: string;
  parentCategoryId?: number;
  paths?: string[];
  leaf?: boolean;
  status?: string;
  type?: "HX" | "HB" | "HC";
  sortId?: string;
  merge?: boolean;
  /**
   * Whether the category currently accepts new products. Undocumented; also accepted as a query filter on this operation.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  available?: boolean;
  /**
   * Product-type names valid in this category. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  productTypes?: string[];
}

export interface PageResponseBaseCategoryDTO {
  success?: boolean;
  code?: number;
  version?: number;
  message?: string;
  totalElements?: number;
  totalPages?: number;
  number?: number;
  numberOfElements?: number;
  first?: boolean;
  last?: boolean;
  data?: BaseCategoryDTO[];
}

/**
 * Eşleşen Statü Red
 *
 * `POST /api/products/reject-prematch`
 * Published as "integratorRejectPreMatch".
 */
export type PostProductsRejectPrematchBody = MerchantAndMerchantSkuListDTO[];

export type PostProductsRejectPrematchResponse = void;

/**
 * Ürün Bilgisi Gönderme
 *
 * `POST /api/products/import`
 * Published as "uploadProductViaFile".
 */
export interface PostProductsImportQuery {
  version?: number;
}

export interface PostProductsImportBody {
  file: FileInput;
}

export type PostProductsImportResponse = ResponseObject;

/**
 * Hızlı Ürün Yükleme
 *
 * `POST /api/products/fastlisting`
 * Published as "uploadFastListingProduct".
 */
export type PostProductsFastlistingBody = FastListingRequestDTO[];

export type PostProductsFastlistingResponse = Record<string, unknown>;

/**
 * Aksiyon Bekleyen Ürün Silme
 *
 * `POST /api/products/delete-process`
 * Published as "deleteByMerchantAndMerchantSkuList".
 */
export type PostProductsDeleteProcessBody = MerchantAndMerchantSkuDTO[];

export type PostProductsDeleteProcessResponse = Record<string, unknown>;

/**
 * Ürüne Ait Statü Bilgisi Çekme
 *
 * `POST /api/products/check-product-status`
 * Published as "checkProductStatus".
 */
export interface PostProductsCheckProductStatusQuery {
  version?: number;
}

export type PostProductsCheckProductStatusBody = MerchantAndMerchantSkuListDTO[];

export type PostProductsCheckProductStatusResponse = ResponseListProductStatusResponseDTO;

/**
 * Eşleşen Statü Onay
 *
 * `POST /api/products/approve-prematch`
 * Published as "integratorApprovePreMatch".
 */
export type PostProductsApprovePrematchBody = MerchantAndMerchantSkuListDTO[];

export type PostProductsApprovePrematchResponse = void;

/**
 * Kategori Özelliklerini Alma
 *
 * `GET /api/categories/{categoryId}/attributes`
 * Published as "getAllAttributesByCategory".
 */
export interface GetCategoriesAttributesQuery {
  modifiedAtSince?: string;
  /** version */
  version?: number;
}

export interface GetCategoriesAttributesParams {
  categoryId: number;
}

export type GetCategoriesAttributesResponse = ResponseAttributeResponse;

/**
 * Özellik Değerini Alma
 *
 * `GET /api/categories/{categoryId}/attribute/{attributeId}/values`
 * Published as "getAllAttributeValuesByCategoryIdAndAttributeId".
 */
export interface GetCategoriesAttributeValuesQuery {
  modifiedAtSince?: string;
  /** version */
  version?: number;
  /** Datasını görmek istediğiniz sayfa numarası */
  page?: number;
  /** Her sayfada görmek istediğiniz data sayısı */
  size?: number;
}

export interface GetCategoriesAttributeValuesParams {
  categoryId: number;
  attributeId: string;
}

export type GetCategoriesAttributeValuesResponse = Record<string, unknown>;

/**
 * TrackingId Geçmişini Sorgulama
 *
 * `GET /api/products/trackingId-history`
 * Published as "getTrackingList".
 */
export interface GetProductsTrackingIdHistoryQuery {
  version?: number;
  /** Datasını görmek istediğiniz sayfa numarası */
  page?: number;
  /** Her sayfada görmek istediğiniz data sayısı */
  size?: number;
}

export type GetProductsTrackingIdHistoryResponse = Response;

/**
 * Ürün Durumu Sorgulama
 *
 * `GET /api/products/status/{trackingId}`
 * Published as "getProductStatusByTraceId".
 */
export interface GetProductsStatusQuery {
  version?: number;
  /** Datasını görmek istediğiniz sayfa numarası */
  page?: number;
  /** Her sayfada görmek istediğiniz data sayısı */
  size?: number;
}

export interface GetProductsStatusParams {
  trackingId: string;
}

export type GetProductsStatusResponse = PageResponseImportStatusDTO;

/**
 * Statü Bazlı Ürün Bilgisi Çekme
 *
 * `GET /api/products/products-by-merchant-and-status`
 * Published as "getProductByMerchantIdAndStatus".
 */
export interface GetProductsProductsByMerchantAndStatusQuery {
  merchantId: string;
  productStatus: "WAITING" | "IN_EXTERNAL_PROGRESS" | "PRE_MATCHED" | "MATCHED" | "REJECTED" | "MATCHED_WITH_STAGED" | "MISSING_INFO" | "CREATED" | "BLOCKED";
  taskStatus?: boolean;
  version?: number;
  /** Datasını görmek istediğiniz sayfa numarası */
  page?: number;
  /** Her sayfada görmek istediğiniz data sayısı */
  size?: number;
}

export type GetProductsProductsByMerchantAndStatusResponse = PageResponseImportProductInformationDTO;

/**
 * Aksiyon Bekleyen Ürün Silme İşlem Kontrolü
 *
 * `GET /api/products/delete-process/{trackingId}`
 * Published as "getDeleteProcess".
 */
export interface GetProductsDeleteProcessParams {
  trackingId: string;
}

export type GetProductsDeleteProcessResponse = DeleteProcess;

/**
 * Mağaza Bazlı Ürün Bilgisi Listeleme
 *
 * `GET /api/products/all-products-of-merchant/{merchantId}`
 * Published as "getAllProductsByMerchantId".
 */
export interface GetProductsAllProductsOfMerchantQuery {
  barcode?: string;
  merchantSku?: string;
  hbSku?: string;
  /** Datasını görmek istediğiniz sayfa numarası */
  page?: number;
  /** Her sayfada görmek istediğiniz data sayısı */
  size?: number;
}

export interface GetProductsAllProductsOfMerchantParams {
  merchantId: string;
}

export type GetProductsAllProductsOfMerchantResponse = PageResponseIntegratorProductInformation;

/**
 * Kategori Bilgilerini Alma
 *
 * `GET /api/categories/get-all-categories`
 * Published as "getAllCategoriesByParameters".
 */
export interface GetCategoriesGetAllCategoriesQuery {
  /** 'true' olarak gönderilmeli */
  leaf?: boolean;
  status?: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  available?: boolean;
  type?: "HX" | "HB" | "HC";
  /** version */
  version?: number;
  /** Datasını görmek istediğiniz sayfa numarası */
  page?: number;
  /** Her sayfada görmek istediğiniz data sayısı */
  size?: number;
}

export type GetCategoriesGetAllCategoriesResponse = PageResponseBaseCategoryDTO;
