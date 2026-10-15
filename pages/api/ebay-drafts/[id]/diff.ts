import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUserOrApiKey } from '@/lib/auth';
import { getDraftDiff, toSerializable } from '@/lib/ebay/draftService';
import { ebayDraftErrorResponse } from '@/lib/ebay/draftErrors';
import { decodeEntities } from '@/lib/text/decodeEntities';
import type { EbayDiffField } from '@/lib/ebay/draftPlan';

// GET /api/ebay-drafts/:id/diff  (listing-editor §6.4 / §7.1 F3; same contract as Etsy G1)
// Read-only field-level comparison of a draft against the live eBay item + offer,
// powering "Review differences". Never writes, never sends.
// Field keys: title, subtitle, description, aspects, imageUrls, condition,
// conditionDescription, quantity, packageWeightAndSize, price, listingPolicies,
// categoryId, storeCategoryNames, listingDescription (lib/ebay/draftPlan EBAY_DIFF_FIELDS).

export interface EbayDraftDiffResponse {
  /** ISO time of the live listing's start date when eBay reports one, else null. */
  remoteUpdatedAt: string | null;
  /** Sorted: fields both sides touched first, then draft-only, then eBay-only. */
  fields: EbayDiffField[];
  /** The draft's queuedActions, a queued `delete` first. */
  queuedActions: Array<{ type: string; [k: string]: unknown }>;
  hasQueuedDelete: boolean;
}

const TEXT_KEYS = new Set(['title', 'subtitle', 'description', 'listingDescription', 'conditionDescription']);

function decodeValue(key: string, value: unknown): unknown {
  return TEXT_KEYS.has(key) && typeof value === 'string' ? decodeEntities(value) : value;
}

function rank(f: EbayDiffField): number {
  if (f.inDraft && f.changedRemotely) return 0;
  if (f.inDraft) return 1;
  return 2;
}

/** Pure shaping of the service result (exported for tests). */
export function shapeEbayDraftDiff(raw: { remoteUpdatedAt: string | null; fields: EbayDiffField[]; queuedActions: unknown }): EbayDraftDiffResponse {
  const fields = (Array.isArray(raw?.fields) ? raw.fields : [])
    .filter((f) => f && typeof f.key === 'string' && (f.inDraft || f.changedRemotely))
    .map((f, i) => ({
      f: {
        key: f.key,
        base: decodeValue(f.key, f.base),
        remote: decodeValue(f.key, f.remote),
        draft: f.inDraft ? decodeValue(f.key, f.draft) : undefined,
        changedRemotely: Boolean(f.changedRemotely),
        inDraft: Boolean(f.inDraft),
      },
      i,
    }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }) => f);
  const actions = (Array.isArray(raw?.queuedActions) ? raw.queuedActions : [])
    .filter((a): a is { type: string } => Boolean(a) && typeof (a as { type?: unknown }).type === 'string');
  const queuedActions = [...actions.filter((a) => a.type === 'delete'), ...actions.filter((a) => a.type !== 'delete')];
  const t = raw?.remoteUpdatedAt ? new Date(raw.remoteUpdatedAt) : null;
  return {
    remoteUpdatedAt: t && !Number.isNaN(t.getTime()) ? t.toISOString() : null,
    fields,
    queuedActions,
    hasQueuedDelete: queuedActions.some((a) => a.type === 'delete'),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUserOrApiKey(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const raw = await getDraftDiff(id, user.id);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(toSerializable(shapeEbayDraftDiff(raw)));
  } catch (err: unknown) {
    const { status, body } = ebayDraftErrorResponse(err, 'Could not compare the draft with eBay');
    return res.status(status).json(body);
  }
}
