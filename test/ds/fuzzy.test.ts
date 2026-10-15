// lib/ds/fuzzy.ts + lib/nav/orderHits.ts (shell-nav §3.6, §11: moved unchanged from components/CommandPalette.tsx).
import { describe, expect, it } from 'vitest';
import { fold, fuzzyScore, rankByQuery, scoreItem, SECONDARY_MATCH_PENALTY } from '@/lib/ds/fuzzy';
import {
  ORDER_SEARCH_LIMIT,
  ORDERS_PATH,
  needsFullNavigation,
  orderHitHref,
  orderSearchUrl,
  toOrderHits,
} from '@/lib/nav/orderHits';

describe('fold', () => {
  it('lowercases and strips diacritics so ASCII queries match Turkish labels', () => {
    expect(fold('Siparişler', 'tr')).toBe('siparisler');
    expect(fold('Ödeme Çıktısı', 'tr')).toBe('odeme ciktisi');
    expect(fold('İlanlar', 'tr')).toBe('ilanlar');
    expect(fold('Etsy listings', 'en')).toBe('etsy listings');
  });
  it('falls back to toLowerCase on an invalid locale', () => {
    expect(fold('ABC', 'not a locale!!')).toBe('abc');
  });
});

describe('fuzzyScore', () => {
  it('returns 0 for an empty query and -1 for no match', () => {
    expect(fuzzyScore('orders', '')).toBe(0);
    expect(fuzzyScore('orders', 'xyz')).toBe(-1);
  });
  it('ranks a substring above any subsequence, and an earlier substring higher', () => {
    const sub = fuzzyScore('etsy listings', 'list');
    const seq = fuzzyScore('etsy listings', 'elg');
    expect(sub).toBeGreaterThan(900);
    expect(seq).toBeGreaterThan(0);
    expect(seq).toBeLessThan(sub);
    expect(fuzzyScore('orders', 'ord')).toBeGreaterThan(fuzzyScore('my orders', 'ord'));
  });
  it('rewards word starts and contiguous runs', () => {
    expect(fuzzyScore('etsy listings', 'el')).toBe(12); // two word starts
    expect(fuzzyScore('xetxxl', 'el')).toBe(2); // mid-word, not contiguous
    expect(fuzzyScore('xelx yz', 'ey')).toBeLessThan(fuzzyScore('el yz', 'ey'));
  });
});

describe('rankByQuery', () => {
  const items = [
    { label: 'Settings' },
    { label: 'Orders', hint: 'Main' },
    { label: 'Etsy listings', hint: 'Listings', keywords: ['etsy'] },
    { label: 'eBay listings', hint: 'Listings' },
  ];
  it('returns a copy unchanged for an empty or blank query', () => {
    const out = rankByQuery(items, '   ', 'en');
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });
  it('filters and orders by score, stable on ties', () => {
    expect(rankByQuery(items, 'listings', 'en').map((i) => i.label)).toEqual(['Etsy listings', 'eBay listings']);
    expect(rankByQuery(items, 'ord', 'en').map((i) => i.label)).toEqual(['Orders']);
  });
  it('matches on hint/keywords with a penalty, so a label match wins', () => {
    const q = fold('main', 'en');
    const viaHint = scoreItem({ label: 'Orders', hint: 'Main' }, q, 'en');
    const viaLabel = scoreItem({ label: 'Main' }, q, 'en');
    expect(viaHint).toBeGreaterThan(0);
    expect(viaLabel - viaHint).toBeGreaterThanOrEqual(SECONDARY_MATCH_PENALTY);
  });
  it('matches Turkish labels from ASCII input', () => {
    const tr = [{ label: 'Siparişler' }, { label: 'Ayarlar' }];
    expect(rankByQuery(tr, 'siparis', 'tr').map((i) => i.label)).toEqual(['Siparişler']);
  });
});

describe('orderHits', () => {
  it('parses /api/orders JSON, skips malformed rows and caps at the limit', () => {
    const raw = {
      orders: [
        null,
        { id: 'a', orderNumber: '3891', customerName: 'Sarah M.', marketplace: 'etsy' },
        { orderNumber: 42, customerName: 7 },
        { id: 'c' },
        ...Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, orderNumber: `N${i}` })),
      ],
    };
    const hits = toOrderHits(raw);
    expect(hits).toHaveLength(ORDER_SEARCH_LIMIT);
    expect(hits[0]).toEqual({ id: 'a', orderNumber: '3891', customerName: 'Sarah M.', marketplace: 'etsy' });
    expect(hits[1]).toEqual({ id: '42', orderNumber: '42', customerName: '', marketplace: '' });
    expect(toOrderHits(null)).toEqual([]);
    expect(toOrderHits({ orders: 'nope' })).toEqual([]);
    expect(toOrderHits(raw, 1)).toHaveLength(1);
  });
  it('builds the search URL and the Orders href', () => {
    expect(orderSearchUrl('a b')).toBe('/api/orders?search=a+b&searchType=all&page=1&limit=5');
    expect(orderHitHref('#38 91')).toBe(`${ORDERS_PATH}?q=%2338%2091`);
  });
  it('needs a full navigation only on the Orders route itself (until M3)', () => {
    expect(needsFullNavigation('/app/labels')).toBe(true);
    expect(needsFullNavigation('/app/analytics')).toBe(false);
  });
});
