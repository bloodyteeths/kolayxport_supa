import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import {
  catalogDraftErrorResponse,
  discardCatalogDraft,
  getCatalogDraft,
  patchCatalogDraft,
  rebaseCatalogDraft,
  toDTO,
} from '@/lib/catalogDrafts/service';

/**
 * GET    /api/catalog-drafts/:id → { draft }
 * PATCH  /api/catalog-drafts/:id { scheduledSendAt?: string|null, removeQueuedActions?: string[] } → { draft }
 * PATCH  /api/catalog-drafts/:id { rebase: true } → { draft } ("Keep my changes" after Review differences:
 *        the current marketplace values become the draft's base and a conflict goes back to `draft`; never sends)
 * DELETE /api/catalog-drafts/:id → { draft } (status 'cancelled'; refused while sending)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ draft: toDTO(await getCatalogDraft(id, user.id)) });
    }
    if (req.method === 'PATCH') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (body.rebase !== undefined) {
        if (body.rebase !== true || body.scheduledSendAt !== undefined || body.removeQueuedActions !== undefined) {
          return res.status(400).json({ error: 'rebase must be true and sent alone', code: 'INVALID_INPUT', key: 'listings.draftError.invalidInput' });
        }
        return res.status(200).json({ draft: toDTO(await rebaseCatalogDraft(id, user.id)) });
      }
      const draft = await patchCatalogDraft(id, user.id, {
        scheduledSendAt: body.scheduledSendAt,
        removeQueuedActions: body.removeQueuedActions,
      });
      return res.status(200).json({ draft: toDTO(draft) });
    }
    if (req.method === 'DELETE') {
      return res.status(200).json({ draft: toDTO(await discardCatalogDraft(id, user.id)) });
    }
    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const { status, body } = catalogDraftErrorResponse(err);
    return res.status(status).json(body);
  }
}
