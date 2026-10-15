// components/domain/bulk/useBulkStaging.ts — bulk-grid §6.1 client staging queue (M7-C).
//
// - `pending: Map<rowId, Record<field, value>>` holds valid edits not yet written. Every `enqueue` merges into it
//   and (re)starts ONE 800 ms debounce for the whole queue, so a 200-row paste becomes one flush.
// - A flush writes `POST /api/{mp}-drafts/batch-stage` (M7-B, §6.2) with ≤ 50 items per request and at most 2
//   requests in flight; 200 rows = exactly 4 requests.
// - Per-row serialization: a row with a request in flight is never re-sent until that request returns; its new
//   edits wait in `pending`, so two writes to one draft never race.
// - Per-item failures become `failed` rows (their values stay local and show as invalid with the server reason);
//   they never fail the batch. A 402 marks `limitHit` (C6 Banner).
//
// Safety: this only STAGES drafts. Nothing here sends to a marketplace (bulk-grid §6.5 sends separately, on an
// explicit action). Queued actions are never written from here, so a staged delete can't be created by the queue.
import * as React from 'react';
import { stageEtsyDraft } from '@/lib/etsy/draftClient';
import { stageEbayDraft } from '@/lib/ebay/draftClient';
import { stageCatalogDraft, type CatalogMarketplace } from '@/lib/catalogDrafts/client';
import { twoDecimals } from '@/components/domain/listings/useStagedChanges';
import type { ListingMarketplace } from '@/lib/listings/types';
import type { BulkField, BulkTransportKind } from './config/types';
import { BULK_DEBOUNCE_MS, BULK_MAX_IN_FLIGHT } from './config';
import { BATCH_STAGE_MAX_ITEMS } from '@/lib/bulk/batchStage';

/** Items per request = the server's limit (M7-B, bulk-grid §6.1: 50). */
const BULK_BATCH_SIZE = BATCH_STAGE_MAX_ITEMS;

// ─── Types ──────────────────────────────────────────────────────────────────

export type FieldValues = Partial<Record<BulkField, unknown>>;

export type CellPatch = { rowId: string; field: BulkField; value: unknown };

export type BulkStageItem = { rowId: string; values: FieldValues };

export type StageFailure = { code?: string; key?: string; params?: Record<string, string | number> };

export type BulkDraftStatus = 'draft' | 'failed' | 'conflict';

/** A field the server did not stage although the item succeeded (M7-B `rejected`). `field` is a grid field. */
export type RejectedField = { field: string } & StageFailure;

export type BulkStageResult =
  | { rowId: string; ok: true; draftId?: string; status?: BulkDraftStatus; rejected?: RejectedField[] }
  | ({ rowId: string; ok: false } & StageFailure);

export interface BulkStageTransport {
  /** Stages up to BULK_BATCH_SIZE items; resolves one result per item (missing = failed). Throws on a request error. */
  stageBatch(items: BulkStageItem[]): Promise<BulkStageResult[]>;
}

/** Thrown by a transport for a whole-request failure (network, 5xx, 402). */
export class BulkStageError extends Error {
  status: number;
  code?: string;
  key?: string;
  constructor(status: number, message: string, code?: string, key?: string) {
    super(message);
    this.name = 'BulkStageError';
    this.status = status;
    this.code = code;
    this.key = key;
  }
}

export type QueueProgress = { done: number; total: number };

export type QueueSnapshot = {
  /** Valid edits waiting for the debounce / a free lane. */
  pending: ReadonlyMap<string, FieldValues>;
  /** Edits in a request right now. */
  inFlight: ReadonlyMap<string, FieldValues>;
  /** Values written to the draft by this session (confirmed by the server). */
  staged: ReadonlyMap<string, FieldValues>;
  /** Values the server refused, with the reason (shown as invalid; never retried automatically). */
  failed: ReadonlyMap<string, { values: FieldValues; error: StageFailure }>;
  /** Draft id + status per row, from the batch results. */
  drafts: ReadonlyMap<string, { draftId?: string; status?: BulkDraftStatus }>;
  /** "Saving 120 / 200…" while busy; null when idle. */
  progress: QueueProgress | null;
  busy: boolean;
  savedAt: Date | null;
  limitHit: boolean;
  /** Requests sent since the queue was created (tests, acceptance step 3). */
  requests: number;
};

