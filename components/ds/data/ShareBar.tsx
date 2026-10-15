// ShareBar: part-to-whole bar used by DataTable `type: 'share'` (finance-analytics A4).
// 64×6 bar (track neutral-100, fill accent-600, radius 3) + right-aligned percent. `compact` = percent only.
import { Box, Typography } from '@mui/material';
import { accent, neutral as n, px, space } from '@/lib/ds/tokens';
import { useDsFormat } from './fmt';
import type { DsBaseProps } from './types';

export type ShareBarProps = DsBaseProps & {
  /** Fraction 0–1 (values outside are clamped for the bar; the text shows the real value). */
  value: number | null;
  compact?: boolean;
};

export function ShareBar({ value, compact, className, 'data-testid': testId }: ShareBarProps) {
  const fmt = useDsFormat();
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <Typography component="span" variant="dense" sx={{ color: n[500] }}>{'—'}</Typography>;
  }
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const text = fmt.percent(value);
  return (
    <Box
      component="span"
      className={className}
      data-testid={testId}
      sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: px(space[2]), width: '100%' }}
    >
      {!compact && (
        <Box component="span" aria-hidden sx={{ width: px(64), height: px(6), borderRadius: px(3), bgcolor: n[100], overflow: 'hidden', flexShrink: 0 }}>
          <Box component="span" sx={{ display: 'block', width: `${pct}%`, height: '100%', bgcolor: accent[600], borderRadius: px(3) }} />
        </Box>
      )}
      <Typography component="span" variant="dense" sx={{ color: n[800], fontVariantNumeric: 'tabular-nums', minWidth: px(48), textAlign: 'right' }}>
        {text}
      </Typography>
    </Box>
  );
}

export default ShareBar;
