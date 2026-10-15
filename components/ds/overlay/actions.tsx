import React from 'react';
import { Button, type ButtonVariant } from '../inputs/Button';
import type { ControlSize } from '../inputs/types';
import type { ActionSpec } from '../types/actions';

export type { ActionSpec } from '../types/actions';

export type ActionVariant = ButtonVariant;
export type ActionSize = ControlSize;

export interface ActionButtonProps {
  action: ActionSpec;
  /** Visual role. A `tone: 'danger'` action renders `danger` for primary/danger, otherwise `danger-ghost`. */
  variant?: ActionVariant;
  size?: ActionSize;
  fullWidth?: boolean;
  autoFocus?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** Maps an ActionSpec's tone onto the requested button variant (DS §3.8). */
export function resolveActionVariant(action: Pick<ActionSpec, 'tone'>, variant: ActionVariant): ActionVariant {
  if (action.tone !== 'danger') return variant;
  return variant === 'primary' || variant === 'danger' ? 'danger' : 'danger-ghost';
}

/**
 * The one DS renderer for an `ActionSpec` (P4: one component per concept). A thin adapter over the DS
 * `Button` (components/ds/inputs/Button): `loading` keeps the width and shows `loadingLabel`, a disabled
 * action with a `disabledReason` gets a tooltip, `href` renders a next/link. Used by Modal, SidePanel,
 * BottomSheet, StickyActionBar, Banner, EmptyState, ErrorState, PageHeader, Section and BulkActionBar.
 */
export function ActionButton({ action, variant = 'secondary', size = 'md', fullWidth, autoFocus, className, ...rest }: ActionButtonProps) {
  return (
    <Button
      variant={resolveActionVariant(action, variant)}
      size={size}
      icon={action.icon}
      loading={action.loading}
      loadingLabel={action.loadingLabel}
      disabled={action.disabled}
      disabledReason={action.disabledReason}
      href={action.href}
      onClick={action.onClick ? () => action.onClick?.() : undefined}
      fullWidth={fullWidth}
      autoFocus={autoFocus}
      className={className}
      data-testid={rest['data-testid'] ?? `action-${action.id}`}
    >
      {action.label}
    </Button>
  );
}
