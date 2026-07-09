/**
 * Central password policy for all credential-backed accounts.
 *
 * Enforced server-side on every path that sets a password (signup + reset), so a
 * client that skips validation still cannot store a weak secret. Aligned with
 * Amazon SP-API Data Protection Policy §1.4 (Credential Management):
 *
 *   - Minimum length: 10 characters.
 *   - Complexity: must combine lower-case, upper-case, and digits.
 *   - Identity restriction: must not contain the account e-mail local-part or
 *     any significant token from the display name ("restrictions on password
 *     composition relative to user identity information").
 *   - Common-password rejection: a small blocklist of the most-abused secrets.
 *
 * Expiration: interactive user passwords are not force-expired (NIST SP 800-63B
 * discourages mandatory periodic rotation in favour of length + breach checks).
 * Credentials are invalidated on demand via the password-reset flow, which also
 * revokes existing sessions. This module is the single source of truth for that
 * policy; document it in the security runbook rather than duplicating the rules.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200; // guard against bcrypt DoS via huge inputs

export type PasswordPolicyCode =
  | 'password_too_short'
  | 'password_too_long'
  | 'password_needs_lowercase'
  | 'password_needs_uppercase'
  | 'password_needs_digit'
  | 'password_contains_identity'
  | 'password_too_common';

export interface PasswordPolicyResult {
  ok: boolean;
  code?: PasswordPolicyCode;
  /** English fallback message. Clients should localise via the returned code. */
  message?: string;
}

// The most-abused passwords. Kept intentionally small — length + complexity +
// identity checks do the heavy lifting; this only catches the obvious ones.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'qwerty123', 'qwertyuiop',
  '12345678', '123456789', '1234567890', '11111111', '00000000', 'iloveyou',
  'admin123', 'letmein123', 'welcome123', 'abc12345', 'trustno1', 'sunshine1',
  'kolayxport', 'kolayxport1',
]);

function identityTokens(email?: string | null, name?: string | null): string[] {
  const tokens: string[] = [];
  if (email) {
    const local = email.split('@')[0]?.toLowerCase().trim();
    if (local) {
      tokens.push(local);
      // Split "john.doe", "john_doe", "john-doe" into their parts too.
      for (const part of local.split(/[._\-+]/)) {
        if (part.length >= 3) tokens.push(part);
      }
    }
  }
  if (name) {
    for (const part of name.toLowerCase().trim().split(/\s+/)) {
      if (part.length >= 3) tokens.push(part);
    }
  }
  // Dedupe and keep only tokens meaningful enough to matter (>= 3 chars).
  return [...new Set(tokens)].filter((t) => t.length >= 3);
}

export function validatePassword(
  password: unknown,
  identity: { email?: string | null; name?: string | null } = {},
): PasswordPolicyResult {
  if (typeof password !== 'string') {
    return { ok: false, code: 'password_too_short', message: 'Password is required.' };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      code: 'password_too_short',
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      code: 'password_too_long',
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    };
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, code: 'password_needs_lowercase', message: 'Password must include a lower-case letter.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, code: 'password_needs_uppercase', message: 'Password must include an upper-case letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, code: 'password_needs_digit', message: 'Password must include a number.' };
  }

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, code: 'password_too_common', message: 'This password is too common. Choose a less predictable one.' };
  }

  for (const token of identityTokens(identity.email, identity.name)) {
    if (lower.includes(token)) {
      return {
        ok: false,
        code: 'password_contains_identity',
        message: 'Password must not contain your name or e-mail address.',
      };
    }
  }

  return { ok: true };
}
