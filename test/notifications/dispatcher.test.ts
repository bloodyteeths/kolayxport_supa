import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, sendEmail } = vi.hoisted(() => ({
  prisma: {
    notificationDelivery: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    notification: { findMany: vi.fn() },
    notificationSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: prisma }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth/email', () => ({ sendEmail }));

import { decideDelivery, afterFailure, dispatchDueDeliveries, MAX_ATTEMPTS, RETRY_DELAYS_MS } from '@/lib/notificationCenter/dispatcher';
import { isDigestDue, lastDigestSlot, planDigest, runDigests } from '@/lib/notificationCenter/digest';
import { retentionCutoffs, retentionWhere } from '@/lib/notificationCenter/retention';
import { inQuietHours, quietHoursEnd, localParts } from '@/lib/notificationCenter/time';
import { __resetPreferenceCaches } from '@/lib/notificationCenter/preferences';
import { renderNotificationEmail, renderTitle, __setFragmentsForTest } from '@/lib/notificationCenter/render';
import enFrag from '@/messages/fragments/notificationCenter.en.json';
import trFrag from '@/messages/fragments/notificationCenter.tr.json';

// 2026-10-15 23:30 Istanbul (UTC+3) = 20:30Z ; 12:00 Istanbul = 09:00Z
const NIGHT = new Date('2026-10-15T20:30:00Z');
const NOON = new Date('2026-10-15T09:00:00Z');
const settings = { timezone: 'Europe/Istanbul', quietHoursStart: 23, quietHoursEnd: 8 };
// orderCanceled is in-app only by default (spec W5 T1): the fixture user opted in to its email.
const OPT_IN = [{ type: 'orderCanceled', inApp: true, email: true, telegram: false, emailMode: 'instant' }];

beforeEach(() => {
  vi.clearAllMocks();
  __resetPreferenceCaches();
  __setFragmentsForTest({ en: enFrag as any, tr: trFrag as any });
  prisma.notificationSettings.findUnique.mockResolvedValue(null);
  prisma.notificationPreference.findMany.mockResolvedValue(OPT_IN);
  prisma.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
  prisma.notificationDelivery.update.mockResolvedValue({});
  prisma.user.findUnique.mockResolvedValue({ email: 'seller@example.com' });
  sendEmail.mockResolvedValue({ sent: true });
});

describe('time helpers', () => {
  it('quiet window wraps midnight in the user timezone', () => {
    expect(inQuietHours(NIGHT, 'Europe/Istanbul', 23, 8)).toBe(true);
    expect(inQuietHours(NOON, 'Europe/Istanbul', 23, 8)).toBe(false);
    expect(inQuietHours(NIGHT, 'Europe/Istanbul', null, 8)).toBe(false);
    expect(inQuietHours(new Date('2026-10-16T04:59:00Z'), 'Europe/Istanbul', 23, 8)).toBe(true); // 07:59 local
    expect(inQuietHours(new Date('2026-10-16T05:00:00Z'), 'Europe/Istanbul', 23, 8)).toBe(false); // 08:00 local
  });

  it('quietHoursEnd = next 08:00 local', () => {
    const end = quietHoursEnd(NIGHT, 'Europe/Istanbul', 23, 8);
    expect(end.toISOString()).toBe('2026-10-16T05:00:00.000Z');
    expect(localParts(end, 'Europe/Istanbul').hour).toBe(8);
  });
});

describe('decideDelivery', () => {
  const base = {
    channel: 'email',
    severity: 'warning',
    resolvedAt: null,
    readAt: null,
    deliveryCreatedAt: new Date('2026-10-15T20:00:00Z'),
    prefs: { email: true, telegram: false },
    channelConfigured: true,
    settings,
  };

  it('quiet hours hold warnings but send errors', () => {
    const held = decideDelivery({ ...base, now: NIGHT });
    expect(held.action).toBe('hold');
    expect(held.action === 'hold' && held.until.toISOString()).toBe('2026-10-16T05:00:00.000Z');
    expect(decideDelivery({ ...base, severity: 'error', now: NIGHT })).toEqual({ action: 'send' });
    expect(decideDelivery({ ...base, now: NOON })).toEqual({ action: 'send' });
  });

  it('skips resolved, already-read, disabled and unconfigured deliveries', () => {
    expect(decideDelivery({ ...base, resolvedAt: new Date(), now: NOON })).toEqual({ action: 'skip', reason: 'resolved' });
    expect(decideDelivery({ ...base, readAt: new Date('2026-10-15T20:10:00Z'), now: NOON })).toEqual({ action: 'skip', reason: 'read' });
    expect(decideDelivery({ ...base, prefs: { email: false, telegram: false }, now: NOON })).toEqual({ action: 'skip', reason: 'disabled' });
    expect(decideDelivery({ ...base, channelConfigured: false, now: NOON })).toEqual({ action: 'skip', reason: 'not_configured' });
  });
});

describe('retries', () => {
  it('backs off 1m, 5m, 30m, 2h then fails', () => {
    const now = new Date('2026-10-15T09:00:00Z');
    expect(RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
    for (let a = 1; a < MAX_ATTEMPTS; a++) {
      const r = afterFailure(a, now);
      expect(r.status).toBe('pending');
      expect(r.nextAttemptAt.getTime() - now.getTime()).toBe(RETRY_DELAYS_MS[a - 1]);
    }
    expect(afterFailure(MAX_ATTEMPTS, now).status).toBe('failed');
    expect(afterFailure(1, now, true).status).toBe('skipped');
  });
});

function delivery(over: Record<string, unknown> = {}, n: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    channel: 'email',
    status: 'pending',
    attempts: 0,
    createdAt: new Date('2026-10-15T08:59:00Z'),
    notification: {
      id: 'n1',
      userId: 'u1',
      type: 'orderCanceled',
      severity: 'warning',
      titleKey: 'types.orderCanceled',
      params: { orderNumber: '#1001' },
      link: '/app/labels',
      readAt: null,
      resolvedAt: null,
      ...n,
    },
    ...over,
  };
}

describe('dispatchDueDeliveries', () => {
  it('claims, sends and marks sent', async () => {
    prisma.notificationDelivery.findMany.mockResolvedValue([delivery()]);
    const counts = await dispatchDueDeliveries({ now: NOON });
    expect(prisma.notificationDelivery.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'd1', status: 'pending' });
    expect(prisma.notificationDelivery.updateMany.mock.calls[0][0].data.status).toBe('sending');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('seller@example.com');
    expect(mail.subject).toContain('#1001');
    expect(mail.textBody).toContain('https://kolayxport.com/app/labels');
    expect(prisma.notificationDelivery.update.mock.calls[0][0].data).toMatchObject({ status: 'sent', attempts: 1 });
    expect(counts).toMatchObject({ claimed: 1, sent: 1 });
  });

  it('holds a warning during quiet hours and does not send', async () => {
    prisma.notificationDelivery.findMany.mockResolvedValue([delivery()]);
    await dispatchDueDeliveries({ now: NIGHT });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.update.mock.calls[0][0].data).toEqual({ status: 'held', nextAttemptAt: new Date('2026-10-16T05:00:00.000Z') });
  });

  it('a failed send is retried later; missing Postmark config is skipped', async () => {
    prisma.notificationDelivery.findMany.mockResolvedValue([delivery()]);
    sendEmail.mockResolvedValueOnce({ sent: false, reason: 'postmark_500' });
    await dispatchDueDeliveries({ now: NOON });
    expect(prisma.notificationDelivery.update.mock.calls[0][0].data).toMatchObject({ status: 'pending', attempts: 1, error: 'postmark_500' });

    vi.clearAllMocks();
    prisma.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ email: 'seller@example.com' });
    prisma.notificationSettings.findUnique.mockResolvedValue(null);
    prisma.notificationPreference.findMany.mockResolvedValue(OPT_IN);
    prisma.notificationDelivery.findMany.mockResolvedValue([delivery()]);
    sendEmail.mockResolvedValueOnce({ sent: false, reason: 'NEEDS_SMTP_CONFIG' });
    await dispatchDueDeliveries({ now: NOON });
    expect(prisma.notificationDelivery.update.mock.calls[0][0].data).toMatchObject({ status: 'skipped' });
  });

  it('skips an email the user has not opted into (orderCanceled default is in-app only)', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([]);
    prisma.notificationDelivery.findMany.mockResolvedValue([delivery()]);
    await dispatchDueDeliveries({ now: NOON });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.update.mock.calls[0][0].data).toEqual({ status: 'skipped', error: 'disabled' });
  });

  it('a quiet-hours pile-up for one notification sends only the newest raise', async () => {
    prisma.notificationDelivery.findMany.mockResolvedValue([
      delivery({ id: 'd1', status: 'held', raiseSeq: 0 }),
      delivery({ id: 'd2', status: 'held', raiseSeq: 1 }),
      delivery({ id: 'd3', status: 'held', raiseSeq: 2 }),
    ]);
    const counts = await dispatchDueDeliveries({ now: NOON });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const updates = prisma.notificationDelivery.update.mock.calls.map((c: any[]) => [c[0].where.id, c[0].data.status, c[0].data.error]);
    expect(updates).toEqual([
      ['d1', 'skipped', 'superseded'],
      ['d2', 'skipped', 'superseded'],
      ['d3', 'sent', null],
    ]);
    expect(counts).toMatchObject({ sent: 1, skipped: 2 });
  });

  it('skips rows another run already claimed', async () => {
    prisma.notificationDelivery.findMany.mockResolvedValue([delivery()]);
    prisma.notificationDelivery.updateMany.mockResolvedValueOnce({ count: 0 });
    const counts = await dispatchDueDeliveries({ now: NOON });
    expect(counts.claimed).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('digest', () => {
  it('isDigestDue: at/after digestHour, once per local day, not in quiet hours', () => {
    const s = { timezone: 'Europe/Istanbul', digestHour: 8, lastDigestAt: null, quietHoursStart: 23, quietHoursEnd: 8 };
    expect(isDigestDue(NOON, s)).toBe(true);
    expect(isDigestDue(new Date('2026-10-15T04:00:00Z'), s)).toBe(false); // 07:00 local
    expect(isDigestDue(NOON, { ...s, lastDigestAt: new Date('2026-10-15T05:10:00Z') })).toBe(false);
    expect(isDigestDue(NOON, { ...s, lastDigestAt: new Date('2026-10-14T05:10:00Z') })).toBe(true);
    expect(isDigestDue(NIGHT, s)).toBe(false);
  });

  it('isDigestDue: a digestHour inside quiet hours sends when the quiet window ends, once per day', () => {
    // digestHour 23 with quiet 23–08 used to be never due.
    const s = { timezone: 'Europe/Istanbul', digestHour: 23, lastDigestAt: null as Date | null, quietHoursStart: 23, quietHoursEnd: 8 };
    const morning = new Date('2026-10-16T05:00:00Z'); // 08:00 local
    expect(isDigestDue(NIGHT, { ...s, lastDigestAt: new Date('2026-10-14T05:00:00Z') })).toBe(false); // 23:30 quiet
    expect(isDigestDue(morning, { ...s, lastDigestAt: new Date('2026-10-15T05:00:00Z') })).toBe(true); // slot 15th 23:00 not served
    expect(isDigestDue(morning, { ...s, lastDigestAt: morning })).toBe(false);
    expect(isDigestDue(new Date('2026-10-16T15:00:00Z'), { ...s, lastDigestAt: morning })).toBe(false); // 18:00 same slot
    expect(isDigestDue(new Date('2026-10-17T05:00:00Z'), { ...s, lastDigestAt: morning })).toBe(true); // next morning
    expect(lastDigestSlot(NOON, 'Europe/Istanbul', 8)).toEqual(new Date('2026-10-15T05:00:00Z'));
    expect(lastDigestSlot(NOON, 'Europe/Istanbul', 23)).toEqual(new Date('2026-10-14T20:00:00Z'));
  });

  it('planDigest skips resolved / disabled / duplicate notifications', () => {
    const mk = (id: string, nid: string, type = 'listingExpired', resolvedAt: Date | null = null) => ({
      deliveryId: id,
      attempts: 0,
      notification: { id: nid, type, titleKey: `types.${type}`, params: { title: 'x' }, link: null, resolvedAt },
    });
    const plan = planDigest(
      [mk('d1', 'n1'), mk('d2', 'n2', 'listingExpired', new Date()), mk('d3', 'n3', 'seoExperimentReady'), mk('d4', 'n1')],
      (t) => t !== 'seoExperimentReady',
    );
    expect(plan.send.map((r) => r.deliveryId)).toEqual(['d1']);
    expect(plan.skip).toEqual([
      { id: 'd2', reason: 'resolved' },
      { id: 'd3', reason: 'disabled' },
      { id: 'd4', reason: 'duplicate' },
    ]);
  });

  it('runDigests sends ONE email per user with digest items + recent unread, then sets lastDigestAt', async () => {
    prisma.notification.findMany.mockResolvedValueOnce([{ userId: 'u1' }]);
    prisma.notificationDelivery.findMany
      .mockResolvedValueOnce([
        { id: 'd1', attempts: 0, notification: { id: 'n1', type: 'listingExpired', titleKey: 'types.listingExpired', params: { title: 'Box A' }, link: '/app/etsy-listings', resolvedAt: null } },
        { id: 'd2', attempts: 0, notification: { id: 'n2', type: 'dispatchDueTomorrow', titleKey: 'types.dispatchDueTomorrow', params: { count: 2 }, link: '/app/labels', resolvedAt: null } },
      ]);
    prisma.notification.findMany.mockResolvedValue([
      { id: 'n2', type: 'dispatchDueTomorrow', titleKey: 'types.dispatchDueTomorrow', params: { count: 2 }, link: '/app/labels' },
      { id: 'n3', type: 'orderNew', titleKey: 'types.orderNew', params: { orderNumber: '#77' }, link: '/app/labels' },
    ]);
    prisma.notificationSettings.findUnique.mockResolvedValue({ userId: 'u1', locale: 'en', timezone: 'Europe/Istanbul', preset: 'recommended', emailEnabled: true, quietHoursStart: 23, quietHoursEnd: 8, digestHour: 8, lastDigestAt: null });
    const counts = await runDigests({ now: NOON });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const body: string = sendEmail.mock.calls[0][0].textBody;
    expect(body).toContain('Box A');
    expect(body).toContain('2 orders must ship tomorrow');
    expect(body).toContain('New order #77');
    expect(body.match(/must ship tomorrow/g)?.length).toBe(1);
    expect(prisma.notificationDelivery.updateMany.mock.calls.at(-1)![0]).toMatchObject({ where: { id: { in: ['d1', 'd2'] } }, data: { status: 'sent' } });
    expect(prisma.notificationSettings.upsert.mock.calls[0][0].update).toEqual({ lastDigestAt: NOON });
    expect(counts.sent).toBe(1);
    expect(prisma.notification.findMany.mock.calls[0][0]).toMatchObject({
      where: { deliveries: { some: { status: 'digest', channel: 'email' } } },
      distinct: ['userId'],
    });
  });
});

describe('retention', () => {
  it('never ages out unresolved state-bearing rows (reauthRequired); resolved rows always qualify', () => {
    const c = retentionCutoffs(NOON);
    const w = retentionWhere(c);
    expect(w.OR[0]).toEqual({ createdAt: { lt: c.readOrResolvedBefore }, resolvedAt: { not: null } });
    for (const branch of w.OR.slice(1)) {
      expect(branch).toMatchObject({ resolvedAt: null, type: { notIn: ['reauthRequired'] } });
    }
    expect(w.OR[1]).toMatchObject({ createdAt: { lt: c.readOrResolvedBefore }, readAt: { not: null } });
    expect(w.OR[2]).toMatchObject({ createdAt: { lt: c.unreadBefore } });
  });
});

describe('render', () => {
  it('renders new types from the fragment and falls back on missing params', () => {
    expect(renderTitle({ type: 'orderNew', titleKey: 'types.orderNew', params: { orderNumber: '#5' } }, 'tr')).toBe('Yeni sipariş: #5');
    expect(renderTitle({ type: 'dispatchOverdue', titleKey: 'types.dispatchOverdue', params: { count: 1 } }, 'en')).toBe('1 order is past the ship-by date');
    expect(renderTitle({ type: 'orderNew', titleKey: 'types.orderNew', params: {} }, 'en')).toBe('You have a new notification');
    expect(renderTitle({ type: 'draftSyncFailed', titleKey: 'types.draftSyncFailed', params: { title: 'Box' } }, 'en')).toBe('Sync to Etsy failed for "Box"');
  });

  it('bilingual email (TR then EN) when locale is unknown, with preferences link', () => {
    const m = renderNotificationEmail({ type: 'orderCanceled', titleKey: 'types.orderCanceled', params: { orderNumber: '#9' }, link: '/app/labels' }, null);
    expect(m.subject).toBe('KolayXport: #9 numaralı sipariş iptal edildi');
    expect(m.textBody).toContain('Order #9 was cancelled');
    expect(m.textBody).toContain('https://kolayxport.com/app/bildirimler?tab=preferences');
  });
});
