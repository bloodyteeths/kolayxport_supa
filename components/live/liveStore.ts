/**
 * Browser-side live state shared by LiveEventsProvider, useLiveEvent and
 * LiveSoundToggle (owner W6-live). Module-level stores (no React context), so
 * consumers work wherever they are mounted.
 */
import type { LiveEnvelope, LiveEvent } from '@/lib/live/types';
import { liveEventName, liveEventNames } from '@/lib/live/names';

/** window CustomEvent name; `detail` is a LiveClientEvent. */
export const LIVE_WINDOW_EVENT = 'kx:live';

export type LiveClientEvent = {
  /** envelope id (unique; synthetic events use `local-*`) */
  id: string;
  /** epoch ms when published */
  ts: number;
  /** canonical name, e.g. 'order.new' */
  name: string;
  /** every name it answers to (aliases, type, type.*, '*') */
  names: string[];
  event: LiveEvent;
};

export function toClientEvent(env: LiveEnvelope): LiveClientEvent {
  return {
    id: env.id,
    ts: env.ts,
    name: env.name || liveEventName(env.event),
    names: liveEventNames(env.event),
    event: env.event,
  };
}

export function dispatchLiveWindowEvent(detail: LiveClientEvent): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<LiveClientEvent>(LIVE_WINDOW_EVENT, { detail }));
  } catch {
    /* ignore */
  }
}

let syntheticSeq = 0;
/** A client-made envelope (reconnected / polling status). */
export function syntheticEnvelope(event: LiveEvent): LiveEnvelope {
  syntheticSeq += 1;
  const now = Date.now();
  return { id: `local-${now.toString(36)}-${syntheticSeq}`, v: 1, ts: now, event, name: liveEventName(event) };
}

// ---------------------------------------------------------------------------
// Connection status store
// ---------------------------------------------------------------------------

/**
 * idle       provider not mounted / disabled
 * connecting opening (or natively re-opening) the stream
 * live       stream up (hello received)
 * offline    disconnected, retrying with backoff
 * polling    disconnected > 60 s: falling back to periodic revalidation
 */
export type LiveConnectionStatus = 'idle' | 'connecting' | 'live' | 'offline' | 'polling';

export type LiveStatusSnapshot = {
  status: LiveConnectionStatus;
  /** epoch ms of the last status change */
  since: number;
  /** this tab holds the stream (others receive events over BroadcastChannel) */
  leader: boolean;
};

let statusSnap: LiveStatusSnapshot = { status: 'idle', since: 0, leader: false };
const statusListeners = new Set<() => void>();

export function getLiveStatus(): LiveStatusSnapshot {
  return statusSnap;
}

export function setLiveStatus(patch: Partial<LiveStatusSnapshot>): void {
  const next: LiveStatusSnapshot = { ...statusSnap, ...patch };
  if (next.status !== statusSnap.status) next.since = Date.now();
  if (next.status === statusSnap.status && next.leader === statusSnap.leader) return;
  statusSnap = next;
  for (const l of Array.from(statusListeners)) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeLiveStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

const SERVER_STATUS: LiveStatusSnapshot = { status: 'idle', since: 0, leader: false };
export function getServerLiveStatus(): LiveStatusSnapshot {
  return SERVER_STATUS;
}

// ---------------------------------------------------------------------------
// Recently arrived orders (for a "new" chip / row highlight on the orders page)
// ---------------------------------------------------------------------------

const RECENT_TTL_MS = 15 * 60_000;
let recentOrders: ReadonlyMap<string, number> = new Map();
const recentListeners = new Set<() => void>();

export function markRecentOrder(orderId: string, at = Date.now()): void {
  if (!orderId) return;
  const next = new Map(recentOrders);
  next.set(orderId, at);
  for (const [id, ts] of next) if (at - ts > RECENT_TTL_MS) next.delete(id);
  recentOrders = next;
  for (const l of Array.from(recentListeners)) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function getRecentOrders(): ReadonlyMap<string, number> {
  return recentOrders;
}

const EMPTY_RECENT: ReadonlyMap<string, number> = new Map();
export function getServerRecentOrders(): ReadonlyMap<string, number> {
  return EMPTY_RECENT;
}

export function subscribeRecentOrders(listener: () => void): () => void {
  recentListeners.add(listener);
  return () => {
    recentListeners.delete(listener);
  };
}

export const LIVE_RECENT_ORDER_TTL_MS = RECENT_TTL_MS;

// ---------------------------------------------------------------------------
// Resume state (survives LiveEventsProvider remounts within one page load)
// ---------------------------------------------------------------------------

/**
 * Kept at module scope so an unmount/remount of the provider (client-side
 * navigation, `enabled` flapping) reconnects with `?lastEventId=` and the server
 * replays the gap, already-handled envelopes are not re-chimed, and the "(N)"
 * title counter is not lost. Scoped by user key: a different account starts fresh.
 */
export type LiveResumeState = {
  userKey: string;
  lastEventId: string | null;
  seen: Set<string>;
  seenOrder: string[];
  unseenOrders: number;
};

const RESUME_SEEN_MAX = 400;
let resumeState: LiveResumeState | null = null;

export function getLiveResumeState(userKey: string): LiveResumeState {
  if (!resumeState || resumeState.userKey !== userKey) {
    resumeState = { userKey, lastEventId: null, seen: new Set(), seenOrder: [], unseenOrders: 0 };
  }
  return resumeState;
}

/** Records an envelope id; false when it was already seen. */
export function markLiveSeen(st: LiveResumeState, id: string): boolean {
  if (st.seen.has(id)) return false;
  st.seen.add(id);
  st.seenOrder.push(id);
  while (st.seenOrder.length > RESUME_SEEN_MAX) st.seen.delete(st.seenOrder.shift() as string);
  return true;
}

export function __resetLiveResumeStateForTests(): void {
  resumeState = null;
}
