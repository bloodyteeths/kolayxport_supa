import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUserOrApiKey } from '@/lib/auth';
import { resolveDraft, toSerializable } from '@/lib/ebay/draftService';
import { ebayDraftErrorResponse } from '@/lib/ebay/draftErrors';

// POST /api/ebay-drafts/:id/resolve   body: { keep: string[] }   (listing-editor §6.4 / §7.1 F3)
// "Keep my choices": keys in `keep` stay staged ("Mine"); every other field eBay
// changed is dropped from the patch ("eBay's"); the draft is re-based on the live
// item and returns to status 'draft'. NEVER sends to eBay and never removes queued
// actions (a queued delete is removed only via PATCH /api/ebay-drafts/:id
// { removeQueuedActions: ['delete'] }).

const MAX_KEYS = 100;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

/** Validates and de-duplicates `keep`. Returns null when the body is invalid (exported for tests). */
export function parseKeep(body: unknown): string[] | null {
  const keep = (body as { keep?: unknown } | null | undefined)?.keep;
  if (!Array.isArray(keep) || keep.length > MAX_KEYS) return null;
  if (keep.some((k) => typeof k !== 'string' || !KEY_RE.test(k))) return null;
  return Array.from(new Set(keep as string[]));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUserOrApiKey(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });
  const keep = parseKeep(req.body);
  if (!keep) {
    return res.status(400).json({ error: 'keep must be an array of field keys (may be empty)', code: 'INVALID_KEEP' });
  }

  try {
    const draft = await resolveDraft(id, user.id, keep);
    return res.status(200).json({ draft: toSerializable(draft) });
  } catch (err: unknown) {
    const { status, body } = ebayDraftErrorResponse(err, 'Could not apply your choices');
    return res.status(status).json(body);
  }
}
