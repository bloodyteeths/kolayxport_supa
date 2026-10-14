/**
 * Pure stock arithmetic shared by the engine, push worker, observation and
 * preview (W2). No I/O — unit tested in test/stock/*.
 */

/** Push reasons. Only RAISE_ALLOWED reasons may send a quantity above the fresh remote read. */
export type PushReason = 'sale' | 'cancel' | 'adjust' | 'remote_adjust' | 'reconcile' | 'manual' | 'seed' | 'restore';

export const RAISE_ALLOWED_REASONS: ReadonlySet<string> = new Set(['cancel', 'manual', 'seed', 'restore', 'adjust']);

export function reasonAllowsRaise(reason: string | null | undefined): boolean {
  return RAISE_ALLOWED_REASONS.has(String(reason || ''));
}

const PUSH_REASONS: ReadonlySet<string> = new Set(['sale', 'cancel', 'adjust', 'remote_adjust', 'reconcile', 'manual', 'seed', 'restore']);

/** A stored reason string back to a PushReason (unknown -> 'reconcile', lower-only). */
export function asPushReason(r: string | null | undefined): PushReason {
  return PUSH_REASONS.has(String(r || '')) ? (r as PushReason) : 'reconcile';
}

/**
 * Pure: push reason for a settings edit that changes a link target. Only an
 * edit that can RAISE the target (lower buffer, fewer units per sale, higher
 * or removed max) uses 'adjust'; one that can only lower it uses 'reconcile'
 * (never raises above the fresh remote read). null = nothing to push.
 */
export function reasonForTargetEdit(direction: 'raise' | 'lower' | 'none'): PushReason | null {
  if (direction === 'raise') return 'adjust';
  if (direction === 'lower') return 'reconcile';
  return null;
}

/** Direction of a numeric setting where a LARGER value lowers the target (buffers, units per sale). */
export function directionWhenLargerLowers(before: number | null | undefined, after: number | null | undefined): 'raise' | 'lower' | 'none' {
  const b = Number(before ?? 0);
  const a = Number(after ?? 0);
  if (a === b) return 'none';
  return a > b ? 'lower' : 'raise';
}

/** Direction of a max-listed cap change (null = no cap = infinity). */
export function directionForMaxChange(before: number | null | undefined, after: number | null | undefined): 'raise' | 'lower' | 'none' {
  const b = before === null || before === undefined ? Infinity : before;
  const a = after === null || after === undefined ? Infinity : after;
  if (a === b) return 'none';
  return a > b ? 'raise' : 'lower';
}

/** When two enqueues collapse into one pending push, keep the right to raise if either had it. */
export function mergePushReason(existing: string | null | undefined, incoming: string): string {
  if (reasonAllowsRaise(incoming)) return incoming;
  if (reasonAllowsRaise(existing)) return String(existing);
  return incoming;
}

/**
 * Quantity a link should show on its marketplace:
 *   min(maxListedQty ?? ∞, floor(max(0, onHand - item.safetyBuffer - link.buffer) / unitsPerSale))
 */
export function computeLinkTarget(a: {
  onHand: number;
  safetyBuffer?: number | null;
  buffer?: number | null;
  unitsPerSale?: number | null;
  maxListedQty?: number | null;
}): number {
  const units = Math.max(1, Math.trunc(Number(a.unitsPerSale) || 1));
  const avail = Math.max(0, Math.trunc(Number(a.onHand) || 0) - Math.max(0, Math.trunc(Number(a.safetyBuffer) || 0)) - Math.max(0, Math.trunc(Number(a.buffer) || 0)));
  let t = Math.floor(avail / units);
  if (a.maxListedQty !== null && a.maxListedQty !== undefined && Number.isFinite(Number(a.maxListedQty))) {
    t = Math.min(t, Math.max(0, Math.trunc(Number(a.maxListedQty))));
  }
  return Math.max(0, t);
}

/**
 * The quantity actually sent: decreasing reasons never raise a remote above
 * its fresh read (a sale may already have landed there since we computed the
 * target). Returns null when nothing should be sent (no change).
 */
export function decideSendQty(target: number, freshRemote: number, reason: string): number | null {
  const t = Math.max(0, Math.trunc(target));
  const f = Math.max(0, Math.trunc(freshRemote));
  const send = reasonAllowsRaise(reason) ? t : Math.min(t, f);
  return send === f ? null : send;
}

/** Retry backoff for retryable push failures: 30s, 2m, 10m, 30m, 2h (then 2h). */
export const PUSH_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];
export const PUSH_MAX_ATTEMPTS = 6;

export function pushBackoffMs(attempts: number): number {
  const i = Math.max(0, Math.min(PUSH_BACKOFF_MS.length - 1, attempts - 1));
  return PUSH_BACKOFF_MS[i];
}

