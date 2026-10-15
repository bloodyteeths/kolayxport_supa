// components/ds/inputs/types.ts — shared input/action types (DESIGN_SYSTEM §4 "Shared types").

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'attention' | 'neutral';

/** Control size tokens (DS §2.4): sm 32 · md 40 · lg 44 · xl 48. */
export type ControlSize = 'sm' | 'md' | 'lg' | 'xl';
/** Field controls only come in toolbar (sm 32) and form (md 40) heights. */
export type FieldSize = 'sm' | 'md';

export type { ActionSpec } from '../types/actions';

/** Every DS component forwards these (DS §4). */
export interface DsBaseProps {
  className?: string;
  'data-testid'?: string;
}
