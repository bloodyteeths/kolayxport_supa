/**
 * Async Hepsiburada uploads. Price/stock/inventory uploads answer `{ id }` and finish later; we record each one in
 * HepsiburadaUploadBatch and resolve it here (job hepsiburada-uploads, plus StockAdapter.resolveBatch for stock).
 * On success the listing cache is patched with what we sent so the grid shows the new values immediately.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import { loadHepsiburadaClient } from './server';
import { hbErrorMessage, type HbUploadKind, type HbUploadStatus, type HepsiburadaClient } from './client';

export interface HbUploadItem {
  hepsiburadaSku: string;
  merchantSku?: string;
  price?: number;
  availableStock?: number;
  maximumPurchasableQuantity?: number;
  dispatchTime?: number;
}

export type HbBatchOutcome =
  | { state: 'pending' }
  | { state: 'done'; failedSkus: Record<string, string> }
  | { state: 'failed'; error: string };

/**
 * HB listing-upload limits (developer portal FAQ 15/27):
 *  - at most 5 uploads in progress/waiting at once ("There are too many ongoing/waiting inventory uploads"),
 *  - at most 4000 SKUs per request (fewer, larger requests keep us under the 5),
 *  - a daily bulk-update cap of 10 × the seller's listing count ("exceeds his inventory upload limit").
 */
export const MAX_UPLOAD_ROWS = 4000;
export const MAX_UPLOADS_IN_FLIGHT = 5;
/** A recorded upload counts as in flight for this long unless resolved (HB usually finishes in minutes). */
const IN_FLIGHT_WINDOW_MS = 30 * 60 * 1000;
const GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;

/** Retryable "come back later" error (status 429, so isRetryableHttp / the push worker retry it). */
export class HbUploadLimitError extends Error {
  readonly status = 429;
  constructor(readonly code: 'hb_uploads_in_flight' | 'hb_daily_upload_limit', message: string) {
    super(message);
    this.name = 'HbUploadLimitError';
  }
}

/** HB's own limit errors → HbUploadLimitError; anything else unchanged. */
export function asUploadLimitError(err: unknown): unknown {
  const text = JSON.stringify((err as any)?.body ?? '') + ' ' + String((err as any)?.message ?? '');
  if (/too many ongoing\/waiting inventory uploads/i.test(text)) {
    return new HbUploadLimitError('hb_uploads_in_flight', 'Hepsiburada is still processing 5 uploads for this store; retrying shortly');
  }
  if (/exceeds (his|the) inventory upload limit/i.test(text)) {
    return new HbUploadLimitError('hb_daily_upload_limit', "Hepsiburada's daily listing-update limit (10 × listing count) is reached; retrying later");
  }
  return err;
}

/** How many of this store's uploads may still be running on HB's side. */
export async function uploadsInFlight(userId: string, merchantId: string): Promise<number> {
  return prisma.hepsiburadaUploadBatch.count({
    where: { userId, merchantId, status: 'pending', kind: { in: ['inventory', 'stock', 'price'] }, createdAt: { gt: new Date(Date.now() - IN_FLIGHT_WINDOW_MS) } },
  });
}

/** Interpret an upload status body. HB: 'Ready'/'InProgress' (queued) → 'Done'/'Completed'; errors[] per row. */
export function interpretUpload(status: HbUploadStatus | null | undefined): HbBatchOutcome {
  const s = String(status?.status || '').toLowerCase();
  const errs = Array.isArray(status?.errors) ? status!.errors : [];
  const failedSkus: Record<string, string> = {};
  for (const e of errs) {
    const sku = e?.hepsiburadaSku || e?.merchantSku || e?.sku || '';
    if (sku) failedSkus[String(sku)] = String(e?.errorMessage || e?.message || e?.description || 'rejected');
  }
  for (const v of Array.isArray(status?.priceValidations) ? status!.priceValidations : []) {
    const sku = v?.hepsiburadaSku || v?.merchantSku;
    if (sku) failedSkus[String(sku)] = `price outside allowed range ${v?.minPrice ?? '?'}–${v?.maxPrice ?? '?'}`;
  }
  if (['done', 'completed', 'finished', 'success', 'succeeded'].includes(s)) return { state: 'done', failedSkus };
  if (['failed', 'error', 'rejected'].includes(s)) return { state: 'failed', error: errs.map((e) => e?.errorMessage || e?.message).filter(Boolean).join('; ') || 'upload failed' };
  return { state: 'pending' };
}

