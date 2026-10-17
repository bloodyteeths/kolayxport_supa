// components/ds/inputs/IconButton.tsx — DS §3.8: `label` is required (aria-label + tooltip with the shortcut).
import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import MuiIconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import NextLink from 'next/link';
import { control, neutral, tone, accent, radius } from '@/lib/ds/tokens';
import { COARSE, hitSlopAfter } from './_shared';
import { ICON_STROKE, type LucideIcon } from './_icons';
import type { DsBaseProps } from './types';

export interface IconButtonProps extends DsBaseProps {
  icon: LucideIcon;
  /** Required: aria-label and tooltip text. */
  label: string;
  /** xs 28 (dense rows: stays 28 on touch with a 44 hit slop) · sm 32 (default) · md 40 · lg 44. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary';
  tone?: 'default' | 'danger';
  /** Shown in the tooltip, e.g. "⌘K" or "j". */
  shortcut?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  href?: string;
  external?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Toggle buttons (sound on/off, density). */
  pressed?: boolean;
  /** Small counter/dot rendered at the top-right (e.g. the bell's unread pill). */
  badge?: ReactNode;
  /** Hide the tooltip (e.g. when the trigger opens a menu that already names it). */
  noTooltip?: boolean;
  'aria-haspopup'?: boolean | 'menu' | 'listbox' | 'dialog';
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  type?: 'button' | 'submit';
}

const ICON_PX = { xs: 14, sm: 16, md: 18, lg: 20 } as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon, label, size = 'sm', variant = 'ghost', tone: btnTone = 'default', shortcut, onClick, href, external,
    disabled, disabledReason, pressed, badge, noTooltip, className, 'data-testid': testId, type = 'button',
    'aria-haspopup': ariaHasPopup, 'aria-expanded': ariaExpanded, 'aria-controls': ariaControls,
  },
  ref,
) {
  const px = control[size];
  const linkProps = href && !disabled
    ? external
      ? { component: 'a' as const, href, target: '_blank', rel: 'noopener noreferrer' }
      : { component: NextLink, href, ...(href.startsWith('/api/') ? { prefetch: false } : {}) }
    : {};
  const btn = (
    <MuiIconButton
      ref={ref}
      {...(linkProps as Record<string, unknown>)}
      type={href ? undefined : type}
      aria-label={label}
      aria-pressed={pressed}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      disabled={disabled}
      onClick={onClick}
      className={className}
      data-testid={testId}
      sx={{
        position: 'relative',
        width: px,
        height: px,
        padding: 0,
        borderRadius: `${radius.sm}px`,
        color: btnTone === 'danger' ? tone.danger.fg : neutral[500],
        ...(variant === 'secondary' ? { border: `1px solid ${neutral[300]}`, backgroundColor: neutral[0], color: neutral[700] } : null),
        ...(pressed ? { backgroundColor: accent[50], color: accent[700] } : null),
        '&:hover': { backgroundColor: btnTone === 'danger' ? tone.danger.bg : neutral[50], color: btnTone === 'danger' ? tone.danger.fg : neutral[800] },
        '&.Mui-disabled': { color: neutral[400] },
        // Touch: xs/sm keep their visual size with an invisible 44px hit area (growing them to 44px made every row
        // with a ⋯ / copy / arrow button taller on phones — the founder's "huge white spaces"). md/lg grow as before.
        [COARSE]: size === 'xs' || size === 'sm'
          ? hitSlopAfter
          : { width: Math.max(px, control.lg), height: Math.max(px, control.lg) },
      }}
    >
      <Icon size={ICON_PX[size]} strokeWidth={ICON_STROKE} aria-hidden />
      {badge ? (
        <Box component="span" sx={{ position: 'absolute', top: 2, right: 2, pointerEvents: 'none', display: 'inline-flex' }}>
          {badge}
        </Box>
      ) : null}
    </MuiIconButton>
  );

  if (disabled) {
    if (!disabledReason) return btn;
    return (
      <Tooltip title={disabledReason}>
        <span style={{ display: 'inline-flex' }}>{btn}</span>
      </Tooltip>
    );
  }
  if (noTooltip) return btn;
  return <Tooltip title={shortcut ? `${label} · ${shortcut}` : label}>{btn}</Tooltip>;
});

export default IconButton;
