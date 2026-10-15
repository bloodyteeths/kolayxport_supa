// M6 editor Group F: pure eBay draft helpers (lib/ebay/draftPlan.ts, lib/ebay/draftErrors.ts).
import { describe, expect, it } from 'vitest';
import {
  applyInventoryPatch,
  applyMediaOps,
  buildCreatePlan,
  computeEbayDiff,
  deletePath,
  dropRejectedKeys,
  mergeQueuedActions,
  normalizeSellerSku,
  removeActions,
  stableJson,
  type EbayCreateAction,
} from '@/lib/ebay/draftPlan';
import { classifyEbayError, ebayDraftErrorResponse, EbayDraftError } from '@/lib/ebay/draftErrors';

const policies = { fulfillmentPolicyId: 'F1', returnPolicyId: 'R1', paymentPolicyId: 'P1' };
const fullInventory = {
  product: { title: 'Wooden Keepsake Box', description: '<p>Hand made</p>', imageUrls: ['https://i/1.jpg'], aspects: { Brand: ['Belle'] } },
  condition: 'NEW',
  availability: { shipToLocationAvailability: { quantity: 3 } },
};
const fullOffer = {
  pricingSummary: { price: { value: '24.99', currency: 'USD' } },
  listingPolicies: policies,
  categoryId: '1234',
  listingDescription: '<p>Hand made</p>',
};

describe('mergeQueuedActions', () => {
  it('keeps a create action unique, replaces its publish flag and keeps server progress', () => {
    const existing = [{ type: 'create', publish: true, progress: { itemsCreated: ['A'] } }];
    const merged = mergeQueuedActions(existing, [{ type: 'create', publish: false }]);
    expect(merged).toEqual([{ type: 'create', publish: false, progress: { itemsCreated: ['A'] } }]);
  });
  it('never lets a client overwrite progress', () => {
    const merged = mergeQueuedActions([], [{ type: 'create', publish: true, progress: { published: true } }]);
    expect(merged).toEqual([{ type: 'create', publish: true }]);
  });
  it('dedupes other actions by value (legacy behaviour)', () => {
    expect(mergeQueuedActions([{ type: 'publish' }], [{ type: 'publish' }, { type: 'withdraw' }])).toEqual([
      { type: 'publish' },
      { type: 'withdraw' },
    ]);
  });
});

describe('removeActions', () => {
  it('removes delete/publish/withdraw but never create', () => {
    const list = [{ type: 'create' }, { type: 'delete' }, { type: 'publish' }];
    expect(removeActions(list, ['delete', 'create'])).toEqual([{ type: 'create' }, { type: 'publish' }]);
  });
});

describe('applyMediaOps', () => {
  it('runs delete → add → reorder like the sync engine', () => {
    const out = applyMediaOps(['a', 'b', 'c'], [
      { operation: 'reorder', imageUrl: 'c', rank: 0 },
      { operation: 'add_url', imageUrl: 'd', rank: 1 },
      { operation: 'delete', imageUrl: 'b' },
    ]);
    expect(out).toEqual({ imageUrls: ['c', 'a', 'd'], changed: true });
  });
  it('reports unchanged when nothing applies', () => {
    expect(applyMediaOps(['a'], [{ operation: 'delete', imageUrl: 'zzz' }])).toEqual({ imageUrls: ['a'], changed: false });
  });
});

describe('applyInventoryPatch', () => {
  it('replaces product.aspects so a removed item specific stays removed', () => {
    const merged = applyInventoryPatch(
      { product: { title: 'x', aspects: { Brand: ['A'], Color: ['Red'] } } },
      { product: { aspects: { Brand: ['A'] } } },
    );
    expect(merged.product).toEqual({ title: 'x', aspects: { Brand: ['A'] } });
  });
  it('deep-merges everything else', () => {
    const merged = applyInventoryPatch({ product: { title: 'x', imageUrls: ['a'] }, condition: 'NEW' }, { product: { title: 'y' } });
    expect(merged).toEqual({ product: { title: 'y', imageUrls: ['a'] }, condition: 'NEW' });
  });
});