/** Send rows (chunked to 1000) and record each upload. Returns the batch row ids. */
export async function submitHbUpload(
  userId: string,
  client: HepsiburadaClient,
  kind: HbUploadKind,
  items: HbUploadItem[],
  meta: { source?: string; sourceRef?: string } = {},
): Promise<Array<{ batchId: string; uploadId: string; items: HbUploadItem[] }>> {
  const out: Array<{ batchId: string; uploadId: string; items: HbUploadItem[] }> = [];
  const chunks = Math.ceil(items.length / MAX_UPLOAD_ROWS);
  const inFlight = await uploadsInFlight(userId, client.merchantId);
  if (chunks > 0 && inFlight + chunks > MAX_UPLOADS_IN_FLIGHT) {
    throw new HbUploadLimitError('hb_uploads_in_flight', `Hepsiburada is still processing ${inFlight} uploads for this store (limit ${MAX_UPLOADS_IN_FLIGHT}); retrying shortly`);
  }
  for (let i = 0; i < items.length; i += MAX_UPLOAD_ROWS) {
    const chunk = items.slice(i, i + MAX_UPLOAD_ROWS);
    let res: unknown;
    try {
      res =
        kind === 'stock' ? await client.uploadStock(chunk.map((x) => ({ hepsiburadaSku: x.hepsiburadaSku, merchantSku: x.merchantSku, availableStock: x.availableStock, maximumPurchasableQuantity: x.maximumPurchasableQuantity })))
        : kind === 'price' ? await client.uploadPrice(chunk.map((x) => ({ hepsiburadaSku: x.hepsiburadaSku, merchantSku: x.merchantSku, price: x.price })))
        : await client.uploadInventory(chunk as any);
    } catch (err) {
      throw asUploadLimitError(err);
    }
    const uploadId = String((res as any)?.id ?? (res as any)?.Id ?? '');
    if (!uploadId) throw new Error(`Hepsiburada ${kind} upload returned no id`);
    const row = await prisma.hepsiburadaUploadBatch.create({
      data: {
        userId, merchantId: client.merchantId, kind, uploadId, source: meta.source ?? null, sourceRef: meta.sourceRef ?? null,
        itemCount: chunk.length, items: chunk as unknown as Prisma.InputJsonValue,
      },
    });
    out.push({ batchId: row.id, uploadId, items: chunk });
  }
  return out;
}

/** Poll one upload and persist the outcome. */
export async function resolveHbUpload(client: HepsiburadaClient, batch: { id: string; userId: string; merchantId: string; kind: string; uploadId: string; items: unknown; createdAt: Date; attempts: number }): Promise<HbBatchOutcome> {
  let outcome: HbBatchOutcome;
  try {
    outcome = interpretUpload(await client.getUpload(batch.kind as HbUploadKind, batch.uploadId));
  } catch (err) {
    outcome = { state: 'pending' };
    logger.warn('[HEPSIBURADA UPLOADS] poll failed', { batchId: batch.id, error: hbErrorMessage(err) });
  }
  if (outcome.state === 'pending' && Date.now() - batch.createdAt.getTime() > GIVE_UP_AFTER_MS) {
    outcome = { state: 'failed', error: 'Hepsiburada did not finish the upload within 6 hours' };
  }
  if (outcome.state === 'pending') {
    await prisma.hepsiburadaUploadBatch.update({ where: { id: batch.id }, data: { attempts: { increment: 1 } } });
    return outcome;
  }
  await prisma.hepsiburadaUploadBatch.update({
    where: { id: batch.id },
    data: {
      status: outcome.state,
      resolvedAt: new Date(),
      attempts: { increment: 1 },
      errors: (outcome.state === 'done' ? outcome.failedSkus : { error: outcome.error }) as Prisma.InputJsonValue,
    },
  });
  if (outcome.state === 'done') await patchCache(batch.userId, batch.merchantId, (batch.items as HbUploadItem[]) || [], outcome.failedSkus);
  return outcome;
}

async function patchCache(userId: string, merchantId: string, items: HbUploadItem[], failed: Record<string, string>) {
  for (const it of items) {
    if (!it?.hepsiburadaSku || failed[it.hepsiburadaSku] || (it.merchantSku && failed[it.merchantSku])) continue;
    const data: Prisma.HepsiburadaListingUpdateManyMutationInput = {};
    if (typeof it.price === 'number') data.price = new Prisma.Decimal(it.price);
    if (typeof it.availableStock === 'number') data.availableStock = it.availableStock;
    if (typeof it.dispatchTime === 'number') data.dispatchTime = it.dispatchTime;
    if (!Object.keys(data).length) continue;
    await prisma.hepsiburadaListing.updateMany({ where: { userId, merchantId, hbSku: it.hepsiburadaSku }, data });
  }
}

/** Job: resolve this user's pending uploads not owned by the stock push worker (it resolves its own). */
export async function resolvePendingHbUploads(userId: string) {
  const pending = await prisma.hepsiburadaUploadBatch.findMany({
    where: { userId, status: 'pending', NOT: { source: 'stock' } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  if (!pending.length) return { pending: 0 };
  const loaded = await loadHepsiburadaClient(userId);
  if (!loaded.ok) return { skipped: loaded.reason };
  let done = 0;
  let failed = 0;
  for (const b of pending) {
    const r = await resolveHbUpload(loaded.client, b);
    if (r.state === 'done') done++;
    if (r.state === 'failed') failed++;
  }
  return { pending: pending.length, done, failed };
}
