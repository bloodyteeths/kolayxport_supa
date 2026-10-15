import { describe, expect, it } from 'vitest';
import { ETSY_IMPACT, etsyInputFromCache, scoreEtsyListing } from '@/lib/listingScore/etsy';
import { EBAY_IMPACT, ebayInputFromCache, isUsedCondition, normalizeEbayCondition, scoreEbayListing } from '@/lib/listingScore/ebay';
import { TRENDYOL_IMPACT, scoreTrendyolProduct, trendyolInputFromCache } from '@/lib/listingScore/trendyol';
import { WIX_ALL_PRODUCTS_COLLECTION, WIX_IMPACT, scoreWixProduct, wixInputFromCache } from '@/lib/listingScore/wix';
import { SHOPIFY_IMPACT, scoreShopifyProduct, shopifyInputFromCache } from '@/lib/listingScore/shopify';
import type { Check, ScoreResult } from '@/lib/listingScore/types';

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const byId = (r: ScoreResult, id: string): Check => {
  const c = r.checks.find((x) => x.id === id);
  if (!c) throw new Error(`missing check ${id}`);
  return c;
};

describe('impacts sum to 100 for every marketplace', () => {
  it.each([
    ['etsy', ETSY_IMPACT],
    ['ebay', EBAY_IMPACT],
    ['trendyol', TRENDYOL_IMPACT],
    ['wix', WIX_IMPACT],
    ['shopify', SHOPIFY_IMPACT],
  ])('%s', (_m, impact) => {
    expect(sum(impact as Record<string, number>)).toBe(100);
  });
});

describe('every check carries an i18n label and a fix', () => {
  const results: Array<[string, ScoreResult]> = [
    ['etsy', scoreEtsyListing({})],
    ['ebay', scoreEbayListing({})],
    ['trendyol', scoreTrendyolProduct({})],
    ['wix', scoreWixProduct({})],
    ['shopify', scoreShopifyProduct({})],
  ];
  it.each(results)('%s: empty input is all na and unscored', (_m, r) => {
    expect(r.checksUsed).toBe(0);
    expect(r.score).toBe(0);
    for (const c of r.checks) {
      expect(c.status).toBe('na');
      expect(c.label).toMatch(/^listingScore\./);
      expect(c.naReason).toMatch(/^listingScore\.na\./);
      expect(c.fix?.label).toMatch(/^listingScore\.fix\./);
    }
  });
});

describe('etsy cache adapter', () => {
  const row = {
    title: 'Personalized Baby Blanket, Custom Name Blanket for Newborn, Soft Knit Baby Shower Gift, Nursery Keepsake Present',
    description: 'Personalized baby blanket with a custom name. '.repeat(30),
    tags: Array.from({ length: 13 }, (_, i) => `gift idea ${i}`),
    materials: ['cotton'],
    priceAmount: 4999,
    priceDivisor: 100,
    imageCount: 10,
    hasVideo: true,
    shippingProfileId: BigInt(123),
    processingMin: null,
    itemWeight: 0.5,
  };

  it('maps cache fields and leaves alt text, attributes and market as na', () => {
    const input = etsyInputFromCache(row);
    expect(input.price).toBeCloseTo(49.99);
    expect(input.shipping).toEqual({ hasProfile: true, hasProcessing: true, hasWeight: true });
    const r = scoreEtsyListing(input);
    expect(byId(r, 'photos_alt').status).toBe('na');
    expect(byId(r, 'attributes').status).toBe('na');
    expect(byId(r, 'price_market').status).toBe('na');
    expect(byId(r, 'photos_count').status).toBe('pass');
    expect(byId(r, 'shipping_ready').status).toBe('pass');
    expect(r.checksTotal).toBe(12);
    expect(r.checksUsed).toBe(9);
  });

  it('no shipping profile fails shipping', () => {
    const r = scoreEtsyListing(etsyInputFromCache({ ...row, shippingProfileId: null, itemWeight: null }));
    expect(byId(r, 'shipping_ready').status).toBe('fail');
  });
});

