import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { rateLimit } from '@/lib/middleware/rateLimit';
import { issueToken } from '@/lib/auth/tokens';
import { sendEmail, passwordResetEmailBody, maskEmail } from '@/lib/auth/email';
import { logAuthEvent } from '@/lib/admin/events';

/**
 * POST /api/auth/request-reset
 * Body: { email }
 *
 * Always returns `{ ok: true }` (no enumeration). Rate-limited per IP+URL.
 * Only sends a reset link to credentials users (User.password != null). Google-only
 * users have no password and would silently swallow the request — that is intentional
 * to keep the response shape uniform.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!rateLimit(60_000, 3)(req, res)) return;

  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return res.status(200).json({ ok: true });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, password: true },
    });

    if (user && user.password) {
      const plainToken = await issueToken({ identifier: email, purpose: 'password_reset' });
      const base = process.env.NEXTAUTH_URL || 'https://kolayxport.com';
      const url = `${base.replace(/\/$/, '')}/auth/reset?token=${encodeURIComponent(plainToken)}`;
      const { subject, textBody } = passwordResetEmailBody(url);
      const sendResult = await sendEmail({ to: email, subject, textBody });
      logAuthEvent('info', {
        message: 'Password reset requested',
        operation: 'password.reset_requested',
        details: { userId: user.id, to: maskEmail(email), sent: sendResult.sent, reason: sendResult.reason },
      });
    }
  } catch (err) {
    logAuthEvent('error', {
      message: 'request-reset handler error',
      operation: 'password.reset_request_error',
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }

  return res.status(200).json({ ok: true });
}
