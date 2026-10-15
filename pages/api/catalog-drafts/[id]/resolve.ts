import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { catalogDraftErrorResponse, resolveCatalogDraft, toDTO } from '@/lib/catalogDrafts/service';

/**
 * POST /api/catalog-drafts/:id/resolve   body: { keep: string[] }   → { draft: CatalogDraftDTO }
 * (marketplace-editors §7.1; same contract as POST /api/etsy-drafts/:id/resolve)
 *
 * "Keep my choices" in Review differences: staged fields listed in `keep` stay ("Mine"); every other field
 * the marketplace changed is dropped from the patch (the marketplace's value wins); fields only the draft
 * touched always stay. The draft is re-based on the live product and returns to `draft`.
 * It NEVER sends and never removes queued actions (a queued delete/archive is removed only through
 * PATCH /api/catalog-drafts/:id { removeQueuedActions }). Allowed from `conflict` and `failed`.
 * Errors: 400 INVALID_KEEP, 404 DRAFT_NOT_FOUND / REMOTE_MISSING, 409 DRAFT_NOT_EDITABLE / CREATE_DRAFT /
 * MULTI_VARIANT etc. (the kept patch is not allowed on the new base), 502 REMOTE_FAILED, 503 UNAVAILABLE.
 */

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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });
  const keep = parseKeep(req.body);
  if (!keep) {
    return res.status(400).json({ error: 'keep must be an array of field keys (may be empty)', code: 'INVALID_KEEP', key: 'listings.draftError.invalidInput' });
  }

  try {
    const draft = await resolveCatalogDraft(id, user.id, keep);
    return res.status(200).json({ draft: toDTO(draft) });
  } catch (err) {
    const { status, body } = catalogDraftErrorResponse(err);
    return res.status(status).json(body);
  }
}
