// M7-C staging queue + transports (bulk-grid §6.1, §6.2, §9 step 3): debounce, ≤ 50 items per request, 2 in flight,
// per-row serialization, per-item failures and rejected fields, usage limit, and the batch endpoint bodies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BulkStagingQueue,
  BulkStageError,
  createBatchTransport,
  createTransport,
  parseBatchResults,
  toCatalogFields,
  toEbayFields,
  toEtsyFields,
  type BulkStageItem,
  type BulkStageResult,
  type BulkStageTransport,
  type CellPatch,
} from '@/components/domain/bulk/useBulkStaging';

type Deferred = { items: BulkStageItem[]; resolve: (r: BulkStageResult[]) => void; reject: (e: unknown) => void };

function manualTransport() {
  const calls: Deferred[] = [];
  const transport: BulkStageTransport = {
    stageBatch: (items) =>
      new Promise<BulkStageResult[]>((resolve, reject) => {
        calls.push({ items, resolve, reject });
      }),
  };
  const okAll = (d: Deferred) => d.resolve(d.items.map((i) => ({ rowId: i.rowId, ok: true, draftId: `d-${i.rowId}`, status: 'draft' })));
  return { transport, calls, okAll };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function paste(rows: number, fields: Array<'title' | 'price' | 'qty'> = ['title', 'price', 'qty']): CellPatch[] {
  const out: CellPatch[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (const f of fields) out.push({ rowId: String(1000 + r), field: f, value: f === 'title' ? `Title ${r}` : r + 1 });
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('BulkStagingQueue', () => {
  it('debounces the whole queue: edits within 800 ms become one flush', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue([{ rowId: '1', field: 'price', value: 10 }]);
    vi.advanceTimersByTime(500);
    q.enqueue([{ rowId: '2', field: 'price', value: 11 }]);
    vi.advanceTimersByTime(799);
    expect(m.calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].items.map((i) => i.rowId)).toEqual(['1', '2']);
  });

  it('200 rows × 3 columns → exactly 200 items in 4 requests of 50, never more than 2 in flight', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue(paste(200));
    expect(q.getSnapshot().pending.size).toBe(200);
    vi.advanceTimersByTime(800);
    expect(m.calls).toHaveLength(2);
    expect(m.calls.every((c) => c.items.length === 50)).toBe(true);
    expect(q.getSnapshot().progress).toEqual({ done: 0, total: 200 });
    m.okAll(m.calls[0]);
    await flush();
    expect(m.calls).toHaveLength(3);
    expect(q.getSnapshot().progress).toEqual({ done: 50, total: 200 });
    m.okAll(m.calls[1]);
    m.okAll(m.calls[2]);
    await flush();
    expect(m.calls).toHaveLength(4);
    m.okAll(m.calls[3]);
    await flush();
    const snap = q.getSnapshot();
    expect(snap.requests).toBe(4);
    expect(m.calls.flatMap((c) => c.items)).toHaveLength(200);
    expect(new Set(m.calls.flatMap((c) => c.items.map((i) => i.rowId))).size).toBe(200);
    // every item carries all three fields of its row (one draft per listing)
    expect(m.calls[0].items[0].values).toEqual({ title: 'Title 0', price: 1, qty: 1 });
    expect(snap.busy).toBe(false);
    expect(snap.progress).toBeNull();
    expect(snap.staged.size).toBe(200);
    expect(snap.savedAt).toBeInstanceOf(Date);
  });

  it('per-row serialization: a row in flight is not re-sent until its request returns', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue([{ rowId: '1', field: 'price', value: 10 }]);
    vi.advanceTimersByTime(800);
    expect(m.calls).toHaveLength(1);
    q.enqueue([{ rowId: '1', field: 'price', value: 12 }, { rowId: '2', field: 'qty', value: 3 }]);
    vi.advanceTimersByTime(800);
    // row 2 goes; row 1 waits for its first request
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1].items.map((i) => i.rowId)).toEqual(['2']);
    m.okAll(m.calls[0]);
    await flush();
    expect(m.calls).toHaveLength(3);
    expect(m.calls[2].items).toEqual([{ rowId: '1', values: { price: 12 } }]);
  });

  it('per-item failures stay local with the server reason; the rest of the batch is staged', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue([{ rowId: '1', field: 'price', value: 10 }, { rowId: '2', field: 'price', value: 11 }]);
    vi.advanceTimersByTime(800);
    m.calls[0].resolve([
      { rowId: '1', ok: true, draftId: 'd1', status: 'draft' },
      { rowId: '2', ok: false, code: 'CONFLICT', key: 'etsy.draftSync.conflict' },
    ]);
    await flush();
    const s = q.getSnapshot();
    expect(s.staged.get('1')).toEqual({ price: 10 });
    expect(s.failed.get('2')).toEqual({ values: { price: 11 }, error: { code: 'CONFLICT', key: 'etsy.draftSync.conflict', params: undefined } });
    // a new edit of the failed field clears the failure and retries
    q.enqueue([{ rowId: '2', field: 'price', value: 12 }]);
    expect(q.getSnapshot().failed.has('2')).toBe(false);
  });

  it('fields the server rejected on an ok item are not counted as staged', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue([{ rowId: '1', field: 'title', value: 'A && B' }, { rowId: '1', field: 'price', value: 10 }]);
    vi.advanceTimersByTime(800);
    m.calls[0].resolve([{ rowId: '1', ok: true, draftId: 'd1', status: 'draft', rejected: [{ field: 'title', key: 'etsy.validation.titleCharOnce' }] }]);
    await flush();
    const s = q.getSnapshot();
    expect(s.staged.get('1')).toEqual({ price: 10 });
    expect(s.failed.get('1')?.values).toEqual({ title: 'A && B' });
    expect(s.failed.get('1')?.error.key).toBe('etsy.validation.titleCharOnce');
  });

  it('a 402 marks the usage limit, keeps waiting edits local and goes idle (whenIdle resolves)', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport, maxInFlight: 1 });
    q.enqueue(paste(60, ['price']));
    const idle = q.whenIdle();
    expect(m.calls).toHaveLength(1);
    m.calls[0].reject(new BulkStageError(402, 'Payment Required', 'LIMIT'));
    await flush();
    await idle;
    const s = q.getSnapshot();
    expect(s.limitHit).toBe(true);
    expect(s.busy).toBe(false);
    expect(s.failed.size).toBe(60);
    expect(m.calls).toHaveLength(1);
  });

  it('drop forgets pending and staged values of the reverted fields only', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue([{ rowId: '1', field: 'price', value: 10 }, { rowId: '1', field: 'title', value: 'X' }]);
    q.drop('1', ['price']);
    expect(q.getSnapshot().pending.get('1')).toEqual({ title: 'X' });
    q.drop('1');
    expect(q.getSnapshot().pending.has('1')).toBe(false);
    expect(q.getSnapshot().busy).toBe(false);
  });

  it('settle clears staged values after a send', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue([{ rowId: '1', field: 'price', value: 10 }]);
    q.flushNow();
    m.okAll(m.calls[0]);
    await flush();
    expect(q.getSnapshot().staged.has('1')).toBe(true);
    q.settle(['1']);
    expect(q.getSnapshot().staged.has('1')).toBe(false);
    expect(q.getSnapshot().drafts.has('1')).toBe(false);
  });
});

