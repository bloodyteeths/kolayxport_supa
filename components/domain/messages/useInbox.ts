// components/domain/messages/useInbox.ts (messages G5) — the conversation list data (messages §5.1 list
// rows, §5.3 polling / send / mark seen, §6.1 `GET list` cursor).
//
// - `useSWRInfinite` over `GET /api/messages?action=list&platform=&view=&size=&cursor=`; "Load more" adds
//   the next cursor page. A poll re-fetches the first page (newest conversations) only.
// - Merge / keep-on-failure (today's rule, kept): when a platform reports a `platformErrors` entry, its rows
//   from the last good response stay listed; the open thread stays listed even if it left the view.
// - `locallyAnswered` (kept from the legacy page): a conversation answered from this tab stays answered until
//   the platform catches up, so a poll can never re-open a Trendyol one-shot answer. A newer customer message
//   re-opens a Wix thread.
// - Seen state is optimistic (`markSeen` POST is fire-and-forget). Until BR-4 (`InboxThread`) is deployed the
//   server answers `readStateStore: 'memory'`; the UI works the same, the dot just resets on a server restart.
// - Polling: every 120 s while the tab is visible, plus on focus / `visibilitychange` (SWR). Never swaps in
//   skeletons (data is kept while revalidating).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { useAsyncRegion, type AsyncState } from '@/lib/ds/useAsyncState';
import useMessageCountStore from '@/lib/stores/useMessageCountStore';
import type {
  InboxListResponse,
  InboxView,
  MessagePlatform,
  PlatformError,
  PlatformErrorCode,
  UnifiedConversation,
} from '@/types/messages';
import { toOpenKey, type InboxStore } from './useInboxUrlState';
import { isMessagePlatform, MESSAGE_PLATFORMS } from '@/lib/messages/platforms';

export const INBOX_PAGE_SIZE = 30;
export const INBOX_POLL_MS = 120_000;
export const COUNT_REFRESH_DELAY_MS = 4_000;

const PLATFORMS: readonly MessagePlatform[] = MESSAGE_PLATFORMS;

/** `useConnections().has()` per inbox platform (undefined = still loading). Hepsiburada is optional for older callers. */
export type InboxConnected = { wix: boolean | undefined; trendyol: boolean | undefined; hepsiburada?: boolean | undefined };
const ERROR_CODES: readonly PlatformErrorCode[] = ['permission', 'auth', 'credentials', 'rateLimited', 'unavailable'];

export const convKey = toOpenKey;

// ── pure helpers (unit-tested) ──────────────────────────────────────────────────────────────────────────

/** SWR infinite key for page `index`; null stops paging (previous page had no `nextCursor`). */
export function inboxPageKey(
  index: number,
  prev: InboxListResponse | null,
  params: { platform: InboxStore; view: InboxView; size?: number },
): string | null {
  if (index > 0 && (!prev || !prev.nextCursor)) return null;
  const q = new URLSearchParams({ action: 'list', platform: params.platform, view: params.view, size: String(params.size ?? INBOX_PAGE_SIZE) });
  if (index > 0 && prev?.nextCursor) q.set('cursor', prev.nextCursor);
  return `/api/messages?${q.toString()}`;
}

export class InboxFetchError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code?: string, message?: string) {
    super(message || `messages list ${status}`);
    this.status = status;
    this.code = code;
  }
}

const isPlatform = isMessagePlatform;

