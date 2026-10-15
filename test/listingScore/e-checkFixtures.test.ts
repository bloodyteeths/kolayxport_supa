// M6 editor Group E: one fixture per status of every Etsy and eBay check (listing-editor §4.4), including each
// `na` case, run through the same scorer the editor rail uses on the draft view.
import { describe, expect, it } from 'vitest';
import { etsyChecks, ETSY_IMPACT, type EtsyScoreInput } from '@/lib/listingScore/etsy';
import { ebayChecks, EBAY_IMPACT, type EbayScoreInput } from '@/lib/listingScore/ebay';
import type { CheckStatus } from '@/lib/listingScore/types';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const title = (n: number) => 'Personalized Baby Blanket, Custom Name Gift, '.padEnd(n, 'x').slice(0, n);
const tags = (n: number) => ['shower present', 'room decor', 'christening keepsake', 'new mom present', 'swaddle wrap', 'stroller cover', 'heirloom keepsake', 'grandchild present', 'crib accessory', 'first birthday', 'hospital photo prop', 'bassinet cover', 'gender reveal'].slice(0, n);

function etsyStatus(id: keyof typeof ETSY_IMPACT, input: EtsyScoreInput): CheckStatus {
  const c = etsyChecks(input).find((x) => x.id === id);
  if (!c) throw new Error(`missing ${id}`);
  return c.status;
}
function ebayStatus(id: keyof typeof EBAY_IMPACT, input: EbayScoreInput): CheckStatus {
  const c = ebayChecks(input).find((x) => x.id === id);
  if (!c) throw new Error(`missing ${id}`);
  return c.status;
}

type EtsyCase = [keyof typeof ETSY_IMPACT, CheckStatus, EtsyScoreInput];
const ETSY_CASES: EtsyCase[] = [
  ['photos_count', 'pass', { imageCount: 10 }],
  ['photos_count', 'warn', { imageCount: 5 }],
  ['photos_count', 'fail', { imageCount: 4 }],
  ['photos_count', 'na', {}],
  ['photos_alt', 'pass', { images: [{ alt: 'a' }] }],
  ['photos_alt', 'fail', { images: [{ alt: 'a' }, { alt: ' ' }] }],
  ['photos_alt', 'na', { imageCount: 3 }],
  ['photos_alt', 'na', { images: [] }],
  ['video', 'pass', { hasVideo: true }],
  ['video', 'warn', { hasVideo: false }],
  ['video', 'na', {}],
  ['title_length', 'pass', { title: title(100) }],
  ['title_length', 'pass', { title: title(140) }],
  ['title_length', 'warn', { title: title(70) }],
  ['title_length', 'fail', { title: title(69) }],
  ['title_length', 'fail', { title: title(141) }],
  ['title_length', 'na', {}],
  ['title_format', 'pass', { title: 'Personalized Baby Blanket, Custom Name Gift' }],
  ['title_format', 'na', { title: '' }],
  ['title_format', 'na', {}],
  ['tags_count', 'pass', { tags: tags(13) }],
  ['tags_count', 'warn', { tags: tags(10) }],
  ['tags_count', 'fail', { tags: tags(9) }],
  ['tags_count', 'na', {}],
  ['tags_quality', 'pass', { tags: tags(3), title: 'Personalized Baby Blanket' }],
  ['tags_quality', 'warn', { tags: ['blanket', 'shower present'], title: 'Personalized Baby Blanket' }],
  ['tags_quality', 'fail', { tags: ['blanket', 'baby', 'custom'], title: 'Personalized Baby Blanket' }],
  ['tags_quality', 'na', { tags: [] }],
  ['tags_quality', 'na', {}],
  ['description', 'pass', { title: 'Baby Blanket, Gift', description: `Baby blanket for you. ${words(170)}` }],
  ['description', 'warn', { title: 'Baby Blanket, Gift', description: words(170) }],
  ['description', 'fail', { title: 'Baby Blanket, Gift', description: 'Short.' }],
  ['description', 'na', {}],
  ['attributes', 'pass', { attributes: { required: 2, filled: 2 } }],
  ['attributes', 'fail', { attributes: { required: 2, filled: 1 } }],
  ['attributes', 'na', {}],
  ['materials', 'pass', { materials: ['cotton'] }],
  ['materials', 'warn', { materials: [] }],
  ['materials', 'na', {}],
  ['shipping_ready', 'pass', { shipping: { hasProfile: true, hasProcessing: true, hasWeight: true } }],
  ['shipping_ready', 'warn', { shipping: { hasProfile: true, hasProcessing: true, hasWeight: false } }],
  ['shipping_ready', 'warn', { shipping: { hasProfile: true, hasProcessing: false, hasWeight: true } }],
  ['shipping_ready', 'fail', { shipping: { hasProfile: false, hasProcessing: true, hasWeight: true } }],
  ['shipping_ready', 'na', {}],
  ['price_market', 'pass', { price: 45, market: { p25: 35, p75: 55 } }],
  ['price_market', 'warn', { price: 70, market: { p25: 35, p75: 55 } }],
  ['price_market', 'na', { price: 45 }],
  ['price_market', 'na', { market: { p25: 35, p75: 55 } }],
];

