import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './f-harness';
import { isAccountTimezone, parsePreferencesPatch } from '@/lib/settings/accountTimezone';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  userFind: vi.fn(),
  userUpsert: vi.fn(),
  shopCount: vi.fn(),
  notifFind: vi.fn(),
  notifUpsert: vi.fn(),
  invalidate: vi.fn(),
}));
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: (...a: any[]) => m.userFind(...a), upsert: (...a: any[]) => m.userUpsert(...a) },
  shopifyShop: { count: (...a: any[]) => m.shopCount(...a) },
  notificationSettings: { findUnique: (...a: any[]) => m.notifFind(...a), upsert: (...a: any[]) => m.notifUpsert(...a) },
  credential: { upsert: () => Promise.resolve({}) },
  shipperProfile: { upsert: () => Promise.resolve({}) },
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => m.auth(...a) }));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('../../../lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/prismaWithRetry', () => ({ withPrismaRetry: (op: () => Promise<unknown>) => op() }));
vi.mock('../../../lib/prismaWithRetry', () => ({ withPrismaRetry: (op: () => Promise<unknown>) => op() }));
vi.mock('@/lib/notificationCenter/preferences', () => ({ invalidateNotificationConfig: (...a: any[]) => m.invalidate(...a) }));

import handler from '@/pages/api/user/settings';

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.auth.mockResolvedValue({ id: 'u1', email: 'a@b.c' });
  m.userFind.mockResolvedValue({
    id: 'u1', subscriptionPlan: 'growth', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe',
    trialExpiresAt: null, usageResetAt: null, orderSyncCount: 0, labelCount: 0, shippingSettings: {}, integrationSettings: null, shipperProfile: null,
  });
  m.shopCount.mockResolvedValue(0);
  m.userUpsert.mockResolvedValue({});
  m.notifUpsert.mockResolvedValue({});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('parsePreferencesPatch / isAccountTimezone', () => {
  it('validates IANA zones', () => {
    expect(isAccountTimezone('Europe/Istanbul')).toBe(true);
    expect(isAccountTimezone('America/New_York')).toBe(true);
    expect(isAccountTimezone('UTC')).toBe(true);
    // Current IANA names Firefox/Safari list (absent from Node's ICU supportedValuesOf) and aliases
    // the notifications route accepts must round-trip through PATCH /api/user/settings too.
    for (const tz of ['Asia/Kolkata', 'Europe/Kyiv', 'Asia/Ho_Chi_Minh', 'America/Argentina/Buenos_Aires', 'US/Eastern', 'Asia/Calcutta']) {
      expect(isAccountTimezone(tz)).toBe(true);
    }
    expect(parsePreferencesPatch({ timezone: 'Asia/Kolkata' })).toEqual({ ok: true, patch: { timezone: 'Asia/Kolkata' } });
    expect(isAccountTimezone('Mars/Olympus')).toBe(false);
    expect(isAccountTimezone(3)).toBe(false);
  });
  it('maps body shapes', () => {
    expect(parsePreferencesPatch(undefined)).toEqual({ ok: true, patch: null });
    expect(parsePreferencesPatch({})).toEqual({ ok: true, patch: null });
    expect(parsePreferencesPatch({ timezone: null })).toEqual({ ok: true, patch: { timezone: 'Europe/Istanbul' } });
    expect(parsePreferencesPatch({ timezone: 'Europe/Berlin' })).toEqual({ ok: true, patch: { timezone: 'Europe/Berlin' } });
    expect(parsePreferencesPatch({ timezone: 'nope' })).toEqual({ ok: false, fields: ['preferences.timezone'] });
    expect(parsePreferencesPatch('x')).toEqual({ ok: false, fields: ['preferences'] });
  });
});

describe('/api/user/settings preferences (A6 on NotificationSettings.timezone)', () => {
  it('GET returns preferences.timezone from NotificationSettings', async () => {
    m.notifFind.mockResolvedValueOnce({ timezone: 'America/New_York' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.state.status).toBe(200);
    expect(res.state.body.preferences).toEqual({ timezone: 'America/New_York' });
    expect(res.state.body.subscription.billingProvider).toBe('stripe');
  });

  it('GET without a row → timezone null; read failure → no preferences key', async () => {
    m.notifFind.mockResolvedValueOnce(null);
    const r1 = makeRes(); await handler(makeReq(), r1);
    expect(r1.state.body.preferences).toEqual({ timezone: null });
    m.notifFind.mockRejectedValue(new Error('db'));
    const r2 = makeRes(); await handler(makeReq(), r2);
    expect(r2.state.status).toBe(200);
    expect(r2.state.body).not.toHaveProperty('preferences');
  });

  it('PATCH writes the timezone to NotificationSettings and invalidates the notification cache', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'PATCH', body: { preferences: { timezone: 'Europe/London' } } }), res);
    expect(res.state.status).toBe(200);
    expect(m.notifUpsert).toHaveBeenCalledWith({ where: { userId: 'u1' }, create: { userId: 'u1', timezone: 'Europe/London' }, update: { timezone: 'Europe/London' } });
    expect(m.invalidate).toHaveBeenCalledWith('u1');
  });

  it('PATCH timezone null resets to Europe/Istanbul', async () => {
    await handler(makeReq({ method: 'PATCH', body: { preferences: { timezone: null } } }), makeRes());
    expect(m.notifUpsert.mock.calls[0][0].update).toEqual({ timezone: 'Europe/Istanbul' });
  });

  it('PATCH with an invalid timezone → 400 before any write', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'PATCH', body: { preferences: { timezone: 'Not/AZone' }, shippingSettings: { a: 1 } } }), res);
    expect(res.state.status).toBe(400);
    expect(res.state.body).toEqual({ error: 'invalid_preferences', fields: ['preferences.timezone'] });
    expect(m.userUpsert).not.toHaveBeenCalled();
    expect(m.notifUpsert).not.toHaveBeenCalled();
  });

  it('PATCH without preferences leaves NotificationSettings untouched', async () => {
    await handler(makeReq({ method: 'PATCH', body: { shippingSettings: { a: 1 } } }), makeRes());
    expect(m.notifUpsert).not.toHaveBeenCalled();
    expect(m.invalidate).not.toHaveBeenCalled();
  });
});
