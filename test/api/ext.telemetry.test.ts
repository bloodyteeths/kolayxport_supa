import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const ACTING_USER_ID = 'c' + 'a'.repeat(24);

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(async (_req: any) => {
    if (_req.headers?.['x-test-auth'] === 'yes') {
      return { id: ACTING_USER_ID, email: 'u@example.com', name: 'u' };
    }
    return null;
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
  },
  redact: (v: any) => v,
}));

vi.mock('@/lib/admin/events', () => ({
  logExtensionEvent: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

import handler from '@/pages/api/ext/telemetry';
import { logger } from '@/lib/logger';

function makeReq(opts: { origin?: string; auth?: boolean; body?: any; method?: string }): NextApiRequest {
  return {
    headers: {
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.auth ? { 'x-test-auth': 'yes' } : {}),
      'content-type': 'application/json',
    },
    method: opts.method ?? 'POST',
    url: '/api/ext/telemetry',
    query: {},
    body: opts.body ?? {},
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

beforeAll(() => {
  process.env.OFFICIAL_EXTENSION_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
});
afterAll(() => {
  delete process.env.OFFICIAL_EXTENSION_ID;
});

describe('POST /api/ext/telemetry', () => {
  it('rejects unauthenticated POST', async () => {
    const res = makeRes();
    await handler(
      makeReq({ origin: 'https://kolayxport.com', body: { failures: [{ page: 'search', selector: '.foo', url: 'x', timestamp: 0, extensionVersion: '9.3.0' }] } }),
      res,
    );
    expect(res.state.status).toBe(401);
  });

  it('rejects unknown extension origin', async () => {
    const res = makeRes();
    await handler(
      makeReq({ origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', auth: true, body: { failures: [{ page: 'search', selector: '.foo', url: 'x', timestamp: 0, extensionVersion: '9.3.0' }] } }),
      res,
    );
    expect(res.state.status).toBe(403);
  });

  it('accepts authenticated POST from the official extension', async () => {
    const res = makeRes();
    await handler(
      makeReq({
        origin: `chrome-extension://${process.env.OFFICIAL_EXTENSION_ID}`,
        auth: true,
        body: { failures: [{ page: 'listing', selector: '.bar', url: 'https://www.etsy.com/listing/1', timestamp: 1, extensionVersion: '9.3.0' }] },
      }),
      res,
    );
    expect(res.state.status).toBe(200);
    expect(res.state.body.received).toBe(1);
  });

  it('does not set Access-Control-Allow-Origin: *', async () => {
    const res = makeRes();
    await handler(
      makeReq({
        origin: 'https://kolayxport.com',
        auth: true,
        body: { failures: [{ page: 'shop', selector: '.x', url: 'x', timestamp: 0, extensionVersion: '9.3.0' }] },
      }),
      res,
    );
    expect(res.headers['access-control-allow-origin']).toBe('https://kolayxport.com');
  });

  it('drops domSnapshot unless debugMode is true', async () => {
    const res = makeRes();
    await handler(
      makeReq({
        origin: 'https://kolayxport.com',
        auth: true,
        body: {
          failures: [
            {
              page: 'search',
              selector: '.x',
              url: 'x',
              timestamp: 0,
              extensionVersion: '9.3.0',
              domSnapshot: '<html>secret token here</html>',
            },
          ],
        },
      }),
      res,
    );
    expect(res.state.status).toBe(200);
    // The warn payload should not include domSnapshot.
    const warnCalls = (logger.warn as any).mock.calls;
    expect(warnCalls.length).toBeGreaterThan(0);
    const lastCall = warnCalls[warnCalls.length - 1];
    const details = lastCall[1];
    expect(details.domSnapshot).toBeUndefined();
  });

  it('rejects empty failures array with 400', async () => {
    const res = makeRes();
    await handler(
      makeReq({ origin: 'https://kolayxport.com', auth: true, body: { failures: [] } }),
      res,
    );
    expect(res.state.status).toBe(400);
  });
});
