// research legacy port: eBay seller/item readings for the Shop tracker (lib/research/ebayItemTracker.ts) and the
// `ebayItem` watch in lib/research/watchAdapter.ts. Before this, only the legacy eBay Product tracker's "Refresh all"
// wrote EbayPriceSnapshot rows, so eBay seller watches never got a second reading.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, ebayCalls, tokenFor } = vi.hoisted(() => ({
  db: {
    products: [] as any[],
    snaps: [] as any[],
    sellers: [] as any[],
  },
  ebayCalls: [] as string[],
  tokenFor: vi.fn(),
}));

let seq = 0;
function pick(row: any, select: any) {
  if (!select) return row;
  const out: any = {};
  for (const [k, v] of Object.entries(select)) {
    if (k === 'snapshots') {
      const s = v as any;
      const since = s.where?.timestamp?.gte as Date | undefined;
      out.snapshots = db.snaps
        .filter((x) => x.trackedProductId === row.id && (!since || x.timestamp >= since))
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((x) => pick(x, s.select));
    } else if (v) out[k] = row[k];
  }
  return out;
}
const where = (row: any, w: any) => Object.entries(w ?? {}).every(([k, v]) => (v && typeof v === 'object' && !(v instanceof Date) ? true : row[k] === v));

const prismaMock = {
  ebayTrackedProduct: {
    findUnique: vi.fn(async ({ where: w }: any) => db.products.find((p) => p.userId === w.userId_legacyItemId.userId && p.legacyItemId === w.userId_legacyItemId.legacyItemId) ?? null),
    findMany: vi.fn(async ({ where: w, select, take }: any) => db.products.filter((p) => where(p, w)).slice(0, take ?? 1e9).map((p) => pick(p, select))),
    create: vi.fn(async ({ data }: any) => { const row = { id: `tp${++seq}`, createdAt: new Date(), isActive: true, ...data }; db.products.push(row); return row; }),
    update: vi.fn(async ({ where: w, data }: any) => { const row = db.products.find((p) => p.id === w.id); Object.assign(row, data); return row; }),
    updateMany: vi.fn(async ({ where: w, data }: any) => { const rows = db.products.filter((p) => where(p, w)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; }),
  },
  ebayPriceSnapshot: {
    create: vi.fn(async ({ data }: any) => { const row = { id: `s${++seq}`, timestamp: new Date(), ...data }; db.snaps.push(row); return row; }),
  },
  ebayTrackedSeller: { findMany: vi.fn(async () => db.sellers) },
  amazonTrackedProduct: { findMany: vi.fn(async () => []) },
  user: { findUnique: vi.fn(async () => ({ subscriptionPlan: 'starter', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null })) },
  shopifyShop: { count: vi.fn(async () => 0) },
  $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg))),
};

