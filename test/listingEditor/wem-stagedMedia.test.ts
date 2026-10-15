// wiring-editor-media: staged-media undo helpers (PATCH /api/etsy-drafts/[id] { removeMediaIds }) and the
// staging-refusal keys (409 DRAFT_SENDING / DRAFT_SYNCING / DRAFT_NOT_EDITABLE → etsy.draftSync.*).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EtsyDraftClientError } from '@/lib/etsy/draftClient';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import {
  currentUndoPlan,
  isEmptyUndo,
  isRefusalKey,
  isSendingRefusal,
  mediaIdsForGroup,
  mediaRowGroup,
  mediaUndoPlan,
  removeDraftMedia,
  stagingErrorKey,
  stagingRefusalKey,
} from '@/components/domain/listing-editor/stagedMedia';

afterEach(() => vi.unstubAllGlobals());

describe('mediaUndoPlan', () => {
  const del = { id: 'a', kind: 'image', operation: 'delete', etsyMediaId: '11' };
  it('a new delete: drop the row it added', () => {
    expect(mediaUndoPlan([], [del])).toEqual({ removeIds: ['a'], restore: [] });
  });
  it('a reorder that replaced an older staged reorder: drop the new row, re-stage the old rank', () => {
    const before = [{ id: 'r1', kind: 'image', operation: 'reorder', etsyMediaId: '11', rank: 3 }, del];
    const after = [del, { id: 'r2', kind: 'image', operation: 'reorder', etsyMediaId: '11', rank: 1 }];
    expect(mediaUndoPlan(before, after)).toEqual({
      removeIds: ['r2'],
      restore: [{ kind: 'image', operation: 'reorder', etsyMediaId: 11, rank: 3 }],
    });
  });
  it('an alt edit over a staged alt: the earlier staged text comes back', () => {
    const before = [{ id: 'x1', kind: 'image', operation: 'update_alt', etsyMediaId: 12, altText: 'old' }];
    const after = [{ id: 'x2', kind: 'image', operation: 'update_alt', etsyMediaId: 12, altText: 'new' }];
    expect(mediaUndoPlan(before, after).restore).toEqual([{ kind: 'image', operation: 'update_alt', etsyMediaId: 12, altText: 'old' }]);
  });
  it('a replace (upload + delete) drops both; nothing staged = empty plan', () => {
    const up = { id: 'u', kind: 'image', operation: 'upload' };
    expect(mediaUndoPlan([], [up, del]).removeIds).toEqual(['u', 'a']);
    expect(isEmptyUndo(mediaUndoPlan([del], [del]))).toBe(true);
  });
});

describe('currentUndoPlan (a stored plan checked again when Undo is clicked)', () => {
  const plan = { removeIds: ['new'], restore: [{ kind: 'image' as const, operation: 'update_alt' as const, etsyMediaId: 5, altText: 'x' }] };
  it('rows still on the draft: the plan runs', () => {
    expect(currentUndoPlan(plan, [{ id: 'new', kind: 'image', operation: 'update_alt', etsyMediaId: '5', altText: 'y' }])).toEqual(plan);
  });
  it('a removed row is gone (a newer edit replaced it): stale', () => {
    expect(currentUndoPlan(plan, [{ id: 'newer', kind: 'image', operation: 'update_alt', etsyMediaId: '5', altText: 'z' }])).toBeNull();
  });
  it('drops a restore whose photo already holds a newer row of the same operation', () => {
    const restoreOnly = { removeIds: [], restore: plan.restore };
    expect(currentUndoPlan(restoreOnly, [{ id: 'newer', kind: 'image', operation: 'update_alt', etsyMediaId: 5 }])).toEqual({ removeIds: [], restore: [] });
    expect(currentUndoPlan(restoreOnly, [])).toEqual(restoreOnly);
  });
});