export type QueueOptions = {
  transport: BulkStageTransport;
  debounceMs?: number;
  batchSize?: number;
  maxInFlight?: number;
  now?: () => Date;
};

function mergeValues(a: FieldValues | undefined, b: FieldValues): FieldValues {
  return { ...(a ?? {}), ...b };
}

function omitFields(values: FieldValues | undefined, fields: readonly string[] | undefined): FieldValues | undefined {
  if (!values) return undefined;
  if (!fields) return undefined;
  const next: FieldValues = { ...values };
  for (const f of fields) delete next[f as BulkField];
  return Object.keys(next).length ? next : undefined;
}

// ─── Queue (framework-free, unit-tested) ────────────────────────────────────

export class BulkStagingQueue {
  private transport: BulkStageTransport;
  private debounceMs: number;
  private batchSize: number;
  private maxInFlight: number;
  private now: () => Date;

  private pending = new Map<string, FieldValues>();
  private inFlight = new Map<string, FieldValues>();
  private staged = new Map<string, FieldValues>();
  private failed = new Map<string, { values: FieldValues; error: StageFailure }>();
  private drafts = new Map<string, { draftId?: string; status?: BulkDraftStatus }>();
  private requestsInFlight = 0;
  private requests = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private counted = new Set<string>();
  private savedAt: Date | null = null;
  private limitHit = false;
  private listeners = new Set<() => void>();
  private idleWaiters: Array<() => void> = [];
  private snapshot: QueueSnapshot;
  private disposed = false;
  /**
   * Fields reverted while their request was in flight (Revert / Discard all during "Saving…"): when that request
   * returns, its values for these fields are NOT merged back into `staged` (the caller rewrites the draft after
   * `whenIdle()`), so a reverted value never reappears as an unsent edit. `null` = every field of the row.
   */
  private reverted = new Map<string, Set<string> | null>();

  constructor(opts: QueueOptions) {
    this.transport = opts.transport;
    this.debounceMs = opts.debounceMs ?? BULK_DEBOUNCE_MS;
    this.batchSize = opts.batchSize ?? BULK_BATCH_SIZE;
    this.maxInFlight = opts.maxInFlight ?? BULK_MAX_IN_FLIGHT;
    this.now = opts.now ?? (() => new Date());
    this.snapshot = this.build();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): QueueSnapshot => this.snapshot;

  isBusy(): boolean {
    return this.pending.size > 0 || this.requestsInFlight > 0;
  }

  /** Merges valid edits into `pending` and restarts the debounce. Clears earlier server failures of those fields. */
  enqueue(patches: CellPatch[]): void {
    if (!patches.length || this.disposed) return;
    // A new edit after a usage-limit stop retries (the user may have upgraded); a 402 stops it again.
    this.limitHit = false;
    for (const p of patches) {
      const prev = this.pending.get(p.rowId);
      this.pending.set(p.rowId, mergeValues(prev, { [p.field]: p.value }));
      this.counted.add(p.rowId);
      const f = this.failed.get(p.rowId);
      if (f) {
        const rest = omitFields(f.values, [p.field]);
        if (rest) this.failed.set(p.rowId, { ...f, values: rest });
        else this.failed.delete(p.rowId);
      }
    }
    this.restartTimer();
    this.emit();
  }

  /**
   * Forgets local values of a row (Revert cell / row, Discard all): `fields` undefined = every field.
   * Pending and failed values are dropped; staged values are forgotten (the caller rewrites the draft).
   * In-flight values can't be recalled from the server; they are marked reverted so the returning request does not
   * restore them locally, and callers await `whenIdle()` before rewriting the draft.
   */
  drop(rowId: string, fields?: readonly string[]): void {
    if (this.inFlight.has(rowId)) {
      const prev = this.reverted.get(rowId);
      if (!fields || prev === null) this.reverted.set(rowId, null);
      else this.reverted.set(rowId, new Set([...(prev ?? []), ...fields]));
    }
    const apply = <V>(map: Map<string, V>, get: (v: V) => FieldValues, set: (v: V, values: FieldValues) => V) => {
      const cur = map.get(rowId);
      if (!cur) return;
      const rest = fields ? omitFields(get(cur), fields) : undefined;
      if (rest) map.set(rowId, set(cur, rest));
      else map.delete(rowId);
    };
    apply(this.pending, (v) => v, (_v, values) => values);
    apply(this.staged, (v) => v, (_v, values) => values);
    apply(this.failed, (v) => v.values, (v, values) => ({ ...v, values }));
    if (!this.pending.has(rowId) && !this.staged.has(rowId)) this.drafts.delete(rowId);
    if (!this.pending.size && !this.requestsInFlight) this.clearTimer();
    this.emit();
  }

