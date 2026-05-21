import fs from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getUserAccessToken } from '@/lib/integrations/ebayClient';
import { callEbayRateLimited } from '@/lib/integrations/ebayRateLimiter';

const EBAY_API_BASE = 'https://api.ebay.com';
const UPLOAD_ROOT = process.env.EBAY_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ebay-images');
const DEFAULT_MARKETPLACE = 'EBAY_US';

type JsonMap = Record<string, any>;

export function toSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val)));
}

function mergeJson(existing: any, patch: any): any {
  if (patch === undefined) return existing ?? {};
  if (patch === null) return null;
  if (Array.isArray(patch)) return patch;
  if (typeof patch !== 'object') return patch;
  const base = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? { ...existing } : {};
  for (const key of Object.keys(patch)) {
    const pVal = patch[key];
    const eVal = base[key];
    if (pVal && typeof pVal === 'object' && !Array.isArray(pVal) && eVal && typeof eVal === 'object' && !Array.isArray(eVal)) {
      base[key] = mergeJson(eVal, pVal);
    } else {
      base[key] = pVal;
    }
  }
  return base;
}

function actionKey(action: any) {
  return JSON.stringify(action || {});
}

function mergeQueuedActions(existing: any[] = [], incoming?: any[]) {
  if (!incoming) return existing;
  const merged = [...existing];
  const seen = new Set(merged.map(actionKey));
  for (const action of incoming) {
    const key = actionKey(action);
    if (seen.has(key)) continue;
    merged.push(action);
    seen.add(key);
  }
  return merged;
}

function mediaIdentity(media: any) {
  if (!media?.kind || !media?.operation) return null;
  const id = media.imageUrl || media.sourceUrl || media.localPath || '';
  return `${media.kind}:${media.operation}:${id}`;
}

