// @vitest-environment jsdom
// wiring-editor-media: PhotoStudio undo of one staged media change (PATCH removeMediaIds via removeStudioMedia),
// re-staging a replaced reorder, tile / order / video undo ids, and a 409 DRAFT_SENDING that locks the listing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { EtsyImageLike } from '@/components/domain/listing-editor/sections/photosModel';
import {
  buildListingPhotoView,
  buildListingVideoView,
  orderUndoIds,
  tileUndoIds,
  videoUndoIds,
  type MediaOp,
  type StudioDraft,
  type StudioMediaRow,
} from '@/components/domain/photo-studio/studioModel';

const api = vi.hoisted(() => ({
  media: new Map<string, StudioMediaRow[]>(),
  removed: [] as Array<{ draftId: string; ids: string[] }>,
  staged: [] as Array<{ listingId: string; media: unknown[] }>,
  removeError: null as null | { status: number; code: string; key: string },
  stageError: null as null | Error,
  imageCount: 3,
  seq: 0,
}));

vi.mock('@/components/domain/photo-studio/studioApi', async (orig) => {
  const real = await orig<typeof import('@/components/domain/photo-studio/studioApi')>();
  const draftOf = (listingId: string): StudioDraft => ({ id: `d-${listingId}`, listingId, status: 'draft', media: api.media.get(listingId) ?? [], queuedDelete: false });
  return {
    ...real,
    fetchStudioListings: vi.fn(async (_shop: string | null, ids: string[]) => ({
      rows: ids.map((id) => ({ id, title: `Listing ${id}`, thumbUrl: null, sync: null })),
      store: { id: '555', name: 'Shop' },
      stores: [],
    })),
    fetchShopDrafts: vi.fn(async () => new Map([...api.media.keys()].map((id) => [id, draftOf(id)]))),
    fetchListingImages: vi.fn(async (_shop: string, id: string): Promise<EtsyImageLike[]> => Array.from({ length: api.imageCount }, (_, i) => i + 1).map((n) => ({
      listing_image_id: Number(id) * 10 + n, rank: n, alt_text: '', url_570xN: `https://i.etsystatic.com/${id}_${n}.jpg`,
    }))),
    fetchListingVideos: vi.fn(async () => []),
    // The server: reorder / update_alt replace the photo's older row; every staged op gets a new id.
    stageBatchMedia: vi.fn(async (_shop: string, items: { listingId: string; media: MediaOp[] }[], onResult: (r: unknown) => void) => {
      if (api.stageError) throw api.stageError;
      for (const i of items) {
        api.staged.push({ listingId: i.listingId, media: i.media });
        let rows = api.media.get(i.listingId) ?? [];
        for (const m of i.media) {
          const id = 'etsyMediaId' in m ? String(m.etsyMediaId) : null;
          if (m.operation === 'reorder' || m.operation === 'update_alt') rows = rows.filter((r) => !(r.operation === m.operation && r.etsyMediaId === id));
          api.seq += 1;
          rows = [...rows, { id: `row${api.seq}`, kind: m.kind, operation: m.operation, etsyMediaId: id, rank: 'rank' in m ? m.rank ?? null : null, altText: 'altText' in m ? m.altText ?? null : null }];
        }
        api.media.set(i.listingId, rows);
        onResult({ listingId: i.listingId, ok: true, draftId: `d-${i.listingId}`, status: 'draft', media: rows });
      }
    }),
    removeStudioMedia: vi.fn(async (draftId: string, ids: string[]) => {
      if (api.removeError) throw Object.assign(new Error('refused'), api.removeError);
      api.removed.push({ draftId, ids });
      const listingId = draftId.slice(2);
      api.media.set(listingId, (api.media.get(listingId) ?? []).filter((m) => !ids.includes(m.id)));
      return draftOf(listingId);
    }),
  };
});

import { usePhotoStudio } from '@/components/domain/photo-studio/usePhotoStudio';

async function ready(ids: string[]) {
  const hook = renderHook(() => usePhotoStudio({ shopId: '555', ids }));
  await waitFor(() => expect(hook.result.current.photoViews.size).toBe(ids.length));
  return hook;
}

beforeEach(() => {
  api.media = new Map();
  api.removed = [];
  api.staged = [];
  api.removeError = null;
  api.stageError = null;
  api.imageCount = 3;
  api.seq = 0;
});
afterEach(() => vi.clearAllMocks());

