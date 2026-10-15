// lib/ds/status/sync.ts — DS §3.9 sync domain: the state of STAGED changes (push), never pulls.
// Draft rows: EtsyListingDraft / EbayListingDraft / CatalogDraft `status`
// ('draft' | 'syncing' | 'conflict' | 'failed' | 'synced' | 'cancelled').
// `sync.refresh_failed` (pull failure) has no mapping here: it is set directly by the caller (overview queue).

import { normalizeRaw, type SyncStatusKey } from './vocabulary';

/** "Sent" is shown for 24h after the send, then hidden (DS §3.9). */
export const SYNCED_VISIBLE_MS = 24 * 60 * 60 * 1000;

export interface SyncStatusInput {
  status: string | null | undefined;
  /** When the draft was sent (EtsyListingDraft.syncedAt). Falls back to `updatedAt`. */
  syncedAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
}

/** Draft → sync pill key, or null when no pill is shown (no draft, cancelled, sent > 24h ago). */
export function syncStatus(draft: SyncStatusInput | null | undefined, now: Date = new Date()): SyncStatusKey | null {
  if (!draft) return null;
  switch (normalizeRaw(draft.status)) {
    case 'draft':
    case 'pending':
    case 'staged':
      return 'pending';
    case 'syncing':
    case 'sending':
      return 'syncing';
    case 'failed':
    case 'error':
      return 'sync_failed';
    case 'conflict':
      return 'conflict';
    case 'synced':
    case 'sent': {
      const at = draft.syncedAt ?? draft.updatedAt;
      if (at == null) return null;
      const t = new Date(at).getTime();
      return Number.isFinite(t) && now.getTime() - t < SYNCED_VISIBLE_MS ? 'synced' : null;
    }
    default:
      return null;
  }
}

/** True when the draft holds changes that still need sending (counts toward "Send N changes"). */
export function isUnsent(key: SyncStatusKey | null): boolean {
  return key === 'pending' || key === 'sync_failed' || key === 'conflict';
}
