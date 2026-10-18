import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { dayBucket, guardAgainst, hourBucket, parseProductPage, parseStorePage } from '@/lib/market/ingest';
import { parseSnapshot } from '@/lib/research/marketSnapshot';

// A real Trendyol product page read (2026-10-18): ld+json + visible social proof.
const product = (over: Record<string, unknown> = {}) => ({
  mkt: 'trendyol',
  product: {
    id: '1173797433', title: 'Velora Krem 3 Çekmeceli Kapaklı Makyaj Organizeri', brand: 'MAKRİ HOME',
    url: 'https://www.trendyol.com/makri-home/velora-p-1173797433', imageUrl: 'https://cdn.dsmcdn.com/ty1/a.jpg',
    price: 1199, rating: 4.4, ratingCount: 186, reviewCount: 124, favorites: '14,9B', basketCount: '1,4B',
    sellerId: 955748, sellerName: 'MAKRİ HOME', sellerScore: 9.1, otherSellerCount: 2,
    offers: [{ sellerId: 955748, name: 'MAKRİ HOME', price: 1199, score: 9.1 }, { sellerId: 1, name: 'X', price: 1150, score: 42 }, { name: 'no id' }],
    ...over,
  },
});

describe('parseProductPage (untrusted)', () => {
  it('reads a real product page; Turkish compact counts; drops bad offers', () => {
    const p = parseProductPage(product())!;
    expect(p).toMatchObject({ id: '1173797433', price: 1199, ratingCount: 186, reviewCount: 124, favorites: 14900, basketCount: 1400, sellerId: '955748', otherSellerCount: 2 });
    expect(p.offers.map((o) => o.sellerId)).toEqual(['955748']);
  });
  it('rejects wrong marketplace, bad id, missing title; foreign urls dropped', () => {
    expect(parseProductPage({ ...product(), mkt: 'amazon' })).toBeNull();
    expect(parseProductPage(product({ id: 'abc' }))).toBeNull();
    expect(parseProductPage(product({ title: '' }))).toBeNull();
    expect(parseProductPage(product({ url: 'https://evil.example/x', imageUrl: 'javascript:1' }))!).toMatchObject({ url: null, imageUrl: null });
  });
  it('Hepsiburada ids are alphanumeric, hosts are Hepsiburada', () => {
    const p = parseProductPage({ mkt: 'hepsiburada', product: { id: 'HBCV00000ABC12', title: 'Takı kutusu', url: 'https://www.hepsiburada.com/x-p-HBCV00000ABC12', imageUrl: 'https://productimages.hepsiburada.net/s/1.jpg' } })!;
    expect(p).toMatchObject({ mkt: 'hepsiburada', id: 'HBCV00000ABC12' });
    expect(p.url).toContain('hepsiburada.com');
    expect(p.imageUrl).toContain('hepsiburada.net');
  });
});

describe('parseStorePage', () => {
  it('needs a seller id; clamps score', () => {
    expect(parseStorePage({ mkt: 'trendyol', store: {} })).toBeNull();
    expect(parseStorePage({ mkt: 'trendyol', store: { sellerId: 955748, name: 'MAKRİ HOME', score: 99, followers: '12B' } })).toMatchObject({ sellerId: '955748', score: null, followers: 12000 });
  });
});

describe('guardAgainst (one bad read cannot rewrite history)', () => {
  const prev = { price: 1199, ratingCount: 186, reviewCount: 124, favorites: 14900 };
  it('keeps plausible changes', () => {
    expect(guardAgainst(prev, { price: 1099, ratingCount: 190, reviewCount: 125, favorites: 14000 })).toEqual({ price: 1099, ratingCount: 190, reviewCount: 125, favorites: 14000 });
  });
  it('drops shrinking counters and 10x prices', () => {
    expect(guardAgainst(prev, { price: 11.99, ratingCount: 18, reviewCount: 12, favorites: 149 })).toEqual({ price: null, ratingCount: null, reviewCount: null, favorites: null });
  });
  it('no history: accepts as is', () => {
    expect(guardAgainst(null, { price: 5, ratingCount: 1, favorites: 2 })).toEqual({ price: 5, ratingCount: 1, favorites: 2 });
  });
});

describe('buckets and Hepsiburada search pages', () => {
  it('hour/day buckets are UTC floors', () => {
    const d = new Date('2026-10-18T20:47:13.123Z');
    expect(hourBucket(d).toISOString()).toBe('2026-10-18T20:00:00.000Z');
    expect(dayBucket(d).toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });
  it('search snapshot accepts Hepsiburada ids', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: `HBCV0000${i}ABCD`, title: `t${i}`, price: 100 + i }));
    expect(parseSnapshot({ mkt: 'hepsiburada', query: 'takı kutusu', total: 900, items })!.items).toHaveLength(6);
  });
});
