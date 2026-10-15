// PriceBand: median + p25–p75 (never a mean; research §3.1). n < 5 → "Not enough data"; n < 20 → the range
// only with "small sample"; otherwise median, band and a band bar.
import { Box, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { accent, neutral as n, px, radius, space } from '@/lib/ds/tokens';
import { useDsFormat } from '@/components/ds/data/fmt';

export const PRICE_MIN_N = 5;
export const PRICE_RANGE_ONLY_N = 20;

export type PriceBandProps = {
  p25: number | null;
  median: number | null;
  p75: number | null;
  currency: string;
  n: number;
  /** `implausible` (lib/research/stats quality) renders "—" with "unusual price range". */
  implausible?: boolean;
  className?: string;
  'data-testid'?: string;
};

export type PriceBandMode = 'insufficient' | 'implausible' | 'range' | 'full';

export function priceBandMode(p: Pick<PriceBandProps, 'p25' | 'median' | 'p75' | 'n' | 'implausible'>): PriceBandMode {
  if (p.implausible) return 'implausible';
  if (p.n < PRICE_MIN_N || p.p25 === null || p.p75 === null) return 'insufficient';
  if (p.n < PRICE_RANGE_ONLY_N || p.median === null) return 'range';
  return 'full';
}

export function PriceBand(props: PriceBandProps) {
  const { p25, median, p75, currency, n: count, className, 'data-testid': testId } = props;
  const t = useTranslations('ds.research');
  const fmt = useDsFormat();
  const mode = priceBandMode(props);

  if (mode === 'insufficient' || mode === 'implausible') {
    const why = mode === 'implausible' ? t('implausible') : t('notEnoughSample', { count });
    return (
      <Box className={className} data-testid={testId} data-mode={mode}>
        <Typography variant="titleMd" component="span" sx={{ color: n[500] }} aria-label={why}>{'—'}</Typography>
        <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>{why}</Typography>
      </Box>
    );
  }

  const range = t('range', { low: fmt.money(p25 as number, currency), high: fmt.money(p75 as number, currency) });
  if (mode === 'range') {
    return (
      <Box className={className} data-testid={testId} data-mode={mode}>
        <Typography variant="titleMd" component="span" sx={{ color: n[900], fontVariantNumeric: 'tabular-nums' }}>{range}</Typography>
        <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>{t('smallSample', { count })}</Typography>
      </Box>
    );
  }

  const lo = p25 as number;
  const hi = p75 as number;
  const mid = median as number;
  const span = Math.max(hi - lo, Math.abs(mid) * 0.01, 0.01);
  const min = lo - span * 0.5;
  const max = hi + span * 0.5;
  const pos = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <Box className={className} data-testid={testId} data-mode={mode} sx={{ display: 'flex', flexDirection: 'column', gap: px(space[1]) }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: px(space[2]), flexWrap: 'wrap' }}>
        <Typography variant="titleMd" component="span" sx={{ color: n[900], fontVariantNumeric: 'tabular-nums' }}>
          {fmt.money(mid, currency)}
        </Typography>
        <Typography variant="caption" component="span" sx={{ color: n[500] }}>{t('median')}</Typography>
      </Box>
      <Box aria-hidden sx={{ position: 'relative', height: px(6), borderRadius: px(radius.full), bgcolor: n[100], maxWidth: px(240) }}>
        <Box sx={{ position: 'absolute', left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%`, top: 0, bottom: 0, bgcolor: accent[200], borderRadius: px(radius.full) }} />
        <Box sx={{ position: 'absolute', left: `${pos(mid)}%`, top: px(-2), width: px(2), height: px(10), bgcolor: accent[700], ml: px(-1) }} />
      </Box>
      <Typography variant="caption" component="p" sx={{ m: 0, color: n[600], fontVariantNumeric: 'tabular-nums' }}>
        {t('middleHalf', { range, count })}
      </Typography>
    </Box>
  );
}

export default PriceBand;