describe('PhotoStudio undo', () => {
  it('removeTile → result.undo drops exactly the staged delete; the tile is back', async () => {
    const hook = await ready(['1']);
    let res: Awaited<ReturnType<typeof hook.result.current.removeTile>> | undefined;
    await act(async () => { res = await hook.result.current.removeTile('1', 'img:12'); });
    expect(hook.result.current.photoViews.get('1')?.removing).toBe(1);
    expect(res?.undo?.plan.removeIds).toHaveLength(1);
    await act(async () => { await hook.result.current.undo('1', res!.undo!.plan); });
    expect(api.removed).toEqual([{ draftId: 'd-1', ids: res!.undo!.plan.removeIds }]);
    expect(hook.result.current.photoViews.get('1')?.removing).toBe(0);
  });

  it('a second reorder: undo re-stages the first one (the server replaced it)', async () => {
    const hook = await ready(['1']);
    await act(async () => { await hook.result.current.makePrimary('1', 'img:13'); });
    const first = hook.result.current.photoViews.get('1')?.tiles.map((t) => t.id);
    let res: Awaited<ReturnType<typeof hook.result.current.makePrimary>> | undefined;
    await act(async () => { res = await hook.result.current.makePrimary('1', 'img:12'); });
    expect(res && res !== 'pending' && res.undo?.plan.restore.length).toBeGreaterThan(0);
    await act(async () => { if (res && res !== 'pending' && res.undo) await hook.result.current.undo('1', res.undo.plan); });
    expect(hook.result.current.photoViews.get('1')?.tiles.map((t) => t.id)).toEqual(first);
  });

  it('undoOrder drops every staged reorder row', async () => {
    const hook = await ready(['1']);
    await act(async () => { await hook.result.current.makePrimary('1', 'img:13'); });
    const reorderRows = (api.media.get('1') ?? []).filter((m) => m.operation === 'reorder').map((m) => m.id);
    expect(reorderRows.length).toBeGreaterThan(0);
    let r: Awaited<ReturnType<typeof hook.result.current.undoOrder>> | undefined;
    await act(async () => { r = await hook.result.current.undoOrder('1'); });
    expect(r?.ok).toBe(true);
    expect(api.removed[0].ids.sort()).toEqual(reorderRows.sort());
    expect(hook.result.current.photoViews.get('1')?.tiles.map((t) => t.id)).toEqual(['img:11', 'img:12', 'img:13']);
  });

  it('409 DRAFT_SENDING on undo: failure keeps the key and the listing turns read-only (out of the selection)', async () => {
    const hook = await ready(['1', '2']);
    await act(async () => { await hook.result.current.removeTile('1', 'img:12'); });
    api.removeError = { status: 409, code: 'DRAFT_SENDING', key: 'draftSync.draftSyncing' };
    let r: Awaited<ReturnType<typeof hook.result.current.undoTile>> | undefined;
    await act(async () => { r = await hook.result.current.undoTile('1', 'img:12'); });
    expect(r).toEqual({ ok: false, failure: { listingId: '1', code: 'DRAFT_SENDING', key: 'draftSync.draftSyncing', params: undefined } });
    expect(hook.result.current.listings.find((l) => l.id === '1')?.syncing).toBe(true);
    expect(hook.result.current.selected.has('1')).toBe(false);
    expect(hook.result.current.selected.has('2')).toBe(true);
  });
});

