// M10 integrator: pure parts of the legacy features restored after the legacy screens were deleted
// (Set field materials/description/personalization, variation price by property, materials Find & replace,
// Trendyol unarchive, eBay create drafts in the grid banner, eBay "Watch this item").
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
import {
  applyDescriptionMode,
  applyMaterialsMode,
  buildSetFieldPatch,
  setFieldStagePatch,
} from '@/components/domain/listings/bulk/SetFieldModal';
import { applyPriceOpsToInventory, productMatches } from '@/lib/bulk/variationPriceOps';
import { computeFindReplace, findReplaceFields } from '@/components/domain/listings/tools/FindReplacePanel';
import { toNewEbayListingDraft } from '@/components/domain/listings/useStagedChanges';
import { queuedArchiveState, sentItemFor } from '@/lib/catalogDrafts/executors/trendyol';
import { assertUnarchiveIsExclusive } from '@/lib/catalogDrafts/service';
import { ALLOWED_ACTIONS, hasQueuedDelete } from '@/lib/catalogDrafts/schemas';
import { watchItemHref } from '@/components/domain/research/products/TopListingPanel';
import { isArchivedRow } from '@/components/domain/listings/columns';
import type { CurrentListing } from '@/lib/listings/csvImport';

describe('Set field: materials add / remove', () => {
  it('adds missing materials at the end, case-insensitively', () => {
    expect(applyMaterialsMode(['Wood', 'brass'], ['wood', 'Linen'], 'add')).toEqual(['Wood', 'brass', 'Linen']);
  });
  it('removes listed materials and reports no change as null', () => {
    expect(applyMaterialsMode(['Wood', 'Brass'], ['brass'], 'remove')).toEqual(['Wood']);
    expect(applyMaterialsMode(['Wood'], ['linen'], 'remove')).toBeNull();
    expect(applyMaterialsMode(['Wood'], ['wood'], 'add')).toBeNull();
  });
  it('caps at 13 materials', () => {
    const cur = Array.from({ length: 13 }, (_, i) => `m${i}`);
    expect(applyMaterialsMode(cur, ['extra'], 'add')).toBeNull();
  });
});

describe('Set field: description and personalization', () => {
  it('adds text before / after with a blank line', () => {
    expect(applyDescriptionMode('Body', 'Intro', 'prepend')).toBe('Intro\n\nBody');
    expect(applyDescriptionMode('Body', 'Outro', 'append')).toBe('Body\n\nOutro');
    expect(applyDescriptionMode('', 'Only', 'append')).toBe('Only');
    expect(applyDescriptionMode('Body', '  ', 'append')).toBeNull();
  });
  it('builds the replace patch and places it on the description', () => {
    const patch = buildSetFieldPatch('description', { description: ' New text ' });
    expect(patch).toEqual({ description: 'New text' });
    expect(setFieldStagePatch('description', patch!)).toEqual({ description: 'New text' });
  });
  it('builds the personalization patch (one text question, or remove)', () => {
    const on = buildSetFieldPatch('personalization', { personalization: 'on', personalizationRequired: true, personalizationInstructions: 'Name', personalizationMaxChars: 40 });
    expect(on).toEqual({
      personalization_questions: [{ question_type: 'text_input', question_text: 'Personalization', required: true, instructions: 'Name', max_allowed_characters: 40 }],
    });
    expect(setFieldStagePatch('personalization', on!)).toEqual({ etsy: { personalization: on } });
    expect(buildSetFieldPatch('personalization', { personalization: 'off' })).toEqual({ remove: true });
    expect(buildSetFieldPatch('personalization', {})).toBeNull();
    expect(buildSetFieldPatch('personalization', { personalization: 'on', personalizationMaxChars: 5000 })).toBeNull();
  });
  it('other fields stay Etsy draft fields', () => {
    expect(setFieldStagePatch('materials', { materials: ['a'] })).toEqual({ etsy: { fields: { materials: ['a'] } } });
  });
});

describe('Variation price by property value', () => {
  const money = (amount: number) => ({ amount, divisor: 100, currency_code: 'USD' });
  const inventory = {
    products: [
      { property_values: [{ property_name: 'Size', values: ['Large'] }], offerings: [{ price: money(1000) }] },
      { property_values: [{ property_name: 'Size', values: ['Small'] }], offerings: [{ price: money(1000) }] },
    ],
  };
  it('matches property and value case-insensitively', () => {
    expect(productMatches(inventory.products[0], { property: 'size', value: 'LARGE' })).toBe(true);
    expect(productMatches(inventory.products[1], { property: 'size', value: 'large' })).toBe(false);
    expect(productMatches(inventory.products[1], { property: '', value: '' })).toBe(true);
  });
  it('changes only the matching variations', () => {
    const out = applyPriceOpsToInventory(inventory, [{ op: 'increase_pct', amount: 10 }], { match: { property: 'Size', value: 'Large' } });
    const prices = (out!.products as Array<{ offerings: Array<{ price: { amount: number } }> }>).map((p) => p.offerings[0].price.amount);
    expect(prices).toEqual([1100, 1000]);
  });
  it('returns null when no variation matches', () => {
    expect(applyPriceOpsToInventory(inventory, [{ op: 'set', amount: 5 }], { match: { property: 'Color', value: 'Red' } })).toBeNull();
  });
});

