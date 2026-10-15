/**
 * Order views: the one place that defines "To ship" and "Overdue" (CRITIQUE C4,
 * shell-nav §9.1, orders.md §1.3 / §4.2 / A1).
 *
 * Owners: created by M2 shell-B (sidebar counter), extended by M3 orders-G1
 * (A1 views + counts in /api/orders), imported by M8 Overview. Do not copy
 * these clauses anywhere else; import them.
 *
 * Two forms of the same rules:
 * - SQL fragments over the alias `o` = "Order" (server only: raw SQL, no params,
 *   so they compose into any WHERE that binds o."userId" itself).
 * - Pure predicates over a loaded order row (`isToShipOrder`, `isOverdueOrder`,
 *   `effectiveShipBy`), for unit tests and for row mapping (orders G1
 *   `toOrderRows`). A change to one form must be made to the other.
 *   `test/api/nav-counts.test.ts` runs the fixture through the pure predicates
 *   only; it checks the SQL by its text (clauses present, guards, parentheses),
 *   it does NOT execute it. OPEN ITEM (M3 orders-G1): run TO_SHIP_COUNTS_SQL
 *   against a real Postgres over the same fixture and assert it equals
 *   `countToShip`. Known residual drift until then: a rawData date without an
 *   offset is read in the DB session timezone by SQL and by JS `Date` rules in
 *   the twin; NORMALIZED status case-folding is SQL LOWER vs JS lowercasing.
 *
 * OPEN ITEMS before the 'orders' UI flag is turned on (integrator, orders §1.3; G1 has no DB):
 *   (a) execute VIEW_COUNTS_SQL, VIEW_COUNTS_FINGERPRINT_SQL, every `viewWhereSql(view)` and every
 *       `statusKeyWhereSql(key)` inside a real `/api/orders` list query against Postgres (fixtures,
 *       or read-only on prod). These clauses sit in the main list WHERE, so a SQL error is a 500 for
 *       the whole list, not a missing count. Include a row whose shippingAddress is a jsonb string
 *       (JSON.stringify writers) and assert it is not counted as address-incomplete.
 *   (b) the To ship size check: run the four counts per account on prod; if any account has more
 *       than 500 To ship rows, set ORDER_VIEWS.to_ship.defaultPreset to a 90-day window.
 * Known residual address drift: the client reads the EtsyAddress fields, SQL treats the record as
 * complete; when sources disagree on the country, SQL accepts a postal-free country from any source,
 * the client only from the first one.
 *
 * Rules (orders.md §4.2, first match wins for the pill; here as a set):
 *   To ship = listed by /api/orders (unpaid states hidden, NULL status hidden)
 *           ∧ open status (not shipped / delivered / cancelled / refunded)
 *           ∧ no label (voided label = no label; Trendyol's pre-assigned
 *             rawData.cargoTrackingNumber is never read, so it never counts)
 *           ∧ not Amazon FBA/MCF.
 *   Overdue = To ship ∧ effective ship-by < now.
 *   Effective ship-by = MIN(OrderItem.shipBy), then Order.shipByAt (W4
 *   lifecycle column), then rawData.due_date, rawData.ship_by_date, then the
 *   earliest Etsy transactions[].expected_ship_date (index.ts L789–816).
 */
import { isClosedOrderStatus, orderStatus } from '@/lib/ds/status/orders';
import { normalizeRaw } from '@/lib/ds/status/vocabulary';
import type {
  CountedOrderViewKey,
  OrderDatePreset,
  OrderSortKey,
  OrderStatusFilterKey,
  OrderViewKey,
  SortDir,
} from './types';


/* ------------------------------------------------------------ constants */

/** Hidden from every order list (orders/index.ts:159). Compared with LOWER(status). */
export const UNPAID_ORDER_STATUSES = ['awaiting_payment', 'pending_payment'] as const;

/**
 * Normalized raw statuses that close an order (no shipping action left).
 * Same members as the closed sets of `lib/ds/status/orders.ts` (cancelled,
 * refunded, delivered, shipped); the test asserts each one maps to a closed key.
 */
export const CLOSED_ORDER_STATUSES = [
  // cancelled
  'cancelled', 'canceled', 'cancel', 'iptal', 'iptal_edildi', 'cancelled_by_seller', 'cancelled_by_buyer',
  // refunded
  'refunded', 'fully_refunded', 'returned', 'iade', 'iade_edildi',
  // delivered
  'delivered', 'completed', 'complete', 'teslim_edildi',
  // shipped
  'shipped', 'partially_shipped', 'kargolandi', 'kargoda', 'is_shipped', 'fulfilled', 'partially_fulfilled',
  'in_transit', 'at_collection_point',
] as const;

/** `Order.labelStatus` value that cancels every other label signal (void flow, shipments/[id]/void.ts). */
export const VOIDED_LABEL_STATUS = 'voided';

const sqlList = (values: readonly string[]) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');

/* ----------------------------------------------------------------- SQL */

/** Base clause of /api/orders: unpaid states and NULL status are not listed. */
export const LISTED_ORDER_SQL = `LOWER(o."status") NOT IN (${sqlList(UNPAID_ORDER_STATUSES)})`;

/**
 * SQL twin of `normalizeRaw()` (lib/ds/status/vocabulary.ts): trim, split
 * camelCase, whitespace/hyphen runs → '_', lowercase, fold Turkish letters.
 */
export const NORMALIZED_STATUS_SQL = String.raw`TRANSLATE(LOWER(REGEXP_REPLACE(REGEXP_REPLACE(BTRIM(o."status"), '([a-z0-9])([A-Z])', '\1_\2', 'g'), '[[:space:]-]+', '_', 'g')), 'ışğçöü', 'isgcou')`;

/** Not shipped, delivered, cancelled or refunded. NULL status → NULL (callers AND it with LISTED_ORDER_SQL). */
export const OPEN_STATUS_SQL = `${NORMALIZED_STATUS_SQL} NOT IN (${sqlList(CLOSED_ORDER_STATUSES)})`;

