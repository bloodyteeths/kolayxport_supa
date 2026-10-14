import { describe, it, expect, beforeEach, vi } from 'vitest';

const { notification, warn } = vi.hoisted(() => ({
  notification: {
    create: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  warn: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { notification } }));
vi.mock('@/lib/logger', () => ({ logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  notify,
  resolve,
  resolveByPrefix,
  listNotifications,
  markNotificationsRead,
  getOpenReauthFlags,
  notificationKeys,
  invalidateResolveMemo,
  __resetNotificationMemo,
} from '@/lib/notifications';

beforeEach(() => {
  vi.clearAllMocks();
  __resetNotificationMemo();
  notification.upsert.mockResolvedValue({});
  notification.create.mockResolvedValue({});
  notification.updateMany.mockResolvedValue({ count: 1 });
});

const base = {
  type: 'draftSyncFailed' as const,
  severity: 'error' as const,
  titleKey: 'types.draftSyncFailed',
  params: { title: 'Wooden Box' },
  link: '/app/etsy-listings',
};

describe('notify', () => {
  it('upserts on (userId, dedupeKey) and re-raises: bumps createdAt, clears readAt/resolvedAt', async () => {
    await notify('u1', { ...base, dedupeKey: 'draft:d1' });
    expect(notification.upsert).toHaveBeenCalledTimes(1);
    const arg = notification.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId_dedupeKey: { userId: 'u1', dedupeKey: 'draft:d1' } });
    expect(arg.create).toMatchObject({ userId: 'u1', dedupeKey: 'draft:d1', type: 'draftSyncFailed', params: { title: 'Wooden Box' } });
    expect(arg.update.readAt).toBeNull();
    expect(arg.update.resolvedAt).toBeNull();
    expect(arg.update.createdAt).toBeInstanceOf(Date);
    expect(arg.update.params).toEqual({ title: 'Wooden Box' });
  });

  it('creates a plain row when there is no dedupeKey', async () => {
    await notify('u1', base);
    expect(notification.create).toHaveBeenCalledTimes(1);
    expect(notification.upsert).not.toHaveBeenCalled();
  });

  it('onlyIfNew keeps createdAt/readAt of an open row (params refreshed) and memoises repeat calls', async () => {
    const input = { ...base, type: 'usageNearLimit' as const, titleKey: 'types.usageNearLimit', dedupeKey: 'usage:label:near:x', onlyIfNew: true };
    await notify('u1', input);
    await notify('u1', input);
    expect(notification.upsert).toHaveBeenCalledTimes(1);
    expect(notification.upsert.mock.calls[0][0].update).toEqual({ params: { title: 'Wooden Box' } });
  });

  it('onlyIfNew re-raises a previously resolved row with the same key', async () => {
    await notify('u1', { ...base, dedupeKey: 'usage:label:reached:p', onlyIfNew: true });
    const arg = notification.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 'u1', dedupeKey: 'usage:label:reached:p', resolvedAt: { not: null } });
    expect(arg.data).toMatchObject({ readAt: null, resolvedAt: null });
    expect(arg.data.createdAt).toBeInstanceOf(Date);
  });

  it('resolving a key drops its onlyIfNew memo so it can be raised again', async () => {
    const input = { ...base, dedupeKey: 'usage:label:reached:p', onlyIfNew: true };
    await notify('u1', input);
    await resolve('u1', 'usage:label:reached:p');
    await notify('u1', input);
    expect(notification.upsert).toHaveBeenCalledTimes(2);
  });

  it('drops non-primitive params (ICU values must be strings/numbers)', async () => {
    await notify('u1', { ...base, dedupeKey: 'k', params: { title: 'ok', bad: { x: 1 } as any, n: 3, nan: NaN } });
    expect(notification.upsert.mock.calls[0][0].create.params).toEqual({ title: 'ok', n: 3 });
  });

  it('never throws when the DB fails', async () => {
    notification.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(notify('u1', { ...base, dedupeKey: 'k' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('ignores calls without a userId', async () => {
    await notify('', { ...base, dedupeKey: 'k' });
    expect(notification.upsert).not.toHaveBeenCalled();
  });
});

describe('resolve', () => {
  it('sets resolvedAt on the unresolved row for the key', async () => {
    await resolve('u1', 'draft:d1');
    const arg = notification.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 'u1', dedupeKey: 'draft:d1', resolvedAt: null });
    expect(arg.data.resolvedAt).toBeInstanceOf(Date);
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
  it('returns unresolved items newest first with ISO dates and unreadCount', async () => {
    const created = new Date('2026-10-14T10:00:00Z');
    notification.findMany.mockResolvedValue([
      { id: 'n1', type: 'draftConflict', severity: 'warning', titleKey: 'types.draftConflict', params: { title: 'X' }, link: '/app/etsy-listings', readAt: null, createdAt: created },
    ]);
    notification.count.mockResolvedValue(1);
    const out = await listNotifications('u1', 500);
    expect(notification.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1', resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    expect(out).toEqual({
      items: [{ id: 'n1', type: 'draftConflict', severity: 'warning', titleKey: 'types.draftConflict', params: { title: 'X' }, link: '/app/etsy-listings', readAt: null, createdAt: created.toISOString() }],
      unreadCount: 1,
    });
  });

  it('marks only the caller’s rows read', async () => {
    await markNotificationsRead('u1', { ids: ['a', 'b'] });
    expect(notification.updateMany.mock.calls[0][0].where).toEqual({ userId: 'u1', id: { in: ['a', 'b'] }, readAt: null });
    await markNotificationsRead('u1', { all: true });
    expect(notification.updateMany.mock.calls[1][0].where).toEqual({ userId: 'u1', readAt: null });
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
