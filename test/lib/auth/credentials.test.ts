import { describe, it, expect, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';

const users = new Map<string, any>();

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: async ({ where }: any) => users.get(where.email) ?? null,
    },
  },
}));

import { credentialsAuthorize } from '@/lib/auth/credentials';

async function seed(email: string, fields: Partial<any>) {
  const password = fields.password
    ? await bcrypt.hash(String(fields.password), 4)
    : null;
  users.set(email, {
    id: 'u_' + email,
    email,
    name: 'User ' + email,
    emailVerified: fields.emailVerified ?? null,
    password,
  });
}

beforeEach(() => {
  users.clear();
});

describe('credentialsAuthorize', () => {
  it('returns null for missing inputs', async () => {
    expect(await credentialsAuthorize(undefined, undefined)).toBeNull();
    expect(await credentialsAuthorize('', 'pw')).toBeNull();
    expect(await credentialsAuthorize('x@y.z', '')).toBeNull();
    expect(await credentialsAuthorize(123 as any, 'pw')).toBeNull();
  });

  it('returns null for unknown email', async () => {
    expect(await credentialsAuthorize('nobody@example.com', 'pw')).toBeNull();
  });

  it('returns null for Google-only user (no password)', async () => {
    await seed('googleonly@example.com', { emailVerified: new Date(), password: null });
    expect(await credentialsAuthorize('googleonly@example.com', 'whatever')).toBeNull();
  });

  it('returns null for wrong password', async () => {
    await seed('a@b.com', { emailVerified: new Date(), password: 'correctpw' });
    expect(await credentialsAuthorize('a@b.com', 'incorrect')).toBeNull();
  });

  it('returns the user object for verified credentials user', async () => {
    await seed('verified@example.com', { emailVerified: new Date(), password: 'p455w0rd' });
    const u = await credentialsAuthorize('verified@example.com', 'p455w0rd');
    expect(u).not.toBeNull();
    expect(u!.email).toBe('verified@example.com');
  });

  it('throws EMAIL_NOT_VERIFIED for unverified credentials user with correct password', async () => {
    await seed('unverified@example.com', { emailVerified: null, password: 'p455w0rd' });
    await expect(credentialsAuthorize('unverified@example.com', 'p455w0rd')).rejects.toThrow(
      'EMAIL_NOT_VERIFIED',
    );
  });

  it('does NOT throw EMAIL_NOT_VERIFIED if password is wrong (no email-existence leak)', async () => {
    await seed('unverified@example.com', { emailVerified: null, password: 'p455w0rd' });
    // Wrong password still returns null — never throws — so an attacker probing
    // emails can't distinguish "exists+unverified" from "doesn't exist".
    expect(await credentialsAuthorize('unverified@example.com', 'wrong')).toBeNull();
  });

  it('lowercases the email before lookup', async () => {
    await seed('mix@example.com', { emailVerified: new Date(), password: 'pw' });
    const u = await credentialsAuthorize('Mix@Example.COM', 'pw');
    expect(u).not.toBeNull();
  });
});
