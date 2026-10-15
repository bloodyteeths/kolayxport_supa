// components/domain/messages/ThreadPane.tsx — messages §1 center region, §2.1–2.3, §3.2 thread sheet,
// §5.1 thread rows, §5.3 (group G6).
//
// <ThreadPane> is the center region of the inbox: header, history grouped by day, and the composer
// region. It keys its inner state by `platform:id`, so switching threads resets everything (the unsent
// text survives in sessionStorage). The page (G5) owns the list, `?open=`, j/k, the `locallyAnswered`
// map, counts and polling; it passes the open conversation and callbacks in.
//
// <ThreadSheet> is the mobile (< 900) full-height sheet around a ThreadPane (z 1200, above the tab bar),
// with the keyboard inset applied so the composer follows the on-screen keyboard.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import { useTranslations } from 'next-intl';
import { DateText } from '@/components/ds/format/DateText';
import { Button } from '@/components/ds/inputs/Button';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import type { OverflowItem } from '@/components/ds/overlay/OverflowMenu';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { icons } from '@/lib/ds/icons';
import { neutral as n, type as typeScale, zIndex } from '@/lib/ds/tokens';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { useFormatters } from '@/lib/format';
import type { FillContext } from '@/lib/messages/fillVariables';
import { messageRowState } from '@/lib/messages/threadState';
import type { UnifiedConversation } from '@/types/messages';
import { Composer } from './Composer';
import { ContextRail, useContextTitle, type OtherQuestionsLink } from './ContextRail';
import { ContextSheet, ContextSummaryRow } from './ContextSheet';
import { MessageBubble } from './MessageBubble';
import { orderHref, useOrderContext } from './OrderContextList';
import { ThreadHeader } from './ThreadHeader';
import { useKeyboardInset, KB_INSET_VAR } from './useKeyboardInset';
import {
  groupByDay,
  threadKey,
  useThread,
  useUnsentReplyGuard,
  type ThreadSentInfo,
} from './useThread';

export interface ThreadPaneProps {
  conversation: UnifiedConversation;
  /** `pane` = desktop center region (default). `sheet` = mobile layout; use <ThreadSheet> for the frame. */
  layout?: 'pane' | 'sheet';
  /**
   * Pane only: true when the page does not render <ContextRail> next to the pane (content < 1180). The
   * header then shows "Customer & orders" / "Product", which opens the rail as SidePanel sm.
   */
  railHidden?: boolean;
  /** ISO time from the page's `locallyAnswered` map (a poll must not re-open a one-shot answer). */
  locallyAnsweredAt?: string | null;
  /** After a successful send: set `locallyAnswered`, mute the row, decrement the badge, re-fetch counts in 4s. */
  onSent?: (conversation: UnifiedConversation, info: ThreadSentInfo) => void;
  /** Right after the pane fired `markSeen` on open: clear the row dot optimistically (do not POST again). */
  onSeen?: (conversation: UnifiedConversation) => void;
  /** After ⋯ › Mark as unread was posted: put the dot back (do not POST again). */
  onMarkedUnread?: (conversation: UnifiedConversation) => void;
  /** ‹ › in the header (the page binds k / j). Omit to hide a button. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Shown under the history after a send: "Next: Mehmet Y. ›". */
  nextUp?: { name: string; onOpen: () => void } | null;
  /** Sheet: ✕. */
  onClose?: () => void;
  /** ⋯ › Manage saved replies, and the picker's "Manage saved replies" (page-level SavedRepliesPanel). */
  onManageSavedReplies?: () => void;
  /**
   * Optional: the page binds `Enter` itself and calls the registered function. Without it the pane binds
   * `Enter` → focus the composer (page scope; panel scope in the sheet).
   */
  registerComposerFocus?: (fn: (() => void) | null) => void;
  /** Trendyol rail inside the collapsed panel / mobile sheet: "N other questions about this product". */
  otherQuestions?: OtherQuestionsLink | null;
  /**
   * "Discard your unsent reply?" when leaving /app/mesajlar with unsent text. Default true. The inbox page
   * mounts `useUnsentReplyGuard` itself (it must outlive a closed mobile sheet) and passes false here.
   */
  guardNavigation?: boolean;
  /** Default true: POST `markSeen` on open and for Mark as unread (then `onSeen` / `onMarkedUnread`). */
  markSeenOnOpen?: boolean;
  now?: Date;
}

