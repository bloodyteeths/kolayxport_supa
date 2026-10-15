import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  getDraftDiff: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
  resolveDraft: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
  listSyncedDrafts: undefined as undefined | ((...a: unknown[]) => Promise<unknown[]>),
  ownedShops: ['shop1'],
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: async () => h.user }));
vi.mock('@/lib/etsy/draftService', async () => {
  const { EtsyDraftError } = await import('@/lib/etsy/draftErrors');
  return {
    toSerializable: (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))),
    assertShopOwnership: async (_u: string, shopId: string) => {
      if (!h.ownedShops.includes(shopId)) throw new EtsyDraftError('SHOP_NOT_FOUND', 'nope', { status: 404, key: 'draftSync.shopNotFound' });
    },
    get getDraftDiff() { return h.getDraftDiff; },
    get resolveDraft() { return h.resolveDraft; },
    get listSyncedDrafts() { return h.listSyncedDrafts; },
  };
});

import diffHandler, { shapeDraftDiff } from '../../pages/api/etsy-drafts/[id]/diff';
import resolveHandler, { parseKeep } from '../../pages/api/etsy-drafts/[id]/resolve';
import historyHandler, { parseLimit, shapeHistory } from '../../pages/api/etsy-drafts/history';
import { EtsyDraftError } from '@/lib/etsy/draftErrors';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
const call = async (handler: any, { method = 'GET', query = {}, body }: { method?: string; query?: Record<string, string>; body?: unknown }) => {
  const r = res();
  await handler({ method, query, body, headers: {} } as any, r);
  return r;
};

beforeEach(() => {
  h.user = { id: 'u1' };
  h.getDraftDiff = undefined;
  h.resolveDraft = undefined;
  h.listSyncedDrafts = undefined;
});

