// components/ds/shell/SideNavItem.tsx — one sidebar row (shell-nav §3.1 measurements, §3.2 rail).
//
// Expanded: 32 px row, 8 px side margin, 8 px inner padding, radius 6, 18 px icon or 16 px LogoTile,
// label 13/500 neutral-600, right-aligned `micro` tabular count (99+ cap) or a 6 px dot.
// Rail: a 40 × 40 hit area centred in the 64 px column, 20 px icon or LogoTile, the count becomes a 6 px
// dot, and a Tooltip carries the label, the count/dot sentence and the `g` shortcut.
// Active: neutral-0 background, neutral-900 text/icon, e1 shadow + 1 px neutral-200 border; `aria-current`.
// A dot is never the only signal: the aria-label carries the sentence (shell-nav §3.1, §13).
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { ICON_STROKE } from '@/lib/ds/icons';
import { elevation, focusRing, motion, neutral as n, px, radius, tone } from '@/lib/ds/tokens';
import type { NavItem } from '@/lib/nav/useNavModel';

export type SideNavItemProps = {
  item: NavItem;
  /** Rail (64 px) rendering. */
  rail: boolean;
  /** Called after a click (the overlay closes on navigation). */
  onNavigate?: () => void;
};

/** "99+" cap (shell-nav §3.1). */
export function formatNavCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Visible-text-free summary of a row's badge for tooltips and aria-labels. */
export function itemDetail(item: Pick<NavItem, 'countLabel' | 'dotLabel'>): string {
  return [item.dotLabel, item.countLabel].filter(Boolean).join(' · ');
}

/** `g o` in the rail tooltip. */
export function itemShortcut(item: Pick<NavItem, 'gKey'>): string | undefined {
  return item.gKey ? `G ${item.gKey.toLocaleUpperCase('en')}` : undefined;
}

const DOT_COLOR = {
  warning: tone.warning.solid,
  danger: tone.danger.solid,
  attention: tone.attention.solid,
} as const;

function Dot({ color, testId }: { color: string; testId?: string }) {
  return (
    <Box
      component="span"
      aria-hidden
      data-testid={testId}
      sx={{ width: 6, height: 6, borderRadius: px(radius.full), bgcolor: color, flexShrink: 0 }}
    />
  );
}

export function SideNavItem({ item, rail, onNavigate }: SideNavItemProps) {
  const detail = itemDetail(item);
  const ariaLabel = detail ? `${item.ariaLabel}, ${detail}` : item.ariaLabel;
  const Icon = item.icon;
  const iconColor = item.active ? n[900] : n[500];

  const glyph = item.brand ? (
    <LogoTile brand={item.brand} size={rail ? 20 : 16} label={item.ariaLabel} />
  ) : Icon ? (
    <Icon size={rail ? 20 : 18} strokeWidth={ICON_STROKE} aria-hidden color={iconColor} />
  ) : null;

  // Dot wins over the count (shell-nav §3.1: "When a row has both, the warning dot wins").
  const badge = item.dot ? (
    <Dot color={DOT_COLOR[item.dot]} testId={`nav-dot-${item.id}`} />
  ) : item.count ? (
    rail ? (
      <Dot color={item.countTone === 'danger' ? tone.danger.solid : n[500]} testId={`nav-dot-${item.id}`} />
    ) : (
      <Typography
        component="span"
        variant="micro"
        aria-hidden
        data-testid={`nav-count-${item.id}`}
        sx={{
          ml: 'auto',
          fontVariantNumeric: 'tabular-nums',
          color: item.countTone === 'danger' ? tone.danger.fg : n[500],
        }}
      >
        {formatNavCount(item.count)}
      </Typography>
    )
  ) : null;

  const link = (
    <Box
      component={NextLink}
      href={item.href}
      onClick={onNavigate}
      aria-label={ariaLabel}
      aria-current={item.active ? 'page' : undefined}
      data-testid={`nav-item-${item.id}`}
      data-active={item.active ? 'true' : undefined}
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: px(8),
        boxSizing: 'border-box',
        textDecoration: 'none',
        borderRadius: px(radius.sm),
        border: '1px solid transparent',
        color: item.active ? n[900] : n[600],
        transition: `background-color ${motion.fast}ms ${motion.ease}`,
        ...(rail
          ? { width: 40, height: 40, mx: 'auto', justifyContent: 'center' }
          : { height: 32, mx: px(8), px: px(8) }),
        ...(item.active
          ? { bgcolor: n[0], borderColor: n[200], boxShadow: elevation.e1 }
          : { '&:hover': { bgcolor: n[100] } }),
        '&:focus-visible': { outline: 'none', boxShadow: focusRing },
      }}
    >
      {glyph}
      {rail ? (
        badge ? (
          <Box component="span" sx={{ position: 'absolute', top: 6, right: 6, display: 'inline-flex' }}>
            {badge}
          </Box>
        ) : null
      ) : (
        <>
          <Typography
            component="span"
            variant="label"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'inherit',
              fontWeight: item.active ? 600 : 500,
            }}
          >
            {item.label}
          </Typography>
          {badge}
        </>
      )}
    </Box>
  );

  const row = (
    <Box component="li" sx={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }} data-nav-id={item.id}>
      {rail || detail ? (
        <Tooltip
          title={rail ? (detail ? `${item.ariaLabel} · ${detail}` : item.ariaLabel) : detail}
          shortcut={rail ? itemShortcut(item) : undefined}
          placement="right"
          enterDelay={400}
        >
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </Box>
  );
  return row;
}

export default SideNavItem;
