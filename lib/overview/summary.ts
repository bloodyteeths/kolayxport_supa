/**
 * Overview summary (overview.md §4, §4.1). Server-only. One exported function per section,
 * composed by `getOverviewSummary`, which runs every section inside one `Promise.all` with its own
 * try/catch: a failed section is `null` and its key goes into `errors[]`; the call itself never
 * throws because one section failed. Each section error is logged through `logger.error` with the
 * `requestId`, so "Copy error ID" can be traced in SyncLog.
 *
 * Shared definitions are imported, never copied (CRITIQUE C4, C5):
 * - To ship / overdue / effective ship-by / labeled / failed label: `lib/orders/views.ts`
 * - Store → channel: `lib/marketplaces/canonical.ts`
 * - FX: `lib/fx.ts`
 * - Plan limits: `lib/billing/planLimits.ts` (until the billing track exports `getUsageSnapshot`)
 *
 * Time zones: day boundaries are computed in JS for `tz` and passed as ISO strings cast to
 * `timestamptz` then `AT TIME ZONE 'UTC'` (the columns are UTC-stored `timestamp`). Day grouping
 * uses `(ts AT TIME ZONE 'UTC') AT TIME ZONE $tz` (the double conversion; a single one is B.14).
 */
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { EMPTY_CANCELLABLE_STATUSES, emptyCheckSelect, isUncountedDraft, type DraftModelKind } from '@/lib/drafts/emptyDraft';
import { LEGACY_EBAY_SKU_PREFIX } from '@/lib/ebay/legacy';
import { logger } from '@/lib/logger';
import { getExchangeRates, convertToBase, normalizeCurrency, type RatesSnapshot } from '@/lib/fx';
import { canonicalStore } from '@/lib/marketplaces/canonical';
import { decodeEntities } from '@/lib/text/decodeEntities';
import { localParts } from '@/lib/notificationCenter/time';
import { getPlanLimits, checkPlanLimit, type LimitKind } from '@/lib/billing/planLimits';
import { recoverStaleSyncingDrafts } from '@/lib/etsy/draftService';
import {
  EFFECTIVE_SHIP_BY_SQL,
  FAILED_LABEL_SQL,
  LABELED_SQL,
  LISTED_ORDER_SQL,
  NORMALIZED_STATUS_SQL,
  OVERDUE_SQL,
  RAW_STATUSES_BY_KEY,
  STATUS_FILTER_GROUPS,
  TO_SHIP_SQL,
  TRACKING_PUSH_FAILED_SQL,
  UNPAID_ORDER_STATUSES,
} from '@/lib/orders/views';
import { healthColumnTables } from '@/lib/listings/refreshHealth';
import { getLocaleConfig } from '@/lib/i18n/localeConfig';
import {
  LISTING_HEALTH_CAP,
  LISTING_HEALTH_THRESHOLD,
  OVERVIEW_CHANNELS,
  OVERVIEW_CURRENCIES,
  type DraftBucket,
  type DraftRef,
  type OrderRef,
  type OverviewChannel,
  type OverviewCurrency,
  type OverviewSummary,
  type Revenue7d,
  type SectionKey,
  type UsageBlockedReason,
  type UsageSnapshot,
} from './types';

/* ------------------------------------------------------------ constants */

export const DEFAULT_OVERVIEW_TZ = 'Europe/Istanbul';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const SERIES_DAYS = 14;
/** Tracking: a pending extension push older than this counts as "not sent". */
export const TRACKING_PENDING_GRACE_MS = 30 * 60_000;
/** Tracking: a label with no submission at all counts after 2 h, for 14 days. */
export const TRACKING_LABEL_GRACE_MS = 2 * HOUR_MS;
export const TRACKING_LABEL_WINDOW_MS = 14 * DAY_MS;
/** eBay drafts in `syncing` longer than this are reported as failed (read-only; lib/ebay/draftService.ts). */
export const EBAY_STALE_SYNCING_MS = 10 * 60_000;
export const ERROR_TEXT_MAX = 140;
const NEAR_LIMIT_RATIO = 0.8;
const PLACEHOLDER_IMAGE = '/placeholder.png';

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
const sqlList = (vs: readonly string[]) => vs.map(quote).join(', ');


/** Order date used by every window: the marketplace order date, else the sync time. */
export const ORDER_TS_SQL = `COALESCE(o."uiOrderDate", o."createdAt")`;

/** A `$n` ISO-string parameter as a UTC `timestamp` (matches the UTC-stored columns). */
const utcParam = (n: number) => `($${n}::timestamptz AT TIME ZONE 'UTC')`;

/** Etsy order: marketplace mentions Etsy or equals one of the user's shop names. `$n` = lower-cased names (text[]). */
const etsyOrderSql = (n: number) => `(o."marketplace" ILIKE '%etsy%' OR LOWER(o."marketplace") = ANY($${n}::text[]))`;

/** Not cancelled / refunded (normalized status); NULL status passes. */
const NOT_CANCELLED_SQL = `(o."status" IS NULL OR ${NORMALIZED_STATUS_SQL} NOT IN (${sqlList([
  ...RAW_STATUSES_BY_KEY.cancelled,
  ...RAW_STATUSES_BY_KEY.refunded,
])}))`;

/**
 * Counted order (KPIs, series, best sellers): not unpaid, not cancelled / refunded; NULL status
 * (manual orders) counts. Cancelled uses both the raw filter group and the normalized lists, so
 * 'İptal Edildi' or 'cancelled_by_buyer' is left out here exactly as in NOT_CANCELLED_SQL.
 */
export const COUNTED_ORDER_SQL = `(o."status" IS NULL OR (LOWER(o."status") NOT IN (${sqlList([...UNPAID_ORDER_STATUSES])})
  AND ${NORMALIZED_STATUS_SQL} NOT IN (${sqlList(
    Array.from(new Set<string>([...STATUS_FILTER_GROUPS.iptal, ...RAW_STATUSES_BY_KEY.cancelled, ...RAW_STATUSES_BY_KEY.refunded])),
  )})))`;

const FIRST_ITEM_SQL = `(SELECT fi."productName" FROM "OrderItem" fi WHERE fi."orderId" = o.id ORDER BY fi.id LIMIT 1) AS "itemName",
  (SELECT fi.image FROM "OrderItem" fi WHERE fi."orderId" = o.id AND NULLIF(fi.image, '') IS NOT NULL AND fi.image <> '${PLACEHOLDER_IMAGE}' ORDER BY fi.id LIMIT 1) AS "image"`;

