// DS §1 P3 / §2.4: every control is ≥ 44 on `pointer: coarse`. The theme's MuiIconButton has no
// coarse override, so ds/page + ds/toolbar apply one of these to each icon-only control.
import { control } from '@/lib/ds/tokens';

export const COARSE = '@media (pointer: coarse)';

/** Grows a free-standing icon control (⋯, density, sheet close) to 44×44 on touch. */
export const coarseSize = {
  [COARSE]: { width: control.lg, height: control.lg, minWidth: control.lg },
} as const;

/**
 * Keeps a small inline glyph (search clear, chip ×, menu-row delete) visually small but gives it an
 * invisible 44×44 hit area on touch, so it can stay inside a 32px field or a 20px chip.
 */
export const coarseHitArea = {
  position: 'relative',
  [COARSE]: {
    '&::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: control.lg,
      height: control.lg,
      transform: 'translate(-50%, -50%)',
    },
  },
} as const;