/** Defensive parse of a list body (old servers, partial payloads). */
export function parseInboxPage(raw: unknown): InboxListResponse {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const conversations = Array.isArray(r.conversations)
    ? (r.conversations as unknown[]).filter((c): c is UnifiedConversation => !!c && typeof c === 'object' && isPlatform((c as UnifiedConversation).platform) && typeof (c as UnifiedConversation).id === 'string')
    : [];
  const platformErrors = Array.isArray(r.platformErrors)
    ? (r.platformErrors as unknown[]).filter(
        (e): e is PlatformError => !!e && typeof e === 'object' && isPlatform((e as PlatformError).platform) && ERROR_CODES.includes((e as PlatformError).code),
      )
    : [];
  const enabledPlatforms = Array.isArray(r.enabledPlatforms) ? (r.enabledPlatforms as unknown[]).filter(isPlatform) : [];
  return {
    conversations,
    totalCount: typeof r.totalCount === 'number' ? r.totalCount : conversations.length,
    unansweredCount: typeof r.unansweredCount === 'number' ? r.unansweredCount : 0,
    page: typeof r.page === 'number' ? r.page : 0,
    pageSize: typeof r.pageSize === 'number' ? r.pageSize : conversations.length,
    nextCursor: typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null,
    enabledPlatforms,
    platformErrors,
    errors: Array.isArray(r.errors) ? (r.errors as unknown[]).filter((e): e is string => typeof e === 'string') : [],
    fetchedAt: typeof r.fetchedAt === 'string' ? r.fetchedAt : '',
    readStateStore: r.readStateStore === 'db' ? 'db' : 'memory',
  };
}