describe('buildCreatePlan (F1: same calls as the legacy creator)', () => {
  const action: EbayCreateAction = { type: 'create', publish: true };

  it('simple listing: inventory_item → offer → publish', () => {
    const plan = buildCreatePlan({ sku: 'KX-1', action, inventoryPatch: fullInventory, offerPatch: fullOffer, variationPatch: null, media: [] });
    expect(plan.missing).toEqual([]);
    expect(plan.calls.map((c) => c.step)).toEqual(['inventory_item', 'offer', 'publish']);
    const offer = plan.calls[1].body!;
    expect(offer).toMatchObject({
      sku: 'KX-1',
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE',
      listingDuration: 'GTC',
      availableQuantity: 3,
      pricingSummary: { price: { value: '24.99', currency: 'USD' } },
      listingPolicies: policies,
      categoryId: '1234',
    });
    expect(plan.calls[0].body).toMatchObject({ product: { title: 'Wooden Keepsake Box' }, condition: 'NEW' });
    expect(plan.calls[0].body).not.toHaveProperty('conditionDescription');
  });

  it('"Save on eBay as unpublished" stops before publish', () => {
    const plan = buildCreatePlan({ sku: 'KX-1', action: { type: 'create', publish: false }, inventoryPatch: fullInventory, offerPatch: fullOffer, variationPatch: null, media: [] });
    expect(plan.calls.map((c) => c.step)).toEqual(['inventory_item', 'offer']);
  });

  it('keeps a condition description only for used items and defaults the condition to NEW', () => {
    const used = buildCreatePlan({
      sku: 'KX-1', action,
      inventoryPatch: { ...fullInventory, condition: 'USED', conditionDescription: 'Small scratch' },
      offerPatch: fullOffer, variationPatch: null, media: [],
    });
    expect(used.calls[0].body).toMatchObject({ condition: 'USED_EXCELLENT', conditionDescription: 'Small scratch' });
    const none = buildCreatePlan({
      sku: 'KX-1', action,
      inventoryPatch: { ...fullInventory, condition: undefined, conditionDescription: 'ignored' },
      offerPatch: fullOffer, variationPatch: null, media: [],
    });
    expect(none.calls[0].body).toMatchObject({ condition: 'NEW' });
    expect(none.calls[0].body).not.toHaveProperty('conditionDescription');
  });

  it('lists what eBay would reject (the creator draft blockers)', () => {
    const plan = buildCreatePlan({ sku: 'KX-1', action, inventoryPatch: {}, offerPatch: {}, variationPatch: null, media: [] });
    expect(plan.missing.sort()).toEqual(
      ['category', 'description', 'fulfillmentPolicy', 'paymentPolicy', 'photos', 'price', 'returnPolicy', 'title'].sort(),
    );
  });

  it('applies staged media to the photo list', () => {
    const plan = buildCreatePlan({
      sku: 'KX-1', action, inventoryPatch: fullInventory, offerPatch: fullOffer, variationPatch: null,
      media: [{ operation: 'add_url', imageUrl: 'https://i/2.jpg' }],
    });
    expect(plan.calls[0].body!.product.imageUrls).toEqual(['https://i/1.jpg', 'https://i/2.jpg']);
  });

  it('variations: item per variant → group → offer per variant → publish_by_inventory_item_group', () => {
    const plan = buildCreatePlan({
      sku: 'GROUP-1',
      action,
      inventoryPatch: { ...fullInventory, product: { ...fullInventory.product, aspects: { Brand: ['Belle'], Color: ['x'] } } },
      offerPatch: fullOffer,
      variationPatch: {
        variants: [
          { sku: 'GROUP-1-RED', combination: { Color: 'Red' }, quantity: 2, price: '30' },
          { sku: 'GROUP-1-BLUE', combination: { Color: 'Blue' }, quantity: '1', price: '' },
        ],
        imageVaryingAspect: 'Color',
        variationImages: { Blue: 'https://i/blue.jpg' },
        specifications: [{ name: 'Color', values: ['Red', 'Blue'] }],
      },
      media: [],
    });
    expect(plan.missing).toEqual([]);
    expect(plan.calls.map((c) => `${c.step}:${c.sku}`)).toEqual([
      'inventory_item:GROUP-1-RED',
      'inventory_item:GROUP-1-BLUE',
      'inventory_item_group:GROUP-1',
      'offer:GROUP-1-RED',
      'offer:GROUP-1-BLUE',
      'publish_group:GROUP-1',
    ]);
    // Variant's own photo leads.
    expect(plan.calls[1].body!.product.imageUrls).toEqual(['https://i/blue.jpg', 'https://i/1.jpg']);
    expect(plan.calls[0].body!.product.aspects).toEqual({ Brand: ['Belle'], Color: ['Red'] });
    // Group aspects exclude the variation axes.
    expect(plan.calls[2].body).toMatchObject({
      aspects: { Brand: ['Belle'] },
      variantSKUs: ['GROUP-1-RED', 'GROUP-1-BLUE'],
      variesBy: { aspectsImageVariesBy: ['Color'], specifications: [{ name: 'Color', values: ['Red', 'Blue'] }] },
    });
    // Blank variant price falls back to the listing price.
    expect(plan.calls[3].body!.pricingSummary.price.value).toBe('30');
    expect(plan.calls[4].body!.pricingSummary.price.value).toBe('24.99');
    expect(plan.newSkus).toEqual(['GROUP-1-RED', 'GROUP-1-BLUE', 'GROUP-1']);
  });
});

