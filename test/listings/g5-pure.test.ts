// listings G5 pure logic: URL state ↔ query, send plan (never conflicts / queued deletes), bulk math, empty states,
// config invariants (listings-grid §3, §5, §6, §7, §9.4, §15).
import { describe, expect, it, vi } from 'vitest';

// lib/auth-context.js holds JSX in a .js file; the page module imports it (tests mock it, as the shell tests do).
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null }) }));
import { parseUrlState } from '@/lib/ds/useUrlState';
import type { ListingRow, ListingsResponse } from '@/lib/listings/types';
import { LISTINGS_CONFIGS } from '@/components/domain/listings/config';
import {
  LISTINGS_URL_SCHEMA,
  fromFilterValues,
  hasActiveFilters,
  savedViewQuery,
  toFilterValues,
  toListingsQuery,
  viewPatch,
} from '@/components/domain/listings/useListings';
import { mergeOverlay, openStatus, planSend, sendableDraftIds, toSendResult, twoDecimals, type OpenDraft } from '@/components/domain/listings/useStagedChanges';
import { dirtyCellKeys, displayPrice, rowSyncKey } from '@/components/domain/listings/columns';
import { computeNewPrice, planPriceChanges } from '@/components/domain/listings/bulk/ChangePriceModal';
import { computeNewQty, planStockChanges } from '@/components/domain/listings/bulk/ChangeStockModal';
import { applyTags, planTagChanges } from '@/components/domain/listings/bulk/AddTagsModal';
import { minScheduleTime } from '@/components/domain/listings/bulk/ScheduleSendModal';
import { listingsEmptyKind } from '@/components/domain/listings/ListingsTable';
import { parseOptions, optionsUrl } from '@/components/domain/listings/ListingsToolbar';
import { legacyForStore, parseLegacySchedules, remainingLegacyRaw } from '@/components/domain/listings/ListingsPage';
import { excludedClauses } from '@/components/domain/listings/SendChangesAction';
import { editReadOnlyReason, removalKindOf, type ListingsT } from '@/components/domain/listings/columns';
import { fromEbayError } from '@/components/domain/listings/useStagedChanges';

const etsy = LISTINGS_CONFIGS.etsy;
const url = (q: Record<string, string | string[]> = {}) => parseUrlState(LISTINGS_URL_SCHEMA, q);

export function row(over: Partial<ListingRow> = {}): ListingRow {
  return {
    id: '1',
    title: 'Baby blanket',
    metaLine: ['ID 1'],
    thumbUrl: null,
    price: { amount: 54, currency: 'USD' },
    qty: 3,
    editable: { price: true, qty: true },
    status: 'active',
    statusRaw: 'active',
    health: { score: 61, used: 9, total: 12, fails: [] },
    updatedAt: null,
    createdAt: null,
    extra: {},
    externalUrl: null,
    sync: null,
    ...over,
  };
}

