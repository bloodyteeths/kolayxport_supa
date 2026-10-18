/**
 * Hepsiburada executor for catalog drafts. Server-only.
 *
 * Drafts stage listing values only (price, stock, dispatch time, max per order; content lives in HB's catalog).
 * They are sent as ONE async `inventory-uploads` call per chunk with a FULL row per listing: the live listing
 * (fresh read) ⊕ the patch, so an upload never blanks a value the draft did not touch. Each upload is recorded in
 * HepsiburadaUploadBatch (source 'catalogDraft') and polled briefly; drafts not final stay `syncing` with the
 * upload id and are resolved by `resolvePendingCatalogBatches` (pollBatch).
 *
 * Listings fulfilled by HB's warehouse refuse a stock change. HB has no listing "updated" time, so conflict checks
 * are field-level (service.ts).
 */
import prisma from '@/lib/prisma';
import { isHepsiburadaEnabled } from '@/lib/config';
import { createHepsiburadaClient, hbErrorMessage, type HepsiburadaClient } from '@/lib/hepsiburada/client';
import { HB_CREDENTIAL_SELECT } from '@/lib/hepsiburada/server';
import { interpretUpload, submitHbUpload, type HbBatchOutcome, type HbUploadItem } from '@/lib/hepsiburada/uploads';
import {
  CatalogExecutorError,
  ERR,
  type ApplyOutcome,
  type BatchOutcome,
  type CanonicalValues,
  type CatalogDraftRecord,
  type CatalogExecutor,
  type CatalogExecutorSession,
  type RemoteState,
  toExecutorError,
} from '../service';

const POLL_ATTEMPTS = 4;
const POLL_INTERVAL_MS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Canonical values of a live HB listing (listing-external row). */
export function hepsiburadaRemoteValues(l: any): CanonicalValues {
  return {
    price: num(l?.price),
    quantity: num(l?.availableStock) === null ? null : Math.trunc(num(l?.availableStock)!),
    dispatchTime: num(l?.dispatchTime),
    maxPurchasableQuantity: num(l?.maximumPurchasableQuantity),
    variantCount: 1,
    trackInventory: !l?.isFulfilledByHB,
  };
}

function hasListingPatch(draft: CatalogDraftRecord): boolean {
  const p = draft.fieldPatch;
  return p.price !== undefined || p.quantity !== undefined || p.dispatchTime !== undefined || p.maxPurchasableQuantity !== undefined;
}

/** Full inventory row: live listing ⊕ patch. Pure (tested). */
export function inventoryRow(draft: CatalogDraftRecord, remote: RemoteState): HbUploadItem {
  const live: any = remote.raw || {};
  const v = remote.values;
  const p = draft.fieldPatch;
  if (p.quantity !== undefined && live.isFulfilledByHB) {
    throw new CatalogExecutorError(`${ERR}.hbFulfilledStock`, 'Stock of a fulfilled-by-Hepsiburada listing is managed by Hepsiburada');
  }
  const price = p.price ?? v.price ?? null;
  const stock = p.quantity ?? v.quantity ?? null;
  if (price === null || stock === null) throw new CatalogExecutorError(`${ERR}.contentIncomplete`, 'Hepsiburada listing without price or stock');
  const row: HbUploadItem = {
    hepsiburadaSku: draft.externalId,
    ...(live.merchantSku ? { merchantSku: String(live.merchantSku) } : {}),
    price,
    availableStock: stock,
  };
  const dispatch = p.dispatchTime ?? v.dispatchTime ?? null;
  if (dispatch !== null) row.dispatchTime = dispatch;
  const maxQty = p.maxPurchasableQuantity ?? v.maxPurchasableQuantity ?? null;
  if (maxQty !== null) row.maximumPurchasableQuantity = maxQty;
  return row;
}

function appliedFrom(row: HbUploadItem): CanonicalValues {
  return {
    price: row.price ?? null,
    quantity: row.availableStock ?? null,
    ...(row.dispatchTime !== undefined ? { dispatchTime: row.dispatchTime } : {}),
    ...(row.maximumPurchasableQuantity !== undefined ? { maxPurchasableQuantity: row.maximumPurchasableQuantity } : {}),
  };
}

/** Upload outcome → one BatchOutcome per draft. Pure (tested). */
export function draftOutcomes(outcome: HbBatchOutcome, drafts: CatalogDraftRecord[], rows: Map<string, HbUploadItem>): Map<string, BatchOutcome> {
  const out = new Map<string, BatchOutcome>();
  for (const d of drafts) {
    const row = rows.get(d.externalId);
    if (outcome.state === 'pending') {
      out.set(d.id, { kind: 'pending' });
    } else if (outcome.state === 'failed') {
      out.set(d.id, { kind: 'failed', errorKey: `${ERR}.hbRejectedReason`, errorParams: { reason: outcome.error.slice(0, 300) } });
    } else {
      const reason = outcome.failedSkus[d.externalId] ?? (row?.merchantSku ? outcome.failedSkus[row.merchantSku] : undefined);
      if (reason) out.set(d.id, { kind: 'failed', errorKey: `${ERR}.hbRejectedReason`, errorParams: { reason: reason.slice(0, 300) } });
      else out.set(d.id, { kind: 'synced', applied: row ? appliedFrom(row) : {} });
    }
  }
  return out;
}

