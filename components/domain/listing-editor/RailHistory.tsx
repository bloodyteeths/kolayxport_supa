// components/domain/listing-editor/RailHistory.tsx: "Recent sends" in the editor's right rail (listing-editor
// §2, §7 "Recent sends"). A Timeline of the last 3 events, merged from the open draft's `syncAttempts`
// (`GET /api/etsy-drafts?shop_id&listing_id` → `draft.syncAttempts[]`) and, after a successful send has
// closed the draft, the synced drafts from `GET /api/etsy-drafts/history?shop_id&listing_id` (API G1 / BR-3).
// Attempt failures map to the `listings.sendError.*` causes (structured code first, then the English text), never shown raw.
// Read-only. The full history (restore) is the backend's `ListingHistoryPanel`, opened from the footer ⋯.
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { neutral as n, px, space } from '@/lib/ds/tokens';
import { Timeline, type TimelineEvent } from '@/components/ds/data/Timeline';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { Bone } from '@/components/ds/state/Skeletons';

/** `EtsyDraftSyncAttempt` as the drafts API returns it (dates as ISO strings). */
export interface RailSyncAttempt {
  id: string;
  /** `running` | `success` | `failed` | `conflict` (unknown values render as failed). */
  status: string;
  startedAt: string | Date;
  finishedAt?: string | Date | null;
  error?: string | null;
  /** Fields the attempt sent, when known. */
  fieldCount?: number | null;
  /** Draft the attempt belongs to (`EtsyDraftSyncAttempt.draftId`); lets a closed sent draft replace its own attempt. */
  draftId?: string | null;
  /** Structured outcome draftService writes on failure (`{ code, key }` of the `EtsyDraftError`). */
  result?: { code?: string | null; key?: string | null } | null;
}

/** A draft that was sent and closed (`EtsyListingDraft.status = 'synced'`). */
export interface RailSentDraft {
  id: string;
  syncedAt: string | Date;
  /** Field keys it changed (API G1 history). */
  changedKeys?: string[] | null;
}

export type HistoryKind = 'sent' | 'failed' | 'conflict' | 'running';

export interface HistoryItem {
  id: string;
  kind: HistoryKind;
  at: Date;
  fieldCount: number;
  /** Full i18n key of the failure cause (`listings.sendError.*`), failed only. */
  causeKey?: string;
}

const CAUSE_PREFIX = 'listings.sendError.';
const CAUSES = new Set(['conflict', 'interrupted', 'reconnect', 'rateLimited', 'notFound', 'rejected', 'generic']);

/** `EtsyDraftError.code` (lib/etsy/draftService.ts, etsyToken.ts, mediaSafety.ts) → cause. Checked before the text. */
const CODE_CAUSE: Record<string, string> = {
  ETSY_REAUTH_REQUIRED: 'reconnect',
  ETSY_REAUTH: 'reconnect',
  SHOP_NOT_FOUND: 'reconnect',
  REMOTE_CHANGED: 'conflict',
  DRAFT_SYNCING: 'interrupted',
  INVALID_FIELDS: 'rejected',
  INVALID_MEDIA: 'rejected',
  INVALID_ACTIONS: 'rejected',
  INVALID_LISTING_ID: 'rejected',
  DELETE_NOT_EXCLUSIVE: 'rejected',
  MEDIA_SOURCE_MISSING: 'rejected',
  MEDIA_PATH_REJECTED: 'rejected',
  MEDIA_URL_REJECTED: 'rejected',
  VALIDATION: 'rejected',
};

/**
 * Attempt → cause key (`listings.sendError.*`). The structured `result.code` / `result.key` wins; otherwise the
 * English error text is bucketed like the listings grid (`lib/listings/query.ts` `sendErrorKey`, server-only).
 * Only keys under `listings.sendError.` pass through, so a raw key is never shown.
 */
