// Etsy legacy port (listings-etsy gaps): new-listing drafts, Set field, Copy to another shop, variation prices,
// profile delete, and the Etsy staging adapter's extras. Pure / adapter-level.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stageEtsyDraft = vi.fn(async (input: unknown) => ({ id: 'd1', input }));
const fetchEtsyDrafts = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
vi.mock('@/lib/etsy/draftClient', () => ({
  stageEtsyDraft: (input: unknown) => stageEtsyDraft(input),
  fetchEtsyDrafts: (...args: unknown[]) => fetchEtsyDrafts(...args),
  discardEtsyDraft: vi.fn(),
  syncEtsyDraft: vi.fn(),
  syncEtsyDrafts: vi.fn(),
}));

import { etsyAdapter, toNewListingDraft, type NewListingDraft } from '@/components/domain/listings/useStagedChanges';
import { newDraftMeta } from '@/components/domain/listings/NewDraftsBanner';
import { buildSetFieldPatch, setFieldTargets } from '@/components/domain/listings/bulk/SetFieldModal';
import { copyTargets } from '@/components/domain/listings/bulk/CopyToShopModal';
import { applyPriceOpsToInventory, buildVariationPriceInventories } from '@/lib/bulk/variationPriceOps';
import { deleteProfile, loadProfiles, PROFILE_STORAGE_KEY } from '@/components/domain/listing-editor/ProfilesModal';
import type { ListingRow } from '@/lib/listings/types';

function row(over: Partial<ListingRow> = {}): ListingRow {
  return {
    id: '1',
    title: 'Box',
    metaLine: [],
    thumbUrl: null,
    price: { amount: 10, currency: 'USD' },
    qty: 1,
    editable: { price: true, qty: true },
    status: 'active',
    statusRaw: 'active',
    health: null,
    updatedAt: null,
    createdAt: null,
    extra: {},
    externalUrl: null,
    sync: null,
    ...over,
  } as ListingRow;
}

const sync = (over: Partial<NonNullable<ListingRow['sync']>> = {}): NonNullable<ListingRow['sync']> => ({
  draftId: 'd',
  status: 'pending',
  changedFields: ['price'],
  draft: {},
  queuedDelete: false,
  scheduledSendAt: null,
  syncedAt: null,
  ...over,
});

beforeEach(() => {
  stageEtsyDraft.mockClear();
  fetchEtsyDrafts.mockReset();
});

describe('toNewListingDraft', () => {
  it('a local (negative id) draft is a new listing with title, photos, thumb and publish flag', () => {
    const d = toNewListingDraft({
      id: 'n1',
      status: 'draft',
      etsyListingId: '-17',
      fieldPatch: { title: '  Baby Blanket ' },
      media: [
        { id: 'm2', kind: 'image', operation: 'upload', rank: 2, sourceUrl: 'https://img/2.jpg' },
        { id: 'm1', kind: 'image', operation: 'ai_upload', rank: 1, localPath: '/x.jpg' },
        { id: 'm3', kind: 'image', operation: 'delete', rank: 3 },
      ],
      queuedActions: [{ type: 'publish' }],
      updatedAt: '2026-10-15T10:00:00Z',
    });
    expect(d).toMatchObject({
      draftId: 'n1',
      listingId: '-17',
      kind: 'create',
      title: 'Baby Blanket',
      photoCount: 2,
      thumbUrl: '/api/etsy-drafts/media-preview?id=m1',
      partialId: null,
      willPublish: true,
      status: 'pending',
    });
  });
  it('a positive id with a pending create_listing is "partly created"', () => {
    const d = toNewListingDraft({ id: 'n2', status: 'failed', etsyListingId: '555', queuedActions: [{ type: 'create_listing', completedAt: null }] });
    expect(d).toMatchObject({ kind: 'create', partialId: '555', status: 'sync_failed' });
  });
  it('a queued copy is a copy entry with its target shop; plain edits and closed drafts are not entries', () => {
    expect(toNewListingDraft({ id: 'c', status: 'draft', etsyListingId: '9', queuedActions: [{ type: 'copy', targetShopId: 42 }] })).toMatchObject({
      kind: 'copy',
      targetShopId: '42',
      partialId: null,
    });
    expect(toNewListingDraft({ id: 'e', status: 'draft', etsyListingId: '9', fieldPatch: { title: 'x' } })).toBeNull();
    expect(toNewListingDraft({ id: 's', status: 'synced', etsyListingId: '-1' })).toBeNull();
    expect(toNewListingDraft({ id: 'done', status: 'draft', etsyListingId: '9', queuedActions: [{ type: 'copy', completedAt: '2026' }] })).toBeNull();
  });
});

