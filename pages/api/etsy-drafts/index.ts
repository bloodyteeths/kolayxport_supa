import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { toSerializable, upsertDraftPatch, recoverStaleSyncingDrafts } from '@/lib/etsy/draftService';
import { draftErrorResponse } from '@/lib/etsy/draftErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const shopId = String(req.query.shop_id || '');
      const listingId = req.query.listing_id ? BigInt(String(req.query.listing_id)) : null;
      if (!shopId) return res.status(400).json({ error: 'shop_id is required' });

      // Surface drafts orphaned in 'syncing' by a mid-sync restart as 'failed'
      // (retryable) before listing them.
      await recoverStaleSyncingDrafts(user.id, shopId);

      const drafts = await prisma.etsyListingDraft.findMany({
        where: {
          userId: user.id,
          etsyShopId: shopId,
          ...(listingId ? { etsyListingId: listingId } : {}),
          status: { in: ['draft', 'failed', 'conflict', 'syncing'] },
        },
        include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
        orderBy: { updatedAt: 'desc' },
      });
      return res.status(200).json({ drafts: toSerializable(drafts), count: drafts.length });
    }

    if (req.method === 'POST') {
      const {
        shop_id,
        listing_id,
        fields,
        taxonomy,
        inventory,
        variationImages,
        personalization,
        media,
        queuedActions,
        removeQueuedActions,
        replaceFields,
      } = req.body || {};
      if (!shop_id || !listing_id) return res.status(400).json({ error: 'shop_id and listing_id are required' });
      if (removeQueuedActions !== undefined && (!Array.isArray(removeQueuedActions) || removeQueuedActions.some((t: unknown) => typeof t !== 'string'))) {
        return res.status(400).json({ error: 'removeQueuedActions must be an array of action types' });
      }

      const draft = await upsertDraftPatch({
        userId: user.id,
        shopId: String(shop_id),
        listingId: String(listing_id),
        fields,
        taxonomy,
        inventory,
        variationImages,
        personalization,
        // Sanitised in upsertDraftPatch: client media can never set localPath,
        // and sourceUrl must be a public https URL.
        media,
        queuedActions,
        removeQueuedActions,
        replaceFields: Boolean(replaceFields),
      });
      return res.status(200).json({ draft: toSerializable(draft) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    const { status, body } = draftErrorResponse(err, 'Draft request failed');
    return res.status(status).json(body);
  }
}
