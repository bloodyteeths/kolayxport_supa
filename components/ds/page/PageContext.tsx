// Page-level context: lets PageHeader report its actions upward and know whether the app shell owns
// the mobile title / ⋯ (shell-nav §6.1, CRITIQUE C2). M2 shell-F wires `Page` to `ShellContext`.
import * as React from 'react';
import type { ActionSpec, PageBreadcrumb, PageWidth } from './types';

export type PageHeaderActions = {
  primary?: ActionSpec;
  secondary: ActionSpec[];
  overflow: ActionSpec[];
  /** PageHeader `mobilePrimary`; 'menu' puts the primary first in the mobile ⋯ (`mobileOverflow`). */
  mobilePrimary?: 'sticky' | 'menu' | 'none';
};

/** What a page hands to the shell (TopBar, <title>, ⌘K). Emitted by `Page` via `onShellMetaChange`. */
export type PageShellMeta = {
  title: string;
  width: PageWidth;
  breadcrumbs?: PageBreadcrumb[];
  backHref?: string;
  mobileAction?: ActionSpec;
  /**
   * shell-nav §6.1: PageHeader secondaries + overflow, collapsed into the TopBar ⋯ on mobile. When the
   * PageHeader has `mobilePrimary='menu'` (e.g. orders "Add manual order") its primary comes first.
   */
  mobileOverflow: ActionSpec[];
  /** All PageHeader actions (primary first), for usePageActions / ⌘K registration (P3). */
  headerActions: ActionSpec[];
};

export type PageContextValue = {
  title: string;
  width: PageWidth;
  backHref?: string;
  /** True once an AppShell renders the mobile TopBar title and ⋯ (M2). False in M1/legacy layouts. */
  shellManaged: boolean;
  reportHeaderActions: (actions: PageHeaderActions | null) => void;
};

export const PageContext = React.createContext<PageContextValue | null>(null);

export function usePageContext(): PageContextValue | null {
  return React.useContext(PageContext);
}
