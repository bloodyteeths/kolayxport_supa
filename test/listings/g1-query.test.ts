import { describe, it, expect, afterEach } from 'vitest';
import {
  collectExportRows,
  findDuplicates,
  groupDuplicates,
  hasQueuedDelete,
  listListings,
  ListingsQueryError,
  pickEffectiveDrafts,
  planListingsQuery,
  sendErrorKey,
  CATALOG_DESTRUCTIVE_ACTIONS,
  setSchemaFieldOverrideForTests,
} from '@/lib/listings/query';
import { parseListingsQuery, type ListingsQuery } from '@/lib/listings/types';
import { etsyAdapter } from '@/lib/listings/adapters/etsy';
import { ebayAdapter } from '@/lib/listings/adapters/ebay';
import { trendyolAdapter } from '@/lib/listings/adapters/trendyol';
import { makeDb } from './g1-fakeDb';

const NOW = new Date('2026-10-15T12:00:00Z');
const HOUR = 3600_000;

/** Pre-BR-1a schema: no health columns, no skus, no scheduledSendAt, no CatalogDraft. */
const PRE_MIGRATION = (model: string, field: string) => {
  if (model === 'CatalogDraft') return false;
  return !['healthScore', 'skus', 'scheduledSendAt'].includes(field);
};
const POST_MIGRATION = () => true;

afterEach(() => setSchemaFieldOverrideForTests(null));

function q(raw: Record<string, string>): ListingsQuery {
  const p = parseListingsQuery(raw);
  if (!p.ok) throw new Error(p.message);
  return p.query;
}

function etsyRow(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `c${n}`,
    etsyShopId: 'shop1',
    etsyListingId: BigInt(1000 + n),
    title: `Listing ${n}`,
    tags: [],
    priceAmount: 1000 * n,
    priceDivisor: 100,
    priceCurrencyCode: 'USD',
    quantity: n,
    state: 'active',
    url: null,
    shopSectionId: null,
    views: n,
    numFavorers: 0,
    isPersonalizable: false,
    thumbnailUrl75x75: null,
    thumbnailUrl170x135: null,
    thumbnailUrl570xN: null,
    imageCount: n,
    hasVideo: false,
    hasVariations: false,
    etsyCreatedTimestamp: 1_700_000_000 + n,
    etsyUpdatedTimestamp: 1_700_000_000 + n * 10,
    healthScore: null,
    healthChecksUsed: null,
    healthChecksTotal: null,
    healthFails: [],
    skus: [],
    ...over,
  };
}

function draft(id: string, listing: number, status: string, over: Record<string, unknown> = {}) {
  return {
    id,
    userId: 'u1',
    etsyShopId: 'shop1',
    etsyListingId: BigInt(1000 + listing),
    status,
    fieldPatch: {},
    queuedActions: [],
    lastSyncError: null,
    updatedAt: new Date(NOW.getTime() - HOUR),
    syncedAt: null,
    scheduledSendAt: null,
    ...over,
  };
}

function etsyDb() {
  return makeDb({
    etsyShop: [
      { userId: 'u1', shopId: 'shop1', shopName: 'Belle &amp; Co', isActive: true, isDefault: true, createdAt: new Date(1), lastListingSyncAt: new Date('2026-10-15T11:50:00Z') },
      { userId: 'u1', shopId: 'shop2', shopName: null, isActive: true, isDefault: false, createdAt: new Date(2), lastListingSyncAt: null },
      { userId: 'u2', shopId: 'other', shopName: 'X', isActive: true, isDefault: true, createdAt: new Date(0), lastListingSyncAt: null },
    ],
    etsyListing: [
      etsyRow(1, { state: 'sold_out', quantity: 0, healthScore: 30, healthFails: ['photos_count'] }),
      etsyRow(2, { healthScore: 80, title: 'Wooden Keepsake Box &amp; Lid', skus: ['BB-PINK'] }),
      etsyRow(3, { state: 'draft', healthScore: 55, hasVariations: true }),
      etsyRow(4, { state: 'expired' }),
      etsyRow(5, { state: 'edit', hasVideo: true }),
      etsyRow(6),
      { ...etsyRow(7), etsyShopId: 'shop2' },
    ],
    etsyListingDraft: [
      draft('d1', 1, 'draft', { fieldPatch: { price: 12.5, quantity: 4 } }),
      draft('d2', 2, 'failed', { lastSyncError: 'Etsy API 401 Unauthorized: invalid token' }),
      draft('d3', 3, 'conflict', { lastSyncError: 'changed on Etsy' }),
      draft('d4', 4, 'draft', { queuedActions: [{ type: 'delete' }] }),
      draft('d5', 5, 'synced', { syncedAt: new Date(NOW.getTime() - 2 * HOUR), updatedAt: new Date(NOW.getTime() - 2 * HOUR) }),
      draft('d6', 6, 'synced', { syncedAt: new Date(NOW.getTime() - 72 * HOUR) }),
      draft('d7', 1, 'synced', { syncedAt: new Date(NOW.getTime() - HOUR), updatedAt: new Date(NOW.getTime() - HOUR) }),
      draft('d8', 6, 'cancelled'),
      { ...draft('dX', 2, 'draft'), userId: 'u2' },
    ],
  });
}