  /** After a send: these rows' staged values now live on the marketplace (or in a failed draft the list shows). */
  settle(rowIds: readonly string[]): void {
    let changed = false;
    for (const rowId of rowIds) {
      changed = this.staged.delete(rowId) || changed;
      changed = this.drafts.delete(rowId) || changed;
    }
    if (changed) this.emit();
  }

  /** ⌘S, Send, leaving: write everything now. */
  flushNow(): void {
    this.clearTimer();
    this.pump();
  }

  /** Resolves once nothing is pending or in flight (flushes first). */
  whenIdle(): Promise<void> {
    this.flushNow();
    if (!this.isBusy()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /**
   * Unmount: stops the debounce and further dispatch. Not permanent: React StrictMode (dev) runs an effect's
   * cleanup and then the effect again on the same memoised queue, so `revive()` undoes it.
   */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  /** (Re)mount: accepts edits again and restarts the debounce for anything still waiting. */
  revive(): void {
    if (!this.disposed) return;
    this.disposed = false;
    if (this.pending.size) this.restartTimer();
  }

  // ── internals ──

  private restartTimer() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, this.debounceMs);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private pump() {
    if (this.disposed) return;
    let dispatched = false;
    while (this.requestsInFlight < this.maxInFlight) {
      const rows: string[] = [];
      for (const rowId of this.pending.keys()) {
        if (this.inFlight.has(rowId)) continue; // per-row serialization
        rows.push(rowId);
        if (rows.length >= this.batchSize) break;
      }
      if (!rows.length) break;
      const items: BulkStageItem[] = rows.map((rowId) => ({ rowId, values: this.pending.get(rowId) as FieldValues }));
      for (const { rowId, values } of items) {
        this.inFlight.set(rowId, values);
        this.pending.delete(rowId);
      }
      this.requestsInFlight += 1;
      this.requests += 1;
      dispatched = true;
      void this.run(items);
    }
    if (dispatched) this.emit();
  }

  private async run(items: BulkStageItem[]) {
    let results: BulkStageResult[] = [];
    let requestError: StageFailure | null = null;
    try {
      results = await this.transport.stageBatch(items);
    } catch (err) {
      const e = err as { status?: number; code?: string; key?: string };
      if (e?.status === 402) this.limitHit = true;
      requestError = { code: e?.status === 402 ? 'LIMIT' : e?.code ?? 'REQUEST_FAILED', key: e?.key };
    }
    const byRow = new Map(results.map((r) => [r.rowId, r]));
    for (const sent of items) {
      this.inFlight.delete(sent.rowId);
      // Fields reverted while this request was in flight are not restored locally (see `reverted`).
      const gone = this.reverted.has(sent.rowId) ? this.reverted.get(sent.rowId) ?? null : undefined;
      this.reverted.delete(sent.rowId);
      const kept = gone === undefined ? sent.values : gone === null ? undefined : omitFields(sent.values, Array.from(gone));
      if (!kept) continue;
      const item: BulkStageItem = { rowId: sent.rowId, values: kept };
      const r = requestError ? null : byRow.get(item.rowId);
      if (r && r.ok) {
        const rejected = (r.rejected ?? []).filter((x) => x.field in item.values);
        const accepted = rejected.length ? omitFields(item.values, rejected.map((x) => x.field)) : item.values;
        if (accepted) this.staged.set(item.rowId, mergeValues(this.staged.get(item.rowId), accepted));
        this.drafts.set(item.rowId, { draftId: r.draftId, status: r.status });
        if (rejected.length) {
          const values: FieldValues = {};
          for (const x of rejected) values[x.field as BulkField] = item.values[x.field as BulkField];
          const prev = this.failed.get(item.rowId);
          this.failed.set(item.rowId, { values: mergeValues(prev?.values, values), error: { code: rejected[0].code ?? 'REJECTED', key: rejected[0].key, params: rejected[0].params } });
        }
      } else {
        const error: StageFailure = requestError ?? (r && !r.ok ? { code: r.code, key: r.key, params: r.params } : { code: 'NO_RESULT' });
        // Newer pending edits of the same field win over the failed value.
        const newer = this.pending.get(item.rowId);
        const values = newer ? omitFields(item.values, Object.keys(newer)) : item.values;
        if (values && Object.keys(values).length) {
          const prev = this.failed.get(item.rowId);
          this.failed.set(item.rowId, { values: mergeValues(prev?.values, values), error });
        }
      }
    }
    this.requestsInFlight -= 1;
    if (this.limitHit) {
      // Usage limit (402): nothing more can be staged now. Waiting edits stay local as failed (C6 Banner), so the
      // queue goes idle instead of retrying into the limit.
      this.clearTimer();
      for (const [rowId, values] of this.pending) {
        const prev = this.failed.get(rowId);
        this.failed.set(rowId, { values: mergeValues(prev?.values, values), error: { code: 'LIMIT' } });
      }
      this.pending.clear();
    } else if (!this.timer) this.pump();
    if (!this.isBusy()) {
      this.savedAt = this.now();
      this.counted.clear();
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      this.emit();
      waiters.forEach((w) => w());
      return;
    }
    this.emit();
  }

  private build(): QueueSnapshot {
    const busy = this.isBusy();
    let progress: QueueProgress | null = null;
    if (busy) {
      let done = 0;
      for (const r of this.counted) if (!this.pending.has(r) && !this.inFlight.has(r)) done += 1;
      progress = { done, total: this.counted.size };
    }
    return {
      pending: new Map(this.pending),
      inFlight: new Map(this.inFlight),
      staged: new Map(this.staged),
      failed: new Map(this.failed),
      drafts: new Map(this.drafts),
      progress,
      busy,
      savedAt: this.savedAt,
      limitHit: this.limitHit,
      requests: this.requests,
    };
  }

  private emit() {
    this.snapshot = this.build();
    this.listeners.forEach((l) => l());
  }
}

// ─── Field mapping per draft backend (pure) ─────────────────────────────────

/** Etsy `fields` (draftService `fieldPatch` keys). */
export function toEtsyFields(values: FieldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (values.title !== undefined) out.title = values.title;
  if (values.price !== undefined) out.price = values.price;
  if (values.qty !== undefined) out.quantity = values.qty;
  if (values.section !== undefined) out.shop_section_id = values.section === null ? null : Number(values.section);
  if (values.tags !== undefined) out.tags = values.tags;
  return out;
}

/** eBay inventory / offer fields (same paths as listings `ebayAdapter`). */
export function toEbayFields(values: FieldValues, currency: string): { inventoryFields?: Record<string, unknown>; offerFields?: Record<string, unknown> } {
  const inventoryFields: Record<string, unknown> = {};
  const offerFields: Record<string, unknown> = {};
  if (typeof values.title === 'string') inventoryFields.product = { title: values.title };
  if (typeof values.qty === 'number') inventoryFields.availability = { shipToLocationAvailability: { quantity: values.qty } };
  if (typeof values.price === 'number') offerFields.pricingSummary = { price: { value: twoDecimals(values.price), currency } };
  return {
    ...(Object.keys(inventoryFields).length ? { inventoryFields } : {}),
    ...(Object.keys(offerFields).length ? { offerFields } : {}),
  };
}

/** CatalogDraft v1 fields. */
export function toCatalogFields(values: FieldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (values.title !== undefined) out.title = values.title;
  if (values.price !== undefined) out.price = values.price;
  if (values.qty !== undefined) out.quantity = values.qty;
  if (values.tags !== undefined) out.tags = values.tags;
  return out;
}

// ─── Transports ─────────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

function rec(v: unknown): AnyRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : {};
}

