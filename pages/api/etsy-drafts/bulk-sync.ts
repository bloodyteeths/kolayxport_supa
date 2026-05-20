import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { syncDraft } from '@/lib/etsy/draftService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const draftIds = Array.isArray(req.body?.draftIds) ? req.body.draftIds : [];
  if (draftIds.length === 0) return res.status(400).json({ error: 'draftIds is required' });

  const results: Array<{ draftId: string; status: string; count?: number; error?: string }> = [];
  for (const draftId of draftIds) {
    try {
      results.push(await syncDraft(String(draftId), user.id));
    } catch (err: any) {
      results.push({ draftId: String(draftId), status: 'failed', error: err.message || 'Sync failed' });
    }
  }

  return res.status(200).json({
    results,
    success: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'failed').length,
    conflicts: results.filter((r) => r.status === 'conflict').length,
  });
}