/**
 * Amazon FBA (and so MCF, which is a subset), both rawData shapes (index.ts L844–870):
 * direct sync rows[0]['fulfillment-channel'] AFN|AMAZON; Veeqo channel.name ~ FBA,
 * channel.with_fba, channel.type_code 'amazon_fba'. Never NULL.
 */
export const FBA_SQL = `COALESCE(LOWER(o."marketplace") = 'amazon' AND (
    UPPER(COALESCE(o."rawData"->'rows'->0->>'fulfillment-channel', '')) IN ('AFN', 'AMAZON')
    OR COALESCE(o."rawData"->'channel'->>'name', '') ILIKE '%fba%'
    OR COALESCE(o."rawData"->'channel'->>'with_fba', '') = 'true'
    OR COALESCE(o."rawData"->'channel'->>'type_code', '') = 'amazon_fba'
  ), false)`;

/**
 * A label exists (orders.md §4.2 rule 6): Order tracking number / label URL /
 * labelStatus 'created', a created Shipment with tracking or PDF, or a created
 * LabelJob. A voided order label (`labelStatus = 'voided'`) means no label even
 * if old tracking fields remain. Never NULL.
 */
export const HAS_LABEL_SQL = `(COALESCE(LOWER(o."labelStatus"), '') <> '${VOIDED_LABEL_STATUS}' AND (
    NULLIF(o."trackingNumber", '') IS NOT NULL
    OR NULLIF(o."shippingLabelUrl", '') IS NOT NULL
    OR COALESCE(o."labelStatus" = 'created', false)
    OR EXISTS (
      SELECT 1 FROM "Shipment" s
      WHERE s."orderId" = o.id AND s.status = 'created'
        AND (s."trackingNumber" IS NOT NULL OR s."pdfUrl" IS NOT NULL)
    )
    OR EXISTS (
      SELECT 1 FROM "OrderItem" li JOIN "LabelJob" lj ON lj."orderItemId" = li.id
      WHERE li."orderId" = o.id AND lj.status = 'created'
    )
  ))`;

/** No label (the `labelFilter=unlabeled` meaning, with the voided rule). */
export const UNLABELED_SQL = `NOT ${HAS_LABEL_SQL}`;

// Guarded casts: a malformed rawData value must never throw and 500 the count.
// The regex only admits values Postgres can cast: year 1000-9999, month lengths
// per month (Feb up to 29; 29 Feb in a non-leap year is rejected by the nested
// CASE below), hour 00-23, minute/second 00-59, offset within ±15:59. So
// '2026-02-30', '2026-01-01T99:00' or '+99:00' are skipped, not cast.
const ISO_DATE_RE = String.raw`^[1-9]\d{3}-((0[13578]|1[02])-(0[1-9]|[12]\d|3[01])|(0[469]|11)-(0[1-9]|[12]\d|30)|02-(0[1-9]|1\d|2\d))([T ]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?)?(Z|[+-](0\d|1[0-5])(:?[0-5]\d)?)?$`;
const rawDateSql = (key: string) => {
  const v = `(o."rawData"->>'${key}')`;
  // Nested CASE (not AND): the leap-year arithmetic must run only after the regex matched.
  return `(CASE WHEN ${v} ~ '${ISO_DATE_RE}' THEN (CASE WHEN substr(${v}, 6, 5) = '02-29' AND NOT (substr(${v}, 1, 4)::int % 4 = 0 AND (substr(${v}, 1, 4)::int % 100 <> 0 OR substr(${v}, 1, 4)::int % 400 = 0)) THEN NULL ELSE ${v}::timestamptz END) END)`;
};
/** Unix seconds, at most 11 integer digits (year ≤ 5138) so to_timestamp cannot overflow. */
const EPOCH_RE = String.raw`^[0-9]{1,11}(\.[0-9]+)?$`;

/** Effective ship-by as a timestamptz (NULL when no source has one). */
export const EFFECTIVE_SHIP_BY_SQL = `COALESCE(
    (SELECT MIN(si."shipBy") FROM "OrderItem" si WHERE si."orderId" = o.id),
    o."shipByAt",
    ${rawDateSql('due_date')},
    ${rawDateSql('ship_by_date')},
    (SELECT to_timestamp(MIN(CASE WHEN (tx->>'expected_ship_date') ~ '${EPOCH_RE}' THEN NULLIF((tx->>'expected_ship_date')::double precision, 0) END))
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o."rawData"->'transactions') = 'array' THEN o."rawData"->'transactions' ELSE '[]'::jsonb END) AS tx)
  )`;

/**
 * An order still "open" this long after it was placed was shipped or cancelled
 * outside KolayXport (the marketplace status never caught up). It is stale data,
 * not work to do, so it stays out of To ship / Overdue and the sidebar counter.
 */
export const STALE_OPEN_ORDER_DAYS = 90;
export const RECENT_ORDER_SQL = `(COALESCE(o."uiOrderDate", o."createdAt") >= NOW() - INTERVAL '${STALE_OPEN_ORDER_DAYS} days')`;

/** Orders the seller still has to ship and label. */
export const TO_SHIP_SQL = `(${LISTED_ORDER_SQL} AND ${OPEN_STATUS_SQL} AND ${UNLABELED_SQL} AND NOT ${FBA_SQL} AND ${RECENT_ORDER_SQL})`;

/** Ship-by passed. Combine with TO_SHIP_SQL (FBA never reaches here because To ship excludes it). */
export const OVERDUE_SQL = `(${EFFECTIVE_SHIP_BY_SQL}) < NOW()`;

/**
 * One query for the sidebar counter: `$1` = userId.
 * Returns one row `{ toShip: bigint|number|string, overdue: … }` (pg COUNT is bigint).
 */
