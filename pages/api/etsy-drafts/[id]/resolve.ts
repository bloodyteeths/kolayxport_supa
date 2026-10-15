import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import * as draftService from '@/lib/etsy/draftService';

// Looked up by a non-constant key so bundlers do not statically resolve a
// missing export before BR-3 lands (webpack warns, Turbopack errors).
const BR3_EXPORT: string = ['resolveDraft'].join('');
import { draftErrorResponse } from '@/lib/etsy/draftErrors';

// POST /api/etsy-drafts/:id/resolve   body: { keep: string[] }   (listing-editor §6.4 / §7.1 G1)
// "Keep my choices" in Review differences: fields listed in `keep` stay in the
// draft ("Mine"); every other conflicting field is dropped from the patch
// ("Etsy's"); the draft is re-based on the live listing and returns to status
// 'draft'. It NEVER sends to Etsy and never removes queued actions (a queued
// delete is removed only through PATCH /api/etsy-drafts/:id removeQueuedActions).
// Implementation is backend BR-3 `resolveDraft` (import-only); 501 until shipped.

type ResolveDraft = (draftId: string, userId: string, keep: string[]) => Promise<unknown>;

const MAX_KEYS = 100;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

/** Validates and de-duplicates `keep`. Returns null when the body is invalid (exported for tests). */
export function parseKeep(body: unknown): string[] | null {
  const keep = (body as { keep?: unknown } | null | undefined)?.keep;
  if (!Array.isArray(keep) || keep.length > MAX_KEYS) return null;
  if (keep.some((k) => typeof k !== 'string' || !KEY_RE.test(k))) return null;
  return Array.from(new Set(keep as string[]));
}

function resolveImpl(): ResolveDraft | null {
  const fn = Reflect.get(draftService, BR3_EXPORT) as unknown;
  return typeof fn === 'function' ? (fn as ResolveDraft) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });
  const keep = parseKeep(req.body);
  if (!keep) {
    return res.status(400).json({ error: 'keep must be an array of field keys (may be empty)', code: 'INVALID_KEEP' });
  }

  const resolveDraft = resolveImpl();
  if (!resolveDraft) {
    return res.status(501).json({ error: 'Review differences is not available yet', code: 'NOT_AVAILABLE', key: 'draftSync.reviewUnavailable' });
  }

  try {
    const draft = await resolveDraft(id, user.id, keep);
    return res.status(200).json({ draft: draftService.toSerializable(draft) });
  } catch (err: unknown) {
    const { status, body } = draftErrorResponse(err, 'Could not apply your choices');
    return res.status(status).json(body);
  }
}
