import React from 'react';
import { EmptyState as DsEmptyState } from '@/components/ds/state/EmptyState';

/**
 * M1-f shim → `components/ds/state/EmptyState` (DESIGN_SYSTEM §3.13/§4.7 "Shims"; deleted in M10).
 *
 * Pure delegate. Adapter (legacy prop → DS prop):
 * - `icon` (a rendered element, 28–32px) → DS `icon` element (forced to 20px in the 40px tile); any other
 *   renderable node (string, emoji, fragment array) is wrapped in a span so it is not dropped; no icon → no tile
 * - `title` → `title`; `message` → `body` (clamped to 2 lines)
 * - `action` (a rendered button) → DS `actionNode`
 * - `className`, `data-testid` pass through; DS `kind="first-use"`
 * New code: use `components/ds/state/EmptyState` with a registry icon and an ActionSpec.
 */

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  /** Body text (DS: `body`), clamped to 2 lines. */
  message?: string;
  /** A rendered action (legacy). One only. */
  action?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Legacy `icon` is any ReactNode; the DS slot takes an element, so wrap non-element content instead of dropping it. */
function toIconElement(icon: React.ReactNode): React.ReactElement | null {
  if (React.isValidElement(icon)) return icon;
  if (icon === null || icon === undefined || typeof icon === 'boolean' || icon === '') return null;
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
      {icon}
    </span>
  );
}

export default function EmptyState({ icon, title, message, action, className, 'data-testid': testId }: EmptyStateProps) {
  return (
    <DsEmptyState
      kind="first-use"
      icon={toIconElement(icon)}
      title={title}
      body={message}
      actionNode={action}
      className={className}
      data-testid={testId}
    />
  );
}

export { EmptyState };