describe('listListings (etsy, pre-migration schema)', () => {
  it('pages, counts every status/sync bucket, joins the open draft over a synced one', async () => {
    setSchemaFieldOverrideForTests(PRE_MIGRATION);
    const res = await listListings(etsyDb(), etsyAdapter, 'u1', q({ marketplace: 'etsy' }), { now: NOW });
    expect(res.store).toEqual({ id: 'shop1', name: 'Belle & Co', currency: 'USD', lastPulledAt: '2026-10-15T11:50:00.000Z' });
    expect(res.stores).toEqual([{ id: 'shop1', name: 'Belle & Co' }, { id: 'shop2', name: 'shop2' }]);
    expect(res.total).toBe(6);
    expect(res.rows.map((r) => r.id)).toEqual(['1006', '1005', '1004', '1003', '1002', '1001']); // updated desc
    expect(res.counts).toEqual({
      all: 6,
      status: { active: 2, draft: 1, inactive: 1, expired: 1, sold_out: 1 },
      sync: { pending: 2, syncing: 0, failed: 1, conflict: 1, queuedDeletes: 1 },
      needsWork: 0,
      unscored: 6,
    });
    const byId = Object.fromEntries(res.rows.map((r) => [r.id, r]));
    expect(byId['1001'].sync).toMatchObject({ draftId: 'd1', status: 'pending', draft: { price: 12.5, qty: 4 }, queuedDelete: false, scheduledSendAt: null });
    expect(byId['1002'].sync).toMatchObject({ status: 'sync_failed', errorKey: 'listings.sendError.reconnect' });
    expect(byId['1002'].title).toBe('Wooden Keepsake Box & Lid');
    expect(byId['1002'].metaLine).toEqual(['ID 1002']); // skus column not deployed → not read
    expect(byId['1003'].sync).toMatchObject({ status: 'conflict', errorKey: 'listings.sendError.conflict' });
    expect(byId['1004'].sync).toMatchObject({ status: 'pending', queuedDelete: true });
    expect(byId['1005'].sync).toMatchObject({ status: 'synced', draftId: 'd5' });
    expect(byId['1006'].sync).toBeNull(); // synced 3 days ago + cancelled
    expect(byId['1001'].health.score).toBeNull();
  });

  it('sync, status, search and page filters', async () => {
    setSchemaFieldOverrideForTests(PRE_MIGRATION);
    const db = etsyDb();
    const run = (raw: Record<string, string>) => listListings(db, etsyAdapter, 'u1', q({ marketplace: 'etsy', ...raw }), { now: NOW });
    expect((await run({ sync: 'sync_failed,conflict' })).rows.map((r) => r.id).sort()).toEqual(['1002', '1003']);
    expect((await run({ sync: 'synced' })).rows.map((r) => r.id)).toEqual(['1005']);
    expect((await run({ status: 'inactive,draft,expired' })).total).toBe(3);
    expect((await run({ q: 'keepsake' })).rows.map((r) => r.id)).toEqual(['1002']);
    expect((await run({ q: '1004' })).rows.map((r) => r.id)).toEqual(['1004']);
    expect((await run({ hasVideo: 'true' })).rows.map((r) => r.id)).toEqual(['1005']);
    expect((await run({ priceMin: '30', priceMax: '45' })).rows.map((r) => r.id)).toEqual(['1004', '1003']);
    expect((await run({ sort: 'price.asc' })).rows[0].id).toBe('1001');
    // health bands match nothing until healthScore exists; check filters use column proxies
    expect((await run({ health: 'lt50' })).total).toBe(0);
    expect((await run({ health: 'missing_photos' })).rows.map((r) => r.id).sort()).toEqual(['1001', '1002', '1003', '1004']);
    expect((await run({ health: 'no_video' })).total).toBe(5);
    // health sort falls back to updated desc
    expect((await run({ sort: 'health.asc' })).rows[0].id).toBe('1006');
  });

  it('explicit ids, other store, unknown store, not connected', async () => {
    setSchemaFieldOverrideForTests(PRE_MIGRATION);
    const db = etsyDb();
    const ids = await listListings(db, etsyAdapter, 'u1', q({ marketplace: 'etsy' }), { now: NOW, ids: ['1002', 'junk', '1003'] });
    expect(ids.rows.map((r) => r.id).sort()).toEqual(['1002', '1003']);
    const shop2 = await listListings(db, etsyAdapter, 'u1', q({ marketplace: 'etsy', store: 'shop2' }), { now: NOW });
    expect(shop2.rows.map((r) => r.id)).toEqual(['1007']);
    expect(shop2.store.lastPulledAt).toBeNull();
    await expect(listListings(db, etsyAdapter, 'u1', q({ marketplace: 'etsy', store: 'other' }), { now: NOW })).rejects.toMatchObject({ code: 'store_not_found', status: 404 });
    await expect(listListings(db, etsyAdapter, 'u9', q({ marketplace: 'etsy' }), { now: NOW })).rejects.toBeInstanceOf(ListingsQueryError);
  });
});

