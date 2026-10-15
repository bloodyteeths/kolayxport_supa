// components/ds/format/DateText.tsx — DS §3.12, §4.4. Renders a <time> in the seller timezone.
// `relative` and `date` show the absolute date-time in a tooltip. Relative text depends on "now", so the
// server and client render may differ by a minute; hydration warnings are suppressed on the text only.

import { Box, Tooltip } from '@mui/material';
import { EMPTY, toDate, useFormatters, type DateInput, type DateMode } from '@/lib/format';
import { zIndex } from '@/lib/ds/tokens';

export interface DateTextProps {
  value: DateInput;
  /** Default `date`. `weekday` = "Thursday, Oct 15" (Overview subtitle). */
  mode?: DateMode;
  /** Injected clock (tests, lists that share one "now"). */
  now?: Date;
  className?: string;
  'data-testid'?: string;
}

export function DateText({ value, mode = 'date', now, className, 'data-testid': testId }: DateTextProps) {
  const f = useFormatters();
  const d = toDate(value);
  if (!d) {
    return (
      <Box component="span" className={className} data-testid={testId}>
        {EMPTY}
      </Box>
    );
  }
  const text = f.date(d, mode, now);
  const node = (
    <Box
      component="time"
      dateTime={d.toISOString()}
      className={className}
      data-testid={testId}
      suppressHydrationWarning
      sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      {text}
    </Box>
  );
  if (mode !== 'relative' && mode !== 'date') return node;
  const absolute = f.date(d, 'datetime', now);
  if (absolute === text) return node;
  return (
    <Tooltip describeChild title={absolute} enterDelay={400} slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}>
      {node}
    </Tooltip>
  );
}

export default DateText;
