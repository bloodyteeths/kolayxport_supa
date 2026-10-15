// M6 editor Group F: the eBay adapter (components/domain/listing-editor/adapters/ebay.ts) and the eBay draft
// routes (diff / resolve / sync 409 / typed errors).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  getDraftDiff: vi.fn(),
  resolveDraft: vi.fn(),
  syncDraft: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getAuthUserOrApiKey: async () => h.user }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/ebay/draftService', () => ({
  toSerializable: (v: unknown) => JSON.parse(JSON.stringify(v)),
  getDraftDiff: h.getDraftDiff,
  resolveDraft: h.resolveDraft,
  syncDraft: h.syncDraft,
}));

import {
  blankEbayFields,
  buildEbayCreatePayload,
  buildEbayEditPayload,
  combineVariationValues,
  decodeAspects,
  decodeCreateVariations,
  decodeHtmlEntities,
  encodeCreateVariations,
  rebuildCreateVariants,
  ebayAdapter,
  ebayErrorInfo,
  ebayFailureCauseKey,
  ebayFieldsFromCopy,
  ebayFieldsFromListing,
  ebayScoreInput,
  encodeAspects,
  overlayEbayPatches,
  plainTextToHtml,
  toEbayAction,
  toEbayDraftRow,
  validateEbayEditorFields,
  type EbayListingData,
} from '@/components/domain/listing-editor/adapters/ebay';
import { EbayDraftClientError, syncEbayDraft } from '@/lib/ebay/draftClient';
import { EbayDraftError } from '@/lib/ebay/draftErrors';
import diffHandler, { shapeEbayDraftDiff } from '../../pages/api/ebay-drafts/[id]/diff';
import resolveHandler, { parseKeep } from '../../pages/api/ebay-drafts/[id]/resolve';
import syncHandler from '../../pages/api/ebay-drafts/[id]/sync';

const listing: EbayListingData = {
  sku: 'BOX-1',
  product: {
    title: 'Mom&#39;s Wooden Box',
    description: '<p>It&#39;s hand made</p>',
    imageUrls: ['https://i/1.jpg', 'https://i/2.jpg'],
    aspects: { Material: ['Oak'], Brand: ['Belle'] },
  },
  condition: 'NEW',
  availability: { shipToLocationAvailability: { quantity: 4 } },
  offers: [{
    offerId: 'O1',
    status: 'PUBLISHED',
    pricingSummary: { price: { value: '30.00', currency: 'USD' } },
    listingPolicies: { fulfillmentPolicyId: 'F', returnPolicyId: 'R', paymentPolicyId: 'P' },
    categoryId: '77',
    listing: { listingId: '1555' },
  }],
  packageWeightAndSize: { weight: { value: 1.2, unit: 'KILOGRAM' } },
};

describe('fields from eBay (P5: entities decoded on load)', () => {
  it('maps the listing and decodes entities', () => {
    const f = ebayFieldsFromListing(listing);
    expect(f.title).toBe("Mom's Wooden Box");
    expect(f.description).toBe("<p>It's hand made</p>");
    expect(decodeAspects(f.aspects)).toEqual({ Brand: ['Belle'], Material: ['Oak'] });
    expect(f).toMatchObject({ price: '30.00', quantity: 4, categoryId: '77', weight: 1.2, length: '' });
  });
  it('encodes aspects stably regardless of name order', () => {
    expect(encodeAspects({ b: ['1'], a: ['2'] })).toBe(encodeAspects({ a: ['2'], b: ['1'] }));
    expect(encodeAspects({ Empty: [''], ' ': ['x'] })).toBe('');
  });
});