describe('listListings (etsy, post-migration schema)', () => {
  it('reads health and skus, sorts health with nulls last, needs-work counts scored rows only', async () => {
    setSchemaFieldOverrideForTests(POST_MIGRATION);
    const db = etsyDb();
    const run = (raw: Record<string, string>) => listListings(db, etsyAdapter, 'u1', q({ marketplace: 'etsy', ...raw }), { now: NOW });
    const all = await run({});
    expect(all.counts.needsWork).toBe(1);
    expect(all.counts.unscored).toBe(3);
    expect(all.rows.find((r) => r.id === '1002')!.metaLine).toEqual(['ID 1002', 'BB-PINK']);
    expect((await run({ sort: 'health.desc' })).rows.map((r) => r.id).slice(0, 3)).toEqual(['1002', '1003', '1001']);
    expect((await run({ sort: 'health.asc' })).rows.map((r) => r.id).slice(-1)[0]).not.toMatch(/100[123]/);
    expect((await run({ health: 'lt50' })).rows.map((r) => r.id)).toEqual(['1001']);
    expect((await run({ health: '50-74' })).rows.map((r) => r.id)).toEqual(['1003']);
    expect((await run({ health: 'missing_photos' })).rows.map((r) => r.id)).toEqual(['1001']);
    expect((await run({ q: 'BB-PINK' })).rows.map((r) => r.id)).toEqual(['1002']);
    expect(all.rows.find((r) => r.id === '1001')!.sync!.scheduledSendAt).toBeNull();
  });
});