const ORDER_REF_COLS = `o.id AS "id", o."orderNumber" AS "orderNumber", o."marketplace" AS "marketplace",
  (${EFFECTIVE_SHIP_BY_SQL}) AS "shipBy", ${FIRST_ITEM_SQL}`;

/* ---------------------------------------------------------------- SQL */
// Each statement starts with a `/* overview:<name> */` tag (log/EXPLAIN readability and test dispatch).

/** $1 userId, $2 end of today in tz (ISO). */
export const TO_SHIP_SUMMARY_SQL = `/* overview:toShip */
WITH t AS (
  SELECT ${ORDER_TS_SQL} AS ordered, (${EFFECTIVE_SHIP_BY_SQL}) AS sb
  FROM "Order" o
  WHERE o."userId" = $1 AND ${TO_SHIP_SQL}
)
SELECT COUNT(*) AS "count",
  COUNT(*) FILTER (WHERE sb < NOW()) AS "overdue",
  COUNT(*) FILTER (WHERE sb >= NOW() AND sb < $2::timestamptz) AS "dueToday",
  COUNT(*) FILTER (WHERE sb IS NULL) AS "withoutShipBy",
  MIN(ordered) AS "oldestOrderedAt"
FROM t`;

/** $1 userId. Most overdue first. */
export const TO_SHIP_FIRST_OVERDUE_SQL = `/* overview:toShipFirst */
SELECT ${ORDER_REF_COLS}
FROM "Order" o
WHERE o."userId" = $1 AND ${TO_SHIP_SQL} AND ${OVERDUE_SQL}
ORDER BY "shipBy" ASC NULLS LAST, o.id ASC
LIMIT 1`;

/**
 * $1 userId. Same base as `/api/orders?labelStatus=failed` (views.ts FAILED_LABEL_SQL doc), so the
 * Overview count equals the row count of `/app/labels?label=failed&from=all`.
 * One row: the order with the newest failure, plus the total as a window count.
 */
export const LABELS_FAILED_SQL = `/* overview:labels */
SELECT ${ORDER_REF_COLS}, lf."errorMessage" AS "error", COUNT(*) OVER () AS "total"
FROM "Order" o
JOIN LATERAL (
  SELECT lj."errorMessage", lj."updatedAt" FROM "OrderItem" li JOIN "LabelJob" lj ON lj."orderItemId" = li.id
  WHERE li."orderId" = o.id AND LOWER(lj.status) = 'failed'
  ORDER BY lj."updatedAt" DESC LIMIT 1
) lf ON true
WHERE o."userId" = $1 AND ${LISTED_ORDER_SQL} AND ${FAILED_LABEL_SQL}
ORDER BY lf."updatedAt" DESC, o.id ASC
LIMIT 1`;

/**
 * $1 userId, $2 lower-cased Etsy shop names. Counts orders (not submissions) with the shared
 * views.ts TRACKING_PUSH_FAILED_SQL (newest submission failed), not cancelled, and with an open
 * submission, so it never exceeds the Orders tracking-failed list.
 */
export const TRACKING_FAILED_SQL = `/* overview:trackingFailed */
SELECT COUNT(*) AS "count"
FROM "Order" o
WHERE o."userId" = $1 AND ${etsyOrderSql(2)} AND ${LISTED_ORDER_SQL}
  AND ${NOT_CANCELLED_SQL} AND o."cancelledAt" IS NULL
  AND ${TRACKING_PUSH_FAILED_SQL}
  AND EXISTS (SELECT 1 FROM "TrackingSubmission" ots WHERE ots."orderId" = o.id AND ots."closedAt" IS NULL)`;

/**
 * $1 userId, $2 lower-cased Etsy shop names, $3 now-30min, $4 now-2h, $5 now-14d (ISO).
 * Two sources (overview §4.1 tracking.notSent): pending extension pushes older than 30 min, plus
 * labeled live-or-shipped Etsy orders with no submission whose newest label is 2 h – 14 d old.
 * One row: the oldest of them (`id`) plus the total.
 */
export const TRACKING_NOT_SENT_SQL = `/* overview:trackingNotSent */
WITH pending AS (
  SELECT ts."orderId" AS id, ts."submittedAt" AS at
  FROM "TrackingSubmission" ts JOIN "Order" o ON o.id = ts."orderId"
  WHERE ts."submittedBy" = $1 AND ${etsyOrderSql(2)} AND ts."closedAt" IS NULL AND o."cancelledAt" IS NULL
    AND ts."etsySubmitStatus" IN ('pending', 'needs_manual')
    AND ts."submittedAt" < ${utcParam(3)}
), unsent AS (
  SELECT o.id AS id, la.at AS at
  FROM "Order" o
  JOIN LATERAL (
    SELECT GREATEST(
      (SELECT MAX(s."createdAt") FROM "Shipment" s WHERE s."orderId" = o.id AND s.status = 'created'),
      (SELECT MAX(lj."createdAt") FROM "OrderItem" li JOIN "LabelJob" lj ON lj."orderItemId" = li.id
        WHERE li."orderId" = o.id AND lj.status = 'created')
    ) AS at
  ) la ON true
  WHERE o."userId" = $1 AND ${etsyOrderSql(2)} AND ${LISTED_ORDER_SQL} AND ${NOT_CANCELLED_SQL} AND o."cancelledAt" IS NULL
    AND ${LABELED_SQL}
    AND NOT EXISTS (SELECT 1 FROM "TrackingSubmission" nts WHERE nts."orderId" = o.id)
    AND la.at < ${utcParam(4)} AND la.at >= ${utcParam(5)}
), u AS (SELECT id, at FROM pending UNION ALL SELECT id, at FROM unsent)
SELECT id AS "id", COUNT(*) OVER () AS "total" FROM u ORDER BY at ASC, id ASC LIMIT 1`;

/** $1 userId, $2 order id. */
export const ORDER_REF_SQL = `/* overview:orderRef */
SELECT ${ORDER_REF_COLS} FROM "Order" o WHERE o."userId" = $1 AND o.id = $2 LIMIT 1`;

/**
 * $1 userId, $2 window start, $3 now, $4 tz, $5 now-7d, $6 now-14d (ISO except $4).
 * One CTE of counted orders feeds the series (`kind='day'`, `key` = local day) and the revenue /
 * order KPIs (`kind='rev'`, `key` = 'cur'|'prev', per currency).
 */
