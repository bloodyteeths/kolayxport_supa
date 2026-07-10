/**
 * Node-only instrumentation. Imported exclusively from instrumentation.ts under the
 * `NEXT_RUNTIME === 'nodejs'` guard, so this module (and its googleapis/KMS deps)
 * is never included in the edge-runtime bundle.
 *
 * Unwraps the credential Data Encryption Key from GCP KMS at boot so the synchronous
 * encrypt/decrypt helpers in lib/crypto/credentials.ts have their key ready.
 */
export async function registerNode() {
  try {
    const { initEncryptionKey } = await import('./lib/crypto/credentials');
    await initEncryptionKey();
    if (process.env.VAULT_ADDR) {
      console.log('[instrumentation] Credential DEK unwrapped from Vault Transit.');
    } else if (process.env.GCP_KMS_KEY_NAME) {
      console.log('[instrumentation] Credential DEK unwrapped from GCP KMS.');
    }
  } catch (err) {
    // Don't crash the server on boot — but make the failure loud. Credential
    // encrypt/decrypt throws its own clear error on first use until this is fixed.
    console.error('[instrumentation] Failed to load credential encryption key:', err);
  }
}