describe('eBay in-memory price path', () => {
  const db = () =>
    makeDb({
      credential: [{ userId: 'u1', ebayAccessToken: 'tok', ebayRefreshToken: null }],
      ebayListing: [
        { id: 'e1', userId: 'u1', sku: 'A', title: 'A', priceValue: '9.50', priceCurrency: 'USD', quantity: 1, status: 'PUBLISHED', imageCount: 1, ebayUpdatedAt: '2026-10-01T00:00:00Z', syncedAt: new Date('2026-10-14T00:00:00Z') },
        { id: 'e2', userId: 'u1', sku: 'B', title: 'B', priceValue: '100.00', priceCurrency: 'USD', quantity: 0, status: 'PUBLISHED', imageCount: 1, ebayUpdatedAt: '2026-10-03T00:00:00Z', syncedAt: new Date('2026-10-15T00:00:00Z') },
        { id: 'e3', userId: 'u1', sku: 'C', title: 'C', priceValue: '20', priceCurrency: 'USD', quantity: 2, status: 'ENDED', imageCount: 1, ebayUpdatedAt: null, syncedAt: new Date('2026-10-13T00:00:00Z') },
        { id: 'e4', userId: 'u2', sku: 'Z', title: 'Z', priceValue: '1', priceCurrency: 'USD', quantity: 2, status: 'ENDED', imageCount: 1, ebayUpdatedAt: null, syncedAt: new Date() },
      ],
      ebayListingDraft: [{ id: 'ed1', userId: 'u1', sku: 'C', status: 'draft', inventoryPatch: {}, offerPatch: { pricingSummary: { price: { value: '25' } } }, queuedActions: [], updatedAt: NOW, syncedAt: null }],
    });
  it('sorts numerically (string column), filters by price, pages after sorting', async () => {
    setSchemaFieldOverrideForTests(PRE_MIGRATION);
    const res = await listListings(db(), ebayAdapter, 'u1', q({ marketplace: 'ebay', sort: 'price.desc' }), { now: NOW });
    expect(res.rows.map((r) => r.id)).toEqual(['B', 'C', 'A']);
    expect(res.store).toMatchObject({ id: 'ebay', lastPulledAt: '2026-10-15T00:00:00.000Z' });
    expect(res.counts.status).toEqual({ active: 1, sold_out: 1, inactive: 1, draft: 0 });
    expect(res.rows[1].sync).toMatchObject({ status: 'pending', draft: { price: 25 }, changedFields: ['price'] });
    const ranged = await listListings(db(), ebayAdapter, 'u1', q({ marketplace: 'ebay', priceMin: '10', priceMax: '50' }), { now: NOW });
    expect(ranged.rows.map((r) => r.id)).toEqual(['C']);
    expect(ranged.total).toBe(1);
    const updated = await listListings(db(), ebayAdapter, 'u1', q({ marketplace: 'ebay', priceMin: '1' }), { now: NOW });
    expect(updated.rows.map((r) => r.id)).toEqual(['B', 'A', 'C']); // updated desc, null last
  });
});

describe('CatalogDraft not deployed', () => {
  it('trendyol lists rows with no sync join and zero sync counts', async () => {
    setSchemaFieldOverrideForTests(PRE_MIGRATION);
    const db = makeDb({
      credential: [{ userId: 'u1', trendyolSupplierId: '777' }],
      trendyolProduct: [
        { id: 't1', userId: 'u1', supplierId: '777', barcode: 'B1', title: 'T', salePrice: 10, currencyType: 'TRY', quantity: 1, approved: true, onSale: true, rejected: false, blacklisted: false, archived: false, imageCount: 1, syncedAt: NOW },
      ],
    });
    const res = await listListings(db, trendyolAdapter, 'u1', q({ marketplace: 'trendyol' }), { now: NOW });
    expect(res.rows[0]).toMatchObject({ id: 'B1', status: 'active', sync: null });
    expect(res.counts.sync).toEqual({ pending: 0, syncing: 0, failed: 0, conflict: 0, queuedDeletes: 0 });
    expect(res.store).toMatchObject({ id: '777', currency: 'TRY' });
    await expect(listListings(makeDb({ credential: [], trendyolProduct: [] }), trendyolAdapter, 'u1', q({ marketplace: 'trendyol' }))).rejects.toMatchObject({ code: 'not_connected' });
  });
});

