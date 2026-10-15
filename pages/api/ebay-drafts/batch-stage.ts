import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { upsertDraftPatch } from '@/lib/ebay/draftService';
import { classifyEbayError, isEbayDraftError } from '@/lib/ebay/draftErrors';
import { logger } from '@/lib/logger';
import {
  BATCH_STAGE_CONCURRENCY,
  BatchStageRequestError,
  assertItemsArray,
  ebayKey,
  isPlainObject,
  mapWithConcurrency,
  resultStatus,
  type BatchStageResult,
} from '@/lib/bulk/batchStage';

/**
 * POST /api/ebay-drafts/batch-stage  (bulk-grid.md §6.2, M7-B)
 *
 * body  { items: { sku: string; offerId?; inventoryFields?; offerFields?; replaceFields? }[] }  (1..50)
 * 200   { results: BatchStageResult[] }  (`listingId` = the SKU; same order as items)
 *
 * Writes local EbayListingDraft rows only (a new draft reads the live
 * inventory item + offer once for its base). Never queues actions, media or
 * variation patches; a conflict draft stays in conflict (preserveConflict).
 * An open draft with a queued delete is never edited here (DELETE_NOT_EXCLUSIVE).
 * eBay staging has no per-field validation, so an item is staged or refused as
 * a whole (no `rejected[]`).
 */
function hasQueuedDelete(actions: unknown): boolean {
  return Array.isArray(actions) && actions.some((a) => isPlainObject(a) && a.type === 'delete');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const body = isPlainObject(req.body) ? req.body : {};
  let rawItems: Record<string, unknown>[];
  try {
    rawItems = assertItemsArray(body.items);
  } catch (err) {
    const e = err as BatchStageRequestError;
    return res.status(400).json({ error: e.message, code: e.code, key: e.key, ...(e.params ? { params: e.params } : {}) });
  }

  type Parsed =
    | { sku: string; error: BatchStageResult }
    | { sku: string; offerId?: string; inventoryFields?: Record<string, unknown>; offerFields?: Record<string, unknown>; replaceFields: boolean };
  const seen = new Set<string>();
  const parsed: Parsed[] = rawItems.map((it) => {
    const sku = typeof it.sku === 'string' ? it.sku.trim() : '';
    const fail = (code: string, key: string): Parsed => ({ sku, error: { listingId: sku, ok: false, code, key } });
    if (!sku || sku.length > 50) return fail('INVALID_SKU', 'bulk.stage.invalidItem');
    if (seen.has(sku)) return fail('DUPLICATE_ITEM', 'bulk.stage.duplicate');
    seen.add(sku);
    if (it.inventoryFields !== undefined && !isPlainObject(it.inventoryFields)) return fail('INVALID_FIELDS', 'bulk.stage.invalidItem');
    if (it.offerFields !== undefined && !isPlainObject(it.offerFields)) return fail('INVALID_FIELDS', 'bulk.stage.invalidItem');
    const replaceFields = it.replaceFields === true;
    if (it.inventoryFields === undefined && it.offerFields === undefined && !replaceFields) return fail('EMPTY_ITEM', 'bulk.stage.empty');
    return {
      sku,
      offerId: typeof it.offerId === 'string' && it.offerId.trim() ? it.offerId.trim() : undefined,
      inventoryFields: it.inventoryFields as Record<string, unknown> | undefined,
      offerFields: it.offerFields as Record<string, unknown> | undefined,
      replaceFields,
    };
  });

  // Drafts being sent right now must not get a second open draft.
  const skus = parsed.filter((p) => !('error' in p)).map((p) => p.sku);
  const open = skus.length
    ? await prisma.ebayListingDraft.findMany({
      where: { userId: user.id, sku: { in: skus }, status: { in: ['draft', 'failed', 'conflict', 'syncing'] } },
      select: { sku: true, status: true, queuedActions: true },
    })
    : [];
  const editable = new Set(open.filter((d) => d.status !== 'syncing').map((d) => d.sku));
  const syncing = new Set(open.filter((d) => d.status === 'syncing').map((d) => d.sku));
  // A draft with a queued delete must stay delete-only (same rule as the Etsy
  // and catalog services' DELETE_NOT_EXCLUSIVE): the eBay service does not
  // check this, so grid edits would be merged into it and silently dropped
  // when the deletion is sent.
  const deleteQueued = new Set(open.filter((d) => hasQueuedDelete(d.queuedActions)).map((d) => d.sku));

  const results = await mapWithConcurrency(parsed, BATCH_STAGE_CONCURRENCY, async (p): Promise<BatchStageResult> => {
    if ('error' in p) return p.error;
    const { sku } = p;
    if (syncing.has(sku) && !editable.has(sku)) {
      return { listingId: sku, ok: false, code: 'DRAFT_SYNCING', key: 'ebay.draftSync.draftSyncing' };
    }
    if (deleteQueued.has(sku)) {
      return { listingId: sku, ok: false, code: 'DELETE_NOT_EXCLUSIVE', key: 'bulk.stage.deleteQueued' };
    }
    try {
      const draft: any = await upsertDraftPatch({
        userId: user.id,
        sku,
        offerId: p.offerId,
        inventoryFields: p.inventoryFields,
        offerFields: p.offerFields,
        replaceFields: p.replaceFields,
        preserveConflict: true,
      });
      return { listingId: sku, ok: true, draftId: String(draft?.id ?? ''), status: resultStatus(draft?.status) };
    } catch (err) {
      if (!isEbayDraftError(err)) logger.error('eBay batch-stage item failed', err as Error, { userId: user.id, sku });
      const e = classifyEbayError(err);
      if (!isEbayDraftError(err) && e.code === 'EBAY_REJECTED') {
        // Not an eBay answer (e.g. a database error): don't blame eBay.
        return { listingId: sku, ok: false, code: 'STAGE_FAILED', key: 'ebay.draftSync.failed' };
      }
      return { listingId: sku, ok: false, code: e.code, key: ebayKey(e.key), ...(e.params ? { params: e.params } : {}) };
    }
  });

  return res.status(200).json({ results });
}
