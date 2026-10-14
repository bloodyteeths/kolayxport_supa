/**
 * POST /api/etsy/listings/:listingId/versions/:versionId/restore?shop_id=
 * "Undo": stages the version's content as an EtsyListingDraft patch. Never
 * writes to Etsy — the seller reviews and syncs the draft as usual.
 * Response: { draft, restoredKeys, unrestorable[] }.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { assertShopOwnership, toSerializable } from '@/lib/etsy/draftService';
import { draftErrorResponse } from '@/lib/etsy/draftErrors';
import { restoreVersionAsDraft } from '@/lib/etsy/listingHistory';
import { parseBigIntParam, queryString } from '@/lib/etsy/listingIntelApi';

const ERROR_KEYS: Record<string, string> = {
  VERSION_NOT_FOUND: 'listingHistory.errors.versionNotFound',
  VERSION_NOT_RESTORABLE: 'listingHistory.errors.versionNotRestorable',
  LISTING_GONE: 'listingHistory.errors.listingGone',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const shopId = queryString(req, 'shop_id') || String(req.body?.shop_id || '');
  const listingId = parseBigIntParam(req.query.listingId);
  const versionId = queryString(req, 'versionId');
  if (!shopId || listingId === null || !versionId || versionId.length > 64) {
    return res.status(400).json({ error: 'shop_id, listingId and versionId are required' });
  }
  try {
    await assertShopOwnership(user.id, shopId);
    const r = await restoreVersionAsDraft({ userId: user.id, shopId, listingId, versionId });
    if (!r.ok) return res.status(r.status).json({ error: r.code, code: r.code, key: ERROR_KEYS[r.code] });
    return res.status(200).json({
      draft: r.draft ? toSerializable(r.draft) : null,
      restoredKeys: r.plan.restoredKeys,
      unrestorable: r.plan.unrestorable,
      nothingToRestore: !r.draft,
    });
  } catch (err: any) {
    const { status, body } = draftErrorResponse(err, 'Restore failed');
    return res.status(status).json(body);
  }
}
