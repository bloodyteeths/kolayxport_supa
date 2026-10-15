// components/domain/settings/refresh/useRefreshHistory.ts — cursor pages of GET /api/sync/history (unchanged
// endpoint) plus the two actions: POST /api/orders/fullSync and POST /api/sync/retry?id=.
// Polls every 5 s while a run is "running", so the pill and "Refreshing…" clear on their own.
import { useCallback, useMemo, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { isRunning, toRunRow, type RunRow, type SyncHistoryPage } from './refreshModel';

export const SYNC_HISTORY_API = '/api/sync/history';
export const FULL_SYNC_API = '/api/orders/fullSync';
export const RETRY_API = '/api/sync/retry';
export const RUNNING_POLL_MS = 5000;

export function historyKey(index: number, prev: SyncHistoryPage | null): string | null {
  if (index === 0) return SYNC_HISTORY_API;
  if (!prev || !prev.nextCursor || prev.syncs.length === 0) return null;
  return `${SYNC_HISTORY_API}?cursor=${encodeURIComponent(prev.nextCursor)}`;
}

async function fetchPage(url: string): Promise<SyncHistoryPage> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`sync_history_${res.status}`);
  const body = (await res.json()) as Partial<SyncHistoryPage>;
  return { syncs: Array.isArray(body.syncs) ? body.syncs : [], nextCursor: body.nextCursor ?? null };
}

export interface RefreshHistory {
  rows: RunRow[];
  /** First page: loading / error / empty / ready. */
  state: 'loading' | 'error' | 'empty' | 'ready';
  hasMore: boolean;
  loadingMore: boolean;
  /** A "Load more" page failed (the rows already shown stay). */
  loadMoreFailed: boolean;
  running: boolean;
  loadMore: () => void;
  reload: () => Promise<unknown>;
  /** Starts a full refresh. Resolves true when the server accepted it. */
  startFullRefresh: () => Promise<boolean>;
  /** Retries one failed run. Resolves true when the server accepted it. */
  retry: (id: string) => Promise<boolean>;
  startingFull: boolean;
  retryingId: string | null;
}

export function useRefreshHistory(): RefreshHistory {
  const { data, error, size, setSize, mutate } = useSWRInfinite<SyncHistoryPage>(historyKey, fetchPage, {
    revalidateFirstPage: true,
    revalidateOnFocus: false,
    refreshInterval: (pages) => (pages && isRunning((pages[0]?.syncs ?? []).map(toRunRow)) ? RUNNING_POLL_MS : 0),
  });
  const [startingFull, setStartingFull] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const rows = useMemo(() => (data ?? []).flatMap((p) => p.syncs.map(toRunRow)), [data]);
  const last = data?.[data.length - 1];
  const hasMore = Boolean(last && last.nextCursor && last.syncs.length > 0);
  const pagesLoaded = data?.length ?? 0;
  const loadingMore = pagesLoaded > 0 && size > pagesLoaded && !error;
  // Only a page the user asked for (size ahead of the pages we have) counts as a "Load more" failure; an error
  // from the 5 s poll or the first-page revalidation keeps the rows shown and stays silent.
  const loadMoreFailed = Boolean(error) && pagesLoaded > 0 && size > pagesLoaded;

  const state: RefreshHistory['state'] = !data
    ? error ? 'error' : 'loading'
    : rows.length === 0 ? 'empty' : 'ready';

  // Retry after a failed "Load more": size already points at the missing page, so revalidate instead of growing.
  const loadMore = useCallback(() => {
    if (size > pagesLoaded) void mutate();
    else void setSize(pagesLoaded + 1);
  }, [setSize, mutate, size, pagesLoaded]);
  const reload = useCallback(() => mutate(), [mutate]);

  const startFullRefresh = useCallback(async () => {
    setStartingFull(true);
    try {
      const res = await fetch(FULL_SYNC_API, { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) return false;
      await setSize(1);
      await mutate();
      return true;
    } catch {
      return false;
    } finally {
      setStartingFull(false);
    }
  }, [mutate, setSize]);

  const retry = useCallback(async (id: string) => {
    setRetryingId(id);
    try {
      const res = await fetch(`${RETRY_API}?id=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) return false;
      await mutate();
      return true;
    } catch {
      return false;
    } finally {
      setRetryingId(null);
    }
  }, [mutate]);

  return {
    rows, state, hasMore, loadingMore, loadMoreFailed, running: isRunning(rows),
    loadMore, reload, startFullRefresh, retry, startingFull, retryingId,
  };
}
