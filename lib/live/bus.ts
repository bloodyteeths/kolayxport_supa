/**
 * Live event bus (owner W6-live). Server-only.
 *
 *   publisher (any process: Next server, in-process worker, tsx script)
 *     └─ NOTIFY kx_live '{"userId","envelope"}'      (via Prisma, pooled connection)
 *   Postgres
 *     └─ LISTEN kx_live  (ONE dedicated `pg` client per server process, lazy,
 *                          auto-reconnect with backoff, ping watchdog)
 *   bus registry Map<userId, Set<subscriber>>  ──>  SSE streams (pages/api/live/stream.ts)
 *
 * Delivery rules
 *   - While this process is LISTENing, publishes go ONLY through NOTIFY and come
 *     back via LISTEN (one path, no duplicates, cross-process for free).
 *   - While it is not (connecting / reconnecting / transport 'local'), publishes
 *     are delivered to local subscribers immediately AND NOTIFY'd (other
 *     processes). If NOTIFY fails, local delivery already happened.
 *   - Transport 'local' (no DATABASE_URL, tests, KX_LIVE_TRANSPORT=local, or
 *     `pg` missing): in-process only. Logged once.
 *   - Payloads above LIVE_NOTIFY_MAX_BYTES (NOTIFY hard limit is 8000) are
 *     shrunk (long strings clipped) and, if still too big, degraded to an
 *     `invalidate` event so clients revalidate instead of losing the signal.
 *   - A short per-user replay buffer (last 50 events / 5 min) lets a stream that
 *     reconnects with Last-Event-ID receive what it missed during a blip.
 *
 * Process-wide state lives on globalThis (Symbol.for) because Next bundles API
 * routes and instrumentation separately; every copy of this module must share
 * one registry and one LISTEN connection.
 *
 * Nothing here ever throws into publishers. Subscribers that throw are isolated.
 */
import type { LiveEnvelope, LiveEvent, LiveEventType } from './types';
import { LIVE_EVENT_VERSION } from './types';
import { liveEventName, LIVE_SWR_PREFIXES } from './names';

export const LIVE_CHANNEL = 'kx_live';
/** Postgres NOTIFY payload limit is 8000 bytes; stay safely under it. */
export const LIVE_NOTIFY_MAX_BYTES = 7900;
export const LIVE_MAX_STREAMS_PER_USER = 10;
export const LIVE_MAX_SUBSCRIBERS_TOTAL = 5000;
export const LIVE_REPLAY_MAX_EVENTS = 50;
export const LIVE_REPLAY_TTL_MS = 5 * 60_000;

export type LiveTransport = 'pg' | 'local';
export type LiveListenerState = 'idle' | 'connecting' | 'listening' | 'backoff' | 'disabled';
export type LiveSubscriber = (envelope: LiveEnvelope) => void;

type SubscriberEntry = { fn: LiveSubscriber; onEvict?: (reason: string) => void; since: number };

type NotifyFn = (channel: string, payload: string) => Promise<void>;

interface BusState {
  bootId: string;
  seq: number;
  subscribers: Map<string, Set<SubscriberEntry>>;
  total: number;
  replay: Map<string, LiveEnvelope[]>;
  /** userId -> epoch ms when its last stream closed (replay is kept for a while after). */
  recentDisconnect: Map<string, number>;
  transport: LiveTransport | null;
  listenerState: LiveListenerState;
  // pg LISTEN client (typed loosely so the module never needs pg types at import time)
  client: any;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  loggedLocal: boolean;
  notifyOverride: NotifyFn | null;
  stats: { published: number; delivered: number; notifyErrors: number; truncated: number; degraded: number; reconnects: number };
}

const STATE_KEY = Symbol.for('kolayxport.live.bus.v1');

