import { describe, it, expect, beforeEach, vi } from 'vitest';

const { notification, notificationDelivery, notificationSettings, notificationPreference, user, warn, publishLive, kickDispatcher } =
  vi.hoisted(() => ({
    notification: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    notificationDelivery: { createMany: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    notificationSettings: { findUnique: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    warn: vi.fn(),
    publishLive: vi.fn(),
    kickDispatcher: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => ({
  default: { notification, notificationDelivery, notificationSettings, notificationPreference, user },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/live/publish', () => ({ publishLive }));
vi.mock('@/lib/notificationCenter/outbox', () => ({
  kickDispatcher,
  OPEN_DELIVERY_STATUSES: ['pending', 'held', 'digest'],
}));

import {
  notify,
  notifyAdmins,
  resolve,
  resolveByPrefix,
  listNotifications,
  markNotificationsRead,
  getOpenReauthFlags,
  notificationKeys,
  invalidateResolveMemo,
  decideRaise,
  encodeCursor,
  decodeCursor,
  __resetNotificationMemo,
} from '@/lib/notifications';
import { __resetPreferenceCaches } from '@/lib/notificationCenter/preferences';

const created = new Date('2026-10-14T10:00:00Z');

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    type: 'draftSyncFailed',
    severity: 'error',
    titleKey: 'types.draftSyncFailed',
    params: { title: 'Wooden Box' },
    link: '/app/etsy-listings',
    readAt: null,
    resolvedAt: null,
    createdAt: created,
    badge: true,
    entityType: null,
    entityId: null,
    raiseCount: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetNotificationMemo();
  __resetPreferenceCaches();
  notification.create.mockResolvedValue(row());
  notification.findUnique.mockResolvedValue(null);
  notification.update.mockResolvedValue(row({ raiseCount: 1 }));
  notification.updateMany.mockResolvedValue({ count: 1 });
  notification.count.mockResolvedValue(3);
  notificationDelivery.createMany.mockResolvedValue({ count: 1 });
  notificationDelivery.updateMany.mockResolvedValue({ count: 0 });
  notificationDelivery.findMany.mockResolvedValue([]);
  notificationSettings.findUnique.mockResolvedValue(null);
  notificationPreference.findMany.mockResolvedValue([]);
});

const base = {
  type: 'draftSyncFailed' as const,
  severity: 'error' as const,
  titleKey: 'types.draftSyncFailed',
  params: { title: 'Wooden Box' },
  link: '/app/etsy-listings',
};

describe('decideRaise', () => {
  it('re-raises resolved rows, refreshes onlyIfNew, escalates only on increase', () => {
    expect(decideRaise({ resolvedAt: new Date(), params: {} }, { onlyIfNew: true }, {})).toBe('raise');
    expect(decideRaise({ resolvedAt: null, params: {} }, { onlyIfNew: true }, {})).toBe('refresh');
    expect(decideRaise({ resolvedAt: null, params: {} }, {}, {})).toBe('raise');
    expect(decideRaise({ resolvedAt: null, params: { count: 3 } }, { escalateOn: 'count' }, { count: 4 })).toBe('raise');
    expect(decideRaise({ resolvedAt: null, params: { count: 3 } }, { escalateOn: 'count' }, { count: 3 })).toBe('refresh');
    expect(decideRaise({ resolvedAt: null, params: { count: 3 } }, { escalateOn: 'count' }, { count: 2 })).toBe('refresh');
    expect(decideRaise({ resolvedAt: null, params: { count: '3' } }, { escalateOn: 'count' }, { count: 5 })).toBe('raise');
    expect(decideRaise({ resolvedAt: null, params: {} }, { escalateOn: 'count' }, { count: 1 })).toBe('raise');
    expect(decideRaise({ resolvedAt: null, params: { count: 1 } }, { escalateOn: 'count' }, {})).toBe('refresh');
  });
});

describe('notify', () => {
  it('creates a new row on (userId, dedupeKey) with badge from the registry and publishes a live raise', async () => {
    await notify('u1', { ...base, dedupeKey: 'draft:d1', entity: { type: 'draft', id: 'd1' } });
    expect(notification.findUnique.mock.calls[0][0].where).toEqual({ userId_dedupeKey: { userId: 'u1', dedupeKey: 'draft:d1' } });
    const data = notification.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: 'u1',
      dedupeKey: 'draft:d1',
      type: 'draftSyncFailed',
      params: { title: 'Wooden Box' },
      badge: true,
      entityType: 'draft',
      entityId: 'd1',
    });
    expect(publishLive).toHaveBeenCalledWith('u1', expect.objectContaining({ type: 'notification', action: 'raised', unreadCount: 3 }));
    expect(publishLive.mock.calls[0][1].notification).toMatchObject({ id: 'n1', createdAt: created.toISOString() });
  });

  it('re-raises an existing row: bumps createdAt, clears readAt/resolvedAt, increments raiseCount', async () => {
    notification.findUnique.mockResolvedValue({ id: 'n1', params: { title: 'x' }, resolvedAt: null });
    await notify('u1', { ...base, dedupeKey: 'draft:d1' });
    const arg = notification.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'n1' });
    expect(arg.data.readAt).toBeNull();
    expect(arg.data.resolvedAt).toBeNull();
    expect(arg.data.createdAt).toBeInstanceOf(Date);
    expect(arg.data.raiseCount).toEqual({ increment: 1 });
    expect(arg.data.params).toEqual({ title: 'Wooden Box' });
  });

  it('creates a plain row when there is no dedupeKey', async () => {
    await notify('u1', base);
    expect(notification.create).toHaveBeenCalledTimes(1);
    expect(notification.findUnique).not.toHaveBeenCalled();
  });

  it('onlyIfNew keeps an open row (params refreshed only) and memoises repeat calls', async () => {
    notification.findUnique.mockResolvedValue({ id: 'n1', params: {}, resolvedAt: null });
    const input = { ...base, type: 'usageNearLimit' as const, severity: 'warning' as const, titleKey: 'types.usageNearLimit', dedupeKey: 'usage:label:near:x', onlyIfNew: true };
    await notify('u1', input);
    await notify('u1', input);
    expect(notification.findUnique).toHaveBeenCalledTimes(1);
    expect(notification.update).toHaveBeenCalledTimes(1);
    expect(notification.update.mock.calls[0][0].data).toEqual({ params: { title: 'Wooden Box' } });
    expect(publishLive).not.toHaveBeenCalled();
  });

  it('onlyIfNew re-raises a previously resolved row with the same key', async () => {
    notification.findUnique.mockResolvedValue({ id: 'n1', params: {}, resolvedAt: new Date() });
    await notify('u1', { ...base, dedupeKey: 'usage:label:reached:p', onlyIfNew: true });
    expect(notification.update.mock.calls[0][0].data).toMatchObject({ readAt: null, resolvedAt: null });
  });

  it('resolving a key drops its onlyIfNew memo so it can be raised again', async () => {
    const input = { ...base, dedupeKey: 'usage:label:reached:p', onlyIfNew: true };
    await notify('u1', input);
    await resolve('u1', 'usage:label:reached:p');
    await notify('u1', input);
    expect(notification.findUnique).toHaveBeenCalledTimes(2);
  });

  it('escalateOn re-raises only when the param increased', async () => {
    const input = {
      type: 'dispatchOverdue' as const,
      severity: 'warning' as const,
      titleKey: 'types.dispatchOverdue',
      dedupeKey: 'dispatch:overdue:2026-10-15',
      escalateOn: 'count',
    };
    notification.findUnique.mockResolvedValue({ id: 'n1', params: { count: 3 }, resolvedAt: null });
    await notify('u1', { ...input, params: { count: 3 } });
    expect(notification.update.mock.calls[0][0].data).toEqual({ params: { count: 3 } });
    expect(notificationDelivery.createMany).not.toHaveBeenCalled();

    await notify('u1', { ...input, params: { count: 4 } });
    expect(notification.update.mock.calls[1][0].data.raiseCount).toEqual({ increment: 1 });
    // dispatchOverdue emails instantly by default -> one pending email delivery at raiseSeq=raiseCount
    expect(notificationDelivery.createMany).toHaveBeenCalledWith({
      data: [{ notificationId: 'n1', channel: 'email', raiseSeq: 1, status: 'pending' }],
      skipDuplicates: true,
    });
    expect(kickDispatcher).toHaveBeenCalledTimes(1);
  });

  it('queues a digest-mode email delivery without kicking the dispatcher', async () => {
    notification.create.mockResolvedValue(row({ type: 'listingExpired', raiseCount: 0 }));
    await notify('u1', { type: 'listingExpired', severity: 'warning', titleKey: 'types.listingExpired', params: { title: 'Box' }, dedupeKey: 'listing:1:expired' });
    expect(notificationDelivery.createMany.mock.calls[0][0].data).toEqual([
      { notificationId: 'n1', channel: 'email', raiseSeq: 0, status: 'digest' },
    ]);
    expect(kickDispatcher).not.toHaveBeenCalled();
  });

  it('orderNew is an activity row (badge=false, spec W5 T1) and sends no email', async () => {
    notification.create.mockResolvedValue(row({ type: 'orderNew', badge: false }));
    await notify('u1', { type: 'orderNew', severity: 'info', titleKey: 'types.orderNew', params: { orderNumber: '#1' }, dedupeKey: 'order:o1:new', badge: false });
    expect(notification.create.mock.calls[0][0].data.badge).toBe(false);
    expect(notificationDelivery.createMany).not.toHaveBeenCalled();
    expect(publishLive).toHaveBeenCalledWith('u1', { type: 'invalidate', keys: ['/api/notifications/activity'] });
  });

  it('an explicit badge:false from the emitter wins for a registered badge type', async () => {
    await notify('u1', { ...base, dedupeKey: 'draft:d9', badge: false });
    expect(notification.create.mock.calls[0][0].data.badge).toBe(false);
  });

  it('a re-raise supersedes older open deliveries of the same notification + channel', async () => {
    notification.findUnique.mockResolvedValue({ id: 'n1', params: {}, resolvedAt: null, severity: 'error' });
    notification.update.mockResolvedValue(row({ raiseCount: 3 }));
    // draftSyncFailed has no email by default: opt in.
    notificationPreference.findMany.mockResolvedValue([{ type: 'draftSyncFailed', inApp: true, email: true, telegram: false, emailMode: 'instant' }]);
    await notify('u1', { ...base, dedupeKey: 'draft:d1' });
    expect(notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: { notificationId: 'n1', channel: { in: ['email'] }, status: { in: ['pending', 'held', 'digest'] }, raiseSeq: { lt: 3 } },
      data: { status: 'skipped', error: 'superseded' },
    });
    expect(notificationDelivery.createMany).toHaveBeenCalledWith({
      data: [{ notificationId: 'n1', channel: 'email', raiseSeq: 3, status: 'pending' }],
      skipDuplicates: true,
    });
    // supersede runs before the insert
    expect(notificationDelivery.updateMany.mock.invocationCallOrder[0]).toBeLessThan(notificationDelivery.createMany.mock.invocationCallOrder[0]);
  });

  it('cooldown: a non-escalated re-raise within 6 h of a sent email queues no new email and supersedes nothing', async () => {
    notification.findUnique.mockResolvedValue({ id: 'n1', params: {}, resolvedAt: null, severity: 'error' });
    notification.update.mockResolvedValue(row({ type: 'reauthRequired', raiseCount: 5 }));
    notificationDelivery.findMany.mockResolvedValue([{ channel: 'email' }]);
    await notify('u1', { type: 'reauthRequired', severity: 'error', titleKey: 'types.reauthRequired', params: { provider: 'Etsy' }, dedupeKey: 'reauth:etsy:1' });
    const where = notificationDelivery.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ notificationId: 'n1', channel: { in: ['email'] } });
    expect(where.OR[0].sentAt.gte).toBeInstanceOf(Date);
    expect(notificationDelivery.createMany).not.toHaveBeenCalled();
    expect(notificationDelivery.updateMany).not.toHaveBeenCalled();
    expect(kickDispatcher).not.toHaveBeenCalled();
    // the bell still updates
    expect(publishLive).toHaveBeenCalledWith('u1', expect.objectContaining({ action: 'raised' }));
  });

  it('cooldown is bypassed by an escalation (escalateOn rose, or severity went up)', async () => {
    notificationDelivery.findMany.mockResolvedValue([{ channel: 'email' }]);
    notification.findUnique.mockResolvedValue({ id: 'n1', params: { count: 3 }, resolvedAt: null, severity: 'warning' });
    notification.update.mockResolvedValue(row({ type: 'dispatchOverdue', raiseCount: 2 }));
    await notify('u1', { type: 'dispatchOverdue', severity: 'warning', titleKey: 'types.dispatchOverdue', params: { count: 4 }, dedupeKey: 'dispatch:overdue:d', escalateOn: 'count' });
    expect(notificationDelivery.findMany).not.toHaveBeenCalled();
    expect(notificationDelivery.createMany).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    __resetPreferenceCaches();
    notificationSettings.findUnique.mockResolvedValue(null);
    notificationPreference.findMany.mockResolvedValue([]);
    notificationDelivery.findMany.mockResolvedValue([{ channel: 'email' }]);
    notificationDelivery.updateMany.mockResolvedValue({ count: 0 });
    notificationDelivery.createMany.mockResolvedValue({ count: 1 });
    notification.count.mockResolvedValue(1);
    notification.findUnique.mockResolvedValue({ id: 'n1', params: {}, resolvedAt: null, severity: 'warning' });
    notification.update.mockResolvedValue(row({ type: 'dispatchOverdue', raiseCount: 3 }));
    await notify('u1', { type: 'dispatchOverdue', severity: 'error', titleKey: 'types.dispatchOverdue', params: { count: 4 }, dedupeKey: 'dispatch:overdue:d' });
    expect(notificationDelivery.findMany).not.toHaveBeenCalled();
    expect(notificationDelivery.createMany).toHaveBeenCalledTimes(1);
  });

  it('an activity type (badge=false) publishes an invalidate instead of a bell raise', async () => {
    notification.create.mockResolvedValue(row({ type: 'orderShippedExternal', badge: false }));
    await notify('u1', { type: 'orderShippedExternal', severity: 'info', titleKey: 'types.orderShippedExternal', params: { orderNumber: '#1' }, dedupeKey: 'order:o1:shippedExternal' });
    expect(notification.create.mock.calls[0][0].data.badge).toBe(false);
    expect(publishLive).toHaveBeenCalledWith('u1', { type: 'invalidate', keys: ['/api/notifications/activity'] });
  });

  it('in-app disabled by preference still writes the row, with badge=false', async () => {
    notificationPreference.findMany.mockResolvedValue([{ type: 'draftSyncFailed', inApp: false, email: false, telegram: false, emailMode: 'instant' }]);
    await notify('u1', { ...base, dedupeKey: 'draft:d2' });
    expect(notification.create.mock.calls[0][0].data.badge).toBe(false);
  });

  it('losing a create race (P2002) only refreshes params: no second delivery or live raise', async () => {
    notification.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'n1', params: {}, resolvedAt: null, severity: 'error' });
    notification.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await notify('u1', { type: 'orderCanceledAfterLabel', severity: 'error', titleKey: 'types.orderCanceledAfterLabel', params: { orderNumber: '#1' }, dedupeKey: 'order:o1:canceledAfterLabel' });
    expect(notification.update).toHaveBeenCalledTimes(1);
    expect(notification.update.mock.calls[0][0].data).toEqual({ params: { orderNumber: '#1' } });
    expect(notificationDelivery.createMany).not.toHaveBeenCalled();
    expect(publishLive).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops non-primitive params (ICU values must be strings/numbers)', async () => {
    await notify('u1', { ...base, dedupeKey: 'k', params: { title: 'ok', bad: { x: 1 } as any, n: 3, nan: NaN } });
    expect(notification.create.mock.calls[0][0].data.params).toEqual({ title: 'ok', n: 3 });
  });

  it('never throws when the DB fails (including preference loading)', async () => {
    notificationSettings.findUnique.mockRejectedValueOnce(new Error('db down'));
    notification.findUnique.mockRejectedValueOnce(new Error('db down'));
    await expect(notify('u1', { ...base, dedupeKey: 'k' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('ignores calls without a userId', async () => {
    await notify('', { ...base, dedupeKey: 'k' });
    expect(notification.findUnique).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });
});

describe('notifyAdmins', () => {
  it('notifies every admin', async () => {
    user.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    await notifyAdmins({ type: 'webhookBacklog', severity: 'error', titleKey: 'types.webhookBacklog', dedupeKey: 'webhooks:backlog:h' });
    expect(user.findMany.mock.calls[0][0].where).toEqual({ role: 'admin' });
    expect(notification.create).toHaveBeenCalledTimes(2);
  });
});

describe('resolve', () => {
  it('sets resolvedAt, skips open deliveries and publishes a live resolve', async () => {
    await resolve('u1', 'draft:d1');
    const arg = notification.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 'u1', dedupeKey: 'draft:d1', resolvedAt: null });
    expect(arg.data.resolvedAt).toBeInstanceOf(Date);
    expect(notificationDelivery.updateMany.mock.calls[0][0]).toEqual({
      where: { status: { in: ['pending', 'held', 'digest'] }, notification: { userId: 'u1', resolvedAt: { not: null } } },
      data: { status: 'skipped', error: 'resolved' },
    });
    expect(publishLive).toHaveBeenCalledWith('u1', { type: 'notification', action: 'resolved', dedupeKeys: ['draft:d1'] });
  });

  it('does nothing more when no row was open', async () => {
    notification.updateMany.mockResolvedValueOnce({ count: 0 });
    await resolve('u1', 'draft:d1');
    expect(notificationDelivery.updateMany).not.toHaveBeenCalled();
    expect(publishLive).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    notification.updateMany.mockRejectedValueOnce(new Error('db down'));
    await expect(resolve('u1', 'k')).resolves.toBeUndefined();
  });
});

describe('resolveByPrefix', () => {
  it('filters by prefix and excludes keys; memoises within TTL', async () => {
    await resolveByPrefix('u1', 'usage:label:', { exceptKeys: ['usage:label:near:p'], memoTtlMs: 60_000 });
    await resolveByPrefix('u1', 'usage:label:', { exceptKeys: ['usage:label:near:p'], memoTtlMs: 60_000 });
    expect(notification.updateMany).toHaveBeenCalledTimes(1);
    expect(notification.updateMany.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      resolvedAt: null,
      dedupeKey: { startsWith: 'usage:label:', notIn: ['usage:label:near:p'] },
    });
  });

  it('invalidateResolveMemo lets the next identical call hit the DB', async () => {
    await resolveByPrefix('u1', 'usage:label:', { memoTtlMs: 60_000 });
    invalidateResolveMemo('u1', 'usage:label:');
    await resolveByPrefix('u1', 'usage:label:', { memoTtlMs: 60_000 });
    expect(notification.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe('listNotifications / markNotificationsRead', () => {
  it('bell feed: unresolved badge rows, newest first, ISO dates, badge-only unreadCount', async () => {
    notification.findMany.mockResolvedValue([row({ type: 'draftConflict', severity: 'warning', titleKey: 'types.draftConflict', params: { title: 'X' } })]);
    notification.count.mockResolvedValue(1);
    const out = await listNotifications('u1', 500);
    const q = notification.findMany.mock.calls[0][0];
    expect(q.where).toEqual({ userId: 'u1', resolvedAt: null, badge: true });
    expect(q.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(q.take).toBe(101);
    expect(notification.count.mock.calls[0][0].where).toEqual({ userId: 'u1', badge: true, resolvedAt: null, readAt: null });
    expect(out.unreadCount).toBe(1);
    expect(out.nextCursor).toBeNull();
    expect(out.items[0]).toMatchObject({
      id: 'n1',
      type: 'draftConflict',
      severity: 'warning',
      titleKey: 'types.draftConflict',
      params: { title: 'X' },
      link: '/app/etsy-listings',
      readAt: null,
      createdAt: created.toISOString(),
      badge: true,
    });
  });

  it('activity feed with group + cursor; returns nextCursor when there are more rows', async () => {
    const cursor = encodeCursor(created, 'n9');
    notification.findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    const out = await listNotifications('u1', 2, { feed: 'activity', group: 'orders', cursor, includeResolved: true });
    const where = notification.findMany.mock.calls[0][0].where;
    expect(where.badge).toBe(false);
    expect(where.resolvedAt).toBeUndefined();
    expect(where.type.in).toContain('orderNew');
    expect(where.OR).toEqual([{ createdAt: { lt: created } }, { createdAt: created, id: { lt: 'n9' } }]);
    expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(decodeCursor(out.nextCursor)).toEqual({ createdAt: created, id: 'b' });
  });

  it('decodeCursor rejects junk', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  it('marks only the caller’s rows read and publishes a live read event', async () => {
    notification.count.mockResolvedValue(2);
    await markNotificationsRead('u1', { ids: ['a', 'b'] });
    expect(notification.updateMany.mock.calls[0][0].where).toEqual({ userId: 'u1', id: { in: ['a', 'b'] }, readAt: null });
    expect(publishLive).toHaveBeenCalledWith('u1', { type: 'notification', action: 'read', ids: ['a', 'b'], unreadCount: 2 });
    await markNotificationsRead('u1', { all: true });
    expect(notification.updateMany.mock.calls[1][0].where).toEqual({ userId: 'u1', readAt: null });
    expect(publishLive).toHaveBeenLastCalledWith('u1', { type: 'notification', action: 'read', all: true, unreadCount: 0 });
  });

  it('is a no-op with no ids', async () => {
    expect(await markNotificationsRead('u1', { ids: [] })).toBe(0);
    expect(notification.updateMany).not.toHaveBeenCalled();
  });
});

describe('getOpenReauthFlags', () => {
  it('parses provider/account from dedupe keys and swallows errors', async () => {
    const at = new Date('2026-10-14T10:00:00Z');
    notification.findMany.mockResolvedValueOnce([
      { dedupeKey: notificationKeys.reauth('etsy', '12345'), params: { provider: 'Etsy' }, createdAt: at },
      { dedupeKey: null, params: { provider: 'eBay' }, createdAt: at },
    ]);
    expect(await getOpenReauthFlags('u1')).toEqual([
      { provider: 'etsy', accountId: '12345', dedupeKey: 'reauth:etsy:12345', createdAt: at },
      { provider: 'ebay', accountId: null, dedupeKey: null, createdAt: at },
    ]);
    notification.findMany.mockRejectedValueOnce(new Error('db down'));
    expect(await getOpenReauthFlags('u1')).toEqual([]);
  });
});
