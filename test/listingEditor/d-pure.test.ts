// Group D (listing-editor §10) pure logic: variation summaries / payloads / dirty parts / send-time checks,
// personalization overlay + payload + rules, eBay per-variant staging plan, item-specifics helpers, and the
// section adapters (facts, issues, draft overlay). No rendering.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/stock/useStockManaged', () => ({
  useStockManaged: () => ({ managed: false, live: false, variants: [], get: () => undefined }),
}));

import {
  buildEtsyInventoryPayload,
  decodeInventoryProducts,
  renamePropertyValue,
  stampLoadedQuantities,
  summarizeEtsyInventory,
  validateVariationProducts,
  variationDirtyParts,
} from '@/components/etsy/VariationEditor';
import {
  buildPersonalizationPatch,
  personalizationBlocksSave,
  personalizationIssues,
  personalizationKey,
  personalizationStateFrom,
  summarizePersonalization,
  withFileCount,
  withQuestionType,
} from '@/components/etsy/PersonalizationEditor';
import {
  ebayChangedSkus,
  ebayVariantIssues,
  ebayVariantPatches,
  overlayEbayVariantDraft,
  summarizeEbayVariations,
} from '@/components/ebay/VariationEditor';
import { isAspectFilled, missingRequiredAspects, setAspectValues } from '@/components/ebay/ItemSpecificsEditor';
import {
  ebayVariationsFact,
  stagedInventoryProducts,
  toVariationIssues,
  variationsFact,
} from '@/components/domain/listing-editor/sections/VariationsSection';
import {
  openPersonalizationPatch,
  personalizationFact,
  personalizationInputs,
  toPersonalizationIssues,
} from '@/components/domain/listing-editor/sections/PersonalizationSection';
import { changedAspectNames, parseItemAspects, proposalRows, specificsFact } from '@/components/domain/listing-editor/sections/SpecificsSection';
import { flatKeys } from './d-messages';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────

const offering = (amount: number, quantity: number, enabled = true) => ({
  offering_id: 0,
  price: { amount, divisor: 100, currency_code: 'USD' },
  quantity,
  is_enabled: enabled,
});
const pv = (property_id: number, value: string) => ({ property_id, property_name: property_id === 200 ? 'Color' : 'Size', values: [value], scale_id: null });
const product = (color: string, size: string | null, amount: number, qty: number, enabled = true) => ({
  product_id: 0,
  sku: '',
  property_values: size ? [pv(200, color), pv(100, size)] : [pv(200, color)],
  offerings: [offering(amount, qty, enabled)],
});

describe('summarizeEtsyInventory', () => {
  it('counts axes, combinations, enabled price range and stock', () => {
    const s = summarizeEtsyInventory([
      product('Pink', 'S', 5400, 3),
      product('Pink', 'M', 6900, 2),
      product('Blue', 'S', 7900, 1, false),
      product('Blue', 'M', 6000, 4),
    ]);
    expect(s).toEqual({ variations: 2, combinations: 4, enabled: 3, priceMin: 54, priceMax: 69, currency: 'USD', totalQuantity: 9 });
  });

  it('treats a single product without property values as "no variations"', () => {
    const s = summarizeEtsyInventory([{ sku: 'X', property_values: [], offerings: [offering(1000, 5)] }], 'EUR');
    expect(s.variations).toBe(0);
    expect(s.combinations).toBe(0);
    expect(s.priceMin).toBeNull();
    expect(s.currency).toBe('EUR');
  });

  it('maps legacy Style (508) onto Custom1 (513) and ignores deleted rows / garbage', () => {
    const s = summarizeEtsyInventory([
      { property_values: [{ property_id: 508, values: ['A'] }], offerings: [offering(100, 1)] },
      { property_values: [{ property_id: 513, values: ['B'] }], offerings: [offering(200, 1)] },
      { is_deleted: true, property_values: [{ property_id: 200, values: ['C'] }], offerings: [offering(300, 1)] },
    ]);
    expect(s.variations).toBe(1);
    expect(s.combinations).toBe(2);
    expect(summarizeEtsyInventory(null).combinations).toBe(0);
  });
});

