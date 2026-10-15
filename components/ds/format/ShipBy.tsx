// components/ds/format/ShipBy.tsx — DS §3.12: ONE phrase. Danger when overdue, warning when due within 24h.
// Never relative and absolute together (the absolute deadline is the tooltip). Unknown → "—" (orders §8:
// never a guessed date).

import { Box, Tooltip } from '@mui/material';
import { useTranslations } from 'next-intl';
import { EMPTY, useFormatters, type DateInput } from '@/lib/format';
import { neutral, tone, zIndex } from '@/lib/ds/tokens';

export interface ShipByProps {
  date: DateInput;
  /** When set, renders the neutral "Shipped Oct 14" instead of the deadline. */
  shippedAt?: DateInput;
  now?: Date;
  className?: string;
  'data-testid'?: string;
}

// Unknown deadline: the dash is decorative, screen readers get the words.
const SR_ONLY = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;

export function ShipBy({ date, shippedAt, now, className, 'data-testid': testId }: ShipByProps) {
  const f = useFormatters();
  const t = useTranslations('ds.shipBy');
  const p = f.shipByParts(date, shippedAt, now);
  const color = p.tone === 'danger' ? tone.danger.fg : p.tone === 'warning' ? tone.warning.fg : undefined;
  const unknown = p.kind === 'unknown';
  const node = (
    <Box
      component="span"
      className={className}
      data-testid={testId}
      data-tone={p.tone}
      data-kind={p.kind}
      suppressHydrationWarning
      sx={{
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        ...(color ? { color, fontWeight: 500 } : unknown ? { color: neutral[500] } : {}),
      }}
    >
      {unknown ? (
        <>
          <span aria-hidden>{EMPTY}</span>
          <Box component="span" sx={SR_ONLY}>
            {t('unknown')}
          </Box>
        </>
      ) : (
        t(p.key, p.values)
      )}
    </Box>
  );
  const title = unknown ? t('unknown') : p.absolute;
  return (
    <Tooltip describeChild title={title} enterDelay={400} slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}>
      {node}
    </Tooltip>
  );
}

export default ShipBy;
