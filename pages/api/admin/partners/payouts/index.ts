// /api/admin/partners/payouts — payout history (GET) and "mark paid" for manual bank transfers (PATCH). Admin only.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { markManualPayoutPaid } from '@/lib/partners/payouts';

export default withAdmin(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    const payouts = await prisma.partnerPayout.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, partnerId: true, period: true, amountMinor: true, currency: true, provider: true, status: true, externalId: true, error: true, paidAt: true, createdAt: true },
    });
    const partners = await prisma.partner.findMany({ where: { id: { in: [...new Set(payouts.map((p) => p.partnerId))] } }, select: { id: true, code: true } });
    const code = new Map(partners.map((p) => [p.id, p.code]));
    return res.status(200).json({ payouts: payouts.map((p) => ({ ...p, code: code.get(p.partnerId) ?? null })) });
  }
  if (req.method === 'PATCH') {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { payoutId?: unknown; reference?: unknown };
    const payoutId = typeof body.payoutId === 'string' ? body.payoutId : '';
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!payoutId || !reference) return res.status(400).json({ error: 'payoutId and reference are required' });
    const r = await markManualPayoutPaid(payoutId, reference);
    if (r === 'not_found') return res.status(404).json({ error: 'not found' });
    if (r === 'not_manual') return res.status(409).json({ error: 'only unpaid manual payouts can be marked paid' });
    return res.status(200).json({ status: 'paid' });
  }
  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
});
