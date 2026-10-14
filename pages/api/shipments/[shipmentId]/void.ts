import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logShippingEvent } from '@/lib/admin/events';
import { publishLive, publishOrderEvent } from '@/lib/live/publish';
import { resolveCancelledAfterLabel } from '@/lib/orders/orderEffects';

/**
 * POST /api/shipments/[shipmentId]/void   (W4 T9; DELETE /api/shipments/[id]/delete is unchanged)
 *
 * body { action: 'carrier' }         MNG: cancels at MNG (cancelMngShipment) -> 'voided' (voidMethod carrier_api).
 *                                    UPS / FedEx: no void API wired -> 'void_requested' + code MANUAL_VOID_REQUIRED
 *                                    and the carrier portal URL; the user cancels there, then confirms.
 * body { action: 'confirm_manual' }  "Manuel iptal ettim" -> 'voided' (voidMethod manual).
 *
 * shipmentId may also be `order:<orderId>` for FedEx labels that live on the
 * order row (labelStatus/shippingLabelUrl + LabelJob) instead of a Shipment row:
 * 'carrier' answers MANUAL_VOID_REQUIRED, 'confirm_manual' resolves the alert.
 *
 * Both successful paths resolve the orderCanceledAfterLabel notification.
 */

const CARRIER_PORTALS: Record<string, string> = {
  UPS: 'https://www.ups.com/',
  FEDEX: 'https://www.fedex.com/',
  MNG: 'https://www.mngkargo.com.tr/',
};

