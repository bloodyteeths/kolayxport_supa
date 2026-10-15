// POST /api/etsy-drafts/batch-media (M7-E, pro-gating §4.4): guards, the server-side bulkPhotoStudio gate
// (402 featureLocked, neutral for shopify_free), per-item results that never fail the batch, the queued-delete and
// sending blocks, concurrency ≤ 5, and that it only stages (never calls the sync engine).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  dbUser: { subscriptionPlan: 'pro', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null as Date | null } as Record<string, unknown> | null,
  shopifyShops: 0,
  drafts: [] as Array<{ etsyListingId: bigint; status: string; queuedActions: unknown }>,
  upsert: vi.fn(),
  syncDraft: vi.fn(),
  inFlight: 0,
  maxInFlight: 0,
  ownedShops: ['555'],
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: async () => h.user }));
vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: async () => h.dbUser },
    shopifyShop: { count: async () => h.shopifyShops },
    etsyListingDraft: { findMany: async () => h.drafts },
  },
}));
vi.mock('@/lib/etsy/draftService', async () => {
  const { EtsyDraftError } = await import('@/lib/etsy/draftErrors');
  return {
    toSerializable: (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))),
    assertShopOwnership: async (_u: string, shopId: string) => {
      if (!h.ownedShops.includes(shopId)) throw new EtsyDraftError('SHOP_NOT_FOUND', 'nope', { status: 404, key: 'draftSync.shopNotFound' });
    },
    upsertDraftPatch: (...a: unknown[]) => h.upsert(...a),
    syncDraft: (...a: unknown[]) => h.syncDraft(...a),
  };
});

import handler, { parseBatchMediaBody, bulkPhotoStudioAccess } from '../../pages/api/etsy-drafts/batch-media';
import { EtsyDraftError } from '@/lib/etsy/draftErrors';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
const post = async (body: unknown, method = 'POST') => {
  const r = res();
  await handler({ method, query: {}, body, headers: {} } as any, r);
  return r;
};
const del = (id: number) => ({ kind: 'image', operation: 'delete', etsyMediaId: id });

beforeEach(() => {
  h.user = { id: 'u1' };
  h.dbUser = { subscriptionPlan: 'pro', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null };
  h.shopifyShops = 0;
  h.drafts = [];
  h.inFlight = 0;
  h.maxInFlight = 0;
  h.syncDraft.mockReset();
  h.upsert.mockReset();
  h.upsert.mockImplementation(async (p: { listingId: string; media: unknown[] }) => {
    h.inFlight += 1;
    h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
    await new Promise((r) => setTimeout(r, 2));
    h.inFlight -= 1;
    return { id: `d-${p.listingId}`, status: 'draft', etsyListingId: BigInt(p.listingId), media: [{ id: 'm1', kind: 'image', operation: 'delete', etsyMediaId: BigInt(9), localPath: '/srv/secret/path.jpg' }] };
  });
});

describe('body parsing', () => {
  it('rejects malformed bodies', () => {
    expect(parseBatchMediaBody(null).ok).toBe(false);
    expect(parseBatchMediaBody({ shopId: '555', items: [] }).ok).toBe(false);
    expect(parseBatchMediaBody({ shopId: '555', items: Array.from({ length: 51 }, (_, i) => ({ listingId: String(i + 1), media: [del(1)] })) }).ok).toBe(false);
    expect(parseBatchMediaBody({ shopId: '555', items: [{ listingId: '1', media: [del(1)] }, { listingId: '1', media: [del(2)] }] }).ok).toBe(false);
    expect(parseBatchMediaBody({ shopId: '555', items: [{ listingId: '1', media: Array.from({ length: 51 }, () => del(1)) }] }).ok).toBe(false);
    expect(parseBatchMediaBody({ shopId: '555', items: [{ listingId: '1', media: [del(1)] }] }).ok).toBe(true);
  });
});

