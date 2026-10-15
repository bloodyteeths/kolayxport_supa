// components/ds/shell/SoundToggleHost.tsx — neutral host for the backend `LiveSoundToggle` (components/live,
// import only). Used by every shell placement (desktop TopBar, MobileTopBar via `ctx.mobileSoundToggle`,
// MoreSheet account section) so the control looks the same on desktop and mobile.
//
// The descendant selectors out-rank the component's own `sx` icon color, so the backend's MUI palette
// (`warning.main`, `text.secondary`, `text.disabled`) never shows off-palette next to the DS bell:
//   - on and armed  -> neutral-500 (hover neutral-800 on neutral-50)
//   - muted         -> neutral-400 (`aria-pressed="false"`)
//   - needs a click -> DS `tone.warning.fg`, so the "chime will not play until you click" state stays
//     distinct from "armed". The state is read from the volume-down glyph (MUI's default
//     `data-testid="VolumeDownRoundedIcon"`), because the component exposes no state attribute
//     (BR request: `data-sound-state` on the IconButton).
// The live connection dot (MUI Badge) is a status signal and is left as the backend draws it.
import * as React from 'react';
import Box from '@mui/material/Box';
import { neutral as n, px, radius, tone } from '@/lib/ds/tokens';

export type SoundToggleHostProps = {
  children: React.ReactNode;
  /** `sm` = 32 px desktop header button; `touch` = 44 px mobile target. */
  size?: 'sm' | 'touch';
  'data-testid'?: string;
};

export const NEEDS_GESTURE_ICON_SELECTOR = '[data-testid="VolumeDownRoundedIcon"]';

export function soundToggleHostSx(size: 'sm' | 'touch' = 'sm') {
  const box = size === 'touch' ? 44 : 32;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    '& .MuiIconButton-root': {
      width: box,
      height: box,
      minWidth: box,
      minHeight: box,
      p: 0,
      borderRadius: px(radius.sm),
      color: n[500],
    },
    '& .MuiIconButton-root .MuiSvgIcon-root': { color: n[500], fontSize: size === 'touch' ? 20 : 18 },
    '& .MuiIconButton-root[aria-pressed="false"] .MuiSvgIcon-root': { color: n[400] },
    '& .MuiIconButton-root:hover': { bgcolor: n[50] },
    '& .MuiIconButton-root:hover .MuiSvgIcon-root': { color: n[800] },
    // Last, so it also wins over the hover rule (same specificity).
    [`& .MuiIconButton-root .MuiSvgIcon-root${NEEDS_GESTURE_ICON_SELECTOR}`]: { color: tone.warning.fg },
  } as const;
}

export function SoundToggleHost({ children, size = 'sm', 'data-testid': testId = 'sound-toggle-host' }: SoundToggleHostProps) {
  return (
    <Box component="span" data-testid={testId} data-size={size} sx={soundToggleHostSx(size)}>
      {children}
    </Box>
  );
}

export default SoundToggleHost;
