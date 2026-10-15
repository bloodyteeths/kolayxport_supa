// M7-C pure logic: field rules + cell patches (bulk-grid §5.3 step 7, §9 step 2), send states (§6.5), draft overlay,
// banner priority (§3.3, §8), local row filter, the read query, revert plans (§6.3) and the variation price port (§7).
import { describe, expect, it, vi } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import type { ListingRow } from '@/lib/listings/types';
import type { ListingsT } from '@/components/domain/listings/columns';
import { etsyBulkConfig, ebayBulkConfig, bulkConfig } from '@/components/domain/bulk/config';
import { cellReadOnlyReason, draftKeyToField, validateField, type FieldRuleContext } from '@/components/domain/bulk/config/fields';
import {
  applyCellPatches,
  baselineOfRow,
  bulkListQuery,
  unsentEditCount,
  dirtyCells,
  overlayValues,
  parseIdsParam,
  pasteSummaryOf,
  rowSendState,
  rowSyncKey,
} from '@/components/domain/bulk/BulkEditPage';
import { pickBulkBanner, type BulkBannerInput } from '@/components/domain/bulk/BulkBanner';
import { filterGridRows } from '@/components/domain/bulk/BulkToolbar';
import { planCatalogRevert, planDiscard, planEbayRevert, planEtsyRevert, revertDraftFields, type RevertDeps } from '@/components/domain/bulk/useSessionEdits';
import { applyPriceOpsToInventory, buildVariationPriceInventory, isMultiVariation, priceModeToOp } from '@/lib/bulk/variationPriceOps';
import { C_EN, C_TR } from './c-messages';
import { m7aEn, m7aTr } from '../ds/m7a-messages';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MSG = {
  en: deepMerge(deepMerge(en as Obj, m7aEn as Obj), C_EN as Obj),
  tr: deepMerge(deepMerge(tr as Obj, m7aTr as Obj), C_TR as Obj),
};
function tFor(locale: 'en' | 'tr'): ListingsT {
  return createTranslator({ locale, messages: MSG[locale] as never, onError: () => {} }) as unknown as ListingsT;
}
const t = tFor('en');

function row(over: Partial<ListingRow> = {}): ListingRow {
  return {
    id: '1',
    title: 'Wooden Keepsake Box',
    metaLine: ['ID 1', 'WKB-01'],
    thumbUrl: null,
    price: { amount: 54, currency: 'USD' },
    qty: 12,
    editable: { price: true, qty: true },
    status: 'active',
    statusRaw: 'active',
    health: { score: 61, used: 9, total: 12, fails: [] },
    updatedAt: null,
    createdAt: null,
    extra: { section: '7' },
    externalUrl: null,
    sync: null,
    ...over,
  };
}
const sync = (over: Partial<NonNullable<ListingRow['sync']>> = {}): NonNullable<ListingRow['sync']> => ({
  draftId: 'd1',
  status: 'pending',
  changedFields: ['price'],
  draft: { price: 49 },
  queuedDelete: false,
  scheduledSendAt: null,
  syncedAt: null,
  ...over,
});

const ctx = (over: Partial<FieldRuleContext> = {}): FieldRuleContext => ({
  config: etsyBulkConfig,
  t,
  formatMoney: (a, c) => `${c} ${a.toFixed(2)}`,
  sendingIds: new Set(),
  ...over,
});

const EMPTY_SNAP = { staged: new Map(), inFlight: new Map(), pending: new Map(), failed: new Map(), drafts: new Map() };