describe('field mapping', () => {
  it('Etsy fields use the draftService keys', () => {
    expect(toEtsyFields({ title: 'T', price: 12.5, qty: 3, section: '77', tags: ['a'] })).toEqual({ title: 'T', price: 12.5, quantity: 3, shop_section_id: 77, tags: ['a'] });
    expect(toEtsyFields({ section: null })).toEqual({ shop_section_id: null });
  });
  it('eBay fields use the inventory / offer paths with a decimal string price', () => {
    expect(toEbayFields({ title: 'T', qty: 2, price: 12.5 }, 'EUR')).toEqual({
      inventoryFields: { product: { title: 'T' }, availability: { shipToLocationAvailability: { quantity: 2 } } },
      offerFields: { pricingSummary: { price: { value: '12.50', currency: 'EUR' } } },
    });
  });
  it('catalog fields are the v1 CatalogDraft keys', () => {
    expect(toCatalogFields({ title: 'T', price: 1, qty: 2, tags: ['x'] })).toEqual({ title: 'T', price: 1, quantity: 2, tags: ['x'] });
  });
});

describe('parseBatchResults (M7-B contract)', () => {
  const items: BulkStageItem[] = [{ rowId: '1', values: {} }, { rowId: '2', values: {} }];
  it('maps listingId results, keeps fully-qualified keys and rejected fields; ignores rows not asked for', () => {
    const out = parseBatchResults(
      {
        results: [
          { listingId: '1', ok: true, draftId: 'd1', status: 'conflict', rejected: [{ field: 'quantity', key: 'etsy.validation.quantityMin' }] },
          { listingId: '2', ok: false, code: 'BUDGET', key: 'bulk.stage.budget' },
          { listingId: '9', ok: true, draftId: 'd9', status: 'draft' },
        ],
      },
      items,
    );
    expect(out).toEqual([
      { rowId: '1', ok: true, draftId: 'd1', status: 'conflict', rejected: [{ field: 'qty', code: 'REJECTED', key: 'etsy.validation.quantityMin' }] },
      { rowId: '2', ok: false, code: 'BUDGET', key: 'bulk.stage.budget' },
    ]);
  });
});