describe('POST /api/etsy-drafts/batch-media', () => {
  it('405 / 401 / 400', async () => {
    expect((await post({}, 'GET')).statusCode).toBe(405);
    h.user = null;
    expect((await post({ shopId: '555', items: [{ listingId: '1', media: [del(1)] }] })).statusCode).toBe(401);
    h.user = { id: 'u1' };
    expect((await post({ shopId: 'x', items: [] })).statusCode).toBe(400);
  });

  it('402 featureLocked for a Stripe plan without Pro (not neutral) — nothing is staged', async () => {
    h.dbUser = { subscriptionPlan: 'growth', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null };
    const r = await post({ shopId: '555', items: [{ listingId: '1', media: [del(1)] }] });
    expect(r.statusCode).toBe(402);
    expect(r.body).toEqual({ error: 'Payment Required', limitType: 'feature', reason: 'featureLocked', feature: 'bulkPhotoStudio', neutral: false });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('402 neutral for shopify_free (an active Shopify store counts)', async () => {
    h.shopifyShops = 1;
    const r = await post({ shopId: '555', items: [{ listingId: '1', media: [del(1)] }] });
    expect(r.statusCode).toBe(402);
    expect(r.body.neutral).toBe(true);
  });

  it('trial includes the studio; an expired trial does not', async () => {
    h.dbUser = { subscriptionPlan: 'trial', subscriptionStatus: 'trialing', billingInterval: null, billingProvider: null, trialExpiresAt: new Date(Date.now() + 5 * 86_400_000) };
    expect((await bulkPhotoStudioAccess('u1')).allowed).toBe(true);
    h.dbUser = { subscriptionPlan: 'trial', subscriptionStatus: 'trialing', billingInterval: null, billingProvider: null, trialExpiresAt: new Date(Date.now() - 30 * 86_400_000) };
    expect(await bulkPhotoStudioAccess('u1')).toEqual({ allowed: false, neutral: false });
  });

  it('404 when the shop is not the user’s', async () => {
    const r = await post({ shopId: '999', items: [{ listingId: '1', media: [del(1)] }] });
    expect(r.statusCode).toBe(404);
    expect(r.body).toMatchObject({ code: 'SHOP_NOT_FOUND', key: 'draftSync.shopNotFound' });
  });

  it('stages each item, reports per item, never fails the batch, never sends', async () => {
    h.drafts = [
      { etsyListingId: BigInt(2), status: 'draft', queuedActions: [{ type: 'delete' }] },
      { etsyListingId: BigInt(3), status: 'syncing', queuedActions: [] },
    ];
    h.upsert.mockImplementationOnce(async () => { throw new EtsyDraftError('INVALID_MEDIA', 'bad', { key: 'draftSync.invalidMedia' }); });
    const r = await post({ shopId: '555', items: [
      { listingId: '1', media: [del(1)] },
      { listingId: '2', media: [del(2)] },
      { listingId: '3', media: [del(3)] },
      { listingId: '4', media: [del(4)] },
    ] });
    expect(r.statusCode).toBe(200);
    expect(r.body.results).toEqual([
      { listingId: '1', ok: false, code: 'INVALID_MEDIA', key: 'draftSync.invalidMedia' },
      { listingId: '2', ok: false, code: 'QUEUED_DELETE', key: 'draftSync.deleteNotExclusive' },
      { listingId: '3', ok: false, code: 'DRAFT_SENDING', key: 'draftSync.draftSyncing' },
      expect.objectContaining({ listingId: '4', ok: true, draftId: 'd-4', status: 'draft' }),
    ]);
    // the staged file path never leaves the server
    expect(JSON.stringify(r.body)).not.toContain('/srv/secret');
    expect(h.upsert).toHaveBeenCalledTimes(2);
    expect(h.upsert.mock.calls[1][0]).toMatchObject({ userId: 'u1', shopId: '555', listingId: '4', media: [del(4)] });
    expect(h.syncDraft).not.toHaveBeenCalled();
  });

  it('runs at most 5 listings at once', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ listingId: String(i + 1), media: [del(i + 1)] }));
    const r = await post({ shopId: '555', items });
    expect(r.statusCode).toBe(200);
    expect(r.body.results).toHaveLength(50);
    expect(h.maxInFlight).toBeLessThanOrEqual(5);
    expect(h.maxInFlight).toBeGreaterThan(1);
  });
});
