import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { syncDraft, toSerializable } from '@/lib/etsy/draftService';
import { draftErrorResponse } from '@/lib/etsy/draftErrors';

// POST /api/etsy-drafts/:id/sync   body: { force?: boolean }
// force=false (default): if the listing changed on Etsy after the draft was
// staged, the draft is marked 'conflict' and nothing is written (409).
// force=true: the user explicitly chose "apply anyway" — re-base and write.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });
  const force = req.body?.force === true;

  try {
    const result = await syncDraft(id, user.id, { force });
    if (result.status === 'conflict') return res.status(409).json(toSerializable(result));
    return res.status(200).json(toSerializable(result));
  } catch (err: any) {
    const { status, body } = draftErrorResponse(err, 'Sync failed');
    return res.status(status).json(body);
  }
}
