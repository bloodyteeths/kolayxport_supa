// research R4 Price gap — pure model (lib/research/priceGap.ts): link parsing, own-label shipping medians, match
// confidence tiers, margin math, guards (no number without every input), row split/sort and the eBay prefill.
import { describe, expect, it } from 'vitest';
import { summarizeAmounts } from '@/lib/research/stats';
import {
  computeMargin,
  confidenceTier,
  bandsForCarrier,
  ebayPrefill,
  englishKeywords,
  isUsableMatch,
  parseTrendyolProductId,
  pickShipping,
  rowMargin,
  sellPrice,
  shippingOptions,
  sortGapRows,
  splitByConfidence,
  weightBand,
  type PriceGapRow,
} from '@/lib/research/priceGap';

const row = (o: Partial<PriceGapRow> = {}): PriceGapRow => ({
  id: '111111',
  title: 'El yapımı bakır cezve',
  brand: 'Usta',
  url: 'https://www.trendyol.com/usta/cezve-p-111111',
  imageUrl: 'https://cdn.dsmcdn.com/a.jpg',
  images: ['https://cdn.dsmcdn.com/a.jpg', 'http://insecure.example/b.jpg'],
  trPriceTry: 640,
  category: { slug: 'cezve-x-c1', name: 'Cezve' },
  confidence: 'high',
  ebay: summarizeAmounts([40, 44, 46, 48, 48, 50, 52, 55], 'USD'),
  ebayCategoryId: '20625',
  matches: [
    { itemId: 'e1', title: 'Turkish Copper Coffee Pot Handmade', price: 48, currency: 'USD', soldAllTime: 12, url: null, imageUrl: null, confidence: 0.9, matchType: 'exact' },
  ],
  etsy: null,
  englishQuery: 'turkish copper coffee pot',
  fetchedAt: '2026-10-14T08:00:00.000Z',
  ...o,
});

describe('parseTrendyolProductId', () => {
  it('reads -p-<id> from trendyol.com links (with query/hash) and bare ids', () => {
    expect(parseTrendyolProductId('https://www.trendyol.com/usta/bakir-cezve-p-123456789?boutiqueId=61')).toBe(123456789);
    expect(parseTrendyolProductId('trendyol.com/x/y-p-765432#reviews')).toBe(765432);
    expect(parseTrendyolProductId('123456789')).toBe(123456789);
  });
  it('rejects other hosts and garbage', () => {
    expect(parseTrendyolProductId('https://evil.example/x-p-123456789')).toBeNull();
    expect(parseTrendyolProductId('https://www.trendyol.com/kategori')).toBeNull();
    expect(parseTrendyolProductId('')).toBeNull();
    expect(parseTrendyolProductId(undefined)).toBeNull();
  });
});

describe('own label shipping', () => {
  it('weightBand: upper bound inclusive, invalid → null', () => {
    expect(weightBand(0.5)).toBe('0.5');
    expect(weightBand(0.51)).toBe('1');
    expect(weightBand(2)).toBe('2');
    expect(weightBand(7)).toBe('5+');
    expect(weightBand(0)).toBeNull();
    expect(weightBand(null)).toBeNull();
  });

  it('median per carrier × band; < 5 labels → no number (no rate-card guess)', () => {
    const fedex = [12, 13, 14, 14.2, 15, 16].map((c) => ({ carrier: 'FedEx International Priority', weightKg: 0.8, costUsd: c }));
    const ups = [20, 21].map((c) => ({ carrier: 'UPS', weightKg: 0.8, costUsd: c }));
    const opts = shippingOptions([...fedex, ...ups, { carrier: '', weightKg: 1, costUsd: 9 }, { carrier: 'UPS', weightKg: null, costUsd: 9 }]);
    const f = opts.find((o) => o.carrier === 'fedex')!;
    expect(f.band).toBe('1');
    expect(f.n).toBe(6);
    expect(f.medianUsd).toBeCloseTo(14.1, 1);
    expect(f.quality).toBe('small');
    const u = opts.find((o) => o.carrier === 'ups')!;
    expect(u.medianUsd).toBeNull();
    expect(u.quality).toBe('insufficient');
  });

  it('pickShipping: requested carrier/band, else the best usable option in the default band', () => {
    const opts = shippingOptions([
      ...[12, 13, 14, 15, 16].map((c) => ({ carrier: 'fedex', weightKg: 0.4, costUsd: c })),
      ...[30, 31, 32, 33, 34].map((c) => ({ carrier: 'ups', weightKg: 3, costUsd: c })),
      ...[9, 10].map((c) => ({ carrier: 'ups', weightKg: 0.4, costUsd: c })),
    ]);
    expect(pickShipping(opts, {})?.carrier).toBe('fedex');
    expect(pickShipping(opts, { carrier: 'ups', band: '5' })?.medianUsd).toBe(32);
    expect(pickShipping(opts, { defaultKg: 3 })?.carrier).toBe('ups');
    expect(pickShipping([], {})).toBeNull();
  });
});