describe('newDraftMeta', () => {
  const t = (k: string, v?: Record<string, unknown>) => `${k}${v ? JSON.stringify(v) : ''}`;
  const base: NewListingDraft = {
    draftId: 'n',
    listingId: '-1',
    kind: 'create',
    title: '',
    photoCount: 0,
    thumbUrl: null,
    partialId: null,
    willPublish: false,
    targetShopId: null,
    status: 'pending',
    queuedDelete: false,
    updatedAt: null,
  };
  it('lists photos, partial creation, publish and failure', () => {
    const parts = newDraftMeta({ ...base, photoCount: 3, partialId: '77', willPublish: true, status: 'sync_failed' }, t, { marketplaceName: 'Etsy', shopName: () => null });
    expect(parts).toEqual([
      'listings.newDrafts.photos{"count":3}',
      'listings.newDrafts.partiallyCreated{"id":"77","marketplace":"Etsy"}',
      'listings.newDrafts.willPublish',
      'listings.newDrafts.failed',
    ]);
  });
  it('names the copy target shop', () => {
    const parts = newDraftMeta({ ...base, kind: 'copy', targetShopId: 'S2' }, t, { marketplaceName: 'Etsy', shopName: (id) => (id === 'S2' ? 'Second Shop' : null) });
    expect(parts[1]).toBe('listings.newDrafts.copyTo{"shop":"Second Shop"}');
  });
});

describe('etsyAdapter extras', () => {
  it('stages Set field / inventory extras into the same draft, grid fields winning', async () => {
    const a = etsyAdapter({ marketplace: 'etsy', storeId: 'S1' });
    expect(a.stagesEtsyExtras).toBe(true);
    await a.stage('5', { price: 12, etsy: { fields: { shipping_profile_id: 3, price: 99 }, inventory: { products: [] } } } as never);
    expect(stageEtsyDraft).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: 'S1', listingId: '5', fields: { shipping_profile_id: 3, price: 12 }, inventory: { products: [] }, taxonomy: undefined }),
    );
  });
  it('stages a copy to another shop as the queued copy action', async () => {
    const a = etsyAdapter({ marketplace: 'etsy', storeId: 'S1' });
    await a.stage('5', {}, { queuedActions: [{ type: 'copy', targetShopId: 'S2' }] });
    expect(stageEtsyDraft).toHaveBeenCalledWith(expect.objectContaining({ fields: undefined, queuedActions: [{ type: 'copy', targetShopId: 'S2' }] }));
  });
  it('lists the drafts that create a listing', async () => {
    fetchEtsyDrafts.mockResolvedValue([
      { id: 'a', status: 'draft', etsyListingId: '-1' },
      { id: 'b', status: 'draft', etsyListingId: '3', fieldPatch: { price: 2 } },
    ]);
    const a = etsyAdapter({ marketplace: 'etsy', storeId: 'S1' });
    const list = await a.listNewListings!();
    expect(fetchEtsyDrafts).toHaveBeenCalledWith('S1');
    expect(list.map((d) => d.draftId)).toEqual(['a']);
  });
});

