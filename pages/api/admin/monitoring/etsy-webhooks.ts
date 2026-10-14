import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { getEtsyWebhookHealth, replayFailedEtsyWebhooks } from '@/lib/admin/monitoring';
import { recordAdminAction } from '@/lib/admin/audit';

/**
 * Etsy event backbone cockpit (admin only).
 *   GET  -> queue depth by status, oldest due age, backlog by shop, last receipt,
 *           rate budget snapshot, worker status, scheduler JobRun status.
 *   POST { action: 'replay', ids?: string[], shopId?: string }
 *        -> failed events back to 'received' with attempts 0.
 * Counts and ids only; never webhook payloads.
 */
async function handler(req: NextApiRequest, res: NextApiResponse, adminUser: { id: string }) {
  res.setHeader('Cache-Control', 'no-store, private');
  if (req.method === 'GET') {
    return res.json(await getEtsyWebhookHealth());
  }
  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    if (body.action !== 'replay') return res.status(400).json({ error: 'Unknown action' });
    const result = await replayFailedEtsyWebhooks({ ids: body.ids, shopId: body.shopId });
    await recordAdminAction(req, adminUser.id, {
      action: 'etsy_webhooks.replay',
      targetType: 'webhook_event',
      targetId: typeof body.shopId === 'string' ? `shop:${body.shopId}` : undefined,
      metadata: { ids: Array.isArray(body.ids) ? body.ids.slice(0, 50) : undefined, replayed: result.replayed },
    });
    return res.json({ ok: true, ...result });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAdmin(handler);
