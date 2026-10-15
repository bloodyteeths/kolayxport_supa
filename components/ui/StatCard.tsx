import React from 'react';
import Box from '@mui/material/Box';
import { useLocale } from 'next-intl';
import { neutral, tone, type, radius, px, font, space } from '@/lib/ds/tokens';
import { fmtDelta } from '@/lib/format';

/**
 * M1-f shim (DESIGN_SYSTEM §4.4: `ds/data/KpiTile` replaces `ui/StatCard`; deleted in M10).
 * Legacy props are kept; the look is the DS KpiTile: a neutral tile (white, 1px neutral-200, radius 8, 16px
 * padding), caption label 12 neutral-500 with the icon at 16px neutral-400, a `title-lg` tabular value and the
 * KPI delta from `lib/format` fmtDelta: "▲ 12.4%" / "▼ 3%" in success/danger text, a flat neutral "0%" at zero
 * (DS §3.12 Delta). `color` no longer tints anything
 * (P2: color only means something) and is accepted for compatibility only.
 * New code: use `components/ds/data/KpiTile`.
 */

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  /** Percentage change, positive or negative (12.4 = +12.4%). */
  trend?: number;
  /** @deprecated ignored (neutral tile). */
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'rose';
  className?: string;
  'data-testid'?: string;
}

export default function StatCard({ label, value, icon, trend, className, 'data-testid': testId }: StatCardProps) {
  const locale = useLocale();
  const [cfs, clh] = type.caption;
  const [vfs, vlh, vfw, vls] = type.titleLg;
  const [mfs, mlh, mfw] = type.micro;
  // lib/format is the only formatter (DS §1/§3.12): ratio in, '▲ 12.4%' / '▼ 3%' / flat '0%' out.
  const delta = trend === undefined || !Number.isFinite(trend) ? null : fmtDelta(trend / 100, { locale });
  const deltaColor = delta?.tone === 'success' ? tone.success.fg : delta?.tone === 'danger' ? tone.danger.fg : tone.neutral.fg;

  return (
    <Box
      className={className}
      data-testid={testId}
      sx={{
        bgcolor: neutral[0],
        border: `1px solid ${neutral[200]}`,
        borderRadius: px(radius.md),
        p: px(space[4]),
        minWidth: 0,
        fontFamily: font.sans,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: px(space[1.5]), color: neutral[500], minWidth: 0 }}>
        {icon && (
          <Box component="span" aria-hidden sx={{ display: 'inline-flex', color: neutral[400], '& svg': { width: px(16), height: px(16), fontSize: px(16) } }}>
            {icon}
          </Box>
        )}
        <Box component="span" sx={{ fontSize: px(cfs), lineHeight: px(clh), fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: px(space[2]), mt: px(space[1]) }}>
        <Box
          component="span"
          sx={{ fontSize: px(vfs), lineHeight: px(vlh), fontWeight: vfw, letterSpacing: vls, color: neutral[900], fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </Box>
        {delta && (
          <Box
            component="span"
            data-trend={delta.direction}
            sx={{ fontSize: px(mfs), lineHeight: px(mlh), fontWeight: mfw, color: deltaColor, fontVariantNumeric: 'tabular-nums' }}
          >
            {delta.text}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export { StatCard };
