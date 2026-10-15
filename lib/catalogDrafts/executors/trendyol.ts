/**
 * Trendyol executor for catalog drafts. Server-only.
 *
 * Price/stock go through the async price-and-inventory batch, archive through
 * the archive batch (the same Trendyol calls as `/api/trendyol/products`
 * `update_price_inventory` / `archive`). The batch is polled briefly; drafts
 * whose items are not final stay `syncing` with the batchRequestId and are
 * resolved by `resolvePendingCatalogBatches` from the scheduled-send cron.
 *
 * Trendyol has no reliable product "updated" time in the cache, so the
 * conflict check is field-level (see detectConflict).
 */
import prisma from '@/lib/prisma';
import { createTrendyolClient, type TrendyolApiClient } from '@/lib/integrations/trendyolApiClient';
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
const BATCH_CHUNK = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function trendyolRemoteValues(p: any): CanonicalValues {
  return {
    title: typeof p?.title === 'string' ? p.title : null,
    price: n(p?.salePrice),
    listPrice: n(p?.listPrice),
    quantity: n(p?.quantity),
    archived: Boolean(p?.archived),
    variantCount: 1,
    trackInventory: true,
  };
}

function itemBarcode(item: any): string {
  const ri = item?.requestItem;
  const v = ri?.barcode ?? ri?.product?.barcode ?? item?.barcode ?? '';
  return typeof v === 'string' ? v : String(v || '');
}

function reasonText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') return String((raw as any).message || (raw as any).description || JSON.stringify(raw));
  return '';
}

/** Price/stock item for the batch: salePrice never above listPrice. */
export function priceInventoryItem(draft: CatalogDraftRecord, remote: RemoteState): Record<string, unknown> {
  const item: Record<string, unknown> = { barcode: draft.externalId };
  const patch = draft.fieldPatch;
  if (patch.quantity !== undefined) item.quantity = patch.quantity;
  if (patch.price !== undefined) {
    const listNow = remote.values.listPrice ?? null;
    item.salePrice = patch.price;
    item.listPrice = listNow !== null && listNow >= patch.price ? listNow : patch.price;
  }
  return item;
}

/** Map a batch-status response to per-barcode outcomes. */
export function batchOutcomes(data: any, drafts: CatalogDraftRecord[], sentItems: Map<string, Record<string, unknown>>): Map<string, BatchOutcome> {
  const out = new Map<string, BatchOutcome>();
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const byBarcode = new Map<string, any>();
  for (const it of items) byBarcode.set(itemBarcode(it), it);
  const batchStatus = String(data?.status ?? data?.batchRequestStatus ?? '').toUpperCase();
  for (const draft of drafts) {
    const it = byBarcode.get(draft.externalId);
    const status = String(it?.status || '').toUpperCase();
    if (status === 'SUCCESS') {
      const sent = sentItems.get(draft.externalId) || {};
      const applied: CanonicalValues = {};
      if (sent.salePrice !== undefined) applied.price = Number(sent.salePrice);
      if (sent.listPrice !== undefined) applied.listPrice = Number(sent.listPrice);
      if (sent.quantity !== undefined) applied.quantity = Number(sent.quantity);
      if (sent.archived !== undefined) applied.archived = Boolean(sent.archived);
      out.set(draft.id, { kind: 'synced', applied });
    } else if (status === 'FAILED' || (!it && batchStatus === 'FAILED')) {
      const reasons = Array.isArray(it?.failureReasons) ? it.failureReasons.map(reasonText).filter(Boolean) : [];
      out.set(draft.id, reasons.length
        ? { kind: 'failed', errorKey: `${ERR}.batchFailedReason`, errorParams: { reason: reasons.join('; ').slice(0, 300) } }
        : { kind: 'failed', errorKey: `${ERR}.batchFailed` });
    } else {
      out.set(draft.id, { kind: 'pending' });
    }
  }
  return out;
}

/**
 * The item a pending batch sent for this draft. Uses the exact item stored at
 * send time (`baseSnapshot.sentItem`, see ApplyOutcome.sent): the listPrice
 * sent was computed from the remote listPrice at send time, which the base
 * snapshot may not match. The rebuild below is only for drafts left pending
 * before the item was stored; it reports no listPrice, so the cache never
 * records a listPrice that may not have been sent.
 */
export function sentItemFor(draft: CatalogDraftRecord): Record<string, unknown> {
  const stored = (draft.baseSnapshot as Record<string, unknown>).sentItem;
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && (stored as any).barcode === draft.externalId) {
    return stored as Record<string, unknown>;
  }
  if (draft.queuedActions.some((a) => a.type === 'archive' && !a.completedAt)) return { barcode: draft.externalId, archived: true };
  const item: Record<string, unknown> = { barcode: draft.externalId };
  if (draft.fieldPatch.quantity !== undefined) item.quantity = draft.fieldPatch.quantity;
  if (draft.fieldPatch.price !== undefined) item.salePrice = draft.fieldPatch.price;
  return item;
}

