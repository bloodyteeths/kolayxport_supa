import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EtsyDeferError } from '@/lib/etsy/webhooks/types';

// ---------------------------------------------------------------------------
// Prisma mock: one candidate per pass, claim transaction scripted per test.
// ---------------------------------------------------------------------------
let candidates: any[] = [];
let wonRow: any = null;
let loserRows: any[] = [];
const updates: any[] = [];
const txSql: string[] = [];
const shop = vi.fn(async (_a?: any) => ({ userId: 'u1', isActive: true, needsReauth: false, needsReauthAt: null, tokenExpiresAt: new Date(Date.now() + 3_600_000) }) as any);

vi.mock('@/lib/prisma', () => ({
  default: {
    $executeRaw: async () => 0,
    $queryRaw: async () => {
      const c = candidates;
      candidates = [];
      return c;
    },
    $transaction: async (fn: any) => {
      let q = 0;
      const tx = {
        $executeRaw: async (strings: TemplateStringsArray) => { txSql.push(strings.join('?')); return 1; },
        $queryRaw: async (strings: TemplateStringsArray) => {
          txSql.push(strings.join('?'));
          q++;
          if (q === 1) return wonRow ? [wonRow] : [];
          return loserRows;
        },
      };
      return fn(tx);
    },
    etsyShop: { findUnique: (a: any) => shop(a) },
    webhookEvent: {
      update: async (a: any) => { updates.push(a); return {}; },
      updateMany: async () => ({ count: 1 }),
      count: async () => 1,
    },
  },
}));
vi.mock('@/lib/admin/events', () => ({ logIntegrationEvent: () => undefined }));
const notifyAdmins = vi.fn(async (_a?: any) => undefined);
vi.mock('@/lib/notifications', () => ({ notifyAdmins: (a: any) => notifyAdmins(a) }));

const handleEtsyOrderEvent = vi.fn(async (_ctx: any): Promise<any> => ({ outcome: 'done', note: 'note:order_created' }));
vi.mock('@/lib/orders/etsyLifecycle', () => ({ handleEtsyOrderEvent: (ctx: any) => handleEtsyOrderEvent(ctx) }));
const handleEtsyListingEvent = vi.fn(async (_ctx: any): Promise<any> => ({ outcome: 'ignored', note: 'stub:listing_handler_not_wired' }));
vi.mock('@/lib/etsy/listingCache', () => ({ handleEtsyListingEvent: (ctx: any) => handleEtsyListingEvent(ctx) }));
const legacyHandleListingEvent = vi.fn(async (_ctx: any): Promise<any> => ({ outcome: 'done', note: 'legacy' }));
vi.mock('@/lib/etsy/webhooks/legacyListingHandler', () => ({ legacyHandleListingEvent: (ctx: any) => legacyHandleListingEvent(ctx) }));

import { runEtsyWorkerPass } from '@/lib/etsy/webhooks/worker';
import { currentEtsyPriority, EtsyPriority, getEtsyBudgetContext } from '@/lib/etsy/rateBudget';

const now = new Date('2026-10-15T10:00:00Z');
function setup(row: Partial<any>, losers: any[] = []) {
  const full = {
    id: 'etsy:1',
    eventType: 'order.paid',
    eventTypes: ['order.paid'],
    shopId: 'S1',
    resourceKey: 'receipt:77',
    payload: { receipt_id: 77 },
    attempts: 1,
    deferrals: 0,
    createdAt: now,
    firstReceivedAt: now,
    priority: 0,
    ...row,
  };
  candidates = [{ id: full.id, shopId: full.shopId, resourceKey: full.resourceKey, priority: full.priority, createdAt: full.createdAt }];
  wonRow = full;
  loserRows = losers;
}

beforeEach(async () => {
  // Let completion kicks from the previous test (50 ms debounce) run against an empty queue.
  await new Promise((resolve) => setTimeout(resolve, 120));
  candidates = [];
  updates.length = 0;
  txSql.length = 0;
  handleEtsyOrderEvent.mockClear();
  handleEtsyListingEvent.mockClear();
  legacyHandleListingEvent.mockClear();
  notifyAdmins.mockClear();
});