describe('field rules', () => {
  it('Etsy: 141-character title, price below $0.20, quantity 0 are invalid; 140 chars and & once are fine', () => {
    const r = row();
    expect(validateField('title', 'x'.repeat(141), r, ctx())).toBe('Enter a title of up to 140 characters');
    expect(validateField('title', `A & B ${'x'.repeat(134)}`, r, ctx())).toBeNull();
    expect(validateField('price', 0.1, r, ctx())).toMatch(/minimum price is USD 0.20/);
    expect(validateField('price', 12.5, r, ctx())).toBeNull();
    expect(validateField('qty', 0, r, ctx())).toBe('Quantity must be at least 1.');
    expect(validateField('qty', 1000, r, ctx())).toMatch(/whole number from 0 to 999/);
    expect(validateField('title', 'Box & Lid & Bow', r, ctx())).toMatch(/can only be used once/);
  });
  it('eBay titles are limited to 80 characters and have no Etsy character rules', () => {
    const c = ctx({ config: ebayBulkConfig });
    expect(validateField('title', 'x'.repeat(81), row(), c)).toBe('Enter a title of up to 80 characters');
    expect(validateField('title', 'Box & Lid & Bow', row(), c)).toBeNull();
  });
  it('read-only reasons: variations, stock-managed, queued delete, sending, not editable on the marketplace', () => {
    expect(cellReadOnlyReason(row({ editable: { price: false, qty: false, reason: 'variations' } }), 'price', ctx())).toBe(
      'Has variations: use Change price, or edit per variation in the editor',
    );
    expect(cellReadOnlyReason(row({ qty: 7, editable: { price: true, qty: false, reason: 'stock_managed' } }), 'qty', ctx())).toBe('Stock is managed by stock sync');
    expect(cellReadOnlyReason(row({ sync: sync({ queuedDelete: true }) }), 'title', ctx())).toBe('Will be deleted on send');
    expect(cellReadOnlyReason(row(), 'title', ctx({ sendingIds: new Set(['1']) }))).toBe('Sending to Etsy…');
    expect(cellReadOnlyReason(row(), 'section', ctx({ config: ebayBulkConfig }))).toBe('Not editable for eBay yet');
    expect(cellReadOnlyReason(row(), 'title', ctx())).toBeNull();
  });
  it('draft keys map to grid fields', () => {
    expect(['title', 'price', 'quantity', 'shop_section_id', 'tags', 'description'].map(draftKeyToField)).toEqual(['title', 'price', 'qty', 'section', 'tags', null]);
  });
});

