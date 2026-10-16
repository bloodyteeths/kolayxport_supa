// BR backend: getOrCreateDraft refuses to create a sibling draft while one is being sent (409 DRAFT_SENDING),
// recovers a stale 'syncing' orphan instead, and removeDraftMedia is ownership-checked and syncing-safe.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  shopOwned: true,
  syncingRow: null as null | { id: string; updatedAt: Date },
  editableRow: null as null | Record<string, unknown>,
  ownedDraft: null as null | { id: string; status: string },
  mediaRows: [] as Array<{ id: string; localPath: string | null }>,
  create: vi.fn(),
  recoverFindMany: vi.fn(),
  draftUpdateMany: vi.fn(),
  attemptUpdateMany: vi.fn(),
  mediaDeleteMany: vi.fn(),
  mediaFindMany: vi.fn(),
  unlink: vi.fn(async () => undefined),
  getToken: vi.fn(async () => 'tok'),
  callEtsy: vi.fn(async (_path: string, _token: string) => ({ updated_timestamp: 7 })),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    etsyShop: { findFirst: async () => (h.shopOwned ? { id: 's' } : null) },
    etsyListingDraft: {
      findFirst: async (args: any) => {
        if (args?.where?.status === 'syncing') return h.syncingRow;
        if (args?.where?.id) return h.ownedDraft && args.where.id === h.ownedDraft.id && args.where.userId === 'u1' ? h.ownedDraft : null;
        return h.editableRow;
      },
      findMany: (...a: unknown[]) => h.recoverFindMany(...a),
      updateMany: (...a: unknown[]) => h.draftUpdateMany(...a),
      create: (...a: unknown[]) => h.create(...a),
    },
    etsyDraftSyncAttempt: { updateMany: (...a: unknown[]) => h.attemptUpdateMany(...a) },
    etsyDraftMedia: {
      findMany: (...a: unknown[]) => h.mediaFindMany(...a),
      deleteMany: (...a: unknown[]) => h.mediaDeleteMany(...a),
    },
    etsyListing: { findUnique: async () => null, findFirst: async () => null },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolveNotification: vi.fn(), notificationKeys: { draft: (id: string) => id }, NOTIFICATION_LINKS: {} }));
vi.mock('@/lib/listings/healthQueue', () => ({ queueHealthRefresh: vi.fn() }));
vi.mock('@/lib/etsy/http', () => ({ etsyFetch: vi.fn(), callEtsyAPI: h.callEtsy, etsyAuthHeaders: () => ({}) }));
vi.mock('@/lib/etsy/etsyToken', () => ({ getEtsyAccessToken: h.getToken }));
vi.mock('@/lib/etsy/mediaSafety', async (orig) => ({ ...(await orig<any>()), unlinkDraftUploadFile: h.unlink }));

import { getOrCreateDraft, removeDraftMedia, STALE_SYNCING_MS } from '@/lib/etsy/draftService';
import { draftErrorResponse, isDraftSendingError } from '@/lib/etsy/draftErrors';

beforeEach(() => {
  h.shopOwned = true;
  h.syncingRow = null;
  h.editableRow = null;
  h.ownedDraft = null;
  h.mediaRows = [];
  for (const f of [h.create, h.recoverFindMany, h.draftUpdateMany, h.attemptUpdateMany, h.mediaDeleteMany, h.mediaFindMany, h.unlink]) f.mockReset();
  h.recoverFindMany.mockResolvedValue([]);
  h.mediaFindMany.mockImplementation(async (args: any) => h.mediaRows.filter((r) => args.where.id.in.includes(r.id)));
});

