import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import {
  encrypt,
  decrypt,
  isEncrypted,
  decryptIfNeeded,
  encryptIfNeeded,
  _resetKeyCacheForTests,
} from '@/lib/crypto/credentials';

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  _resetKeyCacheForTests();
});

describe('crypto/credentials', () => {
  it('round-trips arbitrary strings', () => {
    const samples = ['', 'short', 'a'.repeat(4096), 'türkçe-karakterler-éñ-🚀', 'oauth_v2_tk_xxx.yyy.zzz'];
    for (const s of samples) {
      const env = encrypt(s);
      expect(env.startsWith('enc:v1:')).toBe(true);
      expect(decrypt(env)).toBe(s);
    }
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encrypt('hello');
    const b = encrypt('hello');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('hello');
    expect(decrypt(b)).toBe('hello');
  });

  it('isEncrypted distinguishes envelope from plaintext', () => {
    expect(isEncrypted('plain')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(encrypt('x'))).toBe(true);
  });

  it('decrypt() throws on tampered ciphertext (GCM auth)', () => {
    const env = encrypt('secret');
    // Flip one bit of the ciphertext segment.
    const parts = env.slice('enc:v1:'.length).split(':');
    const ct = Buffer.from(parts[2], 'base64');
    ct[0] ^= 0x01;
    parts[2] = ct.toString('base64');
    const tampered = 'enc:v1:' + parts.join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('decrypt() throws on malformed envelope', () => {
    expect(() => decrypt('enc:v1:onlyonepart')).toThrow();
    expect(() => decrypt('not-an-envelope')).toThrow();
  });

  it('encryptIfNeeded leaves already-encrypted values alone', () => {
    const once = encrypt('s');
    expect(encryptIfNeeded(once)).toBe(once);
  });

  it('encryptIfNeeded and decryptIfNeeded pass through null/undefined', () => {
    expect(encryptIfNeeded(null)).toBeNull();
    expect(encryptIfNeeded(undefined)).toBeUndefined();
    expect(decryptIfNeeded(null)).toBeNull();
    expect(decryptIfNeeded(undefined)).toBeUndefined();
  });

  it('decryptIfNeeded returns plaintext unchanged (legacy compat)', () => {
    expect(decryptIfNeeded('legacy-token')).toBe('legacy-token');
  });

  it('decryptIfNeeded decrypts when envelope', () => {
    const env = encrypt('payload');
    expect(decryptIfNeeded(env)).toBe('payload');
  });
});

describe('Legacy lib/encryption.ts compatibility', () => {
  // The legacy `lib/encryption.ts` stores `base64(iv|tag|ciphertext)` with no prefix.
  // `decryptIfNeeded` must accept it so production rows written by /api/user/settings
  // continue to work after this sprint.
  function legacyEncrypt(plain: string): string {
    const key = crypto.createHash('sha256').update('does-not-matter-overridden').digest();
    void key;
    // We actually use the same env key — produce the legacy format manually.
    const k = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY!, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  it('decryptIfNeeded reads a legacy base64(iv|tag|ct) value', () => {
    const legacy = legacyEncrypt('legacy-token-value');
    expect(decryptIfNeeded(legacy)).toBe('legacy-token-value');
  });

  it('encryptIfNeeded leaves legacy ciphertext alone (no re-encryption)', () => {
    const legacy = legacyEncrypt('do-not-touch-me');
    const out = encryptIfNeeded(legacy);
    expect(out).toBe(legacy); // unchanged
  });

  it('decryptIfNeeded leaves plaintext untouched (e.g. NextAuth JWTs with dots)', () => {
    const plainJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-bytes';
    expect(decryptIfNeeded(plainJwt)).toBe(plainJwt);
  });

  it('encryptIfNeeded transforms plaintext into enc:v1: envelope', () => {
    const out = encryptIfNeeded('fresh-plain') as string;
    expect(out.startsWith('enc:v1:')).toBe(true);
  });

  it('encryptIfNeeded is idempotent on its own envelope', () => {
    const once = encryptIfNeeded('xy') as string;
    expect(encryptIfNeeded(once)).toBe(once);
  });
});