describe('match confidence', () => {
  it('tiers', () => {
    expect(confidenceTier(0.92, 'exact')).toBe('high');
    expect(confidenceTier(0.92, 'similar')).toBe('medium');
    expect(confidenceTier(0.72, 'equivalent')).toBe('medium');
    expect(confidenceTier(0.6, 'exact')).toBe('low');
  });
  it('matcher rule: none and < 0.5 are not matches', () => {
    expect(isUsableMatch({ confidence: 0.9, matchType: 'none' })).toBe(false);
    expect(isUsableMatch({ confidence: 0.49, matchType: 'exact' })).toBe(false);
    expect(isUsableMatch({ confidence: 0.5, matchType: 'similar' })).toBe(true);
  });
});

describe('margin', () => {
  it('computeMargin: cost via FX + shipping + eBay fee table (FVF + payment + international)', () => {
    const b = computeMargin({ trPriceTry: 640, usdPerTry: 1 / 41.2, shippingUsd: 14.2, sellUsd: 48, ebayCategoryId: '' });
    expect(b.costUsd).toBeCloseTo(15.53, 2);
    expect(b.landedUsd).toBeCloseTo(29.73, 2);
    // 13.25% FVF + 2.35% + $0.30 + 1.65% of $48
    expect(b.feesUsd).toBeCloseTo(48 * 0.1325 + 48 * 0.0235 + 0.3 + 48 * 0.0165, 2);
    expect(b.profitUsd).toBeCloseTo(48 - 29.73 - b.feesUsd, 1);
    expect(b.marginFraction).toBeCloseTo(b.profitUsd / 48, 2);
  });

  it('rowMargin guards: no FX / no shipping / thin eBay sample → no number, estimate kind', () => {
    const fx = { usdPerTry: 1 / 41.2 };
    const ship = { usd: 14.2, kind: 'measured' as const, n: 12 };
    const ok = rowMargin(row(), fx, ship);
    expect(ok.margin.kind).toBe('estimate');
    expect(ok.margin.guard.ok).toBe(true);
    expect(ok.breakdown).not.toBeNull();

    expect(rowMargin(row(), { usdPerTry: null }, ship).landed.guard.reasonKey).toBe('research.gap.guard.noFx');
    expect(rowMargin(row(), fx, null).margin.guard.reasonKey).toBe('research.gap.guard.noShipping');
    expect(rowMargin(row({ trPriceTry: null }), fx, ship).landed.value).toBeNull();

    const thin = rowMargin(row({ ebay: summarizeAmounts([40, 50], 'USD') }), fx, ship);
    expect(thin.landed.guard.ok).toBe(true);
    expect(thin.margin.value).toBeNull();
    expect(thin.margin.guard).toMatchObject({ ok: false, reasonKey: 'research.gap.guard.ebaySample', reasonParams: { n: 2, min: 5 } });
    expect(rowMargin(row({ ebay: null }), fx, ship).margin.guard.reasonKey).toBe('research.gap.guard.noMatch');
  });

  it('a typed shipping cost (kind user) prices the row', () => {
    const m = rowMargin(row(), { usdPerTry: 1 / 41.2 }, { usd: 20, kind: 'user' });
    expect(m.breakdown?.shippingUsd).toBe(20);
  });

  it('sellPrice: median only for a usable sample', () => {
    expect(sellPrice(summarizeAmounts([40, 44, 46, 48, 50], 'USD'))).toBe(46);
    expect(sellPrice(summarizeAmounts([40], 'USD'))).toBeNull();
    expect(sellPrice(null)).toBeNull();
  });
});