describe('URL state → GET /api/listings query', () => {
  it('Etsy defaults to the active view (status=active), page 1, size 50, sort updated.desc', () => {
    const q = toListingsQuery(url(), etsy);
    expect(q).toMatchObject({ marketplace: 'etsy', status: ['active'], page: 1, size: 50, sort: 'updated.desc' });
    expect(q.sync).toBeUndefined();
  });
  it('eBay defaults to all (no status filter)', () => {
    expect(toListingsQuery(url(), LISTINGS_CONFIGS.ebay).status).toBeUndefined();
  });
  it('built-in views contribute their §5 query', () => {
    expect(toListingsQuery(url({ view: 'not_sent' }), etsy)).toMatchObject({ sync: ['pending'] });
    expect(toListingsQuery(url({ view: 'send_failed' }), etsy)).toMatchObject({ sync: ['sync_failed', 'conflict'] });
    expect(toListingsQuery(url({ view: 'needs_work' }), etsy)).toMatchObject({ health: 'lt50' });
    expect(toListingsQuery(url({ view: 'inactive' }), etsy).status).toEqual(['inactive', 'draft', 'expired']);
  });
  it('explicit filters win over the view and map the f.* keys', () => {
    const q = toListingsQuery(
      url({ status: 'sold_out', 'f.hasVideo': '1', 'f.priceMin': '10', 'f.priceMax': 'x', section: '77', shop: 'S1', q: 'blanket', sort: 'price.asc', page: '3' }),
      etsy,
    );
    expect(q).toMatchObject({ status: ['sold_out'], hasVideo: true, priceMin: 10, section: '77', store: 'S1', q: 'blanket', sort: 'price.asc', page: 3 });
    expect(q.priceMax).toBeUndefined();
  });
  it('Wix reads its store from ?site=', () => {
    expect(toListingsQuery(url({ site: 'W1', shop: 'nope' }), LISTINGS_CONFIGS.wix).store).toBe('W1');
    expect(toListingsQuery(url({ shop: 'X' }), LISTINGS_CONFIGS.ebay).store).toBeUndefined();
  });
  it('filter values round-trip through the toolbar', () => {
    const u = url({ status: 'active,sold_out', health: 'missing_tags', 'f.photos': 'lt5', 'f.priceMin': '5' });
    const v = toFilterValues(u, etsy.filters);
    expect(v).toMatchObject({ status: ['active', 'sold_out'], health: 'missing_tags', photos: 'lt5', price: { min: 5, max: undefined } });
    const patch = fromFilterValues({ ...v, price: undefined, hasVideo: true }, etsy.filters);
    expect(patch).toMatchObject({ status: ['active', 'sold_out'], 'f.hasVideo': '1', 'f.priceMin': undefined, 'f.photos': 'lt5' });
  });
  it('a built-in view switch keeps the filters (they combine); selecting the default view stores no ?view=', () => {
    const p = viewPatch('active', [], etsy);
    expect(p.view).toBeUndefined();
    expect(p).toEqual({ view: undefined });
    expect('status' in p).toBe(false);
    expect(viewPatch('needs_work', [], etsy).view).toBe('needs_work');
    const user = viewPatch('u_1', [{ id: 'u_1', query: { status: ['sold_out'], q: 'gold', bogus: 'x' } }], etsy);
    expect(user).toMatchObject({ view: 'u_1', status: ['sold_out'], q: 'gold' });
    expect((user as Record<string, unknown>).bogus).toBeUndefined();
  });
  it('saved view query and active-filter detection', () => {
    const u = url({ status: 'active', q: 'x', page: '2' });
    expect(savedViewQuery(u)).toEqual({ q: 'x', status: ['active'] });
    expect(hasActiveFilters(u)).toBe(true);
    expect(hasActiveFilters(url({ view: 'needs_work', page: '4' }))).toBe(false);
  });
});

