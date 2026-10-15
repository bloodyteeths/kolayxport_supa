import { describe, expect, it } from 'vitest';
import { bandFor, finalizeScore, sortChecks, TRENDYOL_GRADE_SCORE, type Check } from '@/lib/listingScore/types';
import { ETSY_IMPACT, etsyChecks, leadMentionsTitle, scoreEtsyListing, type EtsyScoreInput } from '@/lib/listingScore/etsy';

const goodTitle =
  'Personalized Baby Name Blanket, Custom Newborn Gift for Girls and Boys, Soft Knit Nursery Throw with Embroidered Letters';
const tags13 = [
  'shower present', 'room decor', 'christening keepsake', 'new mom present', 'swaddle wrap',
  'stroller cover', 'heirloom keepsake', 'grandchild present', 'crib accessory', 'first birthday',
  'hospital photo prop', 'bassinet cover', 'gender reveal',
];
const longDesc = `Personalized baby name blanket made to order. ${'Soft cotton knit with your chosen name embroidered by hand in our workshop. '.repeat(14)}`;

const full: EtsyScoreInput = {
  title: goodTitle,
  description: longDesc,
  tags: tags13,
  images: Array.from({ length: 10 }, () => ({ alt: 'Baby blanket with name' })),
  hasVideo: true,
  materials: ['cotton'],
  attributes: { required: 3, filled: 3 },
  shipping: { hasProfile: true, hasProcessing: true, hasWeight: true },
  price: 45,
  market: { p25: 35, p75: 55 },
};

describe('listingScore types', () => {
  it('bands follow DS §3.10', () => {
    expect(bandFor(0)).toBe('needs_work');
    expect(bandFor(49)).toBe('needs_work');
    expect(bandFor(50)).toBe('fair');
    expect(bandFor(74)).toBe('fair');
    expect(bandFor(75)).toBe('good');
    expect(bandFor(89)).toBe('good');
    expect(bandFor(90)).toBe('great');
    expect(bandFor(100)).toBe('great');
  });

  it('Trendyol letters convert per DS', () => {
    expect(TRENDYOL_GRADE_SCORE['A+']).toBe(97);
    expect(TRENDYOL_GRADE_SCORE.F).toBe(40);
  });

  it('na and peer checks leave the denominator; gain is the score delta of a fix', () => {
    const checks: Check[] = [
      { id: 'a', label: 'x', status: 'pass', impact: 50 },
      { id: 'b', label: 'x', status: 'fail', impact: 30 },
      { id: 'c', label: 'x', status: 'warn', impact: 20 },
      { id: 'd', label: 'x', status: 'na', impact: 40 },
      { id: 'p', label: 'x', status: 'fail', impact: 10, group: 'peers' },
    ];
    const r = finalizeScore(checks);
    expect(r.checksUsed).toBe(3);
    expect(r.checksTotal).toBe(4);
    expect(r.score).toBe(60); // (50 + 0 + 10) / 100
    expect(r.checks.find((c) => c.id === 'b')?.gain).toBe(30);
    expect(r.checks.find((c) => c.id === 'c')?.gain).toBe(10);
    expect(r.checks.find((c) => c.id === 'd')?.gain).toBe(0);
    expect(r.checks.find((c) => c.id === 'p')?.gain).toBe(0);
  });

  it('no usable checks → score 0 with checksUsed 0', () => {
    const r = finalizeScore([{ id: 'a', label: 'x', status: 'na', impact: 10 }]);
    expect(r).toMatchObject({ score: 0, checksUsed: 0, checksTotal: 1 });
  });

  it('sortChecks: open by gain, then passes, then na', () => {
    const r = finalizeScore([
      { id: 'pass', label: 'x', status: 'pass', impact: 10 },
      { id: 'na', label: 'x', status: 'na', impact: 10 },
      { id: 'small', label: 'x', status: 'fail', impact: 5 },
      { id: 'big', label: 'x', status: 'fail', impact: 20 },
    ]);
    expect(sortChecks(r.checks).map((c) => c.id)).toEqual(['big', 'small', 'pass', 'na']);
  });
});

