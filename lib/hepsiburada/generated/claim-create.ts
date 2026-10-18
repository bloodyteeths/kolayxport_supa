/* eslint-disable */
/**
 * Talep Oluşturma — generated from openapi/claim-create.json. Do not edit.
 *
 * Source: talep-olusturma v1.0, refreshed with `npm run specs:fetch`.
 * Corrections belong in openapi/overlays/, not here.
 */

export interface Claim {
  claimNumber?: string;
  explanation?: string;
  type?: string;
}

/** Parametreler */
export interface CreateClaim {
  /** Talep yapılacak sku */
  newSKU?: string;
  /** Talep açılacak sipariş */
  orderNumber?: string;
  /** Talep tipi */
  type?: "change" | "missingitem" | "missingpart" | "missinginvoice" | "extraproduct" | "return" | "renewproduct";
  /** Talep nedeni */
  reason?: "ProductIsBroken" | "ProductIsDamaged" | "WrongProductSentByMerchant";
}

export interface CreateClaimResponse {
  ClaimList?: Claim[];
}

/**
 * Yeni bir talep oluşturulmasını sağlar
 *
 * `POST /claims/merchant/{merchantid}/create`
 * Published as "createClaimUsingPOST".
 */
export interface PostClaimsMerchantCreateParams {
  /** merchantid */
  merchantid: string;
}

export type PostClaimsMerchantCreateBody = CreateClaim;

export type PostClaimsMerchantCreateResponse = CreateClaimResponse;
