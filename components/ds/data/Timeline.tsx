// Timeline: dated events (DESIGN_SYSTEM §4.4; orders OrderPanel History). Newest first is the caller's order.
// A tone only colors the dot; text stays neutral.
import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { neutral as n, tone as toneTokens, px, radius, space } from '@/lib/ds/tokens';
import { DateText } from '@/components/ds/format/DateText';
import type { DsBaseProps, Tone } from './types';

export type TimelineEvent = { id?: string; at: Date | string | number; label: string; tone?: Tone; detail?: ReactNode };

export type TimelineProps = DsBaseProps & {
  events: TimelineEvent[];
  /** Date display of each event (default `datetime`). */
  dateMode?: 'datetime' | 'date' | 'relative';
};

export function Timeline({ events, dateMode = 'datetime', className, 'data-testid': testId }: TimelineProps) {
  return (
    <Box component="ol" className={className} data-testid={testId} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const dot = e.tone ? toneTokens[e.tone].solid : n[300];
        return (
          <Box component="li" key={e.id ?? i} sx={{ display: 'grid', gridTemplateColumns: '16px 1fr', columnGap: px(space[2]) }}>
            <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
              <Box sx={{ mt: px(6), width: px(8), height: px(8), borderRadius: px(radius.full), bgcolor: dot, zIndex: 1 }} />
              {!last && <Box aria-hidden sx={{ position: 'absolute', top: px(16), bottom: 0, width: px(1), bgcolor: n[200] }} />}
            </Box>
            <Box sx={{ pb: last ? 0 : px(space[3]), minWidth: 0 }}>
              <Typography variant="dense" component="p" sx={{ m: 0, color: n[800] }}>{e.label}</Typography>
              <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>
                <DateText value={e.at} mode={dateMode} />
              </Typography>
              {e.detail && (
                <Typography variant="caption" component="div" sx={{ color: n[600], mt: px(space[0.5]) }}>{e.detail}</Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default Timeline;
