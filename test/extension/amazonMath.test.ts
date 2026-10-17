import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const M = require('../../chrome-extension/src/lib/amazonMath.js');

describe('parseCount (review / rating counts)', () => {
  it.each([
    ['(633)', 633],
    ['(15,234)', 15234],
    ['15,234 ratings', 15234],
    ['(1.2K)', 1200],
    ['(1,2K)', 1200],
    ['(15K)', 15000],
    ['2.5M', 2500000],
    ['1.234 Sternebewertungen', 1234],
    ['12.345 Bewertungen', 12345],
    ['1,2 Tsd.', 1200],
    ['3 412 évaluations', 3412],
    ['4', 4],
  ])('%s → %d', (input, expected) => {
    expect(M.parseCount(input)).toBe(expected);
  });

  it('Turkish "B" (bin) is a thousand only on amazon.com.tr', () => {
    expect(M.parseCount('1B+', { marketplace: 'TR' })).toBe(1000);
    expect(M.parseCount('1B+', { marketplace: 'US' })).toBe(1);
  });

  it('returns null without digits', () => {
    expect(M.parseCount('See options')).toBeNull();
    expect(M.parseCount(null)).toBeNull();
  });
});

describe('parsePrice', () => {
  it.each([
    ['$33.84', 33.84, 'USD'],
    ['$1,234.56', 1234.56, 'USD'],
    ['1.234,56 €', 1234.56, 'EUR'],
    ['12,99 €', 12.99, 'EUR'],
    ['£12.99', 12.99, 'GBP'],
    ['₺1.299,90', 1299.9, 'TRY'],
    ['1.299,90 TL', 1299.9, 'TRY'],
    ['$149', 149, 'USD'],
  ])('%s → %f %s', (input, value, currency) => {
    expect(M.parsePrice(input)).toEqual({ value, currency });
  });

  it('uses the fallback currency when no symbol is present', () => {
    expect(M.parsePrice('24,99', 'EUR')).toEqual({ value: 24.99, currency: 'EUR' });
  });

  it('rejects empty / zero', () => {
    expect(M.parsePrice('')).toBeNull();
    expect(M.parsePrice('$0.00')).toBeNull();
  });
});

describe('parseRating', () => {
  it.each([
    ['4.4 out of 5 stars', 4.4],
    ['4.4 out of 5 stars, rating details', 4.4],
    ['4,4 von 5 Sternen', 4.4],
    ['5 üzerinden 4,4 yıldız', 4.4],
    ['4.0', 4],
  ])('%s → %f', (input, expected) => {
    expect(M.parseRating(input)).toBe(expected);
  });

  it('never returns a review count as a rating', () => {
    expect(M.parseRating('(633)')).toBeNull();
  });
});

describe('parseBoughtPastMonth', () => {
  it('reads Amazon floors', () => {
    expect(M.parseBoughtPastMonth('5K+ bought in past month')).toEqual({ min: 5000, label: '5K+' });
    expect(M.parseBoughtPastMonth('100+ bought in past month')).toEqual({ min: 100, label: '100+' });
    expect(M.parseBoughtPastMonth('10K+ bought in past month')).toEqual({ min: 10000, label: '10K+' });
    expect(M.parseBoughtPastMonth('Über 1000 Mal im letzten Monat gekauft')).toEqual({ min: 1000, label: '1000+' });
    expect(M.parseBoughtPastMonth('Geçen ay 1B+ kez satın alındı', { marketplace: 'TR' })).toEqual({ min: 1000, label: '1B+' });
  });

  it('ignores unrelated text', () => {
    expect(M.parseBoughtPastMonth('(1.2K)')).toBeNull();
    expect(M.parseBoughtPastMonth('Save 5% with coupon')).toBeNull();
  });
});

describe('parseTotalResults', () => {
  it('reads "over" as a lower bound', () => {
    expect(M.parseTotalResults('1-48 of over 3,000 results for "turkish towel"')).toEqual({ total: 3000, isLowerBound: true });
    expect(M.parseTotalResults('1-48 von mehr als 3.000 Ergebnissen oder Vorschlägen für "handtuch"')).toEqual({ total: 3000, isLowerBound: true });
    expect(M.parseTotalResults('3.000 üzeri sonuç arasından 1-48 arası gösteriliyor')).toEqual({ total: 3000, isLowerBound: true });
  });

  it('reads exact counts and ignores digits in the query', () => {
    expect(M.parseTotalResults('1-16 of 216 results for "iphone 15 case"')).toEqual({ total: 216, isLowerBound: false });
  });
});

describe('parseBsrText', () => {
  it('parses en and de rank lines, top-level first', () => {
    expect(M.parseBsrText('#1,234 in Home & Kitchen (See Top 100 in Home & Kitchen) #5 in Bath Towels')).toEqual([
      { rank: 1234, category: 'Home & Kitchen' },
      { rank: 5, category: 'Bath Towels' },
    ]);
    expect(M.parseBsrText('Nr. 12.345 in Küche, Haushalt & Wohnen (Siehe Top 100) Nr. 7 in Badetücher')[0])
      .toEqual({ rank: 12345, category: 'Küche, Haushalt & Wohnen' });
  });
});

