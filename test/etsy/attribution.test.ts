import { describe, it, expect, vi, beforeEach } from 'vitest';

const { attemptFindMany, findOwnStockWrite } = vi.hoisted(() => ({ attemptFindMany: vi.fn(), findOwnStockWrite: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { etsyDraftSyncAttempt: { findMany: attemptFindMany } } }));
vi.mock('@/lib/stock/hooks', () => ({ findOwnStockWrite }));

import { attemptExplains, attributeChange, decideAttribution } from '@/lib/etsy/attribution';

const T = 1_760_000_000; // seconds
const at = (s: number) => new Date(s * 1000);

describe('attemptExplains', () => {
  it('matches the recorded post-sync remote timestamp exactly', () => {
    expect(attemptExplains({ id: 'a', draftId: 'd', status: 'success', startedAt: at(T - 3600), finishedAt: at(T - 3500), remoteUpdatedTimestamp: T }, T)).toBe(true);
  });
  it('matches a timestamp inside [startedAt-10s, finishedAt+10s]', () => {
    const a = { id: 'a', draftId: 'd', status: 'success', startedAt: at(T - 30), finishedAt: at(T - 5), remoteUpdatedTimestamp: null };
    expect(attemptExplains(a, T)).toBe(true);
    expect(attemptExplains(a, T + 20)).toBe(false);
    expect(attemptExplains(a, T - 45)).toBe(false);
  });
  it('treats a recent running attempt as open-ended', () => {
    const now = (T + 60) * 1000;
    expect(attemptExplains({ id: 'a', draftId: 'd', status: 'running', startedAt: at(T - 5), finishedAt: null, remoteUpdatedTimestamp: null }, T + 30, now)).toBe(true);
  });
});

describe('decideAttribution', () => {
  it('orders draft > attempt > stock > reconcile/initial > external', () => {
    expect(decideAttribution({ draftId: 'd', source: 'webhook' }).attribution).toBe('kolayxport_draft');
    expect(decideAttribution({ matchedAttempt: { id: 'a', draftId: 'd' }, stockPushId: 'p', source: 'webhook' }).attribution).toBe('kolayxport_draft');
    expect(decideAttribution({ stockPushId: 'p', source: 'webhook' }).attribution).toBe('kolayxport_stock');
    expect(decideAttribution({ source: 'reconcile' }).attribution).toBe('unknown');
    expect(decideAttribution({ source: 'initial' }).attribution).toBe('unknown');
    expect(decideAttribution({ source: 'webhook' }).attribution).toBe('external');
  });
});

describe('attributeChange', () => {
  beforeEach(() => {
    attemptFindMany.mockReset();
    findOwnStockWrite.mockReset();
  });

  it('attributes a late/retried webhook to our draft sync by Etsy timestamp (never emittedAt)', async () => {
    attemptFindMany.mockResolvedValue([
      { id: 'att1', draftId: 'dr1', status: 'success', startedAt: at(T - 20), finishedAt: at(T - 2), remoteUpdatedTimestamp: T },
    ]);
    const r = await attributeChange('shop', BigInt(5), T, { source: 'webhook' });
    expect(r).toEqual({ attribution: 'kolayxport_draft', draftId: 'dr1', syncAttemptId: 'att1' });
    expect(findOwnStockWrite).not.toHaveBeenCalled();
  });

  it('an Etsy-UI edit with no matching attempt or stock push is external', async () => {
    attemptFindMany.mockResolvedValue([
      { id: 'att1', draftId: 'dr1', status: 'success', startedAt: at(T - 4000), finishedAt: at(T - 3990), remoteUpdatedTimestamp: T - 3995 },
    ]);
    findOwnStockWrite.mockResolvedValue(null);
    expect((await attributeChange('shop', BigInt(5), T, { source: 'webhook' })).attribution).toBe('external');
  });

  it('uses the stock push when it explains the timestamp', async () => {
    attemptFindMany.mockResolvedValue([]);
    findOwnStockWrite.mockResolvedValue({ pushId: 'push1' });
    expect(await attributeChange('shop', BigInt(5), T, { source: 'webhook' })).toEqual({ attribution: 'kolayxport_stock', stockPushId: 'push1' });
  });

  it('a draftId from the caller short-circuits lookups', async () => {
    const r = await attributeChange('shop', BigInt(5), T, { source: 'draft_sync', draftId: 'd9', syncAttemptId: 'a9' });
    expect(r.attribution).toBe('kolayxport_draft');
    expect(attemptFindMany).not.toHaveBeenCalled();
  });
});
