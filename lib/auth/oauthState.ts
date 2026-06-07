import crypto from 'crypto';

/**
 * Signed OAuth state helpers.
 *
 * OAuth `state` parameters are returned to us by third-party authorization
 * servers (Etsy, eBay, etc.). If we trust the contents naively, an attacker
 * can craft a state with a victim's userId, lure the victim into completing
 * an OAuth flow with the attacker's marketplace account, and end up writing
 * the attacker's tokens into the victim's row. To prevent that we HMAC-sign
 * the state payload on issuance and verify the signature on callback.
 *
 * Format: `<base64url(JSON payload)>.<hex sha256-hmac of the JSON bytes>`
 * Secret: `process.env.NEXTAUTH_SECRET` (already required for NextAuth).
 */

function getSecret(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required to sign OAuth state');
  }
  return Buffer.from(secret, 'utf8');
}

function hmacHex(payloadBytes: Buffer): string {
  return crypto.createHmac('sha256', getSecret()).update(payloadBytes).digest('hex');
}

/**
 * Sign an arbitrary JSON-serializable payload and produce an opaque `state`
 * string that can be sent through an OAuth round trip.
 */
export function signOAuthState(payload: unknown): string {
  const json = JSON.stringify(payload);
  const payloadBytes = Buffer.from(json, 'utf8');
  const encoded = payloadBytes.toString('base64url');
  const sig = hmacHex(payloadBytes);
  return `${encoded}.${sig}`;
}

/**
 * Verify a signed OAuth state. Returns the decoded payload on success, or
 * `null` if the signature is missing, malformed, or does not match. Uses
 * `timingSafeEqual` so signature comparison is not vulnerable to timing.
 *
 * The generic `T` is purely a typing convenience — callers should still
 * validate the shape of the returned object before using individual fields.
 */
export function verifyOAuthState<T = unknown>(state: string | null | undefined): T | null {
  if (!state || typeof state !== 'string') return null;

  const dot = state.lastIndexOf('.');
  if (dot <= 0 || dot === state.length - 1) return null;

  const encoded = state.slice(0, dot);
  const providedSig = state.slice(dot + 1);

  let payloadBytes: Buffer;
  try {
    payloadBytes = Buffer.from(encoded, 'base64url');
  } catch {
    return null;
  }

  let expectedSig: string;
  try {
    expectedSig = hmacHex(payloadBytes);
  } catch {
    return null;
  }

  // timingSafeEqual requires equal-length buffers.
  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const json = payloadBytes.toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
