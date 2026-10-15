// components/domain/pricing/FoundingFullModal.tsx — the founding race (settings §10.4, A4): checkout answered
// 409 `founding_full`. "The founding spots just ran out" · "Growth is ₺4.999 a month. Continue to checkout?"
// · [Not now] [Continue] (Continue re-posts with `expectFounding: false`). Never changes the price silently.
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay';
import { useFormatters } from '@/lib/format';
import { listPrice } from '@/lib/billing/price';
import type { CheckoutRequest } from './useCheckout';

export interface FoundingFullModalProps {
  /** The request to continue at full price; null = closed. */
  request: CheckoutRequest | null;
  onContinue: (req: CheckoutRequest) => void;
  onClose: () => void;
}

export function FoundingFullModal({ request, onContinue, onClose }: FoundingFullModalProps) {
  const t = useTranslations('marketing.pricingV2');
  const f = useFormatters();
  const amount = request ? listPrice(request.plan, request.interval, request.currency) : null;
  const money = amount === null || !request ? '' : f.money(amount, request.currency, { wholeIfIntegral: true });
  const price = request?.interval === 'year' ? t('founding.fullPriceYear', { price: money }) : t('founding.fullPriceMonth', { price: money });
  return (
    <Modal
      open={!!request}
      onClose={onClose}
      size="sm"
      title={t('founding.fullTitle')}
      primary={{ id: 'founding-continue', label: t('founding.continue'), onClick: () => { if (request) onContinue(request); } }}
      secondary={{ id: 'founding-not-now', label: t('founding.notNow'), onClick: onClose }}
      data-testid="founding-full-modal"
    >
      {request ? t('founding.fullBody', { plan: t(`plans.${request.plan}.name`), price }) : null}
    </Modal>
  );
}

export default FoundingFullModal;