describe('transports', () => {
  beforeEach(() => vi.useRealTimers());

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  it('Etsy posts { shopId, items: [{ listingId, fields }] } to /api/etsy-drafts/batch-stage', async () => {
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return jsonResponse({ results: body.items.map((i: { listingId: string }) => ({ listingId: i.listingId, ok: true, draftId: `d${i.listingId}`, status: 'draft' })) });
    });
    const tr = createTransport('etsy', { marketplace: 'etsy', storeId: 'S1', currencyOf: () => 'USD', fetchImpl });
    const res = await tr.stageBatch([{ rowId: '11', values: { price: 12.5, qty: 2 } }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/etsy-drafts/batch-stage');
    expect(JSON.parse(String(init?.body))).toEqual({ shopId: 'S1', items: [{ listingId: '11', fields: { price: 12.5, quantity: 2 } }] });
    expect(res).toEqual([{ rowId: '11', ok: true, draftId: 'd11', status: 'draft' }]);
  });

  it('eBay sends items keyed by sku; catalog sends { marketplace, storeId, items: [{ externalId, fields }] }', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
    await createTransport('ebay', { marketplace: 'ebay', storeId: null, currencyOf: () => 'USD', fetchImpl }).stageBatch([{ rowId: 'SKU-1', values: { title: 'T' } }]);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/ebay-drafts/batch-stage');
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ items: [{ sku: 'SKU-1', inventoryFields: { product: { title: 'T' } } }] });
    await createTransport('catalog', { marketplace: 'wix', storeId: 'site1', currencyOf: () => 'USD', fetchImpl }).stageBatch([{ rowId: 'p1', values: { price: 5 } }]);
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/catalog-drafts');
    expect(JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ marketplace: 'wix', storeId: 'site1', items: [{ externalId: 'p1', fields: { price: 5 } }] });
  });

  it('falls back to one stage call per item when the batch route is missing (404), and remembers it', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const single = vi.fn(async (i: BulkStageItem) => ({ id: `d-${i.rowId}`, status: 'draft' }));
    const tr = createBatchTransport({ kind: 'etsy', url: '/x', body: (items) => ({ items }), single, fetchImpl });
    expect(await tr.stageBatch([{ rowId: '1', values: { price: 1 } }, { rowId: '2', values: { price: 2 } }])).toEqual([
      { rowId: '1', ok: true, draftId: 'd-1', status: 'draft' },
      { rowId: '2', ok: true, draftId: 'd-2', status: 'draft' },
    ]);
    await tr.stageBatch([{ rowId: '3', values: { price: 3 } }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(single).toHaveBeenCalledTimes(3);
  });

  it('a whole-request failure throws BulkStageError with the status (402 → usage limit)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Payment Required' }, 402));
    const tr = createBatchTransport({ kind: 'etsy', url: '/x', body: (items) => ({ items }), single: vi.fn(), fetchImpl });
    await expect(tr.stageBatch([{ rowId: '1', values: {} }])).rejects.toMatchObject({ status: 402 });
  });
});

describe('BulkStagingQueue: review fixes', () => {
  it('a field reverted while its request is in flight does not come back as a staged edit', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue([
      { rowId: '1', field: 'price', value: 12 },
      { rowId: '1', field: 'title', value: 'Kept' },
    ]);
    q.flushNow();
    expect(m.calls).toHaveLength(1);
    q.drop('1', ['price']);
    const idle = q.whenIdle();
    m.okAll(m.calls[0]);
    await idle;
    expect(q.getSnapshot().staged.get('1')).toEqual({ title: 'Kept' });
  });

  it('a whole row reverted while in flight leaves nothing staged and no draft entry', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue([{ rowId: '1', field: 'price', value: 12 }]);
    q.flushNow();
    q.drop('1');
    const idle = q.whenIdle();
    m.okAll(m.calls[0]);
    await idle;
    expect(q.getSnapshot().staged.has('1')).toBe(false);
    expect(q.getSnapshot().drafts.has('1')).toBe(false);
    expect(q.getSnapshot().failed.has('1')).toBe(false);
  });

  it('a new edit after the in-flight revert is still staged', async () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.enqueue([{ rowId: '1', field: 'price', value: 12 }]);
    q.flushNow();
    q.drop('1', ['price']);
    q.enqueue([{ rowId: '1', field: 'price', value: 15 }]);
    m.okAll(m.calls[0]);
    await flush();
    q.flushNow();
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1].items).toEqual([{ rowId: '1', values: { price: 15 } }]);
    m.okAll(m.calls[1]);
    await flush();
    expect(q.getSnapshot().staged.get('1')).toEqual({ price: 15 });
  });

  it('dispose then revive (React StrictMode remount) keeps accepting edits', () => {
    const m = manualTransport();
    const q = new BulkStagingQueue({ transport: m.transport });
    q.dispose();
    q.revive();
    q.enqueue([{ rowId: '1', field: 'title', value: 'x' }]);
    vi.advanceTimersByTime(800);
    expect(m.calls).toHaveLength(1);
  });
});
