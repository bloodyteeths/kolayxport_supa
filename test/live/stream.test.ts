import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authUser = vi.hoisted(() => ({ current: { id: 'u1' } as { id: string } | null }));
vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(async () => authUser.current),
}));

import handler from '@/pages/api/live/stream';
import { __resetLiveBusForTests, liveSubscriberCount, publishToBus } from '@/lib/live/bus';
import { liveUserKey } from '@/lib/live/names';

let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    (req as any).query = Object.fromEntries(url.searchParams.entries());
    // minimal NextApiResponse helpers used by the handler's error paths
    (res as any).status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    (res as any).json = (body: unknown) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    void handler(req as any, res as any);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  authUser.current = { id: 'u1' };
  __resetLiveBusForTests({ transport: 'local' });
});
afterEach(() => __resetLiveBusForTests({ transport: 'local' }));

function open(path = '/api/live/stream', headers: Record<string, string> = {}) {
  return new Promise<{ res: http.IncomingMessage; req: http.ClientRequest; chunks: string[]; waitFor: (re: RegExp) => Promise<string> }>(
    (resolve, reject) => {
      const chunks: string[] = [];
      const waiters: Array<{ re: RegExp; done: (s: string) => void }> = [];
      const req = http.get(`${base}${path}`, { headers }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          chunks.push(c);
          const all = chunks.join('');
          for (const w of waiters.slice()) {
            if (w.re.test(all)) {
              waiters.splice(waiters.indexOf(w), 1);
              w.done(all);
            }
          }
        });
        resolve({
          res,
          req,
          chunks,
          waitFor: (re) =>
            new Promise((done) => {
              const all = chunks.join('');
              if (re.test(all)) done(all);
              else waiters.push({ re, done });
            }),
        });
      });
      req.on('error', reject);
    },
  );
}

const until = async (fn: () => boolean, ms = 1000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('GET /api/live/stream', () => {
  it('401 without a session', async () => {
    authUser.current = null;
    const { res } = await open();
    expect(res.statusCode).toBe(401);
    res.resume();
  });

  it('streams with SSE headers, retry, hello, then live events; unsubscribes on disconnect', async () => {
    const s = await open();
    expect(s.res.statusCode).toBe(200);
    expect(s.res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(s.res.headers['cache-control']).toContain('no-cache');
    expect(s.res.headers['x-accel-buffering']).toBe('no');

    const hello = await s.waitFor(/"phase":"hello"/);
    expect(hello.startsWith('retry: 5000\n\n')).toBe(true);
    expect(liveSubscriberCount('u1')).toBe(1);

    const env = publishToBus('u1', { type: 'invalidate', keys: ['/api/orders'] })!;
    publishToBus('u2', { type: 'invalidate', keys: ['/api/other-user'] });
    const all = await s.waitFor(new RegExp(`id: ${env.id}\\ndata: `));
    expect(all).toContain('"name":"invalidate"');
    expect(all).not.toContain('/api/other-user');

    s.req.destroy();
    await until(() => liveSubscriberCount('u1') === 0);
  });

  it('replays events missed since Last-Event-ID', async () => {
    const first = await open();
    await first.waitFor(/"phase":"hello"/);
    const e1 = publishToBus('u1', { type: 'invalidate', keys: ['/a'] })!;
    await first.waitFor(new RegExp(e1.id));
    first.req.destroy();
    await until(() => liveSubscriberCount('u1') === 0);

    const e2 = publishToBus('u1', { type: 'invalidate', keys: ['/b'] })!; // published while disconnected
    const second = await open('/api/live/stream', { 'Last-Event-ID': e1.id });
    const all = await second.waitFor(new RegExp(`id: ${e2.id}`));
    expect(all).not.toContain(`id: ${e1.id}`);
    // hello (with the user key) precedes the replayed frames
    expect(all.indexOf('"phase":"hello"')).toBeGreaterThan(-1);
    expect(all.indexOf('"phase":"hello"')).toBeLessThan(all.indexOf(`id: ${e2.id}`));
    second.req.destroy();
    await until(() => liveSubscriberCount('u1') === 0);
  });

  it('hello carries the stream user key', async () => {
    const s = await open();
    const all = await s.waitFor(/"phase":"hello"/);
    expect(all).toContain(`"userKey":"${liveUserKey('u1')}"`);
    s.req.destroy();
    await until(() => liveSubscriberCount('u1') === 0);
  });

  it('client gone during auth: no subscription, no timers left behind', async () => {
    let releaseAuth: () => void = () => {};
    const gate = new Promise<void>((r) => {
      releaseAuth = r;
    });
    const { getAuthUser } = await import('@/lib/auth');
    (getAuthUser as any).mockImplementationOnce(async () => {
      await gate;
      return { id: 'u1' };
    });
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const req = http.get(`${base}/api/live/stream`);
    req.on('error', () => {});
    await new Promise((r) => setTimeout(r, 30));
    req.destroy();
    await new Promise((r) => setTimeout(r, 30));
    const before = setIntervalSpy.mock.calls.length;
    releaseAuth();
    await new Promise((r) => setTimeout(r, 50));
    expect(liveSubscriberCount('u1')).toBe(0);
    expect(setIntervalSpy.mock.calls.length).toBe(before);
    setIntervalSpy.mockRestore();
  });

  it('closes the stream when the session re-check says the user changed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'] });
    try {
      const s = await open();
      await s.waitFor(/"phase":"hello"/);
      expect(liveSubscriberCount('u1')).toBe(1);
      authUser.current = { id: 'someone-else' };
      await vi.advanceTimersByTimeAsync(15 * 20_000 + 10);
      vi.useRealTimers();
      await until(() => liveSubscriberCount('u1') === 0);
      s.req.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('405 for non-GET', async () => {
    const res = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.request(`${base}/api/live/stream`, { method: 'POST' }, resolve);
      req.end();
    });
    expect(res.statusCode).toBe(405);
    res.resume();
  });
});
