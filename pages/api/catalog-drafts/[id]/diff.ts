import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { catalogDraftErrorResponse, getCatalogDraftDiff } from '@/lib/catalogDrafts/service';
import { decodeEntities } from '@/lib/text/decodeEntities';

/**
 * GET /api/catalog-drafts/:id/diff  (marketplace-editors §6 conflict check, §7.1; listing-editor §6.4 contract)
 * → { remoteUpdatedAt: string|null, fields: [{ key, base, remote, draft, changedRemotely, inDraft }],
 *     queuedActions: [{ type, queuedAt, payload? }], hasQueuedDelete }
 *
 * Read-only comparison of a Trendyol / Wix / Shopify draft against the live product, for the editor's
 * "Review differences" panel. Same response shape as GET /api/etsy-drafts/:id/diff. Never writes, never sends.
 * `seo` and `variants` values are scoped to the parts the draft touches; op-list keys (Wix `media`, Shopify
 * `images`) are listed with the staged ops as `draft` and the live items as `remote`, never as a conflict.
 * Errors: 404 DRAFT_NOT_FOUND / REMOTE_MISSING, 409 DRAFT_NOT_EDITABLE (sending, sent, cancelled) /
 * CREATE_DRAFT (a new product has nothing to compare), 502 REMOTE_FAILED, 503 UNAVAILABLE.
 */

const TEXT_KEYS = new Set(['title', 'description', 'tags']);

/** Marketplace text can arrive HTML-entity encoded ("one&#39;s"); decoded for display only. */
function decodeValue(key: string, value: unknown): unknown {
  if (!TEXT_KEYS.has(key)) return value;
  if (typeof value === 'string') return key === 'description' ? value : decodeEntities(value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? decodeEntities(v) : v));
  return value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const diff = await getCatalogDraftDiff(id, user.id);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      ...diff,
      fields: diff.fields.map((f) => ({
        ...f,
        base: decodeValue(f.key, f.base),
        remote: decodeValue(f.key, f.remote),
        draft: f.inDraft ? decodeValue(f.key, f.draft) : undefined,
      })),
    });
  } catch (err) {
    const { status, body } = catalogDraftErrorResponse(err);
    return res.status(status).json(body);
  }
}
