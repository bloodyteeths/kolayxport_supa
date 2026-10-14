import type { NextApiRequest, NextApiResponse } from 'next';
import { stockAuth, fail, serverError } from '@/lib/stock/api';
import { generateEtsySkus } from '@/lib/stock/skuGen';

export const config = { maxDuration: 300 };

/**
 * POST /api/stock/generate-skus { shopId, listingIds: string[], prefix?, apply?: boolean }
 * apply=false -> proposals only. apply=true -> each listing's SKUs are STAGED as
 * an Etsy draft (never written to Etsy directly); the seller syncs the draft.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['POST']);
  if (!userId) return;
  const body = (req.body || {}) as Record<string, any>;
  try {
    const shopId = typeof body.shopId === 'string' ? body.shopId : body.shopId ? String(body.shopId) : '';
    const listingIds = Array.isArray(body.listingIds) ? body.listingIds.map(String).filter((s: string) => /^\d{1,20}$/.test(s)) : [];
    if (!shopId || !listingIds.length) return fail(res, 400, 'invalid_request');
    const prefix = typeof body.prefix === 'string' ? body.prefix.slice(0, 12) : undefined;
    try {
      const proposals = await generateEtsySkus(userId, { shopId, listingIds, prefix, apply: body.apply === true });
      return res.status(200).json({ proposals, staged: body.apply === true });
    } catch (err) {
      if (err instanceof Error && err.message === 'shop_not_owned') return fail(res, 404, 'shop_not_found');
      throw err;
    }
  } catch (err) {
    return serverError(res, 'generate-skus', err, userId);
  }
}
