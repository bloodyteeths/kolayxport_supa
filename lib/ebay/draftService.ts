import fs from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { classifyEbayDraftSyncError, EBAY_DRAFT_ERROR } from '@/lib/drafts/syncErrors';
import { getUserAccessToken } from '@/lib/integrations/ebayClient';
import { callEbayRateLimited } from '@/lib/integrations/ebayRateLimiter';
import { sanitizeInventoryItemPayload } from '@/lib/ebay/payloadRules';
import { EbayDraftError, classifyEbayError } from '@/lib/ebay/draftErrors';
import {
  DEFAULT_MARKETPLACE,
  applyInventoryPatch,
  applyMediaOps,
  buildCreatePlan,
  computeEbayDiff,
  dropRejectedKeys,
  findCreateAction,
  isEmptyPatch,
  mergeJson,
  mergeQueuedActions,
  normalizeSellerSku,
  removeActions,
  type EbayCreateAction,
  type EbayCreateProgress,
  type EbayDiffField,
  type JsonMap,
} from '@/lib/ebay/draftPlan';

const EBAY_API_BASE = 'https://api.ebay.com';
const UPLOAD_ROOT = process.env.EBAY_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ebay-images');
const OPEN_STATUSES = ['draft', 'failed', 'conflict'];
const DRAFT_INCLUDE = { media: true, syncAttempts: { orderBy: { startedAt: 'desc' as const }, take: 5 } };

function draftNotFound() {
  return new EbayDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.draftNotFound' });
}

export function toSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val)));
}

function mediaIdentity(media: any) {
  if (!media?.kind || !media?.operation) return null;
  const id = media.imageUrl || media.sourceUrl || media.localPath || '';
  return `${media.kind}:${media.operation}:${id}`;
}

const OFFER_READ_ONLY_FIELDS = ['offerId', 'status', 'listing', 'sku'] as const;

function stripOfferReadOnlyFields(offer: JsonMap): JsonMap {
  const cleaned = { ...offer };
  for (const field of OFFER_READ_ONLY_FIELDS) {
    delete cleaned[field];
  }
  return cleaned;
}

