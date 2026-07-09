/**
 * One-time helper: wrap the credential DEK with a GCP KMS key (KEK) and print the
 * ciphertext to put in CREDENTIAL_DEK_CIPHERTEXT.
 *
 * IMPORTANT — migration safety: to keep every existing encrypted credential
 * decryptable, wrap the *current* CREDENTIAL_ENCRYPTION_KEY as the DEK rather than
 * generating a new one. This script does exactly that when CREDENTIAL_ENCRYPTION_KEY
 * is set; otherwise it generates a fresh 32-byte DEK (only safe on an empty DB).
 *
 * Usage (from the app dir, with gcloud ADC or GOOGLE_APPLICATION_CREDENTIALS set):
 *   GCP_KMS_KEY_NAME=projects/P/locations/L/keyRings/R/cryptoKeys/K \
 *   CREDENTIAL_ENCRYPTION_KEY=<existing-hex-key> \
 *   npx tsx scripts/kms/wrap-dek.ts
 *
 * Then in the production .env:
 *   - set   GCP_KMS_KEY_NAME=...            (same value)
 *   - set   CREDENTIAL_DEK_CIPHERTEXT=...   (printed below)
 *   - REMOVE CREDENTIAL_ENCRYPTION_KEY       (KMS is now the source of truth)
 */
import crypto from 'crypto';
import { google } from 'googleapis';

async function main() {
  const keyName = process.env.GCP_KMS_KEY_NAME;
  if (!keyName) {
    throw new Error('GCP_KMS_KEY_NAME is required (projects/.../cryptoKeys/...)');
  }

  let dek: Buffer;
  const existing = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (existing) {
    const trimmed = existing.trim();
    dek =
      /^[0-9a-fA-F]{64}$/.test(trimmed)
        ? Buffer.from(trimmed, 'hex')
        : Buffer.from(trimmed, 'base64');
    if (dek.length !== 32) {
      throw new Error(`Existing CREDENTIAL_ENCRYPTION_KEY must be 32 bytes; got ${dek.length}`);
    }
    console.error('Wrapping the EXISTING CREDENTIAL_ENCRYPTION_KEY (migration-safe).');
  } else {
    dek = crypto.randomBytes(32);
    console.error('No CREDENTIAL_ENCRYPTION_KEY set — generated a NEW random DEK.');
    console.error('Only use this on an EMPTY database; existing ciphertext would be unreadable.');
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloudkms'],
  });
  const authClient = await auth.getClient();
  const kms = google.cloudkms({ version: 'v1', auth: authClient as any });

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
