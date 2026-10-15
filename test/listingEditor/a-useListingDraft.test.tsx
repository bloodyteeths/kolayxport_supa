// @vitest-environment jsdom
// M6 Group A: the autosave engine. One save layer into the DB draft, debounce + single flight, I0 8b overlay on
// open, offline device copy, Send flushes first, never forces, and never sends a queued delete without confirm.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useListingDraft } from '@/components/domain/listing-editor/useListingDraft';
import type { ListingEditorAdapter } from '@/components/domain/listing-editor/adapters/types';
import { diffKeys } from '@/components/domain/listing-editor/changeSummary';
import type { DraftRow, FieldMap } from '@/lib/listingEditor/types';

type F = FieldMap & { title: string; price: string; tags: string[] };
const REMOTE: F = { title: 'Remote', price: '10.00', tags: ['a'] };

function row(p: Partial<DraftRow> = {}): DraftRow {
  return { id: 'd1', status: 'draft', listingId: '1', fieldPatch: {}, queuedActions: [], media: [], syncAttempts: [], updatedAt: '2026-10-15T10:00:00Z', ...p };
}

function makeAdapter(over: Partial<ListingEditorAdapter<F>> = {}) {
  const store: Record<string, string> = {};
  const a: ListingEditorAdapter<F> = {
    marketplace: 'etsy',
    displayName: 'Etsy',
    blankFields: (d = {}) => ({ title: '', price: '', tags: [], ...d }) as F,
    fieldsFromCopy: (src) => ({ title: src.title }) as Partial<F>,
    readCreateDefaults: () => ({}),
    writeCreateDefaults: vi.fn(),
    newLocalListingId: () => '-100',
    load: vi.fn(async () => ({ fields: { ...REMOTE }, meta: { id: '1', state: 'active', url: null, updatedAt: new Date(1000), views: 0, favorites: 0, currency: 'USD', images: [] } })),
    loadDraft: vi.fn(async () => null),
    overlay: (base, d) => {
      const fields = { ...base, ...(d?.fieldPatch ?? {}) } as F;
      return { fields, extra: {}, applied: Object.keys(d?.fieldPatch ?? {}).length };
    },
    changedKeys: (r, c) => diffKeys(r, c),
    stageFields: vi.fn(async ({ current, remote }) => row({ fieldPatch: Object.fromEntries(diffKeys(remote, current).map((k) => [k, current[k]])) })),
    stageActions: vi.fn(async (_c, actions) => row({ queuedActions: actions })),
    removeActions: vi.fn(async () => row()),
    discard: vi.fn(async () => undefined),
    send: vi.fn(async () => ({ listingId: '1', warnings: [] })),
    validate: () => [],
    errorInfo: (err) => ({ status: null, network: err instanceof TypeError, conflict: (err as { conflict?: boolean })?.conflict === true, key: null }),
    failureCauseKey: () => 'listings.sendError.generic',
    readDeviceCopy: (k) => (store[k] ? JSON.parse(store[k]) : null),
    writeDeviceCopy: vi.fn((k, fields) => {
      store[k] = JSON.stringify({ fields, savedAt: Date.now() });
      return true;
    }),
    clearDeviceCopy: vi.fn((k) => {
      delete store[k];
    }),
    ...over,
  };
  return a;
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function mountEdit(adapter: ListingEditorAdapter<F>) {
  const hook = renderHook(() => useListingDraft<F>({ adapter, shopId: '42', mode: 'edit', listingId: '1', debounceMs: 1500 }));
  await waitFor(() => expect(hook.result.current.loadState).toBe('ready'));
  return hook;
}

describe('useListingDraft', () => {
  it('overlays the DB draft before showing the form (I0 8b) and reads as saved', async () => {
    const adapter = makeAdapter({ loadDraft: vi.fn(async () => row({ fieldPatch: { title: 'Staged' } })) });
    const { result } = await mountEdit(adapter);
    expect(result.current.view.fields.title).toBe('Staged');
    expect(result.current.remote?.title).toBe('Remote');
    expect(result.current.saveState).toBe('saved');
    expect(result.current.changes.map((c) => c.id)).toEqual(['title']);
    expect(result.current.isFieldDirty('title')).toBe(true);
  });

  it('a failed drafts fetch keeps editing but blocks Send', async () => {
    const adapter = makeAdapter({ loadDraft: vi.fn(async () => Promise.reject(new Error('500'))) });
    const { result } = await mountEdit(adapter);
    expect(result.current.draftCheckFailed).toBe(true);
    let out;
    await act(async () => {
      out = await result.current.send();
    });
    expect(out).toEqual({ outcome: 'blocked' });
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('debounces edits into one stage 1.5s after the last change', async () => {
    const adapter = makeAdapter();
    const { result } = await mountEdit(adapter);
    act(() => result.current.setField('title', 'A'));
    act(() => result.current.setField('title', 'AB'));
    expect(result.current.saveState).toBe('dirty');
    await act(async () => {
      vi.advanceTimersByTime(1400);
    });
    expect(adapter.stageFields).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    expect(adapter.stageFields).toHaveBeenCalledTimes(1);
    expect((adapter.stageFields as ReturnType<typeof vi.fn>).mock.calls[0][0].current.title).toBe('AB');
    expect(result.current.draft?.fieldPatch).toEqual({ title: 'AB' });
  });

  it('one request in flight; an edit during it queues exactly one follow-up', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const stageFields = vi.fn(async ({ current }: { current: F }) => {
      if (stageFields.mock.calls.length === 1) await gate;
      return row({ fieldPatch: { title: current.title } });
    });
    const adapter = makeAdapter({ stageFields: stageFields as unknown as ListingEditorAdapter<F>['stageFields'] });
    const { result } = await mountEdit(adapter);
    act(() => result.current.setField('title', 'One'));
    let first: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = result.current.saveNow();
    });
    act(() => result.current.setField('title', 'Two'));
    let second: Promise<boolean> = Promise.resolve(true);
    act(() => {
      second = result.current.saveNow();
    });
    await act(async () => {
      release();
      await first;
      await second;
    });
    expect(stageFields).toHaveBeenCalledTimes(2);
    expect(stageFields.mock.calls[1][0].current.title).toBe('Two');
    expect(result.current.saveState).toBe('saved');
  });

  it('network failure keeps a device copy (offline) and Send says save first', async () => {
    const adapter = makeAdapter({ stageFields: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) });
    const { result } = await mountEdit(adapter);
    act(() => result.current.setField('title', 'Offline edit'));
    await act(async () => {
      await result.current.saveNow();
    });
    expect(result.current.saveState).toBe('offline');
    expect(adapter.writeDeviceCopy).toHaveBeenCalledWith('1', expect.objectContaining({ title: 'Offline edit' }));
    let out;
    await act(async () => {
      out = await result.current.send();
    });
    expect(out).toMatchObject({ outcome: 'failed' });
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('Send flushes the save, then sends without force, then refreshes', async () => {
    const adapter = makeAdapter();
    const { result } = await mountEdit(adapter);
    act(() => result.current.setField('price', '12.00'));
    let out;
    await act(async () => {
      out = await result.current.send();
    });
    expect(adapter.stageFields).toHaveBeenCalledTimes(1);
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect((adapter.send as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({ publish: undefined });
    expect(out).toMatchObject({ outcome: 'sent' });
    expect(adapter.load).toHaveBeenCalledTimes(2);
    expect(result.current.draft).toBeNull();
  });

  it('never sends a draft with a queued delete unless the delete was confirmed', async () => {
    const adapter = makeAdapter({ loadDraft: vi.fn(async () => row({ queuedActions: [{ type: 'delete' }] })) });
    const { result } = await mountEdit(adapter);
    let out;
    await act(async () => {
      out = await result.current.send();
    });
    expect(out).toEqual({ outcome: 'blocked' });
    expect(adapter.send).not.toHaveBeenCalled();
    await act(async () => {
      out = await result.current.send({ confirmedDelete: true });
    });
    expect(adapter.send).toHaveBeenCalledTimes(1);
  });

  it('a conflict comes back as outcome conflict (Review differences), never retried with force', async () => {
    const adapter = makeAdapter({
      loadDraft: vi.fn(async () => row({ fieldPatch: { title: 'Mine' } })),
      send: vi.fn(async () => Promise.reject(Object.assign(new Error('409'), { conflict: true }))),
    });
    const { result } = await mountEdit(adapter);
    let out;
    await act(async () => {
      out = await result.current.send();
    });
    expect(out).toMatchObject({ outcome: 'conflict' });
    expect(adapter.send).toHaveBeenCalledTimes(1);
  });

  it('blocks Send on block_sync issues and lists them', async () => {
    const adapter = makeAdapter({
      loadDraft: vi.fn(async () => row({ fieldPatch: { title: 'x' } })),
      validate: () => [{ field: 'tags', section: 'tags', severity: 'block_sync', key: 'etsy.validation.tagsRequired' }],
    });
    const { result } = await mountEdit(adapter);
    let out: { outcome?: string } = {};
    await act(async () => {
      out = await result.current.send();
    });
    expect(out.outcome).toBe('blocked');
    expect(result.current.issues.map((i) => i.field)).toEqual(['tags']);
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('registered sections are staged on save and counted while dirty', async () => {
    const adapter = makeAdapter({ loadDraft: vi.fn(async () => null) });
    const { result } = await mountEdit(adapter);
    let dirty = true;
    const stage = vi.fn(async () => {
      dirty = false;
    });
    act(() => {
      result.current.register({ id: 'photos', isDirty: () => dirty, stage, changes: () => [{ group: 'photoOrder' }] });
    });
    act(() => result.current.notifyChange());
    expect(result.current.changes.map((c) => c.id)).toEqual(['photoOrder']);
    await act(async () => {
      await result.current.saveNow();
    });
    expect(stage).toHaveBeenCalledTimes(1);
    expect(adapter.loadDraft).toHaveBeenCalledTimes(2);
  });

  it('revert restores the remote value; discard drops the draft and every edit', async () => {
    const adapter = makeAdapter({ loadDraft: vi.fn(async () => row({ fieldPatch: { title: 'Staged', price: '11.00' } })) });
    const { result } = await mountEdit(adapter);
    act(() => result.current.revert(['title']));
    expect(result.current.view.fields.title).toBe('Remote');
    await act(async () => {
      await result.current.discard();
    });
    expect(adapter.discard).toHaveBeenCalledWith('d1');
    expect(result.current.view.fields).toEqual(REMOTE);
    expect(result.current.saveState).toBe('idle');
    expect(result.current.changes).toEqual([]);
  });

  it('refreshRemote keeps dirty fields and takes the rest from the marketplace', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ fields: { ...REMOTE }, meta: { id: '1', state: 'active', url: null, updatedAt: new Date(1000), views: 0, favorites: 0, currency: 'USD', images: [] } })
      .mockResolvedValueOnce({ fields: { ...REMOTE, title: 'Changed on Etsy', price: '15.00' }, meta: { id: '1', state: 'active', url: null, updatedAt: new Date(2000), views: 0, favorites: 0, currency: 'USD', images: [] } });
    const adapter = makeAdapter({ load });
    const { result } = await mountEdit(adapter);
    act(() => result.current.setField('price', '12.00'));
    await act(async () => {
      await result.current.refreshRemote();
    });
    expect(result.current.view.fields.title).toBe('Changed on Etsy');
    expect(result.current.view.fields.price).toBe('12.00');
    expect(result.current.remoteChangedAt?.getTime()).toBe(2000);
  });

  it('create: a local negative id from the start, onDraftCreated after the first stage, publish queued on send', async () => {
    const onDraftCreated = vi.fn();
    const onCreated = vi.fn();
    const adapter = makeAdapter({ send: vi.fn(async () => ({ listingId: '777', warnings: [] })) });
    const { result } = renderHook(() =>
      useListingDraft<F>({ adapter, shopId: '42', mode: 'create', listingId: null, onDraftCreated, onCreated }),
    );
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    expect(result.current.ctx.listingId).toBe('-100');
    expect(result.current.saveState).toBe('idle');
    act(() => result.current.setField('title', 'New listing'));
    await act(async () => {
      await result.current.saveNow();
    });
    expect(onDraftCreated).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.send({ publish: true });
    });
    expect(adapter.stageActions).toHaveBeenCalledWith({ shopId: '42', listingId: '-100' }, [{ type: 'publish' }]);
    expect(adapter.writeCreateDefaults).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith('777');
  });
  it('draft check failed: autosave never stages over the unseen draft; a later check overlays it under the edits', async () => {
    const loadDraft = vi.fn<ListingEditorAdapter<F>['loadDraft']>(async () => Promise.reject(new Error('500')));
    const adapter = makeAdapter({ loadDraft });
    const { result } = await mountEdit(adapter);
    act(() => result.current.setField('title', 'Mine'));
    await act(async () => {
      await result.current.saveNow();
    });
    expect(adapter.stageFields).not.toHaveBeenCalled();
    expect(result.current.saveState).toBe('offline');
    expect(adapter.writeDeviceCopy).toHaveBeenCalledWith('1', expect.objectContaining({ title: 'Mine' }));
    // The drafts API recovers: an existing draft (price staged elsewhere) is overlaid, the edit kept on top.
    loadDraft.mockImplementation(async () => row({ fieldPatch: { price: '20.00' } }));
    await act(async () => {
      await result.current.saveNow();
    });
    expect(adapter.stageFields).toHaveBeenCalledTimes(1);
    const staged = (adapter.stageFields as ReturnType<typeof vi.fn>).mock.calls[0][0].current;
    expect(staged).toMatchObject({ title: 'Mine', price: '20.00' });
    expect(result.current.draftCheckFailed).toBe(false);
  });

  it('draft check Retry (reloadDraft) overlays the recovered fieldPatch onto the form', async () => {
    const loadDraft = vi.fn<ListingEditorAdapter<F>['loadDraft']>(async () => Promise.reject(new Error('500')));
    const adapter = makeAdapter({ loadDraft });
    const { result } = await mountEdit(adapter);
    loadDraft.mockImplementation(async () => row({ fieldPatch: { price: '20.00' } }));
    await act(async () => {
      await result.current.reloadDraft();
    });
    expect(result.current.draftCheckFailed).toBe(false);
    expect(result.current.view.fields.price).toBe('20.00');
    expect(result.current.saveState).not.toBe('dirty');
  });

  it('a second Send while the pre-send save runs is ignored (one sync)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const stageFields = vi.fn(async ({ current }: { current: F }) => {
      await gate;
      return row({ fieldPatch: { title: current.title } });
    });
    const adapter = makeAdapter({ stageFields: stageFields as unknown as ListingEditorAdapter<F>['stageFields'] });
    const { result } = await mountEdit(adapter);
    act(() => result.current.setField('title', 'X'));
    let a: Promise<unknown> = Promise.resolve();
    let b: Promise<unknown> = Promise.resolve();
    act(() => {
      a = result.current.send();
      b = result.current.send();
    });
    await waitFor(() => expect(result.current.sending).toBe(true));
    let second: unknown;
    await act(async () => {
      release();
      await a;
      second = await b;
    });
    expect(second).toEqual({ outcome: 'cancelled' });
    expect(adapter.send).toHaveBeenCalledTimes(1);
  });

  it('after an edit send, draft-only keys are cleared and never re-staged', async () => {
    const meta = { id: '1', state: 'active', url: null, updatedAt: new Date(1000), views: 0, favorites: 0, currency: 'USD', images: [] };
    const load = vi
      .fn()
      .mockResolvedValueOnce({ fields: { ...REMOTE }, meta })
      .mockResolvedValue({ fields: { ...REMOTE, title: 'Staged' }, meta }); // after the send Etsy has the title
    const loadDraft = vi.fn<ListingEditorAdapter<F>['loadDraft']>(async () => row({ fieldPatch: { title: 'Staged', sku: 'OLD' } }));
    const adapter = makeAdapter({
      load,
      loadDraft,
      overlay: (base, d) => {
        const { sku, ...rest } = (d?.fieldPatch ?? {}) as Record<string, unknown>;
        return { fields: { ...base, ...rest } as F, extra: sku !== undefined ? { sku } : {}, applied: 1 };
      },
    });
    const { result } = await mountEdit(adapter);
    loadDraft.mockImplementation(async () => null); // synced: no pending draft any more
    await act(async () => {
      await result.current.send();
    });
    expect(result.current.changes).toEqual([]);
    act(() => result.current.setField('price', '13.00'));
    await act(async () => {
      await result.current.saveNow();
    });
    const call = (adapter.stageFields as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(call.extra).toEqual({});
  });

  it('a send that ran a queued delete reports deleted and stops autosave', async () => {
    const adapter = makeAdapter({
      loadDraft: vi.fn(async () => row({ queuedActions: [{ type: 'delete' }] })),
      send: vi.fn(async () => ({ listingId: '1', deleted: true, warnings: [] })),
    });
    const { result } = await mountEdit(adapter);
    let out: { outcome?: string; deleted?: boolean } = {};
    await act(async () => {
      out = await result.current.send({ confirmedDelete: true });
    });
    expect(out).toMatchObject({ outcome: 'sent', deleted: true });
    expect(adapter.load).toHaveBeenCalledTimes(1); // no refresh of a listing that no longer exists
    act(() => result.current.setField('title', 'after'));
    await act(async () => {
      await result.current.saveNow();
    });
    expect(adapter.stageFields).not.toHaveBeenCalled();
  });

  it('create: a failed send after the server re-keyed the draft moves to the real id and never re-creates', async () => {
    const onCreated = vi.fn();
    const loadDraft = vi.fn<ListingEditorAdapter<F>['loadDraft']>(async () => null);
    const adapter = makeAdapter({
      loadDraft,
      stageFields: vi.fn(async () => row({ id: 'd9', listingId: '-100', fieldPatch: { title: 'New' }, queuedActions: [{ type: 'create_listing' }] })),
      stageActions: vi.fn(async (_c, actions) => row({ id: 'd9', listingId: '-100', queuedActions: [{ type: 'create_listing' }, ...actions] })),
      send: vi.fn(async () => Promise.reject(new Error('photo download failed'))),
    });
    const { result } = renderHook(() => useListingDraft<F>({ adapter, shopId: '42', mode: 'create', listingId: null, onCreated }));
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    act(() => result.current.setField('title', 'New'));
    await act(async () => {
      await result.current.saveNow();
    });
    loadDraft.mockImplementation(async (input) =>
      input.draftId === 'd9'
        ? row({ id: 'd9', status: 'failed', listingId: '555', queuedActions: [{ type: 'create_listing', completedAt: 'x' }] })
        : null,
    );
    let out: { outcome?: string; listingId?: string | null } = {};
    await act(async () => {
      out = await result.current.send({ publish: true });
    });
    expect(loadDraft).toHaveBeenCalledWith({ shopId: '42', draftId: 'd9' });
    expect(out).toMatchObject({ outcome: 'failed', listingId: '555' });
    expect(onCreated).toHaveBeenCalledWith('555');
    expect(result.current.ctx.listingId).toBe('555');
    // The next edit must not stage another create_listing on the old local id.
    const stagesBefore = (adapter.stageFields as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => result.current.setField('title', 'New 2'));
    await act(async () => {
      await result.current.saveNow();
    });
    expect((adapter.stageFields as ReturnType<typeof vi.fn>).mock.calls.length).toBe(stagesBefore);
  });

  it('create: resuming a staged new listing shows a newer device copy (restore banner)', async () => {
    const adapter = makeAdapter({
      loadDraft: vi.fn(async () => row({ id: 'd5', listingId: '-100', fieldPatch: { title: 'DB' }, updatedAt: '2020-01-01T00:00:00Z' })),
    });
    adapter.writeDeviceCopy('-100', { title: 'Offline', price: '', tags: [] } as F);
    const { result } = renderHook(() => useListingDraft<F>({ adapter, shopId: '42', mode: 'create', listingId: null, draftId: 'd5' }));
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    expect(result.current.deviceCopy?.fields.title).toBe('Offline');
  });
});
