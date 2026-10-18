/**
 * Orders surface data contract (orders.md §10, §13 "Frozen contracts"). Types only.
 *
 * Owner: M3 orders-G1. `OrderRow` is the only order shape the new Orders UI uses
 * (list, OrderPanel, CreateLabelPanel, BulkCreateLabelsPanel). It is built from the
 * `/api/orders` payload by `lib/orders/toOrderRows.ts`. `raw` keeps the API order for
 * the carrier adapters until A6 moves the mapping server-side.
 */
import type { OrderRowStatus } from '@/lib/ds/status/orders';
import type { CanonicalStore } from '@/lib/marketplaces/canonical';

/* ------------------------------------------------------------------ views + query */

/** Built-in saved views (orders §1.3). */
export type OrderViewKey = 'to_ship' | 'overdue' | 'label_created' | 'shipped' | 'problems' | 'all';

/** Views whose count `/api/orders?include=counts` returns. */
export type CountedOrderViewKey = 'to_ship' | 'overdue' | 'label_created' | 'problems';

/** `counts` of `/api/orders?include=counts` (A1). Each count ignores page, search, store, status and dates. */
export type ViewCounts = Record<CountedOrderViewKey, number>;

/** "Search in" (orders §1.2 `in`; = the API's `searchType`). */
export type OrderSearchIn = 'all' | 'customer' | 'order' | 'tracking' | 'product' | 'sku' | 'city' | 'phone' | 'note';

/** Normalized status filter keys (DS §3.9 order domain + `label_failed`). The server maps them to raw values (A1). */
export type OrderStatusFilterKey =
  | 'to_ship'
  | 'overdue'
  | 'label_created'
  | 'shipped'
  | 'delivered'
  | 'on_hold'
  | 'problem'
  | 'cancelled'
  | 'refunded'
  | 'label_failed';

/** Column sort keys (orders §4.1). */
export type OrderSortKey = 'orderedAt' | 'shipBy' | 'total' | 'customer' | 'store';
export type SortDir = 'asc' | 'desc';

/** Date presets of the "Order date" `DateRangeField`. `any` = no date bound (overrides the view default). */
export type OrderDatePreset = 'any' | 'today' | 'last7' | 'last30' | 'last90' | 'thisMonth' | 'lastMonth';

export type OrderPageSize = 50 | 100 | 250;

/**
 * The URL state of the Orders page (orders §1.2), as `useOrdersList` takes it.
 * Absent keys use the view defaults (`ORDER_VIEWS[view]` in `lib/orders/views.ts`).
 */
export interface OrdersQuery {
  view: OrderViewKey;
  q?: string;
  in?: OrderSearchIn;
  /** DB `Order.marketplace` values (repeated). */
  store?: string[];
  status?: OrderStatusFilterKey[];
  /** ISO day `YYYY-MM-DD` (local). */
  from?: string;
  to?: string;
  /** Overrides `from`/`to` when set (resolved in local time by `resolveDatePreset`). */
  preset?: OrderDatePreset;
  sort?: OrderSortKey;
  dir?: SortDir;
  /** 1-based. */
  page?: number;
  size?: number;
}

/* ------------------------------------------------------------------ API payload */

/** A Shipment row as `/api/orders` returns it (SELECT * from "Shipment"). */
export interface ApiShipment {
  id: string;
  orderId?: string;
  carrier?: string | null;
  status: string;
  trackingNumber?: string | null;
  pdfUrl?: string | null;
  errorMessage?: string | null;
  serviceType?: string | null;
  createdAt?: string | null;
  voidedAt?: string | null;
  [key: string]: unknown;
}

/** One LabelJob as flattened on `line_items[].labelJobs` (A2 adds `createdAt`, `errorMessage`). */
export interface ApiLabelJob {
  status: string;
  trackingNumber?: string | null;
  carrier?: string | null;
  pdfUrl?: string | null;
  createdAt?: string | null;
  errorMessage?: string | null;
}

export interface ApiTrackingSubmission {
  id?: string;
  trackingNumber: string;
  carrierId?: number | null;
  carrierName?: string | null;
  status?: string | null;
  errorMessage?: string | null;
  submittedAt?: string | null;
  etsySubmittedAt?: string | null;
  etsySubmitStatus?: string | null;
  etsySubmitError?: string | null;
  closedReason?: string | null;
  [key: string]: unknown;
}

export interface ApiLineItem {
  id: string;
  title?: string;
  productName?: string;
  value?: number;
  unitPrice?: number;
  quantity?: number;
  weight?: number;
  hs_code?: string;
  country_of_origin?: string;
  sku?: string;
  image?: string;
  etsyListingUrl?: string;
  variantInfo?: string;
  labelJobStatus?: string;
  trackingNumber?: string;
  shipBy?: string | null;
  labelJobs?: ApiLabelJob[];
  /** Veeqo line items carry their product here (rawData fallback only). */
  sellable?: {
    id?: unknown;
    full_title?: string;
    price?: number;
    sku_code?: string;
    image_url?: string;
    weight?: number;
    product?: { id?: number; title?: string; main_image_src?: string; hs_tariff_number?: string; origin_country?: string };
  };
  [key: string]: unknown;
}

