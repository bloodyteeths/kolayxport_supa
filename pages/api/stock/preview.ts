import type { NextApiRequest, NextApiResponse } from 'next';
import { stockAuth, serverError, qstr } from '@/lib/stock/api';
import { issueConfirmToken, previewStock, CONFIRM_TOKEN_TTL_MS } from '@/lib/stock/preview';

export const config = { maxDuration: 120 };

/**
 * GET  /api/stock/preview            -> plan from last seen quantities (no marketplace calls)
 * POST /api/stock/preview?live=1     -> fresh reads (max 50 links) + confirmToken (15 min) for Go Live
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET', 'POST']);
  if (!userId) return;
  try {
    const live = req.method === 'POST' && ['1', 'true'].includes(qstr(req.query.live) || '');
    const p = await previewStock(userId, { live });
    const token = live ? issueConfirmToken(userId, p.planHash, p.requiresTypedConfirm) : null;
    return res.status(200).json({ ...p, confirmToken: token, confirmTokenExpiresAt: token ? new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString() : null });
  } catch (err) {
    return serverError(res, 'preview', err, userId);
  }
}
