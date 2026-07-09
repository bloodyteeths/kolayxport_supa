/**
 * GCP KMS envelope encryption for the credential Data Encryption Key (DEK).
 *
 * The 32-byte DEK that `lib/crypto/credentials.ts` uses for AES-256-GCM is never
 * stored in plaintext. Instead it is *wrapped* (encrypted) by a Key-Encryption-Key
 * (KEK) that lives inside Google Cloud KMS and never leaves it. At boot we ask KMS
 * to unwrap the DEK once, hold the plaintext DEK in process memory, and use it for
 * all subsequent AES-256-GCM operations.
 *
 * This satisfies SP-API DPP §2.4: KMS owns the KEK lifecycle (generation, storage,
 * rotation, revocation) and prod/non-prod use separate KMS key rings.
 *
 * Environment:
 *   GCP_KMS_KEY_NAME          - full resource name of the KEK:
 *                               projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>
 *   CREDENTIAL_DEK_CIPHERTEXT - base64 of the KMS-wrapped 32-byte DEK
 *   GOOGLE_APPLICATION_CREDENTIALS - service-account JSON with roles/cloudkms.cryptoKeyDecrypter
 *
 * When these are absent we fall back to the plaintext CREDENTIAL_ENCRYPTION_KEY env
 * var (local dev / pre-migration). Production must use the KMS path.
 */

const KEY_LEN = 32;

let cachedDek: Buffer | null = null;
let loadPromise: Promise<Buffer> | null = null;

export function isKmsConfigured(): boolean {
  return Boolean(process.env.GCP_KMS_KEY_NAME && process.env.CREDENTIAL_DEK_CIPHERTEXT);
}

export function getCachedDek(): Buffer | null {
  return cachedDek;
}

async function unwrapDek(): Promise<Buffer> {
  const name = process.env.GCP_KMS_KEY_NAME;
  const ciphertext = process.env.CREDENTIAL_DEK_CIPHERTEXT;
  if (!name || !ciphertext) {
    throw new Error('KMS not configured: GCP_KMS_KEY_NAME and CREDENTIAL_DEK_CIPHERTEXT required');
  }

  // Lazy import: googleapis is Node-only (uses `fs`/`stream`). Loading it here
  // instead of at module top keeps it out of the static bundle graph so the edge
  // runtime / instrumentation compile never tries to resolve Node builtins.
  const { google } = await import('googleapis');

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloudkms'],
  });
  const authClient = await auth.getClient();
  const kms = google.cloudkms({ version: 'v1', auth: authClient as any });

  const res = await kms.projects.locations.keyRings.cryptoKeys.decrypt({
    name,
    requestBody: { ciphertext },
  });

  const plaintextB64 = res.data.plaintext;
  if (!plaintextB64) {
    throw new Error('KMS decrypt returned an empty plaintext DEK');
  }
  const dek = Buffer.from(plaintextB64, 'base64');
  if (dek.length !== KEY_LEN) {
    throw new Error(`Unwrapped DEK must be ${KEY_LEN} bytes; got ${dek.length}`);
  }
  return dek;
}

/**
 * Unwrap the DEK via KMS (once) and cache it. Concurrent callers share one
 * in-flight request. On failure the promise is cleared so a later call can retry.
 */
export async function loadDek(): Promise<Buffer> {
  if (cachedDek) return cachedDek;
  if (!loadPromise) {
    loadPromise = unwrapDek()
      .then((dek) => {
        cachedDek = dek;
        return dek;
      })
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
  }
  return loadPromise;
}

/** Test-only: drop the cached DEK. */
export function _resetDekCacheForTests() {
  cachedDek = null;
  loadPromise = null;
}
