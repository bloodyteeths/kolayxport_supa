// eBay "Fill from photos" fixes (2026-10-18, tutorial run on a photo of a NEW handmade Iznik bowl):
//  1. prompts carry the "only visible / given attributes" rule (the title had invented "Raised Pattern"),
//  2. condition defaults to NEW unless wear is visible or the seller says used, valid for the category,
//  3. the category name travels with the id (the field showed "Category #262366" instead of "Bowls"),
//  4. the description field gets plain text; eBay gets HTML when the listing is sent.
// Shapes below are the real captured responses (kx-gtm scripts/tutorials/fixtures/ebay-create/), trimmed.
import { afterEach, describe, expect, it } from 'vitest';
import {
  UNIVERSAL_CONDITIONS,
  conditionForCategory,
  descriptionToEbayHtml,
  ebayHtmlToText,
  isNewCondition,
  looksLikeHtml,
  resolveAiCondition,
  sellerSaysUsed,
} from '@/lib/ebay/payloadRules';
import { GROUNDING_RULES, conditionLine, generateDescriptionPrompt, identifyProductPrompt, optimizeTitlePrompt } from '@/lib/ebay/aiPrompts';
import { buildCreatePlan, withHtmlDescriptions } from '@/lib/ebay/draftPlan';
import { legacyChanges } from '@/lib/ebay/legacyTrading';
import { fillResearchQuery, sanitizeDescription } from '@/components/domain/listing-editor/useListingAI';
import { dropPlaceholderAspects, isPlaceholderAspectValue, sellerFactsLine, suggestAspectsPrompt } from '@/lib/ebay/aiPrompts';
import { clearEbayCategoryLabels, ebayCategoryLabel, rememberEbayCategoryLabel, rememberEbayCategoryLabels } from '@/components/domain/listing-editor/ebayCategoryLabels';
import { ebayPreviewModel } from '@/components/domain/listing-editor/sections/EbayFieldSections';
import { blankEbayFields } from '@/components/domain/listing-editor/adapters/ebay';
import type { FieldMap, ListingView } from '@/lib/listingEditor/types';

const IDENTIFY = {
  seed: 'handmade Turkish ceramic bowl blue tulip floral Iznik style pottery',
  productName: 'Ceramic decorative bowl',
  keywords: ['turkish bowl', 'iznik pottery'],
  suggestedCondition: 'LIKE_NEW',
  notes: '',
};

const AI_HTML = `<div style="font-family: Arial, sans-serif; line-height: 1.6;">
  <h2 style="color: #0c4a6e;">Handmade Turkish Iznik Ceramic Floral Bowl</h2>

  <p>Bring authentic artisan craftsmanship into your home with this <strong>Turkish Iznik Ceramic Bowl</strong>.</p>

  <h3 style="color: #0c4a6e;">Key Features &amp; Specifications</h3>
  <ul style="list-style-type: square;">
    <li><strong>Origin:</strong> Turkish handmade and hand-painted pottery</li>
    <li><strong>Color Palette:</strong> Rich cobalt blue, light blue, and white</li>
  </ul>
</div>`;

// ── 1. Prompts ────────────────────────────────────────────────────────────────────────────────────────────────

describe('eBay AI prompts: only visible or given attributes', () => {
  it('title, description and identify prompts all carry the grounding rule', () => {
    expect(GROUNDING_RULES).toMatch(/Only state attributes that are visible in the photos or given in the input/);
    expect(GROUNDING_RULES).toMatch(/Never invent materials, techniques, .*dimensions/);
    expect(GROUNDING_RULES).toMatch(/NOT facts about this item/);
    for (const hasResearch of [true, false]) {
      expect(optimizeTitlePrompt({ hasResearch })).toContain(GROUNDING_RULES);
      expect(generateDescriptionPrompt({ hasResearch, format: 'text' })).toContain(GROUNDING_RULES);
      expect(generateDescriptionPrompt({ hasResearch, format: 'html' })).toContain(GROUNDING_RULES);
    }
    expect(optimizeTitlePrompt({ hasResearch: true })).toMatch(/never add a new material, technique, size or feature/);
    expect(identifyProductPrompt('eBay')).toMatch(/Only name attributes you can clearly see/);
  });

  it('identify asks for visible wear and NEW by default (a clean item is not LIKE_NEW)', () => {
    const p = identifyProductPrompt('eBay');
    expect(p).toContain('"wearVisible"');
    expect(p).toMatch(/"suggestedCondition" is NEW unless "wearVisible" is true/);
    expect(p).toMatch(/merely looks unused is NEW, not LIKE_NEW/);
  });

  it('description: a New item is never described as used, no condition section without a condition', () => {
    const p = generateDescriptionPrompt({ hasResearch: false, format: 'text' });
    expect(p).toMatch(/If the condition is New, call the item new and unused, and never write "excellent condition"/);
    expect(p).toMatch(/If no condition is given, write no condition section/);
    expect(p).toMatch(/PLAIN TEXT, no HTML/);
    expect(generateDescriptionPrompt({ hasResearch: false, format: 'html' })).toMatch(/semantic HTML/);
    expect(conditionLine('NEW')).toBe('Condition: New: brand-new, unused');
    expect(conditionLine('USED_GOOD')).toMatch(/pre-owned/);
    expect(conditionLine('')).toBe('');
    expect(conditionLine(undefined)).toBe('');
  });
});