export const COUNTED_ORDERS_SQL = `/* overview:counted */
WITH c AS (
  SELECT ${ORDER_TS_SQL} AS ts, o."totalPrice" AS total, o."currency" AS currency
  FROM "Order" o
  WHERE o."userId" = $1 AND ${COUNTED_ORDER_SQL}
    AND ${ORDER_TS_SQL} >= ${utcParam(2)} AND ${ORDER_TS_SQL} < ${utcParam(3)}
)
SELECT 'day' AS "kind", to_char((ts AT TIME ZONE 'UTC') AT TIME ZONE $4, 'YYYY-MM-DD') AS "key",
  NULL::text AS "currency", COUNT(*) AS "orders", NULL::float8 AS "amount"
FROM c GROUP BY 2
UNION ALL
SELECT 'rev' AS "kind", CASE WHEN ts >= ${utcParam(5)} THEN 'cur' ELSE 'prev' END AS "key",
  UPPER(COALESCE(NULLIF(BTRIM(currency), ''), 'TRY')) AS "currency", COUNT(*) AS "orders",
  COALESCE(SUM(total), 0)::float8 AS "amount"
FROM c WHERE ts >= ${utcParam(6)} GROUP BY 2, 3`;

/** $1 userId, $2 now-7d, $3 now (ISO). Top 5 by units. */
export const TOP_SELLERS_SQL = `/* overview:topSellers */
SELECT COALESCE(NULLIF(BTRIM(i.sku), ''), LOWER(NULLIF(BTRIM(i."productName"), ''))) AS "key",
  MAX(i."productName") AS "name", MAX(NULLIF(BTRIM(i.sku), '')) AS "sku",
  COALESCE(SUM(i.quantity), 0) AS "units", COUNT(DISTINCT i."orderId") AS "orders",
  MAX(NULLIF(NULLIF(i.image, ''), '${PLACEHOLDER_IMAGE}')) AS "image",
  MODE() WITHIN GROUP (ORDER BY o."marketplace") AS "marketplace"
FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
WHERE o."userId" = $1 AND ${COUNTED_ORDER_SQL}
  AND ${ORDER_TS_SQL} >= ${utcParam(2)} AND ${ORDER_TS_SQL} < ${utcParam(3)}
  AND COALESCE(NULLIF(BTRIM(i.sku), ''), NULLIF(BTRIM(i."productName"), '')) IS NOT NULL
GROUP BY 1
ORDER BY "units" DESC, "orders" DESC, "key" ASC
LIMIT 5`;

/* ------------------------------------------------------------- helpers */

/** pg COUNT is bigint; Prisma returns bigint / number / string. Non-negative integer. */
export function toCount(v: unknown): number {
  const n = typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'bigint' ? Number(v) : typeof v === 'object' && v && 'toString' in v ? Number(String(v)) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = decodeEntities(v).trim();
  return s || null;
}

function cleanImage(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = decodeEntities(v).trim();
  if (!s || s === PLACEHOLDER_IMAGE) return null;
  return s;
}

/**
 * A stored error message for display: anything from the first `{` or `[` on (raw JSON) is cut,
 * trailing separators trimmed, then cut to 140 chars. Null when nothing readable is left.
 */
export function sanitizeErrorMessage(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v;
  const cut = s.search(/[{[]/);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/[\s:;,\-–—|]+$/u, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > ERROR_TEXT_MAX) s = `${s.slice(0, ERROR_TEXT_MAX - 1).trimEnd()}…`;
  return s;
}

/** `Order.marketplace` → Overview channel (canonical store; n11 / manual / unknown → other). */
export function channelFor(marketplace: unknown, etsyShopNames: readonly string[]): OverviewChannel {
  const mp = canonicalStore(typeof marketplace === 'string' ? marketplace : null, etsyShopNames).marketplace;
  return (OVERVIEW_CHANNELS as readonly string[]).includes(mp) ? (mp as OverviewChannel) : 'other';
}

interface OrderRefRow {
  id: string;
  orderNumber: string | null;
  marketplace: string | null;
  shipBy: unknown;
  itemName: string | null;
  image: string | null;
}

function toOrderRef(row: OrderRefRow, etsyShopNames: readonly string[]): OrderRef {
  return {
    id: String(row.id),
    orderNumber: String(row.orderNumber ?? ''),
    channel: channelFor(row.marketplace, etsyShopNames),
    itemName: cleanText(row.itemName),
    image: cleanImage(row.image),
    shipBy: toIso(row.shipBy),
  };
}

/* ------------------------------------------------------------ time zone */

let supportedZones: Set<string> | null = null;
function zoneSet(): Set<string> | null {
  if (supportedZones) return supportedZones;
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  if (typeof fn !== 'function') return null;
  try {
    supportedZones = new Set(fn('timeZone'));
    return supportedZones;
  } catch {
    return null;
  }
}

/** `tz` if `Intl.supportedValuesOf('timeZone')` lists it or it is 'UTC', else Europe/Istanbul. */
export function parseOverviewTz(raw: unknown): string {
  const tz = Array.isArray(raw) ? raw[0] : raw;
  if (typeof tz !== 'string' || !tz || tz.length > 64) return DEFAULT_OVERVIEW_TZ;
  if (tz === 'UTC') return 'UTC';
  const zones = zoneSet();
  if (zones) return zones.has(tz) ? tz : DEFAULT_OVERVIEW_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_OVERVIEW_TZ;
  }
}

const isOverviewCurrency = (v: string): v is OverviewCurrency => (OVERVIEW_CURRENCIES as readonly string[]).includes(v);

/** `TRY` | `USD` from the query, else `localeConfig.defaultCurrency` for `locale` ('tr' | 'en'), else TRY. */
export function parseOverviewCurrency(raw: unknown, locale?: string | null): OverviewCurrency {
  const v = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().toUpperCase();
  if (isOverviewCurrency(v)) return v;
  if (locale === 'tr' || locale === 'en') {
    const def = getLocaleConfig(locale).defaultCurrency.toUpperCase();
    if (isOverviewCurrency(def)) return def;
  }
  return 'TRY';
}

/** Offset of `tz` from UTC at `at` in ms (local wall clock − UTC), minute precision. */
function tzOffsetMs(at: number, tz: string): number {
  const p = localParts(new Date(at), tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wall - Math.floor(at / 60_000) * 60_000;
}

/** UTC instant of local midnight of the calendar day `y-m-d` in `tz` (DST-safe, two passes). */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return new Date(t);
}

