import React, { useId } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { backdrop, elevation, neutral as n, radius, zIndex } from '@/lib/ds/tokens';
import { ActionButton, type ActionSpec } from './actions';
import { IconAction } from './IconAction';
import { CloseIcon } from './icons.internal';

export const MODAL_WIDTH = { sm: 440, md: 560 } as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Already-translated title (title-md). */
  title: string;
  /** Optional one-line description under the title. */
  description?: React.ReactNode;
  size?: 'sm' | 'md';
  /** Confirm inside a panel or another modal: z 1550 instead of 1500. */
  nested?: boolean;
  /** The single primary of this view. `tone: 'danger'` renders the danger button. */
  primary: ActionSpec;
  /** Default: "Cancel" that calls onClose. Pass `null` to render no secondary. */
  secondary?: ActionSpec | null;
  /** Hide the ✕ in the header (e.g. a blocking type-to-confirm). Default false. */
  hideClose?: boolean;
  /** Focus Cancel instead of the primary on open (destructive confirms). */
  focusSecondary?: boolean;
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * DS §3.6 Modal: confirmations, pickers and short forms (≤ 4 fields, no scroll). 440 / 560 wide,
 * 20px padding, right-aligned footer (secondary + primary). ⌘/Ctrl+Enter runs the primary.
 * Never open one on page load; never stack two over a panel (use `nested` for the one confirm).
 */
export function Modal({
  open, onClose, title, description, size = 'sm', nested, primary, secondary, hideClose, focusSecondary, children, className, ...rest
}: ModalProps) {
  const t = useTranslations('ds.overlay');
  const titleId = useId();
  const sec: ActionSpec | null =
    secondary === null ? null : secondary ?? { id: 'cancel', label: t('cancel'), onClick: onClose };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !primary.disabled && !primary.loading) {
      e.preventDefault();
      // The Dialog is portalled but React events still bubble through the React tree: stop here so a
      // SidePanel (or another modal) that renders this one does not run its own primary too.
      e.stopPropagation();
      primary.onClick?.();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={className}
      data-testid={rest['data-testid'] ?? 'ds-modal'}
      sx={{ zIndex: nested ? zIndex.nestedModal : zIndex.modal }}
      slotProps={{ backdrop: { sx: { backgroundColor: backdrop } } }}
      PaperProps={{
        sx: {
          width: `min(${MODAL_WIDTH[size]}px, calc(100vw - 32px))`,
          maxWidth: 'none',
          m: '16px',
          borderRadius: `${radius.lg}px`,
          boxShadow: elevation.e4,
          bgcolor: n[0],
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', p: '20px 20px 8px' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box id={titleId} component="h2" sx={{ m: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.01em', color: n[900] }}>
            {title}
          </Box>
          {description && (
            <Box sx={{ mt: '4px', fontSize: 14, lineHeight: '20px', color: n[500] }}>{description}</Box>
          )}
        </Box>
        {!hideClose && <IconAction icon={CloseIcon} label={t('close')} onClick={onClose} data-testid="modal-close" />}
      </Box>
      {children && <Box sx={{ p: '8px 20px', fontSize: 14, lineHeight: '20px', color: n[800] }}>{children}</Box>}
      <Box
        sx={{
          display: 'flex', justifyContent: 'flex-end', gap: '8px', p: '12px 20px 20px',
          '@media (max-width: 599.95px)': { '& > *': { flex: 1 } },
        }}
      >
        {sec && <ActionButton action={sec} variant="secondary" autoFocus={focusSecondary} />}
        <ActionButton action={primary} variant="primary" />
      </Box>
    </Dialog>
  );
}

export default Modal;
