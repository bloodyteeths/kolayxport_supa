/**
 * Next.js instrumentation hook — runs once when the server process starts.
 *
 * The actual Node-only work (unwrapping the credential DEK from GCP KMS, which
 * pulls in `googleapis` and Node builtins) lives in ./instrumentation-node. It is
 * imported ONLY under the positive `NEXT_RUNTIME === 'nodejs'` guard so the edge
 * build dead-code-eliminates the import and never traces googleapis. See
 * lib/crypto/kms.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
