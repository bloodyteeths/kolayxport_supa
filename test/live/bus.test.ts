import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetLiveBusForTests,
  decodeNotifyPayload,
  deliverLocal,
  encodeNotifyPayload,
  LIVE_CHANNEL,
  LIVE_MAX_STREAMS_PER_USER,
  LIVE_NOTIFY_MAX_BYTES,
  listenConnectionString,
  liveSubscriberCount,
  makeEnvelope,
  publishToBus,
  replaySince,
  resolveTransport,
  subscribeLive,
} from '@/lib/live/bus';
import { liveEventName, liveEventNames, matchesLiveNames } from '@/lib/live/names';
import { buildStatusEnvelope, formatSseComment, formatSseFrame, formatSseRetry, SSE_HEADERS } from '@/lib/live/sse';
import { publishLive, publishNewOrders } from '@/lib/live/publish';
import type { LiveEnvelope, LiveEvent } from '@/lib/live/types';

const orderEvent = (id = 'o1'): LiveEvent => ({
  type: 'order',
  kind: 'new',
  order: {
    id,
    marketplace: 'etsy',
    marketplaceKey: '3456',
    orderNumber: '3456',
    source: 'etsy-api',
    status: 'pending',
    customerName: 'Ayşe Yılmaz',
    totalPrice: 42.5,
    currency: 'USD',
    itemCount: 2,
    createdAt: null,
    uiOrderDate: null,
    shipByAt: null,
  },
});

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

beforeEach(() => __resetLiveBusForTests({ transport: 'local' }));
afterEach(() => __resetLiveBusForTests({ transport: 'local' }));

describe('NOTIFY payload encoding / truncation', () => {
  it('passes small payloads through untouched', () => {
    const env = makeEnvelope(orderEvent());
    const r = encodeNotifyPayload('u1', env);
    expect(r.truncated).toBe(false);
    expect(r.degraded).toBe(false);
    expect(JSON.parse(r.payload)).toEqual({ userId: 'u1', envelope: env });
  });

  it('clips long strings so the payload fits under the limit (multi-byte safe)', () => {
    const ev = orderEvent();
    (ev as any).order.customerName = 'ğüşıöç'.repeat(2000); // ~24 KB of 2-byte chars
    const r = encodeNotifyPayload('u1', makeEnvelope(ev));
    expect(r.truncated).toBe(true);
    expect(r.degraded).toBe(false);
    expect(bytes(r.payload)).toBeLessThanOrEqual(LIVE_NOTIFY_MAX_BYTES);
    const decoded = decodeNotifyPayload(r.payload)!;
    expect(decoded.envelope.event.type).toBe('order');
    expect((decoded.envelope.event as any).order.id).toBe('o1');
  });

  it('degrades to an invalidate event when clipping is not enough', () => {
    const ev: LiveEvent = { type: 'invalidate', keys: Array.from({ length: 5000 }, (_, i) => `/api/x/${i}`) };
    const orderish = { ...orderEvent(), order: { ...(orderEvent() as any).order, extra: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, 'x'.repeat(70)])) } } as any;
    for (const e of [ev, orderish]) {
      const r = encodeNotifyPayload('u1', makeEnvelope(e));
      expect(bytes(r.payload)).toBeLessThanOrEqual(LIVE_NOTIFY_MAX_BYTES);
      expect(r.truncated).toBe(true);
    }
    const r = encodeNotifyPayload('u1', makeEnvelope(orderish));
    expect(r.degraded).toBe(true);
    const decoded = decodeNotifyPayload(r.payload)!;
    expect(decoded.envelope.event).toEqual({ type: 'invalidate', keys: ['live:order.new', '/api/orders'] });
    expect(decoded.envelope.name).toBe('invalidate');
  });

  it('rejects malformed payloads', () => {
    expect(decodeNotifyPayload(null)).toBeNull();
    expect(decodeNotifyPayload('not json')).toBeNull();
    expect(decodeNotifyPayload(JSON.stringify({ userId: 'u1' }))).toBeNull();
    expect(decodeNotifyPayload(JSON.stringify({ userId: '', envelope: makeEnvelope(orderEvent()) }))).toBeNull();
    expect(decodeNotifyPayload(JSON.stringify({ userId: 'u1', envelope: { id: 'x', event: {} } }))).toBeNull();
  });

  it('envelopes get unique ids, version and canonical name', () => {
    const a = makeEnvelope(orderEvent());
    const b = makeEnvelope(orderEvent());
    expect(a.id).not.toBe(b.id);
    expect(a.v).toBe(1);
    expect(a.name).toBe('order.new');
  });
});

