import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { upsertDraftPatch, toSerializable } from '@/lib/ebay/draftService';
import { logger } from '@/lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const sku = req.query.sku ? String(req.query.sku) : undefined;
      const where: any = { userId: user.id, status: { in: ['draft', 'failed', 'conflict'] } };
      if (sku) where.sku = sku;

      const drafts = await prisma.ebayListingDraft.findMany({
        where,
        include: {
          media: true,
          syncAttempts: { orderBy: { startedAt: 'desc' }, take: 3 },
        },
        orderBy: { updatedAt: 'desc' },
      });

      return res.status(200).json({ drafts: toSerializable(drafts), count: drafts.length });
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
      });

      return res.status(200).json({ draft: toSerializable(draft) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    logger.error('eBay draft request failed', err, { userId: user.id });
    return res.status(500).json({ error: err.message || 'Draft request failed' });
  }
}