describe('ebay', () => {
  const base = {
    title: 'Apple iPhone 13 Pro 128GB Graphite Unlocked Smartphone Excellent Condition Box',
    description: 'word '.repeat(120),
    imageCount: 8,
    aspects: { Brand: ['Apple'], Type: ['Smartphone'] },
    condition: 'NEW',
    category: { id: '9355' },
    policies: { fulfillment: true, payment: true, return: true },
    package: { hasWeight: true, hasDimensions: true },
  };

  it('a complete cached listing passes every known check', () => {
    const r = scoreEbayListing(base);
    expect(r.score).toBe(100);
    expect(byId(r, 'aspects_required').status).toBe('na');
    expect(byId(r, 'price_market').status).toBe('na');
  });

  it('title thresholds: 60–80 pass, 40–59 warn, > 80 fail', () => {
    expect(byId(scoreEbayListing({ ...base, title: 'x'.repeat(70) }), 'title_length').status).toBe('pass');
    expect(byId(scoreEbayListing({ ...base, title: 'x'.repeat(50) }), 'title_length').status).toBe('warn');
    expect(byId(scoreEbayListing({ ...base, title: 'x'.repeat(81) }), 'title_length').status).toBe('fail');
  });

  it('title keywords from Brand/Type aspects; Unbranded is ignored', () => {
    const miss = scoreEbayListing({ ...base, title: 'Graphite phone 128GB' });
    expect(byId(miss, 'title_keywords').status).toBe('fail');
    const unbranded = scoreEbayListing({ ...base, aspects: { Brand: ['Unbranded'] } });
    expect(byId(unbranded, 'title_keywords').status).toBe('na');
  });

  it('normalizes legacy condition ids and display text before the used-note rule', () => {
    expect(isUsedCondition('1000')).toBe(false);
    expect(isUsedCondition('1500')).toBe(false);
    expect(isUsedCondition('2500')).toBe(false);
    expect(isUsedCondition('2750')).toBe(false);
    expect(isUsedCondition('3000')).toBe(true);
    expect(isUsedCondition('Like New')).toBe(false);
    expect(isUsedCondition('New other (see details)')).toBe(false);
    expect(isUsedCondition('Certified - Refurbished')).toBe(false);
    expect(isUsedCondition('Open box')).toBe(false);
    expect(isUsedCondition('Pre-owned')).toBe(true);
    expect(isUsedCondition('Used')).toBe(true);
    expect(normalizeEbayCondition('like-new')).toBe('LIKE_NEW');
    const legacyNew = scoreEbayListing({ ...base, condition: '1000', conditionDescription: '' });
    expect(byId(legacyNew, 'condition').status).toBe('pass');
    const legacyLikeNew = scoreEbayListing({ ...base, condition: 'Like New', conditionDescription: '' });
    expect(byId(legacyLikeNew, 'condition').status).toBe('pass');
  });

  it('used items without a condition note warn', () => {
    expect(isUsedCondition('USED_GOOD')).toBe(true);
    expect(isUsedCondition('NEW_OTHER')).toBe(false);
    const r = scoreEbayListing({ ...base, condition: 'USED_GOOD', conditionDescription: '' });
    expect(byId(r, 'condition').status).toBe('warn');
  });

  it('cache adapter: legacy rows keep policies and package na', () => {
    const row = {
      title: base.title, description: base.description, imageCount: 2, imageUrls: ['a', 'b', 'c'], aspects: base.aspects,
      condition: 'NEW', conditionDescription: null, categoryId: '9355', fulfillmentPolicyId: null, paymentPolicyId: null,
      returnPolicyId: null, weightValue: null, lengthValue: null, widthValue: null, heightValue: null, priceValue: '12.50',
      isLegacy: true,
    };
    const input = ebayInputFromCache(row);
    expect(input.imageCount).toBe(3);
    expect(input.price).toBe(12.5);
    const r = scoreEbayListing(input);
    expect(byId(r, 'policies').status).toBe('na');
    expect(byId(r, 'package').status).toBe('na');
    const modern = scoreEbayListing(ebayInputFromCache({ ...row, isLegacy: false }));
    expect(byId(modern, 'policies').status).toBe('fail');
    expect(byId(modern, 'package').status).toBe('fail');
  });
});