vi.mock('@/lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, k: string) => (k === 'researchWatch' || k === 'researchSnapshot' ? undefined : (prismaMock as any)[k]) }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn() }));
vi.mock('@/lib/notificationCenter/registry', () => ({ isKnownType: () => false }));
vi.mock('@/lib/integrations/ebayClient', () => ({ getEbayTokenFor: (...a: unknown[]) => tokenFor(...a) }));

const items: Record<string, { price: string; sold: number; seller?: string } | 'gone'> = {};
vi.mock('@/lib/integrations/ebayRateLimiter', () => ({
  callEbayRateLimited: vi.fn(async (url: string, opts: { token: string }) => {
    ebayCalls.push(`${opts.token} ${url}`);
    const id = new URL(url).searchParams.get('legacy_item_id') ?? '';
    const it = items[id];
    if (!it || it === 'gone') throw new Error('eBay API 404: item not found');
    return {
      itemId: `v1|${id}|0`,
      title: 'Engraved Walnut Box &amp; Lid',
      price: { value: it.price, currency: 'USD' },
      condition: 'New',
      seller: { username: it.seller ?? 'engrave_us' },
      image: { imageUrl: 'https://i.ebayimg.com/a.jpg' },
      itemWebUrl: `https://www.ebay.com/itm/${id}`,
      estimatedAvailabilities: [{ estimatedSoldQuantity: it.sold, estimatedRemainingQuantity: 4 }],
    };
  }),
}));

import {
  isEbayItemId,
  needsReading,
  parseEbayItem,
  refreshTrackedEbayItems,
  trackEbayItem,
} from '@/lib/research/ebayItemTracker';
import {
  DAY_MS,
  createWatch,
  detectWatchTarget,
  ebayItemMetrics,
  getWatchDetail,
  itemPriceChange,
  itemPriceSeries,
  listWatches,
  parseCreateBody,
  parseWatchId,
  patchWatch,
  removeWatch,
  WatchError,
} from '@/lib/research/watchAdapter';

const NOW = Date.parse('2026-10-15T06:30:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  db.products = [];
  db.snaps = [];
  db.sellers = [];
  ebayCalls.length = 0;
  seq = 0;
  for (const k of Object.keys(items)) delete items[k];
  tokenFor.mockImplementation(async (userId: string) => ({ token: `tok-${userId}`, kind: 'user' }));
});

describe('pure helpers', () => {
  it('parseEbayItem keeps a real price, never a fake 0; https only', () => {
    const d = parseEbayItem({ title: 'A', price: { value: '24.90', currency: 'USD' }, image: { imageUrl: 'http://x' }, estimatedAvailabilities: [{ estimatedSoldQuantity: 3 }] }, '123456789012');
    expect(d).toMatchObject({ price: 24.9, currency: 'USD', imageUrl: null, soldQuantity: 3, remainingQuantity: null });
    expect(parseEbayItem({ title: 'A', price: { value: '0' } }, '1')?.price).toBeNull();
    expect(parseEbayItem({ price: { value: '5' } }, '1')).toBeNull();
    expect(parseEbayItem(null, '1')).toBeNull();
  });
  it('item ids are 9–15 digits; one reading per UTC day', () => {
    expect(isEbayItemId('123456789012')).toBe(true);
    expect(isEbayItemId('12345')).toBe(false);
    expect(needsReading(null, NOW)).toBe(true);
    expect(needsReading(new Date(NOW - 60_000), NOW)).toBe(false);
    expect(needsReading(new Date(NOW - DAY_MS), NOW)).toBe(true);
  });
  it('item link / id → ebayItem watch target; ids round-trip through parseWatchId', () => {
    expect(detectWatchTarget('https://www.ebay.com/itm/walnut-box/123456789012')).toMatchObject({ type: 'ebayItem', itemId: '123456789012' });
    expect(detectWatchTarget('123456789012', { type: 'ebayItem' })).toEqual({ type: 'ebayItem', itemId: '123456789012', label: null });
    expect(detectWatchTarget('https://www.ebay.com/itm/123456789012', { type: 'ebaySeller' })).toBeNull();
    expect(parseCreateBody({ type: 'ebayItem', refId: '123456789012', label: 'Box' }).target).toEqual({ type: 'ebayItem', itemId: '123456789012', label: 'Box' });
    expect(parseCreateBody({ type: 'ebayItem', refId: 'https://ebay.com/itm/123456789012' }).target).toMatchObject({ type: 'ebayItem', itemId: '123456789012' });
    expect(parseWatchId('ebayItem.tp1')).toEqual({ source: 'ebayTrackedProduct', id: 'tp1' });
  });
  it('item metrics: sales/day from Δ sold (Measured), price change vs ~7 days earlier, no shop counters', () => {
    const r = (d: number, price: number | null, sold: number | null, currency = 'USD') => ({ timestamp: new Date(NOW - d * DAY_MS), price, currency, soldQuantity: sold });
    const m = ebayItemMetrics([r(14, 20, 100), r(7, 20, 114), r(0, 22, 128)]);
    expect(m.salesPerDay).toMatchObject({ value: 2, kind: 'measured', guard: { ok: true } });
    expect(m.priceChange).toMatchObject({ value: 0.1, guard: { ok: true } });
    expect(m.active.guard).toMatchObject({ ok: false, reasonKey: 'research.watch.notApplicable' });
    expect(m.price).toBeNull();
    expect(itemPriceChange([r(3, 20, 1), r(0, 22, 2)]).guard.reasonKey).toBe('research.shops.needWeek');
    expect(itemPriceChange([r(8, 20, 1, 'GBP'), r(0, 22, 2)]).guard.reasonKey).toBe('research.shops.currencyChanged');
    expect(ebayItemMetrics([r(0, 22, 128)]).salesPerDay.guard.reasonKey).toBe('research.shops.firstReading');
  });
  it('price series: one point per UTC day, gaps null, 30 days ending at the latest reading', () => {
    const s = itemPriceSeries([
      { timestamp: new Date(NOW - 2 * DAY_MS), price: 20, currency: 'USD', soldQuantity: 1 },
      { timestamp: new Date(NOW), price: 22, currency: 'USD', soldQuantity: 2 },
    ]);
    expect(s).toHaveLength(30);
    expect(s[29]).toEqual({ date: '2026-10-15', value: 22 });
    expect(s[28].value).toBeNull();
    expect(s[27]).toEqual({ date: '2026-10-13', value: 20 });
    expect(itemPriceSeries([])).toEqual([]);
  });
});

