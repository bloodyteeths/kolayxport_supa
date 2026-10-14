import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn() }));

import {
  classifyExperiment,
  cohortKeyFor,
  experimentWindows,
  findConfounded,
  isSeasonal,
  isoWeekStart,
  poissonDid,
} from '@/lib/etsy/seoExperiments';
import { draftBatchKey } from '@/lib/etsy/listingHistory';

describe('cohorts', () => {
  it('a bulk sync of 50 listings within one 15-min bucket maps to ONE cohort', () => {
    const t0 = new Date('2026-10-15T10:01:00Z');
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const at = new Date(t0.getTime() + i * 10_000); // 50 listings over ~8 minutes
      keys.add(cohortKeyFor({ batchKey: draftBatchKey('shop1', at), shopId: 'shop1', listingId: BigInt(1000 + i), changedAt: at }));
    }
    expect(keys.size).toBe(1);
  });

  it('external edits get one cohort per listing (per hour)', () => {
    const at = new Date('2026-10-15T10:01:00Z');
    const a = cohortKeyFor({ batchKey: null, shopId: 's', listingId: '1', changedAt: at });
    const b = cohortKeyFor({ batchKey: null, shopId: 's', listingId: '2', changedAt: at });
    const a2 = cohortKeyFor({ batchKey: null, shopId: 's', listingId: '1', changedAt: new Date('2026-10-15T10:40:00Z') });
    expect(a).not.toBe(b);
    expect(a).toBe(a2);
  });

  it('windows: before = [t-14d, t), after = [t+1d, t+15d)', () => {
    const w = experimentWindows(new Date('2026-03-15T13:00:00Z'));
    expect(w.beforeStart.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(w.beforeEnd.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(w.afterStart.toISOString()).toBe('2026-03-16T00:00:00.000Z');
    expect(w.afterEnd.toISOString()).toBe('2026-03-30T00:00:00.000Z');
  });

  it('seasonal when any window day touches Nov 15 – Jan 5', () => {
    expect(isSeasonal(new Date('2026-11-05T00:00:00Z'))).toBe(true); // after-window reaches Nov 20
    expect(isSeasonal(new Date('2026-01-15T00:00:00Z'))).toBe(true); // before-window reaches Jan 1
    expect(isSeasonal(new Date('2026-06-15T00:00:00Z'))).toBe(false);
  });

  it('isoWeekStart is the Monday', () => {
    expect(isoWeekStart(new Date('2026-10-15T12:00:00Z')).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('poissonDid (difference-in-differences)', () => {
  it('fixture: treated doubles while control is flat -> ~+100% lift, high confidence', () => {
    const r = poissonDid({ tb: 400, ta: 800, cb: 5000, ca: 5000 });
    expect(r.lift).toBeCloseTo(1.0, 5);
    expect(r.z!).toBeGreaterThan(2.58);
    expect(r.confidence).toBe('high');
  });

  it('control-adjusted: both doubled -> no lift, low confidence', () => {
    const r = poissonDid({ tb: 400, ta: 800, cb: 5000, ca: 10000 });
    expect(r.lift).toBeCloseTo(0, 5);
    expect(r.confidence).toBe('low');
  });

  it('medium band', () => {
    const r = poissonDid({ tb: 100, ta: 130, cb: 10000, ca: 10000 });
    expect(Math.abs(r.z!)).toBeGreaterThanOrEqual(1.96);
    expect(Math.abs(r.z!)).toBeLessThan(2.58);
    expect(r.confidence).toBe('medium');
  });

  it('no control caps confidence at low', () => {
    expect(poissonDid({ tb: 400, ta: 2000 }).confidence).toBe('low');
  });

  it('zero counts are continuity-corrected (no Infinity)', () => {
    const r = poissonDid({ tb: 0, ta: 10, cb: 100, ca: 100 });
    expect(Number.isFinite(r.lift!)).toBe(true);
  });
});

describe('classifyExperiment', () => {
  const treated = { viewsBefore: 400, viewsAfter: 800, ordersBefore: 4, ordersAfter: 9, viewsKnown: true, listings: 3 };
  const control = { viewsBefore: 5000, viewsAfter: 5000, ordersBefore: 40, ordersAfter: 41, viewsKnown: true, listings: 30 };

  it('ready + improved with a shop control', () => {
    const c = classifyExperiment({ treated, control, controlType: 'shop', confounded: false });
    expect(c.status).toBe('ready');
    expect(c.verdict).toBe('improved');
    expect(c.confidence).toBe('high');
  });

  it('insufficient_data under 30 before-views', () => {
    expect(classifyExperiment({ treated: { ...treated, viewsBefore: 12 }, control, controlType: 'shop', confounded: false }).status).toBe('insufficient_data');
  });

  it('insufficient_data without views and < 5 orders', () => {
    const t = { viewsBefore: 0, viewsAfter: 0, ordersBefore: 1, ordersAfter: 2, viewsKnown: false, listings: 1 };
    expect(classifyExperiment({ treated: t, control: null, controlType: 'none', confounded: false }).status).toBe('insufficient_data');
  });

  it('controlType none -> verdict inconclusive (confidence low)', () => {
    const c = classifyExperiment({ treated, control: null, controlType: 'none', confounded: false });
    expect(c.confidence).toBe('low');
    expect(c.verdict).toBe('inconclusive');
  });

  it('confounded wins', () => {
    expect(classifyExperiment({ treated, control, controlType: 'shop', confounded: true }).status).toBe('confounded');
  });
});

describe('findConfounded', () => {
  it('flags overlapping cohorts on the same listing only', () => {
    const base = new Date('2026-05-01T00:00:00Z');
    const set = findConfounded([
      { id: 'a', listingIds: [BigInt(1), BigInt(2)], changedAt: base, windowDays: 14 },
      { id: 'b', listingIds: [BigInt(2)], changedAt: new Date('2026-05-08T00:00:00Z'), windowDays: 14 },
      { id: 'c', listingIds: [BigInt(3)], changedAt: new Date('2026-05-08T00:00:00Z'), windowDays: 14 },
      { id: 'd', listingIds: [BigInt(1)], changedAt: new Date('2026-08-01T00:00:00Z'), windowDays: 14 },
    ]);
    expect(Array.from(set).sort()).toEqual(['a', 'b']);
  });
});
