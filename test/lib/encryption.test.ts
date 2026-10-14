import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import { _resetKeyCacheForTests, decryptIfNeeded, encrypt as encryptEnvelope } from '@/lib/crypto/credentials';
import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptIfPresent,
  decryptIfPresent,
  encryptCredentials,
  decryptCredentials,
  maskSecret,
  maskCredentials,
  stripMaskedSecrets,
  isMaskedSecret,
} from '@/lib/encryption';

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  _resetKeyCacheForTests();
});

// Realistic long plaintext tokens that base64-"decode" to > 28 bytes.
const LONG_PLAINTEXTS = [
  'shippo_live_' + 'a1b2c3d4e5'.repeat(4),
  'Vqt/' + 'abcdefABCDEF0123456789'.repeat(2),
  'A'.repeat(64),
  'abcdefghijklmnopqrstuvwxyz0123456789ABCD', // valid base64 alphabet, 40 chars
];

describe('lib/encryption isEncrypted', () => {
  it('rejects long plaintext tokens that merely look like base64', () => {
    for (const p of LONG_PLAINTEXTS) expect(isEncrypted(p)).toBe(false);
  });

  it('accepts legacy base64 ciphertext and enc:v1 envelopes', () => {
    expect(isEncrypted(encrypt('secret-value'))).toBe(true);
    expect(isEncrypted(encryptEnvelope('secret-value'))).toBe(true);
  });

  it('rejects empty / short / ciphertext under another key', () => {
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted('abc')).toBe(false);
    const foreign = Buffer.concat([crypto.randomBytes(12), crypto.randomBytes(16), crypto.randomBytes(20)]).toString('base64');
    expect(isEncrypted(foreign)).toBe(false);
  });
});

describe('lib/encryption write/read helpers', () => {
  it('encrypts long plaintext instead of storing it as-is', () => {
    for (const p of LONG_PLAINTEXTS) {
      const out = encryptIfPresent(p)!;
      expect(out).not.toBe(p);
      expect(out.startsWith('enc:v1:')).toBe(true);
      expect(decryptIfPresent(out)).toBe(p);
      expect(decryptIfNeeded(out)).toBe(p);
    }
  });

  it('never double-encrypts existing ciphertext of either format', () => {
    const legacy = encrypt('legacy');
    const env = encryptEnvelope('env');
    expect(encryptIfPresent(legacy)).toBe(legacy);
    expect(encryptIfPresent(env)).toBe(env);
  });

  it('decryptIfPresent handles legacy, envelope, plaintext and empty', () => {
    expect(decryptIfPresent(encrypt('legacy'))).toBe('legacy');
    expect(decrypt(encrypt('legacy'))).toBe('legacy');
    expect(decryptIfPresent(encryptEnvelope('env'))).toBe('env');
    expect(decryptIfPresent('plain-token')).toBe('plain-token');
    expect(decryptIfPresent('enc:v1:garbage')).toBe('enc:v1:garbage');
    expect(decryptIfPresent('')).toBe('');
    expect(decryptIfPresent(null)).toBe(null);
    expect(decryptIfPresent(undefined)).toBe(undefined);
  });

  it('encryptCredentials/decryptCredentials round-trip and leave non-credential fields alone', () => {
    const input = { shippoToken: LONG_PLAINTEXTS[0], mngCustomerNumber: '123456', trendyolSupplierId: '999', veeqoApiKey: '' };
    const enc = encryptCredentials(input);
    expect(enc.shippoToken).not.toBe(input.shippoToken);
    expect(enc.mngCustomerNumber).not.toBe('123456');
    expect(enc.trendyolSupplierId).toBe('999');
    expect(enc.veeqoApiKey).toBe('');
    expect(decryptCredentials(enc)).toEqual(input);
  });
});

describe('lib/encryption masking', () => {
  it('masks long secrets as dots + last 4, short ones fully', () => {
    expect(maskSecret('abcdefghijkl1234')).toBe('••••1234');
    expect(maskSecret('short')).toBe('••••••••');
    expect(isMaskedSecret(maskSecret('anything'))).toBe(true);
    expect(isMaskedSecret('plain')).toBe(false);
  });

  it('maskCredentials hides secrets but keeps identifiers readable', () => {
    const out = maskCredentials({
      shippoToken: LONG_PLAINTEXTS[0], mngPassword: 'pw', etsyAccessToken: 'x'.repeat(30),
      mngCustomerNumber: '123456', trendyolSupplierId: '999', upsApiKey: null,
    });
    expect(out.shippoToken).toBe('••••' + LONG_PLAINTEXTS[0].slice(-4));
    expect(out.mngPassword).toBe('••••••••');
    expect(out.etsyAccessToken).toBe('••••xxxx');
    expect(out.mngCustomerNumber).toBe('123456');
    expect(out.trendyolSupplierId).toBe('999');
    expect(out.upsApiKey).toBe(null);
  });

  it('stripMaskedSecrets drops masks but keeps new values and clears', () => {
    const out = stripMaskedSecrets({ shippoToken: '••••abcd', veeqoApiKey: 'new-key', upsApiKey: '', trendyolSupplierId: '1' });
    expect('shippoToken' in out).toBe(false);
    expect(out.veeqoApiKey).toBe('new-key');
    expect(out.upsApiKey).toBe('');
    expect(out.trendyolSupplierId).toBe('1');
  });
});
