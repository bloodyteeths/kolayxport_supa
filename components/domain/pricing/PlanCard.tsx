// components/domain/pricing/PlanCard.tsx — one plan on the public pricing page (settings §10.2, §10.3).
// Built only from DS parts: Section-style card surface (radius-md, 1px neutral-200, no shadow), Money
// (`wholeIfIntegral`), Num, Button. The recommended plan gets a 1px accent-600 border and an accent-700
// caption "Most popular" above the name (not a pill: pills are statuses only). The CTA comes from the pure
// `pricingCta()` decision (lib/billing/billingState.ts).
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs';
import { Money } from '@/components/ds/format';
import { Bone } from '@/components/ds/state';
import { useIsMobile } from '@/components/ds/page';
import { useFormatters } from '@/lib/format';
import { ICON_STROKE, icons } from '@/lib/ds/icons';
import { accent, neutral, radius } from '@/lib/ds/tokens';
import type { PricingCta } from '@/lib/billing/billingState';
import type { Currency, Interval, MeterKey, PricedPlanKey } from '@/lib/billing/types';
import { CARD_FEATURES, LIMIT_METERS, cardPrice, limitFor, type CardFeature } from './pricingModel';

const CheckIcon = icons.check;

export interface PlanCardProps {
  plan: PricedPlanKey;
  interval: Interval;
  currency: Currency;
  /** Live founding percent; null = founding line hidden (list prices only). */
  foundingPercent: number | null;
  /** `'skeleton'` = signed-in viewer whose entitlement has not resolved: no price, no CTA painted (§10.5). */
  cta: PricingCta | 'skeleton';
  recommended: boolean;
  /** This card's button is the page's single primary (P1). */
  primary: boolean;
  /** Plan whose checkout / portal is opening. */
  pending: PricedPlanKey | null;
  onCheckout: (cta: Extract<PricingCta, { kind: 'checkout' }>) => void;
  onSwitch: (plan: PricedPlanKey) => void;
}

const METER_LINE: Record<MeterKey, { count: string; unlimited: string }> = {
  orders: { count: 'limit.orders', unlimited: 'limit.unlimitedOrders' },
  labels: { count: 'limit.labels', unlimited: 'limit.unlimitedLabels' },
  connectedStores: { count: 'limit.stores', unlimited: 'limit.unlimitedStores' },
  aiCredits: { count: 'limit.ai', unlimited: 'limit.unlimitedAi' },
};

