/**
 * Store-limit return (§4.6, `/ayarlar?tab=connections&limit=connectedStore`). Plan copy + "Compare plans"
 * only when Stripe upsells are allowed; shopify_free / unknown provider get neutral copy and a single "OK"
 * (§11: no /fiyatlandirma link, no prices).
 */
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay';
import { storeLimitModel, type StoreAllowance } from './connectionView';

export interface StoreLimitModalProps {
  open: boolean;
  onClose: () => void;
  allowance: StoreAllowance;
}

export function StoreLimitModal({ open, onClose, allowance }: StoreLimitModalProps) {
  const tc = useTranslations('settings.connections');
  const tb = useTranslations('billing');
  const m = storeLimitModel(allowance);

  if (m.neutral) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title={tc('storeLimit.neutralTitle')}
        description={tc('storeLimit.neutralBody')}
        primary={{ id: 'store-limit-ok', label: tc('storeLimit.ok'), onClick: onClose }}
        secondary={null}
        data-testid="store-limit-modal"
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={tc('storeLimit.title', { limit: m.limit })}
      description={tc('storeLimit.body', {
        plan: tb(`planName.${m.plan}` as 'planName.growth'),
        limit: m.limit,
        nextPlan: tb(`planName.${m.nextPlan}` as 'planName.pro'),
        nextLimit: m.nextLimit,
      })}
      primary={{ id: 'store-limit-compare', label: tc('comparePlans'), href: m.compareHref }}
      secondary={{ id: 'store-limit-not-now', label: tc('storeLimit.notNow'), onClick: onClose }}
      data-testid="store-limit-modal"
    />
  );
}

export default StoreLimitModal;