describe('lib/listingScore/etsy', () => {
  it('impacts sum to 100 and every check id is emitted once', () => {
    expect(Object.values(ETSY_IMPACT).reduce((a, b) => a + b, 0)).toBe(100);
    const ids = etsyChecks(full).map((c) => c.id);
    expect(ids.sort()).toEqual(Object.keys(ETSY_IMPACT).sort());
  });

  it('a complete, healthy listing scores great on 12 of 12 checks', () => {
    const r = scoreEtsyListing(full);
    expect(r.checksUsed).toBe(12);
    expect(r.checksTotal).toBe(12);
    expect(r.band).toBe('great');
    expect(r.checks.filter((c) => c.status !== 'pass').map((c) => c.id)).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('missing research data makes price_market n/a (scored on 11 of 12)', () => {
    const r = scoreEtsyListing({ ...full, market: null });
    const pm = r.checks.find((c) => c.id === 'price_market');
    expect(pm?.status).toBe('na');
    expect(pm?.naReason).toBe('listingScore.na.noResearch');
    expect(r.checksUsed).toBe(11);
    expect(r.checksTotal).toBe(12);
  });

  it('cache rows without images/video/attributes/shipping score on the checks they have', () => {
    const r = scoreEtsyListing({ title: goodTitle, tags: tags13, description: longDesc, materials: [] });
    const na = r.checks.filter((c) => c.status === 'na').map((c) => c.id).sort();
    expect(na).toEqual(['attributes', 'photos_alt', 'photos_count', 'price_market', 'shipping_ready', 'video']);
    expect(r.checksUsed).toBe(6);
    expect(r.checks.find((c) => c.id === 'materials')?.status).toBe('warn');
  });

  it('thresholds: photos, title length, tags count', () => {
    const r = scoreEtsyListing({
      ...full,
      images: Array.from({ length: 6 }, () => ({ alt: '' })),
      title: 'Personalized Baby Blanket, Custom Name Gift',
      tags: tags13.slice(0, 9),
    });
    const by = (id: string) => r.checks.find((c) => c.id === id);
    expect(by('photos_count')).toMatchObject({ status: 'warn', label: 'listingScore.etsy.photosCount.low', params: { count: 6, missing: 4 } });
    expect(by('photos_alt')).toMatchObject({ status: 'fail', params: { count: 6 } });
    expect(by('title_length')).toMatchObject({ status: 'fail', label: 'listingScore.etsy.titleLength.short' });
    expect(by('tags_count')).toMatchObject({ status: 'fail', params: { count: 9, max: 13 } });
    expect(r.band).not.toBe('great');
    expect(by('photos_count')?.fix).toEqual({ label: 'listingScore.fix.addPhotos', field: 'photos' });
  });

  it('over 140 characters fails title_length with the long label', () => {
    const r = scoreEtsyListing({ ...full, title: `${goodTitle}, Extra Words To Push It Over The Limit` });
    expect(r.checks.find((c) => c.id === 'title_length')).toMatchObject({ status: 'fail', label: 'listingScore.etsy.titleLength.long' });
  });

  it('tags that repeat title words are weak', () => {
    const r = scoreEtsyListing({ ...full, tags: [...tags13.slice(0, 10), 'baby blanket', 'name blanket', 'newborn gift'] });
    expect(r.checks.find((c) => c.id === 'tags_quality')).toMatchObject({ status: 'fail', params: { count: 3 } });
    const w = scoreEtsyListing({ ...full, tags: [...tags13.slice(0, 12), 'baby blanket'] });
    expect(w.checks.find((c) => c.id === 'tags_quality')).toMatchObject({ status: 'warn', params: { count: 1 } });
  });

  it('description: words and lead keywords', () => {
    expect(leadMentionsTitle(goodTitle, longDesc)).toBe(true);
    expect(leadMentionsTitle(goodTitle, 'Hello there. We make nice things for you.')).toBe(false);
    const r = scoreEtsyListing({ ...full, description: 'Personalized baby name blanket, short text.' });
    expect(r.checks.find((c) => c.id === 'description')).toMatchObject({ status: 'warn', label: 'listingScore.etsy.description.short' });
  });

  it('shipping: profile missing fails, weight missing warns', () => {
    const a = scoreEtsyListing({ ...full, shipping: { hasProfile: false, hasProcessing: true, hasWeight: true } });
    const b = scoreEtsyListing({ ...full, shipping: { hasProfile: true, hasProcessing: true, hasWeight: false } });
    expect(a.checks.find((c) => c.id === 'shipping_ready')?.status).toBe('fail');
    expect(b.checks.find((c) => c.id === 'shipping_ready')).toMatchObject({ status: 'warn', label: 'listingScore.etsy.shipping.noWeight' });
  });

  it('price outside the p25–p75 band warns', () => {
    const r = scoreEtsyListing({ ...full, price: 80 });
    expect(r.checks.find((c) => c.id === 'price_market')?.status).toBe('warn');
  });

  it('every fix stages or focuses, never pushes (action ids are proposal actions)', () => {
    const actions = etsyChecks(full).map((c) => c.fix?.action).filter(Boolean);
    for (const a of actions) expect(a).not.toMatch(/push|send|sync/i);
  });
});
