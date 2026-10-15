import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUserOrApiKey } from '@/lib/auth';
import { discardDraft, toSerializable } from '@/lib/ebay/draftService';
import { logger } from '@/lib/logger';
import { ScheduleError, scheduleErrorResponse, setDraftScheduledSendAt } from '@/lib/drafts/scheduledSend';
import { withLegacyLastSyncError } from '@/lib/drafts/syncErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUserOrApiKey(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    if (req.method === 'GET') {
      const draft = await prisma.ebayListingDraft.findFirst({
        where: { id, userId: user.id },
        include: {
          media: true,
          syncAttempts: { orderBy: { startedAt: 'desc' }, take: 10 },
        },
      });
      if (!draft) return res.status(404).json({ error: 'Draft not found' });
      return res.status(200).json({ draft: toSerializable(draft ? withLegacyLastSyncError(draft as any) : draft) });
    }

    // PATCH { scheduledSendAt: string|null } (additive, listings-grid §9.4):
    // schedule or unschedule the send. Never syncs.
    if (req.method === 'PATCH') {
      if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'scheduledSendAt')) {
        return res.status(400).json({ error: 'scheduledSendAt is required' });
      }
      try {
        await setDraftScheduledSendAt('ebay', id, user.id, req.body.scheduledSendAt);
      } catch (err) {
        if (err instanceof ScheduleError) {
          const { status, body } = scheduleErrorResponse(err);
          return res.status(status).json(body);
        }
        throw err;
      }
      const draft = await prisma.ebayListingDraft.findFirst({ where: { id, userId: user.id } });
      return res.status(200).json({ draft: toSerializable(draft ? withLegacyLastSyncError(draft as any) : draft) });
    }

    if (req.method === 'DELETE') {
      const result = await discardDraft(id, user.id);
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    logger.error('eBay draft [id] request failed', err, { userId: user.id, draftId: id });
    return res.status(500).json({ error: err.message || 'Draft request failed' });
  }
}