describe('PhotoStudio undo: stale plans, last photo, failures', () => {
  it('a toast Undo of an older alt edit does nothing once a newer alt of the same photo is staged', async () => {
    const hook = await ready(['1']);
    let first: Awaited<ReturnType<typeof hook.result.current.saveAlt>> | undefined;
    await act(async () => { first = await hook.result.current.saveAlt('1', 'img:12', 'A'); });
    await act(async () => { await hook.result.current.saveAlt('1', 'img:12', 'B'); });
    const stagedBefore = api.staged.length;
    let r: Awaited<ReturnType<typeof hook.result.current.undo>> | undefined;
    await act(async () => { if (first && first !== 'pending' && first.undo) r = await hook.result.current.undo('1', first.undo.plan); });
    expect(r).toEqual({ ok: false, skipped: 'nothing' });
    expect(api.removed).toEqual([]);
    expect(api.staged.length).toBe(stagedBefore);
    expect((api.media.get('1') ?? []).find((m) => m.operation === 'update_alt')?.altText).toBe('B');
  });

  it('a stale reorder undo leaves the newer order alone', async () => {
    const hook = await ready(['1']);
    let first: Awaited<ReturnType<typeof hook.result.current.makePrimary>> | undefined;
    await act(async () => { first = await hook.result.current.makePrimary('1', 'img:13'); });
    await act(async () => { await hook.result.current.makePrimary('1', 'img:12'); });
    const order = hook.result.current.photoViews.get('1')?.tiles.map((t) => t.id);
    let r: Awaited<ReturnType<typeof hook.result.current.undo>> | undefined;
    await act(async () => { if (first && first !== 'pending' && first.undo) r = await hook.result.current.undo('1', first.undo.plan); });
    expect(r?.skipped).toBe('nothing');
    expect(hook.result.current.photoViews.get('1')?.tiles.map((t) => t.id)).toEqual(order);
  });

  it('nothing staged: undoTile reports nothing to undo (not success)', async () => {
    const hook = await ready(['1']);
    let r: Awaited<ReturnType<typeof hook.result.current.undoTile>> | undefined;
    await act(async () => { r = await hook.result.current.undoTile('1', 'img:12'); });
    expect(r).toEqual({ ok: false, skipped: 'nothing' });
    expect(api.removed).toEqual([]);
  });

  it('removing the new photo of a Replace on a one-photo listing is refused (lastPhoto); undoing both rows is fine', async () => {
    api.imageCount = 1;
    api.media.set('1', [
      { id: 'up', kind: 'image', operation: 'upload', rank: 1, sourceUrl: 'https://x/p.jpg' },
      { id: 'del', kind: 'image', operation: 'delete', etsyMediaId: '11' },
    ]);
    const hook = await ready(['1']);
    let r: Awaited<ReturnType<typeof hook.result.current.undoTile>> | undefined;
    await act(async () => { r = await hook.result.current.undoTile('1', 'new:up'); });
    expect(r).toEqual({ ok: false, skipped: 'lastPhoto' });
    expect(api.removed).toEqual([]);
    await act(async () => { r = await hook.result.current.undo('1', { removeIds: ['up', 'del'], restore: [] }); });
    expect(r).toEqual({ ok: true });
    expect(hook.result.current.photoViews.get('1')?.liveCount).toBe(1);
  });

  it('a restore that throws (network) is a failure result, not a rejection', async () => {
    const hook = await ready(['1']);
    await act(async () => { await hook.result.current.makePrimary('1', 'img:13'); });
    let second: Awaited<ReturnType<typeof hook.result.current.makePrimary>> | undefined;
    await act(async () => { second = await hook.result.current.makePrimary('1', 'img:12'); });
    api.stageError = new TypeError('Failed to fetch');
    let r: Awaited<ReturnType<typeof hook.result.current.undo>> | undefined;
    await act(async () => { if (second && second !== 'pending' && second.undo) r = await hook.result.current.undo('1', second.undo.plan); });
    expect(r?.ok).toBe(false);
    expect(r?.failure?.listingId).toBe('1');
  });
});

describe('undo ids', () => {
  const images: EtsyImageLike[] = [1, 2].map((n) => ({ listing_image_id: n, rank: n, url_570xN: `u${n}` }));
  const draft: StudioDraft = {
    id: 'd', listingId: '1', status: 'draft', queuedDelete: false,
    media: [
      { id: 'del', kind: 'image', operation: 'delete', etsyMediaId: '2' },
      { id: 'up', kind: 'image', operation: 'upload', rank: 3, sourceUrl: 'https://x/y.jpg' },
      { id: 'ord', kind: 'image', operation: 'reorder', etsyMediaId: '1', rank: 2 },
      { id: 'vdel', kind: 'video', operation: 'delete', etsyMediaId: '77' },
    ],
  };
  it('tile, order and video', () => {
    const view = buildListingPhotoView(images, draft);
    expect(tileUndoIds(view, 'img:2')).toEqual(['del']);
    expect(tileUndoIds(view, 'new:up')).toEqual(['up']);
    expect(tileUndoIds(view, 'img:1')).toEqual([]);
    expect(orderUndoIds(draft)).toEqual(['ord']);
    const video = buildListingVideoView([{ videoId: 77, thumbnailUrl: null, state: 'active' } as never], draft);
    expect(videoUndoIds(video, draft)).toEqual(['vdel']);
    expect(videoUndoIds(buildListingVideoView([], { ...draft, media: [{ id: 'vu', kind: 'video', operation: 'upload' }] }), draft)).toEqual(['vu']);
  });
});
