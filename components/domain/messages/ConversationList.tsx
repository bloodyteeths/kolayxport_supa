// components/domain/messages/ConversationList.tsx (messages G5) — the left region of the inbox (desktop,
// 360px, scrolls on its own) and the mobile list (one bordered surface, 1px dividers, gap 0: messages §3.1,
// DS addition §11.5). Rows are `ConversationRow`; "Load more" uses the DataTable cursor button style.
// States other than "rows" (skeleton, empty, error) are rendered by the page into `placeholder`.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { neutral, radius } from '@/lib/ds/tokens';
import { messageRowState } from '@/lib/messages/threadState';
import type { UnifiedConversation } from '@/types/messages';
import { ConversationRow } from './ConversationRow';
import { convKey } from './useInbox';

export interface ConversationListProps {
  rows: UnifiedConversation[];
  /** Key (`wix:abc`) of the open thread. */
  openKey: string | null;
  onOpen: (conversation: UnifiedConversation) => void;
  /** From `useInbox().locallyAnsweredAt`. */
  locallyAnsweredAt: (key: string) => string | null;
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
  mobile?: boolean;
  /** Replaces the rows (skeleton / empty / error), keeps the region frame. */
  placeholder?: React.ReactNode;
  /** Above the rows, inside the region (e.g. the "Searching 50 loaded…" caption). */
  header?: React.ReactNode;
  now?: Date;
}

export function ConversationList({
  rows,
  openKey,
  onOpen,
  locallyAnsweredAt,
  hasMore,
  loadingMore = false,
  onLoadMore,
  mobile = false,
  placeholder,
  header,
  now,
}: ConversationListProps) {
  const t = useTranslations('messages.list');
  const showRows = !placeholder;

  return (
    <Box
      component="section"
      aria-label={t('regionLabel')}
      data-testid="conversation-list"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        ...(mobile
          ? { border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`, bgcolor: neutral[0], overflow: 'hidden' }
          : { height: '100%', overflowY: 'auto', overscrollBehavior: 'contain' }),
      }}
    >
      {header}
      {showRows ? (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {rows.map((c, i) => {
            const k = convKey(c);
            const rowState = messageRowState(c, { locallyAnsweredAt: locallyAnsweredAt(k) });
            return (
              <Box component="li" key={k} sx={{ borderTop: i === 0 ? 'none' : `1px solid ${neutral[200]}` }}>
                <ConversationRow conversation={c} rowState={rowState} selected={k === openKey} onOpen={onOpen} now={now} mobile={mobile} />
              </Box>
            );
          })}
        </Box>
      ) : (
        placeholder
      )}
      {showRows && hasMore ? (
        <Box sx={{ p: '12px', borderTop: `1px solid ${neutral[200]}` }}>
          <Button variant="secondary" size="sm" fullWidth loading={loadingMore} onClick={onLoadMore} data-testid="inbox-load-more">
            {t('loadMore')}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

export default ConversationList;
