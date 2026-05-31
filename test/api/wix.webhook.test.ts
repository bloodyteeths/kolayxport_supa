import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { verifyWixJwt } from '@/lib/integrations/wix/verifyWebhook';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signRs256(headerObj: any, payloadObj: any, privateKey: crypto.KeyObject): string {
  const header = b64url(Buffer.from(JSON.stringify(headerObj)));
  const payload = b64url(Buffer.from(JSON.stringify(payloadObj)));
  const signingInput = Buffer.from(`${header}.${payload}`, 'utf8');
  const signature = crypto.sign('RSA-SHA256', signingInput, privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

let keyPair: crypto.KeyPairKeyObjectResult;
const SAVED_ENV = process.env.WIX_WEBHOOK_PUBLIC_KEY;

beforeAll(() => {
  keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }) as string;
  process.env.WIX_WEBHOOK_PUBLIC_KEY = pubPem;
});

afterAll(() => {
  if (SAVED_ENV === undefined) delete process.env.WIX_WEBHOOK_PUBLIC_KEY;
  else process.env.WIX_WEBHOOK_PUBLIC_KEY = SAVED_ENV;
});

describe('Wix webhook JWT signature verification', () => {
  it('accepts a valid RS256-signed JWT from a known issuer', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = signRs256(
      { alg: 'RS256', typ: 'JWT' },
      { iss: 'wix.com', exp, data: JSON.stringify({ instanceId: 'inst-1' }) },
      keyPair.privateKey,
    );
    const result = verifyWixJwt(jwt);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.iss).toBe('wix.com');
    }
  });

  it('rejects a JWT signed by a different key (invalid_signature)', () => {
    const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = signRs256(
      { alg: 'RS256', typ: 'JWT' },
      { iss: 'wix.com', exp },
      otherKey.privateKey,
    );
    const result = verifyWixJwt(jwt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_signature');
  });

  it('rejects an unsigned (alg=none) JWT', () => {
    const headerB64 = b64url(Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })));
    const payloadB64 = b64url(Buffer.from(JSON.stringify({ iss: 'wix.com' })));
    const jwt = `${headerB64}.${payloadB64}.`;
    const result = verifyWixJwt(jwt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported_alg');
  });

  it('rejects an expired JWT', () => {
    const jwt = signRs256(
      { alg: 'RS256', typ: 'JWT' },
      { iss: 'wix.com', exp: Math.floor(Date.now() / 1000) - 3600 },
      keyPair.privateKey,
    );
    const result = verifyWixJwt(jwt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects an unknown issuer', () => {
    const jwt = signRs256(
      { alg: 'RS256', typ: 'JWT' },
      { iss: 'attacker.example', exp: Math.floor(Date.now() / 1000) + 3600 },
      keyPair.privateKey,
    );
    const result = verifyWixJwt(jwt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_issuer');
  });

  it('rejects a malformed JWT', () => {
    expect(verifyWixJwt('not-a-jwt').ok).toBe(false);
    expect(verifyWixJwt('only.two').ok).toBe(false);
    expect(verifyWixJwt('a.b.c.d').ok).toBe(false);
  });

  it('reports no_public_key when WIX_WEBHOOK_PUBLIC_KEY is unset', () => {
    const saved = process.env.WIX_WEBHOOK_PUBLIC_KEY;
    delete process.env.WIX_WEBHOOK_PUBLIC_KEY;
    const jwt = signRs256(
      { alg: 'RS256', typ: 'JWT' },
      { iss: 'wix.com', exp: Math.floor(Date.now() / 1000) + 3600 },
      keyPair.privateKey,
    );
    const result = verifyWixJwt(jwt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_public_key');
    if (saved) process.env.WIX_WEBHOOK_PUBLIC_KEY = saved;
  });
});
