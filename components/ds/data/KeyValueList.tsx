// KeyValueList: label/value pairs (DESIGN_SYSTEM §4.4; shell-nav shortcut sheet, messages rail, finance P&L
// on mobile). 1 or 2 columns; collapses to 1 below 600px. `copy` adds a CopyText for IDs and numbers.
import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { neutral as n, px, space } from '@/lib/ds/tokens';
import { CopyText } from '@/components/ds/format/CopyText';
import type { DsBaseProps } from './types';

export type KeyValueItem = { label: string; value: ReactNode; copy?: string; mono?: boolean };

export type KeyValueListProps = DsBaseProps & {
  items: KeyValueItem[];
  columns?: 1 | 2;
  /** Width of the label column (default 40 %). */
  labelWidth?: number | string;
  /** Value alignment; 'end' for money columns (statements). Default 'start'. */
  valueAlign?: 'start' | 'end';
};

export function KeyValueList({ items, columns = 1, labelWidth = '40%', valueAlign = 'start', className, 'data-testid': testId }: KeyValueListProps) {
  return (
    <Box
      component="dl"
      className={className}
      data-testid={testId}
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: columns === 2 ? '1fr 1fr' : '1fr' },
        columnGap: px(space[6]),
      }}
    >
      {items.map((it, i) => (
        <Box
          key={`${it.label}-${i}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: `${typeof labelWidth === 'number' ? px(labelWidth) : labelWidth} 1fr`,
            columnGap: px(space[3]),
            alignItems: 'baseline',
            py: px(space[1.5]),
            borderBottom: `1px solid ${n[100]}`,
            minWidth: 0,
          }}
        >
          <Typography component="dt" variant="dense" sx={{ color: n[500], m: 0 }}>{it.label}</Typography>
          <Typography component="dd" variant="dense" sx={{ color: n[800], m: 0, minWidth: 0, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums', textAlign: valueAlign === 'end' ? 'right' : undefined }}>
            {it.copy ? <CopyText value={it.copy} display={typeof it.value === 'string' ? it.value : undefined} mono={it.mono} /> : it.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export default KeyValueList;
