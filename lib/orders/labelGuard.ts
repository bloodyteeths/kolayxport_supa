/**
 * Label safety guard for all four label routes (W4 T8):
 * pages/api/orders/[orderId]/generate-label.ts (FedEx), pages/api/labels/ups.ts,
 * pages/api/labels/mng.ts, pages/api/shipments/index.ts.
 *
 * Called after auth and BEFORE any carrier call (buying a label is
 * irreversible). Refuses with HTTP 409 when the order is
 *   - cancelled / refunded                       -> ORDER_CANCELLED
 *   - shipped on the marketplace without any KolayXport label/tracking and the
 *     shipment came from a marketplace event     -> ORDER_SHIPPED_EXTERNALLY
 * `override: true` (request body `forceCancelled: true`, after the user
 * confirmed CancelledOrderLabelDialog) skips the guard.
 *
 * Direct Etsy orders whose last remote check is older than 10 minutes are
 * re-read live first (one receipt GET at Critical priority + upsert). Any
 * failure of that re-check is logged and the guard falls back to the stored
 * state — Etsy being down must not block shipping.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { classifyOrderStatus, hasLegacyOrderLabel, isCancelledStatus } from './orderStatus';
import { etsyShopCandidatesForOrder } from './etsyShopResolve';

export type LabelGuardCode = 'ORDER_CANCELLED' | 'ORDER_SHIPPED_EXTERNALLY';

export type LabelGuardResult = { ok: true } | { ok: false; httpStatus: 409; code: LabelGuardCode; messageKey: string };

export const LABEL_GUARD_MESSAGE_KEYS: Record<LabelGuardCode, string> = {
  ORDER_CANCELLED: 'orderPipeline.labelGuard.cancelled',
  ORDER_SHIPPED_EXTERNALLY: 'orderPipeline.labelGuard.shippedExternally',
};

export const STALE_REMOTE_CHECK_MS = 10 * 60 * 1000;
const MAX_SHOP_CANDIDATES = 3;

const VOID_STATUSES = new Set(['voided', 'void_requested', 'error', 'failed', 'cancelled', 'canceled']);

export type GuardOrderState = {
  status: string | null;
  externalStatus: string | null;
  lastEventAt: Date | null;
  trackingNumber: string | null;
  labelStatus: string | null;
  shippingLabelUrl: string | null;
  shipments: Array<{ status: string; trackingNumber: string | null; pdfUrl: string | null; voidedAt: Date | null }>;
  trackingSubmissions: number;
};

/** Pure decision (exported for tests). */
export function evaluateLabelGuard(o: GuardOrderState, override?: boolean): LabelGuardResult {
  if (override) return { ok: true };
  if (isCancelledStatus(o.status, o.externalStatus)) {
    return { ok: false, httpStatus: 409, code: 'ORDER_CANCELLED', messageKey: LABEL_GUARD_MESSAGE_KEYS.ORDER_CANCELLED };
  }
  const cls = classifyOrderStatus(o.status, o.externalStatus);
  if ((cls === 'shipped' || cls === 'delivered') && o.lastEventAt) {
    const kxShipment = o.shipments.some(
      (s) => !s.voidedAt && !VOID_STATUSES.has(String(s.status || '').toLowerCase()) && !!(s.trackingNumber || s.pdfUrl),
    );
    const kxLabel = kxShipment || hasLegacyOrderLabel(o) || o.trackingSubmissions > 0;
    if (!kxLabel) {
      return { ok: false, httpStatus: 409, code: 'ORDER_SHIPPED_EXTERNALLY', messageKey: LABEL_GUARD_MESSAGE_KEYS.ORDER_SHIPPED_EXTERNALLY };
    }
  }
  return { ok: true };
}

async function loadState(orderId: string, userId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      marketplaceKey: true,
      marketplace: true,
      source: true,
      rawData: true,
      status: true,
      externalStatus: true,
      lastEventAt: true,
      lastRemoteCheckAt: true,
      trackingNumber: true,
      labelStatus: true,
      shippingLabelUrl: true,
      shipments: { select: { status: true, trackingNumber: true, pdfUrl: true, voidedAt: true } },
      _count: { select: { trackingSubmissions: true } },
    },
  });
}

/** Live re-check of a stale direct-Etsy order. Returns true when the order was refreshed. */
async function refreshEtsyIfStale(order: NonNullable<Awaited<ReturnType<typeof loadState>>>, userId: string): Promise<boolean> {
  const raw = order.rawData && typeof order.rawData === 'object' ? (order.rawData as any) : null;
  const isEtsy = order.source === 'etsy-api' || !!raw?.receipt_id;
  if (!isEtsy) return false;
  const last = Math.max(order.lastRemoteCheckAt?.getTime() ?? 0, order.lastEventAt?.getTime() ?? 0);
  if (Date.now() - last < STALE_REMOTE_CHECK_MS) return false;
  const receiptId = String(raw?.receipt_id || order.marketplaceKey || '');
  if (!/^\d+$/.test(receiptId)) return false;
  try {
    // Receipts carry no shop_id: resolve by the KX-stored shop id / shop name; when
    // ambiguous (several shops), try each — a receipt GET on the wrong shop returns null.
    const { candidates } = await etsyShopCandidatesForOrder(userId, order);
    if (candidates.length === 0) return false;
    const { fetchEtsyReceiptRaw, upsertEtsyReceipt } = await import('./etsyLifecycle');
    const { EtsyPriority } = await import('@/lib/etsy/rateBudget');
    for (const shopId of candidates.slice(0, MAX_SHOP_CANDIDATES)) {
      const receipt = await fetchEtsyReceiptRaw(userId, shopId, receiptId, EtsyPriority.Critical);
      if (!receipt) continue;
      await upsertEtsyReceipt({ userId, shopId, receipt, source: 'manual' });
      return true;
    }
    logger.warn('[labelGuard] live Etsy re-check found no receipt in any candidate shop; using stored state', { orderId: order.id, shops: candidates.length });
    return false;
  } catch (err) {
    logger.warn('[labelGuard] live Etsy re-check failed; using stored state', { orderId: order.id, error: (err as Error)?.message });
    return false;
  }
}

export async function assertOrderLabelable(orderId: string, userId: string, opts?: { override?: boolean }): Promise<LabelGuardResult> {
  if (opts?.override) return { ok: true };
  let order = await loadState(orderId, userId);
  if (!order) return { ok: true }; // ownership / existence is answered by the route (404)
  if (await refreshEtsyIfStale(order, userId)) {
    order = (await loadState(orderId, userId)) ?? order;
  }
  return evaluateLabelGuard(
    {
      status: order.status,
      externalStatus: order.externalStatus,
      lastEventAt: order.lastEventAt,
      trackingNumber: order.trackingNumber,
      labelStatus: order.labelStatus,
      shippingLabelUrl: order.shippingLabelUrl,
      shipments: order.shipments,
      trackingSubmissions: order._count.trackingSubmissions,
    },
    false,
  );
}

/** Reads the override flag from a label request body (`forceCancelled: true`). */
export function labelGuardOverride(body: unknown): boolean {
  return !!(body && typeof body === 'object' && (body as any).forceCancelled === true);
}
