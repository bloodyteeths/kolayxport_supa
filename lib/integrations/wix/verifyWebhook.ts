import crypto from 'crypto';
import { logger } from '@/lib/logger';

/**
 * Wix Webhook JWT signature verification.
 *
 * Wix signs every webhook payload (the JWT body of the POST) with the per-app RSA
 * public/private keypair declared in the Wix Developer Center under the Webhooks tab.
 * The PUBLIC half belongs in the env var WIX_WEBHOOK_PUBLIC_KEY as a PEM:
 *
 *   -----BEGIN PUBLIC KEY-----
 *   MIIBIj...
 *   -----END PUBLIC KEY-----
 *
 * Verification is RS256: SHA-256 over `${headerB64url}.${payloadB64url}` against the
 * RSA public key, using the b64url-decoded signature.
 *
 * Behaviour intentionally aligns with the existing webhook handler's "always return 200
 * to avoid hanging the Wix install" pattern. This module only tells the caller whether
 * the JWT was verifiable. The caller decides how to respond.
 */

export type WixVerifyResult =
  | { ok: true; header: any; payload: any }
  | {
      ok: false;
      reason:
        | 'no_public_key'
        | 'malformed_jwt'
        | 'unsupported_alg'
        | 'invalid_signature'
        | 'expired'
        | 'bad_issuer';
    };

function b64urlToBuffer(s: string): Buffer {
  // Pad if needed.
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function safeJsonParse(buf: Buffer): any | null {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function getPublicKey(): crypto.KeyObject | null {
  const pem = process.env.WIX_WEBHOOK_PUBLIC_KEY;
  if (!pem || typeof pem !== 'string') return null;
  try {
    // Allow the env var to contain escaped newlines (common in .env files).
    const normalized = pem.includes('\n') ? pem : pem.replace(/\\n/g, '\n');
    return crypto.createPublicKey({ key: normalized, format: 'pem' });
  } catch (err) {
    logger.warn('Wix webhook: failed to parse WIX_WEBHOOK_PUBLIC_KEY', {
      reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return null;
  }
}

export function verifyWixJwt(jwt: string): WixVerifyResult {
  if (typeof jwt !== 'string' || !jwt.includes('.')) {
    return { ok: false, reason: 'malformed_jwt' };
  }
  const parts = jwt.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_jwt' };

  const [headerB64, payloadB64, signatureB64] = parts;
  const headerJson = safeJsonParse(b64urlToBuffer(headerB64));
  const payloadJson = safeJsonParse(b64urlToBuffer(payloadB64));
  if (!headerJson || !payloadJson) return { ok: false, reason: 'malformed_jwt' };

  if (headerJson.alg !== 'RS256') {
    return { ok: false, reason: 'unsupported_alg' };
  }

  const key = getPublicKey();
  if (!key) {
    return { ok: false, reason: 'no_public_key' };
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = b64urlToBuffer(signatureB64);

  let verified = false;
  try {
    verified = crypto.verify('RSA-SHA256', signingInput, key, signature);
  } catch (err) {
    logger.warn('Wix webhook: crypto.verify threw', {
      reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return { ok: false, reason: 'invalid_signature' };
  }

  if (!verified) {
    return { ok: false, reason: 'invalid_signature' };
  }

  // Defence-in-depth claim checks. The caller already inspects payload further; we
  // also verify exp and (optionally) iss here so a single helper covers the basics.
  const expectedIssuers = new Set(['wix.com', 'www.wix.com', 'dev.wix.com']);
  if (payloadJson.iss && !expectedIssuers.has(payloadJson.iss)) {
    return { ok: false, reason: 'bad_issuer' };
  }
  if (typeof payloadJson.exp === 'number') {
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Allow 60s of clock skew.
    if (payloadJson.exp + 60 < nowSeconds) {
      return { ok: false, reason: 'expired' };
    }
  }

  return { ok: true, header: headerJson, payload: payloadJson };
}
