import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

/**
 * Credentials provider `authorize` body, extracted so we can unit-test it without
 * spinning up NextAuth. Returns the user shape NextAuth expects, OR `null` for a
 * generic "invalid credentials", OR throws a stable error code for states the UI
 * needs to distinguish.
 *
 * Error codes thrown (NextAuth surfaces these as `?error=<message>` on the signIn URL):
 *   - `EMAIL_NOT_VERIFIED` — password is correct but `User.emailVerified` is null.
 *     The login UI watches for this exact string and offers a "resend verification"
 *     button. We check this AFTER bcrypt.compare so a wrong-password caller never
 *     learns whether the email exists; only a caller who already knows the password
 *     learns that the account is unverified.
 *
 * Google-only users (User.password === null) never reach this provider; they go
 * through the Google OAuth provider instead. We still treat them as a null return
 * here for defence in depth.
 */
export async function credentialsAuthorize(
  email: unknown,
  password: unknown,
): Promise<{ id: string; email: string | null; name: string | null } | null> {
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  if (!email || !password) return null;

  const normalizedEmail = email.toLowerCase().trim();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (!user || !user.password) return null;

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;

  if (user.emailVerified == null) {
    throw new Error('EMAIL_NOT_VERIFIED');
  }

  return { id: user.id, email: user.email, name: user.name };
}