describe('edit payload (drawer handleSave parity)', () => {
  const remote = ebayFieldsFromListing(listing);

  it('stages only changed fields; description on the item and the offer; policies together', () => {
    const current = { ...remote, title: 'New Title', description: 'D', returnPolicyId: 'R2' };
    const p = buildEbayEditPayload(remote, current);
    expect(p.inventoryFields).toEqual({ product: { title: 'New Title', description: 'D' } });
    expect(p.offerFields).toEqual({
      listingDescription: 'D',
      listingPolicies: { fulfillmentPolicyId: 'F', returnPolicyId: 'R2', paymentPolicyId: 'P' },
    });
  });

  it('never sends entities back to eBay', () => {
    const p = buildEbayEditPayload(remote, { ...remote, title: 'Tom&#39;s &amp; Co' });
    expect((p.inventoryFields.product as { title: string }).title).toBe("Tom's & Co");
  });

  it('nothing changed → empty patches', () => {
    expect(buildEbayEditPayload(remote, { ...remote })).toEqual({ inventoryFields: {}, offerFields: {} });
  });

  it('stages the whole aspects map, quantity and package', () => {
    const current = { ...remote, aspects: encodeAspects({ Brand: ['Belle'] }), quantity: 9, length: 10, width: 5, height: 2 };
    const p = buildEbayEditPayload(remote, current);
    expect(p.inventoryFields).toEqual({
      product: { aspects: { Brand: ['Belle'] } },
      availability: { shipToLocationAvailability: { quantity: 9 } },
      packageWeightAndSize: { weight: { value: 1.2, unit: 'KILOGRAM' }, dimensions: { length: 10, width: 5, height: 2, unit: 'CENTIMETER' } },
    });
  });

  it('overlay → extra round-trip keeps patch content without an input', () => {
    const inv = { product: { title: 'Staged', brand: 'X' }, locale: 'en_US' };
    const ofr = { pricingSummary: { price: { value: '31.00', currency: 'USD' } }, tax: { vatPercentage: 1 } };
    const { fields, extra, applied } = overlayEbayPatches(remote, inv, ofr);
    expect(fields.title).toBe('Staged');
    expect(fields.price).toBe('31.00');
    expect(applied).toBe(2);
    expect(extra).toEqual({ 'inventory.product.brand': 'X', 'inventory.locale': 'en_US', 'offer.tax': { vatPercentage: 1 } });
    const p = buildEbayEditPayload(remote, fields, extra);
    expect(p.inventoryFields).toEqual({ product: { title: 'Staged', brand: 'X' }, locale: 'en_US' });
    expect(p.offerFields).toEqual({ pricingSummary: { price: { value: '31.00', currency: 'USD' } }, tax: { vatPercentage: 1 } });
  });
});

describe('create payload + draft rows', () => {
  it('builds the full new-listing content', () => {
    const f = { ...blankEbayFields(), title: 'Box', description: 'Desc', images: ['https://i/1.jpg'], price: '12.5', categoryId: '5', fulfillmentPolicyId: 'F', returnPolicyId: 'R', paymentPolicyId: 'P', conditionDescription: 'n/a' };
    const p = buildEbayCreatePayload(f);
    expect(p.inventoryFields).toEqual({
      condition: 'NEW',
      availability: { shipToLocationAvailability: { quantity: 1 } },
      product: { title: 'Box', description: 'Desc', imageUrls: ['https://i/1.jpg'] },
    });
    expect(p.offerFields).toEqual({
      pricingSummary: { price: { value: '12.50', currency: 'USD' } },
      categoryId: '5',
      listingPolicies: { fulfillmentPolicyId: 'F', returnPolicyId: 'R', paymentPolicyId: 'P' },
      listingDescription: 'Desc',
    });
  });

  it('toEbayDraftRow exposes editor-field keys and keeps raw patches', () => {
    const row = toEbayDraftRow({
      id: 'd1', sku: 'BOX-1', status: 'conflict',
      inventoryPatch: { product: { title: 'T' } },
      offerPatch: { listingPolicies: { fulfillmentPolicyId: 'F2', returnPolicyId: 'R', paymentPolicyId: 'P' } },
      variationPatch: null,
      queuedActions: [{ type: 'delete' }],
      media: [], syncAttempts: [{ id: 'a1', status: 'failed', startedAt: '2026-10-15', error: 'x' }],
    })!;
    expect(row.listingId).toBe('BOX-1');
    expect(row.fieldPatch).toMatchObject({ title: 'T', fulfillmentPolicyId: 'F2', returnPolicyId: 'R', paymentPolicyId: 'P' });
    expect(row.syncAttempts[0]).toMatchObject({ id: 'a1', error: 'x' });
    const { fields } = ebayAdapter.overlay(ebayFieldsFromListing(listing), row);
    expect(fields.fulfillmentPolicyId).toBe('F2');
  });

  it('maps engine actions onto the eBay engine and drops Etsy-only ones', () => {
    expect(toEbayAction({ type: 'deactivate' })).toEqual({ type: 'withdraw' });
    expect(toEbayAction({ type: 'publish' })).toEqual({ type: 'publish' });
    expect(toEbayAction({ type: 'delete' })).toEqual({ type: 'delete' });
    expect(toEbayAction({ type: 'renew' })).toBeNull();
  });
});