export const TO_SHIP_COUNTS_SQL = `SELECT COUNT(*) AS "toShip", COUNT(*) FILTER (WHERE ${OVERDUE_SQL}) AS "overdue"
  FROM "Order" o
  WHERE o."userId" = $1 AND ${TO_SHIP_SQL}`;

/* ---------------------------------------------------- pure predicates */

/** The fields the predicates read (a subset of the Prisma Order + relations). */
export interface OrderViewRow {
  status: string | null | undefined;
  marketplace: string | null | undefined;
  labelStatus?: string | null;
  trackingNumber?: string | null;
  shippingLabelUrl?: string | null;
  shipByAt?: Date | string | null;
  /** When the order was placed (falls back to createdAt), for the stale-order rule. */
  uiOrderDate?: Date | string | null;
  createdAt?: Date | string | null;
  rawData?: unknown;
  items?: ReadonlyArray<{ shipBy?: Date | string | null; labelJobs?: ReadonlyArray<{ status?: string | null }> }>;
  shipments?: ReadonlyArray<{ status?: string | null; trackingNumber?: string | null; pdfUrl?: string | null }>;
}

function obj(v: unknown): Record<string, any> | null {
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return p && typeof p === 'object' ? p : null;
    } catch {
      return null;
    }
  }
  return v && typeof v === 'object' ? (v as Record<string, any>) : null;
}

function validDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string | number);
  return Number.isFinite(d.getTime()) ? d : null;
}

const ISO_DATE = new RegExp(ISO_DATE_RE);
/** Twin of the SQL nested CASE: 29 Feb outside a leap year (the regex already passed). */
function isInvalidLeapDay(v: string): boolean {
  if (v.slice(5, 10) !== '02-29') return false;
  const y = Number(v.slice(0, 4));
  return !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
}
const EPOCH = new RegExp(EPOCH_RE);

export function isListedOrder(row: Pick<OrderViewRow, 'status'>): boolean {
  if (row.status == null) return false;
  return !(UNPAID_ORDER_STATUSES as readonly string[]).includes(String(row.status).toLowerCase());
}

export function isOpenOrder(row: Pick<OrderViewRow, 'status' | 'marketplace'>): boolean {
  return !isClosedOrderStatus(orderStatus(row.status, row.marketplace));
}

export function isFbaOrder(row: Pick<OrderViewRow, 'marketplace' | 'rawData'>): boolean {
  if (String(row.marketplace ?? '').toLowerCase() !== 'amazon') return false;
  const rd = obj(row.rawData);
  if (!rd) return false;
  const fc = String(rd?.rows?.[0]?.['fulfillment-channel'] ?? '').toUpperCase();
  if (fc === 'AFN' || fc === 'AMAZON') return true;
  if (/fba/i.test(String(rd?.channel?.name ?? ''))) return true;
  if (String(rd?.channel?.with_fba ?? '') === 'true') return true;
  return rd?.channel?.type_code === 'amazon_fba';
}

export function orderHasLabel(row: OrderViewRow): boolean {
  if (String(row.labelStatus ?? '').toLowerCase() === VOIDED_LABEL_STATUS) return false;
  if (row.trackingNumber || row.shippingLabelUrl || row.labelStatus === 'created') return true;
  if ((row.shipments ?? []).some((s) => s.status === 'created' && (s.trackingNumber != null || s.pdfUrl != null))) return true;
  return (row.items ?? []).some((i) => (i.labelJobs ?? []).some((j) => j.status === 'created'));
}

/** Pure twin of EFFECTIVE_SHIP_BY_SQL. */
export function effectiveShipBy(row: OrderViewRow): Date | null {
  const itemDates = (row.items ?? []).map((i) => validDate(i.shipBy)).filter((d): d is Date => d !== null);
  if (itemDates.length > 0) return new Date(Math.min(...itemDates.map((d) => d.getTime())));
  const at = validDate(row.shipByAt);
  if (at) return at;
  const rd = obj(row.rawData);
  for (const key of ['due_date', 'ship_by_date']) {
    const v = rd?.[key];
    if (typeof v === 'string' && ISO_DATE.test(v) && !isInvalidLeapDay(v)) {
      const d = validDate(v);
      if (d) return d;
    }
  }
  if (Array.isArray(rd?.transactions)) {
    const stamps = rd.transactions
      .map((tx: any) => tx?.expected_ship_date)
      .filter((v: unknown) => v != null && EPOCH.test(String(v)))
      .map((v: unknown) => Number(v))
      .filter((n: number) => n > 0);
    if (stamps.length > 0) return new Date(Math.min(...stamps) * 1000);
  }
  return null;
}

/** Pure twin of RECENT_ORDER_SQL; an order with no known date counts as recent. */
export function isRecentOrder(row: OrderViewRow, now: Date = new Date()): boolean {
  const placed = validDate(row.uiOrderDate) ?? validDate(row.createdAt);
  return placed === null || placed.getTime() >= now.getTime() - STALE_OPEN_ORDER_DAYS * 86_400_000;
}

export function isToShipOrder(row: OrderViewRow, now: Date = new Date()): boolean {
  return isListedOrder(row) && isOpenOrder(row) && !orderHasLabel(row) && !isFbaOrder(row) && isRecentOrder(row, now);
}

export function isOverdueOrder(row: OrderViewRow, now: Date = new Date()): boolean {
  if (!isToShipOrder(row, now)) return false;
  const d = effectiveShipBy(row);
  return d !== null && d.getTime() < now.getTime();
}

/** `{ toShip, overdue }` over loaded rows; same numbers as TO_SHIP_COUNTS_SQL. */
export function countToShip(rows: readonly OrderViewRow[], now: Date = new Date()): { toShip: number; overdue: number } {
  let toShip = 0;
  let overdue = 0;
  for (const r of rows) {
    if (!isToShipOrder(r, now)) continue;
    toShip++;
    const d = effectiveShipBy(r);
    if (d && d.getTime() < now.getTime()) overdue++;
  }
  return { toShip, overdue };
}

