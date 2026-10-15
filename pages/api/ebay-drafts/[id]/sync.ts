import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUserOrApiKey } from '@/lib/auth';
import { syncDraft, toSerializable } from '@/lib/ebay/draftService';
import { logger } from '@/lib/logger';
import { ebayDraftErrorResponse } from '@/lib/ebay/draftErrors';

// POST /api/ebay-drafts/:id/sync — sends one staged draft to eBay (the editor's explicit Send).
// 200 { status:'success', ... } · 409 { status:'conflict', fields, code, key } (nothing written) ·
// errors: { error, code, key?, params? } with the HTTP status of the typed EbayDraftError (F2).

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUserOrApiKey(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const result = await syncDraft(id, user.id);
    if (result?.status === 'conflict') return res.status(409).json(toSerializable(result));
    return res.status(200).json(toSerializable(result));
  } catch (err: any) {
    logger.error('eBay draft sync failed', err, { userId: user.id, draftId: id });
    const { status, body } = ebayDraftErrorResponse(err, 'Sync failed');
    return res.status(status).json(body);
  }
}
