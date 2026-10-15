// components/domain/billing/IncludedCard.tsx — settings §9.1 "Included in your plan". Pro rows read
// "Included" when `features.*` is on; otherwise "Pro plan" + one "See Pro ›" link (Stripe accounts) or
// "Not included" without any link (neutral / shopify_free, §11). Hidden while the entitlement is unknown.
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { KeyValueList, type KeyValueItem } from '@/components/ds/data/KeyValueList';
import { neutral } from '@/lib/ds/tokens';
import { ActionButton } from '@/components/ds/overlay';
import { PRICING_HREF, isNeutralBilling } from '@/lib/billing/billingState';
import { FEATURE_COPY, FEATURE_PLAN } from '@/lib/billing/featureMap';
import type { Entitlement, Feature } from '@/lib/billing/types';
import { CardHeader } from './parts';

const ORDER: readonly Feature[] = ['arbitrage', 'financials', 'bulkPhotoStudio'];
export const SEE_PRO_HREF = `${PRICING_HREF}?plan=${FEATURE_PLAN}&from=billing`;

export function IncludedCard({ entitlement: e }: { entitlement: Entitlement | undefined }) {
  const t = useTranslations('billing');
  if (!e) return null;
  const neutralAcc = isNeutralBilling(e);
  let linkShown = false;
  const seeProLabel = `${t('features.seePro')} ›`;

  const items: KeyValueItem[] = ORDER.map((feature) => {
    const on = e.features[feature] === true;
    let value: ReactNode;
    if (on) value = t('features.included');
    else if (neutralAcc) value = <span style={{ color: neutral[500] }}>{t('features.notIncluded')}</span>;
    else {
      const showLink = !linkShown;
      linkShown = true;
      value = (
        <span style={{ display: 'inline-flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ color: neutral[500] }}>{t('features.proOnly')}</span>
          {showLink ? (
            <ActionButton
              action={{ id: 'see-pro', label: seeProLabel, href: SEE_PRO_HREF }}
              variant="ghost"
              size="sm"
              data-testid="included-see-pro"
            />
          ) : null}
        </span>
      );
    }
    return { label: t(FEATURE_COPY[feature].billingLabelKey), value };
  });
  items.push({ label: t('features.core'), value: t('features.included') });

  return (
    <Section variant="card" data-testid="billing-included-card">
      <CardHeader title={t('features.title')} />
      <div style={{ marginTop: 8 }}>
        <KeyValueList items={items} labelWidth="50%" />
      </div>
    </Section>
  );
}

export default IncludedCard;