/* =====================================================================
 * M3 orders-G1 extension (orders.md §1.3 views, A1 status keys + counts).
 * Everything above is the M2 shell-B definition and is not redefined here.
 * ===================================================================== */

/* ------------------------------------------------------- view registry */

export const ORDER_VIEW_KEYS: readonly OrderViewKey[] = ['to_ship', 'overdue', 'label_created', 'shipped', 'problems', 'all'];
export const COUNTED_VIEW_KEYS: readonly CountedOrderViewKey[] = ['to_ship', 'overdue', 'label_created', 'problems'];

export interface OrderViewDef {
  key: OrderViewKey;
  /** Date preset when the URL has no `from`/`to`/`preset` (orders §1.3 "Default dates"). */
  defaultPreset: OrderDatePreset;
  sort: OrderSortKey;
  dir: SortDir;
  /** Whether the view shows a count (`counts[key]`). */
  counted: boolean;
}

/** orders §1.3. "To ship" is undated: its status clause bounds it (G0 verification item, CRITIQUE X8). */
export const ORDER_VIEWS: Readonly<Record<OrderViewKey, OrderViewDef>> = {
  to_ship: { key: 'to_ship', defaultPreset: 'any', sort: 'shipBy', dir: 'asc', counted: true },
  overdue: { key: 'overdue', defaultPreset: 'any', sort: 'shipBy', dir: 'asc', counted: true },
  label_created: { key: 'label_created', defaultPreset: 'any', sort: 'orderedAt', dir: 'desc', counted: true },
  shipped: { key: 'shipped', defaultPreset: 'last30', sort: 'orderedAt', dir: 'desc', counted: false },
  problems: { key: 'problems', defaultPreset: 'any', sort: 'shipBy', dir: 'asc', counted: true },
  all: { key: 'all', defaultPreset: 'last30', sort: 'orderedAt', dir: 'desc', counted: false },
};

export const DEFAULT_ORDER_VIEW: OrderViewKey = 'to_ship';

export function isOrderViewKey(v: unknown): v is OrderViewKey {
  return typeof v === 'string' && (ORDER_VIEW_KEYS as readonly string[]).includes(v);
}

/* ------------------------------------------- normalized raw status lists */

/**
 * Normalized raw values per closed/explicit key. Same members as the sets in
 * `lib/ds/status/orders.ts` (test: each maps through `orderStatus()` to its key).
 * Their union is CLOSED_ORDER_STATUSES (cancelled/refunded/delivered/shipped).
 */
export const RAW_STATUSES_BY_KEY = {
  cancelled: ['cancelled', 'canceled', 'cancel', 'iptal', 'iptal_edildi', 'cancelled_by_seller', 'cancelled_by_buyer'],
  refunded: ['refunded', 'fully_refunded', 'returned', 'iade', 'iade_edildi'],
  delivered: ['delivered', 'completed', 'complete', 'teslim_edildi'],
  shipped: ['shipped', 'partially_shipped', 'kargolandi', 'kargoda', 'is_shipped', 'fulfilled', 'partially_fulfilled', 'in_transit', 'at_collection_point'],
  on_hold: ['on_hold', 'onhold', 'hold', 'held'],
  problem: ['undelivered', 'un_delivered', 'unfulfillable', 'unsupplied', 'un_supplied', 'problem'],
} as const;

export const ORDER_STATUS_FILTER_KEYS: readonly OrderStatusFilterKey[] = [
  'to_ship', 'overdue', 'label_created', 'shipped', 'delivered', 'on_hold', 'problem', 'cancelled', 'refunded', 'label_failed',
];

export function isOrderStatusFilterKey(v: unknown): v is OrderStatusFilterKey {
  return typeof v === 'string' && (ORDER_STATUS_FILTER_KEYS as readonly string[]).includes(v);
}

const rawIn = (key: keyof typeof RAW_STATUSES_BY_KEY) => `${NORMALIZED_STATUS_SQL} IN (${sqlList(RAW_STATUSES_BY_KEY[key])})`;

/* ------------------------------------------------------- more SQL rules */

/**
 * A label attempt failed and no label exists (orders §4.2 rule 4, §7.2). `Order.labelStatus =
 * 'failed'` or the newest LabelJob of the order failed. A failure followed by any active label
 * is history, not a failure. Never NULL.
 */
export const LABEL_FAILED_SQL = `(NOT ${HAS_LABEL_SQL} AND (
    COALESCE(LOWER(o."labelStatus") = 'failed', false)
    OR COALESCE((
      SELECT LOWER(lj.status) FROM "OrderItem" li JOIN "LabelJob" lj ON lj."orderItemId" = li.id
      WHERE li."orderId" = o.id ORDER BY lj."createdAt" DESC LIMIT 1
    ) = 'failed', false)
  ))`;

/** The newest tracking push failed (marketplace API or the Etsy extension). Never NULL. */
export const TRACKING_PUSH_FAILED_SQL = `COALESCE((
    SELECT (LOWER(COALESCE(ts.status, '')) = 'failed' OR LOWER(COALESCE(ts."etsySubmitStatus", '')) = 'failed')
    FROM "TrackingSubmission" ts WHERE ts."orderId" = o.id ORDER BY ts."submittedAt" DESC LIMIT 1
  ), false)`;

/**
 * Countries without postal codes: the postal code is not a required field there.
 * ISO2 codes plus the English names stores send instead of codes.
 */
