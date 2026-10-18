/* eslint-disable */
/**
 * Ürün Güncelleme Entegrasyonu — generated from openapi/product-update.json. Do not edit.
 *
 * Source: urun-guncelleme-entegrasyonu v1.0, refreshed with `npm run specs:fetch`.
 * Corrections belong in openapi/overlays/, not here.
 */

import type { FileInput } from './fileInput';

export interface ErrorDTO {
  message?: string;
  description?: string;
  fieldErrors?: FieldErrorDTO[];
}

export interface FieldErrorDTO {
  objectName?: string;
  field?: string;
  message?: string;
}

export interface IntegratorImportStatusDto {
  merchantId?: string;
  items?: IntegratorImportStatusItemDto[];
}

export interface IntegratorImportStatusItemDto {
  hbSku?: string;
  message?: string;
  productStatus?: "COMPLETED" | "UNCOMPLETED";
  updateResults?: IntegratorUpdateResultsDto[];
}

export interface IntegratorUpdateResultAttributeDto {
  attributeId?: string;
  displayName?: string;
  rejectReason?: string;
  attributeType?: "MANDATORY" | "OPTIONAL" | "VARIANT_TYPE";
  fieldResult?: "APPROVED" | "REJECTED" | "IN_PROGRESS" | "PARTIAL_APPROVED";
}

export interface IntegratorUpdateResultsDto {
  fieldName?: "NAME" | "DESCRIPTION" | "KDV" | "BARCODE" | "IS_CUSTOMIZABLE" | "BRAND" | "DESI" | "WARRANTY_PERIOD" | "MEDIA" | "ATTRIBUTE";
  rejectReason?: string;
  fieldResult?: "APPROVED" | "REJECTED" | "IN_PROGRESS" | "PARTIAL_APPROVED";
  attributes?: IntegratorUpdateResultAttributeDto[];
}

export interface PageResponseIntegratorImportStatusDto {
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
  data?: IntegratorImportStatusDto[];
}

export interface ResponseObject {
  success?: boolean;
  code?: number;
  version?: number;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * Ürün Güncelleme Servisi
 *
 * `POST /api/integrator/import`
 * Published as "uploadTicketViaFile".
 */
export interface PostIntegratorImportQuery {
  version?: number;
}

export interface PostIntegratorImportBody {
  file: FileInput;
}

export type PostIntegratorImportResponse = void;

/**
 * Ürün Güncelleme Talep Durumu Sorgulama
 *
 * `GET /api/integrator/status/{trackingId}`
 * Published as "getTicketProductsStatusByTrackingId".
 */
export interface GetIntegratorStatusQuery {
  version?: number;
  /** Datasını görmek istediğiniz sayfa numarası */
  page?: number;
  /** Her sayfada görmek istediğiniz data sayısı */
  size?: number;
}

export interface GetIntegratorStatusParams {
  trackingId: string;
}

export type GetIntegratorStatusResponse = PageResponseIntegratorImportStatusDto;

/**
 * Ürün Güncelleme Geçmişi Sorgulama
 *
 * `GET /api/integrator/merchant/{merchantId}/hbSku/{hbSku}`
 * Published as "getMerchantProcessesByMerchantIdAndSku".
 */
export interface GetIntegratorMerchantParams {
  merchantId: string;
  hbSku: string;
}

export type GetIntegratorMerchantResponse = void;
