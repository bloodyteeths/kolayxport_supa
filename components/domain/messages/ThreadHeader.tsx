// components/domain/messages/ThreadHeader.tsx — messages §2.1–2.2 thread header, §3.2 sheet header
// (group G6). Desktop: Avatar 40 (Wix) or product Thumb 40 (Trendyol) · name · LogoTile withName ·
// one StatusPill · caption "Last message 4 min ago" / "Asked 2 h ago · public question" · ‹ › (k / j) ·
// optional "Customer & orders" button (rail collapsed) · ⋯. Mobile sheet: ✕ · name + logo · ⋯, then
// pill · time (sheets close with ✕, CRITIQUE C16).
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ds/data/Avatar';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Thumb } from '@/components/ds/data/Thumb';
import { Button } from '@/components/ds/inputs/Button';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { OverflowMenu, type OverflowItem } from '@/components/ds/overlay/OverflowMenu';
import { icons } from '@/lib/ds/icons';
import { neutral as n, type as typeScale } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import type { MessageStatusKey } from '@/lib/ds/status/vocabulary';
import type { UnifiedConversation } from '@/types/messages';

export interface ThreadHeaderProps {
  conversation: UnifiedConversation;
  layout?: 'pane' | 'sheet';
  /** The one pill (from `messageRowState`); null renders none. */
  pill: Exclude<MessageStatusKey, 'unread'> | null;
  rawStatus?: string | null;
  onPrev?: () => void;
  onNext?: () => void;
  /** Sheet only: ✕. */
  onClose?: () => void;
  overflow?: OverflowItem[];
  /** Desktop with the rail collapsed (content < 1180): opens the context SidePanel. */
  contextButton?: { label: string; onClick: () => void } | null;
  now?: Date;
}

export function ThreadHeader({ conversation: c, layout = 'pane', pill, rawStatus, onPrev, onNext, onClose, overflow = [], contextButton, now }: ThreadHeaderProps) {
  const t = useTranslations('messages.thread');
  const tOverlay = useTranslations('ds.overlay');
  const f = useFormatters();
  const isTrendyol = c.platform === 'trendyol';
  const name = c.customerName?.trim() || t('customer');
  const when = f.relative(c.lastMessageAt, now);
  const caption = isTrendyol ? t('asked', { time: when }) : t('lastMessage', { time: when });
  const [titleSize, titleLine, titleWeight] = typeScale.titleMd;
  const [capSize, capLine] = typeScale.caption;
  const sheet = layout === 'sheet';

  const leading = sheet ? null : isTrendyol ? (
    <Thumb src={c.productInfo?.imageUrl} alt={c.productInfo?.title || name} size={40} />
  ) : (
    <Avatar name={name} size={40} />
  );

  const pillNode = <StatusPill domain="message" status={pill} raw={rawStatus} size={sheet ? 'sm' : 'md'} />;

  return (
    <Box
      component="header"
      data-testid="thread-header"
      sx={{
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0,
        minHeight: sheet ? 56 : 64, px: sheet ? '8px' : '16px', py: '8px',
        borderBottom: `1px solid ${n[200]}`, bgcolor: n[0],
        ...(sheet && { position: 'sticky', top: 0, zIndex: 1 }),
      }}
    >
      {sheet && onClose && <IconButton icon={icons.close} label={tOverlay('close')} size="lg" onClick={onClose} data-testid="thread-close" />}
      {leading}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <Box
            component="h2"
            data-testid="thread-title"
            sx={{ m: 0, minWidth: 0, fontSize: titleSize, lineHeight: `${titleLine}px`, fontWeight: titleWeight, color: n[900], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {name}
          </Box>
          <LogoTile brand={c.platform} size={16} withName={!sheet} />
          {!sheet && pillNode}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '2px', fontSize: capSize, lineHeight: `${capLine}px`, color: n[500], minWidth: 0 }}>
          {sheet && pillNode}
          <Box component="span" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {caption}
          </Box>
        </Box>
      </Box>
      {!sheet && contextButton && (
        <Button variant="ghost" size="sm" onClick={contextButton.onClick} data-testid="thread-context-button">
          {contextButton.label}
        </Button>
      )}
      {!sheet && onPrev && <IconButton icon={icons.back} label={t('prev')} shortcut="k" size="sm" onClick={onPrev} data-testid="thread-prev" />}
      {!sheet && onNext && <IconButton icon={icons.next} label={t('next')} shortcut="j" size="sm" onClick={onNext} data-testid="thread-next" />}
      {overflow.length > 0 && <OverflowMenu items={overflow} size={sheet ? 'md' : 'sm'} data-testid="thread-overflow" />}
    </Box>
  );
}

export default ThreadHeader;
