// components/domain/listing-editor/draftSendError.ts — the editor's failed-banner cause from the draft API row.
// The Etsy / eBay draft routes return `lastSyncErrorKey` (the stored next-intl key, or null for legacy rows) and put
// English text back into `lastSyncError` for the legacy pages (docs/integration/draft-sync-error-codes.md). The
// editor reads the key; the adapters' English bucketing stays only as the fallback for old rows.
import type { DraftRow } from '@/lib/listingEditor/types';
import { draftSendError, isI18nKey, type SendError } from '@/lib/listings/sendError';

type ApiDraft = { lastSyncErrorKey?: unknown; syncAttempts?: unknown };

/**
 * The stored error key (+ ICU params from the failed / conflict attempt that recorded it: `result.errorKey` /
 * `result.errorParams`) of a failed or
 * conflicted draft, or null when the API sent no key (legacy text, catalog drafts, other statuses).
 */
export function storedDraftSendError(draft: Pick<DraftRow, 'status' | 'raw'> | null | undefined, prefix?: string): SendError | null {
  if (!draft) return null;
  const raw = (draft.raw && typeof draft.raw === 'object' ? draft.raw : {}) as ApiDraft;
  if (!isI18nKey(raw.lastSyncErrorKey)) return null;
  return draftSendError({ status: draft.status, lastSyncErrorKey: raw.lastSyncErrorKey, syncAttempts: raw.syncAttempts }, { prefix });
}

/**
 * ICU params for `causeKey` (an adapter's `failureCauseKey`, which may have added an `etsy.` / `ebay.` namespace to a
 * bare stored key). Undefined when the API's stored key is a different key or no attempt recorded params for it.
 */
export function storedDraftSendErrorParams(
  draft: Pick<DraftRow, 'status' | 'raw'> | null | undefined,
  causeKey: string,
): Record<string, string | number> | undefined {
  if (!draft) return undefined;
  const raw = (draft.raw && typeof draft.raw === 'object' ? draft.raw : {}) as ApiDraft;
  if (!isI18nKey(raw.lastSyncErrorKey)) return undefined;
  const key = raw.lastSyncErrorKey.trim();
  const prefix = causeKey !== key && causeKey.endsWith(`.${key}`) ? causeKey.slice(0, causeKey.length - key.length) : undefined;
  const stored = storedDraftSendError(draft, prefix);
  return stored?.errorKey === causeKey ? stored.errorParams : undefined;
}
