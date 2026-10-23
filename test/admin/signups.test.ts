import { describe, expect, it } from 'vitest';
import { funnel, isHiddenAccount, signupsToCsv, sourceOf } from '@/lib/admin/signups';

describe('funnel', () => {
  it('counts and rates', () => {
    const f = funnel([
      { stores: ['etsy'], firstOrderAt: '2026-10-22T10:00:00Z', activated: true },
      { stores: ['trendyol'], firstOrderAt: null, activated: true },
      { stores: [], firstOrderAt: null, activated: false },
      { stores: [], firstOrderAt: null, activated: false },
    ]);
    expect(f).toEqual({ signups: 4, connected: 2, withOrder: 1, activated: 2, connectRate: 0.5, orderRate: 0.25 });
  });
  it('no signups → zero rates, no NaN', () => expect(funnel([])).toMatchObject({ connectRate: 0, orderRate: 0 }));
});

describe('sourceOf', () => {
  it('partner code beats ref code beats utm', () => {
    expect(sourceOf({ partner: { code: 'AHMETKONAK' }, refCode: 'X', utmSource: 'fb' })).toBe('AHMETKONAK');
    expect(sourceOf({ partner: null, refCode: 'GRUP1', utmSource: 'fb' })).toBe('GRUP1');
    expect(sourceOf({ partner: null, refCode: null, utmSource: 'instagram' })).toBe('instagram');
    expect(sourceOf(null)).toBe('direct');
  });
});

describe('isHiddenAccount', () => {
  it('hides admins, reviewers and test addresses only', () => {
    expect(isHiddenAccount({ email: 'seller@gmail.com', role: 'user' })).toBe(false);
    expect(isHiddenAccount({ email: 'x@y.com', role: 'admin' })).toBe(true);
    expect(isHiddenAccount({ email: 'review@kolayxport.com', role: 'user' })).toBe(true);
    expect(isHiddenAccount({ email: 'demo@kolayxport.test', role: 'user' })).toBe(true);
  });
});

describe('signupsToCsv', () => {
  it('escapes commas and quotes', () => {
    const csv = signupsToCsv({ days: 1, totals: funnel([]), byDay: [], bySource: [], rows: [{ createdAt: '2026-10-22T10:00:00.000Z', name: 'Ayşe, "Demo"', email: 'a@b.com', source: 'direct', via: null, stores: ['etsy', 'ebay'], firstOrderAt: null, activated: true, plan: 'trial', status: 'trialing', shopify: false, remindersSent: ['day1'] }] });
    expect(csv.split('\n')[1]).toContain('"Ayşe, ""Demo"""');
    expect(csv.split('\n')[1]).toContain('etsy ebay');
  });
});