function addDaysKey(y: number, m: number, d: number, days: number): { y: number; m: number; d: number; key: string } {
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = dt.getUTCMonth() + 1;
  const dd = dt.getUTCDate();
  return { y: yy, m: mm, d: dd, key: `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` };
}

export interface DayWindows {
  /** Local day keys, oldest first: the last 14 days ending today. */
  seriesKeys: string[];
  /** The 14 local days before those. */
  previousKeys: string[];
  /** UTC start of the oldest previous day. */
  windowStart: Date;
  /** UTC start of today in tz. */
  todayStart: Date;
  /** UTC start of tomorrow in tz (end of today). */
  todayEnd: Date;
}

/** Local-day windows for `now` in `tz`. */
export function dayWindows(now: Date, tz: string, days: number = SERIES_DAYS): DayWindows {
  const p = localParts(now, tz);
  const seriesKeys: string[] = [];
  const previousKeys: string[] = [];
  for (let i = 2 * days - 1; i >= 0; i--) {
    const k = addDaysKey(p.year, p.month, p.day, -i).key;
    if (i >= days) previousKeys.push(k);
    else seriesKeys.push(k);
  }
  const first = addDaysKey(p.year, p.month, p.day, -(2 * days - 1));
  const next = addDaysKey(p.year, p.month, p.day, 1);
  return {
    seriesKeys,
    previousKeys,
    windowStart: zonedMidnight(first.y, first.m, first.d, tz),
    todayStart: zonedMidnight(p.year, p.month, p.day, tz),
    todayEnd: zonedMidnight(next.y, next.m, next.d, tz),
  };
}

/* --------------------------------------------------------------- context */

interface EtsyShopRow {
  shopId: string;
  shopName: string | null;
  isActive: boolean;
}

interface CountedRow {
  kind: 'day' | 'rev';
  key: string;
  currency: string | null;
  orders: unknown;
  amount: unknown;
}

export interface SummaryContext {
  userId: string;
  tz: string;
  currency: OverviewCurrency;
  now: Date;
  requestId: string;
  /** Memoized loaders shared by sections (a failure fails only the sections that await it). */
  etsyShops: () => Promise<EtsyShopRow[]>;
  counted: () => Promise<CountedRow[]>;
  windows: DayWindows;
}

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}

export function createSummaryContext(opts: {
  userId: string;
  tz: string;
  currency: OverviewCurrency;
  now?: Date;
  requestId?: string;
}): SummaryContext {
  const now = opts.now ?? new Date();
  const windows = dayWindows(now, opts.tz);
  const ctx: SummaryContext = {
    userId: opts.userId,
    tz: opts.tz,
    currency: opts.currency,
    now,
    requestId: opts.requestId ?? randomUUID(),
    windows,
    etsyShops: memo(() =>
      prisma.etsyShop.findMany({
        where: { userId: opts.userId },
        select: { shopId: true, shopName: true, isActive: true },
      }) as Promise<EtsyShopRow[]>,
    ),
    counted: memo(async () => {
      const t = now.getTime();
      const start = Math.min(windows.windowStart.getTime(), t - 14 * DAY_MS);
      return prisma.$queryRawUnsafe<CountedRow[]>(
        COUNTED_ORDERS_SQL,
        opts.userId,
        new Date(start).toISOString(),
        now.toISOString(),
        opts.tz,
        new Date(t - 7 * DAY_MS).toISOString(),
        new Date(t - 14 * DAY_MS).toISOString(),
      );
    }),
  };
  return ctx;
}

async function shopNames(ctx: SummaryContext, activeOnly = false): Promise<string[]> {
  const shops = await ctx.etsyShops();
  return shops
    .filter((s) => (activeOnly ? s.isActive : true))
    .map((s) => (s.shopName ?? '').trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------- sections */

/** 'meta': User.lastSyncedAt. */
export async function getOrdersLastSyncedAt(ctx: SummaryContext): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { lastSyncedAt: true } });
  return toIso(user?.lastSyncedAt ?? null);
}

export async function getToShipSection(ctx: SummaryContext): Promise<NonNullable<OverviewSummary['toShip']>> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    TO_SHIP_SUMMARY_SQL,
    ctx.userId,
    ctx.windows.todayEnd.toISOString(),
  );
  const r = rows?.[0] ?? {};
  const overdue = toCount(r.overdue);
  let firstOverdue: OrderRef | null = null;
  if (overdue > 0) {
    const [first] = await prisma.$queryRawUnsafe<OrderRefRow[]>(TO_SHIP_FIRST_OVERDUE_SQL, ctx.userId);
    if (first) firstOverdue = toOrderRef(first, await shopNames(ctx));
  }
  return {
    count: toCount(r.count),
    overdue,
    dueToday: toCount(r.dueToday),
    withoutShipBy: toCount(r.withoutShipBy),
    oldestOrderedAt: toIso(r.oldestOrderedAt),
    firstOverdue,
  };
}

export async function getLabelsSection(ctx: SummaryContext): Promise<NonNullable<OverviewSummary['labels']>> {
  const rows = await prisma.$queryRawUnsafe<Array<OrderRefRow & { error: string | null; total: unknown }>>(
    LABELS_FAILED_SQL,
    ctx.userId,
  );
  const row = rows?.[0];
  if (!row) return { failed: 0, first: null };
  return {
    failed: toCount(row.total),
    first: { ...toOrderRef(row, await shopNames(ctx)), error: sanitizeErrorMessage(row.error) },
  };
}

export async function getTrackingSection(ctx: SummaryContext): Promise<NonNullable<OverviewSummary['tracking']>> {
  const names = (await shopNames(ctx, true)).map((n) => n.toLocaleLowerCase('en'));
  const t = ctx.now.getTime();
  const [failedRows, notSentRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ count: unknown }>>(TRACKING_FAILED_SQL, ctx.userId, names),
    prisma.$queryRawUnsafe<Array<{ id: string; total: unknown }>>(
      TRACKING_NOT_SENT_SQL,
      ctx.userId,
      names,
      new Date(t - TRACKING_PENDING_GRACE_MS).toISOString(),
      new Date(t - TRACKING_LABEL_GRACE_MS).toISOString(),
      new Date(t - TRACKING_LABEL_WINDOW_MS).toISOString(),
    ),
  ]);
  const top = notSentRows?.[0];
  let first: OrderRef | null = null;
  if (top?.id) {
    const [ref] = await prisma.$queryRawUnsafe<OrderRefRow[]>(ORDER_REF_SQL, ctx.userId, top.id);
    if (ref) first = toOrderRef(ref, await shopNames(ctx));
  }
  return { notSent: top ? toCount(top.total) : 0, failed: toCount(failedRows?.[0]?.count), first };
}