// ── 2. Condition ─────────────────────────────────────────────────────────────────────────────────────────────

describe('AI condition: NEW by default, valid for the category', () => {
  it('the captured LIKE_NEW for a clean new bowl becomes NEW', () => {
    expect(resolveAiCondition({ suggested: IDENTIFY.suggestedCondition })).toBe('NEW');
    expect(resolveAiCondition({ suggested: 'LIKE_NEW', wearVisible: false })).toBe('NEW');
    expect(resolveAiCondition({ suggested: 'GOOD' })).toBe('NEW');
    expect(resolveAiCondition({})).toBe('NEW');
  });

  it('visible wear keeps a used grade, mapped to one the category accepts', () => {
    // No category list: the universal set (USED_GOOD is media-only → the nearest allowed used grade).
    expect(resolveAiCondition({ suggested: 'GOOD', wearVisible: true })).toBe('USED_EXCELLENT');
    expect(resolveAiCondition({ suggested: 'NEW', wearVisible: true })).toBe('USED_EXCELLENT');
    const books = ['NEW', 'LIKE_NEW', 'USED_VERY_GOOD', 'USED_GOOD', 'USED_ACCEPTABLE'];
    expect(resolveAiCondition({ suggested: 'GOOD', wearVisible: true, allowed: books })).toBe('USED_GOOD');
    expect(resolveAiCondition({ suggested: 'VERY_GOOD', wearVisible: true, allowed: books })).toBe('USED_VERY_GOOD');
  });

  it("the seller's own words decide too (\"never used\" is not used)", () => {
    expect(sellerSaysUsed('used brass candle holder')).toBe(true);
    expect(sellerSaysUsed('Pre-owned leather bag')).toBe(true);
    expect(sellerSaysUsed('ikinci el seramik kase')).toBe(true);
    expect(sellerSaysUsed('kullanılmış kase')).toBe(true);
    expect(sellerSaysUsed('never used, still boxed')).toBe(false);
    expect(sellerSaysUsed('unused vintage tin')).toBe(false);
    expect(sellerSaysUsed('handmade ceramic bowl')).toBe(false);
    expect(resolveAiCondition({ suggested: 'NEW', sellerText: 'used ceramic bowl' })).toBe('USED_EXCELLENT');
  });

  it('a new item in a category without NEW gets its new-equivalent', () => {
    expect(conditionForCategory('NEW', ['NEW_OTHER', 'USED_EXCELLENT'])).toBe('NEW_OTHER');
    expect(resolveAiCondition({ suggested: 'LIKE_NEW', allowed: ['NEW_OTHER', 'USED_EXCELLENT'] })).toBe('NEW_OTHER');
    // Empty list (the captured item_conditions for Bowls) = eBay names none = the universal set.
    expect(conditionForCategory('NEW', [])).toBe('NEW');
    expect(conditionForCategory('LIKE_NEW', null)).toBe('USED_EXCELLENT');
    expect(conditionForCategory('VERY_GOOD', ['USED_EXCELLENT'])).toBe('USED_EXCELLENT');
    expect([...UNIVERSAL_CONDITIONS]).toEqual(['NEW', 'NEW_OTHER', 'USED_EXCELLENT', 'FOR_PARTS_OR_NOT_WORKING']);
    expect(isNewCondition('NEW_OTHER')).toBe(true);
    expect(isNewCondition('LIKE_NEW')).toBe(false);
  });
});

