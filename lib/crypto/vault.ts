/**
 * OpenBao / HashiCorp Vault "Transit" secrets-engine backend for the credential
 * Data Encryption Key (DEK).
 *
 * Same envelope model as the GCP KMS backend (lib/crypto/kms.ts): the 32-byte DEK
 * that lib/crypto/credentials.ts uses for AES-256-GCM is never stored in plaintext.
 * It is wrapped by a Transit key that lives inside Vault and never leaves it. At
 * boot we ask Vault to unwrap the DEK once, hold the plaintext DEK in process
 * memory, and use it for all subsequent AES-256-GCM operations.
 *
 * Transit owns the full key lifecycle Amazon SP-API DPP §2.4 requires: key
 * generation, secure storage, versioned rotation, and revocation. Prod/non-prod use
 * separate Transit keys (or separate Vault instances).
 *
 * Uses global fetch (Node 18+) — no SDK dependency.
 *
 * Environment:
 *   VAULT_ADDR                - e.g. http://127.0.0.1:8200
 *   VAULT_TRANSIT_KEY         - Transit key name that wraps the DEK (e.g. credential-kek)
 *   CREDENTIAL_DEK_CIPHERTEXT - the Vault-wrapped DEK ("vault:v1:...")
 *   VAULT_TRANSIT_MOUNT       - optional, defaults to "transit"
 *   Auth (one of):
 *     VAULT_TOKEN                         - a Vault token, OR
 *     VAULT_ROLE_ID + VAULT_SECRET_ID     - AppRole (preferred for prod)
 *   VAULT_APPROLE_MOUNT       - optional, defaults to "approle"
 *   VAULT_NAMESPACE           - optional (Vault Enterprise only; OpenBao OSS ignores)
 */

const KEY_LEN = 32;

let cachedDek: Buffer | null = null;
let loadPromise: Promise<Buffer> | null = null;

export function isVaultConfigured(): boolean {
  return Boolean(
    process.env.VAULT_ADDR &&
      process.env.VAULT_TRANSIT_KEY &&
      process.env.CREDENTIAL_DEK_CIPHERTEXT &&
      (process.env.VAULT_TOKEN ||
        (process.env.VAULT_ROLE_ID && process.env.VAULT_SECRET_ID)),
  );
}

export function getCachedDek(): Buffer | null {
  return cachedDek;
}

function baseAddr(): string {
  return (process.env.VAULT_ADDR || '').replace(/\/$/, '');
}

function nsHeader(): Record<string, string> {
  return process.env.VAULT_NAMESPACE ? { 'X-Vault-Namespace': process.env.VAULT_NAMESPACE } : {};
}

async function getVaultToken(): Promise<string> {
  if (process.env.VAULT_TOKEN) return process.env.VAULT_TOKEN;

  const roleId = process.env.VAULT_ROLE_ID;
  const secretId = process.env.VAULT_SECRET_ID;
  if (!roleId || !secretId) {
    throw new Error('Vault auth not configured: set VAULT_TOKEN or VAULT_ROLE_ID + VAULT_SECRET_ID');
  }
  const mount = process.env.VAULT_APPROLE_MOUNT || 'approle';
  const res = await fetch(`${baseAddr()}/v1/auth/${mount}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...nsHeader() },
    body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
  });
  if (!res.ok) {
    throw new Error(`Vault AppRole login failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const json: any = await res.json();
  const token = json?.auth?.client_token;
  if (!token) throw new Error('Vault AppRole login returned no client_token');
  return token;
}

async function unwrapDek(): Promise<Buffer> {
  const key = process.env.VAULT_TRANSIT_KEY;
  const ciphertext = process.env.CREDENTIAL_DEK_CIPHERTEXT;
  if (!process.env.VAULT_ADDR || !key || !ciphertext) {
    throw new Error('Vault not configured: VAULT_ADDR, VAULT_TRANSIT_KEY, CREDENTIAL_DEK_CIPHERTEXT required');
  }
  const mount = process.env.VAULT_TRANSIT_MOUNT || 'transit';
  const token = await getVaultToken();

  const res = await fetch(`${baseAddr()}/v1/${mount}/decrypt/${key}`, {
    method: 'POST',
    headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json', ...nsHeader() },
    body: JSON.stringify({ ciphertext }),
  });
  if (!res.ok) {
    throw new Error(`Vault Transit decrypt failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const json: any = await res.json();
  const b64 = json?.data?.plaintext;
  if (!b64) throw new Error('Vault Transit decrypt returned no plaintext');

  const dek = Buffer.from(b64, 'base64');
  if (dek.length !== KEY_LEN) {
    throw new Error(`Unwrapped DEK must be ${KEY_LEN} bytes; got ${dek.length}`);
  }
  return dek;
}

/**
 * Unwrap the DEK via Vault (once) and cache it. Concurrent callers share one
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
