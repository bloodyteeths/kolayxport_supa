/**
 * Listing change history (owner W3).
 *
 * EtsyListingVersion rows are written from the listing refresh path
 * (lib/etsy/listingCache.ts) whenever the content hash changes:
 *   - unchanged hash                              -> no version
 *   - kolayxport_stock change                     -> versioned only when an
 *     offering isEnabled flipped or the state changed (quantity is not content)
 *   - first sighting of an existing listing       -> a silent baseline
 *     (changedKeys = [], hidden from the activity feed)
 *   - deletion                                    -> tombstone
 *   - kolayxport_draft                            -> batchKey
 *     'draftsync:<shopId>:<15-min bucket>' (one SEO cohort per bulk sync)
 *
 * Retention: everything for 180 days, then one version per listing per ISO week.
 *
 * Restore ("undo") never writes to Etsy: it stages an EtsyListingDraft patch
 * through the existing upsertDraftPatch helper and reports what cannot be
 * restored.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  diffSnapshots,
  isStockRelevantChange,
  type ListingSnapshot,
  type SnapshotDiff,
} from './listingNormalize';
import type { Attribution } from './attribution';

export const DRAFT_BATCH_BUCKET_MS = 15 * 60_000;
export const VERSION_RETENTION_DAYS = 180;

export function draftBatchKey(shopId: string, at: Date = new Date()): string {
  const bucket = Math.floor(at.getTime() / DRAFT_BATCH_BUCKET_MS) * DRAFT_BATCH_BUCKET_MS;
  return `draftsync:${shopId}:${new Date(bucket).toISOString().slice(0, 16)}`;
}

export type CaptureDecision =
  | { capture: false; reason: 'unchanged' | 'stock_quantity_only' }
  | { capture: true; changedKeys: string[]; diff: Record<string, any>; baseline: boolean };

/** Pure: should a refresh produce a version? */
export function decideCapture(input: {
  prevHash: string | null;
  nextHash: string;
  prevSnapshot: ListingSnapshot | null;
  nextSnapshot: ListingSnapshot;
  attribution: Attribution;
  isNewListing: boolean;
}): CaptureDecision {
  if (input.prevHash && input.prevHash === input.nextHash) return { capture: false, reason: 'unchanged' };
  if (!input.prevSnapshot) {
    // First time we see this listing's content. A listing created on Etsy
    // after we started watching is a real 'created' change; anything else is
    // a silent baseline.
    return input.isNewListing
      ? { capture: true, changedKeys: ['created'], diff: {}, baseline: false }
      : { capture: true, changedKeys: [], diff: {}, baseline: true };
  }
  const d: SnapshotDiff = diffSnapshots(input.prevSnapshot, input.nextSnapshot);
  if (d.changedKeys.length === 0) {
    // Hash changed only through parts that were not comparable: baseline refresh.
    return { capture: true, changedKeys: [], diff: {}, baseline: true };
  }
  if (input.attribution === 'kolayxport_stock' && !isStockRelevantChange(d)) {
    return { capture: false, reason: 'stock_quantity_only' };
  }
  return { capture: true, changedKeys: d.changedKeys, diff: d.diff, baseline: false };
}

export async function getLatestVersion(shopId: string, listingId: bigint) {
  return prisma.etsyListingVersion.findFirst({
    where: { etsyShopId: shopId, etsyListingId: listingId, isTombstone: false },
    orderBy: { capturedAt: 'desc' },
  });
}

export async function captureVersion(a: {
  userId: string;
  shopId: string;
  listingId: bigint;
  prevHash: string | null;
  isNewListing: boolean;
  snapshot: ListingSnapshot;
  hash: string;
  remoteUpdatedTs: number;
  source: string;
  attribution: Attribution;
  draftId?: string | null;
  syncAttemptId?: string | null;
  stockPushId?: string | null;
  webhookEventId?: string | null;
}): Promise<{ versionId: string; changedKeys: string[]; diff: Record<string, any>; batchKey: string | null; baseline: boolean } | null> {
  const latest = await getLatestVersion(a.shopId, a.listingId);
  const prevSnapshot = (latest?.snapshot as ListingSnapshot | null) || null;
  const prevHash = a.prevHash ?? latest?.contentHash ?? null;
  const decision = decideCapture({
    prevHash,
    nextHash: a.hash,
    prevSnapshot,
    nextSnapshot: a.snapshot,
    attribution: a.attribution,
    isNewListing: a.isNewListing,
  });
  if (!decision.capture) return null;
  // Same content as the latest stored version (e.g. a stock-only hop came back): nothing new.
  if (latest && latest.contentHash === a.hash) return null;

  const batchKey = a.attribution === 'kolayxport_draft' && !decision.baseline ? draftBatchKey(a.shopId) : null;
  const row = await prisma.etsyListingVersion.create({
    data: {
      userId: a.userId,
      etsyShopId: a.shopId,
      etsyListingId: a.listingId,
      remoteUpdatedTs: a.remoteUpdatedTs || 0,
      source: a.source,
      attribution: decision.baseline ? 'unknown' : a.attribution,
      draftId: a.draftId ?? null,
      syncAttemptId: a.syncAttemptId ?? null,
      stockPushId: a.stockPushId ?? null,
      webhookEventId: a.webhookEventId ?? null,
      batchKey,
      contentHash: a.hash,
      changedKeys: decision.changedKeys,
      diff: decision.diff as any,
      snapshot: a.snapshot as any,
      state: a.snapshot.state,
      isTombstone: false,
    },
    select: { id: true },
  });
  return { versionId: row.id, changedKeys: decision.changedKeys, diff: decision.diff, batchKey, baseline: decision.baseline };
}