export function attemptCauseKey(
  error: string | null | undefined,
  result?: { code?: string | null; key?: string | null } | null,
): string {
  const key = typeof result?.key === 'string' ? result.key.trim() : '';
  if (key.startsWith(CAUSE_PREFIX) && CAUSES.has(key.slice(CAUSE_PREFIX.length))) return key;
  const code = typeof result?.code === 'string' ? result.code.trim().toUpperCase() : '';
  if (code && CODE_CAUSE[code]) return CAUSE_PREFIX + CODE_CAUSE[code];
  const raw = typeof error === 'string' ? error.trim() : '';
  if (raw.startsWith(CAUSE_PREFIX) && CAUSES.has(raw.slice(CAUSE_PREFIX.length))) return raw;
  const msg = raw.toLowerCase();
  if (!msg) return `${CAUSE_PREFIX}generic`;
  if (/server restart|interrupted|restarted/.test(msg)) return `${CAUSE_PREFIX}interrupted`;
  if (/access token|refresh token|token (?:has )?expired|invalid_grant|unauthori[sz]ed|reconnect|\b401\b|\b403\b|forbidden/.test(msg)) return `${CAUSE_PREFIX}reconnect`;
  if (/rate limit|too many requests|\b429\b/.test(msg)) return `${CAUSE_PREFIX}rateLimited`;
  if (/not found|\b404\b|no longer exists|deleted/.test(msg)) return `${CAUSE_PREFIX}notFound`;
  if (/price|quantity|title|tag|invalid|validation|must|required|\b400\b/.test(msg)) return `${CAUSE_PREFIX}rejected`;
  return `${CAUSE_PREFIX}generic`;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Merges attempts and sent drafts into newest-first events, `limit` long. Pure (tested). */
export function buildHistory(attempts: RailSyncAttempt[] = [], sent: RailSentDraft[] = [], limit = 3): HistoryItem[] {
  const out: HistoryItem[] = [];
  const seen = new Set<string>();
  // A sent draft row and its own successful attempt are the same send: keep the history row (it has the count).
  const sentDraftIds = new Set(sent.map((d) => String(d.id)));
  for (const a of attempts) {
    const at = toDate(a.finishedAt) ?? toDate(a.startedAt);
    if (!at || seen.has(`a:${a.id}`)) continue;
    seen.add(`a:${a.id}`);
    const status = String(a.status || '').toLowerCase();
    const kind: HistoryKind = status === 'success' || status === 'synced' ? 'sent'
      : status === 'running' || status === 'syncing' ? 'running'
        : status === 'conflict' ? 'conflict' : 'failed';
    if (kind === 'sent' && a.draftId && sentDraftIds.has(String(a.draftId))) continue;
    out.push({
      id: `a:${a.id}`,
      kind,
      at,
      fieldCount: typeof a.fieldCount === 'number' && a.fieldCount > 0 ? a.fieldCount : 0,
      ...(kind === 'failed' ? { causeKey: attemptCauseKey(a.error, a.result) } : {}),
    });
  }
  for (const d of sent) {
    const at = toDate(d.syncedAt);
    if (!at || seen.has(`d:${d.id}`)) continue;
    seen.add(`d:${d.id}`);
    out.push({ id: `d:${d.id}`, kind: 'sent', at, fieldCount: Array.isArray(d.changedKeys) ? new Set(d.changedKeys).size : 0 });
  }
  return out.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, Math.max(0, limit));
}

function readArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    for (const k of ['drafts', 'items', 'history', 'data']) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/** Tolerant parse of `GET /api/etsy-drafts/history` (API G1: last synced drafts with `syncedAt` + changed keys). */
export function parseSentDrafts(body: unknown): RailSentDraft[] {
  return readArray(body).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const r = raw as Record<string, unknown>;
    const id = r.id ?? r.draftId;
    const syncedAt = r.syncedAt ?? r.synced_at ?? r.updatedAt;
    if ((typeof id !== 'string' && typeof id !== 'number') || (typeof syncedAt !== 'string' && !(syncedAt instanceof Date))) return [];
    const keys = [r.changedKeys, r.keys, r.fields].find(Array.isArray) as unknown[] | undefined;
    return [{ id: String(id), syncedAt, changedKeys: keys ? keys.filter((k): k is string => typeof k === 'string') : null }];
  });
}

