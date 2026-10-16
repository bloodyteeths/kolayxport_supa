import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUserOrApiKey } from '@/lib/auth';
import { upsertDraftPatch, toSerializable } from '@/lib/ebay/draftService';
import { logger } from '@/lib/logger';
import { withLegacyLastSyncError } from '@/lib/drafts/syncErrors';
import { isOpenEmptyDraft } from '@/lib/drafts/emptyDraft';
import { ebayDraftErrorResponse, isEbayDraftError } from '@/lib/ebay/draftErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUserOrApiKey(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const sku = req.query.sku ? String(req.query.sku) : undefined;
      const where: any = { userId: user.id, status: { in: ['draft', 'failed', 'conflict'] } };
      if (sku) where.sku = sku;

      const rows = await prisma.ebayListingDraft.findMany({
        where,
        include: {
          media: true,
          syncAttempts: { orderBy: { startedAt: 'desc' }, take: 3 },
        },
        orderBy: { updatedAt: 'desc' },
      });

      // An open draft whose every change was undone holds nothing to send: it is not a pending change.
      const drafts = rows.filter((d) => !isOpenEmptyDraft('EbayListingDraft', d as any));
      return res.status(200).json({ drafts: toSerializable(drafts.map(withLegacyLastSyncError)), count: drafts.length });
    }

    if (req.method === 'POST') {
      const {
        sku,
        offerId,
        inventoryFields,
        offerFields,
        variationFields,
        queuedActions,
        media,
        replaceFields,
        preserveConflict,
      } = req.body || {};

      if (!sku) return res.status(400).json({ error: 'sku is required' });

      const draft = await upsertDraftPatch({
        userId: user.id,
        sku: String(sku),
        offerId: offerId ? String(offerId) : undefined,
        inventoryFields,
        offerFields,
        variationFields,
        queuedActions,
        media,
        replaceFields: Boolean(replaceFields),
        preserveConflict: preserveConflict === true,
      });

      return res.status(200).json({ draft: toSerializable(draft ? withLegacyLastSyncError(draft as any) : draft) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    if (!isEbayDraftError(err)) logger.error('eBay draft request failed', err, { userId: user.id });
    const { status, body } = ebayDraftErrorResponse(err, 'Draft request failed');
    return res.status(status).json(body);
  }
}