function isEmptyPatch(value: any) {
  if (!value) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
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
}) {
  const { userId, sku, offerId } = params;
  const marketplaceId = params.marketplaceId || DEFAULT_MARKETPLACE;

  const existing = await prisma.ebayListingDraft.findFirst({
    where: {
      userId,
      sku,
      status: { in: ['draft', 'failed', 'conflict'] },
    },
    orderBy: { updatedAt: 'desc' },
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });
  if (existing) return existing;

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
}) {
  const draft = await getOrCreateDraft({
    userId: params.userId,
    sku: params.sku,
    offerId: params.offerId,
    marketplaceId: params.marketplaceId,
  });
  const marketplaceId = params.marketplaceId || DEFAULT_MARKETPLACE;

  const data: JsonMap = {
    status: 'draft',
    lastSyncError: null,
    inventoryPatch: params.inventoryFields !== undefined
      ? (params.replaceFields ? (params.inventoryFields || {}) : mergeJson(draft.inventoryPatch, params.inventoryFields))
      : draft.inventoryPatch,
    offerPatch: params.offerFields !== undefined
      ? (params.replaceFields ? (params.offerFields || {}) : mergeJson(draft.offerPatch, params.offerFields))
      : draft.offerPatch,
    variationPatch: params.variationFields !== undefined
      ? params.variationFields
      : draft.variationPatch,
    queuedActions: params.queuedActions !== undefined
      ? mergeQueuedActions(((draft.queuedActions as any[]) || []), params.queuedActions)
      : draft.queuedActions,
  };

  if (params.offerId && !draft.offerId) {
    data.offerId = params.offerId;
  }

  if (['failed', 'conflict'].includes(draft.status)) {
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
  if (!draft) throw new Error('Draft not found');
  if (draft.status === 'syncing') throw new Error('Draft is already syncing');
  if (!['draft', 'failed', 'conflict'].includes(draft.status)) throw new Error(`Draft is not syncable (${draft.status})`);

  const queuedActions = ((draft.queuedActions as any[]) || []);
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
  await prisma.ebayListingDraft.update({ where: { id: draft.id }, data: { status: 'syncing', lastSyncError: null } });

  try {
    const token = await getUserAccessToken(userId);
    const marketplaceId = DEFAULT_MARKETPLACE;
    const results: any[] = [];

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
              data: { status: 'conflict', lastSyncError: `Remote inventory field "${field}" changed since draft was created` },
            });
            await prisma.ebayDraftSyncAttempt.update({
              where: { id: attempt.id },
              data: { status: 'conflict', finishedAt: new Date(), error: `Conflict on field: ${field}` },
            });
            return { status: 'conflict', draftId: draft.id, field };
          }
        }
      } catch (err: any) {
        // If inventory_item no longer exists, only conflict if we weren't trying to create it
        if (String(err.message).includes('404') && !queuedActions.some((a) => a.type === 'create')) {
          await prisma.ebayListingDraft.update({
            where: { id: draft.id },
            data: { status: 'conflict', lastSyncError: 'Inventory item no longer exists on eBay' },
          });
          await prisma.ebayDraftSyncAttempt.update({
            where: { id: attempt.id },
            data: { status: 'conflict', finishedAt: new Date(), error: 'Inventory item missing' },
          });
          return { status: 'conflict', draftId: draft.id, reason: 'missing' };
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
          await callEbayRateLimited(
            `${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(draft.offerId)}`,
            { token, marketplaceId, options: { method: 'DELETE' } }
          );
        }
        await callEbayRateLimited(
          `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(draft.sku)}`,
          { token, marketplaceId, options: { method: 'DELETE' } }
        );
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
              body: JSON.stringify({
                product: currentInventory.product,
                condition: currentInventory.condition,
                conditionDescription: currentInventory.conditionDescription,
                availability: currentInventory.availability,
                packageWeightAndSize: currentInventory.packageWeightAndSize,
              }),
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
      const merged = mergeJson(current, inventoryPatch);

      // eBay inventory_item PUT replaces the whole resource
      await callEbayRateLimited(
        `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(draft.sku)}`,
        {
          token,
          marketplaceId,
          options: {
            method: 'PUT',
            body: JSON.stringify(merged),
          },
        }
      );
      results.push({ step: 'inventoryPatch', sku: draft.sku });
    }

    // --- Process media ops (images live in product.imageUrls on the inventory_item) ---
    if (draft.media.length > 0) {
      const currentInventory = await fetchInventoryItem(token, draft.sku, marketplaceId);
      let imageUrls: string[] = [...(currentInventory?.product?.imageUrls || [])];
      let changed = false;

      const sortedMedia = [...draft.media].sort((a, b) => {
        const order: Record<string, number> = { delete: 0, upload: 1, add_url: 1, reorder: 2 };
        return (order[a.operation] ?? 3) - (order[b.operation] ?? 3);
      });

      for (const media of sortedMedia) {
        if (media.operation === 'delete' && media.imageUrl) {
          const idx = imageUrls.indexOf(media.imageUrl);
          if (idx !== -1) {
            imageUrls.splice(idx, 1);
            changed = true;
          }
        } else if (['upload', 'add_url'].includes(media.operation)) {
          const url = media.imageUrl || media.sourceUrl;
          if (url && !imageUrls.includes(url)) {
            if (media.rank != null && media.rank >= 0 && media.rank <= imageUrls.length) {
              imageUrls.splice(media.rank, 0, url);
            } else {
              imageUrls.push(url);
            }
            changed = true;
          }
        } else if (media.operation === 'reorder' && media.imageUrl) {
          const currentIdx = imageUrls.indexOf(media.imageUrl);
          if (currentIdx !== -1 && media.rank != null) {
            imageUrls.splice(currentIdx, 1);
            imageUrls.splice(media.rank, 0, media.imageUrl);
            changed = true;
          }
        }
      }

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
              body: JSON.stringify(updatedInventory),
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
      data: { status: 'failed', lastSyncError: err.message || 'Sync failed' },
    });
    await prisma.ebayDraftSyncAttempt.update({
      where: { id: attempt.id },
      data: { status: 'failed', finishedAt: new Date(), error: err.message || 'Sync failed' },
    });
    throw err;
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
  if (!draft) throw new Error('Draft not found');

  cleanupDraftMedia(draft.media);

  await prisma.ebayListingDraft.delete({ where: { id: draft.id } });
  return { success: true };
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
