// components/domain/pricing/CompareMobile.tsx — the comparison below 900px (settings §10.3, §14): a
// SegmentedControl picks ONE plan column; the table is 2 columns (feature, value), so there is never a
// horizontal scroll. Starts on the recommended plan.
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { SegmentedControl } from '@/components/ds/inputs';
import { TermHint } from '@/components/ds/format';
import { neutral, radius } from '@/lib/ds/tokens';
import type { PricedPlanKey } from '@/lib/billing/types';
import { COMPARE_ROWS, PRICING_PLANS, RECOMMENDED_PLAN } from './pricingModel';
import { CompareValue } from './compareCell';

export function CompareMobile({ initialPlan = RECOMMENDED_PLAN }: { initialPlan?: PricedPlanKey }) {
  const t = useTranslations('marketing.pricingV2');
  const [plan, setPlan] = useState<PricedPlanKey>(initialPlan);
  return (
    <Box sx={{ display: { xs: 'block', md: 'none' } }} data-testid="compare-mobile">
      <SegmentedControl<PricedPlanKey>
        size="md"
        fullWidth
        aria-label={t('compare.pickPlan')}
        value={plan}
        onChange={setPlan}
        options={PRICING_PLANS.map((p) => ({ value: p, label: t(`plans.${p}.name`) }))}
      />
      <Box
        component="dl"
        sx={{ m: 0, mt: '12px', bgcolor: neutral[0], border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px` }}
        data-testid={`compare-mobile-${plan}`}
      >
        {COMPARE_ROWS.map((row, i) => (
          <Box
            key={row.id}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minHeight: 44, px: '16px',
              borderTop: i === 0 ? 0 : `1px solid ${neutral[100]}`,
            }}
          >
            <Typography component="dt" variant="body1" sx={{ color: neutral[800], display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
              {t(row.labelKey)}
              {row.hintKey ? <TermHint label={t(row.labelKey)} body={t(`hint.${row.hintKey}`)} /> : null}
            </Typography>
            <Typography component="dd" variant="body1" sx={{ m: 0, color: neutral[800], textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              <CompareValue cell={row.cell(plan)} />
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default CompareMobile;