export function PlanCard(props: PlanCardProps) {
  const { plan, interval, currency, foundingPercent, cta, recommended, primary, pending, onCheckout, onSwitch } = props;
  const t = useTranslations('marketing.pricingV2');
  const f = useFormatters();
  const name = t(`plans.${plan}.name`);
  const price = cardPrice(plan, interval, currency, foundingPercent);
  const headingId = `plan-${plan}-name`;
  const skeleton = cta === 'skeleton' || cta.kind === 'loading' || cta.kind === 'redirect';

  const featureLabel = (feat: CardFeature): string =>
    feat.key === 'everythingIn' ? t('feature.everythingIn', { plan: t(`plans.${feat.plan}.name`) }) : t(`feature.${feat.key}`);

  return (
    <Box
      component="article"
      id={`plan-card-${plan}`}
      aria-labelledby={headingId}
      data-testid={`plan-card-${plan}`}
      data-recommended={recommended ? 'true' : 'false'}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        bgcolor: neutral[0],
        border: `1px solid ${recommended ? accent[600] : neutral[200]}`,
        borderRadius: `${radius.md}px`,
        p: '16px',
        scrollMarginTop: '96px',
      }}
    >
      <Box sx={{ minHeight: 16, mb: '4px' }}>
        {recommended ? (
          <Typography variant="caption" component="p" sx={{ m: 0, color: accent[700], fontWeight: 500 }}>
            {t('mostPopular')}
          </Typography>
        ) : null}
      </Box>
      <Typography id={headingId} variant="titleMd" component="h3" sx={{ m: 0, color: neutral[900] }}>
        {name}
      </Typography>
      <Typography variant="body1" component="p" sx={{ m: 0, mt: '4px', color: neutral[600], minHeight: { md: 40 } }}>
        {t(`plans.${plan}.tagline`)}
      </Typography>

      <Box sx={{ mt: '16px', minHeight: 96 }} data-testid={`plan-price-${plan}`}>
        {skeleton ? (
          <Box sx={{ display: 'grid', gap: '8px' }} aria-hidden>
            <Bone w={160} h={36} />
            <Bone w={120} h={16} />
          </Box>
        ) : price ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 8px' }}>
              <Typography variant="display" component="p" sx={{ m: 0, color: neutral[900] }}>
                <Money amount={price.amount} currency={currency} wholeIfIntegral data-testid={`plan-amount-${plan}`} />
              </Typography>
              <Typography variant="body1" component="span" sx={{ color: neutral[600] }}>
                {interval === 'month' ? t('perMonth') : t('perYear')}
              </Typography>
              {price.struck !== null ? (
                <Typography
                  variant="body1"
                  component="s"
                  aria-label={t('listPrice', { price: f.money(price.struck, currency, { wholeIfIntegral: true }) })}
                  sx={{ color: neutral[500] }}
                  data-testid={`plan-struck-${plan}`}
                >
                  <Money amount={price.struck} currency={currency} wholeIfIntegral />
                </Typography>
              ) : null}
            </Box>
            {price.founding || price.perMonth !== null ? (
              <Typography variant="caption" component="p" sx={{ m: 0, mt: '4px', color: neutral[600] }} data-testid={`plan-caption-${plan}`}>
                {price.founding
                  ? price.perMonth !== null
                    ? t('founding.priceNoteYearly', { price: f.money(price.perMonth, currency, { wholeIfIntegral: true }) })
                    : t('founding.priceNote')
                  : t('monthlyEquivalent', { price: f.money(price.perMonth, currency, { wholeIfIntegral: true }) })}
              </Typography>
            ) : null}
          </>
        ) : (
          <Typography variant="display" component="p" sx={{ m: 0, color: neutral[900] }}>
            {t('customPrice')}
          </Typography>
        )}
      </Box>

      <Box sx={{ mt: '16px' }}>
        <PlanCta plan={plan} name={name} cta={cta} primary={primary} pending={pending} onCheckout={onCheckout} onSwitch={onSwitch} />
      </Box>

      <Box component="hr" sx={{ border: 0, borderTop: `1px solid ${neutral[200]}`, my: '16px', mx: 0 }} />

      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: '8px' }}>
        {LIMIT_METERS.map((meter) => {
          const limit = limitFor(plan, meter);
          const keys = METER_LINE[meter];
          return (
            <Typography key={meter} component="li" variant="body1" sx={{ color: neutral[800] }} data-testid={`plan-limit-${plan}-${meter}`}>
              {limit === null
                ? t(keys.unlimited)
                : t(keys.count, { count: f.num(limit), n: limit })}
            </Typography>
          );
        })}
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, mt: '12px', display: 'grid', gap: '8px' }}>
        {CARD_FEATURES[plan].map((feat) => (
          <Typography
            key={feat.key === 'everythingIn' ? `in-${feat.plan}` : feat.key}
            component="li"
            variant="body1"
            sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: neutral[700] }}
          >
            <Box component="span" sx={{ display: 'inline-flex', mt: '2px', color: neutral[700], flexShrink: 0 }}>
              <CheckIcon size={16} strokeWidth={ICON_STROKE} aria-hidden />
            </Box>
            {featureLabel(feat)}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

interface PlanCtaProps {
  plan: PricedPlanKey;
  name: string;
  cta: PricingCta | 'skeleton';
  primary: boolean;
  pending: PricedPlanKey | null;
  onCheckout: PlanCardProps['onCheckout'];
  onSwitch: PlanCardProps['onSwitch'];
}

function PlanCta({ plan, name, cta, primary, pending, onCheckout, onSwitch }: PlanCtaProps) {
  const t = useTranslations('marketing.pricingV2');
  const f = useFormatters();
  // §10.3: plan CTAs are 48 tall on mobile (DS control.xl), 40 on desktop.
  const size = useIsMobile() ? 'xl' : 'md';
  if (cta === 'skeleton' || cta.kind === 'loading' || cta.kind === 'redirect') {
    return (
      <Box aria-hidden data-testid={`plan-cta-skeleton-${plan}`}>
        <Bone w="100%" h={size === 'xl' ? 48 : 40} r={radius.sm} />
      </Box>
    );
  }
  const variant = primary ? 'primary' : 'secondary';
  const isPending = pending === plan;
  const otherPending = pending !== null && !isPending;
  const busy = otherPending ? { disabled: true, disabledReason: t('cta.busyReason') } : {};
  const testId = `plan-cta-${plan}`;

  switch (cta.kind) {
    case 'signup':
      return <Button variant={variant} href={cta.href} fullWidth size={size} data-testid={testId}>{t('cta.startTrial')}</Button>;
    case 'contact':
      return <Button variant={variant} href={cta.href} fullWidth size={size} data-testid={testId}>{t('cta.talk')}</Button>;
    case 'current':
      return <Button variant="secondary" disabled disabledReason={t('cta.currentReason')} fullWidth size={size} data-testid={testId}>{t('cta.current')}</Button>;
    case 'disabled':
      return cta.reason === 'pastDue' ? (
        <Button variant="secondary" disabled disabledReason={t('cta.updatePaymentReason')} fullWidth size={size} data-testid={testId}>{t('cta.updatePaymentFirst')}</Button>
      ) : (
        <Button variant="secondary" disabled disabledReason={t('cta.unknownReason')} fullWidth size={size} data-testid={testId}>{t('cta.unknown')}</Button>
      );
    case 'switch':
      return (
        <Button
          variant={variant}
          fullWidth
          size={size}
          loading={isPending}
          loadingLabel={t('cta.openingPortal')}
          onClick={() => onSwitch(plan)}
          data-testid={testId}
          {...busy}
        >
          {t('cta.switch', { plan: name })}
        </Button>
      );
    case 'checkout':
      return (
        <>
          <Button
            variant={variant}
            fullWidth
            size={size}
            loading={isPending}
            loadingLabel={t('cta.opening')}
            onClick={() => onCheckout(cta)}
            data-testid={testId}
            {...busy}
          >
            {t('cta.choose', { plan: name })}
          </Button>
          {cta.chargeFrom ? (
            <Typography variant="caption" component="p" sx={{ m: 0, mt: '8px', color: neutral[600] }} data-testid={`plan-carry-${plan}`}>
              {t('cta.trialCarry', { date: f.date(cta.chargeFrom, 'date') })}
            </Typography>
          ) : null}
        </>
      );
    default:
      return null;
  }
}

export default PlanCard;
