import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolveByPrefix: vi.fn(), NOTIFICATION_LINKS: { labels: '/app/labels' } }));

import {
  aggregateDispatchHealth,
  buildDispatchRollups,
  computeDispatchState,
  dispatchStage,
  isShippedLate,
  localDateKey,
  localHour,
  percentile,
  rollupAction,
} from '@/lib/orders/dispatch';

const TZ = 'Europe/Istanbul'; // UTC+3, no DST

describe('timezone helpers', () => {
  it('local date / hour follow the seller timezone', () => {
    const d = new Date('2026-10-15T22:30:00Z'); // 01:30 on the 16th in Istanbul
    expect(localDateKey(d, TZ)).toBe('2026-10-16');
    expect(localDateKey(d, 'UTC')).toBe('2026-10-15');
    expect(localHour(d, TZ)).toBe(1);
  });

  it('dispatchStage: overdue / due_today / due_tomorrow by local day', () => {
    const now = new Date('2026-10-15T07:00:00Z'); // 10:00 local
    expect(dispatchStage(new Date('2026-10-14T20:00:00Z'), now, TZ)).toBe('overdue'); // 23:00 on the 14th local
    expect(dispatchStage(new Date('2026-10-14T21:30:00Z'), now, TZ)).toBe('due_today'); // 00:30 on the 15th local
    expect(dispatchStage(new Date('2026-10-16T12:00:00Z'), now, TZ)).toBe('due_tomorrow');
    expect(dispatchStage(new Date('2026-10-18T12:00:00Z'), now, TZ)).toBeNull();
  });

  it('isShippedLate compares local days', () => {
    expect(isShippedLate(new Date('2026-10-15T20:00:00Z'), new Date('2026-10-15T09:00:00Z'), TZ)).toBe(false); // 23:00 same day
    expect(isShippedLate(new Date('2026-10-15T21:30:00Z'), new Date('2026-10-15T09:00:00Z'), TZ)).toBe(true); // 00:30 next day
  });
});

describe('computeDispatchState', () => {
  it('three states', () => {
    expect(computeDispatchState({ rawData: { shipments: [] }, hasActiveShipment: false })).toBe('no_label');
    expect(computeDispatchState({ rawData: { shipments: [] }, hasActiveShipment: true })).toBe('label_not_pushed');
    expect(computeDispatchState({ rawData: {}, trackingNumber: '1Z', hasActiveShipment: false })).toBe('label_not_pushed');
    expect(computeDispatchState({ rawData: {}, hasActiveShipment: false, hasLegacyLabel: true })).toBe('label_not_pushed');
    expect(computeDispatchState({ rawData: { shipments: [{ tracking_code: '1Z' }] }, hasActiveShipment: false })).toBe('shipped_on_etsy');
  });
});

describe('rollups', () => {
  const now = new Date('2026-10-15T07:00:00Z');
  const orders = [
    { orderNumber: '1', shipByAt: new Date('2026-10-13T12:00:00Z'), state: 'no_label' as const },
    { orderNumber: '2', shipByAt: new Date('2026-10-14T12:00:00Z'), state: 'label_not_pushed' as const },
    { orderNumber: '3', shipByAt: new Date('2026-10-15T12:00:00Z'), state: 'no_label' as const },
    { orderNumber: '4', shipByAt: new Date('2026-10-16T12:00:00Z'), state: 'no_label' as const },
    { orderNumber: '5', shipByAt: new Date('2026-10-13T12:00:00Z'), state: 'shipped_on_etsy' as const },
  ];

  it('one rollup per stage for the local day, shipped orders excluded', () => {
    const r = buildDispatchRollups(orders, now, TZ);
    expect(r.map((x) => x.stage)).toEqual(['overdue', 'due_today', 'due_tomorrow']);
    const overdue = r[0];
    expect(overdue).toMatchObject({ count: 2, labelNotPushed: 1, localDate: '2026-10-15', orderNumbers: '1, 2' });
  });

  it('orderNumbers lists at most 5', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ orderNumber: String(i), shipByAt: new Date('2026-10-10T12:00:00Z'), state: 'no_label' as const }));
    expect(buildDispatchRollups(many, now, TZ)[0].orderNumbers.split(', ')).toHaveLength(5);
  });

  it('due_tomorrow digest waits until 09:00 local; overdue re-raises only when the count rises', () => {
    const tomorrow = { stage: 'due_tomorrow' as const, localDate: 'd', count: 2, labelNotPushed: 0, orderNumbers: '' };
    expect(rollupAction(tomorrow, null, 8)).toBe('skip');
    expect(rollupAction(tomorrow, null, 9)).toBe('raise');
    expect(rollupAction(tomorrow, { count: 2, resolved: false }, 15)).toBe('refresh');

    const overdue = { stage: 'overdue' as const, localDate: 'd', count: 3, labelNotPushed: 0, orderNumbers: '' };
    expect(rollupAction(overdue, { count: 3, resolved: false }, 12)).toBe('refresh');
    expect(rollupAction(overdue, { count: 4, resolved: false }, 12)).toBe('refresh');
    expect(rollupAction({ ...overdue, count: 5 }, { count: 4, resolved: false }, 12)).toBe('raise');
    expect(rollupAction(overdue, { count: 3, resolved: true }, 12)).toBe('raise');

    const today = { stage: 'due_today' as const, localDate: 'd', count: 1, labelNotPushed: 0, orderNumbers: '' };
    expect(rollupAction(today, null, 7)).toBe('raise');
    expect(rollupAction({ ...today, count: 4 }, { count: 1, resolved: false }, 7)).toBe('refresh'); // due_today raises once
  });
});

describe('dispatch health aggregation', () => {
  it('rates, late count, handling hours and carrier percentiles', () => {
    const rows = [
      { uiOrderDate: new Date('2026-10-01T09:00:00Z'), shipByAt: new Date('2026-10-03T09:00:00Z'), shippedAt: new Date('2026-10-02T09:00:00Z'), deliveredAt: new Date('2026-10-06T09:00:00Z'), trackingNumber: '1', carrier: 'UPS' },
      { uiOrderDate: new Date('2026-10-01T09:00:00Z'), shipByAt: new Date('2026-10-03T09:00:00Z'), shippedAt: new Date('2026-10-05T09:00:00Z'), deliveredAt: new Date('2026-10-07T09:00:00Z'), trackingNumber: '2', carrier: 'ups' },
      { uiOrderDate: new Date('2026-10-01T09:00:00Z'), shipByAt: new Date('2026-10-03T09:00:00Z'), shippedAt: new Date('2026-10-01T21:00:00Z'), deliveredAt: null, trackingNumber: null, carrier: null },
    ];
    const h = aggregateDispatchHealth(rows, TZ, 90, { no_label: 1, label_not_pushed: 2, shipped_on_etsy: 0 });
    expect(h.shippedCount).toBe(3);
    expect(h.lateCount).toBe(1);
    expect(h.onTimeRate).toBeCloseTo(2 / 3);
    expect(h.onTimeWithTrackingRate).toBeCloseTo(1 / 3);
    expect(h.avgHandlingHours).toBeCloseTo((24 + 96 + 12) / 3, 1);
    expect(h.deliveryDaysByCarrier).toEqual([{ carrier: 'UPS', p50: 2, p90: 4, n: 2 }]);
    expect(h.openByState.label_not_pushed).toBe(2);
  });

  it('percentile on sorted arrays', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 90)).toBe(4);
  });
});
