import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { consumeToken } from '@/lib/auth/tokens';
import { logAuthEvent } from '@/lib/admin/events';
import { maskEmail } from '@/lib/auth/email';

/**
 * GET /api/auth/verify-email?token=...
 *
 * Consumes the email-verification token, marks User.emailVerified = now(), and
 * redirects to the user-facing /auth/verify page with a status query for display.
 *
 * Generic redirect on every failure — no enumeration via response shape.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    return res.redirect('/auth/verify?status=invalid');
  }

  const result = await consumeToken(token, 'email_verify');
  if (!result.ok) {
    logAuthEvent('warn', {
      message: 'Email verify token rejected',
      operation: 'email.verify_token_rejected',
      details: { reason: result.reason },
    });
    return res.redirect(`/auth/verify?status=${encodeURIComponent(result.reason || 'invalid')}`);
  }

  // Only flip emailVerified on credentials users that aren't already verified.
  const updateResult = await prisma.user.updateMany({
    where: { email: result.identifier, emailVerified: null },
    data: { emailVerified: new Date() },
  });

  logAuthEvent('info', {
    message: 'Email verified',
    operation: 'email.verified',
    details: { email: maskEmail(result.identifier!), rowsTouched: updateResult.count },
  });

  return res.redirect('/auth/verify?status=ok');
}
