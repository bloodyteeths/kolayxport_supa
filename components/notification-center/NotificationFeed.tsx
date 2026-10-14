/**
 * Notification list for one tab of /app/bildirimler (owner W5).
 *
 *   view 'unread'   -> GET /api/notifications?feed=badge&unread=1
 *   view 'all'      -> GET /api/notifications?feed=all&includeResolved=1
 *   view 'activity' -> GET /api/notifications/activity
 *
 * Group filter chips (horizontal scroll on mobile), Today / Earlier sections,
 * expandable cards, infinite cursor (auto-load on scroll + a Load more button).
 * Live: refetches on notification.* / invalidate events (W6), plus a 60 s poll.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import useSWRInfinite from 'swr/infinite';
import { mutate as globalMutate } from 'swr';
import { Button, Chip, CircularProgress, Skeleton } from '@mui/material';
import { BellOff, Activity } from 'lucide-react';
import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
import { NOTIFICATION_GROUPS, type NotificationGroup } from '@/lib/notificationCenter/registry';
import NotificationCard from './NotificationCard';
import {
  ACTIVITY_API,
  NOTIFICATIONS_API,
  normalizePage,
  splitByDay,
  type CenterItem,
  type CenterPage,
} from './shared';

export type FeedView = 'unread' | 'all' | 'activity';

const PAGE_SIZE = 30;
/** Groups offered as filters (system = admin plumbing, hidden). */
const FILTER_GROUPS: NotificationGroup[] = NOTIFICATION_GROUPS.filter((g) => g !== 'system');

class FetchError extends Error {
  status: number;
  constructor(status: number) {
    super(`Request failed (${status})`);
    this.status = status;
  }
}

async function fetchPage(url: string): Promise<CenterPage> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new FetchError(res.status);
  return normalizePage(await res.json());
}

function baseUrl(view: FeedView, group: NotificationGroup | null): string {
  const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (group) p.set('group', group);
  if (view === 'activity') return `${ACTIVITY_API}?${p.toString()}`;
  if (view === 'unread') {
    p.set('feed', 'badge');
    p.set('unread', '1');
  } else {
    p.set('feed', 'all');
    p.set('includeResolved', '1');
  }
  return `${NOTIFICATIONS_API}?${p.toString()}`;
}

