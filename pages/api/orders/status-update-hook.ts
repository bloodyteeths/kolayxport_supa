import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Retired. This endpoint used to auto-set SenkronOrderData.customStatus from
 * the cargo status for the removed "Production list" page. Nothing reads that
 * status anymore, so the hook is gone. Existing rows are left untouched.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({ error: 'Gone: the order status update hook has been retired.' });
}
