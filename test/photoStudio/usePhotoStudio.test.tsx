// @vitest-environment jsdom
// M7-E PhotoStudio staging order: the files of one listing upload one after another (a listing without a draft
// would otherwise get several drafts), Replace / AI edits stage the old photo's delete only after the new photo is
// staged (a failed upload leaves no delete behind), a replace counts as one change, and the progress total matches
// the ticks (AI alt text ticks once).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { EtsyImageLike } from '@/components/domain/listing-editor/sections/photosModel';
import { DEFAULT_PLAN_INPUT, planOperation, type MediaOp, type PlanInput } from '@/components/domain/photo-studio/studioModel';

const api = vi.hoisted(() => ({
  inFlight: new Map<string, number>(),
  maxInFlight: new Map<string, number>(),
  log: [] as string[],
  failUploads: false,
  delay: () => new Promise((r) => setTimeout(r, 5)),
}));

vi.mock('@/components/domain/photo-studio/studioApi', async (orig) => {
  const real = await orig<typeof import('@/components/domain/photo-studio/studioApi')>();
  const enter = (id: string) => {
    const n = (api.inFlight.get(id) ?? 0) + 1;
    api.inFlight.set(id, n);
    api.maxInFlight.set(id, Math.max(api.maxInFlight.get(id) ?? 0, n));
  };
  const leave = (id: string) => api.inFlight.set(id, (api.inFlight.get(id) ?? 1) - 1);
  return {
    ...real,
    fetchStudioListings: vi.fn(async (_shop: string | null, ids: string[]) => ({
      rows: ids.map((id) => ({ id, title: `Listing ${id}`, thumbUrl: null, sync: null })),
      store: { id: '555', name: 'Shop' },
      stores: [],
    })),
    fetchShopDrafts: vi.fn(async () => new Map()),
    fetchListingImages: vi.fn(async (_shop: string, id: string): Promise<EtsyImageLike[]> => [
      { listing_image_id: Number(id) * 10 + 1, rank: 1, alt_text: '', url_570xN: `https://i.etsystatic.com/${id}_1.jpg`, url_fullxfull: `https://i.etsystatic.com/${id}_1f.jpg` },
    ]),
    fetchListingVideos: vi.fn(async () => []),
    stageFile: vi.fn(async (input: { listingId: string; operation?: string }) => {
      enter(input.listingId);
      try {
        await api.delay();
        api.log.push(`${input.operation ?? 'upload'}:${input.listingId}`);
        if (api.failUploads) throw Object.assign(new Error('boom'), { status: 500 });
        return { draftId: `d-${input.listingId}`, media: { id: `m-${input.listingId}-${api.log.length}`, kind: 'image', operation: input.operation ?? 'upload', rank: 1 } };
      } finally {
        leave(input.listingId);
      }
    }),
    stageBatchMedia: vi.fn(async (_shop: string, items: { listingId: string; media: MediaOp[] }[], onResult: (r: unknown) => void) => {
      for (const i of items) {
        for (const m of i.media) api.log.push(`${m.operation}:${i.listingId}`);
        onResult({ listingId: i.listingId, ok: true, draftId: `d-${i.listingId}`, status: 'draft', media: [] });
      }
    }),
    generateStudioImage: vi.fn(async () => new File(['x'], 'ai.png', { type: 'image/png' })),
    writeStudioAlt: vi.fn(async () => 'alt text'),
  };
});

import { usePhotoStudio } from '@/components/domain/photo-studio/usePhotoStudio';

const file = (n: number) => new File([String(n)], `f${n}.jpg`, { type: 'image/jpeg' });

async function ready(ids: string[]) {
  const hook = renderHook(() => usePhotoStudio({ shopId: '555', ids }));
  await waitFor(() => expect(hook.result.current.photoViews.size).toBe(ids.length));
  return hook;
}

function planFor(hook: Awaited<ReturnType<typeof ready>>, over: Partial<PlanInput>) {
  const s = hook.result.current;
  return planOperation({ ...DEFAULT_PLAN_INPUT, ...over }, s.listings, s.photoViews);
}

beforeEach(() => {
  api.inFlight.clear();
  api.maxInFlight.clear();
  api.log = [];
  api.failUploads = false;
});
afterEach(() => vi.clearAllMocks());