describe('CatalogDraft deployed', () => {
  it('trendyol: a queued archive is a queued delete; stored i18n error keys pass through', async () => {
    setSchemaFieldOverrideForTests(POST_MIGRATION);
    const tp = (n: number) => ({ id: `t${n}`, userId: 'u1', supplierId: '777', barcode: `B${n}`, title: `T${n}`, salePrice: 10, currencyType: 'TRY', quantity: 1, approved: true, onSale: true, rejected: false, blacklisted: false, archived: false, imageCount: 1, syncedAt: NOW, healthScore: null, healthChecksUsed: null, healthChecksTotal: null, healthFails: [] });
    const cd = (id: string, ext: string, status: string, over: Record<string, unknown> = {}) => ({ id, userId: 'u1', marketplace: 'trendyol', storeId: '777', externalId: ext, status, fieldPatch: {}, queuedActions: [], lastSyncError: null, updatedAt: new Date(NOW.getTime() - HOUR), syncedAt: null, scheduledSendAt: null, ...over });
    const db = makeDb({
      credential: [{ userId: 'u1', trendyolSupplierId: '777' }],
      trendyolProduct: [tp(1), tp(2)],
      catalogDraft: [
        cd('c1', 'B1', 'draft', { queuedActions: [{ type: 'archive' }] }),
        cd('c2', 'B2', 'failed', { fieldPatch: { price: 5 }, lastSyncError: 'listings.validate.priceInvalid' }),
      ],
    });
    const res = await listListings(db, trendyolAdapter, 'u1', q({ marketplace: 'trendyol', sort: 'title.asc' }), { now: NOW });
    const byId = new Map(res.rows.map((r) => [r.id, r]));
    expect(byId.get('B1')!.sync).toMatchObject({ status: 'pending', queuedDelete: true });
    expect(byId.get('B2')!.sync).toMatchObject({ status: 'sync_failed', queuedDelete: false, errorKey: 'listings.validate.priceInvalid' });
    expect(res.counts.sync.queuedDeletes).toBe(1);
  });
});

describe('export rows', () => {
  it('returns every filtered row in sort order, with export fields', async () => {
    setSchemaFieldOverrideForTests(PRE_MIGRATION);
    const db = etsyDb();
    const query = q({ marketplace: 'etsy', status: 'active', sort: 'title.asc' });
    const plan = await planListingsQuery(db, etsyAdapter, 'u1', query, { now: NOW });
    const { items, truncated } = await collectExportRows(db, plan, query, { includeDescription: true });
    expect(truncated).toBe(false);
    expect(items.map((i) => i.row.id)).toEqual(['1006', '1002']);
    expect(items[0].fields).toEqual({ sku: null, tags: [], description: null, materials: [] });
  });
});