describe('copy / cross-list', () => {
  it('Etsy text becomes eBay HTML, title is clamped to 80, materials become an aspect', () => {
    const out = ebayFieldsFromCopy({
      source: 'etsy',
      title: 'A'.repeat(100),
      description: 'Line one\n\nLine <two>',
      tags: [],
      materials: ['Oak', 'Brass'],
      price: 20,
      imageUrls: ['https://i/1.jpg', 'http://insecure/2.jpg'],
      item_weight: 300,
      item_weight_unit: 'g',
    });
    expect(out.title).toHaveLength(80);
    expect(out.description).toBe('<p>Line one</p>\n<p>Line &lt;two&gt;</p>');
    expect(decodeAspects(out.aspects)).toEqual({ Material: ['Oak', 'Brass'] });
    expect(out).toMatchObject({ price: '20.00', images: ['https://i/1.jpg'], weight: 300, weightUnit: 'GRAM' });
    expect(plainTextToHtml('<p>already</p>')).toBe('<p>already</p>');
  });
});

describe('validation, errors, score input', () => {
  it('create needs the legacy creator blockers; edit only a title', () => {
    const create = validateEbayEditorFields(blankEbayFields(), 'create').filter((i) => i.severity === 'block_sync').map((i) => i.field);
    expect(create).toEqual(['title', 'description', 'images', 'categoryId', 'price', 'fulfillmentPolicyId', 'returnPolicyId', 'paymentPolicyId']);
    const edit = validateEbayEditorFields({ ...ebayFieldsFromListing(listing), title: 'x'.repeat(81) }, 'edit');
    expect(edit).toEqual([expect.objectContaining({ field: 'title', severity: 'block_save', key: 'ebay.validation.titleTooLong', section: 'title' })]);
  });

  it('errorInfo prefixes server keys with the ebay namespace', () => {
    const info = ebayErrorInfo(new EbayDraftClientError(422, { error: 'x', code: 'CREATE_INCOMPLETE', key: 'draftSync.createIncomplete', params: { fields: 'price' }, missing: ['price'] }));
    expect(info).toMatchObject({ status: 422, key: 'ebay.draftSync.createIncomplete', conflict: false });
    expect(info.issues).toEqual([expect.objectContaining({ field: 'price', section: 'price', key: 'ebay.validation.priceRequired' })]);
    expect(ebayErrorInfo(new TypeError('Failed to fetch')).network).toBe(true);
  });

  it('failure cause keys never expose raw text', () => {
    expect(ebayFailureCauseKey({ status: 'failed', lastSyncError: 'eBay API 400: The item specific Color is missing' })).toBe('ebay.draftSync.missingAspectsShort');
    expect(ebayFailureCauseKey({ status: 'conflict', lastSyncError: 'whatever' })).toBe('ebay.draftSync.conflict');
    expect(ebayFailureCauseKey({ status: 'failed', lastSyncError: 'SKU A is already used by a listing on eBay' })).toBe('ebay.draftSync.skuExistsShort');
    expect(ebayFailureCauseKey({ status: 'failed', lastSyncError: 'weird' })).toBe('listings.sendError.generic');
  });

  it('score input keeps unknown category metadata as na (null)', () => {
    const s = ebayScoreInput(ebayFieldsFromListing(listing));
    expect(s).toMatchObject({ imageCount: 2, aspectsRequired: null, policies: { fulfillment: true, payment: true, return: true }, package: { hasWeight: true, hasDimensions: false } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Routes + client
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
const call = async (handler: any, { method = 'GET', query = { id: 'd1' }, body }: { method?: string; query?: Record<string, string>; body?: unknown }) => {
  const r = res();
  await handler({ method, query, body, headers: {} } as any, r);
  return r;
};

describe('eBay draft routes', () => {
  beforeEach(() => {
    h.user = { id: 'u1' };
    h.getDraftDiff.mockReset();
    h.resolveDraft.mockReset();
    h.syncDraft.mockReset();
  });

  it('diff: delete first, entities decoded, sorted', async () => {
    h.getDraftDiff.mockResolvedValue({
      remoteUpdatedAt: null,
      fields: [
        { key: 'quantity', base: 1, remote: 2, draft: undefined, changedRemotely: true, inDraft: false },
        { key: 'title', base: 'a', remote: 'Tom&#39;s', draft: 'b', changedRemotely: true, inDraft: true },
      ],
      queuedActions: [{ type: 'publish' }, { type: 'delete' }],
    });
    const r = await call(diffHandler, {});
    expect(r.statusCode).toBe(200);
    expect(r.body.fields.map((f: any) => f.key)).toEqual(['title', 'quantity']);
    expect(r.body.fields[0].remote).toBe("Tom's");
    expect(r.body.queuedActions[0].type).toBe('delete');
    expect(r.body.hasQueuedDelete).toBe(true);
    expect(shapeEbayDraftDiff({ remoteUpdatedAt: 'bad', fields: [], queuedActions: null }).remoteUpdatedAt).toBeNull();
  });

  it('diff/resolve map typed errors and require auth', async () => {
    h.getDraftDiff.mockRejectedValue(new EbayDraftError('MISSING_ON_EBAY', 'gone', { status: 404, key: 'draftSync.missingOnEbay' }));
    const r = await call(diffHandler, {});
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'gone', code: 'MISSING_ON_EBAY', key: 'draftSync.missingOnEbay' });
    h.user = null;
    expect((await call(resolveHandler, { method: 'POST', body: { keep: [] } })).statusCode).toBe(401);
  });

  it('resolve validates keep and never sends', async () => {
    expect(parseKeep({ keep: ['title', 'title', 'price'] })).toEqual(['title', 'price']);
    expect(parseKeep({ keep: 'title' })).toBeNull();
    expect(parseKeep({ keep: ['1bad'] })).toBeNull();
    expect((await call(resolveHandler, { method: 'POST', body: { keep: 'x' } })).statusCode).toBe(400);
    h.resolveDraft.mockResolvedValue({ id: 'd1', status: 'draft' });
    const r = await call(resolveHandler, { method: 'POST', body: { keep: ['title'] } });
    expect(r.statusCode).toBe(200);
    expect(h.resolveDraft).toHaveBeenCalledWith('d1', 'u1', ['title']);
    expect(h.syncDraft).not.toHaveBeenCalled();
  });

  it('sync: conflict → 409 with fields; typed failure keeps code/key', async () => {
    h.syncDraft.mockResolvedValue({ status: 'conflict', draftId: 'd1', fields: ['condition'], key: 'draftSync.conflict' });
    const r = await call(syncHandler, { method: 'POST' });
    expect(r.statusCode).toBe(409);
    expect(r.body.fields).toEqual(['condition']);
    h.syncDraft.mockRejectedValue(new EbayDraftError('SKU_EXISTS', 'taken', { status: 409, key: 'draftSync.skuExists', params: { sku: 'A' } }));
    const r2 = await call(syncHandler, { method: 'POST' });
    expect(r2.statusCode).toBe(409);
    expect(r2.body).toMatchObject({ code: 'SKU_EXISTS', key: 'draftSync.skuExists', params: { sku: 'A' } });
  });
});

describe('draftClient', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('returns a 409 conflict (legacy callers check result.status) and throws typed errors otherwise', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'conflict', fields: ['condition'] }), { status: 409 })) as any;
    await expect(syncEbayDraft('d1')).resolves.toMatchObject({ status: 'conflict' });
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'Payment Required' }), { status: 402 })) as any;
    await expect(syncEbayDraft('d1')).rejects.toMatchObject({ status: 402, message: 'Payment Required', name: 'EbayDraftClientError' });
  });

  it('adapter.send never forces: a conflict throws a conflict error for Review differences', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'conflict', fields: ['condition'], key: 'draftSync.conflict' }), { status: 409 })) as any;
    const draft = toEbayDraftRow({ id: 'd1', sku: 'BOX-1', status: 'draft', inventoryPatch: {}, offerPatch: {}, queuedActions: [], media: [], syncAttempts: [] })!;
    const err = await ebayAdapter.send(draft).catch((e) => e);
    expect(ebayAdapter.errorInfo(err)).toMatchObject({ conflict: true, status: 409, key: 'ebay.draftSync.conflict' });
  });

  it('adapter.send stages the publish choice of a new listing before sending', async () => {
    const calls: Array<{ url: string; body?: any }> = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/sync')) return new Response(JSON.stringify({ status: 'success', created: true, sku: 'KX-1' }), { status: 200 });
      return new Response(JSON.stringify({ draft: { id: 'd1' } }), { status: 200 });
    }) as any;
    const draft = toEbayDraftRow({ id: 'd1', sku: 'KX-1', status: 'draft', inventoryPatch: {}, offerPatch: {}, queuedActions: [{ type: 'create', publish: true }], media: [], syncAttempts: [] })!;
    const out = await ebayAdapter.send(draft, { publish: false });
    expect(calls.map((c) => c.url)).toEqual(['/api/ebay-drafts', '/api/ebay-drafts/d1/sync']);
    expect(calls[0].body).toMatchObject({ sku: 'KX-1', queuedActions: [{ type: 'create', publish: false }] });
    expect(out.listingId).toBe('KX-1');
  });
});