export const NO_POSTAL_COUNTRIES = [
  'AE', 'AG', 'AO', 'AW', 'BS', 'BZ', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CF', 'KM', 'CG', 'CD', 'CK', 'CI', 'DJ', 'DM', 'GQ', 'ER',
  'FJ', 'TF', 'GM', 'GH', 'GD', 'GN', 'GY', 'HK', 'KI', 'KP', 'MO', 'MW', 'ML', 'MR', 'NR', 'NU', 'QA', 'RW', 'KN', 'LC', 'ST',
  'SC', 'SL', 'SB', 'SR', 'SY', 'TL', 'TG', 'TK', 'TO', 'TV', 'UG', 'VU', 'YE', 'ZW',
] as const;
/** English names stores send instead of the ISO2 code (toOrderRows COUNTRY_NAME_TO_ISO maps each to its code). */
export const NO_POSTAL_NAMES = ['UNITED ARAB EMIRATES', 'UAE', 'HONG KONG', 'QATAR', 'MACAU', 'MACAO', 'BAHAMAS', 'THE BAHAMAS', 'BELIZE', 'FIJI', 'GHANA'] as const;

/**
 * Regex (Postgres ARE and JS alike) that captures a top-level string value of `key` from the JSON
 * text of an address. Used for stringified `shippingAddress` values (below). Exported for the twin test.
 */
export const jsonStringFieldRe = (key: string) => String.raw`"${key}"[[:space:]]*:[[:space:]]*"((?:\\.|[^"\\])*)"`;

/**
 * `shippingAddress` is a Json column, but several writers store `JSON.stringify(address)` in it
 * (lib/orderSync.ts address merge, etsyLifecycle, the extension's /api/integrations/etsy/addresses),
 * which Postgres keeps as a jsonb STRING scalar; `->>` on a scalar is NULL. The client parses the
 * string (`parseJsonObject`). So in SQL: an object reads with `->>`, a string reads the field from its
 * JSON text with a regex. `substring … from` never throws on malformed text (a `::jsonb` cast would,
 * and 500 the whole list because the view clause sits in the main WHERE).
 */
const SA = `o."shippingAddress"`;
const saField = (key: string) =>
  `(CASE jsonb_typeof(${SA}) WHEN 'object' THEN ${SA}->>'${key}' WHEN 'string' THEN substring(${SA} #>> '{}' from '${jsonStringFieldRe(key)}') END)`;
const RD = `o."rawData"`;
const WIX = `${RD}->'shippingInfo'->'logistics'->'shippingDestination'->'address'`;
/** The API's flattening defaults a Trendyol shipmentAddress country to 'TR' (index.ts extractAddress); the client reads it as recipientCountry. */
const TRENDYOL_DEFAULT_COUNTRY = `(CASE WHEN (o."source" = 'trendyol' OR o."marketplace" = 'Trendyol')
    AND jsonb_typeof(${RD}->'shipmentAddress') = 'object'
    AND COALESCE(jsonb_typeof(${RD}->'to_address'), 'null') = 'null' THEN 'TR' END)`;
/** Address sources the client extraction reads (toOrderRows `extractShipTo`), in SQL. */
const ADDRESS_SOURCES: Record<'street1' | 'city' | 'postal' | 'country', string[]> = {
  street1: [
    saField('recipientStreet1'), saField('recipient_street1'), saField('address1'), saField('street1'),
    `${RD}->'deliver_to'->>'address1'`, `${RD}->'deliver_to'->>'street1'`, `${RD}->'billing_address'->>'address1'`,
    `${RD}->>'address1'`, `${RD}->>'street1'`, `${RD}->'to_address'->>'street1'`,
    `${WIX}->>'addressLine'`, `${WIX}->>'addressLine1'`, `${RD}->'shipmentAddress'->>'address1'`, `${RD}->'shipmentAddress'->>'address'`,
  ],
  city: [
    saField('recipientCity'), saField('recipient_city'), saField('city'),
    `${RD}->'deliver_to'->>'city'`, `${RD}->'billing_address'->>'city'`, `${RD}->>'city'`,
    `${RD}->'to_address'->>'city'`, `${WIX}->>'city'`, `${RD}->'shipmentAddress'->>'city'`,
  ],
  postal: [
    saField('recipientPostal'), saField('recipient_postal'), saField('postal'), saField('zip'), saField('postalCode'), saField('postcode'),
    `${RD}->'deliver_to'->>'zip'`, `${RD}->'deliver_to'->>'postalCode'`, `${RD}->'deliver_to'->>'postcode'`,
    `${RD}->'billing_address'->>'zip'`, `${RD}->'billing_address'->>'postalCode'`, `${RD}->'billing_address'->>'postcode'`,
    `${RD}->>'zip'`, `${RD}->>'postalCode'`, `${RD}->>'postcode'`,
    `${RD}->'to_address'->>'postal'`, `${RD}->'to_address'->>'zip'`, `${WIX}->>'postalCode'`,
    `${RD}->'shipmentAddress'->>'postalCode'`, `${RD}->'shipmentAddress'->>'zipCode'`,
  ],
  country: [
    saField('recipientCountry'), saField('recipient_country'), saField('country'),
    `${RD}->'deliver_to'->>'country'`, `${RD}->'billing_address'->>'country'`, `${RD}->>'country'`,
    `${RD}->'to_address'->>'country'`, `${WIX}->>'country'`, `${RD}->'shipmentAddress'->>'countryCode'`,
    TRENDYOL_DEFAULT_COUNTRY,
  ],
};
/** A usable value: non-blank, not the legacy '—' placeholder, not Amazon's "Anonymized" text. */
const usable = (expr: string) => `(NULLIF(BTRIM(${expr}), '') IS NOT NULL AND BTRIM(${expr}) <> '—' AND ${expr} NOT ILIKE '%anonymized%')`;
const anyUsable = (exprs: string[]) => `(${exprs.map(usable).join(' OR ')})`;
const countryNoPostal = `(${ADDRESS_SOURCES.country
  .map((e) => `UPPER(BTRIM(COALESCE(${e}, ''))) IN (${sqlList([...NO_POSTAL_COUNTRIES, ...NO_POSTAL_NAMES])})`)
  .join(' OR ')})`;

