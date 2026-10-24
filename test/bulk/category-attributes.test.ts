import { describe, expect, it } from 'vitest';
import { filledProperties, mergeTaxonomyProperties, mostCommonCategory, pendingTaxonomyByListing, planCategoryAttributes } from '@/lib/bulk/categoryAttributes';

const color = { property_id: 200, values: ['Blue'], value_ids: [2] };
const material = { property_id: 300, values: ['Cotton'] };

describe('bulk category attributes', () => {
  it('keeps only filled properties', () => {
    expect(filledProperties({ 200: color, 300: { property_id: 300, values: [] }, 400: undefined })).toEqual([color]);
  });
  it('merges with staged properties; the new value wins', () => {
    expect(mergeTaxonomyProperties([{ property_id: 200, values: ['Red'] }, material], [color])).toEqual([{ property_id: 200, values: ['Blue'], value_ids: [2] }, material]);
    expect(mergeTaxonomyProperties(null, [color])).toEqual([color]);
  });
  it('targets only listings of the chosen category and merges per listing', () => {
    const rows = [{ id: 'a', taxonomyId: 1 }, { id: 'b', taxonomyId: 1 }, { id: 'c', taxonomyId: 2 }, { id: 'd', taxonomyId: null }];
    expect(mostCommonCategory(rows)).toBe(1);
    const plan = planCategoryAttributes(rows, 1, [color], new Map([['b', [material]]]));
    expect(plan.skipped).toBe(2);
    expect(plan.patches).toEqual([{ id: 'a', properties: [color] }, { id: 'b', properties: [material, color] }]);
    expect(planCategoryAttributes(rows, 1, [], new Map()).patches).toEqual([]);
  });
  it('reads staged properties from open drafts only', () => {
    const m = pendingTaxonomyByListing([
      { status: 'draft', etsyListingId: '11', taxonomyPatch: { properties: [material] } },
      { status: 'synced', etsyListingId: '12', taxonomyPatch: { properties: [material] } },
      { status: 'draft', etsyListingId: '13', taxonomyPatch: null },
    ]);
    expect([...m.keys()]).toEqual(['11']);
  });
});
