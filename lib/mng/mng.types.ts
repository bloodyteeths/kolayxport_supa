// ---------------------------------------------------------------------------
// MNG Kargo (DHL eCommerce Turkey) — Type Definitions
// ---------------------------------------------------------------------------

export interface MngCredentials {
  customerNumber: string;
  password: string;
  appId?: string;
  appSecret?: string;
  environment: 'test' | 'production';
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface MngAuthRequest {
  customerNumber: string;
  password: string;
  identityType: number; // always 1
}

export interface MngAuthResponse {
  token: string;
  expireDate?: string;
}

// ─── Order Creation (Plus Command API) ───────────────────────────────────────

export interface MngRecipient {
  customerId?: string;
  refCustomerId?: string;
  name: string;
  taxOffice?: string;
  taxNumber?: string;
  city: string;        // il
  district: string;    // ilce
  neighbourhood?: string; // mahalle
  street?: string;     // sokak/cadde
  address: string;     // full address line
  postCode?: string;
  phone: string;
  email?: string;
}

export interface MngPackage {
  barcode?: string;
  weight: number;      // kg
  width?: number;      // cm
  height?: number;     // cm
  length?: number;     // cm
  desi?: number;       // volumetric weight
  content?: string;
}

export interface MngOrderRequest {
  referenceId: string;
  barcode?: string;
  billOfLandingId?: string;
  isCOD: boolean;
  codAmount?: number;
  shipmentServiceType: number; // 1=Standard, 2=Express, etc.
  packagingType: number;       // 1=Package, 2=Envelope, etc.
  content: string;
  smsPreference1: boolean;     // sender SMS
  smsPreference2: boolean;     // recipient SMS
  smsPreference3: boolean;     // delivery SMS
  paymentType: number;         // 1=Sender, 2=Recipient
  deliveryType: number;        // 1=Address, 2=Branch
  description?: string;
  marketPlaceShortCode?: string;
  marketPlaceSaleCode?: string;
  pudoId?: string;             // pick-up/drop-off point
  recipient: MngRecipient;
  parcels: MngPackage[];
}

export interface MngOrderResponse {
  orderInternalId?: number;
  referenceId?: string;
  barcode?: string;
  billOfLandingId?: string;
  message?: string;
  resultCode?: string;
  isSuccess?: boolean;
}

// ─── Barcode / Invoice (Barcode Command API) ────────────────────────────────

export interface MngInvoiceRequest {
  referenceId?: string;
  billOfLandingId?: string;
  barcode?: string;
}

export interface MngInvoiceResponse {
  barcode?: string;
  billOfLandingId?: string;
  trackingUrl?: string;
  labelUrl?: string;
  labelBase64?: string;
  isSuccess?: boolean;
  message?: string;
}

// ─── Tracking (Standard/Plus Query API) ──────────────────────────────────────

export interface MngTrackingEvent {
  date: string;
  status: string;
  description: string;
  location?: string;
}

export interface MngTrackingResponse {
  barcode?: string;
  billOfLandingId?: string;
  status?: string;
  deliveryDate?: string;
  recipientName?: string;
  events: MngTrackingEvent[];
  isSuccess?: boolean;
  message?: string;
}

// ─── Shipment Result (unified for our system) ───────────────────────────────

export interface MngShipmentResult {
  trackingNumber: string;
  barcode: string;
  labelUrl?: string;
  labelBase64?: string;
  billOfLandingId?: string;
}

// ─── CBS Info (geography) ────────────────────────────────────────────────────

export interface MngCity {
  code: string;
  name: string;
}

export interface MngDistrict {
  code: string;
  name: string;
  cityCode: string;
}