describe('buildEtsyInventoryPayload', () => {
  it('derives price/quantity/sku drivers like the legacy Save and filters unknown ids', () => {
    const products = [product('Pink', 'S', 5000, 1), product('Pink', 'M', 6000, 1), product('Blue', 'S', 5000, 1), product('Blue', 'M', 6000, 1)];
    const p = buildEtsyInventoryPayload(products as never, [100, 999]);
    expect(p.price_on_property).toEqual([100]);
    expect(p.pricesVary).toBe(true);
    expect(p.quantity_on_property).toEqual([]);
  });
});

describe('variationDirtyParts', () => {
  const base = { products: [product('Pink', null, 5000, 1)] as never[], priceOn: [], images: [] as never[] };
  it('is clean for an identical copy and for an unknown price_on_property id', () => {
    expect(variationDirtyParts(base, { products: JSON.parse(JSON.stringify(base.products)), priceOn: [999], images: [] })).toEqual({ inventory: false, images: false });
  });
  it('flags inventory and photo map independently', () => {
    const edited = [{ ...product('Pink', null, 5000, 1), sku: 'NEW' }] as never[];
    expect(variationDirtyParts(base, { products: edited, priceOn: [], images: [] })).toEqual({ inventory: true, images: false });
    expect(variationDirtyParts(base, { products: base.products, priceOn: [], images: [{ property_id: 200, value_id: 0, value: 'Pink', image_id: 9 }] as never[] }))
      .toEqual({ inventory: false, images: true });
  });
});

describe('validateVariationProducts (send-time, mirrors the server fill)', () => {
  it('does not report missing combinations: the server fills them before the PUT', () => {
    const issues = validateVariationProducts([product('Pink', 'S', 5000, 1), product('Blue', 'M', 5000, 1)] as never, []);
    expect(issues.map((i) => i.key)).not.toContain('validation.inventoryMissingCombinations');
  });
  it('reports a zero price', () => {
    const issues = validateVariationProducts([product('Pink', null, 0, 1), product('Blue', null, 500, 1)] as never, [200]);
    expect(issues.map((i) => i.key)).toContain('validation.inventoryPricePositive');
  });
  it('reports prices that vary without a price property', () => {
    const issues = validateVariationProducts([product('Pink', null, 400, 1), product('Blue', null, 500, 1)] as never, []);
    expect(issues.map((i) => i.key)).toContain('validation.inventoryPriceInconsistent');
  });
  it('is empty without variations', () => {
    expect(validateVariationProducts([], [])).toEqual([]);
  });
});

describe('stampLoadedQuantities (kept from I0: restock marker before staging)', () => {
  it('stamps the live quantity when no draft is pending', () => {
    const live = { products: [product('Pink', null, 5000, 7)] };
    const out = stampLoadedQuantities([product('Pink', null, 5000, 9)], { liveInventory: live, pendingDraft: null, originalProducts: [] });
    expect(out[0].kx_loaded_quantity).toBe(7);
  });
  it('carries an earlier staged marker over', () => {
    const draft = { inventoryPatch: { products: [{ ...product('Pink', null, 5000, 9), kx_loaded_quantity: 3 }] } };
    const out = stampLoadedQuantities([product('Pink', null, 5000, 12)], { liveInventory: null, pendingDraft: draft, originalProducts: [] });
    expect(out[0].kx_loaded_quantity).toBe(3);
  });
});

// ── personalization ─────────────────────────────────────────────────────────────────────────────────────

const legacyOff = { is_personalizable: false, personalization_is_required: false, personalization_instructions: '', personalization_char_count_max: 0 };

