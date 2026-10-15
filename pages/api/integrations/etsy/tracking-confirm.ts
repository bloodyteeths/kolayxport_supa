import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { applyExtensionCors, rejectUnauthenticated } from '@/lib/security/internalApiKey';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS: kolayxport.com + configured official extension origin only (fail closed).
  applyExtensionCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: NextAuth cookie session or Bearer token from /api/auth/extension only.
  // No fallback by (public) Etsy shop name.
  const user = await getAuthUser(req, res);

  if (!user) return rejectUnauthenticated(req, res);

  try {
    const { submissionId, status, error: errorMsg } = req.body;

    if (!submissionId || typeof submissionId !== 'string' || !status) {
      return res.status(400).json({ error: 'submissionId and status are required' });
    }

    // submitted    — extension positively saw the tracking number on the saved Etsy order
    // needs_manual — number typed but saving couldn't be confirmed (no submit button /
    //                not visible after submit); stays in tracking-pending for retry
    // failed       — automation error
    if (!['submitted', 'failed', 'needs_manual'].includes(status)) {
      return res.status(400).json({ error: 'status must be "submitted", "failed" or "needs_manual"' });
    }

    // Verify the submission belongs to this user
    const submission = await prisma.trackingSubmission.findFirst({
      where: { id: submissionId, submittedBy: user.id },
    });

    if (!submission) {
      return res.status(404).json({ error: 'Tracking submission not found' });
    }

    // Update the submission
    const updated = await prisma.trackingSubmission.update({
      where: { id: submissionId },
      data: {
        etsySubmitStatus: status,
        etsySubmittedAt: status === 'submitted' ? new Date() : undefined,
        etsySubmitError: status === 'submitted' ? null : (typeof errorMsg === 'string' && errorMsg ? errorMsg.slice(0, 500) : 'Unknown error'),
      },
    });

    logger.info('[tracking-confirm] Etsy tracking submission confirmed', {
      userId: user.id,
      submissionId,
      status,
    });

    return res.status(200).json({ success: true, status: updated.etsySubmitStatus });
  } catch (error) {
    logger.error('[tracking-confirm] Error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Internal server error' });
  }
}
