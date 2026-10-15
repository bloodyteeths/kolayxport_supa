// @vitest-environment jsdom
// wiring-editor-media: the M6 editor's staged-media undo (PhotosSection removeStagedMedia + rail Revert of the
// Photos / Photo order / Alt text / Video groups) through PATCH /api/etsy-drafts/[id] { removeMediaIds }.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DraftRow } from '@/lib/listingEditor/types';
import { useStagedMediaUndo } from '@/components/domain/listing-editor/useStagedMediaUndo';

const draft = (media: DraftRow['media']): DraftRow => ({
  id: 'd1', status: 'draft', listingId: '42', fieldPatch: {}, queuedActions: [], media, syncAttempts: [],
});
const rows: DraftRow['media'] = [
  { id: 'r1', kind: 'image', operation: 'reorder', etsyMediaId: '5', rank: 2 },
  { id: 'r2', kind: 'image', operation: 'reorder', etsyMediaId: '6', rank: 1 },
  { id: 'x', kind: 'image', operation: 'delete', etsyMediaId: '7' },
];
const change = (group: string, over: Record<string, unknown> = {}) => ({ group, kind: 'field', fields: [], source: 'draft', ...over }) as never;

function stubFetch(status = 200, body: unknown = { draft: { id: 'd1' } }) {
  const f = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', f);
  return f;
}
afterEach(() => vi.unstubAllGlobals());

describe('useStagedMediaUndo', () => {
  it('canRevert: staged media groups only, not unsaved strip edits, not when disabled', () => {
    const reloadDraft = vi.fn(async () => null);
    const { result, rerender } = renderHook((p: { enabled: boolean }) => useStagedMediaUndo({ enabled: p.enabled, draft: draft(rows), reloadDraft }), { initialProps: { enabled: true } });
    expect(result.current.canRevert(change('photoOrder'))).toBe(true);
    expect(result.current.canRevert(change('photos'))).toBe(true);
    expect(result.current.canRevert(change('altText'))).toBe(false);
    expect(result.current.canRevert(change('photoOrder', { source: 'form' }))).toBe(false);
    expect(result.current.canRevert(change('title', { fields: ['title'] }))).toBe(false);
    rerender({ enabled: false });
    expect(result.current.canRevert(change('photoOrder'))).toBe(false);
    expect(result.current.removeStagedMedia).toBeUndefined();
  });

  it('revert drops every row of the group, then re-reads the draft', async () => {
    const f = stubFetch();
    const reloadDraft = vi.fn(async () => null);
    const { result } = renderHook(() => useStagedMediaUndo({ enabled: true, draft: draft(rows), reloadDraft }));
    await act(async () => { await result.current.revert(change('photoOrder')); });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('/api/etsy-drafts/d1');
    expect(JSON.parse(String(f.mock.calls[0][1].body))).toEqual({ removeMediaIds: ['r1', 'r2'] });
    expect(reloadDraft).toHaveBeenCalledTimes(1);
  });

  it('revert refused (409 DRAFT_SENDING): throws the keyed error and still re-reads', async () => {
    stubFetch(409, { error: 'x', code: 'DRAFT_SENDING', key: 'draftSync.draftSyncing' });
    const reloadDraft = vi.fn(async () => null);
    const { result } = renderHook(() => useStagedMediaUndo({ enabled: true, draft: draft(rows), reloadDraft }));
    let err: unknown;
    await act(async () => { await result.current.revert(change('photos')).catch((e: unknown) => { err = e; }); });
    expect(err).toMatchObject({ status: 409, code: 'DRAFT_SENDING', key: 'draftSync.draftSyncing' });
    expect(reloadDraft).toHaveBeenCalledTimes(1);
  });

  it('removeStagedMedia: a row not on the loaded draft re-reads it first (a strip upload made the draft)', async () => {
    const f = stubFetch();
    const reloadDraft = vi.fn(async () => draft([{ id: 'new1', kind: 'image', operation: 'upload' }]));
    const { result } = renderHook(() => useStagedMediaUndo({ enabled: true, draft: null, reloadDraft }));
    await act(async () => { await result.current.removeStagedMedia?.('new1'); });
    expect(reloadDraft).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.mock.calls[0][1].body))).toEqual({ removeMediaIds: ['new1'] });
  });
});