describe('personalizationStateFrom (server-draft overlay first, entities decoded)', () => {
  it('a staged remove wins over live questions', () => {
    const s = personalizationStateFrom({
      questions: [{ question_type: 'text_input', question_text: 'Name', required: true, max_allowed_characters: 20 }],
      legacy: legacyOff,
      draftPatch: { remove: true },
    });
    expect(s).toEqual({ enabled: false, questions: [] });
  });
  it('staged questions win over live ones', () => {
    const s = personalizationStateFrom({
      questions: [{ question_type: 'text_input', question_text: 'Live', required: false }],
      legacy: legacyOff,
      draftPatch: { personalization_questions: [{ question_type: 'dropdown', question_text: 'Size', required: true, options: [{ label: 'S' }] }] },
    });
    expect(s.enabled).toBe(true);
    expect(s.questions[0]).toMatchObject({ question_type: 'dropdown', question_text: 'Size' });
  });
  it('decodes HTML entities from Etsy (never sent back encoded)', () => {
    const s = personalizationStateFrom({
      questions: [{ question_type: 'text_input', question_text: 'Baby&#39;s name', instructions: 'Max 10 &amp; no emoji', required: true, max_allowed_characters: 10 }],
      legacy: legacyOff,
    });
    expect(s.questions[0].question_text).toBe("Baby's name");
    expect(buildPersonalizationPatch(s)).toEqual({
      personalization_questions: [{ question_type: 'text_input', question_text: "Baby's name", required: true, instructions: 'Max 10 & no emoji', max_allowed_characters: 10 }],
    });
  });
  it('falls back to the legacy single-field personalization', () => {
    const s = personalizationStateFrom({
      questions: [],
      legacy: { is_personalizable: true, personalization_is_required: true, personalization_instructions: 'Name please', personalization_char_count_max: 0 },
    });
    expect(s.questions[0]).toMatchObject({ question_type: 'text_input', required: true, instructions: 'Name please', max_allowed_characters: 256 });
  });
  it('off with nothing set', () => {
    expect(personalizationStateFrom({ questions: [], legacy: legacyOff })).toEqual({ enabled: false, questions: [] });
  });
});

describe('buildPersonalizationPatch / key / summary', () => {
  it('dropdown questions never carry instructions; uploads carry max files; off = remove', () => {
    const patch = buildPersonalizationPatch({
      enabled: true,
      questions: [
        { question_type: 'dropdown', question_text: ' Size ', instructions: 'ignored', required: false, options: [{ label: 'S' }] },
        { question_type: 'unlabeled_upload', question_text: 'Photo', instructions: 'Clear photo', required: true, max_allowed_files: 2 },
      ],
    });
    expect(patch.personalization_questions[0]).toEqual({ question_type: 'dropdown', question_text: 'Size', required: false, options: [{ label: 'S' }] });
    expect(patch.personalization_questions[1]).toEqual({ question_type: 'unlabeled_upload', question_text: 'Photo', required: true, instructions: 'Clear photo', max_allowed_files: 2 });
    expect(buildPersonalizationPatch({ enabled: false, questions: [] })).toEqual({ remove: true });
  });
  it('switching off keeps the questions in state but stages remove; equal patches compare equal', () => {
    const on = { enabled: true, questions: [{ question_type: 'text_input' as const, question_text: 'Name', required: true, max_allowed_characters: 20 }] };
    expect(personalizationKey({ ...on, enabled: false })).toBe(personalizationKey({ enabled: false, questions: [] }));
    expect(summarizePersonalization(on)).toEqual({ enabled: true, required: true, count: 1 });
    expect(summarizePersonalization({ ...on, enabled: false })).toEqual({ enabled: false, required: false, count: 0 });
  });
});

describe('personalizationIssues', () => {
  it('reports Etsy rules per question with etsy-namespace keys', () => {
    const issues = personalizationIssues({
      enabled: true,
      questions: [
        { question_type: 'text_input', question_text: '', required: false, max_allowed_characters: 0 },
        { question_type: 'dropdown', question_text: 'Size', required: false, options: [] },
        { question_type: 'labeled_upload', question_text: 'Files', required: false, max_allowed_files: 2, options: [{ label: 'Front' }] },
      ],
    });
    const keys = issues.map((i) => `${i.field}:${i.key}`);
    expect(keys).toContain('personalization.1:personalization.validateQuestionTextLength');
    expect(keys).toContain('personalization.1:personalization.validateMaxCharRange');
    expect(keys).toContain('personalization.2:personalization.validateDropdownOptionsRange');
    expect(keys).toContain('personalization.3:personalization.validateLabelCountMatch');
  });
  it('only one upload question; nothing when off', () => {
    const up = { question_type: 'unlabeled_upload' as const, question_text: 'P', required: false, max_allowed_files: 1 };
    expect(personalizationIssues({ enabled: true, questions: [up, { ...up }] }).map((i) => i.key)).toContain('personalization.validateMaxOneUpload');
    expect(personalizationIssues({ enabled: false, questions: [up, { ...up }] })).toEqual([]);
  });
  it('block_save (too long) stops staging', () => {
    expect(personalizationBlocksSave({ enabled: true, questions: [{ question_type: 'text_input', question_text: 'x'.repeat(46), required: false, max_allowed_characters: 10 }] })).toBe(true);
    expect(personalizationBlocksSave({ enabled: true, questions: [{ question_type: 'text_input', question_text: 'Name', required: false, max_allowed_characters: 10 }] })).toBe(false);
  });
});

