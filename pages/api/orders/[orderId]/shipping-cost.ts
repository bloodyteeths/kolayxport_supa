import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

// Manual carrier-cost entry for an order. Carriers (UPS, MNG) only reveal the
// real cost on their invoice, so users log it here after the fact; the
// financial dashboard folds it into the shipping bucket.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const orderId = String(req.query.orderId || '');
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  const { cost, currency } = req.body || {};
  const clearing = cost === null || cost === '' || cost === undefined;
  const parsed = clearing ? null : Number(cost);
  if (!clearing && (!Number.isFinite(parsed) || parsed! < 0 || parsed! > 100000)) {
    return res.status(400).json({ error: 'cost must be a number between 0 and 100000, or null to clear' });
  }
  const cur = clearing ? null : String(currency || 'TRY').toUpperCase();
  if (cur && !['TRY', 'USD', 'EUR', 'GBP'].includes(cur)) {
    return res.status(400).json({ error: 'currency must be one of TRY, USD, EUR, GBP' });
  }

  const order = await prisma.order.findFirst({ where: { id: orderId, userId: user.id }, select: { id: true } });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { manualShippingCost: parsed, manualShippingCostCurrency: cur },
    select: { id: true, manualShippingCost: true, manualShippingCostCurrency: true },
  });

  return res.status(200).json({
    success: true,
    orderId: updated.id,
    manualShippingCost: updated.manualShippingCost != null ? Number(updated.manualShippingCost) : null,
    manualShippingCostCurrency: updated.manualShippingCostCurrency,
  });
}