async function fetchInventoryItem(token: string, sku: string, marketplaceId: string) {
  return callEbayRateLimited<any>(
    `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    { token, marketplaceId }
  );
}

async function fetchOffersForSku(token: string, sku: string, marketplaceId: string) {
  return callEbayRateLimited<any>(
    `${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&limit=10`,
    { token, marketplaceId }
  );
}

async function fetchOffer(token: string, offerId: string, marketplaceId: string) {
  return callEbayRateLimited<any>(
    `${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    { token, marketplaceId }
  );
}

// ---------------------------------------------------------------------------
// getOrCreateDraft
// ---------------------------------------------------------------------------

export async function getOrCreateDraft(params: {
  userId: string;
  sku: string;
  offerId?: string;
  marketplaceId?: string;
  /**
   * F1: the SKU is a new listing (local SKU, nothing on eBay yet). The draft is
   * created without reading eBay, with empty base snapshots.
   */
  isNew?: boolean;
}) {
  const { userId, sku, offerId } = params;
  const marketplaceId = params.marketplaceId || DEFAULT_MARKETPLACE;

  const existing = await prisma.ebayListingDraft.findFirst({
    where: {
      userId,
      sku,
      status: { in: OPEN_STATUSES },
    },
    orderBy: { updatedAt: 'desc' },
    include: DRAFT_INCLUDE,
  });
  if (existing) return existing;

  if (params.isNew) {
    return prisma.ebayListingDraft.create({
      data: {
        userId,
        sku,
        status: 'draft',
        baseSnapshotInventory: {},
        baseSnapshotOffer: {},
        baseUpdatedAt: new Date(),
        inventoryPatch: {},
        offerPatch: {},
        queuedActions: [],
      },
      include: DRAFT_INCLUDE,
    });
  }

  const token = await getUserAccessToken(userId);

  let baseSnapshotInventory: any = {};
  try {
    baseSnapshotInventory = await fetchInventoryItem(token, sku, marketplaceId);
  } catch (err: any) {
    logger.warn('eBay draft: inventory_item fetch failed during draft creation', { sku, error: err.message });
  }

  let baseSnapshotOffer: any = {};
  let resolvedOfferId = offerId || null;
  let resolvedListingId: string | null = null;

  try {
    const offersResp = await fetchOffersForSku(token, sku, marketplaceId);
    const offers = offersResp?.offers || [];
    const matchedOffer = offerId
      ? offers.find((o: any) => o.offerId === offerId)
      : offers[0];
    if (matchedOffer) {
      baseSnapshotOffer = matchedOffer;
      resolvedOfferId = matchedOffer.offerId || resolvedOfferId;
      resolvedListingId = matchedOffer.listing?.listingId || null;
    }
  } catch (err: any) {
    logger.warn('eBay draft: offer fetch failed during draft creation', { sku, error: err.message });
  }

  return prisma.ebayListingDraft.create({
    data: {
      userId,
      sku,
      offerId: resolvedOfferId,
      listingId: resolvedListingId,
      status: 'draft',
      baseSnapshotInventory,
      baseSnapshotOffer,
      baseUpdatedAt: new Date(),
      inventoryPatch: {},
      offerPatch: {},
      queuedActions: [],
    },
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });
}

// ---------------------------------------------------------------------------
// upsertDraftPatch
// ---------------------------------------------------------------------------

export async function upsertDraftPatch(params: {
  userId: string;
  sku: string;
  offerId?: string;
  marketplaceId?: string;
  inventoryFields?: JsonMap;
  offerFields?: JsonMap;
  variationFields?: JsonMap | null;
  queuedActions?: any[];
  media?: Array<JsonMap>;
  replaceFields?: boolean;
  /**
   * The editor's autosave sets this: staging into a `conflict` draft keeps it in
   * `conflict` (and keeps its base snapshots) so Review differences still sees
   * what eBay changed. Without it (legacy drawer) a re-edit re-bases as before.
   */
  preserveConflict?: boolean;
}) {
  const incomingCreate = findCreateAction(params.queuedActions);
  const draft = await getOrCreateDraft({
    userId: params.userId,
    sku: params.sku,
    offerId: params.offerId,
    marketplaceId: params.marketplaceId,
    isNew: Boolean(incomingCreate),
  });
  const marketplaceId = params.marketplaceId || DEFAULT_MARKETPLACE;
  if (incomingCreate && !findCreateAction(draft.queuedActions) && !isEmptyPatch(draft.baseSnapshotInventory)) {
    // An open draft for an EXISTING eBay item already uses this SKU.
    throw new EbayDraftError('SKU_EXISTS', `SKU ${params.sku} is already used by a listing on eBay`, {
      status: 409,
      key: 'draftSync.skuExists',
      params: { sku: params.sku },
    });
  }
  const isCreateDraft = Boolean(incomingCreate || findCreateAction(draft.queuedActions));
  const keepConflict = Boolean(params.preserveConflict) && draft.status === 'conflict';

  const nextActions = params.queuedActions !== undefined
    ? mergeQueuedActions(((draft.queuedActions as any[]) || []), params.queuedActions)
    : (draft.queuedActions as any[]);
  if (isCreateDraft && Array.isArray(nextActions) && nextActions.some((a: any) => a?.type === 'delete')) {
    throw new EbayDraftError('DELETE_ON_NEW', 'A new listing cannot queue a delete; discard the draft instead', {
      status: 400,
      key: 'draftSync.deleteOnNew',
    });
  }

  const data: JsonMap = {
    status: keepConflict ? 'conflict' : 'draft',
    lastSyncError: keepConflict ? draft.lastSyncError : null,
    inventoryPatch: params.inventoryFields !== undefined
      ? (params.replaceFields ? (params.inventoryFields || {}) : mergeJson(draft.inventoryPatch, params.inventoryFields))
      : draft.inventoryPatch,
    offerPatch: params.offerFields !== undefined
      ? (params.replaceFields ? (params.offerFields || {}) : mergeJson(draft.offerPatch, params.offerFields))
      : draft.offerPatch,
    variationPatch: params.variationFields !== undefined
      ? params.variationFields
      : draft.variationPatch,
    queuedActions: nextActions,
  };

  if (params.offerId && !draft.offerId) {
    data.offerId = params.offerId;
  }

  if (['failed', 'conflict'].includes(draft.status) && !isCreateDraft && !keepConflict) {
    try {
      const token = await getUserAccessToken(params.userId);
      const freshInventory = await fetchInventoryItem(token, params.sku, marketplaceId);
      data.baseSnapshotInventory = freshInventory;

      if (draft.offerId) {
        const freshOffer = await fetchOffer(token, draft.offerId, marketplaceId);
        data.baseSnapshotOffer = freshOffer;
      }
      data.baseUpdatedAt = new Date();
    } catch (err: any) {
      logger.warn('eBay draft: snapshot refresh failed on re-edit', { sku: params.sku, error: err.message });
    }
  }

  const updated = await prisma.ebayListingDraft.update({
    where: { id: draft.id },
    data,
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });

  if (params.media?.length) {
    const replaceableOps = params.media.filter((m) =>
      ['reorder', 'update_url'].includes(String(m.operation)) && (m.imageUrl || m.sourceUrl)
    );
    if (replaceableOps.length) {
      await prisma.ebayDraftMedia.deleteMany({
        where: {
          draftId: draft.id,
          OR: replaceableOps.map((m) => ({
            kind: m.kind,
            operation: m.operation,
            imageUrl: m.imageUrl || undefined,
          })),
        },
      });
    }

    const existingMedia = await prisma.ebayDraftMedia.findMany({
      where: { draftId: draft.id },
      select: { kind: true, operation: true, imageUrl: true, sourceUrl: true, localPath: true },
    });
    const existingKeys = new Set(existingMedia.map(mediaIdentity).filter(Boolean));

    const mediaToCreate = params.media.filter((m) => {
      const key = mediaIdentity(m);
      if (!key) return true;
      if (m.operation === 'delete' && existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    if (mediaToCreate.length) {
      await prisma.ebayDraftMedia.createMany({
        data: mediaToCreate.map((m) => ({
          draftId: draft.id,
          sku: params.sku,
          kind: m.kind,
          operation: m.operation,
          imageUrl: m.imageUrl || null,
          localPath: m.localPath || null,
          sourceUrl: m.sourceUrl || null,
          contentType: m.contentType || null,
          filename: m.filename || null,
          rank: m.rank ?? null,
          payload: m.payload || null,
        })),
      });
    }
  }

  return prisma.ebayListingDraft.findUnique({
    where: { id: updated.id },
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });
}

// ---------------------------------------------------------------------------
// syncDraft
// ---------------------------------------------------------------------------

export async function syncDraft(draftId: string, userId: string) {
  const draft = await prisma.ebayListingDraft.findFirst({
    where: { id: draftId, userId },
    include: { media: { orderBy: { createdAt: 'asc' } }, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 1 } },
  });
  if (!draft) throw draftNotFound();
  if (!OPEN_STATUSES.includes(draft.status)) {
    // See etsy/draftService: recover drafts orphaned in 'syncing' by a process
    // restart mid-sync instead of leaving them stuck forever.
    const STALE_SYNCING_MS = 10 * 60 * 1000;
    const isStaleSyncing =
      draft.status === 'syncing' &&
      Date.now() - new Date(draft.updatedAt).getTime() > STALE_SYNCING_MS;
    if (draft.status === 'syncing' && !isStaleSyncing) {
      throw new EbayDraftError('DRAFT_SYNCING', 'Draft is already syncing', { status: 409, key: 'draftSync.draftSyncing' });
    }
    if (!isStaleSyncing) {
      throw new EbayDraftError('NOT_SYNCABLE', `Draft is not syncable (${draft.status})`, {
        status: 409,
        key: 'draftSync.notSyncable',
        params: { status: draft.status },
      });
    }
    await prisma.ebayDraftSyncAttempt.updateMany({
      where: { draftId: draft.id, status: 'running' },
      data: { status: 'failed', finishedAt: new Date(), error: 'Interrupted (process restarted mid-sync); recovered as stale' },
    });
  }

  const queuedActions = ((draft.queuedActions as any[]) || []);
  const createAction = findCreateAction(queuedActions);
  if (createAction && queuedActions.some((a: any) => a?.type === 'delete')) {
    // Never sync a draft that both creates and deletes: refuse before touching eBay.
    throw new EbayDraftError('DELETE_ON_NEW', 'A new listing cannot queue a delete; discard the draft instead', {
      status: 400,
      key: 'draftSync.deleteOnNew',
    });
  }
  const requestPlan = {
    inventoryPatch: draft.inventoryPatch,
    offerPatch: draft.offerPatch,
    variationPatch: draft.variationPatch,
    media: draft.media.map((m) => ({ id: m.id, kind: m.kind, operation: m.operation, imageUrl: m.imageUrl, rank: m.rank })),
    queuedActions,
  };

  const attempt = await prisma.ebayDraftSyncAttempt.create({
    data: { draftId: draft.id, status: 'running', requestPlan },
  });
  // Atomic claim: two concurrent sends of the same draft must not both run.
  const claimed = await prisma.ebayListingDraft.updateMany({
    where: { id: draft.id, status: draft.status },
    data: { status: 'syncing', lastSyncError: null },
  });
  if (claimed.count === 0) {
    await prisma.ebayDraftSyncAttempt.update({
      where: { id: attempt.id },
      data: { status: 'failed', finishedAt: new Date(), error: 'Draft is already syncing' },
    });
    throw new EbayDraftError('DRAFT_SYNCING', 'Draft is already syncing', { status: 409, key: 'draftSync.draftSyncing' });
  }

  try {
    const token = await getUserAccessToken(userId);
    const marketplaceId = DEFAULT_MARKETPLACE;
    const results: any[] = [];

    // --- F1: new listing (queued `create`) ---
    if (createAction) {
      return await syncCreateDraft({ draft, createAction, attemptId: attempt.id, token, marketplaceId });
    }

    // --- Conflict check ---
    if (!isEmptyPatch(draft.inventoryPatch) || !isEmptyPatch(draft.offerPatch)) {
      try {
        const currentInventory = await fetchInventoryItem(token, draft.sku, marketplaceId);
        const baseInventory = draft.baseSnapshotInventory as JsonMap;

        // Compare availability and condition — fields most likely to be edited externally
        const conflictFields = ['availability', 'condition', 'conditionDescription'] as const;
        for (const field of conflictFields) {
          const baseVal = JSON.stringify(baseInventory?.[field] ?? null);
          const currentVal = JSON.stringify(currentInventory?.[field] ?? null);
          const userPatched = (draft.inventoryPatch as JsonMap)?.[field] !== undefined
            || (draft.inventoryPatch as JsonMap)?.product?.[field] !== undefined;

          if (baseVal !== currentVal && !userPatched) {
            await prisma.ebayListingDraft.update({
              where: { id: draft.id },
              data: { status: 'conflict', lastSyncError: EBAY_DRAFT_ERROR.conflict },
            });
            await prisma.ebayDraftSyncAttempt.update({
              where: { id: attempt.id },
              data: { status: 'conflict', finishedAt: new Date(), error: `Remote inventory field "${field}" changed since draft was created`, result: { errorKey: EBAY_DRAFT_ERROR.conflict, errorParams: { field } } },
            });
            return { status: 'conflict', draftId: draft.id, field, fields: [field], code: 'CONFLICT', key: 'draftSync.conflict' };
          }
        }
      } catch (err: any) {
        // If inventory_item no longer exists, only conflict if we weren't trying to create it
        if (String(err.message).includes('404') && !queuedActions.some((a) => a.type === 'create')) {
          await prisma.ebayListingDraft.update({
            where: { id: draft.id },
            data: { status: 'conflict', lastSyncError: EBAY_DRAFT_ERROR.itemMissing },
          });
          await prisma.ebayDraftSyncAttempt.update({
            where: { id: attempt.id },
            data: { status: 'conflict', finishedAt: new Date(), error: 'Inventory item no longer exists on eBay' },
          });
          return { status: 'conflict', draftId: draft.id, reason: 'missing', fields: [], code: 'MISSING_ON_EBAY', key: 'draftSync.missingOnEbay' };
        }
      }
    }

    // --- Process queued actions ---
    for (const action of queuedActions) {
      if (action.type === 'publish' && draft.offerId) {
        const publishResult = await callEbayRateLimited(
          `${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(draft.offerId)}/publish`,
          { token, marketplaceId, options: { method: 'POST' } }
        );
        results.push({ action: 'publish', result: publishResult });

      } else if (action.type === 'withdraw' && draft.listingId) {
        const withdrawResult = await callEbayRateLimited(
          `${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(draft.offerId!)}/withdraw`,
          { token, marketplaceId, options: { method: 'POST' } }
        );
        results.push({ action: 'withdraw', result: withdrawResult });

      } else if (action.type === 'delete') {
        if (draft.offerId) {
          try {
            await callEbayRateLimited(
              `${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(draft.offerId)}/withdraw`,
              { token, marketplaceId, options: { method: 'POST' } }
            );
          } catch (err: any) {
            if (!String(err.message).includes('404')) {
              logger.warn('eBay draft sync: withdraw before delete failed', { offerId: draft.offerId, error: err.message });
            }
          }
          try {
            await callEbayRateLimited(
              `${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(draft.offerId)}`,
              { token, marketplaceId, options: { method: 'DELETE' } }
            );
          } catch (err: any) {
            if (!String(err.message).includes('25710') && !String(err.message).includes('404')) throw err;
          }
        }
        try {
          await callEbayRateLimited(
            `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(draft.sku)}`,
            { token, marketplaceId, options: { method: 'DELETE' } }
          );
        } catch (err: any) {
          if (!String(err.message).includes('25710') && !String(err.message).includes('404')) throw err;
        }
        results.push({ action: 'delete', sku: draft.sku });

        await prisma.ebayListingDraft.update({
          where: { id: draft.id },
          data: { status: 'synced', syncedAt: new Date(), lastSyncError: null },
        });
        await prisma.ebayDraftSyncAttempt.update({
          where: { id: attempt.id },
          data: { status: 'success', finishedAt: new Date(), result: { actions: results, deleted: true } },
        });
        cleanupDraftMedia(draft.media);
        return { status: 'success', draftId: draft.id, deleted: true };

      } else if (action.type === 'copy') {
        const newSku = action.newSku || `${draft.sku}-copy-${Date.now()}`;
        const currentInventory = await fetchInventoryItem(token, draft.sku, marketplaceId);
        await callEbayRateLimited(
          `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(newSku)}`,
          {
            token,
            marketplaceId,
            options: {
              method: 'PUT',
              body: JSON.stringify(
                sanitizeInventoryItemPayload({
                  product: currentInventory.product,
                  condition: currentInventory.condition,
                  conditionDescription: currentInventory.conditionDescription,
                  availability: currentInventory.availability,
                  packageWeightAndSize: currentInventory.packageWeightAndSize,
                })
              ),
            },
          }
        );
        results.push({ action: 'copy', newSku });
      }
    }

    // --- Apply inventoryPatch ---
    const inventoryPatch = draft.inventoryPatch as JsonMap;
    if (!isEmptyPatch(inventoryPatch)) {
      const current = await fetchInventoryItem(token, draft.sku, marketplaceId);
      const merged = applyInventoryPatch(current, inventoryPatch);

      // eBay inventory_item PUT replaces the whole resource
      await callEbayRateLimited(
        `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(draft.sku)}`,
        {
          token,
          marketplaceId,
          options: {
            method: 'PUT',
            body: JSON.stringify(sanitizeInventoryItemPayload(merged)),
          },
        }
      );
      results.push({ step: 'inventoryPatch', sku: draft.sku });
    }

    // --- Process media ops (images live in product.imageUrls on the inventory_item) ---
    if (draft.media.length > 0) {
      const currentInventory = await fetchInventoryItem(token, draft.sku, marketplaceId);
      const { imageUrls, changed } = applyMediaOps([...(currentInventory?.product?.imageUrls || [])], draft.media);

      if (changed) {
        const updatedInventory = {
          ...currentInventory,
          product: {
            ...(currentInventory.product || {}),
            imageUrls,
          },
        };
        await callEbayRateLimited(
          `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(draft.sku)}`,
          {
            token,
            marketplaceId,
            options: {
              method: 'PUT',
              body: JSON.stringify(sanitizeInventoryItemPayload(updatedInventory)),
            },
          }
        );
        results.push({ step: 'media', imageCount: imageUrls.length });
      }
    }

    // --- Apply offerPatch ---
    const offerPatch = draft.offerPatch as JsonMap;
    if (!isEmptyPatch(offerPatch) && draft.offerId) {
      const currentOffer = await fetchOffer(token, draft.offerId, marketplaceId);
      const merged = mergeJson(currentOffer, offerPatch);
      const cleaned = stripOfferReadOnlyFields(merged);

      await callEbayRateLimited(
        `${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(draft.offerId)}`,
        {
          token,
          marketplaceId,
          options: {
            method: 'PUT',
            body: JSON.stringify(cleaned),
          },
        }
      );
      results.push({ step: 'offerPatch', offerId: draft.offerId });
    }

    // --- Apply variationPatch (inventory_item_group) ---
    const variationPatch = draft.variationPatch as JsonMap | null;
    if (variationPatch && !isEmptyPatch(variationPatch)) {
      const groupKey = variationPatch.inventoryItemGroupKey || draft.sku;
      await callEbayRateLimited(
        `${EBAY_API_BASE}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`,
        {
          token,
          marketplaceId,
          options: {
            method: 'PUT',
            body: JSON.stringify(variationPatch),
          },
        }
      );
      results.push({ step: 'variationPatch', groupKey });
    }

    // --- Success ---
    await prisma.ebayListingDraft.update({
      where: { id: draft.id },
      data: { status: 'synced', syncedAt: new Date(), lastSyncError: null },
    });
    await prisma.ebayDraftSyncAttempt.update({
      where: { id: attempt.id },
      data: { status: 'success', finishedAt: new Date(), result: { actions: results } },
    });

    cleanupDraftMedia(draft.media);
    return { status: 'success', draftId: draft.id, results };
  } catch (err: any) {
    await prisma.ebayListingDraft.update({
      where: { id: draft.id },
      // Stable i18n key (docs/integration/draft-sync-error-codes.md); English text stays on the attempt.
      data: { status: 'failed', lastSyncError: classifyEbayDraftSyncError(err).key },
    });
    await prisma.ebayDraftSyncAttempt.update({
      where: { id: attempt.id },
      data: { status: 'failed', finishedAt: new Date(), error: err.message || 'Sync failed', result: { errorKey: classifyEbayDraftSyncError(err).key } },
    });
    // F2: typed error (code/key) with the same English message as before.
    throw classifyEbayError(err);
  }
}

// ---------------------------------------------------------------------------
// discardDraft
// ---------------------------------------------------------------------------

export async function discardDraft(draftId: string, userId: string) {
  const draft = await prisma.ebayListingDraft.findFirst({
    where: { id: draftId, userId },
    include: { media: true },
  });
  if (!draft) throw draftNotFound();
  if (draft.status === 'syncing' && Date.now() - new Date(draft.updatedAt).getTime() < 10 * 60 * 1000) {
    throw new EbayDraftError('DRAFT_SYNCING', 'Draft is syncing; wait for it to finish', { status: 409, key: 'draftSync.draftSyncing' });
  }

  // A new listing that already exists on eBay (a send got part-way) cannot be thrown away: the draft is the
  // only record of the unpublished item/offer. The seller finishes it with "Try sending again".
  const create = findCreateAction(draft.queuedActions);
  if (create && hasCreateProgress(create.progress)) {
    const sku = create.progress?.sku || draft.sku;
    throw new EbayDraftError('CREATED_ON_EBAY', `Listing ${sku} already exists on eBay (unpublished); send it again to finish`, {
      status: 409,
      key: 'draftSync.createdOnEbay',
      params: { sku },
    });
  }

  cleanupDraftMedia(draft.media);

  await prisma.ebayListingDraft.delete({ where: { id: draft.id } });
  return { success: true };
}

// ---------------------------------------------------------------------------
// F1: create a new listing from a staged draft (moved from the legacy creator)
// ---------------------------------------------------------------------------

async function saveCreateProgress(draftId: string, actions: any[], progress: EbayCreateProgress) {
  const next = actions.map((a) => (a?.type === 'create' ? { ...a, progress } : a));
  await prisma.ebayListingDraft.update({ where: { id: draftId }, data: { queuedActions: next } });
  return next;
}

async function inventoryItemExists(token: string, sku: string, marketplaceId: string): Promise<boolean> {
  try {
    const item = await fetchInventoryItem(token, sku, marketplaceId);
    return Boolean(item && (item.product || item.sku));
  } catch (err: any) {
    if (String(err?.message || '').includes('404')) return false;
    throw err;
  }
}

/** True once any eBay resource of a create draft exists (items, group or offers). */
function hasCreateProgress(progress: EbayCreateProgress | undefined | null): boolean {
  return Boolean(progress && ((progress.itemsCreated?.length ?? 0) > 0 || progress.groupCreated || Object.keys(progress.offerIds || {}).length > 0));
}

async function syncCreateDraft(input: {
  draft: any;
  createAction: EbayCreateAction;
  attemptId: string;
  token: string;
  marketplaceId: string;
}) {
  const { draft, createAction, attemptId, token, marketplaceId } = input;
  // The eBay SKU: locked once something exists on eBay (progress.sku), else the seller's own SKU, else the
  // draft's generated local key. The row is re-keyed to it only after a successful send, so the editor (which
  // stages by its local key) never loses the draft while a send fails.
  const ebaySku = createAction.progress?.sku || normalizeSellerSku(createAction.sku) || draft.sku;
  const plan = buildCreatePlan({
    sku: ebaySku,
    action: createAction,
    inventoryPatch: draft.inventoryPatch as JsonMap,
    offerPatch: draft.offerPatch as JsonMap,
    variationPatch: draft.variationPatch,
    media: draft.media,
    marketplaceId,
  });
  if (plan.missing.length) {
    throw new EbayDraftError('CREATE_INCOMPLETE', `Missing before listing on eBay: ${plan.missing.join(', ')}`, {
      status: 422,
      key: 'draftSync.createIncomplete',
      params: { fields: plan.missing.join(', ') },
      extra: { missing: plan.missing },
    });
  }

  let actions = ((draft.queuedActions as any[]) || []).slice();
  const progress: EbayCreateProgress = {
    sku: ebaySku,
    itemsCreated: [...(createAction.progress?.itemsCreated || [])],
    groupCreated: Boolean(createAction.progress?.groupCreated),
    offerIds: { ...(createAction.progress?.offerIds || {}) },
    listingId: createAction.progress?.listingId,
    published: Boolean(createAction.progress?.published),
  };

  if (ebaySku !== draft.sku) {
    // Another open draft of this user already uses the seller's SKU.
    const clash = await prisma.ebayListingDraft.findFirst({
      where: { userId: draft.userId, sku: ebaySku, status: { in: [...OPEN_STATUSES, 'syncing'] } },
    });
    if (clash && clash.id !== draft.id) {
      throw new EbayDraftError('SKU_EXISTS', `SKU ${ebaySku} is already used by another draft`, {
        status: 409,
        key: 'draftSync.skuExists',
        params: { sku: ebaySku },
      });
    }
  }

  // Safety: never overwrite an item that already exists on eBay (PUT inventory_item replaces it).
  // SKUs this draft created itself (progress) are ours and are re-sent below.
  for (const sku of plan.newSkus) {
    if (progress.itemsCreated!.includes(sku) || (sku === ebaySku && progress.groupCreated)) continue;
    if (await inventoryItemExists(token, sku, marketplaceId)) {
      throw new EbayDraftError('SKU_EXISTS', `SKU ${sku} is already used by a listing on eBay`, {
        status: 409,
        key: 'draftSync.skuExists',
        params: { sku },
      });
    }
  }

  let merchantLocationKey: string | null | undefined;
  const results: any[] = [];
  // A retry re-sends the CURRENT content of everything already created (inventory_item / group / offer PUTs
  // are idempotent replaces), so a fix made in the editor after a failed publish reaches eBay. Only the
  // offer POST (not idempotent) is replaced by a PUT to the existing offer.
  for (const call of plan.calls) {
    if (call.step === 'inventory_item') {
      const resend = progress.itemsCreated!.includes(call.sku);
      await callEbayRateLimited(
        `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(call.sku)}`,
        { token, marketplaceId, options: { method: 'PUT', body: JSON.stringify(sanitizeInventoryItemPayload(call.body || {})) } },
      );
      if (!resend) {
        progress.itemsCreated!.push(call.sku);
        actions = await saveCreateProgress(draft.id, actions, progress);
      }
      results.push({ step: 'inventory_item', sku: call.sku, ...(resend ? { updated: true } : {}) });
    } else if (call.step === 'inventory_item_group') {
      const resend = Boolean(progress.groupCreated);
      await callEbayRateLimited(
        `${EBAY_API_BASE}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(call.sku)}`,
        { token, marketplaceId, options: { method: 'PUT', body: JSON.stringify(call.body || {}) } },
      );
      if (!resend) {
        progress.groupCreated = true;
        actions = await saveCreateProgress(draft.id, actions, progress);
      }
      results.push({ step: 'inventory_item_group', groupKey: call.sku, ...(resend ? { updated: true } : {}) });
    } else if (call.step === 'offer') {
      const body: JsonMap = { ...(call.body || {}) };
      if (!body.merchantLocationKey) {
        if (merchantLocationKey === undefined) {
          try {
            const loc = await callEbayRateLimited<any>(`${EBAY_API_BASE}/sell/inventory/v1/location?limit=1`, { token, marketplaceId });
            merchantLocationKey = loc?.locations?.[0]?.merchantLocationKey || null;
          } catch {
            merchantLocationKey = null;
          }
        }
        if (merchantLocationKey) body.merchantLocationKey = merchantLocationKey;
      }
      const existingOfferId = progress.offerIds![call.sku];
      if (existingOfferId) {
        // PUT /offer/{offerId} replaces the offer; sku and marketplaceId are not part of an update body.
        const { sku: _sku, marketplaceId: _mp, ...update } = body;
        await callEbayRateLimited(`${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(existingOfferId)}`, {
          token,
          marketplaceId,
          options: { method: 'PUT', body: JSON.stringify(update) },
        });
        results.push({ step: 'offer', sku: call.sku, offerId: existingOfferId, updated: true });
        continue;
      }
      const created = await callEbayRateLimited<any>(`${EBAY_API_BASE}/sell/inventory/v1/offer`, {
        token,
        marketplaceId,
        options: { method: 'POST', body: JSON.stringify(body) },
      });
      if (created?.offerId) progress.offerIds![call.sku] = String(created.offerId);
      actions = await saveCreateProgress(draft.id, actions, progress);
      results.push({ step: 'offer', sku: call.sku, offerId: created?.offerId });
    } else if (call.step === 'publish' || call.step === 'publish_group') {
      if (progress.published) continue;
      try {
        const published = call.step === 'publish'
          ? await callEbayRateLimited<any>(
              `${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(progress.offerIds![call.sku] || '')}/publish`,
              { token, marketplaceId, options: { method: 'POST' } },
            )
          : await callEbayRateLimited<any>(`${EBAY_API_BASE}/sell/inventory/v1/offer/publish_by_inventory_item_group`, {
              token,
              marketplaceId,
              options: { method: 'POST', body: JSON.stringify(call.body || {}) },
            });
        progress.published = true;
        progress.listingId = published?.listingId ? String(published.listingId) : progress.listingId;
        actions = await saveCreateProgress(draft.id, actions, progress);
        results.push({ step: call.step, listingId: published?.listingId });
      } catch (err: any) {
        // The listing exists on eBay unpublished. Keep the draft (progress saved): "Try sending again" re-sends
        // the current content and retries the publish. Specific causes the seller fixes in the editor (missing
        // item specifics, location) and reconnect keep their own code; anything else says it exists unpublished.
        const typed = classifyEbayError(err);
        if (['MISSING_ASPECTS', 'LOCATION_REQUIRED', 'REAUTH_REQUIRED'].includes(typed.code)) {
          typed.extra = { ...(typed.extra || {}), createdOnEbay: true, sku: ebaySku };
          throw typed;
        }
        throw new EbayDraftError('CREATED_NOT_PUBLISHED', typed.message, {
          status: 502,
          key: 'draftSync.createdNotPublished',
          params: { sku: ebaySku, ...(typed.key ? { cause: typed.key } : {}) },
          extra: { ...(typed.extra || {}), createdOnEbay: true },
        });
      }
    }
  }

  const mainOfferId = progress.offerIds![ebaySku] || Object.values(progress.offerIds!)[0] || null;
  await prisma.ebayListingDraft.update({
    where: { id: draft.id },
    data: {
      status: 'synced',
      syncedAt: new Date(),
      lastSyncError: null,
      offerId: mainOfferId,
      listingId: progress.listingId || null,
      // Re-key to the eBay SKU (the seller's own) once it exists on eBay.
      ...(ebaySku !== draft.sku ? { sku: ebaySku } : {}),
    },
  });
  if (ebaySku !== draft.sku) {
    await prisma.ebayDraftMedia.updateMany({ where: { draftId: draft.id }, data: { sku: ebaySku } });
  }
  await prisma.ebayDraftSyncAttempt.update({
    where: { id: attemptId },
    data: { status: 'success', finishedAt: new Date(), result: { created: true, actions: results, progress } as any },
  });
  cleanupDraftMedia(draft.media);
  return {
    status: 'success' as const,
    draftId: draft.id,
    created: true,
    sku: ebaySku,
    offerId: mainOfferId,
    offerIds: progress.offerIds,
    listingId: progress.listingId || null,
    published: Boolean(progress.published),
    results,
  };
}

// ---------------------------------------------------------------------------
// Draft read + queued-action removal (editor banners)
// ---------------------------------------------------------------------------

export async function getDraft(draftId: string, userId: string) {
  const draft = await prisma.ebayListingDraft.findFirst({
    where: { id: draftId, userId },
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 10 } },
  });
  if (!draft) throw draftNotFound();
  return draft;
}

/** Un-queue staged actions (`delete`, `publish`, `withdraw`, `copy`); `create` is never removable. Never syncs. */
export async function removeQueuedActions(draftId: string, userId: string, types: string[]) {
  const draft = await prisma.ebayListingDraft.findFirst({ where: { id: draftId, userId } });
  if (!draft) throw draftNotFound();
  if (!OPEN_STATUSES.includes(draft.status)) {
    throw new EbayDraftError('DRAFT_NOT_EDITABLE', `Draft can't be edited right now (${draft.status})`, {
      status: 409,
      key: 'draftSync.draftNotEditable',
      params: { status: draft.status },
    });
  }
  return prisma.ebayListingDraft.update({
    where: { id: draft.id },
    data: { queuedActions: removeActions(draft.queuedActions, types) },
    include: DRAFT_INCLUDE,
  });
}

// ---------------------------------------------------------------------------
// F3: Review differences (same contract as Etsy G1)
// ---------------------------------------------------------------------------

async function fetchLive(token: string, draft: { sku: string; offerId: string | null }, marketplaceId: string) {
  let liveInventory: JsonMap = {};
  try {
    liveInventory = await fetchInventoryItem(token, draft.sku, marketplaceId);
  } catch (err: any) {
    if (String(err?.message || '').includes('404')) {
      throw new EbayDraftError('MISSING_ON_EBAY', 'Inventory item no longer exists on eBay', {
        status: 404,
        key: 'draftSync.missingOnEbay',
      });
    }
    throw classifyEbayError(err);
  }
  let liveOffer: JsonMap = {};
  if (draft.offerId) {
    try {
      liveOffer = await fetchOffer(token, draft.offerId, marketplaceId);
    } catch (err: any) {
      if (!String(err?.message || '').includes('404')) throw classifyEbayError(err);
    }
  }
  return { liveInventory, liveOffer };
}

export async function getDraftDiff(draftId: string, userId: string): Promise<{
  remoteUpdatedAt: string | null;
  fields: EbayDiffField[];
  queuedActions: unknown;
}> {
  const draft = await prisma.ebayListingDraft.findFirst({ where: { id: draftId, userId } });
  if (!draft) throw draftNotFound();
  if (findCreateAction(draft.queuedActions)) {
    // A new listing has nothing on eBay to compare with.
    return { remoteUpdatedAt: null, fields: [], queuedActions: draft.queuedActions };
  }
  const token = await getUserAccessToken(userId);
  const { liveInventory, liveOffer } = await fetchLive(token, draft, DEFAULT_MARKETPLACE);
  const fields = computeEbayDiff({
    baseInventory: draft.baseSnapshotInventory as JsonMap,
    baseOffer: draft.baseSnapshotOffer as JsonMap,
    liveInventory,
    liveOffer,
    inventoryPatch: draft.inventoryPatch as JsonMap,
    offerPatch: draft.offerPatch as JsonMap,
  });
  // The Inventory API exposes no modification timestamp (listing.listingStartDate is when it first went
  // live, not when it changed), so the panel uses its untimed intro.
  return { remoteUpdatedAt: null, fields, queuedActions: draft.queuedActions };
}

/**
 * "Keep my choices": fields in `keep` stay staged ("Mine"); every other field
 * eBay changed is dropped from the patch ("eBay's"). Base snapshots are re-based
 * on the live item, status returns to `draft`. Never sends; never touches
 * queued actions (a queued delete is removed only through removeQueuedActions).
 */
export async function resolveDraft(draftId: string, userId: string, keep: string[]) {
  const draft = await prisma.ebayListingDraft.findFirst({ where: { id: draftId, userId } });
  if (!draft) throw draftNotFound();
  if (!OPEN_STATUSES.includes(draft.status)) {
    throw new EbayDraftError('DRAFT_NOT_EDITABLE', `Draft can't be edited right now (${draft.status})`, {
      status: 409,
      key: 'draftSync.draftNotEditable',
      params: { status: draft.status },
    });
  }
  if (findCreateAction(draft.queuedActions)) {
    return prisma.ebayListingDraft.update({ where: { id: draft.id }, data: { status: 'draft', lastSyncError: null }, include: DRAFT_INCLUDE });
  }
  const token = await getUserAccessToken(userId);
  const { liveInventory, liveOffer } = await fetchLive(token, draft, DEFAULT_MARKETPLACE);
  const fields = computeEbayDiff({
    baseInventory: draft.baseSnapshotInventory as JsonMap,
    baseOffer: draft.baseSnapshotOffer as JsonMap,
    liveInventory,
    liveOffer,
    inventoryPatch: draft.inventoryPatch as JsonMap,
    offerPatch: draft.offerPatch as JsonMap,
  });
  const next = dropRejectedKeys({
    fields,
    keep,
    inventoryPatch: draft.inventoryPatch as JsonMap,
    offerPatch: draft.offerPatch as JsonMap,
  });
  return prisma.ebayListingDraft.update({
    where: { id: draft.id },
    data: {
      status: 'draft',
      lastSyncError: null,
      inventoryPatch: next.inventoryPatch,
      offerPatch: next.offerPatch,
      baseSnapshotInventory: liveInventory,
      ...(draft.offerId ? { baseSnapshotOffer: liveOffer } : {}),
      baseUpdatedAt: new Date(),
    },
    include: DRAFT_INCLUDE,
  });
}

// ---------------------------------------------------------------------------
// bulkSyncDrafts
// ---------------------------------------------------------------------------

export async function bulkSyncDrafts(draftIds: string[], userId: string) {
  const results: Array<{ draftId: string; success: boolean; error?: string }> = [];

  for (const draftId of draftIds) {
    try {
      await syncDraft(draftId, userId);
      results.push({ draftId, success: true });
    } catch (err: any) {
      results.push({ draftId, success: false, error: err.message || 'Sync failed' });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Media file helpers
// ---------------------------------------------------------------------------

export function draftUploadDir(userId: string, draftId: string) {
  return path.join(UPLOAD_ROOT, userId, draftId);
}

export async function createDraftMediaFile(params: {
  userId: string;
  draftId: string;
  sku: string;
  kind: string;
  operation: string;
  tempPath: string;
  filename: string;
  contentType?: string;
  rank?: number;
  payload?: any;
}) {
  const dir = draftUploadDir(params.userId, params.draftId);
  await fs.promises.mkdir(dir, { recursive: true });
  const safeName = `${Date.now()}-${params.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const target = path.join(dir, safeName);
  await fs.promises.copyFile(params.tempPath, target);

  return prisma.ebayDraftMedia.create({
    data: {
      draftId: params.draftId,
      sku: params.sku,
      kind: params.kind,
      operation: params.operation,
      localPath: target,
      filename: params.filename,
      contentType: params.contentType,
      rank: params.rank,
      payload: params.payload,
    },
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cleanupDraftMedia(media: Array<{ localPath: string | null }>) {
  for (const m of media) {
    if (m.localPath) fs.promises.unlink(m.localPath).catch(() => undefined);
  }
}
