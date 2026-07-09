import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { rateLimit } from '@/lib/middleware/rateLimit';
import { consumeToken } from '@/lib/auth/tokens';
import { logAuthEvent } from '@/lib/admin/events';
import { validatePassword } from '@/lib/auth/passwordPolicy';

/**
 * POST /api/auth/reset-password
 * Body: { token, newPassword }
 *
 * - Validates token via consumeToken('password_reset').
 * - bcrypt-hashes newPassword at cost 12.
 * - Updates User.password where the email matches AND password is currently set
 *   (avoids overwriting a Google-only account's null password).
 * - Removes any NextAuth Session rows for the user (best-effort — we use JWT sessions
 *   primarily, but a real Session row may exist for OAuth users).
 *
 * Generic JSON shape: `{ ok: true }` on success, `{ ok: false, error: ... }` on
 * validation failures. The token-rejection reasons are not leaked beyond a single
 * `invalid_or_expired` code.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!rateLimit(60_000, 5)(req, res)) return;

  const token = String(req.body?.token || '');
  const newPassword = String(req.body?.newPassword || '');

  if (!token || !newPassword) {
    return res.status(400).json({ ok: false, error: 'invalid_input' });
  }
  // Complexity/length check up-front so we don't burn the single-use token on a
  // weak password. The identity check runs again below once we know the e-mail.
  const preCheck = validatePassword(newPassword);
  if (!preCheck.ok) {
    return res.status(400).json({ ok: false, error: preCheck.code, message: preCheck.message });
  }

  const result = await consumeToken(token, 'password_reset');
  if (!result.ok) {
    logAuthEvent('warn', {
      message: 'Password reset token rejected',
      operation: 'password.reset_token_rejected',
      details: { reason: result.reason },
    });
    return res.status(400).json({ ok: false, error: 'invalid_or_expired' });
  }

  // Now that the token is validated we know the account e-mail: enforce the
  // identity restriction (password must not embed the e-mail local-part).
  const identityCheck = validatePassword(newPassword, { email: result.identifier });
  if (!identityCheck.ok) {
    return res.status(400).json({ ok: false, error: identityCheck.code, message: identityCheck.message });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  try {
    const updateResult = await prisma.user.updateMany({
      where: { email: result.identifier, password: { not: null } },
      data: { password: hashedPassword },
    });

    if (updateResult.count === 0) {
      // Token was valid but no credentials user matches. Don't leak that fact.
      return res.status(400).json({ ok: false, error: 'invalid_or_expired' });
    }

    // Best-effort: kill any DB-backed sessions for this user. JWT sessions remain
    // valid until their natural expiry — documented in the runbook.
    const user = await prisma.user.findUnique({
      where: { email: result.identifier },
      select: { id: true },
    });
    if (user) {
      await prisma.session.deleteMany({ where: { userId: user.id } });
      logAuthEvent('info', {
        message: 'Password reset completed',
        operation: 'password.reset_completed',
        details: { userId: user.id },
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    logAuthEvent('error', {
      message: 'reset-password handler error',
      operation: 'password.reset_error',
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
