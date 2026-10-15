import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listHealthStores,
  refreshHealth,
  resetHealthColumnCache,
  type HealthDb,
} from '@/lib/listings/refreshHealth';

vi.mock('@/lib/prisma', () => ({ default: {} }));

const etsyRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: 'Baby blanket',
  description: '',
  tags: [],
  materials: [],
  priceAmount: 1000,
  priceDivisor: 100,
  imageCount: 2,
  hasVideo: false,
  shippingProfileId: null,
  processingMin: null,
  itemWeight: null,
  ...over,
});

function makeDb(opts: { columns?: boolean; pages?: unknown[][] } = {}) {
  const pages = [...(opts.pages ?? [])];
  const findMany = vi.fn(async () => pages.shift() ?? []);
  const queryRaw = vi.fn(async () =>
    opts.columns === false
      ? []
      : ['EtsyListing', 'EbayListing', 'TrendyolProduct', 'WixProduct', 'ShopifyProduct'].map((t) => ({ table_name: t, n: 4 })),
  );
  const executeRaw = vi.fn(async (q: { values?: unknown[] }) => (Array.isArray(q.values?.[0]) ? (q.values![0] as unknown[]).length : 0));
  const model = { findMany, groupBy: vi.fn() };
  const db = {
    etsyListing: model,
    ebayListing: model,
    trendyolProduct: model,
    wixProduct: model,
    shopifyProduct: model,
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
  } as unknown as HealthDb;
  return { db, findMany, queryRaw, executeRaw, model };
}

beforeEach(() => resetHealthColumnCache());

describe('refreshHealth', () => {
  it('is a no-op when the BR-1a columns are missing', async () => {
    const { db, findMany, executeRaw } = makeDb({ columns: false, pages: [[etsyRow('a')]] });
    const r = await refreshHealth('etsy', { storeId: '123' }, { db });
    expect(r.skipped).toBe('columns_missing');
    expect(findMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('scores and writes in pages with an id cursor', async () => {
    const { db, findMany, executeRaw } = makeDb({ pages: [[etsyRow('a'), etsyRow('b')], [etsyRow('c')]] });
    const r = await refreshHealth('etsy', { storeId: '123', ids: ['111', '222', 'not-a-number'] }, { db, batchSize: 2 });
    expect(r.error).toBeUndefined();
    expect(r.scored).toBe(3);
    expect(r.written).toBe(3);
    expect(r.bands.needs_work).toBe(3);
    expect(executeRaw).toHaveBeenCalledTimes(2);

    const firstWhere = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(firstWhere.etsyShopId).toBe('123');
    expect(firstWhere.etsyListingId).toEqual({ in: [BigInt(111), BigInt(222)] });
    const secondWhere = (findMany.mock.calls[1] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(secondWhere.id).toEqual({ gt: 'b' });

    const sql = executeRaw.mock.calls[0][0] as unknown as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('UPDATE "EtsyListing" AS t');
    expect(sql.values[0]).toEqual(['a', 'b']);
    // scores as text, fails as comma-joined tokens
    expect(typeof (sql.values[1] as string[])[0]).toBe('string');
    expect((sql.values[4] as string[])[0]).toContain('photos_count');
  });

  it('dry run scores without checking or writing columns', async () => {
    const { db, queryRaw, executeRaw } = makeDb({ columns: false, pages: [[etsyRow('a')]] });
    const r = await refreshHealth('etsy', { storeId: '123' }, { db, dryRun: true });
    expect(r.scored).toBe(1);
    expect(r.written).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('never throws: a DB error comes back as error', async () => {
    const { db, findMany } = makeDb();
    findMany.mockRejectedValueOnce(new Error('boom'));
    const r = await refreshHealth('ebay', { storeId: 'user1' }, { db });
    expect(r.error).toBe('boom');
  });

  it('accepts both call forms the sync routes use (never bad_scope)', async () => {
    const pos = makeDb({ pages: [[etsyRow('a')]] });
    const r1 = await refreshHealth('etsy', { storeId: '123', userId: 'u1' }, { db: pos.db });
    expect(r1.skipped).not.toBe('bad_scope');
    expect(r1.written).toBe(1);

    const obj = makeDb({ pages: [[etsyRow('a')]] });
    const r2 = await refreshHealth({ marketplace: 'etsy', userId: 'u1', storeId: '123' }, { db: obj.db });
    expect(r2.skipped).not.toBe('bad_scope');
    expect(r2.marketplace).toBe('etsy');
    expect(r2.storeId).toBe('123');
    expect(r2.written).toBe(1);
    const where = (obj.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where.etsyShopId).toBe('123');
  });

  it('rejects a scope without storeId and short-circuits empty ids', async () => {
    const { db, findMany } = makeDb();
    expect((await refreshHealth('wix', { storeId: '' }, { db })).skipped).toBe('bad_scope');
    const r = await refreshHealth('wix', { storeId: 'site1', ids: [] }, { db });
    expect(r.scored).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes trendyol by supplier and user', async () => {
    const { db, findMany } = makeDb({ pages: [[]] });
    await refreshHealth('trendyol', { storeId: 'sup1', userId: 'u1', ids: ['bc1'] }, { db });
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ supplierId: 'sup1', userId: 'u1', barcode: { in: ['bc1'] } });
  });
});

describe('listHealthStores', () => {
  it('maps grouped rows to scopes', async () => {
    const { db, model } = makeDb();
    model.groupBy.mockResolvedValueOnce([{ userId: 'u1', supplierId: 's1' }]);
    expect(await listHealthStores('trendyol', db)).toEqual([{ storeId: 's1', userId: 'u1' }]);
  });
});
