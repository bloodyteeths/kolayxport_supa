/**
 * /api/hepsiburada/claims — Hepsiburada claims (iade talepleri).
 *
 * GET                       → { claims: HbClaim[], failedStatuses: string[] } open claims (NewRequest, AwaitingAction,
 *                             AwaitingPreApproval, InDispute), soonest deadline first.
 * GET  ?orderNumber=        → same, filtered to one order (order panel).
 * POST { action: 'accept', claimNumber, reason? }
 * POST { action: 'reject', claimNumber, reason, statement }   reason = HB ClaimRejectionReason code
 *
 * Accept/reject change the claim on Hepsiburada immediately (no staging): the UI must confirm first.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '@/lib/logger';
import { requireHepsiburada, sendHbError } from '@/lib/hepsiburada/server';
import { listOpenHepsiburadaClaims } from '@/lib/hepsiburada/claims';

const STATEMENT_MAX = 2000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireHepsiburada(req, res);
  if (!ctx) return;
  const { client, userId } = ctx;

  try {
    if (req.method === 'GET') {
      const result = await listOpenHepsiburadaClaims(client);
      const orderNumber = typeof req.query.orderNumber === 'string' ? req.query.orderNumber.trim() : '';
      const claims = orderNumber ? result.claims.filter((c) => c.orderNumber === orderNumber) : result.claims;
      return res.status(200).json({ claims, failedStatuses: result.failedStatuses });
    }

    if (req.method === 'POST') {
      const action = req.body?.action;
      const claimNumber = typeof req.body?.claimNumber === 'string' ? req.body.claimNumber.trim() : '';
      if (!claimNumber || claimNumber.length > 100) return res.status(400).json({ error: 'claimNumber is required', code: 'badRequest' });

      if (action === 'accept') {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, STATEMENT_MAX) : '';
        await client.acceptClaim(claimNumber, reason ? { AcceptionReason: reason } : {});
        logger.info('[HEPSIBURADA] claim accepted', { userId, claimNumber });
        return res.status(200).json({ ok: true });
      }

      if (action === 'reject') {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
        const statement = typeof req.body?.statement === 'string' ? req.body.statement.trim() : '';
        if (!reason || !statement) return res.status(400).json({ error: 'reason and statement are required', code: 'badRequest' });
        if (statement.length > STATEMENT_MAX) return res.status(400).json({ error: 'statement is too long', code: 'tooLong', max: STATEMENT_MAX });
        await client.rejectClaim(claimNumber, { ClaimRejectionReason: reason, MerchantStatement: statement });
        logger.info('[HEPSIBURADA] claim rejected', { userId, claimNumber });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action', code: 'badRequest' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    logger.warn('[HEPSIBURADA] claims request failed', { userId, method: req.method, status: (err as any)?.status });
    return sendHbError(res, err);
  }
}
