import React from 'react';
import Box from '@mui/material/Box';
import { tone as toneTokens, type, radius, px, font } from '@/lib/ds/tokens';
import type { ToneKey } from '@/lib/ds/tokens';

/**
 * M1-f shim (DESIGN_SYSTEM §4.7 "Shims"; deleted in M10).
 *
 * The DS `StatusPill` takes `domain` + `status` only (no free-form label, DS §3.9), so legacy call sites that
 * pass their own `label` cannot be routed through it. This shim renders the same pill geometry with DS tone
 * tokens (20px tall, micro 11/14 500, 6px dot, soft background, radius full) so legacy pages already get the
 * new look. New code: use `components/ds/data/StatusPill`.
 */

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'purple';

export interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  'data-testid'?: string;
}

/** Legacy variant → DS tone. `purple` has no DS meaning (P2: color only means something) → neutral. */
export const BADGE_TONE: Record<BadgeVariant, ToneKey> = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  info: 'info',
  neutral: 'neutral',
  purple: 'neutral',
};

export default function StatusBadge({
  label,
  variant = 'neutral',
  dot = true,
  size = 'sm',
  className,
  'data-testid': testId,
}: StatusBadgeProps) {
  const toneKey = BADGE_TONE[variant] ?? 'neutral';
  const t = toneTokens[toneKey];
  const small = size === 'sm';
  const [fs, lh, , ls] = small ? type.micro : type.caption;

  return (
    <Box
      component="span"
      className={className}
      data-testid={testId}
      data-tone={toneKey}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: px(6),
        height: px(small ? 20 : 24),
        px: px(small ? 8 : 10),
        borderRadius: px(radius.full),
        bgcolor: t.bg,
        color: t.fg,
        fontFamily: font.sans,
        fontSize: px(fs),
        lineHeight: px(lh),
        fontWeight: 500,
        letterSpacing: ls,
        whiteSpace: 'nowrap',
        maxWidth: '100%',
      }}
    >
      {dot && (
        <Box
          component="span"
          aria-hidden
          sx={{ width: px(6), height: px(6), borderRadius: px(radius.full), bgcolor: t.solid, flexShrink: 0 }}
        />
      )}
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </Box>
    </Box>
  );
}

export { StatusBadge };
