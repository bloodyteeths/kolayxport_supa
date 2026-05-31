import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(async () => null), // unauthenticated in unit tests
}));

vi.mock('next-auth/jwt', () => ({
  encode: vi.fn(async () => 'unit-test-token'),
}));

import handler from '@/pages/api/auth/extension';

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
