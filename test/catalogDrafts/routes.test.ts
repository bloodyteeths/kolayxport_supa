// M6b-A: GET /api/catalog-drafts/:id/diff, POST /api/catalog-drafts/:id/resolve, POST create through index.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authUser = vi.fn();
const getDiff = vi.fn();
const resolve = vi.fn();
const stage = vi.fn();

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/stock/settings', () => ({ getStockSettings: vi.fn(), isStockSyncActive: () => false, channelEnabled: () => false }));
vi.mock('@/lib/catalogDrafts/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/catalogDrafts/service')>('@/lib/catalogDrafts/service');
  return {
    ...actual,
    getCatalogDraftDiff: (...a: any[]) => getDiff(...a),
    resolveCatalogDraft: (...a: any[]) => resolve(...a),
    stageCatalogDraft: (...a: any[]) => stage(...a),
  };
});

import diffHandler from '@/pages/api/catalog-drafts/[id]/diff';
import resolveHandler, { parseKeep } from '@/pages/api/catalog-drafts/[id]/resolve';
import indexHandler from '@/pages/api/catalog-drafts/index';
import { CatalogDraftError } from '@/lib/catalogDrafts/service';

function call(handler: (req: any, res: any) => any, opts: { method?: string; query?: any; body?: unknown }) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return Promise.resolve(handler({ method: opts.method ?? 'GET', headers: {}, query: opts.query ?? {}, body: opts.body } as any, res)).then(() => res);
}

const T = new Date('2026-10-15T10:00:00Z');
const record = (over: any = {}) => ({
  id: 'd1', userId: 'u1', marketplace: 'shopify', storeId: 's', externalId: 'p1', status: 'draft', baseUpdatedAt: null, baseSnapshot: {},
  fieldPatch: {}, queuedActions: [], batchRequestId: null, lastSyncError: null, scheduledSendAt: null, createdAt: T, updatedAt: T, syncedAt: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  authUser.mockResolvedValue({ id: 'u1' });
});

describe('diff route', () => {
  it('returns the diff with entity-decoded titles and never caches', async () => {
    getDiff.mockResolvedValue({
      remoteUpdatedAt: T.toISOString(),
      fields: [{ key: 'title', base: 'Mom&#39;s', remote: 'Mom&#39;s gift', draft: 'Mine', changedRemotely: true, inDraft: true }],
      queuedActions: [], hasQueuedDelete: false,
    });
    const res = await call(diffHandler, { query: { id: 'd1' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.body.fields[0]).toMatchObject({ base: "Mom's", remote: "Mom's gift" });
    expect(getDiff).toHaveBeenCalledWith('d1', 'u1');
  });

  it('maps service errors to stable codes and keys; 401 / 405', async () => {
    getDiff.mockRejectedValue(new CatalogDraftError('CREATE_DRAFT'));
    const res = await call(diffHandler, { query: { id: 'd1' } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'CREATE_DRAFT', key: 'listings.draftError.createDraft' });
    expect((await call(diffHandler, { method: 'POST', query: { id: 'd1' } })).statusCode).toBe(405);
    authUser.mockResolvedValue(null);
    expect((await call(diffHandler, { query: { id: 'd1' } })).statusCode).toBe(401);
  });
});

describe('resolve route', () => {
  it('validates keep and returns the rebased draft as a DTO', async () => {
    expect(parseKeep({ keep: ['title', 'title', 'seo'] })).toEqual(['title', 'seo']);
    expect(parseKeep({ keep: ['bad key'] })).toBeNull();
    expect(parseKeep({})).toBeNull();
    resolve.mockResolvedValue(record({ fieldPatch: { title: 'Mine' } }));
    const res = await call(resolveHandler, { method: 'POST', query: { id: 'd1' }, body: { keep: ['title'] } });
    expect(res.statusCode).toBe(200);
    expect(resolve).toHaveBeenCalledWith('d1', 'u1', ['title']);
    expect(res.body.draft).toMatchObject({ id: 'd1', fieldPatch: { title: 'Mine' }, isCreate: false, queuedDelete: false, createdAt: T.toISOString() });
    expect(res.body.draft).not.toHaveProperty('userId');
    const bad = await call(resolveHandler, { method: 'POST', query: { id: 'd1' }, body: { keep: 'title' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.code).toBe('INVALID_KEEP');
  });
});

describe('index route: create', () => {
  it('passes the create action and payload through; the response carries the new:<id>', async () => {
    stage.mockResolvedValue(record({ externalId: 'new:cabc', queuedActions: [{ type: 'create', queuedAt: T.toISOString(), payload: { brandId: 1 } }] }));
    const res = await call(indexHandler, {
      method: 'POST',
      body: { marketplace: 'trendyol', externalId: 'new', queuedActions: [{ type: 'create', payload: { brandId: 1 } }], fields: { salePrice: 10 } },
    });
    expect(res.statusCode).toBe(200);
    expect(stage.mock.calls[0][0]).toMatchObject({ userId: 'u1', marketplace: 'trendyol', externalId: 'new', queuedActions: [{ type: 'create', payload: { brandId: 1 } }] });
    expect(res.body.draft).toMatchObject({ externalId: 'new:cabc', isCreate: true });
  });

  it('bulk items keep their v1 issue shape (no duplicated params.field)', async () => {
    stage.mockResolvedValue(record());
    const res = await call(indexHandler, { method: 'POST', body: { marketplace: 'shopify', items: [{ externalId: 'p1', fields: { title: 'ok', price: 0, vendor: 'x'.repeat(300) } }] } });
    expect(res.body.results[0].rejected).toEqual([
      { field: 'price', key: 'listings.validate.priceInvalid' },
      { field: 'vendor', key: 'listings.draftError.textTooLong', params: { max: 255 } },
    ]);
  });
});