// ── 3. Category name ─────────────────────────────────────────────────────────────────────────────────────────

describe('eBay category labels', () => {
  afterEach(() => clearEbayCategoryLabels());
  it('remembers the suggestion name per id, ignores blanks', () => {
    rememberEbayCategoryLabel('262366', 'Bowls');
    rememberEbayCategoryLabel('1', '  ');
    rememberEbayCategoryLabel('', 'Nothing');
    rememberEbayCategoryLabels([['262408', 'Vases']]);
    expect(ebayCategoryLabel('262366')).toBe('Bowls');
    expect(ebayCategoryLabel('262408')).toBe('Vases');
    expect(ebayCategoryLabel('1')).toBeUndefined();
    expect(ebayCategoryLabel(null)).toBeUndefined();
  });
});

// ── 4. Description format ────────────────────────────────────────────────────────────────────────────────────

describe('eBay description: plain text in the field, HTML to eBay', () => {
  it('the captured HTML description becomes readable text for the field', () => {
    const text = ebayHtmlToText(AI_HTML);
    expect(looksLikeHtml(text)).toBe(false);
    expect(text).toBe([
      'Handmade Turkish Iznik Ceramic Floral Bowl',
      'Bring authentic artisan craftsmanship into your home with this Turkish Iznik Ceramic Bowl.',
      'Key Features & Specifications',
      '• Origin: Turkish handmade and hand-painted pottery\n• Color Palette: Rich cobalt blue, light blue, and white',
    ].join('\n\n'));
    expect(sanitizeDescription('ebay', { description: AI_HTML })).toBe(text);
  });

  it('plain text → paragraphs and lists; HTML a seller typed (or an existing listing) is sent unchanged', () => {
    const text = 'A hand painted bowl.\nMade in Kütahya.\n\nFeatures:\n• Blue & white\n- Glazed\n\n1. One\n2. Two';
    const html = descriptionToEbayHtml(text);
    expect(html).toBe([
      '<p>A hand painted bowl.<br>Made in Kütahya.</p>',
      '<p>Features:</p>',
      '<ul><li>Blue &amp; white</li><li>Glazed</li></ul>',
      '<ul><li>One</li><li>Two</li></ul>',
    ].join('\n'));
    expect(descriptionToEbayHtml(html)).toBe(html);
    expect(descriptionToEbayHtml('<p>Hand made</p>')).toBe('<p>Hand made</p>');
    expect(descriptionToEbayHtml('Ages 3 < 5 > 2')).toBe('<p>Ages 3 &lt; 5 &gt; 2</p>');
    expect(descriptionToEbayHtml('')).toBe('');
    // Round trip of an AI answer: text in the field, lists come back as lists.
    expect(descriptionToEbayHtml(ebayHtmlToText(AI_HTML))).toContain('<ul><li>Origin: Turkish handmade and hand-painted pottery</li><li>Color Palette:');
  });

  it('publish converts plain text: create plan, staged patches, legacy revise', () => {
    const plan = buildCreatePlan({
      sku: 'KX-1',
      action: { type: 'create', publish: true } as never,
      inventoryPatch: { product: { title: 'Iznik Bowl', description: 'A bowl.\n\n• Blue', imageUrls: ['https://i/1.jpg'] } },
      offerPatch: { categoryId: '262366', listingDescription: 'A bowl.\n\n• Blue', pricingSummary: { price: { value: '40', currency: 'USD' } } },
      variationPatch: null,
      media: [],
    });
    const item = plan.calls.find((c) => c.step === 'inventory_item')!.body as { product: { description: string } };
    const offer = plan.calls.find((c) => c.step === 'offer')!.body as { listingDescription: string };
    expect(item.product.description).toBe('<p>A bowl.</p>\n<ul><li>Blue</li></ul>');
    expect(offer.listingDescription).toBe('<p>A bowl.</p>\n<ul><li>Blue</li></ul>');

    expect(withHtmlDescriptions({ product: { description: 'Hi' }, condition: 'NEW' }, 'inventory')).toEqual({ product: { description: '<p>Hi</p>' }, condition: 'NEW' });
    expect(withHtmlDescriptions({ listingDescription: '<p>Kept</p>' }, 'offer')).toEqual({ listingDescription: '<p>Kept</p>' });
    expect(withHtmlDescriptions({ pricingSummary: {} }, 'offer')).toEqual({ pricingSummary: {} });
    expect(withHtmlDescriptions(null, 'inventory')).toBeNull();

    expect(legacyChanges({ product: { description: 'Plain' } }, {}).description).toBe('<p>Plain</p>');
    expect(legacyChanges({ product: { description: '<p>x</p>' } }, {}).description).toBe('<p>x</p>');
  });

  it('the rail preview shows what eBay gets', () => {
    const view = { fields: { ...blankEbayFields(), description: 'Line one\n\n• Blue' }, facts: {}, meta: { currency: 'USD' } } as unknown as ListingView<FieldMap>;
    expect(ebayPreviewModel(view, null).description).toBe('<p>Line one</p>\n<ul><li>Blue</li></ul>');
  });
});