export interface SendHistoryState {
  sent: RailSentDraft[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}

/**
 * Loads the last sent drafts for one Etsy listing. Disabled (no request) for eBay, create mode (no listing id)
 * or when `enabled` is false. Call `retry` after a send to refresh.
 */
export function useSendHistory(opts: { marketplace: 'etsy' | 'ebay'; shopId?: string | null; listingId?: string | null; enabled?: boolean; limit?: number }): SendHistoryState {
  const { marketplace, shopId, listingId, enabled = true, limit = 3 } = opts;
  const active = enabled && marketplace === 'etsy' && !!shopId && !!listingId && !String(listingId).startsWith('-');
  const [state, setState] = useState<{ sent: RailSentDraft[]; loading: boolean; error: boolean }>({ sent: [], loading: active, error: false });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!active) {
      setState({ sent: [], loading: false, error: false });
      return undefined;
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setState((s) => ({ ...s, loading: true, error: false }));
    const qs = new URLSearchParams({ shop_id: String(shopId), listing_id: String(listingId), limit: String(limit) });
    fetch(`/api/etsy-drafts/history?${qs.toString()}`, { signal: ctrl?.signal, credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body: unknown = await res.json();
        if (!ctrl?.signal.aborted) setState({ sent: parseSentDrafts(body), loading: false, error: false });
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') return;
        if (!ctrl?.signal.aborted) setState((s) => ({ ...s, loading: false, error: true }));
      });
    return () => ctrl?.abort();
  }, [active, shopId, listingId, limit, nonce]);

  const retry = useCallback(() => setNonce((x) => x + 1), []);
  return { ...state, retry };
}

export interface RailHistoryProps {
  marketplace: 'etsy' | 'ebay';
  /** The open draft's attempts (newest first or any order). */
  attempts?: RailSyncAttempt[];
  /** Closed sent drafts (`useSendHistory().sent`). */
  sent?: RailSentDraft[];
  /** History request state (`useSendHistory`). Attempts still render while it loads or fails. */
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  limit?: number;
  'data-testid'?: string;
}

const MP_NAME = { etsy: 'Etsy', ebay: 'eBay' } as const;
const TONE = { sent: 'success', failed: 'danger', conflict: 'warning', running: 'info' } as const;

export function RailHistory({ marketplace, attempts, sent, loading, error, onRetry, limit = 3, 'data-testid': testId }: RailHistoryProps) {
  const t = useTranslations('listingEditor.history');
  const tAll = useTranslations();
  const items = buildHistory(attempts, sent, limit);
  const mp = MP_NAME[marketplace];

  const events: TimelineEvent[] = items.map((it) => ({
    id: it.id,
    at: it.at,
    tone: TONE[it.kind],
    label:
      it.kind === 'sent' ? t('sent', { count: it.fieldCount })
        : it.kind === 'running' ? t('running')
          : it.kind === 'conflict' ? t('conflict', { marketplace: mp })
            : t('failedCause', { cause: tAll(it.causeKey ?? 'listings.sendError.generic') }),
  }));

  return (
    <Box data-testid={testId ?? 'rail-history'} sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
      <Typography component="h3" variant="titleSm" sx={{ m: 0, color: n[800] }}>{t('title')}</Typography>
      {events.length > 0 && <Timeline events={events} dateMode="relative" />}
      {loading && events.length === 0 && (
        <Box aria-busy="true" sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
          <Bone w="70%" h={12} />
          <Bone w="50%" h={12} />
        </Box>
      )}
      {error && <ErrorState variant="inline" title={t('loadFailed')} onRetry={onRetry} />}
      {!loading && !error && events.length === 0 && (
        <Typography component="p" variant="dense" sx={{ m: 0, color: n[500] }}>{t('empty')}</Typography>
      )}
    </Box>
  );
}

export default RailHistory;
