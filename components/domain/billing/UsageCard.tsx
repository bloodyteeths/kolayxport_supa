// components/domain/billing/UsageCard.tsx — settings §9.4: one UsageMeter per known meter (orders, labels,
// connected stores, AI credits), amber ≥ 80 %, red ≥ 100 %, one caption line per meter at most.
// Neutral (shopify_free) accounts: the same facts, no plan names, no links (§11).
// Fallback mode (entitlement endpoint missing): Order imports + Labels and "Detailed usage will appear here soon."
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { UsageMeter } from '@/components/ds/data/UsageMeter';
import { ActionButton } from '@/components/ds/overlay';
import { Bone, ErrorState, SlowState } from '@/components/ds/state';
import type { AsyncState } from '@/lib/ds/useAsyncState';
import { useFormatters } from '@/lib/format';
import { neutral, px, space } from '@/lib/ds/tokens';
import { CHOOSE_PLAN_HREF, NEAR_LIMIT, daysUntil, isNeutralBilling, upsellPlanFor } from '@/lib/billing/billingState';
import { OVERAGE_BUFFER, planLimit } from '@/lib/billing/price';
import type { Entitlement, MeterKey, MeterUsage } from '@/lib/billing/types';
import { METER_KEYS } from '@/lib/billing/types';
import { CardHeader, Line } from './parts';

export interface UsageCardProps {
  entitlement: Entitlement | undefined;
  state: AsyncState;
  fallback?: boolean;
  onRetry?: () => void;
  /** "Manage stores ›" (Connections tab). Hidden without a handler. */
  onManageStores?: () => void;
  now?: Date;
}

type T = ReturnType<typeof useTranslations>;
type F = ReturnType<typeof useFormatters>;

/** One caption per meter (§9.4), or null. Plain function (not a component) so "no caption" renders nothing. */
function meterCaption(meter: MeterKey, m: MeterUsage, e: Entitlement, t: T, f: F): ReactNode {
  const neutralAcc = isNeutralBilling(e);
  if (m.limit === null || !(m.limit > 0)) return meter === 'aiCredits' ? t('usage.aiHelp') : null;
  const ratio = m.used / m.limit;
  if (ratio >= 1) {
    if (meter === 'orders') return t('usage.ordersOver', { cap: f.num(Math.round(m.limit * (1 + OVERAGE_BUFFER))) });
    if (meter === 'labels' || meter === 'aiCredits') {
      const pausedKey = meter === 'labels' ? 'usage.pausedLabels' : 'usage.pausedAi';
      return e.period?.end ? t(pausedKey, { date: f.date(e.period.end) }) : t('usage.limitReached');
    }
    return null;
  }
  if (ratio >= NEAR_LIMIT) {
    const percent = Math.round(ratio * 100);
    const compareLabel = `${t('action.comparePlans')} ›`;
    const near = t('usage.near', { percent, meter: t(`usage.noun.${meter}`) });
    if (neutralAcc) return near;
    const next = upsellPlanFor(e, meter);
    const nextLimit = next && next !== 'enterprise' ? planLimit(next, meter) : undefined;
    const upsell = next && next !== 'enterprise' && typeof nextLimit === 'number'
      ? ` ${t(meter === 'connectedStores' ? 'usage.nearUpsellStores' : 'usage.nearUpsell', { plan: t(`planName.${next}`), limit: f.num(nextLimit) })}`
      : '';
    return (
      <span data-testid={`usage-near-${meter}`}>
        {near}
        {upsell}{' '}
        <ActionButton
          action={{ id: `usage-compare-${meter}`, label: compareLabel, href: CHOOSE_PLAN_HREF }}
          variant="ghost"
          size="sm"
        />
      </span>
    );
  }
  return meter === 'aiCredits' ? t('usage.aiHelp') : null;
}

function MeterSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[4]), marginTop: px(space[3]) }} data-testid="usage-skeleton">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: px(space[1.5]) }}>
          <Bone w="40%" h={12} />
          <Bone w="100%" h={6} />
        </div>
      ))}
    </div>
  );
}

export function UsageCard({ entitlement: e, state, fallback, onRetry, onManageStores, now = new Date() }: UsageCardProps) {
  const t = useTranslations('billing');
  const f = useFormatters();

  if (state === 'loading' || (state === 'slow' && !e)) {
    return (
      <Section variant="card" data-testid="billing-usage-card">
        <CardHeader title={t('usage.title')} />
        {state === 'slow' ? <SlowState variant="inline" onRetry={onRetry} /> : <MeterSkeleton />}
      </Section>
    );
  }
  if (!e) {
    return (
      <Section variant="card" data-testid="billing-usage-card">
        <ErrorState variant="inline" title={t('usage.loadFailed')} onRetry={onRetry} />
      </Section>
    );
  }

  const trial = e.state === 'trial' || e.state === 'grace';
  const resetDays = !trial && e.period?.end ? daysUntil(e.period.end, now) : null;
  const meters = METER_KEYS.filter((k) => e.meters[k]);
  const neutralAcc = isNeutralBilling(e);

  return (
    <Section variant="card" data-testid="billing-usage-card">
      <CardHeader
        title={t(trial ? 'usage.titleTrial' : 'usage.title')}
        trailing={
          resetDays !== null && e.period?.end ? (
            <span style={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }} data-testid="usage-resets">
              {t('usage.resets', { date: f.date(e.period.end), days: resetDays })}
            </span>
          ) : null
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[4]), marginTop: px(space[3]) }}>
        {meters.map((k) => {
          const m = e.meters[k] as MeterUsage;
          const label = t(`usage.meter.${fallback && k === 'orders' ? 'ordersLegacy' : k}`);
          return (
            <div key={k} data-testid={`usage-meter-${k}`}>
              <UsageMeter label={label} used={m.used} limit={m.limit} caption={meterCaption(k, m, e, t, f)} />
              {k === 'connectedStores' && onManageStores ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: px(space[1]) }}>
                  <ActionButton action={{ id: 'manage-stores', label: `${t('usage.manageStores')} ›`, onClick: onManageStores }} variant="ghost" size="sm" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {fallback && !neutralAcc ? <Line variant="caption">{t('usage.soon')}</Line> : null}
    </Section>
  );
}

export default UsageCard;
