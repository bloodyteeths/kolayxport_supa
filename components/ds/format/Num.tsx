// components/ds/format/Num.tsx — DS §3.12, §4.4. Counts and percents. `percent` takes a ratio (0.042 → 4.2%).

import { Box, Tooltip } from '@mui/material';
import { COMPACT_MIN, useFormatters } from '@/lib/format';
import { zIndex } from '@/lib/ds/tokens';

export interface NumProps {
  value: number | null | undefined;
  /** `value` is a ratio, printed as a percent with at most 1 decimal. */
  percent?: boolean;
  /** Applied at ≥ 100,000, full value in the tooltip. */
  compact?: boolean;
  /** Fixed decimals (percent: 0 or 1). */
  decimals?: number;
  /** Always print the sign. */
  sign?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Num({ value, percent, compact, decimals, sign, className, 'data-testid': testId }: NumProps) {
  const f = useFormatters();
  const text = percent
    ? f.percent(value, { decimals: decimals === 0 || decimals === 1 ? decimals : undefined, sign })
    : f.num(value, { compact, decimals, sign });
  const node = (
    <Box component="span" className={className} data-testid={testId} sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {text}
    </Box>
  );
  const showFull = !percent && compact && typeof value === 'number' && Number.isFinite(value) && Math.abs(value) >= COMPACT_MIN;
  if (!showFull) return node;
  return (
    <Tooltip describeChild title={f.num(value, { decimals, sign })} enterDelay={400} slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}>
      {node}
    </Tooltip>
  );
}

export default Num;