describe('usePhotoStudio staging order', () => {
  it('Add 3 files to 4 listings: at most one upload in flight per listing', async () => {
    const hook = await ready(['1', '2', '3', '4']);
    const plan = planFor(hook, { op: 'add', source: 'upload', fileCount: 3 });
    expect(plan.uploads).toHaveLength(12);
    let res: Awaited<ReturnType<typeof hook.result.current.runPlan>> | undefined;
    await act(async () => { res = await hook.result.current.runPlan(plan, { files: [file(0), file(1), file(2)], prompt: '', op: 'add' }); });
    expect(res?.staged).toBe(12);
    for (const id of ['1', '2', '3', '4']) expect(api.maxInFlight.get(id)).toBe(1);
    expect(hook.result.current.stagedHere).toBe(plan.changes);
  });

  it('Replace by file: upload first, then the delete; counts once', async () => {
    const hook = await ready(['1', '2']);
    const plan = planFor(hook, { op: 'replace', source: 'upload', position: 1, fileCount: 1 });
    await act(async () => { await hook.result.current.runPlan(plan, { files: [file(0)], prompt: '', op: 'replace' }); });
    for (const id of ['1', '2']) {
      expect(api.log.indexOf(`upload:${id}`)).toBeGreaterThanOrEqual(0);
      expect(api.log.indexOf(`delete:${id}`)).toBeGreaterThan(api.log.indexOf(`upload:${id}`));
    }
    expect(hook.result.current.stagedHere).toBe(plan.changes);
    expect(plan.changes).toBe(2);
  });

  it('Replace by file: a failed upload leaves no staged delete', async () => {
    api.failUploads = true;
    const hook = await ready(['1', '2']);
    const plan = planFor(hook, { op: 'replace', source: 'upload', position: 1, fileCount: 1 });
    let res: Awaited<ReturnType<typeof hook.result.current.runPlan>> | undefined;
    await act(async () => { res = await hook.result.current.runPlan(plan, { files: [file(0)], prompt: '', op: 'replace' }); });
    expect(api.log.filter((l) => l.startsWith('delete:'))).toEqual([]);
    expect(res?.failed).toBe(2);
    expect(hook.result.current.stagedHere).toBe(0);
  });

  it('Improve quality with AI: a failed AI upload leaves no staged delete; a good one counts once', async () => {
    const hook = await ready(['1']);
    const plan = planFor(hook, { op: 'enhance', position: 1 });
    api.failUploads = true;
    await act(async () => { await hook.result.current.runPlan(plan, { files: [], prompt: '', op: 'enhance' }); });
    expect(api.log.filter((l) => l.startsWith('delete:'))).toEqual([]);
    api.failUploads = false;
    api.log = [];
    await act(async () => { await hook.result.current.runPlan(plan, { files: [], prompt: '', op: 'enhance' }); });
    expect(api.log).toEqual(['ai_upload:1', 'delete:1']);
    expect(hook.result.current.stagedHere).toBe(1);
  });

  it('single-tile Replace: failed upload stages no delete; success stages upload then delete and counts once', async () => {
    const hook = await ready(['1']);
    const tileId = hook.result.current.photoViews.get('1')?.tiles[0].id as string;
    api.failUploads = true;
    await act(async () => { await hook.result.current.replaceTile('1', tileId, file(0)); });
    expect(api.log.filter((l) => l.startsWith('delete:'))).toEqual([]);
    api.failUploads = false;
    api.log = [];
    await act(async () => { await hook.result.current.replaceTile('1', tileId, file(0)); });
    expect(api.log).toEqual(['upload:1', 'delete:1']);
    expect(hook.result.current.stagedHere).toBe(1);
  });

  it('single-tile uploads on one listing queue behind each other', async () => {
    const hook = await ready(['1']);
    await act(async () => {
      await Promise.all([
        hook.result.current.addFiles('1', [file(0)]),
        hook.result.current.addFiles('1', [file(1)]),
        hook.result.current.addFiles('1', [file(2)]),
      ]);
    });
    expect(api.maxInFlight.get('1')).toBe(1);
    expect(api.log).toEqual(['upload:1', 'upload:1', 'upload:1']);
  });

  it('progress total for AI alt text ticks once per job', async () => {
    const hook = await ready(['1', '2']);
    const plan = planFor(hook, { op: 'alt', altMode: 'ai', altAll: true });
    expect(plan.ai).toHaveLength(2);
    const seen: Array<{ done: number; total: number }> = [];
    let resolveAlt: (() => void) | null = null;
    const { writeStudioAlt } = await import('@/components/domain/photo-studio/studioApi');
    vi.mocked(writeStudioAlt).mockImplementationOnce(async () => 'a').mockImplementationOnce(() => new Promise((r) => { resolveAlt = () => r('b'); }));
    let run: Promise<unknown> | undefined;
    act(() => { run = hook.result.current.runPlan(plan, { files: [], prompt: '', op: 'alt' }); });
    await waitFor(() => expect(hook.result.current.progress?.done).toBe(1));
    seen.push(hook.result.current.progress as { done: number; total: number });
    await act(async () => { resolveAlt?.(); await run; });
    expect(seen[0].total).toBe(2);
  });
});