export async function captureTombstone(a: {
  userId: string;
  shopId: string;
  listingId: bigint;
  source: string;
  attribution: Attribution;
  title?: string | null;
  webhookEventId?: string | null;
}): Promise<string | null> {
  try {
    const recent = await prisma.etsyListingVersion.findFirst({
      where: { etsyShopId: a.shopId, etsyListingId: a.listingId, isTombstone: true },
      select: { id: true },
    });
    if (recent) return recent.id;
    const row = await prisma.etsyListingVersion.create({
      data: {
        userId: a.userId,
        etsyShopId: a.shopId,
        etsyListingId: a.listingId,
        source: a.source,
        attribution: a.attribution,
        webhookEventId: a.webhookEventId ?? null,
        contentHash: 'tombstone',
        changedKeys: ['deleted'],
        diff: { title: a.title ?? null } as any,
        state: 'removed',
        isTombstone: true,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err: any) {
    logger.warn('captureTombstone failed', { shopId: a.shopId, listingId: String(a.listingId), error: err?.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Keep everything for 180 days; older versions are thinned to the newest one
 * per (listing, ISO week). Tombstones are always kept. Returns rows deleted.
 */
export async function pruneListingVersions(opts: { batch?: number; signal?: AbortSignal } = {}): Promise<number> {
  const cutoff = new Date(Date.now() - VERSION_RETENTION_DAYS * 24 * 60 * 60_000);
  const batch = Math.max(100, Math.min(opts.batch ?? 5000, 20000));
  let total = 0;
  for (let i = 0; i < 50; i++) {
    if (opts.signal?.aborted) break;
    const deleted = await prisma.$executeRaw`
      DELETE FROM "EtsyListingVersion" WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 row_number() OVER (
                   PARTITION BY "etsyShopId", "etsyListingId", date_trunc('week', "capturedAt")
                   ORDER BY "capturedAt" DESC
                 ) AS rn
          FROM "EtsyListingVersion"
          WHERE "capturedAt" < ${cutoff} AND "isTombstone" = false
        ) ranked
        WHERE ranked.rn > 1
        LIMIT ${batch}
      )`;
    total += Number(deleted) || 0;
    if (!deleted || Number(deleted) < batch) break;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Restore as draft (undo)
// ---------------------------------------------------------------------------

export type RestorePlan = {
  fields: Record<string, any>;
  media: Array<{ kind: 'image'; operation: 'reorder' | 'update_alt'; etsyMediaId: string; rank?: number; altText?: string | null }>;
  restoredKeys: string[];
  unrestorable: Array<{ key: string; reason: string }>;
};

const FIELD_MAP: Array<[keyof ListingSnapshot, string]> = [
  ['title', 'title'],
  ['description', 'description'],
  ['tags', 'tags'],
  ['materials', 'materials'],
  ['whoMade', 'who_made'],
  ['whenMade', 'when_made'],
  ['isSupply', 'is_supply'],
  ['taxonomyId', 'taxonomy_id'],
  ['shopSectionId', 'shop_section_id'],
  ['processingMin', 'processing_min'],
  ['processingMax', 'processing_max'],
  ['shippingProfileId', 'shipping_profile_id'],
  ['returnPolicyId', 'return_policy_id'],
  ['itemWeight', 'item_weight'],
  ['itemWeightUnit', 'item_weight_unit'],
  ['itemLength', 'item_length'],
  ['itemWidth', 'item_width'],
  ['itemHeight', 'item_height'],
  ['itemDimensionsUnit', 'item_dimensions_unit'],
];

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Pure: build the draft patch that brings `current` back to `target`.
 * Only parts that differ are staged. Images: reorder/alt for images that
 * still exist; removed images, variations/inventory, personalization
 * questions, videos and state are reported as not restorable.
 */
export function buildRestorePlan(target: ListingSnapshot, current: ListingSnapshot | null): RestorePlan {
  const plan: RestorePlan = { fields: {}, media: [], restoredKeys: [], unrestorable: [] };
  for (const [snapKey, field] of FIELD_MAP) {
    const want = (target as any)[snapKey];
    const have = current ? (current as any)[snapKey] : undefined;
    if (current && same(want, have)) continue;
    if (want === null || want === undefined) {
      // Clearing a value is not staged (Etsy PATCH semantics differ per field).
      if (current && have !== null && have !== undefined) plan.unrestorable.push({ key: snapKey, reason: 'cleared_value' });
      continue;
    }
    plan.fields[field] = want;
    plan.restoredKeys.push(snapKey);
  }
  // Etsy needs who_made/when_made/is_supply together; the draft engine backfills missing ones.

  if (target.price != null && (!current || current.price !== target.price)) {
    if (target.hasVariations || current?.hasVariations) {
      plan.unrestorable.push({ key: 'price', reason: 'variations' });
    } else {
      plan.fields.price = Number((target.price / 100).toFixed(2));
      plan.restoredKeys.push('price');
    }
  }

  if (target.images && current?.images) {
    const currentIds = new Map(current.images.map((i) => [i.id, i]));
    const missing = target.images.filter((i) => !currentIds.has(i.id));
    if (missing.length) plan.unrestorable.push({ key: 'images', reason: 'images_deleted' });
    const present = target.images.filter((i) => currentIds.has(i.id));
    // Re-rank the surviving images in the target order, then keep any image
    // added since then after them.
    let rank = 1;
    const desired = new Map<string, number>();
    for (const img of present) desired.set(img.id, rank++);
    for (const img of current.images) if (!desired.has(img.id)) desired.set(img.id, rank++);
    let touchedImages = false;
    for (const img of present) {
      const cur = currentIds.get(img.id)!;
      const wantRank = desired.get(img.id)!;
      if (cur.rank !== wantRank) {
        plan.media.push({ kind: 'image', operation: 'reorder', etsyMediaId: img.id, rank: wantRank, altText: img.altText ?? cur.altText ?? null });
        touchedImages = true;
      } else if ((cur.altText || null) !== (img.altText || null)) {
        plan.media.push({ kind: 'image', operation: 'update_alt', etsyMediaId: img.id, rank: cur.rank, altText: img.altText ?? '' });
        touchedImages = true;
      }
    }
    if (touchedImages) plan.restoredKeys.push('images');
  }

  if (target.offerings && current?.offerings && !same(target.offerings, current.offerings)) {
    plan.unrestorable.push({ key: 'offerings', reason: 'inventory' });
  }
  if (current && target.state !== current.state) plan.unrestorable.push({ key: 'state', reason: 'state' });
  if (
    current &&
    (target.isPersonalizable !== current.isPersonalizable ||
      (target.personalizationInstructions || null) !== (current.personalizationInstructions || null))
  ) {
    plan.unrestorable.push({ key: 'personalization', reason: 'personalization' });
  }
  if (target.videoIds && current?.videoIds && !same(target.videoIds, current.videoIds)) {
    plan.unrestorable.push({ key: 'videos', reason: 'videos' });
  }
  return plan;
}

/**
 * Stage `versionId` as a draft for the listing. Never touches Etsy (the
 * draft is synced later by the user). Throws EtsyDraftError for ownership /
 * validation problems (callers map with draftErrorResponse).
 */
export async function restoreVersionAsDraft(a: { userId: string; shopId: string; listingId: bigint; versionId: string }) {
  const version = await prisma.etsyListingVersion.findFirst({
    where: { id: a.versionId, etsyShopId: a.shopId, etsyListingId: a.listingId, userId: a.userId },
  });
  if (!version) return { ok: false as const, status: 404, code: 'VERSION_NOT_FOUND' };
  if (version.isTombstone || !version.snapshot) return { ok: false as const, status: 409, code: 'VERSION_NOT_RESTORABLE' };
  const listingExists = await prisma.etsyListing.findUnique({
    where: { etsyShopId_etsyListingId: { etsyShopId: a.shopId, etsyListingId: a.listingId } },
    select: { id: true },
  });
  if (!listingExists) return { ok: false as const, status: 409, code: 'LISTING_GONE' };

  const latest = await getLatestVersion(a.shopId, a.listingId);
  const current = (latest?.snapshot as ListingSnapshot | null) || null;
  const plan = buildRestorePlan(version.snapshot as unknown as ListingSnapshot, current);
  if (Object.keys(plan.fields).length === 0 && plan.media.length === 0) {
    return { ok: true as const, draft: null, plan };
  }
  const { upsertDraftPatch } = await import('./draftService');
  const draft = await upsertDraftPatch({
    userId: a.userId,
    shopId: a.shopId,
    listingId: a.listingId,
    fields: plan.fields,
    media: plan.media,
  });
  return { ok: true as const, draft, plan };
}
