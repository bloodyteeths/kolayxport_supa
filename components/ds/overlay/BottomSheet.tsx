import React, { useId, useRef, useState } from 'react';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { backdrop, elevation, motion, neutral as n, radius, zIndex } from '@/lib/ds/tokens';
import { ActionButton, type ActionSpec } from './actions';
import { IconAction } from './IconAction';
import { CloseIcon } from './icons.internal';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Full viewport height (filters sheet, heavy sub-editors). Default: up to 90vh, sized to content. */
  fullHeight?: boolean;
  /** Sticky footer, typically a 50/50 pair of 48px buttons (see `SheetFooter`). */
  footer?: React.ReactNode;
  /** One ghost action in the header ("Mark all as read"). */
  headerAction?: ActionSpec;
  /** Over a modal or panel: z 1550. */
  nested?: boolean;
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Distance in px a downward drag on the handle must travel to dismiss. */
export const SHEET_DISMISS_DRAG = 80;

/**
 * Pointer drag on a sheet handle: returns the current downward offset (apply as translateY) and the
 * handlers to spread on the handle. Releasing past `SHEET_DISMISS_DRAG` calls `onDismiss` (which may
 * route through a dirty guard). Shared by BottomSheet and the < 600 SidePanel sheet.
 */
export function useSheetDrag(onDismiss: () => void) {
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    setDrag(Math.max(0, e.clientY - startY.current));
  };
  const onPointerUp = () => {
    const d = drag;
    startY.current = null;
    setDrag(0);
    if (d >= SHEET_DISMISS_DRAG) onDismiss();
  };
  return { drag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

/**
 * DS §4.5 BottomSheet: mobile sheet with a drag handle (drag down ≥ 80px to close), 12px top radius,
 * sticky header and footer, safe-area padding. Used for the mobile "More" nav, filters, pickers and
 * full-height sub-editors.
 */
export function BottomSheet({ open, onClose, title, fullHeight, footer, headerAction, nested, children, className, ...rest }: BottomSheetProps) {
  const t = useTranslations('ds.overlay');
  const titleId = useId();
  const { drag, handlers } = useSheetDrag(onClose);

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      className={className}
      data-testid={rest['data-testid'] ?? 'ds-bottomsheet'}
      transitionDuration={motion.slow}
      sx={{ zIndex: nested ? zIndex.nestedModal : zIndex.drawer }}
      slotProps={{ backdrop: { sx: { backgroundColor: backdrop } } }}
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': titleId,
        sx: {
          display: 'flex', flexDirection: 'column', bgcolor: n[0], boxShadow: elevation.e3,
          borderRadius: `${radius.lg}px ${radius.lg}px 0 0`,
          height: fullHeight ? '100dvh' : 'auto',
          maxHeight: fullHeight ? '100dvh' : '90vh',
          // Keep the header below the iPhone status bar in the home-screen app.
          ...(fullHeight ? { pt: 'env(safe-area-inset-top, 0px)' } : { maxHeight: 'calc(90vh - env(safe-area-inset-top, 0px))' }),
          transform: drag ? `translateY(${drag}px) !important` : undefined,
          overflow: 'hidden',
        },
      }}
    >
      <Box
        data-testid="sheet-handle"
        {...handlers}
        sx={{ display: 'flex', justifyContent: 'center', pt: '8px', pb: '4px', cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
      >
        <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: `${radius.full}px`, bgcolor: n[300] }} />
      </Box>
      <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px', px: '16px', minHeight: 48, borderBottom: `1px solid ${n[100]}` }}>
        <Box id={titleId} component="h2" sx={{ m: 0, flex: 1, minWidth: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: n[900], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </Box>
        {headerAction && <ActionButton action={headerAction} variant="ghost" size="sm" />}
        <IconAction icon={CloseIcon} label={t('close')} onClick={onClose} data-testid="sheet-close" />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', ...(!footer && { pb: 'env(safe-area-inset-bottom, 0px)' }) }}>
        {children}
      </Box>
      {footer && (
        <Box sx={{ flexShrink: 0, borderTop: `1px solid ${n[200]}`, bgcolor: n[0], px: '16px', pt: '12px', pb: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
          {footer}
        </Box>
      )}
    </Drawer>
  );
}

export interface SheetFooterProps {
  primary: ActionSpec;
  secondary?: ActionSpec;
}

/** The 50/50 48px footer pair used by every sheet (DS P3 thumb rule). */
export function SheetFooter({ primary, secondary }: SheetFooterProps) {
  return (
    <Box sx={{ display: 'flex', gap: '8px', '& > *': { flex: 1 } }}>
      {secondary && <ActionButton action={secondary} variant="secondary" size="xl" fullWidth />}
      <ActionButton action={primary} variant="primary" size="xl" fullWidth />
    </Box>
  );
}

export default BottomSheet;
