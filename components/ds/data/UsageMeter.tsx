// UsageMeter: plan usage (DESIGN_SYSTEM §4.2, settings §9.1, shell-nav §8). Accent bar; warning at ≥ 80 %,
// danger at ≥ 100 %. `limit === null` → "Unlimited", no bar. Numbers in tabular figures.
import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { accent, neutral as n, tone as toneTokens, px, radius, space } from '@/lib/ds/tokens';
import { useDsFormat } from './fmt';
import type { DsBaseProps } from './types';

export type UsageMeterProps = DsBaseProps & {
  label: string;
  used: number;
  /** null = unlimited. */
  limit: number | null;
  /** One caption line under the bar, e.g. "Resets 1 Nov". */
  caption?: ReactNode;
  size?: 'sm' | 'md';
};

export type UsageLevel = 'ok' | 'near' | 'over' | 'unlimited';

export function usageLevel(used: number, limit: number | null): UsageLevel {
  if (limit === null) return 'unlimited';
  if (limit <= 0) return used > 0 ? 'over' : 'ok';
  const ratio = used / limit;
  if (ratio >= 1) return 'over';
  if (ratio >= 0.8) return 'near';
  return 'ok';
}

export function UsageMeter({ label, used, limit, caption, size = 'md', className, 'data-testid': testId }: UsageMeterProps) {
  const t = useTranslations('ds.usage');
  const fmt = useDsFormat();
  const level = usageLevel(used, limit);
  const pct = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : level === 'over' ? 100 : 0;
  const fill = level === 'over' ? toneTokens.danger.solid : level === 'near' ? toneTokens.warning.solid : accent[600];
  const valueText = limit === null ? t('unlimited') : t('ofLimit', { used: fmt.num(used), limit: fmt.num(limit) });

  return (
    <Box className={className} data-testid={testId} data-level={level} sx={{ display: 'flex', flexDirection: 'column', gap: px(space[1]) }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: px(space[2]) }}>
        <Typography variant={size === 'sm' ? 'caption' : 'label'} component="span" sx={{ color: n[700] }}>{label}</Typography>
        <Typography
          variant={size === 'sm' ? 'caption' : 'dense'}
          component="span"
          sx={{
            color: level === 'over' ? toneTokens.danger.fg : level === 'near' ? toneTokens.warning.fg : n[600],
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {valueText}
        </Typography>
      </Box>
      {limit !== null && (
        <Box
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={valueText}
          sx={{ height: px(size === 'sm' ? 4 : 6), borderRadius: px(radius.full), bgcolor: n[100], overflow: 'hidden' }}
        >
          <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: fill, borderRadius: px(radius.full) }} />
        </Box>
      )}
      {caption && (
        <Typography variant="caption" component="span" sx={{ color: n[500] }}>{caption}</Typography>
      )}
    </Box>
  );
}

export default UsageMeter;