/**
 * One order of the `/api/orders` response (`orders[]`): the "Order" row (`o.*`) plus the
 * flattened fields the API adds (index.ts processedOrders). Called `LocalUIOrder` in the legacy page.
 */
export interface ApiOrder {
  id: string;
  marketplace: string;
  marketplaceKey?: string;
  orderNumber: string;
  marketplaceOrderId?: string;
  status?: string | null;
  currency?: string | null;
  totalPrice?: number | string | null;
  orderTotalPrice?: number | string | null;
  customerName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  uiOrderDate?: string | null;
  marketplaceOrderDate?: string | null;
  shippingAddress?: unknown;
  rawData?: unknown;
  source?: string | null;
  channel?: string | null;
  labelStatus?: string | null;
  trackingNumber?: string | null;
  shippingLabelUrl?: string | null;
  shippedAt?: string | null;
  shipByAt?: string | null;
  shipByDate?: string | null;
  shippingUpgrade?: string | null;
  giftMessage?: string | null;
  customerNote?: string | null;
  manualShippingCost?: number | string | null;
  manualShippingCostCurrency?: string | null;
  weightKg?: number | null;
  harmonizedCode?: string | null;
  countryOfMfg?: string | null;
  commodityDesc?: string | null;
  isFBA?: boolean;
  isMCF?: boolean;
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientStreet1?: string;
  recipientStreet2?: string;
  recipientCity?: string;
  recipientState?: string;
  recipientPostal?: string;
  recipientCountry?: string;
  recipientPhone?: string;
  line_items?: ApiLineItem[];
  shipments?: ApiShipment[];
  trackingSubmissions?: ApiTrackingSubmission[];
  senkronData?: { internalNote?: string | null; customStatus?: string | null };
  [key: string]: unknown;
}

/** Legacy name (orders §10: `raw: LocalUIOrder`). */
export type LocalUIOrder = ApiOrder;

/** `GET /api/orders` response (A1–A4 fields optional: absent on the legacy call shape). */
export interface OrdersApiResponse {
  orders: ApiOrder[];
  total: number;
  page: number;
  pageSize: number;
  /** A1, with `include=counts`. */
  counts?: ViewCounts;
  /** A4: newest of `User.lastSyncedAt` and the last completed order SyncOperation (ISO), or null when the account never pulled. Present on new-UI calls (`view`, `ids` or `include`). */
  lastPulledAt?: string | null;
  /** The user's Etsy shop names (for `canonicalStore`). Present on new-UI calls. */
  etsyShopNames?: string[];
}

/* ------------------------------------------------------------------ Etsy extension enrichment */

/** One `/api/etsy-addresses` lookup entry (filled by the Chrome extension). */
export interface EtsyAddressEnrichment {
  orderNumber: string;
  etsyStoreName?: string | null;
  shippingAddress?: {
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    country_iso?: string;
    countryCode?: string;
    email?: string;
    phone?: string;
    [key: string]: unknown;
  } | null;
  notes?: string | null;
  shipByDate?: string | null;
  orderDate?: string | null;
}

/** `/api/listing-urls` response (moved from `toLabelRows`). */
export interface ListingUrlLookup {
  byProductId?: Record<string, string>;
  byTitle?: Record<string, string>;
  images?: Record<string, string>;
}

/** Client-side enrichment `toOrderRows` merges in (fetched by `fetchOrderEnrichment`). */
export interface OrderEnrichment {
  etsyAddresses?: Record<string, EtsyAddressEnrichment>;
  listingUrls?: ListingUrlLookup;
}

/* ------------------------------------------------------------------ OrderRow */

export interface OrderItemRow {
  id: string;
  title: string;
  /** Marketplace product page (Etsy active listing, Wix product page, Trendyol resolver, Veeqo → listing). */
  listingUrl: string | null;
  /** Variant text ("Pink / Large"), null when none. */
  variant: string | null;
  sku: string | null;
  quantity: number;
  /** Unit price in the order currency; null when unknown (never invented). */
  unitPrice: number | null;
  /** Product image URL; null → `Thumb` placeholder (never "/placeholder.png"). */
  image: string | null;
  personalization: string | null;
  weightKg: number | null;
  hsCode: string | null;
  /** ISO2 country of manufacture when known. */
  originCountry: string | null;
  /** Item ship-by (ISO). */
  shipBy: string | null;
}

/** Required ship-to fields. The name is not required: Amazon anonymizes it and the order is still shippable. */
export type ShipToField = 'street1' | 'city' | 'postal' | 'country';

export interface ShipTo {
  /** Full recipient name ("" when unknown or anonymized). */
  name: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  /** ISO2 when it could be resolved, else the raw value uppercased, "" when unknown. */
  country: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal: string;
  /** Turkish district (Trendyol `district`) — DHL eCommerce. */
  district: string;
  neighbourhood: string;
  /** Required fields that are empty (orders §4.2 rule 7). Postal is not required for countries without postal codes. */
  missing: ShipToField[];
  /** The marketplace withholds the address (Etsy API without extension data): `missing` lists everything. */
  unavailable: boolean;
  /** Amazon anonymized the buyer name ("Name hidden by Amazon"). */
  nameHidden: boolean;
  /** Filled from the Chrome extension's EtsyAddress record. */
  enrichedFromEtsy: boolean;
}