const DRAFT_STATUSES: readonly BulkDraftStatus[] = ['draft', 'failed', 'conflict'];

/** Server field key (Etsy `quantity`, `shop_section_id`, eBay paths) → grid field. */
function gridFieldOf(serverField: unknown): BulkField | null {
  const f = String(serverField ?? '');
  if (f === 'title' || f.endsWith('product.title')) return 'title';
  if (f === 'price' || f.includes('pricingSummary')) return 'price';
  if (f === 'quantity' || f === 'qty' || f.includes('availability')) return 'qty';
  if (f === 'shop_section_id' || f === 'section') return 'section';
  if (f === 'tags') return 'tags';
  return null;
}

function rejectedOf(list: unknown): RejectedField[] {
  if (!Array.isArray(list)) return [];
  return list.map(rec).flatMap((x) => {
    const field = gridFieldOf(x.field);
    if (!field) return [];
    return [
      {
        field,
        code: 'REJECTED',
        ...(typeof x.key === 'string' ? { key: x.key } : {}),
        ...(x.params && typeof x.params === 'object' ? { params: x.params as Record<string, string | number> } : {}),
      },
    ];
  });
}

/**
 * M7-B response (`lib/bulk/batchStage.ts` `BatchStageResponse`) → results keyed by the requested row ids
 * (`listingId`; `externalId` / `sku` accepted too). `rejected` fields of an ok item stay local as failed.
 */