describe('computeCompetition', () => {
  // Shape of a real amazon.com "turkish towel" page: "over 3,000" results,
  // big incumbents with thousands of ratings, ~1/4 of cards are ads.
  const turkishTowelOrganic = [
    12843, 633, 4521, 2210, 389, 8907, 1544, 96, 3120, 712,
    15402, 241, 1876, 57, 960, 4410, 133, 2750, 18, 505,
    6240, 77, 1290, 340, 0, 2105, 451, 39, 1660, 812, 3340, 120, 25, 990, 5630, 270,
  ];

  it('turkish towel on amazon.com is High', () => {
    const r = M.computeCompetition({
      totalResults: 3000,
      organicReviewCounts: turkishTowelOrganic,
      sponsoredCount: 12,
      cardCount: 48,
    });
    expect(r.level).toBe('High');
    expect(r.score).toBeGreaterThanOrEqual(M.COMPETITION_CONFIG.high);
    expect(r.signals.top10MedianReviews).toBeGreaterThan(1000);
  });

  it('the old symptom (avg 68 reviews) cannot come out of correct counts', () => {
    expect(M.mean(turkishTowelOrganic)).toBeGreaterThan(1000);
  });

  it('a genuine long-tail niche is Low', () => {
    const r = M.computeCompetition({
      totalResults: 180,
      organicReviewCounts: [0, 2, 5, 14, 3, 0, 27, 8, 1, 0, 11, 6, 0, 4],
      sponsoredCount: 1,
      cardCount: 16,
    });
    expect(r.level).toBe('Low');
  });

  it('a middling market (top-10 median a few hundred ratings) is Medium', () => {
    const r = M.computeCompetition({
      totalResults: 2000,
      organicReviewCounts: [650, 320, 1200, 480, 210, 390, 900, 150, 560, 270, 95, 410, 60, 180],
      sponsoredCount: 5,
      cardCount: 30,
    });
    expect(r.level).toBe('Medium');
  });

  it('top-10 median under ~200 ratings reads Low (common Amazon "enterable niche" rule)', () => {
    const r = M.computeCompetition({
      totalResults: 1000,
      organicReviewCounts: [420, 180, 95, 260, 60, 310, 140, 75, 30, 220, 45, 12, 88, 150],
      sponsoredCount: 4,
      cardCount: 24,
    });
    expect(r.level).toBe('Low');
  });

  it('a deep review moat forces High even with few results', () => {
    const r = M.computeCompetition({
      totalResults: 120,
      organicReviewCounts: [5200, 3100, 1800, 2400, 1500, 900, 1300, 2600, 40, 30],
      sponsoredCount: 0,
      cardCount: 10,
    });
    expect(r.level).toBe('High');
  });

  it('is Unknown when fewer than 5 organic review counts were read', () => {
    const r = M.computeCompetition({ totalResults: 3000, organicReviewCounts: [10, 20], sponsoredCount: 0, cardCount: 2 });
    expect(r.level).toBe('Unknown');
    expect(r.score).toBeNull();
  });

  it('uses SP-API offer counts when present', () => {
    const base = { totalResults: 1000, organicReviewCounts: [120, 80, 60, 200, 90, 40, 150], sponsoredCount: 2, cardCount: 20 };
    const without = M.computeCompetition(base);
    const withOffers = M.computeCompetition({ ...base, offerCounts: [20, 25, 18, 30] });
    expect(withOffers.score).toBeGreaterThan(without.score);
    expect(withOffers.signals.medianOfferCount).toBe(22.5);
  });
});

describe('sales figures', () => {
  it("prefers Amazon's own bought-in-past-month floor", () => {
    const f = M.pickSalesFigure({ bought: { min: 5000, label: '5K+' }, price: 24.99, bsr: 900, bsrCategory: 'Home & Kitchen' });
    expect(f.kind).toBe('amazon');
    expect(f.units).toBe(5000);
    expect(f.revenueFloor).toBe(120000); // 124,950 rounded to 2 significant figures
  });

  it('falls back to a labelled BSR estimate with a range', () => {
    const f = M.pickSalesFigure({ price: 20, bsr: 1234, bsrCategory: 'Home & Kitchen', marketplace: 'US' });
    expect(f.kind).toBe('estimate');
    expect(f.curve).toBe('Home & Kitchen');
    // 8000 * 1234^-0.6 ≈ 113.6 → 110 (2 sig. figs)
    expect(f.units).toBe(110);
    expect(f.low).toBeLessThan(f.units);
    expect(f.high).toBeGreaterThan(f.units);
    expect(f.calibrated).toBe(true);
  });

  it('flags non-US estimates as uncalibrated', () => {
    expect(M.estimateSalesFromBsr(1234, 'Küche, Haushalt & Wohnen', 'DE').calibrated).toBe(false);
  });

  it('returns nothing rather than inventing a number', () => {
    expect(M.pickSalesFigure({ price: 20 })).toEqual({ kind: 'none' });
  });
});

describe('formatting', () => {
  it('formats compact money per currency', () => {
    expect(M.formatMoney(3300, 'USD', true)).toBe('$3.3K');
    expect(M.formatMoney(1234.5, 'EUR')).toBe('€1234.50');
    expect(M.formatCompact(15234)).toBe('15K');
  });

  it('escapes HTML', () => {
    expect(M.escapeHtml('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  });
});