/**
 * Ship-to incomplete (orders §4.2 rule 7): street, city, country or (where countries use
 * them) postal code missing in every source, and the Chrome extension has not stored an
 * EtsyAddress for the order. SQL twin of `shipToMissing()` (toOrderRows); the client also
 * reads the EtsyAddress fields themselves, the SQL treats the record as complete. Never NULL.
 */
export const ADDRESS_INCOMPLETE_SQL = `(NOT EXISTS (
    SELECT 1 FROM "EtsyAddress" ea WHERE ea."userId" = o."userId" AND ea."orderNumber" = o."orderNumber"
  ) AND NOT (
    ${anyUsable(ADDRESS_SOURCES.street1)}
    AND ${anyUsable(ADDRESS_SOURCES.city)}
    AND ${anyUsable(ADDRESS_SOURCES.country)}
    AND (${anyUsable(ADDRESS_SOURCES.postal)} OR ${countryNoPostal})
  ))`;

/* ------------------------------------------------------- view clauses */

/** "Label created": has a label, still open, tracking push not failed (a failed push is a Problem). */
export const LABEL_CREATED_SQL = `(${LISTED_ORDER_SQL} AND ${OPEN_STATUS_SQL} AND ${HAS_LABEL_SQL} AND NOT ${TRACKING_PUSH_FAILED_SQL})`;

/** "Shipped": shipped, partially shipped, delivered or completed. */
export const SHIPPED_VIEW_SQL = `(${LISTED_ORDER_SQL} AND (${rawIn('shipped')} OR ${rawIn('delivered')}))`;

/** "Problems": open, not FBA, and label failed OR tracking push failed OR (To ship ∧ address incomplete). */
export const PROBLEMS_SQL = `(${LISTED_ORDER_SQL} AND ${OPEN_STATUS_SQL} AND NOT ${FBA_SQL} AND (
    ${LABEL_FAILED_SQL}
    OR ${TRACKING_PUSH_FAILED_SQL}
    OR (${TO_SHIP_SQL} AND ${ADDRESS_INCOMPLETE_SQL})
  ))`;

/** WHERE fragment (over alias `o`, no params) for a built-in view. `all` = what the API lists anyway. */
export function viewWhereSql(view: OrderViewKey): string {
  switch (view) {
    case 'to_ship':
      return TO_SHIP_SQL;
    case 'overdue':
      return `(${TO_SHIP_SQL} AND ${OVERDUE_SQL})`;
    case 'label_created':
      return LABEL_CREATED_SQL;
    case 'shipped':
      return SHIPPED_VIEW_SQL;
    case 'problems':
      return PROBLEMS_SQL;
    case 'all':
    default:
      return LISTED_ORDER_SQL;
  }
}

/**
 * Status filter key → WHERE fragment (A1). Each key means exactly what its StatusPill means: the
 * clauses follow `orderRowStatus()` (lib/ds/status/orders.ts, orders §4.2, first match wins), so a
 * row whose pill is `k` matches `statusKeyWhereSql(k)`. Pure twin: `matchesStatusKey`.
 *   1–3 terminal raw  → shipped / delivered / cancelled / refunded
 *   4   label failed  → label_failed
 *   5   FBA           → to_ship (never overdue, never label_created)
 *   6   has a label   → label_created (a failed tracking push keeps this pill; the Problems VIEW lists it)
 *   7   address       → problem
 *   8   raw on hold / problem
 *   9   ship-by passed → overdue, else to_ship
 * Views and status keys differ on purpose: the To ship VIEW is "needs a label" (includes rows whose
 * pill is problem / on hold / overdue), the to_ship KEY is the pill.
 */
const PILL_ACTIVE_SQL = `(${OPEN_STATUS_SQL} AND NOT ${LABEL_FAILED_SQL})`;
/** Rules 5–7 did not match: not FBA, no label, address complete. */
const PILL_PAST_ADDRESS_SQL = `(${PILL_ACTIVE_SQL} AND NOT ${FBA_SQL} AND ${UNLABELED_SQL} AND NOT ${ADDRESS_INCOMPLETE_SQL})`;
const PILL_UNHELD_SQL = `(${PILL_PAST_ADDRESS_SQL} AND NOT ${rawIn('on_hold')} AND NOT ${rawIn('problem')})`;
const OVERDUE_KNOWN_SQL = `COALESCE(${OVERDUE_SQL}, false)`;

export function statusKeyWhereSql(key: OrderStatusFilterKey): string {
  switch (key) {
    case 'to_ship':
      return `(${PILL_ACTIVE_SQL} AND (${FBA_SQL} OR (${PILL_UNHELD_SQL} AND NOT ${OVERDUE_KNOWN_SQL})))`;
    case 'overdue':
      return `(${PILL_UNHELD_SQL} AND ${OVERDUE_KNOWN_SQL})`;
    case 'label_created':
      return `(${PILL_ACTIVE_SQL} AND NOT ${FBA_SQL} AND ${HAS_LABEL_SQL})`;
    case 'label_failed':
      return `(${OPEN_STATUS_SQL} AND ${LABEL_FAILED_SQL})`;
    case 'problem':
      return `(${PILL_ACTIVE_SQL} AND NOT ${FBA_SQL} AND ${UNLABELED_SQL} AND (${ADDRESS_INCOMPLETE_SQL} OR ${rawIn('problem')}))`;
    case 'on_hold':
      return `(${PILL_PAST_ADDRESS_SQL} AND ${rawIn('on_hold')})`;
    default:
      // shipped / delivered / cancelled / refunded: rules 1–3 come first, the raw value decides.
      return rawIn(key);
  }
}

/** OR of the status keys (empty → null = no clause). */
export function statusKeysWhereSql(keys: readonly OrderStatusFilterKey[]): string | null {
  const uniq = Array.from(new Set(keys));
  if (uniq.length === 0) return null;
  return `(${uniq.map(statusKeyWhereSql).join(' OR ')})`;
}

