// components/ds/types/actions.ts — DESIGN_SYSTEM §4 "Shared types": the single ActionSpec.
// Every DS module (page, toolbar, overlay, inputs, data, state, feedback) imports or re-exports this one
// declaration; do not declare another copy.
import type { LucideIcon } from '@/lib/ds/icons';

/** One header / footer / bulk / menu action. */
export type ActionSpec = {
  id: string;
  /** Already-translated label. */
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  href?: string;
  /** Display-only shortcut hint (the binding itself goes through useShortcuts). */
  shortcut?: string;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  /** Tooltip shown on a disabled action (P1: a disabled button always says why). */
  disabledReason?: string;
  tone?: 'default' | 'danger';
  paletteGroup?: 'actions' | 'goto';
};
