/**
 * "Empty draft" rules shared by the three draft backends (Etsy, eBay, CatalogDraft).
 *
 * An open draft whose staged content was all removed again (e.g. stage a photo delete, then Undo) must not count
 * as "1 change not sent" and must never be sent. Pure helpers only (no Prisma): the services use them to cancel
 * such drafts, the send paths to skip them, and the counters to exclude them.
 */

import { isLegacyEbaySku } from '@/lib/ebay/legacy';

/** Open statuses an empty draft is auto-cancelled from (never `syncing`: a send owns that row). */
export const EMPTY_CANCELLABLE_STATUSES = ['draft', 'failed', 'conflict'];

/** null / undefined, [], {} and objects whose values are all `undefined` hold nothing. */
export function isEmptyPatchValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every((v) => v === undefined);
  return false;
}

function hasQueuedActions(actions: unknown): boolean {
  return Array.isArray(actions) && actions.some((a) => a && typeof a === 'object');
}

export type EmptyDraftOptions = {
  /**
   * Send paths ignore `scheduledSendAt`: a schedule alone is nothing to send. Everywhere else a scheduled draft is
   * not empty (the seller explicitly scheduled it).
   */
  ignoreSchedule?: boolean;
};

function scheduled(draft: Record<string, any>, opts: EmptyDraftOptions): boolean {
  return !opts.ignoreSchedule && draft.scheduledSendAt != null;
}

/** Media rows of a draft: an explicit count, else `_count.media`, else `media.length`, else 0. */
export function draftMediaCount(draft: Record<string, any>, mediaCount?: number | null): number {
  if (typeof mediaCount === 'number') return mediaCount;
  const c = draft?._count?.media;
  if (typeof c === 'number') return c;
  return Array.isArray(draft?.media) ? draft.media.length : 0;
}

/** EtsyListingDraft: no field / taxonomy / inventory / variation-image / personalization patch, media or action. */
export function isEtsyDraftEmpty(draft: Record<string, any>, mediaCount?: number | null, opts: EmptyDraftOptions = {}): boolean {
  return (
    isEmptyPatchValue(draft.fieldPatch) &&
    isEmptyPatchValue(draft.taxonomyPatch) &&
    isEmptyPatchValue(draft.inventoryPatch) &&
    isEmptyPatchValue(draft.variationImagesPatch) &&
    isEmptyPatchValue(draft.personalizationPatch) &&
    draftMediaCount(draft, mediaCount) === 0 &&
    !hasQueuedActions(draft.queuedActions) &&
    !scheduled(draft, opts)
  );
}

/** EbayListingDraft: no inventory / offer / variation patch, media or action. */
export function isEbayDraftEmpty(draft: Record<string, any>, mediaCount?: number | null, opts: EmptyDraftOptions = {}): boolean {
  return (
    isEmptyPatchValue(draft.inventoryPatch) &&
    isEmptyPatchValue(draft.offerPatch) &&
    isEmptyPatchValue(draft.variationPatch) &&
    draftMediaCount(draft, mediaCount) === 0 &&
    !hasQueuedActions(draft.queuedActions) &&
    !scheduled(draft, opts)
  );
}

/** CatalogDraft: no field patch and no action (it has no media table). */
export function isCatalogDraftEmpty(draft: Record<string, any>, opts: EmptyDraftOptions = {}): boolean {
  return isEmptyPatchValue(draft.fieldPatch) && !hasQueuedActions(draft.queuedActions) && !scheduled(draft, opts);
}

export type DraftModelKind = 'EtsyListingDraft' | 'EbayListingDraft' | 'CatalogDraft';

/** Model-generic form for the counters (listings grid, nav badge, draft lists). */
export function isDraftRowEmpty(model: DraftModelKind, draft: Record<string, any>, opts: EmptyDraftOptions = {}): boolean {
  if (model === 'EtsyListingDraft') return isEtsyDraftEmpty(draft, undefined, opts);
  if (model === 'EbayListingDraft') return isEbayDraftEmpty(draft, undefined, opts);
  return isCatalogDraftEmpty(draft, opts);
}

/** An open (not sending) draft that holds nothing: excluded from "N changes not sent". */
export function isOpenEmptyDraft(model: DraftModelKind, draft: Record<string, any>): boolean {
  return EMPTY_CANCELLABLE_STATUSES.includes(String(draft.status)) && isDraftRowEmpty(model, draft);
}

/**
 * An eBay draft for a listing created on eBay (`legacy-<itemId>`, lib/ebay/legacy): it can never be sent from
 * KolayXport (send paths skip it), so it is not a "change not sent". The row stays for the editor's Discard.
 */
export function isUnsendableLegacyDraft(model: DraftModelKind, draft: Record<string, any>): boolean {
  return model === 'EbayListingDraft' && isLegacyEbaySku(draft?.sku);
}

/**
 * Excluded from every "N changes not sent" count, the send bar and the row badges: open empty drafts and
 * unsendable legacy eBay drafts. Needs the columns of `emptyCheckSelect` (eBay: includes `sku`).
 */
export function isUncountedDraft(model: DraftModelKind, draft: Record<string, any>): boolean {
  return isOpenEmptyDraft(model, draft) || isUnsendableLegacyDraft(model, draft);
}

/** Columns (Prisma `select`) the emptiness check reads, per model. */
export function emptyCheckSelect(model: DraftModelKind, opts: { scheduledSendAt?: boolean } = {}): Record<string, any> {
  const sched = opts.scheduledSendAt ? { scheduledSendAt: true } : {};
  if (model === 'EtsyListingDraft') {
    return {
      fieldPatch: true, taxonomyPatch: true, inventoryPatch: true, variationImagesPatch: true, personalizationPatch: true,
      queuedActions: true, _count: { select: { media: true } }, ...sched,
    };
  }
  if (model === 'EbayListingDraft') {
    return { sku: true, inventoryPatch: true, offerPatch: true, variationPatch: true, queuedActions: true, _count: { select: { media: true } }, ...sched };
  }
  return { fieldPatch: true, queuedActions: true, ...sched };
}
