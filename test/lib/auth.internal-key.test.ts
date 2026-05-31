import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// We test the header-only / timing-safe / X-User-Id branches by mocking
// req.headers and a minimal res. The fall-through to NextAuth getAuthUser is
// outside this unit's scope (covered by integration tests).

const ENV_KEY_LEGACY = 'legacy-clawd-key-aaaaaaaaaaaaaaaaaa';
const ENV_KEY_NEW = 'new-internal-key-bbbbbbbbbbbbbbbbbb';
const SAMPLE_CUID = 'c' + 'a'.repeat(24);

function makeReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return {
    headers: {},
    query: {},
    body: {},
    method: 'GET',
    url: '/test',
    ...overrides,
  } as unknown as NextApiRequest;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const state = { status: 0, body: null as any, ended: false };
  const res = {
    setHeader: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    getHeader: vi.fn((k: string) => headers[k.toLowerCase()]),
    removeHeader: vi.fn((k: string) => {
      delete headers[k.toLowerCase()];
    }),
    appendHeader: vi.fn((k: string, v: string) => {
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

beforeAll(() => {
  process.env.CLAWD_API_KEY = ENV_KEY_LEGACY;
  process.env.KOLAYXPORT_INTERNAL_API_KEY = ENV_KEY_NEW;
});

afterAll(() => {
  delete process.env.CLAWD_API_KEY;
  delete process.env.KOLAYXPORT_INTERNAL_API_KEY;
});

describe('getAuthUserOrApiKey — internal API key path', () => {
  it('rejects API key in query string (header-only)', async () => {
    const { getAuthUserOrApiKey } = await import('@/lib/auth');
    const req = makeReq({ query: { apiKey: ENV_KEY_NEW, userId: SAMPLE_CUID } as any });
    const res = makeRes();
    const u = await getAuthUserOrApiKey(req, res);
    expect(u).toBeNull();
  });

  it('accepts Authorization: Bearer with X-User-Id', async () => {
    const { getAuthUserOrApiKey } = await import('@/lib/auth');
    const req = makeReq({
      headers: {
        authorization: `Bearer ${ENV_KEY_NEW}`,
        'x-user-id': SAMPLE_CUID,
      },
    });
    const res = makeRes();
    const u = await getAuthUserOrApiKey(req, res);
    expect(u).not.toBeNull();
    expect(u?.id).toBe(SAMPLE_CUID);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('still accepts the legacy CLAWD_API_KEY env var', async () => {
    const { getAuthUserOrApiKey } = await import('@/lib/auth');
    const req = makeReq({
      headers: {
        authorization: `Bearer ${ENV_KEY_LEGACY}`,
        'x-user-id': SAMPLE_CUID,
      },
    });
    const res = makeRes();
    const u = await getAuthUserOrApiKey(req, res);
    expect(u).not.toBeNull();
    expect(u?.id).toBe(SAMPLE_CUID);
  });

  it('accepts X-Internal-Api-Key header', async () => {
    const { getAuthUserOrApiKey } = await import('@/lib/auth');
    const req = makeReq({
      headers: {
        'x-internal-api-key': ENV_KEY_NEW,
        'x-user-id': SAMPLE_CUID,
      },
    });
    const res = makeRes();
    const u = await getAuthUserOrApiKey(req, res);
    expect(u).not.toBeNull();
    expect(u?.id).toBe(SAMPLE_CUID);
  });

  it('rejects when API key is valid but X-User-Id is missing (returns null without writing body)', async () => {
    const { getAuthUserOrApiKey } = await import('@/lib/auth');
    const req = makeReq({ headers: { authorization: `Bearer ${ENV_KEY_NEW}` } });
    const res = makeRes();
    const u = await getAuthUserOrApiKey(req, res);
    expect(u).toBeNull();
    expect(res.state.ended).toBe(false);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('rejects when X-User-Id is not a CUID', async () => {
    const { getAuthUserOrApiKey } = await import('@/lib/auth');
    const req = makeReq({
      headers: {
        authorization: `Bearer ${ENV_KEY_NEW}`,
        'x-user-id': 'not-a-cuid',
      },
    });
    const res = makeRes();
    const u = await getAuthUserOrApiKey(req, res);
    expect(u).toBeNull();
  });

  it('wrong-length wrong key falls through to getAuthUser (returns null in this mock with no session)', async () => {
    const { getAuthUserOrApiKey } = await import('@/lib/auth');
    const req = makeReq({
      headers: {
        authorization: 'Bearer wrong-key-short',
        'x-user-id': SAMPLE_CUID,
      },
    });
    const res = makeRes();
    const u = await getAuthUserOrApiKey(req, res);
    // No NEXTAUTH cookie + invalid JWT -> null.
    expect(u).toBeNull();
  });
});
