/**
 * useNotifications — client hook over GET /api/notifications.
 *
 * Contract (shared with the backend):
 *   GET  /api/notifications?limit=20 -> { items: NotificationItem[], unreadCount }
 *   POST /api/notifications/read { ids?: string[], all?: boolean } -> { ok: true }
 *
 * One SWR key app-wide ('/api/notifications'), refreshed on window focus, by
 * the live stream (LiveEventsProvider revalidates '/api/notifications' on every
 * notification.* event) and by a poll: 60s, relaxed to 120s while the stream is
 * live. `unreadCount` counts only badge=true rows (W5); activity-only rows
 * (e.g. orderNew) never raise the badge and never play a sound here (the
 * new-order chime belongs to W6's order event).
 *
 * Every fetch sends `X-KX-Locale` so the server renders emails in the UI
 * language (stored at most once per hour). Mark-read is optimistic: the local cache is updated first and
 * revalidated after the POST settles, so the badge reacts instantly.
 *
 * The response is validated defensively — an unexpected shape (HTML error
 * page, missing fields) yields an empty list instead of crashing the header.
 */
import useSWR from 'swr';
import { useCallback } from 'react';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import { useLiveStatus } from '@/components/live/useLiveEvent';

export const NOTIFICATIONS_KEY = '/api/notifications';
const LIMIT = 20;

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface NotificationItem {
  id: string;
  type: string;
  severity: NotificationSeverity;
  /** Key path under the 'notifications' i18n namespace, e.g. 'types.draftSyncFailed'. */
  titleKey: string;
  params: Record<string, string | number> | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  /** false = activity-feed row (never counted in the badge). */
  badge?: boolean;
  resolvedAt?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

class NotificationsFetchError extends Error {
  status: number;
  constructor(status: number) {
    super(`Failed to load notifications (${status})`);
    this.status = status;
  }
}

const SEVERITIES: readonly NotificationSeverity[] = ['info', 'warning', 'error'];

function sanitizeParams(raw: unknown): Record<string, string | number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    else if (typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/** Only same-origin relative paths are followed (no open redirects via stored links). */
function sanitizeLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  return s;
}

function normalizeItem(raw: unknown): NotificationItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.titleKey !== 'string') return null;
  const severity = SEVERITIES.includes(r.severity as NotificationSeverity)
    ? (r.severity as NotificationSeverity)
    : 'info';
  return {
    id: r.id,
    type: typeof r.type === 'string' ? r.type : '',
    severity,
    titleKey: r.titleKey,
    params: sanitizeParams(r.params),
    link: sanitizeLink(r.link),
    readAt: typeof r.readAt === 'string' ? r.readAt : null,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    badge: typeof r.badge === 'boolean' ? r.badge : undefined,
    resolvedAt: typeof r.resolvedAt === 'string' ? r.resolvedAt : null,
    entityType: typeof r.entityType === 'string' ? r.entityType : null,
    entityId: typeof r.entityId === 'string' ? r.entityId : null,
  };
}

export function normalizeNotifications(raw: unknown): NotificationsResponse {
  if (!raw || typeof raw !== 'object') return { items: [], unreadCount: 0 };
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items)
    ? (r.items.map(normalizeItem).filter(Boolean) as NotificationItem[])
    : [];
  const unread =
    typeof r.unreadCount === 'number' && Number.isFinite(r.unreadCount)
      ? Math.max(0, Math.floor(r.unreadCount))
      : items.filter((i) => !i.readAt).length;
  return { items, unreadCount: unread };
}

function currentLocale(): string {
  try {
    return useLocaleStore.getState().locale || 'tr';
  } catch {
    return 'tr';
  }
}

const fetcher = async (url: string): Promise<NotificationsResponse> => {
  const res = await fetch(`${url}?limit=${LIMIT}`, {
    credentials: 'same-origin',
    headers: { 'X-KX-Locale': currentLocale() },
  });
  if (!res.ok) throw new NotificationsFetchError(res.status);
  return normalizeNotifications(await res.json());
};

export interface UseNotificationsResult {
  items: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  error: Error | undefined;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<NotificationsResponse | undefined>;
}

export function useNotifications(enabled = true): UseNotificationsResult {
  const { status: liveStatus } = useLiveStatus();
  const { data, error, isLoading, mutate } = useSWR<NotificationsResponse>(
    enabled ? NOTIFICATIONS_KEY : null,
    fetcher,
    {
      refreshInterval: liveStatus === 'live' ? 120_000 : 60_000,
      revalidateOnFocus: true,
      keepPreviousData: true,
      dedupingInterval: 10_000,
      shouldRetryOnError: (err: unknown) =>
        !(err instanceof NotificationsFetchError && (err.status === 401 || err.status === 404)),
      errorRetryCount: 2,
    },
  );

  const post = useCallback(
    async (body: { ids?: string[]; all?: boolean }, apply: (prev: NotificationsResponse) => NotificationsResponse) => {
      await mutate(
        async (prev) => {
          const res = await fetch(`${NOTIFICATIONS_KEY}/read`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new NotificationsFetchError(res.status);
          return prev ? apply(prev) : prev;
        },
        {
          optimisticData: (prev) => (prev ? apply(prev) : { items: [], unreadCount: 0 }),
          rollbackOnError: true,
          populateCache: true,
          revalidate: true,
        },
      ).catch(() => {
        // Rolled back; the next poll re-syncs. Marking read is not worth a toast.
      });
    },
    [mutate],
  );

  const markRead = useCallback(
    async (ids: string[]) => {
      const unique = Array.from(new Set(ids.filter(Boolean)));
      if (!unique.length) return;
      const set = new Set(unique);
      await post({ ids: unique }, (prev) => {
        const readAt = new Date().toISOString();
        let newlyRead = 0;
        const items = prev.items.map((i) => {
          if (!set.has(i.id) || i.readAt) return i;
          newlyRead += 1;
          return { ...i, readAt };
        });
        return { items, unreadCount: Math.max(0, prev.unreadCount - newlyRead) };
      });
    },
    [post],
  );

  const markAllRead = useCallback(async () => {
    await post({ all: true }, (prev) => {
      const readAt = new Date().toISOString();
      return { items: prev.items.map((i) => (i.readAt ? i : { ...i, readAt })), unreadCount: 0 };
    });
  }, [post]);

  const refresh = useCallback(() => mutate(), [mutate]);

  return {
    items: data?.items ?? [],
    unreadCount: data?.unreadCount ?? 0,
    isLoading: isLoading && !data,
    error: error as Error | undefined,
    markRead,
    markAllRead,
    refresh,
  };
}

export default useNotifications;