export async function inboxFetcher(url: string): Promise<InboxListResponse> {
  const res = await fetch(url, { credentials: 'same-origin' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { code?: string; error?: string };
    throw new InboxFetchError(res.status, b.code, b.error);
  }
  return parseInboxPage(body);
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** `lastMessageAt` desc, unknown times last (P6), then key for a stable order. */
export function sortConversations(rows: readonly UnifiedConversation[]): UnifiedConversation[] {
  return [...rows].sort((a, b) => {
    const ta = timeOf(a.lastMessageAt);
    const tb = timeOf(b.lastMessageAt);
    if (ta === null && tb !== null) return 1;
    if (tb === null && ta !== null) return -1;
    if (ta !== null && tb !== null && ta !== tb) return tb - ta;
    return convKey(a) < convKey(b) ? -1 : convKey(a) > convKey(b) ? 1 : 0;
  });
}

export interface InboxSnapshot {
  /** Rows per platform from the last response in which that platform did not fail. */
  goodByPlatform: Partial<Record<MessagePlatform, UnifiedConversation[]>>;
  /** Every row shown last time, by key (keeps the open thread listed). */
  shown: Map<string, UnifiedConversation>;
}

export const EMPTY_SNAPSHOT: InboxSnapshot = { goodByPlatform: {}, shown: new Map() };

export interface MergedInbox {
  rows: UnifiedConversation[];
  enabledPlatforms: MessagePlatform[];
  platformErrors: PlatformError[];
  nextCursor: string | null;
  fetchedAt: string | null;
  readStateStore: 'db' | 'memory';
  snapshot: InboxSnapshot;
}

/**
 * Pure merge of the loaded pages with the previous snapshot:
 * dedupe by key (first page wins), a platform that failed keeps its last good rows, the `keepKey` row stays.
 * Platform errors are the union of every page's errors (one per platform).
 */
export function mergeInboxPages(pages: readonly InboxListResponse[], previous: InboxSnapshot, keepKey: string | null): MergedInbox {
  const byKey = new Map<string, UnifiedConversation>();
  const errors = new Map<MessagePlatform, PlatformError>();
  const enabled = new Set<MessagePlatform>();
  for (const p of pages) {
    p.platformErrors.forEach((e) => {
      if (!errors.has(e.platform)) errors.set(e.platform, e);
    });
    p.enabledPlatforms.forEach((x) => enabled.add(x));
    for (const c of p.conversations) {
      const k = convKey(c);
      if (!byKey.has(k)) byKey.set(k, c);
    }
  }
  const goodByPlatform: InboxSnapshot['goodByPlatform'] = { ...previous.goodByPlatform };
  for (const platform of PLATFORMS) {
    if (errors.has(platform)) {
      for (const c of previous.goodByPlatform[platform] ?? []) {
        const k = convKey(c);
        if (!byKey.has(k)) byKey.set(k, c);
      }
    } else if (pages.length > 0) {
      goodByPlatform[platform] = Array.from(byKey.values()).filter((c) => c.platform === platform);
    }
  }
  if (keepKey && !byKey.has(keepKey)) {
    const kept = previous.shown.get(keepKey);
    if (kept) byKey.set(keepKey, kept);
  }
  const rows = sortConversations(Array.from(byKey.values()));
  const last = pages[pages.length - 1];
  return {
    rows,
    enabledPlatforms: PLATFORMS.filter((p) => enabled.has(p)),
    platformErrors: PLATFORMS.map((p) => errors.get(p)).filter((e): e is PlatformError => !!e),
    nextCursor: last ? last.nextCursor : null,
    fetchedAt: pages[0]?.fetchedAt || null,
    readStateStore: pages.some((p) => p.readStateStore === 'db') ? 'db' : 'memory',
    snapshot: { goodByPlatform, shown: new Map(rows.map((r) => [convKey(r), r])) },
  };
}

export interface LocalAnswer {
  /** ISO time the reply was sent from this tab. */
  at: string;
  text: string;
}

export interface SeenOverride {
  seen: boolean;
  /** ms when the seller opened / marked it. */
  at: number;
}

/**
 * Pure: overlays this tab's answers and seen/unseen marks on the server rows.
 * - Answered: Trendyol stays answered (one answer per question). Wix re-opens when the newest message is from
 *   the customer and newer than the reply; such keys are returned in `expired` so the caller can drop them.
 * - Seen: a "seen" mark hides the dot until a message newer than the mark arrives; "unseen" shows it again.
 */
export function applyLocalState(
  rows: readonly UnifiedConversation[],
  answered: ReadonlyMap<string, LocalAnswer>,
  seen: ReadonlyMap<string, SeenOverride>,
): { rows: UnifiedConversation[]; expired: string[] } {
  const expired: string[] = [];
  if (answered.size === 0 && seen.size === 0) return { rows: rows as UnifiedConversation[], expired };
  const out = rows.map((c) => {
    const k = convKey(c);
    let next = c;
    const a = answered.get(k);
    if (a) {
      const sentAt = timeOf(a.at) ?? 0;
      const last = timeOf(c.lastMessageAt);
      const reopened = c.platform === 'wix' && c.lastFromCustomer === true && last !== null && last > sentAt;
      const serverCaughtUp = last !== null && last >= sentAt && c.lastFromCustomer === false;
      if (reopened || (c.platform === 'wix' && serverCaughtUp)) {
        // Wix: a newer customer message re-opens the thread, and once the server shows the reply the local
        // mark is no longer needed (the row stops being muted). Trendyol/Hepsiburada keep their mark (one-shot answer).
        expired.push(k);
      } else {
        next = {
          ...next,
          needsReply: false,
          unread: false,
          status: 'answered',
          ...(serverCaughtUp ? {} : { lastFromCustomer: false, lastMessageText: a.text, lastMessageAt: a.at, lastMessageDate: a.at }),
        };
      }
    }
    const s = seen.get(k);
    if (s) {
      if (s.seen) {
        const last = timeOf(next.lastMessageAt);
        if (last === null || last <= s.at) next = next.unread ? { ...next, unread: false } : next;
      } else if (next.needsReply && !next.unread) {
        next = { ...next, unread: true };
      }
    }
    return next;
  });
  return { rows: out, expired };
}

/** Pure client search over loaded rows (neither API offers text search; messages §4 "Search"). */
export function filterConversations(rows: readonly UnifiedConversation[], q: string | null | undefined, locale = 'tr'): UnifiedConversation[] {
  const needle = (q ?? '').trim().toLocaleLowerCase(locale);
  if (!needle) return rows as UnifiedConversation[];
  return rows.filter((c) =>
    [c.customerName, c.lastMessageText, c.productInfo?.title, c.orderRef, c.subject]
      .some((v) => typeof v === 'string' && v.toLocaleLowerCase(locale).includes(needle)),
  );
}

/** Desktop auto-open target (D7): the newest needs-reply row, else null. Rows are already sorted. */
export function autoOpenTarget(rows: readonly UnifiedConversation[]): UnifiedConversation | null {
  return rows.find((c) => c.needsReply) ?? null;
}

/** j / k: the row after (+1) or before (-1) `currentKey`; the first row when nothing is open. */
export function neighbourKey(rows: readonly UnifiedConversation[], currentKey: string | null, dir: 1 | -1): string | null {
  if (rows.length === 0) return null;
  const i = currentKey ? rows.findIndex((r) => convKey(r) === currentKey) : -1;
  if (i === -1) return convKey(dir === 1 ? rows[0] : rows[rows.length - 1]);
  const j = i + dir;
  return j >= 0 && j < rows.length ? convKey(rows[j]) : null;
}

/** "Next: Mehmet Y. ›" after a send: the next row (after the current one) that still needs a reply. */
export function nextNeedsReplyKey(rows: readonly UnifiedConversation[], currentKey: string | null): string | null {
  const i = currentKey ? rows.findIndex((r) => convKey(r) === currentKey) : -1;
  const after = rows.slice(i + 1).find((r) => r.needsReply);
  if (after) return convKey(after);
  const before = rows.slice(0, Math.max(0, i)).find((r) => r.needsReply);
  return before ? convKey(before) : null;
}

/** Pure: the list region's state for the current data (messages §5.1 "List" row). */
export type ListRegion =
  | { kind: 'loading' }
  | { kind: 'slow' }
  | { kind: 'error' }
  | { kind: 'noStore' }
  | { kind: 'empty'; empty: 'done' | 'none' | 'noResults' }
  | { kind: 'rows' };

export function listRegion(args: {
  state: AsyncState;
  loaded: boolean;
  /** `useConnections().has()` per platform (undefined = still loading). */
  connected: InboxConnected;
  enabledPlatforms: MessagePlatform[];
  /** Platforms with a `platformErrors` entry in the current response. */
  failedPlatforms?: readonly MessagePlatform[];
  /** Merged rows before search (keep-on-failure rows included). Defaults to `visibleCount`. */
  rowCount?: number;
  visibleCount: number;
  view: InboxView;
  filtered: boolean;
}): ListRegion {
  const { state, loaded, connected, enabledPlatforms, visibleCount, view, filtered } = args;
  const failed = args.failedPlatforms ?? [];
  const rowCount = args.rowCount ?? visibleCount;
  if (loaded && connected.wix === false && connected.trendyol === false && connected.hepsiburada !== true && enabledPlatforms.length === 0) return { kind: 'noStore' };
  if (!loaded) {
    if (state === 'error') return { kind: 'error' };
    if (state === 'slow') return { kind: 'slow' };
    return { kind: 'loading' };
  }
  // Every requested platform failed and nothing is cached: the page error, never an empty claim (P6, §5.1).
  if (rowCount === 0 && enabledPlatforms.length > 0 && enabledPlatforms.every((p) => failed.includes(p))) return { kind: 'error' };
  if (visibleCount > 0) return { kind: 'rows' };
  if (filtered) return { kind: 'empty', empty: 'noResults' };
  // A failed platform may hide messages that need a reply: never say "Every message has a reply" then.
  if (failed.length > 0) return { kind: 'empty', empty: 'none' };
  return { kind: 'empty', empty: view === 'needs_reply' ? 'done' : 'none' };
}

/**
 * Store filter options (messages §4): every connected store, independent of the current filter. The list
 * API only reports the platform it was asked for in `enabledPlatforms`, so the caller also passes the union
 * of platforms seen so far and the current selection.
 */
export function storeFilterPlatforms(
  connected: InboxConnected,
  seen: Iterable<MessagePlatform>,
  current: InboxStore,
): MessagePlatform[] {
  const s = new Set<MessagePlatform>(seen);
  if (current !== 'all') s.add(current);
  return PLATFORMS.filter((p) => connected[p] === true || s.has(p));
}

/** Pure: `useShortcuts` Escape order (messages §5.3): leave the field, then clear search, then close the sheet. */
export function escapeStep(args: { inField: boolean; hasSearch: boolean; sheetOpen: boolean }): 'blur' | 'clearSearch' | 'closeSheet' | null {
  if (args.inField) return 'blur';
  if (args.hasSearch) return 'clearSearch';
  if (args.sheetOpen) return 'closeSheet';
  return null;
}

// ── hook ────────────────────────────────────────────────────────────────────────────────────────────────

export interface UseInboxOptions {
  view: InboxView;
  platform: InboxStore;
  /** Open thread key (`wix:abc`): stays listed while it is open. */
  keepKey?: string | null;
  pageSize?: number;
  /** Default 120 s; 0 disables polling (tests). */
  pollMs?: number;
  /** false = no request (e.g. no store connected). Default true. */
  enabled?: boolean;
}

export interface UseInboxResult {
  /** Merged, locally overlaid, sorted rows (before search). */
  conversations: UnifiedConversation[];
  enabledPlatforms: MessagePlatform[];
  platformErrors: PlatformError[];
  /** DS async state of the list region (`stale` = last refresh failed, rows kept). */
  state: AsyncState;
  /** The first response arrived (with or without rows). */
  loaded: boolean;
  /** Last refresh in flight (poll or ⟳); data stays on screen. */
  refreshing: boolean;
  /** Client time of the last successful list response (SyncMeta). */
  lastFetchedAt: Date | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  refresh: () => Promise<void>;
  retry: () => void;
  readStateStore: 'db' | 'memory';
  /** First error (for the page ErrorState cause / error id). */
  error: InboxFetchError | Error | null;
  /** Called by the thread after a successful send (G6 `useThread` `onSent(conversation, { text, at })`). */
  onSent: (conv: Pick<UnifiedConversation, 'platform' | 'id' | 'needsReply'>, info: { text: string; at?: string }) => void;
  /** ISO time this tab answered the conversation, or null. G6 passes it to `composerMode`. */
  locallyAnsweredAt: (key: string) => string | null;
  /**
   * Opened / "Mark as unread": optimistic dot change, plus `POST ?action=markSeen` (fire-and-forget) unless
   * `post: false` (the thread's `useThread` already posted it and only reports back through `onSeen`).
   */
  markSeen: (conv: Pick<UnifiedConversation, 'platform' | 'id'>, seen?: boolean, opts?: { post?: boolean }) => void;
}

export function useInbox({ view, platform, keepKey = null, pageSize = INBOX_PAGE_SIZE, pollMs = INBOX_POLL_MS, enabled = true }: UseInboxOptions): UseInboxResult {
  const getKey = useCallback(
    (index: number, prev: InboxListResponse | null) => (enabled ? inboxPageKey(index, prev, { platform, view, size: pageSize }) : null),
    [enabled, platform, view, pageSize],
  );
  const swr = useSWRInfinite<InboxListResponse>(getKey, inboxFetcher, {
    refreshInterval: pollMs > 0 ? pollMs : 0,
    refreshWhenHidden: false,
    revalidateOnFocus: true,
    revalidateFirstPage: true,
    dedupingInterval: 2_000,
    shouldRetryOnError: false,
  });
  const { data, error, size, setSize, isValidating, isLoading, mutate } = swr;
  const region = useAsyncRegion<InboxListResponse[]>({ data, error, isLoading, isValidating, mutate }, { isEmpty: () => false });

  // A new view / store starts from scratch (no rows of another filter kept).
  const filterKey = `${platform}|${view}`;
  const snapshotRef = useRef<{ key: string; snap: InboxSnapshot }>({ key: filterKey, snap: EMPTY_SNAPSHOT });
  if (snapshotRef.current.key !== filterKey) snapshotRef.current = { key: filterKey, snap: EMPTY_SNAPSHOT };

  const merged = useMemo(() => {
    const pages = (data ?? []).filter(Boolean);
    const m = mergeInboxPages(pages, snapshotRef.current.snap, keepKey);
    snapshotRef.current = { key: filterKey, snap: m.snapshot };
    return m;
    // filterKey is read through the ref guard above.
  }, [data, keepKey]);

  const [answered, setAnswered] = useState<Map<string, LocalAnswer>>(() => new Map());
  const [seen, setSeen] = useState<Map<string, SeenOverride>>(() => new Map());
  const local = useMemo(() => applyLocalState(merged.rows, answered, seen), [merged.rows, answered, seen]);
  const expiredKey = local.expired.join(',');
  useEffect(() => {
    if (!expiredKey) return;
    setAnswered((prev) => {
      const next = new Map(prev);
      expiredKey.split(',').forEach((k) => next.delete(k));
      return next;
    });
  }, [expiredKey]);

  // Client time of the last successful response.
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (data && !error) setLastFetchedAt(new Date());
  }, [data, error]);

  // Badge + counts after a send.
  const fetchCounts = useMessageCountStore((s) => s.fetch);
  const decrement = useMessageCountStore((s) => s.decrement);
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (countTimer.current) clearTimeout(countTimer.current);
  }, []);

  const onSent = useCallback<UseInboxResult['onSent']>(
    (conv, info) => {
      const k = convKey(conv);
      const at = info.at && Number.isFinite(new Date(info.at).getTime()) ? info.at : new Date().toISOString();
      setAnswered((prev) => new Map(prev).set(k, { at, text: info.text }));
      setSeen((prev) => new Map(prev).set(k, { seen: true, at: Date.now() }));
      if (conv.needsReply) decrement(conv.platform);
      if (countTimer.current) clearTimeout(countTimer.current);
      countTimer.current = setTimeout(() => {
        void fetchCounts({ force: true });
      }, COUNT_REFRESH_DELAY_MS);
    },
    [decrement, fetchCounts],
  );

  const locallyAnsweredAt = useCallback((k: string) => answered.get(k)?.at ?? null, [answered]);

  const markSeen = useCallback<UseInboxResult['markSeen']>((conv, isSeen = true, opts) => {
    const k = convKey(conv);
    setSeen((prev) => new Map(prev).set(k, { seen: isSeen, at: Date.now() }));
    if (opts?.post === false) return;
    try {
      void fetch('/api/messages?action=markSeen', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: conv.platform, id: conv.id, seen: isSeen }),
      }).catch(() => undefined);
    } catch {
      /* fire-and-forget */
    }
  }, []);

  const lastPage = data && data.length > 0 ? data[data.length - 1] : undefined;
  const hasMore = Boolean(lastPage?.nextCursor);
  const loadingMore = Boolean(data && size > data.length && isValidating);
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    void setSize((s) => s + 1);
  }, [hasMore, loadingMore, setSize]);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    conversations: local.rows,
    enabledPlatforms: merged.enabledPlatforms,
    platformErrors: merged.platformErrors,
    state: region.state,
    loaded: data !== undefined,
    refreshing: Boolean(data) && isValidating && !loadingMore,
    lastFetchedAt,
    hasMore,
    loadingMore,
    loadMore,
    refresh,
    retry: region.retry,
    readStateStore: merged.readStateStore,
    error: (error as Error | undefined) ?? null,
    onSent,
    locallyAnsweredAt,
    markSeen,
  };
}

export default useInbox;
