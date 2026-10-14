import * as crypto from 'crypto';
import {
  getEncryptionKey,
  encrypt as encryptEnvelope,
  isEncrypted as isEnvelope,
  decryptIfNeeded,
} from './crypto/credentials';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// Single source of truth for the key material: delegates to the KMS-backed loader
// in lib/crypto/credentials.ts. Under KMS the DEK is unwrapped at boot; in dev it
// falls back to CREDENTIAL_ENCRYPTION_KEY. Both this legacy base64 format and the
// newer `enc:v1:` envelope therefore share the exact same key.
function getKey(): Buffer {
  return getEncryptionKey();
}

/** Legacy writer: raw `base64(iv|tag|ciphertext)`. New writes use the `enc:v1:` envelope. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** Legacy reader: decrypts raw `base64(iv|tag|ciphertext)`. Throws if the auth tag doesn't verify. */
export function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export function encryptIfPresent(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  if (isEncrypted(value)) return value;
  return encryptEnvelope(value);
}

/** Accepts `enc:v1:` envelopes, legacy base64 ciphertext and plaintext; never throws. */
export function decryptIfPresent(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  try { return decryptIfNeeded(value); } catch { return value; }
}

/**
 * True only for values that are really ciphertext under our key. Base64 decoding
 * alone proves nothing — Node's decoder silently skips invalid characters, so any
 * long plaintext token "decodes" — hence the legacy format must pass the AES-GCM
 * auth tag check to count as encrypted. The `enc:v1:` envelope is unambiguous.
 */
export function isEncrypted(value: string): boolean {
  if (typeof value !== 'string' || !value) return false;
  if (isEnvelope(value)) return true;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  if (Buffer.from(value, 'base64').length <= IV_LENGTH + TAG_LENGTH) return false;
  try {
    decrypt(value);
    return true;
  } catch {
    return false;
  }
}

const CREDENTIAL_FIELDS = [
  'veeqoApiKey', 'shippoToken',
  'fedexApiKey', 'fedexApiSecret',
  'trendyolApiKey', 'trendyolApiSecret',
  'upsApiKey', 'upsApiSecret',
  'mngPassword', 'mngCustomerNumber', 'mngAppKey', 'mngAppSecret',
  'parasutClientId', 'parasutClientSecret', 'parasutUsername', 'parasutPassword',
  'etsyAccessToken', 'etsyRefreshToken',
  'ebayAccessToken', 'ebayRefreshToken',
  'wixAccessToken', 'wixRefreshToken',
  'shopifyAccessToken',
  'amazonAccessToken', 'amazonRefreshToken',
] as const;

export function encryptCredentials<T extends Record<string, any>>(creds: T): T {
  const result: Record<string, any> = { ...creds };
  for (const field of CREDENTIAL_FIELDS) {
    if (field in result && result[field]) {
      result[field] = encryptIfPresent(result[field]);
    }
  }
  return result as T;
}

export function decryptCredentials<T extends Record<string, any>>(creds: T): T {
  const result: Record<string, any> = { ...creds };
  for (const field of CREDENTIAL_FIELDS) {
    if (field in result && result[field]) {
      result[field] = decryptIfPresent(result[field]);
    }
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// Masking for the browser
// ---------------------------------------------------------------------------
//
// Secrets are never sent back to the client in plaintext. Identifiers the user
// needs to see/edit (supplier IDs, account/customer numbers, Paraşüt client ID
// and username) stay readable even when they are encrypted at rest.
// Keep in sync with SECRET_FIELDS / SECRET_MASK_CHAR in lib/hooks/useSettings.ts.

export const SECRET_MASK_CHAR = '•';

export const SECRET_FIELDS = [
  'veeqoApiKey', 'shippoToken',
  'fedexApiKey', 'fedexApiSecret',
  'trendyolApiKey', 'trendyolApiSecret',
  'upsApiKey', 'upsApiSecret',
  'hepsiburadaApiKey',
  'mngPassword', 'mngAppKey', 'mngAppSecret',
  'parasutClientSecret', 'parasutPassword',
  'etsyAccessToken', 'etsyRefreshToken',
  'ebayAccessToken', 'ebayRefreshToken',
  'wixAccessToken', 'wixRefreshToken',
  'shopifyAccessToken',
  'amazonAccessToken', 'amazonRefreshToken',
] as const;

/** '••••' + last 4 chars for long secrets; a fixed mask for short ones so little is revealed. */
export function maskSecret(plain: string): string {
  const dots = SECRET_MASK_CHAR.repeat(4);
  return plain.length >= 12 ? dots + plain.slice(-4) : dots + dots;
}

export function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.includes(SECRET_MASK_CHAR);
}

/** Replaces every non-empty secret field with its mask. Input must already be decrypted. */
export function maskCredentials<T extends Record<string, any>>(creds: T): T {
  const result: Record<string, any> = { ...creds };
  for (const field of SECRET_FIELDS) {
    if (field in result && result[field]) {
      result[field] = typeof result[field] === 'string' ? maskSecret(result[field]) : SECRET_MASK_CHAR.repeat(8);
    }
  }
  return result as T;
}

/**
 * Drops secret fields the client sent back as an (unchanged or partially edited)
 * mask, so saving the form never overwrites a real secret with the mask.
 * Dropped fields become undefined, which Prisma treats as "leave unchanged".
 */
export function stripMaskedSecrets<T extends Record<string, any>>(creds: T): T {
  const result: Record<string, any> = { ...creds };
  for (const field of SECRET_FIELDS) {
    if (isMaskedSecret(result[field])) delete result[field];
  }
  return result as T;
}
