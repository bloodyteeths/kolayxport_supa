// PATCH /api/etsy-drafts/[id] { removeMediaIds } — validation, 409 DRAFT_SENDING passthrough, old PATCH intact.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ removeMedia: vi.fn(), removeQueued: vi.fn(), findFirst: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/prisma', () => ({ default: { etsyListingDraft: { findFirst: (...a: unknown[]) => h.findFirst(...a) } } }));
vi.mock('@/lib/drafts/scheduledSend', () => ({ ScheduleError: class extends Error {}, scheduleErrorResponse: vi.fn(), setDraftScheduledSendAt: vi.fn() }));
vi.mock('@/lib/drafts/syncErrors', () => ({ withLegacyLastSyncError: (d: unknown) => d }));
vi.mock('@/lib/etsy/draftService', () => ({
  toSerializable: (v: unknown) => v,
  discardDraft: vi.fn(),
  removeQueuedActions: (...a: unknown[]) => h.removeQueued(...a),
  removeDraftMedia: (...a: unknown[]) => h.removeMedia(...a),
}));

import handler from '../../pages/api/etsy-drafts/[id]/index';
import { draftSendingError } from '@/lib/etsy/draftErrors';

const patch = async (body: unknown) => {
  const r: any = { statusCode: 0 };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await handler({ method: 'PATCH', query: { id: 'd1' }, body, headers: {} } as any, r);
  return r;
};

beforeEach(() => {
  h.removeMedia.mockReset().mockResolvedValue({ removedIds: ['m1'], missingIds: [] });
  h.removeQueued.mockReset().mockResolvedValue({ id: 'd1', via: 'queued' });
  h.findFirst.mockReset().mockResolvedValue({ id: 'd1', media: [] });
});

describe('PATCH removeMediaIds', () => {
  it('400 on a malformed list', async () => {
    for (const bad of [[], 'm1', [1], [''], Array.from({ length: 101 }, (_, i) => `m${i}`)]) {
      expect((await patch({ removeMediaIds: bad })).statusCode).toBe(400);
    }
    expect(h.removeMedia).not.toHaveBeenCalled();
  });

  it('removes media and returns the refreshed draft', async () => {
    const r = await patch({ removeMediaIds: ['m1'] });
    expect(r.statusCode).toBe(200);
    expect(h.removeMedia).toHaveBeenCalledWith('d1', 'u1', ['m1']);
    expect(r.body).toEqual({ draft: { id: 'd1', media: [] } });
    expect(h.removeQueued).not.toHaveBeenCalled();
  });

  it('409 DRAFT_SENDING while the draft is being sent', async () => {
    h.removeMedia.mockRejectedValue(draftSendingError());
    const r = await patch({ removeMediaIds: ['m1'] });
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ code: 'DRAFT_SENDING', key: 'draftSync.draftSyncing' });
  });

  it('combines with removeQueuedActions; the old PATCH still requires a list without removeMediaIds', async () => {
    const r = await patch({ removeMediaIds: ['m1'], removeQueuedActions: ['delete'] });
    expect(r.body).toEqual({ draft: { id: 'd1', via: 'queued' } });
    expect((await patch({})).statusCode).toBe(400);
  });
});
