// research legacy port: "Watch an eBay item" in the Shop tracker client (shopModel + useWatches normalisation).
import { describe, expect, it } from 'vitest';
import { cardMeta, findExisting, itemLine, parseShopInput, priceSeries } from '@/components/domain/research/shops/shopModel';
import { SHOP_WATCH_TYPES, isShopWatch, normalizeDetail, normalizeWatchRow } from '@/lib/research/hooks/useWatches';
import { rawRow } from './fixtures';

const fmt = { num: (v: number) => String(v), money: (v: number, c: string) => `${c} ${v}`, delta: (v: number) => ({ text: `${Math.round(v * 100)}%` }) } as never;
const t = Object.assign((k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k), { has: () => true });

const itemRaw = (over: Record<string, unknown> = {}) =>
  rawRow({
    id: 'ebayItem.tp1',
    type: 'ebayItem',
    marketplace: 'ebay',
    refId: '123456789012',
    label: 'Engraved Walnut Box',
    source: 'ebayTrackedProduct',
    capabilities: { alerts: false, remove: true },
    item: { price: 24.9, currency: 'usd', soldAllTime: 312, condition: 'New', seller: 'engrave_us' },
    ...over,
  });

describe('parseShopInput: eBay item links', () => {
  it('an ebay.com/itm link is an eBay item watch on any hub marketplace (title from the slug when there is one)', () => {
    const p = parseShopInput('https://www.ebay.com/itm/engraved-walnut-box/123456789012?hash=x', 'etsy');
    expect(p).toMatchObject({ ok: true, name: '123456789012', request: { type: 'ebayItem', marketplace: 'ebay', refId: '123456789012' } });
    expect(p.ok && p.itemLabel).toBeTruthy();
    const bare = parseShopInput('ebay.com/itm/123456789012', 'ebay');
    expect(bare).toMatchObject({ ok: true, itemLabel: '123456789012', request: { label: '123456789012' } });
  });
  it('a watched item is found by its id (Open instead of a second watch)', () => {
    const row = normalizeWatchRow(itemRaw())!;
    expect(findExisting([row], 'ebay', '123456789012')?.id).toBe('ebayItem.tp1');
  });
});

describe('normalisation + card lines', () => {
  it('ebayItem rows are shop-tracker rows with their item info (currency upper-cased, bad price → null)', () => {
    expect(SHOP_WATCH_TYPES).toContain('ebayItem');
    const row = normalizeWatchRow(itemRaw())!;
    expect(isShopWatch(row)).toBe(true);
    expect(row.source).toBe('ebayTrackedProduct');
    expect(row.item).toEqual({ price: 24.9, currency: 'USD', soldAllTime: 312, condition: 'New', seller: 'engrave_us' });
    expect(normalizeWatchRow(itemRaw({ item: { price: 0, currency: 'x' } }))!.item).toMatchObject({ price: null, currency: 'USD' });
    expect(normalizeWatchRow(itemRaw({ item: undefined }))!.item).toMatchObject({ price: null, soldAllTime: null });
    expect(normalizeWatchRow(rawRow())!.item).toBeUndefined();
  });
  it('item line = own price · sold (all time); the card meta uses it instead of shop counters', () => {
    const row = normalizeWatchRow(itemRaw())!;
    expect(itemLine(row, t, fmt)).toBe('USD 24.9 · research.shops.itemSold {"value":"312"}');
    expect(cardMeta(row, t, fmt)).toBe(itemLine(row, t, fmt));
    expect(itemLine(normalizeWatchRow(rawRow())!, t, fmt)).toBe('');
  });
  it('detail prices: a gap stays a gap (never 0), the chart series keeps one category per day', () => {
    const d = normalizeDetail({ watch: itemRaw(), prices: [{ date: '2026-10-13', value: 20 }, { date: '2026-10-14', value: 0 }, { date: '2026-10-15', value: 22 }] }, null)!;
    expect(d.prices).toEqual([{ date: '2026-10-13', value: 20 }, { date: '2026-10-14', value: null }, { date: '2026-10-15', value: 22 }]);
    const s = priceSeries(d.prices);
    expect(s.data).toEqual([20, null, 22]);
    expect(s.measured).toBe(2);
    expect(priceSeries(undefined).categories).toEqual([]);
  });
});
