/**
 * Trendyol executor for catalog drafts. Server-only.
 *
 * Every write is an async Trendyol batch, polled briefly; drafts whose items
 * are not final stay `syncing` with the batchRequestId and are resolved by
 * `resolvePendingCatalogBatches` from the scheduled-send cron.
 *
 *  - Price / list price / stock → `updatePriceAndInventory` (price-and-inventory).
 *  - Content (title, description, images, attributes, stock code, desi, VAT) →
 *    `updateProducts` with a FULL item: the live product (fresh read, already
 *    conflict-checked) ⊕ the patch. Never a partial item (marketplace-editors
 *    §0 #4, §7.1). The item carries the final price/stock too, so the two
 *    batches never disagree whichever Trendyol processes first.
 *  - A draft with both waits on two batches; both ids are stored in
 *    `baseSnapshot.sentBatches` and the draft is synced only when both succeed.
 *  - Archive → `archiveProducts`. Create → `createProducts([fullItem])`, the
 *    item = create payload (brand, category, barcode, cargo, addresses) ⊕ patch;
 *    on success the draft's externalId becomes the barcode.
 *
 * Trendyol has no reliable product "updated" time in the cache, so the
 * conflict check is field-level (see detectConflict).
 */
import prisma from '@/lib/prisma';
import { createTrendyolClient, type TrendyolApiClient } from '@/lib/integrations/trendyolApiClient';
import {
  CatalogExecutorError,
  ERR,
  isCreateDraft,
  type ApplyOutcome,
  type BatchOutcome,
  type CanonicalValues,
  type CatalogDraftRecord,
  type CatalogExecutor,
  type CatalogExecutorSession,
  type RemoteState,
  type SentBatch,
  toExecutorError,
} from '../service';
import { TRENDYOL_CONTENT_KEYS, createPayloadOf, type TrendyolAttributeValue, type TrendyolCreatePayload } from '../schemas';
import { trendyolValuesFromApi } from '../values';

const POLL_ATTEMPTS = 4;
const POLL_INTERVAL_MS = 2500;
const BATCH_CHUNK = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Canonical values of a Trendyol API product (kept under its v1 name). */
export const trendyolRemoteValues = trendyolValuesFromApi;

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

function hasContentPatch(draft: CatalogDraftRecord): boolean {
  return TRENDYOL_CONTENT_KEYS.some((k) => draft.fieldPatch[k] !== undefined);
}

function hasPricePatch(draft: CatalogDraftRecord): boolean {
  const p = draft.fieldPatch;
  return p.price !== undefined || p.listPrice !== undefined || p.quantity !== undefined;
}

/** Price/stock item for the batch: salePrice never above listPrice. */
export function priceInventoryItem(draft: CatalogDraftRecord, remote: RemoteState): Record<string, unknown> {
  const item: Record<string, unknown> = { barcode: draft.externalId };
  const patch = draft.fieldPatch;
  if (patch.quantity !== undefined) item.quantity = patch.quantity;
  if (patch.price !== undefined || patch.listPrice !== undefined) {
    const sale = patch.price ?? remote.values.price ?? null;
    if (sale === null) throw new CatalogExecutorError(`${ERR}.contentIncomplete`, 'Sale price unknown');
    const listNow = patch.listPrice ?? remote.values.listPrice ?? null;
    item.salePrice = sale;
    item.listPrice = listNow !== null && listNow >= sale ? listNow : sale;
  }
  return item;
}

function attributesForWrite(list: TrendyolAttributeValue[]): Record<string, unknown>[] {
  return list.map((a) => (a.attributeValueId
    ? { attributeId: a.attributeId, attributeValueId: a.attributeValueId }
    : { attributeId: a.attributeId, customAttributeValue: a.customAttributeValue }));
}

/**
 * The full product item for `updateProducts`: the live product ⊕ the patch (content keys, and the final
 * price/stock so both batches agree). Throws `contentIncomplete` when Trendyol did not return a field the
 * update needs (brand, category), instead of sending a partial item.
 */