describe('getOrCreateDraft while a draft is being sent', () => {
  it('throws DRAFT_SENDING (409) and never creates a second draft', async () => {
    h.syncingRow = { id: 'd1', updatedAt: new Date() };
    const err = await getOrCreateDraft({ userId: 'u1', shopId: '555', listingId: '42' }).catch((e) => e);
    expect(isDraftSendingError(err)).toBe(true);
    expect(draftErrorResponse(err, 'x')).toEqual({
      status: 409,
      body: expect.objectContaining({ code: 'DRAFT_SENDING', key: 'draftSync.draftSyncing' }),
    });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('recovers a stale syncing orphan and reuses it instead of throwing', async () => {
    h.syncingRow = { id: 'd1', updatedAt: new Date(Date.now() - STALE_SYNCING_MS - 1000) };
    h.recoverFindMany.mockResolvedValue([{ id: 'd1' }]);
    h.editableRow = { id: 'd1', status: 'failed', media: [] };
    const d = await getOrCreateDraft({ userId: 'u1', shopId: '555', listingId: '42' });
    expect(d).toBe(h.editableRow);
    expect(h.draftUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['d1'] } }, data: expect.objectContaining({ status: 'failed' }) }));
    expect(h.create).not.toHaveBeenCalled();
  });

  it('returns the existing editable draft when nothing is sending', async () => {
    h.editableRow = { id: 'd2', status: 'draft', media: [] };
    expect(await getOrCreateDraft({ userId: 'u1', shopId: '555', listingId: '42' })).toBe(h.editableRow);
  });

  it('uses the passed accessToken for a new draft (no per-draft token fetch)', async () => {
    h.getToken.mockClear();
    h.create.mockResolvedValue({ id: 'new' });
    h.callEtsy.mockClear();
    await getOrCreateDraft({ userId: 'u1', shopId: '555', listingId: '42', accessToken: 'shared' });
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ baseEtsyUpdatedTimestamp: 7 }) }));
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.callEtsy.mock.calls.every((c) => c[1] === 'shared')).toBe(true);
  });
});

describe('removeDraftMedia', () => {
  it('404 for a draft of another user; nothing is deleted', async () => {
    h.ownedDraft = { id: 'd1', status: 'draft' };
    const err = await removeDraftMedia('d1', 'intruder', ['m1']).catch((e) => e);
    expect(draftErrorResponse(err, 'x').status).toBe(404);
    expect(h.mediaDeleteMany).not.toHaveBeenCalled();
    expect(h.unlink).not.toHaveBeenCalled();
  });

  it('409 DRAFT_SENDING while syncing', async () => {
    h.ownedDraft = { id: 'd1', status: 'syncing' };
    const err = await removeDraftMedia('d1', 'u1', 'm1').catch((e) => e);
    expect(isDraftSendingError(err)).toBe(true);
    expect(h.mediaDeleteMany).not.toHaveBeenCalled();
  });

  it('409 for a draft that is no longer editable', async () => {
    h.ownedDraft = { id: 'd1', status: 'synced' };
    const err = await removeDraftMedia('d1', 'u1', 'm1').catch((e) => e);
    expect(draftErrorResponse(err, 'x')).toMatchObject({ status: 409, body: { code: 'DRAFT_NOT_EDITABLE' } });
  });

  it('deletes only this draft’s rows and unlinks their staged files', async () => {
    // The draft still holds a field edit, so removing its media does not empty (cancel) it.
    h.ownedDraft = { id: 'd1', status: 'draft', fieldPatch: { title: 'Kept' } } as any;
    h.mediaRows = [{ id: 'm1', localPath: '/uploads/u1/d1/a.jpg' }, { id: 'm2', localPath: null }];
    const r = await removeDraftMedia('d1', 'u1', ['m1', 'm2', 'other']);
    expect(r).toEqual({ removedIds: ['m1', 'm2'], missingIds: ['other'], cancelled: false });
    expect(h.draftUpdateMany).not.toHaveBeenCalled();
    expect(h.mediaFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { draftId: 'd1', id: { in: ['m1', 'm2', 'other'] } } }));
    expect(h.mediaDeleteMany).toHaveBeenCalledWith({ where: { draftId: 'd1', id: { in: ['m1', 'm2'] } } });
    expect(h.unlink).toHaveBeenCalledTimes(1);
    expect(h.unlink).toHaveBeenCalledWith('/uploads/u1/d1/a.jpg');
  });

  it('rejects an empty id list', async () => {
    h.ownedDraft = { id: 'd1', status: 'draft' };
    const err = await removeDraftMedia('d1', 'u1', []).catch((e) => e);
    expect(draftErrorResponse(err, 'x').body.code).toBe('INVALID_MEDIA');
  });
});