describe('media groups (rail Revert)', () => {
  const media = [
    { id: '1', kind: 'image', operation: 'upload' },
    { id: '2', kind: 'image', operation: 'ai_upload' },
    { id: '3', kind: 'image', operation: 'delete', etsyMediaId: '9' },
    { id: '4', kind: 'image', operation: 'reorder', etsyMediaId: '9', rank: 2 },
    { id: '5', kind: 'image', operation: 'update_alt', etsyMediaId: '9', altText: 'a' },
    { id: '6', kind: 'video', operation: 'delete', etsyMediaId: '7' },
  ];
  it('buckets rows like changeSummary', () => {
    expect(mediaIdsForGroup(media, 'photos')).toEqual(['1', '2', '3']);
    expect(mediaIdsForGroup(media, 'photoOrder')).toEqual(['4']);
    expect(mediaIdsForGroup(media, 'altText')).toEqual(['5']);
    expect(mediaIdsForGroup(media, 'video')).toEqual(['6']);
    expect(mediaRowGroup({ kind: 'other', operation: 'x' })).toBeNull();
    expect(mediaIdsForGroup(null, 'photos')).toEqual([]);
  });
});

describe('staging refusals', () => {
  it('maps codes and keys to the etsy-relative draftSync keys', () => {
    expect(stagingRefusalKey('DRAFT_SENDING')).toBe('draftSync.draftSyncing');
    expect(stagingRefusalKey('DRAFT_SYNCING')).toBe('draftSync.draftSyncing');
    expect(stagingRefusalKey('DRAFT_NOT_EDITABLE')).toBe('draftSync.draftNotEditable');
    expect(stagingRefusalKey('OTHER')).toBeNull();
    // batch-stage sends full keys; batch-media / single routes send etsy-relative ones.
    expect(stagingErrorKey({ code: 'DRAFT_SYNCING', key: 'etsy.draftSync.draftSyncing' })).toBe('draftSync.draftSyncing');
    expect(stagingErrorKey({ code: 'DRAFT_SENDING' })).toBe('draftSync.draftSyncing');
    expect(stagingErrorKey({ code: 'X', key: 'validation.generic' })).toBe('validation.generic');
    expect(isSendingRefusal({ code: 'DRAFT_SENDING' })).toBe(true);
    expect(isSendingRefusal({ key: 'etsy.draftSync.draftSyncing' })).toBe(true);
    expect(isSendingRefusal({ code: 'DRAFT_NOT_EDITABLE' })).toBe(false);
    expect(isRefusalKey('etsy.draftSync.draftSyncing')).toBe(true);
    expect(isRefusalKey('ebay.draftSync.draftNotEditable')).toBe(true);
    expect(isRefusalKey('etsy.validation.generic')).toBe(false);
  });
  it('the keys exist in EN and TR', () => {
    for (const msgs of [en, tr] as Array<{ etsy: { draftSync: Record<string, string> } }>) {
      expect(msgs.etsy.draftSync.draftSyncing).toBeTruthy();
      expect(msgs.etsy.draftSync.draftNotEditable).toContain('{status}');
    }
  });
});

describe('removeDraftMedia', () => {
  it('PATCHes removeMediaIds in chunks of 100 (deduped) and returns the last draft', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/etsy-drafts/d1');
      expect(init.method).toBe('PATCH');
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ draft: { id: 'd1', n: bodies.length } }), { status: 200 });
    }));
    const ids = Array.from({ length: 150 }, (_, i) => `m${i}`);
    const draft = await removeDraftMedia('d1', [...ids, 'm0']);
    expect(bodies).toHaveLength(2);
    expect((bodies[0] as { removeMediaIds: string[] }).removeMediaIds).toHaveLength(100);
    expect((bodies[1] as { removeMediaIds: string[] }).removeMediaIds).toHaveLength(50);
    expect(draft).toEqual({ id: 'd1', n: 2 });
  });
  it('nothing to remove: no request', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await removeDraftMedia('d1', [])).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('409 DRAFT_SENDING throws EtsyDraftClientError with the translated key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'sending', code: 'DRAFT_SENDING', key: 'draftSync.draftSyncing' }), { status: 409 },
    )));
    const err = await removeDraftMedia('d1', ['m1']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EtsyDraftClientError);
    expect(err).toMatchObject({ status: 409, code: 'DRAFT_SENDING', key: 'draftSync.draftSyncing' });
    expect(isSendingRefusal(err)).toBe(true);
  });
});