describe('rows', () => {
  it('splitByConfidence: high/medium shown, low collapsed, unmatched separate', () => {
    const s = splitByConfidence([row({ id: 'a', confidence: 'high' }), row({ id: 'b', confidence: 'low' }), row({ id: 'c', confidence: null }), row({ id: 'd', confidence: 'medium' })]);
    expect(s.main.map((r) => r.id)).toEqual(['a', 'd']);
    expect(s.low.map((r) => r.id)).toEqual(['b']);
    expect(s.none.map((r) => r.id)).toEqual(['c']);
  });

  it('sortGapRows: computed margins first (desc), then confidence', () => {
    const m: Record<string, number | null> = { a: 2, b: null, c: 9, d: null };
    const out = sortGapRows([row({ id: 'a' }), row({ id: 'b', confidence: 'low' }), row({ id: 'c' }), row({ id: 'd', confidence: 'medium' })], (r) => m[r.id]);
    expect(out.map((r) => r.id)).toEqual(['c', 'a', 'd', 'b']);
  });
});

describe('pickShipping: chosen carrier is kept', () => {
  const s = [
    ...[10, 11, 12, 13, 14, 15, 16, 17].map((c) => ({ carrier: 'fedex', weightKg: 0.4, costUsd: c })),
    ...[30, 31, 32, 33, 34, 35].map((c) => ({ carrier: 'ups', weightKg: 1.5, costUsd: c })),
  ];
  it('a carrier without the default band stays on that carrier (closest usable band)', () => {
    const o = pickShipping(shippingOptions(s), { carrier: 'ups', band: null, defaultKg: null });
    expect(o).toMatchObject({ carrier: 'ups', band: '2', n: 6 });
  });
  it('a requested band the carrier lacks → that carrier\'s closest band', () => {
    expect(pickShipping(shippingOptions(s), { carrier: 'ups', band: '0.5' })?.carrier).toBe('ups');
  });
  it('an unknown carrier falls back to the default choice', () => {
    expect(pickShipping(shippingOptions(s), { carrier: 'dhl' })?.carrier).toBe('fedex');
  });
  it('bandsForCarrier lists only that carrier\'s bands', () => {
    expect(bandsForCarrier(shippingOptions(s), 'ups')).toEqual(['2']);
    expect(bandsForCarrier(shippingOptions(s), null)).toEqual(['0.5', '2']);
  });
});

describe('ebayPrefill ("List on eBay")', () => {
  it('English keywords only, https images only, median price, no Turkish title, no publish flag', () => {
    const r = row();
    const p = ebayPrefill(r, rowMargin(r, { usdPerTry: 1 / 41.2 }, { usd: 14.2, kind: 'measured' }));
    expect(p.target).toBe('ebay');
    expect(p.source).toBe('arbitrage');
    expect(p.title).toBeUndefined();
    expect(p.keywords).toContain('copper');
    expect(p.keywords.join(' ')).not.toMatch(/cezve|bakır/);
    expect(p.imageUrls).toEqual([]); // category source: other sellers' photos are reference only
    expect(p.research.referenceImageUrls).toEqual(['https://cdn.dsmcdn.com/a.jpg']);
    expect(ebayPrefill(r, rowMargin(r, { usdPerTry: 1 / 41.2 }, null), 'mine').imageUrls).toEqual(['https://cdn.dsmcdn.com/a.jpg']);
    expect(p.price).toBe(r.ebay!.median);
    expect(p.currency).toBe('USD');
    expect(JSON.stringify(p)).not.toMatch(/avg|mean/i);
  });

  it('no price when the eBay sample is not usable', () => {
    const r = row({ ebay: summarizeAmounts([40, 50], 'USD') });
    const p = ebayPrefill(r, rowMargin(r, { usdPerTry: 0.024 }, null));
    expect(p.price).toBeUndefined();
    expect(p.currency).toBeUndefined();
  });

  it('englishKeywords dedupes and caps at 13', () => {
    const k = englishKeywords({ englishQuery: 'copper copper pot', matches: [] });
    expect(k).toEqual(['copper', 'pot']);
  });
});
