// overview G6 test fixtures: a full OverviewSummary with everything at zero, plus helpers to fill sections.
import type { DraftBucket, OverviewSummary } from '@/lib/overview/types';

export const NOW = new Date('2026-10-15T07:42:00Z'); // 10:42 Europe/Istanbul

export function emptyBucket(over: Partial<DraftBucket> = {}): DraftBucket {
  return { draft: 0, failed: 0, conflict: 0, syncing: 0, firstConflict: null, firstFailed: null, ...over };
}

export function baseSummary(over: Partial<OverviewSummary> = {}): OverviewSummary {
  return {
    generatedAt: '2026-10-15T07:41:00Z',
    requestId: 'req_test_1',
    tz: 'Europe/Istanbul',
    currency: 'TRY',
    errors: [],
    ordersLastSyncedAt: '2026-10-15T07:34:00Z',
    toShip: { count: 0, overdue: 0, dueToday: 0, withoutShipBy: 0, oldestOrderedAt: null, firstOverdue: null },
    labels: { failed: 0, first: null },
    tracking: { notSent: 0, failed: 0, first: null },
    drafts: { etsy: emptyBucket(), ebay: emptyBucket() },
    usage: {
      plan: 'starter',
      status: 'active',
      hideBilling: false,
      trialEndsAt: null,
      resetsAt: null,
      orderSync: { used: 12, limit: 200 },
      label: { used: 3, limit: 100 },
      nearLimit: false,
      blocked: null,
    },
    kpis: {
      revenue7d: {
        value: 86400,
        previous: 76900,
        currency: 'TRY',
        approx: true,
        ratesAsOf: '2026-10-15T07:00:00Z',
        ratesStale: false,
        unconverted: [],
        perCurrency: [{ currency: 'TRY', value: 50000 }, { currency: 'USD', value: 1000 }],
      },
      orders7d: { value: 40, previous: 35 },
    },
    series: {
      days: Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(2 + i).padStart(2, '0')}`, orders: i % 3 })),
      previousTotal: 10,
    },
    topSellers: {
      items: [
        { key: 'BLANKET-1', name: 'Personalized Baby Blanket', image: null, units: 18, orders: 15, channel: 'etsy' },
        { key: 'wooden keepsake box', name: 'Wooden Keepsake Box', image: null, units: 11, orders: 9, channel: 'ebay' },
      ],
    },
    setup: { hasOrders: true, senderComplete: true, hasLabel: true },
    ...over,
  };
}

/** A summary with one item in every queue kind. */
export function busySummary(over: Partial<OverviewSummary> = {}): OverviewSummary {
  return baseSummary({
    toShip: {
      count: 12,
      overdue: 2,
      dueToday: 4,
      withoutShipBy: 0,
      oldestOrderedAt: '2026-10-10T08:00:00Z',
      firstOverdue: { id: 'ord_1', orderNumber: '114-0098', channel: 'amazon', itemName: 'Name Necklace', image: null, shipBy: '2026-10-14T08:00:00Z' },
    },
    labels: {
      failed: 2,
      first: { id: 'ord_2', orderNumber: '3891', channel: 'etsy', itemName: 'Baby Blanket', image: null, shipBy: null, error: 'FedEx: invalid postal code' },
    },
    tracking: { notSent: 3, failed: 0, first: { id: 'ord_3', orderNumber: '4001', channel: 'etsy', itemName: null, image: null, shipBy: null } },
    drafts: {
      etsy: emptyBucket({
        draft: 7,
        failed: 3,
        conflict: 1,
        firstConflict: { draftId: 'd1', listingId: '111', title: 'Wooden Keepsake Box', thumb: null, error: null },
        firstFailed: { draftId: 'd2', listingId: '222', title: 'Name Necklace Gold', thumb: null, error: 'Invalid taxonomy' },
      }),
      ebay: emptyBucket(),
    },
    listingHealth: { etsy: { needsWork: 18, scored: 120, worst: { listingId: '333', title: 'Old Listing', thumb: null, score: 22 } } },
    usage: {
      plan: 'starter',
      status: 'active',
      hideBilling: false,
      trialEndsAt: null,
      resetsAt: null,
      orderSync: { used: 12, limit: 200 },
      label: { used: 9, limit: 10 },
      nearLimit: true,
      blocked: null,
    },
    ...over,
  });
}
