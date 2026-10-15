import { describe, it, expect } from 'vitest';
import { RAW_STATUSES_BY_KEY, CLOSED_ORDER_STATUSES, ORDER_STATUS_FILTER_KEYS, statusKeyWhereSql, statusKeysWhereSql, isOrderStatusFilterKey } from '@/lib/orders/views';
import { orderStatus } from '@/lib/ds/status/orders';

describe('status keys (A1)', () => {
  it('each raw list maps through lib/ds/status/orders to its key', () => {
    for (const [key, raws] of Object.entries(RAW_STATUSES_BY_KEY)) {
      for (const raw of raws) expect(orderStatus(raw), `${raw}`).toBe(key);
    }
  });

  it('closed lists = CLOSED_ORDER_STATUSES', () => {
    const closed = [...RAW_STATUSES_BY_KEY.cancelled, ...RAW_STATUSES_BY_KEY.refunded, ...RAW_STATUSES_BY_KEY.delivered, ...RAW_STATUSES_BY_KEY.shipped];
    expect(new Set(closed)).toEqual(new Set(CLOSED_ORDER_STATUSES));
  });

  it('every key yields a clause; OR-joined; unknown values are not keys', () => {
    for (const k of ORDER_STATUS_FILTER_KEYS) expect(statusKeyWhereSql(k).length).toBeGreaterThan(10);
    expect(statusKeysWhereSql([])).toBeNull();
    expect(statusKeysWhereSql(['shipped', 'cancelled'])).toMatch(/^\([^]* OR [^]*\)$/);
    expect(isOrderStatusFilterKey('onaylandi')).toBe(false);
    expect(isOrderStatusFilterKey('SHIPPED')).toBe(false);
    expect(isOrderStatusFilterKey('shipped')).toBe(true);
  });

  it('raw-status keys use the normalized status, not LOWER(o."status") IN params', () => {
    expect(statusKeyWhereSql('shipped')).toContain('TRANSLATE(LOWER(');
    expect(statusKeyWhereSql('shipped')).toContain("'kargolandi'");
  });
});
