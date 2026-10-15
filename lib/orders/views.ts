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

/** Orders the seller still has to ship and label. */
export const TO_SHIP_SQL = `(${LISTED_ORDER_SQL} AND ${OPEN_STATUS_SQL} AND ${UNLABELED_SQL} AND NOT ${FBA_SQL})`;

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

export function isToShipOrder(row: OrderViewRow): boolean {
  return isListedOrder(row) && isOpenOrder(row) && !orderHasLabel(row) && !isFbaOrder(row);
}

export function isOverdueOrder(row: OrderViewRow, now: Date = new Date()): boolean {
  if (!isToShipOrder(row)) return false;
  const d = effectiveShipBy(row);
  return d !== null && d.getTime() < now.getTime();
}

/** `{ toShip, overdue }` over loaded rows; same numbers as TO_SHIP_COUNTS_SQL. */
export function countToShip(rows: readonly OrderViewRow[], now: Date = new Date()): { toShip: number; overdue: number } {
  let toShip = 0;
  let overdue = 0;
  for (const r of rows) {
    if (!isToShipOrder(r)) continue;
    toShip++;
    const d = effectiveShipBy(r);
    if (d && d.getTime() < now.getTime()) overdue++;
  }
  return { toShip, overdue };
}
