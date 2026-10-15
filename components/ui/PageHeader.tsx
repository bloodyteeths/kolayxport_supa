import React from 'react';
import { PageHeader as DsPageHeader } from '@/components/ds/page/PageHeader';

/**
 * M1-f shim → `components/ds/page/PageHeader` (DESIGN_SYSTEM §3.2/§4.2; deleted in M10).
 *
 * Adapter (legacy prop → DS prop):
 * - `title` → `title`, `subtitle` → `subtitle` (one line, caption)
 * - `children` (arbitrary right-aligned action elements) → `actionsSlot`
 * - `className`, `data-testid` pass through
 * Legacy pages are not inside a shell-managed `<Page>`, so the DS header keeps the title on mobile too.
 * New code: pass `primaryAction` / `secondaryActions` / `overflowActions` as `ActionSpec`s to the DS header.
 */

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Right-aligned actions (legacy slot → DS `actionsSlot`). */
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

export default function PageHeader({ title, subtitle, children, className, 'data-testid': testId }: PageHeaderProps) {
  return (
    <DsPageHeader
      title={title}
      subtitle={subtitle}
      actionsSlot={children ?? undefined}
      className={className}
      data-testid={testId}
    />
  );
}

export { PageHeader };
