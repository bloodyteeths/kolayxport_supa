import { describe, expect, it } from 'vitest';
import {
  HEALTH_FILTER_TOKEN,
  healthFailTokens,
  scoreCacheRow,
  scoreListing,
  toHealthColumns,
} from '@/lib/listingScore';
import { scoreEtsyListing } from '@/lib/listingScore/etsy';
import { finalizeScore } from '@/lib/listingScore/types';

describe('scoreListing dispatch', () => {
  it('matches the marketplace scorer', () => {
    const input = { title: 'Short title', tags: ['a b'], imageCount: 2, hasVideo: false };
    expect(scoreListing(input, 'etsy')).toEqual(scoreEtsyListing(input));
    expect(scoreListing({ imageCount: 0 }, 'shopify').checks.find((c) => c.id === 'photos_count')?.status).toBe('fail');
  });

  it('throws on an unknown marketplace', () => {
    expect(() => scoreListing({} as never, 'amazon' as never)).toThrow(/unknown marketplace/);
  });
});

describe('healthFailTokens', () => {
  it('lists warn/fail check ids and derives title_short', () => {
    const r = scoreEtsyListing({ title: 'Baby blanket', tags: [], imageCount: 2, hasVideo: false });
    const tokens = healthFailTokens(r);
    expect(tokens).toContain(HEALTH_FILTER_TOKEN.missing_photos);
    expect(tokens).toContain(HEALTH_FILTER_TOKEN.missing_tags);
    expect(tokens).toContain(HEALTH_FILTER_TOKEN.no_video);
    expect(tokens).toContain(HEALTH_FILTER_TOKEN.short_title);
    expect(tokens).toContain('title_length');
    // sorted + unique
    expect([...tokens].sort()).toEqual(tokens);
  });

  it('a long title is not short', () => {
    const r = scoreEtsyListing({ title: 'x '.repeat(80) });
    expect(healthFailTokens(r)).toContain('title_length');
    expect(healthFailTokens(r)).not.toContain('title_short');
  });

  it('ignores peer checks and na', () => {
    const r = finalizeScore([
      { id: 'a', label: 'l', status: 'pass', impact: 50 },
      { id: 'b', label: 'l', status: 'na', impact: 50 },
      { id: 'price_vs_peers', label: 'l', status: 'fail', impact: 7, group: 'peers' },
    ]);
    expect(healthFailTokens(r)).toEqual([]);
  });
});

describe('toHealthColumns', () => {
  it('stores null for unscored rows', () => {
    expect(toHealthColumns(scoreListing({}, 'wix'))).toEqual({
      healthScore: null, healthChecksUsed: 0, healthChecksTotal: 4, healthFails: [],
    });
  });

  it('stores score, denominator and tokens', () => {
    const cols = toHealthColumns(scoreCacheRow({
      title: 'Organic Cotton Baby Romper', description: '', images: null, imageCount: 0,
      seoTitle: null, seoDescription: null, tags: [],
    }, 'shopify'));
    expect(cols.healthChecksUsed).toBe(4);
    expect(cols.healthChecksTotal).toBe(6);
    expect(cols.healthScore).toBe(Math.round((15 / 75) * 100));
    expect(cols.healthFails).toEqual(['description', 'photos_count', 'tags_count']);
  });
});
