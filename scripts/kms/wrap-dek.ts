/**
 * One-time helper: wrap the credential DEK with your KMS backend and print the
 * ciphertext to put in CREDENTIAL_DEK_CIPHERTEXT.
 *
 * Backend is chosen automatically:
 *   - Vault / OpenBao Transit  -> when VAULT_ADDR is set
 *   - GCP KMS                  -> when GCP_KMS_KEY_NAME is set
 *
 * IMPORTANT — migration safety: to keep every existing encrypted credential
 * decryptable, wrap the *current* CREDENTIAL_ENCRYPTION_KEY as the DEK rather than
 * generating a new one. This script does exactly that when CREDENTIAL_ENCRYPTION_KEY
 * is set; otherwise it generates a fresh 32-byte DEK (only safe on an empty DB).
 *
 * --- Vault / OpenBao usage (run on the VPS, in the app dir) ---
 *   VAULT_ADDR=http://127.0.0.1:8200 \
 *   VAULT_TOKEN=<token-with-transit-encrypt-perm> \
 *   VAULT_TRANSIT_KEY=credential-kek \
 *   CREDENTIAL_ENCRYPTION_KEY=<existing-hex-key-from-.env> \
 *   npx tsx scripts/kms/wrap-dek.ts
 *
 * --- GCP KMS usage ---
 *   GCP_KMS_KEY_NAME=projects/P/locations/L/keyRings/R/cryptoKeys/K \
 *   CREDENTIAL_ENCRYPTION_KEY=<existing-hex-key> \
 *   npx tsx scripts/kms/wrap-dek.ts
 *
 * Then in the production .env set the printed vars and REMOVE
 * CREDENTIAL_ENCRYPTION_KEY (the KMS backend is now the source of truth).
 */
import crypto from 'crypto';

function resolveDek(): Buffer {
  const existing = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (existing) {
    const trimmed = existing.trim();
    const dek =
      /^[0-9a-fA-F]{64}$/.test(trimmed)
        ? Buffer.from(trimmed, 'hex')
        : Buffer.from(trimmed, 'base64');
    if (dek.length !== 32) {
      throw new Error(`Existing CREDENTIAL_ENCRYPTION_KEY must be 32 bytes; got ${dek.length}`);
    }
    console.error('Wrapping the EXISTING CREDENTIAL_ENCRYPTION_KEY (migration-safe).');
    return dek;
  }
  console.error('No CREDENTIAL_ENCRYPTION_KEY set — generated a NEW random DEK.');
  console.error('Only use this on an EMPTY database; existing ciphertext would be unreadable.');
  return crypto.randomBytes(32);
}

async function wrapWithVault(dek: Buffer): Promise<void> {
  const addr = (process.env.VAULT_ADDR || '').replace(/\/$/, '');
  const key = process.env.VAULT_TRANSIT_KEY || 'credential-kek';
  const mount = process.env.VAULT_TRANSIT_MOUNT || 'transit';
  const token = process.env.VAULT_TOKEN;
  const ns = process.env.VAULT_NAMESPACE;
  if (!token) throw new Error('VAULT_TOKEN is required to wrap the DEK with Vault');

  const res = await fetch(`${addr}/v1/${mount}/encrypt/${key}`, {
    method: 'POST',
    headers: {
      'X-Vault-Token': token,
      'Content-Type': 'application/json',
      ...(ns ? { 'X-Vault-Namespace': ns } : {}),
    },
    body: JSON.stringify({ plaintext: dek.toString('base64') }),
  });
  if (!res.ok) {
    throw new Error(`Vault Transit encrypt failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const json: any = await res.json();
  const ciphertext = json?.data?.ciphertext;
  if (!ciphertext) throw new Error('Vault Transit encrypt returned no ciphertext');

  console.error('\n--- Set these in your production .env ---');
  console.log(`VAULT_ADDR=${addr}`);
  console.log(`VAULT_TRANSIT_KEY=${key}`);
  if (mount !== 'transit') console.log(`VAULT_TRANSIT_MOUNT=${mount}`);
  console.log('# app auth: VAULT_ROLE_ID / VAULT_SECRET_ID (AppRole) or VAULT_TOKEN');
  console.log(`CREDENTIAL_DEK_CIPHERTEXT=${ciphertext}`);
  console.error('--- and REMOVE CREDENTIAL_ENCRYPTION_KEY ---\n');
}

async function wrapWithGcp(dek: Buffer): Promise<void> {
  const keyName = process.env.GCP_KMS_KEY_NAME!;
  // Dynamic import via a `string`-typed specifier: keeps googleapis' very large
  // .d.ts out of the app type-check (this file is in the tsconfig include set),
  // which otherwise OOMs the production build.
  const specifier: string = 'googleapis';
  const { google } = await import(specifier);

  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloudkms'] });
  const authClient = await auth.getClient();
  const kms = google.cloudkms({ version: 'v1', auth: authClient });

  const res = await kms.projects.locations.keyRings.cryptoKeys.encrypt({
    name: keyName,
    requestBody: { plaintext: dek.toString('base64') },
  });
  const ciphertext = res.data.ciphertext;
  if (!ciphertext) throw new Error('KMS encrypt returned empty ciphertext');

  console.error('\n--- Set these in your production .env ---');
  console.log(`GCP_KMS_KEY_NAME=${keyName}`);
  console.log(`CREDENTIAL_DEK_CIPHERTEXT=${ciphertext}`);
  console.error('--- and REMOVE CREDENTIAL_ENCRYPTION_KEY ---\n');
}

async function main() {
  const dek = resolveDek();

  if (process.env.VAULT_ADDR) {
    await wrapWithVault(dek);
  } else if (process.env.GCP_KMS_KEY_NAME) {
    await wrapWithGcp(dek);
  } else {
    throw new Error('Set VAULT_ADDR (Vault/OpenBao) or GCP_KMS_KEY_NAME (GCP KMS) to choose a backend');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
