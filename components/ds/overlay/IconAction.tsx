import React from 'react';
import { IconButton } from '../inputs/IconButton';
import type { LucideIcon } from '@/lib/ds/icons';

export interface IconActionProps {
  icon: LucideIcon;
  /** Required accessible name, also the tooltip. */
  label: string;
  shortcut?: string;
  size?: 'sm' | 'md';
  /** `secondary` adds the 1px neutral border (page-header ⋯). Default ghost. */
  variant?: 'ghost' | 'secondary';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
  'aria-haspopup'?: boolean | 'menu';
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
}

/**
 * Labelled icon button for overlay chrome (close, prev/next, ⋯). A thin adapter over the public DS
 * `IconButton` (components/ds/inputs/IconButton) so there is one icon-button implementation (P4).
 */
export const IconAction = React.forwardRef<HTMLButtonElement, IconActionProps>(function IconAction(
  { icon, label, shortcut, size = 'sm', variant, onClick, disabled, className, ...rest },
  ref,
) {
  return (
    <IconButton
      ref={ref}
      icon={icon}
      label={label}
      shortcut={shortcut}
      size={size}
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      className={className}
      data-testid={rest['data-testid']}
      aria-haspopup={rest['aria-haspopup']}
      aria-expanded={rest['aria-expanded']}
      aria-controls={rest['aria-controls']}
    />
  );
});
