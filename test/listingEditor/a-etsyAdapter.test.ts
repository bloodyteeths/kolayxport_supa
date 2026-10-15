// @vitest-environment jsdom
// M6 Group A: the Etsy adapter keeps the drawer's staging contract and never sends HTML entities back (CRITIQUE V2).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  stageEtsyDraft: vi.fn(),
  syncEtsyDraft: vi.fn(),
  discardEtsyDraft: vi.fn(),
  fetchEtsyDrafts: vi.fn(),
  removeEtsyDraftQueuedActions: vi.fn(),
}));
vi.mock('@/lib/etsy/draftClient', async (orig) => {
  const actual = await orig<typeof import('@/lib/etsy/draftClient')>();
  return { ...actual, ...client };
});

import { EtsyDraftClientError } from '@/lib/etsy/draftClient';
import {
  blankEtsyFields,
  buildEtsyCreatePayload,
  buildEtsyEditPayload,
  etsyAdapter,
  etsyErrorInfo,
  etsyFailureCauseKey,
  etsyFieldsFromListing,
  etsyMetaFromListing,
  isDraftEmpty,
  overlayEtsyFieldPatch,
  readEtsyDeviceCopy,
  toDraftRow,
  validateEtsyEditorFields,
  type EtsyListingData,
} from '@/components/domain/listing-editor/adapters/etsy';

const listing: EtsyListingData = {
  listing_id: 1488223311,
  title: 'Mommy&#39;s Little Girl, Baby Blanket &amp; Swaddle',
  description: 'One&#39;s favourite &quot;soft&quot; blanket',
  tags: ['mom&#39;s gift', 'baby blanket'],
  materials: ['cotton'],
  price: { amount: 6999, divisor: 100, currency_code: 'USD' },
  quantity: 42,
  state: 'active',
  taxonomy_id: 1234,
  shipping_profile_id: 77,
  return_policy_id: null,
  processing_min: 1,
  processing_max: 3,
  item_weight: null,
  who_made: 'i_did',
  when_made: 'made_to_order',
  is_supply: false,
  views: 0,
  num_favorers: 0,
  updated_timestamp: 1_760_000_000,
  images: [
    { listing_image_id: 2, url_570xN: 'https://i.etsystatic.com/2.jpg', rank: 2, alt_text: 'Pink &amp; white' },
    { listing_image_id: 1, url_570xN: 'https://i.etsystatic.com/1.jpg', rank: 1, alt_text: null },
  ],
};

const serverDraft = (extra: Record<string, unknown> = {}) => ({
  id: 'd1',
  status: 'draft',
  etsyListingId: '1488223311',
  fieldPatch: {},
  taxonomyPatch: {},
  inventoryPatch: {},
  variationImagesPatch: null,
  personalizationPatch: null,
  queuedActions: [],
  media: [],
  syncAttempts: [],
  updatedAt: '2026-10-15T10:00:00.000Z',
  ...extra,
});

beforeEach(() => {
  Object.values(client).forEach((f) => f.mockReset());
});

describe('load mapping', () => {
  it('decodes entities on load (title, description, tags, alt text)', () => {
    const f = etsyFieldsFromListing(listing);
    expect(f.title).toBe("Mommy's Little Girl, Baby Blanket & Swaddle");
    expect(f.description).toBe('One\'s favourite "soft" blanket');
    expect(f.tags).toEqual(["mom's gift", 'baby blanket']);
    expect(f.price).toBe('69.99');
    expect(f.return_policy_id).toBe('');
    expect(f.taxonomy_id).toBe(1234);
    const meta = etsyMetaFromListing(listing);
    expect(meta.images.map((i) => i.id)).toEqual(['1', '2']);
    expect(meta.images[1].alt).toBe('Pink & white');
    expect(meta.views).toBe(0);
    expect(meta.updatedAt?.toISOString()).toBe(new Date(1_760_000_000_000).toISOString());
  });

  it('an untouched encoded listing stages nothing (entities never go back to Etsy)', () => {
    const remote = etsyFieldsFromListing(listing);
    expect(buildEtsyEditPayload(remote, { ...remote })).toEqual({});
  });
});