const EMPTY_BUCKET = (): DraftBucket => ({ draft: 0, failed: 0, conflict: 0, syncing: 0, firstConflict: null, firstFailed: null });

function jsonGet(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function bucketFromGroups(groups: Array<{ status: string; _count: unknown }>): DraftBucket {
  const b = EMPTY_BUCKET();
  for (const g of groups ?? []) {
    const c = g._count;
    const n = toCount(typeof c === 'object' && c !== null ? (c as Record<string, unknown>)._all ?? (c as Record<string, unknown>).status : c);
    if (g.status === 'draft' || g.status === 'failed' || g.status === 'conflict' || g.status === 'syncing') b[g.status] += n;
  }
  return b;
}

const ACTIVE_DRAFT_STATUSES = ['draft', 'failed', 'conflict', 'syncing'];

/**
 * Open drafts whose every change was undone hold nothing to send, and eBay drafts of listings created on eBay
 * (`legacy-<itemId>`) can never be sent (lib/drafts/emptyDraft): they are taken out of the "changes not sent" bucket.
 */
async function withoutEmptyDrafts(model: DraftModelKind, delegate: any, userId: string, bucket: DraftBucket): Promise<DraftBucket> {
  const rows: any[] = await delegate.findMany({
    where: { userId, status: { in: EMPTY_CANCELLABLE_STATUSES } },
    select: { status: true, ...emptyCheckSelect(model, { scheduledSendAt: true }) },
  });
  const out = { ...bucket };
  for (const r of rows ?? []) {
    if (!isUncountedDraft(model, r)) continue;
    const k = r.status as 'draft' | 'failed' | 'conflict';
    out[k] = Math.max(0, out[k] - 1);
  }
  return out;
}

async function etsyDraftRef(
  row: { id: string; etsyShopId: string; etsyListingId: bigint | number | string; fieldPatch: unknown; lastSyncError: string | null } | null,
): Promise<DraftRef | null> {
  if (!row) return null;
  let listing: { title: string | null; thumbnailUrl75x75: string | null } | null = null;
  try {
    listing = await prisma.etsyListing.findUnique({
      where: { etsyShopId_etsyListingId: { etsyShopId: row.etsyShopId, etsyListingId: BigInt(String(row.etsyListingId)) } },
      select: { title: true, thumbnailUrl75x75: true },
    });
  } catch {
    listing = null;
  }
  const patchTitle = jsonGet(row.fieldPatch, ['title']);
  return {
    draftId: row.id,
    listingId: String(row.etsyListingId),
    title: cleanText(typeof patchTitle === 'string' && patchTitle.trim() ? patchTitle : listing?.title ?? null),
    thumb: cleanImage(listing?.thumbnailUrl75x75 ?? null),
    error: sanitizeErrorMessage(row.lastSyncError),
  };
}

function ebayDraftRef(
  row: { id: string; sku: string; listingId: string | null; inventoryPatch: unknown; baseSnapshotInventory: unknown; lastSyncError: string | null } | null,
): DraftRef | null {
  if (!row) return null;
  const pick = (path: string[]) => jsonGet(row.inventoryPatch, path) ?? jsonGet(row.baseSnapshotInventory, path);
  const title = pick(['product', 'title']);
  const patchImages = jsonGet(row.inventoryPatch, ['product', 'imageUrls']);
  const baseImages = jsonGet(row.baseSnapshotInventory, ['product', 'imageUrls']);
  const images = Array.isArray(patchImages) && patchImages.length ? patchImages : Array.isArray(baseImages) ? baseImages : [];
  return {
    draftId: row.id,
    listingId: String(row.listingId || row.sku),
    title: cleanText(typeof title === 'string' ? title : null),
    thumb: cleanImage(typeof images[0] === 'string' ? images[0] : null),
    error: sanitizeErrorMessage(row.lastSyncError),
  };
}

const ETSY_REF_SELECT = { id: true, etsyShopId: true, etsyListingId: true, fieldPatch: true, lastSyncError: true } as const;
const EBAY_REF_SELECT = { id: true, sku: true, listingId: true, inventoryPatch: true, baseSnapshotInventory: true, lastSyncError: true } as const;

export async function getEtsyDraftBucket(ctx: SummaryContext): Promise<DraftBucket> {
  // Orphaned `syncing` drafts (restart mid-sync) become failed first, as the draft list does.
  await recoverStaleSyncingDrafts(ctx.userId);
  const where = { userId: ctx.userId };
  const [groups, conflict, failed] = await Promise.all([
    prisma.etsyListingDraft.groupBy({ by: ['status'], where: { ...where, status: { in: ACTIVE_DRAFT_STATUSES } }, _count: { _all: true } }),
    prisma.etsyListingDraft.findFirst({ where: { ...where, status: 'conflict' }, orderBy: { updatedAt: 'desc' }, select: ETSY_REF_SELECT }),
    prisma.etsyListingDraft.findFirst({ where: { ...where, status: 'failed' }, orderBy: { updatedAt: 'desc' }, select: ETSY_REF_SELECT }),
  ]);
  const bucket = await withoutEmptyDrafts('EtsyListingDraft', prisma.etsyListingDraft, ctx.userId, bucketFromGroups(groups as unknown as Array<{ status: string; _count: unknown }>));
  const [firstConflict, firstFailed] = await Promise.all([etsyDraftRef(conflict as never), etsyDraftRef(failed as never)]);
  return { ...bucket, firstConflict, firstFailed };
}

export async function getEbayDraftBucket(ctx: SummaryContext): Promise<DraftBucket> {
  const where = { userId: ctx.userId };
  // First conflict / failed links never point at a legacy listing's draft (it is not counted either).
  const sendable = { NOT: { sku: { startsWith: LEGACY_EBAY_SKU_PREFIX } } };
  const staleBefore = new Date(ctx.now.getTime() - EBAY_STALE_SYNCING_MS);
  const [groups, stale, conflict, failed] = await Promise.all([
    prisma.ebayListingDraft.groupBy({ by: ['status'], where: { ...where, status: { in: ACTIVE_DRAFT_STATUSES } }, _count: { _all: true } }),
    prisma.ebayListingDraft.count({ where: { ...where, status: 'syncing', updatedAt: { lt: staleBefore } } }),
    prisma.ebayListingDraft.findFirst({ where: { ...where, ...sendable, status: 'conflict' }, orderBy: { updatedAt: 'desc' }, select: EBAY_REF_SELECT }),
    prisma.ebayListingDraft.findFirst({
      where: { ...where, ...sendable, OR: [{ status: 'failed' }, { status: 'syncing', updatedAt: { lt: staleBefore } }] },
      orderBy: { updatedAt: 'desc' },
      select: EBAY_REF_SELECT,
    }),
  ]);
  const bucket = await withoutEmptyDrafts('EbayListingDraft', prisma.ebayListingDraft, ctx.userId, bucketFromGroups(groups as unknown as Array<{ status: string; _count: unknown }>));
  // Read-only: stale syncing rows are reported as failed, not written (eBay has no list-level recovery).
  const moved = Math.min(toCount(stale), bucket.syncing);
  return {
    ...bucket,
    syncing: bucket.syncing - moved,
    failed: bucket.failed + moved,
    firstConflict: ebayDraftRef(conflict as never),
    firstFailed: ebayDraftRef(failed as never),
  };
}

export async function getDraftsSection(ctx: SummaryContext): Promise<NonNullable<OverviewSummary['drafts']>> {
  const [etsy, ebay] = await Promise.all([getEtsyDraftBucket(ctx), getEbayDraftBucket(ctx)]);
  return { etsy, ebay };
}

/** Returned by a section that must be left out of the response (not an error). */
export const OMIT_SECTION = Symbol('omit-section');

export class SectionCapError extends Error {
  constructor(section: string, count: number, cap: number) {
    super(`${section}: ${count} rows exceeds the cap of ${cap}`);
    this.name = 'SectionCapError';
  }
}

type ScorerModule = typeof import('@/lib/listingScore/etsy');

/** Guarded scorer load (overview §4.1 "gated by a dynamic import() guard"). Exported for tests. */
export async function loadEtsyScorer(): Promise<ScorerModule | null> {
  try {
    const mod = await import('@/lib/listingScore/etsy');
    return typeof mod?.scoreEtsyListing === 'function' && typeof mod?.etsyInputFromCache === 'function' ? mod : null;
  } catch {
    return null;
  }
}

/**
 * Etsy listing health: active listings of the user's active shops, `score < 50` = needs work.
 * Uses the stored `EtsyListing.healthScore` (written by lib/listings/refreshHealth.ts); listings not
 * refreshed yet (or every row, while the BR-1a columns are missing) are scored here with the same
 * scorer. Above LISTING_HEALTH_CAP active listings it throws
 * (→ null + errors) instead of returning a partial count. OMIT_SECTION when the scorer is unavailable.
 */
export async function getListingHealthSection(
  ctx: SummaryContext,
): Promise<NonNullable<OverviewSummary['listingHealth']> | typeof OMIT_SECTION> {
  const scorer = await loadEtsyScorer();
  if (!scorer) return OMIT_SECTION;
  const shopIds = (await ctx.etsyShops()).filter((s) => s.isActive).map((s) => s.shopId);
  if (shopIds.length === 0) return { etsy: { needsWork: 0, scored: 0, worst: null } };

  const base = { etsyShopId: { in: shopIds }, state: 'active' };
  const total = await prisma.etsyListing.count({ where: base });
  if (total > LISTING_HEALTH_CAP) throw new SectionCapError('listingHealth', total, LISTING_HEALTH_CAP);

  const UNSCORED_SELECT = {
    etsyListingId: true, thumbnailUrl75x75: true,
    title: true, description: true, tags: true, materials: true, priceAmount: true, priceDivisor: true,
    imageCount: true, hasVideo: true, shippingProfileId: true, processingMin: true, itemWeight: true,
  } as const;

  // BR-1a guard (BUILD_PLAN §1 rule 3): until the health columns exist, score every active row here.
  const hasHealthColumns = (await healthColumnTables(prisma)).has('EtsyListing');
  const [needsWorkStored, scoredStored, worstStored, unscored] = hasHealthColumns
    ? await Promise.all([
        prisma.etsyListing.count({ where: { ...base, healthScore: { lt: LISTING_HEALTH_THRESHOLD } } }),
        prisma.etsyListing.count({ where: { ...base, healthScore: { not: null } } }),
        prisma.etsyListing.findFirst({
          where: { ...base, healthScore: { not: null } },
          orderBy: [{ healthScore: 'asc' }, { etsyListingId: 'asc' }],
          select: { etsyListingId: true, title: true, thumbnailUrl75x75: true, healthScore: true },
        }),
        // Never refreshed only: refreshHealth writes healthChecksTotal > 0 (the scorer's check count)
        // even when it stores healthScore NULL for "not enough data", so those rows are not re-read.
        prisma.etsyListing.findMany({
          where: { ...base, healthScore: null, healthChecksTotal: 0 },
          take: LISTING_HEALTH_CAP,
          select: UNSCORED_SELECT,
        }),
      ])
    : [0, 0, null, await prisma.etsyListing.findMany({ where: base, take: LISTING_HEALTH_CAP, select: UNSCORED_SELECT })];

  let needsWork = toCount(needsWorkStored);
  let scored = toCount(scoredStored);
  let worst: { listingId: string; title: string; thumb: string | null; score: number } | null = worstStored
    ? {
        listingId: String(worstStored.etsyListingId),
        title: cleanText(worstStored.title) ?? '',
        thumb: cleanImage(worstStored.thumbnailUrl75x75),
        score: Number(worstStored.healthScore),
      }
    : null;

  for (const row of unscored ?? []) {
    const result = scorer.scoreEtsyListing(scorer.etsyInputFromCache(row as never));
    if (!result || result.checksUsed === 0) continue; // not enough data to score
    scored++;
    if (result.score < LISTING_HEALTH_THRESHOLD) needsWork++;
    if (!worst || result.score < worst.score) {
      worst = {
        listingId: String(row.etsyListingId),
        title: cleanText(row.title) ?? '',
        thumb: cleanImage(row.thumbnailUrl75x75),
        score: result.score,
      };
    }
  }
  return { etsy: { needsWork, scored, worst } };
}

/* ----------------------------------------------------------------- usage */

export interface UsageUserRow {
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  billingProvider: string | null;
  trialExpiresAt: Date | null;
  usageResetAt: Date | null;
  orderSyncCount: number | null;
  labelCount: number | null;
}

/**
 * Pure usage snapshot mirroring `checkUsage` (withUsageLimiter.ts) through lib/billing/planLimits.ts.
 * Reads, never writes: an expired (or missing) `usageResetAt` reports `used: 0`, as checkUsage
 * would reset first. Fallback until the billing track exports `getUsageSnapshot` (BUILD_PLAN §3).
 */
export function usageSnapshotFromUser(user: UsageUserRow, opts: { activeShopifyShops: number }, now: Date = new Date()): UsageSnapshot {
  const resetAt = user.usageResetAt ? new Date(user.usageResetAt) : null;
  const expired = !resetAt || !(now < resetAt);
  const used = (n: number | null | undefined) => (expired ? 0 : Math.max(0, Math.floor(Number(n) || 0)));
  const counters: Record<LimitKind, number> = { orderSync: used(user.orderSyncCount), label: used(user.labelCount) };
  const decision = getPlanLimits(user.subscriptionPlan, user.subscriptionStatus, user.trialExpiresAt, now);

  let blocked: UsageBlockedReason | null = null;
  for (const kind of ['orderSync', 'label'] as const) {
    const check = checkPlanLimit(decision, kind, counters[kind]);
    if (!check.allowed && check.reason) {
      blocked = check.reason;
      break;
    }
  }
  const meter = (kind: LimitKind) => {
    const limit = decision.state === 'trial' || decision.state === 'active' ? decision.limits[kind] : decision.state === 'shopify_free' ? null : 0;
    return { used: counters[kind], limit: limit === null || limit === undefined ? null : limit };
  };
  const orderSync = meter('orderSync');
  const label = meter('label');
  const near = (m: { used: number; limit: number | null }) => m.limit !== null && m.limit > 0 && m.used / m.limit >= NEAR_LIMIT_RATIO;
  const trialEnd = user.trialExpiresAt ? new Date(user.trialExpiresAt) : null;

  return {
    plan: user.subscriptionPlan ?? null,
    status: user.subscriptionStatus ?? null,
    hideBilling: user.billingProvider === 'shopify_free' || opts.activeShopifyShops > 0,
    trialEndsAt: user.subscriptionStatus === 'trialing' && trialEnd && Number.isFinite(trialEnd.getTime()) ? trialEnd.toISOString() : null,
    resetsAt: !expired && resetAt ? resetAt.toISOString() : null,
    orderSync,
    label,
    nearLimit: !blocked && (near(orderSync) || near(label)),
    blocked,
  };
}

function isUsageSnapshot(v: unknown): v is UsageSnapshot {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const meter = (m: unknown) => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).used === 'number';
  return meter(o.orderSync) && meter(o.label) && typeof o.hideBilling === 'boolean';
}