/**
 * One query for all four view counts: `$1` = userId. Row `{ to_ship, overdue, label_created, problems }`
 * (pg COUNT is bigint). Ignores search, store, status and dates (counts belong to the view, orders §1.3).
 */
export const VIEW_COUNTS_SQL = `SELECT
    COUNT(*) FILTER (WHERE ${TO_SHIP_SQL}) AS "to_ship",
    COUNT(*) FILTER (WHERE ${TO_SHIP_SQL} AND ${OVERDUE_SQL}) AS "overdue",
    COUNT(*) FILTER (WHERE ${LABEL_CREATED_SQL}) AS "label_created",
    COUNT(*) FILTER (WHERE ${PROBLEMS_SQL}) AS "problems"
  FROM "Order" o
  WHERE o."userId" = $1 AND ${LISTED_ORDER_SQL}`;

/**
 * Cheap change marker for the view-counts cache (`$1` = userId): one row `{ fp: text }`. It changes
 * when an order is pulled, edited or deleted (Order count / updatedAt; index [userId, updatedAt, id]),
 * when a label is created or voided (Shipment / LabelJob updatedAt, which do not always touch the
 * Order), when tracking is pushed (TrackingSubmission submittedAt / etsySubmittedAt / closedAt) and
 * when the extension stores an address (EtsyAddress updatedAt).
 */
export const VIEW_COUNTS_FINGERPRINT_SQL = `SELECT CONCAT_WS('|',
    (SELECT COUNT(*) FROM "Order" WHERE "userId" = $1),
    (SELECT MAX("updatedAt") FROM "Order" WHERE "userId" = $1),
    (SELECT MAX(s."updatedAt") FROM "Shipment" s JOIN "Order" so ON so.id = s."orderId" WHERE so."userId" = $1),
    (SELECT MAX(lj."updatedAt") FROM "LabelJob" lj JOIN "OrderItem" li ON li.id = lj."orderItemId" JOIN "Order" lo ON lo.id = li."orderId" WHERE lo."userId" = $1),
    (SELECT MAX(GREATEST(ts."submittedAt", ts."etsySubmittedAt", ts."closedAt")) FROM "TrackingSubmission" ts JOIN "Order" tso ON tso.id = ts."orderId" WHERE tso."userId" = $1),
    (SELECT MAX("updatedAt") FROM "EtsyAddress" WHERE "userId" = $1)
  ) AS "fp"`;