describe('computeEbayDiff / dropRejectedKeys (F3)', () => {
  const base = { product: { title: 'Old', aspects: { Brand: ['A'] } }, availability: { shipToLocationAvailability: { quantity: 5 } } };
  const live = { product: { title: 'Changed on eBay', aspects: { Brand: ['A'] } }, availability: { shipToLocationAvailability: { quantity: 4 } } };
  const offerBase = { pricingSummary: { price: { value: '10.00', currency: 'USD' } } };
  const fields = computeEbayDiff({
    baseInventory: base,
    baseOffer: offerBase,
    liveInventory: live,
    liveOffer: offerBase,
    inventoryPatch: { product: { title: 'Mine' } },
    offerPatch: { pricingSummary: { price: { value: '12.00', currency: 'USD' } } },
  });

  it('lists fields both sides touched, draft-only and eBay-only', () => {
    expect(fields.map((f) => [f.key, f.inDraft, f.changedRemotely])).toEqual([
      ['title', true, true],
      ['quantity', false, true],
      ['price', true, false],
    ]);
    expect(fields[0]).toMatchObject({ base: 'Old', remote: 'Changed on eBay', draft: 'Mine' });
  });

  it('drops only conflicting fields the user gave to eBay', () => {
    const dropEbay = dropRejectedKeys({ fields, keep: [], inventoryPatch: { product: { title: 'Mine' } }, offerPatch: { pricingSummary: { price: { value: '12.00' } } } });
    expect(dropEbay.inventoryPatch).toEqual({});
    expect(dropEbay.offerPatch).toEqual({ pricingSummary: { price: { value: '12.00' } } });
    expect(dropEbay.dropped).toEqual(['title']);
    const keepMine = dropRejectedKeys({ fields, keep: ['title'], inventoryPatch: { product: { title: 'Mine' } }, offerPatch: {} });
    expect(keepMine.inventoryPatch).toEqual({ product: { title: 'Mine' } });
  });

  it("description is ONE choice covering the item description and the offer's listingDescription", () => {
    // eBay changed only the offer copy (what buyers see); the draft staged both copies.
    const desc = computeEbayDiff({
      baseInventory: { product: { description: '<p>Old</p>' } },
      baseOffer: { listingDescription: '<p>Old</p>' },
      liveInventory: { product: { description: '<p>Old</p>' } },
      liveOffer: { listingDescription: '<p>Changed on eBay</p>' },
      inventoryPatch: { product: { description: '<p>Mine</p>' } },
      offerPatch: { listingDescription: '<p>Mine</p>' },
    });
    expect(desc.map((f) => [f.key, f.inDraft, f.changedRemotely])).toEqual([['description', true, true]]);
    const theirs = dropRejectedKeys({ fields: desc, keep: [], inventoryPatch: { product: { description: '<p>Mine</p>' } }, offerPatch: { listingDescription: '<p>Mine</p>' } });
    expect(theirs.inventoryPatch).toEqual({});
    expect(theirs.offerPatch).toEqual({});
    const mine = dropRejectedKeys({ fields: desc, keep: ['description'], inventoryPatch: { product: { description: '<p>Mine</p>' } }, offerPatch: { listingDescription: '<p>Mine</p>' } });
    expect(mine.offerPatch).toEqual({ listingDescription: '<p>Mine</p>' });
  });

  it("normalizeSellerSku accepts eBay's SKU characters only", () => {
    expect(normalizeSellerSku('  BB-PINK_1.2 ')).toBe('BB-PINK_1.2');
    expect(normalizeSellerSku('has space')).toBeNull();
    expect(normalizeSellerSku('x'.repeat(51))).toBeNull();
    expect(normalizeSellerSku('')).toBeNull();
    expect(normalizeSellerSku(42)).toBeNull();
  });

  it('deletePath prunes empty parents and stableJson ignores key order', () => {
    expect(deletePath({ a: { b: { c: 1 } }, d: 2 }, ['a', 'b', 'c'])).toEqual({ d: 2 });
    expect(stableJson({ b: 1, a: [1, { y: 2, x: 1 }] })).toBe(stableJson({ a: [1, { x: 1, y: 2 }], b: 1 }));
  });
});

