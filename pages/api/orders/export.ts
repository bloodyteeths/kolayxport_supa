import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { safeDate, safeIsoDate } from '@/lib/utils/safeDate';
import { queryValues, expandStatusFilter } from './index';
import { parseIds } from './print-data';
import { FAILED_LABEL_SQL } from '@/lib/orders/views';
import {
  EXPORT_MAX_ORDERS,
  isExportFormat,
  mapOrderToExportRow,
  dedupeOrders,
  getExportLabels,
  ordersTable,
  toCsv,
  toXlsx,
  toPdf,
  safeTimeZone,
  localIsoDay,
  type ExportFormat,
  type ExportLocale,
} from '@/lib/export/orders';

/**
 * Export the user's orders as CSV / XLSX / PDF.
 *
 *   GET  /api/orders/export?format=csv&ids=a,b,c
 *   GET  /api/orders/export?format=xlsx&scope=filters&<same params as /api/orders>
 *   GET  /api/orders/export?format=pdf&filters=<urlencoded /api/orders query string>
 *   POST /api/orders/export  { format, ids?: string[], filters?: Record<string, string|string[]>, locale?, tz? }
 *
 * POST exists because 1000 cuid ids (~26 KB) exceed typical URL/header limits
 * (nginx 8 KB, Node 16 KB); the labels page uses it. POST must be JSON, so a
 * cross-site form cannot trigger it.
 *
 * Ownership: every query is scoped by userId. Max 1000 orders (413 above that).
 */

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } };

type Query = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return x === undefined || x === '' ? undefined : String(x);
};

// Label predicates copied verbatim from pages/api/orders/index.ts so the export
// returns exactly the rows the list counts as matching. Note the list's two
// predicates are not exact complements: an empty-string trackingNumber /
// shippingLabelUrl satisfies both "labeled" (IS NOT NULL) and "unlabeled"
// (= ''). That quirk lives in the list; we mirror it rather than diverge.
const LIST_LABELED_SQL = `(
  o."trackingNumber" IS NOT NULL OR
  o."shippingLabelUrl" IS NOT NULL OR
  o."labelStatus" = 'created' OR
  EXISTS (SELECT 1 FROM "Shipment" s WHERE s."orderId" = o.id AND s.status = 'created' AND (s."trackingNumber" IS NOT NULL OR s."pdfUrl" IS NOT NULL))
)`;
const LIST_UNLABELED_SQL = `(
  (o."trackingNumber" IS NULL OR o."trackingNumber" = '') AND
  (o."shippingLabelUrl" IS NULL OR o."shippingLabelUrl" = '') AND
  (o."labelStatus" IS NULL OR o."labelStatus" != 'created') AND
  NOT EXISTS (SELECT 1 FROM "Shipment" s WHERE s."orderId" = o.id AND s.status = 'created' AND (s."trackingNumber" IS NOT NULL OR s."pdfUrl" IS NOT NULL))
)`;
// Used only for the shipBy sort (labeled orders last).
const LABELED_SORT_SQL = `(
  (o."trackingNumber" IS NOT NULL AND o."trackingNumber" != '') OR
  (o."shippingLabelUrl" IS NOT NULL AND o."shippingLabelUrl" != '') OR
  COALESCE(o."labelStatus", '') = 'created' OR
  EXISTS (SELECT 1 FROM "Shipment" s WHERE s."orderId" = o.id AND s.status = 'created' AND (s."trackingNumber" IS NOT NULL OR s."pdfUrl" IS NOT NULL))
)`;

/**
 * WHERE / ORDER BY for the filter scope. Kept in step with the labels-page
 * branch of pages/api/orders/index.ts (that handler builds its SQL inline, so
 * it cannot be imported; queryValues / expandStatusFilter are shared).
 */
