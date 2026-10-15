import { describe, it, expect } from 'vitest';
import { isToShipOrder, countToShip, TO_SHIP_SQL, STALE_OPEN_ORDER_DAYS } from '@/lib/orders/views';

const now = new Date('2026-10-15T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const open = { status: 'Awaiting Fulfillment', marketplace: 'Trendyol' };

describe('stale open orders are not "to ship"', () => {
  it('keeps a recent unlabeled open order in To ship', () => {
    expect(isToShipOrder({ ...open, uiOrderDate: daysAgo(3) }, now)).toBe(true);
  });
  it('drops an open order placed more than the stale window ago', () => {
    expect(isToShipOrder({ ...open, uiOrderDate: daysAgo(STALE_OPEN_ORDER_DAYS + 1) }, now)).toBe(false);
  });
  it('falls back to createdAt, and treats an undated order as recent', () => {
    expect(isToShipOrder({ ...open, createdAt: daysAgo(400) }, now)).toBe(false);
    expect(isToShipOrder({ ...open }, now)).toBe(true);
  });
  it('counts and SQL agree on the rule', () => {
    expect(countToShip([{ ...open, uiOrderDate: daysAgo(1) }, { ...open, uiOrderDate: daysAgo(440) }], now).toShip).toBe(1);
    expect(TO_SHIP_SQL).toContain(`INTERVAL '${STALE_OPEN_ORDER_DAYS} days'`);
  });
});
