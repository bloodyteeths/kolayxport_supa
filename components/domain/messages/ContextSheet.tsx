// components/domain/messages/ContextSheet.tsx — messages §3.2 context summary row and §3.3 context bottom
// sheet (group G6). Mobile only: the 48px row under the thread sheet header ("[▪] 2 orders · #10482
// To ship ›" for Wix, product thumb + title for Trendyol) opens a DS BottomSheet with the rail sections.
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Thumb } from '@/components/ds/data/Thumb';
import { BottomSheet } from '@/components/ds/overlay/BottomSheet';
import { Bone } from '@/components/ds/state/Skeletons';
import { ICON_STROKE, iconSize, icons } from '@/lib/ds/icons';
import { orderStatus } from '@/lib/ds/status/orders';
import { focusRing, neutral as n, type as typeScale } from '@/lib/ds/tokens';
import type { UnifiedConversation } from '@/types/messages';
import { ContextRail, useContextTitle, type OtherQuestionsLink } from './ContextRail';
import { useOrderContext } from './OrderContextList';

export interface ContextSheetProps {
  open: boolean;
  onClose: () => void;
  conversation: UnifiedConversation;
  otherQuestions?: OtherQuestionsLink | null;
  now?: Date;
}

/** Sits over the full-height thread sheet (z 1200), so it is nested (z 1550). */
export function ContextSheet({ open, onClose, conversation, otherQuestions, now }: ContextSheetProps) {
  const title = useContextTitle(conversation);
  return (
    <BottomSheet open={open} onClose={onClose} title={title} nested data-testid="context-sheet">
      <ContextRail conversation={conversation} variant="embedded" otherQuestions={otherQuestions} now={now} />
    </BottomSheet>
  );
}

export interface ContextSummaryRowProps {
  conversation: UnifiedConversation;
  onOpen: () => void;
}

const NextIcon = icons.next;

export function ContextSummaryRow({ conversation, onOpen }: ContextSummaryRowProps) {
  const t = useTranslations('messages.context');
  const title = useContextTitle(conversation);
  const isWix = conversation.platform === 'wix';
  const { orders, loading, error } = useOrderContext(isWix ? conversation.contactId : null);
  const [denseSize, denseLine] = typeScale.dense;

  let leading: ReactNode = null;
  let body: ReactNode = title;
  if (isWix) {
    const newest = orders[0];
    if (loading) body = <Bone w="60%" h={12} />;
    // D9: a failed lookup is an error, never "no orders".
    else if (error) body = t('ordersError');
    else if (newest) {
      leading = <Thumb src={newest.items?.[0]?.imageUrl} alt={newest.items?.[0]?.name || title} size={32} />;
      body = (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <Box component="span" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t('summary', { count: orders.length, latest: `#${newest.orderNumber}` })}
          </Box>
          <StatusPill domain="order" status={orderStatus(newest.status, 'wix')} raw={newest.status} size="sm" />
        </Box>
      );
    } else if (conversation.contactId) body = t('noOrders');
  } else if (conversation.productInfo) {
    leading = <Thumb src={conversation.productInfo.imageUrl} alt={conversation.productInfo.title} size={32} />;
    body = conversation.productInfo.title;
  }

  return (
    <Box
      component="button"
      type="button"
      onClick={onOpen}
      aria-label={title}
      data-testid="context-summary-row"
      sx={{
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%', minHeight: 48, px: '16px', py: '8px',
        border: 0, borderBottom: `1px solid ${n[200]}`, bgcolor: n[25], color: n[800], textAlign: 'left', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: denseSize, lineHeight: `${denseLine}px`,
        '&:focus-visible': { outline: 'none', boxShadow: focusRing },
      }}
    >
      {leading}
      <Box component="span" sx={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {body}
      </Box>
      <NextIcon size={iconSize.control} strokeWidth={ICON_STROKE} aria-hidden color={n[400]} />
    </Box>
  );
}

export default ContextSheet;