export function contentItem(draft: CatalogDraftRecord, remote: RemoteState): Record<string, unknown> {
  const p: any = remote.raw || {};
  const v = remote.values;
  const patch = draft.fieldPatch;
  const brandId = v.brandId ?? null;
  const categoryId = v.categoryId ?? null;
  if (!brandId || !categoryId) throw new CatalogExecutorError(`${ERR}.contentIncomplete`, 'Trendyol product without brand or category');
  const price = priceInventoryItem(draft, remote);
  const images = (patch.images as string[] | undefined) ?? v.images ?? [];
  const attributes = patch.attributes ?? v.attributes ?? [];
  const item: Record<string, unknown> = {
    barcode: draft.externalId,
    title: patch.title ?? v.title ?? '',
    productMainId: v.productMainId ?? patch.stockCode ?? v.stockCode,
    brandId,
    categoryId,
    quantity: price.quantity ?? v.quantity ?? 0,
    stockCode: patch.stockCode ?? v.stockCode ?? '',
    dimensionalWeight: patch.dimensionalWeight ?? v.dimensionalWeight ?? 0,
    description: patch.description ?? v.description ?? '',
    currencyType: typeof p.currencyType === 'string' && p.currencyType ? p.currencyType : 'TRY',
    listPrice: price.listPrice ?? v.listPrice ?? v.price,
    salePrice: price.salePrice ?? v.price,
    vatRate: patch.vatRate ?? v.vatRate ?? 20,
    images: images.map((url) => ({ url })),
    attributes: attributesForWrite(attributes),
  };
  if (v.cargoCompanyId) item.cargoCompanyId = v.cargoCompanyId;
  for (const k of ['shipmentAddressId', 'returningAddressId'] as const) if (p[k]) item[k] = p[k];
  return item;
}

/** Required create values (marketplace-editors §5.1); the missing ones are reported in `params.fields`. */
export function createItem(draft: CatalogDraftRecord): Record<string, unknown> {
  const payload = createPayloadOf(draft.queuedActions) as TrendyolCreatePayload;
  const patch = draft.fieldPatch;
  const images = (patch.images as string[] | undefined) ?? [];
  const missing: string[] = [];
  const need = (ok: unknown, name: string) => { if (ok === undefined || ok === null || ok === '') missing.push(name); };
  need(payload.barcode, 'barcode');
  need(payload.brandId, 'brandId');
  need(payload.categoryId, 'categoryId');
  need(payload.cargoCompanyId, 'cargoCompanyId');
  need(patch.title, 'title');
  need(patch.description, 'description');
  need(patch.stockCode, 'stockCode');
  need(patch.dimensionalWeight, 'dimensionalWeight');
  need(patch.price, 'price');
  need(patch.vatRate, 'vatRate');
  if (images.length === 0) missing.push('images');
  if (missing.length) {
    throw new CatalogExecutorError(`${ERR}.createIncomplete`, 'Trendyol create is missing required values', { fields: missing.join(', '), count: missing.length });
  }
  const sale = patch.price as number;
  const list = patch.listPrice !== undefined && patch.listPrice >= sale ? patch.listPrice : sale;
  const item: Record<string, unknown> = {
    barcode: payload.barcode,
    title: patch.title,
    productMainId: payload.productMainId || patch.stockCode,
    brandId: payload.brandId,
    categoryId: payload.categoryId,
    quantity: patch.quantity ?? 0,
    stockCode: patch.stockCode,
    dimensionalWeight: patch.dimensionalWeight,
    description: patch.description,
    currencyType: 'TRY',
    listPrice: list,
    salePrice: sale,
    vatRate: patch.vatRate,
    cargoCompanyId: payload.cargoCompanyId,
    images: images.map((url) => ({ url })),
    attributes: attributesForWrite(patch.attributes ?? []),
  };
  if (payload.shipmentAddressId) item.shipmentAddressId = payload.shipmentAddressId;
  if (payload.returningAddressId) item.returningAddressId = payload.returningAddressId;
  return item;
}

/** What a successful batch item changed, in canonical values (written to the cache). */
export function appliedFromItem(kind: SentBatch['kind'], sent: Record<string, unknown>): CanonicalValues {
  const applied: CanonicalValues = {};
  if (sent.salePrice !== undefined) applied.price = Number(sent.salePrice);
  if (sent.listPrice !== undefined) applied.listPrice = Number(sent.listPrice);
  if (sent.quantity !== undefined) applied.quantity = Number(sent.quantity);
  if (sent.archived !== undefined) applied.archived = Boolean(sent.archived);
  if (kind === 'content' || kind === 'create') {
    if (typeof sent.title === 'string') applied.title = sent.title;
    if (typeof sent.description === 'string') applied.description = sent.description;
    if (Array.isArray(sent.images)) applied.images = (sent.images as any[]).map((i) => String(i?.url ?? '')).filter(Boolean);
    if (Array.isArray(sent.attributes)) applied.attributes = sent.attributes as TrendyolAttributeValue[];
    if (typeof sent.stockCode === 'string') applied.stockCode = sent.stockCode;
    if (typeof sent.dimensionalWeight === 'number') applied.dimensionalWeight = sent.dimensionalWeight;
    if (typeof sent.vatRate === 'number') applied.vatRate = sent.vatRate;
  }
  return applied;
}

