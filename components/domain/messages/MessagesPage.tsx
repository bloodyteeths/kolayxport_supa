// components/domain/messages/MessagesPage.tsx (messages G5) — the new inbox at /app/mesajlar behind the
// `messages` flag (messages §1, §2.1, §3.1, §5.1 list/page rows, §5.3 keyboard + auto-open).
//
// Composition only: list data from `useInbox` (G5), URL state from `useInboxUrlState` (G5), status mapping
// from G4 (`lib/messages/threadState.ts`), the thread + rail from G6 (`ThreadPane`, `ContextRail`) and the
// saved-replies manager from G3 (`SavedRepliesPanel`), each mounted by its published props.
//
// Desktop (≥ 900): one bordered surface, list 360 | thread (flex, min 440) | rail 320; the rail is inline
// from 1200px and otherwise opened by the thread header ("Customer & orders"). Each region scrolls on its own;
// the page does not. Mobile: the list as one bordered surface; a row opens the thread as a full-height sheet.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useLocale, useTranslations } from 'next-intl';
import { Page, PageHeader, SyncMeta, type ActionSpec } from '@/components/ds/page';
import { useIsMobile, useIsNarrow } from '@/components/ds/page/useViewport';
import { Toolbar, type FilterDef, type FilterValues, type SavedView } from '@/components/ds/toolbar';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { ListSkeleton } from '@/components/ds/state/Skeletons';
import { icons } from '@/lib/ds/icons';
import { getLogo } from '@/lib/ds/logos';
import { useCommands, type Command } from '@/lib/ds/useCommand';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { neutral, radius, layout } from '@/lib/ds/tokens';
import { useConnections } from '@/lib/hooks/useConnections';
import useMessageCountStore from '@/lib/stores/useMessageCountStore';
import type { InboxView, MessagePlatform, UnifiedConversation } from '@/types/messages';
import { ConversationList } from './ConversationList';
import { PlatformBanners, SETTINGS_CONNECTIONS_HREF } from './PlatformBanners';
import { SavedRepliesPanel } from './SavedRepliesPanel';
import { ThreadPane, ThreadSheet, type ThreadPaneProps } from './ThreadPane';
import { ContextRail, type OtherQuestionsLink } from './ContextRail';
import {
  autoOpenTarget,
  convKey,
  filterConversations,
  neighbourKey,
  nextNeedsReplyKey,
  escapeStep,
  listRegion,
  storeFilterPlatforms,
  useInbox,
} from './useInbox';
import { INBOX_STORES, useInboxUrlState, type InboxStore } from './useInboxUrlState';
import { useUnsentReplyGuard } from './useThread';

const LIST_WIDTH = 360;
const RAIL_WIDTH = 320;
const THREAD_MIN = 440;
/** Space under the inbox surface (messages §2.1: 100dvh − topbar − pageheader − toolbar − 24px). */
const SURFACE_BOTTOM_GAP = 24;

const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const oy = window.getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
    p = p.parentElement;
  }
  return null;
}

/**
 * Desktop: the surface's distance from the viewport top, measured (not a fixed offset), so the platform
 * banners, the stale line and header differences are subtracted and the page itself does not scroll (§2.1).
 * Re-measured when the content above it changes size and on viewport resize.
 */
