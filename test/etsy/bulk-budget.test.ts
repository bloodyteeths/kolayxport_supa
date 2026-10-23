import { describe, expect, it } from 'vitest';
import { BULK_SHOP_DAILY_CAP, DAILY_GATES, EtsyPriority, evaluateDailyGate } from '@/lib/etsy/rateBudget';

const base = { usedFraction: 0.2, shopBackgroundCalls: 0, shopCap: 5000, calls: 3, nowMs: Date.UTC(2026, 9, 24, 12) };

describe('P4 Bulk daily gate', () => {
  it('bulk stops at 75% of the app quota (order syncs keep the rest)', () => {
    expect(DAILY_GATES[EtsyPriority.Bulk]).toBe(0.75);
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Bulk, usedFraction: 0.74 }).ok).toBe(true);
    const r = evaluateDailyGate({ ...base, priority: EtsyPriority.Bulk, usedFraction: 0.75 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('budget');
  });
  it('one shop cannot exceed its daily bulk cap', () => {
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Bulk, shopBulkCalls: BULK_SHOP_DAILY_CAP - 3 }).ok).toBe(true);
    const r = evaluateDailyGate({ ...base, priority: EtsyPriority.Bulk, shopBulkCalls: BULK_SHOP_DAILY_CAP - 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterMs).toBeGreaterThan(0); // next daily window
  });
  it('the bulk cap never limits interactive or critical calls', () => {
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Interactive, shopBulkCalls: BULK_SHOP_DAILY_CAP * 2 }).ok).toBe(true);
    expect(evaluateDailyGate({ ...base, priority: EtsyPriority.Critical, shopBulkCalls: BULK_SHOP_DAILY_CAP * 2, usedFraction: 0.9 }).ok).toBe(true);
  });
});