export function buildFilterSql(userId: string, q: Query): { where: string; params: unknown[]; orderBy: string } {
  let where = `WHERE o."userId" = $1 AND LOWER(o."status") NOT IN ('awaiting_payment', 'pending_payment')`;
  const params: unknown[] = [userId];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  const search = (first(q.search) || '').trim();
  const searchType = first(q.searchType) || 'all';
  if (search) {
    const p = add(`%${search}%`);
    switch (searchType) {
      case 'customer':
        where += ` AND (o."customerName" ILIKE ${p} OR o."shippingAddress"::text ILIKE ${p})`;
        break;
      case 'order':
        where += ` AND o."orderNumber" ILIKE ${p}`;
        break;
      case 'tracking':
        where += ` AND (o."trackingNumber" ILIKE ${p} OR o."rawData"::text ILIKE ${p}
          OR EXISTS (SELECT 1 FROM "Shipment" s WHERE s."orderId" = o.id AND s."trackingNumber" ILIKE ${p})
          OR EXISTS (SELECT 1 FROM "TrackingSubmission" ts WHERE ts."orderId" = o.id AND ts."trackingNumber" ILIKE ${p}))`;
        break;
      case 'marketplace':
        where += ` AND o."marketplace" ILIKE ${p}`;
        break;
      case 'product':
        where += ` AND EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id AND oi."productName" ILIKE ${p})`;
        break;
      case 'sku':
        where += ` AND EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id AND oi."sku" ILIKE ${p})`;
        break;
      case 'city':
        params[params.length - 1] = `%"city"%${search}%`;
        where += ` AND o."shippingAddress"::text ILIKE ${p}`;
        break;
      case 'phone':
        params[params.length - 1] = `%"phone"%${search}%`;
        where += ` AND o."shippingAddress"::text ILIKE ${p}`;
        break;
      case 'note':
        where += ` AND (o."rawData"::text ILIKE ${p} OR EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id AND oi."notes" ILIKE ${p}))`;
        break;
      default:
        where += ` AND (
          o."orderNumber" ILIKE ${p} OR o."customerName" ILIKE ${p} OR o."marketplace" ILIKE ${p} OR
          o."trackingNumber" ILIKE ${p} OR o."rawData"::text ILIKE ${p} OR o."shippingAddress"::text ILIKE ${p} OR
          EXISTS (SELECT 1 FROM "Shipment" s WHERE s."orderId" = o.id AND s."trackingNumber" ILIKE ${p}) OR
          EXISTS (SELECT 1 FROM "TrackingSubmission" ts WHERE ts."orderId" = o.id AND ts."trackingNumber" ILIKE ${p}) OR
          EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id AND (oi."productName" ILIKE ${p} OR oi."sku" ILIKE ${p}))
        )`;
    }
  }

  const statuses = expandStatusFilter(queryValues(q.status, true));
  if (statuses.length > 0) where += ` AND LOWER(o."status") IN (${statuses.map(add).join(', ')})`;

  const marketplaces = queryValues(q.marketplace);
  if (marketplaces.length > 0) where += ` AND o."marketplace" IN (${marketplaces.map(add).join(', ')})`;

  const labelStatus = first(q.labelStatus);
  if (labelStatus === 'created') where += ` AND ${LIST_LABELED_SQL}`;
  else if (labelStatus === 'not_created') where += ` AND ${LIST_UNLABELED_SQL}`;
  // Same clause as /api/orders?labelStatus=failed so the list and "Export all matching filters" agree.
  else if (labelStatus === 'failed') where += ` AND ${FAILED_LABEL_SQL}`;

  const labelFilter = first(q.labelFilter);
  if (labelFilter === 'labeled') where += ` AND ${LIST_LABELED_SQL}`;
  else if (labelFilter === 'unlabeled') where += ` AND ${LIST_UNLABELED_SQL}`;

  // Like the list: a search ignores the date window.
  const startDate = first(q.startDate);
  const endDate = first(q.endDate);
  if (startDate && !search && safeDate(startDate)) {
    where += ` AND COALESCE(o."uiOrderDate", o."createdAt") >= ${add(startDate)}::timestamp`;
  }
  if (endDate && !search) {
    const endIso = safeIsoDate(endDate + 'T23:59:59.999Z');
    if (endIso) where += ` AND COALESCE(o."uiOrderDate", o."createdAt") <= ${add(endIso)}::timestamp`;
  }

  const sort = (first(q.sort) || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const orderByMap: Record<string, string> = {
    orderDate: `COALESCE(o."uiOrderDate", o."createdAt") ${sort}`,
    shipBy: `CASE WHEN ${LABELED_SORT_SQL} OR UPPER(o."status") IN ('SHIPPED','PARTIALLY_SHIPPED','DELIVERED','COMPLETED','CANCELLED','CANCELED','REFUNDED') THEN 1 ELSE 0 END ASC,
      (SELECT MIN(oi2."shipBy") FROM "OrderItem" oi2 WHERE oi2."orderId" = o.id) ${sort} NULLS LAST,
      COALESCE(o."uiOrderDate", o."createdAt") DESC`,
    price: `o."totalPrice" ${sort} NULLS LAST`,
    customer: `o."customerName" ${sort} NULLS LAST`,
  };
  const orderBy = orderByMap[first(q.sortBy) || 'orderDate'] || orderByMap.orderDate;
  return { where, params, orderBy };
}

/** Filter params from `?filters=<qs>`, a POST body object, or the flat query. */
function readFilters(req: NextApiRequest): Query {
  const body = req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : null;
  if (body?.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)) {
    const out: Query = {};
    for (const [k, v] of Object.entries(body.filters as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
      else if (Array.isArray(v)) out[k] = v.filter(x => typeof x === 'string') as string[];
    }
    return out;
  }
  const encoded = first(req.query.filters);
  if (encoded) {
    const sp = new URLSearchParams(encoded);
    const out: Query = {};
    for (const key of Array.from(new Set(sp.keys()))) {
      const all = sp.getAll(key);
      out[key] = all.length > 1 ? all : all[0];
    }
    return out;
  }
  return req.query as Query;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  res.setHeader('Cache-Control', 'private, no-store');

  const user = await getAuthUser(req, res, { allowBearer: false });
  if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });

  const body = req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : {};
  const format = (body.format ?? first(req.query.format)) as unknown;
  if (!isExportFormat(format)) return res.status(400).json({ error: 'format must be csv, xlsx or pdf' });
  const localeRaw = body.locale ?? first(req.query.locale);
  const locale: ExportLocale = localeRaw === 'en' ? 'en' : 'tr';
  const timeZone = safeTimeZone(body.tz ?? first(req.query.tz));

  // Scope is decided by whether `ids` is PRESENT, not whether it is non-empty:
  // an emptied selection must not silently widen to "all matching filters".
  const idsPresent = req.method === 'POST' ? Object.prototype.hasOwnProperty.call(body, 'ids') : req.query.ids !== undefined;
  const rawIds: string | string[] | undefined = req.method === 'POST'
    ? (Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : typeof body.ids === 'string' ? body.ids : [])
    : req.query.ids;
  const scope: 'ids' | 'filters' = idsPresent ? 'ids' : 'filters';

  try {
    let ids: string[];
    if (scope === 'ids') {
      const parsed = parseIds(rawIds);
      if (parsed.ids.length + parsed.rejected > EXPORT_MAX_ORDERS) {
        return res.status(413).json({
          error: `Too many orders: at most ${EXPORT_MAX_ORDERS} can be exported at once.`,
          max: EXPORT_MAX_ORDERS,
          count: parsed.ids.length + parsed.rejected,
        });
      }
      ids = parsed.ids;
      if (ids.length === 0) return res.status(400).json({ error: 'No valid order ids' });
    } else {
      const { where, params, orderBy } = buildFilterSql(user.id, readFilters(req));
      const countRows = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM "Order" o ${where}`, ...params)) as Array<{ total: number }>;
      const total = Number(countRows[0]?.total || 0);
      if (total > EXPORT_MAX_ORDERS) {
        return res.status(413).json({
          error: `Too many orders (${total}): at most ${EXPORT_MAX_ORDERS} can be exported at once. Narrow the filters or the date range.`,
          max: EXPORT_MAX_ORDERS,
          count: total,
        });
      }
      const idRows = (await prisma.$queryRawUnsafe(
        `SELECT o.id FROM "Order" o ${where} ORDER BY ${orderBy} LIMIT ${EXPORT_MAX_ORDERS}`,
        ...params,
      )) as Array<{ id: string }>;
      ids = idRows.map(r => r.id);
    }

    const found = ids.length === 0 ? [] : await prisma.order.findMany({
      // userId is the ownership check: other users' ids simply do not come back.
      where: { id: { in: ids }, userId: user.id },
      select: {
        id: true, orderNumber: true, marketplace: true, status: true, labelStatus: true, trackingNumber: true,
        shippingLabelUrl: true, currency: true, totalPrice: true, manualShippingCost: true,
        manualShippingCostCurrency: true, customerName: true, createdAt: true, uiOrderDate: true,
        shippingAddress: true, rawData: true,
        items: {
          select: { sku: true, productName: true, variantInfo: true, quantity: true, unitPrice: true, totalPrice: true, notes: true, recipientEmail: true },
          orderBy: { id: 'asc' },
        },
        shipping: {
          select: { firstName: true, lastName: true, company: true, street1: true, street2: true, city: true, state: true, postalCode: true, countryCode: true, phone: true },
        },
        shipments: { select: { carrier: true, status: true, trackingNumber: true, pdfUrl: true }, orderBy: { createdAt: 'desc' } },
        trackingSubmissions: { select: { carrierName: true, trackingNumber: true }, orderBy: { submittedAt: 'desc' } },
        senkronData: { select: { internalNote: true } },
      },
    });

    // Keep the caller's order (selection order, or the list sort for filters).
    const byId = new Map(found.map(o => [o.id, o]));
    let ordered = ids.map(id => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o);
    if (scope === 'filters') ordered = dedupeOrders(ordered);

    const rows = ordered.map(o => mapOrderToExportRow(o, { locale, timeZone }));
    const labels = getExportLabels(locale);

    let payload: Buffer | string;
    let unicodeFont: boolean | undefined;
    if (format === 'csv') payload = toCsv(ordersTable(rows, labels), { locale });
    else if (format === 'xlsx') payload = toXlsx(rows, labels);
    else {
      const pdf = await toPdf(rows, labels, { locale, timeZone });
      payload = pdf.buffer;
      unicodeFont = pdf.unicodeFont;
    }

    const filename = `orders-${localIsoDay(new Date(), timeZone)}.${format}`;
    res.setHeader('Content-Type', CONTENT_TYPES[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Count');

    // Counts only — no order numbers, names or addresses.
    logger.info('[orders/export] export generated', {
      userId: user.id, format, scope, requested: ids.length, exported: rows.length, unicodeFont,
    });

    return res.status(200).send(payload);
  } catch (err) {
    console.error('[orders/export] failed', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Export failed' });
  }
}
