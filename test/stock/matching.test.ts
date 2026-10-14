import { describe, expect, it } from 'vitest';
import { buildMatchSuggestions, candidateKey, jaccard, titleTokens, type RemoteCandidate } from '@/lib/stock/matching';

function c(channel: string, externalId: string, sku: string | null, quantity: number, extra: Partial<RemoteCandidate> = {}): RemoteCandidate {
  return { channel, accountRef: 'acc', externalId, variantRef: '', sku, title: null, quantity, supportsWrite: true, ...extra };
}

describe('buildMatchSuggestions', () => {
  it('groups by normalized SKU (Turkish İ / case / spaces)', () => {
    const { groups } = buildMatchSuggestions([c('etsy', 'e1', 'kilim-İ1', 5), c('trendyol', 't1', 'KILIM-I1 ', 5), c('shopify', 's1', 'kilim-ı1', 4)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].channels).toEqual(['etsy', 'shopify', 'trendyol']);
    expect(groups[0].multiChannel).toBe(true);
    expect(groups[0].needsReview).toBe(false);
  });

  it('loose (folded) matches are suggestions only, never grouped', () => {
    const r = buildMatchSuggestions([c('etsy', 'e1', 'ŞAL-01', 3), c('trendyol', 't1', 'SAL01', 3)]);
    expect(r.groups.every((g) => g.members.length === 1)).toBe(true);
    expect(r.loose).toHaveLength(1);
    expect(r.loose[0].skus.sort()).toEqual(['SAL01', 'ŞAL-01']);
  });

  it('same SKU on several listings of one channel is a shared pool; differing numbers are a conflict', () => {
    const ok = buildMatchSuggestions([c('etsy', 'e1', 'A', 4), c('etsy', 'e2', 'A', 4), c('trendyol', 't1', 'A', 4)]).groups[0];
    expect(ok.sharedPoolChannels).toEqual(['etsy']);
    expect(ok.conflict).toBe(false);
    const bad = buildMatchSuggestions([c('etsy', 'e1', 'A', 4), c('etsy', 'e2', 'A', 2), c('trendyol', 't1', 'A', 4)]).groups[0];
    expect(bad.conflict).toBe(true);
    expect(bad.needsReview).toBe(true);
    expect(bad.reviewReasons).toContain('shared_pool_conflict');
  });

  it('review rules: zero, >= 100, ratio > 5', () => {
    expect(buildMatchSuggestions([c('etsy', 'e', 'Z', 0), c('trendyol', 't', 'Z', 3)]).groups[0].reviewReasons).toContain('zero');
    expect(buildMatchSuggestions([c('etsy', 'e', 'H', 100), c('trendyol', 't', 'H', 99)]).groups[0].reviewReasons).toContain('high');
    expect(buildMatchSuggestions([c('etsy', 'e', 'R', 1), c('trendyol', 't', 'R', 6)]).groups[0].reviewReasons).toContain('ratio');
    expect(buildMatchSuggestions([c('etsy', 'e', 'F', 1), c('trendyol', 't', 'F', 5)]).groups[0].needsReview).toBe(false);
  });

  it('already linked candidates are excluded', () => {
    const e = c('etsy', 'e1', 'A', 4);
    const r = buildMatchSuggestions([e, c('trendyol', 't1', 'A', 4)], { linkedKeys: new Set([candidateKey(e)]) });
    expect(r.groups[0].members).toHaveLength(1);
  });

  it('Etsy offerings without SKU get title suggestions against Trendyol/Shopify', () => {
    const r = buildMatchSuggestions([
      c('etsy', 'e1', null, 2, { title: 'Personalized Wooden Keepsake Box Engraved' }),
      c('trendyol', 't1', 'X1', 2, { title: 'Kişiye Özel Ahşap Keepsake Box Engraved Wooden' }),
      c('shopify', 's1', 'Y1', 2, { title: 'Baby Romper Cotton' }),
    ]);
    expect(r.unmatched).toHaveLength(1);
    expect(r.titles).toHaveLength(1);
    expect(r.titles[0].matches[0].candidate.externalId).toBe('t1');
  });
});

describe('title tokens', () => {
  it('folds Turkish letters and drops short / stop words', () => {
    expect(Array.from(titleTokens('Şık Çiçek ve Gül Kutusu')).sort()).toEqual(['CICEK', 'GUL', 'KUTUSU', 'SIK']);
    expect(jaccard(new Set(['A', 'B']), new Set(['B', 'C']))).toBeCloseTo(1 / 3);
  });
});
