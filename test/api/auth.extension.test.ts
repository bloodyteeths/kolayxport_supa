import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(async () => null), // unauthenticated unless a test says otherwise
  createExtensionToken: vi.fn(async () => 'ext-token'),
  EXTENSION_TOKEN_MAX_AGE_SECONDS: 86400,
}));

const settingsRow = vi.hoisted(() => ({ value: null as null | { locale: string | null } }));
vi.mock('@/lib/prisma', () => ({
  default: {
    syncLog: { create: vi.fn(async () => ({})) }, // logger / security events
    notificationSettings: {
      findUnique: vi.fn(async () => {
        if (settingsRow.value === undefined) throw new Error('db down');
        return settingsRow.value;
      }),
    },
  },
}));

vi.mock('next-auth/jwt', () => ({
  encode: vi.fn(async () => 'unit-test-token'),
}));

import handler from '@/pages/api/auth/extension';
import { getAuthUser } from '@/lib/auth';

function makeReq(origin?: string): NextApiRequest {
  return {
    headers: origin ? { origin } : {},
    method: 'GET',
    url: '/api/auth/extension',
    query: {},
    body: {},
  } as unknown as NextApiRequest;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const state = { status: 0, body: null as any, ended: false };
  const res = {
    setHeader: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    status: vi.fn((code: number) => {
      state.status = code;
      return res;
    }),
    json: vi.fn((body: any) => {
      state.body = body;
      state.ended = true;
      return res;
    }),
    end: vi.fn(() => {
      state.ended = true;
      return res;
    }),
    headers,
    state,
  };
  return res as any;
}

const SAVED = {
  EXT: process.env.OFFICIAL_EXTENSION_ID,
  NODE_ENV: process.env.NODE_ENV,
};

beforeAll(() => {
  process.env.OFFICIAL_EXTENSION_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
});

afterAll(() => {
  if (SAVED.EXT === undefined) delete process.env.OFFICIAL_EXTENSION_ID;
  else process.env.OFFICIAL_EXTENSION_ID = SAVED.EXT;
});

describe('GET /api/auth/extension — origin pinning', () => {
  it('accepts same-origin request (no Origin header)', async () => {
    const res = makeRes();
    await handler(makeReq(), res);
    // No session → 200 with authenticated:false (kept as legacy shape).
    expect(res.state.status).toBe(200);
    expect(res.state.body.authenticated).toBe(false);
  });

  it('accepts the official extension id', async () => {
    const res = makeRes();
    await handler(makeReq(`chrome-extension://${process.env.OFFICIAL_EXTENSION_ID}`), res);
    expect(res.state.status).toBe(200);
  });

  it('accepts the official extension id with trailing slash', async () => {
    const res = makeRes();
    await handler(makeReq(`chrome-extension://${process.env.OFFICIAL_EXTENSION_ID}/`), res);
    expect(res.state.status).toBe(200);
  });

  it('rejects a different extension id', async () => {
    const res = makeRes();
    await handler(makeReq('chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), res);
    expect(res.state.status).toBe(403);
  });

  it('rejects an unrelated http origin in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    await handler(makeReq('https://evil.example'), res);
    expect(res.state.status).toBe(403);
    if (SAVED.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = SAVED.NODE_ENV;
  });

  it('accepts https://kolayxport.com', async () => {
    const res = makeRes();
    await handler(makeReq('https://kolayxport.com'), res);
    expect(res.state.status).toBe(200);
  });

  it('fails closed when OFFICIAL_EXTENSION_ID is unset for chrome-extension origin', async () => {
    const saved = process.env.OFFICIAL_EXTENSION_ID;
    delete process.env.OFFICIAL_EXTENSION_ID;
    const res = makeRes();
    await handler(makeReq('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), res);
    expect(res.state.status).toBe(403);
    if (saved) process.env.OFFICIAL_EXTENSION_ID = saved;
  });
});

describe('GET /api/auth/extension — account language for the extension', () => {
  const signedIn = () => (getAuthUser as any).mockResolvedValueOnce({ id: 'u1', email: 'a@b.c', name: 'A' });

  it('returns the account locale (NotificationSettings.locale) at top level and on user', async () => {
    signedIn();
    settingsRow.value = { locale: 'en' };
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.state.status).toBe(200);
    expect(res.state.body).toMatchObject({ authenticated: true, token: 'ext-token', locale: 'en', user: { id: 'u1', locale: 'en' } });
  });

  it('normalizes the stored value and returns null when unknown or missing', async () => {
    signedIn();
    settingsRow.value = { locale: 'tr-TR' };
    let res = makeRes();
    await handler(makeReq(), res);
    expect(res.state.body.locale).toBe('tr');

    signedIn();
    settingsRow.value = { locale: 'de' };
    res = makeRes();
    await handler(makeReq(), res);
    expect(res.state.body.locale).toBeNull();

    signedIn();
    settingsRow.value = null;
    res = makeRes();
    await handler(makeReq(), res);
    expect(res.state.body.locale).toBeNull();
    expect(res.state.body.authenticated).toBe(true);
  });

  it('a DB error never blocks sign-in', async () => {
    signedIn();
    settingsRow.value = undefined as any;
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.state.body).toMatchObject({ authenticated: true, locale: null });
    settingsRow.value = null;
  });
});
