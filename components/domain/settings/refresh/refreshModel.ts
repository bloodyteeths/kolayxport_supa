// components/domain/settings/refresh/refreshModel.ts — pure mapping for Settings › Refresh history (settings §8).
// Input: one item of GET /api/sync/history `syncs[]` (unchanged contract). No React, no i18n.
import { runStatus, type RunStatusKey } from '@/lib/ds/status';
import { logoDisplayName } from '@/lib/ds/logos';

/** GET /api/sync/history item (pages/api/sync/history.ts). */
export interface RawSyncRun {
  id: string;
  type: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  processedOrders?: number | null;
  successfulOrders?: number | null;
  failedOrders?: number | null;
  errors?: unknown;
}

export interface SyncHistoryPage {
  syncs: RawSyncRun[];
  nextCursor: string | null;
}

/** `settings.refresh.types.<key>`; `store` takes `{ store }`. */
export type RunTypeKey = 'full' | 'scheduled' | 'manual' | 'recent' | 'product' | 'store' | 'other';

export interface RunError {
  message: string;
  orderId: string | null;
}

export interface RunRow {
  id: string;
  rawType: string;
  typeKey: RunTypeKey;
  /** Display name for `typeKey === 'store'` ("Etsy", "DHL eCommerce"). */
  store: string | null;
  status: RunStatusKey | null;
  rawStatus: string;
  startedAt: string | null;
  endedAt: string | null;
  /** null while running or when a timestamp is missing / out of order. */
  durationMs: number | null;
  processed: number;
  successful: number;
  failed: number;
  errors: RunError[];
}

const TYPE_ALIASES: Record<string, RunTypeKey> = {
  full: 'full', full_sync: 'full', fullsync: 'full',
  scheduled: 'scheduled', cron: 'scheduled', auto: 'scheduled', automatic: 'scheduled',
  manual: 'manual',
  recent: 'recent', orders: 'recent',
  product: 'product', products: 'product', inventory: 'product',
};

/** "veeqo_full" → store veeqo; "trendyol" → store trendyol; "full" → full. */
export function runType(raw: string | null | undefined): { key: RunTypeKey; store: string | null } {
  const r = (raw ?? '').trim().toLowerCase();
  if (!r) return { key: 'other', store: null };
  if (TYPE_ALIASES[r]) return { key: TYPE_ALIASES[r], store: null };
  const head = r.split(/[_\s-]/)[0];
  const name = logoDisplayName(head);
  if (name) return { key: 'store', store: name };
  return { key: 'other', store: null };
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function toTime(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** metrics.errors is `{ orderId, error }[]` (lib/sync-status.ts); anything else is shown as text. */
export function runErrors(raw: unknown): RunError[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      const msg = typeof o.error === 'string' ? o.error : typeof o.message === 'string' ? o.message : JSON.stringify(o);
      const id = typeof o.orderId === 'string' || typeof o.orderId === 'number' ? String(o.orderId) : null;
      return { message: msg, orderId: id };
    }
    return { message: String(e), orderId: null };
  });
}

export function toRunRow(r: RawSyncRun): RunRow {
  const { key, store } = runType(r.type);
  const status = runStatus(r.status);
  const s = toTime(r.startedAt);
  const e = toTime(r.endedAt);
  const durationMs = status === 'running' || s === null || e === null || e < s ? null : e - s;
  return {
    id: r.id,
    rawType: r.type ?? '',
    typeKey: key,
    store,
    status,
    rawStatus: r.status ?? '',
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs,
    processed: n(r.processedOrders),
    successful: n(r.successfulOrders),
    failed: n(r.failedOrders),
    errors: runErrors(r.errors),
  };
}

/**
 * Same threshold the backend uses before it marks an `in_progress` run as failed (lib/sync-status.ts startSync).
 * The backend only does that when the next sync of the same type starts, so a run orphaned by a restart stays
 * `in_progress` until then; the UI must not let it block "Refresh all orders" or poll forever.
 */
export const STALE_RUN_MS = 15 * 60_000;

/** A run that is `running` and has a heartbeat (`endedAt` = updatedAt while running, else `startedAt`) < 15 min old. */
export function isActiveRun(r: RunRow, now: number = Date.now()): boolean {
  if (r.status !== 'running') return false;
  const t = toTime(r.endedAt) ?? toTime(r.startedAt);
  return t !== null && now - t < STALE_RUN_MS;
}

/** Any active (non-stale) running run. Stale `in_progress` rows still show their pill but do not count. */
export const isRunning = (rows: readonly RunRow[], now: number = Date.now()) => rows.some((r) => isActiveRun(r, now));

/**
 * "Last successful refresh: today 10:42 · Etsy, eBay": the newest completed run, plus the store names of the
 * completed store runs within 24 h before it (de-duplicated, newest first). Rows are newest first (API order).
 */
export function lastSuccess(rows: readonly RunRow[]): { at: string; sources: string[] } | null {
  const done = rows.filter((r) => r.status === 'completed' && (r.endedAt || r.startedAt));
  if (!done.length) return null;
  const top = done[0];
  const at = (top.endedAt || top.startedAt) as string;
  const atMs = toTime(at) ?? 0;
  const sources: string[] = [];
  for (const r of done) {
    const ms = toTime(r.endedAt || r.startedAt) ?? 0;
    if (atMs - ms > 24 * 3600_000) break;
    if (r.store && !sources.includes(r.store)) sources.push(r.store);
  }
  return { at, sources };
}

/** Pretty JSON of a run's raw errors for "Copy error details". */
export function errorDetailsText(row: RunRow): string {
  return JSON.stringify(row.errors.map((e) => ({ orderId: e.orderId, error: e.message })), null, 2);
}

export const canRetry = (row: RunRow) => row.status === 'failed';