describe('payloads (drawer handleSave / creator handleCreate rules)', () => {
  const remote = etsyFieldsFromListing(listing);

  it('edit: only changed fields, decoded, blanks never sent, extras re-sent', () => {
    const current = {
      ...remote,
      title: 'Mom&#39;s Blanket, Baby Gift',
      tags: [...remote.tags, 'new &amp; soft'],
      item_weight: '' as const,
      processing_max: 5,
    };
    const payload = buildEtsyEditPayload(remote, current, { variation_note: 'kept' });
    expect(payload).toEqual({
      title: "Mom's Blanket, Baby Gift",
      tags: ["mom's gift", 'baby blanket', 'new & soft'],
      processing_max: 5,
      variation_note: 'kept',
    });
    expect(JSON.stringify(payload)).not.toMatch(/&#|&amp;|&quot;/);
  });

  it('edit: price stays the decimal string the drawer sent; a reformatted price is not a change', () => {
    expect(buildEtsyEditPayload(remote, { ...remote, price: '69.9' })).toEqual({ price: '69.9' });
    expect(buildEtsyEditPayload(remote, { ...remote, price: '69.990' })).toEqual({});
  });

  it('create: full field set, numbers parsed, blanks and orphan units left out', () => {
    const f = { ...blankEtsyFields(), title: ' Baby &amp; Me ', price: '19.5', quantity: 0, tags: ['a'], shipping_profile_id: 9 as const };
    expect(buildEtsyCreatePayload(f)).toEqual({
      title: 'Baby & Me',
      price: 19.5,
      quantity: 1,
      tags: ['a'],
      who_made: 'i_did',
      when_made: 'made_to_order',
      is_supply: false,
      shipping_profile_id: 9,
    });
  });

  it('overlay applies the DB draft fieldPatch (I0 8b) and keeps unknown keys as extra', () => {
    const { fields, extra, applied } = overlayEtsyFieldPatch(remote, { title: 'Draft &amp; title', price: 12, foo: 'bar', quantity: null });
    expect(fields.title).toBe('Draft & title');
    expect(fields.price).toBe('12.00');
    expect(fields.quantity).toBe(42);
    expect(extra).toEqual({ foo: 'bar' });
    expect(applied).toBe(2);
  });
});

describe('stageFields', () => {
  const remote = etsyFieldsFromListing(listing);
  const ctx = { shopId: '42', listingId: '1488223311' };

  it('edit with no change and no draft never creates a draft', async () => {
    const out = await etsyAdapter.stageFields({ ctx, mode: 'edit', remote, current: remote, extra: {}, draft: null });
    expect(out).toBeNull();
    expect(client.stageEtsyDraft).not.toHaveBeenCalled();
  });

  it('edit stages with replaceFields: true', async () => {
    client.stageEtsyDraft.mockResolvedValue(serverDraft({ fieldPatch: { title: 'X' } }));
    const out = await etsyAdapter.stageFields({ ctx, mode: 'edit', remote, current: { ...remote, title: 'X' }, extra: {}, draft: null });
    expect(client.stageEtsyDraft).toHaveBeenCalledWith({ shopId: '42', listingId: '1488223311', fields: { title: 'X' }, replaceFields: true });
    expect(out?.fieldPatch).toEqual({ title: 'X' });
  });

  it('edit: everything reverted → the empty plain draft is discarded', async () => {
    client.stageEtsyDraft.mockResolvedValue(serverDraft());
    client.fetchEtsyDrafts.mockResolvedValue([serverDraft()]);
    const existing = toDraftRow(serverDraft({ fieldPatch: { title: 'X' } }));
    const out = await etsyAdapter.stageFields({ ctx, mode: 'edit', remote, current: remote, extra: {}, draft: existing });
    expect(client.stageEtsyDraft).toHaveBeenCalledWith({ shopId: '42', listingId: '1488223311', fields: {}, replaceFields: true });
    expect(client.discardEtsyDraft).toHaveBeenCalledWith('d1');
    expect(out).toBeNull();
  });

  it('edit: an emptied draft that got media meanwhile (photo staged outside the queue) is kept', async () => {
    client.stageEtsyDraft.mockResolvedValue(serverDraft());
    client.fetchEtsyDrafts.mockResolvedValue([
      serverDraft({ updatedAt: '2026-10-15T10:00:01.000Z', media: [{ id: 'm1', kind: 'image', operation: 'upload' }] }),
    ]);
    const existing = toDraftRow(serverDraft({ fieldPatch: { title: 'X' } }));
    const out = await etsyAdapter.stageFields({ ctx, mode: 'edit', remote, current: remote, extra: {}, draft: existing });
    expect(client.discardEtsyDraft).not.toHaveBeenCalled();
    expect(out?.media).toHaveLength(1);
  });

  it('edit: a reverted conflict / failed draft is kept (never silently cleared)', async () => {
    client.stageEtsyDraft.mockResolvedValue(serverDraft({ status: 'conflict' }));
    const existing = toDraftRow(serverDraft({ status: 'conflict', fieldPatch: { title: 'X' } }));
    const out = await etsyAdapter.stageFields({ ctx, mode: 'edit', remote, current: remote, extra: {}, draft: existing });
    expect(client.discardEtsyDraft).not.toHaveBeenCalled();
    expect(out?.status).toBe('conflict');
  });

  it('create always carries the create_listing action (server dedupes it)', async () => {
    client.stageEtsyDraft.mockResolvedValue(serverDraft({ etsyListingId: '-1700' }));
    const current = { ...blankEtsyFields(), title: 'New' };
    await etsyAdapter.stageFields({ ctx: { shopId: '42', listingId: '-1700' }, mode: 'create', remote: null, current, extra: {}, draft: toDraftRow(serverDraft()) });
    expect(client.stageEtsyDraft.mock.calls[0][0]).toMatchObject({
      listingId: '-1700',
      replaceFields: true,
      queuedActions: [{ type: 'create_listing', payload: {} }],
      fields: { title: 'New', quantity: 1 },
    });
  });
});

describe('send / errors / drafts', () => {
  it('send never forces past a conflict', async () => {
    client.syncEtsyDraft.mockResolvedValue({ etsyListingId: '555', warnings: [{ key: 'draftSync.taxonomyWarning', params: { n: 1 } }] });
    const res = await etsyAdapter.send(toDraftRow(serverDraft())!);
    expect(client.syncEtsyDraft).toHaveBeenCalledWith('d1');
    expect(res).toEqual({ listingId: '555', deleted: false, warnings: [{ key: 'etsy.draftSync.taxonomyWarning', params: { n: 1 }, message: undefined }] });
  });

  it('send reports a queued delete that ran (the listing is gone)', async () => {
    client.syncEtsyDraft.mockResolvedValue({ status: 'success', deleted: true, etsyListingId: '1488223311' });
    const res = await etsyAdapter.send(toDraftRow(serverDraft({ queuedActions: [{ type: 'delete' }] }))!);
    expect(res.deleted).toBe(true);
  });

  it('errorInfo: typed client errors → etsy.* keys; fetch TypeError → network', () => {
    const conflict = etsyErrorInfo(new EtsyDraftClientError(409, { status: 'conflict', key: 'draftSync.conflict' }));
    expect(conflict).toMatchObject({ status: 409, conflict: true, key: 'etsy.draftSync.conflict', network: false });
    const v = etsyErrorInfo(
      new EtsyDraftClientError(400, { key: 'validation.titleTooLong', issues: [{ field: 'title', severity: 'block_save', key: 'validation.titleTooLong', message: 'x' }] }),
    );
    expect(v.issues?.[0]).toMatchObject({ field: 'title', section: 'title', key: 'etsy.validation.titleTooLong' });
    expect(etsyErrorInfo(new TypeError('Failed to fetch')).network).toBe(true);
  });

  it('failure cause is always an i18n key (never raw server text)', () => {
    expect(etsyFailureCauseKey({ status: 'failed', lastSyncError: 'Sync interrupted by a server restart — retry' })).toBe('listings.sendError.interrupted');
    expect(etsyFailureCauseKey({ status: 'failed', lastSyncError: 'invalid_grant: token expired' })).toBe('listings.sendError.reconnect');
    expect(etsyFailureCauseKey({ status: 'failed', lastSyncError: 'draftSync.readinessStateRequired' })).toBe('etsy.draftSync.readinessStateRequired');
    expect(etsyFailureCauseKey({ status: 'failed', lastSyncError: null })).toBe('listings.sendError.generic');
  });

  it('loadDraft picks the newest pending draft (drawer rule)', async () => {
    client.fetchEtsyDrafts.mockResolvedValue([serverDraft({ id: 'synced', status: 'synced' }), serverDraft({ id: 'pending', status: 'failed' })]);
    const d = await etsyAdapter.loadDraft({ shopId: '42', listingId: '1' });
    expect(d?.id).toBe('pending');
    client.fetchEtsyDrafts.mockResolvedValue([serverDraft({ id: 'x' }), serverDraft({ id: 'y' })]);
    expect((await etsyAdapter.loadDraft({ shopId: '42', draftId: 'y' }))?.id).toBe('y');
  });

  it('isDraftEmpty ignores completed actions', () => {
    expect(isDraftEmpty(toDraftRow(serverDraft({ queuedActions: [{ type: 'publish', completedAt: 'x' }] }))!)).toBe(true);
    expect(isDraftEmpty(toDraftRow(serverDraft({ queuedActions: [{ type: 'publish' }] }))!)).toBe(false);
  });

  it('validation maps to full i18n keys and sections; processing min > max blocks saving', () => {
    const f = { ...blankEtsyFields(), processing_min: 5, processing_max: 2 };
    const issues = validateEtsyEditorFields(f, 'create');
    expect(issues.find((i) => i.field === 'processing_min')).toMatchObject({ severity: 'block_save', key: 'etsy.editor.prepTimeError', section: 'shipping' });
    expect(issues.find((i) => i.field === 'taxonomy_id')).toMatchObject({ key: 'etsy.validation.taxonomyRequired', section: 'details' });
  });

  it('device copy reads the legacy v1 format as savedAt 0', () => {
    window.localStorage.setItem('listing_draft_7', JSON.stringify({ title: 'Old' }));
    expect(readEtsyDeviceCopy('7')).toEqual({ fields: { title: 'Old' }, savedAt: 0 });
    window.localStorage.setItem('listing_draft_8', JSON.stringify({ v: 2, savedAt: 5, fields: { title: 'New' } }));
    expect(readEtsyDeviceCopy('8')).toEqual({ fields: { title: 'New' }, savedAt: 5 });
    // v1 was written from un-decoded Etsy text: decoded on read (no spurious restore, no entities in the form).
    window.localStorage.setItem('listing_draft_10', JSON.stringify({ title: 'one&#39;s &amp; two', tags: ['mom&#39;s gift'] }));
    expect(readEtsyDeviceCopy('10')?.fields).toMatchObject({ title: "one's & two", tags: ["mom's gift"] });
    window.localStorage.setItem('listing_draft_9', '{bad');
    expect(readEtsyDeviceCopy('9')).toBeNull();
  });
});