describe('question edits', () => {
  it('type change keeps text + required and resets type fields', () => {
    const q = withQuestionType({ question_type: 'text_input', question_text: 'Name', required: true, max_allowed_characters: 20, instructions: 'x' }, 'dropdown');
    expect(q).toEqual({ question_type: 'dropdown', question_text: 'Name', required: true, options: [] });
  });
  it('labeled uploads keep one label per file, clamped 1..10', () => {
    const q = withFileCount({ question_type: 'labeled_upload', question_text: 'F', required: false, max_allowed_files: 1, options: [{ label: 'Front' }] }, 3);
    expect(q.options).toEqual([{ label: 'Front' }, { label: '' }, { label: '' }]);
    expect(withFileCount(q, 40).max_allowed_files).toBe(10);
    expect(withFileCount(q, 2).options).toHaveLength(2);
  });
});

// ── eBay variations ─────────────────────────────────────────────────────────────────────────────────────

describe('eBay per-variant staging plan', () => {
  const items = [
    { sku: 'V1', price: { value: '10.00', currency: 'USD' }, quantity: 4, offerId: 'o1' },
    { sku: 'V2', price: { value: '12.00', currency: 'USD' }, quantity: 0, offerId: 'o2' },
    { sku: 'V3', price: { value: '9.00', currency: 'USD' }, quantity: 1 },
  ];
  const baseline = { V1: { price: '10.00', quantity: 4 }, V2: { price: '12.00', quantity: 0 }, V3: { price: '9.00', quantity: 1 } };

  it('stages only what changed, quantity on the inventory item and price on the offer', () => {
    const edited = [{ ...items[0], quantity: 6 }, { ...items[1], price: { value: '14.5', currency: 'USD' } }, items[2]];
    expect(ebayVariantPatches(edited, baseline)).toEqual([
      { sku: 'V1', offerId: 'o1', inventoryFields: { availability: { shipToLocationAvailability: { quantity: 6 } } } },
      { sku: 'V2', offerId: 'o2', offerFields: { pricingSummary: { price: { value: '14.5', currency: 'USD' } } } },
    ]);
  });
  it('never stages an invalid price or a price without an offer, but keeps it dirty', () => {
    const edited = [{ ...items[0], price: { value: '', currency: 'USD' } }, items[1], { ...items[2], price: { value: '11', currency: 'USD' } }];
    expect(ebayVariantPatches(edited, baseline)).toEqual([]);
    expect(ebayChangedSkus(edited, baseline)).toEqual(['V1', 'V3']);
    expect(ebayVariantIssues(edited).map((i) => i.key)).toEqual(['variations.ebayPriceInvalid']);
  });
  it('flags fractional / negative quantities', () => {
    expect(ebayVariantIssues([{ sku: 'A', quantity: 1.5 }, { sku: 'B', quantity: -1 }]).map((i) => i.field))
      .toEqual(['variations.A.quantity', 'variations.B.quantity']);
  });
  it('overlays an open variant draft (server-draft overlay)', () => {
    const merged = overlayEbayVariantDraft(items[0], {
      inventoryPatch: { availability: { shipToLocationAvailability: { quantity: 2 } } },
      offerPatch: { pricingSummary: { price: { value: '8.5', currency: 'USD' } } },
    });
    expect(merged).toMatchObject({ quantity: 2, price: { value: '8.5', currency: 'USD' } });
    expect(overlayEbayVariantDraft(items[0], null)).toBe(items[0]);
  });
  it('summarizes price range and stock', () => {
    expect(summarizeEbayVariations(items)).toEqual({ variations: 3, priceMin: 9, priceMax: 12, currency: 'USD', totalQuantity: 5 });
  });
});

