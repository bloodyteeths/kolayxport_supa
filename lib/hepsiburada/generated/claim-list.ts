/* eslint-disable */
/**
 * Talep Listeleme — generated from openapi/claim-list.json. Do not edit.
 *
 * Source: talep-listeleme v1.0, refreshed with `npm run specs:fetch`.
 * Corrections belong in openapi/overlays/, not here.
 */

/**
 * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
 * Eight undocumented properties, observed across the live claim feed.
 */
export interface Claim {
  claimDate?: string;
  claimType?: string;
  customerName?: string;
  explanation?: string;
  id?: string;
  merchantRejectionStatement?: string;
  number?: string;
  orderDate?: string;
  orderNumber?: string;
  priceAmount?: number;
  priceCurrency?: string;
  quantity?: number;
  refundAmount?: number;
  refundCurrency?: string;
  refundDate?: string;
  sku?: string;
  status?: string;
  totalPriceAmount?: number;
  finalizedWith?: string;
  IsRenewProductTransferAccepted?: boolean;
  awaitingPreApprovalExpireDate?: string;
  markedAwaitingPreApprovalDate?: string;
  preApprovalReason?: string;
  preApprovalConfirmedBy?: string;
  preApprovalConfirmedDate?: string;
  /**
   * The order line this claim was raised against. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  lineItemId?: string;
  /**
   * When the merchant's window to act on this claim closes. Null while no action is pending. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  AwaitingActionExpireDate?: string;
  /**
   * The merchant's own SKU for the claimed item. Undocumented, and distinct from the documented `sku`.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  MerchantSku?: string;
  /**
   * The customer's stated reason for the claim. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  Reason?: string;
  /**
   * Observed only as null, on every claim in the live feed, so its type is deliberately left unknown rather than guessed. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  RequestedProduct?: unknown;
  /**
   * Evidence the customer attached. Null when none was. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  Reports?: {
  ImageUrl?: string;
  ReportedBy?: string;
}[];
  /**
   * Return-shipment legs for this claim, absent on claims that have none. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  Deliveries?: {
  DeliveryCode?: string;
  Status?: string;
  Direction?: string;
  CreatedDate?: string;
  PackageNumber?: string;
  TrackingNumber?: string;
  CargoCompany?: {
  TypeCode?: string;
  Alias?: string;
  Name?: string;
};
}[];
  /**
   * Observed only as an empty array, so the element type is inferred rather than seen. Undocumented.
   * @remarks Taken from a live response on 2026-08-25, which the published document contradicts. See openapi/overlays/.
   */
  tags?: string[];
}

export interface Money {
  amount?: number;
  currency?: string;
}

export interface PackageLine {
  cargoPaymentInfo?: string;
  commission?: Money;
  customerDelivery?: string;
  customizedText01?: string;
  customizedText02?: string;
  customizedText03?: string;
  customizedText04?: string;
  deliveryType?: string;
  gtip?: string;
  hbSku?: string;
  lineItemId?: string;
  listingId?: string;
  merchantId?: string;
  merchantSku?: string;
  merchantTotalPrice?: Money;
  merchantUnitPrice?: Money;
  orderDate?: string;
  orderNumber?: string;
  pickupTime?: string;
  price?: Money;
  productName?: string;
  properties?: Property[];
  quantity?: number;
  totalHBDiscount?: Money;
  totalPrice?: Money;
  unitHBDiscount?: Money;
  vat?: number;
  weight?: number;
}

export interface Property {
  displayName?: string;
  name?: string;
  value?: string;
}

export interface RejectClaimRequest {
  ClaimRejectionReason?: string;
  MerchantStatement?: string;
  Reports?: string[];
  UploadedReportsUrls?: string[];
}

export interface AcceptClaimRequest {
  FinalizedWith?: string;
  InvoiceLink?: string;
  AcceptionReason?: string;
}

export interface PreApprovalConfirmRequest {
  preApprovalReason?: "ProductInvestigation";
}

/**
 * Merchant için bütün talepleri getirir
 *
 * `GET /claims/merchantId/{merchantId}`
 */
export interface GetClaimsQuery {
  /** Begin Claim Created Date(yyyy-MM-dd HH:mm) */
  beginDate?: string;
  /** End Claim Created Date(yyyy-MM-dd HH:mm) */
  endDate?: string;
  /** Offset */
  offset?: number;
  /** Limit */
  limit?: number;
}

export interface GetClaimsParams {
  /** Merchant Id */
  merchantId: string;
}

export type GetClaimsResponse = Claim[];

/**
 * Merchant için belirtilen statüde ki talepleri getirir
 *
 * `GET /claims/merchantId/{merchantId}/status/{status}`
 */
export interface GetClaimsByStatusQuery {
  /** Offset */
  offset?: number;
  /** Limit */
  limit?: number;
  /** Begin Claim Created Date(yyyy-MM-dd HH:mm) */
  beginDate?: string;
  /** End Claim Created Date(yyyy-MM-dd HH:mm) */
  endDate?: string;
  /** Begin Claim Status Date(yyyy-MM-dd HH:mm) */
  statusBeginDate?: string;
  /** End Claim Status Date(yyyy-MM-dd HH:mm) */
  statusEndDate?: string;
}

export interface GetClaimsByStatusParams {
  /** Merchant Id */
  merchantId: string;
  /** Status */
  status: "NewRequest" | "Accepted" | "AwaitingAction" | "InDispute" | "Rejected" | "Refunded" | "Cancelled" | "AwaitingPreApproval";
}

export type GetClaimsByStatusResponse = Claim[];

/**
 * İletilen Talebin Onaylanmasını Sağlar.
 *
 * `POST /claims/number/{claimNumber}/accept`
 */
export interface PostClaimsAcceptParams {
  /** Claim Number */
  claimNumber: string;
}

export type PostClaimsAcceptBody = AcceptClaimRequest;

export type PostClaimsAcceptResponse = string;

/**
 * PreApproval talebi onayla
 *
 * `POST /claims/number/{claimNumber}/preapprovalconfirm`
 */
export interface PostClaimsPreapprovalconfirmParams {
  /** Claim Number */
  claimNumber: string;
}

export type PostClaimsPreapprovalconfirmBody = PreApprovalConfirmRequest;

export type PostClaimsPreapprovalconfirmResponse = string;

/**
 * İletilen Talebin Reddedilmesini Sağlar.
 *
 * `POST /claims/number/{claimNumber}/reject`
 */
export interface PostClaimsRejectParams {
  /** Claim Number */
  claimNumber: string;
}

export type PostClaimsRejectBody = RejectClaimRequest;

export type PostClaimsRejectResponse = string;
