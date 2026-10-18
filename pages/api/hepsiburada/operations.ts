/**
 * Hepsiburada order operations. `?action=`:
 *   POST package           { orderId }                         pack the order's open lines
 *   GET  label             ?orderId=&format=PDF|ZPL             HB cargo label (packs first if needed) → application/pdf
 *   POST intransit         { orderId, trackingNumber, trackingUrl?, carrier? }   own-cargo shipments only
 *   POST invoice           { orderId, invoiceLink }
 *   POST cancel_line       { lineItemId, reasonId }
 *   GET  cargo_companies   ?orderId=                            companies the package can switch to
 *   POST change_cargo      { orderId, cargoCompanyShortName }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '@/lib/logger';
import { requireHepsiburada, sendHbError } from '@/lib/hepsiburada/server';
import { addInvoiceLink, fetchLabel, loadHbOrder, markInTransit, packOrder } from '@/lib/hepsiburada/fulfilment';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = str(req.query.action);
  const ctx = await requireHepsiburada(req, res);
  if (!ctx) return;
  const { userId, client } = ctx;

  try {
    if (action === 'package' && req.method === 'POST') {
      const orderId = str(req.body?.orderId);
      if (!orderId) return res.status(400).json({ error: 'orderId is required' });
      const pkg = await packOrder(client, userId, orderId);
      if (!pkg) return res.status(409).json({ error: 'Nothing to package', code: 'nothing_to_package' });
      return res.status(200).json(pkg);
    }

    if (action === 'label' && req.method === 'GET') {
      const orderId = str(req.query.orderId);
      const format = str(req.query.format).toUpperCase() === 'ZPL' ? 'ZPL' : 'PDF';
      if (!orderId) return res.status(400).json({ error: 'orderId is required' });
      const pkg = await packOrder(client, userId, orderId);
      if (!pkg) return res.status(409).json({ error: 'Order has no package and nothing to package', code: 'nothing_to_package' });
      const label = await fetchLabel(client, pkg.packageNumber, format);
      res.setHeader('Content-Type', format === 'ZPL' ? 'text/plain; charset=utf-8' : 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="hepsiburada-${pkg.packageNumber}.${format === 'ZPL' ? 'zpl' : 'pdf'}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(label.data);
    }

    if (action === 'intransit' && req.method === 'POST') {
      const orderId = str(req.body?.orderId);
      const trackingNumber = str(req.body?.trackingNumber);
      if (!orderId || !trackingNumber) return res.status(400).json({ error: 'orderId and trackingNumber are required' });
      await markInTransit(client, userId, orderId, { trackingNumber, trackingUrl: str(req.body?.trackingUrl) || undefined, carrier: str(req.body?.carrier) || undefined });
      return res.status(200).json({ ok: true });
    }

    if (action === 'invoice' && req.method === 'POST') {
      const orderId = str(req.body?.orderId);
      const invoiceLink = str(req.body?.invoiceLink);
      if (!orderId || !/^https?:\/\//i.test(invoiceLink)) return res.status(400).json({ error: 'orderId and an http(s) invoiceLink are required' });
      await addInvoiceLink(client, userId, orderId, invoiceLink);
      return res.status(200).json({ ok: true });
    }

    if (action === 'cancel_line' && req.method === 'POST') {
      const lineItemId = str(req.body?.lineItemId);
      const reasonId = Number(req.body?.reasonId);
      if (!lineItemId || !Number.isFinite(reasonId)) return res.status(400).json({ error: 'lineItemId and reasonId are required' });
      await client.cancelLine(lineItemId, reasonId);
      return res.status(200).json({ ok: true });
    }

    if (action === 'cargo_companies' && req.method === 'GET') {
      const loaded = await loadHbOrder(userId, str(req.query.orderId));
      if (!loaded?.raw.packageNumber) return res.status(409).json({ error: 'Order has no Hepsiburada package yet' });
      return res.status(200).json(await client.changeableCargoCompanies(String(loaded.raw.packageNumber)));
    }

    if (action === 'change_cargo' && req.method === 'POST') {
      const loaded = await loadHbOrder(userId, str(req.body?.orderId));
      const company = str(req.body?.cargoCompanyShortName);
      if (!loaded?.raw.packageNumber || !company) return res.status(400).json({ error: 'A packaged orderId and cargoCompanyShortName are required' });
      await client.changeCargoCompany(String(loaded.raw.packageNumber), company);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
  } catch (err: any) {
    if (typeof err?.status === 'number' && !('endpoint' in err)) return res.status(err.status).json({ error: err.message });
    logger.warn('[HEPSIBURADA] operation failed', { action, userId, error: err?.message });
    return sendHbError(res, err);
  }
}
