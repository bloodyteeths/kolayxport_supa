import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, any>();
let now = new Date('2026-05-31T18:00:00Z');

vi.mock('@/lib/prisma', () => {
  return {
    default: {
      authToken: {
        async create({ data }: any) {
          if (store.has(data.tokenHash)) {
            const err: any = new Error('unique constraint');
            err.code = 'P2002';
            throw err;
          }
          const row = { id: 'tok_' + store.size, consumedAt: null, createdAt: new Date(), ...data };
          store.set(data.tokenHash, row);
          return row;
        },
        async findUnique({ where }: any) {
          return store.get(where.tokenHash) ?? null;
        },
        async updateMany({ where, data }: any) {
          let count = 0;
          for (const row of store.values()) {
            if (where.identifier && row.identifier !== where.identifier) continue;
            if (where.purpose && row.purpose !== where.purpose) continue;
            if (where.tokenHash && row.tokenHash !== where.tokenHash) continue;
            if (where.consumedAt === null && row.consumedAt != null) continue;
            Object.assign(row, data);
            count++;
          }
          return { count };
        },
      },
    },
  };
});

import { generatePlainToken, hashToken, issueToken, consumeToken } from '@/lib/auth/tokens';

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

describe('lib/auth/tokens', () => {
  it('generatePlainToken returns base64url, hashToken returns hex sha256', () => {
    const p = generatePlainToken();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(30);
    expect(/^[A-Za-z0-9_-]+$/.test(p)).toBe(true);
    const h = hashToken(p);
    expect(h.length).toBe(64);
    expect(/^[a-f0-9]+$/.test(h)).toBe(true);
  });

  it('issueToken stores hash (not plaintext) and returns plaintext', async () => {
    const plain = await issueToken({ identifier: 'a@b.com', purpose: 'email_verify' });
    expect(plain.length).toBeGreaterThan(30);
    // Internal store should have the hash key, NOT the plaintext.
    expect(store.has(plain)).toBe(false);
    expect(store.has(hashToken(plain))).toBe(true);
  });

  it('issueToken invalidates prior tokens for same identifier+purpose', async () => {
    const p1 = await issueToken({ identifier: 'a@b.com', purpose: 'email_verify' });
    const p2 = await issueToken({ identifier: 'a@b.com', purpose: 'email_verify' });
    // First should be consumed (unusable); second still usable.
    expect((await consumeToken(p1, 'email_verify')).ok).toBe(false);
    expect((await consumeToken(p2, 'email_verify')).ok).toBe(true);
  });

  it('consumeToken happy path returns identifier and marks consumed', async () => {
    const p = await issueToken({ identifier: 'verifyme@example.com', purpose: 'email_verify' });
    const r = await consumeToken(p, 'email_verify');
    expect(r.ok).toBe(true);
    expect(r.identifier).toBe('verifyme@example.com');
    // Second consume should fail.
    expect((await consumeToken(p, 'email_verify')).ok).toBe(false);
  });

  it('consumeToken rejects expired tokens', async () => {
    const p = await issueToken({ identifier: 'a@b.com', purpose: 'password_reset', ttlMs: 1000 });
    vi.setSystemTime(new Date(now.getTime() + 5000));
    const r = await consumeToken(p, 'password_reset');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('consumeToken rejects wrong purpose (cannot use verify token to reset password)', async () => {
    const p = await issueToken({ identifier: 'a@b.com', purpose: 'email_verify' });
    const r = await consumeToken(p, 'password_reset');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('wrong_purpose');
  });

  it('consumeToken returns not_found for unknown plaintext', async () => {
    const r = await consumeToken('definitely-not-a-real-token', 'email_verify');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_found');
  });

  it('identifier is lowercased on issue and consume returns lowercased', async () => {
    const p = await issueToken({ identifier: 'CaseMix@Example.COM', purpose: 'email_verify' });
    const r = await consumeToken(p, 'email_verify');
    expect(r.ok).toBe(true);
    expect(r.identifier).toBe('casemix@example.com');
  });
});
