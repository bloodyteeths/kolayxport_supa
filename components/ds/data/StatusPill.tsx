// components/ds/data/StatusPill.tsx — DESIGN_SYSTEM §3.9. Fixed vocabulary: `domain` + `status` only, no free
// label. The label comes from i18n `status.<domain>.<key>`; the raw marketplace value is the tooltip.
// Pills are never buttons (a clickable status is a FilterButton). At most one order pill and one sync pill per row.

import { Box, Tooltip } from '@mui/material';
import { useTranslations } from 'next-intl';
import { accent, motion, radius, tone as toneTokens, type as typeScale, zIndex } from '@/lib/ds/tokens';
import {
  getStatusStyle,
  statusMessageKey,
  type StatusDomain,
  type StatusKeyOf,
} from '@/lib/ds/status/vocabulary';

export interface StatusPillProps<D extends StatusDomain = StatusDomain> {
  domain: D;
  /** A key of `domain`. `null`/`undefined` renders nothing (mapping functions return null for "no pill"). */
  status: StatusKeyOf<D> | null | undefined;
  /** Raw marketplace value for the tooltip ("Etsy: paid, unshipped"). */
  raw?: string | null;
  /** `md` 20px (default, tables and panels) · `sm` 18px (dense captions). */
  size?: 'sm' | 'md';
  className?: string;
  'data-testid'?: string;
}

const [microSize, microLine, microWeight, microTracking] = typeScale.micro;

export function StatusPill<D extends StatusDomain>({
  domain,
  status,
  raw,
  size = 'md',
  className,
  'data-testid': testId,
}: StatusPillProps<D>) {
  const t = useTranslations('status');
  if (status == null) return null;
  const style = getStatusStyle(domain, status);
  if (!style) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[StatusPill] unknown status "${domain}.${String(status)}"`);
    }
    return null;
  }
  const tk = toneTokens[style.tone];
  const dot = style.dot ?? 'solid';
  const dotColor = dot === 'accent' ? accent[600] : tk.solid;
  const height = size === 'sm' ? 18 : 20;
  const label = t(statusMessageKey(domain, status));

  const pill = (
    <Box
      component="span"
      className={className}
      data-testid={testId}
      data-domain={domain}
      data-status={status}
      data-tone={style.tone}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height,
        px: '8px',
        borderRadius: `${radius.full}px`,
        bgcolor: style.outline ? 'transparent' : tk.bg,
        border: '1px solid',
        borderColor: style.outline ? tk.border : 'transparent',
        color: tk.fg,
        fontSize: microSize,
        lineHeight: `${microLine}px`,
        fontWeight: microWeight,
        letterSpacing: microTracking,
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
        maxWidth: '100%',
      }}
    >
      <Box
        component="span"
        aria-hidden
        data-dot={dot}
        sx={{
          flex: '0 0 auto',
          width: 6,
          height: 6,
          borderRadius: '50%',
          boxSizing: 'border-box',
          bgcolor: dot === 'hollow' ? 'transparent' : dotColor,
          border: dot === 'hollow' ? `1.5px solid ${dotColor}` : 'none',
          ...(dot === 'pulse'
            ? {
                '@keyframes kxPillPulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
                animation: `kxPillPulse 1.2s ${motion.ease} infinite`,
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }
            : {}),
        }}
      />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </Box>
    </Box>
  );

  if (!raw) return pill;
  return (
    <Tooltip describeChild title={raw} enterDelay={400} slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}>
      {pill}
    </Tooltip>
  );
}

export default StatusPill;
