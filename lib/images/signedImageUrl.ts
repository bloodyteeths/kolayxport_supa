import crypto from 'crypto';

/**
 * Signed URLs for locally stored listing images.
 *
 * Listing photos live on the Hetzner filesystem and are served through
 * `/api/clawd/serve-image`. That endpoint is session-authenticated, which is
 * right for the dashboard but fatal for marketplaces: when we hand eBay an
 * `imageUrls` entry it fetches the URL anonymously from its own servers and
 * gets a 401, so the listing can never be published with our photos.
 *
 * Rather than making the whole endpoint public, each uploaded file gets an
 * HMAC signature over its storage path. A request carrying a valid signature
 * is allowed through without a session; everything else still goes through the
 * normal owner check.
 *
 * Secret: `process.env.NEXTAUTH_SECRET` (already required for NextAuth).
 */

function getSecret(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required to sign image URLs');
  }
  return Buffer.from(secret, 'utf8');
}

/** HMAC of a storage path, e.g. `<userId>/<filename>.jpg`. */
export function signImagePath(storagePath: string): string {
  return crypto
    .createHmac('sha256', getSecret())
    .update(Buffer.from(storagePath, 'utf8'))
    .digest('hex');
}

/**
 * Constant-time check of a signature produced by `signImagePath`. Returns
 * false on any malformed input or if the secret is unavailable.
 */
export function verifyImagePathSignature(
  storagePath: string,
  signature: unknown
): boolean {
  if (typeof signature !== 'string' || signature.length === 0) return false;

  let expected: string;
  try {
    expected = signImagePath(storagePath);
  } catch {
    return false;
  }

  const providedBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
