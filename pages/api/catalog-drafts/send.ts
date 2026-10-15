import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { catalogDraftErrorResponse, sendCatalogDrafts } from '@/lib/catalogDrafts/service';

export const config = { maxDuration: 300 };

/**
 * POST /api/catalog-drafts/send { draftIds: string[] (≤ 500), confirmDeleteIds?: string[] }
 * → SendSummary { results, sent, failed[{id,errorKey,errorParams?}], conflicts, pending, skipped[{id,reason}] }
 *
 * Explicit send. Conflicts are never forced (there is no force flag). A draft
 * with a queued delete/archive is skipped (reason 'queued_delete') unless its
 * id is in confirmDeleteIds (the UI's type-to-confirm).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const draftIds = Array.isArray(body.draftIds) ? body.draftIds.map(String) : [];
  const confirmDeleteIds = Array.isArray(body.confirmDeleteIds) ? body.confirmDeleteIds.map(String) : [];

  try {
    const summary = await sendCatalogDrafts(user.id, draftIds, { confirmDeleteIds });
    return res.status(200).json(summary);
  } catch (err) {
    const { status, body: errBody } = catalogDraftErrorResponse(err);
    return res.status(status).json(errBody);
  }
}
