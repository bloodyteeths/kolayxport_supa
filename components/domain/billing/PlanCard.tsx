// components/domain/billing/PlanCard.tsx — settings §9.1–§9.3 Plan card. Renders `billingView()` output;
// it decides nothing itself. Shopify/neutral: title + one line, no Stripe button, no ⋯ (§11).
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { Banner } from '@/components/ds/feedback';
import { ActionButton, OverflowMenu } from '@/components/ds/overlay';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Money } from '@/components/ds/format';
import { ErrorState, PanelSkeleton, SlowState } from '@/components/ds/state';
import type { ActionSpec } from '@/components/ds/types/actions';
import type { AsyncState } from '@/lib/ds/useAsyncState';
import { useFormatters } from '@/lib/format';
import { neutral } from '@/lib/ds/tokens';
import type { BillingLine, BillingView } from '@/lib/billing/billingState';
import type { BillingSummary } from '@/lib/billing/types';
import { CardHeader, DetailRow, Divider, Line } from './parts';

export interface PlanCardActions {
  primary?: ActionSpec | null;
  secondary?: ActionSpec | null;
  /** Mobile only: full-width secondary under the lines (§9.2 trial "Compare plans"). */
  mobileSecondary?: ActionSpec | null;
  overflow?: ActionSpec[];
  /** "Update ›" on the payment method row (portal payment_method_update). */
  updatePayment?: ActionSpec | null;
  /** "Edit in Stripe ↗" on the billing details row (portal home). */
  editDetails?: ActionSpec | null;
}

export interface PlanCardProps {
  view: BillingView;
  /** Entitlement region state (§9.8). */
  state: AsyncState;
  onRetry?: () => void;
  summary?: BillingSummary | null;
  actions: PlanCardActions;
  /** Mobile: the primary lives in the StickyActionBar, not in the card. */
  primaryInCard?: boolean;
  /** Checkout-return banner (§9.5); replaces the state banner while shown. */
  notice?: ReactNode;
}

function LineView({ line, summary }: { line: BillingLine; summary?: BillingSummary | null }) {
  const t = useTranslations('billing');
  const f = useFormatters();
  switch (line.key) {
    case 'trialEnds':
      return (
        <Line toneKey={line.tone === 'warning' ? 'warning' : undefined} testId="plan-line-trialEnds">
          {t('plan.trialEnds', { date: f.date(line.date, 'weekday'), days: line.days })}
        </Line>
      );
    case 'trialIncludes':
      return <Line>{t('plan.trialIncludes')}</Line>;
    case 'price': {
      const price = f.money(line.amount, line.currency, { wholeIfIntegral: true });
      return (
        <Line testId="plan-line-price">
          {t(line.interval === 'year' ? 'plan.billedYearly' : 'plan.billedMonthly', { currency: line.currency })}
          {' · '}
          {t(line.interval === 'year' ? 'plan.perYear' : 'plan.perMonth', { price })}
          {line.list !== null ? (
            <>
              {' '}
              <s style={{ color: neutral[400] }} data-testid="plan-line-list-price">
                <Money amount={line.list} currency={line.currency} wholeIfIntegral />
              </s>
            </>
          ) : null}
        </Line>
      );
    }
    case 'founding':
      return <Line variant="caption" toneKey="accent">{t('plan.founding')}</Line>;
    case 'nextPayment':
      if (!summary?.upcoming) return null;
      return (
        <Line variant="caption" testId="plan-line-nextPayment">
          {t('plan.nextPayment', { amount: f.money(summary.upcoming.amount, summary.upcoming.currency), date: f.date(summary.upcoming.date) })}
        </Line>
      );
    case 'canceling':
      return <Line toneKey="warning">{t('plan.canceling', { date: line.date ? f.date(line.date) : '—', plan: t(`planName.${line.plan}`) })}</Line>;
    case 'expired':
      return <Line>{t('plan.expired')}</Line>;
    case 'enterprise':
      return <Line>{t('plan.enterprise')}</Line>;
    case 'shopify':
      return <Line>{t('plan.shopify')}</Line>;
    default:
      return null;
  }
}

export function PlanCard({ view, state, onRetry, summary, actions, primaryInCard = true, notice }: PlanCardProps) {
  const t = useTranslations('billing');
  const f = useFormatters();

  if (state === 'loading') {
    return <Section variant="card" data-testid="billing-plan-card"><PanelSkeleton sections={1} /></Section>;
  }
  if (state === 'slow') {
    return <Section variant="card" data-testid="billing-plan-card"><SlowState variant="inline" onRetry={onRetry} /></Section>;
  }
  if (view.mode === 'unknown') {
    return (
      <Section variant="card" data-testid="billing-plan-card">
        <ErrorState variant="inline" title={t('loadFailed')} onRetry={onRetry} />
      </Section>
    );
  }

  const stripe = view.mode === 'stripe';
  const banner = notice ?? (view.banner ? (
    <Banner tone={view.banner.tone} title={t(`banner.${view.banner.key}`, { date: view.banner.date ? f.date(view.banner.date) : '—' })} />
  ) : null);
  const pm = summary?.paymentMethod ?? null;
  const overflow = stripe ? actions.overflow ?? [] : [];

  return (
    <Section variant="card" data-testid="billing-plan-card">
      {banner ? <div style={{ marginBottom: 12 }}>{banner}</div> : null}
      <CardHeader
        title={t(`planName.${view.planName}`)}
        after={<StatusPill domain="subscription" status={view.pill} data-testid="billing-plan-pill" />}
        trailing={
          stripe || view.secondary ? (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              {actions.secondary ? <ActionButton action={actions.secondary} variant={actions.secondary.id === 'contactUs' ? 'ghost' : 'secondary'} /> : null}
              {primaryInCard && actions.primary ? <ActionButton action={actions.primary} variant="primary" /> : null}
              {overflow.length > 0 ? <OverflowMenu items={overflow} data-testid="billing-plan-more" /> : null}
            </span>
          ) : null
        }
      />
      {view.lines.map((line, i) => <LineView key={`${line.key}-${i}`} line={line} summary={summary} />)}
      {stripe && !primaryInCard && actions.mobileSecondary ? (
        <div style={{ marginTop: 12 }}>
          <ActionButton action={actions.mobileSecondary} variant="secondary" size="lg" fullWidth data-testid="billing-plan-mobile-secondary" />
        </div>
      ) : null}
      {stripe && view.paymentDetails ? (
        <>
          <Divider />
          {pm ? (
            <DetailRow
              testId="billing-payment-method"
              label={t('paymentMethod.label')}
              value={t('paymentMethod.card', {
                brand: pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1),
                last4: pm.last4,
                month: String(pm.expMonth).padStart(2, '0'),
                year: String(pm.expYear % 100).padStart(2, '0'),
              })}
              action={actions.updatePayment ? <ActionButton action={actions.updatePayment} variant="ghost" size="sm" /> : undefined}
            />
          ) : null}
          <DetailRow
            testId="billing-details"
            label={t('details.label')}
            value={t('details.help')}
            action={actions.editDetails ? <ActionButton action={actions.editDetails} variant="ghost" size="sm" /> : undefined}
          />
        </>
      ) : null}
    </Section>
  );
}

export default PlanCard;