// ---------------------------------------------------------------------------
// Observation classification (T5). Pure: given the link's expected state and
// a fresh remote quantity, decide what the observation means.
// ---------------------------------------------------------------------------

export type ObservationKind =
  | 'stale_ignored'
  | 'echo'
  | 'baseline'
  | 'expected'
  | 'unattributed_drop'
  | 'increase_alert'
  | 'deferred';

export function classifyObservation(a: {
  remoteQty: number;
  remoteUpdatedTs: number;
  lastSeenRemoteQty: number | null;
  lastSeenRemoteTs: number | null;
  isOwnEcho: boolean;
}): { kind: ObservationKind; delta: number | null } {
  if (a.lastSeenRemoteTs !== null && a.lastSeenRemoteTs !== undefined && a.remoteUpdatedTs > 0 && a.remoteUpdatedTs < a.lastSeenRemoteTs) {
    return { kind: 'stale_ignored', delta: null };
  }
  if (a.isOwnEcho) return { kind: 'echo', delta: a.lastSeenRemoteQty === null ? null : a.remoteQty - a.lastSeenRemoteQty };
  if (a.lastSeenRemoteQty === null || a.lastSeenRemoteQty === undefined) return { kind: 'baseline', delta: null };
  const delta = a.remoteQty - a.lastSeenRemoteQty;
  if (delta === 0) return { kind: 'expected', delta: 0 };
  if (delta < 0) return { kind: 'unattributed_drop', delta };
  return { kind: 'increase_alert', delta };
}

/**
 * Sale against the origin link (T2). Part of the sale may already have been
 * counted as an unattributed remote drop (the marketplace decremented its
 * quantity and we observed that before the order arrived).
 *
 *   absorbedQty = min(qty, unattributedDrop)       (listing units, already counted)
 *   restQty     = qty - absorbedQty                (not yet seen remotely)
 *   lastSeenRemoteQty -= restQty                   (expected state, when known)
 *
 * Stock units = listing units × unitsPerSale.
 */
export function splitSaleAgainstOrigin(a: {
  qty: number;
  unitsPerSale: number;
  unattributedDrop: number;
  lastSeenRemoteQty: number | null;
}): {
  absorbedQty: number;
  restQty: number;
  saleUnits: number;
  absorbedUnits: number;
  netOnHandDelta: number;
  nextUnattributedDrop: number;
  nextLastSeenRemoteQty: number | null;
} {
  const qty = Math.max(0, Math.trunc(a.qty));
  const u = Math.max(1, Math.trunc(a.unitsPerSale || 1));
  const absorbedQty = Math.min(qty, Math.max(0, Math.trunc(a.unattributedDrop || 0)));
  const restQty = qty - absorbedQty;
  return {
    absorbedQty,
    restQty,
    saleUnits: qty * u,
    absorbedUnits: absorbedQty * u,
    netOnHandDelta: -(restQty * u),
    nextUnattributedDrop: Math.max(0, Math.trunc(a.unattributedDrop || 0)) - absorbedQty,
    nextLastSeenRemoteQty: a.lastSeenRemoteQty === null || a.lastSeenRemoteQty === undefined ? null : Math.max(0, a.lastSeenRemoteQty - restQty),
  };
}

/** Units reserved for listing via several channels: the review rule of T11. */
export function groupNeedsReview(quantities: number[]): boolean {
  const q = quantities.filter((n) => Number.isFinite(n));
  if (q.length === 0) return true;
  if (q.some((n) => n <= 0)) return true;
  if (q.some((n) => n >= 100)) return true;
  const max = Math.max(...q);
  const min = Math.min(...q);
  return min > 0 && max / min > 5;
}

/**
 * Seed quantity for a matched group (T11, founder policy A by default).
 *   min          — lowest remote quantity across channels minus reserved units
 *   etsy_master  — Etsy quantity (min of Etsy links) minus reserved
 *   manual       — null (user enters it)
 */
export function computeSeedQty(a: {
  policy: string;
  remote: Array<{ channel: string; qty: number; unitsPerSale?: number }>;
  reservedUnits: number;
  subtractReserved: boolean;
}): number | null {
  if (a.policy === 'manual') return null;
  const pool = a.policy === 'etsy_master' ? a.remote.filter((r) => r.channel === 'etsy') : a.remote;
  if (pool.length === 0) return null;
  const units = pool.map((r) => Math.max(0, Math.trunc(r.qty)) * Math.max(1, Math.trunc(r.unitsPerSale || 1)));
  const base = Math.min(...units);
  const reserved = a.subtractReserved ? Math.max(0, Math.trunc(a.reservedUnits || 0)) : 0;
  return Math.max(0, base - reserved);
}