describe('applyCellPatches: the §9 Google Sheets paste', () => {
  const rows = Array.from({ length: 200 }, (_, i) => row({ id: String(i + 1), title: `Old ${i}`, price: { amount: 10, currency: 'USD' }, qty: 5 }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  it('600 cells with 3 invalid (abc, 0.10, 141 chars) → 597 valid edits; 12,50 parsed by the grid is 12.5', () => {
    const patches = rows.flatMap((r, i) => [
      { rowId: r.id, field: 'title', value: i === 7 ? 'x'.repeat(141) : `New title ${i} & "Gift's"` },
      i === 3 ? { rowId: r.id, field: 'price', value: 'abc', error: 'Enter a number' } : { rowId: r.id, field: 'price', value: i === 5 ? 0.1 : i === 9 ? 12.5 : 20 + i },
      { rowId: r.id, field: 'qty', value: 100 + i },
    ]);
    const res = applyCellPatches(patches, byId, ctx(), { invalid: new Map(), dirty: new Set() });
    expect(res.valid).toHaveLength(597);
    expect(res.invalidCount).toBe(3);
    expect([...res.invalid.keys()].sort()).toEqual(['4:price', '6:price', '8:title'].sort());
    expect(res.invalid.get('4:price')?.value).toBe('abc');
    expect(res.valid.find((p) => p.rowId === '10' && p.field === 'price')?.value).toBe(12.5);
    expect(res.valid.every((p) => p.field !== 'title' || !String(p.value).includes('&#'))).toBe(true);
  });
  it('skips per-row read-only cells, drops no-op edits, clears an earlier invalid value once fixed', () => {
    const variation = row({ id: 'v', editable: { price: false, qty: false, reason: 'variations' } });
    const m = new Map([...byId, ['v', variation]]);
    const res = applyCellPatches(
      [
        { rowId: 'v', field: 'price', value: 30 },
        { rowId: '1', field: 'qty', value: 5 }, // same as live, no draft → no-op
        { rowId: '2', field: 'price', value: 15 },
      ],
      m,
      ctx(),
      { invalid: new Map([['2:price', { value: 'abc', message: 'x' }]]), dirty: new Set() },
    );
    expect(res.skipped).toBe(1);
    expect(res.valid).toEqual([{ rowId: '2', field: 'price', value: 15 }]);
    expect(res.invalid.size).toBe(0);
  });
  it('pasteSummaryOf keeps the grid counts', () => {
    expect(
      pasteSummaryOf({ kind: 'ok', patches: [], rows: 200, cols: 3, edits: 597, invalid: 3, skipped: 0, skippedReasons: [], overflow: 0, colOverflow: 0, unchanged: 0, intoSelection: false, rowIds: ['1', '2'] }),
    ).toEqual({ rows: 200, cols: 3, edits: 597, invalid: 3, skipped: 0, overflow: 0, listings: 2 });
  });
});

describe('overlay, dirty and send states', () => {
  it('overlay = server draft → staged → in flight → pending → failed → local invalid', () => {
    const r = row({ sync: sync({ draft: { price: 49, title: 'Draft T' }, changedFields: ['price', 'title'] }) });
    const snap = { ...EMPTY_SNAP, staged: new Map([['1', { qty: 3 }]]), pending: new Map([['1', { title: 'Pending T' }]]) };
    const v = overlayValues([r], etsyBulkConfig.fields, snap, new Map([['1:price', { value: 'abc', message: 'bad' }]]));
    expect(v['1']).toEqual({ price: 'abc', title: 'Pending T', qty: 3 });
    expect([...dirtyCells([r], etsyBulkConfig.fields, snap)].sort()).toEqual(['1:price', '1:qty', '1:title']);
  });
  it('C1: a change = one listing; conflicts, queued deletes and sending rows are not sendable', () => {
    const s = new Set<string>();
    expect(rowSendState(row({ sync: sync() }), EMPTY_SNAP, s)).toBe('sendable');
    expect(rowSendState(row({ sync: sync({ status: 'sync_failed' }) }), EMPTY_SNAP, s)).toBe('sendable');
    expect(rowSendState(row({ sync: sync({ status: 'conflict' }) }), EMPTY_SNAP, s)).toBe('conflict');
    expect(rowSendState(row({ sync: sync({ queuedDelete: true }) }), EMPTY_SNAP, s)).toBe('delete');
    expect(rowSendState(row({ sync: sync({ status: 'syncing' }) }), EMPTY_SNAP, s)).toBe('syncing');
    expect(rowSendState(row(), { ...EMPTY_SNAP, pending: new Map([['1', { price: 1 }]]) }, s)).toBe('sendable');
    expect(rowSendState(row(), { ...EMPTY_SNAP, staged: new Map([['1', { price: 1 }]]), drafts: new Map([['1', { status: 'conflict' as const }]]) }, s)).toBe('conflict');
    expect(rowSendState(row(), EMPTY_SNAP, s)).toBeNull();
    expect(rowSyncKey(row(), { ...EMPTY_SNAP, pending: new Map([['1', { price: 1 }]]) }, s)).toBe('pending');
  });
});

describe('read query', () => {
  it('?ids= reads exactly those listings without the default view filter, one page of ≤ 250', () => {
    const url = { shop: 'S1', view: undefined, sort: 'title.asc', page: 3, size: 250, status: [] } as never;
    const { query, key } = bulkListQuery(url, etsyBulkConfig, ['5', '6']);
    expect(query).toEqual({ marketplace: 'etsy', store: 'S1', sort: 'title.asc', page: 1, size: 250 });
    expect(key).toBe('/api/listings?marketplace=etsy&store=S1&sort=title.asc&size=250&ids=5%2C6');
    expect(parseIdsParam(' 1,2,,2 ,3')).toEqual(['1', '2', '3']);
    expect(parseIdsParam(Array.from({ length: 300 }, (_, i) => i).join(','))).toHaveLength(250);
    expect(parseIdsParam(undefined)).toBeNull();
  });
});

describe('banner priority', () => {
  const base: BulkBannerInput = {
    marketplace: 'etsy',
    limitHit: false,
    stripeUpsell: true,
    needsReauth: false,
    paste: null,
    saving: null,
    failedListings: 0,
    invalid: { count: 0, reason: null },
    conflicts: 0,
  };
  it('paste result while saving, then saved; invalid > 0 → warning with Show them', () => {
    const paste = { rows: 200, cols: 3, edits: 597, invalid: 3, skipped: 0, overflow: 0, listings: 200 };
    const saving = pickBulkBanner({ ...base, paste, saving: { done: 120, total: 200 } }, t, { onShowInvalid: vi.fn() });
    expect(saving?.title).toBe('Pasted 200 rows × 3 columns · 597 edits · 3 invalid');
    expect(saving?.detail).toBe('Saving 120 / 200…');
    expect(saving?.tone).toBe('warning');
    expect(saving?.action?.label).toBe('Show them');
    const done = pickBulkBanner({ ...base, paste: { ...paste, invalid: 0, edits: 600 } }, t);
    expect(done?.tone).toBe('success');
    expect(done?.detail).toBe('Saved · 200 listings, 600 edits not sent');
  });
  it('usage limit wins; shopify_free gets no See plans', () => {
    const b = pickBulkBanner({ ...base, limitHit: true, stripeUpsell: false, failedListings: 2 }, t);
    expect(b?.id).toBe('limit');
    expect(b?.action).toBeUndefined();
    expect(pickBulkBanner({ ...base, limitHit: true }, t)?.action?.href).toBe('/fiyatlandirma?from=bulk-etsy');
  });
  it('failed listings, then invalid, then conflicts; nothing → null', () => {
    expect(pickBulkBanner({ ...base, failedListings: 2, invalid: { count: 1, reason: 'x' } }, t)?.title).toBe("2 listings couldn't be saved");
    expect(pickBulkBanner({ ...base, invalid: { count: 3, reason: "Etsy's minimum price is $0.20" } }, t)?.title).toBe("3 edits can't be saved: Etsy's minimum price is $0.20");
    expect(pickBulkBanner({ ...base, conflicts: 2 }, t)?.title).toMatch(/^2 listings changed on Etsy since your drafts/);
    expect(pickBulkBanner(base, t)).toBeNull();
  });
  it('Turkish copy', () => {
    const b = pickBulkBanner({ ...base, paste: { rows: 200, cols: 3, edits: 597, invalid: 3, skipped: 0, overflow: 0, listings: 200 } }, tFor('tr'));
    expect(b?.title).toBe('200 satır × 3 sütun yapıştırıldı · 597 düzenleme · 3 geçersiz');
    expect(b?.detail).toBe('Kaydedildi · 200 ilan, 597 düzenleme gönderilmedi');
  });
});

describe('row filter', () => {
  it('filters by text, edited and invalid rows', () => {
    const rows = [row({ id: '1', title: 'Baby Blanket' }), row({ id: '2', title: 'Keepsake Box', metaLine: ['ID 2', 'KB-9'] })];
    const sets = { dirtyRows: new Set(['2']), invalidRows: new Set(['1']) };
    expect(filterGridRows(rows, { q: 'kb-9', show: 'all', ...sets }).map((r) => r.id)).toEqual(['2']);
    expect(filterGridRows(rows, { q: '', show: 'edited', ...sets }).map((r) => r.id)).toEqual(['2']);
    expect(filterGridRows(rows, { q: '', show: 'invalid', ...sets }).map((r) => r.id)).toEqual(['1']);
  });
});

describe('revert plans (§6.3)', () => {
  it('Etsy: removes the keys; discards an empty draft; a queued delete forces a rewrite (never dropped)', () => {
    expect(planEtsyRevert({ id: 'd', status: 'draft', fieldPatch: { price: 1, title: 'x' } }, ['price'])).toEqual({ kind: 'rewrite', draftId: 'd', patch: { fields: { title: 'x' } } });
    expect(planEtsyRevert({ id: 'd', status: 'failed', fieldPatch: { quantity: 1 } }, ['qty'])).toEqual({ kind: 'discard', draftId: 'd' });
    expect(planEtsyRevert({ id: 'd', status: 'draft', fieldPatch: { price: 1 }, queuedActions: [{ type: 'delete' }] }, ['price'])).toEqual({ kind: 'rewrite', draftId: 'd', patch: { fields: {} } });
    expect(planEtsyRevert({ id: 'd', status: 'draft', fieldPatch: { price: 1 }, media: [{ id: 'm' }] }, ['price']).kind).toBe('rewrite');
    expect(planEtsyRevert({ id: 'd', status: 'syncing', fieldPatch: { price: 1 } }, ['price']).kind).toBe('none');
    expect(planEtsyRevert({ id: 'd', status: 'draft', fieldPatch: { title: 'x' } }, ['price']).kind).toBe('none');
  });
  it('eBay and catalog', () => {
    expect(planEbayRevert({ id: 'e', status: 'draft', inventoryPatch: { product: { title: 'x', description: 'y' } }, offerPatch: { pricingSummary: {} } }, ['title', 'price'])).toEqual({
      kind: 'rewrite',
      draftId: 'e',
      patch: { inventoryFields: { product: { description: 'y' } }, offerFields: {} },
    });
    expect(planEbayRevert({ id: 'e', status: 'draft', inventoryPatch: { availability: {} }, offerPatch: {} }, ['qty'])).toEqual({ kind: 'discard', draftId: 'e' });
    expect(planCatalogRevert({ id: 'c', status: 'draft', fieldPatch: { price: 1, title: 'x' }, queuedActions: [] }, ['price'])).toEqual({ kind: 'rewrite', draftId: 'c', patch: { fields: { price: null } } });
    expect(planCatalogRevert({ id: 'c', status: 'draft', fieldPatch: { quantity: 1 }, queuedActions: [] }, ['qty'])).toEqual({ kind: 'discard', draftId: 'c' });
  });
  it('revertDraftFields re-reads the Etsy draft and writes the remaining patch with replaceFields', async () => {
    const deps = {
      etsy: {
        fetch: vi.fn(async () => [{ id: 'd1', status: 'draft', etsyListingId: '11', fieldPatch: { price: 1, title: 'T', description: 'kept' } }]),
        stage: vi.fn(async () => ({})),
        discard: vi.fn(async () => ({})),
      },
    } as unknown as RevertDeps;
    expect(await revertDraftFields({ kind: 'etsy', marketplace: 'etsy', storeId: 'S1' }, '11', ['price', 'title'], deps)).toBe('rewritten');
    expect(deps.etsy.fetch).toHaveBeenCalledWith('S1', '11');
    expect(deps.etsy.stage).toHaveBeenCalledWith({ shopId: 'S1', listingId: '11', fields: { description: 'kept' }, replaceFields: true });
    expect(deps.etsy.discard).not.toHaveBeenCalled();
  });
});

describe('variation price ops (BulkEditor port)', () => {
  const inv = {
    products: [
      { product_id: 1, property_values: [{ property_id: 200, values: ['S'] }], offerings: [{ offering_id: 1, price: { amount: 3800, divisor: 100 }, quantity: 4 }] },
      { product_id: 2, property_values: [{ property_id: 200, values: ['M'] }], offerings: [{ offering_id: 2, price: { amount: 4200, divisor: 100 }, quantity: 0 }] },
      { product_id: 3, is_deleted: true, offerings: [] },
    ],
    price_on_property: [200],
  };
  it('applies +10% to every offering, keeps quantities, never below $0.20', () => {
    expect(isMultiVariation(inv)).toBe(true);
    const out = applyPriceOpsToInventory(inv, [priceModeToOp('incPct', 10)]) as { products: Array<{ offerings: Array<{ price: { amount: number }; quantity: number }> }>; price_on_property: number[] };
    expect(out.products).toHaveLength(2);
    expect(out.products.map((p) => p.offerings[0].price.amount)).toEqual([4180, 4620]);
    expect(out.products.map((p) => p.offerings[0].quantity)).toEqual([4, 0]);
    expect(out.price_on_property).toEqual([200]);
    const low = applyPriceOpsToInventory(inv, [priceModeToOp('set', 0.01)]) as { products: Array<{ offerings: Array<{ price: { amount: number } }> }> };
    expect(low.products[0].offerings[0].price.amount).toBe(20);
  });
  it('single-product inventories return null; an open draft inventory wins over the live one', async () => {
    expect(applyPriceOpsToInventory({ products: [{ property_values: [], offerings: [] }] }, [priceModeToOp('set', 5)])).toBeNull();
    const draftInv = { products: [{ property_values: [{ property_id: 1 }], offerings: [{ price: { amount: 1000, divisor: 100 } }] }, { offerings: [] }] };
    const res = (await buildVariationPriceInventory('S', 'L', [priceModeToOp('incAmt', 1)], {}, {
      fetchInventory: async () => inv,
      fetchDrafts: async () => [{ status: 'draft', inventoryPatch: draftInv }],
    })) as { products: Array<{ offerings: Array<{ price: { amount: number } }> }> };
    expect(res.products[0].offerings[0].price.amount).toBe(1100);
  });
});

describe('configs', () => {
  it('every marketplace has a config with its listings route and a bulk.<mp>.columns key', () => {
    for (const mp of ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'] as const) {
      const c = bulkConfig(mp);
      expect(c.marketplace).toBe(mp);
      expect(c.columnStateKey).toBe(`bulk.${mp}.columns`);
      expect(c.fields).toEqual(expect.arrayContaining(['title', 'price', 'qty']));
    }
    expect(etsyBulkConfig.photosHref?.(['1', '2'], 'S1')).toBe('/app/etsy-listings/photos?ids=1%2C2&shop=S1');
  });
});

describe('review fixes: pre-session values and server-only draft fields', () => {
  it('a server draft change the overlay cannot show (section) is not a dirty cell, but still counts as an unsent edit', () => {
    const r = row({ sync: sync({ changedFields: ['shop_section_id', 'price'], draft: { price: 49 } }) });
    const empty = { staged: new Map(), inFlight: new Map(), pending: new Map() };
    const dirty = dirtyCells([r], etsyBulkConfig.fields, empty);
    expect(Array.from(dirty)).toEqual(['1:price']);
    expect(unsentEditCount([r], etsyBulkConfig.fields, dirty)).toBe(2);
  });

  it('setting a server-dirty field back to its live value is staged, not dropped as a no-op', () => {
    const r = row({ sync: sync({ changedFields: ['shop_section_id'], draft: {} }) });
    const res = applyCellPatches([{ rowId: '1', field: 'section', value: '7' }], new Map([['1', r]]), ctx(), { invalid: new Map(), dirty: new Set() });
    expect(res.valid).toEqual([{ rowId: '1', field: 'section', value: '7' }]);
  });

  it('baselineOfRow: none / value / unknown', () => {
    expect(baselineOfRow(row(), 'price')).toEqual({ kind: 'none' });
    expect(baselineOfRow(row({ sync: sync({}) }), 'price')).toEqual({ kind: 'value', value: 49 });
    expect(baselineOfRow(row({ sync: sync({ changedFields: ['shop_section_id'], draft: {} }) }), 'section')).toEqual({ kind: 'unknown' });
  });

  it('planDiscard restores known pre-session values and keeps unknown ones', () => {
    const edits = new Map([
      ['1', new Set(['price', 'title'] as const)],
      ['2', new Set(['section'] as const)],
    ]);
    const base = (rowId: string, field: string) =>
      rowId === '1' && field === 'price' ? ({ kind: 'value', value: 10 } as const) : rowId === '2' ? ({ kind: 'unknown' } as const) : ({ kind: 'none' } as const);
    const plan = planDiscard(edits, base);
    expect(plan.cells).toEqual([
      { rowId: '1', field: 'price' },
      { rowId: '1', field: 'title' },
    ]);
    expect(plan.restore.get('1')).toEqual({ price: 10 });
    expect(plan.kept).toEqual([{ rowId: '2', field: 'section' }]);
  });

  it('revert plans write restored values instead of dropping the field', () => {
    expect(planEtsyRevert({ id: 'd', status: 'draft', fieldPatch: { price: 12, title: 'x' } }, ['price', 'title'], { price: 10 })).toEqual({
      kind: 'rewrite',
      draftId: 'd',
      patch: { fields: { price: 10 } },
    });
    expect(
      planEbayRevert(
        { id: 'e', status: 'draft', inventoryPatch: { availability: { shipToLocationAvailability: { quantity: 4 } } }, offerPatch: { pricingSummary: { price: { value: '12.00', currency: 'USD' } } } },
        ['qty', 'price'],
        { qty: 3, price: 10 },
      ),
    ).toEqual({
      kind: 'rewrite',
      draftId: 'e',
      patch: {
        inventoryFields: { availability: { shipToLocationAvailability: { quantity: 3 } } },
        offerFields: { pricingSummary: { price: { value: '10.00', currency: 'USD' } } },
      },
    });
    expect(planCatalogRevert({ id: 'c', status: 'draft', fieldPatch: { price: 12 }, queuedActions: [] }, ['price'], { price: 10 })).toEqual({
      kind: 'rewrite',
      draftId: 'c',
      patch: { fields: { price: 10 } },
    });
  });
});