describe('buildSetFieldPatch', () => {
  it('builds the draft fieldPatch per field', () => {
    expect(buildSetFieldPatch('shipping', { shippingProfileId: 12 })).toEqual({ shipping_profile_id: 12 });
    expect(buildSetFieldPatch('returnPolicy', { returnPolicyId: 4 })).toEqual({ return_policy_id: 4 });
    expect(buildSetFieldPatch('processing', { readinessStateId: 8 })).toEqual({ readiness_state_id: 8 });
    expect(buildSetFieldPatch('category', { taxonomyId: 1633 })).toEqual({ taxonomy_id: 1633 });
    expect(buildSetFieldPatch('itemDetails', { whoMade: 'i_did', supply: 'product' })).toEqual({ who_made: 'i_did', is_supply: false });
    expect(buildSetFieldPatch('materials', { materials: [' wood ', '', 'x'.repeat(60)] })).toEqual({ materials: ['wood', 'x'.repeat(45)] });
    expect(buildSetFieldPatch('weight', { weight: 1.5, weightUnit: 'kg' })).toEqual({ item_weight: 1.5, item_weight_unit: 'kg' });
    expect(buildSetFieldPatch('dimensions', { length: 10, width: 5, height: 2, dimensionsUnit: 'cm' })).toEqual({
      item_length: 10,
      item_width: 5,
      item_height: 2,
      item_dimensions_unit: 'cm',
    });
  });
  it('is null until the value is complete', () => {
    expect(buildSetFieldPatch('shipping', {})).toBeNull();
    expect(buildSetFieldPatch('category', { taxonomyId: -2 })).toBeNull();
    expect(buildSetFieldPatch('itemDetails', {})).toBeNull();
    expect(buildSetFieldPatch('materials', { materials: [] })).toBeNull();
    expect(buildSetFieldPatch('weight', { weight: 0, weightUnit: 'g' })).toBeNull();
    expect(buildSetFieldPatch('dimensions', { length: 10, width: 5, dimensionsUnit: 'cm' })).toBeNull();
  });
  it('skips rows with a queued removal', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', sync: sync({ queuedDelete: true }) })];
    expect(setFieldTargets(rows).map((r) => r.id)).toEqual(['a']);
  });
});

describe('copyTargets', () => {
  it('stages copies only on listings without open changes', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', sync: sync({}) }), row({ id: 'c', sync: sync({ status: 'synced' }) })];
    const plan = copyTargets(rows);
    expect(plan.ok.map((r) => r.id)).toEqual(['a', 'c']);
    expect(plan.skipped).toBe(1);
  });
});

describe('variation prices', () => {
  const inventory = {
    products: [
      { property_values: [{ property_id: 1, values: ['S'] }], offerings: [{ price: { amount: 1000, divisor: 100 }, quantity: 2 }] },
      { property_values: [{ property_id: 1, values: ['M'] }], offerings: [{ price: 12.5, quantity: 1 }] },
    ],
  };
  it('reads Money objects and plain decimals (draft inventory) alike', () => {
    const out = applyPriceOpsToInventory(inventory, [{ op: 'increase_pct', amount: 10 }]) as { products: Array<{ offerings: Array<{ price: { amount: number } }> }> };
    expect(out.products.map((p) => p.offerings[0].price.amount)).toEqual([1100, 1375]);
  });
  it('builds patches for many listings and reports the unreadable ones', async () => {
    const deps = {
      fetchInventory: vi.fn(async (_s: string, id: string) => (id === 'bad' ? null : inventory)),
      fetchDrafts: vi.fn(async () => []),
    };
    const res = await buildVariationPriceInventories('S1', ['a', 'bad', 'b'], [{ op: 'set', amount: 20 }], {}, deps);
    expect(res.patches.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(res.skipped).toEqual(['bad']);
  });
});

describe('deleteProfile', () => {
  it('removes one profile and keeps the rest as stored', () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    m.set(
      PROFILE_STORAGE_KEY.etsy,
      JSON.stringify([
        { id: 'p1', name: 'A', createdAt: '2026', fields: {} },
        { id: 'p2', name: 'B&#39;s', createdAt: '2026', fields: { tags: ['x'] } },
      ]),
    );
    const next = deleteProfile('etsy', 'p1', storage);
    expect(next?.map((p) => p.id)).toEqual(['p2']);
    expect(JSON.parse(m.get(PROFILE_STORAGE_KEY.etsy)!)).toEqual([{ id: 'p2', name: 'B&#39;s', createdAt: '2026', fields: { tags: ['x'] } }]);
    expect(loadProfiles('etsy', storage)[0].name).toBe("B's");
    expect(deleteProfile('etsy', 'p2', null)).toBeNull();
  });
});
