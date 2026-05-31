import { describe, it, expect, beforeEach, vi } from 'vitest';

const syncLogCreate = vi.fn(async (_args: any) => ({ id: 'log-1' }));

vi.mock('@/lib/prisma', () => ({
  default: { syncLog: { create: (args: any) => syncLogCreate(args) } },
}));

import {
  logSecurityEvent,
  logCronEvent,
  logIntegrationEvent,
  logExtensionEvent,
  logBillingEvent,
} from '@/lib/admin/events';

beforeEach(() => {
  syncLogCreate.mockClear();
});

describe('lib/admin/events — category tagging + redaction', () => {
  it('logSecurityEvent writes category=security and redacts secret-shaped fields', async () => {
    await logSecurityEvent('warn', {
      message: 'sign-in failure',
      operation: 'auth.failed',
      details: { ip: '127.0.0.1', accessToken: 'secret-token', userId: 'u1' },
    });
    expect(syncLogCreate).toHaveBeenCalledTimes(1);
    const call = syncLogCreate.mock.calls[0][0];
    expect(call.data.category).toBe('security');
    expect(call.data.level).toBe('warn');
    expect(call.data.message).toBe('sign-in failure');
    expect(call.data.operation).toBe('auth.failed');
    // Redactor masks token-shaped keys.
    expect(call.data.details.accessToken).toBe('[REDACTED]');
    expect(call.data.details.ip).toBe('127.0.0.1');
    expect(call.data.details.userId).toBe('u1');
  });

  it('each helper sets the right category', async () => {
    await logCronEvent('info', { message: 'tick' });
    await logIntegrationEvent('info', { message: 'sync' });
    await logExtensionEvent('warn', { message: 'reject' });
    await logBillingEvent('error', { message: 'fail' });

    const cats = syncLogCreate.mock.calls.map(([{ data }]) => data.category);
    expect(cats).toEqual(['cron', 'integration', 'extension', 'billing']);
  });

  it('redacts nested secret fields in details', async () => {
    await logIntegrationEvent('error', {
      message: 'wix refresh',
      details: { wix: { refreshToken: 'rrrr', siteId: 'sss' }, ok: false },
    });
    const data = syncLogCreate.mock.calls.at(-1)![0].data;
    expect(data.details.wix.refreshToken).toBe('[REDACTED]');
    expect(data.details.wix.siteId).toBe('sss');
    expect(data.details.ok).toBe(false);
  });
});