describe('trackEbayItem + refreshTrackedEbayItems', () => {
  it('tracks with a first reading; already active → unchanged; removed → re-activated', async () => {
    items['123456789012'] = { price: '24.90', sold: 31 };
    const a = await trackEbayItem('u1', '123456789012', new Date(NOW));
    expect(a.created).toBe(true);
    expect(db.products[0]).toMatchObject({ userId: 'u1', legacyItemId: '123456789012', currentPrice: 24.9, totalSold: 31, seller: 'engrave_us', isActive: true });
    expect(db.snaps).toHaveLength(1);
    expect(db.snaps[0]).toMatchObject({ price: 24.9, soldQuantity: 31, quantity: 4 });
    expect(await trackEbayItem('u1', '123456789012')).toEqual({ id: a.id, created: false });
    expect(ebayCalls).toHaveLength(1);
    db.products[0].isActive = false;
    expect((await trackEbayItem('u1', '123456789012')).created).toBe(true);
    expect(db.products).toHaveLength(1);
    expect(db.products[0].isActive).toBe(true);
  });

  it('daily run: one reading per active item per UTC day, each owner with their own token; ended items are skipped', async () => {
    items['111111111111'] = { price: '10', sold: 5 };
    items['222222222222'] = 'gone';
    db.products.push(
      { id: 'a', userId: 'u1', legacyItemId: '111111111111', isActive: true, lastCheckedAt: new Date(NOW - DAY_MS) },
      { id: 'b', userId: 'u2', legacyItemId: '222222222222', isActive: true, lastCheckedAt: null },
      { id: 'c', userId: 'u2', legacyItemId: '333333333333', isActive: true, lastCheckedAt: new Date(NOW - 60_000) },
      { id: 'd', userId: 'u3', legacyItemId: '444444444444', isActive: false, lastCheckedAt: null },
    );
    const s = await refreshTrackedEbayItems({ nowMs: NOW });
    expect(s).toMatchObject({ due: 2, taken: 1, gone: 1, alreadyToday: 1, failed: 0 });
    expect(db.snaps.map((x) => x.trackedProductId)).toEqual(['a']);
    expect(db.products.find((p) => p.id === 'a')).toMatchObject({ currentPrice: 10, totalSold: 5 });
    expect(db.products.find((p) => p.id === 'b')!.lastCheckedAt.getTime()).toBe(NOW);
    expect(ebayCalls.map((c) => c.split(' ')[0]).sort()).toEqual(['tok-u1', 'tok-u2']);
    // Same day again: nothing due, no eBay call.
    ebayCalls.length = 0;
    expect(await refreshTrackedEbayItems({ nowMs: NOW + 60_000 })).toMatchObject({ due: 0, taken: 0 });
    expect(ebayCalls).toHaveLength(0);
  });
});

