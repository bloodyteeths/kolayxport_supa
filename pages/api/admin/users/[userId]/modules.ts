// /api/admin/users/[userId]/modules — pricing v2 module grants for one account (lib/billing/modules.ts). Admin only.
// GET lists rows; PUT { module, quantity?, currentPeriodEnd? } grants / changes one; DELETE ?module= cancels it.
// Works before PRICING_V2 is on so the founder can test entitlements; payment-backed rows come with P2/P3.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { recordAdminAction } from '@/lib/admin/audit';
import { isModuleKey, summarizeModules } from '@/lib/billing/modules';
import { pricingV2Enabled } from '@/lib/billing/pricingV2';

export default withAdmin(async (req: NextApiRequest, res: NextApiResponse, adminUser: { id: string }) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId || !(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) return res.status(404).json({ error: 'User not found' });

  const list = async () => {
    const rows = await prisma.billingModule.findMany({ where: { userId }, orderBy: { module: 'asc' } });
    return { pricingV2: pricingV2Enabled(), modules: rows, effective: summarizeModules(rows) };
  };

  if (req.method === 'GET') return res.status(200).json(await list());

  if (req.method === 'PUT') {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    if (!isModuleKey(body.module)) return res.status(400).json({ error: 'module must be financials | arbitrage | bulkPhotoStudio | extraStore | extraOrders' });
    const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return res.status(400).json({ error: 'quantity must be 1–100' });
    const end = body.currentPeriodEnd ? new Date(String(body.currentPeriodEnd)) : null;
    if (end && !Number.isFinite(end.getTime())) return res.status(400).json({ error: 'currentPeriodEnd must be a date' });
    await prisma.billingModule.upsert({
      where: { userId_module: { userId, module: body.module } },
      create: { userId, module: body.module, quantity, currentPeriodEnd: end, provider: 'admin', status: 'active' },
      update: { quantity, currentPeriodEnd: end, status: 'active' },
    });
    await recordAdminAction(req, adminUser.id, { action: 'user.module.grant', targetType: 'user', targetId: userId, metadata: { module: body.module, quantity, currentPeriodEnd: end?.toISOString() ?? null } });
    return res.status(200).json(await list());
  }

  if (req.method === 'DELETE') {
    const module = req.query.module;
    if (!isModuleKey(module)) return res.status(400).json({ error: 'module is required' });
    await prisma.billingModule.updateMany({ where: { userId, module }, data: { status: 'canceled' } });
    await recordAdminAction(req, adminUser.id, { action: 'user.module.cancel', targetType: 'user', targetId: userId, metadata: { module } });
    return res.status(200).json(await list());
  }

  res.setHeader('Allow', 'GET, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
});
