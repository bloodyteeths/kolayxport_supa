import { describe, it, expect, beforeEach, vi } from 'vitest';

const auditCreate = vi.fn(async (_args: any) => ({ id: 'audit-1' }));

vi.mock('@/lib/prisma', () => ({
  default: {
    adminAuditLog: { create: (args: any) => auditCreate(args) },
  },
}));

import { recordAdminAction } from '@/lib/admin/audit';

const ADMIN_ID = 'c' + 'a'.repeat(24);
const TARGET_ID = 'c' + 'b'.repeat(24);

function makeReq(opts: { ip?: string; ua?: string } = {}) {
  return {
    headers: {
      ...(opts.ip ? { 'x-forwarded-for': opts.ip } : {}),
      ...(opts.ua ? { 'user-agent': opts.ua } : {}),
    },
    socket: { remoteAddress: opts.ip ?? '127.0.0.1' },
  } as any;
}

beforeEach(() => {
  auditCreate.mockClear();
  process.env.NEXTAUTH_SECRET = 'test-pepper';
});

describe('recordAdminAction', () => {
  it('writes adminUserId, action, targetType, targetId, ipHash, userAgent', async () => {
    await recordAdminAction(makeReq({ ip: '1.2.3.4', ua: 'curl/8' }), ADMIN_ID, {
      action: 'user.update',
      targetType: 'user',
      targetId: TARGET_ID,
      metadata: { fields: ['role'], changes: { role: 'admin' } },
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const data = auditCreate.mock.calls[0][0].data;
    expect(data.adminUserId).toBe(ADMIN_ID);
    expect(data.action).toBe('user.update');
    expect(data.targetType).toBe('user');
    expect(data.targetId).toBe(TARGET_ID);
    expect(typeof data.ipHash).toBe('string');
    expect(data.ipHash.length).toBeGreaterThan(8);
    expect(data.userAgent).toBe('curl/8');
    expect(data.metadata.fields).toEqual(['role']);
  });

  it('redacts secret-shaped fields in metadata', async () => {
    await recordAdminAction(makeReq(), ADMIN_ID, {
      action: 'user.connect',
      targetType: 'user',
      targetId: TARGET_ID,
      metadata: { token: 'abc', accessToken: 'def', notes: 'ok' },
    });
    const data = auditCreate.mock.calls.at(-1)![0].data;
    expect(data.metadata.token).toBe('[REDACTED]');
    expect(data.metadata.accessToken).toBe('[REDACTED]');
    expect(data.metadata.notes).toBe('ok');
  });

  it('hashes the same IP to the same value', async () => {
    await recordAdminAction(makeReq({ ip: '9.9.9.9' }), ADMIN_ID, { action: 'a' });
    await recordAdminAction(makeReq({ ip: '9.9.9.9' }), ADMIN_ID, { action: 'b' });
    const h1 = auditCreate.mock.calls[0][0].data.ipHash;
    const h2 = auditCreate.mock.calls[1][0].data.ipHash;
    expect(h1).toBe(h2);
    expect(h1).not.toBe('9.9.9.9');
  });

  it('does not throw when audit insert fails', async () => {
    auditCreate.mockImplementationOnce(async () => {
      throw new Error('db unavailable');
    });
    await expect(
      recordAdminAction(makeReq(), ADMIN_ID, { action: 'x' }),
    ).resolves.toBeUndefined();
  });
});
