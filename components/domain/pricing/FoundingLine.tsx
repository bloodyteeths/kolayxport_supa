// components/domain/pricing/FoundingLine.tsx — "Founding member offer: 40% off for life for our first 20
// subscribers · 7 of 20 spots left" (settings §10.2). Only from `/api/billing/founding-spots`; never a
// guessed count. Loading: a 16px caption skeleton (height reserved). Off / full / error: nothing.
// ≤ 5 spots: the count part reads "Only 3 spots left" in warning-fg. Never animated, never a countdown.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Bone } from '@/components/ds/state';
import { useFormatters } from '@/lib/format';
import { neutral, tone } from '@/lib/ds/tokens';
import type { FoundingSpots } from '@/lib/billing/types';
import { FEW_SPOTS } from './pricingModel';

export interface FoundingLineProps {
  spots: FoundingSpots | null;
  /** First response pending, or the gated region is still waiting (no layout jump). */
  loading: boolean;
}

export function FoundingLine({ spots, loading }: FoundingLineProps) {
  const t = useTranslations('marketing.pricingV2');
  const f = useFormatters();
  if (loading) {
    return (
      <Box sx={{ height: 16, mt: '12px', maxWidth: 360 }} aria-hidden data-testid="founding-line-skeleton">
        <Bone w="100%" h={16} />
      </Box>
    );
  }
  if (!spots) return null;
  const few = spots.remaining <= FEW_SPOTS;
  return (
    <Typography variant="caption" component="p" sx={{ m: 0, mt: '12px', color: neutral[600] }} data-testid="founding-line">
      {t('founding.offer', { percent: f.num(spots.percentOff), total: f.num(spots.total) })}
      {' · '}
      <Box component="span" sx={few ? { color: tone.warning.fg, fontWeight: 500 } : undefined} data-testid="founding-count">
        {few
          ? t('founding.few', { remaining: spots.remaining })
          : t('founding.count', { remaining: f.num(spots.remaining), total: f.num(spots.total) })}
      </Box>
    </Typography>
  );
}

export default FoundingLine;
