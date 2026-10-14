/**
 * Hepsiburada stock adapter (W2): 'coming soon' stub per founder decision.
 */
import type { StockAdapter } from './types';

export const hepsiburadaAdapter: StockAdapter = {
  channel: 'hepsiburada',
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