describe('subscriber registry', () => {
  it('adds and removes listeners per user', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeLive('u1', a);
    const offB = subscribeLive('u2', b);
    expect(liveSubscriberCount('u1')).toBe(1);
    expect(liveSubscriberCount()).toBe(2);

    publishToBus('u1', orderEvent());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    offA();
    offA(); // idempotent
    expect(liveSubscriberCount('u1')).toBe(0);
    expect(liveSubscriberCount()).toBe(1);
    publishToBus('u1', orderEvent());
    expect(a).toHaveBeenCalledTimes(1);
    offB();
    expect(liveSubscriberCount()).toBe(0);
  });

  it('evicts the oldest stream beyond the per-user cap', () => {
    const evicted: number[] = [];
    const offs = Array.from({ length: LIVE_MAX_STREAMS_PER_USER + 2 }, (_, i) =>
      subscribeLive('u1', () => {}, { onEvict: () => evicted.push(i) }),
    );
    expect(liveSubscriberCount('u1')).toBe(LIVE_MAX_STREAMS_PER_USER);
    expect(evicted).toEqual([0, 1]);
    offs.forEach((off) => off());
    expect(liveSubscriberCount()).toBe(0);
  });

  it('isolates a throwing subscriber', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = vi.fn();
    subscribeLive('u1', () => {
      throw new Error('boom');
    });
    subscribeLive('u1', good);
    expect(() => publishToBus('u1', orderEvent())).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('never throws on bad input', () => {
    expect(publishToBus('', orderEvent())).toBeNull();
    expect(publishToBus('u1', null as any)).toBeNull();
    expect(publishToBus('u1', { foo: 1 } as any)).toBeNull();
    expect(() => publishLive('u1', null as any)).not.toThrow();
    expect(subscribeLive('', () => {})).toBeTypeOf('function');
  });
});

describe('pg transport delivery rules', () => {
  it('while not LISTENing: delivers locally and NOTIFYs', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    __resetLiveBusForTests({ transport: 'pg', notify, listenerState: 'backoff' });
    const fn = vi.fn();
    subscribeLive('u1', fn);
    publishToBus('u1', orderEvent());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe(LIVE_CHANNEL);
    expect(decodeNotifyPayload(notify.mock.calls[0][1])?.userId).toBe('u1');
  });

  it('while LISTENing: waits for the echo; falls back to local delivery when NOTIFY fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notify = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('db down'));
    __resetLiveBusForTests({ transport: 'pg', notify, listenerState: 'listening' });
    const fn = vi.fn();
    subscribeLive('u1', fn);

    publishToBus('u1', orderEvent('a'));
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled(); // arrives via LISTEN, simulated below
    const echoed = decodeNotifyPayload(notify.mock.calls[0][1])!;
    deliverLocal(echoed.userId, echoed.envelope);
    expect(fn).toHaveBeenCalledTimes(1);

    publishToBus('u1', orderEvent('b'));
    await new Promise((r) => setTimeout(r, 0));
    expect(fn).toHaveBeenCalledTimes(2);
    expect((fn.mock.calls[1][0] as LiveEnvelope).event).toMatchObject({ order: { id: 'b' } });
    warn.mockRestore();
  });
});

describe('replay buffer', () => {
  it('returns events after Last-Event-ID for connected users only', () => {
    const off = subscribeLive('u1', () => {});
    const e1 = publishToBus('u1', orderEvent('1'))!;
    const e2 = publishToBus('u1', orderEvent('2'))!;
    const e3 = publishToBus('u1', orderEvent('3'))!;
    expect(replaySince('u1', e1.id).map((e) => e.id)).toEqual([e2.id, e3.id]);
    expect(replaySince('u1', e3.id)).toEqual([]);
    expect(replaySince('u1', 'unknown')).toEqual([]);
    expect(replaySince('u1', null)).toEqual([]);
    off();
    // still kept briefly after disconnect (tab reconnecting)
    const e4 = publishToBus('u1', orderEvent('4'))!;
    expect(replaySince('u1', e3.id).map((e) => e.id)).toEqual([e4.id]);
    // users that never connected here are not buffered
    const x = publishToBus('u9', orderEvent('x'))!;
    publishToBus('u9', orderEvent('y'));
    expect(replaySince('u9', x.id)).toEqual([]);
  });
});