/** Guarded: the billing track's `getUsageSnapshot(user, { activeShopifyShops })` when exported, else the fallback above. */
async function billingUsageSnapshot(): Promise<((user: unknown, opts: { activeShopifyShops: number }) => unknown) | null> {
  try {
    const mod = (await import('@/lib/middleware/withUsageLimiter')) as unknown as Record<string, unknown>;
    return typeof mod.getUsageSnapshot === 'function' ? (mod.getUsageSnapshot as (u: unknown, o: { activeShopifyShops: number }) => unknown) : null;
  } catch {
    return null;
  }
}

export async function getUsageSection(ctx: SummaryContext): Promise<UsageSnapshot> {
  const [user, activeShopifyShops] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ctx.userId },
      select: {
        subscriptionPlan: true, subscriptionStatus: true, billingProvider: true,
        trialExpiresAt: true, usageResetAt: true, orderSyncCount: true, labelCount: true,
      },
    }),
    prisma.shopifyShop.count({ where: { userId: ctx.userId, isActive: true } }),
  ]);
  if (!user) throw new Error('User not found');
  const shops = toCount(activeShopifyShops);
  const external = await billingUsageSnapshot();
  if (external) {
    const snap = await external(user, { activeShopifyShops: shops });
    if (isUsageSnapshot(snap)) return snap;
  }
  return usageSnapshotFromUser(user as UsageUserRow, { activeShopifyShops: shops }, ctx.now);
}

