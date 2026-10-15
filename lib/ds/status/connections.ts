// lib/ds/status/connections.ts — DS §3.9 connection domain; mapping from overview §3.4 / settings §5.
// Honest data (P6): a failed check is `check_failed` ("Couldn't check"), never `not_connected`.

import type { ConnectionStatusKey } from './vocabulary';

export interface ConnectionStatusInput {
  connected?: boolean | null;
  needsReauth?: boolean | null;
  /** e.g. 'incomplete_credentials' from lib/integrations/connectionStatus. */
  reason?: string | null;
}

/**
 * - `checkFailed` (the connections request errored and there is no data) → `check_failed`
 * - unknown provider entry (null/undefined input) → `check_failed` (we do not know it is disconnected);
 *   pass `{ connected: false }` when the provider is known to be absent
 * - connected + needsReauth → `needs_reconnect` · connected → `connected`
 * - not connected + reason `incomplete_credentials` → `incomplete` · otherwise `not_connected`
 */
export function connectionStatus(
  input: ConnectionStatusInput | null | undefined,
  opts: { checkFailed?: boolean } = {},
): ConnectionStatusKey {
  if (opts.checkFailed || !input) return 'check_failed';
  if (input.connected) return input.needsReauth ? 'needs_reconnect' : 'connected';
  if (input.needsReauth) return 'needs_reconnect';
  if (input.reason === 'incomplete_credentials') return 'incomplete';
  return 'not_connected';
}
