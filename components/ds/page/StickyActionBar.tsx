// DS §4.2 StickyActionBar — the single implementation (components/ds/overlay/StickyActionBar.tsx re-exports
// it). Mobile: fixed above `--kx-bottom-nav`, 48px buttons, 50/50 when a secondary is present, and
// publishes its height as `--kx-action-bar` while mounted (the `_app` Toaster offset reads it, DS §3.14).
// Desktop: a sticky footer bar at the bottom of the content column (e1).
// `primarySlot` / `secondarySlot` take custom content (e.g. M1-b's <SplitButton size="xl"/> "Print ▾");
// buttons inside a slot are held to the 48px mobile height.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { elevation, layout as layoutTokens, neutral, zIndex } from '@/lib/ds/tokens';
import { ActionButton } from './ActionButton';
import { ActionMenu } from './ActionMenu';
import type { ActionSpec, DsBaseProps } from './types';
import { useIsMobile } from './useViewport';

export type StickyActionBarProps = DsBaseProps & {
  /** Status line, e.g. "Saved · 3 edits not sent yet" or "5 selected". */
  status?: React.ReactNode;
  /** The primary action. Optional when `primarySlot` is given (or for a status-only bar, e.g. bulk with no primary). */
  primary?: ActionSpec;
  /** Replaces `primary` with custom content (e.g. a SplitButton). */
  primarySlot?: React.ReactNode;
  secondary?: ActionSpec;
  /** Replaces `secondary` with custom content (e.g. "Print ▾"). */
  secondarySlot?: React.ReactNode;
  /** Accessible name of the region; default the generic ds.overlay.actionBar ("Actions" / "İşlemler").
   *  Pass one when a page can show more than one bar so each region has a distinct name. */
  ariaLabel?: string;
  overflow?: ActionSpec[];
  /** Default true. When false nothing renders (state-driven primaries only show when they apply). */
  visible?: boolean;
  /** Force a layout; default follows the viewport. */
  variant?: 'auto' | 'mobile' | 'desktop';
  /** Alias of `variant` (the prop name the overlay StickyActionBar used). */
  layout?: 'auto' | 'mobile' | 'desktop';
};

/** CSS var read by the `_app` Toaster offset so toasts sit above the bar (DS §3.14). */
export const ACTION_BAR_VAR = '--kx-action-bar';

/** Heights of every mounted mobile bar, so one bar unmounting does not clear the var while another is visible. */
const mountedBarHeights = new Map<symbol, number>();

function publishActionBarVar() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (mountedBarHeights.size === 0) {
    root.style.removeProperty(ACTION_BAR_VAR);
    return;
  }
  root.style.setProperty(ACTION_BAR_VAR, `${Math.max(...mountedBarHeights.values())}px`);
}

/** 50/50 cell; a slot's button(s) fill it at 48px. */
const slotSx = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  '& > *': { flex: 1, minWidth: 0 },
  '& .MuiButtonBase-root': { minHeight: 48 },
} as const;

export function StickyActionBar({
  status,
  primary,
  primarySlot,
  secondary,
  secondarySlot,
  ariaLabel,
  overflow = [],
  visible = true,
  variant,
  layout,
  className,
  ...rest
}: StickyActionBarProps) {
  const t = useTranslations('ds.overlay');
  const isMobileViewport = useIsMobile();
  const mode = variant ?? layout ?? 'auto';
  const mobile = mode === 'mobile' || (mode === 'auto' && isMobileViewport);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!visible || !mobile || typeof document === 'undefined') return undefined;
    const el = ref.current;
    const id = Symbol('kx-action-bar');
    const apply = () => {
      mountedBarHeights.set(id, el?.offsetHeight ?? 0);
      publishActionBarVar();
    };
    apply();
    const RO = typeof window !== 'undefined' ? window.ResizeObserver : undefined;
    const ro = RO && el ? new RO(apply) : null;
    if (ro && el) ro.observe(el);
    return () => {
      ro?.disconnect();
      mountedBarHeights.delete(id);
      publishActionBarVar();
    };
  }, [visible, mobile]);

  if (!visible) return null;
  const testId = rest['data-testid'] ?? 'sticky-action-bar';
  const regionLabel = ariaLabel ?? t('actionBar');
  const hasSecondary = Boolean(secondarySlot || secondary);
  const hasPrimary = Boolean(primarySlot || primary);

  if (mobile) {
    return (
      <Box
        ref={ref}
        role="region"
        aria-label={regionLabel}
        className={className}
        data-testid={testId}
        data-layout="mobile"
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 'var(--kx-bottom-nav, 0px)',
          zIndex: zIndex.stickyActionBar,
          bgcolor: neutral[0],
          borderTop: `1px solid ${neutral[200]}`,
          boxShadow: elevation.e1,
          px: `${layoutTokens.gutterMobile}px`,
          py: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {status ? (
          <Typography variant="caption" component="div" sx={{ color: neutral[600] }} data-testid="sticky-action-bar-status">
            {status}
          </Typography>
        ) : null}
        <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {overflow.length ? <ActionMenu items={overflow} size="md" /> : null}
          {hasSecondary ? (
            <Box sx={slotSx} data-testid="sticky-action-bar-secondary">
              {secondarySlot ?? <ActionButton action={secondary!} variant="secondary" size="xl" fullWidth />}
            </Box>
          ) : null}
          {hasPrimary ? (
            <Box sx={slotSx} data-testid="sticky-action-bar-primary">
              {primarySlot ?? <ActionButton action={primary!} variant="primary" size="xl" fullWidth />}
            </Box>
          ) : null}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      ref={ref}
      role="region"
      aria-label={regionLabel}
      className={className}
      data-testid={testId}
      data-layout="desktop"
      sx={{
        position: 'sticky',
        bottom: 0,
        zIndex: zIndex.stickyToolbar,
        bgcolor: neutral[0],
        borderTop: `1px solid ${neutral[200]}`,
        boxShadow: elevation.e1,
        px: '24px',
        py: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: 64,
      }}
    >
      {overflow.length ? <ActionMenu items={overflow} /> : null}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {status ? (
          <Typography variant="dense" component="div" noWrap sx={{ color: neutral[600] }} data-testid="sticky-action-bar-status">
            {status}
          </Typography>
        ) : null}
      </Box>
      {secondarySlot ?? (secondary ? <ActionButton action={secondary} variant="secondary" size="md" /> : null)}
      {primarySlot ?? (primary ? <ActionButton action={primary} variant="primary" size="md" /> : null)}
    </Box>
  );
}
