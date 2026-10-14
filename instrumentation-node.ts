/**
 * Node-only instrumentation. Imported exclusively from instrumentation.ts under the
 * `NEXT_RUNTIME === 'nodejs'` guard, so this module (and its googleapis/KMS deps)
 * is never included in the edge-runtime bundle.
 *
 * 1. Unwraps the credential Data Encryption Key from GCP KMS / Vault at boot so the
 *    synchronous encrypt/decrypt helpers in lib/crypto/credentials.ts have their key ready.
 * 2. Starts the in-process scheduler and the Etsy webhook worker (lib/scheduler):
 *    on by default in production, never during `next build`, kill switch
 *    KX_DISABLE_INPROCESS_JOBS=1. A failure is logged and never crashes boot.
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

  try {
    if (process.env.NEXT_PHASE !== 'phase-production-build' && process.env.KX_DISABLE_INPROCESS_JOBS !== '1') {
      const { startInProcessJobs } = await import('./lib/scheduler');
      const decision = await startInProcessJobs();
      if (decision.scheduler) {
        console.log(`[instrumentation] In-process scheduler scheduled to start (worker loop: ${decision.worker ? 'on' : 'off'}).`);
      }
    }
  } catch (err) {
    console.error('[instrumentation] Failed to start in-process jobs:', err);
  }
}
