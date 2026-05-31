import crypto from 'crypto';
import prisma from '@/lib/prisma';

/**
 * Token-based auth flows: email verification + password reset.
 *
 * Storage shape: AuthToken row with `tokenHash` (SHA-256 of plaintext token in base64url),
 * `identifier` (lowercased email), `purpose`, `expires`, `consumedAt`. The plaintext
 * never lands in the DB — only in the URL we email to the user.
 *
 * Re-issuing for an identifier+purpose invalidates prior unconsumed tokens for the same
 * pair, so a user clicking "resend" effectively kills the older link.
 */

export type TokenPurpose = 'email_verify' | 'password_reset';

const TOKEN_BYTES = 32;

export function generatePlainToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

const DEFAULT_TTL_MS: Record<TokenPurpose, number> = {
  email_verify: 24 * 60 * 60 * 1000,   // 24h
  password_reset: 60 * 60 * 1000,      // 1h
};

export interface IssueArgs {
  identifier: string;
  purpose: TokenPurpose;
  ttlMs?: number;
}

/**
 * Issue a new token. Returns the PLAINTEXT (callers send it via URL).
 * Any prior unconsumed tokens for the same identifier+purpose are marked consumed,
 * so only the freshest link works.
 */
export async function issueToken(args: IssueArgs): Promise<string> {
  const ttlMs = args.ttlMs ?? DEFAULT_TTL_MS[args.purpose];
  const identifier = args.identifier.toLowerCase().trim();
  const plain = generatePlainToken();
  const tokenHash = hashToken(plain);
  const now = new Date();

  const delegate = (prisma as any).authToken;

  await delegate.updateMany({
    where: {
      identifier,
      purpose: args.purpose,
      consumedAt: null,
    },
    data: {
      consumedAt: now,
    },
  });

  await delegate.create({
    data: {
      tokenHash,
      identifier,
      purpose: args.purpose,
      expires: new Date(Date.now() + ttlMs),
    },
  });

  return plain;
}

export interface ConsumeResult {
  ok: boolean;
  identifier?: string;
  reason?: 'not_found' | 'expired' | 'already_consumed' | 'wrong_purpose';
}

/**
 * Consume a token. Atomic: if two concurrent requests race, only one wins.
 * Returns the identifier (lowercased email) on success.
 */
export async function consumeToken(plain: string, purpose: TokenPurpose): Promise<ConsumeResult> {
  if (typeof plain !== 'string' || plain.length === 0) {
    return { ok: false, reason: 'not_found' };
  }
  const tokenHash = hashToken(plain);
  const delegate = (prisma as any).authToken;
  const row = await delegate.findUnique({ where: { tokenHash } });
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.purpose !== purpose) return { ok: false, reason: 'wrong_purpose' };
  if (row.consumedAt) return { ok: false, reason: 'already_consumed' };
  if (new Date(row.expires) < new Date()) return { ok: false, reason: 'expired' };

  // Race-safe consume.
  const result = await delegate.updateMany({
    where: { tokenHash, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (result.count === 0) {
    return { ok: false, reason: 'already_consumed' };
  }
  return { ok: true, identifier: row.identifier };
}