export function createTrendyolSession(client: TrendyolApiClient, userId: string, supplierId: string, opts: { pollAttempts?: number; pollIntervalMs?: number } = {}): CatalogExecutorSession {
  const pollAttempts = opts.pollAttempts ?? POLL_ATTEMPTS;
  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;

  async function poll(batchRequestId: string, drafts: CatalogDraftRecord[], sentItems: Map<string, Record<string, unknown>>, attempts: number) {
    let outcomes = new Map<string, BatchOutcome>(drafts.map((d) => [d.id, { kind: 'pending' } as BatchOutcome]));
    for (let i = 0; i < attempts; i++) {
      await sleep(i === 0 ? Math.min(1500, pollIntervalMs) : pollIntervalMs);
      try {
        const data = await client.getBatchStatus(batchRequestId);
        outcomes = batchOutcomes(data, drafts, sentItems);
        if (Array.from(outcomes.values()).every((o) => o.kind !== 'pending')) break;
      } catch {
        /* transient: keep the drafts pending; the cron resolves them */
      }
    }
    return outcomes;
  }

  return {
    async readRemote(externalIds) {
      const map = new Map<string, RemoteState>();
      for (const barcode of externalIds) {
        const data: any = await client.getProducts({ barcode, size: 1 });
        const p = Array.isArray(data?.content) ? data.content.find((x: any) => String(x?.barcode) === barcode) : null;
        map.set(barcode, p ? { exists: true, updatedAt: null, values: trendyolRemoteValues(p), raw: p } : { exists: false, updatedAt: null, values: {} });
      }
      return map;
    },

    async applyMany(items) {
      const results = new Map<string, ApplyOutcome | CatalogExecutorError>();
      const archive = items.filter(({ draft }) => draft.queuedActions.some((a) => a.type === 'archive' && !a.completedAt));
      const priceInv = items.filter((x) => !archive.includes(x));

      const runBatch = async (
        kind: 'archive' | 'price',
        group: { draft: CatalogDraftRecord; remote: RemoteState }[],
      ) => {
        for (let i = 0; i < group.length; i += BATCH_CHUNK) {
          const chunk = group.slice(i, i + BATCH_CHUNK);
          const sentItems = new Map<string, Record<string, unknown>>();
          for (const { draft, remote } of chunk) {
            sentItems.set(draft.externalId, kind === 'archive' ? { barcode: draft.externalId, archived: true } : priceInventoryItem(draft, remote));
          }
          const payload = Array.from(sentItems.values());
          let batchRequestId: string | null = null;
          try {
            const res: any = kind === 'archive'
              ? await client.archiveProducts(payload as Array<{ barcode: string }>)
              : await client.updatePriceAndInventory(payload);
            batchRequestId = typeof res?.batchRequestId === 'string' && res.batchRequestId ? res.batchRequestId : null;
          } catch (err) {
            const e = toExecutorError(err);
            for (const { draft } of chunk) results.set(draft.id, e);
            continue;
          }
          if (!batchRequestId) {
            for (const { draft } of chunk) results.set(draft.id, new CatalogExecutorError(`${ERR}.batchFailed`, 'Trendyol returned no batchRequestId'));
            continue;
          }
          const drafts = chunk.map((c) => c.draft);
          const outcomes = await poll(batchRequestId, drafts, sentItems, pollAttempts);
          for (const draft of drafts) {
            const o = outcomes.get(draft.id) || { kind: 'pending' };
            if (o.kind === 'synced') results.set(draft.id, { kind: 'synced', applied: o.applied });
            else if (o.kind === 'failed') results.set(draft.id, new CatalogExecutorError(o.errorKey, 'Trendyol batch item failed', o.errorParams));
            else results.set(draft.id, { kind: 'pending', batchRequestId, sent: sentItems.get(draft.externalId) });
          }
        }
      };

      if (priceInv.length) await runBatch('price', priceInv);
      if (archive.length) await runBatch('archive', archive);
      return results;
    },

    async pollBatch(batchRequestId, drafts) {
      const sentItems = new Map<string, Record<string, unknown>>(drafts.map((d) => [d.externalId, sentItemFor(d)]));
      const data = await client.getBatchStatus(batchRequestId);
      return batchOutcomes(data, drafts, sentItems);
    },

    async writeCache(externalId, applied) {
      await prisma.trendyolProduct.updateMany({
        where: { userId, supplierId, barcode: externalId },
        data: {
          ...(applied.price !== undefined && applied.price !== null ? { salePrice: applied.price } : {}),
          ...(applied.listPrice !== undefined && applied.listPrice !== null ? { listPrice: applied.listPrice } : {}),
          ...(applied.quantity !== undefined && applied.quantity !== null ? { quantity: applied.quantity } : {}),
          ...(applied.archived !== undefined ? { archived: applied.archived } : {}),
        },
      });
    },
  };
}

export const trendyolExecutor: CatalogExecutor = {
  async open(userId, storeId) {
    const cred = await prisma.credential.findUnique({
      where: { userId },
      select: { trendyolSupplierId: true, trendyolApiKey: true, trendyolApiSecret: true },
    });
    if (!cred?.trendyolSupplierId || !cred.trendyolApiKey || !cred.trendyolApiSecret || String(cred.trendyolSupplierId) !== storeId) {
      throw new CatalogExecutorError(`${ERR}.notConnected`, 'Trendyol credentials missing or store changed');
    }
    // createTrendyolClient decrypts the stored secrets.
    const client = createTrendyolClient(cred);
    return createTrendyolSession(client, userId, storeId);
  },
};