describe('ebayItem watch (Shop tracker read model)', () => {
  it('POST an item link → tracked item row with its price and sold line; no quota, no BR-1c needed', async () => {
    items['123456789012'] = { price: '24.90', sold: 31 };
    const out = await createWatch('u1', { input: 'https://www.ebay.com/itm/walnut-box/123456789012', type: 'ebayItem', marketplace: 'ebay' }, NOW);
    expect(out.created).toBe(true);
    expect(out.summary).toMatchObject({
      type: 'ebayItem', marketplace: 'ebay', refId: '123456789012', source: 'ebayTrackedProduct',
      label: 'Engraved Walnut Box &amp; Lid', url: 'https://www.ebay.com/itm/123456789012', capabilities: { alerts: false, remove: true },
      item: { price: 24.9, currency: 'USD', soldAllTime: 31, condition: 'New', seller: 'engrave_us' },
    });
    expect(out.summary.id).toMatch(/^ebayItem\./);
    expect(out.summary.snapshots.count).toBe(1);

    const list = await listWatches('u1', { mkt: 'ebay' }, NOW);
    expect(list.rows.map((r) => r.type)).toEqual(['ebayItem']);

    const detail = await getWatchDetail('u1', out.summary.id, NOW);
    expect(detail.prices?.[29]).toMatchObject({ value: 24.9 });
    // One reading: no rate yet, so every sales point is a gap (never a zero).
    expect(detail.sales.every((x) => x.value === null)).toBe(true);

    await expect(patchWatch('u1', out.summary.id, { label: 'x' })).rejects.toMatchObject({ status: 409 });
    expect(await removeWatch('u1', out.summary.id)).toEqual({ id: out.summary.id, removed: true });
    expect(db.products[0].isActive).toBe(false);
    expect((await listWatches('u1', {}, NOW)).rows).toEqual([]);
  });

  it('an unknown / ended item answers 404 with the item key', async () => {
    const err = await createWatch('u1', { type: 'ebayItem', refId: '999999999999' }, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(WatchError);
    expect(err).toMatchObject({ status: 404, body: { error: 'not_found', key: 'research.shops.error.itemNotFound' } });
    expect(db.products).toHaveLength(0);
  });

  it('a watched seller now gets measured sales once the daily job has two readings of its items', async () => {
    db.sellers.push({ id: 'sel1', sellerUsername: 'engrave_us', feedbackScore: 900, createdAt: new Date(NOW - 20 * DAY_MS), isActive: true });
    items['123456789012'] = { price: '24.90', sold: 31 };
    await trackEbayItem('u1', '123456789012', new Date(NOW - 7 * DAY_MS));
    db.snaps[0].timestamp = new Date(NOW - 7 * DAY_MS);
    db.products[0].lastCheckedAt = new Date(NOW - 7 * DAY_MS);
    items['123456789012'] = { price: '24.90', sold: 45 };
    await refreshTrackedEbayItems({ nowMs: NOW });
    db.snaps[1].timestamp = new Date(NOW);
    // The seller adapter reads every active tracked product of the seller (case-insensitive) with its snapshots.
    prismaMock.ebayTrackedProduct.findMany.mockImplementationOnce(async ({ select }: any) => db.products.map((p) => pick(p, select)));
    const list = await listWatches('u1', { type: 'ebaySeller' }, NOW);
    expect(list.rows[0].metrics.salesPerDay).toMatchObject({ value: 2, guard: { ok: true, reasonKey: 'research.shops.ebayTrackedItems' } });
  });
});
