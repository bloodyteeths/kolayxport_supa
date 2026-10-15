// GET /api/listings/duplicates?marketplace&store — duplicate groups over the whole store (listings-grid §9.4, §10).
// Same SKU, same normalised title, or title Jaccard ≥ 0.8 on content words. At most 200 groups. DB only.
// List filters are ignored on purpose: duplicates are a whole-shop question.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { findDuplicates, planListingsQuery } from '@/lib/listings/query';
import type { DuplicatesResponse, ListingsErrorBody, ListingsQuery } from '@/lib/listings/types';
import { handleListingsError, prepareListingsRequest } from './index';

export default async function handler(req: NextApiRequest, res: NextApiResponse<DuplicatesResponse | ListingsErrorBody>) {
  const ready = await prepareListingsRequest(req, res);
  if (!ready) return;
  const { userId, query, adapter } = ready;
  try {
    const storeOnly: ListingsQuery = { marketplace: query.marketplace, store: query.store, sort: query.sort, page: 1, size: query.size };
    const plan = await planListingsQuery(prisma, adapter, userId, storeOnly);
    const { groups, truncated } = await findDuplicates(prisma, plan);
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({ groups, ...(truncated ? { truncated } : {}) });
  } catch (err) {
    handleListingsError(res, err, 'GET /api/listings/duplicates', userId);
  }
}