async function postRead(body: { ids?: string[]; all?: boolean }) {
  const res = await fetch(`${NOTIFICATIONS_API}/read`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new FetchError(res.status);
}

/** Bell (lib/hooks/useNotifications) uses this exact SWR key. */
const BELL_KEY = '/api/notifications';

export interface NotificationFeedProps {
  view: FeedView;
  group: NotificationGroup | null;
  onGroupChange: (g: NotificationGroup | null) => void;
  locale: string;
  /** Registers a "mark all read" action with the page header. */
  onRegisterMarkAll?: (fn: (() => Promise<void>) | null) => void;
}

export default function NotificationFeed({ view, group, onGroupChange, locale, onRegisterMarkAll }: NotificationFeedProps) {
  const t = useTranslations('notificationCenter');
  const router = useRouter();
  const base = baseUrl(view, group);

  const getKey = useCallback(
    (index: number, prev: CenterPage | null) => {
      if (prev && !prev.nextCursor) return null;
      if (index === 0) return base;
      return `${base}&cursor=${encodeURIComponent(prev!.nextCursor as string)}`;
    },
    [base],
  );

  const { data, error, size, setSize, isLoading, isValidating, mutate } = useSWRInfinite<CenterPage>(getKey, fetchPage, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    revalidateFirstPage: true,
    shouldRetryOnError: (err: unknown) => !(err instanceof FetchError && (err.status === 401 || err.status === 404)),
    errorRetryCount: 2,
  });

  useLiveRevalidate(['notification.*', 'invalidate'], () => mutate());

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: CenterItem[] = [];
    for (const page of data || []) {
      for (const it of page.items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(it);
      }
    }
    return out;
  }, [data]);

  const hasMore = Boolean(data && data[data.length - 1]?.nextCursor);
  const loadingMore = Boolean(isValidating && data && size > data.length);

  const applyLocalRead = useCallback(
    (ids: Set<string> | 'all') =>
      mutate(
        (pages) =>
          pages?.map((p) => ({
            ...p,
            items:
              view === 'unread'
                ? p.items.filter((i) => !(ids === 'all' || ids.has(i.id)))
                : p.items.map((i) => (ids === 'all' || ids.has(i.id) ? { ...i, readAt: i.readAt || new Date().toISOString() } : i)),
          })),
        { revalidate: false },
      ),
    [mutate, view],
  );

  const markRead = useCallback(
    async (item: CenterItem) => {
      if (item.readAt) return;
      await applyLocalRead(new Set([item.id]));
      try {
        await postRead({ ids: [item.id] });
      } catch {
        /* the next revalidation restores the true state */
      }
      void globalMutate(BELL_KEY);
      void mutate();
    },
    [applyLocalRead, mutate],
  );

  const markAll = useCallback(async () => {
    await applyLocalRead('all');
    try {
      await postRead({ all: true });
    } catch {
      /* revalidation below restores the true state */
    }
    void globalMutate(BELL_KEY);
    void mutate();
  }, [applyLocalRead, mutate]);

  useEffect(() => {
    onRegisterMarkAll?.(view === 'activity' ? null : markAll);
    return () => onRegisterMarkAll?.(null);
  }, [onRegisterMarkAll, markAll, view]);

  const open = useCallback(
    (item: CenterItem) => {
      void markRead(item);
      if (item.link) void router.push(item.link);
    },
    [markRead, router],
  );

  // Auto-load the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loadingMore) void setSize((s) => s + 1);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, setSize]);

  const { today, earlier } = splitByDay(items);

  const chips = (
    <div
      className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1"
      role="group"
      aria-label={t('page.filterLabel')}
      style={{ scrollbarWidth: 'none' }}
    >
      <Chip
        label={t('groups.all')}
        clickable
        color={group === null ? 'primary' : 'default'}
        variant={group === null ? 'filled' : 'outlined'}
        onClick={() => onGroupChange(null)}
        sx={{ minHeight: 36, flexShrink: 0 }}
      />
      {FILTER_GROUPS.map((g) => (
        <Chip
          key={g}
          label={t(`groups.${g}` as any)}
          clickable
          color={group === g ? 'primary' : 'default'}
          variant={group === g ? 'filled' : 'outlined'}
          onClick={() => onGroupChange(group === g ? null : g)}
          sx={{ minHeight: 36, flexShrink: 0 }}
        />
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (error && !data) {
    body = <ErrorState title={t('page.loadError')} error={error} onRetry={() => mutate()} retrying={isValidating} />;
  } else if (isLoading && !data) {
    body = (
      <ul className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i}>
            <Skeleton variant="rounded" height={64} />
          </li>
        ))}
      </ul>
    );
  } else if (items.length === 0) {
    body =
      view === 'activity' ? (
        <EmptyState icon={<Activity size={28} />} title={t('page.empty.activity')} message={t('page.empty.activityHint')} />
      ) : view === 'unread' ? (
        <EmptyState icon={<BellOff size={28} />} title={t('page.empty.unread')} message={t('page.empty.unreadHint')} />
      ) : (
        <EmptyState icon={<BellOff size={28} />} title={t('page.empty.all')} />
      );
  } else {
    const renderList = (label: string, list: CenterItem[]) =>
      list.length ? (
        <section className="mb-5" aria-label={label}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 px-1">{label}</h2>
          <ul className="flex flex-col gap-2">
            {list.map((item) => (
              <NotificationCard key={item.id} item={item} locale={locale} onOpen={open} onMarkRead={markRead} />
            ))}
          </ul>
        </section>
      ) : null;
    body = (
      <>
        {renderList(t('page.today'), today)}
        {renderList(t('page.earlier'), earlier)}
        <div ref={sentinel} aria-hidden="true" />
        {hasMore && (
          <div className="flex justify-center py-2">
            <Button
              variant="outlined"
              onClick={() => void setSize(size + 1)}
              disabled={loadingMore}
              startIcon={loadingMore ? <CircularProgress size={14} /> : undefined}
              sx={{ minHeight: 44, textTransform: 'none', borderRadius: 2, width: { xs: '100%', sm: 'auto' } }}
            >
              {loadingMore ? t('page.loading') : t('page.loadMore')}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div>
      {chips}
      {body}
    </div>
  );
}
