/**
 * Per-order lifecycle flags for the labels page badges (W4 T16 data source).
 * Pure builder + one batched DB read. Shared by GET/POST /api/orders/lifecycle-flags.
 */
import prisma from '@/lib/prisma';
import { classifyOrderStatus, hasLegacyOrderLabel, type OrderStatusClass } from './orderStatus';
import { computeDispatchState, type DispatchState } from './dispatch';

export type OrderLifecycleFlags = {
  statusClass: OrderStatusClass;
  cancelled: boolean;
  cancelledAt: string | null;
  /** cancelled while a KolayXport label is still active (not voided) */
  cancelledAfterLabel: boolean;
  /** marketplace shows it shipped, but no KolayXport label/tracking exists */
  shippedExternally: boolean;
  /** open and past its ship-by date */
  late: boolean;
  shippedLate: boolean | null;
  dispatchState: DispatchState | null;
  shipByAt: string | null;
  deliveredAt: string | null;
  returnWindowEndsAt: string | null;
  activeShipment: { id: string; carrier: string; trackingNumber: string | null; status: string } | null;
  /** id to pass to POST /api/shipments/[id]/void ('order:<id>' for FedEx order-level labels) */
  voidTargetId: string | null;
  voidRequested: boolean;
  labelCost: number | null;
  labelCostCurrency: string | null;
};

const VOID_STATUSES = new Set(['voided', 'void_requested', 'error', 'failed', 'cancelled', 'canceled']);

type Row = {
  id: string;
  status: string | null;
  externalStatus: string | null;
  source: string | null;
  rawData: any;
  trackingNumber: string | null;
  labelStatus: string | null;
  shippingLabelUrl: string | null;
  cancelledAt: Date | null;
  shipByAt: Date | null;
  shippedLate: boolean | null;
  deliveredAt: Date | null;
  returnWindowEndsAt: Date | null;
  lastEventAt: Date | null;
  manualShippingCost: any;
  manualShippingCostCurrency: string | null;
  shipments: Array<{ id: string; carrier: string; status: string; trackingNumber: string | null; pdfUrl: string | null; voidedAt: Date | null }>;
  _count: { trackingSubmissions: number };
};

export function buildLifecycleFlags(o: Row, now = new Date()): OrderLifecycleFlags {
  const statusClass = classifyOrderStatus(o.status, o.externalStatus, o.deliveredAt);
  const active = o.shipments.find((s) => !s.voidedAt && !VOID_STATUSES.has(String(s.status || '').toLowerCase()) && !!(s.trackingNumber || s.pdfUrl)) || null;
  const voidRequested = o.shipments.some((s) => String(s.status).toLowerCase() === 'void_requested' && !s.voidedAt);
  const legacyLabel = hasLegacyOrderLabel(o);
  const kxLabel = !!active || legacyLabel || o._count.trackingSubmissions > 0;
  const cancelled = statusClass === 'cancelled';
  const isEtsy = o.source === 'etsy-api' || !!(o.rawData && typeof o.rawData === 'object' && (o.rawData as any).receipt_id);
  return {
    statusClass,
    cancelled,
    cancelledAt: o.cancelledAt ? o.cancelledAt.toISOString() : null,
    cancelledAfterLabel: cancelled && (!!active || legacyLabel),
    shippedExternally: (statusClass === 'shipped' || statusClass === 'delivered') && !kxLabel && !!o.lastEventAt,
    late: statusClass === 'open' && !!o.shipByAt && o.shipByAt.getTime() < now.getTime(),
    shippedLate: o.shippedLate,
    dispatchState:
      isEtsy && statusClass !== 'cancelled'
        ? computeDispatchState({ rawData: o.rawData, trackingNumber: o.trackingNumber, hasActiveShipment: !!active, hasLegacyLabel: legacyLabel })
        : null,
    shipByAt: o.shipByAt ? o.shipByAt.toISOString() : null,
    deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
    returnWindowEndsAt: o.returnWindowEndsAt ? o.returnWindowEndsAt.toISOString() : null,
    activeShipment: active ? { id: active.id, carrier: active.carrier, trackingNumber: active.trackingNumber, status: active.status } : null,
    voidTargetId: active ? active.id : legacyLabel ? `order:${o.id}` : null,
    voidRequested,
    labelCost: o.manualShippingCost !== null && o.manualShippingCost !== undefined ? Number(o.manualShippingCost.toString()) : null,
    labelCostCurrency: o.manualShippingCostCurrency,
  };
}

export async function getLifecycleFlags(userId: string, ids: string[]): Promise<Record<string, OrderLifecycleFlags>> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64))).slice(0, 200);
  if (unique.length === 0) return {};
  const rows = await prisma.order.findMany({
    where: { userId, id: { in: unique } },
    select: {
      id: true,
      status: true,
      externalStatus: true,
      source: true,
      rawData: true,
      trackingNumber: true,
      labelStatus: true,
      shippingLabelUrl: true,
      cancelledAt: true,
      shipByAt: true,
      shippedLate: true,
      deliveredAt: true,
      returnWindowEndsAt: true,
      lastEventAt: true,
      manualShippingCost: true,
      manualShippingCostCurrency: true,
      shipments: { select: { id: true, carrier: true, status: true, trackingNumber: true, pdfUrl: true, voidedAt: true }, orderBy: { createdAt: 'desc' } },
      _count: { select: { trackingSubmissions: true } },
    },
  });
  const now = new Date();
  const out: Record<string, OrderLifecycleFlags> = {};
  for (const r of rows) out[r.id] = buildLifecycleFlags(r as Row, now);
  return out;
}