describe('GET /api/etsy-drafts/[id]/diff', () => {
  it('405 / 401 / 400 guards', async () => {
    expect((await call(diffHandler, { method: 'POST', query: { id: 'd1' } })).statusCode).toBe(405);
    h.user = null;
    expect((await call(diffHandler, { query: { id: 'd1' } })).statusCode).toBe(401);
    h.user = { id: 'u1' };
    expect((await call(diffHandler, { query: {} })).statusCode).toBe(400);
  });
  it('501 NOT_AVAILABLE until BR-3 ships', async () => {
    const r = await call(diffHandler, { query: { id: 'd1' } });
    expect(r.statusCode).toBe(501);
    expect(r.body).toMatchObject({ code: 'NOT_AVAILABLE', key: 'draftSync.reviewUnavailable' });
  });
  it('shapes, decodes entities, sorts and puts a queued delete first', async () => {
    const spy = vi.fn(async () => ({
      remoteUpdatedAt: 1760000000,
      fields: [
        { key: 'quantity', base: 30, remote: 38, draft: undefined, changedRemotely: true, inDraft: false },
        { key: 'tags', base: ['mom&#39;s'], remote: ['mom&#39;s'], draft: ['mom\'s gift'], changedRemotely: false, inDraft: true },
        { key: 'title', base: 'One&#39;s box', remote: 'One&amp;Only', draft: 'One\'s box!', changedRemotely: true, inDraft: true },
        { key: 'price', base: 10, remote: 10, draft: 10, changedRemotely: false, inDraft: false },
      ],
      queuedActions: [{ type: 'renew' }, { type: 'delete' }, null],
    }));
    h.getDraftDiff = spy;
    const r = await call(diffHandler, { query: { id: 'd1' } });
    expect(spy).toHaveBeenCalledWith('d1', 'u1');
    expect(r.statusCode).toBe(200);
    expect(r.headers['Cache-Control']).toBe('private, no-store');
    expect(r.body.remoteUpdatedAt).toBe(new Date(1760000000 * 1000).toISOString());
    expect(r.body.fields.map((f: any) => f.key)).toEqual(['title', 'tags', 'quantity']);
    expect(r.body.fields[0]).toMatchObject({ base: "One's box", remote: 'One&Only', draft: "One's box!" });
    expect(r.body.fields[1].base).toEqual(["mom's"]);
    expect(r.body.queuedActions).toEqual([{ type: 'delete' }, { type: 'renew' }]);
    expect(r.body.hasQueuedDelete).toBe(true);
  });
  it('maps typed draft errors', async () => {
    h.getDraftDiff = async () => { throw new EtsyDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.notFound' }); };
    const r = await call(diffHandler, { query: { id: 'zz' } });
    expect([r.statusCode, r.body.code]).toEqual([404, 'DRAFT_NOT_FOUND']);
  });
  it('shapeDraftDiff tolerates garbage', () => {
    expect(shapeDraftDiff({ remoteUpdatedAt: 'nope', fields: null as any, queuedActions: 'x' })).toEqual({
      remoteUpdatedAt: null, fields: [], queuedActions: [], hasQueuedDelete: false,
    });
  });
});

describe('POST /api/etsy-drafts/[id]/resolve', () => {
  it('validates keep', () => {
    expect(parseKeep({ keep: [] })).toEqual([]);
    expect(parseKeep({ keep: ['title', 'title', 'price'] })).toEqual(['title', 'price']);
    expect(parseKeep({})).toBeNull();
    expect(parseKeep(null)).toBeNull();
    expect(parseKeep({ keep: ['title', 3] })).toBeNull();
    expect(parseKeep({ keep: ['__proto__ x'] })).toBeNull();
    expect(parseKeep({ keep: Array.from({ length: 101 }, (_, i) => `k${i}`) })).toBeNull();
  });
  it('guards and 400 before touching the service', async () => {
    expect((await call(resolveHandler, { method: 'GET', query: { id: 'd1' } })).statusCode).toBe(405);
    const spy = vi.fn();
    h.resolveDraft = spy;
    const bad = await call(resolveHandler, { method: 'POST', query: { id: 'd1' }, body: { keep: 'title' } });
    expect([bad.statusCode, bad.body.code]).toEqual([400, 'INVALID_KEEP']);
    expect(spy).not.toHaveBeenCalled();
  });
  it('501 until BR-3 ships', async () => {
    const r = await call(resolveHandler, { method: 'POST', query: { id: 'd1' }, body: { keep: [] } });
    expect(r.statusCode).toBe(501);
  });
  it('calls resolveDraft and returns the serialized draft', async () => {
    const spy = vi.fn(async () => ({ id: 'd1', status: 'draft', etsyListingId: BigInt(42) }));
    h.resolveDraft = spy;
    const r = await call(resolveHandler, { method: 'POST', query: { id: 'd1' }, body: { keep: ['title'] } });
    expect(spy).toHaveBeenCalledWith('d1', 'u1', ['title']);
    expect(r.statusCode).toBe(200);
    expect(r.body.draft).toEqual({ id: 'd1', status: 'draft', etsyListingId: '42' });
  });
});

describe('GET /api/etsy-drafts/history', () => {
  it('parseLimit', () => {
    expect([parseLimit(undefined), parseLimit('0'), parseLimit('5'), parseLimit('99'), parseLimit('x')]).toEqual([3, 3, 5, 10, 3]);
  });
  it('400 on missing / bad params, 404 on a foreign shop', async () => {
    expect((await call(historyHandler, { query: { shop_id: 'shop1' } })).statusCode).toBe(400);
    expect((await call(historyHandler, { query: { shop_id: 'shop1', listing_id: '-5' } })).statusCode).toBe(400);
    const r = await call(historyHandler, { query: { shop_id: 'other', listing_id: '1' } });
    expect([r.statusCode, r.body.code]).toEqual([404, 'SHOP_NOT_FOUND']);
  });
  it('available:false until BR-3 ships', async () => {
    const r = await call(historyHandler, { query: { shop_id: 'shop1', listing_id: '123' } });
    expect([r.statusCode, r.body]).toEqual([200, { items: [], available: false }]);
  });
  it('passes bigint listing id + limit and shapes rows', async () => {
    const spy = vi.fn(async () => [
      { id: 'a', syncedAt: new Date('2026-10-01T10:00:00Z'), changedKeys: ['title', 1] },
      { id: 'b', syncedAt: '2026-10-03T10:00:00Z', changedKeys: null },
      { id: 'c', syncedAt: null },
    ]);
    h.listSyncedDrafts = spy;
    const r = await call(historyHandler, { query: { shop_id: 'shop1', listing_id: '123', limit: '2' } });
    expect(spy).toHaveBeenCalledWith('shop1', BigInt(123), 2);
    expect(r.body.available).toBe(true);
    expect(r.body.items).toEqual([
      { id: 'b', syncedAt: '2026-10-03T10:00:00.000Z', changedKeys: [] },
      { id: 'a', syncedAt: '2026-10-01T10:00:00.000Z', changedKeys: ['title'] },
    ]);
    expect(shapeHistory([{ id: 'x', syncedAt: '2026-01-01' }, { id: 'y', syncedAt: '2026-01-02' }], 1).map((i) => i.id)).toEqual(['y']);
  });
});
