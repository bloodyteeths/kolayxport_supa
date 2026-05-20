import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new Error('CREDENTIAL_ENCRYPTION_KEY not set');
  return Buffer.from(key, 'hex');
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

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
  return encrypt(value);
}

export function decryptIfPresent(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  try { return decrypt(value); } catch { return value; }
}

function isEncrypted(value: string): boolean {
  try {
    const buf = Buffer.from(value, 'base64');
    return buf.length > IV_LENGTH + TAG_LENGTH;
  } catch { return false; }
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
