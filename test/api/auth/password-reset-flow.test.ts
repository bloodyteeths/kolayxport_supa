import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

const users = new Map<string, any>();
const tokens = new Map<string, any>();
const sessions: any[] = [];

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: async ({ where, select }: any) => {
        const u = users.get(where.email) || [...users.values()].find(x => x.id === where.id);
        return u ?? null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const u of users.values()) {
          if (where.email && u.email !== where.email) continue;
          if (where.emailVerified === null && u.emailVerified != null) continue;
          if (where.password?.not === null && u.password == null) continue;
          Object.assign(u, data);
          count++;
        }
        return { count };
      },
    },
    session: {
      deleteMany: async () => {
        const n = sessions.length;
        sessions.length = 0;
        return { count: n };
      },
    },
    authToken: {
      async create({ data }: any) {
        const row = { id: 'tok_' + tokens.size, consumedAt: null, createdAt: new Date(), ...data };
        tokens.set(data.tokenHash, row);
        return row;
      },
      async findUnique({ where }: any) {
        return tokens.get(where.tokenHash) ?? null;
      },
      async updateMany({ where, data }: any) {
        let count = 0;
        for (const row of tokens.values()) {
          if (where.tokenHash && row.tokenHash !== where.tokenHash) continue;
          if (where.identifier && row.identifier !== where.identifier) continue;
          if (where.purpose && row.purpose !== where.purpose) continue;
          if (where.consumedAt === null && row.consumedAt != null) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    },
    syncLog: { create: async () => ({}), count: async () => 0, findMany: async () => [], groupBy: async () => [] },
  },
}));

vi.mock('@/lib/admin/events', () => ({
  logAuthEvent: vi.fn(),
}));

vi.mock('@/lib/auth/email', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/email')>('@/lib/auth/email');
  return {
    ...actual,
    sendEmail: vi.fn(async () => ({ sent: true })),
  };
});

import requestResetHandler from '@/pages/api/auth/request-reset';
import resetPasswordHandler from '@/pages/api/auth/reset-password';
import { sendEmail } from '@/lib/auth/email';
import bcrypt from 'bcryptjs';

function makeReq(body: any) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 255),
    },
    socket: { remoteAddress: '127.0.0.1' },
    url: '/api/auth/test-' + Math.random(),
    body,
  } as any;
}

function makeRes() {
  const state = { status: 0, body: null as any, ended: false };
  const res: any = {
    setHeader: vi.fn(),
    status: vi.fn((c: number) => {
      state.status = c;
      return res;
    }),
    json: vi.fn((b: any) => {
      state.body = b;
      state.ended = true;
      return res;
    }),
    end: vi.fn(() => {
      state.ended = true;
      return res;
    }),
    state,
  };
  return res;
}

beforeAll(async () => {
  const hash = await bcrypt.hash('original-password', 4);
  users.set('existing@example.com', {
    id: 'u1',
    email: 'existing@example.com',
    password: hash,
    emailVerified: new Date(),
  });
  users.set('googleonly@example.com', {
    id: 'u2',
    email: 'googleonly@example.com',
    password: null,
    emailVerified: new Date(),
  });
});

beforeEach(() => {
  tokens.clear();
  sessions.length = 0;
  (sendEmail as any).mockClear();
});

describe('POST /api/auth/request-reset — no enumeration', () => {
  it('returns identical 200 { ok:true } for known credentials user', async () => {
    const res = makeRes();
    await requestResetHandler(makeReq({ email: 'existing@example.com' }), res);
    expect(res.state.status).toBe(200);
    expect(res.state.body).toEqual({ ok: true });
    expect((sendEmail as any).mock.calls.length).toBe(1);
  });

  it('returns identical 200 { ok:true } for unknown email (no email sent)', async () => {
    const res = makeRes();
    await requestResetHandler(makeReq({ email: 'nobody@example.com' }), res);
    expect(res.state.status).toBe(200);
    expect(res.state.body).toEqual({ ok: true });
    expect((sendEmail as any).mock.calls.length).toBe(0);
  });

  it('returns identical 200 { ok:true } for Google-only user (no email sent)', async () => {
    const res = makeRes();
    await requestResetHandler(makeReq({ email: 'googleonly@example.com' }), res);
    expect(res.state.status).toBe(200);
    expect(res.state.body).toEqual({ ok: true });
    expect((sendEmail as any).mock.calls.length).toBe(0);
  });

  it('200 for empty email', async () => {
    const res = makeRes();
    await requestResetHandler(makeReq({ email: '' }), res);
    expect(res.state.status).toBe(200);
  });
});

describe('POST /api/auth/reset-password', () => {
  async function issueResetToken(email: string): Promise<string> {
    const { issueToken } = await import('@/lib/auth/tokens');
    return issueToken({ identifier: email, purpose: 'password_reset' });
  }

  it('rejects short password', async () => {
    const t = await issueResetToken('existing@example.com');
    const res = makeRes();
    await resetPasswordHandler(makeReq({ token: t, newPassword: 'short' }), res);
    expect(res.state.status).toBe(400);
    expect(res.state.body.error).toBe('password_too_short');
  });

  it('rejects invalid token', async () => {
    const res = makeRes();
    await resetPasswordHandler(makeReq({ token: 'not-a-real-token', newPassword: 'a-good-long-password' }), res);
    expect(res.state.status).toBe(400);
    expect(res.state.body.error).toBe('invalid_or_expired');
  });

  it('happy path updates bcrypt hash and consumes token', async () => {
    const t = await issueResetToken('existing@example.com');
    const res = makeRes();
    await resetPasswordHandler(makeReq({ token: t, newPassword: 'a-good-long-password' }), res);
    expect(res.state.status).toBe(200);
    expect(res.state.body).toEqual({ ok: true });
    const u = users.get('existing@example.com');
    // New hash must NOT equal the new plaintext, must verify bcrypt-compare.
    expect(u.password).not.toBe('a-good-long-password');
    expect(await bcrypt.compare('a-good-long-password', u.password)).toBe(true);
    // Token cannot be reused.
    const res2 = makeRes();
    await resetPasswordHandler(makeReq({ token: t, newPassword: 'another-good-long-password' }), res2);
    expect(res2.state.status).toBe(400);
  });
});
