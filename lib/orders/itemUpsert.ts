/**
 * OrderItem upsert (W4 T2). Shared by every order writer (orderSync batch
 * writer, upsertEtsyReceipt, Trendyol/Wix/Shopify syncs).
 *
 * Never delete+recreate: Shipment.orderItem and LabelJob.orderItem are
 * onDelete: Cascade, so recreating items wipes label records.
 *  - Lines are matched by line key (uniqueLineKey, else remoteLineId, else marketplaceKey).
 *  - Matched rows are updated only for fields that actually differ; a manual
 *    weight edit (weightEditedAt) is never overwritten.
 *  - Unmatched incoming lines are created.
 *  - Rows missing remotely are deleted ONLY when no Shipment or LabelJob
 *    references them.
 *
 * `db` may be the prisma client or an interactive transaction client; this
 * function never opens its own transaction (an interactive tx client has no
 * $transaction, which silently broke the legacy writer for mixed batches).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { lineKeyFor } from './orderHash';

export type UpsertLine = {
  lineKey: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  weightKg: number;
  harmonizedCode?: string | null;
  countryOfMfg?: string | null;
  sku?: string | null;
  image?: string | null;
  variantInfo?: string | null;
  notes?: string | null;
  orderNumber?: string | null;
  shipBy?: Date | null;
  listingRef?: string | null;
  variantRef?: string | null;
  variantValueKey?: string | null;
  recipientEmail?: string | null;
};

export type ItemUpsertResult = { created: number; updated: number; unchanged: number; deleted: number; keptReferenced: number };

type Db = PrismaClient | Prisma.TransactionClient;

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** UIOrder line_items -> UpsertLine[] (same field mapping as the legacy orderSync writer). */
export function linesFromUIOrder(order: {
  marketplaceKey: string;
  orderNumber?: string | null;
  shipByDate?: string | null;
  customerNote?: string | null;
  notes?: string | null;
  line_items?: any[] | null;
}): UpsertLine[] {
  const items = Array.isArray(order.line_items) ? order.line_items : [];
  return items.map((item: any, i: number) => {
    const qty = Math.max(1, Math.trunc(Number(item?.quantity) || 1));
    const unit = Number(item?.value) || 0;
    return {
      lineKey: lineKeyFor(item?.id, order.marketplaceKey, i),
      productName: item?.title || 'Unknown Product',
      quantity: qty,
      unitPrice: unit,
      weightKg: Number(item?.weight) || 0.5,
      harmonizedCode: item?.hs_code || '',
      countryOfMfg: item?.country_of_origin || '',
      sku: item?.sku || '',
      image: item?.image || '',
      variantInfo: item?.variantInfo || '',
      notes: item?.notes || item?.description || order.notes || order.customerNote || '',
      orderNumber: order.orderNumber || '',
      shipBy: toDate(item?.shipBy || order.shipByDate),
      listingRef: item?.listingRef ? String(item.listingRef) : null,
      variantRef: item?.variantRef ?? null,
      variantValueKey: item?.variantValueKey ?? null,
    };
  });
}

function sameDecimal(a: unknown, b: number): boolean {
  if (a === null || a === undefined) return false;
  const n = Number((a as any).toString());
  return Number.isFinite(n) && Math.abs(n - b) < 0.005;
}

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

/** Fields of an existing row that differ from the incoming line (pure; exported for tests). */
export function diffItem(existing: any, line: UpsertLine): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const total = line.unitPrice * line.quantity;
  if (str(existing.productName) !== str(line.productName)) data.productName = line.productName;
  if (Number(existing.quantity) !== line.quantity) data.quantity = line.quantity;
  if (!sameDecimal(existing.unitPrice, line.unitPrice)) data.unitPrice = line.unitPrice;
  if (!sameDecimal(existing.totalPrice, total)) data.totalPrice = total;
  if (!existing.weightEditedAt && Number(existing.weightKg) !== line.weightKg) data.weightKg = line.weightKg;
  if (line.harmonizedCode !== undefined && str(existing.harmonizedCode) !== str(line.harmonizedCode)) data.harmonizedCode = line.harmonizedCode;
  if (line.countryOfMfg !== undefined && str(existing.countryOfMfg) !== str(line.countryOfMfg)) data.countryOfMfg = line.countryOfMfg;
  if (str(existing.sku) !== str(line.sku)) data.sku = line.sku ?? '';
  // Never blank out an image we already have.
  if (line.image && str(existing.image) !== str(line.image)) data.image = line.image;
  if (str(existing.variantInfo) !== str(line.variantInfo)) data.variantInfo = line.variantInfo ?? '';
  if (line.notes && str(existing.notes) !== str(line.notes)) data.notes = line.notes;
  if (line.orderNumber && str(existing.orderNumber) !== str(line.orderNumber)) data.orderNumber = line.orderNumber;
  if (line.shipBy && !sameDate(existing.shipBy, line.shipBy)) data.shipBy = line.shipBy;
  if (line.listingRef && str(existing.listingRef) !== str(line.listingRef)) data.listingRef = line.listingRef;
  if (line.variantRef !== undefined && line.variantRef !== null && str(existing.variantRef) !== str(line.variantRef)) data.variantRef = line.variantRef;
  if (line.variantValueKey !== undefined && line.variantValueKey !== null && str(existing.variantValueKey) !== str(line.variantValueKey)) data.variantValueKey = line.variantValueKey;
  if (line.recipientEmail && str(existing.recipientEmail) !== str(line.recipientEmail)) data.recipientEmail = line.recipientEmail;
  if (!existing.uniqueLineKey) data.uniqueLineKey = line.lineKey;
  if (!existing.remoteLineId) data.remoteLineId = line.lineKey;
  if (!existing.marketplaceKey) data.marketplaceKey = line.lineKey;
  return data;
}