// ── item specifics ──────────────────────────────────────────────────────────────────────────────────────

describe('item specifics helpers', () => {
  const meta = (name: string, required: boolean, mode: 'FREE_TEXT' | 'SELECTION_ONLY' = 'FREE_TEXT') => ({
    localizedAspectName: name,
    aspectConstraint: { aspectRequired: required, aspectMode: mode },
  });
  it('missing required aspects ignore blank values', () => {
    expect(missingRequiredAspects({ Brand: [' '], Type: ['Blanket'] }, [meta('Brand', true), meta('Type', true)])).toEqual(['Brand']);
    expect(isAspectFilled(['', 'x'])).toBe(true);
  });
  it('setAspectValues drops empty values and removes the key', () => {
    expect(setAspectValues({ Brand: ['Acme'] }, 'Brand', ['', ' '])).toEqual({});
    expect(setAspectValues({}, 'Color', ['Pink', ''])).toEqual({ Color: ['Pink'] });
  });
  it('parses item_aspects and drops malformed rows', () => {
    const parsed = parseItemAspects({
      aspects: [
        { localizedAspectName: 'Brand', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT' } },
        { localizedAspectName: 'Color', aspectConstraint: { aspectRequired: false, aspectMode: 'SELECTION_ONLY', aspectValues: [{ localizedValue: 'Pink' }, null] } },
        { foo: 1 },
        null,
      ],
    });
    expect(parsed.required.map((a) => a.localizedAspectName)).toEqual(['Brand']);
    expect(parsed.recommended[0].aspectConstraint.aspectValues).toEqual([{ localizedValue: 'Pink' }]);
    expect(parseItemAspects('garbage')).toEqual({ required: [], recommended: [] });
  });
  it('per-aspect dirty names against the live listing', () => {
    expect(changedAspectNames({ Brand: ['Acme'], Color: ['Pink'] }, { Brand: ['Acme'], Size: ['L'] }).sort()).toEqual(['Color', 'Size']);
    expect(changedAspectNames({ Brand: ['Acme'] }, null)).toEqual([]);
  });
  it('AI proposal rows: only strings ≤ 65 chars, not already equal (AI output guard)', () => {
    const rows = proposalRows({ Brand: ['Acme'], Color: 'Pink', Material: ['x'.repeat(66)], Junk: [1, null], '': ['a'], Size: [' L '] }, { Brand: ['Acme'] });
    expect(rows).toEqual([{ name: 'Color', values: ['Pink'] }, { name: 'Size', values: ['L'] }]);
    expect(proposalRows(['Brand'], {})).toEqual([]);
    expect(proposalRows(null, {})).toEqual([]);
  });
  it('coverage fact', () => {
    expect(specificsFact({ Brand: ['A'], Color: ['P'] }, [meta('Brand', true), meta('Type', true)], [meta('Color', false), meta('Size', false)]))
      .toEqual({ required: 2, filled: 1, recommended: 2, recommendedFilled: 1 });
  });
});

// ── section adapters ────────────────────────────────────────────────────────────────────────────────────

describe('section adapters', () => {
  it('variations facts (PriceSection reads the range to go read-only)', () => {
    expect(variationsFact({ variations: 2, combinations: 6, priceMin: 54, priceMax: 79 })).toEqual({ count: 2, combinations: 6, priceRange: { min: 54, max: 79 } });
    expect(variationsFact({ variations: 0, combinations: 0, priceMin: null, priceMax: null })).toEqual({ count: 0, combinations: 0, priceRange: null });
    expect(ebayVariationsFact({ variations: 3, priceMin: 9, priceMax: 12, currency: 'USD', totalQuantity: 5 })).toEqual({ count: 1, combinations: 3, priceRange: { min: 9, max: 12 } });
  });
  it('issues become full-path engine issues in the variations / personalization section', () => {
    expect(toVariationIssues([{ field: 'inventory', severity: 'block_sync', key: 'validation.inventoryPricePositive', message: 'x' }], 'etsy'))
      .toEqual([{ field: 'variations', section: 'variations', severity: 'block_sync', key: 'etsy.validation.inventoryPricePositive', params: undefined, message: 'x' }]);
    expect(toPersonalizationIssues([{ field: 'personalization.1', severity: 'block_sync', key: 'personalization.validateMaxCharRange', params: { index: 1 } }])[0])
      .toMatchObject({ section: 'personalization', key: 'etsy.personalization.validateMaxCharRange', params: { index: 1 } });
  });
  it('draft overlay only from open drafts', () => {
    const products = [product('Pink', null, 100, 1)];
    expect(stagedInventoryProducts({ status: 'draft', inventoryPatch: { products } })).toBe(products);
    expect(stagedInventoryProducts({ status: 'synced', inventoryPatch: { products } })).toBeNull();
    expect(stagedInventoryProducts({ status: 'conflict', inventoryPatch: {} })).toBeNull();
    expect(openPersonalizationPatch({ status: 'failed', personalizationPatch: { remove: true } })).toEqual({ remove: true });
    expect(openPersonalizationPatch({ status: 'draft', personalizationPatch: {} })).toBeUndefined();
    expect(openPersonalizationPatch({ status: 'syncing', personalizationPatch: { remove: true } })).toBeUndefined();
  });
  it('meta.personalization → editor inputs; summary → fact', () => {
    const inputs = personalizationInputs({ is_personalizable: true, personalization_char_count_max: null, personalization_questions: [{ question_type: 'text_input' }] });
    expect(inputs.legacy).toEqual({ is_personalizable: true, personalization_is_required: false, personalization_instructions: '', personalization_char_count_max: 0 });
    expect(inputs.questions).toHaveLength(1);
    expect(personalizationInputs(undefined).questions).toEqual([]);
    expect(personalizationFact({ enabled: true, required: false, count: 2 })).toEqual({ enabled: true, required: false, questions: 2 });
  });
});

describe('Group D i18n fragment', () => {
  it('every key has EN and TR, TR uses real Turkish characters (no ASCII fallbacks)', () => {
    const rows = flatKeys();
    expect(rows.length).toBeGreaterThan(80);
    for (const r of rows) {
      expect(r.en, r.key).not.toBe('');
      expect(r.tr, r.key).not.toBe('');
    }
    const ascii = /\b(Olustur|Gonder|Siparis|Iptal|Odeme|Kisisel|Ozellik|Duzenle)\w*/;
    expect(rows.filter((r) => ascii.test(r.tr)).map((r) => r.key)).toEqual([]);
  });
});

describe('Etsy inventory entities + option rename (embedded)', () => {
  const pv = (property_id: number, value: string) => ({ property_id, property_name: property_id === 200 ? 'Color' : 'Size', values: [value], scale_id: null });
  const prod = (a: string, b: string) => ({ product_id: 0, sku: '', offerings: [], property_values: [pv(200, a), pv(100, b)] });

  it('decodes values and property names once, idempotently', () => {
    const out = decodeInventoryProducts([{ ...prod('Mom&#39;s Blue', 'S'), property_values: [{ ...pv(200, 'Mom&#39;s Blue'), property_name: 'Kid&amp;s' }] }]);
    expect(out[0].property_values[0]).toMatchObject({ values: ["Mom's Blue"], property_name: 'Kid&s' });
    expect(decodeInventoryProducts(out)).toEqual(out);
  });

  it('renames a value in every combination that carries it, nothing else', () => {
    const products = [prod('Red', 'S'), prod('Red', 'M'), prod('Blue', 'S')];
    const out = renamePropertyValue(products, 0, 0, 'Crimson');
    expect(out.map((p) => p.property_values.map((x) => x.values[0]))).toEqual([['Crimson', 'S'], ['Crimson', 'M'], ['Blue', 'S']]);
    expect(out[2]).toBe(products[2]);
  });

  it('restock markers match a decoded product to its encoded live twin', () => {
    const live = { products: [{ ...prod('Mom&#39;s', 'S'), offerings: [{ quantity: 4 }] }] };
    const out = stampLoadedQuantities([prod("Mom's", 'S')], { liveInventory: live, pendingDraft: null, originalProducts: [] });
    expect(out[0].kx_loaded_quantity).toBe(4);
  });
});
