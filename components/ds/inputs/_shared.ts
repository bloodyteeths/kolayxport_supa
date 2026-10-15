// components/ds/inputs/_shared.ts — internal helpers for the input primitives (not exported from the barrel).
import { createContext, useContext } from 'react';
import { useLocale } from 'next-intl';
import { control, neutral, accent, tone, radius, focusRing, motion } from '@/lib/ds/tokens';
import type { FieldSize } from './types';
import { COARSE } from '../page/touch';

/** next-intl locale ('en' | 'tr') → BCP-47 locale used by Intl. */
export function toIntlLocale(locale: string): string {
  if (locale === 'tr') return 'tr-TR';
  if (locale === 'en') return 'en-US';
  return locale;
}

export function useIntlLocale(): string {
  return toIntlLocale(useLocale());
}

export { COARSE };

/**
 * DS §2.4: on coarse pointers every control gets at least a 44×44 hit area. For visually small controls
 * (chip ✕, text buttons, tile buttons) a centred transparent ::after extends the target without moving layout.
 * The element must be positioned (MUI ButtonBase is `position: relative`) and no ancestor may clip it.
 */
export const hitSlopAfter = {
  '&::after': {
    content: '""',
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '100%',
    height: '100%',
    minWidth: 44,
    minHeight: 44,
    transform: 'translate(-50%, -50%)',
  },
} as const;
/** `hitSlopAfter` under the coarse-pointer query. Merge `hitSlopAfter` by hand when the sx already has a COARSE key. */
export const hitSlopSx = { [COARSE]: hitSlopAfter } as const;

/** FormField → control wiring (id, aria-describedby, aria-invalid). */
export interface FieldContextValue {
  id: string;
  /** id of the visible <label>, for group controls (radiogroup, select) that aria-labelledby it. */
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  required?: boolean;
}
export const FieldContext = createContext<FieldContextValue | null>(null);
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

/** sx for an MUI OutlinedInput at a DS field size (32 toolbar / 40 form, 44 on coarse pointers). */
export function outlinedInputSx(size: FieldSize) {
  const sm = size === 'sm';
  return {
    minHeight: control[size],
    fontSize: sm ? 13 : 14,
    '& .MuiOutlinedInput-input': {
      padding: sm ? '6px 10px' : '10px 12px',
      [COARSE]: { padding: '12px 12px' },
    },
    '& .MuiInputAdornment-root': { color: neutral[500], fontSize: sm ? 13 : 14 },
    '& .MuiInputAdornment-positionStart': { marginRight: '0px', marginLeft: '2px' },
    '& .MuiInputAdornment-positionEnd': { marginLeft: '0px' },
    [COARSE]: { minHeight: control.lg, fontSize: 16 },
  } as const;
}

/** Floating-layer paper (menus, popovers, date picker): radius md + e2 shadow comes from the theme. */
export const chipBaseSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  height: 24,
  padding: '0 4px 0 8px',
  borderRadius: radius.full,
  border: `1px solid ${neutral[200]}`,
  backgroundColor: neutral[50],
  color: neutral[800],
  fontSize: 13,
  lineHeight: '18px',
  maxWidth: '100%',
  transition: `background-color ${motion.fast}ms ${motion.ease}`,
} as const;

export const focusVisibleSx = {
  '&:focus-visible': { outline: 'none', boxShadow: focusRing },
} as const;

export const toneText = {
  neutral: neutral[500],
  warning: tone.warning.fg,
  danger: tone.danger.fg,
  accent: accent[700],
} as const;

/** Format a number with grouping for the active locale. */
export function fmtInt(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
}
