import { describe, expect, it } from 'vitest';
import { BACKOFF_MS, backoffFor, mergeEventTypes, planClaims, type ClaimCandidate } from '@/lib/etsy/webhooks/worker';
import { etsyEventPriority, parseResourceKey, resourceKeyFor } from '@/lib/etsy/webhooks/events';
import { shouldAlertBacklog } from '@/lib/scheduler/coreJobs';

const t0 = Date.UTC(2026, 9, 15, 10, 0, 0);
const c = (id: string, shopId: string, resourceKey: string | null, priority: number, offsetMs: number): ClaimCandidate => ({
  id, shopId, resourceKey, priority, createdAt: new Date(t0 + offsetMs),
});

describe('planClaims', () => {
  it('a 5000-event backlog of shop A does not delay shop B (B is in the first round)', () => {
    const rows: ClaimCandidate[] = [];
    for (let i = 0; i < 5000; i++) rows.push(c(`a${i}`, 'A', `listing:${i}`, 2, i));
    rows.push(c('b0', 'B', 'receipt:9', 0, 999_999));
    const plan = planClaims(rows, { maxTotal: 60, perShopCap: 2 });
    expect(plan[0].id).toBe('b0'); // most urgent of round 1
    expect(plan.filter((p) => p.shopId === 'A')).toHaveLength(2);
  });

  it('keeps one candidate per (shop, resource): the most urgent row', () => {
    const plan = planClaims([
      c('1', 'A', 'listing:1', 2, 0),
      c('2', 'A', 'listing:1', 1, 10),
      c('3', 'B', 'listing:1', 2, 5),
    ], { maxTotal: 10 });
    expect(plan.map((p) => p.id).sort()).toEqual(['2', '3']);
  });

  it('rows without a resource key are never merged', () => {
    const plan = planClaims([c('1', 'A', null, 2, 0), c('2', 'A', null, 2, 1)], { maxTotal: 10 });
    expect(plan).toHaveLength(2);
  });

  it('round-robins across shops and orders each round by urgency', () => {
    const plan = planClaims([
      c('a1', 'A', 'listing:1', 2, 0),
      c('a2', 'A', 'listing:2', 2, 1),
      c('a3', 'A', 'listing:3', 2, 2),
      c('b1', 'B', 'receipt:1', 0, 50),
      c('c1', 'C', 'listing:9', 1, 40),
    ], { maxTotal: 10 });
    expect(plan.map((p) => p.id)).toEqual(['b1', 'c1', 'a1', 'a2', 'a3']);
  });

  it('respects the per-shop cap including events already running', () => {
    const rows = [c('a1', 'A', 'listing:1', 2, 0), c('a2', 'A', 'listing:2', 2, 1), c('b1', 'B', 'listing:1', 2, 2)];
    const plan = planClaims(rows, { maxTotal: 10, perShopCap: 2, runningPerShop: new Map([['A', 2]]) });
    expect(plan.map((p) => p.id)).toEqual(['b1']);
  });

  it('honours maxTotal', () => {
    const rows = Array.from({ length: 100 }, (_, i) => c(`x${i}`, `S${i}`, `listing:${i}`, 2, i));
    expect(planClaims(rows, { maxTotal: 60 })).toHaveLength(60);
  });
});

describe('coalescing helpers', () => {
  it('mergeEventTypes unions eventType and eventTypes of the winner and losers', () => {
    expect(mergeEventTypes([
      { eventType: 'order.shipped', eventTypes: ['order.shipped'] },
      { eventType: 'order.paid', eventTypes: [] },
      { eventType: null, eventTypes: ['inventory.out_of_stock'] },
    ])).toEqual(['inventory.out_of_stock', 'order.paid', 'order.shipped']);
  });

  it('backoff: 30s, 2m, 10m, 30m, 2h, then 6h', () => {
    expect(backoffFor(1)).toBe(30_000);
    expect(backoffFor(2)).toBe(120_000);
    expect(backoffFor(5)).toBe(2 * 60 * 60_000);
    expect(backoffFor(9)).toBe(6 * 60 * 60_000);
    expect(backoffFor(50)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
  });
});

describe('event vocabulary', () => {
  it('priorities: order 0, out_of_stock 1, else 2', () => {
    expect(etsyEventPriority('order.paid')).toBe(0);
    expect(etsyEventPriority('order.canceled')).toBe(0);
    expect(etsyEventPriority('reconcile.order')).toBe(0);
    expect(etsyEventPriority('inventory.out_of_stock')).toBe(1);
    expect(etsyEventPriority('listing.updated')).toBe(2);
    expect(etsyEventPriority('reconcile.changed')).toBe(2);
  });

  it('resource keys', () => {
    expect(resourceKeyFor('order.paid', { resource_url: 'https://x/shops/1/receipts/77' })).toBe('receipt:77');
    expect(resourceKeyFor('inventory.updated', { listing_id: 5 })).toBe('listing:5');
    expect(parseResourceKey('listing:123')).toEqual({ kind: 'listing', id: '123' });
    expect(parseResourceKey('weird')).toBeNull();
  });
});

describe('queue health alert', () => {
  it('fires on an old due event or recent failures', () => {
    expect(shouldAlertBacklog({ oldestDueAgeMs: 11 * 60_000, failed1h: 0 })).toBe(true);
    expect(shouldAlertBacklog({ oldestDueAgeMs: 60_000, failed1h: 1 })).toBe(true);
    expect(shouldAlertBacklog({ oldestDueAgeMs: null, failed1h: 0 })).toBe(false);
  });
});