export function createHepsiburadaSession(
  client: HepsiburadaClient,
  userId: string,
  merchantId: string,
  opts: { pollAttempts?: number; pollIntervalMs?: number } = {},
): CatalogExecutorSession {
  const pollAttempts = opts.pollAttempts ?? POLL_ATTEMPTS;
  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;

  async function poll(uploadId: string): Promise<HbBatchOutcome> {
    let outcome: HbBatchOutcome = { state: 'pending' };
    for (let i = 0; i < pollAttempts; i++) {
      await sleep(i === 0 ? Math.min(1500, pollIntervalMs) : pollIntervalMs);
      try {
        outcome = interpretUpload(await client.getUpload('inventory', uploadId));
        if (outcome.state !== 'pending') break;
      } catch {
        /* transient: the drafts stay pending; the cron resolves them */
      }
    }
    return outcome;
  }

  async function settleBatchRow(uploadId: string, outcome: HbBatchOutcome) {
    if (outcome.state === 'pending') return;
    await prisma.hepsiburadaUploadBatch.updateMany({
      where: { userId, kind: 'inventory', uploadId, status: 'pending' },
      data: { status: outcome.state, resolvedAt: new Date(), errors: outcome.state === 'done' ? outcome.failedSkus : { error: outcome.error } },
    });
  }

  return {
    async readRemote(externalIds) {
      const map = new Map<string, RemoteState>();
      for (let i = 0; i < externalIds.length; i += 50) {
        const chunk = externalIds.slice(i, i + 50);
        const res = await client.listListings({ offset: 0, limit: chunk.length, hbSkuList: chunk });
        const bySku = new Map((res?.listings || []).map((l) => [String(l.hepsiburadaSku), l]));
        for (const sku of chunk) {
          const l = bySku.get(sku);
          map.set(sku, l ? { exists: true, updatedAt: null, values: hepsiburadaRemoteValues(l), raw: l } : { exists: false, updatedAt: null, values: {} });
        }
      }
      return map;
    },

    async applyMany(items) {
      const results = new Map<string, ApplyOutcome | CatalogExecutorError>();
      const entries: Array<{ draft: CatalogDraftRecord; row: HbUploadItem }> = [];
      for (const { draft, remote } of items) {
        try {
          if (!hasListingPatch(draft)) {
            results.set(draft.id, { kind: 'synced', applied: {} });
            continue;
          }
          entries.push({ draft, row: inventoryRow(draft, remote) });
        } catch (err) {
          results.set(draft.id, toExecutorError(err));
        }
      }
      if (!entries.length) return results;

      let batches: Awaited<ReturnType<typeof submitHbUpload>>;
      try {
        batches = await submitHbUpload(userId, client, 'inventory', entries.map((e) => e.row), { source: 'catalogDraft' });
      } catch (err) {
        const e = toExecutorError(err);
        if (e.errorKey === `${ERR}.remoteFailed`) Object.assign(e, { errorKey: `${ERR}.hbRejectedReason`, errorParams: { reason: hbErrorMessage(err).slice(0, 300) } });
        for (const { draft } of entries) results.set(draft.id, e);
        return results;
      }

      let offset = 0;
      for (const b of batches) {
        const chunk = entries.slice(offset, offset + b.items.length);
        offset += b.items.length;
        const outcome = await poll(b.uploadId);
        await settleBatchRow(b.uploadId, outcome);
        const rows = new Map(chunk.map((c) => [c.draft.externalId, c.row]));
        const outcomes = draftOutcomes(outcome, chunk.map((c) => c.draft), rows);
        for (const c of chunk) {
          const o = outcomes.get(c.draft.id)!;
          if (o.kind === 'synced') results.set(c.draft.id, { kind: 'synced', applied: o.applied });
          else if (o.kind === 'failed') results.set(c.draft.id, new CatalogExecutorError(o.errorKey, 'Hepsiburada rejected the upload', o.errorParams));
          else results.set(c.draft.id, { kind: 'pending', batchRequestId: b.uploadId, sent: c.row as unknown as Record<string, unknown> });
        }
      }
      return results;
    },

    async pollBatch(uploadId, drafts) {
      // A poll error throws: the service keeps the drafts pending (and times them out).
      const outcome = interpretUpload(await client.getUpload('inventory', uploadId));
      await settleBatchRow(uploadId, outcome);
      const batch = await prisma.hepsiburadaUploadBatch.findFirst({ where: { userId, kind: 'inventory', uploadId }, select: { items: true } });
      const sent = Array.isArray(batch?.items) ? (batch!.items as unknown as HbUploadItem[]) : [];
      return draftOutcomes(outcome, drafts, new Map(sent.map((r) => [r.hepsiburadaSku, r])));
    },

    async writeCache(externalId, applied) {
      await prisma.hepsiburadaListing.updateMany({
        where: { userId, merchantId, hbSku: externalId },
        data: {
          ...(typeof applied.price === 'number' ? { price: applied.price } : {}),
          ...(typeof applied.quantity === 'number' ? { availableStock: applied.quantity } : {}),
          ...(typeof applied.dispatchTime === 'number' ? { dispatchTime: applied.dispatchTime } : {}),
          ...(typeof applied.maxPurchasableQuantity === 'number' ? { maximumPurchasableQuantity: applied.maxPurchasableQuantity } : {}),
        },
      });
    },
  };
}

export const hepsiburadaExecutor: CatalogExecutor = {
  async open(userId, storeId) {
    if (!isHepsiburadaEnabled(userId)) throw new CatalogExecutorError(`${ERR}.notConnected`, 'Hepsiburada is not enabled for this account');
    const cred = await prisma.credential.findUnique({ where: { userId }, select: HB_CREDENTIAL_SELECT });
    if (!cred?.hepsiburadaMerchantId || cred.hepsiburadaMerchantId.trim() !== storeId) {
      throw new CatalogExecutorError(`${ERR}.notConnected`, 'Hepsiburada credentials missing or store changed');
    }
    const client = createHepsiburadaClient(cred);
    if (!client) throw new CatalogExecutorError(`${ERR}.notConnected`, 'Hepsiburada credentials incomplete');
    return createHepsiburadaSession(client, userId, storeId);
  },
};
