import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUserOrApiKey } from '@/lib/auth';
import { syncDraft } from '@/lib/ebay/draftService';
import { logger } from '@/lib/logger';
import { isEbayDraftError } from '@/lib/ebay/draftErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUserOrApiKey(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const draftIds = Array.isArray(req.body?.draftIds) ? req.body.draftIds : [];
  if (draftIds.length === 0) return res.status(400).json({ error: 'draftIds is required' });

  const results: Array<{ draftId: string; status: string; reason?: string; count?: number; error?: string; code?: string; key?: string; params?: Record<string, string | number> }> = [];
  for (const draftId of draftIds) {
    try {
      results.push(await syncDraft(String(draftId), user.id));
    } catch (err: any) {
      logger.error('eBay bulk sync item failed', err, { userId: user.id, draftId: String(draftId) });
      results.push({
        draftId: String(draftId),
        status: 'failed',
        error: err.message || 'Sync failed',
        ...(isEbayDraftError(err) ? { code: err.code, key: err.key, params: err.params } : {}),
      });
    }
  }

  return res.status(200).json({
    results,
    success: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'failed').length,
    conflicts: results.filter((r) => r.status === 'conflict').length,
    // Drafts with nothing left to send were cancelled without calling eBay: neither sent nor failed.
    skipped: results.filter((r) => r.status === 'skipped').length,
    emptyDrafts: results.filter((r) => r.status === 'skipped' && r.reason === 'empty').map((r) => r.draftId),
  });
}