describe('worker pass', () => {
  it('coalesced paid+shipped -> exactly one order handler call with both types, at Critical priority', async () => {
    setup({}, [{ eventType: 'order.shipped', eventTypes: ['order.shipped'], createdAt: new Date(now.getTime() + 5000), firstReceivedAt: null, priority: 0 }]);
    let seenPriority: number | null = null;
    let deferMode: boolean | undefined;
    handleEtsyOrderEvent.mockImplementationOnce(async () => {
      seenPriority = currentEtsyPriority();
      deferMode = getEtsyBudgetContext()?.deferOn429;
      return { outcome: 'done', note: 'ok' };
    });
    const r = await runEtsyWorkerPass({ wait: true });
    expect(r.claimed).toBe(1);
    expect(r.coalesced).toBe(1);
    expect(handleEtsyOrderEvent).toHaveBeenCalledTimes(1);
    const ctx = handleEtsyOrderEvent.mock.calls[0][0];
    expect(Array.from(ctx.eventTypes).sort()).toEqual(['order.paid', 'order.shipped']);
    expect(ctx.receiptId).toBe('77');
    expect(seenPriority).toBe(EtsyPriority.Critical);
    expect(deferMode).toBe(true);
    // the union is persisted on the winner inside the claim transaction
    expect(txSql.some((s) => /"eventTypes" = \?::text\[\]/.test(s))).toBe(true);
    expect(txSql.some((s) => /NOT EXISTS/.test(s) && /'processing'/.test(s))).toBe(true);
    expect(updates.at(-1).data).toMatchObject({ status: 'done', note: 'ok' });
  });

  it('a defer re-queues without consuming the attempt', async () => {
    setup({ attempts: 3 });
    handleEtsyOrderEvent.mockRejectedValueOnce(new EtsyDeferError('rate_limited', 42_000));
    const r = await runEtsyWorkerPass({ wait: true });
    expect(r.outcomes).toEqual({ deferred: 1 });
    const d = updates.at(-1).data;
    expect(d).toMatchObject({ status: 'received', attempts: { decrement: 1 }, deferrals: { increment: 1 }, note: 'deferred:rate_limited' });
    expect(d.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(40_000);
  });

  it('other errors back off, and fail terminally after 10 attempts (admins notified)', async () => {
    setup({ attempts: 2 });
    handleEtsyOrderEvent.mockRejectedValueOnce(new Error('boom'));
    await runEtsyWorkerPass({ wait: true });
    expect(updates.at(-1).data).toMatchObject({ status: 'received', errorMessage: 'boom' });

    setup({ attempts: 10 });
    handleEtsyOrderEvent.mockRejectedValueOnce(new Error('still boom'));
    const r = await runEtsyWorkerPass({ wait: true });
    expect(r.outcomes).toEqual({ failed: 1 });
    expect(updates.at(-1).data).toMatchObject({ status: 'failed', errorMessage: 'still boom' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(notifyAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'webhookBacklog', onlyIfNew: true }));
  });

  it('a shop that needs reauth parks the event (blocked_reauth) without consuming an attempt', async () => {
    setup({});
    shop.mockResolvedValueOnce({ userId: 'u1', isActive: true, needsReauth: true, needsReauthAt: new Date(), tokenExpiresAt: new Date(Date.now() - 1000) });
    const r = await runEtsyWorkerPass({ wait: true });
    expect(r.outcomes).toEqual({ blocked: 1 });
    expect(updates.at(-1).data).toMatchObject({ status: 'blocked_reauth', attempts: { decrement: 1 }, nextAttemptAt: null });
    expect(handleEtsyOrderEvent).not.toHaveBeenCalled();
  });

  it('ETSY_REAUTH_REQUIRED from a handler parks the event too', async () => {
    setup({});
    handleEtsyOrderEvent.mockRejectedValueOnce(Object.assign(new Error('reauth'), { code: 'ETSY_REAUTH_REQUIRED' }));
    const r = await runEtsyWorkerPass({ wait: true });
    expect(r.outcomes).toEqual({ blocked: 1 });
  });

  it('unknown/inactive shop -> ignored', async () => {
    setup({});
    shop.mockResolvedValueOnce(null);
    const r = await runEtsyWorkerPass({ wait: true });
    expect(r.outcomes).toEqual({ ignored: 1 });
  });

  it('listing events go to W3; while W3 is a stub the legacy handler keeps today\'s behaviour', async () => {
    setup({ id: 'etsy:2', eventType: 'listing.updated', eventTypes: ['listing.updated'], resourceKey: 'listing:55', payload: { listing_id: 55 }, priority: 2 });
    const r = await runEtsyWorkerPass({ wait: true });
    expect(r.outcomes).toEqual({ done: 1 });
    expect(handleEtsyListingEvent).toHaveBeenCalledTimes(1);
    expect(handleEtsyListingEvent.mock.calls[0][0].listingId).toBe(BigInt(55));
    expect(legacyHandleListingEvent).toHaveBeenCalledTimes(1);
  });

  it('a real W3 outcome is used as-is', async () => {
    setup({ id: 'etsy:3', eventType: 'inventory.updated', eventTypes: ['inventory.updated'], resourceKey: 'listing:56', payload: {}, priority: 2 });
    handleEtsyListingEvent.mockResolvedValueOnce({ outcome: 'done', note: 'refreshed' });
    await runEtsyWorkerPass({ wait: true });
    expect(legacyHandleListingEvent).not.toHaveBeenCalled();
    expect(updates.at(-1).data).toMatchObject({ status: 'done', note: 'refreshed' });
  });

  it('a claim lost to another worker starts nothing', async () => {
    setup({});
    wonRow = null;
    const r = await runEtsyWorkerPass({ wait: true });
    expect(r.claimed).toBe(0);
    expect(handleEtsyOrderEvent).not.toHaveBeenCalled();
  });
});