describe('Send N plan (§6.2): never conflicts, never queued deletes', () => {
  const d = (over: Partial<OpenDraft>): OpenDraft => ({ draftId: 'd', id: 'l', status: 'pending', queuedDelete: false, createsListing: false, ...over });
  it('partitions open drafts', () => {
    const plan = planSend([
      d({ draftId: 'a' }),
      d({ draftId: 'b', status: 'sync_failed' }),
      d({ draftId: 'c', status: 'conflict' }),
      d({ draftId: 'e', queuedDelete: true }),
      d({ draftId: 'f', status: 'syncing' }),
      d({ draftId: 'g', createsListing: true }),
      d({ draftId: 'h', status: 'conflict', queuedDelete: true }),
    ]);
    expect(plan.sendable.map((x) => x.draftId)).toEqual(['a', 'b']);
    expect(plan.conflicts.map((x) => x.draftId)).toEqual(['c', 'h']);
    expect(plan.deletes.map((x) => x.draftId)).toEqual(['e']);
    expect(plan.syncing.map((x) => x.draftId)).toEqual(['f']);
    expect(plan.newListings.map((x) => x.draftId)).toEqual(['g']);
  });
  it('excluded clauses: one clause per non-empty bucket, no dangling "and"', () => {
    const t = ((k: string, v?: Record<string, unknown>) => `${k.split('.').pop()}:${v?.count ?? ''}`) as unknown as ListingsT;
    const one = [d({})];
    expect(excludedClauses({ conflicts: one, deletes: [], newListings: [], syncing: [] }, t, 'etsy')).toBe('conflicts:1');
    expect(excludedClauses({ conflicts: [], deletes: one, newListings: [], syncing: [] }, t, 'etsy')).toBe('deletes:1');
    expect(excludedClauses({ conflicts: one, deletes: one, newListings: one, syncing: one }, t, 'etsy')).toBe('conflicts:1 · deletes:1 · newListings:1 · syncing:1');
    expect(excludedClauses({ conflicts: [], deletes: [], newListings: [], syncing: [] }, t, 'etsy')).toBe('');
  });
  it('row-level sendable ids exclude conflict, syncing, synced and queued deletes', () => {
    const sync = (status: 'pending' | 'sync_failed' | 'conflict' | 'syncing' | 'synced', queuedDelete = false) => ({
      draftId: `d-${status}-${queuedDelete}`,
      status,
      changedFields: ['price'],
      draft: {},
      queuedDelete,
      scheduledSendAt: null,
      syncedAt: null,
    });
    const rows = [row({ sync: sync('pending') }), row({ sync: sync('sync_failed') }), row({ sync: sync('conflict') }), row({ sync: sync('syncing') }), row({ sync: sync('synced') }), row({ sync: sync('pending', true) })];
    expect(sendableDraftIds(rows)).toEqual(['d-pending-false', 'd-sync_failed-false']);
  });
  it('raw draft statuses map to open keys; closed drafts are dropped', () => {
    expect(['draft', 'failed', 'conflict', 'syncing', 'synced', 'cancelled'].map(openStatus)).toEqual(['pending', 'sync_failed', 'conflict', 'syncing', null, null]);
  });
  it('normalises bulk-sync responses and never reports an unknown body as success', () => {
    expect(
      toSendResult(
        { results: [{ draftId: 'a', status: 'success' }, { draftId: 'b', status: 'failed', key: 'draftSync.x' }, { draftId: 'c', status: 'conflict' }, { draftId: 'd', status: 'pending' }] },
        ['a', 'b', 'c', 'd'],
      ),
    ).toEqual({ sent: ['a'], failed: [{ id: 'b', errorKey: 'draftSync.x' }], conflicts: ['c'] });
    expect(toSendResult({ sent: ['x'], failed: [], conflicts: [] }, ['x']).sent).toEqual(['x']);
    expect(toSendResult({}, ['q']).failed).toEqual([{ id: 'q', errorKey: '' }]);
  });
  it('eBay price strings are dot-decimal with two places', () => {
    expect([twoDecimals(12.5), twoDecimals(0.2), twoDecimals(1234), twoDecimals(9.999)]).toEqual(['12.50', '0.20', '1234.00', '10.00']);
  });
});

describe('cells: draft overlay, sync pill, dirty cells', () => {
  const synced = row({
    sync: { draftId: 'd1', status: 'pending', changedFields: ['price'], draft: { price: 49 }, queuedDelete: false, scheduledSendAt: null, syncedAt: null },
  });
  it('shows the draft value, never the live one, and marks it dirty', () => {
    expect(displayPrice(synced, new Map())).toBe(49);
    expect(dirtyCellKeys([synced], new Map())).toEqual(new Set(['1:price']));
  });
  it('local optimistic overlay wins and adds a pending pill before the refetch', () => {
    const o = new Map([['2', mergeOverlay(undefined, { qty: 7 })]]);
    const r = row({ id: '2' });
    expect(rowSyncKey(r, new Set(), o)).toBe('pending');
    expect(dirtyCellKeys([r], o)).toEqual(new Set(['2:qty']));
    expect(rowSyncKey(synced, new Set(['1']))).toBe('syncing');
    expect(rowSyncKey(row(), new Set())).toBeNull();
  });
});

