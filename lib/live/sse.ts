/**
 * Server-Sent Events framing for the live stream (owner W6-live). Pure.
 *
 * Frames are UNNAMED (`message`) so one EventSource.onmessage handler receives
 * every event type; the canonical name travels inside the envelope (`name`).
 * Named SSE events would silently drop any name the client did not register.
 */
import type { LiveEnvelope } from './types';
import { LIVE_EVENT_VERSION } from './types';
import { liveEventName } from './names';

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  // no-transform: stops Next's built-in gzip (compress: true) from buffering the stream.
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // nginx: disable proxy buffering for this response.
  'X-Accel-Buffering': 'no',
};

/** SSE ids/data must not contain CR/LF; JSON.stringify never emits raw newlines. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ');
}

/**
 * `withId: false` for transport status frames: the browser keeps the last
 * `id:` it saw and sends it back as Last-Event-ID on reconnect, so only real
 * (replayable) bus events may set it.
 */
export function formatSseFrame(envelope: LiveEnvelope, opts: { withId?: boolean } = {}): string {
  const withName: LiveEnvelope = envelope.name ? envelope : { ...envelope, name: liveEventName(envelope.event) };
  const idLine = opts.withId === false ? '' : `id: ${oneLine(withName.id)}\n`;
  return `${idLine}data: ${JSON.stringify(withName)}\n\n`;
}

export function formatSseComment(text = 'ping'): string {
  return `: ${oneLine(text)}\n\n`;
}

export function formatSseRetry(ms: number): string {
  return `retry: ${Math.max(0, Math.round(ms))}\n\n`;
}

/** Transport-level status envelope (hello / heartbeat). Not published on the bus. */
export function buildStatusEnvelope(
  phase: 'hello' | 'heartbeat',
  transport: 'pg' | 'local',
  connectionId: string,
  now = Date.now(),
  userKey?: string,
): LiveEnvelope {
  return {
    id: `${now.toString(36)}-${connectionId}-${phase === 'hello' ? 'h' : 'b'}`,
    v: LIVE_EVENT_VERSION,
    ts: now,
    name: 'sync.status',
    event: {
      type: 'sync',
      kind: 'status',
      scope: 'stream',
      phase,
      serverTime: now,
      transport,
      ...(userKey ? { userKey } : {}),
    },
  };
}