export type LabelSource = 'shipment' | 'labelJob' | 'order';

/** The newest active label of the order (`getLatestLabel`). Voided labels never appear here. */
export interface LatestLabel {
  source: LabelSource;
  /** Only for Shipment labels: the id for `DELETE /api/shipments/:id/delete` ("Delete label…" is shown only with it). */
  shipmentId: string | null;
  /** Raw carrier string ("FedEx", "UPS", "MNG"); pass to `LogoTile`/`logoDisplayName`. */
  carrier: string | null;
  trackingNumber: string | null;
  /** Stored label URL (http(s) or data: URI), null when only a tracking number exists. */
  labelHref: string | null;
  createdAt: string | null;
}

/** The most recent failed label attempt that was not followed by a label. */
export interface LabelFailure {
  carrier: string | null;
  /** Carrier message text (A2), null on old rows. */
  errorMessage: string | null;
  at: string | null;
}

/**
 * Tracking push result (orders §2.2 status caption):
 * `sent` "Tracking sent ✓" · `queued` "Queued for extension" (Etsy) · `pending` sent, waiting for the marketplace ·
 * `failed` "Couldn't send" (row moves to Problems).
 */
export type TrackingPushState = 'sent' | 'queued' | 'pending' | 'failed';

export interface TrackingSubmissionSummary {
  state: TrackingPushState;
  trackingNumber: string;
  carrierName: string | null;
  submittedAt: string | null;
  /** Etsy extension push time, when it happened. */
  deliveredAt: string | null;
  error: string | null;
}

export interface CarrierCost {
  amount: number;
  /** null = currency unknown (render the number with the "Currency unknown" tooltip). */
  currency: string | null;
}

export type OrderHistoryKind =
  | 'ordered'
  | 'imported'
  | 'label_created'
  | 'label_failed'
  | 'tracking_sent'
  | 'tracking_queued'
  | 'tracking_failed'
  | 'shipped';

/** One History timeline entry (orders §5), newest last. */
export interface OrderHistoryEvent {
  kind: OrderHistoryKind;
  at: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  detail?: string | null;
}

export interface OrderRow {
  /** `Order.id` (`?open=` value). */
  id: string;
  orderNumber: string;
  /** DB `Order.marketplace` (shop name for Etsy/Wix, "Manual" for manual orders). */
  marketplace: string;
  /** Canonical store (logo key, shop name). `store.marketplace === 'manual'` for manual orders. */
  store: CanonicalStore;
  /** Display name for the Store cell (shop name or marketplace name; "Manual" for manual orders → UI shows i18n "Manual order"). */
  storeName: string;
  isManual: boolean;

  /** Marketplace order date (ISO). */
  orderedAt: string | null;
  /** `Order.createdAt` = imported into KolayXport (ISO). */
  importedAt: string | null;
  /** Effective ship-by (ISO), null when no source has one (never guessed). */
  shipBy: string | null;
  shippedAt: string | null;
  /** Buyer-paid shipping upgrade ("Express"). */
  shippingUpgrade: string | null;

  /** Order total in `currency`; null when unknown. */
  total: number | null;
  /** ISO 4217, null when unknown (no "USD" default). */
  currency: string | null;

  /** Buyer display name ("" when hidden); see `shipTo.nameHidden`. */
  buyerName: string;
  items: OrderItemRow[];
  shipTo: ShipTo;
  giftMessage: string | null;
  buyerNote: string | null;
  /** Private KolayXport note (`SenkronOrderData.internalNote`). */
  note: string | null;

  /** One pill (orders §4.2). `status.raw` = raw marketplace status for the tooltip. */
  status: OrderRowStatus;
  rawStatus: string;

  label: LatestLabel | null;
  labelFailure: LabelFailure | null;
  /** Trendyol's / Hepsiburada's pre-assigned cargo number (not a label; shown under Label & tracking). */
  marketplaceCargoNumber: string | null;
  /** Hepsiburada orders: package state for the "Pack & print label" action (HB-contracted cargo). */
  hepsiburada?: { packageNumber: string | null; cargoCompany: string | null; canPack: boolean } | null;
  trackingSubmission: TrackingSubmissionSummary | null;
  carrierCost: CarrierCost | null;

  isFBA: boolean;
  isMCF: boolean;
  /** status ∈ {to_ship, overdue, label_failed} ∧ ¬FBA ∧ shipTo.missing empty (orders §10). */
  canLabel: boolean;
  /** "Open on {marketplace} ↗" target; null for manual / unknown marketplaces. */
  marketplaceUrl: string | null;
  history: OrderHistoryEvent[];

  /** The API order, for the carrier adapters until A6. */
  raw: LocalUIOrder;
}