function state(): BusState {
  const g = globalThis as unknown as Record<symbol, BusState | undefined>;
  let s = g[STATE_KEY];
  if (!s) {
    s = {
      bootId: Math.random().toString(36).slice(2, 8),
      seq: 0,
      subscribers: new Map(),
      total: 0,
      replay: new Map(),
      recentDisconnect: new Map(),
      transport: null,
      listenerState: 'idle',
      client: null,
      reconnectAttempt: 0,
      reconnectTimer: null,
      pingTimer: null,
      loggedLocal: false,
      notifyOverride: null,
      stats: { published: 0, delivered: 0, notifyErrors: 0, truncated: 0, degraded: 0, reconnects: 0 },
    };
    g[STATE_KEY] = s;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Transport selection
// ---------------------------------------------------------------------------

function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

/** Connection string for the LISTEN client: Prisma-only query params stripped. */
export function listenConnectionString(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const [base, query] = raw.split('?');
  if (!query) return base;
  const keep = new URLSearchParams();
  const params = new URLSearchParams(query);
  for (const [k, v] of params) {
    if (['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'options', 'application_name'].includes(k)) keep.set(k, v);
  }
  const q = keep.toString();
  return q ? `${base}?${q}` : base;
}

export function resolveTransport(env: Record<string, string | undefined> = process.env): LiveTransport {
  const forced = (env.KX_LIVE_TRANSPORT || '').toLowerCase();
  if (forced === 'local') return 'local';
  if (forced === 'pg') return 'pg';
  if (env.NODE_ENV === 'test' || env.VITEST) return 'local';
  if (env.NEXT_PHASE === 'phase-production-build') return 'local';
  if (!(env.DIRECT_URL || env.DATABASE_URL)) return 'local';
  return 'pg';
}

function transport(): LiveTransport {
  const s = state();
  if (!s.transport) {
    s.transport = resolveTransport();
    if (s.transport === 'local') logLocalOnce('transport=local (no DB url, test/build, or KX_LIVE_TRANSPORT=local)');
  }
  return s.transport;
}

function logLocalOnce(why: string) {
  const s = state();
  if (s.loggedLocal || isTestEnv()) return;
  s.loggedLocal = true;
  console.warn(`[live] in-process delivery only: ${why}`);
}

// ---------------------------------------------------------------------------
// Envelopes, payload encoding, truncation
// ---------------------------------------------------------------------------

export function makeEnvelope(event: LiveEvent, now = Date.now()): LiveEnvelope {
  const s = state();
  s.seq = (s.seq + 1) % Number.MAX_SAFE_INTEGER;
  return {
    id: `${now.toString(36)}-${s.bootId}-${s.seq.toString(36)}`,
    v: LIVE_EVENT_VERSION,
    ts: now,
    event,
    name: liveEventName(event),
  };
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** Recursively clip strings longer than `max` chars and arrays longer than `maxItems`. */
export function clipStrings<T>(value: T, max: number, maxItems = 50, depth = 0): T {
  if (depth > 6) return value;
  if (typeof value === 'string') return (value.length > max ? value.slice(0, max) : value) as unknown as T;
  if (Array.isArray(value)) return value.slice(0, maxItems).map((v) => clipStrings(v, max, maxItems, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = clipStrings(v, max, maxItems, depth + 1);
    return out as T;
  }
  return value;
}

/** Fallback when an event cannot fit: clients revalidate the matching data. */
export function degradeToInvalidate(event: LiveEvent): LiveEvent {
  const type = (event && (event as { type?: string }).type) as LiveEventType | undefined;
  const keys = [`live:${liveEventName(event)}`, ...((type && LIVE_SWR_PREFIXES[type]) || [])];
  return { type: 'invalidate', keys };
}

/**
 * Encode `{ userId, envelope }` for NOTIFY, guaranteed <= maxBytes.
 * Returns the payload plus what had to be done to make it fit.
 */
export function encodeNotifyPayload(
  userId: string,
  envelope: LiveEnvelope,
  maxBytes = LIVE_NOTIFY_MAX_BYTES,
): { payload: string; envelope: LiveEnvelope; truncated: boolean; degraded: boolean } {
  let payload = JSON.stringify({ userId, envelope });
  if (byteLength(payload) <= maxBytes) return { payload, envelope, truncated: false, degraded: false };

  for (const max of [500, 200, 80]) {
    const clipped: LiveEnvelope = { ...envelope, event: clipStrings(envelope.event, max, max >= 200 ? 20 : 5) };
    payload = JSON.stringify({ userId, envelope: clipped });
    if (byteLength(payload) <= maxBytes) return { payload, envelope: clipped, truncated: true, degraded: false };
  }

  const degraded: LiveEnvelope = { ...envelope, event: degradeToInvalidate(envelope.event), name: 'invalidate' };
  payload = JSON.stringify({ userId, envelope: degraded });
  if (byteLength(payload) <= maxBytes) return { payload, envelope: degraded, truncated: true, degraded: true };
  // Pathological userId; still never exceed the limit.
  const minimal: LiveEnvelope = { ...envelope, event: { type: 'invalidate', keys: [] }, name: 'invalidate' };
  return { payload: JSON.stringify({ userId: userId.slice(0, 64), envelope: minimal }), envelope: minimal, truncated: true, degraded: true };
}

/** Parse a NOTIFY payload; null when malformed. */
export function decodeNotifyPayload(raw: string | null | undefined): { userId: string; envelope: LiveEnvelope } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { userId?: unknown; envelope?: LiveEnvelope };
    if (typeof parsed?.userId !== 'string' || !parsed.userId) return null;
    const env = parsed.envelope;
    if (!env || typeof env !== 'object' || typeof env.id !== 'string' || !env.event || typeof (env.event as { type?: unknown }).type !== 'string') {
      return null;
    }
    return { userId: parsed.userId, envelope: env };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Subscriber registry
// ---------------------------------------------------------------------------

export function subscribeLive(
  userId: string,
  fn: LiveSubscriber,
  opts: { onEvict?: (reason: string) => void; maxPerUser?: number } = {},
): () => void {
  const s = state();
  if (!userId || typeof fn !== 'function') return () => {};
  const max = opts.maxPerUser ?? LIVE_MAX_STREAMS_PER_USER;
  let set = s.subscribers.get(userId);
  if (!set) {
    set = new Set();
    s.subscribers.set(userId, set);
  }
  // Per-user cap: evict the OLDEST (the newest tab is the one being looked at).
  while (set.size >= max) {
    const oldest = set.values().next().value as SubscriberEntry | undefined;
    if (!oldest) break;
    removeEntry(userId, oldest);
    safeCall(() => oldest.onEvict?.('per_user_limit'));
  }
  // Global cap: refuse (caller should close the stream).
  if (s.total >= LIVE_MAX_SUBSCRIBERS_TOTAL) {
    safeCall(() => opts.onEvict?.('global_limit'));
    return () => {};
  }
  const entry: SubscriberEntry = { fn, onEvict: opts.onEvict, since: Date.now() };
  set.add(entry);
  s.total += 1;
  ensureListener();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    removeEntry(userId, entry);
  };
}

function removeEntry(userId: string, entry: SubscriberEntry) {
  const s = state();
  const set = s.subscribers.get(userId);
  if (!set || !set.has(entry)) return;
  set.delete(entry);
  s.total = Math.max(0, s.total - 1);
  if (set.size === 0) {
    s.subscribers.delete(userId);
    s.recentDisconnect.set(userId, Date.now());
  }
}

export function liveSubscriberCount(userId?: string): number {
  const s = state();
  if (userId) return s.subscribers.get(userId)?.size ?? 0;
  return s.total;
}

function safeCall(fn: () => void) {
  try {
    fn();
  } catch {
    /* isolated */
  }
}

/** Deliver to this process's subscribers of `userId` and remember for replay. */
export function deliverLocal(userId: string, envelope: LiveEnvelope): number {
  const s = state();
  rememberForReplay(userId, envelope);
  const set = s.subscribers.get(userId);
  if (!set || set.size === 0) return 0;
  let n = 0;
  for (const entry of Array.from(set)) {
    try {
      entry.fn(envelope);
      n += 1;
    } catch (err) {
      console.warn('[live] subscriber threw', (err as Error)?.message);
    }
  }
  s.stats.delivered += n;
  return n;
}

// ---------------------------------------------------------------------------
// Replay buffer (Last-Event-ID)
// ---------------------------------------------------------------------------

function rememberForReplay(userId: string, envelope: LiveEnvelope) {
  const s = state();
  const now = Date.now();
  // Only buffer for users connected to THIS process now or within the replay
  // window (a reconnecting tab); keeps memory bounded on busy servers.
  const left = s.recentDisconnect.get(userId);
  if (!s.subscribers.has(userId) && !(left && now - left <= LIVE_REPLAY_TTL_MS)) {
    if (left) s.recentDisconnect.delete(userId);
    s.replay.delete(userId);
    return;
  }
  let buf = s.replay.get(userId);
  if (!buf) {
    buf = [];
    s.replay.set(userId, buf);
  }
  if (buf.some((e) => e.id === envelope.id)) return;
  buf.push(envelope);
  while (buf.length > LIVE_REPLAY_MAX_EVENTS || (buf.length && now - buf[0].ts > LIVE_REPLAY_TTL_MS)) buf.shift();
  if (s.replay.size > 500 || s.recentDisconnect.size > 500) pruneReplay(now);
}

function pruneReplay(now = Date.now()) {
  const s = state();
  for (const [uid, ts] of s.recentDisconnect) if (now - ts > LIVE_REPLAY_TTL_MS) s.recentDisconnect.delete(uid);
  for (const [uid, buf] of s.replay) {
    while (buf.length && now - buf[0].ts > LIVE_REPLAY_TTL_MS) buf.shift();
    if (buf.length === 0) s.replay.delete(uid);
  }
}

/** Events published after `lastEventId` (empty when unknown/expired). */
export function replaySince(userId: string, lastEventId: string | null | undefined, now = Date.now()): LiveEnvelope[] {
  if (!userId || !lastEventId) return [];
  const buf = state().replay.get(userId);
  if (!buf) return [];
  const idx = buf.findIndex((e) => e.id === lastEventId);
  if (idx < 0) return [];
  return buf.slice(idx + 1).filter((e) => now - e.ts <= LIVE_REPLAY_TTL_MS);
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

async function defaultNotify(channel: string, payload: string): Promise<void> {
  const { default: prisma } = await import('../prisma');
  await prisma.$executeRaw`SELECT pg_notify(${channel}, ${payload})`;
}

/** Fire-and-forget. Never throws. Returns the envelope actually sent (for tests/diagnostics). */
export function publishToBus(userId: string, event: LiveEvent): LiveEnvelope | null {
  try {
    if (!userId || !event || typeof (event as { type?: unknown }).type !== 'string') return null;
    const s = state();
    s.stats.published += 1;
    const envelope0 = makeEnvelope(event);
    const { payload, envelope, truncated, degraded } = encodeNotifyPayload(userId, envelope0);
    if (truncated) s.stats.truncated += 1;
    if (degraded) s.stats.degraded += 1;

    if (transport() === 'local') {
      deliverLocal(userId, envelope);
      return envelope;
    }

    const listening = s.listenerState === 'listening';
    if (!listening) deliverLocal(userId, envelope);

    const notify = s.notifyOverride || defaultNotify;
    notify(LIVE_CHANNEL, payload).catch((err) => {
      s.stats.notifyErrors += 1;
      // The LISTEN echo will never come: deliver locally so this process's tabs still get it.
      if (listening) deliverLocal(userId, envelope);
      if (s.stats.notifyErrors <= 3 || s.stats.notifyErrors % 100 === 0) {
        console.warn('[live] NOTIFY failed', (err as Error)?.message);
      }
    });
    return envelope;
  } catch (err) {
    try {
      console.warn('[live] publish failed', (err as Error)?.message);
    } catch {
      /* ignore */
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// LISTEN connection (one per process)
// ---------------------------------------------------------------------------

const PING_INTERVAL_MS = 60_000;
const PING_TIMEOUT_MS = 10_000;

export function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function ensureListener() {
  const s = state();
  if (transport() !== 'pg' || isBuildPhase()) return;
  if (s.listenerState !== 'idle') return;
  void connectListener();
}

async function connectListener(): Promise<void> {
  const s = state();
  if (s.listenerState === 'connecting' || s.listenerState === 'listening') return;
  s.listenerState = 'connecting';
  const conn = listenConnectionString(process.env.DIRECT_URL || process.env.DATABASE_URL);
  if (!conn) {
    s.listenerState = 'disabled';
    s.transport = 'local';
    logLocalOnce('no DATABASE_URL');
    return;
  }
  let pg: any;
  try {
    pg = await import('pg');
  } catch {
    s.listenerState = 'disabled';
    s.transport = 'local';
    logLocalOnce('`pg` package unavailable');
    return;
  }
  const Client = pg.Client || pg.default?.Client;
  const client = new Client({ connectionString: conn, keepAlive: true, application_name: 'kx-live-listen' });
  s.client = client;

  // MUST be attached before connect: an unhandled 'error' on a pg client crashes the process.
  client.on('error', (err: Error) => {
    console.warn('[live] LISTEN connection error', err?.message);
    scheduleReconnect(client);
  });
  client.on('end', () => scheduleReconnect(client));
  client.on('notification', (msg: { channel: string; payload?: string }) => {
    if (msg.channel !== LIVE_CHANNEL) return;
    const decoded = decodeNotifyPayload(msg.payload);
    if (!decoded) return;
    deliverLocal(decoded.userId, decoded.envelope);
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${LIVE_CHANNEL}`);
    if (s.client !== client) return; // superseded
    s.listenerState = 'listening';
    if (s.reconnectAttempt > 0) console.info('[live] LISTEN reconnected');
    s.reconnectAttempt = 0;
    startPing(client);
  } catch (err) {
    console.warn('[live] LISTEN connect failed', (err as Error)?.message);
    scheduleReconnect(client);
  }
}

function startPing(client: any) {
  const s = state();
  if (s.pingTimer) clearInterval(s.pingTimer);
  s.pingTimer = setInterval(() => {
    if (s.client !== client || s.listenerState !== 'listening') return;
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        console.warn('[live] LISTEN ping timed out');
        scheduleReconnect(client);
      }
    }, PING_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    client
      .query('SELECT 1')
      .then(() => {
        finished = true;
        clearTimeout(timer);
      })
      .catch(() => {
        finished = true;
        clearTimeout(timer);
        scheduleReconnect(client);
      });
  }, PING_INTERVAL_MS);
  (s.pingTimer as { unref?: () => void }).unref?.();
}

function scheduleReconnect(client: any) {
  const s = state();
  if (s.client !== client) return; // stale client event
  s.client = null;
  if (s.pingTimer) {
    clearInterval(s.pingTimer);
    s.pingTimer = null;
  }
  try {
    client.removeAllListeners?.('notification');
    client.on?.('error', () => {}); // swallow late errors from the dead client
    client.end?.().catch?.(() => {});
  } catch {
    /* ignore */
  }
  s.listenerState = 'backoff';
  s.stats.reconnects += 1;
  const delay = backoffMs(s.reconnectAttempt);
  s.reconnectAttempt += 1;
  if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    s.listenerState = 'idle';
    void connectListener();
  }, delay);
  (s.reconnectTimer as { unref?: () => void }).unref?.();
}

// ---------------------------------------------------------------------------
// Diagnostics / test hooks
// ---------------------------------------------------------------------------

export function liveBusStatus() {
  const s = state();
  return {
    transport: transport(),
    listenerState: s.listenerState,
    subscribers: s.total,
    users: s.subscribers.size,
    replayUsers: s.replay.size,
    stats: { ...s.stats },
  };
}

/** Test-only: reset process state and optionally inject a NOTIFY function / transport. */
export function __resetLiveBusForTests(opts: { transport?: LiveTransport; notify?: NotifyFn | null; listenerState?: LiveListenerState } = {}) {
  const s = state();
  if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
  if (s.pingTimer) clearInterval(s.pingTimer);
  s.subscribers.clear();
  s.replay.clear();
  s.recentDisconnect.clear();
  s.total = 0;
  s.seq = 0;
  s.client = null;
  s.reconnectTimer = null;
  s.pingTimer = null;
  s.reconnectAttempt = 0;
  s.transport = opts.transport ?? null;
  s.notifyOverride = opts.notify ?? null;
  s.listenerState = opts.listenerState ?? (opts.transport === 'pg' ? 'disabled' : 'idle');
  s.stats = { published: 0, delivered: 0, notifyErrors: 0, truncated: 0, degraded: 0, reconnects: 0 };
}
