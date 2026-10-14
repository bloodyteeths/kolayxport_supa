/**
 * Live events after a label route created (or voided) a label. Fire-and-forget,
 * never throws, never blocks the HTTP response.
 */
import prisma from '@/lib/prisma';
import { publishLive, publishOrderEvent } from '@/lib/live/publish';

export function publishLabelCreated(userId: string, orderId: string, a: { carrier: string; trackingNumber?: string | null; shipmentId?: string | null }): void {
  try {
    publishLive(userId, { type: 'shipment', kind: 'created', orderId, shipmentId: a.shipmentId ?? null, carrier: a.carrier, trackingNumber: a.trackingNumber ?? null });
    void prisma.order
      .findFirst({ where: { id: orderId, userId } })
      .then((row) => {
        if (row) publishOrderEvent(userId, row, 'label_created');
      })
      .catch(() => undefined);
  } catch {
    /* never throw */
  }
}

/** JSON body of a label-guard refusal (HTTP 409). */
export function labelGuardBody(g: { code: string; messageKey: string }) {
  return { success: false, code: g.code, messageKey: g.messageKey, error: g.code };
}
