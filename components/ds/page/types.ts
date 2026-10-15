// Shared page/toolbar types (DS §4 "Shared types" + shell-nav §6.1 + CRITIQUE C2/C22 additions).

export type { ActionSpec } from '../types/actions';

export type PageWidth = 'list' | 'detail' | 'form' | 'reading';

/** shell-nav §6.1: page-supplied crumbs appended after the navConfig crumbs. */
export type PageBreadcrumb = {
  label: string;
  href?: string;
  menu?: { label: string; href: string }[];
};

/** Common DS props (DS §4 "Every component forwards className and data-testid"). */
export type DsBaseProps = {
  className?: string;
  'data-testid'?: string;
};
