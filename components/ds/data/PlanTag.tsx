// PlanTag: "Pro" marker on gated entry points (pro-gating.md §3.1). Not a StatusPill (it is not a status).
// It returns null unless the account is a Stripe account that may see upgrade wording
// (`stripeUpsell === true`): the ONE place that enforces the Shopify-review rule.
//
// `stripeUpsell` comes from <PlanTagProvider> (mounted once with `useEntitlement()` by the billing/shell
// track) or from the `stripeUpsell` prop. Without either it is unknown → null.
import { createContext, useContext, type ReactNode } from 'react';
import { Box, Tooltip } from '@mui/material';
import { useTranslations } from 'next-intl';
import { neutral as n, px, radius } from '@/lib/ds/tokens';
import { useDsFormat } from './fmt';
import type { DsBaseProps } from './types';

export type PlanContextValue = { stripeUpsell?: boolean | null };
const PlanContext = createContext<PlanContextValue>({});

export function PlanTagProvider({ stripeUpsell, children }: { stripeUpsell: boolean | null | undefined; children: ReactNode }) {
  return <PlanContext.Provider value={{ stripeUpsell }}>{children}</PlanContext.Provider>;
}

export type PlanTagProps = DsBaseProps & {
  plan: 'pro';
  /** Set during the trial: tooltip "Included in your trial until {date}". */
  trialEndsAt?: Date | null;
  /** Overrides the context value (tests, isolated hosts). */
  stripeUpsell?: boolean | null;
};

export function PlanTag({ plan, trialEndsAt, stripeUpsell, className, 'data-testid': testId }: PlanTagProps) {
  const ctx = useContext(PlanContext);
  const t = useTranslations('ds.plan');
  const fmt = useDsFormat();
  const upsell = stripeUpsell ?? ctx.stripeUpsell;
  if (upsell !== true) return null;

  const tip = trialEndsAt ? t('trialTooltip', { date: fmt.date(trialEndsAt) }) : t('proTooltip');
  return (
    <Tooltip title={tip}>
      <Box
        component="span"
        className={className}
        data-testid={testId}
        data-plan={plan}
        aria-label={tip}
        tabIndex={0}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: px(18),
          px: px(6),
          borderRadius: px(radius.full),
          bgcolor: n[100],
          color: n[700],
          fontSize: px(11),
          lineHeight: px(14),
          fontWeight: 500,
          letterSpacing: '0.01em',
          whiteSpace: 'nowrap',
          verticalAlign: 'middle',
        }}
      >
        {t('pro')}
      </Box>
    </Tooltip>
  );
}

export default PlanTag;