/** Effective ship-by sort for the new UI: earliest first, unknown last. */
export function effectiveShipBySortSql(dir: SortDir): string {
  return `(${EFFECTIVE_SHIP_BY_SQL}) ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
}

/* ------------------------------------------------- pure twins (views) */

/** Extra fields the view predicates read beyond `OrderViewRow`. */
export interface OrderViewFacts extends OrderViewRow {
  items?: ReadonlyArray<{
    shipBy?: Date | string | null;
    labelJobs?: ReadonlyArray<{ status?: string | null; createdAt?: Date | string | null; updatedAt?: Date | string | null }>;
  }>;
  trackingSubmissions?: ReadonlyArray<{ status?: string | null; etsySubmitStatus?: string | null; submittedAt?: Date | string | null }>;
  /** `shipToMissing(...).length > 0` with no EtsyAddress record (toOrderRows). */
  addressIncomplete?: boolean;
}

const time = (v: Date | string | null | undefined) => {
  const d = validDate(v);
  return d ? d.getTime() : Number.NEGATIVE_INFINITY;
};

/** Twin of LABEL_FAILED_SQL. */
export function isLabelFailedOrder(row: OrderViewFacts): boolean {
  if (orderHasLabel(row)) return false;
  if (String(row.labelStatus ?? '').toLowerCase() === 'failed') return true;
  let latest: { status?: string | null; createdAt?: Date | string | null } | null = null;
  for (const item of row.items ?? []) {
    for (const j of item.labelJobs ?? []) {
      if (!latest || time(j.createdAt) > time(latest.createdAt)) latest = j;
    }
  }
  return String(latest?.status ?? '').toLowerCase() === 'failed';
}

/** Twin of TRACKING_PUSH_FAILED_SQL. */
export function isTrackingPushFailed(row: Pick<OrderViewFacts, 'trackingSubmissions'>): boolean {
  let latest: { status?: string | null; etsySubmitStatus?: string | null; submittedAt?: Date | string | null } | null = null;
  for (const s of row.trackingSubmissions ?? []) {
    if (!latest || time(s.submittedAt) > time(latest.submittedAt)) latest = s;
  }
  if (!latest) return false;
  return String(latest.status ?? '').toLowerCase() === 'failed' || String(latest.etsySubmitStatus ?? '').toLowerCase() === 'failed';
}

const inRaw = (key: keyof typeof RAW_STATUSES_BY_KEY, status: string | null | undefined) =>
  (RAW_STATUSES_BY_KEY[key] as readonly string[]).includes(normalizeRaw(status));

/** Twin of `viewWhereSql(view)`. */
export function matchesOrderView(row: OrderViewFacts, view: OrderViewKey, now: Date = new Date()): boolean {
  if (!isListedOrder(row)) return false;
  switch (view) {
    case 'to_ship':
      return isToShipOrder(row);
    case 'overdue':
      return isOverdueOrder(row, now);
    case 'label_created':
      return isOpenOrder(row) && orderHasLabel(row) && !isTrackingPushFailed(row);
    case 'shipped':
      return inRaw('shipped', row.status) || inRaw('delivered', row.status);
    case 'problems':
      return (
        isOpenOrder(row) &&
        !isFbaOrder(row) &&
        (isLabelFailedOrder(row) || isTrackingPushFailed(row) || (isToShipOrder(row) && row.addressIncomplete === true))
      );
    case 'all':
    default:
      return true;
  }
}

/**
 * Twin of `statusKeyWhereSql(key)`: the pill rules of `orderRowStatus()` over view facts (FBA from
 * rawData, address from `addressIncomplete`). Unlisted rows match nothing.
 */
export function matchesStatusKey(row: OrderViewFacts, key: OrderStatusFilterKey, now: Date = new Date()): boolean {
  if (!isListedOrder(row)) return false;
  if (key === 'shipped' || key === 'delivered' || key === 'cancelled' || key === 'refunded') return inRaw(key, row.status);
  if (!isOpenOrder(row)) return false;
  const failed = isLabelFailedOrder(row);
  if (key === 'label_failed') return failed;
  if (failed) return false;
  const fba = isFbaOrder(row);
  if (fba) return key === 'to_ship';
  const label = orderHasLabel(row);
  if (key === 'label_created') return label;
  if (label) return false;
  const addr = row.addressIncomplete === true;
  if (key === 'problem') return addr || inRaw('problem', row.status);
  if (addr) return false;
  if (key === 'on_hold') return inRaw('on_hold', row.status);
  if (inRaw('on_hold', row.status) || inRaw('problem', row.status)) return false;
  const d = effectiveShipBy(row);
  const overdue = d !== null && d.getTime() < now.getTime();
  return key === 'overdue' ? overdue : !overdue;
}

/** `{ to_ship, overdue, label_created, problems }` over loaded rows; same numbers as VIEW_COUNTS_SQL. */
export function countViews(rows: readonly OrderViewFacts[], now: Date = new Date()): Record<CountedOrderViewKey, number> {
  const out: Record<CountedOrderViewKey, number> = { to_ship: 0, overdue: 0, label_created: 0, problems: 0 };
  for (const r of rows) for (const k of COUNTED_VIEW_KEYS) if (matchesOrderView(r, k, now)) out[k]++;
  return out;
}


/* ------------------------------- shared with Overview (M8 overview-G1) */

/**
 * Legacy unified status filters (the `status=` values of the legacy labels page and
 * `/api/orders/export`) → the lowercase DB statuses they cover. Moved here from
 * `pages/api/orders/index.ts` (re-exported there) so Overview and Orders read one list
 * (overview §4.1 "Live order", CRITIQUE C4). Matched against `LOWER(o."status")`.
 *
 * 'onaylandi' = live orders that still need fulfilment. Amazon 'pending' is a
 * live order (payment authorising; see commit a4acab0) and belongs here.
 * Genuinely unpaid states (awaiting_payment / pending_payment) are excluded
 * from /api/orders entirely and are deliberately NOT listed.
 */
export const STATUS_FILTER_GROUPS: Record<string, string[]> = {
  onaylandi: [
    'paid', 'created', 'approved', 'pending', 'new', 'open', 'processing',
    'awaiting_fulfillment', 'awaiting_shipment', 'unshipped', 'unfulfilled',
    'not_fulfilled', 'not_started', 'in_progress', 'picking', 'invoiced',
    'ready_to_ship',
    // Shopify financial_status values the mapper stores verbatim: an
    // authorized payment (captured later) or a partial refund is still a live
    // order that needs a label.
    'authorized', 'partially_refunded',
  ],
  kargolandi: ['shipped', 'partially_shipped', 'shipping', 'in_transit', 'fulfilled'],
  iptal: ['cancelled', 'canceled', 'refunded', 'returned', 'unfulfillable', 'voided'],
  delivered: ['delivered', 'completed'],
};

/** Expand UI status filter values to the lowercase DB statuses they cover (unknown values pass through, lowercased). */
export function expandStatusFilter(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key) continue;
    const group = STATUS_FILTER_GROUPS[key];
    if (group) group.forEach((s) => out.add(s));
    else out.add(key);
  }
  return Array.from(out);
}

/**
 * A label exists (alias of HAS_LABEL_SQL under the name overview §4.1 uses; twin: `orderHasLabel`).
 * `UNLABELED_SQL` (above) is its negation. Never NULL.
 */
export const LABELED_SQL = HAS_LABEL_SQL;

/** How far back a failed label attempt still counts as "label failed" (overview §4.1 labels.failed). */
export const FAILED_LABEL_WINDOW_DAYS = 14;

/**
 * Failed label, overview definition (overview §4.1 `labels.failed`, §4.3.2): the order still has
 * no label AND some LabelJob of the order failed and was updated in the last 14 days. Used by the
 * legacy `/api/orders?labelStatus=failed` filter (the `/app/labels?label=failed&from=all` list) and
 * by the Overview summary, so both count the same orders. Never NULL. Twin: `isFailedLabelOrder`.
 *
 * Not the same rule as LABEL_FAILED_SQL (Orders v2 `label_failed` pill: newest job failed or
 * `labelStatus='failed'`, no window). Parity: compose it with the same base clause as /api/orders:
 *   `WHERE o."userId" = $1 AND ${LISTED_ORDER_SQL} AND ${FAILED_LABEL_SQL}`.
 */
export const FAILED_LABEL_SQL = `(${UNLABELED_SQL} AND EXISTS (
    SELECT 1 FROM "OrderItem" fli JOIN "LabelJob" flj ON flj."orderItemId" = fli.id
    WHERE fli."orderId" = o.id AND LOWER(flj.status) = 'failed'
      AND flj."updatedAt" >= NOW() - INTERVAL '${FAILED_LABEL_WINDOW_DAYS} days'
  ))`;

/** Pure twin of FAILED_LABEL_SQL (a job without `updatedAt` falls back to `createdAt`). */
export function isFailedLabelOrder(row: OrderViewFacts, now: Date = new Date()): boolean {
  if (orderHasLabel(row)) return false;
  const since = now.getTime() - FAILED_LABEL_WINDOW_DAYS * 86_400_000;
  return (row.items ?? []).some((i) =>
    (i.labelJobs ?? []).some((j) => {
      if (String(j.status ?? '').toLowerCase() !== 'failed') return false;
      const at = validDate(j.updatedAt) ?? validDate(j.createdAt);
      return at !== null && at.getTime() >= since;
    }),
  );
}