describe('eBay draft errors (F2)', () => {
  it('maps missing item specifics to a typed key with params', () => {
    const e = classifyEbayError(new Error('eBay API 400: The item specific Color is missing. The item specific Size is missing.'));
    expect(e).toMatchObject({ code: 'MISSING_ASPECTS', status: 422, key: 'draftSync.missingAspects', params: { aspects: 'Color, Size' } });
    expect(ebayDraftErrorResponse(e, 'x').body).toMatchObject({ code: 'MISSING_ASPECTS', missingAspects: ['Color', 'Size'] });
  });
  it('maps location, reconnect and unknown failures', () => {
    expect(classifyEbayError(new Error('Item.Country missing')).code).toBe('LOCATION_REQUIRED');
    expect(classifyEbayError(Object.assign(new Error('nope'), { name: 'EbayNotConnectedError' })).code).toBe('REAUTH_REQUIRED');
    expect(classifyEbayError(new Error('eBay API 401: expired')).status).toBe(401);
    expect(classifyEbayError(new Error('eBay API 400: bad price'))).toMatchObject({ code: 'EBAY_REJECTED', key: 'draftSync.rejected' });
  });
  it('keeps typed errors and hides untyped ones behind a 500 with the message only', () => {
    const typed = new EbayDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.draftNotFound' });
    expect(classifyEbayError(typed)).toBe(typed);
    expect(ebayDraftErrorResponse(typed, 'x')).toEqual({ status: 404, body: { error: 'Draft not found', code: 'DRAFT_NOT_FOUND', key: 'draftSync.draftNotFound' } });
    expect(ebayDraftErrorResponse(new Error('boom'), 'fallback')).toEqual({ status: 500, body: { error: 'boom' } });
  });
});