describe('duplicates', () => {
  it('groups same SKU, same normalised title and similar titles', () => {
    const { groups, truncated } = groupDuplicates([
      { id: '1', sku: 'BB-PINK', title: 'Pink Baby Blanket' },
      { id: '2', sku: 'bb-pink ', title: 'Something else' },
      { id: '3', sku: null, title: 'Wooden Keepsake Box, Personalized' },
      { id: '4', sku: null, title: 'wooden keepsake box | personalized' },
      { id: '5', sku: null, title: 'Personalized Wooden Keepsake Box Engraved Gift Mom Name Custom Lid Oak' },
      { id: '6', sku: null, title: 'Personalized Wooden Keepsake Box Engraved Gift Mom Name Custom Lid Walnut' },
      { id: '7', sku: null, title: 'Totally different necklace' },
    ]);
    expect(truncated).toBe(false);
    expect(groups[0]).toEqual({ reason: { kind: 'same_sku', sku: 'BB-PINK' }, ids: ['1', '2'] });
    expect(groups[1]).toEqual({ reason: { kind: 'same_title' }, ids: ['3', '4'] });
    expect(groups[2].reason).toEqual({ kind: 'similar_title', similarity: 83 });
    expect(groups[2].ids.sort()).toEqual(['5', '6']);
    expect(groups).toHaveLength(3);
  });
  it('caps the group count', () => {
    const items = Array.from({ length: 10 }, (_, i) => [
      { id: `${i}a`, sku: `S${i}`, title: `a${i}` },
      { id: `${i}b`, sku: `S${i}`, title: `b${i}` },
    ]).flat();
    const r = groupDuplicates(items, 4);
    expect(r.groups).toHaveLength(4);
    expect(r.truncated).toBe(true);
  });
  it('findDuplicates attaches ListingRows with their sync state', async () => {
    setSchemaFieldOverrideForTests(PRE_MIGRATION);
    const db = etsyDb();
    db.etsyListing.rows.push(etsyRow(8, { title: 'Wooden Keepsake Box & Lid' }));
    const plan = await planListingsQuery(db, etsyAdapter, 'u1', q({ marketplace: 'etsy' }), { now: NOW });
    const res = await findDuplicates(db, plan);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].reason).toEqual({ kind: 'same_title' });
    expect(res.groups[0].rows.map((r) => r.id).sort()).toEqual(['1002', '1008']);
    expect(res.groups[0].rows.find((r) => r.id === '1002')!.sync!.status).toBe('sync_failed');
  });
  it('scales to 5,000 titles', () => {
    const words = 'oak walnut box gift mom dad baby name custom engraved jewelry ring necklace lid wooden keepsake personalized wedding'.split(' ');
    const items = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), sku: null, title: Array.from({ length: 8 }, (_, k) => words[(i * 7 + k * 13 + (i % 11)) % words.length]).join(' ') + ` model${i}` }));
    const t0 = Date.now();
    groupDuplicates(items);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe('draft helpers', () => {
  it('hasQueuedDelete ignores completed deletes', () => {
    expect(hasQueuedDelete([{ type: 'delete' }])).toBe(true);
    expect(hasQueuedDelete([{ type: 'delete', completedAt: '2026-10-01' }])).toBe(false);
    expect(hasQueuedDelete([{ type: 'deactivate' }])).toBe(false);
    expect(hasQueuedDelete(null)).toBe(false);
    expect(hasQueuedDelete([{ type: 'archive' }])).toBe(false); // Etsy / eBay default
    expect(hasQueuedDelete([{ type: 'archive' }], CATALOG_DESTRUCTIVE_ACTIONS)).toBe(true);
    expect(hasQueuedDelete([{ type: 'archive', completedAt: '2026-10-01' }], CATALOG_DESTRUCTIVE_ACTIONS)).toBe(false);
  });
  it('pickEffectiveDrafts prefers the open draft', () => {
    const m = pickEffectiveDrafts([
      { extId: '1', status: 'synced', updatedAt: new Date(5), syncedAt: new Date(5) },
      { extId: '1', status: 'draft', updatedAt: new Date(1), syncedAt: null },
    ]);
    expect(m.get('1')!.status).toBe('draft');
  });
  it('sendErrorKey never returns raw text', () => {
    expect(sendErrorKey('draft', 'x')).toBeNull();
    expect(sendErrorKey('failed', 'Sync interrupted by a server restart — retry Sync to Etsy')).toEqual({ errorKey: 'listings.sendError.interrupted' });
    expect(sendErrorKey('failed', 'Etsy 429 Too Many Requests')).toEqual({ errorKey: 'listings.sendError.rateLimited' });
    expect(sendErrorKey('failed', 'Listing not found')).toEqual({ errorKey: 'listings.sendError.notFound' });
    expect(sendErrorKey('failed', 'Price must be at least 0.20')).toEqual({ errorKey: 'listings.sendError.rejected' });
    expect(sendErrorKey('failed', 'boom')).toEqual({ errorKey: 'listings.sendError.generic' });
    expect(sendErrorKey('failed', null)).toEqual({ errorKey: 'listings.sendError.generic' });
  });
  it('sendErrorKey passes CatalogDraft i18n keys through unchanged', () => {
    expect(sendErrorKey('failed', 'listings.cell.variationsReadOnly')).toEqual({ errorKey: 'listings.cell.variationsReadOnly' });
    expect(sendErrorKey('failed', 'listings.validate.priceInvalid')).toEqual({ errorKey: 'listings.validate.priceInvalid' });
    expect(sendErrorKey('conflict', 'listings.draftError.remoteChanged')).toEqual({ errorKey: 'listings.draftError.remoteChanged' });
    expect(sendErrorKey('failed', 'Invalid price.')).toEqual({ errorKey: 'listings.sendError.rejected' });
  });
});

describe('schema detection (real generated client)', () => {
  it('reads Prisma.<Model>ScalarFieldEnum', async () => {
    const { modelHasField } = await import('@/lib/listings/query');
    expect(modelHasField('EtsyListing', 'hasVariations')).toBe(true);
    expect(modelHasField('EtsyListing', 'notAColumn')).toBe(false);
    expect(modelHasField('NoSuchModel', 'id')).toBe(false);
  });
});