function rowKey(r: { uniqueLineKey?: string | null; remoteLineId?: string | null; marketplaceKey?: string | null; id: string }): string {
  return r.uniqueLineKey || r.remoteLineId || r.marketplaceKey || r.id;
}

export async function upsertOrderItems(db: Db, orderId: string, lines: UpsertLine[]): Promise<ItemUpsertResult> {
  const result: ItemUpsertResult = { created: 0, updated: 0, unchanged: 0, deleted: 0, keptReferenced: 0 };
  const existing = await db.orderItem.findMany({ where: { orderId } });

  const byKey = new Map<string, (typeof existing)[number]>();
  for (const ex of existing) {
    const k = rowKey(ex);
    if (!byKey.has(k)) byKey.set(k, ex);
    // Legacy rows may carry the key only in remoteLineId.
    if (ex.remoteLineId && !byKey.has(ex.remoteLineId)) byKey.set(ex.remoteLineId, ex);
  }

  const kept = new Set<string>();
  const seenKeys = new Set<string>();
  for (const line of lines) {
    if (seenKeys.has(line.lineKey)) continue; // duplicate line key in payload: first wins
    seenKeys.add(line.lineKey);
    const match = byKey.get(line.lineKey);
    if (match && !kept.has(match.id)) {
      kept.add(match.id);
      const data = diffItem(match, line);
      if (Object.keys(data).length === 0) {
        result.unchanged++;
        continue;
      }
      await db.orderItem.update({ where: { id: match.id }, data });
      result.updated++;
      continue;
    }
    const created = await db.orderItem.create({
      data: {
        orderId,
        productName: line.productName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.unitPrice * line.quantity,
        weightKg: line.weightKg,
        harmonizedCode: line.harmonizedCode ?? '',
        countryOfMfg: line.countryOfMfg ?? '',
        sku: line.sku ?? '',
        image: line.image ?? '',
        variantInfo: line.variantInfo ?? '',
        notes: line.notes ?? '',
        marketplaceKey: line.lineKey,
        orderNumber: line.orderNumber ?? '',
        uniqueLineKey: line.lineKey,
        remoteLineId: line.lineKey,
        productId: null,
        shipBy: line.shipBy ?? null,
        listingRef: line.listingRef ?? null,
        variantRef: line.variantRef ?? null,
        variantValueKey: line.variantValueKey ?? null,
        recipientEmail: line.recipientEmail ?? null,
      },
    });
    kept.add(created.id);
    result.created++;
  }

  const stale = existing.filter((ex) => !kept.has(ex.id)).map((ex) => ex.id);
  if (stale.length > 0 && lines.length > 0) {
    // An empty incoming line list is treated as "marketplace did not send lines", never as "delete all".
    const del = await db.orderItem.deleteMany({
      where: { id: { in: stale }, orderId, shipments: { none: {} }, labelJobs: { none: {} } },
    });
    result.deleted = del.count;
    result.keptReferenced = stale.length - del.count;
  }
  return result;
}

/**
 * Order-level ship-by: the earliest valid line ship-by (same precedence as
 * EFFECTIVE_SHIP_BY_SQL in lib/orders/views.ts, which reads Order.shipByAt
 * first). null when no line has one.
 */
export function earliestLineShipBy(lines: ReadonlyArray<{ shipBy?: Date | null }>): Date | null {
  let min: Date | null = null;
  for (const l of lines) {
    const d = l.shipBy;
    if (d instanceof Date && Number.isFinite(d.getTime()) && (!min || d < min)) min = d;
  }
  return min;
}