describe('trendyol (port of calculateTrendyolHealth)', () => {
  const row = {
    title: 'Kadın Pamuklu Oversize Basic Tişört Beyaz Yuvarlak Yaka Kısa Kollu Günlük Yazlık Model Marka',
    brandName: 'Marka',
    categoryName: 'Kadın Tişört',
    description: 'a'.repeat(320),
    images: [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }, { url: 'e' }],
    imageCount: 0,
    attributes: [1, 2, 3, 4, 5],
    listPrice: '199.90',
    salePrice: '149.90',
    quantity: 4,
    approved: true,
    rejected: false,
    blacklisted: false,
    dimensionalWeight: 1,
  };

  it('a product that maxes every legacy factor scores 100', () => {
    const r = scoreTrendyolProduct(trendyolInputFromCache(row));
    expect(r.checksUsed).toBe(10);
    expect(r.score).toBe(100);
  });

  it('rejected and blacklisted fail not_rejected', () => {
    const r = scoreTrendyolProduct(trendyolInputFromCache({ ...row, rejected: true }));
    expect(byId(r, 'not_rejected').status).toBe('fail');
    expect(byId(r, 'not_rejected').label).toBe('listingScore.trendyol.approval.rejected');
    const pending = scoreTrendyolProduct(trendyolInputFromCache({ ...row, approved: false }));
    expect(byId(pending, 'not_rejected').label).toBe('listingScore.trendyol.approval.pending');
  });

  it('price sanity: equal prices warn, no sale price fails', () => {
    expect(byId(scoreTrendyolProduct(trendyolInputFromCache({ ...row, listPrice: '149.90' })), 'price_sanity').status).toBe('warn');
    expect(byId(scoreTrendyolProduct(trendyolInputFromCache({ ...row, salePrice: null })), 'price_sanity').status).toBe('fail');
  });

  it('no brand → title_brand na (leaves the denominator)', () => {
    const r = scoreTrendyolProduct(trendyolInputFromCache({ ...row, brandName: null }));
    expect(byId(r, 'title_brand').status).toBe('na');
    expect(r.checksUsed).toBe(9);
  });

  it('weak product lands in needs work', () => {
    const r = scoreTrendyolProduct(trendyolInputFromCache({
      ...row, title: 'Tişört', description: null, images: null, attributes: null, salePrice: null, quantity: 0, dimensionalWeight: null,
    }));
    expect(r.band).toBe('needs_work');
  });
});

describe('wix (port of calculateHealth)', () => {
  it('All Products collection does not count', () => {
    const input = wixInputFromCache({
      title: 'Handmade Ceramic Coffee Mug with Glazed Finish',
      description: '<p>' + 'text '.repeat(120) + '</p>',
      images: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      imageCount: 10,
      collectionIds: [WIX_ALL_PRODUCTS_COLLECTION],
    });
    expect(input.collectionCount).toBe(0);
    const r = scoreWixProduct(input);
    expect(byId(r, 'collections').status).toBe('fail');
    expect(r.score).toBe(75);
    const withCol = scoreWixProduct({ ...input, collectionCount: 1 });
    expect(withCol.score).toBe(100);
  });

  it('titles over the 80-char Wix cap warn', () => {
    expect(byId(scoreWixProduct({ title: 'x'.repeat(81) }), 'title_length').status).toBe('warn');
    expect(byId(scoreWixProduct({ title: 'x'.repeat(10) }), 'title_length').status).toBe('fail');
  });
});

describe('shopify (new)', () => {
  it('empty cached SEO fields are na, saved ones are scored', () => {
    const row = {
      title: 'Organic Cotton Baby Romper', description: '<p>' + 'soft '.repeat(80) + '</p>',
      images: [{}, {}, {}], imageCount: 3, seoTitle: null, seoDescription: null, tags: ['baby', 'romper', 'organic'],
    };
    const r = scoreShopifyProduct(shopifyInputFromCache(row));
    expect(byId(r, 'seo_title').status).toBe('na');
    expect(byId(r, 'seo_description').status).toBe('na');
    expect(r.score).toBe(100);
    const saved = scoreShopifyProduct(shopifyInputFromCache({ ...row, seoTitle: 'x'.repeat(90), seoDescription: 'short' }));
    expect(byId(saved, 'seo_title').status).toBe('warn');
    expect(byId(saved, 'seo_description').status).toBe('warn');
  });

  it('explicitly empty SEO fields warn, never fail', () => {
    const r = scoreShopifyProduct({ seoTitle: '', seoDescription: null });
    expect(byId(r, 'seo_title').status).toBe('warn');
    expect(byId(r, 'seo_description').status).toBe('warn');
  });

  it('no photos and no tags fail', () => {
    const r = scoreShopifyProduct({ imageCount: 0, tags: [] });
    expect(byId(r, 'photos_count').status).toBe('fail');
    expect(byId(r, 'tags_count').status).toBe('fail');
  });
});
