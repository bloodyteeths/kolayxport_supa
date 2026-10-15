// Group B (listing-editor §10): pure helpers behind the Etsy field sections.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  changedListingProperties, displayList, displayText, fieldDomId, flattenTaxonomy, keepApplicableProperties,
  loadEtsyTaxonomy, mergeById, newTempId, numOrEmpty, numOrNull, numberToPrice, overlayStagedProperties,
  parseListingProperties, parseTaxonomyProperties, pendingCreates, priceToNumber, requiredAttributeSummary,
  searchTaxonomy, shippingProfilePayload, titleTagRepeats, validateShippingProfile, wordCount, __resetTaxonomyCache,
  type ListingPropertyMap,
} from '@/components/domain/listing-editor/sections/etsyShared';
import { returnPolicyPayload } from '@/components/domain/listing-editor/sections/CreateReturnPolicyModal';
import { validProcessingRange } from '@/components/domain/listing-editor/sections/ProcessingProfileField';
import { fieldAnchorId } from '@/lib/listingEditor/sections';

describe('display text (founder complaint: raw entities)', () => {
  it('decodes entities for display and lists', () => {
    expect(displayText('one&#39;s &amp; baby&quot;s')).toBe('one\'s & baby"s');
    expect(displayText(undefined)).toBe('');
    expect(displayList(['mom&#39;s gift', 3, null, 'baby'])).toEqual(["mom's gift", 'baby']);
  });
  it('is idempotent on decoded text', () => {
    expect(displayText("one's")).toBe("one's");
  });
});

describe('field ids', () => {
  it('uses the engine anchor for field keys and resolves score-fix aliases', () => {
    expect(fieldDomId('title')).toBe(fieldAnchorId('title'));
    expect(fieldDomId('details')).toBe(fieldAnchorId('taxonomy_id'));
    expect(fieldDomId('shipping')).toBe(fieldAnchorId('shipping_profile_id'));
    expect(fieldDomId('weight')).toBe(fieldAnchorId('item_weight'));
    expect(fieldDomId('processing')).toBe(fieldAnchorId('readiness_state_id'));
  });
});

describe('text helpers', () => {
  it('counts words', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  Wrap your\nlittle one  ')).toBe(4);
  });
  it('finds the title word repeated in most tags', () => {
    expect(titleTagRepeats('Personalized Baby Blanket', ['name blanket', 'blanket gift', 'newborn gift'])).toEqual({ word: 'blanket', count: 2 });
    expect(titleTagRepeats('Personalized Baby Blanket', ['name blanket', 'newborn gift'])).toBeNull();
    expect(titleTagRepeats('', ['a'])).toBeNull();
  });
  it('converts numbers and prices', () => {
    expect(numOrNull('')).toBeNull();
    expect(numOrNull(4)).toBe(4);
    expect(numOrEmpty(null)).toBe('');
    expect(numOrEmpty(2.5)).toBe(2.5);
    expect(priceToNumber('12,50')).toBe(12.5);
    expect(priceToNumber('')).toBeNull();
    expect(numberToPrice(12.5)).toBe('12.5');
    expect(numberToPrice(12.499)).toBe('12.5');
    expect(numberToPrice(null)).toBe('');
  });
});

describe('taxonomy', () => {
  const tree = [
    { id: 1, name: 'Home & Living', children: [{ id: 2, name: 'Bedding', children: [{ id: 3, name: 'Blankets & Throws' }] }] },
    { id: 4, name: 'Baby', children: [{ id: 5, name: 'Baby Blankets' }] },
  ];
  it('flattens with › paths and leaf flags', () => {
    const flat = flattenTaxonomy(tree);
    expect(flat.map((f) => f.id)).toEqual([1, 2, 3, 4, 5]);
    expect(flat[2]).toEqual({ id: 3, name: 'Blankets & Throws', path: 'Home & Living › Bedding › Blankets & Throws', leaf: true });
    expect(flat[0].leaf).toBe(false);
  });
  it('searches by name first, leaves before parents', () => {
    const flat = flattenTaxonomy(tree);
    expect(searchTaxonomy(flat, 'blanket').map((f) => f.id)).toEqual([5, 3]);
    expect(searchTaxonomy(flat, 'bedding').map((f) => f.id)).toEqual([2, 3]);
    expect(searchTaxonomy(flat, '').map((f) => f.id)).toEqual([1, 4]);
  });
  beforeEach(() => __resetTaxonomyCache());
  it('loads once per shop (reads `categories`), does not cache failures', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ categories: tree }), { status: 200 }));
    const a = await loadEtsyTaxonomy('s1', ok as unknown as typeof fetch);
    await loadEtsyTaxonomy('s1', ok as unknown as typeof fetch);
    expect(a).toHaveLength(5);
    expect(ok).toHaveBeenCalledTimes(1);
    const bad = vi.fn(async () => new Response('x', { status: 500 }));
    await expect(loadEtsyTaxonomy('s2', bad as unknown as typeof fetch)).rejects.toThrow();
    await expect(loadEtsyTaxonomy('s2', ok as unknown as typeof fetch)).resolves.toHaveLength(5);
  });
});