export function ThreadPane(props: ThreadPaneProps) {
  return <ThreadPaneInner key={threadKey(props.conversation)} {...props} />;
}

export interface ThreadSheetProps extends Omit<ThreadPaneProps, 'layout' | 'railHidden' | 'onClose'> {
  open: boolean;
  /** ✕, Esc (outside the composer) and the system back gesture. The unsent text is kept. */
  onClose: () => void;
}

/** Mobile (< 900) thread: full-height sheet (100dvh, z 1200 above the tab bar), keyboard inset as padding. */
export function ThreadSheet({ open, onClose, ...pane }: ThreadSheetProps) {
  useKeyboardInset(open);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      sx={{ zIndex: zIndex.drawer }}
      PaperProps={{
        'aria-label': pane.conversation.customerName || undefined,
        sx: { height: '100dvh', display: 'flex', flexDirection: 'column', pb: `var(${KB_INSET_VAR}, 0px)`, bgcolor: n[0] },
      } as never}
      data-testid="thread-sheet"
    >
      <ThreadPane {...pane} layout="sheet" onClose={onClose} />
    </Dialog>
  );
}

function DayDivider({ date, now }: { date: string | null; now?: Date }) {
  const [size, line] = typeScale.caption;
  if (!date) return null;
  return (
    <Box role="separator" sx={{ display: 'flex', justifyContent: 'center', py: '4px', fontSize: size, lineHeight: `${line}px`, color: n[500] }}>
      <DateText value={date} mode="date" now={now} />
    </Box>
  );
}

