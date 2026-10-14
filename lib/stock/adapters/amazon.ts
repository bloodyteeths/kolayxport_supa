/**
 * Amazon stock adapter (W2): 'coming soon' stub per founder decision.
 * Amazon orders still decrement the hub (sales are read from orders), but no
 * Amazon quantity is read or written.
 */
import type { StockAdapter } from './types';

export const amazonAdapter: StockAdapter = {
  channel: 'amazon',
  supportsWrite: false,
  unsupportedReason: 'coming_soon',
  async listAccounts() {
    return [];
  },
  async ownsAccount() {
    return false;
  },
  async listCandidates() {
    return [];
  },
  async readQuantities() {
    return new Map();
  },
  async pushQuantities(_userId, items) {
    return items.map((it) => ({ pushId: it.pushId, linkId: it.link.id, status: 'failed' as const, retryable: false, error: 'coming_soon', linkPatch: { status: 'unsupported', statusReason: 'coming_soon' } }));
  },
};