type EbayCase = [keyof typeof EBAY_IMPACT, CheckStatus, EbayScoreInput];
const ebayTitle = (n: number) => 'Vintage Brass Compass Nautical Pocket Gift '.padEnd(n, 'x').slice(0, n);
const EBAY_CASES: EbayCase[] = [
  ['photos_count', 'pass', { imageCount: 8 }],
  ['photos_count', 'warn', { imageCount: 4 }],
  ['photos_count', 'fail', { imageCount: 3 }],
  ['photos_count', 'na', {}],
  ['title_length', 'pass', { title: ebayTitle(60) }],
  ['title_length', 'pass', { title: ebayTitle(80) }],
  ['title_length', 'warn', { title: ebayTitle(40) }],
  ['title_length', 'fail', { title: ebayTitle(39) }],
  ['title_length', 'fail', { title: ebayTitle(81) }],
  ['title_length', 'na', {}],
  ['title_keywords', 'pass', { title: 'Acme Compass brass', aspects: { Brand: ['Acme'], Type: 'Compass' } }],
  ['title_keywords', 'warn', { title: 'Acme brass', aspects: { Brand: ['Acme'], Type: 'Compass' } }],
  ['title_keywords', 'fail', { title: 'Brass', aspects: { Brand: ['Acme'], Type: 'Compass' } }],
  ['title_keywords', 'na', { title: 'Brass', aspects: { Brand: ['Unbranded'] } }],
  ['title_keywords', 'na', { aspects: { Brand: ['Acme'] } }],
  ['aspects_required', 'pass', { aspectsRequired: { required: 3, filled: 3 } }],
  ['aspects_required', 'fail', { aspectsRequired: { required: 3, filled: 2 } }],
  ['aspects_required', 'na', {}],
  ['aspects_recommended', 'pass', { aspectsRecommended: { recommended: 10, filled: 7 } }],
  ['aspects_recommended', 'warn', { aspectsRecommended: { recommended: 10, filled: 4 } }],
  ['aspects_recommended', 'fail', { aspectsRecommended: { recommended: 10, filled: 3 } }],
  ['aspects_recommended', 'na', { aspectsRecommended: { recommended: 0, filled: 0 } }],
  ['aspects_recommended', 'na', {}],
  ['condition', 'pass', { condition: 'NEW' }],
  ['condition', 'pass', { condition: 'USED_GOOD', conditionDescription: 'Light wear' }],
  ['condition', 'warn', { condition: 'USED_GOOD', conditionDescription: '' }],
  ['condition', 'fail', { condition: '' }],
  ['condition', 'fail', { condition: null }],
  ['condition', 'na', {}],
  ['description', 'pass', { description: words(100) }],
  ['description', 'warn', { description: words(40) }],
  ['description', 'fail', { description: words(39) }],
  ['description', 'na', {}],
  ['category', 'pass', { category: { id: '123' } }],
  ['category', 'fail', { category: { id: '123', isLeaf: false } }],
  ['category', 'fail', { category: { id: null } }],
  ['category', 'na', {}],
  ['policies', 'pass', { policies: { fulfillment: true, payment: true, return: true } }],
  ['policies', 'warn', { policies: { fulfillment: true, payment: false, return: false } }],
  ['policies', 'fail', { policies: { fulfillment: false, payment: false, return: false } }],
  ['policies', 'na', {}],
  ['package', 'pass', { package: { hasWeight: true, hasDimensions: true } }],
  ['package', 'warn', { package: { hasWeight: false, hasDimensions: true } }],
  ['package', 'fail', { package: { hasWeight: false, hasDimensions: false } }],
  ['package', 'na', {}],
  ['price_market', 'pass', { price: 20, market: { p25: 10, p75: 30 } }],
  ['price_market', 'warn', { price: 5, market: { p25: 10, p75: 30 } }],
  ['price_market', 'na', { price: 20 }],
];

describe('Etsy checks: every status of every check (listing-editor §4.4)', () => {
  it.each(ETSY_CASES)('%s → %s', (id, status, input) => {
    expect(etsyStatus(id, input)).toBe(status);
  });

  it('every check id has a pass and an na fixture', () => {
    for (const id of Object.keys(ETSY_IMPACT)) {
      const statuses = new Set(ETSY_CASES.filter((c) => c[0] === id).map((c) => c[1]));
      expect(statuses.has('na'), `${id} na`).toBe(true);
      expect(statuses.has('pass'), `${id} pass`).toBe(true);
    }
  });

  it('price without research is na with the noResearch reason, never a warning (founder: no orange "No research data")', () => {
    const c = etsyChecks({ price: 45 }).find((x) => x.id === 'price_market');
    expect(c).toMatchObject({ status: 'na', naReason: 'listingScore.na.noResearch' });
  });
});

describe('eBay checks: every status of every check (listing-editor §4.4)', () => {
  it.each(EBAY_CASES)('%s → %s', (id, status, input) => {
    expect(ebayStatus(id, input)).toBe(status);
  });

  it('every check id has a pass and an na fixture', () => {
    for (const id of Object.keys(EBAY_IMPACT)) {
      const statuses = new Set(EBAY_CASES.filter((c) => c[0] === id).map((c) => c[1]));
      expect(statuses.has('na'), `${id} na`).toBe(true);
      expect(statuses.has('pass'), `${id} pass`).toBe(true);
    }
  });
});