/* ------------------------------------------------------- KPIs and series */

/**
 * Revenue + orders over the rolling 7 days vs the 7 before (pure, exported for tests).
 * Currencies with no rate are excluded from BOTH periods and listed in `unconverted`.
 * With no rates at all and any non-base currency sold, `value`/`previous` are null and
 * `perCurrency` carries the unconverted totals.
 */
export function computeKpis(
  rows: readonly CountedRow[],
  base: OverviewCurrency,
  fx: RatesSnapshot,
): NonNullable<OverviewSummary['kpis']> {
  const per = new Map<string, { cur: number; prev: number; curOrders: number; prevOrders: number }>();
  let ordersCur = 0;
  let ordersPrev = 0;
  for (const r of rows) {
    if (r.kind !== 'rev') continue;
    const code = normalizeCurrency(r.currency);
    const e = per.get(code) ?? { cur: 0, prev: 0, curOrders: 0, prevOrders: 0 };
    const n = toCount(r.orders);
    if (r.key === 'cur') {
      e.cur += toNum(r.amount);
      e.curOrders += n;
      ordersCur += n;
    } else {
      e.prev += toNum(r.amount);
      e.prevOrders += n;
      ordersPrev += n;
    }
    per.set(code, e);
  }

  const codes = Array.from(per.keys()).sort();
  const perCurrency = codes
    .filter((c) => per.get(c)!.curOrders > 0)
    .map((c) => ({ currency: c, value: per.get(c)!.cur }));
  const noRates = Object.keys(fx.rates ?? {}).length === 0;
  const foreign = codes.filter((c) => c !== base);
  const ratesAsOf = fx.asOf ? new Date(fx.asOf).toISOString() : null;

  const revenue: Revenue7d = {
    value: 0,
    previous: 0,
    currency: base,
    approx: false,
    ratesAsOf,
    ratesStale: !!fx.stale,
    unconverted: [],
    perCurrency,
  };

  if (noRates && foreign.length > 0) {
    revenue.value = null;
    revenue.previous = null;
    return { revenue7d: revenue, orders7d: { value: ordersCur, previous: ordersPrev } };
  }

  let value = 0;
  let previous = 0;
  for (const c of codes) {
    const e = per.get(c)!;
    // Probe with 1 so a currency with no rate is detected even when its sum is 0.
    if (convertToBase(1, c, fx.rates, base) === null) {
      revenue.unconverted.push({ currency: c, orders: e.curOrders });
      continue;
    }
    value += convertToBase(e.cur, c, fx.rates, base) ?? 0;
    previous += convertToBase(e.prev, c, fx.rates, base) ?? 0;
    if (c !== base && (e.cur !== 0 || e.prev !== 0)) revenue.approx = true;
  }
  revenue.value = Math.round(value * 100) / 100;
  revenue.previous = Math.round(previous * 100) / 100;
  return { revenue7d: revenue, orders7d: { value: ordersCur, previous: ordersPrev } };
}

