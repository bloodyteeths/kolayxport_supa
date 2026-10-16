// components/ds/inputs/Button.tsx — DS §3.8. Five variants, five sizes (xs = dense rows), never a gradient or a hover transform.
// A disabled button always explains itself (`disabledReason` tooltip, P1). `loading` keeps the width.
import { forwardRef, useLayoutEffect, useRef, useState, type MouseEvent, type Ref } from 'react';
import MuiButton, { type ButtonProps as MuiButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import NextLink from 'next/link';
import { accent, control, neutral, tone } from '@/lib/ds/tokens';
import { ICON_STROKE, type LucideIcon } from './_icons';
import { COARSE, hitSlopAfter } from './_shared';
import type { ControlSize, DsBaseProps } from './types';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

export interface ButtonProps extends DsBaseProps {
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: LucideIcon;
  /** Only `▾` for menus (DS §3.8). */
  trailingIcon?: LucideIcon;
  loading?: boolean;
  /** Verb shown while loading ("Creating label…"). Defaults to the label. */
  loadingLabel?: string;
  disabled?: boolean;
  /** Tooltip on a disabled button (required by P1 whenever `disabled` is set). */
  disabledReason?: string;
  href?: string;
  /** Opens `href` in a new tab (external links). */
  external?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  fullWidth?: boolean;
  autoFocus?: boolean;
  /** For menu triggers. */
  'aria-haspopup'?: boolean | 'menu' | 'listbox' | 'dialog';
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'aria-label'?: string;
  children: string;
}

const MUI_SIZE: Record<ControlSize, MuiButtonProps['size']> = { xs: 'small', sm: 'small', md: 'medium', lg: 'large', xl: 'large' };

/** Variant → MUI props. Shared with SplitButton so both halves look identical. */
export function muiVariantProps(variant: ButtonVariant): Pick<MuiButtonProps, 'variant' | 'color'> {
  switch (variant) {
    case 'primary': return { variant: 'contained', color: 'primary' };
    case 'secondary': return { variant: 'outlined', color: 'inherit' };
    case 'danger': return { variant: 'contained', color: 'error' };
    case 'danger-ghost': return { variant: 'text', color: 'error' };
    case 'ghost':
    default: return { variant: 'text', color: 'inherit' };
  }
}

export function buttonSizeSx(size: ControlSize) {
  if (size === 'xs') {
    // Dense rows: 28px visual on every pointer; touch gets a 44×44 hit slop instead of a taller button.
    return {
      minHeight: control.xs,
      padding: '0 8px',
      fontSize: 12,
      gap: '4px',
      [COARSE]: { minHeight: control.xs, ...hitSlopAfter },
    };
  }
  return {
    minHeight: control[size],
    ...(size === 'xl' ? { padding: '0 20px', fontSize: 14 } : null),
    // Touch: sm stays compact (36px) with an invisible 44px hit area — growing every small button to 44px made phone
    // cards and panels loose. md and up still grow to 44px (primary actions, footers).
    [COARSE]: size === 'sm' ? { minHeight: 36, ...hitSlopAfter } : { minHeight: Math.max(control[size], control.lg) },
  };
}

/** Secondary/ghost colours: the theme's `inherit` text/outlined colours are neutral-800 / neutral-700. */
export function variantColorSx(variant: ButtonVariant) {
  if (variant === 'secondary') return { color: neutral[800], borderColor: neutral[300], backgroundColor: neutral[0], '&:hover': { backgroundColor: neutral[50], borderColor: neutral[400] } };
  if (variant === 'ghost') return { color: neutral[700], '&:hover': { backgroundColor: neutral[50] } };
  if (variant === 'danger-ghost') return { color: tone.danger.fg, '&:hover': { backgroundColor: tone.danger.bg } };
  return {};
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary', size = 'md', icon: Icon, trailingIcon: Trailing, loading, loadingLabel, disabled,
    disabledReason, href, external, onClick, type = 'button', fullWidth, autoFocus, children, className, 'data-testid': testId,
    'aria-haspopup': ariaHasPopup, 'aria-expanded': ariaExpanded, 'aria-controls': ariaControls, 'aria-label': ariaLabel,
  },
  ref,
) {
  const innerRef = useRef<HTMLButtonElement | null>(null);
  // "Loading keeps the width" (DS §3.8): measure the button while it shows its normal label, then lock that width
  // as minWidth in the first loading render (measuring after the swap would lock the loading label's width).
  const [idleWidth, setIdleWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (loading || !innerRef.current) return;
    const w = innerRef.current.offsetWidth || null;
    if (w !== idleWidth) setIdleWidth(w);
  });
  const lockedWidth = loading ? idleWidth : null;

  const setRefs = (el: HTMLButtonElement | null) => {
    innerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as { current: HTMLButtonElement | null }).current = el;
  };

  const iconSize = size === 'xs' ? 14 : 16;
  const spinnerColor = variant === 'primary' || variant === 'danger' ? neutral[0] : neutral[500];
  const linkProps = href && !disabled
    ? external
      ? { component: 'a' as const, href, target: '_blank', rel: 'noopener noreferrer' }
      : { component: NextLink, href }
    : {};

  const button = (
    <MuiButton
      ref={setRefs as Ref<HTMLButtonElement>}
      {...muiVariantProps(variant)}
      {...(linkProps as Record<string, unknown>)}
      size={MUI_SIZE[size]}
      type={href ? undefined : type}
      disabled={disabled || loading}
      onClick={onClick}
      fullWidth={fullWidth}
      autoFocus={autoFocus}
      className={className}
      data-testid={testId}
      data-variant={variant}
      aria-busy={loading || undefined}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-label={ariaLabel}
      startIcon={
        loading
          ? <CircularProgress size={size === 'xs' ? 12 : 14} thickness={5} sx={{ color: spinnerColor }} aria-hidden />
          : Icon ? <Icon size={iconSize} strokeWidth={ICON_STROKE} aria-hidden /> : undefined
      }
      endIcon={Trailing && !loading ? <Trailing size={iconSize} strokeWidth={ICON_STROKE} aria-hidden /> : undefined}
      sx={{
        ...buttonSizeSx(size),
        ...variantColorSx(variant),
        whiteSpace: 'nowrap',
        ...(lockedWidth ? { minWidth: lockedWidth } : null),
        // Loading is not "disabled" visually for solid variants: keep the colour, dim slightly.
        ...(loading && (variant === 'primary' || variant === 'danger')
          ? { '&.Mui-disabled': { color: neutral[0], backgroundColor: variant === 'danger' ? tone.danger.solid : accent[600], opacity: 0.85 } }
          : null),
      }}
    >
      {loading ? loadingLabel ?? children : children}
    </MuiButton>
  );

  if (disabled && disabledReason) {
    return (
      <Tooltip title={disabledReason}>
        <span style={{ display: fullWidth ? 'flex' : 'inline-flex', cursor: 'not-allowed' }}>{button}</span>
      </Tooltip>
    );
  }
  return button;
});

export default Button;