describe('bulk modals (§6.3)', () => {
  it('computes prices with rounding and a floor', () => {
    expect(computeNewPrice(38, 'incPct', 10, 'none')).toBe(41.8);
    expect(computeNewPrice(38, 'incPct', 10, '99')).toBe(41.99);
    expect(computeNewPrice(38.4, 'set', 38.4, '00')).toBe(38);
    expect(computeNewPrice(5, 'decAmt', 10, 'none')).toBeNull();
    expect(computeNewPrice(5, 'decPct', -1, 'none')).toBeNull();
  });
  it('skips variation listings and prices under the marketplace minimum', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', editable: { price: false, qty: false, reason: 'variations' } }), row({ id: 'c', price: { amount: 0.3, currency: 'USD' } })];
    const plan = planPriceChanges(rows, (r) => r.price?.amount ?? null, 'decPct', 50, 'none', 0.2);
    expect(plan.patches).toEqual([{ id: 'a', patch: { price: 27 }, from: 54, to: 27 }]);
    expect(plan.skippedVariations).toBe(1);
    expect(plan.skippedInvalid).toBe(1);
  });
  it('stock: set / inc / dec, clamped, skips non-editable', () => {
    expect(computeNewQty(3, 'dec', 5)).toBe(0);
    expect(computeNewQty(998, 'inc', 5, 999)).toBe(999);
    expect(computeNewQty(null, 'set', 1.5)).toBeNull();
    const plan = planStockChanges([row({ id: 'a' }), row({ id: 'b', editable: { price: true, qty: false, reason: 'not_tracked' } })], (r) => r.qty, 'set', 10);
    expect(plan).toEqual({ patches: [{ id: 'a', patch: { qty: 10 } }], skipped: 1 });
  });
  it('tags: add respects the limit, remove is case-insensitive, unknown current tags are skipped', () => {
    expect(applyTags(['a', 'b'], ['B', 'c', 'd'], 'add', 3)).toEqual({ next: ['a', 'b', 'c'], overLimit: true });
    expect(applyTags(['Gift', 'baby'], ['gift'], 'remove', 13).next).toEqual(['baby']);
    expect(applyTags(['x'], ['y'], 'replace', null).next).toEqual(['y']);
    const plan = planTagChanges([row({ id: 'a' }), row({ id: 'b' })], (r) => (r.id === 'a' ? ['x'] : null), ['y'], 'add', 13);
    expect(plan).toEqual({ patches: [{ id: 'a', patch: { tags: ['x', 'y'] } }], overLimit: 0, unknown: 1, unsentTags: 0 });
  });
  it('tags: a listing whose draft already edits tags is skipped (live tags would overwrite the staged ones)', () => {
    const staged = row({ id: 'a', sync: { draftId: 'd', status: 'pending', changedFields: ['tags'], draft: {}, queuedDelete: false, scheduledSendAt: null, syncedAt: null } });
    const plan = planTagChanges([staged, row({ id: 'b' })], () => ['x'], ['y'], 'add', 13);
    expect(plan.unsentTags).toBe(1);
    expect(plan.patches.map((p) => p.id)).toEqual(['b']);
  });
  it('schedule: at least 15 minutes ahead', () => {
    expect(minScheduleTime(new Date('2026-10-15T10:00:00Z')).toISOString()).toBe('2026-10-15T10:15:00.000Z');
  });
});

describe('empty states (§7)', () => {
  const resp = (over: Partial<ListingsResponse['counts']> = {}, lastPulledAt: string | null = '2026-10-15T00:00:00Z'): Pick<ListingsResponse, 'rows' | 'counts' | 'store'> => ({
    rows: [],
    counts: { all: 0, status: {}, sync: { pending: 0, syncing: 0, failed: 0, conflict: 0, queuedDeletes: 0 }, needsWork: 0, unscored: 0, ...over },
    store: { id: 's', name: 'Shop', currency: 'USD', lastPulledAt },
  });
  it('first pull, empty shop, done views, no results', () => {
    expect(listingsEmptyKind({ data: resp({}, null), view: 'active', filtered: false })).toBe('firstPull');
    expect(listingsEmptyKind({ data: resp(), view: 'active', filtered: false })).toBe('noListings');
    expect(listingsEmptyKind({ data: resp({ all: 5 }), view: 'not_sent', filtered: false })).toBe('doneNotSent');
    expect(listingsEmptyKind({ data: resp({ all: 5 }), view: 'send_failed', filtered: false })).toBe('doneFailed');
    expect(listingsEmptyKind({ data: resp({ all: 5 }), view: 'needs_work', filtered: false })).toBe('doneNeedsWork');
    expect(listingsEmptyKind({ data: resp({ all: 5 }), view: 'not_sent', filtered: true })).toBe('noResults');
    expect(listingsEmptyKind({ data: undefined, view: 'all', filtered: false })).toBeNull();
  });
});