export function parseBatchResults(body: unknown, items: BulkStageItem[]): BulkStageResult[] {
  const list = Array.isArray(rec(body).results) ? (rec(body).results as unknown[]).map(rec) : [];
  const wanted = new Set(items.map((i) => i.rowId));
  const out: BulkStageResult[] = [];
  for (const r of list) {
    const rowId = String(r.listingId ?? r.externalId ?? r.sku ?? '');
    if (!wanted.has(rowId)) continue;
    if (r.ok === true) {
      const status = DRAFT_STATUSES.includes(r.status as BulkDraftStatus) ? (r.status as BulkDraftStatus) : undefined;
      const rejected = rejectedOf(r.rejected);
      out.push({
        rowId,
        ok: true,
        ...(typeof r.draftId === 'string' ? { draftId: r.draftId } : {}),
        ...(status ? { status } : {}),
        ...(rejected.length ? { rejected } : {}),
      });
    } else {
      out.push({
        rowId,
        ok: false,
        ...(typeof r.code === 'string' ? { code: r.code } : {}),
        ...(typeof r.key === 'string' ? { key: r.key } : {}),
        ...(r.params && typeof r.params === 'object' ? { params: r.params as Record<string, string | number> } : {}),
      });
    }
  }
  return out;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The batch endpoint is not there (404/405): fall back to one stage call per item. */
function routeMissing(status: number, kind: BulkTransportKind): boolean {
  // eBay / catalog: a 400 from an endpoint that predates `items[]` also means "use the single-item path".
  return status === 404 || status === 405 || (kind !== 'etsy' && status === 400);
}

async function pool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i]);
      }
    }),
  );
  return out;
}

function failureOf(rowId: string, err: unknown): BulkStageResult {
  const e = err as { status?: number; code?: string; key?: string; params?: Record<string, string | number> };
  if (e?.status === 402) throw new BulkStageError(402, 'Payment Required', 'LIMIT');
  return { rowId, ok: false, ...(e?.code ? { code: e.code } : {}), ...(e?.key ? { key: e.key } : {}), ...(e?.params ? { params: e.params } : {}) };
}

function statusOf(draft: unknown): BulkDraftStatus | undefined {
  const s = String(rec(draft).status ?? '');
  return DRAFT_STATUSES.includes(s as BulkDraftStatus) ? (s as BulkDraftStatus) : undefined;
}

export type SingleStage = (item: BulkStageItem) => Promise<unknown>;

/** Single-item fallback concurrency (same as the server's batch concurrency, §6.2). */
const FALLBACK_CONCURRENCY = 5;

