// SignalDots: a 5-dot tier with no unit (research "Signal" kind). The tooltip lists the inputs it was
// derived from. null = "Not enough data".
import { Box, Tooltip, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { accent, neutral as n, px, radius, space } from '@/lib/ds/tokens';

export type SignalDotsProps = {
  tier: 1 | 2 | 3 | 4 | 5 | null;
  /** Already-translated label/value pairs shown in the tooltip. */
  inputs: { label: string; value: string }[];
  className?: string;
  'data-testid'?: string;
};

export function SignalDots({ tier, inputs, className, 'data-testid': testId }: SignalDotsProps) {
  const t = useTranslations('ds.research');
  if (tier === null || tier === undefined) {
    return (
      <Typography component="span" variant="caption" className={className} data-testid={testId} sx={{ color: n[500] }}>
        {t('noData')}
      </Typography>
    );
  }
  const label = t('signalAria', { tier });
  const tip = (
    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: px(2) }}>
      <span>{label}</span>
      {inputs.map((i) => (
        <span key={i.label}>{t('inputLine', { label: i.label, value: i.value })}</span>
      ))}
    </Box>
  );
  return (
    <Tooltip title={tip}>
      <Box
        component="span"
        role="img"
        aria-label={label}
        tabIndex={0}
        className={className}
        data-testid={testId}
        data-tier={tier}
        sx={{ display: 'inline-flex', gap: px(space[1]), alignItems: 'center', verticalAlign: 'middle' }}
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <Box key={i} component="span" sx={{ width: px(6), height: px(6), borderRadius: px(radius.full), bgcolor: i <= tier ? accent[600] : n[200] }} />
        ))}
      </Box>
    </Tooltip>
  );
}

export default SignalDots;
