import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { syncDraft, toSerializable } from '@/lib/etsy/draftService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const result = await syncDraft(id, user.id);
    return res.status(200).json(toSerializable(result));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
}
