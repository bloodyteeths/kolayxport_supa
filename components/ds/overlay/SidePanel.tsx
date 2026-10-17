import React, { useCallback, useId, useRef, useState } from 'react';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useTranslations } from 'next-intl';
import { backdropPanel, control, elevation, motion, neutral as n, panelWidth, radius, tone, zIndex } from '@/lib/ds/tokens';
import { ActionButton, type ActionSpec } from './actions';
import { IconAction } from './IconAction';
import { OverflowMenu } from './OverflowMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { useSheetDrag } from './BottomSheet';
import { CloseIcon, NextIcon, PrevIcon } from './icons.internal';
import { SectionNav, type SectionNavItem } from '../page/SectionNav';

export type SidePanelSize = keyof typeof panelWidth;
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  /** sm 440 · md 560 (default) · lg 720 · xl 960. */
  size?: SidePanelSize;
  title: string;
  /** Logo (LogoTile) or a 40px thumbnail before the title. */
  leading?: React.ReactNode;
  /**
   * One status pill after the title. Pass the rendered `<StatusPill domain status />` (M1-a); a plain
   * node keeps M1-c independent of the status registry.
   */
  status?: React.ReactNode;
  /** Caption line under the title: "#3891 · Etsy · Ordered 14 Oct". */
  meta?: React.ReactNode;
  /** Pad the body (16px) for panels whose content is not made of SidePanelSections (tools, forms). */
  padded?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  primary?: ActionSpec;
  secondary?: ActionSpec;
  /** Footer-left ⋯ (destructive items forced last). In the header when there is no footer. */
  overflow?: ActionSpec[];
  saveState?: SaveState;
  /** Overrides the save-state text, e.g. "Saved · 3 changes not sent to Etsy". */
  saveNote?: React.ReactNode;
  /** Close / prev / next open a nested "Keep editing / Discard" confirm while true. */
  dirty?: boolean;
  /** ⌘/Ctrl+S handler (save draft). */
  onSave?: () => void;
  /**
   * Anchor chips (the shared `ds/page/SectionNav`, non-sticky, scroll-spied on the panel body); rendered only
   * with more than 5 sections (DS §3.5). `state` adds the not-sent / needs-a-fix dot.
   */
  sectionNav?: SectionNavItem[];
  /** Extra content rendered between header and body (e.g. a Banner). Not scrolled. */
  headerSlot?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

