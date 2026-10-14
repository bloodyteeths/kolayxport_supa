/**
 * GET /api/live/stream — Server-Sent Events stream of the signed-in user's
 * live events (owner W6-live).
 *
 *   - Auth: NextAuth session cookie (EventSource sends cookies; it cannot send
 *     headers). 401 otherwise.
 *   - Headers: text/event-stream, no-cache/no-transform (defeats Next gzip),
 *     X-Accel-Buffering: no (defeats nginx buffering).
 *   - On connect: `retry: 5000`, a `sync.status` hello carrying the server
 *     time and the stream user's key (liveUserKey), then any events missed
 *     since Last-Event-ID (header on native reconnect, `?lastEventId=` on
 *     manual reconnect).
 *   - Every 20 s a `: ping` comment (keeps nginx/proxies from idling out); every
 *     third ping also a `sync.status` heartbeat data frame so the client can
 *     detect a dead half-open connection (comments are invisible to EventSource).
 *   - Max 10 streams per user (oldest evicted), connection rotated after ~30 min
 *     and the session re-checked every ~5 min (closed when signed out or
 *     switched); slow consumers are dropped. A client that is already gone
 *     (closed during auth, or a destroyed socket on write) is torn down at once
 *     so it never holds a bus subscription or timers.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { liveBusStatus, replaySince, subscribeLive } from '@/lib/live/bus';
import { buildStatusEnvelope, formatSseComment, formatSseFrame, formatSseRetry, SSE_HEADERS } from '@/lib/live/sse';
import { LIVE_HEARTBEAT_MS, type LiveEnvelope } from '@/lib/live/types';
import { liveUserKey } from '@/lib/live/names';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    externalResolver: true,
  },
};

const RETRY_MS = 5000;
const MAX_LIFETIME_MS = 30 * 60_000;
/** Drop a client whose socket buffer grows past this (it is not reading). */
const MAX_BUFFERED_BYTES = 1024 * 1024;
/** Heartbeats between session re-checks (15 x 20 s = 5 min). */
const SESSION_RECHECK_BEATS = 15;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let user: { id: string } | null = null;
  try {
    user = await getAuthUser(req, res);
  } catch {
    user = null;
  }
  if (!user?.id) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).json({ error: 'unauthorized' });
  }
  const userId = user.id;

  res.writeHead(200, SSE_HEADERS);
  (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();
  const socket = req.socket;
  try {
    socket.setNoDelay(true);
    socket.setKeepAlive(true);
    socket.setTimeout(0);
  } catch {
    /* ignore */
  }

  const connectionId = Math.random().toString(36).slice(2, 10);
  const userKey = liveUserKey(userId);
  let closed = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  const gone = () => Boolean(res.destroyed || socket?.destroyed);

  const write = (chunk: string): boolean => {
    if (closed) return false;
    if (res.writableEnded || gone()) {
      // Client vanished without (or before we saw) a 'close' event: tear down now.
      close('destroyed');
      return false;
    }
    try {
      res.write(chunk);
      // compression middleware (if it still wrapped us) exposes flush()
      (res as unknown as { flush?: () => void }).flush?.();
      if (res.writableLength > MAX_BUFFERED_BYTES) {
        close('slow_consumer');
        return false;
      }
      return true;
    } catch {
      close('write_error');
      return false;
    }
  };

  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lifetime: ReturnType<typeof setTimeout> | null = null;

  function close(reason: string) {
    if (closed) return;
    // Ask the browser to come back quickly on planned closes.
    if ((reason === 'rotate' || reason === 'evicted') && !gone()) {
      try {
        res.write(formatSseRetry(reason === 'rotate' ? 250 : 15_000));
        res.write(formatSseComment(`close ${reason}`));
      } catch {
        /* ignore */
      }
    }
    closed = true;
    unsubscribe();
    unsubscribe = () => {};
    if (heartbeat) clearInterval(heartbeat);
    if (lifetime) clearTimeout(lifetime);
    heartbeat = null;
    lifetime = null;
    try {
      if (!res.writableEnded) res.end();
    } catch {
      /* ignore */
    }
    resolveDone();
  }

  req.on('close', () => close('client_closed'));
  res.on('close', () => close('res_closed'));
  res.on('error', () => close('res_error'));

  // The client may have disconnected while getAuthUser was awaited: its
  // 'close' events fired before the listeners above existed.
  if (gone()) {
    close('gone_before_setup');
    return done;
  }

  write(formatSseRetry(RETRY_MS));
  // Hello FIRST: it carries the stream's user key, and the browser ignores data
  // frames until it has checked that key against its own session.
  const transport = liveBusStatus().transport;
  write(formatSseFrame(buildStatusEnvelope('hello', transport, connectionId, Date.now(), userKey), { withId: false }));
  if (closed) return done;

  // Subscribe BEFORE replaying so nothing published in between is lost
  // (duplicates are dropped client-side by envelope id).
  const queued: LiveEnvelope[] = [];
  let replaying = true;
  const unsub = subscribeLive(
    userId,
    (env) => {
      if (closed) return;
      if (replaying) queued.push(env);
      else write(formatSseFrame(env));
    },
    { onEvict: () => close('evicted') },
  );
  // onEvict('global_limit') may already have closed us synchronously.
  if (closed) {
    unsub();
    return done;
  }
  unsubscribe = unsub;

  const headerId = req.headers['last-event-id'];
  const queryId = req.query.lastEventId;
  const lastEventId =
    (Array.isArray(headerId) ? headerId[0] : headerId) || (Array.isArray(queryId) ? queryId[0] : queryId) || null;
  const missed = replaySince(userId, lastEventId);
  const sent = new Set<string>();
  for (const env of missed) {
    if (closed) break;
    sent.add(env.id);
    write(formatSseFrame(env));
  }
  replaying = false;
  for (const env of queued) {
    if (closed) break;
    if (!sent.has(env.id)) write(formatSseFrame(env));
  }
  // write_error / slow_consumer during replay: never arm timers on a closed stream.
  if (closed) return done;

  let beats = 0;
  let checkingSession = false;
  heartbeat = setInterval(() => {
    if (closed) return;
    beats += 1;
    if (beats % 3 === 0) {
      write(formatSseFrame(buildStatusEnvelope('heartbeat', transport, connectionId), { withId: false }));
    } else {
      write(formatSseComment('ping'));
    }
    // Re-validate the session every SESSION_RECHECK_BEATS (~5 min): a signed-out
    // or switched account stops receiving this user's events well before rotation.
    if (beats % SESSION_RECHECK_BEATS === 0 && !checkingSession && !closed) {
      checkingSession = true;
      void recheckSession(req)
        .then((stillId) => {
          if (stillId === false) return; // could not tell (transient error): keep streaming
          if (stillId !== userId) close('session_changed');
        })
        .finally(() => {
          checkingSession = false;
        });
    }
  }, LIVE_HEARTBEAT_MS);

  lifetime = setTimeout(() => close('rotate'), MAX_LIFETIME_MS + Math.floor(Math.random() * 60_000));

  return done;
}

/**
 * Session re-check for an open stream. Headers are long sent, so NextAuth gets
 * a throwaway response object (it may try to set a refreshed cookie).
 * Returns the current user id, null when signed out, or false when unknown.
 */
async function recheckSession(req: NextApiRequest): Promise<string | null | false> {
  const sink = {
    headers: {} as Record<string, unknown>,
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return this.headers[String(name).toLowerCase()];
    },
    removeHeader(name: string) {
      delete this.headers[String(name).toLowerCase()];
    },
    status() {
      return this;
    },
    json() {
      return this;
    },
    send() {
      return this;
    },
    end() {
      return this;
    },
  };
  try {
    const u = await getAuthUser(req, sink as unknown as NextApiResponse, { allowBearer: false });
    return u?.id ?? null;
  } catch {
    return false;
  }
}
