// lib/auth/appleSecret.ts — Sign in with Apple client secret (SERVER ONLY). Apple wants an ES256 JWT signed with the
// "Sign in with Apple" key (.p8) instead of a static secret; it may live at most 6 months, so it is minted at boot
// and re-minted when older than 30 days. App Store guideline 4.8: the iOS app offers Google sign-in, so it must also
// offer Sign in with Apple.
//
// Env: APPLE_SERVICES_ID (the web "Services ID", e.g. com.kolayxport.signin), APPLE_TEAM_ID, APPLE_KEY_ID,
//      APPLE_PRIVATE_KEY (the .p8 contents; literal "\n" sequences are accepted).
import crypto from 'crypto';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function appleConfigured(): boolean {
  return Boolean(process.env.APPLE_SERVICES_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY);
}

let cached: { secret: string; at: number } | null = null;

export function appleClientSecret(now = Date.now()): string {
  if (cached && now - cached.at < 30 * 86_400_000) return cached.secret;
  const iat = Math.floor(now / 1000);
  const header = { alg: 'ES256', kid: process.env.APPLE_KEY_ID };
  const payload = {
    iss: process.env.APPLE_TEAM_ID,
    iat,
    exp: iat + 180 * 86_400,
    aud: 'https://appleid.apple.com',
    sub: process.env.APPLE_SERVICES_ID,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = crypto.createPrivateKey((process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'));
  const sig = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  cached = { secret: `${input}.${b64url(sig)}`, at: now };
  return cached.secret;
}
