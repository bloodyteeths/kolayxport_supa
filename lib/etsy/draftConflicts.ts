/**
 * Draft conflict marking after a remote listing change (owner W3; moved from
 * lib/etsy/webhooks/processor.ts — W1 deletes the old private copies).
 *
 * After a listing refresh, open drafts whose base is older than the live
 * listing are flagged 'conflict' unless:
 *   - the change is attributed to KolayXport itself (kolayxport_draft /
 *     kolayxport_stock — see lib/etsy/attribution.ts), or
 *   - the draft is media-only (the sync engine validates live media ids), or
 *   - the draft is field-only and none of its fields changed remotely
 *     (e.g. a sale bumped updated_timestamp).
 */
import prisma from '@/lib/prisma';
import { remoteChangedKeys } from './draftService';
import { isOwnAttribution } from './attribution';

export const OPEN_DRAFT_STATUSES = ['draft', 'failed'];

export async function markOpenDraftsConflict(shopId: string, listingId: bigint, reasonKey: string, draftIds?: string[]): Promise<number> {
  const res = await prisma.etsyListingDraft.updateMany({
    where: {
      etsyShopId: shopId,
      etsyListingId: listingId,
      status: { in: OPEN_DRAFT_STATUSES },
      ...(draftIds ? { id: { in: draftIds } } : {}),
    },
    data: { status: 'conflict', lastSyncError: reasonKey },
  });
  return res.count;
}

function isEmptyJson(v: any) {
  return v == null || (typeof v === 'object' && Object.keys(v).length === 0);
}

export type DraftLikeForConflict = {
  id: string;
  baseEtsyUpdatedTimestamp: number;
  baseSnapshot: any;
  fieldPatch: any;
  taxonomyPatch: any;
  inventoryPatch: any;
  personalizationPatch: any;
  variationImagesPatch: any;
  queuedActions: any;
  mediaCount: number;
};

/** Pure: which drafts does this remote listing conflict with? */
export function draftsInConflict(drafts: DraftLikeForConflict[], remote: any): string[] {
  const remoteUpdated = Number(remote?.updated_timestamp || 0);
  if (!remoteUpdated) return [];
  const out: string[] = [];
  for (const draft of drafts) {
    const base = draft.baseEtsyUpdatedTimestamp || 0;
    if (!base || remoteUpdated <= base) continue;
    const queued = Array.isArray(draft.queuedActions) ? draft.queuedActions : [];
    const otherPatchesEmpty =
      isEmptyJson(draft.taxonomyPatch) &&
      isEmptyJson(draft.inventoryPatch) &&
      isEmptyJson(draft.personalizationPatch) &&
      isEmptyJson(draft.variationImagesPatch) &&
      queued.length === 0;
    const fieldKeys = Object.keys(draft.fieldPatch || {});
    if (otherPatchesEmpty && fieldKeys.length === 0 && draft.mediaCount > 0) continue;
    if (otherPatchesEmpty && fieldKeys.length > 0) {
      const changed = remoteChangedKeys(draft.baseSnapshot, remote, fieldKeys);
      if (changed && changed.length === 0) continue;
    }
    out.push(draft.id);
  }
  return out;
}

export async function checkDraftConflicts(
  shopId: string,
  listingId: bigint,
  remote: any,
  ctx: { attribution?: string | null } = {},
): Promise<number> {
  if (isOwnAttribution(ctx.attribution)) return 0;
  const drafts = await prisma.etsyListingDraft.findMany({
    where: { etsyShopId: shopId, etsyListingId: listingId, status: { in: OPEN_DRAFT_STATUSES } },
    include: { _count: { select: { media: true } } },
  });
  if (drafts.length === 0) return 0;
  const conflicted = draftsInConflict(
    drafts.map((d) => ({
      id: d.id,
      baseEtsyUpdatedTimestamp: d.baseEtsyUpdatedTimestamp,
      baseSnapshot: d.baseSnapshot,
      fieldPatch: d.fieldPatch,
      taxonomyPatch: d.taxonomyPatch,
      inventoryPatch: d.inventoryPatch,
      personalizationPatch: d.personalizationPatch,
      variationImagesPatch: d.variationImagesPatch,
      queuedActions: d.queuedActions,
      mediaCount: d._count.media,
    })),
    remote,
  );
  if (conflicted.length === 0) return 0;
  return markOpenDraftsConflict(shopId, listingId, 'etsy.draftSync.remoteChanged', conflicted);
}

export async function hasOpenDraft(shopId: string, listingId: bigint): Promise<boolean> {
  const n = await prisma.etsyListingDraft.count({
    where: { etsyShopId: shopId, etsyListingId: listingId, status: { in: ['draft', 'failed', 'conflict'] } },
  });
  return n > 0;
}
