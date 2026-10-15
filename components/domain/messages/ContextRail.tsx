// components/domain/messages/ContextRail.tsx — messages §1, §2.1–2.2, §4 rail rows (group G6).
// Right region of the inbox (the page's 320px grid column draws the border; the rail scrolls itself). Wix: Customer (name, email copy) + Orders. Trendyol:
// Product + "N other questions about this product". `variant="embedded"` renders the same sections
// without the rail chrome, inside the "Customer & orders" SidePanel (content < 1180) or the mobile
// ContextSheet.
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { CopyText } from '@/components/ds/format/CopyText';
import { Button } from '@/components/ds/inputs/Button';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { neutral as n, type as typeScale } from '@/lib/ds/tokens';
import type { UnifiedConversation } from '@/types/messages';
import { OrderContextList } from './OrderContextList';
import { ProductContextCard } from './ProductContextCard';

/** Rail width (messages §2.1; CRITIQUE C23 "right rail 320–360"). */
export const CONTEXT_RAIL_WIDTH = 320;

export interface OtherQuestionsLink {
  /** Loaded rows with the same `productInfo.id`, this one excluded. */
  count: number;
  /** The page sets search to the product title. */
  onShow: () => void;
}

export interface ContextRailProps {
  conversation: UnifiedConversation;
  /** `rail` = the page's right grid column (the page draws the column border); `embedded` = inside a panel/sheet. */
  variant?: 'rail' | 'embedded';
  otherQuestions?: OtherQuestionsLink | null;
  /** Same as `otherQuestions` in two props (G5 MessagesPage shape). Ignored when `otherQuestions` is set. */
  otherQuestionsCount?: number;
  onShowOtherQuestions?: () => void;
  now?: Date;
  'data-testid'?: string;
}

/** Title of the rail / panel / sheet for this thread. */
export function useContextTitle(conversation: Pick<UnifiedConversation, 'platform'>): string {
  const t = useTranslations('messages.context');
  return conversation.platform === 'trendyol' ? t('product') : t('title');
}

export function ContextRail({
  conversation, variant = 'rail', otherQuestions: otherProp, otherQuestionsCount, onShowOtherQuestions, now, 'data-testid': testId,
}: ContextRailProps) {
  const otherQuestions: OtherQuestionsLink | null = otherProp
    ?? (onShowOtherQuestions && otherQuestionsCount ? { count: otherQuestionsCount, onShow: onShowOtherQuestions } : null);
  const t = useTranslations('messages.context');
  const tThread = useTranslations('messages.thread');
  const title = useContextTitle(conversation);
  const isWix = conversation.platform === 'wix';
  const [titleSize, titleLine, titleWeight] = typeScale.titleSm;
  const [denseSize, denseLine] = typeScale.dense;
  const name = conversation.customerName?.trim() || tThread('customer');

  const sections = (
    <>
      {isWix && (
        <SidePanelSection id="msg-context-customer" title={t('customer')}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: denseSize, lineHeight: `${denseLine}px`, color: n[800] }}>
            <Box data-testid="context-customer-name">{name}</Box>
            {conversation.customerEmail && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, color: n[600] }}>
                <Box component="span" sx={{ color: n[500] }}>{t('email')}</Box>
                <CopyText value={conversation.customerEmail} truncate={28} />
              </Box>
            )}
          </Box>
        </SidePanelSection>
      )}
      {isWix && (
        <SidePanelSection id="msg-context-orders" title={t('orders')}>
          <OrderContextList contactId={conversation.contactId} now={now} />
        </SidePanelSection>
      )}
      {!isWix && conversation.productInfo && (
        <SidePanelSection id="msg-context-product" title={t('product')}>
          <ProductContextCard productInfo={conversation.productInfo} />
        </SidePanelSection>
      )}
      {!isWix && conversation.customerName?.trim() && (
        <SidePanelSection id="msg-context-customer" title={t('customer')}>
          <Box sx={{ fontSize: denseSize, lineHeight: `${denseLine}px`, color: n[800] }}>{name}</Box>
        </SidePanelSection>
      )}
      {!isWix && otherQuestions && otherQuestions.count > 0 && (
        <Box sx={{ px: '12px', py: '8px', borderTop: `1px solid ${n[100]}` }}>
          <Button variant="ghost" size="sm" onClick={otherQuestions.onShow} data-testid="other-questions">
            {t('otherQuestions', { count: otherQuestions.count })}
          </Button>
        </Box>
      )}
    </>
  );

  if (variant === 'embedded') {
    return <Box data-testid={testId ?? 'context-rail-embedded'}>{sections}</Box>;
  }

  return (
    <Box
      component="aside"
      aria-label={title}
      data-testid={testId ?? 'context-rail'}
      sx={{ width: '100%', minHeight: 0, height: '100%', overflowY: 'auto', bgcolor: n[0] }}
    >
      {isWix && (
        <Box component="h2" sx={{ m: 0, px: '20px', pt: '16px', fontSize: titleSize, lineHeight: `${titleLine}px`, fontWeight: titleWeight, color: n[900] }}>
          {title}
        </Box>
      )}
      {sections}
    </Box>
  );
}

export default ContextRail;