// ── Follow-up: item specifics never guess, seller facts are given facts, short research query ───────────────

describe('item specifics: no guessing, no placeholders', () => {
  it('the aspects prompt carries the grounding rule and no "most likely country"', () => {
    const p = suggestAspectsPrompt({});
    expect(p).toContain(GROUNDING_RULES);
    expect(p).not.toMatch(/most likely country/i);
    const never = p.split('\n').find((l) => l.includes('NEVER guessed')) ?? '';
    for (const a of ['Origin', 'Country/Region of Manufacture', 'Brand', 'Product Line', 'Maker', 'Material', 'Dimensions']) expect(never).toContain(a);
    expect(p).toMatch(/A pattern or motif \(e\.g\. "Tulip"\) is not a product line/);
  });

  it('placeholder values are dropped unless required and listed by eBay', () => {
    for (const v of ['Unknown', 'N/A', 'n/a', 'Does not apply', 'Unbranded', 'Not specified', 'None']) expect(isPlaceholderAspectValue(v)).toBe(true);
    expect(isPlaceholderAspectValue('Turkey')).toBe(false);
    const ai = { Origin: ['Unknown'], 'Country of Origin': ['China'], Brand: ['Unbranded'], Color: ['Blue', 'N/A'] };
    expect(dropPlaceholderAspects(ai)).toEqual({ 'Country of Origin': ['China'], Color: ['Blue'] });
    expect(dropPlaceholderAspects(ai, [{ name: 'brand', required: true, values: ['Unbranded'] }])).toEqual({ 'Country of Origin': ['China'], Brand: ['Unbranded'], Color: ['Blue'] });
    // Listed but not required, or required but not listed: still dropped.
    expect(dropPlaceholderAspects({ Brand: ['Unbranded'] }, [{ name: 'Brand', required: false, values: ['Unbranded'] }])).toEqual({});
    expect(dropPlaceholderAspects({ Brand: ['Unbranded'] }, [{ name: 'Brand', required: true, values: [] }])).toEqual({});
  });

  it("seller facts line: trimmed, empty when nothing was typed", () => {
    expect(sellerFactsLine('  handmade  Turkish Iznik bowl ')).toBe("Seller's facts (stated by the seller, true for this item, may be used): handmade Turkish Iznik bowl");
    expect(sellerFactsLine('')).toBe('');
    expect(sellerFactsLine(undefined)).toBe('');
  });
});

describe('Start faster research query (eBay)', () => {
  it("seller words first, then the product type; short and keyword-like", () => {
    expect(fillResearchQuery({ sellerText: 'handmade Turkish Iznik bowl', productName: IDENTIFY.productName, seed: IDENTIFY.seed })).toBe('handmade turkish iznik bowl ceramic');
    expect(fillResearchQuery({ sellerText: 'Iznik', productName: 'Ceramic decorative bowl', seed: IDENTIFY.seed })).toBe('iznik bowl ceramic');
  });
  it('without seller words: the product type, else the start of the photo phrase (never the long visual phrase)', () => {
    expect(fillResearchQuery({ sellerText: '', productName: IDENTIFY.productName, seed: IDENTIFY.seed })).toBe('ceramic bowl');
    expect(fillResearchQuery({ productName: '', seed: IDENTIFY.seed })).toBe('handmade turkish ceramic bowl blue');
    const q = fillResearchQuery({ sellerText: 'a very long description of a hand painted Turkish ceramic serving bowl with tulips', productName: 'Bowl', seed: '' });
    expect(q.split(' ').length).toBeLessThanOrEqual(6);
    expect(q.length).toBeLessThanOrEqual(60);
  });
});