/** 14 local days, zero-filled, plus the 14 days before (pure, exported for tests). */
export function computeSeries(rows: readonly CountedRow[], windows: DayWindows): NonNullable<OverviewSummary['series']> {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== 'day' || typeof r.key !== 'string') continue;
    byDay.set(r.key, (byDay.get(r.key) ?? 0) + toCount(r.orders));
  }
  return {
    days: windows.seriesKeys.map((date) => ({ date, orders: byDay.get(date) ?? 0 })),
    previousTotal: windows.previousKeys.reduce((s, k) => s + (byDay.get(k) ?? 0), 0),
  };
}

export async function getKpisSection(ctx: SummaryContext): Promise<NonNullable<OverviewSummary['kpis']>> {
  const [rows, fx] = await Promise.all([ctx.counted(), getExchangeRates()]);
  return computeKpis(rows ?? [], ctx.currency, fx);
}

export async function getSeriesSection(ctx: SummaryContext): Promise<NonNullable<OverviewSummary['series']>> {
  return computeSeries((await ctx.counted()) ?? [], ctx.windows);
}

export async function getTopSellersSection(ctx: SummaryContext): Promise<NonNullable<OverviewSummary['topSellers']>> {
  const t = ctx.now.getTime();
  const [rows, names] = await Promise.all([
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      TOP_SELLERS_SQL,
      ctx.userId,
      new Date(t - 7 * DAY_MS).toISOString(),
      ctx.now.toISOString(),
    ),
    shopNames(ctx),
  ]);
  const items = (rows ?? [])
    .filter((r) => typeof r.key === 'string' && r.key)
    .map((r) => ({
      key: String(r.key),
      name: cleanText(r.name) ?? cleanText(r.sku) ?? String(r.key),
      image: cleanImage(r.image),
      units: toCount(r.units),
      orders: toCount(r.orders),
      channel: channelFor(r.marketplace, names),
    }));
  return { items };
}

export async function getSetupSection(ctx: SummaryContext): Promise<NonNullable<OverviewSummary['setup']>> {
  const userId = ctx.userId;
  const [order, sender, shipment, labeled] = await Promise.all([
    prisma.order.findFirst({ where: { userId }, select: { id: true } }),
    prisma.shipperProfile.findUnique({ where: { userId }, select: { shipperStreet1: true, shipperCity: true } }),
    prisma.shipment.findFirst({ where: { order: { userId } }, select: { id: true } }),
    prisma.order.findFirst({ where: { userId, labelStatus: 'created' }, select: { id: true } }),
  ]);
  return {
    hasOrders: !!order,
    senderComplete: !!(sender?.shipperStreet1?.trim() && sender?.shipperCity?.trim()),
    hasLabel: !!shipment || !!labeled,
  };
}

/* --------------------------------------------------------------- compose */

type SectionResult<T> = { ok: true; value: T } | { ok: false } | { ok: 'omit' };

async function run<T>(ctx: SummaryContext, key: SectionKey, fn: () => Promise<T | typeof OMIT_SECTION>): Promise<SectionResult<T>> {
  try {
    const value = await fn();
    if (value === OMIT_SECTION) return { ok: 'omit' };
    return { ok: true, value: value as T };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    try {
      void logger.error(`[overview] section ${key} failed`, err, { requestId: ctx.requestId, section: key, userId: ctx.userId });
    } catch {
      /* logging must never fail the summary */
    }
    return { ok: false };
  }
}

/**
 * The whole summary. Never throws because a section failed: failed sections are `null` and listed
 * in `errors` (in SECTION_KEYS order). `listingHealth` is omitted when the scorer is unavailable.
 */
export async function getOverviewSummary(opts: {
  userId: string;
  tz: string;
  currency: OverviewCurrency;
  now?: Date;
  requestId?: string;
}): Promise<OverviewSummary> {
  const ctx = createSummaryContext(opts);
  const [meta, toShip, labels, tracking, drafts, listingHealth, usage, kpis, series, topSellers, setup] = await Promise.all([
    run(ctx, 'meta', () => getOrdersLastSyncedAt(ctx)),
    run(ctx, 'toShip', () => getToShipSection(ctx)),
    run(ctx, 'labels', () => getLabelsSection(ctx)),
    run(ctx, 'tracking', () => getTrackingSection(ctx)),
    run(ctx, 'drafts', () => getDraftsSection(ctx)),
    run(ctx, 'listingHealth', () => getListingHealthSection(ctx)),
    run(ctx, 'usage', () => getUsageSection(ctx)),
    run(ctx, 'kpis', () => getKpisSection(ctx)),
    run(ctx, 'series', () => getSeriesSection(ctx)),
    run(ctx, 'topSellers', () => getTopSellersSection(ctx)),
    run(ctx, 'setup', () => getSetupSection(ctx)),
  ]);

  const errors: SectionKey[] = [];
  const val = <T>(key: SectionKey, r: SectionResult<T>): T | null => {
    if (r.ok === true) return r.value;
    if (r.ok === false) errors.push(key);
    return null;
  };

  const summary: OverviewSummary = {
    generatedAt: ctx.now.toISOString(),
    requestId: ctx.requestId,
    tz: ctx.tz,
    currency: ctx.currency,
    errors,
    ordersLastSyncedAt: null,
    toShip: val('toShip', toShip),
    labels: val('labels', labels),
    tracking: val('tracking', tracking),
    drafts: val('drafts', drafts),
    usage: null,
    kpis: null,
    series: null,
    topSellers: null,
    setup: null,
  };
  if (listingHealth.ok !== 'omit') summary.listingHealth = val('listingHealth', listingHealth);
  summary.usage = val('usage', usage);
  summary.kpis = val('kpis', kpis);
  summary.series = val('series', series);
  summary.topSellers = val('topSellers', topSellers);
  summary.setup = val('setup', setup);
  summary.ordersLastSyncedAt = val('meta', meta);
  return summary;
}