describe('Find & replace in materials (Etsy)', () => {
  const base: CurrentListing = { id: '1', title: 'Box', price: 1, quantity: 1, tags: [], description: null, materials: ['oak wood', 'brass'], hasVariations: false };
  it('is offered only for Etsy with Etsy draft fields', () => {
    expect(findReplaceFields('etsy', { materials: true })).toContain('materials');
    expect(findReplaceFields('etsy')).not.toContain('materials');
    expect(findReplaceFields('ebay', { materials: true })).not.toContain('materials');
  });
  it('stages the new list as an Etsy draft field', () => {
    const r = computeFindReplace([base], { field: 'materials', find: 'oak', replace: 'walnut', matchCase: false }, 'etsy');
    expect(r.stageable).toHaveLength(1);
    expect(r.stageable[0].patch).toEqual({ etsy: { fields: { materials: ['walnut wood', 'brass'] } } });
  });
  it('flags a listing whose materials have an unsent change', () => {
    const l: CurrentListing = { ...base, draft: { status: 'pending', fields: ['materials'], overlaid: [] } };
    const r = computeFindReplace([l], { field: 'materials', find: 'oak', replace: 'walnut', matchCase: false }, 'etsy');
    expect(r.stageable).toHaveLength(0);
    expect(r.changes[0].flag).toBe('unsentChange');
  });
});

describe('Trendyol unarchive', () => {
  const draft = (types: string[]) => ({ externalId: 'B1', baseSnapshot: {}, fieldPatch: {}, queuedActions: types.map((type) => ({ type, queuedAt: 'x' })) }) as never;
  it('is an allowed, non-destructive queued action', () => {
    expect(ALLOWED_ACTIONS.trendyol).toContain('unarchive');
    expect(hasQueuedDelete([{ type: 'unarchive', queuedAt: 'x' }])).toBe(false);
  });
  it('is sent through the archive endpoint with archived:false', () => {
    expect(queuedArchiveState(draft(['unarchive']))).toBe(false);
    expect(queuedArchiveState(draft(['archive']))).toBe(true);
    expect(queuedArchiveState(draft([]))).toBeNull();
    expect(sentItemFor(draft(['unarchive']))).toEqual({ barcode: 'B1', archived: false });
  });
  it('must be staged alone', () => {
    expect(() => assertUnarchiveIsExclusive({}, [{ type: 'unarchive', queuedAt: 'x' }])).not.toThrow();
    expect(() => assertUnarchiveIsExclusive({ price: 5 }, [{ type: 'unarchive', queuedAt: 'x' }])).toThrow();
    expect(() => assertUnarchiveIsExclusive({}, [{ type: 'unarchive', queuedAt: 'x' }, { type: 'archive', queuedAt: 'x' }])).toThrow();
  });
  it('is offered for archived rows only', () => {
    expect(isArchivedRow({ statusRaw: 'archived,notOnSale' } as never)).toBe(true);
    expect(isArchivedRow({ statusRaw: 'onSale' } as never)).toBe(false);
  });
});

describe('eBay create drafts in the grid banner', () => {
  it('lists drafts with a pending create', () => {
    const d = toNewEbayListingDraft({
      id: 'd1',
      sku: 'LOCAL-1',
      status: 'draft',
      updatedAt: '2026-10-15T00:00:00Z',
      inventoryPatch: { product: { title: 'Mug', imageUrls: ['https://i.ebayimg.com/a.jpg', 'http://x'] } },
      queuedActions: [{ type: 'create', publish: true }],
    });
    expect(d).toMatchObject({ draftId: 'd1', listingId: '', kind: 'create', title: 'Mug', photoCount: 1, thumbUrl: 'https://i.ebayimg.com/a.jpg', willPublish: true });
  });
  it('ignores edits of existing listings and closed drafts', () => {
    expect(toNewEbayListingDraft({ id: 'd2', sku: 'S', status: 'draft', queuedActions: [] })).toBeNull();
    expect(toNewEbayListingDraft({ id: 'd3', sku: 'S', status: 'synced', queuedActions: [{ type: 'create' }] })).toBeNull();
  });
});

describe('Research: watch an eBay item from the product finder', () => {
  it('links to the Shop tracker with the canonical item link', () => {
    expect(watchItemHref('ebay', 'https://www.ebay.com/itm/Some-title/123456789012?hash=x')).toBe(
      `/app/research/shops?mkt=ebay&add=${encodeURIComponent('https://www.ebay.com/itm/123456789012')}`,
    );
    expect(watchItemHref('ebay', 'https://www.ebay.co.uk/itm/123456789012')).not.toBeNull();
  });
  it('is not offered for other marketplaces or links', () => {
    expect(watchItemHref('etsy', 'https://www.ebay.com/itm/123456789012')).toBeNull();
    expect(watchItemHref('ebay', 'https://www.ebay.com/str/shop')).toBeNull();
    expect(watchItemHref('ebay', null)).toBeNull();
  });
});