describe('M6 F review fixes', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('HTML descriptions: display entities decode, escaped markup stays escaped, tags untouched (round trip)', () => {
    const html = '<p title="a &quot;b&quot;">One&#39;s box &lt;3 &amp;lt;b&amp;gt; &eacute;</p>';
    const decoded = decodeHtmlEntities(html);
    expect(decoded).toBe('<p title="a &quot;b&quot;">One\'s box &lt;3 &amp;lt;b&amp;gt; é</p>');
    expect(decodeHtmlEntities(decoded)).toBe(decoded);
    const f = ebayFieldsFromListing({ ...listing, product: { ...listing.product, description: html } });
    expect(f.description).toBe(decoded);
    // Edited and staged: escaped text is sent back escaped, never as markup.
    const payload = buildEbayEditPayload(f, { ...f, description: `${f.description}<p>new</p>` });
    expect(payload.inventoryFields.product).toMatchObject({ description: expect.stringContaining('&lt;3') });
    expect(String((payload.offerFields as any).listingDescription)).not.toContain('<3');
  });

  it('variation rows: every combination, SKUs kept for existing combinations and unique for new ones', () => {
    expect(combineVariationValues([{ name: 'Color', values: ['Pink', 'Blue'] }, { name: 'Size', values: ['S'] }])).toEqual([
      { Color: 'Pink', Size: 'S' },
      { Color: 'Blue', Size: 'S' },
    ]);
    const first = rebuildCreateVariants([{ name: 'Color', values: ['Pink', 'Blue'] }], [], 'BOX', { price: '20.00', quantity: 1 });
    expect(first.map((v) => v.sku)).toEqual(['BOX-PINK', 'BOX-BLUE']);
    const edited = [{ ...first[0], sku: 'MINE', price: '25.00' }, first[1]];
    const next = rebuildCreateVariants([{ name: 'Color', values: ['Pink', 'Blue', 'Pink!'] }], edited, 'BOX', { price: '20.00', quantity: 1 });
    expect(next.map((v) => [v.sku, v.price])).toEqual([['MINE', '25.00'], ['BOX-BLUE', '20.00'], ['BOX-PINK', '20.00']]);
    const again = rebuildCreateVariants([{ name: 'Color', values: ['Pink', 'Pink!'] }], [], 'BOX', { price: null, quantity: 1 });
    expect(new Set(again.map((v) => v.sku)).size).toBe(2);
  });

  it('create mode stages variations as variationFields and the seller SKU on the create action', async () => {
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ draft: { id: 'd1', sku: 'KX-1', status: 'draft', queuedActions: calls[calls.length - 1].queuedActions ?? [], variationPatch: calls[calls.length - 1].variationFields } }), { status: 200 });
    }) as any;
    const variations = {
      specifications: [{ name: 'Color', values: ['Pink'] }],
      variants: [{ sku: 'BB-PINK-1', combination: { Color: 'Pink' }, quantity: 2, price: '20.00' }],
    };
    const current = { ...blankEbayFields(), title: 'Box', sku: 'BB-PINK', createVariations: encodeCreateVariations(variations) };
    const staged = await ebayAdapter.stageFields({ ctx: { shopId: 'ebay', listingId: 'KX-1' }, mode: 'create', remote: null, current, extra: {}, draft: null });
    expect(calls[0]).toMatchObject({ sku: 'KX-1', variationFields: variations, queuedActions: [{ type: 'create', publish: true, sku: 'BB-PINK' }] });
    // Overlay round trip: both create-only fields come back from the draft.
    const back = ebayAdapter.overlay(blankEbayFields(), staged);
    expect(back.fields.sku).toBe('BB-PINK');
    expect(decodeCreateVariations(back.fields.createVariations)).toEqual(variations);
    // Unchanged create action → not re-sent (keeps the server's progress untouched).
    await ebayAdapter.stageFields({ ctx: { shopId: 'ebay', listingId: 'KX-1' }, mode: 'create', remote: null, current, extra: {}, draft: staged });
    expect(calls[1].queuedActions).toBeUndefined();
    // No variations → variationFields null (clears a removed set).
    await ebayAdapter.stageFields({ ctx: { shopId: 'ebay', listingId: 'KX-1' }, mode: 'create', remote: null, current: { ...current, createVariations: '' }, extra: {}, draft: staged });
    expect(calls[2].variationFields).toBeNull();
  });

  it('adapter.send keeps the seller SKU when it restages the publish choice', async () => {
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/sync')) return new Response(JSON.stringify({ status: 'success', created: true, sku: 'BB-PINK' }), { status: 200 });
      return new Response(JSON.stringify({ draft: { id: 'd1' } }), { status: 200 });
    }) as any;
    const draft = toEbayDraftRow({ id: 'd1', sku: 'KX-1', status: 'draft', inventoryPatch: {}, offerPatch: {}, queuedActions: [{ type: 'create', publish: true, sku: 'BB-PINK', progress: { sku: 'BB-PINK' } }], media: [], syncAttempts: [] })!;
    const out = await ebayAdapter.send(draft, { publish: false });
    expect(calls[0].body.queuedActions).toEqual([{ type: 'create', publish: false, sku: 'BB-PINK' }]);
    expect(out.listingId).toBe('BB-PINK');
  });

  it('validation: variations replace the listing price requirement; bad / duplicate variant SKUs and bad seller SKU block', () => {
    const base = { ...blankEbayFields(), title: 'T', description: 'D', images: ['https://i/1.jpg'], categoryId: '1', fulfillmentPolicyId: 'F', returnPolicyId: 'R', paymentPolicyId: 'P' };
    const withVars = (variants: any[]) => ({ ...base, createVariations: encodeCreateVariations({ specifications: [{ name: 'Color', values: ['A', 'B'] }], variants }) });
    const keys = (f: any) => validateEbayEditorFields(f, 'create').map((i) => i.key);
    expect(keys(withVars([{ sku: 'A1', combination: { Color: 'A' }, quantity: 1, price: '5.00' }]))).toEqual([]);
    expect(keys(withVars([{ sku: 'A1', combination: { Color: 'A' }, quantity: 1, price: null }]))).toEqual(['ebay.validation.variantPriceRequired']);
    expect(keys(withVars([
      { sku: 'A1', combination: { Color: 'A' }, quantity: 1, price: '5.00' },
      { sku: 'A1', combination: { Color: 'B' }, quantity: 1, price: '5.00' },
    ]))).toEqual(['ebay.validation.variantSkuDuplicate']);
    expect(keys({ ...base, price: '5.00', sku: 'bad sku!' })).toEqual(['ebay.validation.skuInvalid']);
    expect(validateEbayEditorFields(withVars([{ sku: '', combination: { Color: 'A' }, quantity: 1, price: '5.00' }]), 'create')[0])
      .toMatchObject({ field: 'createVariations', section: 'variations', key: 'ebay.validation.variantSkuRequired' });
  });
});