function ThreadPaneInner({
  conversation: c,
  layout = 'pane',
  railHidden = false,
  locallyAnsweredAt,
  onSent,
  onSeen,
  onMarkedUnread,
  onPrev,
  onNext,
  nextUp,
  onClose,
  onManageSavedReplies,
  registerComposerFocus,
  otherQuestions,
  guardNavigation = true,
  markSeenOnOpen = true,
  now,
}: ThreadPaneProps) {
  const t = useTranslations('messages.thread');
  const tComposer = useTranslations('messages.composer');
  const tSaved = useTranslations('messages.saved');
  const tContext = useTranslations('messages.context');
  const f = useFormatters();
  const sheet = layout === 'sheet';
  const isWix = c.platform === 'wix';

  const thread = useThread(c, { locallyAnsweredAt, onSent, onSeen, onMarkedUnread, postReadState: markSeenOnOpen });
  // A send from this tab mutes the header pill too (same rule as the row, messages §5.3).
  const effectiveLocal = locallyAnsweredAt ?? (thread.justSent ? 'sent' : null);
  const row = messageRowState(c, { locallyAnsweredAt: effectiveLocal });

  useUnsentReplyGuard(
    { title: tComposer('discard.title'), keep: tComposer('discard.keep'), discard: tComposer('discard.confirm') },
    { enabled: guardNavigation },
  );

  const { orders } = useOrderContext(isWix ? c.contactId : null);
  const newest = orders[0];
  const fillContext = useMemo<FillContext>(() => ({
    customerName: c.customerName,
    productTitle: isWix ? newest?.items?.[0]?.name ?? null : c.productInfo?.title ?? null,
    orderNumber: isWix ? newest?.orderNumber ?? c.orderRef ?? null : null,
  }), [c.customerName, c.productInfo?.title, c.orderRef, isWix, newest]);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const focusComposer = useCallback((): boolean => {
    if (!inputRef.current) return false;
    inputRef.current.focus();
    return true;
  }, []);
  useEffect(() => {
    if (!registerComposerFocus) return undefined;
    registerComposerFocus(() => void focusComposer());
    return () => registerComposerFocus(null);
  }, [registerComposerFocus, focusComposer]);
  useShortcuts(
    { enter: { handler: () => focusComposer(), description: tComposer('focusShortcut') } },
    { scope: sheet ? 'panel' : 'page', enabled: !registerComposerFocus },
  );

  // History scrolls to the newest message on open and on every new bubble.
  const historyRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(() => groupByDay(thread.messages, f.timeZone), [thread.messages, f.timeZone]);
  const count = thread.messages.length;
  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, thread.loading]);

  const [contextOpen, setContextOpen] = useState(false);
  const contextTitle = useContextTitle(c);

  const overflow: OverflowItem[] = [
    { id: 'markUnread', label: t('markUnread'), onClick: () => void thread.markUnread() },
  ];
  if (!isWix && c.productInfo?.webUrl) {
    overflow.push({ id: 'viewOnTrendyol', label: t('viewOnTrendyol'), icon: icons.externalLink, href: c.productInfo.webUrl });
  }
  if (isWix && newest?.kxOrderId) {
    overflow.push({ id: 'openOrder', label: tContext('openOrder'), href: orderHref(newest.kxOrderId) });
  }
  if (onManageSavedReplies) {
    overflow.push({ id: 'manageSaved', label: tSaved('manage'), onClick: onManageSavedReplies });
  }

  let history: ReactNode;
  if (thread.loading) {
    history = <PanelSkeleton sections={2} data-testid="thread-loading" />;
  } else if (thread.loadError) {
    history = <ErrorState variant="inline" title={t('error.title')} onRetry={thread.retry} data-testid="thread-error" />;
  } else if (count === 0) {
    const [size, line, weight] = typeScale.titleSm;
    const [bSize, bLine] = typeScale.dense;
    history = (
      <Box data-testid="thread-empty" sx={{ textAlign: 'center', py: '32px', px: '16px' }}>
        <Box sx={{ fontSize: size, lineHeight: `${line}px`, fontWeight: weight, color: n[900] }}>{t('empty.title')}</Box>
        <Box sx={{ mt: '4px', fontSize: bSize, lineHeight: `${bLine}px`, color: n[500] }}>{t('empty.body')}</Box>
      </Box>
    );
  } else {
    history = groups.map((g, gi) => (
      <Box key={`${g.day}-${gi}`} sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <DayDivider date={g.date} now={now} />
        {g.messages.map((m) => (
          <MessageBubble key={m.id} message={m} compact={sheet} now={now} />
        ))}
      </Box>
    ));
  }

  return (
    <Box
      data-testid="thread-pane"
      data-thread={threadKey(c)}
      sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, height: '100%', bgcolor: n[0] }}
    >
      <ThreadHeader
        conversation={c}
        layout={layout}
        pill={row.pill}
        rawStatus={row.rawTooltip}
        onPrev={onPrev}
        onNext={onNext}
        onClose={onClose}
        overflow={overflow}
        contextButton={!sheet && railHidden ? { label: contextTitle, onClick: () => setContextOpen(true) } : null}
        now={now}
      />
      {sheet && <ContextSummaryRow conversation={c} onOpen={() => setContextOpen(true)} />}

      <Box
        ref={historyRef}
        data-testid="thread-history"
        aria-live="polite"
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: '12px', px: '16px', py: '16px', bgcolor: n[25] }}
      >
        {history}
        {thread.justSent && nextUp && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" trailingIcon={icons.next} onClick={nextUp.onOpen} data-testid="thread-next-up">
              {t('nextUp', { name: nextUp.name })}
            </Button>
          </Box>
        )}
      </Box>

      <Composer thread={thread} fillContext={fillContext} layout={layout} onManageSavedReplies={onManageSavedReplies} inputRef={inputRef} />

      {sheet ? (
        <ContextSheet open={contextOpen} onClose={() => setContextOpen(false)} conversation={c} otherQuestions={otherQuestions} now={now} />
      ) : (
        railHidden && (
          <SidePanel open={contextOpen} onClose={() => setContextOpen(false)} size="sm" title={contextTitle} data-testid="thread-context-panel">
            <ContextRail conversation={c} variant="embedded" otherQuestions={otherQuestions} now={now} />
          </SidePanel>
        )
      )}
    </Box>
  );
}

export default ThreadPane;