/**
 * Map a batch-status response to per-draft outcomes. `sentItems` is keyed by barcode; `barcodeOf` gives the
 * barcode a draft's item was sent under (default: its externalId; a create uses its payload barcode).
 */
export function batchOutcomes(
  data: any,
  drafts: CatalogDraftRecord[],
  sentItems: Map<string, Record<string, unknown>>,
  opts: { kind?: SentBatch['kind']; barcodeOf?: (d: CatalogDraftRecord) => string } = {},
): Map<string, BatchOutcome> {
  const out = new Map<string, BatchOutcome>();
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const byBarcode = new Map<string, any>();
  for (const it of items) byBarcode.set(itemBarcode(it), it);
  const batchStatus = String(data?.status ?? data?.batchRequestStatus ?? '').toUpperCase();
  const barcodeOf = opts.barcodeOf ?? ((d: CatalogDraftRecord) => d.externalId);
  for (const draft of drafts) {
    const barcode = barcodeOf(draft);
    const it = byBarcode.get(barcode);
    const status = String(it?.status || '').toUpperCase();
    if (status === 'SUCCESS') {
      const sent = sentItems.get(barcode) || {};
      out.set(draft.id, { kind: 'synced', applied: appliedFromItem(opts.kind ?? 'price', sent) });
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
  const archiveState = queuedArchiveState(draft);
  if (archiveState !== null) return { barcode: draft.externalId, archived: archiveState };
  const item: Record<string, unknown> = { barcode: draft.externalId };
  if (draft.fieldPatch.quantity !== undefined) item.quantity = draft.fieldPatch.quantity;
  if (draft.fieldPatch.price !== undefined) item.salePrice = draft.fieldPatch.price;
  return item;
}

/** `true` for a queued archive, `false` for a queued unarchive (both go through the archive endpoint), else null. */
export function queuedArchiveState(draft: Pick<CatalogDraftRecord, 'queuedActions'>): boolean | null {
  if (draft.queuedActions.some((a) => a.type === 'archive' && !a.completedAt)) return true;
  if (draft.queuedActions.some((a) => a.type === 'unarchive' && !a.completedAt)) return false;
  return null;
}

const BATCH_KINDS: SentBatch['kind'][] = ['content', 'price', 'archive', 'create'];

/** Batches a pending draft waits on: `sentBatches` (v2) when it holds `batchRequestId`, else the single v1 batch. */
export function sentBatchesFor(draft: CatalogDraftRecord, batchRequestId: string): SentBatch[] {
  const raw = (draft.baseSnapshot as Record<string, unknown>).sentBatches;
  if (Array.isArray(raw)) {
    const list = raw.filter((b): b is SentBatch => Boolean(b) && typeof b === 'object'
      && typeof (b as SentBatch).batchRequestId === 'string'
      && BATCH_KINDS.includes((b as SentBatch).kind)
      && Boolean((b as SentBatch).item) && typeof (b as SentBatch).item === 'object');
    // A list from an earlier send (not holding the batch the draft now waits on) is stale: never poll it.
    if (list.length && list.some((b) => b.batchRequestId === batchRequestId)) return list;
  }
  const archive = queuedArchiveState(draft) !== null;
  return [{ kind: archive ? 'archive' : 'price', batchRequestId, item: sentItemFor(draft) }];
}

export type StepResult = { kind: SentBatch['kind']; batch: SentBatch | null; outcome: BatchOutcome | CatalogExecutorError };

/**
 * All batches of one draft → one outcome: failed when any failed (params gain `step`), synced when all are
 * synced (applied values merged; a create reports its barcode as the new externalId), else pending.
 */
export function combineSteps(steps: StepResult[], externalIdOnCreate?: string): ApplyOutcome | CatalogExecutorError {
  for (const s of steps) {
    if (s.outcome instanceof CatalogExecutorError) return s.outcome;
    if (s.outcome.kind === 'failed') {
      return new CatalogExecutorError(s.outcome.errorKey, `Trendyol ${s.kind} batch item failed`, { ...(s.outcome.errorParams || {}), step: s.kind });
    }
  }
  if (steps.every((s) => (s.outcome as BatchOutcome).kind === 'synced')) {
    const applied: CanonicalValues = {};
    for (const s of steps) Object.assign(applied, (s.outcome as Extract<BatchOutcome, { kind: 'synced' }>).applied);
    return { kind: 'synced', applied, ...(externalIdOnCreate ? { externalId: externalIdOnCreate } : {}) };
  }
  const batches = steps.map((s) => s.batch).filter((b): b is SentBatch => Boolean(b));
  const firstPending = steps.find((s) => (s.outcome as BatchOutcome).kind === 'pending')?.batch || batches[0];
  const priceOrOnly = batches.find((b) => b.kind === 'price') || batches[0];
  const multi = batches.length > 1 || batches[0].kind === 'content' || batches[0].kind === 'create';
  return { kind: 'pending', batchRequestId: firstPending.batchRequestId, sent: priceOrOnly.item, ...(multi ? { batches } : {}) };
}

export function createTrendyolSession(client: TrendyolApiClient, userId: string, supplierId: string, opts: { pollAttempts?: number; pollIntervalMs?: number } = {}): CatalogExecutorSession {
  const pollAttempts = opts.pollAttempts ?? POLL_ATTEMPTS;
  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;

  async function poll(
    batchRequestId: string,
    drafts: CatalogDraftRecord[],
    sentItems: Map<string, Record<string, unknown>>,
    kind: SentBatch['kind'],
    barcodeOf: (d: CatalogDraftRecord) => string,
  ) {
    let outcomes = new Map<string, BatchOutcome>(drafts.map((d) => [d.id, { kind: 'pending' } as BatchOutcome]));
    for (let i = 0; i < pollAttempts; i++) {
      await sleep(i === 0 ? Math.min(1500, pollIntervalMs) : pollIntervalMs);
      try {
        const data = await client.getBatchStatus(batchRequestId);
        outcomes = batchOutcomes(data, drafts, sentItems, { kind, barcodeOf });
        if (Array.from(outcomes.values()).every((o) => o.kind !== 'pending')) break;
      } catch {
        /* transient: keep the drafts pending; the cron resolves them */
      }
    }
    return outcomes;
  }

  const send = (kind: SentBatch['kind'], payload: Record<string, unknown>[]): Promise<any> => {
    if (kind === 'archive') return client.archiveProducts(payload as Array<{ barcode: string }>);
    if (kind === 'price') return client.updatePriceAndInventory(payload);
    if (kind === 'content') return client.updateProducts(payload);
    return client.createProducts(payload);
  };

  return {
    async readRemote(externalIds) {
      const map = new Map<string, RemoteState>();
      for (const barcode of externalIds) {
        const data: any = await client.getProducts({ barcode, size: 1 });
        const p = Array.isArray(data?.content) ? data.content.find((x: any) => String(x?.barcode) === barcode) : null;
        map.set(barcode, p ? { exists: true, updatedAt: null, values: trendyolValuesFromApi(p), raw: p } : { exists: false, updatedAt: null, values: {} });
      }
      return map;
    },

    async applyMany(items) {
      const results = new Map<string, ApplyOutcome | CatalogExecutorError>();
      const steps = new Map<string, StepResult[]>();
      const createBarcode = new Map<string, string>();
      // Per kind: the drafts and their items. A draft whose item cannot be built fails before any send.
      type Entry = { draft: CatalogDraftRecord; barcode: string; item: Record<string, unknown> };
      const groups: Record<SentBatch['kind'], Entry[]> = { create: [], content: [], price: [], archive: [] };
      for (const { draft, remote } of items) {
        try {
          if (isCreateDraft(draft)) {
            const item = createItem(draft);
            createBarcode.set(draft.id, String(item.barcode));
            groups.create.push({ draft, barcode: String(item.barcode), item });
          } else if (queuedArchiveState(draft) !== null) {
            groups.archive.push({ draft, barcode: draft.externalId, item: { barcode: draft.externalId, archived: queuedArchiveState(draft) } });
          } else {
            const content = hasContentPatch(draft) ? contentItem(draft, remote) : null;
            const price = hasPricePatch(draft) ? priceInventoryItem(draft, remote) : null;
            if (!content && !price) {
              results.set(draft.id, { kind: 'synced', applied: {} });
              continue;
            }
            if (content) groups.content.push({ draft, barcode: draft.externalId, item: content });
            if (price) groups.price.push({ draft, barcode: draft.externalId, item: price });
          }
          steps.set(draft.id, []);
        } catch (err) {
          results.set(draft.id, toExecutorError(err));
        }
      }

      const runBatch = async (kind: SentBatch['kind']) => {
        const group = groups[kind];
        for (let i = 0; i < group.length; i += BATCH_CHUNK) {
          const chunk = group.slice(i, i + BATCH_CHUNK);
          const sentItems = new Map<string, Record<string, unknown>>(chunk.map((c) => [c.barcode, c.item]));
          const byDraft = new Map(chunk.map((c) => [c.draft.id, c.barcode]));
          const barcodeOf = (d: CatalogDraftRecord) => byDraft.get(d.id) ?? d.externalId;
          let batchRequestId: string | null = null;
          try {
            const res: any = await send(kind, chunk.map((c) => c.item));
            batchRequestId = typeof res?.batchRequestId === 'string' && res.batchRequestId ? res.batchRequestId : null;
          } catch (err) {
            const e = toExecutorError(err);
            for (const { draft } of chunk) steps.get(draft.id)?.push({ kind, batch: null, outcome: e });
            continue;
          }
          if (!batchRequestId) {
            const e = new CatalogExecutorError(`${ERR}.batchFailed`, 'Trendyol returned no batchRequestId');
            for (const { draft } of chunk) steps.get(draft.id)?.push({ kind, batch: null, outcome: e });
            continue;
          }
          const outcomes = await poll(batchRequestId, chunk.map((c) => c.draft), sentItems, kind, barcodeOf);
          for (const c of chunk) {
            steps.get(c.draft.id)?.push({ kind, batch: { kind, batchRequestId, item: c.item }, outcome: outcomes.get(c.draft.id) || { kind: 'pending' } });
          }
        }
      };

      // Content before price: a content item is rejected faster than a price batch settles.
      for (const kind of ['create', 'content', 'price', 'archive'] as const) {
        if (groups[kind].length) await runBatch(kind);
      }
      steps.forEach((list, draftId) => {
        if (results.has(draftId)) return;
        results.set(draftId, list.length ? combineSteps(list, createBarcode.get(draftId)) : new CatalogExecutorError(`${ERR}.remoteFailed`, 'Nothing sent'));
      });
      return results;
    },

    async pollBatch(batchRequestId, drafts) {
      const out = new Map<string, BatchOutcome>();
      const statusCache = new Map<string, Promise<any>>();
      const status = (id: string) => {
        let p = statusCache.get(id);
        if (!p) {
          p = client.getBatchStatus(id);
          statusCache.set(id, p);
        }
        return p;
      };
      for (const draft of drafts) {
        const list: StepResult[] = [];
        for (const batch of sentBatchesFor(draft, batchRequestId)) {
          const barcode = String(batch.item.barcode ?? draft.externalId);
          // A poll error throws: the service keeps the drafts pending (and times them out).
          const data = await status(batch.batchRequestId);
          const o = batchOutcomes(data, [draft], new Map([[barcode, batch.item]]), { kind: batch.kind, barcodeOf: () => barcode }).get(draft.id);
          list.push({ kind: batch.kind, batch, outcome: o || { kind: 'pending' } });
        }
        const createdBarcode = isCreateDraft(draft) ? list.find((s) => s.kind === 'create')?.batch?.item.barcode : undefined;
        const combined = combineSteps(list, typeof createdBarcode === 'string' ? createdBarcode : undefined);
        if (combined instanceof CatalogExecutorError) out.set(draft.id, { kind: 'failed', errorKey: combined.errorKey, errorParams: combined.errorParams });
        else if (combined.kind === 'synced') out.set(draft.id, { kind: 'synced', applied: combined.applied, ...(combined.externalId ? { externalId: combined.externalId } : {}) });
        else out.set(draft.id, { kind: 'pending' });
      }
      return out;
    },

    async writeCache(externalId, applied) {
      const images = Array.isArray(applied.images) ? applied.images : null;
      await prisma.trendyolProduct.updateMany({
        where: { userId, supplierId, barcode: externalId },
        data: {
          ...(applied.price !== undefined && applied.price !== null ? { salePrice: applied.price } : {}),
          ...(applied.listPrice !== undefined && applied.listPrice !== null ? { listPrice: applied.listPrice } : {}),
          ...(applied.quantity !== undefined && applied.quantity !== null ? { quantity: applied.quantity } : {}),
          ...(applied.archived !== undefined ? { archived: applied.archived } : {}),
          ...(typeof applied.title === 'string' && applied.title ? { title: applied.title } : {}),
          ...(typeof applied.description === 'string' ? { description: applied.description } : {}),
          ...(images ? { images: images.map((url) => ({ url })), imageCount: images.length, thumbnailUrl: images[0] ?? null } : {}),
          ...(Array.isArray(applied.attributes) ? { attributes: applied.attributes as any } : {}),
          ...(typeof applied.stockCode === 'string' ? { stockCode: applied.stockCode } : {}),
          ...(typeof applied.dimensionalWeight === 'number' ? { dimensionalWeight: applied.dimensionalWeight } : {}),
          ...(typeof applied.vatRate === 'number' ? { vatRate: applied.vatRate } : {}),
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
