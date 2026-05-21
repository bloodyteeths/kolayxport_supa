import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUserOrApiKey } from '@/lib/auth';
import { syncDraft, toSerializable } from '@/lib/ebay/draftService';
import { logger } from '@/lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUserOrApiKey(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const result = await syncDraft(id, user.id);
    return res.status(200).json(toSerializable(result));
  } catch (err: any) {
    logger.error('eBay draft sync failed', err, { userId: user.id, draftId: id });
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
}