describe('filter options and legacy schedules', () => {
  it('parses sections and collections', () => {
    expect(parseOptions('sections', { shop_sections: [{ shop_section_id: 9, title: 'Blankets' }] })).toEqual([{ value: '9', label: 'Blankets' }]);
    expect(parseOptions('collections', { collections: [{ id: 'c1', name: 'Tr' }] })).toEqual([{ value: 'c1', label: 'Tr' }]);
    expect(optionsUrl('sections', null)).toBeNull();
    expect(optionsUrl('brands', 's')).toBeNull();
  });
  it('reads pending legacy scheduled updates and ignores junk', () => {
    const raw = JSON.stringify([
      { listingId: 11, scheduledAt: '2026-11-01T09:00:00Z', changes: { price: '12.5', quantity: 3 } },
      { listingId: 12, scheduledAt: '2026-11-01T09:00:00Z', changes: {} },
      { listingId: 13, scheduledAt: '2026-11-01T09:00:00Z', status: 'done', changes: { price: 1 } },
      { scheduledAt: 'x' },
    ]);
    expect(parseLegacySchedules(raw).map(({ raw: _raw, ...u }) => u)).toEqual([
      { listingId: '11', shopId: null, changes: { price: 12.5, qty: 3 }, scheduledAt: '2026-11-01T09:00:00Z' },
    ]);
    expect(parseLegacySchedules('not json')).toEqual([]);
    expect(parseLegacySchedules(null)).toEqual([]);
  });
  it('carries description and shop_id; only this shop is offered; storage keeps what was not staged', () => {
    const entries = [
      { id: '1', listing_id: '11', shop_id: 'A', scheduled_at: '2026-11-01T09:00:00Z', changes: { description: 'New text' } },
      { id: '2', listing_id: '12', shop_id: 'B', scheduled_at: '2026-11-01T09:00:00Z', changes: { price: '9.00' } },
      { id: '3', listing_id: '13', shop_id: 'A', scheduled_at: '2026-11-01T09:00:00Z', changes: {} },
    ];
    const raw = JSON.stringify(entries);
    const parsed = parseLegacySchedules(raw);
    expect(parsed.map((u) => [u.listingId, u.shopId, u.changes])).toEqual([
      ['11', 'A', { description: 'New text' }],
      ['12', 'B', { price: 9 }],
    ]);
    const forA = legacyForStore(parsed, 'A', { stagesDescription: true });
    expect(forA.movable.map((u) => u.listingId)).toEqual(['11']);
    expect(legacyForStore(parsed, 'A', { stagesDescription: false })).toEqual({ movable: [], kept: [parsed[0]] });
    // Staging shop A's entry leaves shop B's and the unparseable one in storage.
    expect(remainingLegacyRaw(raw, [forA.movable[0].raw])).toEqual([entries[1], entries[2]]);
    expect(remainingLegacyRaw(raw, parsed.map((u) => u.raw))).toEqual([entries[2]]);
  });
});