function useSurfaceTop(enabled: boolean): [React.RefCallback<HTMLDivElement>, number | null] {
  const [el, setEl] = React.useState<HTMLDivElement | null>(null);
  const [top, setTop] = React.useState<number | null>(null);
  useIsoLayoutEffect(() => {
    if (!enabled || !el || typeof window === 'undefined') return;
    const scroller = scrollParentOf(el);
    const measure = () => {
      const offset = scroller ? scroller.scrollTop : window.scrollY;
      const next = Math.round(el.getBoundingClientRect().top + offset);
      setTop((prev) => (prev !== null && Math.abs(prev - next) < 1 ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    // Everything above the surface lives in its parent: any size change there moves the surface.
    if (ro && el.parentElement) {
      ro.observe(el.parentElement);
      Array.from(el.parentElement.children).forEach((child) => {
        if (child !== el) ro.observe(child);
      });
    }
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [enabled, el]);
  return [setEl, enabled ? top : null];
}

export interface MessagesPageProps {
  /** Test seam: shared "now" for relative times. */
  now?: Date;
  /** Test seam: polling interval (0 disables). */
  pollMs?: number;
}

function isTextField(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function MessagesPage({ now, pollMs }: MessagesPageProps = {}) {
  const t = useTranslations('messages');
  const tBanner = useTranslations('messages.platformBanners');
  // messages §5.3: leaving /app/mesajlar with any stored unsent reply asks first. Mounted here (not in the
  // pane) so it still applies after the mobile thread sheet was closed; panes get guardNavigation={false}.
  useUnsentReplyGuard({ title: t('composer.discard.title'), keep: t('composer.discard.keep'), discard: t('composer.discard.confirm') });
  const locale = useLocale();
  const mobile = useIsMobile();
  const narrow = useIsNarrow();
  const url = useInboxUrlState();
  const { view, store, q, open } = url.state;
  const openKey = open ?? null;

  const connections = useConnections();
  const connected = { wix: connections.has('wix'), trendyol: connections.has('trendyol') };

  const [surfaceRef, surfaceTop] = useSurfaceTop(!mobile);
  const inbox = useInbox({ view, platform: store, keepKey: openKey, pollMs });
  // Union of the platforms any response reported (for the Store filter options).
  const [seenPlatforms, setSeenPlatforms] = React.useState<MessagePlatform[]>([]);
  const enabledKey = inbox.enabledPlatforms.join(',');
  React.useEffect(() => {
    if (!enabledKey) return;
    setSeenPlatforms((prev) => {
      const add = (enabledKey.split(',') as MessagePlatform[]).filter((p) => !prev.includes(p));
      return add.length ? [...prev, ...add] : prev;
    });
  }, [enabledKey]);
  const visible = React.useMemo(() => filterConversations(inbox.conversations, q, locale === 'en' ? 'en' : 'tr'), [inbox.conversations, q, locale]);

  // ── counts (nav badge store; the PageHeader count is the needs-reply total) ─────────────────────────────
  const counts = useMessageCountStore((s) => s.counts);
  const fetchCounts = useMessageCountStore((s) => s.fetch);
  React.useEffect(() => {
    void fetchCounts();
  }, [fetchCounts]);
  // A refreshed list may change the badge (new customer message): re-read the counts with it.
  const fetchedAtMs = inbox.lastFetchedAt?.getTime() ?? 0;
  const firstFetch = React.useRef(true);
  React.useEffect(() => {
    if (!fetchedAtMs) return;
    if (firstFetch.current) {
      firstFetch.current = false;
      return;
    }
    void fetchCounts();
  }, [fetchedAtMs, fetchCounts]);

  // ── open thread ─────────────────────────────────────────────────────────────────────────────────────────
  const openConv: UnifiedConversation | null = React.useMemo(
    () => (openKey ? inbox.conversations.find((c) => convKey(c) === openKey) ?? null : null),
    [inbox.conversations, openKey],
  );

  const markSeen = inbox.markSeen;
  const openConversation = React.useCallback(
    (c: UnifiedConversation) => {
      url.setOpen(convKey(c));
    },
    [url],
  );
  const openByKey = React.useCallback(
    (k: string | null) => {
      if (!k) return;
      const c = inbox.conversations.find((r) => convKey(r) === k);
      if (c) openConversation(c);
    },
    [inbox.conversations, openConversation],
  );
  const closeThread = React.useCallback(() => url.setOpen(null), [url]);

  // After the first list response, once per page view:
  // - `?open=` points at a listed conversation: keep it (restored on reload, §5.3).
  // - `?open=` points at one that is not listed (not on the first page, or it left the view): drop the stale
  //   key so mobile does not keep an `open` that renders nothing, and do not swap in another conversation.
  //   (Restoring it needs a single-conversation lookup the list API does not offer yet.)
  // - `?open=` absent: desktop auto-opens the newest needs-reply row (D7). Never on mobile.
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    if (autoOpened.current || !url.ready || !inbox.loaded) return;
    autoOpened.current = true;
    if (openKey) {
      if (!openConv) url.setOpen(null);
      return;
    }
    if (mobile) return;
    const target = autoOpenTarget(visible) ?? visible[0] ?? null;
    if (target) url.setOpen(convKey(target));
  }, [mobile, url, inbox.loaded, openKey, openConv, visible]);

  // ── navigation helpers ──────────────────────────────────────────────────────────────────────────────────
  const goNeighbour = React.useCallback((dir: 1 | -1) => openByKey(neighbourKey(visible, openKey, dir)), [openByKey, visible, openKey]);
  const goNextNeedsReply = React.useCallback(() => openByKey(nextNeedsReplyKey(visible, openKey)), [openByKey, visible, openKey]);
  const prevKey = neighbourKey(visible, openKey, -1);
  const nextKey = neighbourKey(visible, openKey, 1);
  const nextUpKey = openKey ? nextNeedsReplyKey(visible, openKey) : null;
  const nextUpConv = nextUpKey ? visible.find((c) => convKey(c) === nextUpKey) ?? null : null;

  // ── saved replies manager (PageHeader ⋯) ────────────────────────────────────────────────────────────────
  const [savedOpen, setSavedOpen] = React.useState(false);

  // ── keyboard (useShortcuts, input-aware) ────────────────────────────────────────────────────────────────
  const sheetOpen = mobile && Boolean(openKey);
  useShortcuts(
    {
      j: { handler: () => goNeighbour(1), description: t('thread.next') },
      k: { handler: () => goNeighbour(-1), description: t('thread.prev') },
      escape: {
        handler: () => {
          const active = typeof document !== 'undefined' ? document.activeElement : null;
          const step = escapeStep({ inField: isTextField(active), hasSearch: Boolean(q), sheetOpen });
          if (step === 'blur') (active as HTMLElement).blur();
          else if (step === 'clearSearch') url.setSearch('');
          else if (step === 'closeSheet') closeThread();
          else return false;
          return true;
        },
        preventDefault: false,
      },
    },
    { scope: 'page', enabled: !savedOpen, describe: true },
  );

  // ⌘K: "Go to next message needing reply" (header ⋯ actions reach the palette through PageHeader).
  const commands = React.useMemo<Command[]>(
    () => [
      {
        id: 'messages.nextNeedsReply',
        label: t('cmd.nextNeedsReply'),
        group: 'actions',
        icon: icons.message,
        onThisPage: true,
        disabled: !visible.some((c) => c.needsReply),
        run: goNextNeedsReply,
      },
    ],
    [t, visible, goNextNeedsReply],
  );
  useCommands(commands);

  // ── toolbar ─────────────────────────────────────────────────────────────────────────────────────────────
  // Options = every connected store, not the current response's `enabledPlatforms` (which only lists the
  // platform that was asked for), so the seller can switch Wix → Trendyol directly.
  const storeOptions = storeFilterPlatforms(connected, seenPlatforms, store).map((p) => ({ value: p, label: getLogo(p)?.name ?? p, leading: <LogoTile brand={p} size={16} /> }));
  const filters: FilterDef[] = [
    { key: 'store', label: t('filters.store'), type: 'select', pinned: true, options: storeOptions, allLabel: t('filters.storeAll') },
  ];
  const filterValues: FilterValues = { store: store === 'all' ? undefined : store };
  const onFilterChange = (values: FilterValues) => {
    const v = values.store;
    const next = typeof v === 'string' && (INBOX_STORES as readonly string[]).includes(v) ? (v as InboxStore) : 'all';
    if (next !== store) url.setStore(next);
  };
  const views: SavedView[] = [
    { id: 'needs_reply', label: t('views.needsReply'), count: counts.total, builtIn: true },
    // Unread total: only once the counts action returns one (backend gap, BR-4 / G1); no number until then.
    { id: 'unread', label: t('views.unread'), count: unreadCountOf(counts), builtIn: true },
    { id: 'all', label: t('views.all'), builtIn: true },
  ];
  const filtered = Boolean(q) || store !== 'all';

  const region = listRegion({
    state: inbox.state,
    loaded: inbox.loaded,
    connected,
    enabledPlatforms: inbox.enabledPlatforms,
    failedPlatforms: inbox.platformErrors.map((e) => e.platform),
    rowCount: inbox.conversations.length,
    visibleCount: visible.length,
    view,
    filtered,
  });

  // ── header ──────────────────────────────────────────────────────────────────────────────────────────────
  const syncState = inbox.refreshing ? 'pulling' : inbox.state === 'stale' ? 'failed' : 'idle';
  const overflow: ActionSpec[] = [{ id: 'manage-saved-replies', label: t('overflow.manageSaved'), onClick: () => setSavedOpen(true) }];
  const header = (
    <PageHeader
      title={t('title')}
      count={counts.total > 0 ? counts.total : undefined}
      meta={
        region.kind === 'noStore' ? undefined : (
          <SyncMeta source="all" lastPulledAt={inbox.lastFetchedAt} state={syncState} onPull={() => void inbox.refresh()} now={now} />
        )
      }
      overflowActions={region.kind === 'noStore' ? undefined : overflow}
    />
  );

  if (region.kind === 'noStore') {
    return (
      <Page title={t('title')} width="list">
        {header}
        <EmptyState
          kind="first-use"
          icon={icons.message}
          title={t('empty.connect.title')}
          body={t('empty.connect.body')}
          action={{ id: 'connect-store', label: t('empty.connect.action'), href: SETTINGS_CONNECTIONS_HREF }}
          data-testid="messages-no-store"
        />
      </Page>
    );
  }

  // ── list region content ─────────────────────────────────────────────────────────────────────────────────
  let placeholder: React.ReactNode = null;
  if (region.kind === 'loading') placeholder = <ListSkeleton rows={mobile ? 5 : 8} leading="avatar" />;
  else if (region.kind === 'slow') placeholder = <SlowState onRetry={inbox.retry} />;
  else if (region.kind === 'error') {
    // Every platform failed (HTTP 200 with one platformErrors entry each): cause from the codes. Otherwise the
    // request itself failed.
    const platformFailed = inbox.loaded && inbox.platformErrors.length > 0;
    const cause = platformFailed
      ? inbox.platformErrors.map((e) => tBanner(e.code, { name: getLogo(e.platform)?.name ?? e.platform })).join(' ')
      : undefined;
    const errorId = platformFailed
      ? `messages.list · ${inbox.platformErrors.map((e) => `${e.platform}:${e.code}`).join(' · ')}`
      : inbox.error
        ? errorIdOf(inbox.error)
        : undefined;
    placeholder = (
      <ErrorState
        variant="page"
        title={t('error.list.title')}
        cause={cause}
        onRetry={platformFailed ? () => void inbox.refresh() : inbox.retry}
        retrying={platformFailed ? inbox.refreshing : undefined}
        errorId={errorId}
      />
    );
  }
  else if (region.kind === 'empty') {
    placeholder =
      region.empty === 'noResults' ? (
        <EmptyState kind="no-results" title={t('empty.noResults.title')} action={{ id: 'clear-filters', label: t('empty.noResults.action'), onClick: url.clearFilters }} compact />
      ) : region.empty === 'done' ? (
        <EmptyState kind="done" title={t('empty.done.title')} body={t('empty.done.body')} compact />
      ) : (
        <EmptyState kind="first-use" icon={icons.message} title={t('empty.none.title')} compact />
      );
  }

  const searchCaption =
    q && inbox.hasMore && region.kind === 'rows' ? (
      <Box sx={{ px: mobile ? '16px' : '12px', py: '8px', fontSize: 12, lineHeight: '16px', color: neutral[500], borderBottom: `1px solid ${neutral[200]}` }} data-testid="search-loaded-only">
        {t('search.loadedOnly', { count: inbox.conversations.length })}
      </Box>
    ) : null;

  const staleLine =
    inbox.state === 'stale' ? (
      <Box sx={{ mb: '8px' }}>
        <ErrorState variant="stale" staleSince={inbox.lastFetchedAt ?? undefined} onRetry={inbox.retry} retrying={inbox.refreshing} />
      </Box>
    ) : null;

  // A Wix row answered from this tab stays muted only in the Needs reply view (so the list does not jump
  // under the cursor, §5.3); Trendyol keeps the mark everywhere (one-shot answer).
  const rowAnsweredAt = (k: string) => (view === 'needs_reply' || !k.startsWith('wix:') ? inbox.locallyAnsweredAt(k) : null);

  const list = (
    <ConversationList
      rows={visible}
      openKey={openKey}
      onOpen={openConversation}
      locallyAnsweredAt={rowAnsweredAt}
      hasMore={inbox.hasMore && region.kind === 'rows'}
      loadingMore={inbox.loadingMore}
      onLoadMore={inbox.loadMore}
      mobile={mobile}
      placeholder={placeholder ?? undefined}
      header={searchCaption}
      now={now}
    />
  );

  const otherQuestionsCount = openConv?.productInfo?.id
    ? visible.filter((c) => c.productInfo?.id === openConv.productInfo?.id && convKey(c) !== convKey(openConv)).length
    : 0;
  const otherQuestions: OtherQuestionsLink | null =
    openConv && otherQuestionsCount > 0
      ? {
          count: otherQuestionsCount,
          onShow: () => {
            if (openConv.productInfo?.title) url.setSearch(openConv.productInfo.title);
          },
        }
      : null;
  // ThreadPane (G6): useThread posts markSeen on open and reports back through onSeen / onMarkedUnread,
  // so the list only updates its optimistic dot here (no second POST).
  const threadProps: Omit<ThreadPaneProps, 'layout' | 'railHidden' | 'onClose'> | null = openConv
    ? {
        conversation: openConv,
        locallyAnsweredAt: inbox.locallyAnsweredAt(convKey(openConv)),
        onSent: (c, info) => inbox.onSent(c, info),
        onSeen: (c) => markSeen(c, true, { post: false }),
        onMarkedUnread: (c) => markSeen(c, false, { post: false }),
        onPrev: prevKey ? () => openByKey(prevKey) : undefined,
        onNext: nextKey ? () => openByKey(nextKey) : undefined,
        nextUp: nextUpConv ? { name: nextUpConv.customerName || t('list.customerFallback'), onOpen: () => openConversation(nextUpConv) } : null,
        onManageSavedReplies: () => setSavedOpen(true),
        otherQuestions,
        guardNavigation: false,
        now,
      }
    : null;

  const toolbar = (
    <Toolbar
      search={{ value: q ?? '', onChange: url.setSearch, placeholder: t('search.placeholder'), shortcut: '/', debounceMs: 250 }}
      filters={filters}
      values={filterValues}
      onChange={onFilterChange}
      onClearAll={url.clearFilters}
      views={{ views, activeId: view, onSelect: (id) => url.setView(id as InboxView) }}
      resultCount={region.kind === 'rows' ? visible.length : undefined}
      resultLabel={region.kind === 'rows' ? t('list.count', { count: visible.length }) : undefined}
      sticky={mobile}
    />
  );

  return (
    <Page title={t('title')} width="list">
      {header}
      {toolbar}
      <PlatformBanners errors={inbox.platformErrors} onRetry={() => void inbox.refresh()} retrying={inbox.refreshing} />
      {staleLine}
      {mobile ? (
        <>
          {list}
          {threadProps ? <ThreadSheet {...threadProps} open onClose={closeThread} /> : null}
        </>
      ) : (
        <Box
          ref={surfaceRef}
          data-testid="inbox-surface"
          sx={{
            display: 'grid',
            gridTemplateColumns: !threadProps
              ? '1fr'
              : narrow
                ? `${LIST_WIDTH}px minmax(${THREAD_MIN}px, 1fr)`
                : `${LIST_WIDTH}px minmax(${THREAD_MIN}px, 1fr) ${RAIL_WIDTH}px`,
            height: surfaceTop !== null ? `calc(100dvh - ${surfaceTop}px - ${SURFACE_BOTTOM_GAP}px)` : `calc(100dvh - ${layout.topBar}px - 220px)`,
            minHeight: 480,
            border: `1px solid ${neutral[200]}`,
            borderRadius: `${radius.md}px`,
            bgcolor: neutral[0],
            overflow: 'hidden',
          }}
        >
          <Box sx={{ minHeight: 0, borderRight: threadProps ? `1px solid ${neutral[200]}` : 'none', overflow: 'hidden' }}>{list}</Box>
          {threadProps ? (
            <Box sx={{ minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} data-testid="inbox-thread-region">
              <ThreadPane {...threadProps} layout="pane" railHidden={narrow} />
            </Box>
          ) : null}
          {openConv && !narrow ? (
            <Box sx={{ minHeight: 0, borderLeft: `1px solid ${neutral[200]}`, overflowY: 'auto' }} data-testid="inbox-rail-region">
              <ContextRail conversation={openConv} otherQuestions={otherQuestions} now={now} />
            </Box>
          ) : null}
        </Box>
      )}
      <SavedRepliesPanel open={savedOpen} onClose={() => setSavedOpen(false)} />
    </Page>
  );
}

function unreadCountOf(counts: object): number | undefined {
  const v = (counts as { unread?: unknown }).unread;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function errorIdOf(e: Error & { status?: number; code?: string }): string | undefined {
  const parts = [e.status ? `HTTP ${e.status}` : null, e.code ?? null].filter(Boolean);
  return parts.length ? `messages.list · ${parts.join(' · ')}` : undefined;
}

export default MessagesPage;
