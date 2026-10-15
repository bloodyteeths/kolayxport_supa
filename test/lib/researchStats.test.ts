import { describe, it, expect } from 'vitest';
import {
  robustStats, normalizePrices, summarizePrices, isPlausible, boundsFor, tukeyTrim,
  priceDisplay, decodeEntities, groupMedian, buildFxTable, quantile, MIN_SAMPLE, SMALL_SAMPLE,
} from '@/lib/research/stats';

// "halloween decor"-like fixture: 40 USD listings $8–$60, plus JPY/INR listings
// that were previously averaged as if they were dollars, plus $9,999 placeholders.
const usd = Array.from({ length: 40 }, (_, i) => ({ amount: 8 + (i * 52) / 39, currency: 'USD' }));
const mixed = [
  ...usd,
  { amount: 150000, currency: 'JPY' },
  { amount: 4500, currency: 'JPY' },
  { amount: 2499, currency: 'INR' },
  { amount: 9999, currency: 'USD' },
  { amount: 9999, currency: 'USD' },
  { amount: 0.01, currency: 'USD' },
];

describe('quantile / robustStats', () => {
  it('interpolates quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBeNull();
  });

  it('never returns a mean and trims placeholder outliers', () => {
    const vals = [10, 11, 12, 13, 14, 15, 16, 17, 18, 9999];
    const s = robustStats(vals);
    expect(s.trimmed).toBe(1);
    expect(s.max).toBe(18);
    expect(s.median).toBe(14);
    expect(s.total).toBe(10);
    expect(s.n).toBe(9);
  });

  it('ignores non-finite and non-positive values', () => {
    const s = robustStats([NaN, -3, 0, 5, Infinity]);
    expect(s.total).toBe(1);
    expect(s.median).toBe(5);
  });

  it('does not trim tiny samples', () => {
    expect(tukeyTrim([1, 2, 1000]).trimmed).toBe(0);
  });
});

describe('normalizePrices', () => {
  it('excludes currencies with no FX rate instead of mixing them', () => {
    const r = normalizePrices(mixed, 'USD', {});
    expect(r.excludedNoFx).toBe(3);
    expect(r.values.length).toBe(43);
  });

  it('converts with the FX table', () => {
    const r = normalizePrices([{ amount: 1500, currency: 'JPY' }, { amount: 10, currency: 'tl' }], 'USD', { JPY: 0.0067, TRY: 0.025 });
    expect(r.values.map((v) => Math.round(v * 100) / 100)).toEqual([10.05, 0.25]);
    expect(r.excludedNoFx).toBe(0);
  });

  it('treats a missing currency as the target currency and skips junk', () => {
    const r = normalizePrices([{ amount: '12.5' }, { amount: null }, { amount: 'abc' }], 'USD');
    expect(r.values).toEqual([12.5]);
  });
});

describe('summarizePrices (the "$5218.94 avg" regression)', () => {
  it('keeps the median of a mixed-currency halloween sample under $200', () => {
    const s = summarizePrices(mixed, { currency: 'USD', fx: {} });
    expect(s.median).not.toBeNull();
    expect(s.median!).toBeLessThan(200);
    expect(s.p25!).toBeLessThanOrEqual(s.median!);
    expect(s.p75!).toBeGreaterThanOrEqual(s.median!);
    expect(s.excludedNoFx).toBe(3);
    expect(s.excludedImplausible).toBe(3); // two $9,999 + one $0.01
    expect(s.quality).toBe('ok');
    expect(s.max!).toBeLessThanOrEqual(2000);
  });

  it('still under $200 when JPY/INR are converted', () => {
    const s = summarizePrices(mixed, { currency: 'USD', fx: { JPY: 0.0067, INR: 0.012 } });
    expect(s.excludedNoFx).toBe(0);
    expect(s.median!).toBeLessThan(200);
  });

  it('enforces minimum n thresholds', () => {
    const four = summarizePrices([10, 12, 14, 16].map((amount) => ({ amount })), { currency: 'USD' });
    expect(four.quality).toBe('insufficient');
    const seven = summarizePrices([10, 12, 14, 16, 18, 20, 22].map((amount) => ({ amount })), { currency: 'USD' });
    expect(seven.quality).toBe('small');
    const twenty = summarizePrices(Array.from({ length: SMALL_SAMPLE }, (_, i) => ({ amount: 10 + i })), { currency: 'USD' });
    expect(twenty.quality).toBe('ok');
    expect(MIN_SAMPLE).toBe(5);
  });

  it('flags an unusual median instead of printing it', () => {
    const s = summarizePrices(Array.from({ length: 25 }, (_, i) => ({ amount: 700 + i })), { currency: 'USD' });
    expect(s.quality).toBe('implausible');
    expect(priceDisplay(s).value).toBe('—');
  });

  it('applies no bounds for non-USD without a rate, scaled bounds with one', () => {
    expect(boundsFor('TRY')).toBeNull();
    expect(boundsFor('TRY', 'physical', 40)!.max).toBe(80000);
    expect(isPlausible(5000, null)).toBe(true);
    expect(isPlausible(0.1, boundsFor('USD'))).toBe(false);
    expect(isPlausible(0.3, boundsFor('USD', 'digital'))).toBe(true);
  });
});

describe('priceDisplay', () => {
  const ok = summarizePrices(usd, { currency: 'USD' });
  it('shows median + band for ok samples', () => {
    const d = priceDisplay(ok, 'en-US');
    expect(d.value.startsWith('$')).toBe(true);
    expect(d.band).toMatch(/^\$.+–\$.+$/);
    expect(d.n).toBe(40);
  });
  it('shows range only for small samples and — for insufficient', () => {
    const small = summarizePrices(usd.slice(0, 8), { currency: 'USD' });
    expect(priceDisplay(small).value).toBe('—');
    expect(priceDisplay(small).band).not.toBeNull();
    expect(priceDisplay(null).value).toBe('—');
  });
  it('formats in the summary currency', () => {
    const d = priceDisplay(summarizePrices(usd.map((u) => ({ amount: u.amount * 40, currency: 'TRY' })), { currency: 'TRY' }), 'tr-TR');
    expect(d.value).toContain('₺');
  });
});

describe('groupMedian', () => {
  it('returns the median of a per-shop group', () => {
    expect(groupMedian([10, 20, 1000])).toBe(20);
    expect(groupMedian([])).toBeNull();
  });
});

describe('buildFxTable', () => {
  it('keeps only currencies the converter can price', async () => {
    const t = await buildFxTable(['JPY', 'usd', 'XXX', 'TL', null], 'USD', async (a, from) =>
      from === 'JPY' ? a * 0.0067 : from === 'TRY' ? a * 0.025 : null);
    expect(t).toEqual({ JPY: 0.0067, TRY: 0.025 });
  });
});

describe('decodeEntities', () => {
  it('decodes named, numeric and double-escaped entities', () => {
    expect(decodeEntities('Mom&#39;s &quot;Best&quot; Gift &amp; More')).toBe('Mom\'s "Best" Gift & More');
    expect(decodeEntities('Tom &amp;amp; Jerry')).toBe('Tom & Jerry');
    expect(decodeEntities('&#x2665; love')).toBe('♥ love');
    expect(decodeEntities('&unknown; stays')).toBe('&unknown; stays');
    expect(decodeEntities(null)).toBe('');
  });
});
