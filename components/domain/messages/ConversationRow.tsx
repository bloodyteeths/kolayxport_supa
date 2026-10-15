// components/domain/messages/ConversationRow.tsx (messages G5) — one inbox row (messages §2.1 list, §3.1,
// §4 "Row *" rows): Avatar 32 + brand badge · name (600 when unread) · relative time or "—" · unread dot ·
// one-line preview ("You: " when the newest message is the seller's) · at most one StatusPill · order / product chip.
// The whole row is the target (72px on mobile). Status logic comes from G4 (`messageRowState`).
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ds/data/Avatar';
import { Thumb } from '@/components/ds/data/Thumb';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { DateText } from '@/components/ds/format/DateText';
import { accent, focusRing, font, neutral, px, tone, type as typeScale, zIndex } from '@/lib/ds/tokens';
import type { MessageRowState } from '@/lib/messages/threadState';
import type { UnifiedConversation } from '@/types/messages';

export interface ConversationRowProps {
  conversation: UnifiedConversation;
  /** From `messageRowState(conversation, { locallyAnsweredAt })` (lib/messages/threadState.ts). */
  rowState: MessageRowState;
  selected?: boolean;
  onOpen: (conversation: UnifiedConversation) => void;
  /** Shared clock for relative times (tests). */
  now?: Date;
  /** Mobile: 72px row, 16px side padding. */
  mobile?: boolean;
  'data-testid'?: string;
}

const [denseSize, denseLine] = typeScale.dense;
const [captionSize, captionLine] = typeScale.caption;
/** Order numbers are shown as "#10482" (a symbol, not copy). */
const ORDER_PREFIX = '#';

function ConversationRowImpl({ conversation: c, rowState, selected = false, onOpen, now, mobile = false, 'data-testid': testId }: ConversationRowProps) {
  const t = useTranslations('messages.list');
  const name = c.customerName?.trim() || t('customerFallback');
  const preview = (c.lastMessageText ?? '').replace(/\s+/g, ' ').trim();
  const fromSeller = c.lastFromCustomer === false;
  const { unread, muted, pill, rawTooltip } = rowState;

  const orderLabel = c.orderRef ? ORDER_PREFIX + c.orderRef.replace(/^#/, '') : null;
  const chip =
    c.platform === 'wix' && orderLabel ? (
      <Box component="span" sx={{ fontFamily: font.mono, fontSize: px(captionSize), lineHeight: px(captionLine), color: neutral[600], whiteSpace: 'nowrap' }}>
        {orderLabel}
      </Box>
    ) : c.productInfo?.title ? (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
        <Thumb src={c.productInfo.imageUrl ?? null} alt="" size={16} />
        <Box component="span" sx={{ fontSize: px(captionSize), lineHeight: px(captionLine), color: neutral[600], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {c.productInfo.title}
        </Box>
      </Box>
    ) : null;

  const time = c.lastMessageAt ? (
    <DateText value={c.lastMessageAt} mode="relative" now={now} />
  ) : (
    <Tooltip title={t('timeUnknown')} slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}>
      <Box component="span" aria-label={t('timeUnknown')}>
        —
      </Box>
    </Tooltip>
  );

  const pillNode = pill ? <StatusPill domain="message" status={pill} raw={rawTooltip} size="sm" /> : null;

  return (
    <ButtonBase
      component="div"
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onOpen(c)}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(c);
        }
      }}
      data-testid={testId ?? `conversation-row-${c.platform}-${c.id}`}
      data-unread={unread || undefined}
      data-muted={muted || undefined}
      data-selected={selected || undefined}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        width: '100%',
        textAlign: 'left',
        boxSizing: 'border-box',
        minHeight: mobile ? 72 : 68,
        px: mobile ? '16px' : '12px',
        py: '10px',
        bgcolor: selected ? accent[50] : 'transparent',
        boxShadow: selected ? `inset 3px 0 0 ${accent[600]}` : 'none',
        '&:hover': { bgcolor: selected ? accent[50] : neutral[50] },
        '&.Mui-focusVisible, &:focus-visible': { outline: 'none', boxShadow: focusRing },
      }}
    >
      <Box sx={{ pt: '2px', opacity: muted ? 0.7 : 1 }}>
        <Avatar name={name} size={32} brand={c.platform} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <Box
            component="span"
            data-testid="conversation-name"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: px(denseSize),
              lineHeight: px(denseLine),
              fontWeight: unread ? 600 : 500,
              color: muted ? neutral[600] : neutral[900],
            }}
          >
            {name}
          </Box>
          <Box component="span" sx={{ fontSize: px(captionSize), lineHeight: px(captionLine), color: neutral[500], flexShrink: 0 }}>
            {time}
          </Box>
          {unread ? (
            <Box
              component="span"
              role="img"
              aria-label={t('unreadLabel')}
              data-testid="unread-dot"
              sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tone.info.solid, flexShrink: 0 }}
            />
          ) : null}
        </Box>
        <Box
          component="span"
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: px(denseSize),
            lineHeight: px(denseLine),
            color: preview ? neutral[600] : neutral[500],
            fontStyle: preview ? 'normal' : 'italic',
          }}
          data-testid="conversation-preview"
        >
          {preview ? (
            <>
              {fromSeller ? `${t('youPrefix')} ` : null}
              {preview}
            </>
          ) : (
            t('noText')
          )}
        </Box>
        {pillNode || chip ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, mt: '2px' }}>
            {pillNode}
            {chip}
          </Box>
        ) : null}
      </Box>
    </ButtonBase>
  );
}

export const ConversationRow = React.memo(ConversationRowImpl);
export default ConversationRow;