describe('SSE formatting', () => {
  it('formats data frames with id and canonical name', () => {
    const env = makeEnvelope(orderEvent());
    const frame = formatSseFrame(env);
    expect(frame.startsWith(`id: ${env.id}\ndata: `)).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
    const data = frame.split('\n')[1].slice('data: '.length);
    expect(JSON.parse(data)).toEqual(env);
    expect(frame.split('\n').length).toBe(4); // id, data, '', ''
  });

  it('adds a name when missing and can omit the id', () => {
    const env: LiveEnvelope = { id: 'x', v: 1, ts: 1, event: { type: 'notification', action: 'raised', notification: null as any } };
    const frame = formatSseFrame(env, { withId: false });
    expect(frame.startsWith('data: ')).toBe(true);
    expect(JSON.parse(frame.slice(6)).name).toBe('notification.raised');
  });

  it('comments, retry and status envelopes', () => {
    expect(formatSseComment()).toBe(': ping\n\n');
    expect(formatSseComment('a\nb')).toBe(': a b\n\n');
    expect(formatSseRetry(5000)).toBe('retry: 5000\n\n');
    const hello = buildStatusEnvelope('hello', 'pg', 'c1', 1000);
    expect(hello.name).toBe('sync.status');
    expect(hello.event).toEqual({ type: 'sync', kind: 'status', scope: 'stream', phase: 'hello', serverTime: 1000, transport: 'pg' });
  });

  it('sends anti-buffering headers', () => {
    expect(SSE_HEADERS['Content-Type']).toMatch(/^text\/event-stream/);
    expect(SSE_HEADERS['Cache-Control']).toContain('no-cache');
    expect(SSE_HEADERS['Cache-Control']).toContain('no-transform');
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no');
  });
});

describe('event names and aliases', () => {
  it('derives canonical names and aliases', () => {
    expect(liveEventName(orderEvent())).toBe('order.new');
    const cancelled: LiveEvent = { ...(orderEvent() as any), kind: 'cancelled' };
    expect(liveEventNames(cancelled)).toEqual(expect.arrayContaining(['order.cancelled', 'order.canceled', 'order', 'order.*', '*']));
    const raised: LiveEvent = { type: 'notification', action: 'raised', notification: null as any };
    expect(matchesLiveNames(raised, ['notification.new'])).toBe(true);
    const deleted: LiveEvent = { type: 'listing', kind: 'deleted', marketplace: 'etsy', shopId: '1', listingId: '2' };
    expect(matchesLiveNames(deleted, ['listing.removed'])).toBe(true);
    expect(matchesLiveNames(deleted, ['listing.changed'])).toBe(false);
    const oos: LiveEvent = { type: 'stock', kind: 'out_of_stock' };
    expect(matchesLiveNames(oos, ['stock.alert'])).toBe(true);
    expect(matchesLiveNames(oos, ['stock.changed'])).toBe(true);
    const ship: LiveEvent = { type: 'shipment', kind: 'created', orderId: 'o1' };
    expect(matchesLiveNames(ship, ['order.updated'])).toBe(true);
    expect(liveEventName({ type: 'invalidate', keys: [] })).toBe('invalidate');
    expect(liveEventNames(null)).toEqual([]);
    expect(matchesLiveNames(orderEvent(), [])).toBe(false);
  });
});

describe('publishNewOrders', () => {
  it('announces only fresh orders, newest first, and summarises the overflow', () => {
    const seen: LiveEnvelope[] = [];
    subscribeLive('u1', (e) => seen.push(e));
    const now = Date.parse('2026-10-15T12:00:00Z');
    const orders = [
      { id: 'old', uiOrderDate: '2026-09-01T00:00:00Z' },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, uiOrderDate: new Date(now - i * 60_000).toISOString() })),
    ];
    publishNewOrders('u1', orders, { now, scope: 'trendyol' });
    const news = seen.filter((e) => e.name === 'order.new');
    expect(news).toHaveLength(10);
    expect((news[0].event as any).order.id).toBe('n0');
    const summary = seen.find((e) => e.name === 'sync.finished')!;
    expect(summary.event).toEqual({ type: 'sync', kind: 'finished', scope: 'trendyol', newOrders: 3 });
    expect(() => publishNewOrders('u1', null)).not.toThrow();
  });
});

describe('transport selection', () => {
  it('chooses pg only with a DB url outside tests/build', () => {
    expect(resolveTransport({ DATABASE_URL: 'postgres://x' })).toBe('pg');
    expect(resolveTransport({})).toBe('local');
    expect(resolveTransport({ DATABASE_URL: 'postgres://x', VITEST: 'true' })).toBe('local');
    expect(resolveTransport({ DATABASE_URL: 'postgres://x', NEXT_PHASE: 'phase-production-build' })).toBe('local');
    expect(resolveTransport({ DATABASE_URL: 'postgres://x', KX_LIVE_TRANSPORT: 'local' })).toBe('local');
  });

  it('strips Prisma-only params from the LISTEN connection string', () => {
    expect(listenConnectionString('postgresql://u:p@h:5432/db?pgbouncer=true&connection_limit=1&sslmode=require&schema=public')).toBe(
      'postgresql://u:p@h:5432/db?sslmode=require',
    );
    expect(listenConnectionString('postgresql://u:p@h/db')).toBe('postgresql://u:p@h/db');
    expect(listenConnectionString(undefined)).toBeNull();
  });
});