export function createBatchTransport(opts: {
  kind: BulkTransportKind;
  url: string;
  body(items: BulkStageItem[]): unknown;
  single: SingleStage;
  fetchImpl?: FetchLike;
}): BulkStageTransport {
  const doFetch: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  let batchMissing = false;
  const fallback = async (items: BulkStageItem[]) =>
    pool(items, FALLBACK_CONCURRENCY, async (item): Promise<BulkStageResult> => {
      try {
        const draft = await opts.single(item);
        const id = rec(draft).id;
        const status = statusOf(draft);
        return { rowId: item.rowId, ok: true, ...(typeof id === 'string' ? { draftId: id } : {}), ...(status ? { status } : {}) };
      } catch (err) {
        return failureOf(item.rowId, err);
      }
    });
  return {
    async stageBatch(items) {
      if (!items.length) return [];
      if (batchMissing) return fallback(items);
      const res = await doFetch(opts.url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.body(items)),
      });
      if (routeMissing(res.status, opts.kind)) {
        batchMissing = true;
        return fallback(items);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const b = rec(body);
        throw new BulkStageError(res.status, String(b.error ?? `HTTP ${res.status}`), typeof b.code === 'string' ? b.code : undefined, typeof b.key === 'string' ? b.key : undefined);
      }
      return parseBatchResults(body, items);
    },
  };
}

export type TransportContext = {
  marketplace: ListingMarketplace;
  storeId: string | null;
  /** Row currency (eBay `pricingSummary.price.currency`). */
  currencyOf(rowId: string): string;
  fetchImpl?: FetchLike;
};

/** The transport of a marketplace (bulk-grid §6.2 endpoints, single-item fallback through the draft clients). */
export function createTransport(kind: BulkTransportKind, ctx: TransportContext): BulkStageTransport {
  const storeId = ctx.storeId ?? '';
  if (kind === 'etsy') {
    return createBatchTransport({
      kind,
      url: '/api/etsy-drafts/batch-stage',
      body: (items) => ({ shopId: storeId, items: items.map((i) => ({ listingId: i.rowId, fields: toEtsyFields(i.values) })) }),
      single: (i) => stageEtsyDraft({ shopId: storeId, listingId: i.rowId, fields: toEtsyFields(i.values) }),
      fetchImpl: ctx.fetchImpl,
    });
  }
  if (kind === 'ebay') {
    return createBatchTransport({
      kind,
      url: '/api/ebay-drafts/batch-stage',
      body: (items) => ({ items: items.map((i) => ({ sku: i.rowId, ...toEbayFields(i.values, ctx.currencyOf(i.rowId)) })) }),
      single: (i) => stageEbayDraft({ sku: i.rowId, ...toEbayFields(i.values, ctx.currencyOf(i.rowId)) }),
      fetchImpl: ctx.fetchImpl,
    });
  }
  const marketplace = ctx.marketplace as CatalogMarketplace;
  return createBatchTransport({
    kind,
    url: '/api/catalog-drafts',
    body: (items) => ({
      marketplace,
      ...(ctx.storeId ? { storeId: ctx.storeId } : {}),
      items: items.map((i) => ({ externalId: i.rowId, fields: toCatalogFields(i.values) })),
    }),
    single: (i) =>
      stageCatalogDraft({
        marketplace,
        ...(ctx.storeId ? { storeId: ctx.storeId } : {}),
        externalId: i.rowId,
        fields: toCatalogFields(i.values) as Parameters<typeof stageCatalogDraft>[0]['fields'],
      }),
    fetchImpl: ctx.fetchImpl,
  });
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export type UseBulkStaging = QueueSnapshot & {
  queue: BulkStagingQueue;
  enqueue(patches: CellPatch[]): void;
  drop(rowId: string, fields?: readonly string[]): void;
  settle(rowIds: readonly string[]): void;
  flushNow(): void;
  whenIdle(): Promise<void>;
};

/** One queue per transport (a store switch makes a new queue). `transport` must be memoised by the caller. */
export function useBulkStaging(transport: BulkStageTransport, opts: Omit<QueueOptions, 'transport'> = {}): UseBulkStaging {
  const optsRef = React.useRef(opts);
  const queue = React.useMemo(() => new BulkStagingQueue({ transport, ...optsRef.current }), [transport]);
  React.useEffect(() => {
    queue.revive();
    return () => queue.dispose();
  }, [queue]);
  const snap = React.useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  return React.useMemo(
    () => ({
      ...snap,
      queue,
      enqueue: (p: CellPatch[]) => queue.enqueue(p),
      drop: (rowId: string, fields?: readonly string[]) => queue.drop(rowId, fields),
      settle: (rowIds: readonly string[]) => queue.settle(rowIds),
      flushNow: () => queue.flushNow(),
      whenIdle: () => queue.whenIdle(),
    }),
    [snap, queue],
  );
}

export default useBulkStaging;
