import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { assertShopOwnership, getEtsyAccessToken, recoverStaleSyncingDrafts, upsertDraftPatch } from '@/lib/etsy/draftService';
import { isEtsyDraftError } from '@/lib/etsy/draftErrors';
import { canSpend, EtsyPriority } from '@/lib/etsy/rateBudget';
import { logger } from '@/lib/logger';
import {
  BATCH_STAGE_CONCURRENCY,
  BatchStageRequestError,
  ETSY_CALLS_PER_NEW_DRAFT,
  assertItemsArray,
  etsyKey,
  isPlainObject,
  mapWithConcurrency,
  resultStatus,
  sanitizeEtsyBatchFields,
  type BatchStageIssue,
  type BatchStageResult,
} from '@/lib/bulk/batchStage';

/**
 * POST /api/etsy-drafts/batch-stage  (bulk-grid.md §6.2, M7-B)
 *
 * body  { shopId: string; items: { listingId: string; fields?; inventory?; replaceFields? }[] }  (1..50 items)
 * 200   { results: BatchStageResult[] }  (same order as items; one item never fails the batch)
 *
 * Writes local EtsyListingDraft rows only. Never writes to Etsy (a new draft
 * reads the live listing + inventory once for its conflict base) and never
 * queues actions or media, so a delete can't be staged through here.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const body = isPlainObject(req.body) ? req.body : {};
  const shopId = typeof body.shopId === 'string' ? body.shopId.trim() : typeof body.shopId === 'number' ? String(body.shopId) : '';

  let rawItems: Record<string, unknown>[];
  try {
    if (!shopId) throw new BatchStageRequestError('INVALID_INPUT', 'bulk.stage.invalidRequest', 'shopId is required');
    rawItems = assertItemsArray(body.items);
  } catch (err) {
    const e = err as BatchStageRequestError;
    return res.status(400).json({ error: e.message, code: e.code, key: e.key, ...(e.params ? { params: e.params } : {}) });
  }

  try {
    await assertShopOwnership(user.id, shopId);
  } catch (err) {
    if (isEtsyDraftError(err)) {
      return res.status(err.status).json({ error: err.message, code: err.code, key: etsyKey(err.key) });
    }
    logger.error('Etsy batch-stage: ownership check failed', err as Error, { userId: user.id });
    return res.status(500).json({ error: 'Batch stage failed', code: 'INTERNAL', key: 'etsy.draftSync.failed' });
  }

  // Parse items up front; malformed items become per-item failures.
  type Parsed =
    | { listingId: string; error: BatchStageResult }
    | { listingId: string; fields?: Record<string, unknown>; inventory?: Record<string, unknown>; replaceFields: boolean; rejected: BatchStageIssue[]; warnings: BatchStageIssue[] };
  const seen = new Set<string>();
  const parsed: Parsed[] = rawItems.map((it) => {
    const listingId = typeof it.listingId === 'number' ? String(it.listingId) : typeof it.listingId === 'string' ? it.listingId.trim() : '';
    const fail = (code: string, key: string, params?: Record<string, string | number>, issues?: BatchStageIssue[]): Parsed => ({
      listingId,
      error: { listingId, ok: false, code, key, ...(params ? { params } : {}), ...(issues ? { issues } : {}) },
    });
    if (!/^\d{1,20}$/.test(listingId)) return fail('INVALID_LISTING_ID', 'etsy.draftSync.invalidListingId');
    if (seen.has(listingId)) return fail('DUPLICATE_ITEM', 'bulk.stage.duplicate');
    seen.add(listingId);
    if (it.fields !== undefined && !isPlainObject(it.fields)) return fail('INVALID_FIELDS', 'etsy.draftSync.invalidFields');
    if (it.inventory !== undefined && !isPlainObject(it.inventory)) return fail('INVALID_INVENTORY', 'etsy.draftSync.invalidFields');
    const replaceFields = it.replaceFields === true;
    const { fields, rejected, warnings } = sanitizeEtsyBatchFields(it.fields as Record<string, unknown> | undefined, { replaceFields });
    const hasFields = Object.keys(fields).length > 0;
    const hasInventory = it.inventory !== undefined;
    if (rejected.length && (replaceFields || (!hasFields && !hasInventory))) {
      // A revert (replaceFields) must write the whole remaining patch or
      // nothing; and an item whose every value is invalid stages nothing.
      return fail('VALIDATION_FAILED', rejected[0].key, rejected[0].params, rejected);
    }
    if (!hasFields && !hasInventory && !replaceFields) return fail('EMPTY_ITEM', 'bulk.stage.empty');
    return {
      listingId,
      fields: hasFields || replaceFields ? fields : undefined,
      inventory: hasInventory ? (it.inventory as Record<string, unknown>) : undefined,
      replaceFields,
      rejected,
      warnings,
    };
  });

  // Drafts orphaned in 'syncing' by a restart become 'failed' (editable).
  try {
    await recoverStaleSyncingDrafts(user.id, shopId);
  } catch (err) {
    logger.warn('Etsy batch-stage: stale syncing recovery failed', { userId: user.id, error: (err as Error)?.message });
  }

  // One DB read for every item: which listings already have an open draft
  // (no Etsy read needed) and which are mid-send (must not get a second draft).
  const ids = parsed.filter((p) => !('error' in p)).map((p) => BigInt(p.listingId));
  const open = ids.length
    ? await prisma.etsyListingDraft.findMany({
      where: { userId: user.id, etsyShopId: shopId, etsyListingId: { in: ids }, status: { in: ['draft', 'failed', 'conflict', 'syncing'] } },
      select: { etsyListingId: true, status: true },
    })
    : [];
  const editable = new Set<string>();
  const syncing = new Set<string>();
  for (const d of open) {
    const id = String(d.etsyListingId);
    if (d.status === 'syncing') syncing.add(id);
    else editable.add(id);
  }

  // New drafts read the live listing once for their conflict base: fetch the
  // shop token once per request (lazily, only if some item needs a new draft).
  // A token failure falls back to getListingSnapshot's own lookup/cache path.
  let tokenPromise: Promise<string | undefined> | null = null;
  const sharedToken = () => (tokenPromise ??= Promise.resolve().then(() => getEtsyAccessToken(shopId, user.id)).catch((err: unknown) => {
    logger.warn('Etsy batch-stage: shared token fetch failed', { userId: user.id, error: (err as Error)?.message });
    return undefined;
  }));

  const results = await mapWithConcurrency(parsed, BATCH_STAGE_CONCURRENCY, async (p): Promise<BatchStageResult> => {
    if ('error' in p) return p.error;
    const { listingId } = p;
    if (syncing.has(listingId) && !editable.has(listingId)) {
      return { listingId, ok: false, code: 'DRAFT_SYNCING', key: 'etsy.draftSync.draftSyncing' };
    }
    if (!editable.has(listingId)) {
      const gate = canSpend(shopId, EtsyPriority.Interactive, ETSY_CALLS_PER_NEW_DRAFT);
      if (!gate.ok) {
        return {
          listingId,
          ok: false,
          code: 'BUDGET',
          key: 'bulk.stage.budget',
          params: { minutes: Math.max(1, Math.ceil((gate.retryAfterMs ?? 60_000) / 60_000)) },
        };
      }
    }
    try {
      const accessToken = editable.has(listingId) ? undefined : await sharedToken();
      const draft: any = await upsertDraftPatch({
        userId: user.id,
        shopId,
        listingId,
        fields: p.fields,
        inventory: p.inventory,
        replaceFields: p.replaceFields,
        ...(accessToken ? { accessToken } : {}),
      });
      return {
        listingId,
        ok: true,
        draftId: String(draft?.id ?? ''),
        status: resultStatus(draft?.status),
        ...(p.rejected.length ? { rejected: p.rejected } : {}),
        ...(p.warnings.length ? { warnings: p.warnings } : {}),
      };
    } catch (err) {
      return etsyFailure(listingId, err, user.id);
    }
  });

  return res.status(200).json({ results });
}

function etsyFailure(listingId: string, err: unknown, userId: string): BatchStageResult {
  if (isEtsyDraftError(err)) {
    return {
      listingId,
      ok: false,
      code: err.code,
      key: etsyKey(err.key),
      ...(err.params ? { params: err.params } : {}),
      ...(err.issues ? { issues: err.issues.map((i) => ({ field: i.field, key: etsyKey(i.key, 'validation.generic'), ...(i.params ? { params: i.params } : {}) })) } : {}),
    };
  }
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'EtsyRateLimitedError') {
    return { listingId, ok: false, code: 'RATE_LIMITED', key: 'etsy.draftSync.rateLimited' };
  }
  if (name === 'EtsyDeferError') {
    const ms = Number((err as { retryAfterMs?: unknown }).retryAfterMs) || 60_000;
    return { listingId, ok: false, code: 'BUDGET', key: 'bulk.stage.budget', params: { minutes: Math.max(1, Math.ceil(ms / 60_000)) } };
  }
  logger.error('Etsy batch-stage item failed', err as Error, { userId, listingId });
  return { listingId, ok: false, code: 'STAGE_FAILED', key: 'etsy.draftSync.failed' };
}