describe('configs (§3, §15)', () => {
  it('every marketplace has the shared core columns, ≤ 4 bulk actions, ≤ 3 pinned filters and a column key', () => {
    for (const [mp, c] of Object.entries(LISTINGS_CONFIGS)) {
      expect(c.marketplace).toBe(mp);
      for (const k of ['thumb', 'listing', 'price', 'qty', 'status', 'changes', 'health', 'updated'] as const) expect(c.columns).toContain(k);
      expect(c.bulkActions.length).toBeLessThanOrEqual(4);
      expect(c.filters.filter((f) => f.pinned).length).toBeLessThanOrEqual(3);
      expect(c.filters[0].key).toBe('status');
      expect(c.columnStateKey).toBe(`listings.${mp}.columns`);
      expect(c.views).toContain(c.defaultView);
      for (const h of c.hiddenByDefault) expect(c.columns).toContain(h);
    }
    expect(LISTINGS_CONFIGS.etsy.defaultView).toBe('active');
    expect(LISTINGS_CONFIGS.trendyol.views).toContain('review');
  });
  it('the three CatalogDraft marketplaces route to their M6b editors (used only while editor-<mp> is on)', () => {
    expect(LISTINGS_CONFIGS.trendyol.editorHref('BC-1', null)).toBe('/app/trendyol-urunler/BC-1');
    expect(LISTINGS_CONFIGS.wix.editorHref('a1', 'S7')).toBe('/app/wix-urunler/a1?site=S7');
    expect(LISTINGS_CONFIGS.shopify.editorHref('42', 'S9')).toBe('/app/shopify-urunler/42?shop=S9');
    expect(LISTINGS_CONFIGS.wix.newListingHref('S7')).toBe('/app/wix-urunler/new?site=S7');
    expect(LISTINGS_CONFIGS.trendyol.newListingHref(null)).toBe('/app/trendyol-urunler/new');
    expect(LISTINGS_CONFIGS.etsy.editorHref('5', 'S')).toBe('/app/etsy-listings/5?shop=S');
  });
  it('Etsy links its Activity page and pulls with its shop id', () => {
    expect(LISTINGS_CONFIGS.etsy.headerLinks?.[0].href('S')).toBe('/app/etsy-aktivite?shop=S');
    expect(LISTINGS_CONFIGS.etsy.pull({ storeId: 'S', userId: null }).url).toBe('/api/clawd/etsy?action=sync_listings&shop_id=S');
    expect(LISTINGS_CONFIGS.ebay.pull({ storeId: null, userId: 'u' }).url).toContain('user_id=u');
  });
});

describe('review fixes', () => {
  const t = ((k: string, v?: Record<string, unknown>) => (v?.kind ? `${k}:${v.kind}` : k)) as unknown as ListingsT;
  const ctx = { config: { marketplace: 'etsy' as const, inlineEdit: { price: true, qty: true } }, sendingIds: new Set<string>(), removalKind: 'delete' as const };
  const sync = (over = {}) => ({ draftId: 'd', status: 'pending' as const, changedFields: [], draft: {}, queuedDelete: true, scheduledSendAt: null, syncedAt: null, ...over });
  it('a queued removal makes price/qty read-only with its reason', () => {
    expect(editReadOnlyReason(row({ sync: sync() }), 'price', t, ctx)).toBe('listings.cell.removalQueued:delete');
    expect(editReadOnlyReason(row({ sync: sync() }), 'qty', t, { ...ctx, removalKind: 'archive' })).toBe('listings.cell.removalQueued:archive');
  });
  it('read-only reasons come from LISTING_EDITABLE_REASON_I18N (stock_managed included)', () => {
    const r = row({ editable: { price: true, qty: false, reason: 'stock_managed' } });
    expect(editReadOnlyReason(r, 'qty', t, ctx)).toBe('listings.cell.stockManaged');
    expect(editReadOnlyReason(r, 'price', t, ctx)).toBeNull();
  });
  it('removal kind is archive only where the config archives and cannot delete', () => {
    expect(removalKindOf(LISTINGS_CONFIGS.trendyol)).toBe('archive');
    expect(removalKindOf(LISTINGS_CONFIGS.etsy)).toBe('delete');
    expect(LISTINGS_CONFIGS.trendyol.rowActions).toContain('sendDeletion');
  });
  it('eBay client errors: a usage-limit answer becomes a 402 StagingError', () => {
    expect(fromEbayError(new Error('Payment Required')).status).toBe(402);
    expect(fromEbayError(new Error('HTTP 402')).status).toBe(402);
    expect(fromEbayError(new Error('Draft not found')).status).toBe(500);
  });
});
