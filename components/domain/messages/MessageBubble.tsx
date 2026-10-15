// components/domain/messages/MessageBubble.tsx — messages §11.3 (group G6). Customer bubble: neutral-0
// with a 1px neutral-200 border, left. Seller bubble: neutral-100, no border, right. Radius 8, padding
// 8/12, max width 80% (85% on mobile), body text and a caption meta line "Customer · 10:12". No accent
// fill, so no color gains a new meaning.
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { DateText } from '@/components/ds/format/DateText';
import { neutral as n, radius, type as typeScale } from '@/lib/ds/tokens';
import type { UnifiedMessage } from '@/types/messages';

const HOUR = 60 * 60 * 1000;

export interface MessageBubbleProps {
  message: UnifiedMessage;
  /** Mobile sheet: 85% max width. */
  compact?: boolean;
  now?: Date;
  'data-testid'?: string;
}

/** `relative` for the last hour ("4 min ago"), otherwise the time of day ("10:12"). */
export function bubbleTimeMode(date: string | null | undefined, now: Date = new Date()): 'relative' | 'time' | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.abs(now.getTime() - t) < HOUR ? 'relative' : 'time';
}

export function MessageBubble({ message, compact, now, 'data-testid': testId }: MessageBubbleProps) {
  const t = useTranslations('messages.thread');
  const seller = message.sender === 'seller';
  const timeMode = bubbleTimeMode(message.date, now);
  const [bodySize, bodyLine] = typeScale.body;
  const [capSize, capLine] = typeScale.caption;

  return (
    <Box
      data-testid={testId ?? 'message-bubble'}
      data-sender={message.sender}
      sx={{ display: 'flex', justifyContent: seller ? 'flex-end' : 'flex-start' }}
    >
      <Box
        sx={{
          maxWidth: compact ? '85%' : '80%',
          px: '12px',
          py: '8px',
          borderRadius: `${radius.md}px`,
          bgcolor: seller ? n[100] : n[0],
          border: seller ? '1px solid transparent' : `1px solid ${n[200]}`,
          color: n[900],
        }}
      >
        <Box
          component="p"
          sx={{ m: 0, fontSize: bodySize, lineHeight: `${bodyLine}px`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {message.text}
        </Box>
        <Box sx={{ mt: '4px', fontSize: capSize, lineHeight: `${capLine}px`, color: n[500] }}>
          {seller ? t('you') : t('customer')}
          {timeMode && (
            <>
              {' · '}
              <DateText value={message.date} mode={timeMode} now={now} />
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default MessageBubble;
