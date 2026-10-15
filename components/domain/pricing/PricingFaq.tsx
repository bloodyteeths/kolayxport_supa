// components/domain/pricing/PricingFaq.tsx — "Questions": all answers visible (no accordion), reading width
// 720 (settings §10.2). Part of the gated region (§10.5) because answers talk about plans and money. The
// founding question is shown only while the offer is open.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { neutral, layout } from '@/lib/ds/tokens';
import type { FoundingSpots } from '@/lib/billing/types';

const QUESTIONS = ['trial', 'limits', 'founding', 'change', 'currency', 'data'] as const;

export function PricingFaq({ founding }: { founding: FoundingSpots | null }) {
  const t = useTranslations('marketing.pricingV2');
  const items = QUESTIONS.filter((q) => q !== 'founding' || founding);
  return (
    <Box component="section" aria-labelledby="pricing-faq-title" sx={{ maxWidth: layout.maxReading, mt: '48px' }} data-testid="pricing-faq">
      <Typography id="pricing-faq-title" variant="titleLg" component="h2" sx={{ m: 0, mb: '16px', color: neutral[900] }}>
        {t('faq.title')}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: 'grid', gap: '20px' }}>
        {items.map((q) => (
          <Box key={q} data-testid={`faq-${q}`}>
            <Typography component="dt" variant="titleSm" sx={{ color: neutral[900] }}>
              {t(`faq.${q}.q`)}
            </Typography>
            <Typography component="dd" variant="body1" sx={{ m: 0, mt: '4px', color: neutral[700] }}>
              {q === 'founding' && founding
                ? t('faq.founding.a', { total: founding.total, percent: founding.percentOff })
                : t(`faq.${q}.a`)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default PricingFaq;
