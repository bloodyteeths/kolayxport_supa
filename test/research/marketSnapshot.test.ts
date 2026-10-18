import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { parseCompact, parseSnapshot, sellerTop5Share, snapshotFacts, snapshotResult, toTopListingsFromSnapshot } from '@/lib/research/marketSnapshot';

// Shape of what content-trendyol-search.js sends, from a real "ahşap takı kutusu" page (2026-10-18).
const item = (i: number, over: Record<string, unknown> = {}) => ({
  id: String(1209640361 + i), title: `Ahşap Takı Kutusu ${i}`, url: `https://www.trendyol.com/x/y-p-${i}`,
  thumbUrl: 'https://cdn.dsmcdn.com/mnresize/400/-/ty1970/a.jpg', price: 500 + i * 50, brand: `Marka ${i % 7}`,
  sellerId: String(437910 + (i % 7)), favorites: i % 2 ? '3K' : '15K', orderBadge: i === 1 ? '100+' : null,
  rating: 4.2, ratingCount: 10 + i, sponsored: i % 3 === 0, category: 'Makyaj & Takı Organizeri', ...over,
});
const body = (n = 36, over: Record<string, unknown> = {}) => ({ mkt: 'trendyol', query: 'ahşap takı kutusu', total: 5109, items: Array.from({ length: n }, (_, i) => item(i)), ...over });

describe('parseCompact', () => {
  it('reads Trendyol compact counters', () => {
    expect(parseCompact('3K')).toBe(3000);
    expect(parseCompact('15K')).toBe(15000);
    expect(parseCompact('1,2B')).toBe(1200);
    expect(parseCompact('100+')).toBe(100);
    expect(parseCompact('360')).toBe(360);
    expect(parseCompact('1.2M')).toBe(1200000);
    expect(parseCompact('çok')).toBeNull();
  });
});

describe('parseSnapshot (untrusted browser payload)', () => {
  it('accepts a real-shaped page and normalises counters', () => {
    const s = parseSnapshot(body(), '2026-10-18T13:00:00.000Z')!;
    expect(s.items).toHaveLength(36);
    expect(s.total).toBe(5109);
    expect(s.items[1]).toMatchObject({ favorites: 3000, orderBadge: '100+', ordersAtLeast: 100, sponsored: false });
  });

  it('rejects other marketplaces, missing query, too few items; drops bad ids, foreign urls and duplicates', () => {
    expect(parseSnapshot(body(36, { mkt: 'amazon' }))).toBeNull();
    expect(parseSnapshot(body(36, { query: '' }))).toBeNull();
    expect(parseSnapshot(body(3))).toBeNull();
    const s = parseSnapshot(body(36, { items: [...body().items, item(0), item(99, { id: 'abc' }), item(98, { url: 'https://evil.example/p', thumbUrl: 'javascript:alert(1)', rating: 9 })] }))!;
    expect(s.items).toHaveLength(37);
    const odd = s.items.find((i) => i.id === String(1209640361 + 98))!;
    expect(odd.url).toBeNull();
    expect(odd.thumbUrl).toBeNull();
    expect(odd.rating).toBeNull();
  });

  it('caps at 120 items', () => {
    expect(parseSnapshot(body(200))!.items).toHaveLength(120);
  });
});

describe('result building', () => {
  const s = parseSnapshot(body(), '2026-10-18T13:00:00.000Z')!;

  it('top listings and seller concentration use organic results only (ads excluded)', () => {
    const top = toTopListingsFromSnapshot(s);
    expect(top.every((t) => !s.items.find((i) => i.id === t.id)!.sponsored)).toBe(true);
    expect(top[0]).toMatchObject({ price: { amount: 550, currency: 'TRY' }, orderBadge: '100+' });
    const share = sellerTop5Share(s.items);
    expect(share.guard.ok).toBe(true);
    expect(share.value).toBeGreaterThan(0.5);
  });

  it('facts: ad pressure and order badges', () => {
    expect(snapshotFacts(s)).toEqual({ sponsoredShare: 0.333, withOrderBadge: 1, organic: 24 });
  });

  it('ProductsResult: TRY price band, total from Trendyol, newcomers not measurable', () => {
    const r = snapshotResult(s, { demand: { tier: 3, inputs: [], kind: 'signal' }, evidence: () => ({ facts: [], confidence: 'low', basis: { key: 'x' } }) as any, cached: true });
    expect(r.mkt).toBe('trendyol');
    expect(r.price.currency).toBe('TRY');
    expect(r.competition.total.value).toBe(5109);
    expect(r.newcomers.guard.ok).toBe(false);
  });
});
