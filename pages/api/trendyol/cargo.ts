/**
 * Trendyol cargo for one stored order. `?action=`:
 *   GET  label   ?orderId=&format=pdf|zpl&boxes=1
 *        pdf → our 100×150 mm cargo label (Code 128 of the cargo number), works for every carrier
 *        zpl → Trendyol's common label (Trendyol Express / Aras on Trendyol-paid cargo) for thermal printers
 *   POST status  { orderId, status: 'Picking' | 'Invoiced', invoiceNumber? }   report the package status to Trendyol
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { isTrendyolEnabled } from '@/lib/config';
import { cargoLabelPdf } from '@/lib/shipping/cargoLabelPdf';
import { contentsOf, fetchCommonLabel, isCommonLabelNotAllowed, loadTrendyolOrder, recipientOf, senderOf, trendyolCargoInfo, trendyolClientFor, trendyolErrorText } from '@/lib/trendyol/cargo';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const CAPTIONS = {
  tr: { recipient: 'Alıcı', sender: 'Gönderen', order: 'Sipariş', package: 'Paket', contents: 'İçerik', deci: 'Desi' },
  en: { recipient: 'Recipient', sender: 'Sender', order: 'Order', package: 'Package', contents: 'Contents', deci: 'Deci' },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!isTrendyolEnabled(user.id)) return res.status(403).json({ error: 'Trendyol is not enabled for this account' });
  const action = str(req.query.action);
  const orderId = str(req.query.orderId) || str(req.body?.orderId);
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  try {
    const loaded = await loadTrendyolOrder(user.id, orderId);
    if (!loaded) return res.status(404).json({ error: 'Trendyol order not found' });
    const info = trendyolCargoInfo(loaded.raw);
    const client = await trendyolClientFor(user.id);

    if (action === 'label' && req.method === 'GET') {
      if (!info.cargoNumber) return res.status(409).json({ error: 'This order has no Trendyol cargo number yet', code: 'no_cargo_number' });
      const format = str(req.query.format).toLowerCase() === 'zpl' ? 'zpl' : 'pdf';
      if (format === 'zpl') {
        if (!client) return res.status(400).json({ error: 'Trendyol credentials not configured' });
        if (!info.commonLabel) return res.status(409).json({ error: 'Trendyol has no common label for this carrier; use the PDF label', code: 'not_common_label' });
        const boxes = Math.min(Math.max(Number(req.query.boxes) || 1, 1), 20);
        const docs = await fetchCommonLabel(client, info.cargoNumber, boxes);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="trendyol-${info.cargoNumber}.zpl"`);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).send(docs.join('\n'));
      }
      const locale = str(req.query.locale) === 'en' ? 'en' : 'tr';
      const pdf = await cargoLabelPdf({
        carrier: info.carrier || 'Trendyol',
        cargoNumber: info.cargoNumber,
        marketplace: 'Trendyol',
        orderNumber: loaded.order.orderNumber || String(loaded.raw.orderNumber || ''),
        packageId: info.packageId,
        recipient: recipientOf(loaded.raw),
        sender: await senderOf(client, user.id),
        contents: contentsOf(loaded.raw),
        deci: Number(loaded.raw.cargoDeci) || null,
        t: CAPTIONS[locale],
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="trendyol-${info.cargoNumber}.pdf"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(pdf);
    }

    if (action === 'status' && req.method === 'POST') {
      if (!client) return res.status(400).json({ error: 'Trendyol credentials not configured' });
      const status = str(req.body?.status);
      if (status !== 'Picking' && status !== 'Invoiced') return res.status(400).json({ error: "status must be 'Picking' or 'Invoiced'" });
      const invoiceNumber = str(req.body?.invoiceNumber);
      if (status === 'Invoiced' && !invoiceNumber) return res.status(400).json({ error: 'invoiceNumber is required for Invoiced' });
      if (!info.packageId || !info.lines.length) return res.status(409).json({ error: 'Order has no Trendyol package lines' });
      await client.updatePackageStatus(info.packageId, info.lines, status, invoiceNumber || undefined);
      // Reflect locally; the next Trendyol sync overwrites with Trendyol's own value.
      await prisma.order.update({
        where: { id: loaded.order.id },
        data: {
          externalStatus: status,
          rawData: { ...loaded.raw, shipmentPackageStatus: status, status, ...(invoiceNumber ? { invoiceNumber } : {}) } as unknown as Prisma.InputJsonValue,
        },
      });
      return res.status(200).json({ ok: true, status });
    }

    return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
  } catch (err: any) {
    const ty = trendyolErrorText(err);
    logger.warn('[TRENDYOL CARGO] action failed', { action, userId: user.id, status: err?.status, code: ty.code, error: ty.text || err?.message });
    if (isCommonLabelNotAllowed(err)) {
      return res.status(409).json({ error: ty.text || 'Trendyol has not enabled the common label for this store', code: 'common_label_not_allowed' });
    }
    const message = ty.text ? `Trendyol: ${ty.text}` : err?.message || 'Trendyol API error';
    if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: message, code: ty.code || undefined });
    }
    return res.status(502).json({ error: message, code: ty.code || undefined });
  }
}
