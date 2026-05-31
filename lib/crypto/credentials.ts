import crypto from 'crypto';

/**
 * Envelope-format credential encryption.
 *
 * Format: `enc:v1:<base64-iv>:<base64-tag>:<base64-ciphertext>`
 *
 * Storage compatibility: ciphertext lives in the same `String?` column as the
 * plaintext token did before. Read code MUST treat any value that does not
 * start with `enc:v1:` as plaintext (legacy) — see decryptIfNeeded().
 *
 * Cipher: AES-256-GCM with a 12-byte IV and 16-byte auth tag.
 *
 * Key source: CREDENTIAL_ENCRYPTION_KEY env. Accepts:
 *   - 64-char hex string (32 raw bytes)
 *   - 44-char base64 string (32 raw bytes after decode)
 *
 * Generate one with:
 *   openssl rand -hex 32
 */

const ENVELOPE_PREFIX = 'enc:v1:';
const ENVELOPE_PREFIX_LEN = ENVELOPE_PREFIX.length;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let cachedKey: Buffer | null = null;

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === 64) {
    return Buffer.from(trimmed, 'hex');
  }
  // base64 or base64url
  const padded =
    trimmed.length % 4 === 0
      ? trimmed
      : trimmed + '='.repeat(4 - (trimmed.length % 4));
  const buf = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return buf;
}

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32',
    );
  }
  const key = parseKey(raw);
  if (key.length !== KEY_LEN) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes; got ${key.length}.`,
    );
  }
  cachedKey = key;
  return key;
}

/**
 * Test-only helper: reset the cached key so tests can swap CREDENTIAL_ENCRYPTION_KEY.
 * Not intended for production use.
 */
export function _resetKeyCacheForTests() {
  cachedKey = null;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

export function encrypt(plain: string): string {
  if (typeof plain !== 'string') {
    throw new Error('encrypt(): expected string input');
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    ENVELOPE_PREFIX +
    iv.toString('base64') +
    ':' +
    tag.toString('base64') +
    ':' +
    ciphertext.toString('base64')
  );
}

export function decrypt(envelope: string): string {
  if (typeof envelope !== 'string' || !envelope.startsWith(ENVELOPE_PREFIX)) {
    throw new Error('decrypt(): not an encrypted envelope');
  }
  const body = envelope.slice(ENVELOPE_PREFIX_LEN);
  const parts = body.split(':');
  if (parts.length !== 3) {
    throw new Error('decrypt(): malformed envelope');
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  if (iv.length !== IV_LEN) throw new Error('decrypt(): bad IV length');
  if (tag.length !== TAG_LEN) throw new Error('decrypt(): bad tag length');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}

// ---------------------------------------------------------------------------
// Legacy format compatibility
// ---------------------------------------------------------------------------
//
// Before this module existed the repo shipped `lib/encryption.ts`, which encrypts
// to raw `base64(iv|tag|ciphertext)` (no `enc:v1:` prefix). That format is still
// produced by `pages/api/user/settings.ts` for user-pasted credentials (Veeqo,
// FedEx, UPS, MNG, Trendyol, Paraşüt, SMTP) and therefore exists in production
// today. We must therefore accept BOTH formats on read while continuing to write
// only the new `enc:v1:` envelope.
//
// Heuristic for the legacy format: a base64 string that decodes to at least
// `IV + TAG + 1 byte` of binary, has no `enc:v1:` prefix, and successfully
// decrypts with `aes-256-gcm` under the same key.
//
// If the value is plaintext (e.g. an OAuth token written directly into the DB
// before any encryption layer existed), legacy decrypt throws and we pass it
// through untouched.

const LEGACY_MIN_BYTES = IV_LEN + TAG_LEN + 1;

function looksLikeLegacy(value: string): boolean {
  if (value.startsWith(ENVELOPE_PREFIX)) return false;
  // Base64 only — quick reject for tokens that contain `.` (NextAuth JWT shape,
  // most OAuth bearer tokens, etc.).
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) return false;
  let buf: Buffer;
  try {
    buf = Buffer.from(value, 'base64');
  } catch {
    return false;
  }
  return buf.length >= LEGACY_MIN_BYTES;
}

function tryLegacyDecrypt(value: string): string | null {
  try {
    const key = getEncryptionKey();
    const buf = Buffer.from(value, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Read-path helper for the gradual migration.
 * Accepts THREE on-disk shapes and always returns plaintext:
 *   1. `enc:v1:...`               — new envelope (this module)
 *   2. raw base64 of `iv|tag|ct`  — legacy format from `lib/encryption.ts`
 *   3. anything else              — plaintext, passed through unchanged
 *
 * Returns null/undefined unchanged.
 */
export function decryptIfNeeded<T extends string | null | undefined>(value: T): T {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  if (isEncrypted(value)) return decrypt(value) as T;
  if (looksLikeLegacy(value)) {
    const decoded = tryLegacyDecrypt(value);
    if (decoded != null) return decoded as T;
  }
  return value;
}

/**
 * Write-path helper. If the value is already encrypted (either format), return as-is;
 * otherwise encrypt to the new `enc:v1:` envelope.
 * Null/undefined pass through.
 *
 * IMPORTANT: this never re-encrypts a legacy `base64(iv|tag|ct)` value. Production
 * already contains those, and a re-encrypt would mean writing `enc:v1:<base64-of-legacy>`
 * which is opaque to every other reader. The backfill script is responsible for
 * intentional legacy→enc:v1 migration; everyday writes must leave legacy alone.
 *
 * **Fail-soft when CREDENTIAL_ENCRYPTION_KEY is unset.** OAuth callbacks call this on
 * every token write. If the key isn't configured in production, throwing here would
 * break every marketplace connect/refresh. We preserve the pre-Sprint-5 behaviour
 * (plaintext write) instead. Operators must set the key for at-rest encryption to
 * actually take effect — the admin cockpit can surface this gap (look for new rows
 * without `enc:v1:` after a deploy).
 */
export function encryptIfNeeded<T extends string | null | undefined>(value: T): T {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  if (isEncrypted(value)) return value;
  if (looksLikeLegacy(value) && tryLegacyDecrypt(value) != null) return value;
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) return value;
  return encrypt(value) as T;
}
