/**
 * Message an Amazon buyer (orders §4.3 / CRITIQUE U4): Modal sm rebuilt from the legacy
 * `components/amazon/AmazonMessageDialog.tsx` with DS parts. Message type `Select` + text `TextArea`,
 * primary "Send to Amazon". SP-API messaging is one-way (no inbox), so Messages M8 does not take it over.
 *
 * Same API as the legacy dialog:
 *  GET  /api/integrations/amazon/messages?orderId=&marketplaceId=  → { allowedActions[], mcf? }
 *  POST /api/integrations/amazon/messages { orderId, marketplaceId, messageType, text }
 *  POST /api/integrations/amazon/messages { orderId, marketplaceId, action: 'productReviewAndSellerFeedback' }
 * `orderId` is the Amazon order number (`OrderRow.orderNumber`), as the legacy page sent it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { TextArea } from '@/components/ds/inputs/TextArea';
import { Banner } from '@/components/ds/feedback/Banner';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { useToast } from '@/components/ds/feedback/toast';
import { neutral } from '@/lib/ds/tokens';
import { icons } from '@/lib/ds/icons';
import type { OrderRow } from '@/lib/orders/types';

export type AmazonMessageType =
  | 'unexpectedProblem'
  | 'confirmDeliveryDetails'
  | 'confirmOrderDetails'
  | 'confirmCustomizationDetails'
  | 'confirmServiceDetails';

/** `reviewRequest` = Solicitations API (no text). */
export type MessageBuyerKind = AmazonMessageType | 'reviewRequest';

export const AMAZON_MESSAGE_TYPES: readonly AmazonMessageType[] = [
  'unexpectedProblem',
  'confirmDeliveryDetails',
  'confirmOrderDetails',
  'confirmCustomizationDetails',
  'confirmServiceDetails',
];

export const AMAZON_MESSAGE_MAX = 4000;

/** Marketplace id the legacy page sent (`marketplaceId` column, else `rawData.salesChannel`). */
export function amazonMarketplaceId(row: OrderRow | null): string | undefined {
  if (!row) return undefined;
  const raw = row.raw as { marketplaceId?: unknown; rawData?: { salesChannel?: unknown } | null };
  const v = raw?.marketplaceId ?? raw?.rawData?.salesChannel;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Request body for a send (exported for tests). */
export function buildMessageBody(row: OrderRow, kind: MessageBuyerKind, text: string) {
  const base = { orderId: row.orderNumber, marketplaceId: amazonMarketplaceId(row) };
  if (kind === 'reviewRequest') return { ...base, action: 'productReviewAndSellerFeedback' };
  return { ...base, messageType: kind, text: text.trim() };
}

/** Templates are allowed when Amazon returned no list (unknown), or when it lists them. */
export function isAllowedKind(kind: MessageBuyerKind, allowed: string[] | null): boolean {
  if (kind === 'reviewRequest') return true; // Solicitations is a separate API; Amazon gives the verdict on send.
  return !allowed || allowed.length === 0 || allowed.includes(kind);
}

export interface MessageBuyerModalProps {
  open: boolean;
  row: OrderRow | null;
  onClose: () => void;
}

export function MessageBuyerModal({ open, row, onClose }: MessageBuyerModalProps) {
  const t = useTranslations('orders.messageBuyer');
  const toast = useToast();
  const [kind, setKind] = useState<MessageBuyerKind>('unexpectedProblem');
  const [text, setText] = useState('');
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [isMCF, setIsMCF] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<'load' | 'send' | null>(null);
  const [textError, setTextError] = useState<string | null>(null);

  const orderNumber = row?.orderNumber;
  const marketplaceId = amazonMarketplaceId(row);

  useEffect(() => {
    if (!open || !orderNumber) return;
    let cancelled = false;
    setKind('unexpectedProblem');
    setText('');
    setAllowed(null);
    setIsMCF(Boolean(row?.isMCF));
    setError(null);
    setTextError(null);
    setLoading(true);
    const qs = new URLSearchParams({ orderId: orderNumber, ...(marketplaceId ? { marketplaceId } : {}) });
    fetch(`/api/integrations/amazon/messages?${qs.toString()}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json().catch(() => ({}))) as { allowedActions?: string[]; mcf?: boolean };
        if (cancelled) return;
        setAllowed(Array.isArray(data.allowedActions) ? data.allowedActions : []);
        if (data.mcf) setIsMCF(true);
      })
      .catch(() => {
        // Not blocking: every template stays selectable and Amazon gives the verdict on send.
        if (!cancelled) setAllowed(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderNumber, marketplaceId]);

  const kinds: MessageBuyerKind[] = [...AMAZON_MESSAGE_TYPES, 'reviewRequest'];
  const options: SelectOption<MessageBuyerKind>[] = useMemo(
    () => kinds.map((k) => ({
      value: k,
      label: t(`type.${k}`),
      disabled: !isAllowedKind(k, allowed),
      description: !isAllowedKind(k, allowed) ? t('notAllowed') : k === 'reviewRequest' ? t('reviewHint') : undefined,
    })),
    [allowed, t],
  );

  const needsText = kind !== 'reviewRequest';

  const send = async () => {
    if (!row || sending) return;
    if (needsText && !text.trim()) {
      setTextError(t('textRequired'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/amazon/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildMessageBody(row, kind, text)),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(kind === 'reviewRequest' ? t('reviewSent') : t('sent'));
      onClose();
    } catch {
      setError('send');
    } finally {
      setSending(false);
    }
  };

  const blockedReason = isMCF ? t('mcf') : !isAllowedKind(kind, allowed) ? t('notAllowed') : undefined;

  return (
    <Modal
      open={open && !!row}
      onClose={sending ? () => undefined : onClose}
      size="sm"
      title={t('title')}
      description={row ? t('order', { number: `#${row.orderNumber}` }) : undefined}
      primary={{
        id: 'send-message',
        label: kind === 'reviewRequest' ? t('requestReview') : t('send'),
        icon: icons.message,
        onClick: () => void send(),
        loading: sending,
        loadingLabel: t('sending'),
        disabled: Boolean(blockedReason),
        disabledReason: blockedReason,
      }}
      data-testid="message-buyer-modal"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>{t('outboundOnly')}</Typography>
        {isMCF && <Banner tone="warning" title={t('mcf')} data-testid="message-buyer-mcf" />}
        {error === 'send' && (
          <ErrorState variant="inline" title={t('failed')} cause={t('failedCause')} onRetry={() => void send()} data-testid="message-buyer-error" />
        )}
        <FormField label={t('typeLabel')} htmlFor="message-buyer-type" helper={loading ? t('checking') : undefined}>
          <Select<MessageBuyerKind>
            id="message-buyer-type"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setTextError(null);
            }}
            options={options}
            disabled={isMCF}
            data-testid="message-buyer-type"
          />
        </FormField>
        {needsText && (
          <FormField
            label={t('text')}
            htmlFor="message-buyer-text"
            error={textError}
            counter={{ value: text.length, max: AMAZON_MESSAGE_MAX }}
          >
            <TextArea
              id="message-buyer-text"
              value={text}
              onChange={(v) => {
                setText(v.slice(0, AMAZON_MESSAGE_MAX));
                if (textError) setTextError(null);
              }}
              minRows={4}
              maxRows={10}
              maxLength={AMAZON_MESSAGE_MAX}
              disabled={isMCF}
              data-testid="message-buyer-text"
            />
          </FormField>
        )}
      </Box>
    </Modal>
  );
}

export default MessageBuyerModal;
