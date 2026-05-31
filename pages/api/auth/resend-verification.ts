import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { rateLimit } from '@/lib/middleware/rateLimit';
import { issueToken } from '@/lib/auth/tokens';
import { sendEmail, verificationEmailBody, maskEmail } from '@/lib/auth/email';
import { logAuthEvent } from '@/lib/admin/events';

/**
 * POST /api/auth/resend-verification
 * Body: { email }
 *
 * Always returns `{ ok: true }` (no enumeration). Rate-limited per IP+URL.
 * Only sends an email when:
 *   - User exists
 *   - User has a password (credentials user; Google users are skipped — they have no
 *     emailVerified-null state to recover)
 *   - User.emailVerified is null
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // 3 requests per 60s per IP per URL.
  if (!rateLimit(60_000, 3)(req, res)) return;

  const email = String(req.body?.email || '').toLowerCase().trim();
  // Defensive: never throw or return early in a way that lets the client distinguish.
  if (!email || !email.includes('@')) {
    return res.status(200).json({ ok: true });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, password: true, emailVerified: true },
    });

    if (user && user.password && !user.emailVerified) {
      const plainToken = await issueToken({ identifier: email, purpose: 'email_verify' });
      const base = process.env.NEXTAUTH_URL || 'https://kolayxport.com';
      const url = `${base.replace(/\/$/, '')}/api/auth/verify-email?token=${encodeURIComponent(plainToken)}`;
      const { subject, textBody } = verificationEmailBody(url);
      const sendResult = await sendEmail({ to: email, subject, textBody });
      logAuthEvent('info', {
        message: 'Verification email re-sent',
        operation: 'email.verify_resent',
        details: { to: maskEmail(email), userId: user.id, sent: sendResult.sent, reason: sendResult.reason },
      });
    }
  } catch (err) {
    logAuthEvent('error', {
      message: 'resend-verification handler error',
      operation: 'email.verify_resend_error',
      error: err instanceof Error ? err : new Error(String(err)),
    });
    // Still 200 — no enumeration.
  }

  return res.status(200).json({ ok: true });
}