function portalFor(carrier: string): string | null {
  return CARRIER_PORTALS[String(carrier || '').toUpperCase()] || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const shipmentId = typeof req.query.shipmentId === 'string' ? req.query.shipmentId : '';
  const action = req.body?.action;
  if (!shipmentId || shipmentId.length > 80) return res.status(400).json({ error: 'shipmentId required' });
  if (action !== 'carrier' && action !== 'confirm_manual') {
    return res.status(400).json({ error: "action must be 'carrier' or 'confirm_manual'" });
  }

  try {
    // Order-level FedEx label (no Shipment row).
    if (shipmentId.startsWith('order:')) {
      const orderId = shipmentId.slice('order:'.length);
      const order = await prisma.order.findFirst({ where: { id: orderId, userId: user.id }, select: { id: true } });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (action === 'carrier') {
        return res.status(200).json({
          success: true,
          status: 'void_requested',
          code: 'MANUAL_VOID_REQUIRED',
          messageKey: 'orderPipeline.void.manualRequired',
          carrierPortalUrl: portalFor('FEDEX'),
        });
      }
      // Persist the void: labelStatus 'voided' makes hasLegacyOrderLabel() false, so
      // lifecycle-flags / label guard / dispatch stop treating the order as labelled.
      // shippingLabelUrl is kept for the record.
      const now = new Date();
      const updatedOrder = await prisma.$transaction(async (tx) => {
        const row = await tx.order.update({ where: { id: order.id }, data: { labelStatus: 'voided' } });
        await tx.labelJob.updateMany({
          where: { orderItem: { orderId: order.id }, status: { notIn: ['voided', 'failed', 'error'] } },
          data: { status: 'voided' },
        });
        return row;
      });
      await resolveCancelledAfterLabel(user.id, order.id);
      publishLive(user.id, { type: 'shipment', kind: 'voided', orderId: order.id, shipmentId: null, carrier: 'FEDEX', trackingNumber: updatedOrder.trackingNumber });
      publishOrderEvent(user.id, updatedOrder, 'updated');
      logShippingEvent('info', { message: 'Order-level label marked voided manually', operation: 'shipments.void.manual', userId: user.id, details: { orderId, at: now.toISOString() } });
      return res.status(200).json({ success: true, status: 'voided', voidMethod: 'manual' });
    }

    const shipment = await prisma.shipment.findFirst({
      where: { id: shipmentId },
      include: { order: { select: { id: true, userId: true } } },
    });
    if (!shipment || shipment.order.userId !== user.id) return res.status(404).json({ error: 'Shipment not found' });
    if (shipment.status === 'voided') return res.status(200).json({ success: true, status: 'voided', voidMethod: shipment.voidMethod });

    const carrier = String(shipment.carrier || '').toUpperCase();
    const now = new Date();

    if (action === 'confirm_manual') {
      const updated = await prisma.shipment.update({
        where: { id: shipment.id },
        data: { status: 'voided', voidedAt: now, voidMethod: 'manual', voidError: null },
      });
      await resolveCancelledAfterLabel(user.id, shipment.order.id);
      publishLive(user.id, { type: 'shipment', kind: 'voided', orderId: shipment.order.id, shipmentId: shipment.id, carrier, trackingNumber: shipment.trackingNumber });
      void prisma.order.findFirst({ where: { id: shipment.order.id } }).then((row) => row && publishOrderEvent(user.id, row, 'updated')).catch(() => undefined);
      logShippingEvent('info', { message: 'Shipment marked voided manually', operation: 'shipments.void.manual', userId: user.id, details: { shipmentId: shipment.id, carrier } });
      return res.status(200).json({ success: true, status: updated.status, voidMethod: 'manual' });
    }

    // action === 'carrier'
    if (carrier === 'MNG') {
      if (!shipment.trackingNumber) {
        return res.status(422).json({ success: false, code: 'VOID_FAILED', messageKey: 'orderPipeline.void.failed', error: 'No MNG barcode on this shipment' });
      }
      try {
        const { getMngCredentialsForUser } = await import('@/lib/mng/mng.credentials');
        const { cancelMngShipment } = await import('@/lib/mng/mng.service');
        const creds = await getMngCredentialsForUser(user.id);
        const r = await cancelMngShipment(creds, shipment.trackingNumber);
        if (!r.isSuccess) throw new Error(r.message || 'MNG cancel rejected');
        await prisma.shipment.update({
          where: { id: shipment.id },
          data: { status: 'voided', voidedAt: now, voidMethod: 'carrier_api', voidError: null },
        });
        await resolveCancelledAfterLabel(user.id, shipment.order.id);
        publishLive(user.id, { type: 'shipment', kind: 'voided', orderId: shipment.order.id, shipmentId: shipment.id, carrier, trackingNumber: shipment.trackingNumber });
        logShippingEvent('info', { message: 'MNG shipment voided via carrier API', operation: 'shipments.void.carrier', userId: user.id, details: { shipmentId: shipment.id } });
        return res.status(200).json({ success: true, status: 'voided', voidMethod: 'carrier_api' });
      } catch (err: any) {
        const message = String(err?.message || err).slice(0, 300);
        await prisma.shipment.update({ where: { id: shipment.id }, data: { voidError: message } }).catch(() => undefined);
        logShippingEvent('warn', { message: 'MNG shipment void failed', operation: 'shipments.void.failed', userId: user.id, details: { shipmentId: shipment.id, error: message } });
        return res.status(502).json({ success: false, code: 'VOID_FAILED', messageKey: 'orderPipeline.void.failed', error: message, carrierPortalUrl: portalFor(carrier) });
      }
    }

    // UPS / FedEx / other: no void API wired — the user voids in the carrier portal, then confirms.
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'void_requested' } });
    publishLive(user.id, { type: 'shipment', kind: 'void_requested', orderId: shipment.order.id, shipmentId: shipment.id, carrier, trackingNumber: shipment.trackingNumber });
    return res.status(200).json({
      success: true,
      status: 'void_requested',
      code: 'MANUAL_VOID_REQUIRED',
      messageKey: 'orderPipeline.void.manualRequired',
      carrierPortalUrl: portalFor(carrier),
    });
  } catch (error: any) {
    console.error('[shipments/void] error', error?.message || error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
