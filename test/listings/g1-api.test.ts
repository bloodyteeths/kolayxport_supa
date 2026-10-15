import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeDb } from './g1-fakeDb';

const h = vi.hoisted(() => ({ db: {} as Record<string, unknown>, user: { id: 'u1' } as { id: string } | null }));

vi.mock('@/lib/prisma', () => ({ default: new Proxy({}, { get: (_t, k: string) => h.db[k] }) }));
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => h.user }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(async () => undefined), info: vi.fn(), warn: vi.fn() } }));

import listHandler from '../../pages/api/listings/index';
import exportHandler from '../../pages/api/listings/export';
import duplicatesHandler from '../../pages/api/listings/duplicates';
import { setSchemaFieldOverrideForTests } from '@/lib/listings/query';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.send = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
const call = async (handler: any, query: Record<string, string>, method = 'GET') => {
  const r = res();
  await handler({ method, query, headers: {} } as any, r);
  return r;
};

function listing(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `c${n}`, etsyShopId: 'shop1', etsyListingId: BigInt(1000 + n), title: `Box ${n}`, tags: ['gift', 'box'], description: `Desc ${n}`,
    priceAmount: 1000 * n, priceDivisor: 100, priceCurrencyCode: 'USD', quantity: n, state: 'active', url: null, shopSectionId: null,
    views: 0, numFavorers: 0, isPersonalizable: false, thumbnailUrl75x75: null, thumbnailUrl170x135: null, thumbnailUrl570xN: null,
    imageCount: 5, hasVideo: false, hasVariations: false, etsyCreatedTimestamp: 1, etsyUpdatedTimestamp: n, ...over,
  };
}

beforeEach(() => {
  setSchemaFieldOverrideForTests((model, field) => model !== 'CatalogDraft' && !['healthScore', 'skus', 'scheduledSendAt'].includes(field));
  h.user = { id: 'u1' };
  h.db = makeDb({
    etsyShop: [{ userId: 'u1', shopId: 'shop1', shopName: 'Belle Couture Gifts', isActive: true, isDefault: true, createdAt: new Date(0), lastListingSyncAt: null }],
    etsyListing: [listing(1), listing(2, { title: '=cmd|calc', state: 'inactive' }), listing(3, { title: 'Box 1' })],
    etsyListingDraft: [],
  });
});
afterEach(() => setSchemaFieldOverrideForTests(null));

describe('GET /api/listings', () => {
  it('401 without a session, 405 on POST, 400 on a bad marketplace', async () => {
    h.user = null;
    expect((await call(listHandler, { marketplace: 'etsy' })).body).toEqual({ error: 'unauthorized' });
    h.user = { id: 'u1' };
    const post = await call(listHandler, { marketplace: 'etsy' }, 'POST');
    expect(post.statusCode).toBe(405);
    const bad = await call(listHandler, { marketplace: 'amazon' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error).toBe('bad_request');
  });
  it('404 not_connected / store_not_found', async () => {
    h.user = { id: 'nobody' };
    expect((await call(listHandler, { marketplace: 'etsy' })).body).toEqual({ error: 'not_connected' });
    h.user = { id: 'u1' };
    const r = await call(listHandler, { marketplace: 'etsy', store: 'nope' });
    expect([r.statusCode, r.body]).toEqual([404, { error: 'store_not_found' }]);
  });
  it('200 with the ListingsResponse shape, no-store', async () => {
    const r = await call(listHandler, { marketplace: 'etsy', size: '50', ids: '1001,1003' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['Cache-Control']).toBe('private, no-store');
    expect(Object.keys(r.body).sort()).toEqual(['counts', 'rows', 'store', 'stores', 'total']);
    expect(r.body.rows.map((x: any) => x.id)).toEqual(['1003', '1001']);
    expect(r.body.counts.all).toBe(3);
  });
  it('500 carries an errorId and no raw message', async () => {
    h.db = { ...h.db, etsyListing: { findMany: async () => { throw new Error('db exploded: secret'); }, count: async () => 0, findFirst: async () => null } };
    const r = await call(listHandler, { marketplace: 'etsy' });
    expect(r.statusCode).toBe(500);
    expect(r.body.error).toBe('server_error');
    expect(r.body.errorId).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
});

describe('GET /api/listings/export', () => {
  it('streams every filtered row as CSV with a dated filename', async () => {
    const r = await call(exportHandler, { marketplace: 'etsy', status: 'active', sort: 'title.asc', includeDescription: '1' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['Content-Disposition']).toMatch(/filename="etsy-listings-belle-couture-gifts-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(r.headers['X-Export-Rows']).toBe('2');
    const lines = String(r.body).replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('id,title,price,currency,quantity,status,sku,tags,health,url,section,views,favorites,materials,description');
    expect(lines[1]).toBe('1001,Box 1,10,USD,1,active,,"gift, box",,https://www.etsy.com/listing/1001,,0,0,,Desc 1');
    expect(lines).toHaveLength(3);
  });
  it('guards formula titles and honours ids', async () => {
    const r = await call(exportHandler, { marketplace: 'etsy', ids: '1002' });
    const lines = String(r.body).replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith("1002,'=cmd|calc,")).toBe(true);
  });
});

describe('GET /api/listings/duplicates', () => {
  it('returns groups with rows', async () => {
    const r = await call(duplicatesHandler, { marketplace: 'etsy' });
    expect(r.statusCode).toBe(200);
    expect(r.body.groups).toHaveLength(1);
    expect(r.body.groups[0].reason).toEqual({ kind: 'same_title' });
    expect(r.body.groups[0].rows.map((x: any) => x.id).sort()).toEqual(['1001', '1003']);
  });
});
