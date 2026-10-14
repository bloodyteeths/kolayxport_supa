import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { discardDraft, removeQueuedActions, toSerializable } from '@/lib/etsy/draftService';
import { draftErrorResponse } from '@/lib/etsy/draftErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    if (req.method === 'GET') {
      const draft = await prisma.etsyListingDraft.findFirst({
        where: { id, userId: user.id },
        include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 10 } },
      });
      if (!draft) return res.status(404).json({ error: 'Draft not found' });
      return res.status(200).json({ draft: toSerializable(draft) });
    }

    // PATCH { removeQueuedActions: ['delete', ...] } — un-queue staged actions
    // (e.g. cancel a queued listing delete without discarding the draft).
    if (req.method === 'PATCH') {
      const types = req.body?.removeQueuedActions;
      if (!Array.isArray(types) || types.length === 0 || types.some((t: unknown) => typeof t !== 'string')) {
        return res.status(400).json({ error: 'removeQueuedActions must be a non-empty array of action types' });
      }
      const draft = await removeQueuedActions(id, user.id, types);
      return res.status(200).json({ draft: toSerializable(draft) });
    }

    if (req.method === 'DELETE') {
      const result = await discardDraft(id, user.id);
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    const { status, body } = draftErrorResponse(err, 'Draft request failed');
    return res.status(status).json(body);
  }
}