describe('category details', () => {
  const props = parseTaxonomyProperties({
    results: [
      { property_id: 200, display_name: 'Primary color', is_required: true, possible_values: [{ value_id: 1, name: 'Pink' }, { value_id: 2, name: 'Blue' }] },
      { property_id: 300, name: 'Fabric', is_required: false, scales: [{ scale_id: 9, display_name: 'Inches' }] },
      { property_id: 0, display_name: 'bad' },
    ],
  });
  it('parses taxonomy properties like the drawer', () => {
    expect(props.map((p) => p.property_id)).toEqual([200, 300]);
    expect(props[0].possible_values).toEqual([{ value_id: 1, name: 'Pink' }, { value_id: 2, name: 'Blue' }]);
    expect(props[1].display_name).toBe('Fabric');
    expect(props[1].scales).toEqual([{ scale_id: 9, display_name: 'Inches' }]);
  });
  it('parses listing properties and decodes entities', () => {
    const map = parseListingProperties({ results: [{ property_id: 200, values: ['Pink'], value_ids: [1] }, { property_id: 301, values: ['Mom&#39;s'] }] });
    expect(map[200]).toEqual({ property_id: 200, property_name: undefined, values: ['Pink'], value_ids: [1], scale_id: null });
    expect(map[301].values).toEqual(["Mom's"]);
  });
  it('stages only changed properties (drawer semantics)', () => {
    const orig: ListingPropertyMap = { 200: { property_id: 200, values: ['Pink'], value_ids: [1], scale_id: null } };
    const same: ListingPropertyMap = { 200: { property_id: 200, values: ['Pink'], value_ids: [1], scale_id: null } };
    expect(changedListingProperties(orig, same)).toEqual([]);
    const cur: ListingPropertyMap = {
      200: { property_id: 200, values: ['Blue'], value_ids: [2] },
      300: { property_id: 300, values: ['Cotton'], value_ids: [], scale_id: 9 },
    };
    expect(changedListingProperties(orig, cur).map((p) => p.property_id).sort()).toEqual([200, 300]);
    // A cleared value is a change (the server deletes the property on send).
    expect(changedListingProperties(orig, { 200: { property_id: 200, values: [], value_ids: [] } })).toHaveLength(1);
  });
  it('overlays the staged taxonomyPatch over remote values (I0 overlay)', () => {
    const base: ListingPropertyMap = { 200: { property_id: 200, values: ['Pink'], value_ids: [1] } };
    const next = overlayStagedProperties(base, { properties: [{ property_id: 200, values: ['Blue'], value_ids: [2] }] });
    expect(next[200].values).toEqual(['Blue']);
    expect(overlayStagedProperties(base, null)).toEqual(base);
  });
  it('summarises required attributes for the score', () => {
    expect(requiredAttributeSummary(null, {})).toBeNull();
    expect(requiredAttributeSummary(props, {})).toEqual({ required: 1, filled: 0 });
    expect(requiredAttributeSummary(props, { 200: { property_id: 200, values: ['Pink'] } })).toEqual({ required: 1, filled: 1 });
  });
  it('keeps values whose property exists in the new category and counts dropped ones', () => {
    const values: ListingPropertyMap = {
      200: { property_id: 200, values: ['Pink'] },
      999: { property_id: 999, values: ['X'] },
      998: { property_id: 998, values: [] },
    };
    const { kept, dropped } = keepApplicableProperties(values, props);
    expect(Object.keys(kept)).toEqual(['200']);
    expect(dropped).toBe(1);
  });
});

describe('staged creates', () => {
  it('reads pending create actions from the draft so they survive a reload', () => {
    const p = pendingCreates([
      { type: 'create_shop_section', tempId: -1, payload: { title: 'Blankets' } },
      { type: 'create_shipping_profile', tempId: -2, payload: { title: 'US free' } },
      { type: 'create_return_policy', tempId: -3, payload: { accepts_returns: true, accepts_exchanges: false, return_deadline: 30 } },
      { type: 'create_shop_section', tempId: -4, payload: { title: 'Done' }, completedAt: '2026-10-01' },
      { type: 'publish' },
    ]);
    expect(p.sections).toEqual([{ shop_section_id: -1, title: 'Blankets' }]);
    expect(p.shippingProfiles).toEqual([{ shipping_profile_id: -2, title: 'US free' }]);
    expect(p.returnPolicies[0]).toMatchObject({ return_policy_id: -3, accepts_returns: true, return_deadline: 30 });
  });
  it('merges remote and pending options without duplicates', () => {
    expect(mergeById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: -5 }], 'id')).toEqual([{ id: 1 }, { id: 2 }, { id: -5 }]);
  });
  it('builds the drawer-identical shipping profile payload', () => {
    const input = { title: ' US Free ', origin_country_iso: 'TR', destination_country_iso: null, primary_cost: 4.5, secondary_cost: null, min_processing_days: 1, max_processing_days: 3 };
    expect(validateShippingProfile(input)).toEqual([]);
    expect(shippingProfilePayload(input)).toEqual({ title: 'US Free', origin_country_iso: 'TR', primary_cost: 4.5, secondary_cost: 0, min_processing_days: 1, max_processing_days: 3 });
    expect(shippingProfilePayload({ ...input, destination_country_iso: 'US' }).destination_country_iso).toBe('US');
    expect(validateShippingProfile({ ...input, title: ' ', min_processing_days: 5 })).toEqual(['titleRequired', 'processingRange']);
  });
  it('builds the return policy payload (deadline only when returns or exchanges are accepted)', () => {
    expect(returnPolicyPayload(true, true, 30)).toEqual({ accepts_returns: true, accepts_exchanges: true, return_deadline: 30 });
    expect(returnPolicyPayload(false, false, 30)).toEqual({ accepts_returns: false, accepts_exchanges: false, return_deadline: undefined });
  });
  it('uses negative temp ids', () => {
    expect(newTempId(() => 1700)).toBe(-1700);
  });
  it('validates the processing profile range (1–10 days, min ≤ max)', () => {
    expect(validProcessingRange(1, 3)).toBe(true);
    expect(validProcessingRange(4, 3)).toBe(false);
    expect(validProcessingRange(0, 3)).toBe(false);
    expect(validProcessingRange(1, 11)).toBe(false);
    expect(validProcessingRange(null, 3)).toBe(false);
  });
});