const SAVE_KEYS: Record<Exclude<SaveState, 'idle'>, 'dirty' | 'saving' | 'saved' | 'error'> = {
  dirty: 'dirty', saving: 'saving', saved: 'saved', error: 'error',
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * DS §3.5 SidePanel: overlay on the right with the light `backdropPanel` (CRITIQUE C18); the list
 * behind stays mounted. ≥ 900: fixed width by size. 600–899: min(560, 100vw − 48). < 600: full-height
 * bottom sheet with drag handle and a 50/50 48px footer. Header 56 and footer 64 are sticky; only the
 * body scrolls. Keys: Esc close, j/k prev/next (outside inputs), ⌘/Ctrl+Enter primary, ⌘/Ctrl+S onSave.
 */
export function SidePanel({
  open, onClose, size = 'md', title, leading, status, meta, padded, onPrev, onNext, primary, secondary, overflow,
  saveState = 'idle', saveNote, dirty, onSave, sectionNav, headerSlot, children, className, ...rest
}: SidePanelProps) {
  const t = useTranslations('ds.overlay');
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<null | (() => void)>(null);

  const guard = useCallback(
    (fn: () => void) => {
      if (dirty) setPending(() => fn);
      else fn();
    },
    [dirty],
  );
  const requestClose = () => guard(onClose);
  const { drag, handlers: dragHandlers } = useSheetDrag(requestClose);

  const hasFooter = !!(primary || secondary || saveState !== 'idle' || saveNote);
  const saveText = saveNote ?? (saveState !== 'idle' ? t(`saveState.${SAVE_KEYS[saveState]}`) : null);
  const width = isPhone ? '100vw' : isTablet ? `min(${panelWidth.md}px, calc(100vw - 48px))` : `${panelWidth[size]}px`;

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keydowns from portalled descendants (nested Modal/ConfirmDialog, the ⋯ menu, a BottomSheet) bubble
    // here through the React tree although their DOM sits outside the Paper: ignore them, and anything a
    // child already handled.
    if (e.defaultPrevented || !(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter' && primary && !primary.disabled && !primary.loading) {
      e.preventDefault();
      primary.onClick?.();
      return;
    }
    if (mod && (e.key === 's' || e.key === 'S') && onSave) {
      e.preventDefault();
      onSave();
      return;
    }
    if (mod || e.altKey || isTypingTarget(e.target)) return;
    if (e.key === 'j' && onNext) {
      e.preventDefault();
      guard(onNext);
    } else if (e.key === 'k' && onPrev) {
      e.preventDefault();
      guard(onPrev);
    }
  };

  return (
    <>
      <Drawer
        anchor={isPhone ? 'bottom' : 'right'}
        open={open}
        onClose={requestClose}
        className={className}
        data-testid={rest['data-testid'] ?? 'ds-sidepanel'}
        transitionDuration={motion.base}
        SlideProps={{
          onEntered: () => {
            const active = document.activeElement;
            if (!bodyRef.current?.contains(active)) titleRef.current?.focus();
          },
        }}
        sx={{ zIndex: zIndex.drawer }}
        slotProps={{ backdrop: { sx: { backgroundColor: backdropPanel } } }}
        PaperProps={{
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': titleId,
          onKeyDown,
          sx: {
            width,
            height: isPhone ? '100dvh' : '100%',
            maxWidth: '100vw',
            // Home-screen app on iPhone (black-translucent status bar, viewport-fit=cover) draws under the clock:
            // without this the header and its ✕ sat in the untouchable status-bar strip.
            ...(isPhone && { pt: 'env(safe-area-inset-top, 0px)' }),
            display: 'flex',
            flexDirection: 'column',
            bgcolor: n[0],
            boxShadow: elevation.e3,
            borderRadius: isPhone ? `${radius.lg}px ${radius.lg}px 0 0` : `${radius.lg}px 0 0 ${radius.lg}px`,
            overflow: 'hidden',
          },
        }}
      >
        {isPhone && (
          <Box
            data-testid="panel-handle"
            {...dragHandlers}
            sx={{ display: 'flex', justifyContent: 'center', pt: '8px', pb: '4px', cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
          >
            <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: `${radius.full}px`, bgcolor: n[300] }} />
          </Box>
        )}
        {/* header (sticky by layout: only the body scrolls) */}
        <Box sx={{ flexShrink: 0, borderBottom: `1px solid ${n[200]}`, px: '16px', py: '10px', minHeight: 56, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {leading && <Box sx={{ flexShrink: 0, display: 'inline-flex' }}>{leading}</Box>}
            <Box
              id={titleId}
              ref={titleRef}
              component="h2"
              tabIndex={-1}
              sx={{ m: 0, flex: 1, minWidth: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.01em', color: n[900], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', outline: 'none' }}
            >
              {title}
            </Box>
            {status && <Box sx={{ flexShrink: 0, display: 'inline-flex' }}>{status}</Box>}
            {(onPrev || onNext) && !isPhone && ( /* phones: no ‹ › (the title needs the room; close and pick the next card) */
              <Box sx={{ display: 'inline-flex', flexShrink: 0 }}>
                <IconAction icon={PrevIcon} label={t('prev')} shortcut="K" disabled={!onPrev} onClick={() => onPrev && guard(onPrev)} data-testid="panel-prev" />
                <IconAction icon={NextIcon} label={t('next')} shortcut="J" disabled={!onNext} onClick={() => onNext && guard(onNext)} data-testid="panel-next" />
              </Box>
            )}
            {!hasFooter && overflow && overflow.length > 0 && <OverflowMenu items={overflow} />}
            <IconAction icon={CloseIcon} label={t('close')} shortcut="Esc" onClick={requestClose} data-testid="panel-close" />
          </Box>
          {meta && <Box sx={{ mt: '2px', fontSize: 12, lineHeight: '16px', color: n[500], ...(isPhone ? { display: 'flex', flexWrap: 'wrap', '& > *': { flexWrap: 'wrap' } } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>{meta}</Box>}
        </Box>
        {sectionNav && sectionNav.length > 5 && (
          <Box sx={{ px: '16px', bgcolor: n[25], borderBottom: `1px solid ${n[100]}`, '& > nav': { bgcolor: 'transparent', borderBottom: 0 } }}>
            <SectionNav sections={sectionNav} sticky={false} scrollRoot={bodyRef} aria-label={t('sections')} data-testid="panel-section-nav" />
          </Box>
        )}
        {headerSlot && <Box sx={{ flexShrink: 0 }}>{headerSlot}</Box>}
        <Box ref={bodyRef} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', ...(padded ? { p: '16px', display: 'flex', flexDirection: 'column', gap: '16px' } : null) }}>
          {children}
        </Box>
        {hasFooter && (
          <Box
            sx={{
              flexShrink: 0, borderTop: `1px solid ${n[200]}`, bgcolor: n[25], minHeight: 56, px: '16px', py: '10px',
              display: 'flex', alignItems: 'center', gap: '8px',
              ...(isPhone && { flexWrap: 'wrap', pb: 'calc(10px + env(safe-area-inset-bottom, 0px))' }),
            }}
          >
            {overflow && overflow.length > 0 && <OverflowMenu items={overflow} size="md" />}
            <Box
              role="status"
              aria-live="polite"
              data-testid="panel-save-state"
              sx={{
                flex: 1, minWidth: 0, fontSize: 12, lineHeight: '16px', display: 'flex', alignItems: 'center', gap: '6px',
                color: saveState === 'error' ? tone.danger.fg : saveState === 'dirty' ? tone.attention.fg : n[500],
                // Phone: an empty save line used to take a whole row with ⋯ above the buttons. Hide it when empty;
                // when it has text it sits on its own line above ⋯ + buttons.
                ...(isPhone && (saveText || saveState === 'saving' ? { flexBasis: '100%', order: -1 } : { display: 'none' })),
              }}
            >
              {saveState === 'saving' && <CircularProgress size={12} sx={{ color: n[400] }} />}
              {saveText}
            </Box>
            {(secondary || primary) && (
              <Box sx={{ display: 'flex', gap: '8px', ...(isPhone && { flex: 1, minWidth: 0, '& > *': { flex: 1, minWidth: 0 } }) }}>
                {secondary && <ActionButton action={secondary} variant="secondary" size={isPhone ? 'lg' : 'md'} fullWidth={isPhone} />}
                {primary && <ActionButton action={primary} variant="primary" size={isPhone ? 'lg' : 'md'} fullWidth={isPhone} />}
              </Box>
            )}
          </Box>
        )}
      </Drawer>
      <ConfirmDialog
        open={!!pending}
        nested
        title={t('dirtyGuard.title')}
        body={t('dirtyGuard.body')}
        confirmLabel={t('dirtyGuard.discard')}
        cancelLabel={t('dirtyGuard.keep')}
        tone="danger"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const fn = pending;
          setPending(null);
          fn?.();
        }}
      />
    </>
  );
}

/** Height constants for consumers that align content with the panel chrome. */
export const SIDE_PANEL_HEADER_H = 56;
export const SIDE_PANEL_FOOTER_H = 64;
export const SIDE_PANEL_SHEET_BUTTON_H = control.xl;

export default SidePanel;
