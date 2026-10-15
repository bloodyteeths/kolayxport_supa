// components/domain/pricing/ReviewerSummary.tsx — "Pricing summary (English)" for marketplace app reviewers
// (settings §14 P5 exception, tiers.md §4): English in every locale, `lang="en"`, generated from the plan
// tables (list prices in both currencies, monthly and yearly), formatted with the English locale. Part of
// the gated region (§10.5): it contains prices.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { fmtMoney, fmtNum } from '@/lib/format';
import { neutral, layout } from '@/lib/ds/tokens';
import { reviewerFacts } from './pricingModel';

const en = (n: number | null): string => (n === null ? 'unlimited' : fmtNum(n, { locale: 'en' }));
const money = (n: number, currency: 'TRY' | 'USD'): string => fmtMoney(n, currency, { locale: 'en', wholeIfIntegral: true });

export function ReviewerSummary() {
  const t = useTranslations('marketing.pricingV2');
  const nameT = useTranslations('marketing.pricingV2.plans');
  return (
    <Box component="section" lang="en" aria-labelledby="pricing-reviewer-title" sx={{ maxWidth: layout.maxReading, mt: '48px' }} data-testid="reviewer-summary">
      <Typography id="pricing-reviewer-title" variant="titleSm" component="h2" sx={{ m: 0, mb: '8px', color: neutral[900] }}>
        {t('reviewerSummary.title')}
      </Typography>
      <Box sx={{ display: 'grid', gap: '4px' }}>
        {reviewerFacts().map((p) => (
          <Typography key={p.plan} variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>
            {t('reviewerSummary.plan', {
              // Plan names are product names, identical in EN and TR.
              plan: nameT(`${p.plan}.name`),
              monthTry: money(p.monthTry, 'TRY'),
              yearTry: money(p.yearTry, 'TRY'),
              monthUsd: money(p.monthUsd, 'USD'),
              yearUsd: money(p.yearUsd, 'USD'),
              orders: en(p.orders),
              labels: en(p.labels),
              stores: en(p.stores),
              ai: en(p.ai),
            })}
          </Typography>
        ))}
        <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>
          {t('reviewerSummary.enterprise')}
        </Typography>
        <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>
          {t('reviewerSummary.footer')}
        </Typography>
      </Box>
    </Box>
  );
}

export default ReviewerSummary;
